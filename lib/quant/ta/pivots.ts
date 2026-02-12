/**
 * Pivot Point Calculations
 */

export interface PivotPoints {
    pivot: number;
    r1: number;
    r2: number;
    r3: number;
    s1: number;
    s2: number;
    s3: number;
}

/**
 * Standard (Floor Trader) Pivots
 */
export const standardPivots = (high: number, low: number, close: number): PivotPoints => {
    const p = (high + low + close) / 3;
    const r1 = (p * 2) - low;
    const r2 = p + (high - low);
    const r3 = high + 2 * (p - low);
    
    const s1 = (p * 2) - high;
    const s2 = p - (high - low);
    const s3 = low - 2 * (high - p);
    
    return { pivot: p, r1, r2, r3, s1, s2, s3 };
};

/**
 * Fibonacci Pivots
 * Applies key Fib ratios (.382, .618, 1.0) to the previous day's range extended from the Pivot.
 */
export const fibonacciPivots = (high: number, low: number, close: number): PivotPoints => {
    const p = (high + low + close) / 3;
    const range = high - low;
    
    const r1 = p + 0.382 * range;
    const r2 = p + 0.618 * range;
    const r3 = p + 1.000 * range;
    
    const s1 = p - 0.382 * range;
    const s2 = p - 0.618 * range;
    const s3 = p - 1.000 * range;
    
    return { pivot: p, r1, r2, r3, s1, s2, s3 };
};

/**
 * Camarilla Pivots
 * Known for intense mean-reversion boundary support/resistance levels.
 */
export const camarillaPivots = (high: number, low: number, close: number): PivotPoints => {
    const range = high - low;
    // Camarilla doesn't strictly use a central pivot in the same way, but we will return close for alignment
    const p = close; 
    
    const r1 = close + range * 1.1 / 12;
    const r2 = close + range * 1.1 / 6;
    const r3 = close + range * 1.1 / 4;
    
    const s1 = close - range * 1.1 / 12;
    const s2 = close - range * 1.1 / 6;
    const s3 = close - range * 1.1 / 4;
    
    return { pivot: p, r1, r2, r3, s1, s2, s3 };
};

/**
 * Woodie's Pivots
 * Gives much higher weighting to the Recent Close.
 */
export const woodiePivots = (high: number, low: number, close: number): PivotPoints => {
    const p = (high + low + 2 * close) / 4;
    const range = high - low;
    
    const r1 = (2 * p) - low;
    const r2 = p + range;
    const r3 = high + 2 * (p - low); // standard ext
    
    const s1 = (2 * p) - high;
    const s2 = p - range;
    const s3 = low - 2 * (high - p); // standard ext

    return { pivot: p, r1, r2, r3, s1, s2, s3 };
};
