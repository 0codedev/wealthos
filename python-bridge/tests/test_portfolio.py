"""Properties for the execution engine: E1/E2/E3/E4, P-10, P-11, P-12, and sizing coherence.

Every test here is written to FAIL on a specific defect that actually occurred
during T5.1, rather than to confirm that a function returns something. A test
that only asserts "no exception" would have passed all six.
"""

from __future__ import annotations

import math
import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.backtest import exits as exits_mod  # noqa: E402
from services.backtest import portfolio as pf  # noqa: E402
from services.backtest import signals as signals_mod  # noqa: E402
from services.backtest import sizing as sizing_mod  # noqa: E402


# ── fixtures ─────────────────────────────────────────────────────────────────
def _bars(symbol: str, n: int = 80, start: str = "2024-01-01 09:15",
          price: float = 1000.0) -> pd.DataFrame:
    """A deterministic intraday frame: `bar_of_day` 0..n-1 on a single date."""
    times = pd.date_range(start, periods=n, freq="5min")
    rng = np.random.default_rng(7)
    drift = rng.normal(0, 1.0, n)
    close = price + np.cumsum(drift)
    df = pd.DataFrame({
        "symbol": symbol, "datetime": times,
        "date": times.date,
        "open": close - 0.5, "high": close + 2.0, "low": close - 2.0,
        "close": close, "bar_of_day": np.arange(n),
        "atr_14": np.full(n, price * 0.004),
    })
    return df


def _panel(symbols=("AAA", "BBB", "CCC"), n=80) -> pd.DataFrame:
    return pd.concat([_bars(s, n) for s in symbols], ignore_index=True)


def _tape(o, h, l, c, atr=4.0, symbol="AAA", start="2024-01-01 09:15"):
    """Build a multi-bar frame from explicit OHLC, with a correct bar index.

    `_one_bar` was wrong: concatenating single-row frames gives every row
    `pos_in_symbol = 0`, so the second bar could never be reached.
    """
    n = len(o)
    times = pd.date_range(start, periods=n, freq="5min")
    return pd.DataFrame({
        "symbol": symbol, "datetime": times, "date": times.date,
        "open": np.asarray(o, float), "high": np.asarray(h, float),
        "low": np.asarray(l, float), "close": np.asarray(c, float),
        "bar_of_day": np.arange(n), "atr_14": np.full(n, atr)})


def _cand(prepped, symbol, pos, direction="LONG", atr=4.0, score=1.0):
    row = prepped[(prepped["symbol"] == symbol) & (prepped["pos_in_symbol"] == pos)]
    return pd.DataFrame([{"symbol": symbol, "direction": direction, "atr_14": atr,
                          "score": score, "pos_in_symbol": pos,
                          "datetime": row["datetime"].iloc[0]}])


def _cfg(**kw) -> pf.ExecutionConfig:
    base = dict(capital=100_000.0, risk_pct=0.01, max_concurrent=3, r_mult=2.0)
    base.update(kw)
    return pf.ExecutionConfig(**base)


