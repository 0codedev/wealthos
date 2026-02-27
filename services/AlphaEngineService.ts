import { llmPipeline } from './llm';
import { logger } from './Logger';
import { OrderBookSignal } from './OrderBookIntelligenceService';
import { getHistRatio } from './IntradayCandleService';

// ... (existing exports and interfaces)
import { optionChainService } from './OptionChainService';
import { FNO_STOCKS } from '../data/fno_stocks';
import { SECTOR_CONSTITUENTS } from '../data/sectorConstituents';
import { YahooHistoricalService } from './backtester/YahooHistoricalService';
import { orderFlowService } from './OrderFlowService';
import { upstoxMarketDataService } from './UpstoxMarketDataService';
import { useSettingsStore } from '../store/settingsStore';
import { alphaCache } from '../lib/alphaCache';
import { fetchCoordinator } from '../lib/fetchCoordinator';

export type XFactorMode = 'TRADER_INTENT' | 'QUANT_RELATIVE';

export interface SectorData {
    sector: string;
    lastPrice: number;
    percentChange: number;
    previousClose: number;
    strengthRatio: number; // Sector X-Factor Multiplier (vs Nifty 50)
    fatigueScore: number;  // Consecutive days direction (e.g. -4 or +3)
    fatigueState: 'springboard' | 'exhaustion' | 'neutral';
    openPrice?: number;
    openChangePct?: number;
    highPrice?: number;
    lowPrice?: number;
    l2cChangePct?: number;
    h2cChangePct?: number;
    confluenceScore?: number; // -100 to +100
    confluenceGrade?: 'ELITE BULLISH' | 'STRONG BULLISH' | 'NEUTRAL' | 'STRONG BEARISH' | 'ELITE BEARISH';
    bullsBearsRatio?: number;
    intradayBoosterCount?: number;
    topDriverSymbol?: string;
    topDriverStrength?: number;
    yearHigh?: number;
    yearLow?: number;
    perChange30d?: number;
    perChange365d?: number;
    pe?: number;
    pb?: number;
    dy?: number;
    zFactor?: number;
    xFactorMode?: XFactorMode;
    volume?: number;
    value?: number;
}

export interface StockData {
    symbol: string;
    sector: string;
    lastPrice: number;
    previousClose: number;
    openPrice: number;
    high: number;
    low: number;
    percentChange: number;
    volume: number;
    value: number; // Traded value
    gFactor: number;
    rFactor?: number;
    apexSignal?: string;
    signal: 'Up' | 'Down';
    openingGapPct: number;      // (Open - prevClose) / prevClose * 100
    dayExtremeScore: number;    // (LTP - Low) / (High - Low), 1.0 = at high, 0.0 = at low
    // Derived Rule Flags
    isORBLowPreservedProxy: boolean;
    isORBHighPreservedProxy: boolean;
    openChangePct: number;      // (LTP - Open) / Open * 100

    // New Intraday Rebound & Exhaustion metrics
    atr?: number;
    grr?: number;
    ovr?: number;
    isExhausted?: boolean;
    isTrapRisk?: boolean;
    isRebound?: boolean;
    yearHigh?: number;
    yearLow?: number;
    perChange30d?: number;
    perChange365d?: number;
    oi?: number;
    dai?: number;
    depth_pressure?: 'BUY_SIDE' | 'SELL_SIDE' | 'NEUTRAL';
    orderBookSignal?: OrderBookSignal;

    // Strategy Integration Fields
    atp?: number;
    upperCircuit?: number;
    lowerCircuit?: number;
    ohlc_intervals?: Record<string, any>;
    candleBuffer?: {
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        ts: number | string;
    }[];
    timeOfDayRvol?: number | null;
    rvol?: number;
}

export interface MarketMood {
    isBullish: boolean;
    ceVelocity: number;
    peVelocity: number;
    timestamp: string;
}

interface SectorConfig {
    name: string;
    nseIndexSymbol?: string;
    yahooSymbol?: string;
}

const SECTOR_CONFIGS: SectorConfig[] = [
    { name: 'IT', nseIndexSymbol: 'NIFTY IT', yahooSymbol: '^CNXIT' },
    { name: 'NIFTY MID SELECT', nseIndexSymbol: 'NIFTY MID SELECT', yahooSymbol: '^NSEMDCP50' },
    { name: 'NIFTY 50', nseIndexSymbol: 'NIFTY 50', yahooSymbol: '^NSEI' },
    { name: 'SENSEX', nseIndexSymbol: 'NIFTY 50', yahooSymbol: '^BSESN' }, // Fallback to NIFTY 50 for NSE feed
    { name: 'FIN SERVICE', nseIndexSymbol: 'NIFTY FIN SERVICE', yahooSymbol: '^CNXFIN' },
    { name: 'FMCG', nseIndexSymbol: 'NIFTY FMCG', yahooSymbol: '^CNXFMCG' },
    { name: 'REALTY', nseIndexSymbol: 'NIFTY REALTY', yahooSymbol: '^CNXREALTY' },
    { name: 'PHARMA', nseIndexSymbol: 'NIFTY PHARMA', yahooSymbol: '^CNXPHARMA' },
    { name: 'OIL & GAS', nseIndexSymbol: 'NIFTY OIL AND GAS', yahooSymbol: '^CNXENERGY' },
    { name: 'CEMENT', nseIndexSymbol: 'NIFTY CEMENT', yahooSymbol: 'ULTRACEMCO.NS' }, // Direct index payload
    { name: 'BANK', nseIndexSymbol: 'NIFTY BANK', yahooSymbol: '^NSEBANK' },
    { name: 'PVT BANK', nseIndexSymbol: 'NIFTY PVT BANK', yahooSymbol: 'NIFTY_PVT_BANK.NS' },
    { name: 'METAL', nseIndexSymbol: 'NIFTY METAL', yahooSymbol: '^CNXMETAL' },
    { name: 'PSU BANK', nseIndexSymbol: 'NIFTY PSU BANK', yahooSymbol: '^CNXPSUBANK' },
    { name: 'AUTO', nseIndexSymbol: 'NIFTY AUTO', yahooSymbol: '^CNXAUTO' },
    { name: 'CONSUMER DURABLES', nseIndexSymbol: 'NIFTY CONSR DURBL', yahooSymbol: 'BSE-CD.BO' },
    { name: 'DEFENSE', nseIndexSymbol: 'NIFTY INDIA DEFENCE', yahooSymbol: 'HAL.NS' },
    { name: 'HEALTHCARE', nseIndexSymbol: 'NIFTY HEALTHCARE', yahooSymbol: '^CNXPHARMA' },
    { name: 'CHEMICALS', nseIndexSymbol: 'NIFTY CHEMICALS', yahooSymbol: 'TATACHEM.NS' },
    { name: 'MEDIA', nseIndexSymbol: 'NIFTY MEDIA', yahooSymbol: '^CNXMEDIA' },
    { name: 'CAPITAL MARKETS', nseIndexSymbol: 'NIFTY CAPITAL MKT', yahooSymbol: 'BSE.NS' },
    { name: 'ENERGY', nseIndexSymbol: 'NIFTY ENERGY', yahooSymbol: '^CNXENERGY' },
    { name: 'CAP GOODS', yahooSymbol: 'LT.NS' },
    { name: 'SERVICES', nseIndexSymbol: 'NIFTY SERV SECTOR', yahooSymbol: 'ADANIPORTS.NS' }
];

export const SECTOR_ZFACTOR_INDEX_MAP: Record<string, string> = {
    'NIFTY 50': 'NSE_INDEX|Nifty 50',
    'BANK': 'NSE_INDEX|Nifty Bank',
    'IT': 'NSE_INDEX|Nifty IT',
    'AUTO': 'NSE_INDEX|Nifty Auto',
    'PHARMA': 'NSE_INDEX|Nifty Pharma',
    'FMCG': 'NSE_INDEX|Nifty FMCG',
    'METAL': 'NSE_INDEX|Nifty Metal',
    'REALTY': 'NSE_INDEX|Nifty Realty',
    'PSU BANK': 'NSE_INDEX|Nifty PSU Bank',
    'FIN SERVICE': 'NSE_INDEX|Nifty Fin Service',
    'NIFTY MID SELECT': 'NSE_INDEX|NIFTY MID SELECT',
    'PVT BANK': 'NSE_INDEX|Nifty Pvt Bank',
    'CONSUMER DURABLES': 'NSE_INDEX|NIFTY CONSR DURBL',
    'OIL & GAS': 'NSE_INDEX|NIFTY OIL AND GAS',
    'DEFENSE': 'NSE_INDEX|Nifty Ind Defence',
    'CEMENT': 'NSE_INDEX|Nifty Cement',
    'SERVICES': 'NSE_INDEX|Nifty Serv Sector',
    'HEALTHCARE': 'NSE_INDEX|NIFTY HEALTHCARE',
    'CHEMICALS': 'NSE_INDEX|Nifty Chemicals',
    'MEDIA': 'NSE_INDEX|Nifty Media',
    'CAPITAL MARKETS': 'NSE_INDEX|Nifty Capital Mkt',
    'ENERGY': 'NSE_INDEX|Nifty Energy'
};

/**
 * Alpha Engine 2.0 — Z-Factor Statistics
 *
 * Replaces the v1 arithmetic-return / SMA-volume implementation with
 * a log-normal volatility estimator and a 20-candle time-decay
 * (Volume-Weighted EMA) volume baseline.
 *
 * Properties:
 *   - Log returns handle multiplicative price moves correctly
 *     (Brownian motion is log-normal, not arithmetic).
 *   - Time-decay weighting means the most recent ~5 candles
 *     contribute ~63% of the EMA, giving higher relevance to
 *     recent volume spikes.
 *   - The function is O(n) with no allocations per candle
 *     (only one floating-point accumulator for the EMA).
 *   - Mathematically safe against divide-by-zero and NaN by
 *     floor-guarding both outputs.
 *
 * @param candles - Upstox-format candles: [ts, open, high, low, close, volume, oi]
 * @returns Object with `log_std` (volatility, decimal), `wma_vol` (volume baseline),
 *          `logReturns` (cached return series for downstream consumers)
 */
export function computeZFactorStats(
    candles: number[][]
): { log_std: number; wma_vol: number; logReturns: { date: string | number; val: number }[] } {
    if (!candles || candles.length === 0) {
        return { log_std: 0.005, wma_vol: 1, logReturns: [] };
    }

    // Clone and sort candles chronologically (oldest first) by timestamp (index 0)
    const sortedCandles = [...candles].sort((a, b) => {
        const tA = a[0];
        const tB = b[0];
        if (typeof tA === 'number' && typeof tB === 'number') {
            return tA - tB;
        }
        return String(tA).localeCompare(String(tB));
    });

    // ── Step 1: Log returns ─────────────────────────────────────────────
    // r_t = ln(Close_t / Close_t-1)  (mathematically symmetric, additive)
    const logReturns: { date: string | number; val: number }[] = [];
    for (let i = 1; i < sortedCandles.length; i++) {
        const prevClose = sortedCandles[i - 1]?.[4];
        const currClose = sortedCandles[i]?.[4];
        const date = sortedCandles[i]?.[0];
        if (prevClose && currClose && prevClose > 0 && currClose > 0 && date !== undefined) {
            logReturns.push({ date, val: Math.log(currClose / prevClose) });
        }
    }

    if (logReturns.length === 0) {
        return { log_std: 0.005, wma_vol: 1, logReturns: [] };
    }

    // ── Step 2: Volatility = stdev of log returns ────────────────────────
    // Population stdev is fine here — we treat the 20-candle window as
    // a sample of the recent distribution rather than as the full population.
    const n = logReturns.length;
    const mean = logReturns.reduce((s, v) => s + v.val, 0) / n;
    const variance = logReturns.reduce((s, v) => s + (v.val - mean) * (v.val - mean), 0) / n;
    // Floor at 0.005 (= 0.5% daily σ floor) to avoid divide-by-zero downstream.
    const log_std = Math.sqrt(variance) || 0.005;

    // ── Step 3: Volume-Weighted EMA over the last 20 candles ────────────
    // EMA constant k = 2 / (N+1), N = 20 → k ≈ 0.0952
    // We initialize with the first available volume to avoid a warm-up bias.
    const lookback = 20;
    const start = Math.max(0, sortedCandles.length - lookback);
    const window = sortedCandles.slice(start);
    const alpha = 2 / (window.length + 1); // span-based smoothing
    let ema = window[0]?.[5] ?? 1;
    for (let i = 1; i < window.length; i++) {
        const v = window[i]?.[5] ?? 0;
        ema = v * alpha + ema * (1 - alpha);
    }
    const wma_vol = ema || 1; // floor at 1 to avoid 0/0

    return { log_std, wma_vol, logReturns };
}

// ────────────────────────────────────────────────────────────────────────────
// Alpha Engine 2.0 — Cross-sectional + Benchmark Robust Statistics Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Cross-sectional Median (in-place-safe via copy).
 * O(n log n) for a fresh sort; tolerant to non-finite values.
 */
export function medianOf(values: number[]): number {
    const clean = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
    const n = clean.length;
    if (n === 0) return 0;
    return n % 2 === 0
        ? ((clean[n / 2 - 1] ?? 0) + (clean[n / 2] ?? 0)) / 2
        : (clean[(n - 1) / 2] ?? 0);
}

// ────────────────────────────────────────────────────────────────────────────
// CC68.35 — Adaptive Momentum Filter (pure helpers, exported for tests).
//
// These functions are pure and stateless on purpose: the production code in
// AlphaEngineService owns the per-sector state (prevRaw, rolling variance),
// but the formula itself lives here so it can be unit-tested in isolation
// without spinning up the singleton or stubbing Upstox.
// ────────────────────────────────────────────────────────────────────────────

/**
 * One step of the Adaptive Momentum Filter.
 *
 *   Dynamic_Alpha = clamp( max(MIN_ALPHA, |Δ raw| / stdev), MIN_ALPHA, 1 )
 *   Smoothed(t)   = α·Raw(t) + (1 − α)·Smoothed(t−1)
 *
 * @param rawEnergy        Current tick's raw energy (alpha × compressedVol).
 * @param prevRawEnergy    Raw energy from the previous tick. `null` on the
 *                         very first observation → returns `rawEnergy` as-is
 *                         and seeds the rolling variance with `|rawEnergy|`.
 * @param prevRollingVar   Rolling variance of |Δ raw|² from the previous tick.
 *                         `null` on the first observation.
 * @param prevSmoothed     Smoothed score from the previous tick. `null` on the
 *                         first observation → returns `rawEnergy` as-is.
 * @param opts             Tuning constants. Defaults match the production
 *                         engine (MIN_ALPHA=0.25, VAR_DECAY=0.30, SAFE_VAR=0.01).
 *
 * @returns `{ smoothed, newRollingVar, dynamicAlpha }`. None of these should
 *          be NaN — division-by-zero and zero-variance are guarded.
 */
export function adaptiveMomentumStep(
    rawEnergy: number,
    prevRawEnergy: number | null,
    prevRollingVar: number | null,
    prevSmoothed: number | null,
    opts: { minAlpha?: number; varDecay?: number; safeVar?: number } = {}
): { smoothed: number; newRollingVar: number; dynamicAlpha: number } {
    const minAlpha = opts.minAlpha ?? 0.25;
    const varDecay = opts.varDecay ?? 0.30;
    const safeVar = opts.safeVar ?? 0.01;

    // ── 0. Sanitize raw input. Bad ticks (NaN, ±Infinity) must not poison
    //      the smoothing state — the engine has to keep running for the
    //      next valid tick. We coerce to 0 and continue.
    const raw = Number.isFinite(rawEnergy) ? rawEnergy : 0;
    // If the previous tick was also non-finite, treat the chain as "no
    // history" and just return the raw value without touching the state.
    const prevRaw = (prevRawEnergy !== null && Number.isFinite(prevRawEnergy)) ? prevRawEnergy : null;
    const prevVar = (prevRollingVar !== null && Number.isFinite(prevRollingVar)) ? prevRollingVar : null;
    const prevSm = (prevSmoothed !== null && Number.isFinite(prevSmoothed)) ? prevSmoothed : null;

    // ── 1. Update rolling variance of |Δ raw|² via exponential decay ─────
    let newRollingVar: number;
    if (prevRaw === null || prevVar === null) {
        // First-ever tick: seed variance with |raw|² (clamped to safe floor)
        // so the very next tick has a meaningful denominator.
        newRollingVar = Math.max(Math.abs(raw), safeVar);
    } else {
        const sq = Math.pow(raw - prevRaw, 2);
        newRollingVar = (1 - varDecay) * prevVar + varDecay * sq;
        if (newRollingVar < safeVar) {
            newRollingVar = safeVar; // freeze-proof floor
        }
    }

    // ── 2. Compute dynamic alpha from the magnitude of the regime shift ──
    let dynamicAlpha = minAlpha;
    if (prevRaw !== null) {
        const delta = Math.abs(raw - prevRaw);
        const stdev = Math.sqrt(newRollingVar);
        // Ratio is in "how many stdevs did we just move" units. Capped at 1.
        const ratio = stdev > 0 ? delta / stdev : minAlpha;
        dynamicAlpha = Math.max(minAlpha, Math.min(1, ratio));
    }

    // ── 3. Apply the adaptive smoothing ─────────────────────────────────
    const smoothed = prevSm !== null
        ? raw * dynamicAlpha + prevSm * (1 - dynamicAlpha)
        : raw;

    return { smoothed, newRollingVar, dynamicAlpha };
}

