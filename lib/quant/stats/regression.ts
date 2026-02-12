/**
 * Regression Analysis Engine
 */
import { mean, variance, covariance } from './descriptive';

export interface LinearRegressionResult {
    slope: number;
    intercept: number;
    rSquared: number;
    correlation: number;
    points: { x: number, y: number }[];
    predictedY: number[];
}

/**
 * Simple Linear Regression (Ordinary Least Squares)
 * Fits a line Y = β0 + β1*X
 * 
 * @param x Independent variable array (Predictor)
 * @param y Dependent variable array (Target)
 */
export const simpleLinearRegression = (
    x: number[], 
    y: number[]
): LinearRegressionResult => {
    if (x.length !== y.length || x.length < 2) {
        return {
            slope: 0,
            intercept: 0,
            rSquared: 0,
            correlation: 0,
            points: [],
            predictedY: []
        };
    }

    const meanX = mean(x);
    const meanY = mean(y);
    
    // Covariance / Variance gives slope β1
    const covXY = covariance(x, y, true);
    const varX = variance(x, true);
    const varY = variance(y, true);
    
    const slope = varX === 0 ? 0 : covXY / varX;
    
    // β0 = Y - β1*X
    const intercept = meanY - slope * meanX;
    
    // R-Squared calculation
    // R^2 = (Cov(X,Y)^2) / (Var(X) * Var(Y))
    const rSquared = (varX === 0 || varY === 0) 
        ? 0 
        : Math.pow(covXY, 2) / (varX * varY);
        
    const correlation = Math.sqrt(rSquared) * (slope > 0 ? 1 : -1);

    // Prepare point pairs and predicted line for charting
    const points: {x:number, y:number}[] = [];
    const predictedY: number[] = [];
    
    for (let i = 0; i < x.length; i++) {
        points.push({ x: x[i], y: y[i] });
        predictedY.push(intercept + slope * x[i]);
    }

    return {
        slope,
        intercept,
        rSquared,
        correlation,
        points,
        predictedY
    };
};
