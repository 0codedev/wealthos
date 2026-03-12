// services/ml/TelemetryGuard.ts
// 7-day rolling hit-rate check. Triggers rollback if current model degrades vs previous.

import { db } from '../../database';
import type { Trade } from '../../database';
import { modelVersioning } from '../ml/ModelVersioning';
import { clearAllLearnedWeights } from './MlWeightsService';

const ROLLBACK_THRESHOLD = 0.70;
const WINDOW_DAYS = 7;

export interface TelemetryVerdict {
  shouldRollback: boolean;
  currentHitRate: number;
  previousHitRate: number;
  reason: string;
}

interface ModelWithParent { parentVersion?: number | null; version: number; }

function isModelWithParent(m: unknown): m is ModelWithParent {
  return !!m && typeof (m as any).version === 'number';
}

export async function evaluate(): Promise<TelemetryVerdict> {
  const current = await modelVersioning.getCurrentVersion();
  if (!current) {
    return { shouldRollback: false, currentHitRate: 0, previousHitRate: 0, reason: 'no_current_model' };
  }
  const history = await modelVersioning.getVersionHistory();
  const currentWithParent = current as unknown as ModelWithParent;
  const previous = history.find(v =>
    isModelWithParent(v) && currentWithParent.parentVersion === v.version && v.version !== current.version,
  );

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const trades = await db.trades.where('date').above(cutoff).toArray();

  if (trades.length < 5) {
    return { shouldRollback: false, currentHitRate: 0, previousHitRate: previous?.accuracy ?? 0, reason: 'insufficient_trades' };
  }

  const currentHitRate = trades.filter((t: Trade) => (t.pnl ?? 0) > 0).length / trades.length;
  const previousHitRate = previous?.accuracy ?? 0.5;

  if (currentHitRate < previousHitRate * ROLLBACK_THRESHOLD) {
    return { shouldRollback: true, currentHitRate, previousHitRate, reason: 'hit_rate_collapse' };
  }

  return { shouldRollback: false, currentHitRate, previousHitRate, reason: 'healthy' };
}

export async function applyRollbackIfNeeded(): Promise<boolean> {
  const verdict = await evaluate();
  if (!verdict.shouldRollback) return false;
  const current = await modelVersioning.getCurrentVersion();
  const currentWithParent = current as unknown as ModelWithParent | null;
  if (!currentWithParent || currentWithParent.parentVersion == null) {
    await clearAllLearnedWeights();
    return true;
  }
  return await modelVersioning.rollbackToVersion(currentWithParent.parentVersion);
}
