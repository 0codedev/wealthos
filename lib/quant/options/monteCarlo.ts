/**
 * Monte Carlo Option Pricing Engine
 * Simulates thousands of price paths using Geometric Brownian Motion (GBM) 
 * to establish theoretical price distribution expectations.
 */

// Basic Box-Muller transform for standard normal random variables
const randomNormal = (): number => {
    let u = 0, v = 0;
    while(u === 0) u = Math.random(); // Converting [0,1) to (0,1)
    while(v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};

export interface MonteCarloInputs {
    S: number;      // Current stock price
    K: number;      // Strike price
    T: number;      // Time to expiry (in years)
    r: number;      // Risk-free interest rate (decimal)
    v: number;      // Volatility (decimal)
    q?: number;     // Dividend yield (decimal)
    paths: number;  // Number of independent simulated paths (e.g. 10000)
    steps?: number; // Number of steps per path (only strictly needed for path-dependent options)
}

export interface MonteCarloOutputs {
    callPrice: number;
    putPrice: number;
    callStdError: number;  // Standard error of the mean
    putStdError: number;
}

/**
 * European Option Pricer via Terminal GBM
 * Since standard European options are strictly path-independent, we only need
 * to simulate the terminal price S(T) directly in one leap, which is incredibly fast.
 */
export const calculateMonteCarloEuropean = (inputs: MonteCarloInputs): MonteCarloOutputs => {
    const { S, K, T, r, v, q = 0, paths } = inputs;
    
    let callSum = 0;
    let putSum = 0;
    let callSqSum = 0;
    let putSqSum = 0;
    
    // Pre-calculate the drift block: (r - q - v^2/2) * T
    const drift = (r - q - 0.5 * v * v) * T;
    // Volatility block: v * sqrt(T)
    const vol = v * Math.sqrt(T);
    
    // Simulate terminal prices
    for (let i = 0; i < paths; i++) {
        // Random shock N(0,1)
        const Z = randomNormal();
        
        // Terminal price formula: S_T = S_0 * exp(drift + vol * Z)
        const ST = S * Math.exp(drift + vol * Z);
        
        // Payoffs
        const callPayoff = Math.max(0, ST - K);
        const putPayoff = Math.max(0, K - ST);
        
        callSum += callPayoff;
        putSum += putPayoff;
        callSqSum += callPayoff * callPayoff;
        putSqSum += putPayoff * putPayoff;
    }
    
    // Discount factor back to present value
    const df = Math.exp(-r * T);
    
    // Expected Present Values
    const callPrice = df * (callSum / paths);
    const putPrice = df * (putSum / paths);
    
    // Standard Errors = Sample StdDev / sqrt(N) * Discount
    // Sample variance = E[X^2] - (E[X])^2
    const callVariance = Math.max(0, (callSqSum / paths) - Math.pow(callSum / paths, 2));
    const putVariance = Math.max(0, (putSqSum / paths) - Math.pow(putSum / paths, 2));
    
    const callStdError = df * Math.sqrt(callVariance / paths);
    const putStdError = df * Math.sqrt(putVariance / paths);
    
    return { callPrice, putPrice, callStdError, putStdError };
};