# ── P-1: sizing coherence at the institutionally resolved config ─────────────
class TestSizingCoherence:
    def test_risk_budget_is_never_leveraged(self):
        """`risk_pct=0.01` on Rs 100k is Rs 1,000 of REAL risk at any leverage.

        If this ever passes, a stated 1% account risk has silently become 3%.
        """
        for lev in (1.0, 2.0, 3.0, 5.0):
            sc = sizing_mod.SizingConfig(capital=100_000.0, risk_pct=0.01, leverage=lev)
            assert sc.risk_budget if hasattr(sc, "risk_budget") else True
            r = sizing_mod.compute_quantity(1000.0, 3.5, sc)
            assert r.risk_budget == pytest.approx(1000.0), \
                f"leverage {lev} changed the rupee risk budget to {r.risk_budget}"

    def test_leverage_scales_size_but_never_the_risk_budget(self):
        """Leverage buys more size; it must not buy more RISK.

        A larger position necessarily carries a larger rupee risk, so the
        invariant is not "planned_loss never grows" -- it is "the risk budget is
        identical at every leverage, and planned_loss stays inside it".
        """
        base = sizing_mod.compute_quantity(
            1000.0, 3.5, sizing_mod.SizingConfig(capital=1e6, risk_pct=0.01, leverage=1.0))
        lev3 = sizing_mod.compute_quantity(
            1000.0, 3.5, sizing_mod.SizingConfig(capital=1e6, risk_pct=0.01, leverage=3.0))
        assert lev3.qty > base.qty, "leverage must be able to increase size"
        assert lev3.risk_budget == base.risk_budget == pytest.approx(10_000.0)
        assert lev3.planned_loss <= 10_000.0, "leverage must not escape the risk budget"

    def test_leverage_one_is_bit_identical_to_the_pre_leverage_law(self):
        sc = sizing_mod.SizingConfig(capital=100_000.0, risk_pct=0.01, leverage=1.0)
        r = sizing_mod.compute_quantity(1000.0, 3.5, sc)
        assert r.qty_by_nominal_cap == int(100_000.0 / 1000.0)
        assert r.qty_by_slot == int(100_000.0 * sc.slot_gross_pct / 1000.0)

    def test_leverage_above_five_is_rejected(self):
        with pytest.raises(sizing_mod.SizingError):
            sizing_mod.SizingConfig(capital=1e5, leverage=5.1)

    def test_atr_floor_meets_the_three_point_five_x_friction_hurdle(self):
        v = _cfg().viability()
        assert v["meets_3_5x_hurdle"] is True
        assert v["hurdle_multiple"] == pytest.approx(3.5)
        assert v["atr_floor_pct"] == 0.0035

    def test_planned_loss_never_exceeds_the_risk_budget(self):
        """P-1. No regime may produce a loss larger than the authorised budget."""
        for lev in (1.0, 2.0, 3.0):
            for price in (50.0, 500.0, 5000.0):
                for stop in (price * 0.0035, price * 0.01, price * 0.05):
                    sc = sizing_mod.SizingConfig(capital=100_000.0, risk_pct=0.01,
                                                 leverage=lev)
                    r = sizing_mod.compute_quantity(price, stop, sc)
                    assert r.planned_loss <= sc.capital * sc.risk_pct + 1e-6


# ── E1: entry never fills on the signal bar ──────────────────────────────────
class TestE1EntryCausality:
    def test_fill_is_the_open_after_the_signal_bar(self):
        df = _panel(("AAA",), n=40)
        df = pf.prepare_panel(df)
        cand = pd.DataFrame([{
            "symbol": "AAA", "direction": "LONG", "atr_14": 4.0, "score": 1.0,
            "pos_in_symbol": 5, "datetime": df.loc[df.pos_in_symbol == 5, "datetime"].iloc[0],
        }])
        fills = pf.resolve_fills(df, cand, _cfg())
        assert len(fills) == 1
        f = fills[0]
        assert f.entry_index == 6, "must fill on the NEXT bar, never the signal bar"
        o = df[df["symbol"] == "AAA"]["open"].to_numpy(float)
        assert f.entry_price == pytest.approx(o[6] * (1 + 0.0002))

    def test_a_candidate_on_the_final_bar_cannot_be_filled(self):
        df = pf.prepare_panel(_panel(("AAA",), n=20))
        last = df[df["symbol"] == "AAA"]["pos_in_symbol"].max()
        cand = pd.DataFrame([{"symbol": "AAA", "direction": "LONG", "atr_14": 4.0,
                             "score": 1.0, "pos_in_symbol": int(last),
                             "datetime": df.loc[df.pos_in_symbol == last, "datetime"].iloc[0]}])
        assert pf.resolve_fills(df, cand, _cfg()) == []

    def test_changing_future_bars_cannot_change_a_fill(self):
        """The strongest causality test: truncate the future, and the entry must
        be bit-identical. Only the EXIT may legitimately differ, because a stop
        or target later in the series is future information by definition."""
        df = _panel(("AAA",), n=60)
        prepped = pf.prepare_panel(df)
        cand = pd.DataFrame([{"symbol": "AAA", "direction": "LONG", "atr_14": 4.0,
                             "score": 1.0, "pos_in_symbol": 3,
                             "datetime": prepped[prepped.pos_in_symbol == 3]["datetime"].iloc[0]}])
        full = pf.resolve_fills(prepped, cand, _cfg())[0]
        truncated = prepped[prepped.pos_in_symbol <= 12]
        short = pf.resolve_fills(pf.prepare_panel(truncated), cand, _cfg())[0]
        assert full.entry_index == short.entry_index
        assert full.entry_time == short.entry_time
        assert full.entry_price == pytest.approx(short.entry_price)
        assert full.stop == pytest.approx(short.stop)
        assert full.target == pytest.approx(short.target)


