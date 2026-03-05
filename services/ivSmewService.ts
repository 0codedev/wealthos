/**
 * IV Smile / Skew Service — CC29
 *
 * Pulls IV observations from a live OptionChainSnapshot, deduplicates
 * strikes (averaging CE/PE where both are present), and computes the
 * institutional skew metrics used by options desks:
 *
 *   - ATM IV        → at-the-money implied volatility
 *   - 25Δ Skew      → IV(25Δ put) − IV(25Δ call)  (in vol % points)
 *   - Risk Reversal → OTM Call IV − OTM Put IV     (directional skew)
 *   - Butterfly     → (OTM Call IV + OTM Put IV) / 2 − ATM IV (wing pricing)
 *   - Curvature     → second-difference of the smile around ATM
 *
 * Also provides natural-cubic-spline interpolation so the UI can render
 * a smooth smile curve from a sparse strike grid.
 */

import type { OptionChainSnapshot } from './OptionChainService';

// ============================================================
// TYPES
// ============================================================

export interface IVSmilePoint {
    strike: number;
    iv: number;             // % (matches NSE convention — e.g. 14.5 means 14.5%)
    type: 'CE' | 'PE';
    moneyness: number;      // strike / spot — 1.0 = ATM
    delta?: number;         // populated when CE/PE has a delta
}

export interface SkewMetrics {
    atmStrike: number;
    atmIV: number;          // % — average of CE & PE at the closest strike
    /** IV at the 25-delta put minus IV at the 25-delta call, in vol points. */
    skew25Delta: number;
    /** OTM Call IV − OTM Put IV (5 strikes OTM), in vol points. */
    riskReversal: number;
    /** (OTM Call IV + OTM Put IV) / 2 − ATM IV (wing premium), in vol points. */
    butterfly: number;
    /** d²IV / dK² evaluated at ATM (smile convexity). */
    curvature: number;
    /** OTM strikes used in the RR/BF calculation, useful for UI labels. */
    otmCallStrike: number;
    otmPutStrike: number;
}

export interface CubicSpline {
    xs: number[];
    ys: number[];
    /** Second-derivative coefficients (M array) for natural-cubic-spline. */
    m: number[];
    /** Evaluate the spline at x. */
    evaluate(x: number): number;
}

// ============================================================
// IV SMILE
// ============================================================

/**
 * Extract the IV smile from an option chain. Deduplicates strikes by
 * averaging CE and PE when both are present, then returns the unique
 * strikes sorted ascending. The `type` field is the dominant side —
 * 'CE' for strikes ≥ ATM and 'PE' for strikes < ATM (otherwise the
 * first non-null type wins).
 */
export function computeIVSmile(
    chain: OptionChainSnapshot,
    spot: number
): IVSmilePoint[] {
    if (!chain?.strikes?.length || spot <= 0) return [];

    const merged = new Map<number, { iv: number; type: 'CE' | 'PE'; delta?: number }>();

    for (const row of chain.strikes) {
        const ce = row.CE;
        const pe = row.PE;

        // Case 1: Both CE and PE have IV → average
        if (ce && ce.iv > 0 && pe && pe.iv > 0) {
            const avg = (ce.iv + pe.iv) / 2;
            // Use the side closest to being ATM (delta ≈ 0.5 or -0.5)
            const ceDelta = Math.abs(Math.abs(ce.delta ?? 0.5) - 0.5);
            const peDelta = Math.abs(Math.abs(pe.delta ?? -0.5) - 0.5);
            const dominantType: 'CE' | 'PE' = ceDelta <= peDelta ? 'CE' : 'PE';
            const dominantDelta = dominantType === 'CE' ? ce.delta : pe.delta;
            merged.set(row.strikePrice, { iv: avg, type: dominantType, delta: dominantDelta });
        } else if (ce && ce.iv > 0) {
            merged.set(row.strikePrice, { iv: ce.iv, type: 'CE', delta: ce.delta });
        } else if (pe && pe.iv > 0) {
            merged.set(row.strikePrice, { iv: pe.iv, type: 'PE', delta: pe.delta });
        }
    }

    const points: IVSmilePoint[] = [];
    for (const [strike, entry] of merged.entries()) {
        points.push({
            strike,
            iv: entry.iv,
            type: entry.type,
            moneyness: strike / spot,
            delta: entry.delta
        });
    }
    points.sort((a, b) => a.strike - b.strike);
    return points;
}

