"""The calibration harness must be indistinguishable from production at defaults.

An earlier draft of the harness re-implemented the generators and emitted 7,521
SNAP signals against production's 941, and referenced an ORB column that does not
exist. Every trial result from that draft would have been unattributable: the
number would have measured the re-implementation, not the parameter.

These tests exist so a variant result can be trusted to measure its parameters and
nothing else. If one fails, the grid must not be run.
"""
from __future__ import annotations

import os
import sys

import pandas as pd
import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)
# scripts/backtest, one level above python-bridge's parent (the repo root).
_REPO_ROOT = os.path.dirname(_ROOT)
sys.path.insert(0, os.path.join(_REPO_ROOT, "scripts", "backtest"))

from services.backtest import panel as panel_mod  # noqa: E402
from services.backtest import signals as signals_mod  # noqa: E402
import calibration_phase1a as cal  # noqa: E402

SYMBOLS = ["BEL", "TCS", "INFY", "RELIANCE", "SBIN", "AXISBANK"]


@pytest.fixture(scope="module")
def df():
    frame, _info = panel_mod.load_for_strategies(
        ["snap", "squeeze", "orb"], symbols=SYMBOLS)
    return frame


def _same(mine, prod) -> int:
    a = pd.Series(mine).fillna(0).astype(int)
    b = pd.Series(prod).fillna(0).astype(int)
    return int((a != b).sum())


class TestHarnessEquivalence:
    """The load-bearing tests. A failure here invalidates every trial."""

    def test_snap_default_reproduces_production(self, df):
        assert _same(cal.gen_snap(df, 0.80, 20.0, 1.0),
                     signals_mod.signals_snap(df)) == 0

    def test_squeeze_default_reproduces_production(self, df):
        assert _same(cal.gen_squeeze(df, 6, 0.0, False),
                     signals_mod.signals_squeeze(df)) == 0

    def test_orb_default_reproduces_production(self, df):
        assert _same(cal.gen_orb(df, 20.0, 1.3),
                     signals_mod.signals_orb(df)) == 0


class TestGridIntegrity:
    """The trial count is the single easiest number to understate, and
    understating it is how a search for noise gets reported as a finding."""

    def test_total_trials_equals_the_cartesian_product(self):
        assert cal.TOTAL_TRIALS == sum(cal.EXPECTED_TRIALS.values())

    def test_grid_length_equals_declared_total(self):
        assert len(cal.GRID) == cal.TOTAL_TRIALS

    def test_every_strategy_appears(self):
        assert {v.strategy for v in cal.GRID} == {"snap", "squeeze", "orb"}

    def test_no_duplicate_parameter_bundles(self):
        labels = [v.label for v in cal.GRID]
        assert len(set(labels)) == len(labels), "a duplicate inflates nothing but hides one"

    def test_indices_are_dense_and_per_strategy(self):
        for strat in ("snap", "squeeze", "orb"):
            group = [v for v in cal.GRID if v.strategy == strat]
            assert [v.index for v in group] == list(range(1, len(group) + 1))
            assert all(v.total == len(group) for v in group)

    def test_baseline_variant_exists_for_every_strategy(self):
        """Without a variant that IS production, there is nothing to calibrate
        against and no anchor for the report."""
        defaults = {
            "snap": {"mom": 0.80, "adx": 20.0, "vol": 1.0, "r": 1.0},
            "squeeze": {"count": 6, "vol": 0.0, "r": 1.0},
            # ORB's certified baseline used r_mult = 2.5, so 2.5 is the baseline
            # cell, not 1.5. Asserting 1.5 here is what caught the omission.
            "orb": {"adx": 20.0, "vol": 1.3, "r": 2.5},
        }
        labels = {v.label for v in cal.GRID}
        for strat, params in defaults.items():
            want = cal.Variant(strat, params).label
            assert want in labels, f"no baseline variant for {strat}: {want}"

    def test_bonferroni_bar_is_strict(self):
        assert 0.05 / cal.TOTAL_TRIALS < 0.0005


class TestMonotonicity:
    """A stricter threshold must never produce MORE signals. If it does, a
    parameter is wired to the wrong predicate and the grid is not measuring what
    its labels claim."""

    def test_tighter_snap_momentum_is_subset(self, df):
        loose = cal.gen_snap(df, 0.80, 20.0, 1.0) != 0
        tight = cal.gen_snap(df, 0.95, 20.0, 1.0) != 0
        assert int(tight.sum()) <= int(loose.sum())

    def test_higher_snap_adx_is_subset(self, df):
        loose = cal.gen_snap(df, 0.80, 20.0, 1.0) != 0
        tight = cal.gen_snap(df, 0.80, 30.0, 1.0) != 0
        assert int(tight.sum()) <= int(loose.sum())

    def test_longer_squeeze_coil_is_subset(self, df):
        loose = cal.gen_squeeze(df, 6, 0.0, False) != 0
        tight = cal.gen_squeeze(df, 12, 0.0, False) != 0
        assert int(tight.sum()) <= int(loose.sum())

    def test_higher_orb_adx_is_subset(self, df):
        loose = cal.gen_orb(df, 20.0, 1.3) != 0
        tight = cal.gen_orb(df, 30.0, 1.3) != 0
        assert int(tight.sum()) <= int(loose.sum())

    def test_squeeze_blackout_is_subset_of_no_blackout(self, df):
        loose = cal.gen_squeeze(df, 6, 0.0, False) != 0
        tight = cal.gen_squeeze(df, 6, 0.0, True) != 0
        assert int(tight.sum()) <= int(loose.sum())


class TestGeneratorValidation:
    def test_generators_are_deterministic(self, df):
        a = cal.gen_snap(df, 0.85, 25.0, 1.2)
        b = cal.gen_snap(df, 0.85, 25.0, 1.2)
        assert _same(a, b) == 0

    def test_sparse_one_signal_per_symbol_day(self, df):
        """The production invariant: a count inflated by the bar count is not a count."""
        for name, sig in (("snap", cal.gen_snap(df, 0.85, 25.0, 1.2)),
                          ("squeeze", cal.gen_squeeze(df, 8, 1.3, False)),
                          ("orb", cal.gen_orb(df, 25.0, 1.5))):
            nz = sig[sig != 0]
            days = df.loc[nz.index].assign(_s=nz.to_numpy()).groupby(
                ["symbol", "date"]).size()
            assert days.max() == 1, f"{name} emitted multiple signals on one symbol-day"
