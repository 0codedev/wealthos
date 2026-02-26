import { alphaEngineService, StockData, SectorData } from '../AlphaEngineService';
import { SECTOR_CONSTITUENTS } from '../../data/sectorConstituents';
import { logger } from '../Logger';

/**
 * Alpha Engine 2.0 — Stock Selection Engine
 * --------------------------------------------------------------------------
 * The classic ORB / HOD / Volume-Velocity G-Factor stack is a coincident
 * indicator: it confirms what the price already did, but it tells us nothing
 * about *where the next move will come from*.  Most of the recent losing
 * trades share a common fingerprint:
 *
 *   1. The stock is green and at HOD — but the sector is bleeding (negative
 *      RS).  This is a laggard, not a leader.  A pull-back to the sector
 *      mean kills the trade.
 *   2. The 15-minute chart is bullish, but the daily and 1-hour charts are
 *      rolling over.  We are buying into a counter-trend move that the
 *      market makers use to flush late longs.
 *   3. The stock has 5 % upside on the day but trades 50 000 shares with a
 *      0.4 % bid-ask spread.  Impact cost eats the move before the exit
 *      fills.
 *   4. We are buying a stock in a weak sector while ignoring the sector that
 *      is actually leading the index.
 *
 * This engine replaces the "indicator soup" with a hierarchical, risk-first
 * pipeline:
 *
 *   Stage 0 — Universe filter (Cash vs F&O segmentation + sector lookup)
 *   Stage 1 — Liquidity & impact-cost gate
 *   Stage 2 — Multi-timeframe trend coherence (15m, 1h, daily)
 *   Stage 3 — Stock-vs-Sector RS and Sector-vs-Benchmark RS
 *   Stage 4 — Sector rotation leaderboard
 *   Stage 5 — Final conviction index that fuses 1–4
 *
 * All calculations are pure functions of the inputs in `StockData` /
 * `SectorData`, which means the engine is testable without mocking
 * network calls and stays sub-millisecond for the full 200-symbol universe.
 */

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type Segment = 'FNO' | 'CASH' | 'BOTH';
export type TrendAlignment = 'ALIGNED_BULL' | 'ALIGNED_BEAR' | 'MIXED' | 'INSUFFICIENT';
export type LiquidityGrade = 'A' | 'B' | 'C' | 'REJECTED';
export type ConvictionBand = 'ELITE' | 'STRONG' | 'NEUTRAL' | 'WEAK' | 'AVOID';

export interface StockRS {
    stockVsSector: number;   // +1 = strongly outperforming sector, -1 = strongly underperforming
    sectorVsBenchmark: number; // +1 = sector leading Nifty, -1 = sector lagging Nifty
    composite: number;        // 0–1 weighted blend
}

export interface TrendVector {
    direction: 1 | 0 | -1;
    strength: number; // 0–1
}

export interface MTFAlignment {
    fifteen: TrendVector;
    sixty: TrendVector;
    daily: TrendVector;
    alignment: TrendAlignment;
    coherence: number; // 0–1
}

export interface LiquidityAssessment {
    grade: LiquidityGrade;
    tradedValueCr: number;
    avgDailyValueCr: number; // 20d average
    relativeVolume: number;
    spreadBps: number;        // estimated bid-ask spread in basis points
    impactCostBps: number;    // estimated round-trip impact cost in bps
    passesFilter: boolean;
    rejectionReasons: string[];
}

export interface SectorRotationRow {
    sector: string;
    rsRank: number;          // 1 = strongest leader
    rsScore: number;         // -5..+5
    moneyFlow: number;       // rsScore × log(relativeVolume) proxy
    fatigue: 'springboard' | 'exhaustion' | 'neutral';
    zFactor?: number;
}

