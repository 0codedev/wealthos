/**
 * Delta Hedging Engine — CC29
 *
 * Converts a portfolio's net delta into a futures hedge using the
 * Indian lot-size discipline from utils/optionsMath. The engine also
 * simulates the hedged-vs-unhedged P&L across a ±15% spot move and
 * suggests a strategy (futures / butterfly / vertical spread) based on
 * the joint magnitude of delta and gamma.
 *
 * Inputs intentionally mirror PortfolioGreeks so the UI can wire the
 * existing service in without an adapter layer.
 */

import { getLotSize } from '../utils/optionsMath';

// ============================================================
// TYPES
// ============================================================

export interface HedgeResult {
    futuresContracts: number;   // signed: + = BUY, − = SELL
    hedgeQty: number;          // futuresContracts * lotSize
    residualDelta: number;     // netDelta after hedge (≈ 0)
    side: 'BUY' | 'SELL';
    notional: number;          // hedgeQty * spot — absolute rupee exposure
    lotSize: number;
    indexName: string;
    costApprox: number;        // margin × contracts (₹) — naive estimate
}

export interface PayoffPoint {
    spotMove: number;   // 0.00 = at current spot, 0.05 = +5%
    spot: number;
    pnlUnhedged: number;
    pnlHedged: number;
}

export interface HedgeStrategy {
    name: 'FUTURES' | 'BUTTERFLY' | 'VERTICAL_SPREAD' | 'NO_HEDGE' | 'STRADDLE';
    rationale: string;
    priority: number;   // higher = stronger recommendation
}

export interface PositionGreeks {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    quantity?: number;  // signed qty — used for residual aggregation
}

// ============================================================
// FUTURES HEDGE
// ============================================================

/**
 * Convert a net delta into a futures hedge.
 *
 *   hedgeQty = round(netDelta / lotSize) * lotSize
 *   side     = SELL futures when netDelta is positive (long stock equivalent
 *              in an options-only book needs to be sold), and BUY when negative.
 *   residual = whatever didn't divide cleanly into whole lots.
 *
 * `indexName` MUST be one of the supported Indian indices or getLotSize
 * will throw — we catch that and fall back to NIFTY's lot size to keep
 * the UI from crashing on non-F&O underlyings.
 */
export function computeHedge(
    netDelta: number,
    spot: number,
    indexName: string,
    lotOverride?: number
): HedgeResult {
    let lotSize: number;
    try {
        lotSize = lotOverride ?? getLotSize(indexName);
    } catch {
        lotSize = lotOverride ?? 25; // safe default = NIFTY
    }

    // Each futures contract contributes +1 (or -1) delta per lot
    const contracts = netDelta !== 0 ? -Math.round(netDelta / lotSize) : 0;
    const hedgeQty = contracts * lotSize;
    const residual = netDelta + hedgeQty; // hedge adds negative of itself
    const side: 'BUY' | 'SELL' = contracts > 0 ? 'BUY' : 'SELL';
    const notional = Math.abs(hedgeQty) * spot;

    // Naive margin estimate: 10% of notional per contract (typical NIFTY
    // SPAN margin band) — UI uses this to size capital calls.
    const costApprox = Math.abs(contracts) * spot * lotSize * 0.10;

    return {
        futuresContracts: contracts,
        hedgeQty,
        residualDelta: residual,
        side,
        notional,
        lotSize,
        indexName,
        costApprox
    };
}

// ============================================================
// P&L SIMULATION
// ============================================================

/**
 * Run a deterministic, geometric-Brownian-motion style P&L simulation
 * across a ±range spot move. The unhedged position loses (or gains)
 * ~ netDelta × Δspot at first order, and picks up gamma curvature in
 * the wings. The hedged P&L subtracts the futures MTM so the user
 * can see how the curve flattens.
 *
 * `positions` is an array of leg-style Greeks entries — only delta &
 * gamma are used here (theta & vega ignored for the static curve).
 */
