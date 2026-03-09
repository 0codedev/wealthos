// services/mce/gexScorer.ts
// Pure sub-score for the GEX lens. Distance-only sigmoid (v1).
// Spec: §2.4

import { GexFeatureVector, McsSubScore } from './types';

function withReason(value: number, reason: string, dataAvailable: boolean, weight: number): McsSubScore {
  return { value: Math.max(0, Math.min(1, value)), weight, reason, dataAvailable };
}

function fmtCr(x: number): string {
  const sign = x >= 0 ? '+' : '−';
  return `${sign}₹${Math.abs(x).toFixed(2)} cr`;
}

function distancePctLabel(d: number): string {
  if (d < 0.3) return 'in reaction zone';
  if (d < 1.0) return 'approaching';
  return 'far';
}

function netTone(x: number): string {
  if (x >  2)  return 'range-bound';
  if (x < -2)  return 'trending';
  return 'neutral';
}

function skewTone(x: number): string {
  if (x >  0.5) return 'fear';
  if (x < -0.5) return 'complacency';
  return 'balanced';
}

function buildReason(features: GexFeatureVector, _subScore: number): string {
  const parts: string[] = [];
  if (features.netGexCrores !== 0) {
    parts.push(`Net GEX ${fmtCr(features.netGexCrores)} (${netTone(features.netGexCrores)})`);
  }
  if (features.magnetStrike != null && features.magnetGexCrores != null) {
    const wall = features.magnetGexCrores < 0 ? 'call wall' : 'put wall';
    parts.push(`Magnet ${features.magnetStrike} (${wall}, ${fmtCr(features.magnetGexCrores)})`);
  }
  if (features.ivSkewAtm != null) {
    parts.push(`IV skew ${features.ivSkewAtm >= 0 ? '+' : ''}${features.ivSkewAtm.toFixed(2)} (${skewTone(features.ivSkewAtm)})`);
  }
  if (features.distanceToMagnetPct != null) {
    parts.push(`${features.distanceToMagnetPct.toFixed(2)}% from magnet — ${distancePctLabel(features.distanceToMagnetPct)}`);
  }
  return parts.length === 0 ? 'GEX data unavailable' : parts.join('; ');
}

export function scoreGex(features: GexFeatureVector, weight: number): McsSubScore {
  if (features.dataQuality === 'THIN') {
    return withReason(0.5, 'Chain thin — GEX unreliable', false, weight);
  }
  if (features.magnetStrike == null || features.distanceToMagnetPct == null) {
    return withReason(0.5, 'No magnet strike identified', false, weight);
  }
  const d = features.distanceToMagnetPct;
  const raw = 1 - Math.min(d / 2.0, 1);
  const subScore = 0.5 + 0.5 * raw;
  return withReason(subScore, buildReason(features, subScore), true, weight);
}