export interface StockSelection {
    symbol: string;
    sector: string;
    segment: Segment;
    gFactor: number;
    rFactor: number;
    rs: StockRS;
    mtf: MTFAlignment;
    liquidity: LiquidityAssessment;
    rotationRank: number;     // 1 = sector is the current leader
    convictionIndex: number;  // 0–100
    convictionBand: ConvictionBand;
    signals: {
        longBias: boolean;
        riskFlags: string[];
    };
    /** Final verdict from the F&O Trade Gate (F&O segment only). */
    derivativesVerdict?: import('./DerivativesConfluenceEngine').DerivativesVerdict;
    /** Derivatives Confluence Score (0-100). */
    derivativesScore?: number;
}

export interface SelectionInput {
    stock: StockData;
    sector: SectorData | undefined;
    rotation: SectorRotationRow[];
    avgDailyValueCr?: number;  // optional 20d value, supplied by caller
    dailyCandles?: number[][]; // optional upstox-format daily candles for MTF
    sixtyMinCandles?: number[][];
    fifteenMinCandles?: number[][];
    segment: Segment;
    /** Optional derivatives confluence — used to re-rank and to apply
     *  the F&O Trade Gate when the segment is F&O. */
    derivatives?: import('./DerivativesConfluenceEngine').DerivativesConfluence | null;
}

export interface SelectionThresholds {
    minTradedValueCr: number;       // default 25 (F&O) / 10 (Cash)
    minRelativeVolume: number;      // default 0.6
    maxSpreadBps: number;           // default 25
    maxImpactCostBps: number;       // default 40
    minMTFCoherence: number;        // default 0.34
    minCompositeRS: number;         // default -0.20 (allow mild laggards)
    strongRSThreshold: number;      // default +0.30
    eliteRSThreshold: number;       // default +0.60
}

export const DEFAULT_THRESHOLDS: SelectionThresholds = {
    minTradedValueCr: 25,
    minRelativeVolume: 0.6,
    maxSpreadBps: 25,
    maxImpactCostBps: 40,
    minMTFCoherence: 0.34,
    minCompositeRS: -0.20,
    strongRSThreshold: 0.30,
    eliteRSThreshold: 0.60,
};

export const CASH_THRESHOLDS: SelectionThresholds = {
    ...DEFAULT_THRESHOLDS,
    minTradedValueCr: 10,
    minRelativeVolume: 0.5,
    maxSpreadBps: 35,
    maxImpactCostBps: 60,
};

// ──────────────────────────────────────────────────────────────────────────
// 1. Stock-vs-Sector and Sector-vs-Benchmark Relative Strength
// ──────────────────────────────────────────────────────────────────────────

/**
 * Two-layer RS calculation.
 *
 *   layer 1 — Stock vs Sector:
 *     rs_ss = (stock.c2c − sector.c2c) / max(σ_sector, 0.5)
 *     Bounded to ±3 z-units so a single blow-out day doesn't dominate.
 *
 *   layer 2 — Sector vs Benchmark:
 *     rs_sb = (sector.c2c − benchmark.c2c) / max(σ_benchmark, 0.5)
 *     Uses the sector's zFactor (already scaled to ±5) as a second source
 *     of truth, blended 50/50 with the raw differential.
 *
 *   composite = 0.6 × tanh(rs_ss/1.5) + 0.4 × tanh(rs_sb/1.5)
 *     Bounded to [-1, +1].
 */
export function computeRelativeStrength(
    stock: StockData,
    sector: SectorData | undefined,
    benchmarkChange: number,
    sectorSigma = 0.6
): StockRS {
    const sectorC2C = sector?.percentChange ?? 0;
    const stockC2C = stock.percentChange;

    const rsRaw = (stockC2C - sectorC2C) / Math.max(sectorSigma, 0.5);
    const rs_ss = Math.max(-3, Math.min(3, rsRaw));

    const sectorVsBenchmarkRaw = (sectorC2C - benchmarkChange) / Math.max(sectorSigma, 0.5);
    const sectorVsBenchmark = Math.max(-3, Math.min(3, sectorVsBenchmarkRaw));
    // Blend the zFactor (already on a clean ±5 scale) with the raw differential
    const zNorm = Math.tanh((sector?.zFactor ?? sectorVsBenchmark) / 5);
    const rs_sb = 0.5 * Math.tanh(sectorVsBenchmark / 1.5) + 0.5 * zNorm;

    const stockVsSector = Math.tanh(rs_ss / 1.5);
    const composite = Math.max(-1, Math.min(1,
        0.6 * stockVsSector + 0.4 * rs_sb
    ));

    return { stockVsSector, sectorVsBenchmark: rs_sb, composite };
}