/**
 * Find the strike closest to the spot price.
 */
export function findATMStrike(chain: OptionChainSnapshot, spot: number): number {
    if (!chain?.strikes?.length || spot <= 0) return 0;
    let best = chain.strikes[0]?.strikePrice ?? 0;
    let bestDiff = Math.abs(best - spot);
    for (const row of chain.strikes) {
        const diff = Math.abs(row.strikePrice - spot);
        if (diff < bestDiff) {
            best = row.strikePrice;
            bestDiff = diff;
        }
    }
    return best;
}

// ============================================================
// SKEW METRICS
// ============================================================

/**
 * Compute the standard institutional skew metrics from an IV smile.
 *
 *   - 25Δ Skew: we approximate the 25Δ strikes using delta on each side.
 *     If the chain doesn't carry a clean 25Δ contract we fall back to
 *     a delta-weighted interpolation between the closest CE/PE strikes.
 *   - Risk Reversal (RR): 5-strike-OTM Call IV minus Put IV.
 *   - Butterfly (BF): wing premium relative to ATM.
 *   - Curvature: discrete second derivative of IV at ATM.
 */
export function computeSkewMetrics(
    chain: OptionChainSnapshot,
    spot: number
): SkewMetrics {
    const empty: SkewMetrics = {
        atmStrike: 0,
        atmIV: 0,
        skew25Delta: 0,
        riskReversal: 0,
        butterfly: 0,
        curvature: 0,
        otmCallStrike: 0,
        otmPutStrike: 0
    };

    if (!chain?.strikes?.length || spot <= 0) return empty;

    const atmStrike = findATMStrike(chain, spot);
    if (!atmStrike) return empty;

    // Average CE/PE IV at ATM
    const atmRow = chain.strikes.find(r => r.strikePrice === atmStrike);
    const atmCallIV = atmRow?.CE?.iv ?? 0;
    const atmPutIV = atmRow?.PE?.iv ?? 0;
    const atmIV = (atmCallIV + atmPutIV) / 2 || atmCallIV || atmPutIV;

    // Determine the strike interval for OTM fallback
    const interval = atmRow
        ? Math.max(1, Math.abs(atmRow.strikePrice - (chain.strikes.find(r => r.strikePrice > atmStrike)?.strikePrice ?? atmStrike + 50)))
        : 50;

    const findStrikeByDelta = (targetDelta: number, side: 'CE' | 'PE'): { strike: number; iv: number } => {
        let bestStrike = 0;
        let bestIV = 0;
        let bestDiff = Infinity;
        for (const row of chain.strikes) {
            const c = side === 'CE' ? row.CE : row.PE;
            if (!c || c.iv <= 0) continue;
            const d = c.delta ?? (side === 'CE' ? 0.5 : -0.5);
            const diff = Math.abs(Math.abs(d) - Math.abs(targetDelta));
            if (diff < bestDiff) {
                bestDiff = diff;
                bestStrike = row.strikePrice;
                bestIV = c.iv;
            }
        }
        return { strike: bestStrike, iv: bestIV };
    };

    const put25 = findStrikeByDelta(0.25, 'PE');
    const call25 = findStrikeByDelta(0.25, 'CE');

    // If delta-based lookup failed, fall back to OTM-by-strikes
    let put25IV = put25.iv;
    let call25IV = call25.iv;

    if (put25IV === 0 || call25IV === 0) {
        // Find strikes ~ 2 intervals OTM
        const otmPutStrike = atmStrike - 2 * interval;
        const otmCallStrike = atmStrike + 2 * interval;
        const putRow = chain.strikes.find(r => r.strikePrice === otmPutStrike);
        const callRow = chain.strikes.find(r => r.strikePrice === otmCallStrike);
        put25IV = putRow?.PE?.iv ?? 0;
        call25IV = callRow?.CE?.iv ?? 0;
    }

    // OTM-by-5-strikes for RR/BF
    const otmOffset = 5 * interval;
    const otmPutStrike = atmStrike - otmOffset;
    const otmCallStrike = atmStrike + otmOffset;
    const otmPutRow = chain.strikes.find(r => r.strikePrice === otmPutStrike);
    const otmCallRow = chain.strikes.find(r => r.strikePrice === otmCallStrike);
    const otmPutIV = otmPutRow?.PE?.iv ?? 0;
    const otmCallIV = otmCallRow?.CE?.iv ?? 0;

    // Curvature: 2nd-difference at ATM (smile convexity)
    let curvature = 0;
    if (atmCallIV > 0 && atmPutIV > 0) {
        const left = chain.strikes.find(r => r.strikePrice === atmStrike - interval);
        const right = chain.strikes.find(r => r.strikePrice === atmStrike + interval);
        if (left && right) {
            const leftIV = ((left.CE?.iv ?? 0) + (left.PE?.iv ?? 0)) / 2;
            const rightIV = ((right.CE?.iv ?? 0) + (right.PE?.iv ?? 0)) / 2;
            if (leftIV > 0 && rightIV > 0) {
                curvature = (leftIV - 2 * atmIV + rightIV) / Math.max(1, interval * interval);
            }
        }
    }

    return {
        atmStrike,
        atmIV,
        skew25Delta: put25IV > 0 && call25IV > 0 ? put25IV - call25IV : 0,
        riskReversal: otmCallIV > 0 && otmPutIV > 0 ? otmCallIV - otmPutIV : 0,
        butterfly: (otmCallIV > 0 && otmPutIV > 0 && atmIV > 0)
            ? (otmCallIV + otmPutIV) / 2 - atmIV
            : 0,
        curvature,
        otmCallStrike,
        otmPutStrike
    };
}

