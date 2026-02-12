/**
 * Hypothesis Testing Engine
 */
import { mean, stdDev } from './descriptive';

export interface HypothesisResult {
    testStatistic: number;
    pValue: number;
    rejectNull: boolean;
    criticalValue: number;
}

/**
 * Standard Normal CDF helper for p-values
 * Uses Hastings approximation for normal CDF
 */
const normalCDF = (z: number): number => {
    const b1 = 0.31938153;
    const b2 = -0.356563782;
    const b3 = 1.781477937;
    const b4 = -1.821255978;
    const b5 = 1.330274429;
    const p = 0.2316419;
    const c = 0.39894228;

    if (z >= 0.0) {
        const t = 1.0 / (1.0 + p * z);
        return (1.0 - c * Math.exp(-z * z / 2.0) * t *
            (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1));
    } else {
        const t = 1.0 / (1.0 - p * z);
        return (c * Math.exp(-z * z / 2.0) * t *
            (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1));
    }
};

/**
 * One-Sample Z-Test
 * Tests if the population mean is significantly different from a hypothesized value.
 * Assumes population standard deviation is known or sample size is very large (n > 30).
 * 
 * @param sampleData Array of sample observations
 * @param populationMean Expected or hypothesized population mean (Null Hypothesis)
 * @param populationStdDev Known population standard deviation (if null, uses sample stdDev)
 * @param alpha Significance level (e.g. 0.05 for 95% confidence)
 * @param tail "two" | "left" | "right"
 */
export const zTest1Sample = (
    sampleData: number[],
    populationMean: number,
    populationStdDev: number | null = null,
    alpha: number = 0.05,
    tail: 'two' | 'left' | 'right' = 'two'
): HypothesisResult => {
    if (sampleData.length === 0) {
        return { testStatistic: 0, pValue: 1, rejectNull: false, criticalValue: 0 };
    }

    const n = sampleData.length;
    const sampleMean = mean(sampleData);
    const sigma = populationStdDev !== null ? populationStdDev : stdDev(sampleData, true);
    
    // Z = (x̄ - μ) / (σ / √n)
    const zScore = (sampleMean - populationMean) / (sigma / Math.sqrt(n));
    
    let pValue = 0;
    // For two-tailed test, critical value is approx 1.96 for alpha=0.05
    // In a real quant engine we should use an exact inverse CDF, here we hardcode 1.96 for simplicity 
    // unless using a complex library. For now, let's just use Z=1.96 for 95%.
    let criticalValue = 1.96; 
    
    if (tail === 'two') {
        pValue = 2 * (1 - normalCDF(Math.abs(zScore)));
        if (alpha === 0.01) criticalValue = 2.576;
        else if (alpha === 0.10) criticalValue = 1.645;
    } else if (tail === 'right') {
        pValue = 1 - normalCDF(zScore);
        if (alpha === 0.05) criticalValue = 1.645;
        else if (alpha === 0.01) criticalValue = 2.326;
        else if (alpha === 0.10) criticalValue = 1.282;
    } else if (tail === 'left') {
        pValue = normalCDF(zScore);
        if (alpha === 0.05) criticalValue = -1.645;
        else if (alpha === 0.01) criticalValue = -2.326;
        else if (alpha === 0.10) criticalValue = -1.282;
    }

    const rejectNull = pValue < alpha;

    return {
        testStatistic: zScore,
        pValue,
        rejectNull,
        criticalValue
    };
};
