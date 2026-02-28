import { SimulatedTrade, BacktestMetrics } from '../../types/backtester.types';
import { MetricsCalculator } from './MetricsCalculator';

export interface WalkForwardWindow {
  id: string;
  startDate: string;
  endDate: string;
  tradeCount: number;
  metrics: BacktestMetrics;
  isProfitable: boolean;
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  robustnessScore: number; // Percentage of windows that are profitable
  averageEfficiency: number; // Metric comparing best to worst windows
}

export class WalkForwardOptimizer {
  
  /**
   * Evaluates the strategy over chronological chunks (windows) of the trade history.
   * Helps identify if a strategy only worked in one specific market regime.
   * 
   * @param trades All simulated trades in chronological order
   * @param initialCapital Starting capital for each window isolated test
   * @param numWindows Number of segments to split the data into (e.g. 5)
   */
  static runRobustnessCheck(
    trades: SimulatedTrade[], 
    initialCapital: number,
    numWindows: number = 5
  ): WalkForwardResult {
    
    if (!trades || trades.length < numWindows * 2) {
      return { windows: [], robustnessScore: 0, averageEfficiency: 0 };
    }

    const windowSize = Math.floor(trades.length / numWindows);
    const windows: WalkForwardWindow[] = [];
    let profitableCount = 0;

    for (let i = 0; i < numWindows; i++) {
      const startIndex = i * windowSize;
      // Last window takes any remaining trades
      const endIndex = (i === numWindows - 1) ? trades.length : (i + 1) * windowSize;
      
      const windowTrades = trades.slice(startIndex, endIndex);
      
      if (windowTrades.length === 0) continue;

      const metrics = MetricsCalculator.calculate(windowTrades, initialCapital);
      const isProfitable = metrics.netProfit > 0;

      if (isProfitable) profitableCount++;

      windows.push({
        id: `W${i + 1}`,
        startDate: windowTrades[0].date,
        endDate: windowTrades[windowTrades.length - 1].date,
        tradeCount: windowTrades.length,
        metrics,
        isProfitable
      });
    }

    const robustnessScore = (profitableCount / numWindows) * 100;
    
    // Average efficiency: simple heuristic based on Win Rate variance across windows
    // (A real WFO calculates IS vs OOS return ratios)
    const winRates = windows.map(w => w.metrics.winRate);
    const maxWR = Math.max(...winRates);
    const minWR = Math.min(...winRates);
    const averageEfficiency = maxWR > 0 ? (minWR / maxWR) * 100 : 0;

    return {
      windows,
      robustnessScore,
      averageEfficiency
    };
  }
}
