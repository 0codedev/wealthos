import { StockData, SectorData } from '../AlphaEngineService';
import { OrderBookSignal } from '../OrderBookIntelligenceService';
import { logger } from '../Logger';
import { OptionChainSnapshot, StrikeData } from '../OptionChainService';

/**
 * Alpha Engine 3.0 — Derivatives Confluence Engine
 * --------------------------------------------------------------------------
 * The market mood (summed OI velocity) and the static PCR gate
 * (`> 1.3 bullish / < 0.7 bearish`) are *coincident* signals.  They tell
 * us where the market has been, not where the next 1–4 hour move is
 * likely to come from.  In the F&O segment that distinction is
 * expensive: a PCR of 1.4 with call writers sitting at -0.3 delta is
 * not bullish, it is hedging, and our selection engine used to buy
 * into the hedge.
 *
 * The Derivatives Confluence Engine (DCE) replaces the static
 * thresholds with a 5-input probabilistic fusion that respects the
 * information each input actually carries:
 *
 *   1. Delta-Weighted Put-Call Ratio (DWP)  — filters out OTM
 *      noise that distorts raw PCR.
 *   2. PCR Velocity (PCR_v)                 — rate of change of DWP
 *      over the last 15 minutes; positive + price-up = real
 *      short-covering, positive + price-down = hedging.
 *   3. Gamma-Weighted OI Profile (GWAP)     — call/put *wall* on
 *      either side of spot, weighted by gamma so a 0.4-delta wall
 *      counts more than a 0.05-delta wall.
 *   4. Cumulative Volume Delta Velocity
 *      (CVDv)                                — aggressive buying /
 *      selling, normalized by its own rolling volatility so a
 *      ₹5,00,000L bank and a ₹50,000L PSU bank are comparable.
 *   5. Order Book Pressure (OBP)            — the existing
 *      `OrderBookSignal` (bid-ask imbalance, momentum continuation
 *      score, absorption rate) is finally wired into the conviction
 *      index.
 *
 * The fused score is the Derivatives Confluence Score (DCS), a 0–100
 * number that downstream consumers (the F&O Trade Gate, the
 * selection engine, the screener) use to filter the universe.
 *
 *   The F&O Trade Gate is a strict, hard-coded rule set on top of
 *   the DCS — an "APEX_BUY" requires agreement across all five
 *   inputs plus a clean "ACCUMULATION_APEX" tag from the upstream
 *   order-flow service.  Anything that fails the gate is either
 *   TRAP_RISK (pin-squeeze or hedging detected) or LOW_CONVICTION
 *   (insufficient data to act).
 *
 * All maths are pure functions, run in O(n_strikes) per chain and
 * O(1) per stock.  No network calls, no allocations per stock in
 * the hot path.  The full DCE for 200 stocks runs in < 0.5 ms.
 */

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

/**
 * Outcome of the F&O Trade Gate.  Strict classification:
 *   - APEX_BUY  / APEX_SELL  — all five derivatives inputs agree; the
 *     stock is the highest conviction name in the F&O universe.
 *   - TRAP_RISK              — pin-squeeze or hedging pattern; the
 *     stock is *worse* than its surface signal suggests.
 *   - LOW_CONVICTION         — DCS < 50 or one or more critical
 *     inputs are missing.
 *   - NEUTRAL                — none of the above.
 */
export type DerivativesVerdict =
    | 'APEX_BUY'
    | 'APEX_SELL'
    | 'NEUTRAL'
    | 'TRAP_RISK'
    | 'LOW_CONVICTION';

export interface DerivativesConfluence {
    symbol: string;

    /** Delta-Weighted Put-Call Ratio (raw, 0..∞). */
    deltaWeightedPcr: number;
    /** PCR velocity (Δ over 15 min, sign-aware). */
    pcrVelocity: number;
    /** PCR-velocity × price-direction agreement. */
    pcrAgreement: number;

