/**
 * Position Sizing Engine
 */

export interface PositionSizeResult {
    riskAmount: number;
    shares: number;
    effectiveRiskPercentage: number;
    riskRewardRatio: number;
    rewardAmount: number;
    targetDistance: number;
    stopDistance: number;
}

/**
 * Validates variables and calculates the exact position size ensuring account risk parameters are respected.
 * 
 * @param accountBalance Initial capital available
 * @param riskPercentage Maximum risk willing to take (e.g. 1 for 1% of account)
 * @param entryPrice Buy/Short entry level
 * @param stopLossPrice Pre-determined exit level for a loss
 * @param targetPrice Expected profit exit
 * @param tradeType Direction (Long or Short)
 */
export const fixedRiskSizer = (
    accountBalance: number,
    riskPercentage: number,
    entryPrice: number,
    stopLossPrice: number,
    targetPrice: number,
    tradeType: 'long' | 'short' = 'long'
): PositionSizeResult => {
    const defaultRes = {
        riskAmount: 0,
        shares: 0,
        effectiveRiskPercentage: 0,
        riskRewardRatio: 0,
        rewardAmount: 0,
        targetDistance: 0,
        stopDistance: 0,
    };

    if (entryPrice <= 0 || stopLossPrice <= 0 || accountBalance <= 0 || riskPercentage <= 0) {
        return defaultRes;
    }

    // Determine stop distance depending on direction
    let stopDistance = 0;
    let targetDistance = 0;
    
    if (tradeType === 'long') {
        stopDistance = entryPrice - stopLossPrice;
        targetDistance = targetPrice - entryPrice;
    } else {
        stopDistance = stopLossPrice - entryPrice; // For short, SL > Entry
        targetDistance = entryPrice - targetPrice; // For short, Target < Entry
    }

    if (stopDistance <= 0) {
        return defaultRes; // Invalid SL placement
    }

    const calculatedRiskAmount = accountBalance * (riskPercentage / 100);
    
    // Position Size = Capital at Risk / Risk per Share 
    let shares = calculatedRiskAmount / stopDistance;
    shares = Math.floor(shares); // Round down to buy full units (assuming equities/crypto without fractional)

    const actualRisk = shares * stopDistance;
    const actualRiskPct = (actualRisk / accountBalance) * 100;
    
    let riskRewardRatio = 0;
    let rewardAmount = 0;
    
    if (targetDistance > 0) {
        riskRewardRatio = targetDistance / stopDistance;
        rewardAmount = shares * targetDistance;
    }

    return {
        riskAmount: actualRisk,
        shares,
        effectiveRiskPercentage: actualRiskPct,
        riskRewardRatio,
        rewardAmount,
        targetDistance,
        stopDistance
    };
};
