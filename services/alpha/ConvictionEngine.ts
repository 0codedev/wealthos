/**
 * ConvictionEngine — Unified conviction scoring (refactor on top, don't delete)
 * ─────────────────────────────────────────────────────────────────────────
 * Phase 25 / CC68. Sits ON TOP of the existing engines
 * (ConvergenceEngine, VerdictEngine, StockSelectionEngine, SignalFusionService,
 *  DerivativesConfluenceEngine, mceOrchestrator). Does not replace them.
 *
 * The unified engine reads per-stock fields that were already computed by the
 * warm-cash pipeline, the live order book, and the MCS orchestrator, and
 * produces ONE 0–100 conviction score per stock per segment, plus a full
 * 23-check breakdown and (when available) the 5 MCS sub-scores.
 *
 * Hard rules (project-wide):
 *   • No I/O. Pure function. ~0.3 ms per stock.
 *   • No new dependencies.
 *   • Missing data is treated as neutral (0.5) — never zero.
 *   • Refactor on top. The existing engines keep running.
 *
 * Spec: docs/artifacts/phase-e-conviction-refactor-2026-06-18.md §2.5
 * Spec: Extras/AGENT SWARM/CLAUDE_CODE/tasks/Agent_CC68_Unified_Conviction_Pipeline.md
 */

import type { McsSubScore, McsSnapshot } from '../mce/types';

// ──────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────

export type StrategyId = 'ema_snapback' | 'morning_snapback' | 'upper_circuit' | 'fno_orb_retest';
export type ConvictionSegment = 'cash' | 'fno';
export type ConvictionDirection = 'CALL' | 'PUT';

/** Liquidity grade shared with StockSelectionEngine (A/B/C/REJECTED). */
export type ConvictionLiquidity = 'A' | 'B' | 'C' | 'REJECTED' | null;

/** OI quadrant (matches oiSignal in VerdictEngine). */
export type ConvictionOiQuadrant =
  | 'LONG_BUILDUP'
  | 'SHORT_COVERING'
  | 'LONG_UNWIND'
  | 'SHORT_BUILDUP'
  | 'NEUTRAL'
  | null;

export interface ConvictionMcsRollup {
  total: number;                       // 0..100
  confidence: number;                  // 0..1
  verdict: 'FIRE' | 'WAIT' | 'ABORT';
  subScores: {
    htf:        McsSubScore;
    indicators: McsSubScore;
    flow:       McsSubScore;
    regime:     McsSubScore;
    gex:        McsSubScore;
  };
}

export interface ConvictionInputs {
  symbol: string;
  segment: ConvictionSegment;
  direction: ConvictionDirection;
  strategyId?: StrategyId;

  // ── Per-stock signals (continuous where possible) ──
  rvol: number;                        // 0..N
  gFactor: number;                     // 0..10
  rFactor: number;                     // signed
  xFactor: number;                     // z-score
  dayExtreme: number;                  // 0..1
  o2c: number;                         // open-to-current %
  change: number;                      // c2c %

  // ── Candle / ORB ──
  dailyPattern: 'Bullish' | 'Bearish' | null;
  weeklyPattern: 'Bullish' | 'Bearish' | null;
  /** Direction-aware: CALL → low held, PUT → high held. */
  orbPreserved: boolean | null;
  orbMinutes: number | null;

  // ── Sector context ──
  sectorName: string;
  sectorSCS: number;                   // -100..+100
  sectorFatigue: number;               // consecutive days
  sectorRotationRank: number | null;   // 1 = leader
  sectorRotationTotal: number | null;

  // ── FII / DII (cash-only mostly, but index-futures FII is F&O-relevant) ──
  fiiVelocity: number | null;          // -1..+1
  diiVelocity: number | null;
  fiiNetBuyer: boolean | null;

  // ── OI quadrant (F&O) ──
  oiQuadrant: ConvictionOiQuadrant;
  oiChangePct: number | null;          // % change in OI today

  // ── Derivatives confluence (F&O, optional) ──
  dcs: number | null;                  // 0..100
  apexSignal: 'ACCUMULATION_APEX' | 'EXHAUSTION_APEX' | null;

  // ── Quality / valuation ──
  qualityRating: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL' | null;
  valuationType: 'under_valued' | 'over_valued' | null;

  // ── Order book live (optional) ──
  cvd: number | null;
  oreScore: number | null;             // 0..1
  obp: number | null;                  // -1..+1

  // ── Liquidity ──
  liquidityGrade: ConvictionLiquidity;
  spreadBps: number | null;

  // ── Trap / exhaustion (from RiskEngine) ──
  isExhausted: boolean;
  isTrapRisk: boolean;

  // ── MCS snapshot (services/mce/orchestrator.ts) — drives the 5th check-group ──
  mcs?: McsSnapshot | null;

  // ── CC68.30: New fields from the 17-card recalibration ──

  /** Group B #8.5 — Order-book wall imbalance (bid vs ask). */
  obWallImbalance?: number | null;     // -1..+1, positive = bid pressure

  /** Group C #12 — FII cash net direction aligned with direction. */
  fiiCashNetCr?: number | null;        // signed ₹ Cr

  /** Group C #13 — MF net flow aligned with direction. */
  mfNetPctChange?: number | null;      // % change in MF holdings (last month)

  /** Group E #21 — Earnings calendar proximity. */
  earningsDaysUntil?: number | null;   // negative = already happened
  earningsImminent?: boolean;          // true if days_until is 0..2

