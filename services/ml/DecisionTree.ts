// services/ml/DecisionTree.ts
// Histogram-based regression tree for one booster round.
// Pure TypeScript. No deps. Tuned for 100-300 row datasets.
//
// Design notes (2026-06-17):
//  - Histogram splits: bin each feature into BINS buckets, evaluate split candidates at bin edges.
//  - Regression with squared-error loss (matches LightGBM's 'regression' objective for both targets).
//  - Pre-sorted feature columns once per tree → O(rows × bins × features) per tree.
//  - L2 leaf regularization via minLeafSum to prevent 1-row leaves.

const BINS = 32;
const MIN_LEAF_SUM = 5;

export interface Split {
  feature: number;
  threshold: number;
  leftIdx: number[];   // row indices routed to left child
  rightIdx: number[];
  leftPrediction: number;
  rightPrediction: number;
}

export interface TreeNode {
  isLeaf: boolean;
  prediction: number;
  split?: Split;
  left?: TreeNode;
  right?: TreeNode;
}

export function buildTree(
  rows: number[][],          // [row][feature]
  residuals: number[],       // y - currentPrediction, per row
  maxDepth: number,
): TreeNode {
  if (maxDepth <= 0 || rows.length < 2 * MIN_LEAF_SUM) {
    return { isLeaf: true, prediction: mean(residuals) };
  }

  const best = findBestSplit(rows, residuals);
  if (!best) return { isLeaf: true, prediction: mean(residuals) };

  const leftRows = best.leftIdx.map(i => rows[i]);
  const leftRes  = best.leftIdx.map(i => residuals[i]);
  const rightRows = best.rightIdx.map(i => rows[i]);
  const rightRes  = best.rightIdx.map(i => residuals[i]);

  return {
    isLeaf: false,
    prediction: 0,
    split: best,
    left:  buildTree(leftRows,  leftRes,  maxDepth - 1),
    right: buildTree(rightRows, rightRes, maxDepth - 1),
  };
}

export function predictOne(node: TreeNode, row: number[]): number {
  if (node.isLeaf) return node.prediction;
  const v = row[node.split!.feature];
  return v <= node.split!.threshold
    ? predictOne(node.left!,  row)
    : predictOne(node.right!, row);
}

export function featureImportance(node: TreeNode, counts: number[]): void {
  // counts[i] += gain-ish: number of rows passing through splits on feature i.
  if (node.isLeaf) return;
  counts[node.split!.feature] += node.split!.leftIdx.length + node.split!.rightIdx.length;
  featureImportance(node.left!,  counts);
  featureImportance(node.right!, counts);
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function findBestSplit(rows: number[][], residuals: number[]): Split | null {
  const n = rows.length;
  if (n === 0) return null;
  const numFeatures = rows[0].length;
  let best: Split | null = null;
  let bestGain = -Infinity;

  // Current node variance (proportional to SSE)
  const totalSum = sum(residuals);
  const totalSq = sumOfSquares(residuals);
  const baseSse = totalSq - (totalSum * totalSum) / n;
  if (baseSse <= 0) return null;

  for (let f = 0; f < numFeatures; f++) {
    // Build (value, index) pairs and sort
    const pairs: { v: number; i: number }[] = new Array(n);
    for (let i = 0; i < n; i++) pairs[i] = { v: rows[i][f], i };
    pairs.sort((a, b) => a.v - b.v);

    // Histogram bin edges (BINS-1 thresholds)
    const numThresholds = Math.max(1, BINS - 1);
    const edges: number[] = new Array(numThresholds);
    for (let t = 0; t < numThresholds; t++) {
      let i = Math.floor(((t + 1) * n) / (numThresholds + 1));
      if (i >= n) i = n - 1;
      edges[t] = pairs[i].v;
    }

    // Sweep left → right, tracking left sum and left count
    let leftSum = 0;
    let leftCount = 0;
    let prevEdge = -Infinity;
    let pairIdx = 0;
    for (const edge of edges) {
      // Move all pairs with v <= edge into left bucket
      while (pairIdx < n && pairs[pairIdx].v <= edge) {
        leftSum += residuals[pairs[pairIdx].i];
        leftCount++;
        pairIdx++;
      }
      if (leftCount < MIN_LEAF_SUM) continue;
      if (n - leftCount < MIN_LEAF_SUM) continue;
      if (edge === prevEdge) continue;
      prevEdge = edge;

      const rightSum = totalSum - leftSum;
      const rightCount = n - leftCount;
      const leftSse = sumOfSquaresOfPrefix(pairs, residuals, pairIdx) - (leftSum * leftSum) / leftCount;
      const rightSse = totalSq - sumOfSquaresOfPrefix(pairs, residuals, pairIdx) - (rightSum * rightSum) / rightCount;
      const gain = baseSse - leftSse - rightSse;
      if (gain > bestGain) {
        bestGain = gain;
        const leftIdx = pairs.slice(0, pairIdx).map(p => p.i);
        const rightIdx = pairs.slice(pairIdx).map(p => p.i);
        best = {
          feature: f,
          threshold: edge,
          leftIdx,
          rightIdx,
          leftPrediction: leftSum / leftCount,
          rightPrediction: rightSum / rightCount,
        };
      }
    }
  }

  return best;
}

function sum(arr: number[]): number {
  let s = 0;
  for (const v of arr) s += v;
  return s;
}

function sumOfSquares(arr: number[]): number {
  let s = 0;
  for (const v of arr) s += v * v;
  return s;
}

function sumOfSquaresOfPrefix(
  pairs: { v: number; i: number }[],
  residuals: number[],
  prefixEnd: number,
): number {
  let s = 0;
  for (let i = 0; i < prefixEnd; i++) {
    const r = residuals[pairs[i].i];
    s += r * r;
  }
  return s;
}
