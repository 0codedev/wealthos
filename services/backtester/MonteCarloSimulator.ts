import { SimulatedTrade } from '../../types/backtester.types';

export interface MonteCarloResult {
  paths: number[][];       // 1000 arrays of equity curves (or a subset for rendering)
  medianFinalEquity: number;
  percentile5th: number;   // Pessimistic
  percentile95th: number;  // Optimistic
  riskOfRuin: number;      // % of runs that hit 0 or go below a ruin threshold
}

export class MonteCarloSimulator {
  
  /**
   * Runs a Monte Carlo simulation by randomly shuffling the trade sequence.
   * This tests if the strategy's success was just due to a "lucky" sequence of trades.
   * 
   * @param originalTrades The simulated trades from the original backtest run
   * @param initialCapital The starting capital
   * @param iterations Number of simulation runs (default 1000)
   * @param maxPathsToReturn How many full paths to return for the UI to draw (to avoid rendering 1000 SVG lines)
   */
  static run(
    originalTrades: SimulatedTrade[], 
    initialCapital: number, 
    iterations: number = 1000,
    maxPathsToReturn: number = 50
  ): MonteCarloResult {
    
    if (!originalTrades || originalTrades.length === 0) {
      return { paths: [], medianFinalEquity: initialCapital, percentile5th: initialCapital, percentile95th: initialCapital, riskOfRuin: 0 };
    }

    const tradeReturns = originalTrades.map(t => t.netPnL);
    const finalEquities: number[] = [];
    const savedPaths: number[][] = [];
    let ruinedCount = 0;
    const ruinThreshold = initialCapital * 0.5; // Ruin = losing 50% of capital

    for (let i = 0; i < iterations; i++) {
      // 1. Shuffle the array using Fisher-Yates
      const shuffledReturns = [...tradeReturns];
      for (let j = shuffledReturns.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [shuffledReturns[j], shuffledReturns[k]] = [shuffledReturns[k], shuffledReturns[j]];
      }

      // 2. Reconstruct Equity Curve
      let currentEquity = initialCapital;
      const currentPath = [initialCapital];
      let isRuined = false;

      for (const pnl of shuffledReturns) {
        currentEquity += pnl;
        
        // Safety bounds
        if (currentEquity < 0) currentEquity = 0;
        currentPath.push(currentEquity);

        if (currentEquity <= ruinThreshold && !isRuined) {
          isRuined = true;
          ruinedCount++;
        }
      }

      finalEquities.push(currentEquity);

      // Save a subset of paths to render the fan chart
      if (i < maxPathsToReturn) {
        savedPaths.push(currentPath);
      }
    }

    // 3. Calculate Percentiles
    finalEquities.sort((a, b) => a - b);
    
    const medianIndex = Math.floor(iterations * 0.50);
    const p5Index = Math.floor(iterations * 0.05);
    const p95Index = Math.floor(iterations * 0.95);

    return {
      paths: savedPaths,
      medianFinalEquity: finalEquities[medianIndex],
      percentile5th: finalEquities[p5Index],
      percentile95th: finalEquities[p95Index],
      riskOfRuin: (ruinedCount / iterations) * 100
    };
  }
}