  /** Group F #17 — FII+P+DII momentum score (computed from shareholding cache). */
  ownershipMomentumScore?: number | null;  // 0.4·FII + 0.3·DII + 0.3·Promoter

  /** Group F #18 — Quality total_score (StockeZee) aligned with direction. */
  qualityTotalScore?: number | null;   // 0..100

  /** Group F #19 — Valuation upside % aligned with direction. */
  valuationUpsidePct?: number | null;  // (intrinsic - ltp) / ltp * 100

  /** Group F #20 — Insider net value (₹ Cr) — for kill + magnitude bonus. */
  insiderNetValueCr?: number | null;   // negative = net selling
  insiderSignificantExit?: boolean;     // |net| > 5 Cr AND negative
  boosterRank?: number | null;          // F&O Intraday Booster rank (1-indexed)
  velocity?: number;                    // changePct / elapsedMin
  openingGapPct?: number;               // opening gap %
}

/** A single check in the 28-check catalog (CC68.30 expansion). */
export interface ConvictionCheckResult {
  id: number;                          // 1..28
  group: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  name: string;                        // human label
  weight: number;                      // weight in 100-pt catalog
  passed: boolean;                     // neutral = null ⇒ not passed
  measuredValue: number | string | null;  // e.g. RVOL=3.2 or "LONG_BUILDUP"
  reason: string;                      // one-line explanation
}

export interface ConvictionKill {
  id: string;
  reason: string;
}

export interface ConvictionScore {
  symbol: string;
  segment: ConvictionSegment;
  direction: ConvictionDirection;
  score: number;                       // 0..100 (with magnitude bonus, clamped)
  passedWeight: number;                // sum of weights of passed checks
  totalWeight: number;                 // typically 100 (or 116 with CC68.30)
  checks: ConvictionCheckResult[];     // length 28 (or 23 if MCS is absent)
  kills: ConvictionKill[];
  reason: string;                      // top 3 passes, one-line
  weakness: string | null;             // top 1 failure (or null)
  magnitudeBonus: number;              // 0..8
  killed: boolean;
  computedAt: string;                  // ISO timestamp
  mcs: ConvictionMcsRollup | null;
}

// ──────────────────────────────────────────────────────────────────────────
// 23-check catalog
// ──────────────────────────────────────────────────────────────────────────

interface CheckDef {
  id: number;
  group: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  name: string;
  weight: number;
  /** Pure function. Returns { passed, measuredValue, reason }. */
  evaluate: (i: ConvictionInputs) => { passed: boolean; measuredValue: number | string | null; reason: string };
}

const dirSign = (d: ConvictionDirection): 1 | -1 => (d === 'CALL' ? 1 : -1);

/** Group A — Magnitude / Volume (4 checks, weight 18) */
const groupA: CheckDef[] = [
  {
    id: 1, group: 'A', name: 'RVOL ≥ 2.0', weight: 8,
    evaluate: (i) => {
      const passed = i.rvol >= 2.0;
      return {
        passed,
        measuredValue: Number(i.rvol.toFixed(2)),
        reason: passed ? `RVOL ${i.rvol.toFixed(2)}× — strong participation` : `RVOL ${i.rvol.toFixed(2)}× — below 2.0 bar`,
      };
    },
  },
  {
    id: 2, group: 'A', name: 'VWAP holding', weight: 4,
    evaluate: (i) => {
      // Direction-aware: o2c × direction > 0 means holding above (CALL) or below (PUT) VWAP.
      const sign = dirSign(i.direction);
      const passed = i.o2c * sign > 0;
      return {
        passed,
        measuredValue: Number(i.o2c.toFixed(2)),
        reason: passed ? `O2C ${i.o2c.toFixed(2)}% aligned with ${i.direction}` : `O2C ${i.o2c.toFixed(2)}% against ${i.direction}`,
      };
    },
  },
  {
    id: 3, group: 'A', name: 'Volume sustained', weight: 3,
    evaluate: (i) => {
      const passed = i.rvol >= 1.5;
      return {
        passed,
        measuredValue: Number(i.rvol.toFixed(2)),
        reason: passed ? `RVOL ${i.rvol.toFixed(2)}× — sustained` : `RVOL ${i.rvol.toFixed(2)}× — soft`,
      };
    },
  },
  {
    id: 4, group: 'A', name: 'Beta aligned', weight: 3,
    evaluate: (i) => {
      const sign = dirSign(i.direction);
      const passed = i.change * sign > 0;
      return {
        passed,
        measuredValue: Number(i.change.toFixed(2)),
        reason: passed ? `Change ${i.change.toFixed(2)}% aligned` : `Change ${i.change.toFixed(2)}% misaligned`,
      };
    },
  },
];