/**
 * CC68.36 — Loosened tanh squash for the X-Factor output.
 *
 *   xFactor = tanh(robustScore / 3.0) × 5.0
 *
 * The old denominator was 2.0 which compressed the ±1 robust-score band
 * into roughly ±2.1 (already half-saturated). With 3.0 the same band
 * reads as ±1.6, the median bucket (±0.5) reads as ±0.83 (vs ±0.46
 * before), and only truly outlier sectors (|robust| > 3) approach
 * saturation. The chart axis stays at ±5.0 so users see a wider spread
 * without changing the legend.
 *
 * Input: a robust score already normalised by MAD (median-centred,
 *        MAD-scaled, winsorised). Output: X-Factor on [-5, +5].
 */
export function xFactorTanh(robustScore: number): number {
    if (!Number.isFinite(robustScore)) return 0;
    const x = Math.tanh(robustScore / 3.0) * 5.0;
    if (isNaN(x) || !isFinite(x)) return 0;
    return Number(x.toFixed(4));
}

/**
 * Median Absolute Deviation — robust L1-equivalent of stdev.
 * Returns MAD × 1.4826 (Gaussian-consistent constant) so the result
 * is directly comparable to a regular standard deviation.
 */
export function medianAbsoluteDeviation(values: number[], med: number): number {
    const deviations = values
        .filter(v => Number.isFinite(v))
        .map(v => Math.abs(v - med))
        .sort((a, b) => a - b);
    const mad = medianOf(deviations);
    return mad * 1.4826;
}

/**
 * Winsorize a series at the supplied percentile bounds (e.g. 0.05 / 0.95).
 * Values below the lower bound are clamped to the bound, and likewise for the upper.
 * Removes the influence of extreme outliers without dropping observations.
 */
export function winsorize(values: number[], lowerPct: number, upperPct: number): number[] {
    if (values.length === 0) return [];
    const sorted = [...values].filter(v => Number.isFinite(v)).sort((a, b) => a - b);
    const lo = sorted[Math.max(0, Math.floor(sorted.length * lowerPct))] ?? 0;
    const hi = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * upperPct) - 1)] ?? 0;
    return values.map(v => {
        if (!Number.isFinite(v)) return med_approx(values);
        if (v < lo) return lo;
        if (v > hi) return hi;
        return v;
    });
}

function med_approx(values: number[]): number {
    return medianOf(values);
}

/**
 * Beta coefficient — Cov(sector, benchmark) / Var(benchmark).
 * Bounded away from zero so the X-Factor denominator never explodes.
 */
export function computeBeta(
    sectorReturns: { date: string | number; val: number }[],
    benchmarkReturns: { date: string | number; val: number }[]
): number {
    if (!sectorReturns.length || !benchmarkReturns.length) return 1;

    // Create a map of benchmark returns keyed by date (as string) to align them
    const benchmarkMap = new Map<string, number>();
    benchmarkReturns.forEach(r => {
        benchmarkMap.set(String(r.date), r.val);
    });

    const alignedSector: number[] = [];
    const alignedBenchmark: number[] = [];

    sectorReturns.forEach(r => {
        const dateKey = String(r.date);
        if (benchmarkMap.has(dateKey)) {
            alignedSector.push(r.val);
            alignedBenchmark.push(benchmarkMap.get(dateKey)!);
        }
    });

    const n = alignedSector.length;
    if (n < 2) return 1;

    const sMean = alignedSector.reduce((s, v) => s + v, 0) / n;
    const bMean = alignedBenchmark.reduce((s, v) => s + v, 0) / n;
    let cov = 0;
    let bVar = 0;
    for (let i = 0; i < n; i++) {
        const sR = alignedSector[i] - sMean;
        const bR = alignedBenchmark[i] - bMean;
        cov += sR * bR;
        bVar += bR * bR;
    }
    if (bVar === 0) return 1;
    const beta = cov / bVar;
    // Clamp to a sensible range so a single bad window doesn't blow up the signal.
    if (!Number.isFinite(beta)) return 1;
    return Math.max(-3, Math.min(3, beta));
}

export interface GFactorInputs {
    percentChange: number;
    openingGapPct: number;
    ltp: number;
    high: number;
    low: number;
    openPrice: number;
    rvol: number;
    tps?: number;
    gravityScore?: number;
}

export function computeGFactor(inputs: GFactorInputs): number {
    const { percentChange, openingGapPct, ltp, high, low, openPrice, rvol, tps, gravityScore } = inputs;
    
    // Continuous Logistic Sigmoid Activation: S(x; x0, k) = 1 / (1 + exp(-k * (x - x0)))
    const sigmoid = (x: number, x0: number, k: number): number => {
        return 1.0 / (1.0 + Math.exp(-Math.max(-20, Math.min(20, k * (x - x0)))));
    };

    let score = 0;
    const isBull = percentChange >= 0;

    if (isBull) {
        // 1. ORB Low Preserved (Continuous Sigmoid, Max 3.5 points)
        // High score when low stays close to or above openPrice
        const lowRatio = openPrice > 0 ? low / openPrice : 1.0;
        const orbScore = 3.5 * sigmoid(lowRatio, 0.9985, 400);
        score += orbScore;

        // 2. HOD Breakout Proximity (Continuous Sigmoid, Max 3.0 points)
        // High score when LTP pushes towards or above High of Day
        const hodRatio = high > 0 ? ltp / high : 1.0;
        const hodScore = 3.0 * sigmoid(hodRatio, 0.998, 300);
        score += hodScore;

        // 3. Volume Surge (Continuous Sigmoid, Max 2.0 points)
        const volScore = 2.0 * sigmoid(rvol, 1.5, 2.5);
        score += volScore;

        // 4. Gap Up (Continuous Sigmoid, Max 1.5 points)
        const gapScore = 1.5 * sigmoid(openingGapPct, 0.5, 3.0);
        score += gapScore;

        // 5. Trend Magnitude (Up to 2.0 points)
        score += Math.min(percentChange * 0.3, 2.0);
    } else {
        // 1. ORB High Preserved on downside (Max 3.5 points)
        const highRatio = openPrice > 0 ? high / openPrice : 1.0;
        const orbScore = 3.5 * sigmoid(1.0015, highRatio, 400);
        score += orbScore;

        // 2. LOD Breakdown Proximity (Max 3.0 points)
        const lodRatio = low > 0 ? ltp / low : 1.0;
        const lodScore = 3.0 * sigmoid(1.002, lodRatio, 300);
        score += lodScore;

        // 3. Volume Surge on Selloff (Max 2.0 points)
        const volScore = 2.0 * sigmoid(rvol, 1.5, 2.5);
        score += volScore;

        // 4. Gap Down (Max 1.5 points)
        const gapScore = 1.5 * sigmoid(-openingGapPct, 0.5, 3.0);
        score += gapScore;

        // 5. Trend Magnitude
        score += Math.min(Math.abs(percentChange) * 0.3, 2.0);
    }
    
    // Institutional Trade Intensity Boost (Smooth Sigmoid, up to 1.5 points)
    if (tps && tps > 0) {
        const tpsBoost = 1.5 * sigmoid(tps, 3.0, 1.2);
        score += tpsBoost;
    }

    // Buyer/Seller Gravity Score (Tanh saturation, up to 1.0 point)
    if (gravityScore !== undefined && gravityScore !== null) {
        if (isBull && gravityScore > 0.05) {
            score += 1.0 * Math.tanh(gravityScore * 2.0);
        } else if (!isBull && gravityScore < -0.05) {
            score += 1.0 * Math.tanh(Math.abs(gravityScore) * 2.0);
        }
    }
    
    return Number(Math.min(score, 10.0).toFixed(2));
}


/**
 * Backwards-compatible adapter that maps the new log_std / wma_vol
 * outputs onto the legacy { std_dev, sma_vol } keys used by the rest
 * of the engine.  std_dev is the log_std expressed in percent, since
 * the rest of the engine assumes percentage-scale volatility.
 */
export function zStatsToLegacy(
    stats: { log_std: number; wma_vol: number; logReturns: number[] }
): { std_dev: number; sma_vol: number } {
    return { std_dev: stats.log_std * 100, sma_vol: stats.wma_vol };
}

class AlphaEngineService {
    private static instance: AlphaEngineService;
    private static readonly CACHE_MOOD_KEY = 'alpha_cache_mood_v3';
    private static readonly CACHE_SECTORS_KEY = 'alpha_cache_sectors_v5';
    private static readonly CACHE_STOCKS_KEY = 'alpha_cache_stocks_v5';
    private static readonly CACHE_SOURCE_KEY = 'alpha_cache_source_v1';
    private static readonly CACHE_ZFACTOR_KEY = 'alpha_cache_zfactor_v1';
    private static readonly CACHE_SELECTION_KEY = 'alpha_cache_selection_v1';
    private static readonly CACHE_SELECTION_TTL_MS = 5 * 60 * 1000; // 5 minutes
    private static readonly X_FACTOR_MODE_STORAGE_KEY = 'alpha_xfactor_mode_v1';

    public activeDataSource: 'UPSTOX' | 'NSE_SCRAPER' | 'YAHOO' | 'MOCK' = 'MOCK';
    private xFactorMode: XFactorMode = 'TRADER_INTENT';

    /**
     * U-shaped intraday volume curve for Indian trading sessions (09:15 to 15:30 IST).
     * Replaces naive full-day 20-day average denominator with expected volume fraction so far.
     */
    public static getTimeOfDayExpectedVolumeFraction(date: Date = new Date()): number {
        const utc = date.getTime() + date.getTimezoneOffset() * 60000;
        const ist = new Date(utc + 5.5 * 3600000);
        const h = ist.getHours();
        const m = ist.getMinutes();
        const timeVal = h * 100 + m;

        if (timeVal < 915) return 0.08;
        if (timeVal >= 1530) return 1.0;

        const minutesFromOpen = (h - 9) * 60 + (m - 15);
        if (minutesFromOpen <= 45) {
            // 09:15 - 10:00: rapid opening auction accumulation (0% - 28%)
            return Math.max(0.08, (minutesFromOpen / 45) * 0.28);
        } else if (minutesFromOpen <= 135) {
            // 10:00 - 11:30: discovery & golden window (28% - 50%)
            return 0.28 + ((minutesFromOpen - 45) / 90) * 0.22;
        } else if (minutesFromOpen <= 285) {
            // 11:30 - 14:00: midday lull (50% - 70%)
            return 0.50 + ((minutesFromOpen - 135) / 150) * 0.20;
        } else {
            // 14:00 - 15:30: afternoon volume ramp (70% - 100%)
            return 0.70 + ((minutesFromOpen - 285) / 90) * 0.30;
        }
    }

    private previousVolumes: Record<string, number> = {};
    private cachedSectors: SectorData[] = [];
    private cachedStocks: StockData[] = [];
    private cachedMood: MarketMood | null = null;
    private sectorFatigueScores: Record<string, number> = {};
    private stockATRCache: Record<string, number> = {};
    private pcrGate: 'BULLISH' | 'NEUTRAL' | 'BEARISH' = 'NEUTRAL';
    private pcrValue: number = 1.0;
    private macroBias: 'STRONG_BULLISH' | 'HEDGED' | 'NEUTRAL' | 'DISTRIBUTION' = 'NEUTRAL';
    private fiiCashNet: number = 0;
    private xFactorEmaState: Record<string, number> = {};
    // CC68.35 — Adaptive Momentum Filter: track each sector's previous
    // raw score so the smoothing alpha can scale with the magnitude of the
    // regime change. Without this the static alpha=0.25 lags by 3-4 ticks
    // when a sector suddenly reverses, hiding the new direction from the
    // user. With it, the filter reacts on the same tick the regime shifts.
    private xFactorPrevRawScore: Record<string, number> = {};
    // CC68.35 — Rolling variance of the raw energy stream (per sector).
    // Used as the denominator when scaling alpha by |Δ raw|.
    // Initialised lazily on the first observation to 1.0 (safe default)
    // so the first ever tick produces a finite dynamic alpha.
    private xFactorRollingVar: Record<string, number> = {};
    // CC68.35 — Tuning constants. These live here so the values are
    // visible at the top of the engine and can be tuned from one place.
    // ── Alpha Engine Tuning Constants ───────────────────────────────────────
    private static readonly X_FACTOR_MIN_ALPHA        = 0.25;   // EMA floor
    private static readonly X_FACTOR_VAR_DECAY        = 0.30;   // Variance decay
    private static readonly X_FACTOR_SAFE_VAR         = 0.01;   // Min variance
    private static readonly X_FACTOR_TANH_DENOM       = 3.0;    // Saturation speed
    private static readonly X_FACTOR_RELATIVE_BLEND   = 0.50;   // λ: 0=absolute, 1=relative
    private static readonly X_FACTOR_MIN_SECTOR_COUNT = 5;      // MAD guard
    private static readonly G_FACTOR_RVOL_THRESHOLD   = 1.50;   // Real volume surge
    private static readonly G_FACTOR_ORB_LOW_TOL      = 0.9985; // ORB tolerance
    private static readonly G_FACTOR_ORB_HIGH_TOL     = 1.0015; // ORB tolerance
    private static readonly SCS_GAP_THRESHOLD_PCT     = 1.0;    // When to adjust O2C weight
    private static readonly BETA_MAX_STALENESS_MS     = 86_400_000; // 24h in ms
    // ────────────────────────────────────────────────────────────────────────
    // In-memory memoization for Z-Factor / benchmark baselines keyed by
    // (instrument, 15-minute window).  Prevents redundant candle queries
    // when computeXFactor and fetchSectorZFactorBaselines are called in
    // quick succession by the same tab.
    private baselineMemo: {
        windowStart: number;
        baselines: Record<string, { log_std: number; wma_vol: number; beta: number; computedAt?: number }>;
    } | null = null;
    private benchmarkMemo: {
        windowStart: number;
        returns: { date: string | number; val: number }[];
    } | null = null;

    private activeFnoStocks = FNO_STOCKS;
    private activeSectorConstituents = SECTOR_CONSTITUENTS;
    private isUniverseInitialized = false;
    private hydrationPromise: Promise<void> | null = null;
    private lastRFactorAlertTimes: Map<string, number> = new Map();
    public volumeAverages: Record<string, { avg_volume_20d: number, avg_abs_change_20d: number }> = {};

    // R-FACTOR PIPELINE HEALTH: when volumeAverages cannot be loaded, rFactor
    // degrades to |pctChange| noise (~0 for quiet stocks). Surface that state
    // loudly instead of failing silently, and retry with backoff + a 30s
    // negative cache so a temporarily down bridge doesn't get hammered.
    private volumeAveragesFailedAt = 0;
    private lastRFactorDegradedWarnAt = 0;
    private static readonly VOLUME_AVG_RETRY_DELAY_MS = 30000;

    private async ensureVolumeAveragesLoaded(): Promise<void> {
        if (Object.keys(this.volumeAverages).length > 0) return;

        // Negative cache: skip refetch within 30s after a failure
        const sinceFailure = Date.now() - this.volumeAveragesFailedAt;
        if (this.volumeAveragesFailedAt > 0 && sinceFailure < AlphaEngineService.VOLUME_AVG_RETRY_DELAY_MS) return;

        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const response = await fetch('/api/python-nse/api/upstox/historical/volume-avg/all');
                if (response.ok) {
                    const data = await response.json();
                    if (data && Object.keys(data).length > 0) {
                        this.volumeAverages = data;
                        this.volumeAveragesFailedAt = 0;
                        logger.info(`AlphaEngineService: Loaded volume averages for ${Object.keys(this.volumeAverages).length} symbols.`);
                        return;
                    }
                }

                // High-speed DuckDB Parquet ADV fallback
                const duckDbResp = await fetch('/api/python-nse/api/alpha/parquet/adv');
                if (duckDbResp.ok) {
                    const duckDbJson = await duckDbResp.json();
                    if (duckDbJson && duckDbJson.data && Object.keys(duckDbJson.data).length > 0) {
                        this.volumeAverages = duckDbJson.data;
                        this.volumeAveragesFailedAt = 0;
                        logger.info(`AlphaEngineService: Loaded DuckDB Parquet volume averages for ${Object.keys(this.volumeAverages).length} symbols.`);
                        return;
                    }
                }

                // NON-OK RESPONSE: previously swallowed silently -> empty
                // baselines -> dead R-Factor with zero diagnostics.
                logger.error(`AlphaEngineService: volume-avg endpoint returned HTTP ${response.status} (attempt ${attempt}/${maxAttempts})`);
            } catch (error: unknown) {
                logger.error('AlphaEngineService: Failed to load volume averages', error instanceof Error ? error.message : error);
            }
            if (attempt < maxAttempts) {
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
        this.volumeAveragesFailedAt = Date.now();
    }

    /**
     * True when R-Factor cannot be computed honestly because the 20-day
     * volume baseline is unavailable. UI can badge the value as degraded.
     */
    public isRFactorDegraded(): boolean {
        return Object.keys(this.volumeAverages).length === 0;
    }

    private warnRFactorDegradedOnce(): void {
        const now = Date.now();
        if (now - this.lastRFactorDegradedWarnAt < 5 * 60 * 1000) return;
        this.lastRFactorDegradedWarnAt = now;
        logger.warn('AlphaEngineService: R-FACTOR DEGRADED - no 20-day volume baseline loaded. rFactor values are unreliable until /api/upstox/historical/volume-avg/all succeeds.');
    }

