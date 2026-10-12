import { BacktestEngine } from '../services/backtester/BacktestEngine';
import { MonteCarloSimulator } from '../services/backtester/MonteCarloSimulator';
import { WalkForwardOptimizer } from '../services/backtester/WalkForwardOptimizer';

// Handle incoming messages from the main thread
self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  try {
    if (type === 'RUN_SIMULATION') {
      const { config, trades } = payload;
      
      // 1. Run core simulation
      const simResult = BacktestEngine.runSimulation(config, trades);
      
      // 2. If trades exist, run advanced analytics
      let mcResult = null;
      let wfResult = null;

      if (simResult.trades.length > 0) {
        // Run 1000 iteration Monte Carlo
        mcResult = MonteCarloSimulator.run(simResult.trades, config.initialCapital, 1000);
        
        // Run 5-window Walk Forward
        wfResult = WalkForwardOptimizer.runRobustnessCheck(simResult.trades, config.initialCapital, 5);
      }

      // 3. Post results back to main thread
      self.postMessage({
        type: 'SIMULATION_COMPLETE',
        payload: {
          simResult,
          mcResult,
          wfResult
        }
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({
      type: 'SIMULATION_ERROR',
      payload: message || 'Unknown error during simulation'
    });
  }
};
