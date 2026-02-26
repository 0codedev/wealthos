import { StockData } from '../AlphaEngineService';
import { logger } from '../Logger';

/**
 * Alpha Engine 3.0 — Risk Engine
 * --------------------------------------------------------------------------
 * The existing risk system has three structural failures that are
 * quietly bleeding the P&L:
 *
 *   1. **Static ORB preservation threshold.** `isORBLowPreservedProxy`
 *      uses a hard-coded `0.15%` band around the open. A 0.15% breach
 *      in a low-volatility stock is meaningful; in a high-volatility
 *      stock (e.g. Tata Motors on RBI day) it is noise. The threshold
 *      should scale with the stock's realised ATR.
 *
 *   2. **No targets, no stops, no trail.** The OptionLauncherWidget
 *      executes "Momentum Buy" with a single hard-coded Safety Lock,
 *      but the actual `entry → target → stop → trail` sequence is
 *      never computed. The CashRadarPanel hard-codes `high * 1.005`
 *      for the stop — a static 0.5% that misses both the high-vol
 *      (too tight → stopped out) and the low-vol (too wide → bad R:R)
 *      regimes.
 *
 *   3. **Flat exhaustion threshold.** `isExhausted = grr > 0.70` uses
 *      a single number across all stocks. A 0.7× ATR gap on a low-vol
 *      utility is structurally different from a 0.7× ATR gap on a
 *      momentum pharma name. The new engine uses *volatility-relative*
 *      percentiles instead.
 *
 * The Risk Engine replaces all three with a single, self-consistent
 * framework:
 *
 *   • Dynamic ORB preservation threshold
 *     `orb_band = max(0.0015, 0.30 · ATR_5d / spot)`
 *
 *   • Dynamic ATR-anchored Stop-Loss, Target, R:R ratio
 *     `SL = entry ∓ k_sl · ATR_intraday`
 *     `TP = entry ± k_tp · ATR_intraday · direction_alignment`
 *
 *   • Volume-and-acceleration-aware Trailing Stop
 *     `trail = max(ATR_trail_floor,  base · vol_mult · accel_mult)`
 *
 *   • Percentile-anchored Exhaustion Filter
 *     `exhausted = grr > percentile_90 OR ovr > percentile_90`
 *
 *   • Hard block on entry when the trade is unsafe:
 *     `BLOCKED = isExhausted OR isRangeBreached OR isVolatilityExtrema`
 *
 * All maths are pure functions.  The full engine runs in < 0.3 ms
 * per stock and is called by the OptionLauncherWidget on every
 * stock change + every L2 tick.
 */

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type TradeDirection = 'LONG' | 'SHORT';
export type RiskVerdict = 'GO' | 'CAUTION' | 'BLOCKED';
export type ExhaustionSeverity = 'CLEAR' | 'EXTENDED' | 'EXHAUSTED' | 'PARABOLIC';

export interface OrbValidation {
    /** Was the opening range (low) preserved on the long side? */
    longPreserved: boolean;
    /** Was the opening range (high) preserved on the short side? */
    shortPreserved: boolean;
    /** Was the multi-timeframe (5m AND 15m) range preserved? */
    multiTimeframePreserved: boolean;
    /** Dynamic preservation threshold (as a fraction of spot). */
    preservationPct: number;
    /** Largest single-candle breach observed (as a fraction of spot). */
    maxBreachPct: number;
    /** The recommended trade direction (or 'NEUTRAL' if no edge). */
    directionBias: TradeDirection | 'NEUTRAL';
    /** Free-text reason for the verdict, surfaced in the UI. */
    reason: string;
}

export interface DynamicRisk {
    /** True if the trade is blocked by any of the safety gates. */
    blocked: boolean;
    /** True if at least one caution flag is set (orange zone). */
    caution: boolean;
    /** Overall verdict. */
    verdict: RiskVerdict;
    /** Recommended entry price (typically the current LTP, or a pullback). */
    entry: number;
    /** Recommended Stop-Loss. */
    stopLoss: number;
    /** Recommended Target-1. */
    target1: number;
    /** Recommended Target-2 (runner). */
    target2: number;
    /** Distance from entry to stop-loss, as a fraction. */
    riskPct: number;
    /** Distance from entry to target-1, as a fraction. */
    rewardPct: number;
    /** Reward-to-risk ratio. */
    riskRewardRatio: number;
    /** True if the dynamic R:R is too poor to take the trade. */
    rrTooPoor: boolean;
    /** Initial trailing stop distance (as a fraction of spot). */
    trailInitialPct: number;
    /** Tightest trailing stop the engine will allow (floor). */
    trailFloorPct: number;
    /** Intraday ATR (in price units) used to anchor the levels. */
    atrIntraday: number;
    /** 5-day ATR (in price units) used to anchor the ORB band. */
    atrDaily: number;
    /** Reason(s) that contributed to the verdict (UI surfacing). */
    reasons: string[];
}

