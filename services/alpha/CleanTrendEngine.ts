/**
 * CC68.43 — Clean Trend Day engine (institutional-footprint pattern).
 *
 * Detects the pattern the user trades: a stock that opens near the previous
 * close (small gap), gets an institutional volume spike around 9:30, then
 * trends in one direction with shallow pullbacks till mid-session. Excludes
 * the trap of a big gap up/down that then goes range-bound or reverses.
 *
 * Pure + testable. Consumes 5-min candles (today, live) and an optional
 * historical baseline (parquet) for the 9:30-volume comparison. Every sub-check
 * is toggleable; OFF = skipped (neutral, never blocks).
 *
 * See plan: C:\Users\gadda\.claude\plans\velvety-discovering-gem.md
 */

export interface Candle {
  ts: string;   // 'HH:MM' or ISO — HH:MM is extracted for same-time matching
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface CleanTrendThresholds {
  maxGapPct: number;           // |openingGapPct| <= this → "opens near previous close"
  volumeSpikeMultiple: number; // 9:30 candle vol >= this × baseline → institutional entry
  maxPullbackPct: number;      // max drawdown from a running peak (pullback depth)
  minLegRatio: number;         // trend legs / pullback legs
  maxAdverseClosePct: number;  // max single-candle body against the trend
  bigGapPct: number;           // |gap| > this = "big gap" (trap candidate)
  rangeBoundPct: number;       // big gap + day range < this = range-bound trap
}

export interface CleanTrendToggles {
  smallGap: boolean;
  volume930Spike: boolean;
  cleanTrend: boolean;
  trapExclude: boolean;
}

export type CleanTrendVerdict = 'CLEAN' | 'WATCH' | 'TRAP';

export interface CleanTrendResult {
  verdict: CleanTrendVerdict;
  score: number;               // 0..100
  flags: { smallGap: boolean; volume930Spike: boolean; cleanTrend: boolean };
  trapReason: string | null;
  direction: 'UP' | 'DOWN' | 'NONE';
  intradayRvol: number | null;  // last candle vol / avg of prior (≤5) — the traction metric
  nine30SpikeRatio: number | null;
  histRatio: number | null;
  /** CC68.46 — live entry-trigger dots from the candle series (null = not enough data). */
  liveVol2x: boolean | null;   // last candle vol >= 2× avg of prior 5
  liveEma9Held: boolean | null; // last close holds the 9-EMA in the trend direction
}

export const DEFAULT_CLEAN_TREND_THRESHOLDS: CleanTrendThresholds = {
  maxGapPct: 1.5,
  volumeSpikeMultiple: 2.0,
  maxPullbackPct: 2.0,
  minLegRatio: 1.5,
  maxAdverseClosePct: 0.4,
  bigGapPct: 3.0,
  rangeBoundPct: 1.0,
};

export const DEFAULT_CLEAN_TREND_TOGGLES: CleanTrendToggles = {
  smallGap: true,
  volume930Spike: true,
  cleanTrend: true,
  trapExclude: true,
};

const timeKey = (ts: string): string => {
  const m = ts.match(/(\d{2}:\d{2})/);
  return m ? m[1] : ts;
};

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface CleanTrendInput {
  todayCandles: Candle[];
  histBaseline?: Candle[] | null;
  openingGapPct: number;
  prevClose: number;
  thresholds: CleanTrendThresholds;
  toggles: CleanTrendToggles;
}

export function scoreCleanTrend(input: CleanTrendInput): CleanTrendResult {
  const { todayCandles: c, histBaseline, openingGapPct, thresholds: T, toggles: TG } = input;

  const empty: CleanTrendResult = {
    verdict: 'WATCH', score: 50, flags: { smallGap: true, volume930Spike: true, cleanTrend: true },
    trapReason: null, direction: 'NONE', intradayRvol: null, nine30SpikeRatio: null, histRatio: null,
    liveVol2x: null, liveEma9Held: null,
  };
  if (!c || c.length < 2) return empty;

  const firstOpen = c[0].o;
  const lastClose = c[c.length - 1].c;
  const direction: CleanTrendResult['direction'] =
    lastClose > firstOpen ? 'UP' : lastClose < firstOpen ? 'DOWN' : 'NONE';

  // ── SmallGap ──────────────────────────────────────────────────────────────
  const smallGap = Math.abs(openingGapPct) <= T.maxGapPct;

  // ── Volume930Spike ────────────────────────────────────────────────────────
  // Spike = highest-volume candle among the first 6 (index >= 1, needs priors).
  const scanEnd = Math.min(6, c.length);
  let spikeIdx = 1;
  for (let i = 2; i < scanEnd; i++) if (c[i].v > c[spikeIdx].v) spikeIdx = i;
  const spikeV = c[spikeIdx].v;
  const priorAvg = avg(c.slice(0, spikeIdx).map(x => x.v));
  const sameDayRatio = priorAvg > 0 ? spikeV / priorAvg : 0;
  const nine30SpikeRatio = sameDayRatio;

  let histRatio: number | null = null;
  if (histBaseline && histBaseline.length) {
    const spikeTime = timeKey(c[spikeIdx].ts);
    const sameTime = histBaseline.filter(h => timeKey(h.ts) === spikeTime).map(h => h.v);
    if (sameTime.length) {
      const ha = avg(sameTime);
      histRatio = ha > 0 ? spikeV / ha : 0;
    }
  }
  const volume930 = sameDayRatio >= T.volumeSpikeMultiple;
  const histConfirms = histRatio === null || histRatio >= T.volumeSpikeMultiple;

  // ── CleanTrend structure ──────────────────────────────────────────────────
  const progress = firstOpen !== 0 ? ((lastClose - firstOpen) / firstOpen) * 100 : 0;

  // pullbackDepth: max drawdown from running peak (UP) / max drawup from running trough (DOWN)
  let pullbackDepth = Infinity;
  if (direction === 'UP') {
    let runMax = c[0].h;
    for (const x of c) { runMax = Math.max(runMax, x.h); pullbackDepth = Math.min(pullbackDepth, runMax > 0 ? ((runMax - x.l) / runMax) * 100 : 0); }
  } else if (direction === 'DOWN') {
    let runMin = c[0].l;
    for (const x of c) { runMin = Math.min(runMin, x.l); pullbackDepth = Math.min(pullbackDepth, runMin > 0 ? ((x.h - runMin) / runMin) * 100 : 0); }
  }
  pullbackDepth = pullbackDepth === Infinity ? 100 : pullbackDepth;

  // legRatio: trend-move / adverse-move (bodies)
  let trendMove = 0, adverseMove = 0;
  for (const x of c) {
    const body = x.c - x.o;
    if (direction === 'UP') { if (body > 0) trendMove += body; else adverseMove += -body; }
    else if (direction === 'DOWN') { if (body < 0) trendMove += -body; else adverseMove += body; }
  }
  const legRatio = adverseMove > 0 ? trendMove / adverseMove : Infinity;

  // adverseClose: max single-candle body against the trend (% of open)
  let adverseClose = 0;
  for (const x of c) {
    if (x.o === 0) continue;
    const adv = direction === 'UP' ? Math.max(0, (x.o - x.c) / x.o * 100)
      : direction === 'DOWN' ? Math.max(0, (x.c - x.o) / x.o * 100) : 0;
    adverseClose = Math.max(adverseClose, adv);
  }

  // higherLows (UP) / lowerHighs (DOWN): adverse candles' extremes must be non-decreasing (UP) / non-increasing (DOWN)
  let structureOk = true;
  let prevExt: number | null = null;
  for (const x of c) {
    const isAdverse = direction === 'UP' ? x.c < x.o : direction === 'DOWN' ? x.c > x.o : false;
    if (!isAdverse) continue;
    const ext = direction === 'UP' ? x.l : x.h;
    if (prevExt !== null) {
      if (direction === 'UP' && ext < prevExt - 1e-9) structureOk = false;
      if (direction === 'DOWN' && ext > prevExt + 1e-9) structureOk = false;
    }
    prevExt = ext;
  }

  const cleanTrend = direction !== 'NONE'
    && Math.abs(progress) >= 0.5
    && pullbackDepth <= T.maxPullbackPct
    && legRatio >= T.minLegRatio
    && adverseClose <= T.maxAdverseClosePct
    && structureOk;

  // ── TrapExclude (big gap + range-bound / reversal) ────────────────────────
  const bigGap = Math.abs(openingGapPct) > T.bigGapPct;
  let trapReason: string | null = null;
  if (bigGap) {
    const dayHigh = Math.max(...c.map(x => x.h));
    const dayLow = Math.min(...c.map(x => x.l));
    const rangePct = firstOpen !== 0 ? ((dayHigh - dayLow) / firstOpen) * 100 : 0;
    const rangeBound = rangePct < T.rangeBoundPct;
    const reversal = openingGapPct > 0 ? lastClose < firstOpen : lastClose > firstOpen;
    if (rangeBound) trapReason = `Big gap (${openingGapPct.toFixed(1)}%) + range-bound (${rangePct.toFixed(2)}%)`;
    else if (reversal) trapReason = `Big gap (${openingGapPct.toFixed(1)}%) + reversal`;
  }

  // ── intradayRvol (last candle vs avg of prior ≤5) ─────────────────────────
  const priorN = c.slice(Math.max(0, c.length - 6), c.length - 1).map(x => x.v);
  const intradayRvol = priorN.length && avg(priorN) > 0 ? c[c.length - 1].v / avg(priorN) : null;

  // ── live entry-trigger dots ───────────────────────────────────────────────
  // 2×Vol: last candle volume >= 2× the average of the prior 5 candles.
  const prior5 = c.slice(Math.max(0, c.length - 6), c.length - 1).map(x => x.v);
  const liveVol2x: boolean | null = prior5.length >= 5 && avg(prior5) > 0
    ? c[c.length - 1].v >= 2 * avg(prior5) : null;
  // 9-EMA held: compute 9-period EMA of closes; in-trend if price respects it.
  let liveEma9Held: boolean | null = null;
  if (c.length >= 9) {
    const k = 2 / (9 + 1);
    let ema = c[0].c;
    for (let i = 1; i < c.length; i++) ema = c[i].c * k + ema * (1 - k);
    const last = c[c.length - 1].c;
    liveEma9Held = direction === 'UP' ? last >= ema : direction === 'DOWN' ? last <= ema : null;
  }

  // ── Verdict assembly ──────────────────────────────────────────────────────
  // Skipped checks report neutral `true` so they never block.
  const fSmallGap = TG.smallGap ? smallGap : true;
  const fVolume = TG.volume930Spike ? volume930 : true;
  const fClean = TG.cleanTrend ? cleanTrend : true;

  let verdict: CleanTrendVerdict;
  let score: number;

  if (TG.trapExclude && trapReason) {
    verdict = 'TRAP'; score = 0;
  } else if ((TG.smallGap && !smallGap) || (TG.volume930Spike && !volume930)) {
    // A toggled-ON hard gate failed → excluded.
    verdict = 'TRAP';
    trapReason = trapReason ?? (TG.smallGap && !smallGap ? `Failed: gap ${openingGapPct.toFixed(1)}% > ${T.maxGapPct}%` : `Failed: 9:30 volume ${sameDayRatio.toFixed(2)}× < ${T.volumeSpikeMultiple}×`);
    score = 0;
  } else if (TG.cleanTrend && !cleanTrend) {
    verdict = 'WATCH'; score = 50;
  } else if (TG.volume930Spike && !histConfirms) {
    verdict = 'WATCH'; score = 55; // same-day spike but history disagrees
  } else {
    verdict = 'CLEAN';
    score = clamp(80 + (sameDayRatio >= 3 ? 5 : 0) + (legRatio >= 2 ? 5 : 0), 75, 100);
  }

  return {
    verdict, score,
    flags: { smallGap: fSmallGap, volume930Spike: fVolume, cleanTrend: fClean },
    trapReason, direction, intradayRvol, nine30SpikeRatio, histRatio, liveVol2x, liveEma9Held,
  };
}

function avg(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export { getHistRatio } from '../IntradayCandleService';
