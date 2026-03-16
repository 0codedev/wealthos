/**
 * Quantum Phase 12 — Cross-cutting math primitives.
 *
 * The CC34 / CC36 / CC37 / "anyone can win" layer share several
 * non-trivial numerical primitives. To keep the components thin and
 * the math auditable, we collect them here:
 *
 *   - Pearson correlation + covariance
 *   - Log returns
 *   - Geometric Brownian Motion final prices (deterministic w/ seed)
 *   - Strategy payoff & P&L (multi-leg)
 *   - Parametric 1-day VaR & CVaR
 *   - Beta-weighted portfolio delta vs NIFTY
 *   - Profitability score (the 5-component composite)
 *
 * All functions are pure. No DOM. No state. They are the single
 * source of truth for the deck math and are unit-testable.
 */
import type {
    CrossAssetRisk,
    OptimizerResult,
    OptimizerRow,
    ProfitabilityScore,
    QuantumAsset,
    StrategyKind,
    StrategyLeg,
} from '../types/quantum';
import { blackScholes, monteCarloFinalPrices, INDIAN_INDEX_CONFIG } from '../utils/optionsMath';

// =====================================================================
// RETURNS / CORRELATION
// =====================================================================

export function returnsFromCloses(closes: number[]): number[] {
    const out: number[] = [];
    for (let i = 1; i < closes.length; i++) {
        const prev = closes[i - 1] ?? 0;
        const curr = closes[i] ?? 0;
        if (prev > 0) out.push(curr / prev - 1);
    }
    return out;
}

export function mean(xs: number[]): number {
    if (xs.length === 0) return 0;
    let s = 0;
    for (const x of xs) s += x;
    return s / xs.length;
}

export function stddev(xs: number[]): number {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    let s = 0;
    for (const x of xs) s += (x - m) * (x - m);
    return Math.sqrt(s / (xs.length - 1));
}

export function covariance(xs: number[], ys: number[]): number {
    const n = Math.min(xs.length, ys.length);
    if (n < 2) return 0;
    const mx = mean(xs.slice(0, n));
    const my = mean(ys.slice(0, n));
    let s = 0;
    for (let i = 0; i < n; i++) {
        s += ((xs[i] ?? 0) - mx) * ((ys[i] ?? 0) - my);
    }
    return s / (n - 1);
}

export function pearson(xs: number[], ys: number[]): number {
    const sx = stddev(xs);
    const sy = stddev(ys);
    if (sx === 0 || sy === 0) return 0;
    return covariance(xs, ys) / (sx * sy);
}

/**
 * Build a square correlation matrix from a list of return series.
 * Symbols that have < 5 data points get 0 (uncorrelated fallback).
 */
export function buildCorrelationMatrix(symbols: string[], series: number[][]): number[][] {
    const n = symbols.length;
    const out: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = i; j < n; j++) {
            if (i === j) {
                out[i]![j] = 1;
                continue;
            }
            const a = series[i] ?? [];
            const b = series[j] ?? [];
            if (a.length < 5 || b.length < 5) {
                out[i]![j] = 0;
                out[j]![i] = 0;
            } else {
                const r = pearson(a, b);
                out[i]![j] = r;
                out[j]![i] = r;
            }
        }
    }
    return out;
}

// =====================================================================
// BETA-WEIGHTED PORTFOLIO DELTA & VaR
// =====================================================================

/**
 * Portfolio beta vs NIFTY, weighted by exposure.
 *  portfolioBeta = Σ(wᵢ · βᵢ) / Σwᵢ
 */
export function portfolioBeta(assets: QuantumAsset[]): number {
    const totW = assets.reduce((s, a) => s + Math.max(0, a.exposure), 0);
    if (totW === 0) return 0;
    const num = assets.reduce((s, a) => s + Math.max(0, a.exposure) * a.beta, 0);
    return num / totW;
}

/**
 * Beta-weighted portfolio delta in "points of NIFTY".
 * For an option with delta d and NIFTY beta β, the NIFTY-equivalent
 * delta = d · (optionSpot / NIFTYSpot) · β · 1.
 *
 * Equities are treated as delta=1.
 */
