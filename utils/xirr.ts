/**
 * XIRR (Extended Internal Rate of Return) Calculator
 * 
 * Uses Newton-Raphson method to calculate the annualized return
 * for a series of irregular cash flows.
 */

export interface CashFlow {
    date: Date;
    amount: number; // negative for outflows (investments), positive for inflows (returns/withdrawals)
}

interface XirrInvestmentLike {
    id?: string;
    lastUpdated: string;
    createdAt?: string;
    effectiveAt?: string;
    acquiredAt?: string;
    investedAmount: number;
    currentValue: number;
}

/**
 * Calculate the difference in years between two dates (actual/365)
 */
const yearFraction = (d1: Date, d2: Date): number => {
    return (d2.getTime() - d1.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
};

/**
 * Net Present Value of cash flows at a given rate
 */
const npv = (rate: number, cashFlows: CashFlow[], baseDate: Date): number => {
    return cashFlows.reduce((sum, cf) => {
        const years = yearFraction(baseDate, cf.date);
        return sum + cf.amount / Math.pow(1 + rate, years);
    }, 0);
};

/**
 * Derivative of NPV with respect to rate
 */
const npvDerivative = (rate: number, cashFlows: CashFlow[], baseDate: Date): number => {
    return cashFlows.reduce((sum, cf) => {
        const years = yearFraction(baseDate, cf.date);
        if (years === 0) return sum;
        return sum - years * cf.amount / Math.pow(1 + rate, years + 1);
    }, 0);
};

/**
 * Fallback bisection method for when Newton-Raphson doesn't converge
 */
const bisectionXIRR = (
    cashFlows: CashFlow[],
    baseDate: Date,
    tolerance: number = 1e-5
): number | null => {
    let low = -0.9;
    let high = 10.0;

    const valueLow = npv(low, cashFlows, baseDate);
    const valueHigh = npv(high, cashFlows, baseDate);
    const isIncreasing = valueHigh > valueLow;

    for (let i = 0; i < 200; i++) {
        const mid = (low + high) / 2;
        const value = npv(mid, cashFlows, baseDate);

        if (Math.abs(value) < tolerance) return mid;

        if (value > 0) {
            if (isIncreasing) high = mid;
            else low = mid;
        } else {
            if (isIncreasing) low = mid;
            else high = mid;
        }
    }

    return null;
};

/**
 * Calculate XIRR using Newton-Raphson method
 * 
 * @param cashFlows Array of {date, amount} objects. Investments should be negative, current value positive.
 * @param guess Initial guess for the rate (default 0.1 = 10%)
 * @param tolerance Convergence tolerance (default 1e-7)
 * @param maxIterations Maximum iterations (default 100)
 * @returns Annualized return as a decimal (0.15 = 15%), or null if no convergence
 */
export const calculateXIRR = (
    cashFlows: CashFlow[],
    guess: number = 0.1,
    tolerance: number = 1e-7,
    maxIterations: number = 100
): number | null => {
    if (cashFlows.length < 2) return null;

    // Need both positive and negative cash flows
    const hasPositive = cashFlows.some(cf => cf.amount > 0);
    const hasNegative = cashFlows.some(cf => cf.amount < 0);
    if (!hasPositive || !hasNegative) return null;

    const firstCf = cashFlows[0];
    if (!firstCf) return null;
    const baseDate = firstCf.date;
    let rate = guess;

    for (let i = 0; i < maxIterations; i++) {
        const value = npv(rate, cashFlows, baseDate);
        const derivative = npvDerivative(rate, cashFlows, baseDate);

        if (Math.abs(derivative) < 1e-10) {
            // Try a different starting point
            rate = rate + 0.1;
            continue;
        }

        const newRate = rate - value / derivative;

        if (Math.abs(newRate - rate) < tolerance) {
            // Guard against unrealistic results
            if (newRate < -0.99 || newRate > 100) return null;
            return newRate;
        }

        rate = newRate;

        // Guard against divergence
        if (rate < -0.99) rate = -0.9;
        if (rate > 100) rate = 10;
    }

    // If Newton-Raphson didn't converge, try bisection method
    return bisectionXIRR(cashFlows, baseDate);
};

/**
 * Extract original purchase date from investment ID if possible
 */
const getPurchaseDate = (inv: XirrInvestmentLike): Date => {
    const explicitDate = inv.acquiredAt || inv.effectiveAt || inv.createdAt;
    if (explicitDate) {
        const parsed = new Date(explicitDate);
        if (!isNaN(parsed.getTime())) {
            return parsed;
        }
    }

    try {
        if (inv.id && inv.id.startsWith('inv_')) {
            const parts = inv.id.split('_');
            if (parts.length >= 2) {
                const partVal = parts[1];
                if (partVal !== undefined) {
                    const timestamp = parseInt(partVal, 10);
                    // Validate it's a realistic timestamp (after ~2020)
                    if (!isNaN(timestamp) && timestamp > 1600000000000) {
                        return new Date(timestamp);
                    }
                }
            }
        }
    } catch {
        // Fallback
    }
    return new Date(inv.lastUpdated);
};

/**
 * Build cash flows from investment history for Total-Return XIRR calculation
 * 
 * Takes active investments, current portfolio valuation, and optional historical 
 * dividends and realized trades to compute true institutional-grade XIRR.
 */
export const buildPortfolioCashFlows = (
    investments: XirrInvestmentLike[],
    totalCurrentValue: number,
    options?: {
        dividends?: Array<{ date: string | Date; amount: number }>;
        realizedTrades?: Array<{ entryDate?: string | Date; exitDate?: string | Date; entryAmount?: number; exitAmount?: number; pnl?: number }>;
    }
): CashFlow[] => {
    const flows: CashFlow[] = [];

    // 1. Active holdings: Each investment is an outflow (negative) on its purchase date
    for (const inv of investments) {
        const date = getPurchaseDate(inv);
        if (!isNaN(date.getTime()) && inv.investedAmount > 0) {
            flows.push({ date, amount: -inv.investedAmount });
        }
    }

    // 2. Historical Dividends: Each dividend received is a positive cash inflow on its credit date
    if (options?.dividends && Array.isArray(options.dividends)) {
        for (const div of options.dividends) {
            const divDate = new Date(div.date);
            if (!isNaN(divDate.getTime()) && div.amount > 0) {
                flows.push({ date: divDate, amount: div.amount });
            }
        }
    }

    // 3. Realized Roundtrips: Entry capital outflow and exit capital inflow
    if (options?.realizedTrades && Array.isArray(options.realizedTrades)) {
        for (const trade of options.realizedTrades) {
            if (trade.entryDate && trade.entryAmount && trade.entryAmount > 0) {
                const eDate = new Date(trade.entryDate);
                if (!isNaN(eDate.getTime())) {
                    flows.push({ date: eDate, amount: -trade.entryAmount });
                }
            }
            if (trade.exitDate && trade.exitAmount && trade.exitAmount > 0) {
                const xDate = new Date(trade.exitDate);
                if (!isNaN(xDate.getTime())) {
                    flows.push({ date: xDate, amount: trade.exitAmount });
                }
            }
        }
    }

    // 4. Current portfolio value is an inflow (positive) today
    if (totalCurrentValue > 0) {
        flows.push({ date: new Date(), amount: totalCurrentValue });
    }

    // Sort chronologically
    flows.sort((a, b) => a.date.getTime() - b.date.getTime());

    return flows;
};

/**
 * Calculate rolling XIRR for different time periods
 */
export const calculateRollingXIRR = (
    investments: XirrInvestmentLike[],
    _totalCurrentValue: number
): Record<string, number | null> => {
    const now = new Date();
    const periods: Record<string, number> = {
        '1M': 30,
        '3M': 90,
        '6M': 180,
        '1Y': 365,
        '3Y': 1095,
        '5Y': 1825,
        'ALL': Infinity,
    };

    const result: Record<string, number | null> = {};

    for (const [label, days] of Object.entries(periods)) {
        const cutoffDate = days === Infinity
            ? new Date(0)
            : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

        const filteredInvestments = investments.filter(inv => {
            const d = getPurchaseDate(inv);
            return d >= cutoffDate;
        });

        if (filteredInvestments.length === 0) {
            result[label] = null;
            continue;
        }

        const periodCurrent = filteredInvestments.reduce((s, i) => s + i.currentValue, 0);

        const flows = buildPortfolioCashFlows(filteredInvestments, periodCurrent);
        result[label] = calculateXIRR(flows);
    }

    return result;
};
