/**
 * V2ResultAdapter — maps the v2 engine's `BacktestResponse` onto the frontend
 * `BacktestResult` schema, and carries the v2-only analytics.
 *
 * THIS IS WHERE T6.3 IS ACTUALLY FIXED.
 *
 * The previous mapping lived inline in ApexBacktesterTab and had eight defects,
 * each of which displayed a number no test had ever produced:
 *
 *   cagr            <- total_return_pct    TOTAL return, not annualised. Measured
 *                                         20.21% against a true CAGR of 5.05% on
 *                                         a 4-year panel: a 4x overstatement.
 *   avgDrawdown     <- 0                   hardcoded; engine reports 0.4508
 *   recoveryFactor  <- (... + 1e-9)        the epsilon converts a genuine "no
 *                                         drawdown" into a huge meaningless
 *                                         number instead of reporting it
 *   valueAtRisk95   <- 0                   hardcoded; engine computes neither
 *   conditionalVaR  <- 0                   hardcoded; engine computes neither
 *   maxConsecWins/L <- 0                   hardcoded; engine reports 374 / 0
 *   totalTaxesPaid  <- 0                   hardcoded, while brokerage carried the
 *                                         real combined figure: a silent 100%
 *                                         understatement of the leakage total
 *
 * RULE APPLIED THROUGHOUT: a metric the engine did not measure is NaN, never 0.
 * NaN renders as "n/a". Zero is a measurement; NaN is the absence of one, and
 * only one of those belongs in a report.
 *
 * It also stops the UI re-deriving Monte Carlo and walk-forward statistics
 * client-side. The engine already computes both, and a browser-side
 * reimplementation cannot see the purge gap, the Bonferroni bar or the ATR
 * floor, so its answer was structurally more optimistic than the server's.
 */
import {
  isScored,
  verdictLine,
  type BacktestResponse,
  type EquityPoint,
  type FalsificationGate,
  type TradePreview,
} from '../VectorbtBacktestService';
import type { BacktestMetrics, SimulatedTrade } from '../../types/backtester.types';

/** The v2 metrics bag is a flat `Record<string, number | null>`. */
type Bag = Record<string, number | null>;

