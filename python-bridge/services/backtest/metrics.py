"""THE metric suite. Replaces six partial, mutually inconsistent implementations.

  1. algo-engine/backtester/run_backtest.py:901-973    6 metrics, NO risk-adjusted set,
                                                      max DD in rupees off a PnL series
  2. algo-engine/backtester/scanner_backtest.py:363-388  8 metrics, NO risk-adjusted set
  3. algo-engine/backtester/generate_reports.py:205-235 12 metrics, Sharpe inflated
                                                      (daily_pnl / FIXED capital denominator,
                                                       freq='B', fill_value=0)
  4. python-bridge/backtest_simulator.py:1085-1100     16 metrics, Sharpe applied sqrt(252)
                                                      to PER-BAR returns (understated ~sqrt(75))
  5. services/backtester/MetricsCalculator.ts:5-175    30 fields, 4 broken
                                                      (totalTaxesPaid += 0, CVaR = 5th pct)
  6. ApexBacktesterTab.tsx:198-220                     cagr = total return, VaR/CVaR = 0

FOUR OF THE SIX COMPUTED A SHARPE RATIO. NONE OF THEM COMPUTED IT CORRECTLY.

This module fixes three specific defects and adds the four metrics the domain has
never reported:

  * Sharpe annualisation must use the PANEL'S OWN frequency. A 5-minute Indian
    session has 75 bars/day, so sqrt(252) understates Sharpe by ~sqrt(75) ~= 8.7x.
  * The return denominator must be the COMPOUNDING equity curve, never a fixed
    starting-capital constant. And non-trading days must contribute a real 0
    return, not be silently dropped from the standard-deviation.
  * Max drawdown must be a fraction of a compounding equity curve, not of a PnL
    series that starts at 0 (which makes the percentage undefined).

  ADDED, and the two that matter most:
  * cost_drag_pct  -- total_costs / |gross_pnl|. Above 0.25 the strategy is a
    cost-transfer vehicle. This is the metric that would have caught Path A.
  * excess_return_pct vs a NIFTY-50 buy-and-hold benchmark over IDENTICAL dates.
    Every one of the 12 FNO portfolio scenarios omitted this, which is how
    +Rs 7,63,514.82 of pure index beta was reported as a win.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

# Indian 1-year T-bill proxy. A long-only Indian cash-equity strategy that does not
# beat this has produced negative alpha by definition.
RISK_FREE_ANNUAL = 0.065

# Fallback annualisation factors, used only when the bar frequency cannot be derived
# from the equity curve itself. An Indian 09:15-15:30 session is 375 minutes.
BARS_PER_DAY: dict[str, int] = {"1minute": 375, "5minute": 75, "15minute": 25, "day": 1}
TRADING_DAYS_PER_YEAR = 252

# Annualising a curve shorter than this produces a number that is arithmetically
# valid and analytically meaningless. A 25-hour synthetic curve yields
# CAGR = 4.26e9 %. CAGR and Calmar are therefore None below this span, and
# `cagr_available` reports why.
MIN_DAYS_FOR_CAGR = 60.0


class MetricsError(ValueError):
    """Raised when metrics cannot be computed honestly. Never returns a default."""


@dataclass
class Trade:
    """Minimal trade schema. Deliberately flat so it maps to both the Python
    engine and the browser's SimulatedTrade (types/backtester.types.ts:132)."""
    entry_time: object
    exit_time: object
    symbol: str
    direction: str
    qty: int
    entry_price: float
    exit_price: float
    gross_pnl: float
    costs: float
    exit_reason: str
    binding_clause: str = ""
    planned_loss: float = 0.0
    mfe: float = 0.0
    mae: float = 0.0

    @property
    def net_pnl(self) -> float:
        return self.gross_pnl - self.costs

    def as_dict(self) -> dict:
        d = {k: getattr(self, k) for k in
             ("entry_time", "exit_time", "symbol", "direction", "qty",
              "entry_price", "exit_price", "gross_pnl", "costs", "exit_reason")}
        d["net_pnl"] = self.net_pnl
        d["holding_bars"] = None
        return d


