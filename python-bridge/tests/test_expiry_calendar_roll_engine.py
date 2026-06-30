"""Unit tests for Expiry Calendar Roll Engine."""

import os
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.expiry_calendar_roll_engine import (
    RollConfig,
    RollPosition,
    PositionLeg,
    LiquiditySnapshot,
    RollPhase,
    RollAction,
    ExecutionMode,
    InstrumentKind,
    physical_delivery_margin_tier,
    margin_surge_active,
    sieve_stock_fo_positions,
    liquidity_cliff_detected,
    delta_pnl_roll,
    compute_roll_pnl,
    balance_roll_strikes,
    choose_execution_mode,
    LiquidationGuard,
    can_transition,
    next_index_expiry,
    next_stock_monthly_expiry,
    next_expiry,
    days_to_expiry,
    is_expiry_day,
    instrument_kind_for,
    ExpiryCalendarRollEngine,
)


def _ist(d, h=10, m=0):
    from zoneinfo import ZoneInfo
    return datetime(d.year, d.month, d.day, h, m, tzinfo=ZoneInfo("Asia/Kolkata"))


def test_instrument_kind():
    assert instrument_kind_for("NIFTY") == InstrumentKind.INDEX_WEEKLY.value
    assert instrument_kind_for("BANKNIFTY") == InstrumentKind.INDEX_WEEKLY.value
    assert instrument_kind_for("RELIANCE") == InstrumentKind.STOCK_MONTHLY.value


def test_next_index_expiry_weekday():
    # 2026-10-14 is Wednesday? Let's just check weekday correctness.
    now = _ist(date(2026, 10, 12))  # Monday
    d = next_index_expiry("NIFTY", now)  # Thursday
    assert d.weekday() == 3
    assert d >= now.date()


def test_next_stock_monthly_expiry_last_thursday():
    now = _ist(date(2026, 10, 1))
    d = next_stock_monthly_expiry(now)
    assert d.weekday() == 3
    # last thursday of October 2026
    assert d.day >= 22


def test_days_to_expiry():
    now = _ist(date(2026, 10, 20))
    assert days_to_expiry("2026-10-22", now) == 2


def test_is_expiry_day():
    now = _ist(date(2026, 10, 22))
    assert is_expiry_day("NIFTY", "2026-10-22", now) is True


def test_pd_margin_tiers():
    assert physical_delivery_margin_tier(4) == 0.20
    assert physical_delivery_margin_tier(3) == 0.40
    assert physical_delivery_margin_tier(2) == 0.60
    assert physical_delivery_margin_tier(1) == 1.00
    assert physical_delivery_margin_tier(0) == 1.00
    assert physical_delivery_margin_tier(5) == 0.0


def test_margin_surge_active():
    assert margin_surge_active(3) is True
    assert margin_surge_active(5) is False


def test_sieve_stock_positions():
    now = _ist(date(2026, 10, 20))
    pos = RollPosition(underlying="RELIANCE", instrument_kind=InstrumentKind.STOCK_MONTHLY.value,
                       is_stock_fo=True, physical_delivery=True, expiry="2026-10-22",
                       legs=[PositionLeg(side="CE", position="SHORT", strike=100, premium=5, quantity=-50)])
    decs = sieve_stock_fo_positions([pos], now, trigger_tier=0.40)
    assert len(decs) == 1
    assert decs[0]["action"] in ("ROLL", "CLOSE")


def test_liquidity_cliff_spread_explosion():
    now = _ist(date(2026, 10, 22), h=14, m=30)
    snap = LiquiditySnapshot(symbol="NIFTY", bid=100, ask=100.5, bid_qty=1000, ask_qty=1000,
                              baseline_spread_bps=1.0, baseline_depth=10000, is_expiry_day=True)
    # make spread huge by setting ask far
    snap2 = LiquiditySnapshot(symbol="NIFTY", bid=100, ask=103, bid_qty=100, ask_qty=100,
                              baseline_spread_bps=1.0, baseline_depth=10000, is_expiry_day=True)
    detected, diag = liquidity_cliff_detected(snap2, now)
    assert detected is True