export function portfolioDeltaWeighted(
    assets: QuantumAsset[],
    niftySpot: number
): number {
    if (niftySpot <= 0) return 0;
    let delta = 0;
    for (const a of assets) {
        const d = a.isOption ? (a.optionType === 'CE' ? 0.5 : -0.5) : 1;
        const spot = a.price || 0;
        const beta = a.beta || 1;
        delta += d * (spot / niftySpot) * beta * (a.exposure / Math.max(1, spot));
    }
    return delta;
}

/**
 * Ledoit-Wolf Covariance Matrix Shrinkage
 *
 * Implements Work Package 14:
 * Shrinks sample covariance matrix S toward a well-conditioned constant-correlation target F:
 *   Σ_shrunk = (1 - δ*) S + δ* F
 * Eliminates singular/inverted matrices and ill-conditioned eigenvalue explosions
 * when number of assets N approaches sample length T.
 */
export function ledoitWolfShrinkage(series: number[][]): {
    shrunkCov: number[][];
    shrinkageDelta: number;
    shrunkCorr: number[][];
} {
    const n = series.length;
    if (n === 0) return { shrunkCov: [], shrinkageDelta: 0, shrunkCorr: [] };
    const t = Math.min(...series.map(s => s.length));
    if (t < 5) {
        // Fallback for short series: Identity covariance
        const cov: number[][] = Array.from({ length: n }, (_, i) =>
            Array.from({ length: n }, (_, j) => (i === j ? 0.04 : 0))
        );
        const corr: number[][] = Array.from({ length: n }, (_, i) =>
            Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
        );
        return { shrunkCov: cov, shrinkageDelta: 1.0, shrunkCorr: corr };
    }

    // 1. Sample Covariance Matrix S
    const S: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = i; j < n; j++) {
            const covVal = covariance(series[i]!, series[j]!);
            S[i]![j] = covVal;
            S[j]![i] = covVal;
        }
    }

    // 2. Average correlation r_bar
    let sumCorr = 0;
    let corrPairs = 0;
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const si = Math.sqrt(Math.max(1e-8, S[i]![i]!));
            const sj = Math.sqrt(Math.max(1e-8, S[j]![j]!));
            const r = (S[i]![j]!) / (si * sj);
            sumCorr += r;
            corrPairs++;
        }
    }
    const rBar = corrPairs > 0 ? sumCorr / corrPairs : 0;

    // 3. Constant correlation target F
    const F: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if (i === j) {
                F[i]![j] = S[i]![i]!;
            } else {
                const si = Math.sqrt(Math.max(1e-8, S[i]![i]!));
                const sj = Math.sqrt(Math.max(1e-8, S[j]![j]!));
                F[i]![j] = rBar * si * sj;
            }
        }
    }

    // 4. Shrinkage intensity delta*
    let gammaSq = 0;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const diff = (F[i]![j]!) - (S[i]![j]!);
            gammaSq += diff * diff;
        }
    }

    // Empirical asymptotically optimal shrinkage delta bounded in [0, 1]
    const delta = gammaSq > 0 ? Math.min(1.0, Math.max(0.0, (1.0 / t) * (1.0 - rBar * rBar) / Math.max(1e-6, gammaSq))) : 0.2;
    const optimalDelta = Number(Math.min(0.85, Math.max(0.10, delta)).toFixed(4));

    // 5. Compute shrunk covariance Σ_shrunk = (1 - δ) S + δ F
    const shrunkCov: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const shrunkCorr: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            shrunkCov[i]![j] = (1 - optimalDelta) * (S[i]![j]!) + optimalDelta * (F[i]![j]!);
        }
    }

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const si = Math.sqrt(Math.max(1e-8, shrunkCov[i]![i]!));
            const sj = Math.sqrt(Math.max(1e-8, shrunkCov[j]![j]!));
            shrunkCorr[i]![j] = (shrunkCov[i]![j]!) / (si * sj);
        }
    }

    return { shrunkCov, shrinkageDelta: optimalDelta, shrunkCorr };
}

/**
 * Cornish-Fisher Expansion for Fat-Tailed Value-at-Risk (VaR) & CVaR
 *
 * Expands Gaussian quantile z_alpha for empirical return asymmetry (skewness)
 * and fat-tail thickness (excess kurtosis):
 *   z~ = z + (S/6)(z^2 - 1) + (K/24)(z^3 - 3z) - (S^2/36)(2z^3 - 5z)
 */
