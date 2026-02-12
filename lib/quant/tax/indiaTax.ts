/**
 * Indian Taxation Engine (Post July 2024 Budget)
 * Handles Capital Gains, F&O Turnover limits, and basic harvesting principles.
 */

// Global Tax Slabs (Simplified New Regime 2024 for F&O business income)
export const calculateSlabTax = (netIncome: number): number => {
    if (netIncome <= 300000) return 0; // 0-3L Null
    
    let tax = 0;
    // 3L-7L @ 5%
    if (netIncome > 300000) {
        const taxable = Math.min(netIncome, 700000) - 300000;
        tax += taxable * 0.05;
    }
    // 7L-10L @ 10%
    if (netIncome > 700000) {
        const taxable = Math.min(netIncome, 1000000) - 700000;
        tax += taxable * 0.10;
    }
    // 10L-12L @ 15%
    if (netIncome > 1000000) {
        const taxable = Math.min(netIncome, 1200000) - 1000000;
        tax += taxable * 0.15;
    }
    // 12L-15L @ 20%
    if (netIncome > 1200000) {
        const taxable = Math.min(netIncome, 1500000) - 1200000;
        tax += taxable * 0.20;
    }
    // Above 15L @ 30%
    if (netIncome > 1500000) {
        const taxable = netIncome - 1500000;
        tax += taxable * 0.30;
    }

    // 87A rebate for < 7L income essentially wipes tax out under New Regime
    if (netIncome <= 700000) {
        tax = 0; // Marginal relief and rebate applied broadly for typical calculation
    }

    return tax;
};

/**
 * Short Term Capital Gains (Equity, < 12 months holding)
 * @param gains Realized STCG profit
 * @param losses Offset STCG or LTCG losses
 * @returns Net Tax at 20%
 */
export const calculateSTCG = (gains: number, stcgLosses: number = 0): { netGain: number, tax: number } => {
    const netGain = Math.max(0, gains - stcgLosses);
    return {
        netGain,
        tax: netGain * 0.20 // Flat 20% post budget 2024
    };
};

/**
 * Long Term Capital Gains (Equity, > 12 months holding)
 * Exemption: First ₹1.25 Lakh is tax free.
 * @param gains Realized LTCG profit
 * @param losses Offset LTCG losses ONLY (LTCG cannot offset STCG)
 * @returns Net Tax at 12.5%
 */
export const calculateLTCG = (gains: number, ltcgLosses: number = 0): { netGain: number, taxableGain: number, tax: number } => {
    const netGain = Math.max(0, gains - ltcgLosses);
    // Exemption limit 1,25,000
    const taxableGain = Math.max(0, netGain - 125000);
    return {
        netGain,
        taxableGain,
        tax: taxableGain * 0.125 // Flat 12.5% above exemption per year
    };
};

/**
 * F&O Turnover (Business Income)
 * Section 44AB threshold is 10 Crores for fully digital traders (like us on Dhan).
 * Turnover = Absolute Sum of (Profits + Losses) per trade + Option Premium on sale.
 * 
 * @param trades Array of { profitLoss: number }
 */
export const calculateFnOTurnover = (trades: { pnl: number, isOptionSale: boolean, optionPremium?: number }[]): { turnover: number, auditRequired: boolean } => {
    let totalTurnover = 0;

    for (const trade of trades) {
        // Essential: In F&O, a loss of 10k adds 10k to turnover!
        totalTurnover += Math.abs(trade.pnl);
        
        // Options sellers add premium received
        if (trade.isOptionSale && trade.optionPremium) {
            totalTurnover += trade.optionPremium;
        }
    }

    // Fully digital exemption threshold is ₹10,00,00,000 (10 CR)
    const auditRequired = totalTurnover > 100000000;

    return { turnover: totalTurnover, auditRequired };
};

export interface HarvestingOpportunity {
    ticker: string;
    qty: number;
    buyPrice: number;
    ltp: number; // Last Traded Price
    type: 'ST' | 'LT'; // Short term / Long term holding status
    unrealizedLoss: number;
    taxSaved: number;
}

/**
 * Tax Loss Harvesting Simulator
 * Discovers potential cash saved if closing losing positions before March 31.
 */
export const simulateHarvesting = (holdings: { ticker: string, qty: number, buyPrice: number, ltp: number, isShortTerm: boolean }[]): HarvestingOpportunity[] => {
    const opportunities: HarvestingOpportunity[] = [];

    for (const h of holdings) {
        if (h.ltp < h.buyPrice) {
            const lossPerShare = h.buyPrice - h.ltp;
            const totalLoss = lossPerShare * h.qty;
            
            // Tax Saved depends entirely on what bucket we assume the user has gains in.
            // If ST, booking this loss offsets STCG which is taxed at 20%
            // If LT, booking this loss offsets LTCG which is taxed at 12.5%
            const possibleTaxSaved = h.isShortTerm ? totalLoss * 0.20 : totalLoss * 0.125;

            opportunities.push({
                ticker: h.ticker,
                qty: h.qty,
                buyPrice: h.buyPrice,
                ltp: h.ltp,
                type: h.isShortTerm ? 'ST' : 'LT',
                unrealizedLoss: totalLoss,
                taxSaved: possibleTaxSaved
            });
        }
    }

    // Return sorted highest savings to lowest
    return opportunities.sort((a, b) => b.taxSaved - a.taxSaved);
};