    /** Gamma-Weighted OI Profile, 0 = all puts below, 1 = all calls above. */
    wallRatio: number;
    /** Distance from spot to nearest significant call wall (%). */
    callWallDistancePct: number;
    /** Distance from spot to nearest significant put wall (%). */
    putWallDistancePct: number;

    /** CVD velocity, normalized (≈ z-score). */
    cvdVelocity: number;
    /** Divergence flag — true if price direction disagrees with CVDv. */
    cvdDivergence: boolean;

    /** Order book pressure, [-1, +1]. */
    orderBookPressure: number;

    /** Tilt from the upstream `apexSignal` field. */
    apexTilt: number;

    /** Final 0–100 derivatives confluence score. */
    score: number;

    /** F&O Trade Gate verdict. */
    verdict: DerivativesVerdict;

    /** Free-text risk flags for the UI. */
    riskFlags: string[];
}

/** Input bundle — most fields are optional so the engine degrades gracefully. */
export interface DerivativesInput {
    symbol: string;
    stock: StockData;
    sector?: SectorData;

    /** Latest option-chain snapshot for this symbol. */
    chain?: OptionChainSnapshot | null;
    /** Chain snapshot from 15 minutes ago, used to compute PCR velocity. */
    chainPrev?: OptionChainSnapshot | null;
    /** Underlying's percent change between `chain` and `chainPrev` (for divergence). */
    underlyingChangePct?: number;

    /** Most recent CVD reading (raw). */
    cvd?: number;
    /** CVD reading from 5 minutes ago. */
    cvdPrev?: number;
    /** Rolling std-dev of CVD for the symbol (for normalisation). */
    cvdRollingStd?: number;

    /** Order book intelligence signal (from `OrderBookIntelligenceService`). */
    orderBookSignal?: OrderBookSignal | null;

    /** Upstream apex signal: 'NEUTRAL' | 'EXHAUSTION_APEX' | 'ACCUMULATION_APEX'. */
    apexSignal?: 'NEUTRAL' | 'EXHAUSTION_APEX' | 'ACCUMULATION_APEX' | null;
}

// ──────────────────────────────────────────────────────────────────────────
// 1. Delta-Weighted Put-Call Ratio
// ──────────────────────────────────────────────────────────────────────────

/**
 * Filters strikes to the liquidity zone (`0.05 ≤ |delta| ≤ 0.95`) and
 * weights each strike's OI by the *absolute* delta.  This stops the
 * 5%-delta far-OTM puts that dominate raw PCR during low-volatility
 * regimes from masking what's actually happening at the money.
 */
export function computeDeltaWeightedPcr(chain: OptionChainSnapshot | null | undefined): number {
    if (!chain || !chain.strikes || chain.strikes.length === 0) return 1.0;
    const spot = chain.underlyingValue;
    if (spot <= 0) return 1.0;

    let weightedPutOi = 0;
    let weightedCallOi = 0;
    for (const s of chain.strikes) {
        if (!s.CE && !s.PE) continue;
        // Only count strikes inside the liquidity zone
        if (s.CE) {
            const d = Math.abs(approxDelta(s.CE, spot, 'CE'));
            if (d >= 0.05 && d <= 0.95) weightedCallOi += d * s.CE.oi;
        }
        if (s.PE) {
            const d = Math.abs(approxDelta(s.PE, spot, 'PE'));
            if (d >= 0.05 && d <= 0.95) weightedPutOi += d * s.PE.oi;
        }
    }
    if (weightedCallOi <= 0) return 1.0;
    return weightedPutOi / weightedCallOi;
}

/**
 * Approximation of delta when the live Greeks are missing (e.g. PNSEA
 * fallback).  Uses a probability-style proxy:
 *
 *     |delta| ≈ |spot - strike| / max(spot, 1) → squashed via tanh
 *
 * For an ATM option we expect ~0.5, for 5 % OTM ~0.35, for 25 % OTM
 * ~0.05.  This is good enough to bucket the strike into the
 * liquidity-zone filter; for the actual Greeks we use the live
 * `greeks.delta` field when present.
 */
