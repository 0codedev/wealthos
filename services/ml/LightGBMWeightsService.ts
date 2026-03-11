// services/ml/LightGBMWeightsService.ts
// Pure-TS gradient boosting wrapper. Mirrors the API surface of the planned lightgbm-wasm bridge
// so we can swap implementations later (option B: onnxruntime-web with exported LightGBM models).
// No new dependencies. Trains in <500ms for 200 rows × 22 features.

import type { TrainingRow } from '../mce/types';
import { encodeFeatures } from './features';
import { trainBooster, predictBooster, type TrainedBooster } from './GradientBooster';

export interface TrainResult {
  hitProbModel: TrainedBooster;
  mfeMaeModel: TrainedBooster;
  featureImportance: number[];   // [22], aggregated from hitProb booster
  valHitRate: number;
  valMfeMae: number;
  hitProbPredictions: { row: TrainingRow; pred: number }[];
}

const MIN_ROWS = 30;

export function trainBoosters(trainRows: TrainingRow[], valRows: TrainingRow[] = []): TrainResult | null {
  if (trainRows.length < MIN_ROWS) return null;

  const X = trainRows.map(r => encodeFeatures((r.features as any)));
  const Xv = valRows.map(r => encodeFeatures((r.features as any)));
  const yHit = trainRows.map(r => r.hitProb);
  const yMfe = trainRows.map(r => r.mfeMaeRatio);
  const yHitVal = valRows.map(r => r.hitProb);
  const yMfeVal = valRows.map(r => r.mfeMaeRatio);

  const hitModel = trainBooster({ X, y: yHit, valX: Xv.length ? Xv : undefined, valY: yHitVal.length ? yHitVal : undefined });
  const mfeModel = trainBooster({ X, y: yMfe, valX: Xv.length ? Xv : undefined, valY: yMfeVal.length ? yMfeVal : undefined });
  if (!hitModel || !mfeModel) return null;

  const valHitRate = valRows.length > 0
    ? valRows.filter(r => r.hitProb >= 0.5).length / valRows.length
    : 0;
  const valMfeMae = valRows.length > 0
    ? valRows.reduce((s, r) => s + r.mfeMaeRatio, 0) / valRows.length
    : 0;

  return {
    hitProbModel: hitModel,
    mfeMaeModel: mfeModel,
    featureImportance: hitModel.importance,
    valHitRate,
    valMfeMae,
    hitProbPredictions: valRows.map((r, i) => ({ row: r, pred: predictBooster(hitModel, Xv[i]) })),
  };
}

export function predict(
  hitProbModel: TrainedBooster,
  mfeMaeModel: TrainedBooster,
  vector: any,
): { hitProb: number; mfeMaeRatio: number } | null {
  try {
    const x = encodeFeatures(vector);
    const hit = predictBooster(hitProbModel, x);
    const mfe = predictBooster(mfeMaeModel, x);
    return {
      hitProb: clamp(hit, 0, 1),
      mfeMaeRatio: Math.max(0, mfe),
    };
  } catch {
    return null;
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
