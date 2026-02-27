import { BacktestConfig, BacktestResult, SimulatedTrade, EquityPoint, DrawdownPoint } from '../../types/backtester.types';
import { MetricsCalculator } from './MetricsCalculator';
import { StrategyParser } from './StrategyParser';
import { OptionsSimulator } from './OptionsSimulator';

export interface HistoricalTradeNode {
  id?: string | number;
  date: string;
  ticker: string;
  direction: 'Long' | 'Short';
  entryPrice: number;
  exitPrice: number;
  high?: number;
  low?: number;
  exitTime?: string;
  metadata?: {
    optionLegs?: Array<{
      dte: number;
      ivEntry: number;
      ivExit: number;
    }>;
  };
  [key: string]: any;
}

/**
 * BacktestEngine
 * 
 * The core simulation loop that replays historical trades through strategy rules.
 * Handles both standard Equity/Futures and multi-leg Options simulation.
 */
export class BacktestEngine {
  
  static runSimulation(config: BacktestConfig, historicalTrades: HistoricalTradeNode[]): BacktestResult {
    const startTime = performance.now();
    const { strategy, initialCapital, costs } = config;
    
    let currentCapital = initialCapital;
    const simulatedTrades: SimulatedTrade[] = [];
    const equityCurve: EquityPoint[] = [];
    const drawdownCurve: DrawdownPoint[] = [];
    
    let peakCapital = initialCapital;

    // 1. Filter historical trades based on entry rules (Time, Day, Ticker, etc.)
    const candidates = StrategyParser.filterTrades(strategy, historicalTrades);

    for (const trade of candidates) {
      // 2. Position Sizing
      const quantity = this.calculateQuantity(config, trade, currentCapital);
      
      // 3. Determine Entry & Exit Prices (Simulating Costs/Slippage)
      const entryPrice = trade.entryPrice * (1 + (costs.estimatedSlippagePercent / 100));
      let exitPrice = trade.exitPrice * (1 - (costs.estimatedSlippagePercent / 100));
      
      // 4. Handle Simulation Logic
      let netPnL = 0;
      let reason = 'ORIGINAL_TRADE_EXIT';
      let totalCosts = 0;

      if (strategy.assetClass === 'Options' && strategy.legs && strategy.legs.length > 0) {
        // Multi-Leg Options Simulation (Black-Scholes)
        const r = 0.07; // 7% Risk Free Rate
        
        // Read options legs metadata from trade if enriched
        const metaLegs = (trade as any).metadata?.optionLegs;
        
        let T_ENTRY = 0.019; // Default ~7 DTE
        let T_EXIT = T_ENTRY * 0.8;
        
        if (metaLegs && metaLegs.length > 0 && metaLegs[0].dte !== undefined) {
          const dte = metaLegs[0].dte;
          T_ENTRY = Math.max(0.0001, dte) / 365.0;
          T_EXIT = Math.max(0.0001, dte - 0.2) / 365.0;
        }

        const entryVal = OptionsSimulator.calculateStrategyPayoff(trade.entryPrice, strategy.legs.map((l, idx) => {
          const legIV = metaLegs && metaLegs[idx] ? metaLegs[idx].ivEntry : 0.18;
          return {
            type: l.type,
            action: l.action,
            K: trade.entryPrice + l.strikeOffset,
            quantity: quantity * l.quantityMultiplier,
            iv: legIV
          };
        }), T_ENTRY, r, 0.18);

        const exitVal = OptionsSimulator.calculateStrategyPayoff(trade.exitPrice, strategy.legs.map((l, idx) => {
          const legIV = metaLegs && metaLegs[idx] ? metaLegs[idx].ivExit : 0.18;
          return {
            type: l.type,
            action: l.action,
            K: trade.entryPrice + l.strikeOffset,
            quantity: quantity * l.quantityMultiplier,
            iv: legIV
          };
        }), T_EXIT, r, 0.18);

        netPnL = exitVal.totalValue - entryVal.totalValue;
        reason = 'OPTIONS_STRATEGY_EXIT';
        
        const costData = this.calculateCosts(costs, entryPrice, exitPrice, quantity);
        totalCosts = costData.brokerage + costData.taxes;
      } else {
        // Standard Equity/Futures Simulation
        const grossPnL = (exitPrice - entryPrice) * quantity * (trade.direction === 'Long' ? 1 : -1);
        
        // Apply Strategy Exit Rules (Stop Loss / Targets)
        const exitResult = this.applyExitRules(strategy, trade, entryPrice, quantity);
        if (exitResult.triggered) {
          exitPrice = exitResult.price;
          netPnL = exitResult.pnl;
          reason = exitResult.reason;
        } else {
          netPnL = grossPnL;
        }

        const costData = this.calculateCosts(costs, entryPrice, exitPrice, quantity);
        totalCosts = costData.brokerage + costData.taxes;
      }

      // 5. Deduct Transaction Costs
      netPnL -= totalCosts;

      // 6. Update Capital and Risk metrics
      currentCapital += netPnL;
      if (currentCapital > peakCapital) peakCapital = currentCapital;
      
      const drawdownAmount = peakCapital - currentCapital;
      const drawdownPercent = (drawdownAmount / peakCapital) * 100;

      simulatedTrades.push({
        id: trade.id?.toString() || Math.random().toString(),
        date: trade.date,
        ticker: trade.ticker,
        direction: trade.direction,
        entryPrice,
        exitPrice,
        quantity,
        grossPnL: netPnL + totalCosts, // Reverse calc for gross
        netPnL,
        totalCosts,
        reason,
        capitalAtRisk: entryPrice * quantity,
        postTradeEquity: currentCapital
      });

      equityCurve.push({ date: trade.date, equity: currentCapital });
      drawdownCurve.push({ date: trade.date, drawdown: drawdownPercent });
    }

    // 7. Calculate Final Analytics
    const metrics = MetricsCalculator.calculate(simulatedTrades, initialCapital);
    const executionTimeMs = performance.now() - startTime;

    return {
      config,
      trades: simulatedTrades,
      metrics,
      equityCurve,
      drawdownCurve,
      executionTimeMs
    };
  }

