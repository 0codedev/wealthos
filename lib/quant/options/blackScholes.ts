import { normalCdf, normalPdf } from '../probability/distributions';

export interface BSMInputs {
    S: number;  // Current Stock Price
    K: number;  // Strike Price
    T: number;  // Time to Expiry (in years)
    r: number;  // Risk-Free Rate (decimal, e.g., 0.05 for 5%)
    v: number;  // Volatility (decimal, e.g., 0.20 for 20%)
    q?: number; // Dividend Yield (decimal, default 0)
}

export interface BSMOutputs {
    callPrice: number;
    putPrice: number;
    callDelta: number;
    putDelta: number;
    gamma: number;
    vega: number;
    callTheta: number;
    putTheta: number;
    callRho: number;
    putRho: number;
    d1: number;
    d2: number;
}

/**
 * Calculates the Black-Scholes-Merton option prices and Greeks
 * 
 * S: Spot Price
 * K: Strike Price
 * T: Time to Expiry (years)
 * r: Risk-free rate (decimal)
 * v: Implied Volatility (decimal)
 * q: Continuous Dividend Yield (decimal)
 */
export const calculateBSM = ({ S, K, T, r, v, q = 0 }: BSMInputs): BSMOutputs => {
    // Edge case: Expiry is 0 (or almost 0)
    if (T <= 0) {
        return {
            callPrice: Math.max(0, S - K),
            putPrice: Math.max(0, K - S),
            callDelta: S > K ? 1 : 0,
            putDelta: S < K ? -1 : 0,
            gamma: 0,
            vega: 0,
            callTheta: 0,
            putTheta: 0,
            callRho: 0,
            putRho: 0,
            d1: 0,
            d2: 0,
        };
    }

    // d1 and d2 calculations
    const d1 = (Math.log(S / K) + (r - q + 0.5 * v * v) * T) / (v * Math.sqrt(T));
    const d2 = d1 - v * Math.sqrt(T);

    // Cumulative distribution function values
    const Nd1 = normalCdf(d1);
    const Nd2 = normalCdf(d2);
    const N_minus_d1 = normalCdf(-d1);
    const N_minus_d2 = normalCdf(-d2);

    // Probability density function value
    const pd1 = normalPdf(d1);

    const ert = Math.exp(-r * T);
    const eqt = Math.exp(-q * T);

    // Pricing
    const callPrice = S * eqt * Nd1 - K * ert * Nd2;
    const putPrice = K * ert * N_minus_d2 - S * eqt * N_minus_d1;

    // Greeks
    const callDelta = eqt * Nd1;
    const putDelta = eqt * (Nd1 - 1);
    
    // Gamma is the same for calls and puts
    const gamma = (eqt * pd1) / (S * v * Math.sqrt(T));
    
    // Vega is the same for calls and puts (often expressed per 1% change, so /100)
    const vega = (S * eqt * pd1 * Math.sqrt(T)) / 100;
    
    // Theta (often expressed per day, so /365)
    // Formula without dividend: (- (S*v*pd1)/(2*sqrt(T)) - r*K*ert*Nd2 ) / 365
    // Formula with dividend:
    const thetaTerm1 = -(S * v * eqt * pd1) / (2 * Math.sqrt(T));
    const callTheta = (thetaTerm1 + q * S * eqt * Nd1 - r * K * ert * Nd2) / 365;
    const putTheta = (thetaTerm1 - q * S * eqt * N_minus_d1 + r * K * ert * N_minus_d2) / 365;

    // Rho (often expressed per 1% change, so /100)
    const callRho = (K * T * ert * Nd2) / 100;
    const putRho = (-K * T * ert * N_minus_d2) / 100;

    return {
        callPrice: Math.max(0, callPrice),
        putPrice: Math.max(0, putPrice),
        callDelta,
        putDelta,
        gamma,
        vega,
        callTheta,
        putTheta,
        callRho,
        putRho,
        d1,
        d2
    };
};
