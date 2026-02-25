/**
 * CC68.39 — Morning Momentum Engine
 *
 * The influencer's 3-step morning flow as ONE pure, testable pipeline:
 *   1. Dominant sector (the 1.5× "clear winner or sit out" rule)
 *      — bull mood → strongest positive zFactor sector; bear → most negative.
 *   2. F&O candidates in that sector, mood-aligned, hard-killed.
 *   3. Dead-gap rejection (D1/D2/D4) + Morning Momentum Score (MMS) 0–100.
 *
 * MMS leads with the day's-extreme (the only reliably knowable signal at
 * 9:50–10:30) and degrades to NEUTRAL 0.5 when data is missing — never 0,
 * never a kill. This is the fix for "R-factor not available for all stocks".
 *
 * See: Extras/trade_finder_replication_playbook.md (the reverse-engineered
 * strategy this implements) and the plan at
 * C:\Users\gadda\.claude\plans\velvety-discovering-gem.md.
 */

import type { StockData, SectorData, MarketMood } from '../AlphaEngineService';
import type { ConvictionScore } from './ConvictionEngine';
import type { CleanTrendResult } from './CleanTrendEngine';

// ─── Tunable constants (single source of truth) ─────────────────────────────

/** MMS sub-signal weights. Sum to 1.0. Real-time-reliable core (dayExtreme +
 *  gFactor) = 0.55; confirmation (rFactor + cx) = 0.30; context = 0.15. */
export const MORNING_MOMENTUM_WEIGHTS = {
  dayExtreme: 0.30,
  gFactor: 0.25,
  rFactor: 0.15,
  cx: 0.15,
  sectorDominance: 0.10,
  moodAlignment: 0.05,
} as const;

/** Playbook R-factor tiers. >3.5 = elite institutional footprint. */
export const R_FACTOR_ELITE = 3.5;
export const R_FACTOR_SECONDARY = 2.0;

/** A sector below this |zFactor| is "too flat" to trade (playbook: bar < 0.5%). */
/** A sector below this |zFactor| is "too flat" to trade (playbook: bar < 0.5%). */
export const MIN_DOMINANT_ZFACTOR = 0.5;
/** The #1 sector must beat #2 by this ratio, else "no clear winner — sit out". */
export const DOMINANCE_RATIO = 1.2;

/** Mock rFactor fallback tops out at 1.9 (1.0 + (hash%10)/10). Any value above
 *  this cannot have come from the mock → the bridge is live. */
const MOCK_RFACTOR_MAX = 1.9;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MorningMomentumInput {
  stocks: StockData[];
  sectors: SectorData[];
  mood: MarketMood | null;
  /** Precomputed ConvictionEngine scores keyed by symbol (async pass done by caller). */
  convictions?: Map<string, ConvictionScore>;
  /** Precomputed CleanTrend results keyed by symbol (async candle pass done by caller). */
  cleanTrend?: Map<string, CleanTrendResult>;
  /** F&O universe (from data/fno_stocks). Non-F&O stocks are filtered out. */
  fnoSymbols: Set<string>;
  /** Whether the Python bridge is supplying real rFactor (vs mock fallback). */
  bridgeRFactorLive: boolean;
}

export interface MorningEntryTrigger {
  dayHighBreak: boolean;   // live: CALL lastPrice >= high ; PUT lastPrice <= low
  sectorDominant: boolean; // live: dominant sector still #1 (true within a single compute)
  vol2x: boolean | null;   // null = "confirm on chart" (Phase 1 — needs 5-min candle cache)
  ema9Held: boolean | null; // null = "confirm on chart" (Phase 1)
}

export interface MorningDeadGap {
  d1RangeExpansion: boolean;
  d2SectorBetrayal: boolean;
  d3VolumeTrap: boolean;   // always false in Phase 1 (needs 5-min volume curve)
  d4PreMarketHighHit: boolean;
  reason: string | null;
}

export type MorningVerdict = 'ENTER' | 'WATCH' | 'SIT OUT';