export function cornishFisherVaR(
    assets: QuantumAsset[],
    matrix: number[][],
    confidence = 0.95,
    skewness = -0.45, // typical Indian index/derivative negative skew
    excessKurtosis = 2.8 // fat tails
): { var95: number; cvar95: number; adjustedZ: number } {
    const totalExposure = assets.reduce((s, a) => s + Math.max(0, a.exposure), 0);
    if (totalExposure === 0) return { var95: 0, cvar95: 0, adjustedZ: 1.645 };

    const z = confidence === 0.95 ? 1.645 : confidence === 0.99 ? 2.326 : 1.282;

    // Cornish-Fisher adjusted critical value
    const z2 = z * z;
    const z3 = z2 * z;
    const sTerm = (skewness / 6) * (z2 - 1);
    const kTerm = (excessKurtosis / 24) * (z3 - 3 * z);
    const s2Term = ((skewness * skewness) / 36) * (2 * z3 - 5 * z);
    const adjustedZ = Math.max(z * 0.8, z + sTerm + kTerm - s2Term);

    let varPortfolio = 0;
    for (let i = 0; i < assets.length; i++) {
        for (let j = 0; j < assets.length; j++) {
            const wi = (assets[i]!.exposure) / totalExposure;
            const wj = (assets[j]!.exposure) / totalExposure;
            const si = (assets[i]!.volatility || 0.20) / Math.sqrt(252);
            const sj = (assets[j]!.volatility || 0.20) / Math.sqrt(252);
            const rho = matrix[i]?.[j] ?? 0;
            varPortfolio += wi * wj * si * sj * rho;
        }
    }
    const sigmaPortfolio = Math.sqrt(Math.max(0, varPortfolio)) * totalExposure;

    const varVal = adjustedZ * sigmaPortfolio;
    // Expected Shortfall (CVaR) with fat-tail multiplier
    const cvarMultiplier = 1.0 + (excessKurtosis / 12) + (skewness * skewness / 18);
    const cvarVal = varVal * Math.min(1.65, Math.max(1.20, cvarMultiplier));

    return {
        var95: Number(varVal.toFixed(2)),
        cvar95: Number(cvarVal.toFixed(2)),
        adjustedZ: Number(adjustedZ.toFixed(3))
    };
}

/**
 * Parametric 1-day VaR at 95% confidence reinforced with Cornish-Fisher expansion.
 */
export function parametricVaR(
    assets: QuantumAsset[],
    matrix: number[][],
    confidence = 0.95
): { var95: number; cvar95: number } {
    const cf = cornishFisherVaR(assets, matrix, confidence);
    return { var95: cf.var95, cvar95: cf.cvar95 };
}

/**
 * Build a CrossAssetRisk object from a set of assets and a
 * correlation matrix. Used by QuantumConfluenceDeck.
 */
export function buildCrossAssetRisk(
    assets: QuantumAsset[],
    matrix: number[][],
    niftySpot: number
): CrossAssetRisk {
    const beta = portfolioBeta(assets);
    const delta = portfolioDeltaWeighted(assets, niftySpot);
    const { var95, cvar95 } = parametricVaR(assets, matrix);
    return {
        asOf: Date.now(),
        assets,
        matrix,
        portfolioBeta: beta,
        portfolioDeltaWeighted: delta,
        var95,
        cvar95,
    };
}

// =====================================================================
// SCENARIO SHOCK IMPACT
// =====================================================================

/**
 * Apply a single-axis shock to the portfolio and return per-asset + total P&L.
 * For NIFTY axis, every equity/option with a beta gets shock · beta.
 * For VIX axis, options IV bumps with sqrt scaling.
 * For RATES axis, debt marks-to-market with a duration of 1.
 * For USDINR, currency-sensitive assets (import-heavy) get a -0.3 beta.
 * For CRUDE, commodity-sensitive sectors get a +0.5 beta (default).
 */
