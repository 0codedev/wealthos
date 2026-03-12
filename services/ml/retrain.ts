// services/ml/retrain.ts
// Orchestrates one full nightly training cycle. Pure-TS, runs in main thread.
// Typical: <500ms for 200 rows × 22 features × 2 boosters. No web worker needed.
//
// Phase B.4: when db.trade_legs has rows (Dhan backfill), we ALSO build
// training rows from per-leg data via buildTrainingRowsFromLegs and concat.
// Net effect: training data is 2-4x larger and per-leg-accurate. Flip
// USE_LEG_SPLITTER to false to A/B test against the combined-Trade path.

import { db } from '../../database';
import type { Trade } from '../../database';
import { buildTrainingRows, buildTrainingRowsFromLegs } from './Labeler';
import { split } from './WalkForwardSplit';
import { trainBoosters } from './LightGBMWeightsService';
import { deriveLensWeights } from './LensWeightDeriver';
import { calibrateThresholds } from './ThresholdCalibrator';
import { registerNewVersion } from './MlModelService';
import { persistWeightRow, clearAllLearnedWeights } from './MlWeightsService';
import { applyRollbackIfNeeded } from './TelemetryGuard';
import { DEFAULT_WEIGHTS, type McsWeights } from '../mce/types';
import type { TrainingRow, RegimeBucket } from '../mce/types';
import { extractFeatures } from '../mce/featureExtractor';
import { countLegs, readAllLegs } from './TradeLegsLoader';
import { PortfolioOptimizer } from './PortfolioOptimizer';
import { ModelRegistry } from './ModelRegistry';

const FEATURE_COLUMNS = 22;
const USE_LEG_SPLITTER = true;   // flip to false to A/B test leg vs combined path

export interface RetrainSummary {
  skipped: boolean;
  reason?: string;
  trainedRows: number;
  valHitRate: number;
  valMfeMae: number;
  version?: number;
  durationMs: number;
}

export async function runNightlyRetrain(): Promise<RetrainSummary> {
  const start = Date.now();

  const trades = (await db.trades.toArray()) as Trade[];
  if (trades.length < 30) {
    return { skipped: true, reason: 'insufficient_trades', trainedRows: 0, valHitRate: 0, valMfeMae: 0, durationMs: Date.now() - start };
  }

  const featureCache = new Map<string, any>();
  const combinedRows: TrainingRow[] = buildTrainingRows(trades, (trade) => {
    if (featureCache.has(trade.ticker)) return featureCache.get(trade.ticker);
    const f = extractFeaturesSync(trade.ticker);
    featureCache.set(trade.ticker, f);
    return f;
  });

  // Phase B.4: optionally mix in per-leg rows from Dhan backfill.
  let rows: TrainingRow[] = combinedRows;
  if (USE_LEG_SPLITTER) {
    const legCount = await countLegs();
    if (legCount > 0) {
      const legs = await readAllLegs();
      const legRows: TrainingRow[] = buildTrainingRowsFromLegs(legs, (trade) => {
        if (featureCache.has(trade.ticker)) return featureCache.get(trade.ticker);
        const f = extractFeaturesSync(trade.ticker);
        featureCache.set(trade.ticker, f);
        return f;
      });
      // Tag leg-derived rows so telemetry can filter them out for A/B tests.
      for (const r of legRows) (r as any).source = 'leg_splitter';
      rows = [...combinedRows, ...legRows];
    }
  }

  if (rows.length < 30) {
    return { skipped: true, reason: 'insufficient_rows_after_labeler', trainedRows: 0, valHitRate: 0, valMfeMae: 0, durationMs: Date.now() - start };
  }

  const { train, val, regimeBuckets, skipped, reason } = split(rows);
  if (skipped) {
    return { skipped: true, reason: reason ?? 'walk_forward_skipped', trainedRows: 0, valHitRate: 0, valMfeMae: 0, durationMs: Date.now() - start };
  }

  const result = trainBoosters(train, val);
  if (!result) {
    return { skipped: true, reason: 'booster_train_failed', trainedRows: train.length, valHitRate: 0, valMfeMae: 0, durationMs: Date.now() - start };
  }

  const weights = deriveLensWeights(result.featureImportance);
  const thresholds = calibrateThresholds(val);

  // Wipe old learned rows, persist fresh global + per-regime
  await clearAllLearnedWeights();

  await persistWeightRow({
    symbolScope: 'GLOBAL',
    regimeScope: 'ALL',
    weights,
    fireCutoff: thresholds.fire,
    waitCutoff: thresholds.wait,
    trainedOn: Date.now(),
    trainRows: train.length,
    valHitRate: result.valHitRate,
    valMfeMae: result.valMfeMae,
    source: 'LEARNED',
  });

  for (const [regime, regimeRows] of Object.entries(regimeBuckets) as [RegimeBucket, TrainingRow[]][]) {
    if (regimeRows.length < 30) continue;
    const regResult = trainBoosters(regimeRows, val);
    if (!regResult) continue;
    const regWeights: McsWeights = deriveLensWeights(regResult.featureImportance);
    await persistWeightRow({
      symbolScope: 'GLOBAL',
      regimeScope: regime,
      weights: regWeights,
      fireCutoff: thresholds.fire,
      waitCutoff: thresholds.wait,
      trainedOn: Date.now(),
      trainRows: regimeRows.length,
      valHitRate: result.valHitRate,
      valMfeMae: result.valMfeMae,
      source: 'LEARNED',
    });
  }

  // Serialize boosters (TrainedBooster is JSON-safe: tree + initPrediction + importance)
  const hitJson = JSON.stringify(result.hitProbModel);
  const mfeJson = JSON.stringify(result.mfeMaeModel);

  const version = await registerNewVersion({
    hitProbModelJson: hitJson,
    mfeMaeModelJson: mfeJson,
    valHitRate: result.valHitRate,
    valMfeMae: result.valMfeMae,
    trainRows: train.length,
    regime: 'GLOBAL',
  });

  // Telemetry guard runs asynchronously, doesn't block this call
  void applyRollbackIfNeeded().catch(() => {});

  try {
    const demoAssets = [
      { symbol: 'EQUITY (NIFTY)', returns: [0.012, -0.008, 0.015, -0.005, 0.02, -0.01] },
      { symbol: 'MUTUAL FUNDS', returns: [0.005, -0.003, 0.006, -0.002, 0.008, -0.004] },
      { symbol: 'GOLD (ETF)', returns: [-0.002, 0.004, -0.001, 0.006, -0.003, 0.005] },
      { symbol: 'LIQUID CASH', returns: [0.0002, 0.0002, 0.0002, 0.0002, 0.0002, 0.0002] }
    ];
    const optResult = PortfolioOptimizer.optimize(demoAssets);
    await ModelRegistry.register('portfolio-optimizer', version, optResult);
  } catch {}

  return {
    skipped: false,
    trainedRows: train.length,
    valHitRate: result.valHitRate,
    valMfeMae: result.valMfeMae,
    version,
    durationMs: Date.now() - start,
  };
}

function extractFeaturesSync(symbol: string): any {
  try {
    const f = extractFeatures(symbol, 'PRE_ENTRY', Date.now());
    return f;
  } catch {
    return {
      htf: { ltp: 0 },
      indicators: {},
      flow: {},
      regime: { sectorRs: 1.0, niftyTrend: 'SIDEWAYS', vixBucket: 'NORMAL' },
    };
  }
}