export interface MorningPick {
  stock: StockData;
  sector: string;
  direction: 'CALL' | 'PUT';
  mms: number;                // 0..100
  verdict: MorningVerdict;
  rFactorValue: number | null;
  rFactorLive: boolean;
  entryTrigger: MorningEntryTrigger;
  deadGap: MorningDeadGap;
  reason: string;
  /** CC68.46 — clean-trend result when candle data is available (null = not fetched). */
  cleanTrend?: CleanTrendResult | null;
}

export interface DominantSectorInfo {
  sector: string;
  zFactor: number;
  percentChange: number;
}

export interface MorningResult {
  dominantSector: DominantSectorInfo | null;
  backupSector?: DominantSectorInfo | null;
  direction: 'CALL' | 'PUT';
  picks: MorningPick[];
  bridgeRFactorLive: boolean;
  sitOutReason: string | null;
}

export function getDominantSector(
  sectors: SectorData[],
  isBull: boolean
): {
  dominantSector: DominantSectorInfo | null;
  backupSector: DominantSectorInfo | null;
  sitOutReason: string | null;
} {
  const candidates = sectors
    .filter(s => s.zFactor != null && Number.isFinite(s.zFactor) && Math.sign(s.zFactor) === (isBull ? 1 : -1))
    .sort((a, b) => Math.abs(b.zFactor!) - Math.abs(a.zFactor!));

  if (candidates.length === 0) {
    return { dominantSector: null, backupSector: null, sitOutReason: 'No sector aligned with market mood — sit out' };
  }

  const top = candidates[0];
  if (Math.abs(top.zFactor!) < MIN_DOMINANT_ZFACTOR) {
    return { dominantSector: null, backupSector: null, sitOutReason: 'Sectors too flat — no dominant momentum, sit out' };
  }

  const domPct = top.percentChange ?? 0;
  const dominantSector = { sector: top.sector, zFactor: top.zFactor!, percentChange: domPct };

  if (candidates.length >= 2) {
    const second = candidates[1];
    if (Math.abs(top.zFactor!) < DOMINANCE_RATIO * Math.abs(second.zFactor!)) {
      if (Math.abs(second.zFactor!) >= MIN_DOMINANT_ZFACTOR) {
        const backupPct = second.percentChange ?? 0;
        return {
          dominantSector,
          backupSector: { sector: second.sector, zFactor: second.zFactor!, percentChange: backupPct },
          sitOutReason: null
        };
      }
    }
  }

  return { dominantSector, backupSector: null, sitOutReason: null };
}

// ─── Small helpers ──────────────────────────────────────────────────────────

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5);
const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

function sectorMatches(stockSector: string | undefined, domSector: string): boolean {
  if (!stockSector) return false;
  if (stockSector === domSector) return true;
  const s = stockSector.replace('NIFTY ', '').trim();
  const d = domSector.replace('NIFTY ', '').trim();
  return s === d || stockSector.includes(domSector) || domSector.includes(stockSector);
}

/**
 * Pure heuristic: the bridge is "live" if any stock carries a real rFactor
 * (the mock fallback can never exceed 1.9). The AlphaEngineService exposes a
 * thin wrapper over this; tests hit it directly here.
 */
export function estimateBridgeRFactorLive(stocks: StockData[]): boolean {
  return stocks.some(s => s.rFactor != null && Number.isFinite(s.rFactor) && s.rFactor > MOCK_RFACTOR_MAX);
}

/** Verdict from a raw MMS, with dead-gap downgrade. Exported for unit testing. */
export function mmsVerdict(mms: number, deadGapActive: boolean): MorningVerdict {
  let v: MorningVerdict;
  if (mms >= 75) v = 'ENTER';
  else if (mms >= 55) v = 'WATCH';
  else v = 'SIT OUT';
  if (deadGapActive && v === 'ENTER') v = 'WATCH';
  return v;
}

// ─── MMS sub-signals (each 0..1, missing → 0.5 neutral) ─────────────────────

