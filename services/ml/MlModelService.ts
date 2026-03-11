// services/ml/MlModelService.ts
// Versioned model registry. Single-writer (nightly job).

import { db } from '../../database';
import type { MlModelVersion } from '../../database';

export async function getCurrent(): Promise<MlModelVersion | null> {
  const all = await db.ml_models.toArray();
  return all.find(v => v.isCurrent === 1) ?? null;
}

export async function getHistory(): Promise<MlModelVersion[]> {
  return db.ml_models.orderBy('version').reverse().toArray();
}

export async function registerNewVersion(args: {
  hitProbModelJson: string;
  mfeMaeModelJson: string;
  valHitRate: number;
  valMfeMae: number;
  trainRows: number;
  regime: MlModelVersion['regime'];
}): Promise<number> {
  const history = await getHistory();
  const nextVersion = (history[0]?.version ?? 0) + 1;
  const parent = history.find(v => v.isCurrent === 1)?.version ?? null;

  // Demote previous current
  await db.ml_models.where('isCurrent').equals(1).modify({ isCurrent: 0 });

  await db.ml_models.add({
    version: nextVersion,
    trainedOn: Date.now(),
    hitProbModelJson: args.hitProbModelJson,
    mfeMaeModelJson: args.mfeMaeModelJson,
    valHitRate: args.valHitRate,
    valMfeMae: args.valMfeMae,
    trainRows: args.trainRows,
    regime: args.regime,
    isCurrent: 1,
    source: 'LEARNED',
    parentVersion: parent,
  });

  return nextVersion;
}

export async function rollback(target: number): Promise<boolean> {
  const all = await db.ml_models.toArray();
  const t = all.find(v => v.version === target);
  if (!t) return false;
  await db.ml_models.where('isCurrent').equals(1).modify({ isCurrent: 0 });
  if (t.id != null) await db.ml_models.update(t.id, { isCurrent: 1 });
  return true;
}
