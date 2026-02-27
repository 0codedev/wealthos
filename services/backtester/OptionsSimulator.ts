/**
 * OptionsSimulator
 * 
 * Implements the Black-Scholes model for option pricing and Greek calculations.
 * Used for simulating options strategy performance over time.
 */
export interface OptionGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export interface OptionPriceResult {
  price: number;
  greeks: OptionGreeks;
}

export class OptionsSimulator {
  
  /**
   * Cumulative standard normal distribution function (N(x))
   */
  private static cnd(x: number): number {
    const a1 = 0.31938153;
    const a2 = -0.356563782;
    const a3 = 1.781477937;
    const a4 = -1.821255978;
    const a5 = 1.330274429;
    const L = Math.abs(x);
    const K = 1.0 / (1.0 + 0.2316419 * L);
    let d = 1.0 - 1.0 / Math.sqrt(2 * Math.PI) * Math.exp(-L * L / 2) * (a1 * K + a2 * K * K + a3 * Math.pow(K, 3) + a4 * Math.pow(K, 4) + a5 * Math.pow(K, 5));
    if (x < 0) d = 1.0 - d;
    return d;
  }

  /**
   * Standard normal probability density function (n(x))
   */
  private static npdf(x: number): number {
    return (1.0 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
  }

  /**
   * Calculates Option Price and Greeks using Black-Scholes model
   * 
   * @param S Spot Price
   * @param K Strike Price
   * @param T Time to Expiry (in years, e.g., 7 days = 7/365)
   * @param r Risk-free rate (e.g., 0.07 for 7%)
   * @param v Volatility (Implied Volatility, e.g., 0.20 for 20%)
   * @param type 'CE' for Call, 'PE' for Put
   */
  static calculatePrice(
    S: number,
    K: number,
    T: number,
    r: number,
    v: number,
    type: 'CE' | 'PE'
  ): OptionPriceResult {
    // Basic validation to prevent NaN
    if (T <= 0) return { price: type === 'CE' ? Math.max(0, S - K) : Math.max(0, K - S), greeks: { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 } };
    if (v <= 0) v = 0.01; // Avoid division by zero

    const d1 = (Math.log(S / K) + (r + (v * v) / 2) * T) / (v * Math.sqrt(T));
    const d2 = d1 - v * Math.sqrt(T);

    let price = 0;
    let delta = 0;
    let rho = 0;

    if (type === 'CE') {
      price = S * this.cnd(d1) - K * Math.exp(-r * T) * this.cnd(d2);
      delta = this.cnd(d1);
      rho = K * T * Math.exp(-r * T) * this.cnd(d2) / 100;
    } else {
      price = K * Math.exp(-r * T) * this.cnd(-d2) - S * this.cnd(-d1);
      delta = this.cnd(d1) - 1;
      rho = -K * T * Math.exp(-r * T) * this.cnd(-d2) / 100;
    }

    const gamma = this.npdf(d1) / (S * v * Math.sqrt(T));
    const vega = (S * Math.sqrt(T) * this.npdf(d1)) / 100;
    
    // Theta calculation (per day)
    const thetaPart1 = -(S * v * this.npdf(d1)) / (2 * Math.sqrt(T));
    const thetaPart2 = r * K * Math.exp(-r * T) * (type === 'CE' ? this.cnd(d2) : this.cnd(-d2));
    const theta = (thetaPart1 - thetaPart2) / 365;

    return {
      price,
      greeks: { delta, gamma, theta, vega, rho }
    };
  }

  /**
   * Calculates Implied Volatility (IV) using the Newton-Raphson method,
   * falling back to bisection search if Newton-Raphson fails to converge.
   * 
   * @param S Spot Price
   * @param marketPrice Option market price
   * @param K Strike Price
   * @param T Time to Expiry (in years)
   * @param r Risk-free rate
   * @param type 'CE' | 'PE'
   */
  static calculateIV(
    S: number,
    marketPrice: number,
    K: number,
    T: number,
    r: number,
    type: 'CE' | 'PE'
  ): number {
    if (marketPrice <= 0) return 0.001;

    let v = 0.20; // Initial guess (20% volatility)
    const maxIterations = 100;
    const tolerance = 1e-5;

    // 1. Try Newton-Raphson method
    for (let i = 0; i < maxIterations; i++) {
      const res = this.calculatePrice(S, K, T, r, v, type);
      const price = res.price;
      const vega = res.greeks.vega * 100; // raw vega (unscaled by 100)

      const diff = price - marketPrice;
      if (Math.abs(diff) < tolerance) {
        return v;
      }

      if (Math.abs(vega) < 1e-7) {
        break; // Fallback to bisection
      }

      const nextV = v - diff / vega;
      if (nextV <= 0 || nextV > 5.0) {
        break; // Out of reasonable bounds, fallback to bisection
      }
      v = nextV;
    }

    // 2. Fallback to Bisection Search
    let low = 0.0001;
    let high = 5.0;
    let mid = 0.20;
    
    for (let i = 0; i < 50; i++) {
      mid = (low + high) / 2;
      const price = this.calculatePrice(S, K, T, r, mid, type).price;
      const diff = price - marketPrice;
      
      if (Math.abs(diff) < tolerance) {
        return mid;
      }
      
      if (diff > 0) {
        high = mid;
      } else {
        low = mid;
      }
    }

    return mid;
  }

  /**
   * Retrieves Option Greeks using Black-Scholes model
   */
  static calculateGreeks(
    S: number,
    K: number,
    T: number,
    r: number,
    v: number,
    type: 'CE' | 'PE'
  ): OptionGreeks {
    return this.calculatePrice(S, K, T, r, v, type).greeks;
  }

  /**
   * Utility to simulate a multi-leg strategy payoff
   */
  static calculateStrategyPayoff(
    S: number,
    legs: { type: 'CE' | 'PE', action: 'BUY' | 'SELL', K: number, quantity: number, iv?: number }[],
    T: number,
    r: number,
    v: number
  ): { totalValue: number, netGreeks: OptionGreeks } {
    let totalValue = 0;
    const netGreeks: OptionGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };

    legs.forEach(leg => {
      const legIV = leg.iv !== undefined ? leg.iv : v;
      const res = this.calculatePrice(S, leg.K, T, r, legIV, leg.type);
      const multiplier = leg.action === 'BUY' ? 1 : -1;
      const legValue = res.price * leg.quantity * multiplier;
      
      totalValue += legValue;
      netGreeks.delta += res.greeks.delta * leg.quantity * multiplier;
      netGreeks.gamma += res.greeks.gamma * leg.quantity * multiplier;
      netGreeks.theta += res.greeks.theta * leg.quantity * multiplier;
      netGreeks.vega += res.greeks.vega * leg.quantity * multiplier;
      netGreeks.rho += res.greeks.rho * leg.quantity * multiplier;
    });

    return { totalValue, netGreeks };
  }
}