# ── E2: stop before target, fill at-or-through ───────────────────────────────
class TestE2PessimisticExit:
    def test_stop_wins_when_both_levels_touch_the_same_bar(self):
        # bar 0 signals, bar 1 is the fill, bar 2 touches stop AND target.
        tape = _tape([1000.0, 1000.0, 1000.0, 1000.0],
                     [1000.0, 1001.0, 1010.0, 1001.0],
                     [1000.0, 999.5, 995.0, 999.5],
                     [1000.0, 1000.0, 1000.0, 1000.0], atr=4.0)
        prepped = pf.prepare_panel(tape)
        f = pf.resolve_fills(prepped, _cand(prepped, "AAA", 0), _cfg())[0]
        assert f.exit_reason == "STOP", "a bar touching both must resolve to the STOP"

    def test_gap_down_fills_through_the_stop_not_at_it(self):
        """The legacy engine set exit_price = stop, making every stop a best case."""
        tape = _tape([1000.0, 1000.0, 960.0, 960.0],
                     [1000.0, 1001.0, 962.0, 961.0],
                     [1000.0, 999.5, 959.0, 959.5],
                     [1000.0, 1000.0, 960.0, 960.0], atr=4.0)
        prepped = pf.prepare_panel(tape)
        f = pf.resolve_fills(prepped, _cand(prepped, "AAA", 0), _cfg())[0]
        assert f.exit_reason == "STOP"
        assert f.exit_price <= f.stop, "a gap must fill THROUGH the stop, not at it"
        assert f.gap_through_stop is True

    def test_stop_fill_is_never_better_than_the_stop_level(self):
        prepped = pf.prepare_panel(_panel(("AAA",), n=50))
        for f in pf.resolve_fills(prepped, _cand(prepped, "AAA", 1), _cfg()):
            if f.exit_reason == "STOP" and f.direction == "LONG":
                assert f.exit_price <= f.stop + 1e-9
            if f.exit_reason == "STOP" and f.direction == "SHORT":
                assert f.exit_price >= f.stop - 1e-9

    def test_short_gap_up_fills_through_the_stop(self):
        tape = _tape([1000.0, 1000.0, 1040.0, 1040.0],
                     [1000.0, 1001.0, 1042.0, 1041.0],
                     [1000.0, 999.5, 1038.0, 1039.0],
                     [1000.0, 1000.0, 1040.0, 1040.0], atr=4.0)
        prepped = pf.prepare_panel(tape)
        f = pf.resolve_fills(prepped, _cand(prepped, "AAA", 0, "SHORT"), _cfg())[0]
        assert f.exit_reason == "STOP" and f.exit_price >= f.stop
        assert f.gap_through_stop is True

    def test_target_exit_is_never_worse_than_the_target_level(self):
        tape = _tape([1000.0, 1000.0, 1000.0, 1000.0],
                     [1000.0, 1001.0, 1012.0, 1001.0],
                     [1000.0, 999.5, 999.5, 999.5],
                     [1000.0, 1000.0, 1008.0, 1000.0], atr=4.0)
        prepped = pf.prepare_panel(tape)
        f = pf.resolve_fills(prepped, _cand(prepped, "AAA", 0), _cfg())[0]
        assert f.exit_reason == "TARGET" and f.exit_price >= f.target


