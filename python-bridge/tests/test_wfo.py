"""Walk-forward gate and multiplicity correction: P-10, F-1..F-5.

The legacy optimiser (blueprint 1.2.3) ran 35 trials on one symbol, sorted on raw
PnL, accepted a minimum of ONE trade, and wrote the winner into the live ORB
config. Each test below targets one of those failures or one of the ways a
falsification gate can be made to fail open.
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.backtest import mc as mc_mod  # noqa: E402
from services.backtest import metrics as metrics_mod  # noqa: E402
from services.backtest import wfo  # noqa: E402


def _dates(n: int) -> pd.Series:
    """n genuinely distinct trading dates."""
    return pd.Series(pd.bdate_range("2022-01-03", periods=n))


def _curve(start: float, drift_per_bar: float, n: int = 400,
           noise: float = 0.01, seed: int = 3) -> list[dict]:
    """A synthetic intraday equity curve.

    `noise` DEFAULTS HIGH on purpose. An earlier version defaulted to 0, which
    produced a deterministic drift and a Sharpe of ~340; the Deflated Sharpe
    correctly deflated that to 0.0 and refused to pass the gate. That was the
    gate working, and the fixture was unrealistic. Real 5-minute equity curves
    are flat on most bars and noisy on the rest, giving Sharpe in the 1-5 range.
    """
    rng = np.random.default_rng(seed)
    eq = [start]
    for _ in range(n - 1):
        eq.append(eq[-1] * (1.0 + drift_per_bar + rng.normal(0, noise)))
    t0 = pd.Timestamp("2024-01-01 09:15")
    return [{"date": t0 + pd.Timedelta(minutes=5 * i), "equity": float(v)}
            for i, v in enumerate(eq)]


_BARS_PER_YEAR = 60_480.0          # 5-minute NSE bars, per metrics.bars_per_year
_PER_BAR_SIGMA = 0.0006            # ~0.06% per bar


def _drift_for_sharpe(target: float, sigma: float = _PER_BAR_SIGMA) -> float:
    """Per-bar drift that annualises to `target` Sharpe.

    The annualisation factor for 5-minute bars is sqrt(60480) = 245.9, so a drift
    guessed by eye lands anywhere between Sharpe 0 and Sharpe 98. Deriving it
    keeps the fixture honest instead of lucky.
    """
    return target * sigma / np.sqrt(_BARS_PER_YEAR)


def _realistic_fold(seed: int, positive: bool = True, n: int = 1200,
                    sharpe: float = 3.8) -> list[dict]:
    """A curve whose Sharpe lands in the 1-5 band, as measured on the real panel.

    The default 3.8 is the Sharpe the real orb run actually produced, so the
    fixture sits inside the band the gate is designed for. Below ~3 the sampling
    error on a 1,200-bar synthetic can push an individual fold negative, which
    would make the test assert on noise rather than on gate behaviour.
    """
    drift = _drift_for_sharpe(sharpe if positive else -sharpe)
    return _curve(100_000, drift, n=n, noise=_PER_BAR_SIGMA, seed=seed)


# ── anchored folds ───────────────────────────────────────────────────────────
class TestAnchoredFolds:
    def test_produces_the_requested_number_of_folds(self):
        assert len(wfo.anchored_folds(_dates(300), n_folds=5)) == 5

    def test_training_window_never_touches_the_test_window(self):
        for f in wfo.anchored_folds(_dates(300), n_folds=5, purge_gap=5):
            assert f.train_end < f.test_start, \
                f"fold {f.fold} trains through {f.train_end} but tests from {f.test_start}"

    def test_is_anchored_not_rolling(self):
        folds = wfo.anchored_folds(_dates(300), n_folds=5)
        assert len({f.train_start for f in folds}) == 1, \
            "every fold must start from the same first date (expanding window)"

    def test_training_window_grows_monotonically(self):
        folds = wfo.anchored_folds(_dates(300), n_folds=5)
        widths = [(f.train_end - f.train_start) for f in folds]
        assert widths == sorted(widths)

    def test_folds_are_chronological_and_non_overlapping(self):
        folds = wfo.anchored_folds(_dates(300), n_folds=5)
        for a, b in zip(folds, folds[1:]):
            assert a.test_end < b.test_start, "test windows must not overlap"

    def test_purge_gap_actually_separates_the_windows(self):
        tight = wfo.anchored_folds(_dates(300), n_folds=4, purge_gap=0)
        wide = wfo.anchored_folds(_dates(300), n_folds=4, purge_gap=20)
        gap_tight = (tight[0].test_start - tight[0].train_end).days
        gap_wide = (wide[0].test_start - wide[0].train_end).days
        assert gap_wide > gap_tight

    def test_too_few_dates_is_refused_not_truncated(self):
        with pytest.raises(wfo.WFOError, match="unique dates"):
            wfo.anchored_folds(pd.Series(pd.to_datetime(["2024-01-01"] * 5)), n_folds=4)

    def test_single_fold_is_refused(self):
        with pytest.raises(wfo.WFOError):
            wfo.anchored_folds(_dates(300), n_folds=1)


# ── robustness plateau ───────────────────────────────────────────────────────
class TestRobustnessPlateau:
    def _grid(self, fn):
        return {(i, j): fn(i, j) for i in range(5) for j in range(5)}

    def test_a_genuine_plateau_is_green(self):
        r = wfo.robustness_plateau(self._grid(lambda i, j: 1.0 + 0.01 * i), (2, 2))
        assert r["status"] == "Robust Green Plateau"
        assert r["spike_signature"] is False

    def test_an_isolated_spike_is_caught(self):
        r = wfo.robustness_plateau(
            self._grid(lambda i, j: 5.0 if (i, j) == (2, 2) else -1.0), (2, 2))
        assert r["status"] == "Isolated Spike (Overfit Risk)"

    def test_a_green_neighbourhood_on_a_negative_grid_is_flagged_as_a_spike(self):
        """The case the legacy rule mislabels: the 3x3 neighbourhood is 100%
        positive, so the legacy check says green, while the grid is mostly
        negative. This is the overfit shape the neighbourhood cannot see."""
        def fn(i, j):
            return 2.0 if max(abs(i - 2), abs(j - 2)) <= 1 else -2.0
        r = wfo.robustness_plateau(self._grid(fn), (2, 2))
        assert r["neighbourhood_positive_pct"] == 100.0
        assert r["grid_positive_pct"] < 75.0
        assert r["status"] == "Robust Green Plateau"     # legacy label
        assert r["spike_signature"] is True              # the addition catches it

    def test_moderate_cluster_is_labelled_as_such(self):
        def fn(i, j):
            return 2.0 if (i == 2 and abs(j - 2) <= 1) or (j == 2 and abs(i - 2) <= 1) else -1.0
        r = wfo.robustness_plateau(self._grid(fn), (2, 2))
        assert r["status"] in ("Moderate Cluster", "Isolated Spike (Overfit Risk)")

    def test_empty_grid_is_refused(self):
        with pytest.raises(wfo.WFOError):
            wfo.robustness_plateau({}, (0, 0))

    def test_non_finite_cells_are_ignored_not_counted_as_positive(self):
        g = self._grid(lambda i, j: 2.0)
        g[(0, 0)] = float("nan")
        r = wfo.robustness_plateau(g, (2, 2))
        assert r["grid_cells"] == 24, "a NaN cell must be excluded, not counted"


# ── multiplicity correction: the 35-trial search ────────────────────────────
class TestMultiplicityCorrection:
    def test_bonferroni_tightens_with_more_trials(self):
        assert wfo.multiplicity_correction(1.8, 35, 200, p_value=0.02)[
            "bonferroni_threshold"] == pytest.approx(0.05 / 35)

    def test_a_p_value_that_passes_at_one_trial_fails_at_thirty_five(self):
        """The exact legacy failure: Sharpe 1.8 looks publishable until you admit
        you searched 35 times for it."""
        one = wfo.multiplicity_correction(1.8, 1, 200, p_value=0.02)
        many = wfo.multiplicity_correction(1.8, 35, 200, p_value=0.02)
        assert one["bonferroni_pass"] is True
        assert many["bonferroni_pass"] is False
        assert many["passed"] is False

    def test_deflated_sharpe_penalises_a_broad_search(self):
        assert (wfo.multiplicity_correction(1.8, 1, 200, p_value=0.01)["deflated_sharpe"]
                > wfo.multiplicity_correction(1.8, 500, 200, p_value=0.01)["deflated_sharpe"])

    def test_a_missing_p_value_cannot_pass_the_gate(self):
        """F-4: omitting a test is not passing it."""
        r = wfo.multiplicity_correction(2.0, 1, 200, p_value=None)
        assert r["bonferroni_pass"] is False
        assert r["passed"] is False
        assert "no p-value" in r["note"]

    def test_both_corrections_must_pass_not_either(self):
        dsr_ok = wfo.multiplicity_correction(3.0, 1, 200, p_value=0.001)
        assert dsr_ok["dsr_pass"] is True and dsr_ok["bonferroni_pass"] is True
        assert dsr_ok["passed"] is True

    def test_zero_trials_is_rejected(self):
        with pytest.raises(wfo.WFOError):
            wfo.multiplicity_correction(1.0, 0, 100, p_value=0.01)

    def test_trials_counted_is_the_search_not_the_survivors(self):
        """`n_trials` must be the number of combinations EVALUATED."""
        r = wfo.multiplicity_correction(1.8, 35, 200, p_value=0.02)
        assert r["n_trials"] == 35
        assert r["bonferroni_threshold"] < 0.05 / 34, \
            "n_trials must be the full search space, not the survivors"


# ── the gate itself ──────────────────────────────────────────────────────────
class TestWalkForwardGate:
    def test_consistently_positive_folds_pass_the_shape_checks(self):
        curves = [_realistic_fold(3 + i) for i in range(4)]
        r = wfo.walk_forward_gate(None, curves, n_trials=1, runs_p=0.001,
                                  min_folds_passing=3, min_trades_per_fold=0)
        assert r.n_folds == 4
        assert r.aggregate["folds_positive"] == 4
        assert r.reasons == [], f"unexpected block: {r.reasons}"

    def test_failing_bonferroni_blocks_the_gate_even_when_every_fold_is_green(self):
        curves = [_realistic_fold(3 + i) for i in range(4)]
        r = wfo.walk_forward_gate(None, curves, n_trials=35, runs_p=0.02,
                                  min_folds_passing=3, min_trades_per_fold=0)
        assert r.passed is False
        assert any("Bonferroni" in x for x in r.reasons)

    def test_too_few_positive_folds_blocks_the_gate(self):
        curves = [_realistic_fold(3 + i, True) for i in range(3)] \
            + [_realistic_fold(99, False)]
        r = wfo.walk_forward_gate(None, curves, n_trials=1, runs_p=0.001,
                                  min_folds_passing=4, min_trades_per_fold=0)
        assert r.passed is False
        assert any("folds positive" in x for x in r.reasons)

    def test_a_gate_with_no_reasons_passes_and_one_with_reasons_never_does(self):
        curves = [_realistic_fold(3 + i) for i in range(4)]
        r = wfo.walk_forward_gate(None, curves, n_trials=1, runs_p=0.001,
                                  min_trades_per_fold=0)
        assert r.passed == (len(r.reasons) == 0)

    def test_thin_folds_are_reported_and_counted(self):
        """F-5: the legacy optimiser accepted a minimum of ONE trade. A fold with
        one trade cannot be scored and must be visible, not averaged in."""
        curves = [_curve(100_000, 0.001, n=60, noise=0.0006) for _ in range(4)]
        r = wfo.walk_forward_gate(None, curves, n_trials=1, runs_p=0.001,
                                  min_trades_per_fold=20, min_folds_passing=3)
        assert r.aggregate["folds_meeting_min_trades"] <= r.n_folds
        if r.aggregate["folds_meeting_min_trades"] < 3:
            assert any("trades" in x for x in r.reasons)

    def test_too_few_usable_folds_refuses_to_pass(self):
        r = wfo.walk_forward_gate(None, [_curve(100_000, 0.0, n=5)], n_trials=1)
        assert r.passed is False
        assert r.reasons

    def test_a_zero_variance_series_is_refused_as_an_artefact(self):
        """A near-zero-volatility curve has an effectively infinite Sharpe, and
        the Deflated Sharpe PASSES it -- infinity is maximally surprising. The
        gate therefore needs its own plausibility ceiling.

        This is a real gap found while writing these tests: with only the
        multiplicity corrections in place, a straight line scored 3.6e15 and was
        accepted.
        """
        curves = [_curve(100_000, 0.0006, noise=0.0) for _ in range(4)]
        r = wfo.walk_forward_gate(None, curves, n_trials=1, runs_p=0.001,
                                  min_folds_passing=3, min_trades_per_fold=0)
        assert abs(r.aggregate["mean_fold_sharpe"]) > wfo.MAX_PLAUSIBLE_SHARPE
        assert r.passed is False
        assert any("plausibility ceiling" in x for x in r.reasons)

    def test_a_realistic_sharpe_is_not_caught_by_the_artefact_screen(self):
        curves = [_realistic_fold(3 + i) for i in range(4)]
        r = wfo.walk_forward_gate(None, curves, n_trials=1, runs_p=0.001,
                                  min_folds_passing=3, min_trades_per_fold=0)
        assert r.aggregate["mean_fold_sharpe"] < wfo.MAX_PLAUSIBLE_SHARPE
        assert not any("plausibility" in x for x in r.reasons)

    def test_dsr_observes_return_bars_not_trade_count(self):
        """n_obs for the Deflated Sharpe is the length of the series that produced
        the Sharpe. Conflating it with a trade-count threshold made DSR collapse
        to 0 for a healthy strategy."""
        curves = [_realistic_fold(3 + i) for i in range(4)]
        r = wfo.walk_forward_gate(None, curves, n_trials=1, runs_p=0.001,
                                  min_folds_passing=3, min_trades_per_fold=0)
        assert r.aggregate["n_return_obs"] == sum(len(c) - 1 for c in curves)
        assert r.aggregate["multiplicity"]["n_obs"] == r.aggregate["n_return_obs"]

    def test_min_folds_is_absolute_not_a_fraction(self):
        """A 4-fold and a 10-fold run must not be held to different standards."""
        c = [_realistic_fold(3 + i) for i in range(4)]
        assert wfo.walk_forward_gate(None, c, 1, runs_p=0.001, min_folds_passing=3,
                                     min_trades_per_fold=0
                                     ).aggregate["folds_positive"] >= 3


# ── F-1: the order test that was provably degenerate ─────────────────────────
class TestF1OrderIndependence:
    def test_profit_factor_is_order_invariant_so_it_cannot_be_the_baseline(self):
        """An earlier F-1 permuted trades and compared PROFIT FACTOR. That is
        invariant under permutation, so the baseline is a single point and the
        test can never falsify anything."""
        pnls = np.array([100.0, -50.0, 75.0, -25.0, 200.0, -120.0])
        pf = pnls[pnls > 0].sum() / -pnls[pnls < 0].sum()
        for _ in range(50):
            perm = np.random.default_rng().permutation(pnls)
            assert perm[perm > 0].sum() / -perm[perm < 0].sum() == pytest.approx(pf)

    def test_the_replacement_baseline_tests_order_dependent_statistics(self):
        """The rewritten F-1 uses max-DD, ulcer and Sharpe, which all vary under
        permutation -- unlike profit factor, which is a constant."""
        pnls = np.array([100.0, -50.0, 75.0, -25.0, 200.0, -120.0])
        b = metrics_mod.shuffle_baseline(pnls, n_iterations=300, seed=1)
        od = b["order_dependent"]
        assert set(od) == {"max_drawdown_pct", "ulcer_index", "sharpe"}
        for name, d in od.items():
            assert d["null_median"] != d["null_p95"], \
                f"{name} must vary under permutation or it is order-invariant"

    def test_order_invariant_statistics_are_named_so_they_are_never_reported(self):
        pnls = np.array([100.0, -50.0, 75.0, -25.0, 200.0, -120.0])
        b = metrics_mod.shuffle_baseline(pnls, n_iterations=200, seed=1)
        assert "profit_factor" in b["not_falsifiable_by_shuffling"]
        assert "profit_factor" not in b["order_dependent"]

    def test_a_permutation_baseline_reports_a_null_distribution(self):
        pnls = np.array([100.0, -50.0, 75.0, -25.0, 200.0, -120.0] * 8)
        b = metrics_mod.shuffle_baseline(pnls, n_iterations=500, seed=11,
                                          starting_equity=100_000.0)
        dd = b["order_dependent"]["max_drawdown_pct"]
        assert dd["null_p95"] > dd["null_median"] > 0
        assert "passes" in dd


# ── Monte Carlo: returns not rupees ──────────────────────────────────────────
class TestMonteCarloReturns:
    def test_a_flat_curve_has_zero_volatility_and_cannot_be_improved(self):
        flat = [{"date": pd.Timestamp("2024-01-01") + pd.Timedelta(minutes=5 * i),
                 "equity": 100_000.0} for i in range(200)]
        r = mc_mod.to_returns(flat, 100_000.0)
        assert np.all(r == 0.0)
        res = mc_mod.bootstrap_returns(r, n_iterations=200, seed=1)
        assert res.stats["final_equity"]["p50"] == pytest.approx(100_000.0)
        assert res.max_dd_distribution["max_pct"] == pytest.approx(0.0)

    def test_zero_return_bars_are_kept_not_dropped(self):
        """This engine holds no position on most bars. Dropping the zeros would
        overstate volatility of the invested periods."""
        eq = [100_000.0]
        for i in range(120):
            eq.append(eq[-1] if i % 2 else eq[-1] * 1.001)
        r = mc_mod.to_returns([{"date": pd.Timestamp("2024-01-01") + pd.Timedelta(
            minutes=5 * i), "equity": v} for i, v in enumerate(eq)], 100_000.0)
        assert len(r) == len(eq) - 1
        assert np.mean(r == 0) > 0.4

    def test_max_drawdown_distribution_is_reported_not_just_its_mean(self):
        r = mc_mod.to_returns(_curve(100_000, 0.0, noise=0.002, n=500), 100_000.0)
        res = mc_mod.bootstrap_returns(r, n_iterations=300, seed=5)
        d = res.max_dd_distribution
        for k in ("mean_pct", "median_pct", "p90_pct", "p95_pct", "max_pct"):
            assert k in d, f"the promised max-DD distribution is missing {k}"
        assert d["max_pct"] >= d["p95_pct"] >= d["median_pct"] >= 0

    def test_resample_mode_is_recorded_so_no_unearned_distributional_claim(self):
        r = mc_mod.to_returns(_curve(100_000, 0.0002, noise=0.001, n=400), 100_000.0)
        for bs in (0, 20):
            res = mc_mod.bootstrap_returns(r, n_iterations=200, seed=2, block_size=bs)
            assert res.resample in ("iid",) or res.resample.startswith("block")

    def test_ruin_is_refused_not_clipped(self):
        """A blown-up account makes percentage returns undefined. It must be
        reported, not silently clipped into a survivable-looking series."""
        blown = [{"date": pd.Timestamp("2024-01-01") + pd.Timedelta(minutes=5 * i),
                  "equity": 100_000.0 * (0.5 ** i)} for i in range(60)]
        with pytest.raises(mc_mod.MonteCarloError, match="floor"):
            mc_mod.to_returns(blown, 100_000.0)

    def test_an_account_decayed_to_a_vanishing_fraction_is_still_refused(self):
        """A geometric decay never literally reaches 0, so a `<= 0` test alone
        would never fire. This is the case that exposed that gap."""
        tiny = [{"date": pd.Timestamp("2024-01-01") + pd.Timedelta(minutes=5 * i),
                 "equity": 100_000.0 * (0.5 ** i)} for i in range(80)]
        assert min(r["equity"] for r in tiny) > 0, "never actually reaches zero"
        with pytest.raises(mc_mod.MonteCarloError, match="floor"):
            mc_mod.to_returns(tiny, 100_000.0)

    def test_non_finite_equity_is_refused(self):
        bad = [{"date": pd.Timestamp("2024-01-01") + pd.Timedelta(minutes=5 * i),
                "equity": (float("nan") if i == 5 else 100_000.0)} for i in range(40)]
        with pytest.raises(mc_mod.MonteCarloError, match="non-finite"):
            mc_mod.to_returns(bad, 100_000.0)

    def test_too_few_observations_is_refused(self):
        with pytest.raises(mc_mod.MonteCarloError, match="20 observations"):
            mc_mod.bootstrap_returns(np.zeros(10), n_iterations=200)

    def test_a_deep_tail_fails_the_tail_bound(self):
        r = mc_mod.to_returns(_curve(100_000, 0.0, noise=0.02, n=600), 100_000.0)
        res = mc_mod.bootstrap_returns(r, n_iterations=200, seed=9)
        assert res.passed is False
        assert res.reasons

    def test_autoselected_block_size_respects_ten_blocks(self):
        for n in (0, 50, 99, 100, 1000, 68_652):
            bs = mc_mod.block_size_autoselect(n)
            assert bs == 0 or n // bs >= 10
