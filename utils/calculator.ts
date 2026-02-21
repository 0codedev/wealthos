/**
 * WealthOS Command Palette Math & FX Expression Evaluator
 * Safely evaluates arithmetic expressions, currency conversions, and Indian index lot sizes.
 */

// Approximate FX reference rates to INR
const FX_RATES_TO_INR: Record<string, number> = {
    USD: 87.25,
    EUR: 92.40,
    GBP: 110.15,
    AED: 23.75,
    SGD: 64.80,
    CAD: 61.50,
    AUD: 55.20,
    JPY: 0.58,
    USDT: 89.50,
    BTC: 8250000
};

// Indian F&O Index Lot Sizes
const INDEX_LOT_SIZES: Record<string, number> = {
    NIFTY: 25,
    BANKNIFTY: 15,
    FINNIFTY: 25,
    MIDCPNIFTY: 50,
    SENSEX: 10,
    BANKEX: 15
};

export interface CalcResult {
    isValid: boolean;
    expression: string;
    result: number;
    formattedResult: string;
    explanation?: string;
    isCurrency?: boolean;
}

/**
 * Tokenizes and evaluates a standard arithmetic expression safely (without eval).
 */
function evaluateArithmetic(expr: string): number | null {
    try {
        // Clean and validate characters: only numbers, operators, parens, decimal, spaces
        const sanitized = expr.replace(/,/g, '').trim();
        if (!/^[\d\s+\-*/().%^]+$/.test(sanitized)) {
            return null;
        }

        // Handle percentage: e.g. "500 * 18%" -> "500 * 0.18" or "100 + 20%" -> "100 * 1.2"
        let processed = sanitized.replace(/(\d+(?:\.\d+)?)%/g, '($1 / 100)');
        // Handle power operator ^
        processed = processed.replace(/\^/g, '**');

        // Safe Function constructor for math only
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const fn = new Function(`"use strict"; return (${processed});`);
        const value = fn();

        if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
            return value;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Evaluates any user input query for math, currency conversion, or lot sizing.
 */
export function evaluateCommandExpression(rawQuery: string): CalcResult | null {
    if (!rawQuery || rawQuery.trim().length < 2) return null;

    let query = rawQuery.trim();

    // Strip leading '>' or '=' if present
    if (query.startsWith('>') || query.startsWith('=')) {
        query = query.substring(1).trim();
    }

    // 1. Currency Conversion check (e.g. "100 USD in INR", "$50 to INR", "5000 INR in USD")
    const currencyPattern = /^(?:(\$|€|£|₹)?\s*([\d,.]+)\s*([a-zA-Z]{3})?)\s*(?:in|to|=)\s*([a-zA-Z]{3}|₹|\$|€|£)$/i;
    const currMatch = query.match(currencyPattern);

    if (currMatch) {
        const symbol = currMatch[1];
        const amountStr = currMatch[2].replace(/,/g, '');
        let fromCurr = (currMatch[3] || '').toUpperCase();
        let toCurr = currMatch[4].toUpperCase();

        if (symbol === '$') fromCurr = 'USD';
        if (symbol === '€') fromCurr = 'EUR';
        if (symbol === '£') fromCurr = 'GBP';
        if (symbol === '₹') fromCurr = 'INR';

        if (toCurr === '₹') toCurr = 'INR';
        if (toCurr === '$') toCurr = 'USD';
        if (toCurr === '€') toCurr = 'EUR';

        const amount = parseFloat(amountStr);
        if (!isNaN(amount) && fromCurr && toCurr) {
            let amountInInr = amount;
            if (fromCurr !== 'INR') {
                const rate = FX_RATES_TO_INR[fromCurr];
                if (!rate) return null;
                amountInInr = amount * rate;
            }

            let finalAmount = amountInInr;
            if (toCurr !== 'INR') {
                const targetRate = FX_RATES_TO_INR[toCurr];
                if (!targetRate) return null;
                finalAmount = amountInInr / targetRate;
            }

            const formatted = toCurr === 'INR' 
                ? `₹${finalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
                : `${toCurr} ${finalAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

            return {
                isValid: true,
                expression: query,
                result: finalAmount,
                formattedResult: formatted,
                explanation: `FX Conversion (${fromCurr} → ${toCurr})`,
                isCurrency: true
            };
        }
    }

    // 2. Index Lot sizing calculation (e.g. "5 lots Nifty * 150" or "Nifty 4 lots")
    const lotPattern = /(\d+)\s*(?:lots?|lot)\s*(?:of\s*)?(nifty|banknifty|finnifty|midcpnifty|sensex)/i;
    const lotMatch = query.match(lotPattern);
    if (lotMatch) {
        const lotCount = parseInt(lotMatch[1], 10);
        const indexKey = lotMatch[2].toUpperCase();
        const lotSize = INDEX_LOT_SIZES[indexKey];
        if (lotSize) {
            const totalQty = lotCount * lotSize;
            return {
                isValid: true,
                expression: query,
                result: totalQty,
                formattedResult: `${totalQty.toLocaleString('en-IN')} Qty (${lotCount} Lots × ${lotSize})`,
                explanation: `${indexKey} F&O Lot Sizing`
            };
        }
    }

    // 3. Pure Arithmetic Evaluation
    const mathResult = evaluateArithmetic(query);
    if (mathResult !== null) {
        const isDecimal = mathResult % 1 !== 0;
        const formatted = mathResult.toLocaleString('en-IN', {
            maximumFractionDigits: isDecimal ? 4 : 0
        });

        return {
            isValid: true,
            expression: query,
            result: mathResult,
            formattedResult: formatted,
            explanation: 'Math Calculation'
        };
    }

    return null;
}