/** Group B — Structure / Pattern (4 checks, weight 17) */
const groupB: CheckDef[] = [
  {
    id: 5, group: 'B', name: 'ORB preserved', weight: 6,
    evaluate: (i) => {
      // orbPreserved is direction-aware upstream: CALL → low held; PUT → high held.
      const passed = i.orbPreserved === true;
      const measured = i.orbPreserved === null ? 'n/a' : (i.orbMinutes ? `${i.orbMinutes}m` : 'yes/no');
      return {
        passed,
        measuredValue: measured,
        reason: i.orbPreserved === null ? 'ORB data unavailable — neutral' : passed ? `ORB ${i.orbMinutes ?? '?'}m held for ${i.direction}` : `ORB broken against ${i.direction}`,
      };
    },
  },
  {
    id: 6, group: 'B', name: 'Daily Candle pattern', weight: 4,
    evaluate: (i) => {
      const want = i.direction === 'CALL' ? 'Bullish' : 'Bearish';
      const passed = i.dailyPattern === want;
      return {
        passed,
        measuredValue: i.dailyPattern ?? 'n/a',
        reason: i.dailyPattern ? (passed ? `Daily ${i.dailyPattern} — aligned` : `Daily ${i.dailyPattern} — against`) : 'Daily pattern unavailable',
      };
    },
  },
  {
    id: 7, group: 'B', name: 'Weekly Candle pattern', weight: 4,
    evaluate: (i) => {
      const want = i.direction === 'CALL' ? 'Bullish' : 'Bearish';
      const passed = i.weeklyPattern === want;
      return {
        passed,
        measuredValue: i.weeklyPattern ?? 'n/a',
        reason: i.weeklyPattern ? (passed ? `Weekly ${i.weeklyPattern} — aligned` : `Weekly ${i.weeklyPattern} — against`) : 'Weekly pattern unavailable',
      };
    },
  },
  {
    id: 8, group: 'B', name: 'CVD / OBP aligned', weight: 3,
    evaluate: (i) => {
      if (i.cvd == null) {
        return { passed: false, measuredValue: 'n/a', reason: 'CVD unavailable — neutral' };
      }
      const sign = dirSign(i.direction);
      const passed = i.cvd * sign > 0;
      return {
        passed,
        measuredValue: Number(i.cvd.toFixed(2)),
        reason: passed ? `CVD ${i.cvd.toFixed(0)} aligned with ${i.direction}` : `CVD ${i.cvd.toFixed(0)} against ${i.direction}`,
      };
    },
  },
];

/** Group C — Sector context (3 checks, weight 17) */
const groupC: CheckDef[] = [
  {
    id: 9, group: 'C', name: 'Sector rotation aligned', weight: 7,
    evaluate: (i) => {
      const sign = dirSign(i.direction);
      const target = 25 * sign;
      const passed = i.sectorSCS * sign >= target;
      return {
        passed,
        measuredValue: Number(i.sectorSCS.toFixed(2)),
        reason: passed ? `Sector SCS ${i.sectorSCS.toFixed(1)} — favorable` : `Sector SCS ${i.sectorSCS.toFixed(1)} — against ${i.direction}`,
      };
    },
  },
  {
    id: 10, group: 'C', name: 'Sector not exhausted', weight: 5,
    evaluate: (i) => {
      const sign = dirSign(i.direction);
      // Springboard: <= -2 (bearish trend exhausted → reversal up); for PUT: >= +2.
      const passed = i.sectorFatigue * sign <= 2;
      return {
        passed,
        measuredValue: Number(i.sectorFatigue),
        reason: passed
          ? `Sector fatigue ${i.sectorFatigue} — not in ${i.direction} exhaustion`
          : `Sector fatigue ${i.sectorFatigue} — exhausted for ${i.direction}`,
      };
    },
  },
  {
    id: 11, group: 'C', name: 'Market mood aligned', weight: 5,
    evaluate: (i) => {
      // We don't have a free marketMood input; we use macroBias via fiiNetBuyer proxy.
      // If the user provides no macro signal, this is treated as neutral (pass = false
      // but not a kill). Trade Sniper can set fiiNetBuyer=true for bullish mood.
      const want = i.direction === 'CALL';
      const moodBullish = i.fiiNetBuyer === true;
      const moodBearish = i.fiiNetBuyer === false;
      if (i.fiiNetBuyer == null) {
        return { passed: false, measuredValue: 'n/a', reason: 'Market mood unavailable' };
      }
      const passed = want ? moodBullish : moodBearish;
      return {
        passed,
        measuredValue: i.fiiNetBuyer ? 'BULL' : 'BEAR',
        reason: passed ? `Market mood aligned with ${i.direction}` : `Market mood against ${i.direction}`,
      };
    },
  },
];

