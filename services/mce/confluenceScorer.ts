// services/mce/confluenceScorer.ts
// The math. Pure functions. No I/O. No timers.
// Spec: docs/superpowers/specs/2026-06-17-mcs-momentum-continuation-score-design.md §4
// CC68.31: Each sub-score function now accepts an optional `extras` bundle
// and adds small bonuses from the 17-card Shadow Screener caches (quality,
// valuation, delivery, MF, insider, FII/DII composite).

import {
  MceFeatureVector, McsScore, McsSubScore, McsWeights,
  McsVerdict, McsHoldVerdict, DEFAULT_WEIGHTS, GexFeatureVector, MceExtras,
} from './types';
import { scoreGex } from './gexScorer';

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

function withReason(value: number, reason: string, dataAvailable: boolean, weight: number): McsSubScore {
  return { value: clamp(value), weight, reason, dataAvailable };
}

function dataUnavailable(weight: number, label: string): McsSubScore {
  return withReason(0.5, `${label}: data unavailable — assuming neutral`, false, weight);
}

/** Apply a list of (+bonus, reason) to v, return updated v + new reasons. */
function applyExtras(v: number, parts: string[], extras: MceExtras | undefined, pairs: Array<[boolean, string, number]>): number {
  for (const [cond, reason, bonus] of pairs) {
    if (cond) {
      v += bonus;
      parts.push(reason);
    }
  }
  return v;
}

export function htfSubScore(f: MceFeatureVector['htf'], w: number, extras?: MceExtras): McsSubScore {
  if (f.ltp === 0) return dataUnavailable(w, 'HTF');
  let v = 0.5;
  const parts: string[] = [];
  if (f.abovePriorDayHigh === true)  { v += 0.20; parts.push('above prior day high'); }
  if (f.aboveVwap === true)          { v += 0.10; parts.push('above VWAP'); }
  if (f.nearLevelPct != null) {
    if (f.nearLevelPct > 0.4)        { v += 0.15; parts.push('room to run (no nearby S/R)'); }
    else if (f.nearLevelPct < 0.1)   { v -= 0.25; parts.push('sitting on resistance'); }
  }
  if (f.priorDayLow != null && f.ltp < f.priorDayLow) { v -= 0.15; parts.push('below prior day low'); }

  // CC68.31 — extras bonuses
  v = applyExtras(v, parts, extras, [
    [(extras?.qualityTotalScore ?? 0) >= 70, `quality total ${Math.round(extras?.qualityTotalScore ?? 0)}/100 — long-term health`, 0.10],
    [(extras?.valuationUpsidePct ?? 0) > 10, `valuation upside ${(extras?.valuationUpsidePct ?? 0).toFixed(0)}% — room to run`, 0.05],
    [(extras?.valuationUpsidePct ?? 0) < -20, `valuation upside ${(extras?.valuationUpsidePct ?? 0).toFixed(0)}% — overvalued`, -0.10],
  ]);

  const reason = parts.length === 0
    ? 'No HTF structure confirmed in either direction'
    : parts.join('; ');
  return withReason(v, reason, true, w);
}

export function indicatorSubScore(f: MceFeatureVector['indicators'], w: number, extras?: MceExtras): McsSubScore {
  let v = 0.5;
  const parts: string[] = [];
  if (f.rsi14 != null) {
    if (f.rsi14 > 75)       { v -= 0.20; parts.push(`RSI ${Math.round(f.rsi14)} overbought`); }
    else if (f.rsi14 > 65)  { v += 0.10; parts.push(`RSI ${Math.round(f.rsi14)} strong, not overbought`); }
    else if (f.rsi14 >= 40) { parts.push(`RSI ${Math.round(f.rsi14)}`); }
    else                    { v -= 0.15; parts.push(`RSI ${Math.round(f.rsi14)} broken`); }
  }
  if (f.macdHist != null) {
    const b = Math.sign(f.macdHist) * Math.min(Math.abs(f.macdHist) / 0.5, 0.15);
    v += b;
    parts.push(`MACD histogram ${f.macdHist >= 0 ? '+' : ''}${f.macdHist.toFixed(2)}`);
  }
  if (f.emaStack === 'BULL') { v += 0.10; parts.push('EMA stack bullish'); }
  else if (f.emaStack === 'BEAR') { v -= 0.10; parts.push('EMA stack bearish'); }
  if (f.adx14 != null) {
    if (f.adx14 > 20)       { v += 0.05; parts.push(`ADX ${Math.round(f.adx14)} trending`); }
    else if (f.adx14 < 15)  { v -= 0.05; parts.push(`ADX ${Math.round(f.adx14)} choppy`); }
  }

  // CC68.31 — extras bonuses
  v = applyExtras(v, parts, extras, [
    [(extras?.qualityMomentumScore ?? 0) >= 70, `quality momentum ${Math.round(extras?.qualityMomentumScore ?? 0)}/100 — confirmed trend`, 0.05],
    [(extras?.qualityRiskScore ?? 0) >= 70, `quality risk ${Math.round(extras?.qualityRiskScore ?? 0)}/100 — elevated`, -0.05],
  ]);

  return withReason(v, parts.join('; ') || 'no indicator data', true, w);
}

