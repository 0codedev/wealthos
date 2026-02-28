import { StrategyDefinition } from '../../types/backtester.types';

export interface SimulationResult {
  status: 'success' | 'error';
  warning?: string;
  metrics: {
    initial_capital: number;
    final_capital: number;
    total_return_pct: number;
    max_drawdown_pct: number;
    sharpe_ratio: number;
    sortino_ratio: number;
    calmar_ratio: number;
    profit_factor: number;
    win_rate_pct: number;
    total_trades: number;
    winning_trades: number;
    losing_trades: number;
    avg_win: number;
    avg_loss: number;
    expectancy: number;
    total_costs: number;
  };
  equity_curve: { date: string; equity: number; drawdown_pct: number }[];
  trade_log: {
    entry_date: string;
    exit_date: string;
    entry_price: number;
    exit_price: number;
    side: 'BUY' | 'SELL';
    qty: number;
    pnl_gross: number;
    costs: number;
    pnl_net: number;
    exit_reason: string;
  }[];
  walk_forward: { window: number; from: string; to: string; sharpe: number; total_return_pct: number }[];
  monte_carlo: {
    p5: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p95: number[];
    risk_of_ruin_pct: number;
  };
}

export class SimulationService {
  /**
   * Executes strategy backtest simulation on historical Parquet files.
   */
  static async runSimulation(config: {
    symbol: string;
    asset_class: string;
    interval: string;
    from_date: string;
    to_date: string;
    initial_capital: number;
    position_sizing: { type: string; value: number };
    entry_rules: any[];
    exit_rules: any[];
    legs?: any[];
  }): Promise<SimulationResult> {
    try {
      const response = await fetch('/api/python-nse/api/backtest/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Simulation execution failed on the backend.');
      }

      return await response.json();
    } catch (error: unknown) {
      console.error('[SimulationService] Error running simulation:', error);
      throw error;
    }
  }
}
