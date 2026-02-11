/**
 * Calculates probabilities related to consecutive sequences (Streaks/Runs).
 */

/**
 * Probability of an event not happening for N consecutive times within a sequence of M trials.
 * Formula simplified for approximation of losing streaks:
 * For instance, probability of hitting a losing streak of length L in N trades given win rate P.
 * 
 * Using De Moivre's approximation or recursive bounds.
 * Simplified approach for UI estimates: The Expected number of streaks of length L
 * E(streaks) = (N - L + 1) * p^L
 * Probability of at least one streak is roughly: 1 - exp(-E(streaks)) (Poisson approximation)
 * 
 * @param totalTrades Total number of consecutive trades taken (e.g. 100)
 * @param streakLength The length of the streak to calculate risk for (e.g. 5 losses in a row)
 * @param eventProbability The probability of the singular event (e.g. Loss Rate = 0.6 if Win rate 0.4)
 */
export const probabilityOfStreakApprox = (
    totalTrades: number,
    streakLength: number,
    eventProbability: number
): number => {
    if (streakLength > totalTrades) return 0;
    if (eventProbability <= 0) return 0;
    if (eventProbability >= 1) return 1;

    // Expected number of streaks
    const expectedStreaks = (totalTrades - streakLength + 1) * Math.pow(eventProbability, streakLength);
    
    // Poisson Approximation for probability of AT LEAST ONE streak
    const probability = 1 - Math.exp(-expectedStreaks);
    
    return probability;
};