/** Group D — F&O core (4 checks, weight 22) */
const groupD: CheckDef[] = [
  {
    id: 12, group: 'D', name: 'G-Factor ≥ 6', weight: 7,
    evaluate: (i) => {
      const passed = i.gFactor >= 6;
      return {
        passed,
        measuredValue: Number(i.gFactor.toFixed(2)),
        reason: passed ? `G-Factor ${i.gFactor.toFixed(2)} — strong` : `G-Factor ${i.gFactor.toFixed(2)} — below 6`,
      };
    },
  },
  {
    id: 13, group: 'D', name: 'R-Factor ≥ 1.5', weight: 4,
    evaluate: (i) => {
      const passed = i.rFactor >= 1.5;
      return {
        passed,
        measuredValue: Number(i.rFactor.toFixed(2)),
        reason: passed ? `R-Factor ${i.rFactor.toFixed(2)} — favorable` : `R-Factor ${i.rFactor.toFixed(2)} — soft`,
      };
    },
  },
  {
    id: 14, group: 'D', name: 'FII net / OI long buildup', weight: 6,
    evaluate: (i) => {
      // Cash: fiiVelocity > 0 + fiiNetBuyer. F&O: oiQuadrant aligned.
      if (i.segment === 'cash') {
        if (i.fiiVelocity == null || i.fiiNetBuyer == null) {
          return { passed: false, measuredValue: 'n/a', reason: 'FII data unavailable' };
        }
        const sign = dirSign(i.direction);
        const passed = i.fiiVelocity * sign > 0;
        return {
          passed,
          measuredValue: i.fiiVelocity.toFixed(2),
          reason: passed ? `FII velocity ${i.fiiVelocity.toFixed(2)} aligned` : `FII velocity ${i.fiiVelocity.toFixed(2)} against ${i.direction}`,
        };
      }
      // F&O
      if (!i.oiQuadrant || i.oiQuadrant === 'NEUTRAL') {
        return { passed: false, measuredValue: 'n/a', reason: 'OI quadrant unavailable' };
      }
      const want = i.direction === 'CALL'
        ? (i.oiQuadrant === 'LONG_BUILDUP' || i.oiQuadrant === 'SHORT_COVERING')
        : (i.oiQuadrant === 'SHORT_BUILDUP' || i.oiQuadrant === 'LONG_UNWIND');
      return {
        passed: want,
        measuredValue: i.oiQuadrant,
        reason: want ? `OI ${i.oiQuadrant} aligned with ${i.direction}` : `OI ${i.oiQuadrant} against ${i.direction}`,
      };
    },
  },
  {
    id: 15, group: 'D', name: 'Delivery % / OI change', weight: 5,
    evaluate: (i) => {
      if (i.segment === 'cash') {
        // Delivery % is read from the warm-cash proxy; if absent, neutral.
        if (i.oiChangePct == null) {
          return { passed: false, measuredValue: 'n/a', reason: 'Delivery data unavailable' };
        }
        const passed = i.oiChangePct >= 50;  // 50% delivery threshold
        return {
          passed,
          measuredValue: `${i.oiChangePct.toFixed(0)}%`,
          reason: passed ? `Delivery ${i.oiChangePct.toFixed(0)}% — strong hands` : `Delivery ${i.oiChangePct.toFixed(0)}% — weak`,
        };
      }
      // F&O
      if (i.oiChangePct == null) {
        return { passed: false, measuredValue: 'n/a', reason: 'OI change unavailable' };
      }
      const passed = i.oiChangePct >= 5;  // 5% OI change threshold
      return {
        passed,
        measuredValue: `${i.oiChangePct.toFixed(1)}%`,
        reason: passed ? `OI change ${i.oiChangePct.toFixed(1)}% — fresh positions` : `OI change ${i.oiChangePct.toFixed(1)}% — soft`,
      };
    },
  },
];

/** Group E — Risk gates (3 checks, weight 6) */
const groupE: CheckDef[] = [
  {
    id: 16, group: 'E', name: 'No trap', weight: 3,
    evaluate: (i) => ({
      passed: !i.isTrapRisk,
      measuredValue: i.isTrapRisk ? 'TRAP' : 'clean',
      reason: i.isTrapRisk ? 'Trap risk detected' : 'No trap risk',
    }),
  },
  {
    id: 17, group: 'E', name: 'Spread tight', weight: 2,
    evaluate: (i) => {
      if (i.spreadBps == null) {
        return { passed: true, measuredValue: 'n/a', reason: 'Spread unavailable — assume tight' };
      }
      const passed = i.spreadBps < 30;
      return {
        passed,
        measuredValue: `${i.spreadBps.toFixed(0)}bps`,
        reason: passed ? `Spread ${i.spreadBps.toFixed(0)}bps tight` : `Spread ${i.spreadBps.toFixed(0)}bps wide`,
      };
    },
  },
  {
    id: 18, group: 'E', name: 'Liquidity grade', weight: 1,
    evaluate: (i) => ({
      passed: i.liquidityGrade !== 'REJECTED',
      measuredValue: i.liquidityGrade ?? 'n/a',
      reason: i.liquidityGrade === 'REJECTED' ? 'Liquidity REJECTED' : `Liquidity ${i.liquidityGrade ?? 'unknown'}`,
    }),
  },
];

/** Group F — MCS momentum continuation (5 checks, weight 20)
 *  Segment-aware: cash stocks have no GEX/HTF option chain, so we treat
 *  missing MCS as "data unavailable" — neutral, NOT killed. The check
 *  fails (passed=false) but doesn't fail-loud.
 */
const mcsCheck = (
  id: number,
  label: string,
  pick: (s: McsSnapshot) => McsSubScore
): CheckDef => ({
  id, group: 'F', name: `MCS — ${label}`, weight: 4,
  evaluate: (i) => {
    if (!i.mcs) {
      // CC68.12: cash stocks have no option chain → MCS absent.
      // Treat as "data unavailable" (failed but not killed). This was
      // the root cause of the empty Cash Radar panel — MCS returned null
      // for cash-only stocks (CEMPRO, BSL, AARON, CREDITACC, INDIASHLTR,
      // CHEMPLASTS) and the card was filtered out by `!killed` in
      // ConvictionCardPanel.tsx because the missing-MCS path also tripped
      // downstream checks.
      return { passed: false, measuredValue: 'n/a', reason: `${label}: MCS not attached (cash or fetch failed) — neutral` };
    }
    const sub = pick(i.mcs);
    if (!sub.dataAvailable) {
      return { passed: false, measuredValue: 'n/a', reason: `${label}: data unavailable — neutral` };
    }
    // Pass rule: sub.value (0..1) maps to a 0..100 score; pass when score >= 60
    // (i.e. contributes >= 60% of its slot). This is the standard
    // "FIRE-worthy" threshold shared with MCS verdict.
    const score100 = sub.value * 100;
    const passed = score100 >= 60;
    return {
      passed,
      measuredValue: Number((sub.value * 100).toFixed(1)),
      reason: passed
        ? `${label} ${(sub.value * 100).toFixed(0)}/100 — confirmed`
        : `${label} ${(sub.value * 100).toFixed(0)}/100 — weak (${sub.reason.slice(0, 40)})`,
    };
  },
});

