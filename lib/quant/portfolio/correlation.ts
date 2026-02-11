/**
 * Matrix Math & N-Asset Portfolio Interrelationships
 * Tools for building Correlation and Covariance matrices from multi-asset return arrays.
 */

import { mean, stdDev } from '../stats/descriptive';

/**
 * Efficiently computes the Pearson Correlation Coefficient between exactly two arrays of identical length.
 */
export const pearsonCorrelation = (x: number[], y: number[]): number => {
    if (x.length !== y.length || x.length === 0) return 0;
    
    const n = x.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    
    for (let i = 0; i < n; i++) {
        const xi = x[i];
        const yi = y[i];
        sumX += xi;
        sumY += yi;
        sumXY += xi * yi;
        sumX2 += xi * xi;
        sumY2 += yi * yi;
    }
    
    const numerator = (n * sumXY) - (sumX * sumY);
    const denominator = Math.sqrt(((n * sumX2) - (sumX * sumX)) * ((n * sumY2) - (sumY * sumY)));
    
    if (denominator === 0) return 0;
    return numerator / denominator;
};

/**
 * Builds a full N x N Pearson Correlation Matrix from an array of N return arrays.
 * 
 * @param returnsMatrix Array of N arrays, where each inner array contains T chronological returns.
 * @returns 2D Correlation matrix NxN, where diagonal is exactly 1.0.
 */
export const buildCorrelationMatrix = (returnsMatrix: number[][]): number[][] => {
    const N = returnsMatrix.length;
    const matrix: number[][] = Array.from({ length: N }, () => new Array(N).fill(1));
    
    for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) { // Only compute upper triangle
            const corr = pearsonCorrelation(returnsMatrix[i], returnsMatrix[j]);
            matrix[i][j] = corr;
            matrix[j][i] = corr; // Symmetric
        }
    }
    
    return matrix;
};

/**
 * Evaluates Portfolio Variance given N Asset Weights, N Asset StdDevs, and an N x N Correlation matrix.
 * Direct application of w^T * Cov * w logic expanded via correlation (Cov = Corr * stdI * stdJ).
 * 
 * @param weights Array of N weights (summing to 1)
 * @param stdDevs Array of N historical standard deviations
 * @param corrMatrix N x N Correlation matrix
 * @returns Total Portfolio Variance
 */
export const calculateNAssetPortfolioVariance = (weights: number[], stdDevs: number[], corrMatrix: number[][]): number => {
    let varSum = 0;
    const N = weights.length;
    
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            varSum += weights[i] * weights[j] * stdDevs[i] * stdDevs[j] * corrMatrix[i][j];
        }
    }
    
    return varSum;
};
