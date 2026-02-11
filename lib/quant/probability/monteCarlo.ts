/**
 * Geometric Brownian Motion (GBM) Monte Carlo Engine
 */

// Box-Muller transform to generate standard normal random variables
const gaussianRandom = (): number => {
    let u = 0, v = 0;
    while(u === 0) u = Math.random();
    while(v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};

/**
 * Simulates multiple random walk price paths using GBM.
 * dS = S * (μ * dt + σ * dW)
 * 
 * @param startPrice Initial asset price (S0)
 * @param expectedReturn Annualized expected drift (μ) e.g., 0.08 for 8%
 * @param volatility Annualized volatility (σ) e.g., 0.20 for 20%
 * @param numPaths How many simulation lines to draw
 * @param timeHorizonYears Total time to simulate in years (e.g. 1 year)
 * @param stepsPerYear How many data points per year (e.g. 252 for daily)
 */
export const simulateGBM = (
    startPrice: number,
    expectedReturn: number,
    volatility: number,
    numPaths: number,
    timeHorizonYears: number,
    stepsPerYear: number = 252
): number[][] => {
    const totalSteps = Math.floor(timeHorizonYears * stepsPerYear);
    const dt = 1 / stepsPerYear; // Time step in years
    
    // Precalculate the deterministic drift portion of the continuous GBM formula
    // S(t) = S0 * exp((μ - σ^2/2)t + σW)
    const driftExp = (expectedReturn - 0.5 * Math.pow(volatility, 2)) * dt;
    const volSqrtDt = volatility * Math.sqrt(dt);

    const paths: number[][] = [];

    for (let path = 0; path < numPaths; path++) {
        const currentPath: number[] = new Array(totalSteps + 1);
        currentPath[0] = startPrice;
        
        for (let step = 1; step <= totalSteps; step++) {
            // W is a standard normal random variable
            const W = gaussianRandom();
            // Next price
            currentPath[step] = currentPath[step - 1] * Math.exp(driftExp + volSqrtDt * W);
        }
        paths.push(currentPath);
    }

    return paths;
};
