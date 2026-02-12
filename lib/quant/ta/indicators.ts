/**
 * Core Price Oscillators and Indicator Math Engines
 */
import { stdDev } from '../stats/descriptive';

/**
 * Simple Moving Average (SMA)
 */
export const calculateSMA = (data: number[], period: number): number[] => {
    if (data.length < period || period <= 0) return [];
    
    const sma: number[] = new Array(data.length).fill(null);
    let sum = 0;
    
    // Initial sum
    for (let i = 0; i < period; i++) sum += data[i];
    sma[period - 1] = sum / period;
    
    for (let i = period; i < data.length; i++) {
        sum = sum - data[i - period] + data[i];
        sma[i] = sum / period;
    }
    return sma;
};

/**
 * Exponential Moving Average (EMA)
 */
export const calculateEMA = (data: number[], period: number): number[] => {
    if (data.length < period || period <= 0) return [];
    
    const ema: number[] = new Array(data.length).fill(null);
    const multiplier = 2 / (period + 1);
    
    // Start EMA with SMA of first 'period' elements
    let sum = 0;
    for (let i = 0; i < period; i++) sum += data[i];
    let prevEma = sum / period;
    ema[period - 1] = prevEma;
    
    for (let i = period; i < data.length; i++) {
        prevEma = (data[i] - prevEma) * multiplier + prevEma;
        ema[i] = prevEma;
    }
    return ema;
};

/**
 * Relative Strength Index (RSI) using Wilder's Smoothing Method
 */
export const calculateRSI = (data: number[], period: number = 14): number[] => {
    if (data.length <= period || period <= 0) return [];
    
    const rsi: number[] = new Array(data.length).fill(null);
    
    let sumGain = 0;
    let sumLoss = 0;
    
    // First setup
    for (let i = 1; i <= period; i++) {
        const diff = data[i] - data[i - 1];
        if (diff > 0) sumGain += diff;
        else sumLoss += Math.abs(diff);
    }
    
    let avgGain = sumGain / period;
    let avgLoss = sumLoss / period;
    
    if (avgLoss === 0) rsi[period] = 100;
    else rsi[period] = 100 - (100 / (1 + (avgGain / avgLoss)));
    
    // Wilder's smoothing
    for (let i = period + 1; i < data.length; i++) {
        const diff = data[i] - data[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? Math.abs(diff) : 0;
        
        avgGain = ((avgGain * (period - 1)) + gain) / period;
        avgLoss = ((avgLoss * (period - 1)) + loss) / period;
        
        if (avgLoss === 0) rsi[i] = 100;
        else rsi[i] = 100 - (100 / (1 + (avgGain / avgLoss)));
    }
    
    return rsi;
};

/**
 * Bollinger Bands
 */
export interface BollingerBands {
    upper: number[];
    middle: number[]; // SMA
    lower: number[];
}

export const calculateBollingerBands = (data: number[], period: number = 20, multiplier: number = 2): BollingerBands => {
    if (data.length < period || period <= 0) {
        return { upper: [], middle: [], lower: [] };
    }
    
    const upper: number[] = new Array(data.length).fill(null);
    const middle: number[] = calculateSMA(data, period);
    const lower: number[] = new Array(data.length).fill(null);
    
    for (let i = period - 1; i < data.length; i++) {
        // Slice the window backwards
        const window = data.slice(i - period + 1, i + 1);
        const stdev = stdDev(window, true);
        
        upper[i] = middle[i]! + multiplier * stdev;
        lower[i] = middle[i]! - multiplier * stdev;
    }
    
    return { upper, middle, lower };
};

/**
 * Average True Range (ATR)
 * Measures absolute historical volatility in exact price units.
 */
export const calculateATR = (highs: number[], lows: number[], closes: number[], period: number = 14): number[] => {
    if (highs.length !== lows.length || lows.length !== closes.length || closes.length <= period) return [];

    const atr: number[] = new Array(closes.length).fill(null);
    const tr: number[] = new Array(closes.length).fill(0);
    
    // True Range TR: max(H-L, abs(H-Cprev), abs(L-Cprev))
    tr[0] = highs[0] - lows[0]; // first day has no Cprev
    for (let i = 1; i < closes.length; i++) {
        tr[i] = Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        );
    }
    
    // Initial ATR (SMA of TR)
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += tr[i];
    atr[period] = sum / period;
    
    // Wilder's Smoothing for ATR
    for (let i = period + 1; i < closes.length; i++) {
        atr[i] = (atr[i - 1]! * (period - 1) + tr[i]) / period;
    }
    
    return atr;
};