export function flowSubScore(f: MceFeatureVector['flow'], w: number, extras?: MceExtras): McsSubScore {
  let v = 0.5;
  const parts: string[] = [];
  if (f.obi != null) {
    const b = f.obi * 0.30;
    v += b;
    parts.push(`OBI ${f.obi >= 0 ? '+' : ''}${f.obi.toFixed(2)} (${f.obi >= 0 ? 'buy' : 'sell'} pressure)`);
  }
  if (f.bidWall && f.askWall) {
    if (f.bidWall.qty > f.askWall.qty * 1.5)      { v += 0.10; parts.push('large bid wall present'); }
    else if (f.askWall.qty > f.bidWall.qty * 1.5) { v -= 0.10; parts.push('large ask wall present'); }
  }
  if (f.absorption != null) {
    if (f.absorption > 70)       { v += 0.05; parts.push(`absorption ${Math.round(f.absorption)}% (sellers absorbed)`); }
    else if (f.absorption < 30)  { v -= 0.05; parts.push(`absorption ${Math.round(f.absorption)}% (buyers absorbed)`); }
  }
  if (f.oiDeltaPct != null) {
    const b = Math.sign(f.oiDeltaPct) * Math.min(Math.abs(f.oiDeltaPct) / 20, 0.10);
    v += b;
    parts.push(`ATM OI ${f.oiDeltaPct >= 0 ? '+' : ''}${f.oiDeltaPct.toFixed(0)}% in 5 min`);
  }
  if (f.pcr != null) {
    if (f.pcr > 1.2)       { v += 0.05; parts.push(`PCR ${f.pcr.toFixed(2)} (puts crowded)`); }
    else if (f.pcr < 0.7)  { v -= 0.05; parts.push(`PCR ${f.pcr.toFixed(2)} (calls crowded)`); }
  }

  // CC68.31 — extras bonuses
  v = applyExtras(v, parts, extras, [
    [(extras?.deliveryPct ?? 0) >= 60 && (extras?.changePct ?? 0) > 0, `delivery ${Math.round(extras?.deliveryPct ?? 0)}% on green candle — institutional`, 0.05],
    [(extras?.deliveryPct ?? 0) < 25 && (extras?.changePct ?? 0) > 0, `delivery ${Math.round(extras?.deliveryPct ?? 0)}% on green — weak hands`, -0.05],
    [(extras?.mfNetPctChange ?? 0) > 0, `MF net ${(extras?.mfNetPctChange ?? 0).toFixed(1)}% — smart money buying`, 0.05],
    [(extras?.insiderNetValueCr ?? 0) > 0, `insider net ${(extras?.insiderNetValueCr ?? 0).toFixed(1)} Cr — insider buying`, 0.05],
    [((extras?.ownershipMomentumScore ?? 0) * (extras?.ownershipMomentumSign ?? 0)) > 0, `ownership momentum aligned — smart-money confirmation`, 0.05],
  ]);

  return withReason(v, parts.join('; ') || 'no flow data', true, w);
}