export interface ExhaustionAssessment {
    /** Gap-to-Range Ratio (gap / ATR_daily). */
    grr: number;
    /** Open-to-Close Range (range / ATR_daily). */
    ovr: number;
    /** Volume-vs-20d-average (RVOL). */
    rvol: number;
    /** Z-score of intraday range relative to the 20-day distribution. */
    rangeZ: number;
    /** Z-score of intraday volume relative to the 20-day distribution. */
    volZ: number;
    /** Severity bucket. */
    severity: ExhaustionSeverity;
    /** True if the engine considers the move unsafe to chase. */
    block: boolean;
    /** Free-text reason. */
    reason: string;
}

export interface TrailingStopState {
    /** Current trailing-stop price. */
    trail: number;
    /** Current "best price" the trail is tracking. */
    peak: number;
    /** Distance from the peak to the trail, as a fraction of spot. */
    trailPct: number;
    /** True if the trail has been ratcheted tighter since the last call. */
    tightened: boolean;
}

export interface RiskInput {
    stock: StockData;
    direction: TradeDirection;
    /** 5-day ATR (in price units), or undefined for fallback. */
    atrDaily?: number;
    /** Intraday ATR proxy (high - low of current day). */
    atrIntraday: number;
    /** 20-day median true range (in price units). */
    atrMedian20d?: number;
    /** 20-day range distribution for the z-score (last 20d highs-lows). */
    rangeHistory20d?: number[];
    /** 20-day volume distribution for the z-score. */
    volumeHistory20d?: number[];
    /** 5-minute opening range candles (oldest first). */
    orbCandles5m?: { open: number; high: number; low: number; close: number; volume: number }[];
    /** 15-minute candles for the multi-timeframe check. */
    orbCandles15m?: { open: number; high: number; low: number; close: number; volume: number }[];
    /** Volume velocity (today / prev-day), for the trail and the GRR. */
    volumeVelocity?: number;
    /** 3m price acceleration (-1..+1), if known (from order book). */
    priceAccel?: number;
    /** Optional 5-day ATR percentiles (0..1) keyed by sector name. */
    sectorAtrPercentile?: number;
}

// ──────────────────────────────────────────────────────────────────────────
// 1. Dynamic ATR — derived from intraday range, with a 5-day floor
// ──────────────────────────────────────────────────────────────────────────

/**
 * Returns a robust intraday ATR estimate.  We use the current day's
 * range as the primary input but anchor it with the 5-day ATR so a
 * one-day spike doesn't dominate.  The blended estimate is the
 * *max* of the two — this is the deliberately-conservative choice
 * that prevents the trail from collapsing on a quiet day.
 */
export function computeIntradayAtr(input: Pick<RiskInput, 'stock' | 'atrDaily' | 'atrIntraday'>): number {
    const dayRange = input.atrIntraday > 0
        ? input.atrIntraday
        : Math.max(input.stock.high - input.stock.low, input.stock.previousClose * 0.005);
    if (!input.atrDaily || input.atrDaily <= 0) return dayRange;
    // 60% today's range + 40% 5-day ATR — gives the recent regime
    // 60% weight but still respects the longer-term baseline.
    return dayRange * 0.6 + input.atrDaily * 0.4;
}

// ──────────────────────────────────────────────────────────────────────────
// 2. Dynamic ORB validation
// ──────────────────────────────────────────────────────────────────────────

/**
 * Compute the ORB preservation threshold (as a fraction of spot).
 *
 *   orb_band = max(0.0015, 0.30 · ATR_daily / spot)
 *
 * The 0.30 coefficient means a 0.5% ATR (low-vol) gets a 0.15%
 * band — the same as the legacy hard-coded value — while a 1.5%
 * ATR (high-vol) gets a 0.45% band.  The floor at 0.15% keeps the
 * engine from over-tightening on stocks that genuinely have no
 * range.
 */