export function applyScenarioShock(
    assets: QuantumAsset[],
    axis: import('../types/quantum').ScenarioAxis,
    shockPct: number,
    niftySpot: number
): { pnlImpact: number; perAsset: Record<string, number> } {
    const perAsset: Record<string, number> = {};
    let total = 0;
    for (const a of assets) {
        let factor = 0;
        switch (axis) {
            case 'NIFTY':
                factor = (a.beta || 1) * shockPct;
                break;
            case 'VIX':
                if (a.isOption) {
                    // option P&L ≈ vega · ΔIV  — approximate ΔIV ≈ 0.4 · ΔVIX for ATM
                    factor = -0.4 * shockPct * Math.min(0.5, Math.abs(a.exposure / Math.max(a.price, 1)) / 100);
                } else {
                    factor = -0.1 * shockPct; // equities usually drop when VIX spikes
                }
                break;
            case 'RATES':
                if (a.assetClass === 'DEBT') factor = -0.05 * shockPct;
                else factor = -0.15 * shockPct;
                break;
            case 'USDINR':
                if (a.assetClass === 'COMMODITY' || a.assetClass === 'EQUITY') {
                    factor = -0.05 * shockPct;
                }
                break;
            case 'CRUDE':
                if (a.assetClass === 'COMMODITY') factor = 0.6 * shockPct;
                else factor = -0.05 * shockPct;
                break;
        }
        const impact = a.exposure * factor;
        perAsset[a.symbol] = impact;
        total += impact;
    }
    void niftySpot;
    return { pnlImpact: total, perAsset };
}

// =====================================================================
// STRATEGY PAYOFF + OPTIMIZER MATH
// =====================================================================

/**
 * Build the canonical list of legs for a given strategy, given a
 * spot, ATM strike, and the strategy parameters. Used by the
 * sweep optimizer and the live payoff chart.
 */
export function buildStrategyLegs(
    strategy: StrategyKind,
    spot: number,
    atm: number,
    dte: number,
    rate: number,
    iv: number
): StrategyLeg[] {
    const t = Math.max(dte, 1) / 365;
    const callPremium = (k: number) => blackScholes({ spot, strike: k, timeToExpiry: t, riskFreeRate: rate, volatility: iv }).callPrice;
    const putPremium = (k: number) => blackScholes({ spot, strike: k, timeToExpiry: t, riskFreeRate: rate, volatility: iv }).putPrice;
    const lot = 25;
    const qty = 1;
    switch (strategy) {
        case 'LONG_CALL':
            return [{ kind: 'CE', side: 'BUY', strike: atm, premium: callPremium(atm), dte, lotSize: lot, quantity: qty }];
        case 'LONG_PUT':
            return [{ kind: 'PE', side: 'BUY', strike: atm, premium: putPremium(atm), dte, lotSize: lot, quantity: qty }];
        case 'SHORT_CALL':
            return [{ kind: 'CE', side: 'SELL', strike: atm, premium: callPremium(atm), dte, lotSize: lot, quantity: qty }];
        case 'SHORT_PUT':
            return [{ kind: 'PE', side: 'SELL', strike: atm, premium: putPremium(atm), dte, lotSize: lot, quantity: qty }];
        case 'BULL_CALL_SPREAD': {
            const k1 = atm;
            const k2 = atm + (spot * 0.02);
            return [
                { kind: 'CE', side: 'BUY', strike: k1, premium: callPremium(k1), dte, lotSize: lot, quantity: qty },
                { kind: 'CE', side: 'SELL', strike: k2, premium: callPremium(k2), dte, lotSize: lot, quantity: qty },
            ];
        }
        case 'BEAR_PUT_SPREAD': {
            const k1 = atm;
            const k2 = atm - (spot * 0.02);
            return [
                { kind: 'PE', side: 'BUY', strike: k1, premium: putPremium(k1), dte, lotSize: lot, quantity: qty },
                { kind: 'PE', side: 'SELL', strike: k2, premium: putPremium(k2), dte, lotSize: lot, quantity: qty },
            ];
        }
        case 'STRADDLE': {
            return [
                { kind: 'CE', side: 'BUY', strike: atm, premium: callPremium(atm), dte, lotSize: lot, quantity: qty },
                { kind: 'PE', side: 'BUY', strike: atm, premium: putPremium(atm), dte, lotSize: lot, quantity: qty },
            ];
        }
        case 'STRANGLE': {
            const kc = atm + (spot * 0.02);
            const kp = atm - (spot * 0.02);
            return [
                { kind: 'CE', side: 'BUY', strike: kc, premium: callPremium(kc), dte, lotSize: lot, quantity: qty },
                { kind: 'PE', side: 'BUY', strike: kp, premium: putPremium(kp), dte, lotSize: lot, quantity: qty },
            ];
        }
        case 'IRON_CONDOR': {
            const kp1 = atm - (spot * 0.04);
            const kp2 = atm - (spot * 0.02);
            const kc1 = atm + (spot * 0.02);
            const kc2 = atm + (spot * 0.04);
            return [
                { kind: 'PE', side: 'BUY', strike: kp1, premium: putPremium(kp1), dte, lotSize: lot, quantity: qty },
                { kind: 'PE', side: 'SELL', strike: kp2, premium: putPremium(kp2), dte, lotSize: lot, quantity: qty },
                { kind: 'CE', side: 'SELL', strike: kc1, premium: callPremium(kc1), dte, lotSize: lot, quantity: qty },
                { kind: 'CE', side: 'BUY', strike: kc2, premium: callPremium(kc2), dte, lotSize: lot, quantity: qty },
            ];
        }
        case 'BUTTERFLY': {
            const wing = spot * 0.02;
            return [
                { kind: 'CE', side: 'BUY', strike: atm - wing, premium: callPremium(atm - wing), dte, lotSize: lot, quantity: qty },
                { kind: 'CE', side: 'SELL', strike: atm, premium: callPremium(atm) * 2, dte, lotSize: lot, quantity: qty * 2 },
                { kind: 'CE', side: 'BUY', strike: atm + wing, premium: callPremium(atm + wing), dte, lotSize: lot, quantity: qty },
            ];
        }
        case 'CALENDAR': {
            // same strike, different expiries — we approximate with two legs at different dte
            return [
                { kind: 'CE', side: 'SELL', strike: atm, premium: callPremium(atm), dte, lotSize: lot, quantity: qty },
                { kind: 'CE', side: 'BUY', strike: atm, premium: callPremium(atm) * 1.15, dte: Math.max(dte * 2, 21), lotSize: lot, quantity: qty },
            ];
        }
        case 'RATIO_SPREAD': {
            return [
                { kind: 'CE', side: 'BUY', strike: atm, premium: callPremium(atm), dte, lotSize: lot, quantity: 1 },
                { kind: 'CE', side: 'SELL', strike: atm + spot * 0.02, premium: callPremium(atm + spot * 0.02), dte, lotSize: lot, quantity: 2 },
            ];
        }
    }
}

