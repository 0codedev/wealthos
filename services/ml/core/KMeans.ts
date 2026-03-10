/**
 * KMeans.ts
 * Pure TypeScript implementation of K-Means clustering with deterministic seeding
 * for regime clustering, signal deduplication, and mistake pattern clustering.
 */

export class KMeans {
  private centroids: number[][] = [];
  private k: number = 2;
  private maxIter: number = 100;

  constructor(k = 2, maxIter = 100) {
    this.k = k;
    this.maxIter = maxIter;
  }

  private euclideanDistanceSq(a: number[], b: number[]): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return sum;
  }

  /**
   * Simple deterministic random generator for seeding.
   */
  private nextRandom(rngState: number): { rand: number; nextState: number } {
    const nextState = (rngState * 1664525 + 1013904223) % 4294967296;
    return { rand: nextState / 4294967296, nextState };
  }

  /**
   * Fit K-Means on dataset (N x D matrix) with K clusters and optional random seed.
   */
  public fit(data: number[][], k?: number, seed = 42): void {
    if (k !== undefined) {
      this.k = k;
    }

    if (!data || data.length === 0 || data[0].length === 0) {
      this.centroids = [];
      return;
    }

    const n = data.length;
    const numCols = data[0].length;
    const actualK = Math.min(this.k, n);

    // Initialize centroids using deterministic random seed
    let rngState = seed;
    const usedIndices = new Set<number>();
    this.centroids = [];

    while (this.centroids.length < actualK) {
      const res = this.nextRandom(rngState);
      rngState = res.nextState;
      const idx = Math.floor(res.rand * n);
      if (!usedIndices.has(idx)) {
        usedIndices.add(idx);
        this.centroids.push([...data[idx]]);
      }
    }

    // Iterative optimization loop
    for (let iter = 0; iter < this.maxIter; iter++) {
      const clusterCounts = new Array(actualK).fill(0);
      const newCentroids: number[][] = Array.from({ length: actualK }, () => new Array(numCols).fill(0));

      let changed = false;

      for (let i = 0; i < n; i++) {
        const point = data[i];
        const closestCluster = this.predict(point);

        clusterCounts[closestCluster]++;
        for (let c = 0; c < numCols; c++) {
          newCentroids[closestCluster][c] += point[c];
        }
      }

      // Update centroids
      for (let cIdx = 0; cIdx < actualK; cIdx++) {
        if (clusterCounts[cIdx] > 0) {
          for (let c = 0; c < numCols; c++) {
            const avgVal = newCentroids[cIdx][c] / clusterCounts[cIdx];
            if (Math.abs(this.centroids[cIdx][c] - avgVal) > 1e-6) {
              changed = true;
            }
            this.centroids[cIdx][c] = avgVal;
          }
        }
      }

      if (!changed) break;
    }
  }

  /**
   * Predict the index of the nearest cluster centroid for a single point.
   */
  public predict(point: number[]): number {
    if (this.centroids.length === 0) return 0;

    let minDist = Infinity;
    let closestIndex = 0;

    for (let i = 0; i < this.centroids.length; i++) {
      const dist = this.euclideanDistanceSq(point, this.centroids[i]);
      if (dist < minDist) {
        minDist = dist;
        closestIndex = i;
      }
    }

    return closestIndex;
  }

  /**
   * Get fitted cluster centroids.
   */
  public getCentroids(): number[][] {
    return this.centroids.map(c => [...c]);
  }
}
