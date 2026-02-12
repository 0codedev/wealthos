/**
 * Calculates the arithmetic mean (average) of an array of numbers.
 */
export const mean = (data: number[]): number => {
    if (data.length === 0) return 0;
    return data.reduce((sum, val) => sum + val, 0) / data.length;
};

/**
 * Calculates the variance of an array of numbers.
 * @param data Array of numbers
 * @param isSample Set to true for sample variance (n-1), false for population variance (n)
 */
export const variance = (data: number[], isSample: boolean = true): number => {
    if (data.length < 2) return 0;
    const m = mean(data);
    const sumSq = data.reduce((sum, val) => sum + Math.pow(val - m, 2), 0);
    return sumSq / (data.length - (isSample ? 1 : 0));
};

/**
 * Calculates the standard deviation of an array of numbers.
 */
export const stdDev = (data: number[], isSample: boolean = true): number => {
    return Math.sqrt(variance(data, isSample));
};

/**
 * Calculates the covariance between two arrays of numbers.
 */
export const covariance = (dataX: number[], dataY: number[], isSample: boolean = true): number => {
    if (dataX.length !== dataY.length || dataX.length < 2) return 0;
    const meanX = mean(dataX);
    const meanY = mean(dataY);
    let sum = 0;
    for (let i = 0; i < dataX.length; i++) {
        sum += (dataX[i] - meanX) * (dataY[i] - meanY);
    }
    return sum / (dataX.length - (isSample ? 1 : 0));
};

/**
 * Calculates the Pearson correlation coefficient between two arrays of numbers.
 */
export const correlation = (dataX: number[], dataY: number[]): number => {
    const cov = covariance(dataX, dataY, true);
    const stdX = stdDev(dataX, true);
    const stdY = stdDev(dataY, true);
    if (stdX === 0 || stdY === 0) return 0;
    return cov / (stdX * stdY);
};

/**
 * Calculates the downside deviation (used for Sortino ratio).
 */
export const downsideDeviation = (data: number[], targetReturn: number = 0, isSample: boolean = true): number => {
    if (data.length < 2) return 0;
    const sumSq = data.reduce((sum, val) => {
        return val < targetReturn ? sum + Math.pow(val - targetReturn, 2) : sum;
    }, 0);
    return Math.sqrt(sumSq / (data.length - (isSample ? 1 : 0)));
};

/**
 * Calculates the median of an array of numbers.
 */
export const median = (data: number[]): number => {
    if (data.length === 0) return 0;
    const sorted = [...data].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
};

/**
 * Calculates the mode of an array of numbers. Returns the first mode if multiple exist.
 */
export const mode = (data: number[]): number | null => {
    if (data.length === 0) return null;
    const counts = new Map<number, number>();
    let maxFreq = 0;
    let modeVal = data[0];
    
    for (const val of data) {
        const count = (counts.get(val) || 0) + 1;
        counts.set(val, count);
        if (count > maxFreq) {
            maxFreq = count;
            modeVal = val;
        }
    }
    return modeVal;
};

/**
 * Calculates Fisher-Pearson coefficient of skewness.
 */
export const skewness = (data: number[]): number => {
    if (data.length < 3) return 0;
    const m = mean(data);
    const s = stdDev(data, true);
    if (s === 0) return 0;
    
    const n = data.length;
    let sum3 = 0;
    for (const val of data) {
        sum3 += Math.pow((val - m) / s, 3);
    }
    
    // Adjusted Fisher-Pearson formula
    return (n * sum3) / ((n - 1) * (n - 2));
};

/**
 * Calculates Excess Kurtosis (Fisher). Normal distribution = 0.
 */
export const kurtosis = (data: number[]): number => {
    if (data.length < 4) return 0;
    const m = mean(data);
    const s = stdDev(data, true);
    if (s === 0) return 0;
    
    const n = data.length;
    let sum4 = 0;
    for (const val of data) {
        sum4 += Math.pow((val - m) / s, 4);
    }
    
    const term1 = (n * (n + 1) * sum4) / ((n - 1) * (n - 2) * (n - 3));
    const term2 = (3 * Math.pow(n - 1, 2)) / ((n - 2) * (n - 3));
    return term1 - term2;
};

/**
 * Calculates the Nth percentile of a sorted array. P = 0 to 100
 */
export const percentile = (sortedData: number[], p: number): number => {
    if (sortedData.length === 0) return 0;
    if (p <= 0) return sortedData[0];
    if (p >= 100) return sortedData[sortedData.length - 1];

    const index = (p / 100) * (sortedData.length - 1);
    const lower = Math.floor(index);
    const upper = lower + 1;
    const weight = index % 1;

    if (upper >= sortedData.length) return sortedData[lower];
    return sortedData[lower] * (1 - weight) + sortedData[upper] * weight;
};

/**
 * Calculates the Interquartile Range (IQR). Wait for sorted data.
 */
export const iqr = (sortedData: number[]): number => {
    if (sortedData.length < 2) return 0;
    const q1 = percentile(sortedData, 25);
    const q3 = percentile(sortedData, 75);
    return q3 - q1;
};

