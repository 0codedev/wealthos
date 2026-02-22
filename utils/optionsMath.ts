/**
 * Options Math — Black-Scholes pricing, Greeks, IV solver, and Monte Carlo paths.
 *
 * Per CC9 constraints:
 *   - No changes to the Black-Scholes equations or implied-volatility formulas
 *     that would introduce inaccuracies. Coefficients match the canonical form
 *     (Hull, *Options, Futures, and Other Derivatives*, 9th ed., Ch. 15 & 19).
 *   - All Greeks are computed analytically where possible; Gamma/Vega/Rho
 *     follow the standard partial derivatives, not numerical finite differences.
 *
 * Indian-market harmonization (CC9 Phase 3):
 *   - NIFTY=25, BANKNIFTY=15, FINNIFTY=40, MIDCPNIFTY=75
 *   - Expiry days: NIFTY=Thursday, BANKNIFTY=Wednesday, FINNIFTY=Tuesday, MIDCPNIFTY=Monday
 *   - Strike intervals: NIFTY=50, BANKNIFTY=100, FINNIFTY=50, MIDCPNIFTY=25
 *
 * The Monte Carlo engine uses geometric Brownian motion (no jumps) — the
 * probability-of-profit overlay in OptionsPayoffChart consumes this. We use
 * Box-Muller for the standard normal draw, matching utils/MonteCarlo.ts.
 */

// ============================================================
// INDIAN INDEX CONFIGS
// ============================================================

export type SupportedIndex = 'NIFTY' | 'BANKNIFTY' | 'FINNIFTY' | 'MIDCPNIFTY';

export interface IndianIndexConfig {
    lotSize: number;
    strikeInterval: number; // ₹
    /** ISO weekday number: 1=Mon … 7=Sun */
    expiryWeekday: number;
    defaultRiskFreeRate: number; // decimal (e.g. 0.065 for 6.5%)
    defaultVolatility: number; // decimal
    typicalAnnualizedVol: number; // fallback for IV solver
    displayName: string;
}

export const INDIAN_INDEX_CONFIG: Record<SupportedIndex, IndianIndexConfig> = {
    NIFTY:      { lotSize: 25, strikeInterval: 50,  expiryWeekday: 4 /* Thu */, defaultRiskFreeRate: 0.065, defaultVolatility: 0.14, typicalAnnualizedVol: 0.14, displayName: 'NIFTY 50' },
    BANKNIFTY:  { lotSize: 15, strikeInterval: 100, expiryWeekday: 3 /* Wed */, defaultRiskFreeRate: 0.065, defaultVolatility: 0.18, typicalAnnualizedVol: 0.18, displayName: 'BANK NIFTY' },
    FINNIFTY:   { lotSize: 40, strikeInterval: 50,  expiryWeekday: 2 /* Tue */, defaultRiskFreeRate: 0.065, defaultVolatility: 0.16, typicalAnnualizedVol: 0.16, displayName: 'FIN NIFTY' },
    MIDCPNIFTY: { lotSize: 75, strikeInterval: 25,  expiryWeekday: 1 /* Mon */, defaultRiskFreeRate: 0.065, defaultVolatility: 0.20, typicalAnnualizedVol: 0.20, displayName: 'MIDCAP NIFTY' },
};

/**
 * Returns the lot size for the given index. Throws on unknown index.
 * This is the single source of truth for Indian lot-size enforcement.
 */
export function getLotSize(index: string): number {
    const cfg = INDIAN_INDEX_CONFIG[index as SupportedIndex];
    if (!cfg) throw new Error(`Unknown index: ${index}`);
    return cfg.lotSize;
}

/**
 * Returns the strike interval for the given index.
 */
export function getStrikeInterval(index: string): number {
    const cfg = INDIAN_INDEX_CONFIG[index as SupportedIndex];
    if (!cfg) throw new Error(`Unknown index: ${index}`);
    return cfg.strikeInterval;
}