export function simulateHedgedPayoff(
    positions: PositionGreeks[],
    spot: number,
    range: number = 0.15,
    samples: number = 50,
    indexName: string = 'NIFTY',
    lotOverride?: number
): { unhedged: PayoffPoint[]; hedged: PayoffPoint[]; hedge: HedgeResult } {
    const totalDelta = positions.reduce((s, p) => s + p.delta * (p.quantity ?? 1), 0);
    const totalGamma = positions.reduce((s, p) => s + p.gamma * (p.quantity ?? 1), 0);

    const hedge = computeHedge(totalDelta, spot, indexName, lotOverride);

    // Underlying moves: linearly interpolated from (1-range)*spot → (1+range)*spot
    const out: { unhedged: PayoffPoint[]; hedged: PayoffPoint[] } = {
        unhedged: new Array(samples),
        hedged: new Array(samples)
    };

    for (let i = 0; i < samples; i++) {
        const t = samples === 1 ? 0.5 : i / (samples - 1);
        const movePct = -range + 2 * range * t; // -range → +range
        const newSpot = spot * (1 + movePct);
        const dS = newSpot - spot;

        // First-order P&L: delta × dS + 0.5 × gamma × dS²
        const unhedgedPnl = totalDelta * dS + 0.5 * totalGamma * dS * dS;

        // Hedged: subtract the futures MTM. Futures have delta=1 per unit,
        // gamma=0, so the hedge contributes (hedgeQty × dS) to cancel delta.
        const hedgedPnl = unhedgedPnl - hedge.hedgeQty * dS;

        out.unhedged[i] = { spotMove: movePct, spot: newSpot, pnlUnhedged: unhedgedPnl, pnlHedged: hedgedPnl };
        out.hedged[i]   = { spotMove: movePct, spot: newSpot, pnlUnhedged: unhedgedPnl, pnlHedged: hedgedPnl };
    }
    return { ...out, hedge };
}

// ============================================================
// STRATEGY RECOMMENDATION
// ============================================================

/**
 * Suggest a hedge strategy from the joint magnitude of delta and gamma.
 *
 *   - |gamma| > 0.5  → convexity risk dominates → long butterfly
 *   - |delta| > 50   → directional risk dominates → futures
 *   - both elevated  → directional + convex → vertical spread
 *   - otherwise      → no hedge needed (or straddle if vega-heavy)
 *
 * `netVega` is optional — when provided and |vega| > 100 we prefer a
 * long straddle / strangle to capture vol expansion.
 */
export function recommendHedgeStrategy(
    netDelta: number,
    netGamma: number,
    spot: number,
    netVega?: number
): HedgeStrategy {
    const absDelta = Math.abs(netDelta);
    const absGamma = Math.abs(netGamma);
    const absVega = Math.abs(netVega ?? 0);

    // 1) Vega-driven — only when delta & gamma are both quiet
    if (absVega > 100 && absDelta < 25 && absGamma < 0.3) {
        return {
            name: 'STRADDLE',
            rationale: `Vega exposure (${netVega!.toFixed(0)}) dominates. Long straddle monetizes a vol expansion.`,
            priority: 3
        };
    }

    // 2) Gamma + Delta together → vertical spread
    if (absGamma > 0.5 && absDelta > 50) {
        return {
            name: 'VERTICAL_SPREAD',
            rationale: `High |Γ|=${absGamma.toFixed(2)} AND |Δ|=${absDelta.toFixed(0)}. A vertical spread caps both directional and convex risk for a known debit.`,
            priority: 5
        };
    }

    // 3) Gamma alone → butterfly
    if (absGamma > 0.5) {
        return {
            name: 'BUTTERFLY',
            rationale: `Gamma of ${netGamma.toFixed(2)} is the dominant Greek. A long butterfly monetizes reversion to ATM.`,
            priority: 4
        };
    }

    // 4) Delta alone → futures
    if (absDelta > 50) {
        return {
            name: 'FUTURES',
            rationale: `Net Δ of ${netDelta.toFixed(0)} drives the P&L. Offset with index futures for cheapest delta-neutrality.`,
            priority: 5
        };
    }

    return {
        name: 'NO_HEDGE',
        rationale: 'Greek exposure is within tolerance — no immediate hedge required.',
        priority: 0
    };
}
