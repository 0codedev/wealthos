/**
 * VectorbtBacktestService — typed client for the v2 backtest engine.
 *
 * WHAT THIS REPLACES. The UI previously called `/api/vectorbt/optimize` and
 * rendered whatever grid cell came back, then displayed a "ML Fit Test" card
 * that reported "✅ VALID EDGE" with a p-value of 0.020 whenever no fit result
 * was present (PerformanceReport.tsx:99-100). The number was a `?? 0.02`
 * fallback: the UI invented passing statistical evidence for a strategy that had
 * never been tested. The endpoint this service calls returns a real
 * `FalsificationGate` with a `promotable` boolean instead.
 *
 * ERROR HANDLING. Every call returns `SafeResult<T>` from `utils/safeAsync`, so
 * a caller does `if (!res.ok) return;` and the user already has a toast with a
 * "Copy details" action. There is no `window.alert` and no bare try/catch in any
 * consumer. Errors carry the HTTP status so `safeAsync` can categorise a 422 as
 * a validation problem rather than a generic failure.
 *
 * PAYLOAD SIZING. A full run over the real panel returns ~1.9 MB: 500 trade
 * previews and a subsampled equity curve. `trades` is a PREVIEW, truncated by
 * the server. `runtime` carries the authoritative totals over all trades, and
 * this module surfaces both so a consumer cannot sum the truncated list and
 * report a different number from the one the gate was decided on.
 */
import { safeAsync, type SafeResult } from '../utils/safeAsync';
import { logger } from './Logger';

const BASE = '/api/python-nse/api/backtest/v2';

/** The ten falsification gates, in engine order. Mirrors `types.GATE_NAMES`. */
export const GATE_NAMES = [
  'has_min_trades',
  'positive_expectancy',
  'survives_costs',
  'sharpe_above_threshold',
  'max_dd_within_budget',
  'oos_folds_positive',
  'passes_bonferroni',
  'passes_dsr',
  'mc_tail_within_bound',
  'not_overfit_plateau',
] as const;

export type GateName = (typeof GATE_NAMES)[number];

/** Plain labels. A gate name is an implementation detail; this is the UI copy. */
export const GATE_LABELS: Record<GateName, string> = {
  has_min_trades: 'Enough trades to be meaningful',
  positive_expectancy: 'Net profit after all costs',
  survives_costs: 'Edge survives statutory charges',
  sharpe_above_threshold: 'Sharpe clears the bar',
  max_dd_within_budget: 'Drawdown within budget',
  oos_folds_positive: 'Profitable out-of-sample folds',
  passes_bonferroni: 'Survives multiple-comparison correction',
  passes_dsr: 'Deflated Sharpe holds up',
  mc_tail_within_bound: 'Monte Carlo tail within bound',
  not_overfit_plateau: 'Not an isolated overfit spike',
};

/** Why a gate exists, shown as the panel's subtitle. Not decoration. */
export const GATE_WHY: Record<GateName, string> = {
  has_min_trades: 'A handful of trades cannot be scored.',
  positive_expectancy: 'Total P&L after costs must be positive.',
  survives_costs: 'An edge that only exists gross is not tradeable.',
  sharpe_above_threshold: 'Return per unit of volatility.',
  max_dd_within_budget: 'A strategy that can lose 90% is not a strategy.',
  oos_folds_positive: 'Walk-forward folds the strategy never saw during selection.',
  passes_bonferroni: 'Searching N parameters and keeping the best is a multiple-comparison problem.',
  passes_dsr: 'The Sharpe expected from the best of N tries, given skew and kurtosis.',
  mc_tail_within_bound: 'p95 of the drawdown distribution, not the mean.',
  not_overfit_plateau: 'A green neighbourhood on a mostly-negative grid is a spike.',
};

export interface BacktestRequest {
  strategy: 'orb' | 'squeeze' | 'vwap' | 'gap' | 'mtf' | 'snap' | 'zscore';
  symbols: string[];
  timeframe?: '5minute' | '15minute' | 'day';
  capital?: number;

  risk_pct?: number;
  leverage?: number;
  max_concurrent?: number;
  r_mult?: number;
  lot_size?: number;
  date_from?: string;
  date_to?: string;
  apply_costs?: boolean;
  volume_veto?: boolean;
  n_folds?: number;
  purge_bars?: number;
  /**
   * Number of parameter combinations SEARCHED, not survivors. Drives the
   * Bonferroni and Deflated-Sharpe corrections. Default 1 means "no search",
   * which is the honest value for a single fixed-parameter run.
   */
  n_param_trials?: number;
  mc_iterations?: number;
  mc_block_size?: number;
  min_trades?: number;
  alpha?: number;
}

export type FalsificationGate = {
  [K in GateName]: boolean;
} & {
  promotable: boolean;
  n_passed: number;
  n_failed: number;
  failed_gates: GateName[];
  evidence: Record<string, unknown>;
}

export interface TradePreview {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  qty: number;
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  gross_pnl: number;
  costs: number;
  net_pnl: number;
  exit_reason: 'STOP' | 'TARGET' | 'EOD' | string;
  realised_r: number;
  binding_clause: string;
  gap_through_stop: boolean;
  atr_governed: boolean;
  score: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
  cash: number;
  open_positions: number;
}

