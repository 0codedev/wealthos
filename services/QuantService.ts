
// Types for Quant Analysis
export interface OverlapResult {
    fundA: string;
    fundB: string;
    overlapPercentage: number;
    commonHoldings: { ticker: string; weight: number }[];
}

export interface TaxHarvestOpportunity {
    ticker: string;
    currentValue: number;
    unrealizedLoss: number;
    lossPercentage: number;
    purchaseDate: string;
    term: 'SHORT' | 'LONG';
    suggestion: string;
}

export interface RiskMetrics {
    sharpeRatio: number;
    sortinoRatio: number;
    beta: number;
    alpha: number;
    maxDrawdown: number;
    volatility: number;
}

// Mock Holdings for Overlap Simulation
// In a real app, this would come from an API (Morningstar/Valueresearch)
const FUND_HOLDINGS: Record<string, string[]> = {
    'Parag Parikh Flexi Cap': ['HDFCBANK', 'ITC', 'BAJFINANCE', 'ICICIBANK', 'GOOGL', 'META', 'MSFT', 'AMZN'],
    'HDFC Top 100': ['HDFCBANK', 'RELIANCE', 'ICICIBANK', 'INFY', 'L&T', 'ITC', 'TCS', 'AXISBANK'],
    'SBI Small Cap': ['BLUESTAR', 'CHALET', 'ELGIEQUIP', 'VSTTILLERS', 'FINPIPE'],
    'Axis Bluechip': ['HDFCBANK', 'ICICIBANK', 'BAJFINANCE', 'INFY', 'TCS', 'KOTAKBANK'],
    'Quant Small Cap': ['RELIANCE', 'HDFCBANK', 'JIOFIN', 'IRB', 'BIKAJI'], // Quant is weird, owns large caps too sometimes
    'Nifty 50 ETF': ['HDFCBANK', 'RELIANCE', 'ICICIBANK', 'INFY', 'L&T', 'ITC', 'TCS', 'AXISBANK', 'KOTAKBANK', 'BAJFINANCE']
};

/**
 * Calculates overlap between two internal fund names or simulating based on common stocks
 */
export const calculateOverlap = (fundAName: string, fundBName: string): OverlapResult => {
    // Normalize names to match mock keys approximately
    const findKey = (name: string) => Object.keys(FUND_HOLDINGS).find(k => name.toLowerCase().includes(k.toLowerCase().split(' ')[0]));

    const keyA = findKey(fundAName);
    const keyB = findKey(fundBName);

    if (!keyA || !keyB) {
        // Fallback: Statistical Simulation
        // If we don't have data, return 0 instead of fake random numbers
        return {
            fundA: fundAName,
            fundB: fundBName,
            overlapPercentage: 0,
            commonHoldings: []
        };
    }

    const holdingsA = FUND_HOLDINGS[keyA];
    const holdingsB = FUND_HOLDINGS[keyB];

    const common = holdingsA.filter(h => holdingsB.includes(h));
    const overlapPct = common.length / Math.max(holdingsA.length, holdingsB.length); // Jaccard-ish index

    return {
        fundA: fundAName,
        fundB: fundBName,
        overlapPercentage: overlapPct,
        commonHoldings: common.map(c => ({ ticker: c, weight: 0 })) // Weight 0 until live
    };
};

/**
 * Scans investments for Tax Loss Harvesting opportunities
 */
export const calculateTaxHarvesting = (investments: any[]): TaxHarvestOpportunity[] => {
    const opportunities: TaxHarvestOpportunity[] = [];
    return opportunities; // Empty until live data provides exact lot tracking
};

/**
 * Calculates Risk Metrics (Sharpe, Sortino, etc.)
 */
export const calculateRiskMetrics = (returnsHistory: number[]): RiskMetrics => {
    // Math logic goes here when history is piped
    // Returning 0 instead of fake "Good Portfolio" mocks to strictly enforce Live Truth
    return {
        sharpeRatio: 0,
        sortinoRatio: 0,
        beta: 0,
        alpha: 0,
        maxDrawdown: 0,
        volatility: 0
    };
};
