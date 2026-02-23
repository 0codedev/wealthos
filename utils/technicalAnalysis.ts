/**
 * Technical Analysis Utilities
 * 
 * Lightweight TA calculations for Smart Watchlist entry zones.
 * All calculations work on simple price arrays (newest last).
 */

export interface TechnicalSignals {
    rsi14: number | null;
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    bollingerUpper: number | null;
    bollingerLower: number | null;
    bollingerMiddle: number | null;
    atr14: number | null;
    percentFromHigh: number;
    percentFromLow: number;
    signal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
    score: number; // -100 to +100
}

/**
 * Simple Moving Average
 */
export const calculateSMA = (prices: number[], period: number): number | null => {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    return slice.reduce((sum, p) => sum + p, 0) / period;
};

/**
 * Relative Strength Index (RSI) — Wilder's smoothing
 */
export const calculateRSI = (prices: number[], period: number = 14): number | null => {
    if (prices.length < period + 1) return null;

    let gains = 0;
    let losses = 0;

    // First, get initial SMA for the first 'period' bars
    for (let i = 1; i <= period; i++) {
        const pI = prices[i];
        const pPrev = prices[i - 1];
        if (pI === undefined || pPrev === undefined) continue;
        const change = pI - pPrev;
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Wilder's Smoothing for the rest of the prices
    for (let i = period + 1; i < prices.length; i++) {
        const pI = prices[i];
        const pPrev = prices[i - 1];
        if (pI === undefined || pPrev === undefined) continue;
        const change = pI - pPrev;
        const currentGain = change > 0 ? change : 0;
        const currentLoss = change < 0 ? Math.abs(change) : 0;

        avgGain = ((avgGain * (period - 1)) + currentGain) / period;
        avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;
    }

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
};

/**
 * Bollinger Bands (20-period SMA, 2 std deviations)
 */
export const calculateBollingerBands = (
    prices: number[],
    period: number = 20,
    stdDevMultiplier: number = 2
): { upper: number; middle: number; lower: number } | null => {
    if (prices.length < period) return null;

    const slice = prices.slice(-period);
    const middle = slice.reduce((sum, p) => sum + p, 0) / period;

    const variance = slice.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    return {
        upper: middle + stdDevMultiplier * stdDev,
        middle,
        lower: middle - stdDevMultiplier * stdDev,
    };
};

/**
 * Average True Range (ATR)
 */
export const calculateATR = (
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 14
): number | null => {
    if (highs.length < period + 1) return null;

    const trueRanges: number[] = [];
    for (let i = 1; i < highs.length; i++) {
        const hI = highs[i];
        const lI = lows[i];
        const cPrev = closes[i - 1];
        if (hI === undefined || lI === undefined || cPrev === undefined) continue;
        const tr = Math.max(
            hI - lI,
            Math.abs(hI - cPrev),
            Math.abs(lI - cPrev)
        );
        trueRanges.push(tr);
    }

    const recent = trueRanges.slice(-period);
    return recent.reduce((sum, tr) => sum + tr, 0) / period;
};

/**
 * Generate a composite technical signal from price data
 */
export const generateSignals = (prices: number[]): TechnicalSignals => {
    const current = prices[prices.length - 1] || 0;
    const recentPrices = prices.slice(-252);
    const high52w = recentPrices.length ? recentPrices.reduce((max, p) => Math.max(max, p), -Infinity) : 0;
    const low52w = recentPrices.length ? recentPrices.reduce((min, p) => Math.min(min, p), Infinity) : 0;

    const rsi14 = calculateRSI(prices, 14);
    const sma20 = calculateSMA(prices, 20);
    const sma50 = calculateSMA(prices, 50);
    const sma200 = calculateSMA(prices, 200);
    const bollinger = calculateBollingerBands(prices, 20, 2);

    const percentFromHigh = high52w > 0 ? ((current - high52w) / high52w) * 100 : 0;
    const percentFromLow = low52w > 0 ? ((current - low52w) / low52w) * 100 : 0;

    // Composite scoring (-100 to +100)
    let score = 0;
    let factors = 0;

    // RSI signal
    if (rsi14 !== null) {
        if (rsi14 < 30) score += 30;       // Oversold = bullish
        else if (rsi14 < 40) score += 15;
        else if (rsi14 > 70) score -= 30;  // Overbought = bearish
        else if (rsi14 > 60) score -= 15;
        factors++;
    }

    // Price vs SMA200 (trend)
    if (sma200 !== null) {
        const distFromSMA200 = ((current - sma200) / sma200) * 100;
        if (distFromSMA200 > 0 && distFromSMA200 < 5) score += 20; // Just above = bullish
        else if (distFromSMA200 < 0 && distFromSMA200 > -10) score += 25; // Near pullback
        else if (distFromSMA200 < -10) score += 10; // Deep discount
        else if (distFromSMA200 > 20) score -= 15; // Overextended
        factors++;
    }

    // Bollinger Band position
    if (bollinger) {
        const bandWidth = bollinger.upper - bollinger.lower;
        if (bandWidth > 0) {
            const position = (current - bollinger.lower) / bandWidth;
            if (position < 0.2) score += 20;       // Near lower band
            else if (position > 0.8) score -= 20;  // Near upper band
            factors++;
        }
    }

    // 52-week position
    if (percentFromHigh < -20) score += 15; // >20% from high = potential value
    if (percentFromHigh > -5) score -= 10;  // Near high = expensive

    // Normalize score
    const maxPossible = factors > 0 ? factors * 30 + 15 : 100;
    const normalizedScore = Math.round((score / maxPossible) * 100);
    const clampedScore = Math.max(-100, Math.min(100, normalizedScore));

    // Map score to signal
    let signal: TechnicalSignals['signal'];
    if (clampedScore >= 50) signal = 'STRONG_BUY';
    else if (clampedScore >= 15) signal = 'BUY';
    else if (clampedScore > -15) signal = 'NEUTRAL';
    else if (clampedScore > -50) signal = 'SELL';
    else signal = 'STRONG_SELL';

    return {
        rsi14,
        sma20,
        sma50,
        sma200,
        bollingerUpper: bollinger?.upper ?? null,
        bollingerLower: bollinger?.lower ?? null,
        bollingerMiddle: bollinger?.middle ?? null,
        atr14: null, // Needs OHLC data
        percentFromHigh,
        percentFromLow,
        signal,
        score: clampedScore,
    };
};

/**
 * Get signal color based on score
 */
export const getSignalColor = (signal: TechnicalSignals['signal']): string => {
    switch (signal) {
        case 'STRONG_BUY': return '#10b981';
        case 'BUY': return '#34d399';
        case 'NEUTRAL': return '#f59e0b';
        case 'SELL': return '#f87171';
        case 'STRONG_SELL': return '#ef4444';
    }
};

/**
 * Get traffic light emoji for signal
 */
export const getSignalEmoji = (signal: TechnicalSignals['signal']): string => {
    switch (signal) {
        case 'STRONG_BUY': return '🟢';
        case 'BUY': return '🟢';
        case 'NEUTRAL': return '🟡';
        case 'SELL': return '🔴';
        case 'STRONG_SELL': return '🔴';
    }
};