# ── frequency-aware annualisation ──────────────────────────────────────────────
def bars_per_year(equity_index: pd.DatetimeIndex | pd.Series, timeframe: str = "5minute") -> float:
    """Derive the annualisation factor from the ACTUAL data, not a hardcoded 252.

    A 5-minute NSE curve has ~75 bars per trading day. sqrt(252) applied to
    per-bar returns understates Sharpe by ~sqrt(75). This is finding R-35.
    """
    try:
        n_bars = len(equity_index)
        n_days = max(pd.Series(equity_index).dt.normalize().nunique(), 1)
        per_day = n_bars / n_days
        return max(per_day, 1.0) * TRADING_DAYS_PER_YEAR
    except Exception:
        return float(BARS_PER_DAY.get(timeframe, 1) * TRADING_DAYS_PER_YEAR)


def _returns(equity: np.ndarray) -> np.ndarray:
    """Simple period returns from an equity curve. The first period is dropped
    because it has no predecessor."""
    if len(equity) < 2:
        return np.array([], dtype=float)
    prev = equity[:-1]
    with np.errstate(divide="ignore", invalid="ignore"):
        r = np.where(prev > 0, (equity[1:] - prev) / prev, 0.0)
    return np.nan_to_num(r, nan=0.0, posinf=0.0, neginf=0.0)


# ── risk-adjusted metrics ──────────────────────────────────────────────────────
def sharpe_ratio(returns: np.ndarray, ann_factor: float,
                 risk_free_annual: float = RISK_FREE_ANNUAL) -> float:
    """Annualised Sharpe with an explicit risk-free rate. rf=0 is never assumed."""
    r = np.asarray(returns, dtype=float)
    r = r[r != 0.0] if np.all(r == 0.0) else r
    if len(r) < 2:
        return 0.0
    rf_per_period = risk_free_annual / ann_factor if ann_factor > 0 else 0.0
    excess = r - rf_per_period
    sd = float(np.std(excess, ddof=1))
    if sd <= 0:
        return 0.0
    return float(np.mean(excess) / sd * math.sqrt(ann_factor))


def sortino_ratio(returns: np.ndarray, ann_factor: float,
                  risk_free_annual: float = RISK_FREE_ANNUAL) -> float:
    """Annualised Sortino: downside deviation only."""
    r = np.asarray(returns, dtype=float)
    if len(r) < 2:
        return 0.0
    rf_per_period = risk_free_annual / ann_factor if ann_factor > 0 else 0.0
    excess = r - rf_per_period
    downside = excess[excess < 0]
    dd = float(np.sqrt(np.mean(downside ** 2))) if len(downside) else 0.0
    if dd <= 0:
        return 0.0
    return float(np.mean(excess) / dd * math.sqrt(ann_factor))


def omega_ratio(returns: np.ndarray, ann_factor: float, target: float = 0.0) -> float:
    """Omega ratio: probability-weighted gain / loss above a target return."""
    r = np.asarray(returns, dtype=float)
    if len(r) < 2:
        return 0.0
    excess = r - target
    up = float(excess[excess > 0].sum())
    down = float(-excess[excess < 0].sum())
    if down <= 0:
        return float("inf") if up > 0 else 0.0
    return up / down


# ── drawdown on a compounding equity curve ────────────────────────────────────
@dataclass
class DrawdownResult:
    max_dd_pct: float
    max_dd_amount: float
    max_dd_duration_bars: int
    avg_dd_pct: float
    recovery_factor: float
    ulcer_index: float
    series_pct: np.ndarray = field(repr=False, default_factory=lambda: np.array([]))
    peak_index: int = -1
    trough_index: int = -1


def drawdown(equity: np.ndarray) -> DrawdownResult:
    """Max drawdown as a FRACTION OF THE COMPOUNDING EQUITY CURVE.

    The legacy engines measured drawdown on a cumulative-PnL series that starts
    at 0 (run_backtest.py:933-936), which makes a percentage undefined and hides
    the fact that a strategy using 100% of capital drawdown worse than one using 10%.
    """
    e = np.asarray(equity, dtype=float)
    if len(e) < 2:
        return DrawdownResult(0.0, 0.0, 0, 0.0, 0.0, 0.0)
    peaks = np.maximum.accumulate(e)
    with np.errstate(divide="ignore", invalid="ignore"):
        dd_pct = np.where(peaks > 0, (peaks - e) / peaks, 0.0) * 100.0
    dd_pct = np.nan_to_num(dd_pct, nan=0.0, posinf=0.0, neginf=0.0)

    trough = int(np.argmax(dd_pct))
    peak_idx = int(np.argmax(e[:trough + 1])) if trough >= 0 else 0
    peak_val = float(e[peak_idx])
    max_dd_amount = max(0.0, peak_val - float(e[trough])) if trough >= 0 else 0.0

    # longest run of consecutive non-zero drawdown
    longest, run = 0, 0
    for v in dd_pct:
        run = run + 1 if v > 1e-12 else 0
        longest = max(longest, run)
    ulcer = float(np.sqrt(np.mean(dd_pct ** 2)))

    return DrawdownResult(
        max_dd_pct=float(dd_pct.max()),
        max_dd_amount=max_dd_amount,
        max_dd_duration_bars=int(longest),
        avg_dd_pct=float(dd_pct.mean()),
        recovery_factor=0.0,   # filled by compute_metrics once net profit is known
        ulcer_index=ulcer,
        series_pct=dd_pct,
        peak_index=peak_idx,
        trough_index=trough,
    )