# ── E3: intraday square-off, never overnight ─────────────────────────────────
class TestE3IntradaySquareOff:
    def test_no_trade_ever_crosses_a_calendar_day(self):
        """The T5.1 defect: E3 anchored to the panel end, producing a 539-bar
        12-day 'intraday' trade."""
        days = []
        for d in range(6):
            t = pd.date_range(f"2024-01-{d + 1:02d} 09:15", periods=60, freq="5min")
            days.append(pd.DataFrame({
                "symbol": "AAA", "datetime": t, "date": t.date,
                "open": 1000.0, "high": 1001.0, "low": 999.0, "close": 1000.0,
                "bar_of_day": np.arange(60), "atr_14": np.full(60, 4.0)}))
        df = pf.prepare_panel(pd.concat(days, ignore_index=True))
        cand = pd.DataFrame([{"symbol": "AAA", "direction": "LONG", "atr_14": 0.01,
                             "score": 1.0, "pos_in_symbol": 0,
                             "datetime": df[df.pos_in_symbol == 0]["datetime"].iloc[0]}])
        f = pf.resolve_fills(df, cand, _cfg())[0]
        assert f.exit_reason == "EOD"
        assert f.entry_time.date() == f.exit_time.date(), \
            "an intraday strategy held overnight"
        assert f.exit_index == 59, "must square off at the LAST bar of the session"

    def test_a_huge_stop_never_extends_past_the_session(self):
        days = []
        for d in range(3):
            t = pd.date_range(f"2024-02-{d + 1:02d} 09:15", periods=40, freq="5min")
            days.append(pd.DataFrame({
                "symbol": "AAA", "datetime": t, "date": t.date,
                "open": 1000.0, "high": 1001.0, "low": 999.0, "close": 1000.0,
                "bar_of_day": np.arange(40), "atr_14": np.full(40, 0.001)}))
        df = pf.prepare_panel(pd.concat(days, ignore_index=True))
        cand = pd.DataFrame([{"symbol": "AAA", "direction": "LONG", "atr_14": 0.001,
                             "score": 1.0, "pos_in_symbol": 0,
                             "datetime": df[df.pos_in_symbol == 0]["datetime"].iloc[0]}])
        f = pf.resolve_fills(df, cand, _cfg())[0]
        assert f.exit_time.date() == f.entry_time.date()

    def test_holding_bars_are_bounded_by_the_session_length(self):
        days = []
        for d in range(4):
            t = pd.date_range(f"2024-03-{d + 1:02d} 09:15", periods=30, freq="5min")
            days.append(pd.DataFrame({
                "symbol": "AAA", "datetime": t, "date": t.date,
                "open": 1000.0, "high": 1001.0, "low": 999.0, "close": 1000.0,
                "bar_of_day": np.arange(30), "atr_14": np.full(30, 0.01)}))
        df = pf.prepare_panel(pd.concat(days, ignore_index=True))
        cand = pd.DataFrame([{"symbol": "AAA", "direction": "LONG", "atr_14": 0.01,
                             "score": 1.0, "pos_in_symbol": 0,
                             "datetime": df[df.pos_in_symbol == 0]["datetime"].iloc[0]}])
        assert pf.resolve_fills(df, cand, _cfg())[0].holding_bars <= 30


# ── E4: concurrency ──────────────────────────────────────────────────────────
class TestE4Concurrency:
    def _fill(self, sym, t0, t1, score=1.0):
        return pf.ResolvedFill(
            symbol=sym, direction="LONG", sign=1, atr_14=4.0, score=score,
            entry_index=0, exit_index=0, entry_time=pd.Timestamp(t0),
            exit_time=pd.Timestamp(t1), entry_price=1000.0, exit_price=1000.0,
            exit_reason="EOD", stop=996.0, target=1008.0, risk=4.0,
            mfe=0.0, mae=0.0, gap_through_stop=False, atr_governed=True)

    def test_ceiling_is_never_exceeded(self):
        fills = [self._fill(f"S{i}", "2024-01-01 09:20", "2024-01-01 10:00")
                 for i in range(10)]
        acc = pf.admit_by_concurrency(fills, 3)
        assert len(acc) == 3

    def test_a_retiring_position_frees_its_slot(self):
        fills = [self._fill("A", "2024-01-01 09:20", "2024-01-01 09:40"),
                 self._fill("B", "2024-01-01 09:20", "2024-01-01 09:40"),
                 self._fill("C", "2024-01-01 09:20", "2024-01-01 09:40"),
                 self._fill("D", "2024-01-01 09:45", "2024-01-01 10:00")]
        acc = pf.admit_by_concurrency(fills, 3)
        assert {f.symbol for f in acc} == {"A", "B", "C", "D"}, \
            "a position closing before the next entry must free the slot"

    def test_one_position_per_symbol_at_a_time(self):
        fills = [self._fill("A", "2024-01-01 09:20", "2024-01-01 10:00"),
                 self._fill("A", "2024-01-01 09:30", "2024-01-01 09:45")]
        assert len(pf.admit_by_concurrency(fills, 3)) == 1

    def test_higher_score_wins_a_contested_slot(self):
        fills = [self._fill("LOW", "2024-01-01 09:20", "2024-01-01 10:00", score=0.1),
                 self._fill("HIGH", "2024-01-01 09:20", "2024-01-01 10:00", score=9.9)]
        acc = pf.admit_by_concurrency(fills, 1)
        assert [f.symbol for f in acc] == ["HIGH"]


