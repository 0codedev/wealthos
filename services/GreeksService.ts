/**
 * GreeksService - Black-Scholes Options Pricing & Greeks Engine
 * 
 * Provides:
 * - Delta: Sensitivity to underlying price change
 * - Gamma: Sensitivity of Delta to price change (Acceleration)
 * - Theta: Time decay per day
 * - Vega: Sensitivity to Implied Volatility
 * - Rho: Sensitivity to Interest Rates
 */

export interface Greeks {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
}

class GreeksService {
    private static instance: GreeksService;

    private constructor() {}

    static getInstance(): GreeksService {
        if (!GreeksService.instance) {
            GreeksService.instance = new GreeksService();
        }
        return GreeksService.instance;
    }

    /**
     * Standard Normal Cumulative Distribution Function
     */
    private nCDF(x: number): number {
        const t = 1 / (1 + 0.2316419 * Math.abs(x));
        const d = 0.3989423 * Math.exp(-x * x / 2);
        const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + t * 1.3302744))));
        return x > 0 ? 1 - p : p;
    }

    /**
     * Standard Normal Probability Density Function
     */
    private nPDF(x: number): number {
        return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
    }

    /**
     * Calculate Greeks for an option
     * 
     * @param s Current Stock Price (Spot)
     * @param k Strike Price
     * @param t Time to expiration (in years, e.g., 5 days = 5/365)
     * @param r Risk-free interest rate (e.g., 0.07 for 7%)
     * @param v Implied Volatility (e.g., 0.15 for 15%)
     * @param type 'CE' or 'PE'
     */
    calculateGreeks(s: number, k: number, t: number, r: number, v: number, type: 'CE' | 'PE'): Greeks {
        if (t <= 0) t = 0.000001; // Avoid division by zero on expiry day
        
        const d1 = (Math.log(s / k) + (r + (v * v) / 2) * t) / (v * Math.sqrt(t));
        const d2 = d1 - v * Math.sqrt(t);

        const delta = type === 'CE' ? this.nCDF(d1) : this.nCDF(d1) - 1;
        const gamma = this.nPDF(d1) / (s * v * Math.sqrt(t));
        const vega = (s * this.nPDF(d1) * Math.sqrt(t)) / 100; // Divided by 100 for 1% IV change
        
        // Theta calculation
        const theta1 = -(s * this.nPDF(d1) * v) / (2 * Math.sqrt(t));
        const theta2 = r * k * Math.exp(-r * t) * this.nCDF(d2);
        const theta3 = r * k * Math.exp(-r * t) * this.nCDF(-d2);
        
        let theta = 0;
        if (type === 'CE') {
            theta = (theta1 - theta2) / 365;
        } else {
            theta = (theta1 + theta3) / 365;
        }

        const rho = (type === 'CE' 
            ? k * t * Math.exp(-r * t) * this.nCDF(d2)
            : -k * t * Math.exp(-r * t) * this.nCDF(-d2)) / 100;

        return {
            delta,
            gamma,
            theta,
            vega,
            rho
        };
    }
}

export const greeksService = GreeksService.getInstance();