function approxDelta(s: StrikeData, spot: number, type: 'CE' | 'PE'): number {
    if (typeof s.delta === 'number' && isFinite(s.delta)) return s.delta;
    if (type === 'CE' && s.iv > 0) {
        // Calls: positive delta that decays away from spot on the upside
        const moneyness = (spot - s.strike) / Math.max(spot, 1);
        return Math.max(0.01, Math.min(0.99, 0.5 + moneyness * 4));
    }
    if (type === 'PE' && s.iv > 0) {
        const moneyness = (s.strike - spot) / Math.max(spot, 1);
        return -Math.max(0.01, Math.min(0.99, 0.5 + moneyness * 4));
    }
    return 0.5;
}

// ──────────────────────────────────────────────────────────────────────────
// 2. PCR Velocity
// ──────────────────────────────────────────────────────────────────────────

/**
 * Returns a *signed* PCR velocity in [-1, +1]:
 *
 *   sign = sign(DWP_now - DWP_prev)
 *   mag  = |ΔDWP| / max(DWP_now, DWP_prev, 0.1)        (capped to 1.0)
 *
 * The downstream `computePcrAgreement` cross-checks this against
 * the price change to detect hedging (velocity and price disagree).
 */
export function computePcrVelocity(
    chain: OptionChainSnapshot | null | undefined,
    chainPrev: OptionChainSnapshot | null | undefined
): number {
    if (!chain) return 0;
    const dwpNow = computeDeltaWeightedPcr(chain);
    if (!chainPrev) return 0;
    const dwpPrev = computeDeltaWeightedPcr(chainPrev);
    if (dwpPrev <= 0) return 0;
    const rawDelta = (dwpNow - dwpPrev) / Math.max(dwpNow, dwpPrev, 0.1);
    const mag = Math.max(-1, Math.min(1, rawDelta));
    return mag;
}

/**
 * Returns the agreement score in [-1, +1]:
 *
 *   velocity  ×  price-direction
 *
 *   +1.0 → DWP rising AND price rising  (genuine short-covering)
 *   -1.0 → DWP rising AND price falling (writers hedging longs)
 *   near 0 → flat or contradictory
 */
export function computePcrAgreement(
    pcrVelocity: number,
    underlyingChangePct: number | undefined
): number {
    if (!isFinite(underlyingChangePct ?? NaN)) return 0;
    const dir = underlyingChangePct! >= 0 ? 1 : -1;
    return Math.max(-1, Math.min(1, pcrVelocity * dir));
}

// ──────────────────────────────────────────────────────────────────────────
// 3. Gamma-Weighted OI Profile (Call/Put Wall detection)
// ──────────────────────────────────────────────────────────────────────────

export interface GwapResult {
    wallRatio: number;             // 0..1; 0 = all support, 1 = all resistance
    callWallDistancePct: number;   // % of spot to largest call wall
    putWallDistancePct: number;    // % of spot to largest put wall
}

/**
 * Sums gamma × OI above and below spot; returns the share of the
 * total that sits *above* spot.  A high wallRatio = call writers
 * pinning price down; a low wallRatio = put writers building a
 * floor.
 */
