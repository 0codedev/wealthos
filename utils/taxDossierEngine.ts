/**
 * WealthOS Indian Capital Gains Tax Dossier Engine (ITR-2 / ITR-3 Schedule CG)
 * Compliant with Indian Budget 2024 amendments:
 * - STCG (Section 111A): 20% flat tax
 * - LTCG (Section 112A): 12.5% on aggregate gains exceeding ₹1,25,000 exemption
 * - Grandfathering Clause: Pre-31 Jan 2018 FMV adjustment
 * - Intraday: Speculative Business Income (Slab rate)
 * - Derivatives (F&O): Non-Speculative Business Income (Slab rate)
 */

export interface TaxTradeEntry {
    id: string;
    symbol: string;
    assetType: 'EQUITY' | 'MUTUAL_FUND' | 'FNO' | 'INTRADAY' | 'DEBT_GOLD';
    buyDate: string;
    sellDate: string;
    buyPrice: number;
    sellPrice: number;
    quantity: number;
    fairMarketValueJan2018?: number; // For Section 112A grandfathering
}

export interface TaxComputationResult {
    financialYear: string;
    stcgGains: number;
    stcgTaxPayable: number;
    ltcgGrossGains: number;
    ltcgExemptionApplied: number;
    ltcgNetTaxable: number;
    ltcgTaxPayable: number;
    fnoBusinessTurnover: number;
    fnoNetProfitLoss: number;
    intradaySpeculativePnL: number;
    totalDirectTaxLiability: number;
    entries: {
        symbol: string;
        type: string;
        holdingPeriodDays: number;
        gainOrLoss: number;
        taxCategory: 'STCG_20' | 'LTCG_12_5' | 'FNO_BIZ' | 'INTRADAY_SPEC';
    }[];
}

export const LTCG_EXEMPTION_LIMIT = 125000; // ₹1.25 Lakhs per FY (Budget 2024)
export const STCG_RATE = 0.20; // 20%
export const LTCG_RATE = 0.125; // 12.5%

export function computeIndianTaxDossier(trades: TaxTradeEntry[], financialYear = '2025-2026'): TaxComputationResult {
    let stcgGains = 0;
    let ltcgGrossGains = 0;
    let fnoTurnover = 0;
    let fnoNetPnL = 0;
    let intradayPnL = 0;

    const processedEntries: TaxComputationResult['entries'] = [];

    trades.forEach(trade => {
        const buy = new Date(trade.buyDate);
        const sell = new Date(trade.sellDate);
        const holdingDays = Math.max(0, Math.floor((sell.getTime() - buy.getTime()) / (1000 * 60 * 60 * 24)));
        const isLongTerm = holdingDays >= 365;

        const totalCost = trade.buyPrice * trade.quantity;
        const totalSale = trade.sellPrice * trade.quantity;
        let gain = totalSale - totalCost;

        if (trade.assetType === 'INTRADAY') {
            intradayPnL += gain;
            processedEntries.push({
                symbol: trade.symbol,
                type: 'Intraday Equity',
                holdingPeriodDays: holdingDays,
                gainOrLoss: gain,
                taxCategory: 'INTRADAY_SPEC'
            });
        } else if (trade.assetType === 'FNO') {
            fnoTurnover += Math.abs(gain);
            fnoNetPnL += gain;
            processedEntries.push({
                symbol: trade.symbol,
                type: 'F&O Derivatives',
                holdingPeriodDays: holdingDays,
                gainOrLoss: gain,
                taxCategory: 'FNO_BIZ'
            });
        } else if (isLongTerm) {
            // Check Section 112A Grandfathering
            if (trade.fairMarketValueJan2018 && new Date(trade.buyDate) < new Date('2018-01-31')) {
                const lowerOfFmvOrSale = Math.min(trade.fairMarketValueJan2018 * trade.quantity, totalSale);
                const adjustedCost = Math.max(totalCost, lowerOfFmvOrSale);
                gain = totalSale - adjustedCost;
            }

            ltcgGrossGains += gain;
            processedEntries.push({
                symbol: trade.symbol,
                type: 'Long-Term Capital Gain',
                holdingPeriodDays: holdingDays,
                gainOrLoss: gain,
                taxCategory: 'LTCG_12_5'
            });
        } else {
            stcgGains += gain;
            processedEntries.push({
                symbol: trade.symbol,
                type: 'Short-Term Capital Gain',
                holdingPeriodDays: holdingDays,
                gainOrLoss: gain,
                taxCategory: 'STCG_20'
            });
        }
    });

    // Compute Net LTCG with ₹1.25L Exemption
    const positiveLtcg = Math.max(0, ltcgGrossGains);
    const ltcgExemptionApplied = Math.min(positiveLtcg, LTCG_EXEMPTION_LIMIT);
    const ltcgNetTaxable = Math.max(0, positiveLtcg - ltcgExemptionApplied);
    const ltcgTaxPayable = ltcgNetTaxable * LTCG_RATE;

    // Compute STCG Tax @ 20%
    const positiveStcg = Math.max(0, stcgGains);
    const stcgTaxPayable = positiveStcg * STCG_RATE;

    const totalDirectTax = stcgTaxPayable + ltcgTaxPayable;

    return {
        financialYear,
        stcgGains,
        stcgTaxPayable,
        ltcgGrossGains,
        ltcgExemptionApplied,
        ltcgNetTaxable,
        ltcgTaxPayable,
        fnoBusinessTurnover: fnoTurnover,
        fnoNetProfitLoss: fnoNetPnL,
        intradaySpeculativePnL: intradayPnL,
        totalDirectTaxLiability: totalDirectTax,
        entries: processedEntries
    };
}
