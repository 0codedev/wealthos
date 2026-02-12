/**
 * Value at Risk (VaR) Engine
 */

/**
 * Parametric VaR (Normal Distribution Method)
 * Estimates the maximum expected loss over a specific horizon at a given confidence level,
 * assuming returns are normally distributed.
 * 
 * @param portfolioValue Current value of the portfolio
 * @param meanReturn Expected average return (decimal, e.g. 0.05 for 5%)
 * @param stdDev Standard deviation (volatility) of returns (decimal)
 * @param confidenceLevel Confidence level (e.g., 0.95 for 95%, 0.99 for 99%)
 */
export const parametricVaR = (
    portfolioValue: number, 
    meanReturn: number, 
    stdDev: number, 
    confidenceLevel: number
): { varLevel: number, varAmount: number, zScore: number } => {
    // Standard Normal Z-Scores for common confidence levels
    // In a real app, you could use an inverse error function (norminv), 
    // but these constants are standard for VaR.
    let zScore = 1.645; // 95% default
    
    if (confidenceLevel === 0.90) zScore = 1.282;
    else if (confidenceLevel === 0.95) zScore = 1.645;
    else if (confidenceLevel === 0.99) zScore = 2.326;
    else if (confidenceLevel === 0.999) zScore = 3.090;

    // VaR = Portfolio Value * (Z * StdDev - MeanReturn)
    // Note: mean return is often assumed to be 0 for daily VaR, but included here for completeness
    const varLevel = (zScore * stdDev) - meanReturn;
    const varAmount = portfolioValue * varLevel;
    
    return { varLevel, varAmount, zScore };
};

/**
 * Historical Simulation VaR
 * Sorts actual historical returns to find the loss at the Nth percentile.
 */
export const historicalVaR = (
    portfolioValue: number, 
    historicalReturns: number[], 
    confidenceLevel: number
): { varLevel: number, varAmount: number } => {
    if (historicalReturns.length === 0) return { varLevel: 0, varAmount: 0 };
    
    // Sort ascending (worst returns first)
    const sortedReturns = [...historicalReturns].sort((a, b) => a - b);
    
    // 95% confidence means looking at the 5th percentile worst return
    const percentile = 1 - confidenceLevel;
    const index = Math.max(0, Math.floor(sortedReturns.length * percentile));
    
    // Convert to a positive VaR representation (loss amount)
    const varLevel = Math.abs(sortedReturns[index]);
    const varAmount = portfolioValue * varLevel;

    return { varLevel, varAmount };
};