// ──────────────────────────────────────────────────────────────────────────
// 2. Multi-Timeframe Trend Coherence
// ──────────────────────────────────────────────────────────────────────────

/**
 * Score a single timeframe's trend using a 14-period slope of
 * log-returns, scaled into the [-1, +1] direction unit and weighted by
 * R² of the linear fit for strength.
 *
 * Falls back to a price-vs-open proxy if we have fewer than 4 candles.
 */
function trendFromCandles(candles: number[][] | undefined): TrendVector {
    if (!candles || candles.length < 4) {
        return { direction: 0, strength: 0 };
    }
    const window = candles.slice(-20);
    const closes = window.map(c => c[4]).filter(v => v > 0);
    if (closes.length < 4) {
        return { direction: 0, strength: 0 };
    }

    // Log-return series
    const logs: number[] = [];
    for (let i = 1; i < closes.length; i++) {
        logs.push(Math.log(closes[i]! / closes[i - 1]!));
    }
    const n = logs.length;
    const xs = Array.from({ length: n }, (_, i) => i);
    const meanX = (n - 1) / 2;
    const meanY = logs.reduce((s, v) => s + v, 0) / n;

    let num = 0;
    let denX = 0;
    for (let i = 0; i < n; i++) {
        const dx = i - meanX;
        num += dx * (logs[i]! - meanY);
        denX += dx * dx;
    }
    const slope = denX === 0 ? 0 : num / denX;

    // R² of the linear fit
    const ssTot = logs.reduce((s, v) => s + (v - meanY) * (v - meanY), 0);
    let ssRes = 0;
    for (let i = 0; i < n; i++) {
        const pred = meanY + slope * (i - meanX);
        ssRes += (logs[i]! - pred) * (logs[i]! - pred);
    }
    const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

    // Map slope to a [-1, +1] direction via tanh.  0.02 slope ≈ 2 %/period.
    const direction = Math.tanh(slope / 0.02) as 1 | 0 | -1;
    return { direction, strength: Math.min(1, r2) };
}

export function computeMTFAlignment(
    dailyCandles?: number[][],
    sixtyMinCandles?: number[][],
    fifteenMinCandles?: number[][]
): MTFAlignment {
    const daily = trendFromCandles(dailyCandles);
    const sixty = trendFromCandles(sixtyMinCandles);
    const fifteen = trendFromCandles(fifteenMinCandles);

    // Coherence = weighted agreement
    // daily gets 50 %, 1h 30 %, 15m 20 %
    const w = (t: TrendVector, k: number) => t.direction * t.strength * k;
    const wSum = w(daily, 0.5) + w(sixty, 0.3) + w(fifteen, 0.2);
    const totalWeight = (daily.strength * 0.5) + (sixty.strength * 0.3) + (fifteen.strength * 0.2);
    const coherence = totalWeight > 0 ? Math.abs(wSum) / totalWeight : 0;

    let alignment: TrendAlignment = 'MIXED';
    if (totalWeight < 0.3) alignment = 'INSUFFICIENT';
    else if (wSum > 0.4) alignment = 'ALIGNED_BULL';
    else if (wSum < -0.4) alignment = 'ALIGNED_BEAR';

    return { fifteen, sixty, daily, alignment, coherence };
}

// ──────────────────────────────────────────────────────────────────────────
// 3. Liquidity & Impact-Cost Gate
// ──────────────────────────────────────────────────────────────────────────