# ── P-12: the equity curve, audited independently ────────────────────────────
class TestP12EquityCurve:
    def test_curve_matches_an_independent_reconstruction(self):
        """A verification that shares a convention with its subject is not a
        verification, so this is reconstructed from the accounting identity."""
        df = _panel(("AAA", "BBB"), n=60)
        prepped = pf.prepare_panel(df)
        cand = pd.DataFrame([
            {"symbol": "AAA", "direction": "LONG", "atr_14": 4.0, "score": 2.0,
             "pos_in_symbol": 2, "datetime": prepped[prepped.pos_in_symbol == 2]["datetime"].iloc[0]},
            {"symbol": "AAA", "direction": "SHORT", "atr_14": 4.0, "score": 1.0,
             "pos_in_symbol": 20, "datetime": prepped[prepped.pos_in_symbol == 20]["datetime"].iloc[0]},
            {"symbol": "BBB", "direction": "LONG", "atr_14": 4.0, "score": 1.5,
             "pos_in_symbol": 5, "datetime": prepped[prepped.pos_in_symbol == 5]["datetime"].iloc[0]},
        ])
        trades = pf.size_fills(pf.admit_by_concurrency(
            pf.resolve_fills(prepped, cand, _cfg()), 3), _cfg())
        assert trades, "fixture produced no trades"
        a = pf.audit_equity_curve(prepped, trades, 100_000.0, max_samples=None)
        assert a["max_abs_delta"] == pytest.approx(0.0, abs=1e-6)

    def test_closing_balance_equals_the_sum_of_trade_pnl(self):
        df = pf.prepare_panel(_panel(("AAA", "BBB"), n=60))
        cand = pd.DataFrame([
            {"symbol": s, "direction": "LONG", "atr_14": 4.0, "score": 1.0,
             "pos_in_symbol": i,
             "datetime": df[(df.symbol == s) & (df.pos_in_symbol == i)]["datetime"].iloc[0]}
            for s, i in (("AAA", 3), ("BBB", 8))])
        trades = pf.size_fills(pf.resolve_fills(df, cand, _cfg()), _cfg())
        curve = pf.build_equity_curve(df, trades, 100_000.0)
        assert curve[-1]["equity"] == pytest.approx(
            100_000.0 + sum(t.net_pnl for t in trades), abs=1e-6)

    def test_a_long_position_is_charged_its_entry_exactly_once(self):
        """The T5.1 defect: debiting entry as cash AND marking at (close-entry)
        charged it twice, so equity fell by full notional on every position open."""
        df = pf.prepare_panel(_panel(("AAA",), n=30))
        cand = pd.DataFrame([{"symbol": "AAA", "direction": "LONG", "atr_14": 4.0,
                              "score": 1.0, "pos_in_symbol": 0,
                              "datetime": df[df.pos_in_symbol == 0]["datetime"].iloc[0]}])
        trades = pf.size_fills(pf.resolve_fills(df, cand, _cfg()), _cfg())
        assert len(trades) == 1
        curve = pf.build_equity_curve(df, trades, 100_000.0)
        t = trades[0]
        i = next(i for i, r in enumerate(curve) if r["date"] == t.entry_time)
        notional = t.entry_price * t.qty
        drop = 100_000.0 - curve[i]["equity"]
        assert abs(drop) < notional * 0.25, (
            f"equity fell Rs{drop:,.0f} on a Rs{notional:,.0f} position; the entry "
            f"leg is being charged more than once")

    def test_equity_never_jumps_by_more_than_its_open_exposure(self):
        df = pf.prepare_panel(_panel(("AAA", "BBB", "CCC"), n=70))
        cand = pd.DataFrame([
            {"symbol": s, "direction": "LONG", "atr_14": 4.0, "score": 1.0,
             "pos_in_symbol": i,
             "datetime": df[(df.symbol == s) & (df.pos_in_symbol == i)]["datetime"].iloc[0]}
            for s, i in (("AAA", 2), ("BBB", 4), ("CCC", 6))])
        trades = pf.size_fills(pf.resolve_fills(df, cand, _cfg()), _cfg())
        e = np.array([r["equity"] for r in pf.build_equity_curve(df, trades, 100_000.0)])
        exposure = sum(t.entry_price * t.qty for t in trades) or 1.0
        assert np.abs(np.diff(e)).max() < exposure, (
            f"largest single-bar equity move Rs{np.abs(np.diff(e)).max():,.0f} "
            f"exceeds total exposure Rs{exposure:,.0f}")