def test_liquidity_cliff_not_expiry():
    now = _ist(date(2026, 10, 22), h=14, m=30)
    snap = LiquiditySnapshot(symbol="NIFTY", bid=100, ask=100.1, bid_qty=1000, ask_qty=1000,
                              baseline_spread_bps=1.0, baseline_depth=10000, is_expiry_day=False)
    detected, _ = liquidity_cliff_detected(snap, now)
    assert detected is False


def test_delta_pnl_roll():
    v = delta_pnl_roll(100.0, 110.0, 5.0, 2.0)
    assert v == 7.0


def test_compute_roll_pnl():
    pos = RollPosition(underlying="NIFTY", expiry="2026-10-22",
                       legs=[PositionLeg(side="CE", position="SHORT", strike=100, premium=5, quantity=-50, theta=-0.5)])
    new_legs = [PositionLeg(side="CE", position="SHORT", strike=100, premium=4, quantity=-50, theta=-0.3)]
    m = compute_roll_pnl(pos, new_legs, "2026-10-29")
    assert "delta_pnl_roll" in m


def test_balance_roll_strikes():
    legs = [
        PositionLeg(side="CE", position="SHORT", strike=100, delta=0.3, quantity=-1),
        PositionLeg(side="PE", position="SHORT", strike=90, delta=-0.25, quantity=-1),
    ]
    res = balance_roll_strikes(legs, target_delta=0.0, tolerance=0.1)
    assert "selected" in res
    assert "net_delta" in res


def test_choose_execution_mode_cliff():
    now = _ist(date(2026, 10, 22), h=14, m=30)
    snap = LiquiditySnapshot(symbol="NIFTY", bid=100, ask=103, bid_qty=10, ask_qty=10,
                              baseline_spread_bps=1.0, baseline_depth=10000, is_expiry_day=True)
    assert choose_execution_mode(snap, now, 0) == ExecutionMode.ATOMIC_SPREAD.value


def test_liquidation_guard():
    g = LiquidationGuard(max_attempts=2)
    assert g.can_roll("p1") is True
    g.record_attempt("p1")
    g.record_attempt("p1")
    assert g.can_roll("p1") is False
    orders = g.fail_safe_flatten_orders([RollPosition(position_id="p1", underlying="NIFTY", legs=[PositionLeg(side="CE", position="SHORT", strike=100, premium=5, quantity=-10)])], "test")
    assert len(orders) == 1
    assert orders[0]["fail_safe"] is True


def test_state_transitions():
    assert can_transition(RollPhase.IDLE, RollPhase.DETECT) is True
    assert can_transition(RollPhase.IDLE, RollPhase.EXECUTE) is False


def test_engine_run_cycle():
    engine = ExpiryCalendarRollEngine()
    now = _ist(date(2026, 10, 20))
    pos = RollPosition(underlying="RELIANCE", instrument_kind=InstrumentKind.STOCK_MONTHLY.value,
                       is_stock_fo=True, physical_delivery=True, expiry="2026-10-22",
                       legs=[PositionLeg(side="CE", position="SHORT", strike=100, premium=5, quantity=-50)])
    res = engine.run_cycle([pos], now=now)
    assert res["status"] == "ok"


def test_engine_plan_roll():
    engine = ExpiryCalendarRollEngine()
    pos = RollPosition(underlying="NIFTY", expiry="2026-10-22",
                       legs=[PositionLeg(side="CE", position="SHORT", strike=100, premium=5, quantity=-50, delta=0.3)])
    new_legs = [PositionLeg(side="CE", position="SHORT", strike=105, premium=4, quantity=-50, delta=0.28)]
    plan = engine.plan_roll(pos, "2026-10-29", new_legs)
    assert plan.mode in (ExecutionMode.ATOMIC_SPREAD.value, ExecutionMode.LEG_BY_LEG.value)