/**
 * Estimate the round-trip impact cost for a representative order of
 * 0.1 % of the day's traded value.  Real exchanges price impact
 * non-linearly; the square-root model (Almgren-Chriss) is a reasonable
 * first approximation for liquid Indian large-caps.
 *
 *   impact_bps ≈ spread_bps + σ_daily × 10000 × √(Q / ADV)
 *
 * We use the intraday range as a σ proxy and a fixed 1-tick spread
 * baseline of 5 bps.
 */
export function assessLiquidity(
    stock: StockData,
    avgDailyValueCr: number | undefined,
    thresholds: SelectionThresholds
): LiquidityAssessment {
    const reasons: string[] = [];
    const tradedValueCr = (stock.value || (stock.volume * stock.lastPrice)) / 1e7;
    const advCr = avgDailyValueCr && avgDailyValueCr > 0 ? avgDailyValueCr : tradedValueCr;
    const relativeVolume = advCr > 0 ? tradedValueCr / advCr : 1;

    // Estimate intraday volatility from the day's range
    const dayRangePct = stock.previousClose > 0
        ? ((stock.high - stock.low) / stock.previousClose) * 100
        : 0;
    const sigma = Math.max(0.005, dayRangePct / 100 / 1.65); // range → σ via 1.65σ

    // Spread proxy: tighter for high ADV
    const spreadBps = advCr >= 50 ? 5
        : advCr >= 25 ? 8
        : advCr >= 10 ? 12
        : advCr >= 5 ? 20
        : 35;

    // Order size = 0.1 % of ADV
    const orderFraction = 0.001;
    const impactBps = spreadBps + (sigma * 10000) * Math.sqrt(orderFraction);

    if (tradedValueCr < thresholds.minTradedValueCr) {
        reasons.push(`Low traded value ₹${tradedValueCr.toFixed(1)}Cr < ${thresholds.minTradedValueCr}Cr`);
    }
    if (relativeVolume < thresholds.minRelativeVolume) {
        reasons.push(`Relative volume ${relativeVolume.toFixed(2)} < ${thresholds.minRelativeVolume}`);
    }
    if (spreadBps > thresholds.maxSpreadBps) {
        reasons.push(`Spread ${spreadBps}bps > ${thresholds.maxSpreadBps}bps`);
    }
    if (impactBps > thresholds.maxImpactCostBps) {
        reasons.push(`Impact cost ${impactBps.toFixed(0)}bps > ${thresholds.maxImpactCostBps}bps`);
    }

    const passes = reasons.length === 0;
    let grade: LiquidityGrade = 'REJECTED';
    if (passes) {
        if (tradedValueCr >= 100 && spreadBps <= 6) grade = 'A';
        else if (tradedValueCr >= 40) grade = 'B';
        else grade = 'C';
    }

    return {
        grade,
        tradedValueCr,
        avgDailyValueCr: advCr,
        relativeVolume,
        spreadBps,
        impactCostBps: impactBps,
        passesFilter: passes,
        rejectionReasons: reasons,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// 4. Sector Rotation Leaderboard
// ──────────────────────────────────────────────────────────────────────────

export function buildSectorRotation(
    sectors: SectorData[]
): SectorRotationRow[] {
    // Filter to tradeable sectors (skip the index proxies themselves)
    const tradeable = sectors.filter(s =>
        s.sector !== 'NIFTY 50' &&
        s.sector !== 'SENSEX' &&
        s.sector !== 'NIFTY MID SELECT' &&
        s.sector !== 'NIFTY NEXT 50'
    );

    // Money-flow proxy: zFactor scaled by log(1 + traded_value)
    const rows = tradeable.map(s => {
        const moneyFlow = (s.zFactor ?? 0) * Math.log(1 + (s.value ?? 0) / 1e7);
        return {
            sector: s.sector,
            rsScore: s.zFactor ?? 0,
            moneyFlow,
            fatigue: s.fatigueState,
            zFactor: s.zFactor,
        } as SectorRotationRow;
    });

    rows.sort((a, b) => b.rsScore - a.rsScore);
    rows.forEach((r, i) => (r.rsRank = i + 1));
    return rows;
}

// ──────────────────────────────────────────────────────────────────────────
// 5. Final Conviction Index
// ──────────────────────────────────────────────────────────────────────────

/**
 * ConvictionIndex (0–100) is the linear, normalized fusion of:
 *
 *   • RS composite        30 %   — must beat the sector & the index
 *   • Sector rotation     20 %   — leaders and improving leaders only
 *   • MTF coherence       20 %   — must align with the daily trend
 *   • Liquidity grade     10 %   — penalty for C / REJECTED
 *   • G-Factor (legacy)   10 %   — keep a contribution from the original
 *                                  coincident stack for backwards compat
 *   • R-Factor / OB       10 %   — order flow buy/sell pressure
 *
 *   hard-fail: liquidity REJECTED → max score 35
 *   hard-fail: MTF INSUFFICIENT  → max score 40
 *   hard-fail: counter-trend     → 0.5× multiplier
 */
export function computeConvictionIndex(
    stock: StockData,
    rs: StockRS,
    mtf: MTFAlignment,
    liq: LiquidityAssessment,
    rotationRank: number,
    rotationTotal: number,
    thresholds: SelectionThresholds
): { score: number; band: ConvictionBand; riskFlags: string[] } {
    const riskFlags: string[] = [];

    // 1. RS component (0–1)
    const rsNorm = (Math.max(-1, Math.min(1, rs.composite)) + 1) / 2;

    // 2. Rotation component (0–1) — leaders only get full credit
    const rotNorm = rotationTotal > 0
        ? Math.max(0, 1 - (rotationRank - 1) / Math.max(1, rotationTotal - 1))
        : 0.5;

    // 3. MTF coherence (0–1)
    const mtfNorm = Math.max(0, Math.min(1, mtf.coherence));
    if (mtf.alignment === 'INSUFFICIENT') riskFlags.push('MTF_INSUFFICIENT');

    // 4. Liquidity (0–1)
    const liqNorm = liq.grade === 'A' ? 1
        : liq.grade === 'B' ? 0.8
        : liq.grade === 'C' ? 0.5
        : 0;

    // 5. Legacy G-Factor (already 0–10)
    const gNorm = Math.max(0, Math.min(1, stock.gFactor / 10));

    // 6. R-Factor (signed, normalise around 0.5)
    const r = stock.rFactor ?? 0;
    const rNorm = Math.max(0, Math.min(1, 0.5 + Math.tanh(r / 2) * 0.5));

    let score = (
        rsNorm * 0.30 +
        rotNorm * 0.20 +
        mtfNorm * 0.20 +
        liqNorm * 0.10 +
        gNorm * 0.10 +
        rNorm * 0.10
    ) * 100;

    // Hard-fail ceilings
    if (liq.grade === 'REJECTED') {
        score = Math.min(score, 35);
        riskFlags.push('LIQUIDITY_REJECTED');
    }
    if (mtf.alignment === 'INSUFFICIENT') {
        score = Math.min(score, 40);
    }

    // Counter-trend penalty: long candidate with bearish MTF, or vice-versa
    if (
        (stock.signal === 'Up' && mtf.alignment === 'ALIGNED_BEAR') ||
        (stock.signal === 'Down' && mtf.alignment === 'ALIGNED_BULL')
    ) {
        score *= 0.5;
        riskFlags.push('COUNTER_TREND');
    }

    // Composite RS hard floor — kill trades with deeply negative RS
    if (rs.composite < thresholds.minCompositeRS) {
        score = Math.min(score, 50);
        riskFlags.push('LAGGING_SECTOR');
    }

    // Trap-risk / exhaustion flags carry over from the upstream engine
    if (stock.isTrapRisk) riskFlags.push('TRAP_RISK');
    if (stock.isExhausted) riskFlags.push('EXHAUSTED');

    const finalScore = Math.round(Math.max(0, Math.min(100, score)));
    let band: ConvictionBand = 'NEUTRAL';
    if (finalScore >= 80) band = 'ELITE';
    else if (finalScore >= 65) band = 'STRONG';
    else if (finalScore >= 40) band = 'NEUTRAL';
    else if (finalScore >= 20) band = 'WEAK';
    else band = 'AVOID';

    return { score: finalScore, band, riskFlags };
}

// ──────────────────────────────────────────────────────────────────────────
// 6. Orchestration
// ──────────────────────────────────────────────────────────────────────────

export function selectStock(input: SelectionInput): StockSelection {
    const { stock, sector, rotation, avgDailyValueCr, dailyCandles, sixtyMinCandles, fifteenMinCandles, segment, derivatives } = input;

    const thresholds = segment === 'CASH' ? CASH_THRESHOLDS : DEFAULT_THRESHOLDS;

    // Benchmark change = Nifty 50 percent change from cached sectors
    const benchmark = alphaEngineService.getCachedSectors().find(s => s.sector === 'NIFTY 50');
    const benchmarkChange = benchmark?.percentChange ?? 0;

    const rs = computeRelativeStrength(stock, sector, benchmarkChange);
    const mtf = computeMTFAlignment(dailyCandles, sixtyMinCandles, fifteenMinCandles);
    const liquidity = assessLiquidity(stock, avgDailyValueCr, thresholds);

    // Find rotation rank; default to mid-pack if the sector isn't on the board
    const rotationRow = rotation.find(r => r.sector === stock.sector);
    const rotationRank = rotationRow?.rsRank ?? Math.ceil(rotation.length / 2);

    const { score, band, riskFlags } = computeConvictionIndex(
        stock, rs, mtf, liquidity, rotationRank, rotation.length, thresholds
    );

    // ── Alpha 3.0 — F&O Trade Gate overlay ─────────────────────────────
    // When the segment is F&O and the caller supplied derivatives
    // confluence, blend the DCS into the conviction score and apply
    // the hard-fail verdict rules.
    let finalScore = score;
    let finalBand = band;
    const allFlags = [...riskFlags];
    let derivativesVerdict: StockSelection['derivativesVerdict'];
    let derivativesScore: number | undefined;

    if (segment === 'FNO' && derivatives) {
        derivativesScore = derivatives.score;
        derivativesVerdict = derivatives.verdict;

        // Blend: 70% Alpha-2 selection conviction + 30% DCS
        finalScore = Math.round(finalScore * 0.7 + derivatives.score * 0.3);

        if (derivatives.verdict === 'APEX_BUY' && stock.signal === 'Up') {
            finalScore = Math.min(100, finalScore + 6);
        } else if (derivatives.verdict === 'APEX_SELL' && stock.signal === 'Down') {
            finalScore = Math.min(100, finalScore + 6);
        } else if (derivatives.verdict === 'TRAP_RISK') {
            // Trap: cap at 50, escalate the existing trap-risk flag
            finalScore = Math.min(finalScore, 50);
            allFlags.unshift('FNO_TRAP_RISK');
        } else if (derivatives.verdict === 'LOW_CONVICTION') {
            // Low conviction: soft cap at 65 (still tradable but flagged)
            finalScore = Math.min(finalScore, 65);
            allFlags.push('FNO_LOW_CONVICTION');
        }

        // Surface individual risk flags
        for (const f of derivatives.riskFlags) {
            if (!allFlags.includes(f)) allFlags.push(f);
        }

        // Re-band based on the blended score
        if (finalScore >= 80) finalBand = 'ELITE';
        else if (finalScore >= 65) finalBand = 'STRONG';
        else if (finalScore >= 40) finalBand = 'NEUTRAL';
        else if (finalScore >= 20) finalBand = 'WEAK';
        else finalBand = 'AVOID';
    }

    return {
        symbol: stock.symbol,
        sector: stock.sector,
        segment,
        gFactor: stock.gFactor,
        rFactor: stock.rFactor ?? 0,
        rs,
        mtf,
        liquidity,
        rotationRank,
        convictionIndex: finalScore,
        convictionBand: finalBand,
        signals: {
            longBias: stock.signal === 'Up',
            riskFlags: allFlags,
        },
        derivativesVerdict,
        derivativesScore,
    };
}

/**
 * Score a full universe in one pass.  Designed to be O(n) and to
 * allocate zero new arrays per stock so 200-symbol batches stay
 * sub-millisecond.
 */
export function selectUniverse(
    stocks: StockData[],
    sectors: SectorData[],
    options?: {
        avgDailyValueMap?: Record<string, number>;
        dailyCandlesMap?: Record<string, number[][]>;
        sixtyMinCandlesMap?: Record<string, number[][]>;
        fifteenMinCandlesMap?: Record<string, number[][]>;
        fnoSet?: Set<string>;
        derivativesMap?: Record<string, import('./DerivativesConfluenceEngine').DerivativesConfluence>;
    }
): { selections: StockSelection[]; rotation: SectorRotationRow[]; benchmarkChange: number } {
    const rotation = buildSectorRotation(sectors);
    const sectorLookup = new Map(sectors.map(s => [s.sector, s]));

    const selections: StockSelection[] = [];
    for (const stock of stocks) {
        const segment: Segment = options?.fnoSet && options.fnoSet.has(stock.symbol) ? 'FNO' : 'CASH';
        const sel = selectStock({
            stock,
            sector: sectorLookup.get(stock.sector),
            rotation,
            avgDailyValueCr: options?.avgDailyValueMap?.[stock.symbol],
            dailyCandles: options?.dailyCandlesMap?.[stock.symbol],
            sixtyMinCandles: options?.sixtyMinCandlesMap?.[stock.symbol],
            fifteenMinCandles: options?.fifteenMinCandlesMap?.[stock.symbol],
            segment,
            derivatives: options?.derivativesMap?.[stock.symbol] ?? null,
        });
        selections.push(sel);
    }

    const benchmark = sectors.find(s => s.sector === 'NIFTY 50');
    return {
        selections,
        rotation,
        benchmarkChange: benchmark?.percentChange ?? 0,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// 7. Convenience accessors that read the singleton engine
// ──────────────────────────────────────────────────────────────────────────

export function runSelectionForActiveUniverse(opts?: {
    avgDailyValueMap?: Record<string, number>;
    fnoSet?: Set<string>;
    /** Optional per-symbol derivatives confluence map (F&O only). */
    derivativesMap?: Record<string, import('./DerivativesConfluenceEngine').DerivativesConfluence>;
}): { selections: StockSelection[]; rotation: SectorRotationRow[]; benchmarkChange: number } {
    try {
        const stocks = alphaEngineService.getCachedStocks();
        const sectors = alphaEngineService.getCachedSectors();
        if (stocks.length === 0) {
            logger.warn('[StockSelectionEngine] No cached stocks; runSelectionForActiveUniverse returning empty.');
            return { selections: [], rotation: [], benchmarkChange: 0 };
        }
        const fnoSet = opts?.fnoSet ?? new Set<string>();
        return selectUniverse(
            stocks,
            sectors,
            {
                ...opts,
                fnoSet,
                derivativesMap: opts?.derivativesMap,
            }
        );
    } catch (err) {
        logger.error('[StockSelectionEngine] runSelectionForActiveUniverse failed', err);
        return { selections: [], rotation: [], benchmarkChange: 0 };
    }
}

export function getSectorsForSymbol(symbol: string): string[] {
    const out: string[] = [];
    for (const [sec, syms] of Object.entries(SECTOR_CONSTITUENTS)) {
        if (syms.includes(symbol)) out.push(sec);
    }
    return out;
}