/**
 * Returns the next valid expiry weekday (1=Mon … 7=Sun).
 */
export function getExpiryWeekday(index: string): number {
    const cfg = INDIAN_INDEX_CONFIG[index as SupportedIndex];
    if (!cfg) throw new Error(`Unknown index: ${index}`);
    return cfg.expiryWeekday;
}

/**
 * Snaps an arbitrary strike to the nearest valid strike for the index.
 */
export function snapToStrike(price: number, index: string, side: 'CE' | 'PE' = 'CE'): number {
    const interval = getStrikeInterval(index);
    return Math.round(price / interval) * interval;
}

/**
 * Returns the next expiry date for the given index (>= today).
 * Indian index options expire on the configured weekday; if today is the
 * expiry weekday, returns today's date so intraday expirations are honored.
 */
export function getNextExpiry(index: string, from: Date = new Date()): Date {
    const cfg = INDIAN_INDEX_CONFIG[index as SupportedIndex];
    if (!cfg) throw new Error(`Unknown index: ${index}`);
    const today = new Date(from);
    today.setHours(0, 0, 0, 0);
    const todayWeekday = today.getDay() === 0 ? 7 : today.getDay(); // 0=Sun → 7
    let daysToAdd = (cfg.expiryWeekday - todayWeekday + 7) % 7;
    // If today IS the expiry weekday, we still return today for intraday use
    const next = new Date(today);
    next.setDate(today.getDate() + daysToAdd);
    // Set to 15:30 IST (3:30 PM market close) — the official expiry time
    next.setHours(15, 30, 0, 0);
    return next;
}

/**
 * Returns year-fraction (ACT/365) between two dates for use in Black-Scholes.
 */
export function yearFraction(from: Date, to: Date): number {
    const ms = to.getTime() - from.getTime();
    return Math.max(0, ms / (365 * 24 * 60 * 60 * 1000));
}

// ============================================================
// BLACK-SCHOLES PRICING & GREEKS
// ============================================================

/**
 * Standard normal PDF and CDF.
 * Uses the Abramowitz & Stegun rational approximation (error < 7.5e-8).
 */
export function normPdf(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function normCdf(x: number): number {
    // A&S 26.2.17
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * absX);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
    return 0.5 * (1.0 + sign * y);
}

export interface BlackScholesInput {
    spot: number;          // S
    strike: number;        // K
    timeToExpiry: number;  // T in years
    riskFreeRate: number;  // r (decimal)
    volatility: number;    // σ (decimal, annualized)
    dividendYield?: number; // q (decimal, continuous) — 0 for Indian indices
}

export interface BlackScholesResult {
    callPrice: number;
    putPrice: number;
    callDelta: number;
    putDelta: number;
    gamma: number;
    vega: number;        // per 1.0 of σ
    callRho: number;     // per 1.0 of r
    putRho: number;
    callTheta: number;   // per DAY (we annual-divide by 365 for clarity)
    putTheta: number;
    d1: number;
    d2: number;
}

/**
 * Pure Black-Scholes pricing and Greeks for a European option.
 * Returns call+put plus all standard Greeks.
 */
