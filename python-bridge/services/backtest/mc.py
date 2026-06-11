"""Monte Carlo on RETURNS, plus the max-drawdown distribution.

WHY RETURNS AND NOT RUPEES. The legacy bootstrap
`algo-engine/backtester/bootstrap_tester.py` resampled TRADE P&L amounts and
replayed them against a fixed starting capital. That is only valid if the rupee
size of every trade is independent of the sequence, which it is not: this engine
sizes every position off the SAME risk budget regardless of the equity level, so
a drawdown mechanically shrinks subsequent rupee stakes. Replaying fixed rupee
magnitudes therefore reports a smoother equity path than the strategy can produce
and understates the tail. Resampling RETURN series preserves the compounding
relationship and lets position size follow equity the way it actually does.

The 5,000-iteration bootstrap in `metrics.shuffle_baseline` remains the
order-invariant test of ORDER DEPENDENCE (max DD, ulcer, Sharpe). This module is
the complementary test of DISTRIBUTIONAL stability: what range of outcomes does
this return series admit?

THE MAX-DRAWDOWN DISTRIBUTION. The blueprint promised one and no legacy module
delivered it. Mean drawdown is a poor summary of a drawdown distribution: a
strategy with a median 4% max-DD and a 40% tail is a different product from one
with a flat 5%, and only the second number is in the existing reports. Here the
whole distribution is returned, so the UI can show p50/p90/p95/max and the
promotion gate can require a TAIL bound rather than a mean.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

log = logging.getLogger("backtest.mc")

# The tail bound a candidate must clear to be promotable.
TAIL_DD_PCT = 0.25          # p95 of max drawdown must not exceed 25%
TAIL_DD_PCT_HARD = 0.40     # absolute veto, no exceptions


class MonteCarloError(RuntimeError):
    """Raised when a bootstrap cannot be performed honestly."""


@dataclass
class MCResult:
    n_iterations: int = 0
    n_obs: int = 0
    resample: str = "returns"
    stats: dict = field(default_factory=dict)
    max_dd_distribution: dict = field(default_factory=dict)
    quantiles: dict = field(default_factory=dict)
    passed: bool = False
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"n_iterations": self.n_iterations, "n_obs": self.n_obs,
                "resample": self.resample, "stats": self.stats,
                "max_dd_distribution": self.max_dd_distribution,
                "quantiles": self.quantiles, "passed": self.passed,
                "reasons": self.reasons}


def to_returns(equity_curve, initial_capital: float = 100_000.0) -> np.ndarray:
    """Period returns from a time-ordered equity curve.

    A curve that is flat produces zeros, and zeros are legitimate: this engine
    holds no position on most bars. They must NOT be dropped, or the volatility
    of the invested periods is overstated. The curve is sorted by time first --
    the panel arrives in symbol blocks, and an unsorted diff would produce
    nonsense returns at every block boundary.
    """
    if len(equity_curve) < 3:
        raise MonteCarloError(f"need >= 3 curve points, got {len(equity_curve)}")
    if isinstance(equity_curve, pd.DataFrame):
        if "date" in equity_curve.columns:
            s = equity_curve.sort_values("date")
        else:
            s = equity_curve
        eq = s["equity"].to_numpy(float)
    else:
        rows = sorted(equity_curve, key=lambda r: pd.Timestamp(r["date"]))
        eq = np.array([float(r["equity"]) for r in rows])
    if not np.all(np.isfinite(eq)):
        raise MonteCarloError("equity curve contains non-finite values")
    assert_solvent(eq, initial_capital)
    prev = eq[:-1]
    if np.any(prev <= 0):
        bad = int(np.sum(prev <= 0))
        raise MonteCarloError(
            f"equity reached <= 0 at {bad} bar(s); percentage returns are undefined "
            f"and a blown-up account is not a resampling question")
    return eq[1:] / prev - 1.0


# An account that has decayed to a vanishing fraction of its starting size is
# just as ruined as one at exactly zero, and a geometric decay never actually
# reaches zero -- so a `<= 0` test alone is unreachable and the ruin check below
# would never fire. This threshold is what makes it fire.
IMPLAUSIBLE_EQUITY_FRACTION = 1e-3


def assert_solvent(eq: np.ndarray, initial_capital: float) -> None:
    """Refuse a curve that has been wiped out, however it got there."""
    if not np.isfinite(initial_capital) or initial_capital <= 0:
        raise MonteCarloError(f"initial capital must be positive, got {initial_capital}")
    floor = initial_capital * IMPLAUSIBLE_EQUITY_FRACTION
    if np.any(eq <= floor):
        worst = float(np.min(eq))
        idx = int(np.argmin(eq))
        raise MonteCarloError(
            f"equity fell to Rs{worst:,.4f} at bar {idx}, at or below the "
            f"{IMPLAUSIBLE_EQUITY_FRACTION:.1%}-of-capital floor "
            f"(Rs{floor:,.2f}). A blown-up account is not a resampling question, "
            f"and resampling its returns would manufacture a survivable-looking "
            f"distribution from a total loss.")


def bootstrap_returns(returns: np.ndarray, n_iterations: int = 2000, seed: int = 42,
                      initial_capital: float = 100_000.0,
                      block_size: int = 0) -> MCResult:
    """Resample the return series with replacement; rebuild the equity path.

    `block_size > 0` switches to MOVING-BLOCK bootstrap, which preserves
    short-range autocorrelation. Intraday returns are not i.i.d. -- a momentum
    entry produces clustered bars -- so the resampling scheme must be a
    deliberate choice rather than a default.

    DIRECTION OF THE EFFECT IS DATA-DEPENDENT, and this module does not assume
    one. I wrote the original note here claiming i.i.d. understates the tail; on
    the measured orb return series the opposite held (iid p95 2.58% vs block
    p95 2.30%), because that series has NEGATIVE short-lag autocorrelation --
    positions are flat on ~51% of bars and active in runs, which is a mean-
    reversion pattern at the bar level. The block bootstrap is offered because
    it is the assumption-free choice, not because it is guaranteed to be
    wider. `resample` records which was used so a report never implies a
    distributional claim it did not test.
    """
    r = np.asarray(returns, dtype=float)
    if r.ndim != 1:
        raise MonteCarloError(f"returns must be 1-D, got shape {r.shape}")
    n = len(r)
    if n < 20:
        raise MonteCarloError(f"need >= 20 observations to bootstrap, got {n}")
    if n_iterations < 100:
        raise MonteCarloError(f"n_iterations must be >= 100, got {n_iterations}")
    if np.any(~np.isfinite(r)):
        raise MonteCarloError("returns contain non-finite values")

    if block_size and block_size > 1:
        if block_size >= n:
            block_size = n // 2
        if block_size < 2:
            resample_mode = "iid"
            paths = np.array([r[np.random.default_rng(seed + i).integers(0, n, n)]
                              for i in range(n_iterations)])
        else:
            resample_mode = f"block({block_size})"
            n_blocks = int(np.ceil(n / block_size))
            rng = np.random.default_rng(seed)
            paths = np.empty((n_iterations, n), dtype=float)
            for i in range(n_iterations):
                starts = rng.integers(0, n - block_size + 1, n_blocks)
                idx = (starts[:, None] + np.arange(block_size)[None, :]).ravel()[:n]
                paths[i] = r[idx]
    else:
        resample_mode = "iid"
        rng = np.random.default_rng(seed)
        paths = np.array([r[rng.integers(0, n, n)] for _ in range(n_iterations)])

    finals = initial_capital * np.prod(1.0 + paths, axis=1)
    rets = paths.sum(axis=1)
    peak = np.maximum.accumulate(initial_capital * np.cumprod(1.0 + paths, axis=1), axis=1)
    curve = initial_capital * np.cumprod(1.0 + paths, axis=1)
    max_dd = np.max((peak - curve) / peak, axis=1)
    worst = np.min(curve, axis=1)

    def q(a, ps=(1, 5, 25, 50, 75, 90, 95, 99)):
        return {f"p{p}": round(float(np.percentile(a, p)), 6) for p in ps}

    out = MCResult(n_iterations=n_iterations, n_obs=n, resample=resample_mode)
    out.stats = {
        "final_equity": q(finals),
        "total_return_pct": q((finals / initial_capital - 1.0) * 100.0),
        "cumulative_return": q(rets),
        "mean_path_min_equity": q(worst),
        "prob_ruin": float(np.mean(worst <= 0.0)),
        "prob_loss": float(np.mean(finals < initial_capital)),
    }
    out.max_dd_distribution = {
        "mean_pct": round(float(max_dd.mean()) * 100, 4),
        "median_pct": round(float(np.median(max_dd)) * 100, 4),
        "p90_pct": round(float(np.percentile(max_dd, 90)) * 100, 4),
        "p95_pct": round(float(np.percentile(max_dd, 95)) * 100, 4),
        "p99_pct": round(float(np.percentile(max_dd, 99)) * 100, 4),
        "max_pct": round(float(max_dd.max()) * 100, 4),
        "tail_bound_pct": TAIL_DD_PCT * 100,
        "hard_veto_pct": TAIL_DD_PCT_HARD * 100,
    }
    out.quantiles = {"final_equity": out.stats["final_equity"]}
    p95 = out.max_dd_distribution["p95_pct"] / 100.0
    if p95 > TAIL_DD_PCT_HARD:
        out.reasons.append(
            f"p95 max-DD {p95 * 100:.1f}% exceeds the hard veto "
            f"{TAIL_DD_PCT_HARD * 100:.0f}%")
    elif p95 > TAIL_DD_PCT:
        out.reasons.append(
            f"p95 max-DD {p95 * 100:.1f}% exceeds the tail bound "
            f"{TAIL_DD_PCT * 100:.0f}%")
    if out.stats["prob_ruin"] > 0:
        out.reasons.append(
            f"ruin probability {out.stats['prob_ruin'] * 100:.2f}% across "
            f"{n_iterations} paths")
    if out.stats["prob_loss"] > 0.5:
        out.reasons.append(
            f"more than half of paths lose money "
            f"({out.stats['prob_loss'] * 100:.1f}%)")
    out.passed = not out.reasons
    return out


def block_size_autoselect(n_obs: int, target_blocks: int = 20) -> int:
    """Block length giving roughly `target_blocks` independent blocks.

    Politis & White style: L ~ n^(1/3) is the standard rule for dependent data;
    this uses it but also refuses to produce fewer than 10 blocks, because a
    bootstrap with 3 blocks is not resampling, it is guessing.
    """
    if n_obs < 100:
        return 0
    L = max(2, int(round(n_obs ** (1.0 / 3.0))))
    L = min(L, max(2, n_obs // 10))
    return 0 if n_obs // L < 10 else L