function dayExtremeSignal(stock: StockData, direction: 'CALL' | 'PUT'): number {
  const des = clamp01(stock.dayExtremeScore); // 0 = at low, 1 = at high
  return direction === 'CALL' ? des : 1 - des;
}

function gFactorSignal(stock: StockData): number {
  return clamp01((stock.gFactor ?? 0) / 10);
}

function rFactorSignal(stock: StockData): number {
  const r = stock.rFactor;
  if (r == null || !Number.isFinite(r)) return 0.5; // missing → neutral
  if (r > R_FACTOR_ELITE) return 1.0;
  if (r >= R_FACTOR_SECONDARY) return 0.6;
  return 0.2;
}

function cxSignal(stock: StockData, convictions?: Map<string, ConvictionScore>): number {
  const cx = convictions?.get(stock.symbol) ?? convictions?.get(stock.symbol.toUpperCase());
  if (!cx || cx.killed) return 0.5; // missing or killed → neutral
  return clamp01(cx.score / 100);
}

function sectorDominanceSignal(domZFactor: number | null): number {
  if (domZFactor == null || !Number.isFinite(domZFactor)) return 0.5;
  return clamp01(Math.abs(domZFactor) / 5);
}

function moodAlignmentSignal(stock: StockData, mood: MarketMood | null): number {
  if (!mood) return 0.5;
  return (stock.signal === 'Up') === mood.isBullish ? 1 : 0;
}

// ─── Dead-gap rejection filter ──────────────────────────────────────────────

function computeDeadGap(stock: StockData, domPercentChange: number): MorningDeadGap {
  const d1 = stock.openPrice > 0 && stock.openingGapPct > 3
    && ((stock.high - stock.low) / stock.openPrice) * 100 < 1;

  const d2 = Math.abs(stock.openingGapPct) > 0.5
    && sign(domPercentChange) !== 0
    && sign(stock.openingGapPct) !== sign(domPercentChange);

  // D3 (volume trap) needs a 5-min volume curve — deferred to Phase 2.
  const d3 = false;

  const d4 = stock.dayExtremeScore >= 0.98 && stock.openChangePct < 0;

  const active: string[] = [];
  if (d1) active.push('range expansion');
  if (d2) active.push('sector betrayal');
  if (d4) active.push('pre-market high already hit');

  return {
    d1RangeExpansion: d1,
    d2SectorBetrayal: d2,
    d3VolumeTrap: d3,
    d4PreMarketHighHit: d4,
    reason: active.length ? `Dead gap: ${active.join(', ')}` : null,
  };
}

// ─── Entry-trigger checklist ────────────────────────────────────────────────

function computeEntryTrigger(stock: StockData, direction: 'CALL' | 'PUT'): MorningEntryTrigger {
  return {
    dayHighBreak: direction === 'CALL' ? stock.lastPrice >= stock.high : stock.lastPrice <= stock.low,
    sectorDominant: true, // true within a single compute; re-checked live by the UI
    vol2x: null,          // Phase 1: confirm on chart (needs 5-min candle cache)
    ema9Held: null,       // Phase 1: confirm on chart
  };
}

// ─── Main pipeline ──────────────────────────────────────────────────────────