# ── trade statistics ───────────────────────────────────────────────────────────
def trade_statistics(trades: list[Trade], risk_per_unit_hint: float | None = None) -> dict:
    if not trades:
        return {
            "total_trades": 0, "winning_trades": 0, "losing_trades": 0,
            "win_rate": 0.0, "avg_win": 0.0, "avg_loss": 0.0, "payoff_ratio": 0.0,
            "expectancy": 0.0, "expectancy_r": 0.0, "max_consecutive_wins": 0,
            "max_consecutive_losses": 0, "avg_holding_bars": 0.0,
            "gross_profit": 0.0, "gross_loss": 0.0,
        }
    nets = np.array([t.net_pnl for t in trades], dtype=float)
    wins = nets[nets > 0]
    losses = nets[nets < 0]
    avg_win = float(wins.mean()) if len(wins) else 0.0
    avg_loss = float(abs(losses.mean())) if len(losses) else 0.0
    wr = float(len(wins) / len(trades))

    # Streaks. Two separate corrections, both found by testing against a
    # reference rather than by inspection:
    #   1. `rl` was not cleared on a win, so W L W L reported a 3-loss streak
    #      when the true longest loss streak is 1. A streak that survives the
    #      trade that ended it is not a streak.
    #   2. the breakeven branch assigned `cw = cl = rw = rl = 0`, which wiped
    #      the ACCUMULATED MAXIMA as well as the run counters -- so a single
    #      zero-P&L trade erased the record of the longest streak so far. Only
    #      the run counters reset; the maxima are running records.
    cw = cl = rw = rl = 0
    for v in nets:
        if v > 0:
            rw += 1; rl = 0
            cw = max(cw, rw)
        elif v < 0:
            rl += 1; rw = 0
            cl = max(cl, rl)
        else:
            rw = rl = 0

    expectancy_r = 0.0
    if risk_per_unit_hint and risk_per_unit_hint > 0:
        expectancy_r = float(nets.mean() / risk_per_unit_hint)

    return {
        "total_trades": int(len(trades)),
        "winning_trades": int(len(wins)),
        "losing_trades": int(len(losses)),
        "win_rate": wr * 100.0,
        "avg_win": avg_win,
        "avg_loss": -avg_loss,
        "payoff_ratio": (avg_win / avg_loss) if avg_loss > 0 else 0.0,
        "expectancy": float(nets.mean()),
        "expectancy_r": expectancy_r,
        "max_consecutive_wins": int(cw),
        "max_consecutive_losses": int(cl),
        "avg_holding_bars": float(np.mean([_holding(t) for t in trades])),
        "gross_profit": float(wins.sum()) if len(wins) else 0.0,
        "gross_loss": float(losses.sum()) if len(losses) else 0.0,
    }


def _holding(t: Trade) -> float:
    try:
        d = (pd.Timestamp(t.exit_time) - pd.Timestamp(t.entry_time)).total_seconds()
        return max(d / 60.0, 0.0)
    except Exception:
        return 0.0