    private constructor() {
        if (typeof window !== 'undefined') {
            try {
                const savedMode = localStorage.getItem(AlphaEngineService.X_FACTOR_MODE_STORAGE_KEY) as XFactorMode | null;
                if (savedMode === 'QUANT_RELATIVE' || savedMode === 'TRADER_INTENT') {
                    this.xFactorMode = savedMode;
                }
            } catch { /* non-fatal */ }
        }
        this.cachedMood = this.getSessionItem<MarketMood | null>(AlphaEngineService.CACHE_MOOD_KEY, null);
        const rawSectors = this.getSessionItem<SectorData[]>(AlphaEngineService.CACHE_SECTORS_KEY, []);
        this.cachedSectors = Array.isArray(rawSectors)
            ? rawSectors.filter((s: any) => s.sector !== 'MEDIA' && s.sector !== 'HEALTHCARE')
            : [];
        this.cachedStocks = this.getSessionItem<StockData[]>(AlphaEngineService.CACHE_STOCKS_KEY, []);
        this.activeDataSource = this.getSessionItem<'UPSTOX' | 'NSE_SCRAPER' | 'YAHOO' | 'MOCK'>(AlphaEngineService.CACHE_SOURCE_KEY, 'MOCK');

        // Start async hydration from Dexie/alphaCache
        this.hydrationPromise = this.hydrateFromAlphaCache();
    }

    private async hydrateFromAlphaCache() {
        if (typeof window === 'undefined') return;
        try {
            const keys = [
                AlphaEngineService.CACHE_MOOD_KEY,
                AlphaEngineService.CACHE_SECTORS_KEY,
                AlphaEngineService.CACHE_STOCKS_KEY,
                AlphaEngineService.CACHE_SOURCE_KEY,
                AlphaEngineService.CACHE_ZFACTOR_KEY
            ];
            for (const key of keys) {
                if (!sessionStorage.getItem(key)) {
                    const cached = await alphaCache.get(key);
                    if (cached && !cached.isStale) {
                        sessionStorage.setItem(key, JSON.stringify(cached.data));
                    }
                }
            }
            // Sync local values back to cached properties
            const rawSectors = this.getSessionItem<SectorData[]>(AlphaEngineService.CACHE_SECTORS_KEY, []);
            this.cachedSectors = Array.isArray(rawSectors)
                ? rawSectors.filter((s: any) => s.sector !== 'MEDIA' && s.sector !== 'HEALTHCARE')
                : [];
            this.cachedStocks = this.getSessionItem<StockData[]>(AlphaEngineService.CACHE_STOCKS_KEY, []);
            this.cachedMood = this.getSessionItem<MarketMood | null>(AlphaEngineService.CACHE_MOOD_KEY, null);
            this.activeDataSource = this.getSessionItem<'UPSTOX' | 'NSE_SCRAPER' | 'YAHOO' | 'MOCK'>(AlphaEngineService.CACHE_SOURCE_KEY, 'MOCK');
        } catch (e: unknown) {
            logger.error('AlphaEngineService: Error during cache self-hydration:', e instanceof Error ? e.message : e);
        }
    }

    static getInstance(): AlphaEngineService {
        if (!AlphaEngineService.instance) {
            AlphaEngineService.instance = new AlphaEngineService();
        }
        return AlphaEngineService.instance;
    }

    public getXFactorMode(): XFactorMode {
        return this.xFactorMode;
    }

    public setXFactorMode(mode: XFactorMode): SectorData[] {
        this.xFactorMode = mode;
        if (typeof window !== 'undefined') {
            try {
                localStorage.setItem(AlphaEngineService.X_FACTOR_MODE_STORAGE_KEY, mode);
            } catch { /* non-fatal */ }
        }
        if (this.cachedSectors && this.cachedSectors.length > 0) {
            const nifty50 = this.cachedSectors.find(s => s.sector === 'NIFTY 50');
            const nifty50OpenPct = nifty50?.openChangePct ?? 0;
            const baselines = this.baselineMemo?.baselines || {};
            this.computeXFactor(this.cachedSectors, baselines, nifty50OpenPct);
            this.setSessionItem(AlphaEngineService.CACHE_SECTORS_KEY, this.cachedSectors);
        }
        return this.cachedSectors;
    }

    private async ensureUniverseInitialized(): Promise<void> {
        if (this.isUniverseInitialized) return;
        try {
            const data = await fetchCoordinator.dedupedFetch('fno-universe', async () => {
                const response = await fetch('/api/python-nse/api/nse/fno-universe');
                if (!response.ok) throw new Error(`NSE universe error: ${response.status}`);
                return response.json();
            }, 12 * 60 * 60 * 1000); // 12 hours TTL

            if (data.status === 'success' && data.fno_stocks && data.sector_constituents) {
                this.activeFnoStocks = data.fno_stocks;
                this.activeSectorConstituents = data.sector_constituents;
                this.isUniverseInitialized = true;
                logger.info(`AlphaEngineService: Dynamic universe initialized with ${this.activeFnoStocks.length} F&O stocks.`);
            }
        } catch (error: unknown) {
            logger.error('AlphaEngineService: Failed to fetch dynamic universe from Python bridge, using static fallback.', error instanceof Error ? error.message : error);
        }
    }

    private getSessionItem<T>(key: string, defaultVal: T): T {
        if (typeof window === 'undefined') return defaultVal;
        try {
            const item = sessionStorage.getItem(key);
            return item ? JSON.parse(item) as T : defaultVal;
        } catch {
            return defaultVal;
        }
    }

    private setSessionItem(key: string, val: unknown): void {
        if (typeof window === 'undefined') return;
        try {
            sessionStorage.setItem(key, JSON.stringify(val));

            // Asynchronously write to alphaCache with TTL
            let ttlHours = 4;
            if (key === AlphaEngineService.CACHE_ZFACTOR_KEY) {
                ttlHours = 24;
            } else if (key === AlphaEngineService.CACHE_STOCKS_KEY) {
                ttlHours = 24;
            }
            alphaCache.set(key, val, ttlHours);
        } catch (e: unknown) {
            logger.warn('AlphaEngineService: Failed to cache to IndexedDB:', e instanceof Error ? e.message : e);
        }
    }

    /**
     * Cache management
     */
    getCachedSectors(): SectorData[] {
        if (this.cachedSectors.length === 0) {
            const rawSectors = this.getSessionItem<SectorData[]>(AlphaEngineService.CACHE_SECTORS_KEY, []);
            this.cachedSectors = Array.isArray(rawSectors)
                ? rawSectors.filter((s: SectorData) => s.sector !== 'MEDIA' && s.sector !== 'HEALTHCARE')
                : [];
        }
        const firstSector = this.cachedSectors[0];
        const isIncomplete = this.cachedSectors.length > 0 && firstSector &&
            (!('l2cChangePct' in firstSector) || !('h2cChangePct' in firstSector));
        if (isIncomplete) {
            this.cachedSectors = [];
        }
        return this.cachedSectors;
    }
    getCachedStocks(): StockData[] {
        if (this.cachedStocks.length === 0) {
            this.cachedStocks = this.getSessionItem<StockData[]>(AlphaEngineService.CACHE_STOCKS_KEY, []);
        }
        const firstStock = this.cachedStocks[0];
        const isIncomplete = this.cachedStocks.length > 0 && firstStock &&
            (!('high' in firstStock) || !('low' in firstStock));
        if (isIncomplete) {
            this.cachedStocks = [];
        }
        return this.cachedStocks;
    }
    getDataSource(): 'UPSTOX' | 'NSE_SCRAPER' | 'YAHOO' | 'MOCK' {
        return this.activeDataSource;
    }
    getCachedMood(): MarketMood | null {
        if (!this.cachedMood) {
            this.cachedMood = this.getSessionItem<MarketMood | null>(AlphaEngineService.CACHE_MOOD_KEY, null);
        }
        return this.cachedMood;
    }

    /**
     * CC68.39 — Is the Python bridge supplying real R-factor right now?
     * The mock fallback tops out at 1.9 (1.0 + (hash%10)/10), so any cached
     * stock with rFactor > 1.9 proves the bridge is live. Used by the Morning
     * Momentum data-confidence badge so the elite tier's unreachability is
     * surfaced instead of silent. Mirrors the pure `estimateBridgeRFactorLive`
     * in services/alpha/MorningMomentumEngine.ts.
     */
    isBridgeRFactorLive(): boolean {
        return this.getCachedStocks().some(
            s => s.rFactor != null && Number.isFinite(s.rFactor) && s.rFactor > 1.9,
        );
    }

    /**
     * Step 0: Get the Broader Market Mood
     */
    async fetchMarketMood(forceRefresh: boolean = false): Promise<MarketMood | null> {
        if (this.hydrationPromise) await this.hydrationPromise;
        if (!this.cachedMood) {
            this.cachedMood = this.getSessionItem<MarketMood | null>(AlphaEngineService.CACHE_MOOD_KEY, null);
        }
        if (!forceRefresh && this.cachedMood) return this.cachedMood;

        try {
            const chain = await optionChainService.fetchOptionChain('NIFTY', undefined, forceRefresh);
            if (!chain) {
                if (this.cachedMood) return this.cachedMood;
                // CC68.39: Dynamic fallback based on NIFTY sector change instead of hardcoded bullish
                const niftySector = this.cachedSectors.find(s => s.sector === 'NIFTY 50' || s.sector === 'NIFTY');
                const isNiftyBullish = (niftySector?.percentChange ?? 0) >= 0;
                const defaultMood: MarketMood = {
                    isBullish: isNiftyBullish,
                    ceVelocity: isNiftyBullish ? 457000 : 543000,
                    peVelocity: isNiftyBullish ? 543000 : 457000,
                    timestamp: new Date().toISOString()
                };
                this.cachedMood = defaultMood;
                this.setSessionItem(AlphaEngineService.CACHE_MOOD_KEY, defaultMood);
                return defaultMood;
            }

            let totalCeVelocity = 0;
            let totalPeVelocity = 0;

            chain.strikes.forEach(s => {
                if (Math.abs(s.strikePrice - chain.underlyingValue) <= 500) {
                    if (s.CE) totalCeVelocity += s.CE.oiVelocity;
                    if (s.PE) totalPeVelocity += s.PE.oiVelocity;
                }
            });

            // If velocities are zero (e.g. initial load), we use daily change in OI to prevent 0% / 0%
            let ceVelocity = totalCeVelocity;
            let peVelocity = totalPeVelocity;
            if (ceVelocity === 0 && peVelocity === 0) {
                const ceWriting = chain.strikes.reduce((sum, s) => {
                    if (Math.abs(s.strikePrice - chain.underlyingValue) <= 500 && s.CE) {
                        return sum + Math.max(0, s.CE.changeInOi);
                    }
                    return sum;
                }, 0);
                const peWriting = chain.strikes.reduce((sum, s) => {
                    if (Math.abs(s.strikePrice - chain.underlyingValue) <= 500 && s.PE) {
                        return sum + Math.max(0, s.PE.changeInOi);
                    }
                    return sum;
                }, 0);

                ceVelocity = ceWriting;
                peVelocity = peWriting;
            }

            // CC68.39: If computed velocities are still 0 (e.g. holiday/weekend), fall back dynamically based on Nifty return
            if (ceVelocity === 0 && peVelocity === 0) {
                const niftySector = this.cachedSectors.find(s => s.sector === 'NIFTY 50' || s.sector === 'NIFTY');
                const isNiftyBullish = (niftySector?.percentChange ?? 0) >= 0;
                ceVelocity = isNiftyBullish ? 457000 : 543000;
                peVelocity = isNiftyBullish ? 543000 : 457000;
            }

            const mood: MarketMood = {
                isBullish: peVelocity > ceVelocity,
                ceVelocity: ceVelocity,
                peVelocity: peVelocity,
                timestamp: chain.timestamp || new Date().toISOString()
            };

            this.cachedMood = mood;
            this.setSessionItem(AlphaEngineService.CACHE_MOOD_KEY, mood);
            return mood;
        } catch (error: unknown) {
            logger.error('AlphaEngineService: Failed to fetch market mood', error instanceof Error ? error.message : error);
            return this.cachedMood;
        }
    }

