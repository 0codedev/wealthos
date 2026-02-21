/**
 * Financial Calculators - Comprehensive utility functions
 * Covers: Sharpe ratio, dividend yield, SIP vs Lumpsum, safe withdrawal rate,
 * rolling returns, drawdown analysis, portfolio overlap, FIRE calculations
 */

import { Investment } from '../types';

// ==================== RETURN CALCULATIONS ====================

/**
 * Calculate Compound Annual Growth Rate (CAGR)
 */
export function calculateCAGR(
    beginningValue: number,
    endingValue: number,
    years: number
): number {
    if (beginningValue <= 0 || years <= 0) return 0;
    return (Math.pow(endingValue / beginningValue, 1 / years) - 1) * 100;
}

/**
 * Calculate Sharpe Ratio
 * (Portfolio Return - Risk-Free Rate) / Portfolio Std Dev
 */
export function calculateSharpeRatio(
    portfolioReturn: number, // Annual return %
    riskFreeRate: number = 6, // Default 6% (India FD rate)
    stdDeviation: number = 15 // Default 15% volatility
): number {
    if (stdDeviation === 0) return 0;
    return (portfolioReturn - riskFreeRate) / stdDeviation;
}

/**
 * Calculate rolling returns for given periods
 */
export function calculateRollingReturns(
    values: number[],
    periods: number[] = [1, 3, 5, 10] // years
): Record<string, number> {
    const result: Record<string, number> = {};
    const monthlyValues = values;

    periods.forEach(years => {
        const months = years * 12;
        if (monthlyValues.length >= months) {
            const startValue = monthlyValues[monthlyValues.length - months];
            const endValue = monthlyValues[monthlyValues.length - 1];
            if (startValue !== undefined && endValue !== undefined) {
                result[`${years}Y`] = calculateCAGR(startValue, endValue, years);
            }
        }
    });

    return result;
}

/**
 * Calculate maximum drawdown
 */
export function calculateMaxDrawdown(values: number[]): {
    maxDrawdown: number;
    peakIndex: number;
    troughIndex: number;
} {
    let maxDrawdown = 0;
    const firstVal = values[0];
    if (firstVal === undefined) return { maxDrawdown: 0, peakIndex: 0, troughIndex: 0 };
    let peak = firstVal;
    let peakIndex = 0;
    let troughIndex = 0;
    let currentPeakIndex = 0;

    values.forEach((value, index) => {
        if (value > peak) {
            peak = value;
            currentPeakIndex = index;
        }

        const drawdown = ((peak - value) / peak) * 100;
        if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
            peakIndex = currentPeakIndex;
            troughIndex = index;
        }
    });

    return { maxDrawdown, peakIndex, troughIndex };
}

// ==================== DIVIDEND CALCULATIONS ====================

/**
 * Calculate dividend yield
 */
export function calculateDividendYield(
    annualDividend: number,
    currentPrice: number
): number {
    if (currentPrice <= 0) return 0;
    return (annualDividend / currentPrice) * 100;
}

/**
 * Calculate dividend growth rate
 */
export function calculateDividendGrowthRate(
    dividends: number[], // Historical dividends
    years: number
): number {
    if (dividends.length < 2 || years <= 0) return 0;
    const startDiv = dividends[0];
    const endDiv = dividends[dividends.length - 1];
    if (startDiv === undefined || endDiv === undefined) return 0;
    return calculateCAGR(startDiv, endDiv, years);
}

/**
 * Estimate future passive income from dividends
 */
export function estimateFuturePassiveIncome(
    investments: Investment[],
    yearsAhead: number = 10,
    dividendGrowthRate: number = 8 // 8% annual growth
): number[] {
    const currentDividends = investments.reduce((sum, inv) => {
        // Estimate 2% yield if no dividend data
        const estimatedYield = 0.02;
        return sum + inv.currentValue * estimatedYield;
    }, 0);

    const projections: number[] = [];
    for (let year = 1; year <= yearsAhead; year++) {
        projections.push(currentDividends * Math.pow(1 + dividendGrowthRate / 100, year));
    }
    return projections;
}

// ==================== SIP VS LUMPSUM ====================

/**
 * Compare SIP vs Lumpsum returns
 */