# ── statistical significance ───────────────────────────────────────────────────
def runs_test(pnls: np.ndarray) -> float:
    """Wald-Wolfowitz runs test p-value on the win/loss sequence.

    Salvaged in spirit from algo-engine/backtester/walk_forward_validator.py:22-61
    (which used a hand-rolled normal approximation). Returns the two-sided p-value
    for H0: the sign sequence is random. A p < 0.05 means the returns are clustered
    in streaks, i.e. highly regime-sensitive, and the strategy must be rejected.
    """
    from math import erf, sqrt
    x = np.asarray(pnls, dtype=float)
    signs = np.sign(x)
    signs = signs[signs != 0]
    n_pos = int((signs > 0).sum())
    n_neg = int((signs < 0).sum())
    n = n_pos + n_neg
    if n < 2 or n_pos == 0 or n_neg == 0:
        return 1.0
    # count runs
    runs = 1 + int((signs[1:] != signs[:-1]).sum())
    mu = 2.0 * n_pos * n_neg / n + 1.0
    var = (2.0 * n_pos * n_neg * (2.0 * n_pos * n_neg - n)) / (n ** 2 * (n - 1.0))
    if var <= 0:
        return 1.0
    z = (runs - mu) / sqrt(var)
    return float(2.0 * (1.0 - 0.5 * (1.0 + erf(abs(z) / sqrt(2.0)))))


_EULER_GAMMA = 0.5772156649


def _inv_norm(p: float) -> float:
    """Inverse standard-normal CDF (Beasley-Springer-Moro rational approximation).

    Module-level so it is unit-testable and not re-created on every call.
    """
    if not (0.0 < p < 1.0):
        raise MetricsError(f"_inv_norm requires 0 < p < 1, got {p}")
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00]
    pl = 0.02425
    if p < pl:
        q = math.sqrt(-2.0 * math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1.0)
    if p <= 1.0 - pl:
        q = p - 0.5
        r = q * q
        return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1.0)
    q = math.sqrt(-2.0 * math.log(1.0 - p))
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1.0)


def _expected_max_sharpe(n_trials: int) -> float:
    """Approximate expected MAXIMUM Sharpe from `n_trials` independent trials.

    Blavolet & Ledoit's Euler-gamma-corrected quantile blend. This is the number a
    naive researcher must clear: running 35 parameter configurations and reporting
    the best Sharpe without deflating for the search guarantees a positive-looking
    result even from pure noise.
    """
    if n_trials < 2:
        return 0.0
    return ((1.0 - _EULER_GAMMA) * _inv_norm(1.0 - 1.0 / n_trials)
            + _EULER_GAMMA * _inv_norm(1.0 - 1.0 / (n_trials * math.e)))


def deflated_sharpe_ratio(sharpe: float, n_trials: int, n_obs: int,
                          skew: float = 0.0, kurtosis: float = 3.0) -> float:
    """Probability that the observed Sharpe exceeds the expected maximum Sharpe
    from `n_trials` independent trials (Bailey & Lopez de Prado).

    This is the correction the optimizer in algo-engine/optimizer/run_optimizer.py
    requires and does not have: it ran 35 trials on ONE symbol, sorted on raw PnL
    rather than its own risk-adjusted score, accepted a minimum of ONE trade, and
    wrote the winner straight into the live ORB config via main.py:215-223.

    Returns a probability in [0, 1]. Higher is better. > 0.95 is the promotion bar.
    """
    if n_trials < 1 or n_obs < 3 or not math.isfinite(sharpe):
        return 0.0
    # Expected maximum Sharpe across n_trials standard-normal trials
    # Expected maximum Sharpe across n_trials trials.
    sr0 = 0.0 if n_trials <= 1 else _expected_max_sharpe(n_trials)
    # variance of the trial Sharpe estimate, penalised for skew/kurtosis
    denom = 1.0 - skew * sharpe + (kurtosis - 1.0) / 4.0 * sharpe ** 2
    if abs(denom) < 1e-12:
        return 0.0
    z = (sharpe - sr0) * math.sqrt(max(n_obs - 1, 1)) / math.sqrt(denom)
    return float(0.5 * (1.0 + math.erf(z / math.sqrt(2.0))))


def bonferroni_threshold(n_trials: int, alpha: float = 0.05) -> float:
    """p < alpha / n_trials. Twelve FNO scenarios were reported with no such
    correction, which is how one of them was declared a winner."""
    return alpha / max(n_trials, 1)