    /**
     * Step 1: Fetch Sector Scope
     */
    async fetchSectorScope(forceRefresh: boolean = false): Promise<SectorData[]> {
        if (this.hydrationPromise) await this.hydrationPromise;
        await this.ensureUniverseInitialized();
        if (this.cachedSectors.length === 0) {
            const rawSectors = this.getSessionItem<SectorData[]>(AlphaEngineService.CACHE_SECTORS_KEY, []);
            this.cachedSectors = Array.isArray(rawSectors)
                ? rawSectors
                : [];
        }
        const firstSector = this.cachedSectors[0];
        const isCacheIncomplete = this.cachedSectors.length > 0 && firstSector &&
            (!('l2cChangePct' in firstSector) || !('h2cChangePct' in firstSector));

        if (!forceRefresh && this.cachedSectors.length > 0 && !isCacheIncomplete) return this.cachedSectors;

        try {
            // Guarantee constituent stocks are loaded first for volume/turnover calculation & custom fallback
            if (this.cachedStocks.length === 0 || forceRefresh) {
                await this.fetchFnOStocks(forceRefresh);
            }

            // Initialize base sector objects
            const mappedSectors: SectorData[] = SECTOR_CONFIGS.map((config): SectorData => ({
                sector: config.name,
                lastPrice: 0,
                percentChange: 0,
                previousClose: 0,
                strengthRatio: 1.0,
                fatigueScore: 0,
                fatigueState: 'neutral',
                openPrice: 0,
                openChangePct: 0,
                highPrice: 0,
                lowPrice: 0,
                l2cChangePct: 0,
                h2cChangePct: 0,
                yearHigh: 0,
                yearLow: 0,
                perChange30d: 0,
                perChange365d: 0,
                pe: 0,
                pb: 0,
                dy: 0
            }));

            // =========================================================================
            // TIER 1: Upstox REST Batch Quotes (Primary official broker source)
            // =========================================================================
            const isUpstoxEnabled = useSettingsStore.getState().isUpstoxEnabled;
            if (isUpstoxEnabled) {
                try {
                    const upstoxKeys = Object.values(SECTOR_ZFACTOR_INDEX_MAP);
                    if (!upstoxKeys.includes('BSE_INDEX|SENSEX')) {
                        upstoxKeys.push('BSE_INDEX|SENSEX');
                    }
                    const res = await fetchCoordinator.dedupedFetch('upstoxIndexQuotes', async () => {
                        const r = await fetch(`/api/python-nse/api/upstox/quotes?symbols=${encodeURIComponent(upstoxKeys.join(','))}`);
                        if (!r.ok) throw new Error(`Upstox quotes error: ${r.status}`);
                        return r.json();
                    }, 10000);

                    if (res && typeof res === 'object') {
                        mappedSectors.forEach(s => {
                            const key = SECTOR_ZFACTOR_INDEX_MAP[s.sector] || (s.sector === 'SENSEX' ? 'BSE_INDEX|SENSEX' : null);
                            const quote = (key && res[key]) || res[s.sector] || (key ? res[key.replace('|', ':')] : null);
                            if (quote && (Number(quote.last_price) > 0 || Number(quote.ltp) > 0)) {
                                const ltp = Number(quote.last_price) || Number(quote.ltp) || 0;
                                const ohlc = quote.ohlc || {};
                                const open = Number(ohlc.open) || ltp;
                                const high = Math.max(Number(ohlc.high) || ltp, ltp);
                                const low = Math.min(Number(ohlc.low) || ltp, ltp);
                                const prevClose = Number(ohlc.close) || (ltp - (Number(quote.net_change) || 0)) || ltp;

                                const percentChange = prevClose > 0 ? Number((((ltp - prevClose) / prevClose) * 100).toFixed(2)) : (Number(quote.net_change) || 0);
                                const openChangePct = open > 0 ? Number((((ltp - open) / open) * 100).toFixed(2)) : 0;
                                const l2cChangePct = low > 0 ? Number((((ltp - low) / low) * 100).toFixed(2)) : 0;
                                const h2cChangePct = high > 0 ? Number((((ltp - high) / high) * 100).toFixed(2)) : 0;

                                s.lastPrice = ltp;
                                s.percentChange = percentChange;
                                s.previousClose = prevClose;
                                s.openPrice = open;
                                s.openChangePct = openChangePct;
                                s.highPrice = high;
                                s.lowPrice = low;
                                s.l2cChangePct = l2cChangePct;
                                s.h2cChangePct = h2cChangePct;
                            }
                        });
                    }
                } catch (err) {
                    logger.warn('AlphaEngineService: Upstox quotes fetch failed, proceeding to Tier 2 (NSE)', err instanceof Error ? err.message : err);
                }
            }

            // =========================================================================
            // TIER 2: NSE Public REST (/api/nse/api/allIndices) Fallback
            // Runs if any sector is missing (lastPrice === 0) or Upstox is disabled/offline
            // =========================================================================
            const needsNseFallback = mappedSectors.some(s => s.lastPrice === 0 && s.sector !== 'CAP GOODS');
            if (needsNseFallback) {
                try {
                    await fetch('/api/nse/', { credentials: 'omit' }).catch(() => { });
                    const nseData = await fetchCoordinator.dedupedFetch('allIndices', async () => {
                        const response = await fetch('/api/nse/api/allIndices');
                        if (!response.ok) throw new Error(`NSE API error: ${response.status}`);
                        return response.json();
                    }, 15000);

                    if (nseData && Array.isArray(nseData.data)) {
                        mappedSectors.forEach(s => {
                            if (s.lastPrice > 0) return; // Already populated from Tier 1 (Upstox)

                            const config = SECTOR_CONFIGS.find(c => c.name === s.sector);
                            if (!config?.nseIndexSymbol) return;

                            const conf = config.nseIndexSymbol.toUpperCase();
                            const SECTOR_NSE_ALIASES: Record<string, string[]> = {
                                'CONSUMER DURABLES': ['NIFTY CONSR DURBL', 'NIFTY CONSUMER DURABLES'],
                                'OIL & GAS': ['NIFTY OIL AND GAS', 'NIFTY OIL & GAS'],
                                'SERVICES': ['NIFTY SERV SECTOR', 'NIFTY SERVICES SECTOR', 'NIFTY SERVICES'],
                                'DEFENSE': ['NIFTY INDIA DEFENCE', 'NIFTY IND DEFENCE', 'NIFTY DEFENCE', 'NIFTY DEFENSE'],
                                'CAPITAL MARKETS': ['NIFTY CAPITAL MKT', 'NIFTY CAPITAL MARKETS'],
                                'FIN SERVICE': ['NIFTY FIN SERVICE', 'NIFTY FINANCIAL SERVICES']
                            };

                            const item = nseData.data.find((idx: any) => {
                                const sym = (idx.indexSymbol || idx.index || '').toUpperCase();
                                if (!sym) return false;
                                if (sym === conf) return true;
                                const aliases = SECTOR_NSE_ALIASES[s.sector];
                                if (aliases && aliases.some(a => a.toUpperCase() === sym)) return true;
                                const normSym = sym.replace(/&/g, 'AND').replace(/[^A-Z0-9]/g, '');
                                const normConf = conf.replace(/&/g, 'AND').replace(/[^A-Z0-9]/g, '');
                                return normSym.length > 3 && normSym === normConf;
                            });

                            if (item) {
                                const ltp = Number(item.last) || Number(item.lastPrice) || 0;
                                const open = Number(item.open) || 0;
                                const high = Number(item.high) || Number(item.dayHigh) || Number(item.highPrice) || ltp;
                                const low = Number(item.low) || Number(item.dayLow) || Number(item.lowPrice) || ltp;
                                const openChangePct = open > 0 ? ((ltp - open) / open) * 100 : 0;
                                const l2cChangePct = low > 0 ? ((ltp - low) / low) * 100 : 0;
                                const h2cChangePct = high > 0 ? ((ltp - high) / high) * 100 : 0;

                                s.lastPrice = ltp;
                                s.percentChange = Number(item.percentChange) || Number(item.pChange) || 0;
                                s.previousClose = Number(item.previousClose) || Number(item.prevClose) || 0;
                                s.openPrice = open;
                                s.openChangePct = Number(openChangePct.toFixed(2));
                                s.highPrice = high;
                                s.lowPrice = low;
                                s.l2cChangePct = Number(l2cChangePct.toFixed(2));
                                s.h2cChangePct = Number(h2cChangePct.toFixed(2));
                                s.yearHigh = Number(item.yearHigh) || 0;
                                s.yearLow = Number(item.yearLow) || 0;
                                s.perChange30d = Number(item.perChange30d) || 0;
                                s.perChange365d = Number(item.perChange365d) || 0;
                                s.pe = Number(item.pe) || 0;
                                s.pb = Number(item.pb) || 0;
                                s.dy = Number(item.dy) || 0;
                            }
                        });
                    }
                } catch (nseErr) {
                    logger.warn('AlphaEngineService: NSE allIndices fetch failed, proceeding to Tier 3 (Constituents/Yahoo)', nseErr instanceof Error ? nseErr.message : nseErr);
                }
            }

            // =========================================================================
            // TIER 3: Constituent Synthesis (Strictly for synthetic sectors or if both T1 & T2 failed)
            // Volume and turnover aggregation runs for ALL sectors, but price/OHLC is NEVER overwritten if s.lastPrice > 0.
            // =========================================================================
            mappedSectors.forEach(s => {
                const sectorStocks = this.activeSectorConstituents[s.sector] || [];
                const matchingStocks = this.cachedStocks.filter(st => sectorStocks.includes(st.symbol));
                if (matchingStocks.length > 0) {
                    const totalVolume = matchingStocks.reduce((sum, st) => sum + (st.volume || 0), 0);
                    const totalValuePaise = matchingStocks.reduce((sum, st) => sum + Math.round((st.value || 0) * 100), 0);
                    s.volume = totalVolume;
                    s.value = totalValuePaise / 100;

                    // If official index price already acquired from Upstox or NSE, DO NOT overwrite with constituent averages!
                    if (s.lastPrice > 0) return;

                    const avgChange = matchingStocks.reduce((sum, st) => sum + st.percentChange, 0) / matchingStocks.length;
                    const avgPrice = matchingStocks.reduce((sum, st) => sum + st.lastPrice, 0) / matchingStocks.length;
                    const avgPrev = matchingStocks.reduce((sum, st) => sum + st.previousClose, 0) / matchingStocks.length;

                    const avgOpen = matchingStocks.reduce((sum, st) => sum + st.openPrice, 0) / matchingStocks.length;
                    const avgOpenChange = matchingStocks.reduce((sum, st) => sum + st.openChangePct, 0) / matchingStocks.length;
                    const avgHigh = matchingStocks.reduce((sum, st) => sum + st.high, 0) / matchingStocks.length;
                    const avgLow = matchingStocks.reduce((sum, st) => sum + st.low, 0) / matchingStocks.length;

                    s.lastPrice = avgPrice;
                    s.percentChange = Number(avgChange.toFixed(2));
                    s.previousClose = avgPrev;
                    s.openPrice = avgOpen;
                    s.openChangePct = Number(avgOpenChange.toFixed(2));
                    s.highPrice = avgHigh;
                    s.lowPrice = avgLow;
                    s.l2cChangePct = Number((avgLow > 0 ? ((avgPrice - avgLow) / avgLow) * 100 : 0).toFixed(2));
                    s.h2cChangePct = Number((avgHigh > 0 ? ((avgPrice - avgHigh) / avgHigh) * 100 : 0).toFixed(2));
                }
            });

            // Third pass: Compute Sector X-Factor Strength Ratio relative to Nifty 50
            const nifty50 = mappedSectors.find(s => s.sector === 'NIFTY 50');
            const nifty50Change = nifty50 ? nifty50.percentChange : 0;
            const denominator = Math.max(Math.abs(nifty50Change), 0.1);

            mappedSectors.forEach(s => {
                s.strengthRatio = Number((s.percentChange / denominator).toFixed(2));
                // Fetch fatigue scores
                const score = this.sectorFatigueScores[s.sector] || 0;
                s.fatigueScore = score;
                s.fatigueState = score <= -3 ? 'springboard' : score >= 3 ? 'exhaustion' : 'neutral';
            });

            // Run the parallel calculations and wait for them to finish before returning so fatigue states are accurate on first load
            await this.calculateSectorFatigue(mappedSectors).catch((err: unknown) =>
                logger.error('AlphaEngineService: Fatigue calculation error', err instanceof Error ? err.message : err)
            );

            // Compute X-Factor 2.0
            let baselines: Record<string, { log_std: number; wma_vol: number; beta: number; computedAt?: number }> = {};
            if (isUpstoxEnabled) {
                try {
                    baselines = await this.fetchSectorZFactorBaselines(forceRefresh);
                } catch (err: unknown) {
                    logger.error('AlphaEngineService: Z-Factor baseline fetch failed', err instanceof Error ? err.message : err);
                }
            }
            const nifty50OpenPct = nifty50?.openChangePct ?? 0;
            this.computeXFactor(mappedSectors, baselines, nifty50OpenPct);

            const boosterRaw = this.getSessionItem<unknown[]>(AlphaEngineService.CACHE_ZFACTOR_KEY, []);
            const boosterStocks = this.getSessionItem<unknown[]>(AlphaEngineService.CACHE_ZFACTOR_KEY, []);
            const confluencedSectors = this.calculateSectorConfluence(mappedSectors, boosterRaw, boosterStocks);

            this.cachedSectors = confluencedSectors.sort((a, b) => b.percentChange - a.percentChange);
            this.setSessionItem(AlphaEngineService.CACHE_SECTORS_KEY, this.cachedSectors);
            return this.cachedSectors;
        } catch (error: unknown) {
            logger.error('AlphaEngineService: Failed to fetch sector indices', error instanceof Error ? error.message : error);
            return this.cachedSectors;
        }
    }

    /**
     * Helper to run tasks with a concurrency limit
     */
    private async limitConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
        const results: T[] = new Array(tasks.length);
        const queue = tasks.map((task, index) => ({ task, index }));
        let activeCount = 0;
        let nextIndex = 0;