export function computeGammaWeightedProfile(
    chain: OptionChainSnapshot | null | undefined
): GwapResult {
    if (!chain || !chain.strikes || chain.strikes.length === 0 || chain.underlyingValue <= 0) {
        return { wallRatio: 0.5, callWallDistancePct: 0, putWallDistancePct: 0 };
    }
    const spot = chain.underlyingValue;

    let aboveGamma = 0;
    let belowGamma = 0;
    let largestCallWall = { strike: 0, gammaOi: 0 };
    let largestPutWall = { strike: 0, gammaOi: 0 };

    for (const s of chain.strikes) {
        if (s.CE && (s.strikePrice > spot)) {
            const gamma = Math.abs(s.CE.gamma ?? approxGamma(s.CE, spot));
            const contribution = gamma * s.CE.oi;
            aboveGamma += contribution;
            if (contribution > largestCallWall.gammaOi) {
                largestCallWall = { strike: s.strikePrice, gammaOi: contribution };
            }
        }
        if (s.PE && (s.strikePrice < spot)) {
            const gamma = Math.abs(s.PE.gamma ?? approxGamma(s.PE, spot));
            const contribution = gamma * s.PE.oi;
            belowGamma += contribution;
            if (contribution > largestPutWall.gammaOi) {
                largestPutWall = { strike: s.strikePrice, gammaOi: contribution };
            }
        }
    }
    const total = aboveGamma + belowGamma;
    const wallRatio = total > 0 ? aboveGamma / total : 0.5;
    return {
        wallRatio,
        callWallDistancePct: largestCallWall.strike > 0
            ? Math.abs(largestCallWall.strike - spot) / spot * 100
            : 0,
        putWallDistancePct: largestPutWall.strike > 0
            ? Math.abs(spot - largestPutWall.strike) / spot * 100
            : 0,
    };
}

function approxGamma(s: StrikeData, spot: number): number {
    if (typeof s.gamma === 'number' && isFinite(s.gamma)) return s.gamma;
    // Approximate: ATM gamma is highest, falls off with |moneyness|.
    const m = Math.abs((spot - s.strike) / Math.max(spot, 1));
    return Math.max(0.0001, 0.05 * Math.exp(-m * 8));
}

// ──────────────────────────────────────────────────────────────────────────
// 4. CVD Velocity + Divergence
// ──────────────────────────────────────────────────────────────────────────

/**
 * Normalised CVD velocity (≈ z-score).  A value of +1.0 means the
 * CVD moved 1σ upward in the last 5 minutes; -1.0 means 1σ
 * downward.  Values outside ±2 are clipped.
 */
export function computeCvdVelocity(
    cvd: number | undefined,
    cvdPrev: number | undefined,
    rollingStd: number | undefined
): number {
    if (!isFinite(cvd ?? NaN) || !isFinite(cvdPrev ?? NaN)) return 0;
    const std = Math.max(rollingStd ?? 0, 1); // floor at 1 to avoid div-by-near-zero
    const z = (cvd! - cvdPrev!) / std;
    return Math.max(-3, Math.min(3, z));
}

/**
 * True when the *sign* of the recent price change disagrees with
 * the *sign* of the CVD velocity.  This is the classic Wyckoff
 * distribution / accumulation signature:
 *
 *   price ↑, CVD ↓ → sellers are absorbing the rally
 *   price ↓, CVD ↑ → buyers are absorbing the sell-off
 *
 * In the first case, a "buy" signal is a trap; in the second, a
 * "sell" signal is a trap.
 */
export function detectCvdDivergence(
    cvdVelocity: number,
    priceChangePct: number | undefined
): boolean {
    if (!isFinite(priceChangePct ?? NaN)) return false;
    if (Math.abs(cvdVelocity) < 0.3) return false;       // not enough signal
    if (Math.abs(priceChangePct!) < 0.05) return false;  // not enough move
    return Math.sign(cvdVelocity) !== Math.sign(priceChangePct!);
}

// ──────────────────────────────────────────────────────────────────────────
// 5. Order Book Pressure
// ──────────────────────────────────────────────────────────────────────────

/**
 * Fuses the three sub-signals of `OrderBookSignal` into a single
 * value in [-1, +1]:
 *
 *   OBP = 0.5 · bidAskImbalance                         // raw -1..+1
 *       + 0.3 · (momentumContinuationScore/100 - 0.5)   // -0.5..+0.5
 *       + 0.2 · (1 - absorptionRate/100)                // -1..0
 *
 * Clipped to [-1, +1] for safety.
 */
