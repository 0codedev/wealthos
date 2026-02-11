/**
 * Cox-Ross-Rubinstein (CRR) Binomial Tree Model
 * Solves for American options by building a price lattice and tracking 
 * the maximum of (early exercise, hold value) working backwards from expiry.
 */

export interface BinomialInputs {
    S: number;  // Current stock price
    K: number;  // Strike price
    T: number;  // Time to expiry (in years)
    r: number;  // Risk-free interest rate (decimal)
    v: number;  // Volatility (decimal)
    q?: number; // Dividend yield (decimal)
    n: number;  // Number of discrete steps
    isCall: boolean; // True for Call, false for Put
    isAmerican: boolean; // True allows early exercise
}

/**
 * Executes a full N-step Binomial Options Pricing calculation
 */
export const calculateBinomialOption = (inputs: BinomialInputs): { price: number } => {
    const { S, K, T, r, v, q = 0, n, isCall, isAmerican } = inputs;
    
    // Step size (dt)
    const dt = T / n;
    
    // CRR Parameters
    const u = Math.exp(v * Math.sqrt(dt)); // Up-move factor
    const d = 1 / u; // Down-move factor
    
    // Risk-neutral probability
    const p = (Math.exp((r - q) * dt) - d) / (u - d);
    
    // Discount factor for one step
    const df = Math.exp(-r * dt);
    
    // Initialize the asset price tree at maturity (node N)
    // We only need a 1D array representing the final column, then work backwards
    const values: number[] = new Array(n + 1);
    
    for (let i = 0; i <= n; i++) {
        // Price at node (n, i) = S * u^(n-i) * d^i
        const ST = S * Math.pow(u, n - i) * Math.pow(d, i);
        // Payoff at maturity
        values[i] = Math.max(0, isCall ? ST - K : K - ST);
    }
    
    // Work backwards through the tree
    for (let step = n - 1; step >= 0; step--) {
        for (let i = 0; i <= step; i++) {
            // Expected value of holding the option (discounted expected future payoff)
            const holdValue = df * (p * values[i] + (1 - p) * values[i + 1]);
            
            if (isAmerican) {
                // If American, check if early exercise is more profitable
                // Stock price at this intermediate node:
                const St = S * Math.pow(u, step - i) * Math.pow(d, i);
                const exerciseValue = isCall ? St - K : K - St;
                
                // Option value is the maximum of holding it or exercising it early
                values[i] = Math.max(holdValue, exerciseValue, 0);
            } else {
                // European option can only be held
                values[i] = holdValue;
            }
        }
    }
    
    // The value at node (0,0) is the option price today
    return { price: values[0] };
};
