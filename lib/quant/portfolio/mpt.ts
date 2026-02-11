import { mean, variance, stdDev, covariance, downsideDeviation } from '../stats/descriptive';

export interface AssetReturns {
    symbol: string;
    returns: number[]; // Array of historical returns (e.g., daily or monthly)
    weight: number;    // Weight in the portfolio (0 to 1)
}

/**
 * Calculates the expected return of a portfolio given the weights and average historic returns of assets.
 */
export const portfolioReturn = (assets: AssetReturns[]): number => {
    return assets.reduce((total, asset) => {
        const avgReturn = mean(asset.returns);
        return total + (asset.weight * avgReturn);
    }, 0);
};

/**
 * Calculates the total variance of a portfolio.
 * Formula: w^T * Cov * w 
 * (Weight transpose * Covariance Matrix * Weight Vector)
 */
export const portfolioVariance = (assets: AssetReturns[]): number => {
    let varianceSum = 0;
    
    for (let i = 0; i < assets.length; i++) {
        for (let j = 0; j < assets.length; j++) {
            const weightId = assets[i].weight;
            const weightJd = assets[j].weight;
            const covInter = covariance(assets[i].returns, assets[j].returns, true); // true for sample covariance
            
            varianceSum += weightId * weightJd * covInter;
        }
    }
    return varianceSum;
};

/**
 * Calculates the Standard Deviation (Volatility/Risk) of a portfolio.
 */
export const portfolioStdDev = (assets: AssetReturns[]): number => {
    return Math.sqrt(portfolioVariance(assets));
};

/**
 * Calculates the Sharpe Ratio of a portfolio.
 * Formula: (Rp - Rf) / σp
 */
export const sharpeRatio = (portReturn: number, riskFreeRate: number, portStdDev: number): number => {
    if (portStdDev === 0) return 0;
    return (portReturn - riskFreeRate) / portStdDev;
};

/**
 * Calculates the Sortino Ratio of a portoflio (uses downside deviation instead of standard deviation).
 * Formula: (Rp - Rf) / σd
 */
export const sortinoRatio = (assets: AssetReturns[], riskFreeRate: number, targetReturn: number = 0): number => {
    // Generate simulated portfolio returns timeline
    // Assumes all asset returns arrays have the same length and align in time
    const numPeriods = assets[0]?.returns.length || 0;
    if (numPeriods === 0) return 0;
    
    const portReturns: number[] = new Array(numPeriods).fill(0);
    
    for (let t = 0; t < numPeriods; t++) {
        for (const asset of assets) {
            portReturns[t] += asset.weight * (asset.returns[t] || 0);
        }
    }
    
    const avgPortReturn = mean(portReturns);
    const downDev = downsideDeviation(portReturns, targetReturn, true);
    
    if (downDev === 0) return 0;
    return (avgPortReturn - riskFreeRate) / downDev;
};

/**
 * Calculates Asset Beta relative to a benchmark (market).
 * Formula: Covariance(Asset, Market) / Variance(Market)
 */
export const calculateBeta = (assetReturns: number[], marketReturns: number[]): number => {
    const varMarket = variance(marketReturns, true);
    if (varMarket === 0) return 1; // Default to 1 if market has no variance
    
    const cov = covariance(assetReturns, marketReturns, true);
    return cov / varMarket;
};

/**
 * Calculates Jensen's Alpha.
 * Formula: Rp - [Rf + Beta * (Rm - Rf)]
 * Rp: Portfolio Return, Rf: Risk-Free Rate, Rm: Market Return
 */
export const calculateAlpha = (portReturn: number, marketReturn: number, riskFreeRate: number, beta: number): number => {
    const expectedReturn = riskFreeRate + beta * (marketReturn - riskFreeRate);
    return portReturn - expectedReturn;
};

/**
 * Calculates Portfolio Variance using weights, individual standard deviations, and a correlation matrix.
 * This is much easier for UI calculators than inputting raw historical returns.
 */
export const portfolioVarianceFromMatrix = (
    weights: number[], 
    stdDevs: number[], 
    correlationMatrix: number[][]
): number => {
    let varianceSum = 0;
    
    for (let i = 0; i < weights.length; i++) {
        for (let j = 0; j < weights.length; j++) {
            varianceSum += weights[i] * weights[j] * stdDevs[i] * stdDevs[j] * correlationMatrix[i][j];
        }
    }
    
    return varianceSum;
};

/**
 * Calculates Portfolio Standard Deviation using correlation matrix.
 */
export const portfolioStdDevFromMatrix = (
    weights: number[], 
    stdDevs: number[], 
    correlationMatrix: number[][]
): number => {
    return Math.sqrt(portfolioVarianceFromMatrix(weights, stdDevs, correlationMatrix));
};