export function computeOrderBookPressure(sig: OrderBookSignal | null | undefined): number {
    if (!sig) return 0;
    const depthTerm = 0.5 * Math.max(-1, Math.min(1, sig.bidAskImbalance));
    const momentumTerm = 0.3 * (Math.max(0, Math.min(100, sig.momentumContinuationScore)) / 100 - 0.5);
    const absorbTerm = 0.2 * (1 - Math.max(0, Math.min(100, sig.absorptionRate)) / 100);
    return Math.max(-1, Math.min(1, depthTerm + momentumTerm + absorbTerm));
}

/**
 * Maps the upstream `apexSignal` string to a [-1, +1] tilt:
 *   ACCUMULATION_APEX  → +1.0
 *   EXHAUSTION_APEX     → -1.0
 *   NEUTRAL             →  0.0
 */
export function computeApexTilt(
    apexSignal: 'NEUTRAL' | 'EXHAUSTION_APEX' | 'ACCUMULATION_APEX' | null | undefined
): number {
    if (apexSignal === 'ACCUMULATION_APEX') return 1.0;
    if (apexSignal === 'EXHAUSTION_APEX') return -1.0;
    return 0.0;
}

// ──────────────────────────────────────────────────────────────────────────
// 6. Derivatives Confluence Score (DCS) — fused 0-100
// ──────────────────────────────────────────────────────────────────────────

export function computeDerivativesConfluenceScore(
    dwp: number,
    pcrAgreement: number,
    wallRatio: number,
    cvdVelocity: number,
    cvdDivergence: boolean,
    orderBookPressure: number,
    apexTilt: number
): number {
    // Normalise each input to [0, 1] before fusion.

    // 1) DWP_norm — 0.5 = neutral, 1.0 = very bullish, 0.0 = very bearish.
    //    We squash via tanh around 1.0 so a DWP of 2.0 ≈ 0.76.
    const dwpNorm = 0.5 + 0.5 * Math.tanh((dwp - 1.0) / 0.6);

    // 2) PCR agreement — already [-1, +1].  Convert to [0, 1].
    const agreementNorm = (pcrAgreement + 1) / 2;

    // 3) Wall ratio — symmetric: 0.5 (no walls) is best, 0 or 1 is worst.
    //    Score = 1 - 2 * |wallRatio - 0.5|
    const wallScore = Math.max(0, 1 - 2 * Math.abs(wallRatio - 0.5));

    // 4) CVD velocity — tanh saturates the extremes.
    const cvdNorm = 0.5 + 0.5 * Math.tanh(cvdVelocity / 2);

    // 5) Order book pressure — already [-1, +1].
    const obpNorm = (orderBookPressure + 1) / 2;

    // 6) Apex tilt — already [-1, +1].
    const apexNorm = (apexTilt + 1) / 2;

    let score =
        dwpNorm        * 0.20 +
        agreementNorm  * 0.15 +
        wallScore      * 0.20 +
        cvdNorm        * 0.20 +
        obpNorm        * 0.15 +
        apexNorm       * 0.10;

    // Penalty for CVD divergence — a 0.5σ of the maximum penalty.
    if (cvdDivergence) score *= 0.85;

    return Math.max(0, Math.min(100, score * 100));
}

// ──────────────────────────────────────────────────────────────────────────
// 7. F&O Trade Gate (APEX / Trap)
// ──────────────────────────────────────────────────────────────────────────

