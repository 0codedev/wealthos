/**
 * PermutationImportance.ts
 * Pure TypeScript module for computing model-agnostic Feature Permutation Importance.
 * Measures degradation in loss when each feature column is randomly shuffled.
 */

export interface PermutationImportanceOptions {
  predictFn: (row: number[]) => number;
  X: number[][];
  y: number[];
  featureNames?: string[];
  seed?: number;
}

export class PermutationImportance {
  /**
   * Compute permutation importance for each feature.
   * Returns a record of featureName -> importanceScore.
   */
  public static compute(options: PermutationImportanceOptions): Record<string, number> {
    const { predictFn, X, y, featureNames, seed = 42 } = options;

    if (!X || X.length === 0 || X.length !== y.length) {
      return {};
    }

    const numCols = X[0].length;
    const numRows = X.length;
    const names = featureNames ?? Array.from({ length: numCols }, (_, i) => `feature_${i}`);

    // Compute baseline Mean Squared Error (MSE)
    let baselineMse = 0;
    for (let i = 0; i < numRows; i++) {
      const p = predictFn(X[i]);
      const err = y[i] - p;
      baselineMse += err * err;
    }
    baselineMse /= numRows;

    let rngState = seed;
    const result: Record<string, number> = {};

    // For each feature column, create a permuted copy and calculate loss
    for (let col = 0; col < numCols; col++) {
      const colName = names[col] ?? `feature_${col}`;

      // Create matrix with permuted column
      const permutedX = X.map(row => [...row]);

      // Fisher-Yates shuffle of column col
      for (let i = numRows - 1; i > 0; i--) {
        const nextState = (rngState * 1664525 + 1013904223) % 4294967296;
        rngState = nextState;
        const j = Math.floor((nextState / 4294967296) * (i + 1));
        const temp = permutedX[i][col];
        permutedX[i][col] = permutedX[j][col];
        permutedX[j][col] = temp;
      }

      // Compute permuted MSE
      let permutedMse = 0;
      for (let i = 0; i < numRows; i++) {
        const p = predictFn(permutedX[i]);
        const err = y[i] - p;
        permutedMse += err * err;
      }
      permutedMse /= numRows;

      // Importance is the loss increase due to destroying the feature's signal
      const importance = Math.max(0, permutedMse - baselineMse);
      result[colName] = importance;
    }

    return result;
  }
}