// ============================================================
// CUBIC SPLINE INTERPOLATION
// ============================================================

/**
 * Build a natural-cubic-spline through the given (x, y) points.
 * Boundary conditions: second derivative = 0 at both ends.
 * Throws if fewer than 2 points are provided.
 */
export function cubicInterpolate(points: { x: number; y: number }[]): CubicSpline {
    if (points.length < 2) {
        throw new Error('cubicInterpolate requires at least 2 points');
    }

    const sorted = [...points].sort((a, b) => a.x - b.x);
    const n = sorted.length;
    const xs = sorted.map(p => p.x);
    const ys = sorted.map(p => p.y);

    // Solve for second derivatives M via the tridiagonal system.
    // Natural boundary: M[0] = M[n-1] = 0.
    const h = new Array(n - 1);
    const alpha = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
        h[i] = xs[i + 1] - xs[i];
    }
    for (let i = 1; i < n - 1; i++) {
        alpha[i] = (3 / h[i]) * (ys[i + 1] - ys[i]) - (3 / h[i - 1]) * (ys[i] - ys[i - 1]);
    }

    const l = new Array(n);
    const mu = new Array(n);
    const z = new Array(n);
    l[0] = 1;
    for (let i = 1; i < n - 1; i++) {
        l[i] = 2 * (xs[i + 1] - xs[i - 1]) - h[i - 1] * mu[i - 1];
        mu[i] = h[i] / l[i];
        z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
    }
    l[n - 1] = 1;

    const m = new Array(n).fill(0);
    const c = new Array(n).fill(0);
    const b = new Array(n - 1).fill(0);
    const d = new Array(n - 1).fill(0);

    for (let j = n - 2; j >= 0; j--) {
        m[j] = z[j] - mu[j] * m[j + 1];
        c[j] = (ys[j + 1] - ys[j]) / h[j] - h[j] * (m[j + 1] + 2 * m[j]) / 3;
        d[j] = (m[j + 1] - m[j]) / (3 * h[j]);
        b[j] = (ys[j + 1] - ys[j]) / h[j] - h[j] * (m[j + 1] + 2 * m[j]) / 3;
    }

    const spline: CubicSpline = {
        xs,
        ys,
        m,
        evaluate(x: number): number {
            // Find interval [xs[i], xs[i+1]] containing x via binary search
            let lo = 0;
            let hi = n - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (xs[mid] > x) hi = mid; else lo = mid;
            }
            const hx = x - xs[lo];
            return ys[lo] + b[lo] * hx + c[lo] * hx * hx + d[lo] * hx * hx * hx;
        }
    };
    return spline;
}