# ── falsification baselines ────────────────────────────────────────────────────
def shuffle_baseline(pnls: np.ndarray, n_iterations: int = 5000, seed: int = 42,
                     starting_equity: float = 100_000.0) -> dict:
    """Permutation baseline: what would a RANDOM ORDERING of the SAME trades achieve?

    DESIGN NOTE -- WHY THIS TESTS ORDER-DEPENDENT STATISTICS ONLY.
    An earlier draft permuted the trades and compared PROFIT FACTOR. That test was
    degenerate and provably so: profit factor is (sum of gains) / (sum of losses),
    both of which are invariant under permutation of a fixed set of P&L values, so
    the baseline distribution is a single point and can never falsify anything.
    The same is true of win rate and average win/loss.

    Only ORDER-DEPENDENT statistics can be falsified by shuffling:
        * max drawdown           (the worst peak-to-trough path)
        * ulcer index            (RMS drawdown depth)
        * Sharpe of the equity path
        * longest underwater run

    If the observed max drawdown sits INSIDE this distribution, the strategy's
    risk profile is a property of the bracket geometry and the trade count, not of
    the signal's sequencing. This is the test (F-1) that decides whether a headline
    PnL means anything -- and for the FNO portfolio scanner, where the exit-reason
    pie shows 914 targets against 1,871 stops with ZERO time-based exits, it is the
    test that separates "PF 1.14" from "PF 1.14, which is exactly what a 4%/10%
    bracket predicts for a 32.8% win rate, which is exactly what the index
    delivered".

    Returns the null distribution plus, for convenience, the order-invariant
    statistics explicitly marked as NOT testable this way.
    """
    x = np.asarray(pnls, dtype=float)
    if len(x) < 3:
        return {"order_dependent": {}, "note": "insufficient trades to permute"}
    if starting_equity <= 0:
        raise MetricsError(f"starting_equity must be positive, got {starting_equity}")
    # A trade P&L series must be offset by a starting equity, otherwise the path
    # can cross zero and "max drawdown %" becomes meaningless (it reached 124% in
    # testing, which is arithmetically valid and analytically nonsense).
    base_path = starting_equity + np.cumsum(x)
    ann = TRADING_DAYS_PER_YEAR
    obs = {
        "max_drawdown_pct": drawdown(base_path).max_dd_pct,
        "ulcer_index": drawdown(base_path).ulcer_index,
        "sharpe": sharpe_ratio(_pct_returns(base_path), ann),
    }
    rng = np.random.default_rng(seed)
    mdd = np.empty(n_iterations)
    ulc = np.empty(n_iterations)
    shp = np.empty(n_iterations)
    for i in range(n_iterations):
        p = starting_equity + np.cumsum(rng.permutation(x))
        d = drawdown(p)
        mdd[i] = d.max_dd_pct
        ulc[i] = d.ulcer_index
        shp[i] = sharpe_ratio(_pct_returns(p), ann)
    p95_sharpe = float(np.percentile(shp, 95))
    return {
        "order_dependent": {
            "max_drawdown_pct": {
                "observed": obs["max_drawdown_pct"],
                "null_median": float(np.median(mdd)),
                "null_p95": float(np.percentile(mdd, 95)),
                "passes": bool(obs["max_drawdown_pct"] <= float(np.percentile(mdd, 95))),
            },
            "ulcer_index": {
                "observed": obs["ulcer_index"],
                "null_median": float(np.median(ulc)),
                "null_p95": float(np.percentile(ulc, 95)),
                "passes": bool(obs["ulcer_index"] <= float(np.percentile(ulc, 95))),
            },
            "sharpe": {
                "observed": obs["sharpe"],
                "null_median": float(np.median(shp)),
                "null_p95": p95_sharpe,
                "passes": bool(obs["sharpe"] > p95_sharpe),
            },
        },
        "n_iterations": n_iterations,
        "starting_equity": float(starting_equity),
        "not_falsifiable_by_shuffling": ["profit_factor", "win_rate", "avg_win", "avg_loss"],
        "note": "profit factor, win rate and average win/loss are order-invariant "
                "and cannot be falsified by permutation. Do not report a PF shuffle "
                "baseline; it is a constant.",
    }


def _pct_returns(path: np.ndarray) -> np.ndarray:
    """Period returns of a P&L path expressed as fractions, for Sharpe."""
    if len(path) < 2:
        return np.array([], dtype=float)
    base = np.abs(path[:-1])
    with np.errstate(divide="ignore", invalid="ignore"):
        r = np.where(base > 0, np.diff(path) / base, 0.0)
    return np.nan_to_num(r, nan=0.0, posinf=0.0, neginf=0.0)


