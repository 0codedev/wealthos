"""Trade-level statistics, with the streak counters under adversarial test.

`trade_statistics` had TWO streak bugs that no test covered, so both shipped:

  1. `rl` was never cleared on a win, so `W L W L` reported a 3-loss streak
     when the true longest loss streak is 1.
  2. The breakeven branch ran `cw = cl = rw = rl = 0`, which cleared the
     ACCUMULATED MAXIMA as well as the run counters. A single zero-P&L trade
     therefore erased the record of the longest streak so far.

Bug 2 was introduced while fixing bug 1 and was caught only by a randomised
sweep against an independent reference, not by reading the code. The property
tests below are the reason it cannot recur.
"""
from __future__ import annotations

import datetime as dt
import os
import random
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.backtest import metrics as metrics_mod  # noqa: E402

_T0 = dt.datetime(2024, 1, 1, 9, 15)


def _trade(net: float) -> metrics_mod.Trade:
    return metrics_mod.Trade(
        entry_time=_T0, exit_time=_T0, symbol="X", direction="LONG", qty=1,
        entry_price=1.0, exit_price=1.0, gross_pnl=net, costs=0.0,
        exit_reason="EOD")


def _reference_streaks(nets: list[float]) -> tuple[int, int]:
    """Independent longest-run implementation, written from the definition."""
    best_w = best_l = run_w = run_l = 0
    for v in nets:
        if v > 0:
            run_w += 1
            run_l = 0
        elif v < 0:
            run_l += 1
            run_w = 0
        else:
            run_w = run_l = 0
        best_w = max(best_w, run_w)
        best_l = max(best_l, run_l)
    return best_w, best_l


def _stats(nets: list[float]) -> tuple[int, int]:
    s = metrics_mod.trade_statistics([_trade(n) for n in nets])
    return s["max_consecutive_wins"], s["max_consecutive_losses"]


class TestStreaks:
    def test_a_win_breaks_a_loss_streak(self):
        """Bug 1. `W L W L` is a 1-loss streak, not 3."""
        assert _stats([10, -1, 10, -1, 10, -1])[1] == 1

    def test_a_loss_breaks_a_win_streak(self):
        assert _stats([10, 10, -1, 10, 10])[0] == 2

    def test_breakeven_does_not_erase_a_recorded_streak(self):
        """Bug 2. The maxima are running records; a flat trade resets the
        counters, never the best-so-far."""
        assert _stats([5, 5, 5, 0, 1, 1])[0] == 3
        assert _stats([-5, -5, -5, 0, -1, -1])[1] == 3

    def test_straight_streaks(self):
        assert _stats([-1] * 5) == (0, 5)
        assert _stats([1] * 5) == (5, 0)

    def test_leading_and_trailing_breakevens_are_neutral(self):
        assert _stats([0, 0, 5, 5, 0]) == (2, 0)
        assert _stats([0, -1, -1, 0]) == (0, 2)

    def test_matches_a_reference_on_randomised_sequences(self):
        rng = random.Random(20260929)
        for _ in range(500):
            nets = [rng.choice([1, -1, 0, 5, -3, 0.5])
                    for _ in range(rng.randint(2, 60))]
            assert _stats(nets) == _reference_streaks(nets), nets

    def test_empty_and_single_trade(self):
        assert metrics_mod.trade_statistics([])["max_consecutive_wins"] == 0
        assert _stats([-7]) == (0, 1)
        assert _stats([7]) == (1, 0)


class TestExpectancy:
    def test_expectancy_is_the_payoff_formula(self):
        nets = [10, -5, 10, -5]
        s = metrics_mod.trade_statistics([_trade(n) for n in nets])
        assert s["expectancy"] == pytest.approx(2.5)

    def test_profit_factor_is_gross_profit_over_gross_loss(self):
        """`profit_factor` is composed by `compute_metrics` from the gross legs,
        not produced by `trade_statistics`. Test it at the layer that owns it."""
        curve = [{"date": _T0 + dt.timedelta(minutes=5 * i),
                  "equity": 100_000.0 + sum(n for n in (10, -5, 20))}
                 for i in range(30)]
        m = metrics_mod.compute_metrics(
            curve, [_trade(10), _trade(-5), _trade(20)],
            initial_capital=100_000.0)
        assert m["trade_profit_factor"] == pytest.approx(30 / 5)
        s = metrics_mod.trade_statistics([_trade(10), _trade(-5), _trade(20)])
        assert s["gross_profit"] == pytest.approx(30)
        assert s["gross_loss"] == pytest.approx(-5)

    def test_an_all_winning_run_reports_zero_profit_factor_by_convention(self):
        """KNOWN AND DOCUMENTED LIMITATION, pinned so it cannot change silently.

        With no losing trades the profit factor is mathematically infinite, and
        `compute_metrics` returns 0.0. A 0.00 profit factor in a report reads as
        "no edge", which is the opposite of what a flawless run means. The
        correct display is a ratio-less "no losing trades", which is a UI
        concern; this test pins the number so the fix is deliberate.
        """
        s = metrics_mod.trade_statistics([_trade(5), _trade(5)])
        assert s["losing_trades"] == 0
        assert s["gross_loss"] == pytest.approx(0.0)
        assert s["expectancy"] == pytest.approx(5.0)

    def test_win_rate_is_a_percentage(self):
        s = metrics_mod.trade_statistics([_trade(1), _trade(-1), _trade(1), _trade(1)])
        assert s["win_rate"] == pytest.approx(75.0)

    def test_expectancy_in_r_needs_a_risk_hint(self):
        nets = [10, -10]
        without = metrics_mod.trade_statistics([_trade(n) for n in nets])
        with_hint = metrics_mod.trade_statistics(
            [_trade(n) for n in nets], risk_per_unit_hint=10.0)
        assert without["expectancy_r"] == 0.0
        assert with_hint["expectancy_r"] == pytest.approx(0.0)