export interface BacktestResponse {
  strategy: string;
  symbols: string[];
  capital: number;
  config: Record<string, number | boolean>;
  viability: {
    atr_floor_pct: number;
    friction_hurdle_pct: number;
    hurdle_multiple: number;
    meets_3_5x_hurdle: boolean;
    risk_implied_notional_x: number;
    slot_gross_pct: number;
    leverage: number;
    buying_power: number;
    risk_budget: number;
  };
  diagnostics: Record<string, unknown> & {
    candidates?: number;
    trades?: number;
    max_concurrent?: number;
    max_concurrent_observed?: number;
    concurrency_ceiling_respected?: boolean;
    overnight_trades?: number;
    brackets_atr_governed?: number;
    brackets_floored?: number;
  };
  metrics: Record<string, number | null>;
  wfo: {
    passed: boolean;
    n_folds?: number;
    reasons?: string[];
    aggregate?: Record<string, number | boolean | null> & {
      folds_positive?: number;
      mean_fold_sharpe?: number;
      n_return_obs?: number;
      multiplicity?: {
        bonferroni_threshold?: number;
        bonferroni_pass?: boolean;
        deflated_sharpe?: number;
        dsr_pass?: boolean;
        n_trials?: number;
        observed_sharpe?: number;
      };
    };
  };
  monte_carlo: {
    passed: boolean;
    resample?: string;
    n_iterations?: number;
    stats?: {
      prob_ruin?: number;
      prob_loss?: number;
      final_equity?: Record<string, number>;
    };
    max_dd_distribution?: {
      mean_pct: number;
      median_pct: number;
      p90_pct: number;
      p95_pct: number;
      p99_pct: number;
      max_pct: number;
      tail_bound_pct: number;
    };
    reasons?: string[];
  };
  gate: FalsificationGate;
  /** PREVIEW, truncated server-side. Use `runtime` totals for real figures. */
  trades: TradePreview[];
  equity_curve: EquityPoint[];
  runtime: {
    seconds: number;
    rows: number;
    trades_total: number;
    trades_returned: number;
    trades_truncated: boolean;
    equity_points_total: number;
    equity_points_returned: number;
    net_pnl_total: number;
    gross_pnl_total: number;
    costs_total: number;
  };
}

export interface EngineHealth {
  status: string;
  engine: string;
  strategies: string[];
  gates: string[];
  thresholds: { sharpe: number; max_dd_pct: number; mc_tail_p95_pct: number };
  atr_floor_pct: number;
  friction_hurdle_pct: number;
}

export interface CostTables {
  asset_class: string;
  default_slippage_bps: number;
  delivery: Record<string, number>;
  min_viable_target_pct: number;
}

class BridgeError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
  }
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    // Surface the server's own `detail` when present; a bare status code tells
    // the user nothing actionable.
    let detail = `Backtest engine error ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      /* non-JSON error body; the status is all we have */
    }
    throw new BridgeError(detail, response.status);
  }
  return (await response.json()) as T;
}

/** Cheap liveness probe. Does not touch the panel, so it cannot fail on data. */
export async function getEngineHealth(): Promise<SafeResult<EngineHealth>> {
  return safeAsync(() => getJson<EngineHealth>('/health'), {
    context: 'VectorbtBacktestService.health',
    title: 'Backtest engine unreachable',
  });
}

/**
 * Statutory cost tables, served by the engine.
 *
 * T6.5: these were previously duplicated as hardcoded client-side constants in
 * the UI, which is how the options-STT rate drifted out of sync with the engine
 * and started charging 0.125% instead of 0.0625%. One source, fetched.
 */
export async function getCostTables(
  assetClass = 'EQ',
): Promise<SafeResult<CostTables>> {
  return safeAsync(
    () => getJson<CostTables>(`/costs/${encodeURIComponent(assetClass)}`),
    { context: 'VectorbtBacktestService.costs', title: 'Could not load cost tables' },
  );
}

export async function runBacktest(
  request: BacktestRequest,
): Promise<SafeResult<BacktestResponse>> {
  return safeAsync(
    () =>
      getJson<BacktestResponse>('/run', {
        method: 'POST',
        body: JSON.stringify(request),
      }),
    {
      context: 'VectorbtBacktestService.run',
      title: 'Backtest failed',
      actionLabel: 'Retry',
      onAction: () => {
        void runBacktest(request);
      },
    },
  );
}

/**
 * A run that could not be scored must never read as a pass.
 *
 * A type predicate rather than a plain boolean, so a consumer that has checked
 * `isScored(run)` gets `run` narrowed to non-null and does not have to re-check.
 */
export function isScored(run: BacktestResponse | null): run is BacktestResponse {
  if (!run) return false;
  return run.gate != null && typeof run.gate.promotable === 'boolean';
}

/**
 * One-line verdict for the header. States the count and names the blocker
 * rather than collapsing to a colour, because "not promotable" with a reason is
 * the whole point of the gate.
 */
export function verdictLine(run: BacktestResponse | null): string {
  if (!isScored(run)) return 'Not yet run';
  const { n_passed, n_failed, failed_gates } = run.gate;
  if (run.gate.promotable) return `Promotable — all ${n_passed} gates passed`;
  if (n_failed === 1) {
    const only = failed_gates[0];
    return `Not promotable — ${GATE_LABELS[only]?.toLowerCase() ?? only} failed`;
  }
  return `Not promotable — ${n_failed} of ${n_passed + n_failed} gates failed`;
}

logger.debug('VectorbtBacktestService loaded', { base: BASE }, 'VectorbtBacktestService');
