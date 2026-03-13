// services/ml/WalkForwardSplit.ts
// Anchored walk-forward split. NEVER random — financial data leaks via random splits.

import type { TrainingRow, RegimeBucket } from '../mce/types';

const MIN_ROWS = 30;
const TRAIN_DAYS = 60;
const VAL_DAYS = 7;
const DAY_MS = 86400000;

export interface SplitResult {
  train: TrainingRow[];
  val: TrainingRow[];
  regimeBuckets: Record<RegimeBucket, TrainingRow[]>;
  skipped: boolean;
  reason?: string;
}

export function split(rows: TrainingRow[]): SplitResult {
  if (rows.length < MIN_ROWS) {
    return { train: [], val: [], regimeBuckets: emptyBuckets(), skipped: true, reason: 'insufficient_rows' };
  }
  const sorted = [...rows].sort((a, b) => a.asOf - b.asOf);
  const latest = sorted[sorted.length - 1].asOf;
  const valCutoff = latest - VAL_DAYS * DAY_MS;
  const trainCutoff = valCutoff - TRAIN_DAYS * DAY_MS;

  const train = sorted.filter(r => r.asOf >= trainCutoff && r.asOf < valCutoff);
  const val = sorted.filter(r => r.asOf >= valCutoff);

  if (train.length < 20 || val.length < 5) {
    return { train: [], val: [], regimeBuckets: emptyBuckets(), skipped: true, reason: 'window_too_thin' };
  }

  const regimeBuckets = emptyBuckets();
  for (const r of train) regimeBuckets[r.regime].push(r);

  return { train, val, regimeBuckets, skipped: false };
}

function emptyBuckets(): Record<RegimeBucket, TrainingRow[]> {
  return { TRENDING_UP: [], TRENDING_DOWN: [], CHOPPY: [], HIGH_VIX: [] };
}