export function regimeSubScore(f: MceFeatureVector['regime'], w: number, extras?: MceExtras): McsSubScore {
  let v = 0.5;
  const parts: string[] = [];
  if (f.sectorRs != null) {
    const b = clamp((f.sectorRs - 1) * 0.5, -0.2, 0.2);
    v += b;
    const pct = ((f.sectorRs - 1) * 100).toFixed(1);
    parts.push(`sector ${f.sectorRs >= 1 ? '+' : ''}${pct}% vs Nifty`);
  }
  if (f.niftyTrend === 'UP')       { v += 0.15; parts.push('Nifty in uptrend'); }
  else if (f.niftyTrend === 'DOWN') { v -= 0.15; parts.push('Nifty in downtrend'); }
  if (f.vixBucket === 'LOW')       { v += 0.10; parts.push('VIX low'); }
  else if (f.vixBucket === 'HIGH')  { v -= 0.10; parts.push('VIX high'); }

  // CC68.31 — extras bonuses
  v = applyExtras(v, parts, extras, [
    [(extras?.fiiDiiComposite ?? 0) > 2, `FII/DII composite ${(extras?.fiiDiiComposite ?? 0).toFixed(1)} — bullish regime`, 0.05],
    [(extras?.fiiDiiComposite ?? 0) < -2, `FII/DII composite ${(extras?.fiiDiiComposite ?? 0).toFixed(1)} — bearish regime`, -0.05],
    [f.vixBucket === 'NORMAL' && (extras?.vixChangePct ?? 0) < -5, `VIX normal + dropping ${(extras?.vixChangePct ?? 0).toFixed(1)}% — supportive`, 0.05],
    [(extras?.vixLevel ?? 0) > 20, `VIX ${(extras?.vixLevel ?? 0).toFixed(1)} elevated — risk-off`, -0.05],
  ]);

  return withReason(v, parts.join('; ') || 'no regime data', true, w);
}

export function computeVerdict(total: number): McsVerdict {
  if (total >= 70) return 'FIRE';
  if (total >= 45) return 'WAIT';
  return 'ABORT';
}

export function computeHoldVerdict(current: McsScore, fillMcsTotal: number | null): McsHoldVerdict {
  if (current.total >= 75 && current.confidence >= 0.7) {
    if (fillMcsTotal != null && current.total - fillMcsTotal >= 5) return 'ADD_ELIGIBLE';
    return 'HOLD';
  }
  if (current.total >= 60) return 'HOLD';
  if (current.total >= 40) return 'TRIM_WATCH';
  return 'EXIT_CANDIDATE';
}

export function scoreFeatures(features: MceFeatureVector, weights: McsWeights = DEFAULT_WEIGHTS): McsScore {
  const gexFeatures = (features as unknown as { gex?: GexFeatureVector }).gex;
  const gex = gexFeatures
    ? scoreGex(gexFeatures, weights.gex)
    : withReason(0.5, 'GEX not yet attached to snapshot', false, weights.gex);

  const extras = features.extras;
  const htf        = htfSubScore(features.htf, weights.htf, extras);
  const indicators = indicatorSubScore(features.indicators, weights.indicators, extras);
  const flow       = flowSubScore(features.flow, weights.flow, extras);
  const regime     = regimeSubScore(features.regime, weights.regime, extras);

  const values = [htf.value, indicators.value, flow.value, regime.value, gex.value];
  const wArr = [weights.htf, weights.indicators, weights.flow, weights.regime, weights.gex];
  const weightedSum = values.reduce((s, v, i) => s + v * wArr[i], 0);
  const weightTotal = wArr.reduce((s, w) => s + w, 0) || 1;
  const total0to1 = weightedSum / weightTotal;
  const total = Math.round(total0to1 * 100);

  // CC68.31: confidence cap when many lenses are data-unavailable.
  // With 2+ lenses at dataAvailable=false, cap confidence at 0.6 so the user
  // sees that the score is built on fewer signals.
  const unavailableCount = [htf, indicators, flow, regime, gex].filter(s => !s.dataAvailable).length;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  const baseConfidence = clamp(1 - stddev * 2, 0, 1);
  const confidence = unavailableCount >= 2 ? Math.min(baseConfidence, 0.6) : baseConfidence;

  return {
    total,
    confidence: Math.round(confidence * 100) / 100,
    verdict: computeVerdict(total),
    subScores: { htf, indicators, flow, regime, gex },
    weightsAreLearned: false,
  };
}