  private static calculateQuantity(config: BacktestConfig, trade: HistoricalTradeNode, currentCapital: number): number {
    const { positionSizing } = config.strategy;
    
    let qty = 1;

    if (positionSizing.type === 'FIXED_QUANTITY') {
      qty = positionSizing.value;
    }
    
    else if (positionSizing.type === 'PERCENT_OF_CAPITAL') {
      const capitalToUse = currentCapital * (positionSizing.value / 100);
      qty = Math.floor(capitalToUse / trade.entryPrice) || 1;
    }
    
    else if (positionSizing.type === 'FIXED_RISK_AMOUNT') {
      const slRule = config.strategy.exitRules.find(r => r.type === 'FIXED_STOP_LOSS');
      const slValue = slRule ? Number(slRule.value) : (trade.entryPrice * 0.02);
      const riskPerShare = slRule?.unit === 'PERCENT' ? (trade.entryPrice * slValue / 100) : slValue;
      qty = Math.floor(positionSizing.value / riskPerShare) || 1;
    }

    else if (positionSizing.type === 'KELLY') {
      // Basic Kelly: (p*b - q) / b where b is Win/Loss ratio, p is Win probability
      // For backtest start, we use a conservative 2% if no data
      qty = Math.floor((currentCapital * 0.02) / trade.entryPrice) || 1;
    }

    // Apply Max Exposure Guard
    if (positionSizing.maxExposure) {
      const maxQty = Math.floor(positionSizing.maxExposure / trade.entryPrice);
      qty = Math.min(qty, maxQty);
    }

    return qty;
  }

