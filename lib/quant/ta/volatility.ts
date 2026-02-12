/**
 * Advanced Volatility Estimators
 */

/**
 * Parkinson Historical Volatility Estimator
 * Uses the high and low prices to capture intra-period variance, 
 * more efficient than close-to-close if trading is continuous.
 * 
 * @param highs Array of high prices
 * @param lows Array of low prices
 * @param tradingPeriods Annualization factor (e.g. 252 for daily)
 */
export const parkinsonVolatility = (highs: number[], lows: number[], tradingPeriods: number = 252): number => {
    if (highs.length !== lows.length || highs.length < 2) return 0;
    
    let sumLogSq = 0;
    for (let i = 0; i < highs.length; i++) {
        if (highs[i] <= 0 || lows[i] <= 0) continue;
        const hlLog = Math.log(highs[i] / lows[i]);
        sumLogSq += Math.pow(hlLog, 2);
    }
    
    const variance = sumLogSq / (4 * highs.length * Math.log(2));
    return Math.sqrt(variance) * Math.sqrt(tradingPeriods);
};

/**
 * Garman-Klass Historical Volatility Estimator
 * Uses Open, High, Low, Close (OHLC) to incorporate both intraday volatility 
 * and overnight jumps. Very robust for options pricing underlying assumption.
 */
export const garmanKlassVolatility = (opens: number[], highs: number[], lows: number[], closes: number[], tradingPeriods: number = 252): number => {
    if (opens.length !== highs.length || highs.length !== lows.length || lows.length !== closes.length || opens.length < 2) return 0;

    let sum = 0;
    for (let i = 0; i < opens.length; i++) {
        if (opens[i] <= 0 || highs[i] <= 0 || lows[i] <= 0 || closes[i] <= 0) continue;
        
        const logHL = Math.log(highs[i] / lows[i]);
        const logCO = Math.log(closes[i] / opens[i]);
        
        const term = 0.5 * Math.pow(logHL, 2) - (2 * Math.log(2) - 1) * Math.pow(logCO, 2);
        sum += term;
    }

    const variance = sum / opens.length;
    return Math.sqrt(variance) * Math.sqrt(tradingPeriods);
};