export function compareSIPvsLumpsum(
    totalAmount: number,
    monthlyReturn: number, // Monthly return %
    months: number
): {
    sipFinalValue: number;
    lumpsumFinalValue: number;
    sipReturns: number;
    lumpsumReturns: number;
    winner: 'SIP' | 'Lumpsum';
} {
    const monthlyRate = monthlyReturn / 100;
    const sipAmount = totalAmount / months;

    // SIP: Sum of (P * (1 + r)^(n-i)) for each month
    let sipFinalValue = 0;
    for (let i = 0; i < months; i++) {
        sipFinalValue += sipAmount * Math.pow(1 + monthlyRate, months - i);
    }

    // Lumpsum: P * (1 + r)^n
    const lumpsumFinalValue = totalAmount * Math.pow(1 + monthlyRate, months);

    return {
        sipFinalValue,
        lumpsumFinalValue,
        sipReturns: ((sipFinalValue - totalAmount) / totalAmount) * 100,
        lumpsumReturns: ((lumpsumFinalValue - totalAmount) / totalAmount) * 100,
        winner: lumpsumFinalValue > sipFinalValue ? 'Lumpsum' : 'SIP'
    };
}

// ==================== FIRE CALCULATIONS ====================

/**
 * Calculate Safe Withdrawal Rate based on portfolio
 */
export function calculateSafeWithdrawalRate(
    portfolioValue: number,
    annualExpenses: number,
    expectedReturns: number = 8,
    inflationRate: number = 6
): {
    traditionalSWR: number; // 4% rule
    personalizedSWR: number;
    yearsToDeplete: number;
    safeAnnualWithdrawal: number;
} {
    const traditionalSWR = 4;
    const realReturn = expectedReturns - inflationRate;

    // Personalized SWR based on real returns
    const personalizedSWR = Math.max(2.5, Math.min(5, realReturn));

    // Years to deplete at current withdrawal rate
    const currentWithdrawalRate = (annualExpenses / portfolioValue) * 100;
    let yearsToDepleteCalc = Infinity;

    if (currentWithdrawalRate > realReturn) {
        const annualDeficit = annualExpenses - portfolioValue * (realReturn / 100);
        if (annualDeficit > 0) {
            yearsToDepleteCalc = portfolioValue / annualDeficit;
        }
    }

    const yearsToDeplete = yearsToDepleteCalc === Infinity
        ? Infinity
        : Math.max(0, Math.min(200, Math.round(yearsToDepleteCalc)));

    return {
        traditionalSWR,
        personalizedSWR,
        yearsToDeplete,
        safeAnnualWithdrawal: portfolioValue * personalizedSWR / 100
    };
}

/**
 * Calculate Coast FIRE number
 * Amount needed today to coast to retirement without additional savings
 */
export function calculateCoastFIRE(
    targetRetirementCorpus: number,
    yearsToRetirement: number,
    expectedReturns: number = 10
): number {
    const rate = expectedReturns / 100;
    return targetRetirementCorpus / Math.pow(1 + rate, yearsToRetirement);
}

/**
 * Calculate Barista FIRE (partial retirement with part-time income)
 */
export function calculateBaristaFIRE(
    annualExpenses: number,
    partTimeIncome: number, // Expected part-time annual income
    _expectedReturns: number = 7
): {
    corpusNeeded: number;
    coverageFromWork: number;
    coverageFromPortfolio: number;
} {
    const expenseGap = annualExpenses - partTimeIncome;
    const corpusNeeded = expenseGap > 0 ? expenseGap * 25 : 0; // 4% rule

    return {
        corpusNeeded,
        coverageFromWork: (partTimeIncome / annualExpenses) * 100,
        coverageFromPortfolio: ((annualExpenses - partTimeIncome) / annualExpenses) * 100
    };
}

/**
 * Calculate Lean FIRE vs Fat FIRE numbers
 */
export function calculateFIREVariants(
    currentExpenses: number,
    inflationRate: number = 6,
    yearsToRetirement: number = 20
): {
    leanFIRE: number; // Basic expenses only (50% of current)
    regularFIRE: number; // Current lifestyle
    fatFIRE: number; // Comfortable (150% of current)
} {
    const futureExpenseMultiplier = Math.pow(1 + inflationRate / 100, yearsToRetirement);
    const futureExpenses = currentExpenses * 12 * futureExpenseMultiplier;

    return {
        leanFIRE: (futureExpenses * 0.5) * 25,
        regularFIRE: futureExpenses * 25,
        fatFIRE: (futureExpenses * 1.5) * 25
    };
}

// ==================== PORTFOLIO ANALYSIS ====================

/**
 * Detect portfolio overlap between mutual funds
 */
export function detectPortfolioOverlap(
    holdings1: string[], // Stock names in fund 1
    holdings2: string[]  // Stock names in fund 2
): {
    overlapPercentage: number;
    commonHoldings: string[];
    uniqueToFirst: string[];
    uniqueToSecond: string[];
} {
    const set1 = new Set(holdings1.map(h => h.toLowerCase()));
    const set2 = new Set(holdings2.map(h => h.toLowerCase()));

    const common = holdings1.filter(h => set2.has(h.toLowerCase()));
    const totalUnique = new Set([...holdings1, ...holdings2]).size;

    return {
        overlapPercentage: (common.length / totalUnique) * 100,
        commonHoldings: common,
        uniqueToFirst: holdings1.filter(h => !set2.has(h.toLowerCase())),
        uniqueToSecond: holdings2.filter(h => !set1.has(h.toLowerCase()))
    };
}