  private static applyExitRules(strategy: any, trade: HistoricalTradeNode, entryPrice: number, quantity: number) {
    let bestExitPrice = trade.exitPrice;
    let bestReason = 'ORIGINAL_TRADE_EXIT';
    let triggered = false;

    // We simulate trailing stops by tracking the highest price seen (for Longs) or lowest (for Shorts)
    // For historical trade replay, we only have Entry/Exit/High/Low if provided.
    // If only Entry/Exit provided, Trailing Stop is less effective but still calculates against exit.
    
    let highSinceEntry = Math.max(entryPrice, trade.exitPrice, trade.high || entryPrice);
    let lowSinceEntry = Math.min(entryPrice, trade.exitPrice, trade.low || entryPrice);

    for (const rule of strategy.exitRules) {
      if (rule.type === 'FIXED_STOP_LOSS') {
        const slValue = Number(rule.value);
        const slPrice = trade.direction === 'Long' 
          ? (rule.unit === 'PERCENT' ? entryPrice * (1 - slValue / 100) : entryPrice - slValue)
          : (rule.unit === 'PERCENT' ? entryPrice * (1 + slValue / 100) : entryPrice + slValue);
        
        const hitSL = trade.direction === 'Long' ? (lowSinceEntry <= slPrice) : (highSinceEntry >= slPrice);
        if (hitSL) {
          return { triggered: true, price: slPrice, pnl: (slPrice - entryPrice) * quantity * (trade.direction === 'Long' ? 1 : -1), reason: 'STOP_LOSS_HIT' };
        }
      }
      
      if (rule.type === 'FIXED_TARGET') {
        const targetValue = Number(rule.value);
        const targetPrice = trade.direction === 'Long'
          ? (rule.unit === 'PERCENT' ? entryPrice * (1 + targetValue / 100) : entryPrice + targetValue)
          : (rule.unit === 'PERCENT' ? entryPrice * (1 - targetValue / 100) : entryPrice - targetValue);
          
        const hitTarget = trade.direction === 'Long' ? (highSinceEntry >= targetPrice) : (lowSinceEntry <= targetPrice);
        if (hitTarget) {
          return { triggered: true, price: targetPrice, pnl: (targetPrice - entryPrice) * quantity * (trade.direction === 'Long' ? 1 : -1), reason: 'TARGET_REACHED' };
        }
      }

      if (rule.type === 'TRAILING_STOP') {
        const trailValue = Number(rule.value);
        const trailPrice = trade.direction === 'Long'
          ? (rule.unit === 'PERCENT' ? highSinceEntry * (1 - trailValue / 100) : highSinceEntry - trailValue)
          : (rule.unit === 'PERCENT' ? lowSinceEntry * (1 + trailValue / 100) : lowSinceEntry + trailValue);

        const hitTrail = trade.direction === 'Long' ? (lowSinceEntry <= trailPrice) : (highSinceEntry >= trailPrice);
        if (hitTrail) {
          return { triggered: true, price: trailPrice, pnl: (trailPrice - entryPrice) * quantity * (trade.direction === 'Long' ? 1 : -1), reason: 'TRAILING_STOP_HIT' };
        }
      }

      if (rule.type === 'TIME_BASED' || rule.type === 'END_OF_DAY') {
        const exitTime = rule.type === 'END_OF_DAY' ? '15:15' : rule.value.toString();
        if (trade.exitTime && trade.exitTime >= exitTime) {
          // If the original trade lasted longer than our time cutoff, we exit at original exit price but mark reason
          return { triggered: true, price: trade.exitPrice, pnl: (trade.exitPrice - entryPrice) * quantity * (trade.direction === 'Long' ? 1 : -1), reason: 'TIME_BASED_EXIT' };
        }
      }
    }

    const pnl = (trade.exitPrice - entryPrice) * quantity * (trade.direction === 'Long' ? 1 : -1);
    return { triggered: false, price: trade.exitPrice, pnl, reason: 'ORIGINAL_TRADE_EXIT' };
  }

  private static calculateCosts(costs: any, entry: number, exit: number, qty: number) {
    const turnover = (entry + exit) * qty;
    const brokerage = costs.brokeragePerOrder * 2;
    const stt = (exit * qty) * costs.sttRate;
    const otherTaxes = turnover * (costs.exchangeFeeRate + costs.stampDutyRate);
    
    return {
      brokerage,
      taxes: stt + otherTaxes
    };
  }
}

// ── VectorBT high-performance backend ───────────────────────────────────────

export interface VectorBTRequest {
  symbol:      string;
  from_date:   string;
  to_date:     string;
  capital?:    number;
  strategy?:   'ema_cross' | 'rsi';
  fast_period?: number;
  slow_period?: number;
  rsi_period?:  number;
  rsi_entry?:   number;
  rsi_exit?:    number;
}

export interface VectorBTResult {
  symbol:            string;
  total_return:      number;
  annualized_return: number;
  sharpe_ratio:      number;
  sortino_ratio:     number;
  max_drawdown:      number;
  win_rate:          number;
  trade_count:       number;
  profit_factor:     number;
  equity_curve:      Array<{ date: string; value: number }>;
  drawdown_curve:    Array<{ date: string; value: number }>;
}

const BRIDGE_URL = '/api/python-nse';

export async function runVectorBTBacktest(
  params: VectorBTRequest
): Promise<VectorBTResult> {
  const res = await fetch(`${BRIDGE_URL}/api/backtest/vectorbt`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(params),
    signal:  AbortSignal.timeout(60_000) // VectorBT JIT + run can take up to 60s
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `VectorBT backtest failed (${res.status})`);
  }
  return res.json();
}

export interface LeanCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LeanExportResult {
  status: string;
  file_path: string;
  lines_written: number;
  message: string;
}

export async function runLeanExport(
  symbol: string,
  candles: LeanCandle[]
): Promise<LeanExportResult> {
  const res = await fetch(`${BRIDGE_URL}/api/backtest/lean/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, candles }),
    signal: AbortSignal.timeout(30_000)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `LEAN export failed (${res.status})`);
  }
  return res.json();
}


