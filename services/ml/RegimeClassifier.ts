// services/ml/RegimeClassifier.ts
// Rule-based 4-bucket regime classifier. Seeded centroids for downstream K-means use.

import type { RegimeFeatures } from '../mce/types';
import type { RegimeBucket } from '../mce/types';

export const REGIME_CENTROIDS: Record<RegimeBucket, { sectorRs: number; niftyTrend: -1 | 0 | 1; vixHigh: 0 | 1 }> = {
  TRENDING_UP:   { sectorRs: 1.015, niftyTrend:  1, vixHigh: 0 },
  TRENDING_DOWN: { sectorRs: 0.985, niftyTrend: -1, vixHigh: 0 },
  CHOPPY:        { sectorRs: 1.000, niftyTrend:  0, vixHigh: 0 },
  HIGH_VIX:      { sectorRs: 1.000, niftyTrend:  0, vixHigh: 1 },
};

function trendCode(t: RegimeFeatures['niftyTrend']): -1 | 0 | 1 {
  if (t === 'UP') return 1;
  if (t === 'DOWN') return -1;
  return 0;
}

export function classifyRegime(r: RegimeFeatures): RegimeBucket {
  if (r.vixBucket === 'HIGH') return 'HIGH_VIX';
  const trend = trendCode(r.niftyTrend);
  const rs = r.sectorRs ?? 1.0;
  if (trend === 1 && rs > 1.005) return 'TRENDING_UP';
  if (trend === -1 && rs < 0.995) return 'TRENDING_DOWN';
  return 'CHOPPY';
}
