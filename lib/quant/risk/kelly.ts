/**
 * Kelly Criterion Optimizer
 */

export interface KellyResult {
    fullKelly: number;
    halfKelly: number;
    quarterKelly: number;
    isNegativeEV: boolean;
}

/**
 * Calculates the exact optimal fraction of bankroll to wager (Full Kelly)
 * Kelly = (bp - q) / b
 * where:
 * b = ratio of average win to average loss (e.g. 2:1 -> b=2)
 * p = probability of winning
 * q = probability of losing (1 - p)
 * 
 * @param winProbability Probability of winning trade (decimal, e.g. 0.55 for 55%)
 * @param winLossRatio Average Win / Average Loss ratio
 */
export const calculateKelly = (
    winProbability: number, 
    winLossRatio: number
): KellyResult => {
    // If win ratio is 0 or negative edge, return 0 edge
    if (winLossRatio <= 0 || winProbability <= 0) {
        return {
            fullKelly: 0,
            halfKelly: 0,
            quarterKelly: 0,
            isNegativeEV: true
        };
    }

    const p = winProbability;
    const q = 1 - p;
    const b = winLossRatio;
    
    // Theoretical Edge calculation to check if negative expectation
    const expectedValue = (p * b) - q;
    const isNegativeEV = expectedValue <= 0;

    if (isNegativeEV) {
        return {
            fullKelly: 0,
            halfKelly: 0,
            quarterKelly: 0,
            isNegativeEV: true
        };
    }

    // f* = (bp - q) / b = p - (q / b)
    let fullKelly = (b * p - q) / b;
    
    // Clamp to 1 (100% of bankroll)
    fullKelly = Math.min(1, Math.max(0, fullKelly));

    return {
        fullKelly: fullKelly * 100,         // Return as percentages
        halfKelly: (fullKelly / 2) * 100,
        quarterKelly: (fullKelly / 4) * 100,
        isNegativeEV: false
    };
};