export function computeMorningPicks(input: MorningMomentumInput): MorningResult {
  const { stocks, sectors, mood, convictions, cleanTrend, fnoSymbols, bridgeRFactorLive } = input;
  const isBull = mood?.isBullish ?? true;
  const direction: 'CALL' | 'PUT' = isBull ? 'CALL' : 'PUT';

  // Step 1 — dominant sector (1.2× rule), aligned to mood.
  const domResult = getDominantSector(sectors, isBull);
  const { dominantSector, backupSector, sitOutReason } = domResult;

  if (sitOutReason || !dominantSector) {
    return { dominantSector: null, backupSector: null, direction, picks: [], bridgeRFactorLive, sitOutReason };
  }

  const domPct = dominantSector.percentChange;

  // Step 2 — F&O candidates in the dominant or backup sector, mood-aligned, hard-killed.
  const survivors = stocks.filter(s => {
    if (!fnoSymbols.has(s.symbol.toUpperCase())) return false;
    const matchesPrimary = sectorMatches(s.sector, dominantSector.sector);
    const matchesBackup = backupSector ? sectorMatches(s.sector, backupSector.sector) : false;
    if (!matchesPrimary && !matchesBackup) return false;
    if (isBull ? s.signal !== 'Up' : s.signal !== 'Down') return false; // mood-aligned side
    if (s.isExhausted) return false;
    if (s.isTrapRisk) return false;
    if ((s.gFactor ?? 0) < 4) return false;
    return true;
  });

  // Step 3 — dead-gap + MMS + verdict for each survivor.
  const w = MORNING_MOMENTUM_WEIGHTS;
  const picks: (MorningPick | null)[] = survivors.map(stock => {
    const matchesPrimary = sectorMatches(stock.sector, dominantSector.sector);
    const matchedSector = matchesPrimary ? dominantSector.sector : (backupSector?.sector ?? dominantSector.sector);
    const matchedPct = matchesPrimary ? dominantSector.percentChange : (backupSector?.percentChange ?? dominantSector.percentChange);
    const deadGap = computeDeadGap(stock, matchedPct);

    // CC68.46 — candle-accurate clean-trend result (if the async pass fetched it).
    const ct = cleanTrend?.get(stock.symbol) ?? cleanTrend?.get(stock.symbol.toUpperCase()) ?? null;
    // Candle-accurate trap exclusion overrides the snapshot dead-gap when present.
    if (ct && ct.verdict === 'TRAP') return null;

    let mms = Math.round(100 * (
      w.dayExtreme * dayExtremeSignal(stock, direction)
      + w.gFactor * gFactorSignal(stock)
      + w.rFactor * rFactorSignal(stock)
      + w.cx * cxSignal(stock, convictions)
      + w.sectorDominance * sectorDominanceSignal(dominantSector.zFactor)
      + w.moodAlignment * moodAlignmentSignal(stock, mood)
    ) * 10) / 10; // 1-decimal

    // Clean-trend adjustment: CLEAN boosts, WATCH trims (mild, tunable).
    if (ct) {
      if (ct.verdict === 'CLEAN') mms = Math.min(100, mms + 5);
      else if (ct.verdict === 'WATCH') mms = Math.max(0, mms - 5);
    }

    const verdict = mmsVerdict(mms, deadGap.reason != null);
    const baseTrigger = computeEntryTrigger(stock, direction);
    // Live 2×Vol / 9EMA dots from the candle series when available.
    const entryTrigger = ct
      ? { ...baseTrigger, vol2x: ct.liveVol2x, ema9Held: ct.liveEma9Held }
      : baseTrigger;
    const reason = deadGap.reason
      ? `${deadGap.reason} · MMS ${mms}`
      : ct
        ? `${ct.verdict} trend · MMS ${mms} · G ${(stock.gFactor ?? 0).toFixed(1)} · R ${stock.rFactor != null ? stock.rFactor.toFixed(1) : '—'}`
        : `MMS ${mms} · G ${(stock.gFactor ?? 0).toFixed(1)} · R ${stock.rFactor != null ? stock.rFactor.toFixed(1) : '—'}`;
    return {
      stock,
      sector: matchedSector,
      direction,
      mms,
      verdict,
      rFactorValue: stock.rFactor ?? null,
      rFactorLive: bridgeRFactorLive,
      entryTrigger,
      deadGap,
      reason,
      cleanTrend: ct,
    };
  });

  // Drop candle-accurate trap exclusions, then sort + cap.
  const validPicks = picks.filter((p): p is MorningPick => p !== null);

  // Step 4 — sort by MMS desc, cap at top 5.
  validPicks.sort((a, b) => b.mms - a.mms);
  const top5 = validPicks.slice(0, 5);

  return { dominantSector, backupSector, direction, picks: top5, bridgeRFactorLive, sitOutReason: null };
}