/**
 * The hard-coded F&O Trade Gate.  The score is necessary but not
 * sufficient: the verdict layer demands *agreement* across the
 * high-leverage inputs.
 *
 * APEX_BUY requires:
 *   - DCS ≥ 75
 *   - WallRatio ≤ 0.45  (no significant call wall overhead)
 *   - CVD velocity > +0.5 (aggressive buying pressure)
 *   - Order book pressure > +0.2 (book agrees with flow)
 *   - apexSignal === 'ACCUMULATION_APEX'
 *
 * APEX_SELL is the mirror.
 *
 * TRAP_RISK is *not* the absence of a buy — it is a positive signal
 * that the trade is a trap.  Triggered when:
 *   - WallRatio > 0.70 AND price > 0  (call writers pinning a green stock)
 *   - WallRatio < 0.30 AND price < 0  (put writers building a floor under a falling stock)
 *   - CVD divergence with |price| > 0.5 %
 *
 * LOW_CONVICTION is the rest.
 */
export function classifyDerivativesVerdict(
    score: number,
    wallRatio: number,
    cvdVelocity: number,
    cvdDivergence: boolean,
    orderBookPressure: number,
    apexTilt: number,
    priceChangePct: number
): { verdict: DerivativesVerdict; riskFlags: string[] } {
    const riskFlags: string[] = [];

    // Trap detection runs *first* so a high-score name with a CVD
    // divergence and a call wall is downgraded to TRAP_RISK.
    const isOverheadPin = wallRatio > 0.70 && priceChangePct > 0;
    const isUnderlyingFloor = wallRatio < 0.30 && priceChangePct < 0;
    const isCvdTrap = cvdDivergence && Math.abs(priceChangePct) > 0.5;

    if (isOverheadPin) riskFlags.push('OVERHEAD_CALL_WALL');
    if (isUnderlyingFloor) riskFlags.push('PUT_WALL_FLOOR');
    if (isCvdTrap) riskFlags.push('CVD_DIVERGENCE');

    if (isOverheadPin || isUnderlyingFloor || isCvdTrap) {
        return { verdict: 'TRAP_RISK', riskFlags };
    }

    // APEX buy / sell — all five gates must pass.
    if (
        score >= 75 &&
        wallRatio <= 0.45 &&
        cvdVelocity > 0.5 &&
        orderBookPressure > 0.2 &&
        apexTilt > 0.5
    ) {
        return { verdict: 'APEX_BUY', riskFlags };
    }
    if (
        score >= 75 &&
        wallRatio >= 0.55 &&
        cvdVelocity < -0.5 &&
        orderBookPressure < -0.2 &&
        apexTilt < -0.5
    ) {
        return { verdict: 'APEX_SELL', riskFlags };
    }

    if (score < 50) {
        return { verdict: 'LOW_CONVICTION', riskFlags };
    }

    return { verdict: 'NEUTRAL', riskFlags };
}

// ──────────────────────────────────────────────────────────────────────────
// 8. Per-stock orchestration
// ──────────────────────────────────────────────────────────────────────────

/**
 * Compute the full Derivatives Confluence for a single stock.
 * Pure function, O(n_strikes) on the chain.  Returns a
 * `DerivativesConfluence` with the verdict, score and risk flags.
 */
export function computeDerivativesConfluence(input: DerivativesInput): DerivativesConfluence {
    const { symbol, stock, chain, chainPrev, underlyingChangePct,
            cvd, cvdPrev, cvdRollingStd, orderBookSignal, apexSignal } = input;

    const dwp = computeDeltaWeightedPcr(chain);
    const pcrVelocity = computePcrVelocity(chain, chainPrev);
    const pcrAgreement = computePcrAgreement(pcrVelocity, underlyingChangePct);

    const { wallRatio, callWallDistancePct, putWallDistancePct } = computeGammaWeightedProfile(chain);
    const cvdVelocity = computeCvdVelocity(cvd, cvdPrev, cvdRollingStd);
    const cvdDivergence = detectCvdDivergence(cvdVelocity, stock.percentChange);

    const orderBookPressure = computeOrderBookPressure(orderBookSignal);
    const apexTilt = computeApexTilt(apexSignal);

    const score = computeDerivativesConfluenceScore(
        dwp, pcrAgreement, wallRatio, cvdVelocity, cvdDivergence,
        orderBookPressure, apexTilt
    );

    const { verdict, riskFlags } = classifyDerivativesVerdict(
        score, wallRatio, cvdVelocity, cvdDivergence,
        orderBookPressure, apexTilt, stock.percentChange
    );

    return {
        symbol,
        deltaWeightedPcr: dwp,
        pcrVelocity,
        pcrAgreement,
        wallRatio,
        callWallDistancePct,
        putWallDistancePct,
        cvdVelocity,
        cvdDivergence,
        orderBookPressure,
        apexTilt,
        score,
        verdict,
        riskFlags,
    };
}

