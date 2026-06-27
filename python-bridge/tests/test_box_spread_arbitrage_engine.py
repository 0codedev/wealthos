"""Unit tests for Box Spread Arbitrage Engine."""

import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.box_spread_arbitrage_engine import (
    OptionStyle,
    BoxSide,
    ExecutionStatus,
    OptionQuote,
    BoxSpread,
    BoxSpreadLeg,
    BoxCandidate,
    FrictionBreakdown,
    ExecutionReport,
    ParityViolation,
    put_call_parity_residual,
    parity_violation,
    task_raw_put_forward_spread,
    scan_parity_violations,
    box_width,
    box_market_price_mid,
    box_pv,
    box_mispricing,
    implied_box_rate,
    annualized_box_yield,
    friction_cost_box,
    min_mispricing_threshold,
    validate_box_invariants,
    has_early_assignment_risk,
    scan_box_spreads,
    AtomicBoxExecutor,
    OrderPlacer,
    BoxSpreadArbitrageEngine,
    FIXTURE_CHAIN_NIFTY,
    EUROPEAN_INDEX_UNDERLYINGS,
    ATOMIC_FILL_TIMEOUT_MS,
)


def test_parity_residual_zero():
    # C - P = S - K*disc
    r = 0.07; T = 30/365.0
    K = 22000.0; S = 22250.0
    disc = __import__("math").exp(-r*T)
    synthetic = S - K*disc
    C = 400.0; P = C - synthetic
    res = put_call_parity_residual(C, P, S, K, r, T)
    assert res == pytest.approx(0.0, abs=1e-6)


def test_parity_residual_violation():
    res = put_call_parity_residual(400.0, 100.0, 22250.0, 22000.0, 0.07, 30/365.0)
    assert res != 0.0


def test_task_raw_spread():
    v = task_raw_put_forward_spread(100.0, 22250.0, 22000.0, 0.07, 30/365.0)
    assert isinstance(v, float)


def test_scan_parity():
    chain = {
        22000: {"CE": {"bid": 410, "ask": 412, "volume": 100}, "PE": {"bid": 120, "ask": 122, "volume": 100}},
    }
    out = scan_parity_violations(chain, spot=22250.0, T=7/365.0, threshold=0.0)
    assert len(out) == 1
    assert isinstance(out[0], ParityViolation)


def test_box_width():
    assert box_width(22000, 22500) == 500.0
    assert box_width(22500, 22000) == 500.0


def test_box_market_price_mid():
    # C1 - C2 + P2 - P1
    v = box_market_price_mid(411.0, 331.0, 121.0, 151.0)
    assert v == pytest.approx(411 - 331 + 151 - 121)


def test_box_pv():
    import math
    w = 500.0; r = 0.07; T = 30/365.0
    assert box_pv(w, r, T) == pytest.approx(w * math.exp(-r*T))


def test_box_mispricing():
    w = 500.0; mp = 490.0
    assert box_mispricing(mp, w, 0.07, 30/365.0) == pytest.approx(box_pv(w, 0.07, 30/365.0) - mp)


def test_implied_rate():
    rate = implied_box_rate(490.0, 500.0, 30/365.0)
    assert rate > 0


def test_annualized_yield():
    y = annualized_box_yield(490.0, 500.0, 30/365.0)
    assert y > 0


def test_friction_positive():
    fb = friction_cost_box(411.0, 331.0, 121.0, 151.0, quantity=50, width=500.0)
    assert isinstance(fb, FrictionBreakdown)
    assert fb.total_friction > 0
    assert fb.per_unit_friction > 0


def test_min_threshold():
    thr = min_mispricing_threshold(411.0, 331.0, 121.0, 151.0, quantity=50, width=500.0)
    assert thr > 0


def test_validate_invariants_ok():
    box = BoxSpread(underlying="NIFTY", expiry="2026-10-22", k1=22000, k2=22500,
                    call_k1=411, call_k2=101, put_k1=121, put_k2=321, quantity=50)
    assert validate_box_invariants(box) is None


def test_validate_invariants_bad_underlying():
    box = BoxSpread(underlying="RELIANCE", expiry="2026-10-22", k1=22000, k2=22500,
                    call_k1=411, call_k2=101, put_k1=121, put_k2=321, quantity=50)
    with pytest.raises(ValueError):
        validate_box_invariants(box)


def test_validate_invariants_bad_strikes():
    box = BoxSpread(underlying="NIFTY", expiry="2026-10-22", k1=22500, k2=22000,
                    call_k1=411, call_k2=101, put_k1=121, put_k2=321, quantity=50)
    with pytest.raises(ValueError):
        validate_box_invariants(box)


def test_early_assignment():
    assert has_early_assignment_risk("NIFTY", "EUROPEAN") is False
    assert has_early_assignment_risk("NIFTY", "AMERICAN") is True


def test_scan_box_spreads():
    spot = 22250.0; T = 7/365.0
    cands = scan_box_spreads(FIXTURE_CHAIN_NIFTY, underlying="NIFTY", expiry="2026-10-22",
                             spot=spot, r=0.07, T=T, quantity=50, lot_size=50, min_volume=1000)
    assert isinstance(cands, list)
    for c in cands:
        assert isinstance(c, BoxCandidate)


def test_atomic_success():
    placer = OrderPlacer()
    ex = AtomicBoxExecutor(placer=placer, timeout_ms=250)
    box = BoxSpread(underlying="NIFTY", expiry="2026-10-22", k1=22000, k2=22500,
                    call_k1=411, call_k2=101, put_k1=121, put_k2=321, quantity=2)
    rep = ex.execute(box, direction=BoxSide.BUY.value)
    assert rep.status == ExecutionStatus.SUCCESS
    assert rep.legs_filled == 4
    assert rep.fill_window_ms <= 250


def test_atomic_timeout_squares_off():
    class SlowPlacer(OrderPlacer):
        def place(self, order):
            time.sleep(0.1)
            return super().place(order)
    ex = AtomicBoxExecutor(placer=SlowPlacer(), timeout_ms=50)
    box = BoxSpread(underlying="NIFTY", expiry="2026-10-22", k1=22000, k2=22500,
                    call_k1=411, call_k2=101, put_k1=121, put_k2=321, quantity=2)
    rep = ex.execute(box)
    assert rep.status == ExecutionStatus.ABORTED
    assert len(rep.square_off_orders) >= 1


def test_engine_class():
    eng = BoxSpreadArbitrageEngine()
    cands = eng.scan(FIXTURE_CHAIN_NIFTY, underlying="NIFTY", spot=22250.0, T=7/365.0, quantity=50)
    assert isinstance(cands, list)


def test_friction_to_dict():
    fb = friction_cost_box(411.0, 331.0, 121.0, 151.0, quantity=50, width=500.0)
    d = fb.to_dict()
    assert "totalFriction" in d


def test_candidate_to_dict():
    spot = 22250.0; T = 7/365.0
    cands = scan_box_spreads(FIXTURE_CHAIN_NIFTY, underlying="NIFTY", expiry="2026-10-22",
                             spot=spot, r=0.07, T=T, quantity=50, min_volume=1000)
    if cands:
        d = cands[0].to_dict()
        assert "mispricingExec" in d
        assert "netAnnualizedYield" in d