const groupF: CheckDef[] = [
  mcsCheck(19, 'HTF (higher-time-frame structure)', (s) => s.score.subScores.htf),
  mcsCheck(20, 'Indicators (RSI/MACD/EMA/ADX)', (s) => s.score.subScores.indicators),
  mcsCheck(21, 'Flow (OBI/walls/absorption/OI/PCR)', (s) => s.score.subScores.flow),
  mcsCheck(22, 'Regime (sector RS / Nifty / VIX)', (s) => s.score.subScores.regime),
  mcsCheck(23, 'GEX (gamma exposure magnet)', (s) => s.score.subScores.gex),
];

/**
 * CC68.30 — Group G: Smart money + Fundamentals (5 new checks, weight 16).
 * Reads from the 17-card Shadow Screener caches (via the AlphaInputsBundle).
 * Missing data is neutral (passes=false, no kill).
 */
const groupG: CheckDef[] = [
  {
    id: 24, group: 'G', name: 'Ownership momentum aligned', weight: 4,
    evaluate: (i) => {
      if (i.ownershipMomentumScore == null) {
        return { passed: false, measuredValue: 'n/a', reason: 'Ownership momentum unavailable' };
      }
      const sign = dirSign(i.direction);
      const m = i.ownershipMomentumScore;
      const aligned = m * sign > 0;
      return {
        passed: aligned,
        measuredValue: Number(m.toFixed(2)),
        reason: aligned
          ? `Ownership momentum ${m.toFixed(2)} aligned with ${i.direction}`
          : `Ownership momentum ${m.toFixed(2)} against ${i.direction}`,
      };
    },
  },
  {
    id: 25, group: 'G', name: 'Quality total_score aligned', weight: 3,
    evaluate: (i) => {
      if (i.qualityTotalScore == null) {
        return { passed: false, measuredValue: 'n/a', reason: 'Quality score unavailable' };
      }
      // Quality is symmetric — high score is good for both directions (reduces risk)
      const passed = i.qualityTotalScore >= 60;
      return {
        passed,
        measuredValue: Math.round(i.qualityTotalScore),
        reason: passed
          ? `Quality ${Math.round(i.qualityTotalScore)}/100 — good fundamentals`
          : `Quality ${Math.round(i.qualityTotalScore)}/100 — below 60`,
      };
    },
  },
  {
    id: 26, group: 'G', name: 'Valuation upside aligned', weight: 3,
    evaluate: (i) => {
      if (i.valuationUpsidePct == null) {
        return { passed: false, measuredValue: 'n/a', reason: 'Valuation upside unavailable' };
      }
      const sign = dirSign(i.direction);
      // For CALL: positive upside is good. For PUT: negative upside (overvalued) is good.
      const passed = i.valuationUpsidePct * sign > 0;
      return {
        passed,
        measuredValue: Number(i.valuationUpsidePct.toFixed(1)),
        reason: passed
          ? `Upside ${i.valuationUpsidePct.toFixed(1)}% aligned with ${i.direction}`
          : `Upside ${i.valuationUpsidePct.toFixed(1)}% against ${i.direction}`,
      };
    },
  },
  {
    id: 27, group: 'G', name: 'FII cash net aligned', weight: 3,
    evaluate: (i) => {
      if (i.fiiCashNetCr == null) {
        return { passed: false, measuredValue: 'n/a', reason: 'FII cash net unavailable' };
      }
      const sign = dirSign(i.direction);
      // FII positive = bullish (good for CALL, bad for PUT)
      const passed = i.fiiCashNetCr * sign > 0;
      return {
        passed,
        measuredValue: Math.round(i.fiiCashNetCr),
        reason: passed
          ? `FII cash net ${Math.round(i.fiiCashNetCr)} Cr aligned with ${i.direction}`
          : `FII cash net ${Math.round(i.fiiCashNetCr)} Cr against ${i.direction}`,
      };
    },
  },
  {
    id: 28, group: 'G', name: 'MF net flow aligned', weight: 3,
    evaluate: (i) => {
      if (i.mfNetPctChange == null) {
        return { passed: false, measuredValue: 'n/a', reason: 'MF net flow unavailable' };
      }
      const sign = dirSign(i.direction);
      // MF positive = bullish (good for CALL, bad for PUT)
      const passed = i.mfNetPctChange * sign > 0;
      return {
        passed,
        measuredValue: Number(i.mfNetPctChange.toFixed(1)),
        reason: passed
          ? `MF net ${i.mfNetPctChange.toFixed(1)}% aligned with ${i.direction}`
          : `MF net ${i.mfNetPctChange.toFixed(1)}% against ${i.direction}`,
      };
    },
  },
  {
    id: 29, group: 'G', name: 'Intraday Booster confirmed', weight: 4,
    evaluate: (i) => {
      if (i.boosterRank == null) {
        return { passed: false, measuredValue: 'n/a', reason: 'Intraday Booster rank unavailable' };
      }
      const passed = i.boosterRank <= 15;
      return {
        passed,
        measuredValue: i.boosterRank,
        reason: passed
          ? `Booster Rank #${i.boosterRank} <= 15 (Smart Money confirmation)`
          : `Booster Rank #${i.boosterRank} > 15`,
      };
    },
  },
  {
    id: 30, group: 'G', name: 'Velocity ok', weight: 5,
    evaluate: (i) => {
      const vel = i.velocity !== undefined ? i.velocity : 0;
      const passed = vel <= 0.40;
      return {
        passed,
        measuredValue: Number(vel.toFixed(3)),
        reason: passed ? `Velocity ${vel.toFixed(3)}%/min <= 0.40%` : `Velocity ${vel.toFixed(3)}%/min > 0.40% limit`
      };
    }
  },
  {
    id: 31, group: 'G', name: 'RVOL not extreme', weight: 5,
    evaluate: (i) => {
      const passed = i.rvol < 10.0;
      return {
        passed,
        measuredValue: Number(i.rvol.toFixed(2)),
        reason: passed ? `RVOL ${i.rvol.toFixed(2)}x <= 10x` : `RVOL ${i.rvol.toFixed(2)}x > 10x extreme`
      };
    }
  },
  {
    id: 32, group: 'G', name: 'Day extreme room', weight: 3,
    evaluate: (i) => {
      const passed = i.dayExtreme < 0.85;
      return {
        passed,
        measuredValue: Number(i.dayExtreme.toFixed(2)),
        reason: passed ? `HOD proximity ${(i.dayExtreme * 100).toFixed(0)}% has room` : `HOD proximity ${(i.dayExtreme * 100).toFixed(0)}% exhausted`
      };
    }
  },
  {
    id: 33, group: 'G', name: 'Gap not parabolic', weight: 4,
    evaluate: (i) => {
      const gap = i.openingGapPct !== undefined ? i.openingGapPct : 0;
      const passed = gap < 3.0;
      return {
        passed,
        measuredValue: Number(gap.toFixed(2)),
        reason: passed ? `Gap ${gap.toFixed(2)}% < 3.0%` : `Gap ${gap.toFixed(2)}% >= 3.0% parabolic`
      };
    }
  }
];