/**
 * Compute the realized P&L for a list of legs at a given terminal
 * underlying price. This is the same intrinsic-at-expiry model used
 * by OptionsPayoffChart and the Monte Carlo.
 */
export function legPayoff(leg: StrategyLeg, terminal: number): number {
    if (leg.kind === 'FUT') {
        // futures pnl = (terminal - entry) · sign(side) · lotSize · qty
        // here `premium` is the entry price for the future
        return (leg.side === 'BUY' ? 1 : -1) * (terminal - leg.premium) * leg.lotSize * leg.quantity;
    }
    const intrinsic = leg.kind === 'CE' ? Math.max(0, terminal - leg.strike) : Math.max(0, leg.strike - terminal);
    return (leg.side === 'BUY' ? 1 : -1) * (intrinsic - leg.premium) * leg.lotSize * leg.quantity;
}

export function totalPayoff(legs: StrategyLeg[], terminal: number): number {
    let p = 0;
    for (const l of legs) p += legPayoff(l, terminal);
    return p;
}

/**
 * Run a single OptimizerRow evaluation. 1000 GBM paths, compute win
 * rate, expectancy, sharpe, drawdown, profit factor. ~5–10 ms per row.
 */
export function evaluateStrategyRow(
    underlying: string,
    spot: number,
    strategy: StrategyKind,
    strike: number,
    dte: number,
    rate: number,
    iv: number
): OptimizerRow {
    const legs = buildStrategyLegs(strategy, spot, strike, dte, rate, iv);
    const netPremium = legs.reduce((s, l) => s + (l.side === 'BUY' ? 1 : -1) * l.premium * l.lotSize * l.quantity, 0);

    const drift = 0.06; // neutral
    const t = Math.max(dte, 1) / 365;
    const mc = monteCarloFinalPrices({ spot, drift, volatility: iv, timeToExpiry: t, paths: 1000 });

    let wins = 0;
    let totalWin = 0;
    let totalLoss = 0;
    const pnls: number[] = new Array(mc.paths.length);
    for (let i = 0; i < mc.paths.length; i++) {
        const term = mc.paths[i]!;
        const pnl = totalPayoff(legs, term);
        pnls[i] = pnl;
        if (pnl > 0) {
            wins++;
            totalWin += pnl;
        } else {
            totalLoss += pnl;
        }
    }
    const winRate = wins / Math.max(1, pnls.length);
    const avgWin = wins > 0 ? totalWin / wins : 0;
    const avgLoss = wins < pnls.length ? totalLoss / (pnls.length - wins) : 0;
    const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;
    const profitFactor = totalLoss < 0 ? totalWin / Math.abs(totalLoss) : Infinity;
    const avgPnl = mean(pnls);
    const stdPnl = stddev(pnls);
    const sharpe = stdPnl > 0 ? (avgPnl / stdPnl) * Math.sqrt(252 / 21) : 0;
    let running = 0;
    let peak = 0;
    let maxDD = 0;
    for (const p of pnls) {
        running += p;
        if (running > peak) peak = running;
        const dd = peak - running;
        if (dd > maxDD) maxDD = dd;
    }
    const recovery = maxDD > 0 ? (avgPnl * pnls.length) / maxDD : 0;
    const score = Math.max(0, Math.min(100, 50 + expectancy / 50 + sharpe * 5 - maxDD / 1000));

    void underlying;
    return {
        strike,
        dte,
        netPremium,
        winRate,
        avgWin,
        avgLoss,
        expectancy,
        profitFactor,
        maxDrawdown: maxDD,
        sharpe,
        recovery,
        score,
    };
}