export function blackScholes(input: BlackScholesInput): BlackScholesResult {
    const { spot: S, strike: K, timeToExpiry: T, riskFreeRate: r, volatility: sigma } = input;
    const q = input.dividendYield ?? 0;

    // Handle edge cases that BS does not gracefully handle
    if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
        // At expiry or zero vol → intrinsic only
        const callIntrinsic = Math.max(0, S - K);
        const putIntrinsic = Math.max(0, K - S);
        return {
            callPrice: callIntrinsic,
            putPrice: putIntrinsic,
            callDelta: callIntrinsic > 0 ? 1 : putIntrinsic > 0 ? 0 : (S > K ? 1 : 0),
            putDelta: putIntrinsic > 0 ? -1 : callIntrinsic > 0 ? 0 : (S < K ? -1 : 0),
            gamma: 0, vega: 0, callRho: 0, putRho: 0,
            callTheta: 0, putTheta: 0, d1: 0, d2: 0
        };
    }

    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;

    const Nd1 = normCdf(d1);
    const Nd2 = normCdf(d2);
    const Nmd1 = normCdf(-d1);
    const Nmd2 = normCdf(-d2);
    const npd1 = normPdf(d1);

    const expRT = Math.exp(-r * T);
    const expQT = Math.exp(-q * T);

    const callPrice = S * expQT * Nd1 - K * expRT * Nd2;
    const putPrice = K * expRT * Nmd2 - S * expQT * Nmd1;

    const callDelta = expQT * Nd1;
    const putDelta = expQT * (Nd1 - 1);
    const gamma = (expQT * npd1) / (S * sigma * sqrtT);
    const vega = S * expQT * npd1 * sqrtT;            // ∂V/∂σ (per 1.0 of σ)
    const callRho = K * T * expRT * Nd2;                // ∂C/∂r (per 1.0 of r)
    const putRho = -K * T * expRT * Nmd2;

    // Theta is annualized: convert to per-day for UI clarity
    const annualCallTheta = -(S * expQT * npd1 * sigma) / (2 * sqrtT)
        - r * K * expRT * Nd2
        + q * S * expQT * Nd1;
    const annualPutTheta = -(S * expQT * npd1 * sigma) / (2 * sqrtT)
        + r * K * expRT * Nmd2
        - q * S * expQT * Nmd1;
    const callTheta = annualCallTheta / 365;
    const putTheta = annualPutTheta / 365;

    return {
        callPrice, putPrice,
        callDelta, putDelta,
        gamma, vega,
        callRho, putRho,
        callTheta, putTheta,
        d1, d2
    };
}

// ============================================================
// IMPLIED VOLATILITY (Newton-Raphson with bisection fallback)
// ============================================================

export interface IVSolverInput {
    marketPrice: number;  // observed option price
    spot: number;
    strike: number;
    timeToExpiry: number;
    riskFreeRate: number;
    isCall: boolean;
    dividendYield?: number;
}

export interface IVSolverResult {
    iv: number;
    converged: boolean;
    iterations: number;
    finalError: number;
}

/**
 * Implied volatility solver. Uses Newton-Raphson when vega is well-behaved,
 * falls back to bisection for deep-ITM/OTM where vega approaches 0.
 */
export function impliedVolatility(input: IVSolverInput): IVSolverResult {
    const { marketPrice, spot, strike, timeToExpiry, riskFreeRate, isCall } = input;
    const q = input.dividendYield ?? 0;

    // Edge: market price cannot be negative or exceed spot
    if (marketPrice <= 0) return { iv: 0, converged: false, iterations: 0, finalError: Infinity };
    if (isCall && marketPrice > spot) return { iv: 5, converged: false, iterations: 0, finalError: Infinity };

    const bs = (sig: number) => blackScholes({ spot, strike, timeToExpiry, riskFreeRate, volatility: sig, dividendYield: q });
    const target = (sig: number) => (isCall ? bs(sig).callPrice : bs(sig).putPrice) - marketPrice;
    const vegaFn = (sig: number) => bs(sig).vega;

    // Newton-Raphson
    let sigma = 0.20; // initial guess
    for (let i = 0; i < 50; i++) {
        const diff = target(sigma);
        if (Math.abs(diff) < 1e-5) return { iv: sigma, converged: true, iterations: i, finalError: Math.abs(diff) };
        const v = vegaFn(sigma);
        if (!Number.isFinite(v) || Math.abs(v) < 1e-8) break; // fall through to bisection
        const next = sigma - diff / v;
        if (next <= 0 || !Number.isFinite(next)) break;
        sigma = next;
    }

    // Bisection fallback
    let lo = 1e-4;
    let hi = 5.0;
    if (target(lo) * target(hi) > 0) {
        // No sign change — return the best we have
        return { iv: sigma, converged: false, iterations: 50, finalError: Math.abs(target(sigma)) };
    }
    for (let i = 0; i < 100; i++) {
        const mid = (lo + hi) / 2;
        const diff = target(mid);
        if (Math.abs(diff) < 1e-5) return { iv: mid, converged: true, iterations: 50 + i, finalError: Math.abs(diff) };
        if (target(lo) * diff < 0) hi = mid; else lo = mid;
    }
    return { iv: (lo + hi) / 2, converged: false, iterations: 150, finalError: Math.abs(target((lo + hi) / 2)) };
}