/**
 * Calculate holdings health score
 */
export function calculateHoldingsHealthScore(investment: Investment): {
    score: number; // 0-100
    factors: Record<string, number>;
    recommendation: string;
} {
    const gain = investment.currentValue - investment.investedAmount;
    const gainPercent = (gain / investment.investedAmount) * 100;

    const factors: Record<string, number> = {
        returns: Math.min(100, Math.max(0, 50 + gainPercent * 2)), // -25% to +25% maps to 0-100
        diversification: investment.type === 'Mutual Fund' ? 80 : 50, // MF more diversified
        liquidity: ['Stocks', 'Mutual Fund', 'Gold'].includes(investment.type) ? 90 : 50,
        // Infer risk from asset type since Investment doesn't have a riskLevel property
        riskAdjusted: ['Fixed Deposit', 'Digital Gold'].includes(investment.type) ? 80 :
            ['Mutual Fund', 'ETF'].includes(investment.type) ? 60 : 40,
    };

    const score = Object.values(factors).reduce((a, b) => a + b, 0) / Object.keys(factors).length;

    let recommendation = 'Hold';
    if (score < 40) recommendation = 'Review - Consider exiting';
    else if (score < 60) recommendation = 'Monitor closely';
    else if (score > 80) recommendation = 'Strong position - Consider adding';

    return { score: Math.round(score), factors, recommendation };
}

/**
 * Compare assets side by side
 */
export function compareAssets(assets: Investment[]): {
    comparison: Array<{
        name: string;
        invested: number;
        current: number;
        returns: number;
        returnsPercent: number;
        healthScore: number;
        rank: number;
    }>;
    bestPerformer: string;
    worstPerformer: string;
} {
    const comparison = assets.map(asset => {
        const returns = asset.currentValue - asset.investedAmount;
        const { score } = calculateHoldingsHealthScore(asset);
        return {
            name: asset.name,
            invested: asset.investedAmount,
            current: asset.currentValue,
            returns,
            returnsPercent: asset.investedAmount > 0 ? (returns / asset.investedAmount) * 100 : 0,
            healthScore: score,
            rank: 0
        };
    });

    // Rank by returns
    comparison.sort((a, b) => b.returnsPercent - a.returnsPercent);
    comparison.forEach((item, index) => item.rank = index + 1);

    return {
        comparison,
        bestPerformer: comparison[0]?.name || '',
        worstPerformer: comparison[comparison.length - 1]?.name || ''
    };
}

// ==================== REBALANCING ====================

/**
 * Calculate rebalancing recommendations
 */
export function calculateRebalance(
    investments: Investment[],
    targetAllocation: Record<string, number> // { 'Stocks': 60, 'Mutual Fund': 30, 'Gold': 10 }
): Array<{
    type: string;
    currentPercent: number;
    targetPercent: number;
    difference: number;
    action: 'BUY' | 'SELL' | 'HOLD';
    amount: number;
}> {
    const totalValue = investments.reduce((sum, inv) => sum + inv.currentValue, 0);

    // Group by type
    const byType: Record<string, number> = {};
    investments.forEach(inv => {
        byType[inv.type] = (byType[inv.type] || 0) + inv.currentValue;
    });

    // Merge keys from both targetAllocation and actual holdings
    const allTypes = Array.from(new Set([...Object.keys(targetAllocation), ...Object.keys(byType)]));

    // Calculate rebalance actions
    return allTypes.map(type => {
        const currentValue = byType[type] || 0;
        const currentPercent = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
        const targetPercent = targetAllocation[type] || 0;
        const difference = targetPercent - currentPercent;
        const amount = Math.abs(difference / 100 * totalValue);

        return {
            type,
            currentPercent: Math.round(currentPercent * 10) / 10,
            targetPercent,
            difference: Math.round(difference * 10) / 10,
            action: difference > 2 ? 'BUY' : difference < -2 ? 'SELL' : 'HOLD',
            amount: Math.round(amount)
        };
    });
}

export default {
    calculateCAGR,
    calculateSharpeRatio,
    calculateRollingReturns,
    calculateMaxDrawdown,
    calculateDividendYield,
    calculateDividendGrowthRate,
    estimateFuturePassiveIncome,
    compareSIPvsLumpsum,
    calculateSafeWithdrawalRate,
    calculateCoastFIRE,
    calculateBaristaFIRE,
    calculateFIREVariants,
    detectPortfolioOverlap,
    calculateHoldingsHealthScore,
    compareAssets,
    calculateRebalance
};
