/**
 * IsotonicRegression.ts
 * Pure TypeScript implementation of Pool Adjacent Violators Algorithm (PAVA)
 * for calibrating raw model confidence scores into true empirical probabilities.
 */

interface Block {
  xMin: number;
  xMax: number;
  yAvg: number;
  weight: number;
}

export class IsotonicRegression {
  private blocks: Block[] = [];

  /**
   * Fit the isotonic regression calibrator on raw scores and binary outcomes (0 or 1).
   */
  public fit(scores: number[], labels: number[]): void {
    if (!scores || scores.length === 0 || scores.length !== labels.length) {
      this.blocks = [];
      return;
    }

    // Sort by score ascending
    const items = scores.map((s, i) => ({ x: s, y: labels[i] }));
    items.sort((a, b) => a.x - b.x);

    // Initial blocks
    const initialBlocks: Block[] = items.map(item => ({
      xMin: item.x,
      xMax: item.x,
      yAvg: item.y,
      weight: 1,
    }));

    // Pool Adjacent Violators Algorithm (PAVA)
    const stack: Block[] = [];
    for (const b of initialBlocks) {
      stack.push(b);
      while (stack.length >= 2) {
        const prev = stack[stack.length - 2];
        const curr = stack[stack.length - 1];

        if (prev.yAvg > curr.yAvg) {
          // Monotonicity violation -> pool blocks
          stack.pop();
          const totalWeight = prev.weight + curr.weight;
          prev.yAvg = (prev.weight * prev.yAvg + curr.weight * curr.yAvg) / totalWeight;
          prev.weight = totalWeight;
          prev.xMax = curr.xMax;
        } else {
          break;
        }
      }
    }

    this.blocks = stack;
  }

  /**
   * Calibrate a raw confidence score (0..1) to empirical probability (0..1).
   */
  public calibrate(score: number): number {
    if (this.blocks.length === 0) {
      return Math.max(0, Math.min(1, score));
    }

    if (score <= this.blocks[0].xMin) {
      return Math.max(0, Math.min(1, this.blocks[0].yAvg));
    }

    const last = this.blocks[this.blocks.length - 1];
    if (score >= last.xMax) {
      return Math.max(0, Math.min(1, last.yAvg));
    }

    // Linear interpolation between blocks
    for (let i = 0; i < this.blocks.length - 1; i++) {
      const b1 = this.blocks[i];
      const b2 = this.blocks[i + 1];

      if (score >= b1.xMin && score <= b2.xMax) {
        const mid1 = (b1.xMin + b1.xMax) / 2;
        const mid2 = (b2.xMin + b2.xMax) / 2;

        if (mid2 === mid1) return b1.yAvg;

        const t = (score - mid1) / (mid2 - mid1);
        const interpolated = b1.yAvg + t * (b2.yAvg - b1.yAvg);
        return Math.max(0, Math.min(1, interpolated));
      }
    }

    return Math.max(0, Math.min(1, score));
  }
}