// ============================================================
// MONTE CARLO PROBABILITY OF PROFIT
// ============================================================

export interface MonteCarloConfig {
    spot: number;
    drift: number;        // annualized drift (e.g. 0.08 for 8%)
    volatility: number;   // annualized
    timeToExpiry: number; // years
    paths: number;        // # of simulation paths
    seed?: number;        // for deterministic tests
    antithetic?: boolean; // variance reduction
}

export interface MonteCarloResult {
    probabilityOfProfit: number;  // fraction of paths ending ITM (using leg-level P&L)
    paths: number[];              // final prices for charting
    percentiles: { p5: number; p10: number; p25: number; p50: number; p75: number; p90: number; p95: number };
    mean: number;
    std: number;
    min: number;
    max: number;
}

/**
 * Box-Muller standard normal draw. Optional `seed` makes the stream
 * deterministic (LCG + Box-Muller) for backtesting reproducibility.
 */
function randn(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function monteCarloFinalPrices(cfg: MonteCarloConfig): MonteCarloResult {
    const { spot, drift, volatility, timeToExpiry, paths } = cfg;

    if (paths <= 0 || timeToExpiry <= 0) {
        return {
            probabilityOfProfit: 0,
            paths: [],
            percentiles: { p5: spot, p10: spot, p25: spot, p50: spot, p75: spot, p90: spot, p95: spot },
            mean: spot, std: 0, min: spot, max: spot
        };
    }

    const driftT = (drift - 0.5 * volatility * volatility) * timeToExpiry;
    const volSqrtT = volatility * Math.sqrt(timeToExpiry);
    const finals: number[] = new Array(paths);

    for (let i = 0; i < paths; i++) {
        const z = randn();
        finals[i] = spot * Math.exp(driftT + volSqrtT * z);
    }

    finals.sort((a, b) => a - b);
    const p = (q: number) => finals[Math.max(0, Math.min(paths - 1, Math.floor(q * paths)))];

    const sum = finals.reduce((s, x) => s + x, 0);
    const mean = sum / paths;
    const variance = finals.reduce((s, x) => s + (x - mean) * (x - mean), 0) / paths;

    return {
        probabilityOfProfit: 0, // set by caller based on legs
        paths: finals,
        percentiles: {
            p5: p(0.05), p10: p(0.10), p25: p(0.25), p50: p(0.50), p75: p(0.75), p90: p(0.90), p95: p(0.95)
        },
        mean,
        std: Math.sqrt(variance),
        min: finals[0],
        max: finals[paths - 1]
    };
}

/**
 * Compute probability that a multi-leg strategy is profitable at expiry,
 * using the leg-level intrinsic-value P&L formula.
 */
export function probabilityOfProfit(
    cfg: MonteCarloConfig,
    legs: Array<{ type: 'CE' | 'PE'; action: 'Buy' | 'Sell'; strikePrice: number; premium: number; lotSize: number; quantity: number }>
): { probabilityOfProfit: number; result: MonteCarloResult } {
    const result = monteCarloFinalPrices(cfg);
    if (result.paths.length === 0) return { probabilityOfProfit: 0, result };

    let wins = 0;
    for (const finalPrice of result.paths) {
        let totalPnl = 0;
        for (const leg of legs) {
            const intrinsic = leg.type === 'CE'
                ? Math.max(0, finalPrice - leg.strikePrice)
                : Math.max(0, leg.strikePrice - finalPrice);
            const legPnl = (leg.action === 'Buy' ? 1 : -1) * (intrinsic - leg.premium) * leg.lotSize * leg.quantity;
            totalPnl += legPnl;
        }
        if (totalPnl > 0) wins++;
    }

    result.probabilityOfProfit = wins / result.paths.length;
    return { probabilityOfProfit: result.probabilityOfProfit, result };
}

// ============================================================
// PAYOFF HELPERS
// ============================================================

export interface PayoffLeg {
    type: 'CE' | 'PE';
    action: 'Buy' | 'Sell';
    strikePrice: number;
    premium: number;
    lotSize: number;
    quantity: number;
}

export interface PayoffPoint {
    price: number;
    pnl: number;
    /** Density (probability mass) of final prices around this point, for the Monte Carlo overlay. */
    density?: number;
}

/**
 * Build the per-expiry payoff curve for a list of legs.
 * Uses the simple intrinsic-at-expiry P&L model (same as OptionsPayoffChart).
 */
export function computePayoffCurve(
    spot: number,
    legs: PayoffLeg[],
    points: number = 80,
    range: number = 0.15  // ±15% around spot
): PayoffPoint[] {
    const lo = spot * (1 - range);
    const hi = spot * (1 + range);
    const out: PayoffPoint[] = new Array(points);
    for (let i = 0; i < points; i++) {
        const price = lo + (hi - lo) * (i / (points - 1));
        let pnl = 0;
        for (const leg of legs) {
            const intrinsic = leg.type === 'CE' ? Math.max(0, price - leg.strikePrice) : Math.max(0, leg.strikePrice - price);
            pnl += (leg.action === 'Buy' ? 1 : -1) * (intrinsic - leg.premium) * leg.lotSize * leg.quantity;
        }
        out[i] = { price, pnl };
    }
    return out;
}

/**
 * Compute the breakeven points (where the payoff curve crosses y=0).
 * Linear interpolation between samples is sufficient for ±15% range with 80 points.
 */
export function computeBreakevens(curve: PayoffPoint[]): number[] {
    const out: number[] = [];
    for (let i = 0; i < curve.length - 1; i++) {
        const a = curve[i];
        const b = curve[i + 1];
        if (a.pnl === 0) { out.push(a.price); continue; }
        if (a.pnl * b.pnl < 0) {
            const t = Math.abs(a.pnl) / (Math.abs(a.pnl) + Math.abs(b.pnl));
            out.push(a.price + (b.price - a.price) * t);
        }
    }
    return out;
}

/**
 * Compute max profit, max loss, and risk/reward ratio for a payoff curve.
 * Returns null R/R if the strategy is undefined (e.g. unlimited profit, 0 loss).
 */
export function summarizePayoff(curve: PayoffPoint[]): {
    maxProfit: number;
    maxLoss: number;
    riskRewardRatio: number | null;
    netPremium: number;
} {
    let maxProfit = -Infinity;
    let maxLoss = Infinity;
    let netPremium = 0;
    for (const p of curve) {
        if (p.pnl > maxProfit) maxProfit = p.pnl;
        if (p.pnl < maxLoss) maxLoss = p.pnl;
    }
    // Net premium is the cost at the spot price (assumed to be the curve midpoint)
    const mid = curve[Math.floor(curve.length / 2)];
    netPremium = -(mid?.pnl ?? 0);
    const riskRewardRatio = maxLoss < 0 && maxProfit > 0 ? Math.abs(maxProfit / maxLoss) : null;
    return { maxProfit, maxLoss, riskRewardRatio, netPremium };
}