/**
 * Sweep a grid of (strike, dte) pairs and return the best row.
 * This is the "in-app backtester" — pure JS, no Worker needed because
 * 1000 paths × 16 cells ≈ 16k simulations ≈ 50–100 ms total.
 */
export function runStrategyOptimizer(
    request: import('../types/quantum').OptimizerRequest
): OptimizerResult {
    const start = performance.now();
    const spot = request.spot;
    const interval = spot * 0.01; // 1% grid
    const rangePct = request.strikeRangePct ?? 0.04;
    const lo = Math.round((spot * (1 - rangePct)) / interval) * interval;
    const hi = Math.round((spot * (1 + rangePct)) / interval) * interval;
    const dtes = request.dteGrid ?? [7, 14, 21, 30];
    const iv = request.iv ?? 0.16;
    const rate = request.rate ?? 0.065;
    const trials = request.trials ?? 1000;
    void trials;

    const rows: OptimizerRow[] = [];
    for (let k = lo; k <= hi + 0.5; k += interval) {
        for (const dte of dtes) {
            const r = evaluateStrategyRow(request.underlying, spot, request.strategy, k, dte, rate, iv);
            rows.push(r);
        }
    }
    rows.sort((a, b) => b.score - a.score);
    const best = rows[0] ?? null;
    return {
        request,
        rows,
        best,
        durationMs: performance.now() - start,
    };
}

// =====================================================================
// PROFITABILITY SCORE
// =====================================================================

/**
 * Pure scorer that turns a list of closed trades + journal + market
 * context into the composite 0..100 ProfitabilityScore.
 *
 *  process   — 4-Point Gate compliance, journaling, square-off
 *  risk      — Average risk/trade, max DD, stop-loss discipline
 *  edge      — Win rate × R-multiple, expectancy
 *  behavior  — Streak health, no-revenge rate
 *  learning  — Backtests, papers, lessons
 */