        return new Promise((resolve) => {
            const runNext = () => {
                if (nextIndex >= tasks.length && activeCount === 0) {
                    resolve(results);
                    return;
                }

                while (activeCount < limit && nextIndex < tasks.length) {
                    const { task, index } = queue[nextIndex++];
                    activeCount++;
                    task()
                        .then(res => {
                            results[index] = res;
                        })
                        .catch(() => {
                            results[index] = null as any;
                        })
                        .finally(() => {
                            activeCount--;
                            runNext();
                        });
                }
            };
            if (tasks.length === 0) resolve([]);
            else runNext();
        });
    }

    /**
     * Compute multi-day consecutive candle direction to track sector fatigue
     */
    private async calculateSectorFatigue(sectorsList: SectorData[]): Promise<void> {
        const tickers: Record<string, string> = {};
        SECTOR_CONFIGS.forEach(c => {
            if (c.yahooSymbol) tickers[c.name] = c.yahooSymbol;
        });

        // Use concurrency limit to prevent network flooding (max 5 parallel calls)
        const tasks = sectorsList.map((s) => async () => {
            try {
                const ticker = tickers[s.sector] || `${s.sector}.NS`;
                const trades = await YahooHistoricalService.getSyntheticTrades(ticker, '1d', '1mo');
                if (trades.length >= 3) {
                    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date)) as any[];

                    let consecutiveCount = 0;
                    let lastDirection = 0;

                    for (let i = 0; i < sorted.length; i++) {
                        const item = sorted[i];
                        if (!item) continue;
                        const open = item.metadata?.open || item.entryPrice;
                        const close = item.metadata?.close || item.exitPrice;
                        const diff = close - open;
                        const currentDirection = diff >= 0 ? 1 : -1;

                        if (i === 0) {
                            lastDirection = currentDirection;
                            consecutiveCount = 1;
                        } else {
                            if (currentDirection === lastDirection) {
                                consecutiveCount++;
                            } else {
                                consecutiveCount = 1;
                                lastDirection = currentDirection;
                            }
                        }
                    }

                    const score = lastDirection * consecutiveCount;
                    this.sectorFatigueScores[s.sector] = score;
                    s.fatigueScore = score;
                    s.fatigueState = score <= -3 ? 'springboard' : score >= 3 ? 'exhaustion' : 'neutral';
                }
            } catch (err: unknown) {
                // Ignore errors silently
            }
        });

        await this.limitConcurrency(tasks, 5);

        // Save computed scores back to cache and sessionStorage
        this.cachedSectors = [...sectorsList];
        this.setSessionItem(AlphaEngineService.CACHE_SECTORS_KEY, this.cachedSectors);
    }

    /**
     * Z-Factor baseline entry persisted in alphaCache.
     * log_std: daily σ of log returns (decimal, e.g. 0.018 = 1.8% / day)
     * wma_vol: 20-candle volume-weighted EMA baseline
     * beta:    20-day covariance of sector log returns vs Nifty 50 log returns
     */
    private static readonly CACHE_ZFACTOR_KEY_V2 = 'alpha_cache_zfactor_v2';
    private static readonly CACHE_XFACTOR_KEY = 'alpha_cache_xfactor_v1';
    private static readonly CACHE_BENCHMARK_KEY = 'alpha_cache_benchmark_v1';
    private static readonly Z_FACTOR_TTL_MS = 15 * 60 * 1000; // 15 minutes

    private async fetchSectorZFactorBaselines(forceRefresh: boolean = false): Promise<Record<string, { log_std: number; wma_vol: number; beta: number; computedAt?: number }>> {
        if (this.hydrationPromise) await this.hydrationPromise;

        // 15-minute in-memory memoization guard — prevents redundant
        // candle fan-out when computeXFactor is called repeatedly
        // (e.g. sector refresh + dashboard render) within the same window.
        const now = Date.now();
        if (
            !forceRefresh &&
            this.baselineMemo &&
            now - this.baselineMemo.windowStart < AlphaEngineService.Z_FACTOR_TTL_MS &&
            Object.keys(this.baselineMemo.baselines).length > 0
        ) {
            return this.baselineMemo.baselines;
        }

        if (!forceRefresh) {
            const cachedResult = await alphaCache.get(AlphaEngineService.CACHE_ZFACTOR_KEY_V2);
            if (cachedResult && !cachedResult.isStale && Object.keys(cachedResult.data).length > 0) {
                this.baselineMemo = { windowStart: now, baselines: cachedResult.data };
                return cachedResult.data;
            }
        }

        const baselines: Record<string, { log_std: number; wma_vol: number; beta: number; computedAt?: number }> = {};
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // Fetch Nifty 50 candles first to compute the benchmark covariance.
        // Memoize the result so all sector tasks can reuse it.
        const niftyKey = SECTOR_ZFACTOR_INDEX_MAP['NIFTY 50'];
        const benchmarkReturns = await this.fetchBenchmarkReturns(niftyKey, startDate, endDate, forceRefresh);

        const tasks = Object.entries(SECTOR_ZFACTOR_INDEX_MAP).map(([sectorName, key]) => async () => {
            try {
                const res = await fetchCoordinator.dedupedFetch(`candles:${key}`, async () => {
                    const response = await fetch(
                        `/api/python-nse/api/upstox/historical-candles?instrument_key=${encodeURIComponent(key)}&interval=day&to_date=${endDate}&from_date=${startDate}`
                    );
                    if (!response.ok) {
                        throw new Error(`Upstox candles error: ${response.status}`);
                    }
                    return response.json();
                }, 60 * 60 * 1000); // 1 hour TTL for historical candles

                if (res.status === 'success' && res.data && Array.isArray(res.data.candles)) {
                    // Take the first 20 candles (newest first, which is how Upstox returns them)
                    const candles20 = res.data.candles.slice(0, 20);
                    const stats = computeZFactorStats(candles20);
                    // Beta = Cov(sector, benchmark) / Var(benchmark)
                    const beta = computeBeta(stats.logReturns, benchmarkReturns);
                    baselines[sectorName] = {
                        log_std: stats.log_std,
                        wma_vol: stats.wma_vol,
                        beta,
                        computedAt: Date.now()
                    };
                }
            } catch (err: unknown) {
                logger.error(`AlphaEngineService: Failed to fetch Z-Factor baseline for ${sectorName}`, err instanceof Error ? err.message : err);
            }
        });

        await this.limitConcurrency(tasks, 5);

        if (Object.keys(baselines).length > 0) {
            // 15-minute TTL — short enough to catch intraday regime changes,
            // long enough to avoid redundant candle queries.
            try {
                await alphaCache.set(AlphaEngineService.CACHE_ZFACTOR_KEY_V2, baselines, 0.25);
            } catch { /* non-fatal */ }
            this.setSessionItem(AlphaEngineService.CACHE_ZFACTOR_KEY_V2, baselines);
            this.baselineMemo = { windowStart: now, baselines };
        }

        return baselines;
    }

    /**
     * Fetches the Nifty 50 benchmark log returns used for covariance
     * calculations. Memoizes the result in alphaCache (15-min TTL) to
     * avoid redundant candle queries across the universe.
     */
    private async fetchBenchmarkReturns(
        instrumentKey: string,
        startDate: string,
        endDate: string,
        forceRefresh: boolean = false
    ): Promise<{ date: string | number; val: number }[]> {
        const now = Date.now();
        if (
            !forceRefresh &&
            this.benchmarkMemo &&
            now - this.benchmarkMemo.windowStart < AlphaEngineService.Z_FACTOR_TTL_MS
        ) {
            return this.benchmarkMemo.returns;
        }

        if (!forceRefresh) {
            try {
                const cached = await alphaCache.get(AlphaEngineService.CACHE_BENCHMARK_KEY);
                if (cached && !cached.isStale && Array.isArray(cached.data?.returns)) {
                    this.benchmarkMemo = { windowStart: now, returns: cached.data.returns };
                    return cached.data.returns as { date: string | number; val: number }[];
                }
            } catch { /* fallthrough to fetch */ }
        }

        try {
            const res = await fetchCoordinator.dedupedFetch(`candles:${instrumentKey}`, async () => {
                const response = await fetch(
                    `/api/python-nse/api/upstox/historical-candles?instrument_key=${encodeURIComponent(instrumentKey)}&interval=day&to_date=${endDate}&from_date=${startDate}`
                );
                if (!response.ok) {
                    throw new Error(`Upstox benchmark candles error: ${response.status}`);
                }
                return response.json();
            }, 60 * 60 * 1000);

            if (res?.status === 'success' && res.data && Array.isArray(res.data.candles)) {
                const candles20 = res.data.candles.slice(0, 20);
                const stats = computeZFactorStats(candles20);
                const payload = { returns: stats.logReturns, computedAt: now };
                try { await alphaCache.set(AlphaEngineService.CACHE_BENCHMARK_KEY, payload, 0.25); } catch { /* non-fatal */ }
                this.setSessionItem(AlphaEngineService.CACHE_BENCHMARK_KEY, payload);
                this.benchmarkMemo = { windowStart: now, returns: stats.logReturns };
                return stats.logReturns;
            }
        } catch (err: unknown) {
            logger.warn('AlphaEngineService: Benchmark covariance fetch failed, falling back to zero-beta', err instanceof Error ? err.message : err);
        }
        return [];
    }

    private computeXFactor(
        sectors: SectorData[],
        baselines: Record<string, { log_std: number; wma_vol: number; beta: number; computedAt?: number }>,
        nifty50OpenPct: number
    ): void {
        const isTraderIntent = this.xFactorMode === 'TRADER_INTENT';

        if (isTraderIntent) {
            // ── TRADER_INTENT MODE (Captain's First Intent from Alpha Pulse Pro) ──
            // Strict Directional Contract: Green = UP (price gained), Red = DOWN (price dropped).
            // Natural institutional kinetic scaling (soft-bounded to ±10.0 instead of clamped to 5.0).
            const niftySector = sectors.find(s => s.sector === 'NIFTY 50' || s.sector === 'NIFTY');
            const niftyBenchmark = nifty50OpenPct !== 0
                ? nifty50OpenPct
                : (niftySector?.openChangePct || niftySector?.percentChange || 0);
            const benchmarkDenom = Math.max(Math.abs(niftyBenchmark), 0.25);

            sectors.forEach(sector => {
                sector.xFactorMode = 'TRADER_INTENT';
                const baseline = baselines[sector.sector];

                // 1. Strict Price Direction (Percent Change with Intraday Confirmation)
                const pricePct = sector.percentChange;
                const openPct = sector.openChangePct ?? 0;
                const activeMove = Math.abs(openPct) > 0.01 ? openPct : pricePct;

                let sign = 0;
                if (activeMove > 0.01) {
                    sign = 1;
                } else if (activeMove < -0.01) {
                    sign = -1;
                } else if (pricePct > 0.01) {
                    sign = 1;
                } else if (pricePct < -0.01) {
                    sign = -1;
                }

                // 2. Relative Strength vs Benchmark
                const relativeStrength = Math.abs(activeMove) / benchmarkDenom;

                // 3. Volume Ratio: constituent sum vs 20-day baseline with Time-of-Day U-Curve
                const sectorStocks = this.activeSectorConstituents[sector.sector] || [];
                const currentVol = (sector.volume && sector.volume > 0)
                    ? sector.volume
                    : this.cachedStocks
                        .filter(s => s.sector === sector.sector || sectorStocks.includes(s.symbol))
                        .reduce((sum, s) => sum + (s.volume || 0), 0);

                let wmaVol = baseline?.wma_vol ?? 0;
                if (wmaVol <= 1) {
                    const constituentAvgVol = sectorStocks
                        .map(sym => this.volumeAverages[sym]?.avg_volume_20d ?? 0)
                        .reduce((sum, v) => sum + v, 0);
                    wmaVol = constituentAvgVol > 0 ? constituentAvgVol : Math.max(sectorStocks.length * 1_000_000, 1_000_000);
                }
                const todFraction = AlphaEngineService.getTimeOfDayExpectedVolumeFraction();
                const expectedVolSoFar = Math.max(1000, wmaVol * todFraction);
                const volumeRatio = currentVol > 0 ? currentVol / expectedVolSoFar : 1.0;
                const volMultiplier = Math.min(2.5, Math.max(0.6, Math.sqrt(volumeRatio)));

                // 4. Raw Trader Intent Magnitude (soft-bounded to 10.0, never flattened to 0)
                const magnitude = Math.min(10.0, Math.max(0.1, relativeStrength * volMultiplier));
                const rawScore = sign !== 0 ? sign * magnitude : 0;

                // 5. Adaptive Momentum Filter
                const prevSmoothed = this.xFactorEmaState[sector.sector] ?? null;
                const prevRaw = this.xFactorPrevRawScore[sector.sector] ?? null;
                const prevVar = this.xFactorRollingVar[sector.sector] ?? null;

                const { smoothed, newRollingVar } = adaptiveMomentumStep(
                    rawScore,
                    prevRaw,
                    prevVar,
                    prevSmoothed,
                    {
                        minAlpha: AlphaEngineService.X_FACTOR_MIN_ALPHA,
                        varDecay: AlphaEngineService.X_FACTOR_VAR_DECAY,
                        safeVar: AlphaEngineService.X_FACTOR_SAFE_VAR,
                    }
                );

                this.xFactorPrevRawScore[sector.sector] = rawScore;
                this.xFactorRollingVar[sector.sector] = newRollingVar;

                // Enforce sign invariance: smoothed score must NEVER invert the sign of price movement!
                let finalScore = smoothed;
                if (sign > 0 && finalScore <= 0) finalScore = Math.max(0.1, magnitude);
                else if (sign < 0 && finalScore >= 0) finalScore = -Math.max(0.1, magnitude);
                else if (sign === 0) finalScore = 0;

                finalScore = Math.max(-10.0, Math.min(10.0, finalScore));
                this.xFactorEmaState[sector.sector] = finalScore;

                sector.zFactor = Number(finalScore.toFixed(2));
            });

            const snapshot = sectors.map(s => ({ sector: s.sector, zFactor: s.zFactor, mode: 'TRADER_INTENT' }));
            try {
                alphaCache.set(AlphaEngineService.CACHE_XFACTOR_KEY, snapshot, 0.25);
                this.setSessionItem(AlphaEngineService.CACHE_XFACTOR_KEY, snapshot);
            } catch { /* non-fatal */ }
            return;
        }

        // ── QUANT_RELATIVE MODE (Cross-Sectional Winsorized MAD Relative Alpha) ──
        sectors.forEach(sector => {
            sector.xFactorMode = 'QUANT_RELATIVE';
        });

        const smoothedScores: number[] = [];

        sectors.forEach(sector => {
            // Step 1: Benchmark Alpha (intraday vs NIFTY 50)
            const rawAlpha = (sector.openChangePct ?? 0) - nifty50OpenPct;

            // Step 1b: Beta-adjusted alpha
            const baseline = baselines[sector.sector];
            const isBaselineStale = baseline?.computedAt
                ? (Date.now() - baseline.computedAt) > AlphaEngineService.BETA_MAX_STALENESS_MS
                : false;
            if (isBaselineStale) {
                logger.warn(`AlphaEngine: Stale beta for ${sector.sector} — using 1.0 fallback`);
            }
            const beta = (isBaselineStale || !baseline) ? 1.0 : (baseline.beta ?? 1.0);
            const safeBeta = Math.max(Math.abs(beta), 0.25);
            const alpha = rawAlpha / safeBeta;

            // Calculate current volume summing constituents
            const sectorStocks = this.activeSectorConstituents[sector.sector] || [];
            const currentVol = this.cachedStocks
                .filter(s => s.sector === sector.sector || sectorStocks.includes(s.symbol))
                .reduce((sum, s) => sum + (s.volume || 0), 0);

            // Step 2: Log-compressed volume ratio against the EMA baseline
            let wmaVol = baseline?.wma_vol ?? 0;
            if (wmaVol <= 1) {
                const constituentAvgVol = sectorStocks
                    .map(sym => this.volumeAverages[sym]?.avg_volume_20d ?? 0)
                    .reduce((sum, v) => sum + v, 0);

                wmaVol = constituentAvgVol > 0
                    ? constituentAvgVol
                    : Math.max(sectorStocks.length * 1_000_000, 1_000_000);
            }
            const compressedVol = Math.log(1 + (currentVol / wmaVol));

            // Adaptive Momentum Filter
            const rawEnergy = alpha * compressedVol;

            const prevRaw = this.xFactorPrevRawScore[sector.sector] ?? null;
            const prevVar = this.xFactorRollingVar[sector.sector] ?? null;
            const prevSmoothed = this.xFactorEmaState[sector.sector] ?? null;

            const { smoothed, newRollingVar } = adaptiveMomentumStep(
                rawEnergy,
                prevRaw,
                prevVar,
                prevSmoothed,
                {
                    minAlpha: AlphaEngineService.X_FACTOR_MIN_ALPHA,
                    varDecay: AlphaEngineService.X_FACTOR_VAR_DECAY,
                    safeVar: AlphaEngineService.X_FACTOR_SAFE_VAR,
                }
            );

            this.xFactorPrevRawScore[sector.sector] = rawEnergy;
            this.xFactorRollingVar[sector.sector] = newRollingVar;
            this.xFactorEmaState[sector.sector] = smoothed;
            smoothedScores.push(smoothed);
        });

        // Step 4: Cross-Sectional Robust Scaling (Winsorized Median + MAD)
        if (smoothedScores.length < AlphaEngineService.X_FACTOR_MIN_SECTOR_COUNT) {
            sectors.forEach((sector, i) => {
                const score = smoothedScores[i] ?? 0;
                let xFactor = Math.tanh(score / AlphaEngineService.X_FACTOR_TANH_DENOM) * 10.0;
                sector.zFactor = isNaN(xFactor) || !isFinite(xFactor) 
                    ? 0 : Number(xFactor.toFixed(2));
            });
            const snapshot = sectors.map(s => ({ sector: s.sector, zFactor: s.zFactor, mode: 'QUANT_RELATIVE' }));
            try {
                alphaCache.set(AlphaEngineService.CACHE_XFACTOR_KEY, snapshot, 0.25);
                this.setSessionItem(AlphaEngineService.CACHE_XFACTOR_KEY, snapshot);
            } catch { /* non-fatal */ }
            return;
        }

        const winsorized = winsorize(smoothedScores, 0.05, 0.95);
        const winsorMedian = medianOf(winsorized);
        const mad = medianAbsoluteDeviation(winsorized, winsorMedian);
        const safeMad = Math.max(mad, 0.01);

        // Step 5: tanh squash -> Relative X-Factor on [-10, +10]
        sectors.forEach((sector, i) => {
            const score = smoothedScores[i] ?? 0;
            const robustRelative = (score - winsorMedian) / safeMad;
            const xRelative = Math.tanh(robustRelative / AlphaEngineService.X_FACTOR_TANH_DENOM) * 10.0;
            
            sector.zFactor = isNaN(xRelative) || !isFinite(xRelative) 
                ? 0 : Number(xRelative.toFixed(2));
        });

        // Step 6: Cache the computed X-Factor outputs (15-minute TTL)
        const snapshot = sectors.map(s => ({ sector: s.sector, zFactor: s.zFactor, mode: 'QUANT_RELATIVE' }));
        try {
            alphaCache.set(AlphaEngineService.CACHE_XFACTOR_KEY, snapshot, 0.25);
            this.setSessionItem(AlphaEngineService.CACHE_XFACTOR_KEY, snapshot);
        } catch { /* non-fatal */ }
    }

    /**
     * Compute live X-Factor for a single sector on real-time tick updates
     */
    public computeSingleSectorXFactor(
        sector: { percentChange: number; openChangePct?: number; volume?: number },
        benchmarkPct: number
    ): number {
        const activeMove = (sector.openChangePct != null && Math.abs(sector.openChangePct) > 0.01)
            ? sector.openChangePct
            : sector.percentChange;
        if (Math.abs(activeMove) < 0.001) return 0;

        const sign = activeMove > 0 ? 1 : -1;
        const benchmarkDenom = Math.max(Math.abs(benchmarkPct), 0.25);
        const relativeStrength = Math.abs(activeMove) / benchmarkDenom;
        const score = sign * Math.min(10.0, Math.max(0.1, relativeStrength));
        return Number(score.toFixed(2));
    }

    /**
     * Verify strict 5m range preservation by querying Yahoo Intraday API lazily
     */
    async verifyORBWithCandles(symbol: string): Promise<{ isLowPreserved: boolean; isHighPreserved: boolean; detail?: string }> {
        try {
            const trades = await YahooHistoricalService.getSyntheticTrades(symbol, '5m', '1d');
            if (trades.length === 0) {
                return { isLowPreserved: true, isHighPreserved: true, detail: 'No intraday data' };
            }

            const sortedTrades = [...trades].sort((a, b) => (a.entryTime || '').localeCompare(b.entryTime || '')) as any[];
            const firstCandle = sortedTrades[0];
            if (!firstCandle) {
                return { isLowPreserved: true, isHighPreserved: true, detail: 'No intraday data' };
            }
            const firstLow = firstCandle.metadata?.low || firstCandle.entryPrice;
            const firstHigh = firstCandle.metadata?.high || firstCandle.entryPrice;

            let isLowPreserved = true;
            let isHighPreserved = true;

            for (let i = 1; i < sortedTrades.length; i++) {
                const item = sortedTrades[i];
                if (!item) continue;
                const candleLow = item.metadata?.low;
                const candleHigh = item.metadata?.high;

                if (candleLow !== undefined && candleLow < firstLow) {
                    isLowPreserved = false;
                }
                if (candleHigh !== undefined && candleHigh > firstHigh) {
                    isHighPreserved = false;
                }
            }

            return {
                isLowPreserved,
                isHighPreserved,
                detail: `Verified via ${sortedTrades.length} candles (5m range: L=${firstLow.toFixed(1)}, H=${firstHigh.toFixed(1)})`
            };
        } catch (error: unknown) {
            console.error(`Error verifying ORB for ${symbol}:`, error instanceof Error ? error.message : error);
            return { isLowPreserved: true, isHighPreserved: true, detail: 'Check failed (API error)' };
        }
    }

    /**
     * Fetch precise 5-Day ATR for a single stock symbol
     */
    async fetchPreciseStockATR(symbol: string): Promise<number | null> {
        if (this.stockATRCache[symbol]) {
            return this.stockATRCache[symbol];
        }
        try {
            const trades = await YahooHistoricalService.getSyntheticTrades(symbol, '1d', '7d');
            if (trades.length >= 3) {
                const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date)) as any[];
                let trSum = 0;
                let validCount = 0;

                for (let i = 1; i < sorted.length; i++) {
                    const item = sorted[i];
                    const prevItem = sorted[i - 1];
                    if (!item || !prevItem) continue;

                    const high = item.metadata?.high || item.entryPrice;
                    const low = item.metadata?.low || item.entryPrice;
                    const prevClose = prevItem.metadata?.close || prevItem.exitPrice;

                    if (high !== undefined && low !== undefined && prevClose !== undefined) {
                        const tr = Math.max(
                            high - low,
                            Math.abs(high - prevClose),
                            Math.abs(low - prevClose)
                        );
                        trSum += tr;
                        validCount++;
                    }
                }
                if (validCount > 0) {
                    const atr = trSum / validCount;
                    this.stockATRCache[symbol] = atr;
                    return atr;
                }
            }
        } catch (err: unknown) {
            console.error(`Failed to fetch precise ATR for ${symbol}:`, err instanceof Error ? err.message : err);
        }
        return null;
    }

    /**
     * Prefetch 5-Day ATR for sector constituent stocks in the background
     */
    async prefetchSectorATR(symbols: string[]): Promise<void> {
        const toFetch = symbols.filter(sym => !this.stockATRCache[sym]);
        if (toFetch.length === 0) return;

        const tasks = toFetch.map((symbol) => async () => {
            try {
                // Fetch 7 days of daily candles to guarantee at least 5 trading days
                const trades = await YahooHistoricalService.getSyntheticTrades(symbol, '1d', '7d');
                if (trades.length >= 3) {
                    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date)) as any[];
                    let trSum = 0;
                    let validCount = 0;

                    for (let i = 1; i < sorted.length; i++) {
                        const item = sorted[i];
                        const prevItem = sorted[i - 1];
                        if (!item || !prevItem) continue;

                        const high = item.metadata?.high || item.entryPrice;
                        const low = item.metadata?.low || item.entryPrice;
                        const prevClose = prevItem.metadata?.close || prevItem.exitPrice;

                        if (high !== undefined && low !== undefined && prevClose !== undefined) {
                            const tr = Math.max(
                                high - low,
                                Math.abs(high - prevClose),
                                Math.abs(low - prevClose)
                            );
                            trSum += tr;
                            validCount++;
                        }
                    }
                    if (validCount > 0) {
                        this.stockATRCache[symbol] = trSum / validCount;
                    }
                }
            } catch (err: unknown) {
                // Fail silently, fallback will be used
            }
        });

        await this.limitConcurrency(tasks, 5);
    }

    /**
     * Step 2 & 3: Fetch F&O Stocks and calculate R-Factor
     */
    async fetchFnOStocks(forceRefresh: boolean = false): Promise<StockData[]> {
        if (this.hydrationPromise) await this.hydrationPromise;
        await this.ensureUniverseInitialized();
        if (this.cachedStocks.length === 0) {
            this.cachedStocks = this.getSessionItem<StockData[]>(AlphaEngineService.CACHE_STOCKS_KEY, []);
        }
        const firstStock = this.cachedStocks[0];
        const isCacheIncomplete = this.cachedStocks.length > 0 && firstStock &&
            (!('high' in firstStock) || !('low' in firstStock));

        if (!forceRefresh && this.cachedStocks.length > 0 && !isCacheIncomplete) return this.cachedStocks;

        const isUpstoxEnabled = useSettingsStore.getState().isUpstoxEnabled;

        if (isUpstoxEnabled) {
            try {
                logger.info('AlphaEngineService: Fetching F&O Stocks via Upstox primary API');
                const symbols = this.activeFnoStocks.map(s => s.symbol);
                const quotes = await upstoxMarketDataService.getFullQuotes(symbols);

                if (quotes && Object.keys(quotes).length > 0) {
                    const stocksData: StockData[] = [];

                    for (const symbol of symbols) {
                        const quote = quotes[symbol];
                        if (!quote) continue;

                        // Determine sector
                        let sector = 'OTHERS';
                        for (const [secName, syms] of Object.entries(this.activeSectorConstituents)) {
                            if (secName === 'NIFTY 50' || secName === 'SENSEX' || secName === 'NIFTY MID SELECT') continue;
                            if (syms.includes(symbol)) {
                                sector = secName;
                                break;
                            }
                        }
                        if (sector === 'OTHERS') {
                            const fnoStock = this.activeFnoStocks.find(s => s.symbol === symbol);
                            if (fnoStock) sector = fnoStock.sector;
                        }

                        const ltp = Number(quote.last_price) || 0;
                        const openPrice = Number(quote.ohlc.open) || 0;
                        const high = Number(quote.ohlc.high) || 0;
                        const low = Number(quote.ohlc.low) || 0;
                        const prevClose = Number(quote.ohlc.close) || 0;
                        const netChange = Number(quote.net_change) || 0;
                        const percentChange = prevClose > 0 ? (netChange / prevClose) * 100 : 0;

                        const volume = Number(quote.volume) || 0;
                        const prevVolume = this.previousVolumes[symbol] || volume;
                        this.previousVolumes[symbol] = volume;

                        // Fix #2: Real Volume Surge (Upstox 20d avg)
                        const avg20dVol = this.volumeAverages[symbol]?.avg_volume_20d ?? 0;
                        const rvol = avg20dVol > 0
                            ? volume / avg20dVol
                            : (prevVolume > 0 ? volume / prevVolume : 1);

                        const openingGapPct = prevClose > 0 && openPrice > 0
                            ? ((openPrice - prevClose) / prevClose) * 100
                            : 0;

                        const dayRange = high - low;
                        const dayExtremeScore = dayRange > 0
                            ? (percentChange >= 0 ? (ltp - low) / dayRange : (high - ltp) / dayRange)
                            : 0.5;

                        const openChangePct = openPrice > 0 ? ((ltp - openPrice) / openPrice) * 100 : 0;

                        // ATR and Rebound calculations
                        const cachedAtr = this.stockATRCache[symbol];
                        const atr = cachedAtr && cachedAtr > 0 ? cachedAtr : (prevClose * 0.030); // 3.0% fallback daily range estimate
                        const gapAmt = Math.abs(openPrice - prevClose);
                        const grr = atr > 0 ? gapAmt / atr : 0;
                        const ovr = atr > 0 ? dayRange / atr : 0;

                        const isExhausted = grr > 0.70;
                        const isTrapRisk = percentChange >= 0
                            ? (openingGapPct > 0.15 && openChangePct < -0.15)
                            : (openingGapPct < -0.15 && openChangePct > 0.15);
                        const isRebound = percentChange >= 0
                            ? (openingGapPct < -0.15 && openChangePct > 0.15)
                            : false;

                        // Rule 1 Proxy (Low/High not breached from opening level by more than 0.15%)
                        const isORBLowPreservedProxy = low >= openPrice * 0.9985;
                        const isORBHighPreservedProxy = high <= openPrice * 1.0015;

                        // Fix #3: G-Factor: Eliminate 4x Code Duplication
                        const normalizedGFactor = computeGFactor({
                            percentChange,
                            openingGapPct,
                            ltp,
                            high,
                            low,
                            openPrice,
                            rvol
                        });

                        stocksData.push({
                            symbol,
                            sector,
                            lastPrice: ltp,
                            previousClose: prevClose,
                            openPrice,
                            high,
                            low,
                            percentChange: Number(percentChange.toFixed(2)) || 0,
                            volume,
                            value: Math.round(volume * (Number(quote.average_price) || ltp) * 100) / 100,
                            gFactor: normalizedGFactor,
                            rvol,
                            signal: percentChange >= 0 ? 'Up' : 'Down',
                            openingGapPct: Number(openingGapPct.toFixed(2)),
                            dayExtremeScore: Number(dayExtremeScore.toFixed(3)),
                            isORBLowPreservedProxy,
                            isORBHighPreservedProxy,
                            openChangePct: Number(openChangePct.toFixed(2)),
                            atr: Number(atr.toFixed(2)),
                            grr: Number(grr.toFixed(2)),
                            ovr: Number(ovr.toFixed(2)),
                            isExhausted,
                            isTrapRisk,
                            isRebound,
                            yearHigh: 0,
                            yearLow: 0,
                            perChange30d: 0,
                            perChange365d: 0,
                            dai: quote.dai,
                            depth_pressure: quote.depth_pressure,
                            upperCircuit: quote.upper_circuit_limit,
                            lowerCircuit: quote.lower_circuit_limit,
                            atp: quote.average_price,
                            timeOfDayRvol: getHistRatio(symbol, volume)
                        });
                    }

                    // Fetch live R-Factors in bulk and attach
                    try {
                        await this.ensureVolumeAveragesLoaded();
                        const symbolsToQuery = stocksData.map(s => s.symbol);
                        const orderFlowMap = await orderFlowService.getLatestOrderFlowBulk(symbolsToQuery);
                        stocksData.forEach(s => {
                            const ofData = orderFlowMap[s.symbol];
                            s.apexSignal = ofData ? ofData.apex_signal : 'NEUTRAL';

                            // Client-side dynamic R-Factor calculation matching TradeFinder.
                            // HONEST DEGRADATION: without the 20-day baseline, the old math
                            // collapsed rFactor into |pctChange| noise (~0 for quiet names).
                            // Leave it undefined instead - all consumers already handle that.
                            const entry = this.volumeAverages[s.symbol];
                            const avgVol = entry?.avg_volume_20d || 0;
                            if (avgVol <= 0) {
                                this.warnRFactorDegradedOnce();
                                s.rFactor = undefined;
                                return;
                            }
                            const avgAbsChg = entry?.avg_abs_change_20d || 1.0;

                            const todFraction = AlphaEngineService.getTimeOfDayExpectedVolumeFraction();
                            const expectedVolSoFar = Math.max(1, avgVol * todFraction);
                            const volRatio = s.volume / expectedVolSoFar;
                            const pctChg = Math.abs(s.percentChange);
                            const chgRatio = avgAbsChg > 0 ? pctChg / avgAbsChg : 1.0;

                            s.rFactor = Number((volRatio * chgRatio).toFixed(2));
                        });
                    } catch (err: unknown) {
                        logger.error('AlphaEngineService: Failed to attach bulk order flow data (Upstox flow)', err instanceof Error ? err.message : err);
                    }

                    this.cachedStocks = stocksData.filter(s => s.sector !== 'OTHERS');
                    this.setSessionItem(AlphaEngineService.CACHE_STOCKS_KEY, this.cachedStocks);
                    this.activeDataSource = 'UPSTOX';
                    this.setSessionItem(AlphaEngineService.CACHE_SOURCE_KEY, this.activeDataSource);
                    
                    // Evaluate R-Factor breaches for alerts
                    this.checkRFactorBreaches(this.cachedStocks);

                    return this.cachedStocks;
                }
            } catch (upstoxErr: unknown) {
                logger.error('AlphaEngineService: Upstox primary API failed, falling back to legacy NSE scraping', upstoxErr instanceof Error ? upstoxErr.message : upstoxErr);
            }
        }

        try {
            const response = await fetch('/api/python-nse/api/nse/fno-stocks');
            if (!response.ok) throw new Error(`NSE Python API error: ${response.status}`);

            const data = await response.json();
            if (!data || !Array.isArray(data.data) || data.data.length === 0) {
                throw new Error("NSE Python API returned invalid or empty F&O stocks list");
            }

            const fnoSymbols = new Set(this.activeFnoStocks.map(s => s.symbol));
            const filteredData = data.data.filter((item: any) => fnoSymbols.has(item.symbol));

            // Fetch live Yahoo Finance quotes in bulk to get high, low, open, and actual previous close
            let yahooQuotes: Record<string, any> = {};
            try {
                const symbolsToFetch = filteredData.map((item: any) => item.symbol);
                yahooQuotes = await this.fetchYahooQuotesBulk(symbolsToFetch);
            } catch (yErr: unknown) {
                logger.warn('AlphaEngineService: Failed to fetch Yahoo quotes for NSE Scraper enrichment', yErr instanceof Error ? yErr.message : yErr);
            }

            const stocksData: StockData[] = filteredData.map((item: any) => {
                const symbol = item.symbol;
                const quote = yahooQuotes[symbol];

                // Determine sector by checking SECTOR_CONSTITUENTS first (excluding indices)
                let sector = 'OTHERS';
                for (const [secName, symbols] of Object.entries(this.activeSectorConstituents)) {
                    if (secName === 'NIFTY 50' || secName === 'SENSEX' || secName === 'NIFTY MID SELECT') continue;
                    if (symbols.includes(symbol)) {
                        sector = secName;
                        break;
                    }
                }

                // Fallback to FNO_STOCKS if not found in constituents
                if (sector === 'OTHERS') {
                    const fnoStock = this.activeFnoStocks.find(s => s.symbol === symbol);
                    if (fnoStock) sector = fnoStock.sector;
                }

                const percentChange = Number(item.pchange) || 0;
                const volume = Number(item.totalTradedVolume) || 0;

                const prevVolume = this.previousVolumes[symbol] || volume;
                this.previousVolumes[symbol] = volume;

                // Fix #2: Real Volume Surge (Upstox 20d avg)
                const avg20dVol = this.volumeAverages[symbol]?.avg_volume_20d ?? 0;
                const rvol = avg20dVol > 0
                    ? volume / avg20dVol
                    : (prevVolume > 0 ? volume / prevVolume : 1);

                const openPrice = quote ? (Number(quote.regularMarketOpen) || Number(item.previousClose) || 0) : (Number(item.previousClose) || 0);
                const high = quote ? (Number(quote.regularMarketDayHigh) || Number(item.lastPrice) || 0) : (Number(item.lastPrice) || 0);
                const low = quote ? (Number(quote.regularMarketDayLow) || Number(item.lastPrice) || 0) : (Number(item.lastPrice) || 0);
                const prevClose = quote ? (Number(quote.regularMarketPreviousClose) || Number(item.previousClose) || 0) : (Number(item.previousClose) || 0);
                const ltp = Number(item.lastPrice) || 0;

                const openingGapPct = prevClose > 0 && openPrice > 0
                    ? ((openPrice - prevClose) / prevClose) * 100
                    : 0;
                const dayRange = high - low;
                const dayExtremeScore = dayRange > 0
                    ? (percentChange >= 0 ? (ltp - low) / dayRange : (high - ltp) / dayRange)
                    : 0.5;

                const openChangePct = openPrice > 0 ? ((ltp - openPrice) / openPrice) * 100 : 0;

                // ATR and Rebound calculations
                const cachedAtr = this.stockATRCache[symbol];
                const atr = cachedAtr && cachedAtr > 0 ? cachedAtr : (prevClose * 0.030); // 3.0% fallback daily range estimate
                const gapAmt = Math.abs(openPrice - prevClose);
                const grr = atr > 0 ? gapAmt / atr : 0;
                const ovr = atr > 0 ? dayRange / atr : 0;

                const isExhausted = grr > 0.70;
                const isTrapRisk = percentChange >= 0
                    ? (openingGapPct > 0.15 && openChangePct < -0.15)
                    : (openingGapPct < -0.15 && openChangePct > 0.15);
                const isRebound = percentChange >= 0
                    ? (openingGapPct < -0.15 && openChangePct > 0.15)
                    : false; // Bearish setups do not have a positive rebound setup (it is a trap risk)

                // Rule 1 Proxy (Low/High not breached from opening level by more than 0.15%)
                const isORBLowPreservedProxy = low >= openPrice * 0.9985;
                const isORBHighPreservedProxy = high <= openPrice * 1.0015;

                // Fix #3: G-Factor: Eliminate 4x Code Duplication
                const normalizedGFactor = computeGFactor({
                    percentChange,
                    openingGapPct,
                    ltp,
                    high,
                    low,
                    openPrice,
                    rvol
                });

                return {
                    symbol,
                    sector,
                    lastPrice: ltp,
                    previousClose: prevClose,
                    openPrice,
                    high,
                    low,
                    percentChange: Number(percentChange) || 0,
                    volume: Number(volume) || 0,
                    value: Number(item.totalTradedValue) || 0,
                    gFactor: normalizedGFactor,
                    rvol,
                    signal: percentChange >= 0 ? 'Up' : 'Down',
                    openingGapPct: Number(openingGapPct.toFixed(2)),
                    dayExtremeScore: Number(dayExtremeScore.toFixed(3)),
                    isORBLowPreservedProxy,
                    isORBHighPreservedProxy,
                    openChangePct: Number(openChangePct.toFixed(2)),
                    atr: Number(atr.toFixed(2)),
                    grr: Number(grr.toFixed(2)),
                    ovr: Number(ovr.toFixed(2)),
                    isExhausted,
                    isTrapRisk,
                    isRebound,
                    yearHigh: Number(item.yearHigh) || 0,
                    yearLow: Number(item.yearLow) || 0,
                    perChange30d: Number(item.perChange30d) || 0,
                    perChange365d: Number(item.perChange365d) || 0
                };
            });

            // Fetch live R-Factors in bulk and attach to stocksData
            try {
                await this.ensureVolumeAveragesLoaded();
                const symbols = stocksData.map(s => s.symbol);
                const orderFlowMap = await orderFlowService.getLatestOrderFlowBulk(symbols);
                stocksData.forEach(s => {
                    const ofData = orderFlowMap[s.symbol];
                    s.apexSignal = ofData ? ofData.apex_signal : 'NEUTRAL';

                    // Client-side dynamic R-Factor calculation matching TradeFinder.
                    // HONEST DEGRADATION: same as the Upstox path - without the
                    // baseline, undefined beats misleading near-zero noise.
                    const entry = this.volumeAverages[s.symbol];
                    const avgVol = entry?.avg_volume_20d || 0;
                    if (avgVol <= 0) {
                        this.warnRFactorDegradedOnce();
                        s.rFactor = undefined;
                        return;
                    }
                    const avgAbsChg = entry?.avg_abs_change_20d || 1.0;

                    const todFraction = AlphaEngineService.getTimeOfDayExpectedVolumeFraction();
                    const expectedVolSoFar = Math.max(1, avgVol * todFraction);
                    const volRatio = s.volume / expectedVolSoFar;
                    const pctChg = Math.abs(s.percentChange);
                    const chgRatio = avgAbsChg > 0 ? pctChg / avgAbsChg : 1.0;

                    s.rFactor = Number((volRatio * chgRatio).toFixed(2));
                });
            } catch (err) {
                logger.error('AlphaEngineService: Failed to attach bulk order flow data', err);
            }

            this.cachedStocks = stocksData.filter(s => s.sector !== 'OTHERS');
            this.setSessionItem(AlphaEngineService.CACHE_STOCKS_KEY, this.cachedStocks);
            this.activeDataSource = 'NSE_SCRAPER';
            this.setSessionItem(AlphaEngineService.CACHE_SOURCE_KEY, this.activeDataSource);
            
            // Evaluate R-Factor breaches for alerts
            this.checkRFactorBreaches(this.cachedStocks);

            return this.cachedStocks;
        } catch (error) {
            logger.error('AlphaEngineService: Failed to fetch FnO stocks', error);

            // Try Yahoo Finance bulk quotes fallback (Tier 3) to get actual market prices
            try {
                logger.info('AlphaEngineService: Attempting Yahoo Finance bulk quotes fallback...');
                const symbols = this.activeFnoStocks.map(s => s.symbol);
                const yahooQuotes = await this.fetchYahooQuotesBulk(symbols);
                if (yahooQuotes && Object.keys(yahooQuotes).length > 0) {
                    const stocksData: StockData[] = [];
                    for (const symbol of symbols) {
                        const quote = yahooQuotes[symbol];
                        if (!quote) continue;

                        let sector = 'OTHERS';
                        for (const [secName, syms] of Object.entries(this.activeSectorConstituents)) {
                            if (secName === 'NIFTY 50' || secName === 'SENSEX' || secName === 'NIFTY MID SELECT') continue;
                            if (syms.includes(symbol)) {
                                sector = secName;
                                break;
                            }
                        }
                        if (sector === 'OTHERS') {
                            const fnoStock = this.activeFnoStocks.find(s => s.symbol === symbol);
                            if (fnoStock) sector = fnoStock.sector;
                        }

                        const ltp = Number(quote.regularMarketPrice) || 0;
                        const openPrice = Number(quote.regularMarketOpen) || 0;
                        const high = Number(quote.regularMarketDayHigh) || 0;
                        const low = Number(quote.regularMarketDayLow) || 0;
                        const prevClose = Number(quote.regularMarketPreviousClose) || 0;
                        const percentChange = Number(quote.regularMarketChangePercent) || 0;
                        const volume = Number(quote.regularMarketVolume) || 0;
                        const prevVolume = this.previousVolumes[symbol] || volume;
                        this.previousVolumes[symbol] = volume;

                        // Fix #2: Real Volume Surge (Upstox 20d avg)
                        const avg20dVol = this.volumeAverages[symbol]?.avg_volume_20d ?? 0;
                        const rvol = avg20dVol > 0
                            ? volume / avg20dVol
                            : (prevVolume > 0 ? volume / prevVolume : 1);

                        const openingGapPct = prevClose > 0 && openPrice > 0
                            ? ((openPrice - prevClose) / prevClose) * 100
                            : 0;
                        const dayRange = high - low;
                        const dayExtremeScore = dayRange > 0
                            ? (percentChange >= 0 ? (ltp - low) / dayRange : (high - ltp) / dayRange)
                            : 0.5;
                        const openChangePct = openPrice > 0 ? ((ltp - openPrice) / openPrice) * 100 : 0;

                        const cachedAtr = this.stockATRCache[symbol];
                        const atr = cachedAtr && cachedAtr > 0 ? cachedAtr : (prevClose * 0.030);
                        const gapAmt = Math.abs(openPrice - prevClose);
                        const grr = atr > 0 ? gapAmt / atr : 0;
                        const ovr = atr > 0 ? dayRange / atr : 0;

                        const isExhausted = grr > 0.70;
                        const isTrapRisk = percentChange >= 0
                            ? (openingGapPct > 0.15 && openChangePct < -0.15)
                            : (openingGapPct < -0.15 && openChangePct > 0.15);
                        const isRebound = percentChange >= 0
                            ? (openingGapPct < -0.15 && openChangePct > 0.15)
                            : false;

                        // Rule 1 Proxy (Low/High not breached from opening level by more than 0.15%)
                        const isORBLowPreservedProxy = low >= openPrice * 0.9985;
                        const isORBHighPreservedProxy = high <= openPrice * 1.0015;

                        // Fix #3: G-Factor: Eliminate 4x Code Duplication
                        const normalizedGFactor = computeGFactor({
                            percentChange,
                            openingGapPct,
                            ltp,
                            high,
                            low,
                            openPrice,
                            rvol
                        });

                        stocksData.push({
                            symbol,
                            sector,
                            lastPrice: ltp,
                            previousClose: prevClose,
                            openPrice,
                            high,
                            low,
                            percentChange: Number(percentChange.toFixed(2)),
                            volume,
                            value: volume * ltp,
                            gFactor: normalizedGFactor,
                            rvol,
                            signal: percentChange >= 0 ? 'Up' : 'Down',
                            openingGapPct: Number(openingGapPct.toFixed(2)),
                            dayExtremeScore: Number(dayExtremeScore.toFixed(3)),
                            isORBLowPreservedProxy,
                            isORBHighPreservedProxy,
                            openChangePct: Number(openChangePct.toFixed(2)),
                            atr: Number(atr.toFixed(2)),
                            grr: Number(grr.toFixed(2)),
                            ovr: Number(ovr.toFixed(2)),
                            isExhausted,
                            isTrapRisk,
                            isRebound,
                            yearHigh: Number(quote.fiftyTwoWeekHigh) || 0,
                            yearLow: Number(quote.fiftyTwoWeekLow) || 0,
                            perChange30d: 0,
                            perChange365d: 0,
                            timeOfDayRvol: getHistRatio(symbol, volume)
                        });
                    }

                    this.cachedStocks = stocksData.filter(s => s.sector !== 'OTHERS');
                    this.setSessionItem(AlphaEngineService.CACHE_STOCKS_KEY, this.cachedStocks);
                    this.activeDataSource = 'YAHOO';
                    this.setSessionItem(AlphaEngineService.CACHE_SOURCE_KEY, this.activeDataSource);
                    logger.info(`AlphaEngineService: Successfully loaded ${this.cachedStocks.length} F&O stocks from Yahoo Finance bulk fallback`);
                    return this.cachedStocks;
                }
            } catch (yahooErr) {
                logger.error('AlphaEngineService: Yahoo Finance bulk quotes fallback failed', yahooErr);
            }

            if (this.cachedStocks && this.cachedStocks.length > 0) {
                return this.cachedStocks;
            }
            logger.warn('AlphaEngineService: No cached stocks and live feeds failed, generating local mock fallback');
            this.activeDataSource = 'MOCK';
            this.setSessionItem(AlphaEngineService.CACHE_SOURCE_KEY, this.activeDataSource);
            this.cachedStocks = this.generateFallbackStocks();
            this.setSessionItem(AlphaEngineService.CACHE_STOCKS_KEY, this.cachedStocks);
            return this.cachedStocks;
        }
    }

    private checkRFactorBreaches(stocks: StockData[]) {
        const nowMs = Date.now();
        // Cooldown for R-Factor alerts (default 4 hours, i.e., 240 minutes)
        const cooldownMs = 4 * 60 * 60 * 1000; 

        stocks.forEach(s => {
            if (s.rFactor && s.rFactor >= 3.5) {
                const cooldownKey = `${s.symbol}-RFACTOR-GOLD`;
                const lastAlert = this.lastRFactorAlertTimes.get(cooldownKey) || 0;
                if (nowMs - lastAlert > cooldownMs) {
                    this.lastRFactorAlertTimes.set(cooldownKey, nowMs);
                    
                    // Trigger alert via OmniAlertDispatcher
                    logger.warn(`[AlphaEngine] R-FACTOR BREACH: ${s.symbol} reached Gold Tier with R-Factor of ${s.rFactor}`);
                    
                    const event = {
                        symbol: s.symbol,
                        instrumentKey: '',
                        currentPrice: s.lastPrice,
                        movePct: s.percentChange,
                        windowMinutes: 15,
                        volumeMultiplier: s.rvol || 0,
                        direction: s.percentChange >= 0 ? 'UP' as const : 'DOWN' as const,
                        triggerType: 'VERDICT_FIRE' as const,
                        timestamp: nowMs,
                        velocity: `R-Factor: ${s.rFactor}`
                    };

                    import('./OmniAlertDispatcher').then(({ omniAlertDispatcher }) => {
                        omniAlertDispatcher.fire(
                            event, 
                            `R-Factor Gold Tier reached! Value: ${s.rFactor} (Apex Signal: ${s.apexSignal || 'NEUTRAL'})`
                        );
                    }).catch(err => {
                        logger.error('AlphaEngineService: Failed to dispatch R-factor alert', err);
                    });
                }
            }
        });
    }

    /**
     * Calculate Multi-Source Sector Confluence & Strength Index (SCS)
     * Combines price action performance, breadth from F&O movements, and constituent momentum.
     */
    calculateSectorConfluence(
        sectorsList: SectorData[],
        boosterRawData: any[] = [],
        boosterStocksList: any[] = []
    ): SectorData[] {
        const normalizeSectorName = (name: string): string => {
            const clean = name.replace(/Nifty\s+/gi, '').replace(/NIFTY\s+/gi, '').trim().toUpperCase();
            if (clean === 'PVT BANK' || clean === 'PRIVATE BANK') return 'PVT BANK';
            if (clean === 'PSU BANK') return 'PSU BANK';
            if (clean === 'BANK' || clean === 'BANKS') return 'BANK';
            if (clean === 'FIN SERVICE' || clean === 'FINANCIAL SERVICES' || clean === 'FINANCIAL SERVICE' || clean === 'FIN SERVICES') return 'FIN SERVICE';
            if (clean === 'FMCG') return 'FMCG';
            if (clean === 'IT') return 'IT';
            if (clean === 'METAL' || clean === 'METALS') return 'METAL';
            if (clean === 'PHARMA' || clean === 'PHARMACEUTICALS') return 'PHARMA';
            if (clean === 'HEALTHCARE' || clean === 'HEALTH' || clean === '500 HEALTH' || clean === 'MIDSML HLTH') return 'HEALTHCARE';
            if (clean === 'REALTY' || clean === 'REAL ESTATE') return 'REALTY';
            if (clean === 'ENERGY' || clean === 'OIL & GAS' || clean === 'OIL AND GAS' || clean === 'OIL&GAS') return 'OIL & GAS';
            if (clean === 'AUTO' || clean === 'AUTOMOBILE') return 'AUTO';
            if (clean === 'CEMENT') return 'CEMENT';
            if (clean === 'DEFENSE' || clean === 'DEFENCE') return 'DEFENSE';
            if (clean === 'CAP GOODS' || clean === 'CAPITAL GOODS') return 'CAP GOODS';
            if (clean === 'SERVICES' || clean === 'SERVICE') return 'SERVICES';
            return clean;
        };

        const activeStocks = this.getCachedStocks();

        return sectorsList.map(s => {
            // 1. Performance Score
            const openChangePct = s.openChangePct ?? 0;
            const percentChange = s.percentChange ?? 0;
            const l2cChangePct = s.l2cChangePct ?? 0;
            const h2cChangePct = s.h2cChangePct ?? 0;
            const fatigueScore = s.fatigueScore ?? 0;

            // Protect against false bias during trend reversal transitions
            let effectiveFatigueScore = fatigueScore;
            if ((fatigueScore > 0 && percentChange < 0) || (fatigueScore < 0 && percentChange > 0)) {
                effectiveFatigueScore = 0;
            }

            const prevClose = s.previousClose ?? 0;
            const openPrice = s.openPrice ?? 0;
            const openingGapPct = prevClose > 0 && openPrice > 0
                ? ((openPrice - prevClose) / prevClose) * 100
                : 0;

            const isLargeGapDay = Math.abs(openingGapPct) >= AlphaEngineService.SCS_GAP_THRESHOLD_PCT;
            const wO2C     = isLargeGapDay ? 0.25 : 0.40;
            const wC2C     = isLargeGapDay ? 0.35 : 0.20;
            const wL2C     = 0.15;
            const wH2C     = 0.10;
            const wFatigue = 0.10;

            const perfVal = wO2C * openChangePct 
                          + wC2C * percentChange 
                          + wL2C * l2cChangePct 
                          + wH2C * h2cChangePct 
                          + wFatigue * effectiveFatigueScore;
            const sPerformance = 100 * Math.tanh(perfVal);

            // 2. Breadth Score
            let positive = 0;
            let negative = 0;
            const normalizedSec = normalizeSectorName(s.sector);

            const boosterSector = boosterRawData?.find(b => normalizeSectorName(b.sector || b.name || '') === normalizedSec);

            if (boosterSector && Array.isArray(boosterSector.stock_list) && boosterSector.stock_list.length > 0) {
                boosterSector.stock_list.forEach((item: any) => {
                    const change = parseFloat(item.change_per) || 0;
                    if (change > 0) positive++;
                    else if (change < 0) negative++;
                });
            } else {
                // Fallback to active constituent stocks from cachedStocks
                const sectorConstituentSymbols = this.activeSectorConstituents[s.sector] || [];
                const matchingStocks = activeStocks.filter(st => sectorConstituentSymbols.includes(st.symbol));
                matchingStocks.forEach(st => {
                    if (st.percentChange > 0) positive++;
                    else if (st.percentChange < 0) negative++;
                });
            }

            const total = positive + negative;
            const bullsBearsRatio = total > 0 ? (positive - negative) / total : 0;
            const sBreadth = bullsBearsRatio * 100;
            const breadthActive = total > 0;

            // 3. Constituent Momentum Score (Market-Cap / Turnover Weighted)
            let rRaw = 0;
            let boosterConstituentCount = 0;
            let topDriver: StockData | null = null;
            let maxAbsChange = -1;

            const sectorConstituentSymbols = this.activeSectorConstituents[s.sector] || [];
            const matchingStocks = activeStocks.filter(st => sectorConstituentSymbols.includes(st.symbol));
            const momentumActive = matchingStocks.length > 0;

            // Calculate constituent market-cap/turnover weights
            const totalTurnover = matchingStocks.reduce(
                (sum, st) => sum + Math.max(1000, (st.lastPrice || 100) * (st.volume || 10000)),
                0
            );

            matchingStocks.forEach(st => {
                const dir = st.percentChange > 0 ? 1 : (st.percentChange < 0 ? -1 : 0);
                const stockTurnover = Math.max(1000, (st.lastPrice || 100) * (st.volume || 10000));
                // Normalized market-cap weight (average = 1.0)
                const capWeight = totalTurnover > 0
                    ? (stockTurnover / totalTurnover) * matchingStocks.length
                    : 1.0;
                const effectiveCapWeight = Math.min(3.5, Math.max(0.2, capWeight));

                let stockMomentum = dir * (st.gFactor ?? 0);

                // Check if in top 15 of boosterStocksList
                const top15Booster = boosterStocksList?.slice(0, 15) || [];
                const isInTop15Booster = top15Booster.some(b => (b.Symbol || b.symbol_name || '').toUpperCase() === st.symbol.toUpperCase());
                if (isInTop15Booster) {
                    stockMomentum += dir * 5.0;
                }

                rRaw += effectiveCapWeight * stockMomentum;

                // Check if in entire boosterStocksList
                const isInBooster = boosterStocksList?.some(b => (b.Symbol || b.symbol_name || '').toUpperCase() === st.symbol.toUpperCase());
                if (isInBooster) {
                    boosterConstituentCount++;
                }

                // Track top driver
                const absChange = Math.abs(st.percentChange);
                if (absChange > maxAbsChange) {
                    maxAbsChange = absChange;
                    topDriver = st;
                }
            });

            const sMomentum = 100 * Math.tanh(rRaw * 0.1);

            // 4. Sector Confluence Score (SCS) with Dynamic Weight Redistribution
            let activeWeightSum = 0.4; // Performance is always available
            if (breadthActive) activeWeightSum += 0.3;
            if (momentumActive) activeWeightSum += 0.3;

            const wPerf = 0.4 / activeWeightSum;
            const wBreadth = breadthActive ? (0.3 / activeWeightSum) : 0;
            const wMomentum = momentumActive ? (0.3 / activeWeightSum) : 0;

            const scs = wPerf * sPerformance + wBreadth * sBreadth + wMomentum * sMomentum;

            // Grade Mapping
            let confluenceGrade: SectorData['confluenceGrade'] = 'NEUTRAL';
            if (scs >= 75) confluenceGrade = 'ELITE BULLISH';
            else if (scs >= 25) confluenceGrade = 'STRONG BULLISH';
            else if (scs <= -75) confluenceGrade = 'ELITE BEARISH';
            else if (scs <= -25) confluenceGrade = 'STRONG BEARISH';

            return {
                ...s,
                confluenceScore: Number(scs.toFixed(2)),
                confluenceGrade,
                bullsBearsRatio: Number(bullsBearsRatio.toFixed(2)),
                intradayBoosterCount: boosterConstituentCount,
                topDriverSymbol: topDriver ? (topDriver as StockData).symbol : undefined,
                topDriverStrength: topDriver ? (topDriver as StockData).percentChange : undefined
            };
        });
    }

    private async fetchYahooQuotesBulk(symbols: string[]): Promise<Record<string, any>> {
        try {
            const chunks: string[][] = [];
            const chunkSize = 20; // Fixed: Yahoo Spark API limits requests to max 20 symbols
            for (let i = 0; i < symbols.length; i += chunkSize) {
                chunks.push(symbols.slice(i, i + chunkSize));
            }

            const results: Record<string, any> = {};

            await Promise.all(chunks.map(async (chunk) => {
                const yahooSymbols = chunk.map(s => s.endsWith('.NS') ? s : `${s.replace('&', '%26')}.NS`).join(',');
                const url = `/api/yahoo/v7/finance/spark?symbols=${yahooSymbols}&range=1d&interval=5m`;
                const response = await fetch(url);
                if (response.ok) {
                    const json = await response.json();
                    if (json.spark && Array.isArray(json.spark.result)) {
                        json.spark.result.forEach((item: any) => {
                            if (!item || !item.symbol) return;
                            const cleanSymbol = item.symbol.replace('.NS', '');
                            const respObj = item.response?.[0];
                            const meta = respObj?.meta;
                            if (meta) {
                                const closeArr = respObj.indicators?.quote?.[0]?.close || [];
                                const open = closeArr.find((v: any) => v !== null) || meta.chartPreviousClose || meta.regularMarketPrice || 0;
                                results[cleanSymbol] = {
                                    regularMarketOpen: open,
                                    regularMarketDayHigh: meta.regularMarketDayHigh ?? meta.regularMarketPrice ?? 0,
                                    regularMarketDayLow: meta.regularMarketDayLow ?? meta.regularMarketPrice ?? 0,
                                    regularMarketPreviousClose: meta.chartPreviousClose ?? 0,
                                    regularMarketPrice: meta.regularMarketPrice ?? 0,
                                    regularMarketVolume: meta.regularMarketVolume ?? 0,
                                    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? meta.regularMarketPrice ?? 0,
                                    fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? meta.regularMarketPrice ?? 0,
                                };
                            }
                        });
                    }
                }
            }));

            return results;
        } catch (e) {
            logger.warn('AlphaEngineService: Yahoo bulk quotes fetch failed', e);
            return {};
        }
    }

    private generateFallbackStocks(): StockData[] {
        return this.activeFnoStocks.map(f => {
            const sym = f.symbol;
            let hash = 0;
            for (let i = 0; i < sym.length; i++) hash += sym.charCodeAt(i);

            const lastPrice = 150 + (hash % 4350);
            const percentChange = Number((((hash % 130) - 60) / 20).toFixed(2));
            const signal = percentChange >= 0 ? 'Up' : 'Down';
            const openingGapPct = Number((((hash % 90) - 40) / 30).toFixed(2));
            const volume = 500000 + (hash % 10) * 450000;

            const prevClose = lastPrice / (1 + percentChange / 100);
            const openPrice = prevClose * (1 + openingGapPct / 100);

            const low = Math.min(lastPrice, openPrice) - (hash % 5) * 5;
            const high = Math.max(lastPrice, openPrice) + (hash % 7) * 5;

            const openChangePct = openPrice > 0 ? ((lastPrice - openPrice) / openPrice) * 100 : 0;
            const dayRangeAct = high - low;
            const dayExtremeScore = dayRangeAct > 0
                ? (percentChange >= 0 ? (lastPrice - low) / dayRangeAct : (high - lastPrice) / dayRangeAct)
                : 0.5;

            const isORBLowPreservedProxy = low >= openPrice * 0.9985;
            const isORBHighPreservedProxy = high <= openPrice * 1.0015;
            const isVolumeSurge = hash % 3 === 0;
            const rvol = isVolumeSurge ? 1.6 : 1.0;

            const gFactor = computeGFactor({
                percentChange,
                openingGapPct,
                ltp: lastPrice,
                high,
                low,
                openPrice,
                rvol
            });
            const atr = prevClose * 0.030;
            const grr = atr > 0 ? Math.abs(openPrice - prevClose) / atr : 0;
            const ovr = atr > 0 ? (high - low) / atr : 0;

            return {
                symbol: sym,
                sector: f.sector,
                lastPrice: Number(lastPrice.toFixed(2)),
                previousClose: Number(prevClose.toFixed(2)),
                openPrice: Number(openPrice.toFixed(2)),
                high: Number(high.toFixed(2)),
                low: Number(low.toFixed(2)),
                percentChange: Number(percentChange.toFixed(2)),
                volume,
                value: volume * lastPrice,
                gFactor,
                rvol,
                rFactor: Number((1.0 + (hash % 10) / 10).toFixed(2)),
                signal,
                openingGapPct: Number(openingGapPct.toFixed(2)),
                dayExtremeScore: Number(dayExtremeScore.toFixed(3)),
                isORBLowPreservedProxy,
                isORBHighPreservedProxy,
                openChangePct: Number(openChangePct.toFixed(2)),
                atr: Number(atr.toFixed(2)),
                grr: Number(grr.toFixed(2)),
                ovr: Number(ovr.toFixed(2)),
                isExhausted: grr > 0.70,
                isTrapRisk: percentChange >= 0
                    ? (openingGapPct > 0.15 && openChangePct < -0.15)
                    : (openingGapPct < -0.15 && openChangePct > 0.15),
                isRebound: percentChange >= 0 ? (openingGapPct < -0.15 && openChangePct > 0.15) : false,
                apexSignal: 'NEUTRAL',
                yearHigh: Number((lastPrice * 1.3).toFixed(2)),
                yearLow: Number((lastPrice * 0.7).toFixed(2)),
                perChange30d: Number((percentChange * 2.5).toFixed(2)),
                perChange365d: Number((percentChange * 12).toFixed(2))
            };
        });
    }

    /**
     * Fetch PCR Gate and update pcrGate and pcrValue state
     */
    async fetchPCRGate(forceRefresh: boolean = false): Promise<'BULLISH' | 'NEUTRAL' | 'BEARISH'> {
        try {
            const pcrData = await upstoxMarketDataService.getPCR('NIFTY');
            if (pcrData && pcrData.pcr !== undefined) {
                this.pcrValue = pcrData.pcr;
                if (this.pcrValue > 1.3) this.pcrGate = 'BULLISH';
                else if (this.pcrValue < 0.7) this.pcrGate = 'BEARISH';
                else this.pcrGate = 'NEUTRAL';
            }
        } catch (err) {
            logger.error('AlphaEngineService: Failed to fetch PCR Gate', err);
        }
        return this.pcrGate;
    }

    getPCRGate() {
        return this.pcrGate;
    }

    getPCRValue() {
        return this.pcrValue;
    }

    /**
     * Fetch consolidated FII/DII flow and update macroBias state
     */
    async fetchMacroBias(forceRefresh: boolean = false): Promise<'STRONG_BULLISH' | 'HEDGED' | 'NEUTRAL' | 'DISTRIBUTION'> {
        try {
            const data = await upstoxMarketDataService.getFiiDiiConsolidated(5);
            if (data && data.status === 'success' && data.today) {
                const today = data.today;
                this.macroBias = today.macro_bias || 'NEUTRAL';
                this.fiiCashNet = today.fii_cash || 0;
            }
        } catch (err) {
            logger.error('AlphaEngineService: Failed to fetch macro FII/DII bias', err);
        }
        return this.macroBias;
    }

    getMacroBias() {
        return this.macroBias;
    }

    getFiiCashNet() {
        return this.fiiCashNet;
    }

    /**
     * Fetch all cached ORE results
     */
    async fetchOREAll(date?: string): Promise<any[]> {
        try {
            const url = date
                ? `/api/python-nse/api/alpha/ore/all?date=${encodeURIComponent(date)}`
                : '/api/python-nse/api/alpha/ore/all';
            const res = await fetch(url);
            if (res.ok) {
                const json = await res.json();
                return json.data || [];
            }
        } catch (err) {
            logger.error('AlphaEngineService: Failed to fetch ORE all data', err);
        }
        return [];
    }

    /**
     * Trigger ORE batch calculation
     */
    async triggerOREBatch(symbols: string[]): Promise<any> {
        try {
            const res = await fetch('/api/python-nse/api/alpha/ore/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols })
            });
            if (res.ok) return await res.json();
        } catch (err) {
            logger.error('AlphaEngineService: Failed to trigger ORE batch', err);
        }
        return null;
    }

    /**
     * Fetch ORE batch progress
     */
    async fetchOREProgress(): Promise<any> {
        try {
            const res = await fetch('/api/python-nse/api/alpha/ore/progress');
            if (res.ok) return await res.json();
        } catch (err) {
            logger.error('AlphaEngineService: Failed to fetch ORE progress', err);
        }
        return null;
    }

    /**
     * Fetch bulk CVD values from WebSocket server cache
     */
    async fetchCVDBulk(): Promise<Record<string, number>> {
        try {
            const res = await fetch('/api/python-nse/api/upstox/cvd/bulk');
            if (res.ok) {
                const json = await res.json();
                return json.data || {};
            }
        } catch (err) {
            logger.error('AlphaEngineService: Failed to fetch CVD bulk', err);
        }
        return {};
    }

    /**
     * Fetch all cached RS ranks
     */
    async fetchRSRankAll(date?: string): Promise<any[]> {
        try {
            const url = date
                ? `/api/python-nse/api/alpha/rs-rank/all?date=${encodeURIComponent(date)}`
                : '/api/python-nse/api/alpha/rs-rank/all';
            const res = await fetch(url);
            if (res.ok) {
                const json = await res.json();
                return json.data || [];
            }
        } catch (err) {
            logger.error('AlphaEngineService: Failed to fetch RS rank all data', err);
        }
        return [];
    }

    /**
     * Trigger RS rank sync
     */
    async triggerRSRankSync(symbols: string[]): Promise<any> {
        try {
            const res = await fetch('/api/python-nse/api/alpha/rs-rank/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols })
            });
            if (res.ok) return await res.json();
        } catch (err) {
            logger.error('AlphaEngineService: Failed to trigger RS Rank sync', err);
        }
        return null;
    }

    /**
     * Fetch RS rank progress
     */
    async fetchRSRankProgress(): Promise<any> {
        try {
            const res = await fetch('/api/python-nse/api/alpha/rs-rank/progress');
            if (res.ok) return await res.json();
        } catch (err) {
            logger.error('AlphaEngineService: Failed to fetch RS Rank progress', err);
        }
        return null;
    }

    /**
     * Fetch all cached candle patterns
     */
    async fetchPatternScanAll(date?: string): Promise<{ data: any[]; warning?: string }> {
        try {
            const url = date
                ? `/api/python-nse/api/alpha/pattern-scan/all?date=${encodeURIComponent(date)}`
                : '/api/python-nse/api/alpha/pattern-scan/all';
            const res = await fetch(url);
            if (res.ok) {
                const json = await res.json();
                return {
                    data: json.data || [],
                    warning: json.warning
                };
            }
        } catch (err) {
            logger.error('AlphaEngineService: Failed to fetch pattern scan all data', err);
        }
        return { data: [] };
    }

    /**
     * Trigger pattern scan batch
     */
    async triggerPatternScan(symbols: string[]): Promise<any> {
        try {
            const res = await fetch('/api/python-nse/api/alpha/pattern-scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols })
            });
            if (res.ok) return await res.json();
        } catch (err) {
            logger.error('AlphaEngineService: Failed to trigger pattern scan', err);
        }
        return null;
    }

    /**
     * Fetch pattern scan progress
     */
    async fetchPatternScanProgress(): Promise<any> {
        try {
            const res = await fetch('/api/python-nse/api/alpha/pattern-scan/progress');
            if (res.ok) return await res.json();
        } catch (err) {
            logger.error('AlphaEngineService: Failed to fetch pattern progress', err);
        }
        return null;
    }

    /**
     * Fetch all cached shareholding velocities
     */
    async fetchShareholdingVelocityAll(): Promise<any[]> {
        try {
            const res = await fetch('/api/python-nse/api/alpha/shareholding-velocity/all');
            if (res.ok) {
                const json = await res.json();
                return json.data || [];
            }
        } catch (err) {
            logger.error('AlphaEngineService: Failed to fetch shareholding velocities', err);
        }
        return [];
    }

    /**
     * Trigger shareholding velocity sync
     */
    async triggerShareholdingSync(symbols: string[]): Promise<any> {
        try {
            const res = await fetch('/api/python-nse/api/alpha/shareholding-velocity/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols })
            });
            if (res.ok) return await res.json();
        } catch (err) {
            logger.error('AlphaEngineService: Failed to trigger shareholding velocity sync', err);
        }
        return null;
    }

    /**
     * Fetch shareholding sync progress
     */
    async fetchShareholdingProgress(): Promise<any> {
        try {
            const res = await fetch('/api/python-nse/api/alpha/shareholding-velocity/progress');
            if (res.ok) return await res.json();
        } catch (err) {
            logger.error('AlphaEngineService: Failed to fetch shareholding progress', err);
        }
        return null;
    }

    /**
     * Fetch OI change data for a symbol
     */
    async fetchChangeOI(symbol: string, expiry: string, date?: string, interval: number = 15): Promise<any> {
        try {
            const dateParam = date ? `&date=${encodeURIComponent(date)}` : '';
            const url = `/api/python-nse/api/upstox/change-oi?symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}${dateParam}&interval=${interval}`;
            const res = await fetch(url);
            if (res.ok) {
                return await res.json();
            }
        } catch (err) {
            logger.error(`AlphaEngineService: Failed to fetch OI change for ${symbol}`, err);
        }
        return null;
    }

    /**
     * AI-Powered Signal Interpretation
     * Provides a qualitative "Intelligence Overlay" on top of raw quantitative signals.
     */
    async interpretSignalAI(stock: StockData): Promise<string> {
        const mood = this.getCachedMood();
        const sector = this.cachedSectors.find(s => s.sector === stock.sector);
        
        const prompt = `
            You are a "Signal Analyst". Interpret this quantitative stock signal:
            
            STOCK: ${stock.symbol}
            PRICE: ₹${stock.lastPrice} (${stock.percentChange}%)
            G-FACTOR: ${stock.gFactor}
            APEX SIGNAL: ${stock.apexSignal || 'Neutral'}
            SECTOR: ${stock.sector} (${sector?.percentChange || 0}%)
            MARKET MOOD: ${mood?.isBullish ? 'BULLISH' : 'BEARISH'}
            
            GOAL: Explain the "Conviction" behind this setup in 1-2 punchy sentences.
            Detect if this is a "Bull Trap" or a "Clean Breakout".
            
            STRICT RULES:
            1. No generic fluff.
            2. Mention the G-Factor if it's high (> 7).
            3. Be skeptical if Market Mood is BEARISH but stock is UP.
        `;

        try {
            const response = await llmPipeline(prompt, {
                modelOverride: 'llama-3.1-8b-instant',
                requireHighIntelligence: false
            });
            return response.text;
        } catch (error) {
            logger.error(`AlphaEngine: AI interpretation failed for ${stock.symbol}`, error);
            return "Unable to generate intelligence overlay at this time.";
        }
    }

    /**
     * Ghost Setup Tracking: Records all candidates identified during 10:30 AM scanner runs
     * to `db.scan_candidates` regardless of whether they were traded.
     */
    async recordGhostScanCandidates(candidates: Array<{ symbol: string; combinedScore: number; mlProb: number; quantScore: number; aiConviction: number }>): Promise<void> {
        try {
            const { db } = await import('../database');
            const now = Date.now();
            const rows = candidates.map(c => ({
                symbol: c.symbol,
                combinedScore: c.combinedScore,
                mlProb: c.mlProb,
                quantScore: c.quantScore,
                aiConviction: c.aiConviction,
                scanTime: now,
                wasTraded: false,
                actualReturn: null
            }));

            await db.scan_candidates.bulkAdd(rows);
            logger.info(`[AlphaEngineService] Ghost setup tracking logged ${rows.length} scan candidates.`);
        } catch (err) {
            logger.error('[AlphaEngineService] Failed to log ghost scan candidates:', err);
        }
    }

    /**
     * SPRINT 2.E1/E2 — Ghost-loop backfill + recalibration.
     * 1. Finds scan candidates older than 24h whose outcome was never filled.
     * 2. Backfills actualReturn from Yahoo daily closes (first close after the
     *    scan -> latest close).
     * 3. Feeds all resolved outcomes into recalibrateWeights().
     * Designed to run WEEKLY from App.tsx's scheduler; cheap no-op when there
     * is nothing to backfill.
     */
    async backfillGhostOutcomesAndRecalibrate(): Promise<{ backfilled: number; weights: { mlWeight: number; quantWeight: number; aiWeight: number } | null }> {
        try {
            const { db } = await import('../database');
            const cutoff = Date.now() - 24 * 60 * 60 * 1000;
            const pending = await db.scan_candidates
                .filter((c: any) => c.scanTime < cutoff && (c.actualReturn === null || c.actualReturn === undefined))
                .toArray();
            if (pending.length === 0) {
                return { backfilled: 0, weights: null };
            }

            // Group by symbol so each symbol needs only one history fetch.
            const bySymbol = new Map<string, any[]>();
            for (const c of pending) {
                if (!bySymbol.has(c.symbol)) bySymbol.set(c.symbol, []);
                bySymbol.get(c.symbol)!.push(c);
            }

            let backfilled = 0;
            for (const [symbol, rows] of bySymbol) {
                try {
                    const trades = await YahooHistoricalService.getSyntheticTrades(symbol, '1d', '6mo');
                    const closes = (trades || [])
                        .map((t: any) => ({ ts: t.timestamp || t.metadata?.date ? new Date(t.metadata?.date || t.timestamp).getTime() : 0, price: t.exitPrice || t.metadata?.close }))
                        .filter((x: any) => x.price > 0 && x.ts > 0)
                        .sort((a: any, b: any) => a.ts - b.ts);
                    if (closes.length < 2) continue;

                    const latest = closes[closes.length - 1].price;
                    for (const row of rows) {
                        // First close AFTER the scan time = T+1-ish entry reference
                        const ref = closes.find((c: any) => c.ts >= row.scanTime);
                        if (!ref || latest <= 0 || ref.price <= 0) continue;
                        row.actualReturn = Number((((latest - ref.price) / ref.price) * 100).toFixed(2));
                        backfilled++;
                    }
                    await db.scan_candidates.bulkPut(rows);
                } catch (symErr) {
                    logger.warn(`[AlphaEngineService] Ghost backfill failed for ${symbol}:`, symErr);
                }
            }

            // Feed every candidate with a resolved outcome into recalibration
            const allWithOutcome = await db.scan_candidates
                .filter((c: any) => c.actualReturn !== null && c.actualReturn !== undefined)
                .toArray();
            let weights: { mlWeight: number; quantWeight: number; aiWeight: number } | null = null;
            if (allWithOutcome.length >= 10) {
                weights = await this.recalibrateWeights(allWithOutcome.map((c: any) => ({
                    symbol: c.symbol,
                    actualReturn: c.actualReturn,
                    mlProb: c.mlProb,
                    quantScore: c.quantScore,
                    aiConviction: c.aiConviction
                })));
                logger.info(`[AlphaEngineService] Ghost recalibration complete. Weights: ml=${weights.mlWeight.toFixed(2)} quant=${weights.quantWeight.toFixed(2)} ai=${weights.aiWeight.toFixed(2)} (from ${allWithOutcome.length} outcomes)`);
            }

            return { backfilled, weights };
        } catch (err) {
            logger.error('[AlphaEngineService] backfillGhostOutcomesAndRecalibrate failed:', err);
            return { backfilled: 0, weights: null };
        }
    }

    /**
     * Online ML Outcome Recalibration: Re-weights ML, Quant, and AI components
     * based on historical accuracy, enforcing a strict 15% floor per component weight.
     */
    async recalibrateWeights(outcomes: Array<{ symbol: string; actualReturn: number; mlProb: number; quantScore: number; aiConviction: number }>): Promise<{ mlWeight: number; quantWeight: number; aiWeight: number }> {
        // Default baseline weights
        let mlWeight = 0.40;
        let quantWeight = 0.35;
        let aiWeight = 0.25;

        if (!outcomes || outcomes.length === 0) {
            return { mlWeight, quantWeight, aiWeight };
        }

        try {
            let mlError = 0;
            let quantError = 0;
            let aiError = 0;

            for (const o of outcomes) {
                const target = o.actualReturn > 0 ? 1 : 0;
                mlError += Math.pow(target - o.mlProb, 2);
                quantError += Math.pow(target - (o.quantScore / 100), 2);
                aiError += Math.pow(target - (o.aiConviction / 100), 2);
            }

            const n = outcomes.length;
            const mlMse = mlError / n;
            const quantMse = quantError / n;
            const aiMse = aiError / n;

            // Invert MSE to get raw accuracy weights
            const mlAcc = 1 / (mlMse + 0.01);
            const quantAcc = 1 / (quantMse + 0.01);
            const aiAcc = 1 / (aiMse + 0.01);
            const sumAcc = mlAcc + quantAcc + aiAcc;

            // Raw normalized proposal
            let rawMl = mlAcc / sumAcc;
            let rawQuant = quantAcc / sumAcc;
            let rawAi = aiAcc / sumAcc;

            // Enforce 15% floor (0.15) per weight component
            const FLOOR = 0.15;
            rawMl = Math.max(FLOOR, rawMl);
            rawQuant = Math.max(FLOOR, rawQuant);
            rawAi = Math.max(FLOOR, rawAi);

            // Re-normalize after clamping
            const total = rawMl + rawQuant + rawAi;
            mlWeight = Number((rawMl / total).toFixed(3));
            quantWeight = Number((rawQuant / total).toFixed(3));
            aiWeight = Number((1 - mlWeight - quantWeight).toFixed(3)); // preserve exact sum 1.0

            logger.info(`[AlphaEngineService] Recalibrated component weights -> ML: ${mlWeight}, Quant: ${quantWeight}, AI: ${aiWeight}`);
            return { mlWeight, quantWeight, aiWeight };
        } catch (err) {
            logger.error('[AlphaEngineService] Recalibration failed, using default weights:', err);
            return { mlWeight: 0.40, quantWeight: 0.35, aiWeight: 0.25 };
        }
    }
}

export const alphaEngineService = AlphaEngineService.getInstance();

/**
 * Alpha Engine 2.0 — Stock Selection façade.
 *
 * The engine itself is a pure function (`selectUniverse` in
 * `services/alpha/StockSelectionEngine.ts`).  We re-export a couple of
 * convenience wrappers here so consumers can stay on the
 * `alphaEngineService.*` API surface and not have to import from the
 * alpha sub-folder.
 */
import {
    selectUniverse,
    runSelectionForActiveUniverse,
    buildSectorRotation,
    type StockSelection,
    type SectorRotationRow,
} from './alpha/StockSelectionEngine';

export type { StockSelection, SectorRotationRow };

export const alphaSelectionService = {
    run: runSelectionForActiveUniverse,
    selectUniverse,
    buildSectorRotation,
};

