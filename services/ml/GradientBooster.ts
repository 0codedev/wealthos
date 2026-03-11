// services/ml/GradientBooster.ts
// Multi-output gradient boosting with histogram regression trees.
// Pure TypeScript. No dependencies. Trained in main thread (≤500ms for 200 rows × 22 features × 2 targets).
//
// Designed to mirror LightGBM's small-data defaults:
//  - learning rate 0.05
//  - num_leaves capped via maxDepth=4 (2^4 = 16 leaves max)
//  - 100 trees, early stopping when val loss stops improving for 20 rounds
//  - L2 leaf smoothing implicit via minLeafSum guard in DecisionTree

import { buildTree, predictOne, featureImportance, type TreeNode } from './DecisionTree';

export interface BoosterConfig {
  numRounds: number;          // max trees
  learningRate: number;
  maxDepth: number;           // capped to keep trees small
  earlyStoppingRounds: number;
  subsample: number;          // 0..1, fraction of rows per tree
}

export const DEFAULT_BOOSTER_CONFIG: BoosterConfig = {
  numRounds: 100,
  learningRate: 0.05,
  maxDepth: 4,
  earlyStoppingRounds: 20,
  subsample: 1.0,            // disable by default (200 rows is already small)
};

export interface TrainedBooster {
  trees: TreeNode[];
  initPrediction: number;     // base = mean(y)
  importance: number[];       // [numFeatures], row-pass count
  valLoss: number;
  trainRows: number;
}

export interface TrainArgs {
  X: number[][];
  y: number[];
  valX?: number[][];
  valY?: number[];
  config?: Partial<BoosterConfig>;
  onProgress?: (round: number, valLoss: number | null) => void;
}

export function trainBooster(args: TrainArgs): TrainedBooster | null {
  const cfg: BoosterConfig = { ...DEFAULT_BOOSTER_CONFIG, ...(args.config ?? {}) };
  const { X, y } = args;
  if (X.length < 30 || X.length !== y.length) return null;

  const initPrediction = mean(y);
  const predictions = new Array<number>(X.length).fill(initPrediction);
  const trees: TreeNode[] = [];
  const numFeatures = X[0].length;
  const importance = new Array<number>(numFeatures).fill(0);

  let bestValLoss = Infinity;
  let roundsSinceImprovement = 0;
  let lastValLoss = Infinity;

  const trainSize = Math.max(2, Math.floor(X.length * cfg.subsample));
  const rng = makeRng(X.length);

  for (let round = 0; round < cfg.numRounds; round++) {
    const residuals = y.map((yi, i) => yi - predictions[i]);

    // Subsample rows
    const indices = sampleIndices(X.length, trainSize, rng);
    const subX = indices.map(i => X[i]);
    const subR = indices.map(i => residuals[i]);

    const tree = buildTree(subX, subR, cfg.maxDepth);
    trees.push(tree);
    featureImportance(tree, importance);

    // Update predictions on FULL training set (use all rows for fit)
    for (let i = 0; i < X.length; i++) {
      predictions[i] += cfg.learningRate * predictOne(tree, X[i]);
    }

    // Validation loss
    let valLoss: number | null = null;
    if (args.valX && args.valY && args.valX.length > 0) {
      valLoss = mse(args.valX, args.valY, predictions => {
        // For each val row, sum over all trees
        let p = initPrediction;
        for (const t of trees) p += cfg.learningRate * predictOne(t, predictions as unknown as number[]);
        return p;
      });
      lastValLoss = valLoss;
      if (valLoss < bestValLoss - 1e-6) {
        bestValLoss = valLoss;
        roundsSinceImprovement = 0;
      } else {
        roundsSinceImprovement++;
      }
    }

    args.onProgress?.(round, valLoss);

    if (roundsSinceImprovement >= cfg.earlyStoppingRounds && valLoss != null) {
      // Roll back the last `earlyStoppingRounds` trees (they overfit)
      const rollback = Math.min(cfg.earlyStoppingRounds, trees.length - 1);
      trees.splice(trees.length - rollback, rollback);
      break;
    }
  }

  return {
    trees,
    initPrediction,
    importance,
    valLoss: lastValLoss,
    trainRows: X.length,
  };
}

export function predictBooster(booster: TrainedBooster, row: number[]): number {
  let p = booster.initPrediction;
  for (const tree of booster.trees) {
    p += DEFAULT_BOOSTER_CONFIG.learningRate * predictOne(tree, row);
  }
  return p;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function mse(X: number[][], y: number[], predictFn: (row: number[]) => number): number {
  let s = 0;
  for (let i = 0; i < X.length; i++) {
    const p = predictFn(X[i]);
    const e = y[i] - p;
    s += e * e;
  }
  return s / X.length;
}

// xorshift32 PRNG for deterministic subsampling
function makeRng(seed: number) {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 0xffffffff);
  };
}

function sampleIndices(n: number, k: number, rng: () => number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  // Fisher-Yates with rng
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
  }
  return idx.slice(0, k);
}
