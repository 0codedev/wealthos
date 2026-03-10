/**
 * BacktestFitDetector.ts
 * Detects backtest curve-fitting / overfitting via 500-iteration Monte Carlo permutation testing.
 * Compares actual strategy Sharpe ratio against permuted random-entry baseline distribution.
 */

export interface BacktestFitResult {
  actualSharpe: number;
  benchmarkSharpeMean: number;
  benchmarkSharpe95th: number;
  pValue: number;           // Probability strategy performance is due to random luck
  isOverfitted: boolean;    // true if pValue >= 0.05
  confidenceScore: number;  // 0..1 (1 - pValue)
}

export class BacktestFitDetector {
  /**
   * Run Monte Carlo permutation test on sequence of trade returns.
   */
  public static test(returns: number[], iterations = 500, seed = 42): BacktestFitResult {
    if (!returns || returns.length < 10) {
      return {
        actualSharpe: 0,
        benchmarkSharpeMean: 0,
        benchmarkSharpe95th: 0,
        pValue: 1.0,
        isOverfitted: true,
        confidenceScore: 0.0,
      };
    }

    const actualSharpe = this.computeSharpe(returns);
    const permutedSharpes: number[] = [];

    let rngState = seed;

    for (let iter = 0; iter < iterations; iter++) {
      // Create randomly permuted signs/returns
      const shuffled = [...returns];

      for (let i = shuffled.length - 1; i > 0; i--) {
        const nextState = (rngState * 1664525 + 1013904223) % 4294967296;
        rngState = nextState;
        const j = Math.floor((nextState / 4294967296) * (i + 1));
        const tmp = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = tmp;
      }

      // Random sign flips to simulate random entries
      for (let i = 0; i < shuffled.length; i++) {
        const nextState = (rngState * 1664525 + 1013904223) % 4294967296;
        rngState = nextState;
        if (nextState / 4294967296 > 0.5) {
          shuffled[i] = -shuffled[i];
        }
      }

      permutedSharpes.push(this.computeSharpe(shuffled));
    }

    permutedSharpes.sort((a, b) => a - b);

    // Count how many permuted random benchmarks beat or equal actual Sharpe
    let betterCount = 0;
    for (const s of permutedSharpes) {
      if (s >= actualSharpe) betterCount++;
    }

    const pValue = betterCount / iterations;
    const meanSharpe = permutedSharpes.reduce((a, b) => a + b, 0) / iterations;
    const idx95 = Math.floor(iterations * 0.95);
    const sharpe95th = permutedSharpes[idx95] ?? 0;

    const isOverfitted = pValue >= 0.05 || actualSharpe <= sharpe95th;
    const confidenceScore = parseFloat((1.0 - pValue).toFixed(2));

    return {
      actualSharpe: parseFloat(actualSharpe.toFixed(2)),
      benchmarkSharpeMean: parseFloat(meanSharpe.toFixed(2)),
      benchmarkSharpe95th: parseFloat(sharpe95th.toFixed(2)),
      pValue: parseFloat(pValue.toFixed(4)),
      isOverfitted,
      confidenceScore,
    };
  }

  private static computeSharpe(returns: number[]): number {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    let varianceSum = 0;
    for (const r of returns) {
      const diff = r - mean;
      varianceSum += diff * diff;
    }
    const stdDev = Math.sqrt(varianceSum / (returns.length - 1));
    if (stdDev === 0) return 0;
    // Annualized Sharpe assuming 252 trading days
    return (mean / stdDev) * Math.sqrt(252);
  }
}