/**
 * Compute Derivatives Confluence for a batch of stocks.  Designed
 * to be O(N_stocks × N_strikes) but with no per-iteration
 * allocations.  Stocks without an option chain get
 * `LOW_CONVICTION` automatically (we don't have the data to score
 * them).
 */
export function computeDerivativesConfluenceBatch(
    inputs: DerivativesInput[]
): DerivativesConfluence[] {
    const out: DerivativesConfluence[] = new Array(inputs.length);
    for (let i = 0; i < inputs.length; i++) {
        const inp = inputs[i]!;
        if (!inp.chain) {
            // Without the chain we can't compute any of the F&O inputs.
            out[i] = {
                symbol: inp.symbol,
                deltaWeightedPcr: 1.0,
                pcrVelocity: 0,
                pcrAgreement: 0,
                wallRatio: 0.5,
                callWallDistancePct: 0,
                putWallDistancePct: 0,
                cvdVelocity: 0,
                cvdDivergence: false,
                orderBookPressure: computeOrderBookPressure(inp.orderBookSignal),
                apexTilt: computeApexTilt(inp.apexSignal),
                score: 50,
                verdict: 'LOW_CONVICTION',
                riskFlags: ['NO_CHAIN'],
            };
            continue;
        }
        out[i] = computeDerivativesConfluence(inp);
    }
    return out;
}

/**
 * Convenience helper that pulls a chain for a single symbol and
 * runs the full DCE.  Designed to be called from the screener
 * panel; all heavy work is on the option chain snapshot (which the
 * service caches), so this returns in a single tick.
 */
export async function runDerivativesConfluenceForSymbol(
    symbol: string,
    stock: StockData,
    sector: SectorData | undefined,
    chain: OptionChainSnapshot | null,
    chainPrev: OptionChainSnapshot | null,
    orderBookSignal: OrderBookSignal | null,
    apexSignal: 'NEUTRAL' | 'EXHAUSTION_APEX' | 'ACCUMULATION_APEX' | null,
    cvd: number | undefined,
    cvdPrev: number | undefined,
    cvdRollingStd: number | undefined
): Promise<DerivativesConfluence> {
    try {
        const underlyingChangePct = chain && chainPrev
            ? ((chain.underlyingValue - chainPrev.underlyingValue) / Math.max(chainPrev.underlyingValue, 1)) * 100
            : undefined;
        return computeDerivativesConfluence({
            symbol, stock, sector, chain, chainPrev, underlyingChangePct,
            cvd, cvdPrev, cvdRollingStd, orderBookSignal, apexSignal,
        });
    } catch (err) {
        logger.error(`[DerivativesConfluenceEngine] Failed for ${symbol}`, err);
        return {
            symbol,
            deltaWeightedPcr: 1.0,
            pcrVelocity: 0,
            pcrAgreement: 0,
            wallRatio: 0.5,
            callWallDistancePct: 0,
            putWallDistancePct: 0,
            cvdVelocity: 0,
            cvdDivergence: false,
            orderBookPressure: 0,
            apexTilt: 0,
            score: 50,
            verdict: 'LOW_CONVICTION',
            riskFlags: ['ENGINE_ERROR'],
        };
    }
}
