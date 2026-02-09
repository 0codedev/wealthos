
// ----------------------------------------------------------------------
// 1. Core Rule & Strategy Definitions
// ----------------------------------------------------------------------

export type RuleCondition = 
  | 'EQUALS' | 'NOT_EQUALS' 
  | 'GREATER_THAN' | 'LESS_THAN' 
  | 'CONTAINS' | 'NOT_CONTAINS' 
  | 'BETWEEN' | 'IN' | 'NOT_IN';

export interface StrategyRule {
  id: string;
  field: string;          // e.g., 'timeOfDay', 'dayOfWeek', 'ticker', 'direction', 'consecutiveLosses'
  condition: RuleCondition;
  value: any;             // The threshold or array of values
  logicalOperator?: 'AND' | 'OR'; // How it connects to the next rule
}

export interface IndicatorCondition {
  id: string;
  logic: 'AND' | 'OR';            // connector to previous condition

  // LEFT SIDE — what you're measuring
  leftType: 'INDICATOR' | 'PRICE' | 'PATTERN' | 'BEHAVIORAL';
  leftIndicator: string;           // e.g. "ema", "rsi", "vwap", "close", "gap_pct"
  leftPeriod?: number;             // e.g. 9 for EMA(9)
  leftPeriod2?: number;            // for MACD: fast/slow

  // OPERATOR
  operator:
    | 'GREATER_THAN'
    | 'LESS_THAN'
    | 'GREATER_EQUAL'
    | 'LESS_EQUAL'
    | 'EQUALS'
    | 'NOT_EQUALS'
    | 'CROSSES_ABOVE'              // crossover detection
    | 'CROSSES_BELOW'
    | 'BETWEEN'
    | 'IS_TRUE';                    // for boolean patterns

  // RIGHT SIDE — value or another indicator
  rightType: 'VALUE' | 'INDICATOR' | 'PRICE_ACTION';
  rightValue?: number | string;             // e.g. 55 for RSI > 55
  rightIndicator?: string;         // e.g. "ema" for EMA(9) > EMA(21)
  rightPeriod?: number;            // e.g. 21 for the right EMA
  rightValueHigh?: number | string;         // for BETWEEN: upper bound
}

export type ExitType = 
  | 'FIXED_STOP_LOSS'
  | 'FIXED_TARGET'
  | 'TRAILING_STOP'
  | 'TIME_BASED'
  | 'END_OF_DAY';

export interface ExitRule {
  id: string;
  type: ExitType;
  value: number | string; // e.g., 5% stop, Rs 1000, or "15:15"
  unit: 'PERCENT' | 'ABSOLUTE' | 'TIME';
}

export type PositionSizingType = 
  | 'FIXED_QUANTITY'
  | 'FIXED_RISK_AMOUNT'
  | 'PERCENT_OF_CAPITAL'
  | 'KELLY';

export interface PositionSizing {
  type: PositionSizingType;
  value: number;          // e.g., 100 shares, Rs 2000 risk, 2% capital
  maxExposure?: number;   // Maximum total capital allocated to this trade
}

export interface OptionLeg {
  id: string;
  type: 'CE' | 'PE';
  action: 'BUY' | 'SELL';
  strikeSelection: 'ATM' | 'ITM' | 'OTM';
  strikeOffset: number; // e.g., +100 for OTM-100 CE
  quantityMultiplier: number; // e.g., 2 for selling 2 legs in a ratio spread
}

export interface StrategyDefinition {
  id: string;
  name: string;
  description: string;
  assetClass: 'Equity' | 'Options' | 'Futures' | 'Commodity';
  ticker?: string; // Target ticker/symbol (e.g. NIFTY, BANKNIFTY, SBIN)
  entryRules: IndicatorCondition[];
  exitRules: ExitRule[];
  positionSizing: PositionSizing;
  legs?: OptionLeg[]; // New: Multi-leg support
}

// ----------------------------------------------------------------------
// 2. Backtest Configuration
// ----------------------------------------------------------------------

export interface CostModel {
  brokeragePerOrder: number; // e.g., 20
  sttRate: number;           // e.g., 0.000625 for options sell
  exchangeFeeRate: number;   // e.g., 0.0005
  stampDutyRate: number;
  estimatedSlippagePercent: number; 
}

export interface BacktestConfig {
  strategy: StrategyDefinition;
  dateRange: { from: Date; to: Date };
  initialCapital: number;
  costs: CostModel;
  useRealTradeHistory: boolean; // True if using Dhan sync data
}

// ----------------------------------------------------------------------
// 3. Execution & Results
// ----------------------------------------------------------------------

export interface EquityPoint {
  date: string;
  equity: number;
}

export interface DrawdownPoint {
  date: string;
  drawdown: number;
}

export interface SimulatedTrade {
  id: string;
  originalTradeId?: string; // If mapped from actual history
  date: string;
  ticker: string;
  direction: 'Long' | 'Short';
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  grossPnL: number;
  netPnL: number;
  totalCosts: number;
  entryTime?: string;
  exitTime?: string;
  reason: string;          // Changed from reasonForExit to match Engine usage
  capitalAtRisk: number;
  postTradeEquity: number;
  mistakesFiltered?: string[]; // If strategy avoided this trade due to specific mistakes
}

export interface BacktestMetrics {
  // Returns
  initialCapital: number;
  finalCapital: number;
  netProfit: number;
  totalReturnPercent: number;
  cagr: number;

  // Drawdown
  maxDrawdownAmount: number;
  maxDrawdownPercent: number;
  avgDrawdownPercent: number;
  recoveryFactor: number; // Net Profit / Max Drawdown

  // Risk Adjusted
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  profitFactor: number;
  
  // Tail Risk
  valueAtRisk95: number;
  conditionalVaR: number;

  // Trade Stats
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  payoffRatio: number; // AvgWin / AvgLoss
  expectancy: number;  // (WR * AvgWin) - (LR * AvgLoss)

  // Streaks
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;

  // NSE Specific
  totalBrokeragePaid: number;
  totalTaxesPaid: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: SimulatedTrade[];
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  drawdownCurve: DrawdownPoint[];
  executionTimeMs: number;
}

export type DataSource = 'upstox_live' | 'data_vault' | 'trade_journal' | 'yahoo_finance';

export interface BacktestDataMeta {
  source: DataSource;
  symbol: string;
  segment: 'options' | 'futures' | 'equity';
  interval: string;
  from: string;
  to: string;
  totalCandles: number;
  fetchedAt: string;
}

export interface FetchProgress {
  step: 1 | 2 | 3 | 4;
  stepName: 'Expiries' | 'Contracts' | 'Candles' | 'Importing';
  current: number;
  total: number;
  symbol: string;
}

export interface ScreenerConfig {
  strategy: StrategyDefinition;
  universe: 'indices' | 'all' | 'custom';
  customSymbols?: string;
  sectors?: string[];
  portfolioMode: 'independent' | 'consolidated';
  maxConcurrentTrades?: number;
  dateRange: { from: string; to: string };
  initialCapital: number;
  costs: CostModel;
}

export interface SymbolScreenerResult {
  symbol: string;
  sector: string;
  tradesCount: number;
  winRate: number;
  netPnL: number;
}

export interface ScreenerResult {
  config: ScreenerConfig;
  trades: SimulatedTrade[];
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  drawdownCurve: DrawdownPoint[];
  symbolBreakdown: SymbolScreenerResult[];
  executionTimeMs: number;
}

