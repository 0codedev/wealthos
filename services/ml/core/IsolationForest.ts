/**
 * IsolationForest.ts
 * Pure TypeScript implementation of Isolation Forest for unsupervised anomaly detection.
 * Standardized score range: 0.0 (normal) to 1.0 (highly anomalous).
 */

interface IsolationTreeNode {
  featureIndex?: number;
  splitValue?: number;
  left?: IsolationTreeNode;
  right?: IsolationTreeNode;
  size: number;
}

export interface IsolationForestOptions {
  numTrees?: number;
  subsampleSize?: number;
  seed?: number;
}

export class IsolationForest {
  private numTrees: number;
  private subsampleSize: number;
  private trees: IsolationTreeNode[] = [];
  private maxDepth: number = 0;
  private cSubsample: number = 1;
  private seed: number;

  constructor(options?: IsolationForestOptions) {
    this.numTrees = options?.numTrees ?? 100;
    this.subsampleSize = options?.subsampleSize ?? 256;
    this.seed = options?.seed ?? 42;
  }

  /**
   * Simple deterministic random number generator (Linear Congruential Generator)
   */
  private nextRandom(rngState: number): { rand: number; nextState: number } {
    const nextState = (rngState * 1664525 + 1013904223) % 4294967296;
    return { rand: nextState / 4294967296, nextState };
  }

  /**
   * Average path length estimation c(n) for a binary search tree with n nodes.
   */
  private static averagePathLength(n: number): number {
    if (n <= 1) return 0;
    if (n === 2) return 1;
    // Euler-Mascheroni constant \approx 0.5772156649
    const eulerGamma = 0.5772156649;
    return 2 * (Math.log(n - 1) + eulerGamma) - (2 * (n - 1)) / n;
  }

  /**
   * Fit the isolation forest on numeric dataset data (N x D matrix).
   */
  public fit(data: number[][]): void {
    if (!data || data.length === 0 || data[0].length === 0) {
      this.trees = [];
      return;
    }

    const n = data.length;
    const actualSubsampleSize = Math.min(this.subsampleSize, n);
    this.maxDepth = Math.ceil(Math.log2(Math.max(actualSubsampleSize, 2)));
    this.cSubsample = IsolationForest.averagePathLength(actualSubsampleSize);

    this.trees = [];
    let rngState = this.seed;

    for (let i = 0; i < this.numTrees; i++) {
      // Subsample rows
      const subsample: number[][] = [];
      for (let j = 0; j < actualSubsampleSize; j++) {
        const res = this.nextRandom(rngState);
        rngState = res.nextState;
        const idx = Math.floor(res.rand * n);
        subsample.push(data[idx]);
      }

      const tree = this.buildTree(subsample, 0, rngState);
      rngState = tree.nextState;
      this.trees.push(tree.node);
    }
  }

  private buildTree(
    data: number[][],
    currentDepth: number,
    rngState: number
  ): { node: IsolationTreeNode; nextState: number } {
    const numRows = data.length;
    if (numRows <= 1 || currentDepth >= this.maxDepth) {
      return { node: { size: numRows }, nextState: rngState };
    }

    const numCols = data[0].length;
    let state = rngState;

    // Check if all feature values are identical
    let allIdentical = true;
    for (let c = 0; c < numCols; c++) {
      const val0 = data[0][c];
      for (let r = 1; r < numRows; r++) {
        if (data[r][c] !== val0) {
          allIdentical = false;
          break;
        }
      }
      if (!allIdentical) break;
    }

    if (allIdentical) {
      return { node: { size: numRows }, nextState: state };
    }

    // Randomly pick a feature that has variation
    const validCols: number[] = [];
    for (let c = 0; c < numCols; c++) {
      let minVal = data[0][c];
      let maxVal = data[0][c];
      for (let r = 1; r < numRows; r++) {
        if (data[r][c] < minVal) minVal = data[r][c];
        if (data[r][c] > maxVal) maxVal = data[r][c];
      }
      if (maxVal > minVal) {
        validCols.push(c);
      }
    }

    if (validCols.length === 0) {
      return { node: { size: numRows }, nextState: state };
    }

    const resCol = this.nextRandom(state);
    state = resCol.nextState;
    const colIdx = validCols[Math.floor(resCol.rand * validCols.length)];

    let minVal = data[0][colIdx];
    let maxVal = data[0][colIdx];
    for (let r = 1; r < numRows; r++) {
      if (data[r][colIdx] < minVal) minVal = data[r][colIdx];
      if (data[r][colIdx] > maxVal) maxVal = data[r][colIdx];
    }

    const resSplit = this.nextRandom(state);
    state = resSplit.nextState;
    const splitVal = minVal + resSplit.rand * (maxVal - minVal);

    const leftData: number[][] = [];
    const rightData: number[][] = [];

    for (let r = 0; r < numRows; r++) {
      if (data[r][colIdx] < splitVal) {
        leftData.push(data[r]);
      } else {
        rightData.push(data[r]);
      }
    }

    const leftChild = this.buildTree(leftData, currentDepth + 1, state);
    state = leftChild.nextState;

    const rightChild = this.buildTree(rightData, currentDepth + 1, state);
    state = rightChild.nextState;

    return {
      node: {
        featureIndex: colIdx,
        splitValue: splitVal,
        left: leftChild.node,
        right: rightChild.node,
        size: numRows,
      },
      nextState: state,
    };
  }

  /**
   * Calculate anomaly score for a single point vector.
   * Returns a number between 0.0 (normal) and 1.0 (anomalous).
   */
  public score(point: number[]): number {
    if (!this.trees || this.trees.length === 0) return 0.5;

    let totalPathLength = 0;
    for (const tree of this.trees) {
      totalPathLength += this.pathLength(point, tree, 0);
    }

    const avgPathLength = totalPathLength / this.trees.length;
    if (this.cSubsample <= 0) return 0.5;

    // s(x, n) = 2 ^ (- avgPathLength / c(n))
    return Math.pow(2, -avgPathLength / this.cSubsample);
  }

  private pathLength(point: number[], node: IsolationTreeNode, currentDepth: number): number {
    if (node.featureIndex === undefined || node.splitValue === undefined || !node.left || !node.right) {
      return currentDepth + IsolationForest.averagePathLength(node.size);
    }

    const val = point[node.featureIndex] ?? 0;
    if (val < node.splitValue) {
      return this.pathLength(point, node.left, currentDepth + 1);
    } else {
      return this.pathLength(point, node.right, currentDepth + 1);
    }
  }
}