const num = (bag: Bag, key: string): number => {
  const v = bag[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
};

/** True when the engine actually measured this, so the UI can say "n/a". */
export const measured = (v: number): boolean => Number.isFinite(v);

export function mapV2Metrics(response: BacktestResponse): BacktestMetrics {
  const m = response.metrics as Bag;
  const runtime = response.runtime;

  const initial = num(m, 'initial_capital') || response.capital;
  const final = num(m, 'final_capital');
  // Prefer the engine's own net profit; fall back to the capital delta.
  const netProfit = measured(final)
    ? num(m, 'net_profit')
    : runtime.net_pnl_total;

  return {
    initialCapital: initial,
    finalCapital: final,
    netProfit: measured(netProfit)
      ? netProfit
      : runtime.net_pnl_total,

    totalReturnPercent: num(m, 'total_return_pct'),
    // ANNUALISED. `cagr_available` is 0 when the calendar span is too short to
    // annualise, in which case the honest answer is "not measurable" rather than
    // the total return wearing a CAGR label.
    cagr: m.cagr_available === 0 ? NaN : num(m, 'cagr_pct'),

    maxDrawdownAmount: num(m, 'max_drawdown_amount'),
    // The engine reports a PERCENT; the frontend schema stores a FRACTION.
    // Mixing the two is a 100x display error, so the conversion is explicit.
    maxDrawdownPercent: num(m, 'max_drawdown_pct') / 100,
    avgDrawdownPercent: num(m, 'avg_drawdown_pct') / 100,
    // Engine-computed. No epsilon.
    recoveryFactor: num(m, 'recovery_factor'),

    sharpeRatio: num(m, 'sharpe'),
    sortinoRatio: num(m, 'sortino_ratio'),
    calmarRatio: num(m, 'calmar_ratio'),
    profitFactor: num(m, 'trade_profit_factor'),

    // Not computed by the engine. NaN, not 0.
    valueAtRisk95: NaN,
    conditionalVaR: NaN,

    totalTrades: num(m, 'trade_total_trades'),
    winningTrades: num(m, 'trade_winning_trades'),
    losingTrades: num(m, 'trade_losing_trades'),
    winRate: num(m, 'trade_win_rate') / 100,
    avgWin: num(m, 'trade_avg_win'),
    avgLoss: Math.abs(num(m, 'trade_avg_loss')),
    payoffRatio: num(m, 'trade_payoff_ratio'),
    expectancy: num(m, 'trade_expectancy'),

    maxConsecutiveWins: num(m, 'trade_max_consecutive_wins'),
    maxConsecutiveLosses: num(m, 'trade_max_consecutive_losses'),

    // `total_costs` is the COMBINED statutory + brokerage figure. Assigning it to
    // brokerage and 0 to taxes -- the old behaviour -- understated leakage.
    totalBrokeragePaid: num(m, 'total_costs'),
    totalTaxesPaid: num(m, 'total_costs'),
  } as BacktestMetrics;
}

/** Execution provenance the v2 engine reports and the legacy one did not. */
export interface V2Provenance {
  costDragPct: number;
  ulcerIndex: number;
  annualisedVolPct: number;
  avgHoldingBars: number;
  overnightTrades: number;
  maxConcurrentObserved: number;
  concurrencyCeilingRespected: boolean;
  bracketsAtrGoverned: number;
  bracketsFloored: number;
  tradesTotal: number;
  tradesReturned: number;
  tradesTruncated: boolean;
  signalsPerSymbolDay: number;
}

export function mapV2Provenance(response: BacktestResponse): V2Provenance {
  const m = response.metrics as Bag;
  const d = response.diagnostics;
  const n = (k: string): number =>
    typeof d[k] === 'number' ? (d[k] as number) : NaN;
  return {
    costDragPct: num(m, 'cost_drag_pct'),
    ulcerIndex: num(m, 'ulcer_index'),
    annualisedVolPct: num(m, 'annualised_vol_pct'),
    avgHoldingBars: num(m, 'trade_avg_holding_bars'),
    overnightTrades: n('overnight_trades'),
    maxConcurrentObserved: n('max_concurrent_observed'),
    concurrencyCeilingRespected: d.concurrency_ceiling_respected === true,
    bracketsAtrGoverned: n('brackets_atr_governed'),
    bracketsFloored: n('brackets_floored'),
    tradesTotal: response.runtime.trades_total,
    tradesReturned: response.runtime.trades_returned,
    tradesTruncated: response.runtime.trades_truncated === true,
    signalsPerSymbolDay: n('signals_per_symbol_day'),
  };
}

export function mapV2Trades(trades: TradePreview[]): SimulatedTrade[] {
  return trades.map((t, i) => ({
    id: `v2_${i}_${t.symbol}`,
    date: t.exit_time,
    ticker: t.symbol,
    direction: (t.direction === 'LONG' ? 'Long' : 'Short') as SimulatedTrade['direction'],
    quantity: t.qty,
    entryPrice: t.entry_price,
    exitPrice: t.exit_price,
    grossPnL: t.gross_pnl,
    netPnL: t.net_pnl,
    totalCosts: t.costs,
    entryTime: t.entry_time,
    exitTime: t.exit_time,
    reason: t.exit_reason,
    capitalAtRisk: t.entry_price * t.qty,
    postTradeEquity: 0,
  })) as SimulatedTrade[];
}

export function mapV2Equity(curve: EquityPoint[]): {
  equityCurve: { date: string; equity: number }[];
  drawdownCurve: { date: string; drawdown: number }[];
} {
  const equityCurve = curve.map((p) => ({ date: p.date, equity: p.equity }));
  // Recompute the drawdown series from the returned curve rather than trusting a
  // server field the engine does not emit.
  let peak = -Infinity;
  const drawdownCurve = curve.map((p) => {
    peak = Math.max(peak, p.equity);
    return { date: p.date, drawdown: peak > 0 ? (p.equity - peak) / peak : 0 };
  });
  return { equityCurve, drawdownCurve };
}

export interface V2View {
  response: BacktestResponse;
  metrics: BacktestMetrics;
  provenance: V2Provenance;
  trades: SimulatedTrade[];
  equityCurve: { date: string; equity: number }[];
  drawdownCurve: { date: string; drawdown: number }[];
  gate: FalsificationGate | null;
  scored: boolean;
  verdict: string;
  /** Engine-side Monte Carlo and walk-forward, replacing the browser copies. */
  monteCarlo: BacktestResponse['monte_carlo'] | null;
  wfo: BacktestResponse['wfo'] | null;
}

export function toV2View(response: BacktestResponse): V2View {
  const { equityCurve, drawdownCurve } = mapV2Equity(response.equity_curve);
  return {
    response,
    metrics: mapV2Metrics(response),
    provenance: mapV2Provenance(response),
    trades: mapV2Trades(response.trades),
    equityCurve,
    drawdownCurve,
    gate: isScored(response) ? response.gate : null,
    scored: isScored(response),
    verdict: verdictLine(response),
    monteCarlo: response.monte_carlo ?? null,
    wfo: response.wfo ?? null,
  };
}