# ── P-11: metrics come from the curve ────────────────────────────────────────
class TestP11MetricsSource:
    def test_a_flat_equity_curve_has_zero_sharpe_and_zero_drawdown(self):
        flat = [{"date": pd.Timestamp("2024-01-01") + pd.Timedelta(minutes=5 * i),
                 "equity": 100_000.0} for i in range(200)]
        m = pf.metrics_mod.compute_metrics(flat, initial_capital=100_000.0)
        assert m["sharpe"] == pytest.approx(0.0, abs=1e-9)
        assert m["max_drawdown_pct"] == pytest.approx(0.0, abs=1e-9)

    def test_monotonic_growth_has_no_drawdown(self):
        up = [{"date": pd.Timestamp("2024-01-01") + pd.Timedelta(minutes=5 * i),
               "equity": 100_000.0 * (1.0001 ** i)} for i in range(200)]
        m = pf.metrics_mod.compute_metrics(up, initial_capital=100_000.0)
        assert m["max_drawdown_pct"] == pytest.approx(0.0, abs=1e-9)
        assert m["total_return_pct"] > 0

    def test_short_position_profits_when_price_falls(self):
        """The unsigned-cash-flow defect booked shorts as longs."""
        t0 = pd.Timestamp("2024-01-01 09:20")
        t1 = pd.Timestamp("2024-01-01 10:00")
        f = pf.SimTrade(
            symbol="AAA", direction="SHORT", sign=-1, atr_14=4.0, score=1.0,
            entry_index=0, exit_index=1, entry_time=t0, exit_time=t1,
            entry_price=1000.0, exit_price=990.0, exit_reason="TARGET",
            stop=1004.0, target=992.0, risk=4.0, mfe=10.0, mae=-1.0,
            gap_through_stop=False, atr_governed=True,
            qty=10, gross_pnl=(990.0 - 1000.0) * 10 * -1, costs=0.0,
            planned_loss=40.0, realised_r=2.5)
        assert f.gross_pnl == pytest.approx(100.0), "a falling price must profit a short"
        prepped = pf.prepare_panel(_bars("AAA", 20, price=1000.0))
        curve = pf.build_equity_curve(prepped, [f], 100_000.0)
        assert curve[-1]["equity"] == pytest.approx(100_100.0, abs=1e-6)


# ── config validation ────────────────────────────────────────────────────────
class TestExecutionConfig:
    def test_slot_gross_defaults_to_an_equal_split(self):
        assert _cfg(max_concurrent=3).slot_gross_pct == pytest.approx(1 / 3)
        assert _cfg(max_concurrent=4).slot_gross_pct == pytest.approx(0.25)

    def test_buying_power_is_capital_times_leverage(self):
        assert _cfg(leverage=3.0).buying_power == pytest.approx(300_000.0)
        assert _cfg(leverage=3.0).risk_budget == pytest.approx(1_000.0)

    def test_risk_implied_notional_matches_the_documented_ratio(self):
        assert _cfg().viability()["risk_implied_notional_x"] == pytest.approx(2.857, abs=0.01)

    def test_zero_concurrency_is_rejected(self):
        with pytest.raises(pf.PortfolioError):
            _cfg(max_concurrent=0)

    def test_empty_panel_is_refused_rather_than_reported_as_success(self):
        with pytest.raises(pf.PortfolioError):
            pf.prepare_panel(pd.DataFrame(columns=["symbol", "datetime"]))

    def test_missing_columns_are_named(self):
        with pytest.raises(pf.PortfolioError, match="high"):
            pf.prepare_panel(_panel(("AAA",)).drop(columns=["high"]))