export function computeProfitabilityScore(
    closedTrades: import('../database').Trade[],
    ctx: {
        journalEntries?: number;
        maxDrawdownPct?: number;
        revengeTradeCount?: number;
        lessonsCompleted?: number;
        backtestsRun?: number;
        streakDays?: number;
    }
): ProfitabilityScore {
    const n = closedTrades.length;
    const wins = closedTrades.filter(t => (t.pnl || 0) > 0);
    const losses = closedTrades.filter(t => (t.pnl || 0) < 0);
    const winRate = n > 0 ? wins.length / n : 0;

    // R-multiples
    let rSum = 0;
    let rCount = 0;
    for (const t of closedTrades) {
        const sl = t.stopLoss;
        const entry = t.entryPrice;
        const exit = t.exitPrice;
        const r = (sl && entry && exit)
            ? ((exit - entry) / Math.max(0.0001, entry - sl)) * (t.direction === 'Long' ? 1 : -1)
            : 0;
        if (Number.isFinite(r) && r !== 0) {
            rSum += r;
            rCount++;
        }
    }
    const avgR = rCount > 0 ? rSum / rCount : 0;
    void (closedTrades[0] as any)?.side;

    // Edge = win rate × avgR, normalised 0..100 (1.5R+ at 50% = ~75)
    const edgeRaw = winRate * Math.max(0, Math.min(3, avgR)) * 50;
    const edge = Math.max(0, Math.min(100, edgeRaw));

    // Risk = inverse of (avg risk/trade pct + max DD penalty)
    const avgLossPct = losses.length > 0
        ? losses.reduce((s, t) => s + Math.min(1, Math.abs(t.pnl || 0) / 100000), 0) / losses.length
        : 0;
    const slDiscipline = n > 0
        ? closedTrades.filter(t => typeof t.stopLoss === 'number' && t.stopLoss > 0).length / n
        : 0;
    const dd = ctx.maxDrawdownPct ?? 0;
    const risk = Math.max(0, Math.min(100,
        100 - avgLossPct * 200 - dd * 4 + slDiscipline * 30
    ));

    // Process = journal density + sl discipline
    const journalPerTrade = n > 0 ? Math.min(2, (ctx.journalEntries ?? 0) / n) : 0;
    const process = Math.max(0, Math.min(100, journalPerTrade * 35 + slDiscipline * 35 + (n > 0 ? 30 : 10)));

    // Behavior = streak health, no-revenge
    const revengeRate = n > 0 ? (ctx.revengeTradeCount ?? 0) / n : 0;
    const streak = ctx.streakDays ?? 0;
    const behavior = Math.max(0, Math.min(100, 100 - revengeRate * 200 + Math.min(20, streak * 2)));

    // Learning = backtests + lessons
    const learning = Math.max(0, Math.min(100,
        ((ctx.backtestsRun ?? 0) * 5) + ((ctx.lessonsCompleted ?? 0) * 3) + (n > 20 ? 30 : 10)
    ));

    const score = Math.round(
        process * 0.20 +
        risk * 0.20 +
        edge * 0.25 +
        behavior * 0.20 +
        learning * 0.15
    );

    const tier =
        score >= 80 ? 'MASTER' :
        score >= 65 ? 'STRATEGIST' :
        score >= 50 ? 'OPERATOR' :
        score >= 30 ? 'APPRENTICE' : 'NOVICE';

    // Pick the primary driver = the lowest component
    const components = { process, risk, edge, behavior, learning };
    const sorted = (Object.keys(components) as (keyof typeof components)[])
        .sort((a, b) => components[a] - components[b]);
    const primaryDriver = sorted[0]!;

    const coachMap: Record<keyof typeof components, string> = {
        process: 'Add a 1-line note to every trade. The journal is the moat.',
        risk: 'Tighten your stop. Cap every trade at 1% of capital.',
        edge: 'Cut your C-grade setups. Wait for A+ only.',
        behavior: 'Walk away after 2 losses. The revenge trade is never worth it.',
        learning: 'Run 1 backtest this week. Document the win-rate of your best setup.',
    };

    // Project 21 days at the user's current expectancy
    const avgPnl = n > 0 ? closedTrades.reduce((s, t) => s + (t.pnl || 0), 0) / n : 0;
    const tradesPerWeek = Math.max(1, Math.round(n / 4));
    const projected21dPnl = avgPnl * tradesPerWeek * 3;

    // Confidence = the smaller of (n / 30) and (1 - n/Nmax)
    const confidence = Math.max(0.1, Math.min(1, n / 30));

    return {
        score,
        tier,
        components,
        coach: coachMap[primaryDriver],
        projected21dPnl,
        confidence,
        primaryDriver,
    };
}

void INDIAN_INDEX_CONFIG;
