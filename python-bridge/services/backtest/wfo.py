"""Walk-forward optimisation as a GATE, plus multiple-comparison correction.

WHAT THIS REPLACES. `routers/vectorbt_router.py:270-288` computes a "Robustness
Plateau" over a 3x3 grid neighbourhood of the best-Sharpe parameter cell, and
labels >= 75% positive neighbours "Robust Green Plateau". That is a useful
heuristic and it is NOT sufficient, for one reason: it conditions on the winner.
The neighbourhood is centred on the best cell, so a strategy that is lucky in one
spot and terrible everywhere else still gets a centred neighbourhood, and the
"plateau" is an artefact of where the search happened to peak.

The legacy optimiser compounded this (blueprint 1.2.3): `run_optimizer.py` ran 35
trials on ONE symbol, sorted on raw PnL rather than its own risk-adjusted score,
accepted a minimum of ONE trade, and wrote the winner into the LIVE ORB config
via main.py:215-223. No correction for having tried 35 things. The best of 35
noisy results is expected to look good even when the underlying edge is absent.

TWO CORRECTIONS APPLIED HERE.

  WFO  Anchored walk-forward. Parameters are chosen on [t0, t1) and evaluated on
       [t1, t2) -- the evaluation window is NEVER seen during selection. The
       legacy code reported the in-sample optimum. `purge_gap` between the
       selection and evaluation windows exists because a feature computed with a
       rolling window leaks across the boundary: without a gap, the last
       `atr_14` values in the selection window use bars from the evaluation
       window.

  MULTIPLICITY  A parameter search is a multiple-comparison problem. Two
       corrections are applied and BOTH must pass:
         - Bonferroni: the significance bar is alpha / n_trials, so 35 trials at
           alpha=0.05 demand p < 0.00143.
         - Deflated Sharpe (Bailey & Lopez de Prado): the expected maximum Sharpe
           from n_trials independent trials given the observed skew and kurtosis.
           A raw Sharpe of 1.8 is unremarkable after searching 35 times; the DSR
           asks how surprising it actually is.

Neither correction can make a strategy good. They can only stop a search from
promoting noise, which is the actual failure mode on record.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import metrics as metrics_mod

log = logging.getLogger("backtest.wfo")

# The legacy plateau thresholds, preserved so the two implementations are comparable.
PLATEAU_GREEN_PCT = 75.0
PLATEAU_MODERATE_PCT = 50.0

# A plausible ceiling on annualised Sharpe. Not a quality bar -- a HIGH Sharpe is
# good -- but an ARTEFACT bar.
#
# A return series with zero volatility has an infinite Sharpe, and neither the
# Bonferroni test nor the Deflated Sharpe can catch that: DSR asks whether the
# Sharpe is surprising given the search, and infinity is maximally surprising, so
# it PASSES. A measured fold Sharpe of 3.6e15 is a straight line being scored as
# a strategy. No real intraday Indian-equity strategy sustains an annualised
# Sharpe above roughly 10, and nothing above this number is a finding.
MAX_PLAUSIBLE_SHARPE = 20.0


class WFOError(RuntimeError):
    """Raised when a walk-forward cannot be performed honestly."""


@dataclass(frozen=True)
class WFOSplit:
    """One anchored fold. `train` selects; `test` only ever scores."""
    fold: int
    train_start: pd.Timestamp
    train_end: pd.Timestamp
    test_start: pd.Timestamp
    test_end: pd.Timestamp

    def as_dict(self) -> dict:
        return {"fold": self.fold, "train_start": self.train_start,
                "train_end": self.train_end, "test_start": self.test_start,
                "test_end": self.test_end}


@dataclass
class WFOResult:
    folds: list[dict] = field(default_factory=list)
    n_folds: int = 0
    n_trials: int = 0
    passed: bool = False
    reasons: list[str] = field(default_factory=list)
    aggregate: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"folds": self.folds, "n_folds": self.n_folds,
                "n_trials": self.n_trials, "passed": self.passed,
                "reasons": self.reasons, "aggregate": self.aggregate}


# ── folds ────────────────────────────────────────────────────────────────────
def anchored_folds(dates: pd.Series, n_folds: int = 4, train_frac: float = 0.5,
                   purge_gap: int = 1) -> list[WFOSplit]:
    """Anchored (expanding-window) folds over unique dates, in date order.

    Anchored, not rolling: every fold's training window starts at the same first
    date, so the strategy is always evaluated on data that is a strict superset
    of what it learned on. That is the honest analogue of a live deployment,
    which never gets to un-learn.

    `purge_gap` is measured in BARS and separates the last training bar from the
    first test bar.
    """
    if n_folds < 2:
        raise WFOError(f"n_folds must be >= 2, got {n_folds}")
    if not (0 < train_frac < 1):
        raise WFOError(f"train_frac must be in (0, 1), got {train_frac}")
    uniq = pd.Series(pd.to_datetime(dates)).drop_duplicates().sort_values().reset_index(drop=True)
    n = len(uniq)
    if n < n_folds * 4:
        raise WFOError(f"only {n} unique dates for {n_folds} folds; need >= {n_folds * 4}")

    first_train = max(2, int(n * train_frac))
    step = (n - first_train) // n_folds
    if step < 1:
        raise WFOError(f"fold step collapsed to {step} bars with {n} dates")

    out: list[WFOSplit] = []
    for k in range(n_folds):
        tr_hi = first_train + k * step
        te_lo = tr_hi + purge_gap
        te_hi = min(te_lo + step, n)
        if te_lo >= n or te_hi <= te_lo:
            break
        out.append(WFOSplit(
            fold=k + 1,
            train_start=uniq.iloc[0],
            train_end=uniq.iloc[tr_hi - 1],
            test_start=uniq.iloc[te_lo],
            test_end=uniq.iloc[te_hi - 1]))
    if len(out) < 2:
        raise WFOError(f"only {len(out)} usable fold(s); a walk-forward needs >= 2")
    return out


# ── legacy plateau, reimplemented and hardened ────────────────────────────────
def robustness_plateau(grid: dict[tuple[int, int], float],
                       best: tuple[int, int]) -> dict:
    """Share of positive Sharpe in the 3x3 neighbourhood of the best cell.

    This is the legacy `vectorbt_router.py:270-288` logic, and the legacy
    thresholds (75% green / 50% moderate) are preserved exactly so the two
    implementations stay comparable.

    WHAT IS ADDED: the full-grid positive share, and the out-of-sample share. A
    centred neighbourhood of a spiky surface can still read "green" while the
    grid as a whole is mostly negative, which is the classic overfit shape. The
    gate requires the OOS share, not the neighbourhood share.
    """
    vals = [v for v in grid.values() if v is not None and np.isfinite(v)]
    if not vals:
        raise WFOError("empty grid; cannot assess robustness")
    df_, ds_ = best
    neigh = []
    for a in (-1, 0, 1):
        for b in (-1, 0, 1):
            v = grid.get((df_ + a, ds_ + b))
            if v is not None and np.isfinite(v):
                neigh.append(float(v))
    if not neigh:
        raise WFOError(f"no finite neighbours around {best}")

    nb_pct = 100.0 * sum(1 for v in neigh if v > 0) / len(neigh)
    all_pct = 100.0 * sum(1 for v in vals if v > 0) / len(vals)
    if nb_pct >= PLATEAU_GREEN_PCT:
        status = "Robust Green Plateau"
    elif nb_pct >= PLATEAU_MODERATE_PCT:
        status = "Moderate Cluster"
    else:
        status = "Isolated Spike (Overfit Risk)"
    return {"neighbourhood_cells": len(neigh),
            "neighbourhood_positive_pct": round(nb_pct, 1),
            "grid_cells": len(vals),
            "grid_positive_pct": round(all_pct, 1),
            "best_sharpe": float(grid[best]),
            "status": status,
            # A green neighbourhood on a mostly-negative grid is the overfit shape.
            "spike_signature": bool(nb_pct >= PLATEAU_GREEN_PCT
                                    and all_pct < PLATEAU_GREEN_PCT)}


# ── multiplicity correction ───────────────────────────────────────────────────
def multiplicity_correction(observed_sharpe: float, n_trials: int, n_obs: int,
                            p_value: float | None = None, alpha: float = 0.05,
                            skew: float = 0.0, kurtosis: float = 3.0) -> dict:
    """Bonferroni and Deflated Sharpe. BOTH must pass.

    `n_trials` is the number of parameter combinations that were evaluated, not
    the number that survived to be reported. Reporting the survivor count is the
    mistake that made a 35-trial search look like a single test.
    """
    if n_trials < 1:
        raise WFOError(f"n_trials must be >= 1, got {n_trials}")
    bonf = metrics_mod.bonferroni_threshold(n_trials, alpha=alpha)
    dsr = metrics_mod.deflated_sharpe_ratio(observed_sharpe, n_trials, n_obs,
                                            skew=skew, kurtosis=kurtosis)
    p = p_value
    out = {
        "observed_sharpe": observed_sharpe,
        "n_trials": n_trials,
        "n_obs": n_obs,
        "alpha": alpha,
        "bonferroni_threshold": bonf,
        "deflated_sharpe": dsr,
        "runs_p_value": p,
    }
    out["bonferroni_pass"] = bool(p is not None and p < bonf)
    out["dsr_pass"] = bool(dsr >= 0.95)
    out["passed"] = bool(out["bonferroni_pass"] and out["dsr_pass"])
    if p is None:
        out["note"] = ("no p-value supplied: Bonferroni could not be evaluated, so "
                       "the gate cannot pass. Omitting a test is not passing it.")
    return out


# ── the gate ─────────────────────────────────────────────────────────────────
@dataclass
class FOLD:
    metrics: dict = field(default_factory=dict)
    n_trades: int = 0
    sharpe: float = float("nan")
    max_dd: float = float("nan")
    net_pnl: float = 0.0


def walk_forward_gate(date_of_trade: pd.Series, equity_by_fold,
                     n_trials: int, alpha: float = 0.05,
                     min_folds_passing: int = 3, min_trades_per_fold: int = 20,
                     runs_p: float | None = None,
                     min_fold_net: float = 0.0) -> WFOResult:
    """Gate a strategy on out-of-sample folds, then correct for having searched.

    `min_folds_passing` is absolute rather than a fraction, so that a 4-fold run
    and a 10-fold run are not silently held to different standards.
    """
    res = WFOResult(n_trials=n_trials)
    sharpes, fold_rows = [], []
    for i, eq in enumerate(equity_by_fold):
        m = metrics_mod.compute_metrics(eq, initial_capital=100_000.0)
        net = float(m.get("total_return_pct", 0.0)) * 1_000.0
        row = {"fold": i + 1, "n_trades": int(m.get("n_trades", 0)),
               "sharpe": round(float(m.get("sharpe", float("nan"))), 4),
               "max_drawdown_pct": round(float(m.get("max_drawdown_pct", float("nan"))), 4),
               "total_return_pct": round(float(m.get("total_return_pct", 0.0)), 4),
               "net_pnl": round(net, 2)}
        fold_rows.append(row)
        sharpes.append(float(m.get("sharpe", float("nan"))))

    clean = [s for s in sharpes if np.isfinite(s)]
    res.folds = fold_rows
    res.n_folds = len(fold_rows)

    if len(clean) < 2:
        res.reasons.append("fewer than 2 folds produced a finite Sharpe")
        res.passed = False
        return res

    mean_sh = float(np.mean(clean))
    n_obs = max(1, sum(max(len(eq) - 1, 0) for eq in equity_by_fold))
    res.aggregate = {
        "n_return_obs": n_obs,
        "mean_fold_sharpe": round(mean_sh, 4),
        "median_fold_sharpe": round(float(np.median(clean)), 4),
        "min_fold_sharpe": round(float(np.min(clean)), 4),
        "std_fold_sharpe": round(float(np.std(clean, ddof=1)), 4) if len(clean) > 1 else 0.0,
        "folds_positive": int(sum(1 for s in clean if s > 0)),
        "folds_meeting_min_trades": int(
            sum(1 for r in fold_rows if r["n_trades"] >= min_trades_per_fold)),
        "folds_positive_net": int(sum(1 for r in fold_rows if r["net_pnl"] > min_fold_net)),
    }

    if res.aggregate["folds_positive"] < min_folds_passing:
        res.reasons.append(
            f"only {res.aggregate['folds_positive']}/{res.n_folds} folds positive; "
            f"require >= {min_folds_passing}")
    if res.aggregate["folds_meeting_min_trades"] < min_folds_passing:
        res.reasons.append(
            f"only {res.aggregate['folds_meeting_min_trades']}/{res.n_folds} folds "
            f"reached {min_trades_per_fold} trades; a fold that thin cannot be scored")

    # Artefact screen, BEFORE the multiplicity corrections. A fold Sharpe far
    # above the plausible ceiling means a degenerate (near-zero-volatility)
    # series, which the Deflated Sharpe would otherwise score as a triumph.
    absurd = [r for r in fold_rows
              if not math.isfinite(r["sharpe"]) or abs(r["sharpe"]) > MAX_PLAUSIBLE_SHARPE]
    if absurd:
        worst = max(abs(r["sharpe"]) for r in absurd)
        res.reasons.append(
            f"fold Sharpe {worst:.3g} exceeds the plausibility ceiling "
            f"{MAX_PLAUSIBLE_SHARPE:g}; this is a near-zero-volatility artefact, "
            f"not an edge")

    # n_obs for the Deflated Sharpe is the number of RETURN observations that
    # produced the Sharpe -- the bars, not the trades. Passing `min_trades_per_fold`
    # here conflated two different units and made DSR collapse to 0 whenever that
    # threshold was low, so a healthy strategy was refused for a bookkeeping slip.
    corr = multiplicity_correction(
        mean_sh, n_trials=n_trials, n_obs=n_obs,
        p_value=runs_p, alpha=alpha)
    res.aggregate["multiplicity"] = corr
    if not corr["bonferroni_pass"]:
        why = corr.get("note", f"p={corr['runs_p_value']} >= {corr['bonferroni_threshold']:.6f}")
        res.reasons.append(f"Bonferroni failed: {why}")
    if not corr["dsr_pass"]:
        res.reasons.append(
            f"Deflated Sharpe {corr['deflated_sharpe']:.4f} < 0.95 after {n_trials} trials")

    res.passed = not res.reasons
    return res