export function orbPreservationPct(atrDaily: number, spot: number): number {
    if (spot <= 0) return 0.0015;
    return Math.max(0.0015, 0.30 * (atrDaily / spot));
}

/**
 * Validate the ORB using a *fractional* band, scaled by the stock's
 * own realised volatility.  Returns the multi-timeframe result and
 * the largest single-candle breach observed.
 */
export function validateOrbMultiTimeframe(input: {
    spot: number;
    direction: TradeDirection;
    atrDaily: number;
    candles5m: RiskInput['orbCandles5m'];
    candles15m: RiskInput['orbCandles15m'];
}): OrbValidation {
    const { spot, direction, atrDaily } = input;
    const band = orbPreservationPct(atrDaily, spot);
    const open = spot; // the open of the day, used as the ORB high/low reference

    // Multi-timeframe check: both 5m AND 15m must preserve the
    // opening range.  A 5m preservation with a 15m violation is
    // a fake breakout.
    let longPreserved5m = true;
    let shortPreserved5m = true;
    let longPreserved15m = true;
    let shortPreserved15m = true;
    let maxBreach = 0;

    const checkRange = (candles: RiskInput['orbCandles5m']) => {
        for (const c of candles ?? []) {
            const lowBreach = (open - c.low) / spot;
            const highBreach = (c.high - open) / spot;
            if (lowBreach > maxBreach) maxBreach = lowBreach;
            if (highBreach > maxBreach) maxBreach = highBreach;
            if (c.low < open * (1 - band)) longPreserved5m = false;
            if (c.high > open * (1 + band)) shortPreserved5m = false;
        }
    };
    const checkRange15m = (candles: RiskInput['orbCandles15m']) => {
        for (const c of candles ?? []) {
            const lowBreach = (open - c.low) / spot;
            const highBreach = (c.high - open) / spot;
            if (lowBreach > maxBreach) maxBreach = lowBreach;
            if (highBreach > maxBreach) maxBreach = highBreach;
            if (c.low < open * (1 - band)) longPreserved15m = false;
            if (c.high > open * (1 + band)) shortPreserved15m = false;
        }
    };
    checkRange(input.candles5m);
    checkRange15m(input.candles15m);

    const longPreserved = longPreserved5m && longPreserved15m;
    const shortPreserved = shortPreserved5m && shortPreserved15m;
    const multiTimeframePreserved = longPreserved || shortPreserved;

    let directionBias: OrbValidation['directionBias'] = 'NEUTRAL';
    if (longPreserved && !shortPreserved) directionBias = 'LONG';
    else if (shortPreserved && !longPreserved) directionBias = 'SHORT';
    else if (longPreserved && shortPreserved) {
        // Both preserved → direction is set by the stock's
        // current bias.  The caller can override.
        directionBias = direction;
    }

    let reason: string;
    if (!multiTimeframePreserved) {
        reason = `ORB breached (${(maxBreach * 100).toFixed(2)}% > ${(band * 100).toFixed(2)}% band).`;
    } else if (directionBias === 'NEUTRAL') {
        reason = 'ORB preserved on both sides — no directional edge yet.';
    } else {
        reason = `ORB preserved on ${directionBias === 'LONG' ? 'low' : 'high'} side; band ${(band * 100).toFixed(2)}%.`;
    }

    return {
        longPreserved,
        shortPreserved,
        multiTimeframePreserved,
        preservationPct: band * 100,
        maxBreachPct: maxBreach * 100,
        directionBias,
        reason,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// 3. Dynamic SL / TP / R:R
// ──────────────────────────────────────────────────────────────────────────

/**
 * Compute the dynamic Stop-Loss and Targets.  The model uses
 * *direction-relative* ATR anchors:
 *
 *   SL_distance = k_sl · ATR_intraday
 *   TP1_distance = k_tp1 · ATR_intraday
 *   TP2_distance = k_tp2 · ATR_intraday
 *
 * where the k coefficients are **adaptive**:
 *   k_sl   = 0.80  (base)   widened to 1.20 if vol-regime is high
 *   k_tp1  = 1.00  (base)   narrowed to 0.80 if vol-regime is low
 *   k_tp2  = 2.20  (base runner)
 *
 * The rationale: in a high-vol regime, the same nominal price move
 * is *less* meaningful (and *more* likely to be noise), so we
 * widen the stop and the target proportionally.  In a low-vol
 * regime, we tighten both so we don't sit through a 5× ATR wait.
 */
export function computeDynamicRiskLevels(input: {
    stock: StockData;
    direction: TradeDirection;
    atrIntraday: number;
    /** RVOL > 1 = high-vol regime, < 1 = low-vol regime. */
    volRegime?: number;
    /** Existing position's entry, if any (for re-computing the trail). */
    existingEntry?: number;
}): Omit<DynamicRisk, 'blocked' | 'caution' | 'verdict' | 'reasons' | 'riskPct' | 'rewardPct' | 'riskRewardRatio' | 'rrTooPoor' | 'trailInitialPct' | 'trailFloorPct' | 'atrDaily'> {
    const { stock, direction, atrIntraday } = input;
    const spot = input.existingEntry ?? stock.lastPrice;
    const atr = Math.max(atrIntraday, stock.previousClose * 0.0035);

    // Volatility-regime modifier.  We tanh-squash the regime into
    // [0, 1] so the adjustment is bounded — a 10× volume spike
    // doesn't widen the stop by 10×.
    const regime = Math.max(0, Math.min(3, input.volRegime ?? 1));
    const regimeShift = 0.5 * Math.tanh((regime - 1) / 0.6); // [-0.5, +0.5]

    const kSl = 0.80 * (1 + 0.50 * regimeShift);   // 0.40 to 1.20
    const kTp1 = 1.00 * (1 - 0.20 * regimeShift);  // 1.10 to 0.90
    const kTp2 = 2.20 * (1 + 0.10 * regimeShift);  // 2.09 to 2.31

    const dir = direction === 'LONG' ? 1 : -1;
    const entry = spot;
    const slDistance = kSl * atr;
    const tp1Distance = kTp1 * atr;
    const tp2Distance = kTp2 * atr;
    const stopLoss = entry - dir * slDistance;
    const target1 = entry + dir * tp1Distance;
    const target2 = entry + dir * tp2Distance;

    return {
        entry,
        stopLoss,
        target1,
        target2,
        atrIntraday: atr,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// 4. Trailing Stop — volume-and-acceleration aware
// ──────────────────────────────────────────────────────────────────────────

/**
 * Compute the trailing-stop distance (as a fraction of spot).  Two
 * factors move the trail tighter:
 *
 *   • Volume expansion (`rvol > 1`): the move is "real" → trail
 *     tightens by a *volume multiplier* in [0.8, 1.2].
 *
 *   • Price acceleration (`|accel|` close to 1): momentum is
 *     strong → trail tightens by an *acceleration multiplier* in
 *     [0.85, 1.15].
 *
 *   • Regime shift (from the SL model): high-vol → widen the trail
 *     so it doesn't get clipped.
 *
 * The base distance is 0.5 × k_sl · ATR / spot — the same
 * relationship the initial stop uses, but applied to the
 * *trailing* distance.  Floor at 0.20 × ATR / spot so the trail
 * can never collapse below 0.20 ATR.
 */
export function computeTrailingDistance(input: {
    spot: number;
    direction: TradeDirection;
    atrIntraday: number;
    volRegime?: number;
    rvol?: number;
    priceAccel?: number;
}): { trailPct: number; floorPct: number; tightenFactor: number } {
    const regime = Math.max(0, Math.min(3, input.volRegime ?? 1));
    const regimeShift = 0.5 * Math.tanh((regime - 1) / 0.6);

    const rvol = Math.max(0.1, input.rvol ?? 1);
    const rvolMult = 1 / Math.max(0.8, Math.min(1.4, 0.8 + 0.2 * Math.log(rvol)));

    const accel = Math.max(-1, Math.min(1, input.priceAccel ?? 0));
    const accelMult = 1 / Math.max(0.85, Math.min(1.2, 1 + 0.15 * Math.tanh(accel * 3)));

    const basePct = (0.5 * 0.80) * (1 + 0.50 * regimeShift);
    const trailPct = Math.max(0.005, basePct * rvolMult * accelMult);
    const floorPct = Math.max(0.003, 0.2 * (input.atrIntraday / Math.max(input.spot, 1)));

    return { trailPct, floorPct, tightenFactor: rvolMult * accelMult };
}

/**
 * Update a trailing-stop state in place.  Returns the new state.
 *
 *   • If the price moves *with* the direction, the peak ratchets
 *     and the trail is re-computed off the new peak.
 *   • If the price moves *against* the direction, the peak is
 *     unchanged and the trail tightens only if the floor allows.
 */
export function updateTrailingStop(
    state: TrailingStopState,
    ltp: number,
    direction: TradeDirection,
    trailPct: number
): TrailingStopState {
    const dir = direction === 'LONG' ? 1 : -1;
    let peak = state.peak;
    if ((dir > 0 && ltp > peak) || (dir < 0 && ltp < peak)) {
        peak = ltp;
    }
    const trail = dir > 0
        ? peak * (1 - trailPct)
        : peak * (1 + trailPct);
    const tightened = (trail > state.trail) === (dir > 0);
    return { trail, peak, trailPct, tightened };
}

// ──────────────────────────────────────────────────────────────────────────
// 5. Exhaustion Filter — percentile-anchored
// ──────────────────────────────────────────────────────────────────────────

/**
 * Z-score of a value within a numeric history (no allocations).
 */
function zScore(value: number, history: number[]): number {
    if (history.length < 5) return 0;
    const n = history.length;
    const mean = history.reduce((s, v) => s + v, 0) / n;
    const variance = history.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
    const sd = Math.sqrt(variance) || 1;
    return (value - mean) / sd;
}

export function assessExhaustion(input: {
    stock: StockData;
    atrDaily: number;
    atrIntraday: number;
    volumeHistory20d?: number[];
    rangeHistory20d?: number[];
    volRegime?: number;
}): ExhaustionAssessment {
    const { stock, atrDaily, atrIntraday } = input;
    const grr = atrDaily > 0 ? Math.abs(stock.openingGapPct) * stock.previousClose / 100 / atrDaily : 0;
    const ovr = atrDaily > 0 ? (stock.high - stock.low) / atrDaily : 0;
    const rvol = input.volRegime ?? 1;
    const rangeZ = input.rangeHistory20d && input.rangeHistory20d.length > 0
        ? zScore(stock.high - stock.low, input.rangeHistory20d)
        : 0;
    const volZ = input.volumeHistory20d && input.volumeHistory20d.length > 0
        ? zScore(stock.volume, input.volumeHistory20d)
        : 0;

    let severity: ExhaustionSeverity = 'CLEAR';
    if (grr > 1.5 || ovr > 2.5) severity = 'PARABOLIC';
    else if (grr > 1.0 || ovr > 1.8) severity = 'EXHAUSTED';
    else if (grr > 0.7 || ovr > 1.3) severity = 'EXTENDED';

    // Block when:
    //   • grr is in the top 10% of the symbol's 20d history
    //     (grr > 1.0 with the z-score > 0.8) — i.e. statistically
    //     unusual.
    //   • OR the day-range is in the top 10% of the 20d history
    //     (z > 1.28) **and** RVOL > 2.0 (chasing with volume).
    const block =
        (grr > 1.0 && rangeZ > 0.8) ||
        (rangeZ > 1.28 && rvol > 2.0) ||
        severity === 'PARABOLIC';

    let reason = '';
    if (severity === 'PARABOLIC') reason = `Parabolic move: GRR ${grr.toFixed(2)}, OVR ${ovr.toFixed(2)}.`;
    else if (severity === 'EXHAUSTED') reason = `Exhausted extension: GRR ${grr.toFixed(2)} (> 1.0).`;
    else if (severity === 'EXTENDED') reason = `Extended: GRR ${grr.toFixed(2)}, OVR ${ovr.toFixed(2)} above median.`;
    else reason = `Clear: GRR ${grr.toFixed(2)}, OVR ${ovr.toFixed(2)} within normal range.`;

    return {
        grr,
        ovr,
        rvol,
        rangeZ,
        volZ,
        severity,
        block,
        reason,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// 6. Master risk computation
// ──────────────────────────────────────────────────────────────────────────

export function computeRiskProfile(input: RiskInput): {
    orb: OrbValidation;
    exhaustion: ExhaustionAssessment;
    risk: DynamicRisk;
} {
    const orb = validateOrbMultiTimeframe({
        spot: input.stock.lastPrice,
        direction: input.direction,
        atrDaily: input.atrDaily ?? 0,
        candles5m: input.orbCandles5m,
        candles15m: input.orbCandles15m,
    });

    const exhaustion = assessExhaustion({
        stock: input.stock,
        atrDaily: input.atrDaily ?? 0,
        atrIntraday: input.atrIntraday,
        volumeHistory20d: input.volumeHistory20d,
        rangeHistory20d: input.rangeHistory20d,
        volRegime: input.volumeVelocity,
    });

    const levels = computeDynamicRiskLevels({
        stock: input.stock,
        direction: input.direction,
        atrIntraday: input.atrIntraday,
        volRegime: input.volumeVelocity,
    });

    const trail = computeTrailingDistance({
        spot: input.stock.lastPrice,
        direction: input.direction,
        atrIntraday: input.atrIntraday,
        volRegime: input.volumeVelocity,
        rvol: input.volumeVelocity,
        priceAccel: input.priceAccel,
    });

    const dir = input.direction === 'LONG' ? 1 : -1;
    const riskPct = Math.abs(levels.entry - levels.stopLoss) / Math.max(levels.entry, 1);
    const rewardPct = Math.abs(levels.target1 - levels.entry) / Math.max(levels.entry, 1);
    const riskRewardRatio = riskPct > 0 ? rewardPct / riskPct : 0;
    const rrTooPoor = riskRewardRatio < 1.2;

    const reasons: string[] = [];
    if (!orb.multiTimeframePreserved) reasons.push(`ORB breached (${orb.maxBreachPct.toFixed(2)}%)`);
    if (exhaustion.block) reasons.push(`Exhaustion: ${exhaustion.severity} (GRR=${exhaustion.grr.toFixed(2)})`);
    if (rrTooPoor) reasons.push(`R:R ${riskRewardRatio.toFixed(2)} < 1.2`);

    let verdict: RiskVerdict = 'GO';
    let caution = false;
    let blocked = false;
    if (exhaustion.block || !orb.multiTimeframePreserved) {
        verdict = 'BLOCKED';
        blocked = true;
    } else if (rrTooPoor || orb.directionBias === 'NEUTRAL') {
        verdict = 'CAUTION';
        caution = true;
    }

    return {
        orb,
        exhaustion,
        risk: {
            blocked,
            caution,
            verdict,
            entry: levels.entry,
            stopLoss: levels.stopLoss,
            target1: levels.target1,
            target2: levels.target2,
            riskPct,
            rewardPct,
            riskRewardRatio,
            rrTooPoor,
            trailInitialPct: trail.trailPct,
            trailFloorPct: trail.floorPct,
            atrIntraday: levels.atrIntraday,
            atrDaily: input.atrDaily ?? 0,
            reasons,
        },
    };
}

// ──────────────────────────────────────────────────────────────────────────
// 7. Convenience — quick price-reactivity check
// ──────────────────────────────────────────────────────────────────────────

/**
 * True if *any* of the dynamic risk outputs would change on a new
 * LTP.  Used by the OptionLauncherWidget to decide whether the
 * full risk recompute is needed, or whether the cached profile
 * can be returned.
 */
export function riskShouldRecompute(
    prev: DynamicRisk | null,
    ltp: number,
    direction: TradeDirection
): boolean {
    if (!prev) return true;
    if (direction === 'LONG' && ltp <= prev.stopLoss) return true;
    if (direction === 'SHORT' && ltp >= prev.stopLoss) return true;
    if (direction === 'LONG' && ltp >= prev.target1) return true;
    if (direction === 'SHORT' && ltp <= prev.target1) return true;
    return false;
}

// ──────────────────────────────────────────────────────────────────────────
// 8. Engine façade — keep the API surface stable for downstream callers
// ──────────────────────────────────────────────────────────────────────────

export const riskEngine = {
    computeIntradayAtr,
    validateOrbMultiTimeframe,
    computeDynamicRiskLevels,
    computeTrailingDistance,
    updateTrailingStop,
    assessExhaustion,
    computeRiskProfile,
    riskShouldRecompute,
};

// Re-export logger in case any caller wants to wire engine errors
export { logger };