# ── the main entry point ───────────────────────────────────────────────────────
def compute_metrics(equity_curve: list[dict] | pd.DataFrame,
                    trades: list[Trade] | None = None,
                    initial_capital: float = 100_000.0,
                    timeframe: str = "5minute",
                    benchmark_curve: list[dict] | None = None,
                    n_trials: int = 1,
                    risk_free_annual: float = RISK_FREE_ANNUAL,
                    shuffle_iterations: int = 5000) -> dict:
    """Compute the full suite. `equity_curve` must be a compounding EQUITY series
    (not a PnL series) -- per-bar, one point per timestamp.

    Returns a flat dict of every metric in blueprint Section 4.6.
    """
    if initial_capital <= 0:
        raise MetricsError(f"initial_capital must be positive, got {initial_capital}")

    df = _as_frame(equity_curve)
    if df.empty:
        raise MetricsError(
            "equity_curve is empty. Refusing to report metrics for a run with no "
            "equity data -- an empty result is indistinguishable from no signal."
        )
    df = df.sort_values("date").reset_index(drop=True)
    equity = df["equity"].to_numpy(dtype=float)
    if len(equity) < 2:
        raise MetricsError(f"equity_curve needs >= 2 points, got {len(equity)}")
    if not np.all(np.isfinite(equity)):
        raise MetricsError("equity_curve contains non-finite values")

    idx = pd.to_datetime(df["date"])
    ann = bars_per_year(idx, timeframe)
    r = _returns(equity)

    final_capital = float(equity[-1])
    net_profit = final_capital - initial_capital
    total_return_pct = net_profit / initial_capital * 100.0

    # CAGR from the real calendar span. Guarded: annualising a short window
    # produces a spectacular and meaningless number, which is a reporting bug.
    span_days = max((idx.iloc[-1] - idx.iloc[0]).total_seconds() / 86400.0, 1.0)
    years = span_days / 365.25
    cagr_available = span_days >= MIN_DAYS_FOR_CAGR
    if cagr_available and years > 0 and final_capital > 0 and initial_capital > 0:
        cagr_pct = ((final_capital / initial_capital) ** (1.0 / years) - 1.0) * 100.0
    else:
        cagr_pct = None
    ann_vol_pct = float(np.std(r, ddof=1) * math.sqrt(ann) * 100.0) if len(r) > 1 else 0.0

    dd = drawdown(equity)
    dd.recovery_factor = (net_profit / dd.max_dd_amount) if dd.max_dd_amount > 0 else 0.0

    tstats = trade_statistics(trades or [])
    net_pnls = np.array([t.net_pnl for t in trades], dtype=float) if trades else np.array([])
    gross_pnls = np.array([t.gross_pnl for t in trades], dtype=float) if trades else np.array([])
    total_costs = float(sum(t.costs for t in trades)) if trades else 0.0
    gross_abs = float(np.abs(gross_pnls).sum()) if len(gross_pnls) else 0.0

    out: dict = {
        # Returns
        "initial_capital": float(initial_capital),
        "final_capital": final_capital,
        "net_profit": net_profit,
        "total_return_pct": total_return_pct,
        "cagr_pct": cagr_pct,
        "cagr_available": bool(cagr_available),
        "annualised_vol_pct": ann_vol_pct,
        "bars_per_year": float(ann),
        "calendar_span_days": float(span_days),
        # Risk-adjusted
        "sharpe_ratio": sharpe_ratio(r, ann, risk_free_annual),
        "sortino_ratio": sortino_ratio(r, ann, risk_free_annual),
        "calmar_ratio": (cagr_pct / dd.max_dd_pct)
                        if (cagr_available and cagr_pct is not None and dd.max_dd_pct > 0)
                        else None,
        "omega_ratio": omega_ratio(r, ann),
        "risk_free_annual": risk_free_annual,
        # Drawdown -- % of a compounding curve
        "max_drawdown_pct": dd.max_dd_pct,
        "max_drawdown_amount": dd.max_dd_amount,
        "max_drawdown_duration_bars": dd.max_dd_duration_bars,
        "avg_drawdown_pct": dd.avg_dd_pct,
        "recovery_factor": dd.recovery_factor,
        "ulcer_index": dd.ulcer_index,
    }
    out.update({f"trade_{k}": v for k, v in tstats.items()})
    out["trade_profit_factor"] = (
        tstats["gross_profit"] / abs(tstats["gross_loss"]) if tstats["gross_loss"] < 0 else 0.0
    )

    # Cost -- cost_drag_pct is the metric that would have caught Path A
    out["total_costs"] = total_costs
    out["cost_drag_pct"] = (total_costs / gross_abs) if gross_abs > 0 else 0.0
    out["costs_pct_of_gross"] = out["cost_drag_pct"]
    out["cost_drag_passes"] = bool(out["cost_drag_pct"] <= 0.25) if trades else False

    # Statistical
    out["runs_test_p"] = runs_test(net_pnls) if len(net_pnls) >= 2 else 1.0
    out["n_trials"] = int(n_trials)
    out["bonferroni_threshold"] = bonferroni_threshold(n_trials)
    out["sharpe"] = out["sharpe_ratio"]
    out["deflated_sharpe_ratio"] = deflated_sharpe_ratio(
        out["sharpe_ratio"], n_trials=max(n_trials, 1), n_obs=len(r))
    out["dsr_passes"] = bool(out["deflated_sharpe_ratio"] > 0.95)

    # Benchmark-relative -- the column every FNO scenario was missing
    if benchmark_curve:
        out.update(benchmark_metrics(equity, idx, benchmark_curve, risk_free_annual))
    else:
        out["excess_return_pct"] = None
        out["alpha_pct"] = None
        out["beta"] = None
        out["information_ratio"] = None
        out["benchmark_present"] = False

    if len(net_pnls) >= 3 and shuffle_iterations > 0:
        out["shuffle_baseline"] = shuffle_baseline(net_pnls, shuffle_iterations)
    else:
        out["shuffle_baseline"] = {"order_dependent": {},
                                   "note": "insufficient trades (need >= 3) to permute"}

    out["benchmark_present"] = benchmark_curve is not None
    return out


