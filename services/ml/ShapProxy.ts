/**
 * ShapProxy.ts
 * Computes feature permutation importance for trained boosters as a fast proxy for SHAP feature values.
 */

import { PermutationImportance } from './core/PermutationImportance';
import { FEATURE_COLUMNS } from './features';
import type { TrainedBooster } from './GradientBooster';
import { predictBooster } from './GradientBooster';
import type { TrainingRow } from '../mce/types';
import { encodeFeatures } from './features';

export class ShapProxy {
  /**
   * Calculate permutation importance across all 23 feature columns.
   */
  public static computeBoosterImportance(
    booster: TrainedBooster,
    valRows: TrainingRow[]
  ): Record<string, number> {
    if (!booster || !valRows || valRows.length === 0) {
      return {};
    }

    const X = valRows.map(r => encodeFeatures(r.features));
    const y = valRows.map(r => r.hitProb);

    const predictFn = (row: number[]) => predictBooster(booster, row);

    return PermutationImportance.compute({
      predictFn,
      X,
      y,
      featureNames: [...FEATURE_COLUMNS],
    });
  }
}
