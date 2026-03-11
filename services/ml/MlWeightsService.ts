// services/ml/MlWeightsService.ts
// Lookup chain: per-symbol → per-regime → GLOBAL → DEFAULT_WEIGHTS

import { db } from '../../database';
import type { MlWeightRow } from '../../database';
import { DEFAULT_WEIGHTS, type McsWeights, type RegimeBucket } from '../mce/types';

const FALLBACK_CUTOFFS = { fire: 70, wait: 45 };

export interface LookupResult {
  weights: McsWeights;
  fireCutoff: number;
  waitCutoff: number;
  source: 'SYMBOL_OVERRIDE' | 'REGIME_GLOBAL' | 'GLOBAL_DEFAULT' | 'HARD_DEFAULT';
}

export async function lookupWeights(
  symbol: string,
  regime: RegimeBucket,
): Promise<LookupResult> {
  const symbolOverride = await db.ml_weights
    .where('[symbolScope+regimeScope]')
    .equals([symbol, 'ALL'])
    .first();
  if (symbolOverride) {
    return {
      weights: symbolOverride.weights,
      fireCutoff: symbolOverride.fireCutoff,
      waitCutoff: symbolOverride.waitCutoff,
      source: 'SYMBOL_OVERRIDE',
    };
  }

  const regimeRow = await db.ml_weights
    .where('[symbolScope+regimeScope]')
    .equals(['GLOBAL', regime])
    .first();
  if (regimeRow) {
    return {
      weights: regimeRow.weights,
      fireCutoff: regimeRow.fireCutoff,
      waitCutoff: regimeRow.waitCutoff,
      source: 'REGIME_GLOBAL',
    };
  }

  const globalRow = await db.ml_weights
    .where('[symbolScope+regimeScope]')
    .equals(['GLOBAL', 'ALL'])
    .first();
  if (globalRow) {
    return {
      weights: globalRow.weights,
      fireCutoff: globalRow.fireCutoff,
      waitCutoff: globalRow.waitCutoff,
      source: 'GLOBAL_DEFAULT',
    };
  }

  return {
    weights: { ...DEFAULT_WEIGHTS },
    fireCutoff: FALLBACK_CUTOFFS.fire,
    waitCutoff: FALLBACK_CUTOFFS.wait,
    source: 'HARD_DEFAULT',
  };
}

export async function persistWeightRow(row: Omit<MlWeightRow, 'id'>): Promise<void> {
  // Replace any existing row for this (symbolScope, regimeScope) pair
  const existing = await db.ml_weights
    .where('[symbolScope+regimeScope]')
    .equals([row.symbolScope, row.regimeScope])
    .toArray();
  for (const e of existing) {
    if (e.id != null) await db.ml_weights.delete(e.id);
  }
  await db.ml_weights.add(row as MlWeightRow);
}

export async function clearAllLearnedWeights(): Promise<void> {
  await db.ml_weights.clear();
}