export const CHECK_CATALOG: ReadonlyArray<CheckDef> = [
  ...groupA, ...groupB, ...groupC, ...groupD, ...groupE, ...groupF, ...groupG,
];

export const CATALOG_TOTAL_WEIGHT = CHECK_CATALOG.reduce((s, c) => s + c.weight, 0); // expect 137 (was 120)

export const GENERIC_GROUP_SUMS: Record<string, number> = {
  A: 18, B: 17, C: 17, D: 22, E: 6, F: 20, G: 37
};

export const STRATEGY_GROUP_WEIGHTS: Record<StrategyId, Record<string, number>> = {
  ema_snapback: { A: 15, B: 22, C: 8, D: 10, E: 25, F: 10, G: 10 },
  morning_snapback: { A: 22, B: 20, C: 20, D: 18, E: 5, F: 10, G: 5 },
  upper_circuit: { A: 28, B: 15, C: 12, D: 20, E: 5, F: 10, G: 10 },
  fno_orb_retest: { A: 25, B: 20, C: 15, D: 15, E: 5, F: 10, G: 10 }
};

export function applyStrategyWeights(checks: ConvictionCheckResult[], strategyId?: StrategyId): ConvictionCheckResult[] {
  if (!strategyId || !STRATEGY_GROUP_WEIGHTS[strategyId]) return checks;
  const targetGroupWeights = STRATEGY_GROUP_WEIGHTS[strategyId];
  return checks.map(c => {
    const origGroupSum = GENERIC_GROUP_SUMS[c.group] || 1;
    const targetGroupSum = targetGroupWeights[c.group] ?? origGroupSum;
    const scaledWeight = Number((c.weight * (targetGroupSum / origGroupSum)).toFixed(2));
    return {
      ...c,
      weight: scaledWeight
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Kill conditions (hard block — no score)
// ──────────────────────────────────────────────────────────────────────────

interface KillDef {
  id: string;
  reason: string;
  test: (i: ConvictionInputs) => boolean;
}

const KILLS: KillDef[] = [
  { id: 'RVOL_DEAD', reason: 'RVOL < 0.8 — no participation', test: (i) => i.rvol < 0.8 },
  { id: 'SECTOR_WRONG_DIR', reason: 'Sector rotating against direction', test: (i) => i.sectorSCS * dirSign(i.direction) < 0 },
  // CC68.20: G-Factor and R-Factor are Trade-Sniper signals (F&O only).
  // For cash, `gFactor=undefined → 0` from the StockeZee feed trips these
  // kills for every single cash card. The verdict is meaningless — every
  // cash row in the live scanner has no G-Factor until the live pipeline
  // computes one. Lift the kill: cash cards now score G/R as passed=false
  // (contributes nothing) instead of being killed outright.
  { id: 'GFACTOR_DEAD', reason: 'G-Factor < 4 — no edge', test: (i) => i.segment === 'fno' && i.gFactor < 4 },
  { id: 'RFACTOR_DEAD', reason: 'R-Factor < 1.2 — bad R:R', test: (i) => i.segment === 'fno' && i.rFactor < 1.2 },
  { id: 'EXHAUSTED_FNO', reason: 'Exhausted on F&O', test: (i) => i.isExhausted && i.segment === 'fno' },
  { id: 'TRAP', reason: 'Trap risk detected', test: (i) => i.isTrapRisk },
  { id: 'LIQUIDITY_REJECTED', reason: 'Liquidity REJECTED', test: (i) => i.liquidityGrade === 'REJECTED' },
  { id: 'ORB_BROKEN', reason: 'ORB broken against direction', test: (i) => i.orbPreserved === false },
  { id: 'MCS_ABORT', reason: 'MCS verdict ABORT (high confidence)', test: (i) => !!i.mcs && i.mcs.score.verdict === 'ABORT' && i.mcs.score.confidence >= 0.6 },
  // CC68.30: New kills from the 17-card recalibration
  { id: 'EARNINGS_TODAY', reason: 'Earnings result today — high event risk', test: (i) => i.earningsDaysUntil === 0 },
  { id: 'INSIDER_EXIT', reason: 'Significant insider net selling (>5 Cr)', test: (i) => i.insiderSignificantExit === true },
  { id: 'MF_EXIT', reason: 'MF net holding drop > 5% across top schemes', test: (i) => i.mfNetPctChange != null && i.mfNetPctChange < -5 },
];

// ──────────────────────────────────────────────────────────────────────────
// Magnitude bonus
// ──────────────────────────────────────────────────────────────────────────

const MAX_BONUS_PER_SOURCE = 3;
const MAX_BONUS_TOTAL = 8;

function magnitudeBonus(i: ConvictionInputs): number {
  let bonus = 0;
  if (i.rvol > 2)  bonus += Math.min(MAX_BONUS_PER_SOURCE, Math.floor((i.rvol - 2) * 1.5));
  if (i.gFactor > 6) bonus += Math.min(MAX_BONUS_PER_SOURCE, Math.floor((i.gFactor - 6) * 0.5));
  if (Math.abs(i.sectorSCS) > 25) bonus += Math.min(MAX_BONUS_PER_SOURCE, Math.floor((Math.abs(i.sectorSCS) - 25) / 10));
  if (i.mcs && i.mcs.score.total >= 70) bonus += Math.min(MAX_BONUS_PER_SOURCE, Math.floor((i.mcs.score.total - 70) / 10));
  return Math.min(MAX_BONUS_TOTAL, bonus);
}

// ──────────────────────────────────────────────────────────────────────────
// MCS rollup helper
// ──────────────────────────────────────────────────────────────────────────

function buildMcsRollup(snap: McsSnapshot | null | undefined): ConvictionMcsRollup | null {
  // CC68.12: synthesize a WAIT rollup when MCS is absent (cash stocks).
  // Returns a neutral MCS rollup with confidence=0 so the ConvictionCardPanel
  // can render the 5 sub-score tiles as empty placeholders instead of hiding
  // the entire card. This was the second root cause of empty panels.
  if (!snap) {
    const neutral = (label: string): McsSubScore => ({
      value: 0.5,
      weight: 0.2,
      dataAvailable: false,
      reason: `${label} not available for cash segment`,
    });
    return {
      total: 50,
      confidence: 0,
      verdict: 'WAIT',
      subScores: {
        htf: neutral('HTF'),
        indicators: neutral('Indicators'),
        flow: neutral('Flow'),
        regime: neutral('Regime'),
        gex: neutral('GEX'),
      },
    };
  }
  return {
    total: snap.score.total,
    confidence: snap.score.confidence,
    verdict: snap.score.verdict,
    subScores: snap.score.subScores,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Main scoring function (pure)
// ──────────────────────────────────────────────────────────────────────────

export function score(inputs: ConvictionInputs): ConvictionScore {
  // 1. Evaluate kill conditions.
  const kills: ConvictionKill[] = [];
  for (const k of KILLS) {
    if (k.test(inputs)) {
      kills.push({ id: k.id, reason: k.reason });
    }
  }

  // 2. Evaluate all 23 checks.
  let checks: ConvictionCheckResult[] = CHECK_CATALOG.map((def) => {
    const { passed, measuredValue, reason } = def.evaluate(inputs);
    return {
      id: def.id,
      group: def.group,
      name: def.name,
      weight: def.weight,
      passed,
      measuredValue,
      reason,
    };
  });

  if (inputs.strategyId) {
    checks = applyStrategyWeights(checks, inputs.strategyId);
  }

  // 3. Passed weight / total.
  const passedWeight = checks.filter((c) => c.passed).reduce((s, c) => s + c.weight, 0);
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);

  // 4. Magnitude bonus (only if not killed).
  const bonus = kills.length > 0 ? 0 : magnitudeBonus(inputs);

  // 5. Final score.
  const raw = (passedWeight / Math.max(1, totalWeight)) * 100;
  const finalScore = Math.max(0, Math.min(100, Math.round(raw + bonus)));

  // 6. Reason (top 3 passes).
  const passes = checks.filter((c) => c.passed).sort((a, b) => b.weight - a.weight);
  const reason = passes.slice(0, 3).map((c) => c.name).join(' · ') || (kills.length > 0 ? `Killed: ${kills[0].reason}` : 'no passes');

  // 7. Weakness (top 1 failure).
  const failures = checks.filter((c) => !c.passed).sort((a, b) => b.weight - a.weight);
  const weakness = failures.length > 0 ? failures[0].name : null;

  return {
    symbol: inputs.symbol,
    segment: inputs.segment,
    direction: inputs.direction,
    score: kills.length > 0 ? 0 : finalScore,
    passedWeight,
    totalWeight,
    checks,
    kills,
    reason,
    weakness,
    magnitudeBonus: bonus,
    killed: kills.length > 0,
    computedAt: new Date().toISOString(),
    mcs: buildMcsRollup(inputs.mcs),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Convenience: rank an array of ConvictionScore
// ──────────────────────────────────────────────────────────────────────────

export function rank(scores: ConvictionScore[]): ConvictionScore[] {
  return [...scores]
    .filter((s) => !s.killed)
    .sort((a, b) => b.score - a.score || b.passedWeight - a.passedWeight);
}

// ──────────────────────────────────────────────────────────────────────────
// Display stability: per-symbol CX smoothing (bounded-step)
// ──────────────────────────────────────────────────────────────────────────

/**
 * CX is recomputed from live tick-derived inputs on every cycle, so raw values
 * can swing 0 -> 100 -> 0 within a minute when individual checks flip. That
 * instability leaks straight into the trading UI and alert conviction.
 *
 * `smoothConvictionScore` caps the displayed movement at CX_MAX_STEP points
 * per update toward the fresh raw value, so the number stays readable while
 * still converging within ~7 cycles of any real regime change. State is
 * keyed by symbol and lives in-memory only (resets on reload - safe).
 */
const CX_MAX_STEP = 15;
const cxSmoothState = new Map<string, { smoothed: number; updatedAt: number }>();

export function smoothConvictionScore(symbol: string, rawScore: number): number {
  const key = symbol.toUpperCase().trim();
  const prev = cxSmoothState.get(key);

  if (!prev || !Number.isFinite(prev.smoothed)) {
    cxSmoothState.set(key, { smoothed: rawScore, updatedAt: Date.now() });
    return rawScore;
  }

  // If the state is stale (>10 min since last update, e.g. symbol left the
  // screener), snap to the fresh value instead of crawling.
  if (Date.now() - prev.updatedAt > 10 * 60 * 1000) {
    cxSmoothState.set(key, { smoothed: rawScore, updatedAt: Date.now() });
    return rawScore;
  }

  const delta = rawScore - prev.smoothed;
  const step = Math.sign(delta) * Math.min(Math.abs(delta), CX_MAX_STEP);
  const smoothed = Math.max(0, Math.min(100, prev.smoothed + step));
  cxSmoothState.set(key, { smoothed, updatedAt: Date.now() });
  return smoothed;
}

/** Returns a conviction object whose display score is stability-smoothed. Killed scores pass through untouched. */
export function smoothScoreObject(symbol: string, scoreObj: ConvictionScore): ConvictionScore {
  if (scoreObj.killed) return scoreObj;
  return { ...scoreObj, score: smoothConvictionScore(symbol, scoreObj.score) };
}

// ──────────────────────────────────────────────────────────────────────────
// Convenience: build ConvictionInputs from a StockData + caches (no I/O)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Pull all available fields off StockData + a few extra caches and produce
 * a fully-formed ConvictionInputs. The caller is responsible for providing
 * the optional MCS snapshot (mceOrchestrator.score returns it).
 *
 * This helper does NOT touch the network, sessionStorage, or Dexie.
 */
export function buildInputsFromStock(
  stock: import('../AlphaEngineService').StockData,
  extras: {
    direction?: ConvictionDirection;
    mcs?: McsSnapshot | null;
    fiiVelocity?: number | null;
    fiiNetBuyer?: boolean | null;
    dailyPattern?: 'Bullish' | 'Bearish' | null;
    weeklyPattern?: 'Bullish' | 'Bearish' | null;
    orbPreserved?: boolean | null;
    orbMinutes?: number | null;
    qualityRating?: ConvictionInputs['qualityRating'];
    valuationType?: ConvictionInputs['valuationType'];
    cvd?: number | null;
    oreScore?: number | null;
    spreadBps?: number | null;
    oiChangePct?: number | null;
    dcs?: number | null;
    rvol?: number;
    o2cOverride?: number;       // CC68.21: allow callers to pass a computed O2C
    sectorSCSOverride?: number;
    sectorFatigueOverride?: number;
    boosterRank?: number | null;
    velocity?: number;
    openingGapPct?: number;
  } = {}
): ConvictionInputs {
  return {
    symbol: stock.symbol,
    segment: stock.signal === 'Up' ? 'fno' : 'cash',  // best-effort; callers should override
    direction: extras.direction ?? (stock.signal === 'Up' ? 'CALL' : 'PUT'),
    rvol: extras.rvol ?? 1.0,
    gFactor: stock.gFactor ?? 0,
    rFactor: stock.rFactor ?? 0,
    xFactor: 0,
    dayExtreme: 0,
    o2c: extras.o2cOverride ?? 0,
    change: stock.percentChange ?? 0,
    dailyPattern: extras.dailyPattern ?? null,
    weeklyPattern: extras.weeklyPattern ?? null,
    orbPreserved: extras.orbPreserved ?? (stock.isORBLowPreservedProxy ?? null),
    orbMinutes: extras.orbMinutes ?? null,
    sectorName: stock.sector ?? 'Unknown',
    sectorSCS: extras.sectorSCSOverride ?? 0,
    sectorFatigue: extras.sectorFatigueOverride ?? 0,
    sectorRotationRank: null,
    sectorRotationTotal: null,
    fiiVelocity: extras.fiiVelocity ?? null,
    diiVelocity: null,
    fiiNetBuyer: extras.fiiNetBuyer ?? null,
    oiQuadrant: null,
    oiChangePct: extras.oiChangePct ?? null,
    dcs: extras.dcs ?? null,
    apexSignal: null,
    qualityRating: extras.qualityRating ?? null,
    valuationType: extras.valuationType ?? null,
    cvd: extras.cvd ?? null,
    oreScore: extras.oreScore ?? null,
    obp: null,
    liquidityGrade: null,
    spreadBps: extras.spreadBps ?? null,
    isExhausted: stock.isExhausted ?? false,
    isTrapRisk: stock.isTrapRisk ?? false,
    mcs: extras.mcs ?? null,
    boosterRank: extras.boosterRank ?? null,
    velocity: extras.velocity,
    openingGapPct: extras.openingGapPct,
  };
}