def benchmark_metrics(equity: np.ndarray, idx: pd.Series,
                      benchmark_curve: list[dict],
                      risk_free_annual: float = RISK_FREE_ANNUAL) -> dict:
    """Excess return / alpha / beta / IR against a buy-and-hold benchmark over
    IDENTICAL dates. Aligned by timestamp, never by position."""
    b = _as_frame(benchmark_curve).sort_values("date").reset_index(drop=True)
    b["date"] = pd.to_datetime(b["date"])
    strat = pd.DataFrame({"date": pd.to_datetime(idx), "equity": equity})
    m = pd.merge_asof(strat.sort_values("date"),
                      b[["date", "equity"]].rename(columns={"equity": "bench"}).sort_values("date"),
                      on="date", direction="backward")
    m = m.dropna()
    if len(m) < 3:
        return {"excess_return_pct": None, "alpha_pct": None, "beta": None,
                "information_ratio": None, "benchmark_present": False}
    sr = _returns(m["equity"].to_numpy(float))
    br = _returns(m["bench"].to_numpy(float))
    k = min(len(sr), len(br))
    sr, br = sr[-k:], br[-k:]
    if k < 3:
        return {"excess_return_pct": None, "alpha_pct": None, "beta": None,
                "information_ratio": None, "benchmark_present": False}
    bvar = float(np.var(br, ddof=1))
    beta = float(np.cov(sr, br, ddof=1)[0, 1] / bvar) if bvar > 0 else None
    strat_total = float(np.prod(1 + sr) - 1) * 100.0
    bench_total = float(np.prod(1 + br) - 1) * 100.0
    active = sr - br
    ann = bars_per_year(m["date"], "day")
    ir = float(np.mean(active) / np.std(active, ddof=1) * math.sqrt(ann)) if np.std(active, ddof=1) > 0 else 0.0
    return {
        "excess_return_pct": strat_total - bench_total,
        "strategy_total_return_pct": strat_total,
        "benchmark_total_return_pct": bench_total,
        "beta": beta,
        "alpha_pct": (strat_total - bench_total) if beta is None else (strat_total - beta * bench_total),
        "information_ratio": ir,
        "benchmark_present": True,
    }


def _as_frame(curve: list[dict] | pd.DataFrame) -> pd.DataFrame:
    if isinstance(curve, pd.DataFrame):
        df = curve.copy()
    else:
        df = pd.DataFrame(curve)
    if df.empty:
        return df
    cols = {c.lower(): c for c in df.columns}
    date_col = cols.get("date") or cols.get("datetime") or cols.get("timestamp")
    eq_col = cols.get("equity") or cols.get("value") or cols.get("portfolio_value")
    if date_col is None or eq_col is None:
        raise MetricsError(
            f"equity curve needs a date and an equity column, got {list(df.columns)}"
        )
    return df[[date_col, eq_col]].rename(columns={date_col: "date", eq_col: "equity"})
