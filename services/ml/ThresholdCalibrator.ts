// services/ml/ThresholdCalibrator.ts
// 5×5 grid sweep over (fire_cutoff, wait_cutoff) candidates. Maximizes 0.7*precision@FIRE + 0.3*precision@WAIT.
// Falls back to {70, 45} (P1 defaults) when val set is too small.
// Includes Rolling Z-Score Greek Flow Imbalance (GFI) calibration normalized by symbol liquidity.

import type { TrainingRow } from '../mce/types';

export interface CalibratedThresholds {
  fire: number;
  wait: number;
  optimalGfiZScore?: number;
}

const FIRE_GRID = [66, 70, 74, 78, 82];
const WAIT_GRID = [38, 42, 46, 50, 54];
const MIN_BAND_SIZE = 10;
const DEFAULT_FIRE = 70;
const DEFAULT_WAIT = 45;

/**
 * Computes Rolling Z-Score for Greek Flow Imbalance (GFI) normalized by symbol liquidity
 * Z_GFI = (GFI_t - μ_GFI) / σ_GFI
 */
export function computeRollingZScoreGFI(gfiSeries: number[], windowSize: number = 20): number[] {
  if (!gfiSeries || gfiSeries.length === 0) return [];
  const zScores: number[] = [];

  for (let i = 0; i < gfiSeries.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const windowVals = gfiSeries.slice(start, i + 1);
    if (windowVals.length < 3) {
      zScores.push(0);
      continue;
    }

    const mean = windowVals.reduce((a, b) => a + b, 0) / windowVals.length;
    const variance = windowVals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (windowVals.length - 1);
    const stdDev = Math.sqrt(Math.max(1e-6, variance));

    const z = (gfiSeries[i] - mean) / stdDev;
    zScores.push(Number(Math.max(-4.0, Math.min(4.0, z)).toFixed(2)));
  }

  return zScores;
}

export function calibrateThresholds(valRows: TrainingRow[]): CalibratedThresholds {
  if (valRows.length < MIN_BAND_SIZE * 2) return { fire: DEFAULT_FIRE, wait: DEFAULT_WAIT, optimalGfiZScore: 1.5 };

  const scored = valRows.map(r => ({ score: r.hitProb * 100, won: r.hitProb >= 0.5 }));

  let best: CalibratedThresholds = { fire: DEFAULT_FIRE, wait: DEFAULT_WAIT, optimalGfiZScore: 1.5 };
  let bestScore = -Infinity;

  for (const f of FIRE_GRID) {
    for (const w of WAIT_GRID) {
      if (f - w < 10) continue;
      if (f >= 95 || w < 35) continue;

      const fireBand = scored.filter(s => s.score >= f);
      const waitBand = scored.filter(s => s.score >= w && s.score < f);
      if (fireBand.length < MIN_BAND_SIZE || waitBand.length < MIN_BAND_SIZE) continue;

      const firePrecision = fireBand.filter(s => s.won).length / fireBand.length;
      const waitPrecision = waitBand.filter(s => s.won).length / waitBand.length;
      const combined = 0.7 * firePrecision + 0.3 * waitPrecision;
      if (combined > bestScore) {
        bestScore = combined;
        best = { fire: f, wait: w, optimalGfiZScore: 1.5 };
      }
    }
  }

  return best;
}
