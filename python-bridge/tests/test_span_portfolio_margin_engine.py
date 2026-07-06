"""Unit tests for span_portfolio_margin_engine."""

import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.span_portfolio_margin_engine import (
    Exchange, StrategyType, PositionSide, OptionType,
    OptionLeg, StrategyBook, MarginBreakdown, CrossMarginResult,
    HeadroomStatus, SequenceStep, DispatchResult, FillAck,
    SPANMarginCalculator, CrossMarginCalculator, HeadroomGuard,
    InMemoryOrderPlacer, SequenceGovernor, SpanPortfolioMarginEngine,
    build_iron_condor_book, build_ratio_spread_book, build_calendar_roll_book,
    build_box_spread_book,
    FIXTURE_IRON_CONDOR_NIFTY, FIXTURE_RATIO_SPREAD_NIFTY,
    FIXTURE_CALENDAR_ROLL_NIFTY, FIXTURE_BOX_SPREAD_NIFTY,
    FIXTURE_SENSEX_IRON_CONDOR, FIXTURE_MCX_IRON_CONDOR,
    FIXTURE_MULTI_EXCHANGE_BOOKS, FIXTURE_HEADROOM_OK, FIXTURE_HEADROOM_LOW,
    FILL_ACK_TIMEOUT_MS, HEADROOM_THRESHOLD,
    compute_margin, check_headroom, build_sequence,
)


def test_fixtures_load():
    assert FIXTURE_IRON_CONDOR_NIFTY.strategy == StrategyType.IRON_CONDOR.value
    assert len(FIXTURE_IRON_CONDOR_NIFTY.legs) == 4
    assert FIXTURE_RATIO_SPREAD_NIFTY.strategy == StrategyType.RATIO_SPREAD.value
    assert FIXTURE_CALENDAR_ROLL_NIFTY.strategy == StrategyType.CALENDAR_ROLL.value
    assert FIXTURE_BOX_SPREAD_NIFTY.strategy == StrategyType.BOX_SPREAD.value


def test_margin_iron_condor_positive():
    eng = SpanPortfolioMarginEngine()
    m = eng.margin_for_book(FIXTURE_IRON_CONDOR_NIFTY)
    assert isinstance(m, MarginBreakdown)
    assert m.total_margin >= 0
    assert m.span_margin >= 0
    assert m.exposure_margin >= 0
    assert len(m.scenario_losses) == 16


def test_margin_all_strategies():
    eng = SpanPortfolioMarginEngine()
    for book in [FIXTURE_IRON_CONDOR_NIFTY, FIXTURE_RATIO_SPREAD_NIFTY,
                 FIXTURE_CALENDAR_ROLL_NIFTY, FIXTURE_BOX_SPREAD_NIFTY]:
        m = eng.margin_for_book(book)
        assert m.total_margin >= 0


def test_hedged_reduces_vs_naked():
    # A hedged iron condor should have lower exposure than a naked short strangle
    ic = FIXTURE_IRON_CONDOR_NIFTY
    eng = SpanPortfolioMarginEngine()
    m_ic = eng.margin_for_book(ic)
    # naked: remove long wings
    naked = build_iron_condor_book(underlying="NIFTY", exchange="NSE", underlying_price=22000.0,
                                  short_ce_strike=22200.0, short_pe_strike=21800.0,
                                  long_ce_strike=22400.0, long_pe_strike=21600.0,
                                  quantity=1, lot_size=50)
    # make it naked by dropping longs
    naked.legs = [l for l in naked.legs if l.is_short()]
    naked.strategy = StrategyType.CUSTOM.value
    m_naked = eng.margin_for_book(naked)
    assert m_ic.exposure_margin <= m_naked.exposure_margin + 1e-6


def test_cross_margin():
    eng = SpanPortfolioMarginEngine()
    margins, cross = eng.margin_for_books(FIXTURE_MULTI_EXCHANGE_BOOKS)
    assert isinstance(cross, CrossMarginResult)
    assert cross.gross_total >= cross.net_total
    assert cross.net_total >= 0
    assert cross.benefit >= 0


def test_cross_margin_mcq_no_benefit():
    # MCX vs NSE should have 0 benefit
    cm = CrossMarginCalculator()
    r = cm.calculate({"NSE_NIFTY": 100000.0, "MCX_ANY": 50000.0})
    # find pair benefit
    mcx_pair = [p for p in r.pairs if "MCX" in str(p["pair"])]
    assert all(p.get("benefit", 0) == 0 for p in mcx_pair)


def test_headroom_ok():
    hs = check_headroom(free=500000.0, total=1000000.0)
    assert isinstance(hs, HeadroomStatus)
    assert hs.throttle is False
    assert hs.free_pct == 0.5


def test_headroom_low_throttle():
    hs = check_headroom(free=100000.0, total=1000000.0)
    assert hs.throttle is True
    assert hs.free_pct == 0.1


def test_headroom_threshold_boundary():
    hs = check_headroom(free=200000.0, total=1000000.0)
    # exactly 20% -> not below threshold -> no throttle
    assert hs.throttle is False
    hs2 = check_headroom(free=199999.0, total=1000000.0)
    assert hs2.throttle is True


def test_sequence_build_order():
    steps = build_sequence(FIXTURE_IRON_CONDOR_NIFTY)
    assert len(steps) == 2
    assert steps[0].phase == "HEDGE"
    assert steps[1].phase == "SHORT"
    # hedge step contains long legs
    long_ids = [l.leg_id for l in FIXTURE_IRON_CONDOR_NIFTY.long_legs()]
    assert set(steps[0].leg_ids) == set(long_ids)


def test_sequence_hedge_first_dispatch():
    book = FIXTURE_IRON_CONDOR_NIFTY
    placer = InMemoryOrderPlacer(latency_ms=10.0)
    gov = SequenceGovernor()
    res = gov.dispatch_sequence(book, placer.place_order)
    assert res.status == "success"
    assert res.aborted is False
    # first step acked
    assert res.steps[0].status == "ACKED"
    assert res.steps[1].status == "ACKED"
    # 4 orders
    assert len(res.orders) == 4


def test_sequence_aborts_on_hedge_timeout():
    book = FIXTURE_IRON_CONDOR_NIFTY
    # placer with latency > 200ms
    placer = InMemoryOrderPlacer(latency_ms=250.0)
    gov = SequenceGovernor(fill_ack_timeout_ms=200)
    res = gov.dispatch_sequence(book, placer.place_order)
    assert res.aborted is True
    assert res.status == "failed"
    # short leg should not have been routed
    short_orders = [o for o in res.orders if o["phase"] == "SHORT"]
    assert len(short_orders) == 0


def test_sequence_aborts_on_hedge_rejection():
    book = FIXTURE_IRON_CONDOR_NIFTY
    long_ids = {l.leg_id for l in book.long_legs()}
    # fail one hedge leg
    placer = InMemoryOrderPlacer(latency_ms=5.0, fail_legs={list(long_ids)[0]})
    gov = SequenceGovernor()
    res = gov.dispatch_sequence(book, placer.place_order)
    assert res.aborted is True
    short_orders = [o for o in res.orders if o["phase"] == "SHORT"]
    assert len(short_orders) == 0


def test_headroom_throttles_dispatch():
    book = FIXTURE_IRON_CONDOR_NIFTY
    placer = InMemoryOrderPlacer(latency_ms=5.0)
    gov = SequenceGovernor()
    hs = HeadroomStatus(free_collateral=100000.0, total_collateral=1000000.0,
                       free_pct=0.1, threshold=0.2, throttle=True)
    res = gov.dispatch_sequence(book, placer.place_order, headroom=hs)
    assert res.status == "throttled"
    assert res.aborted is True
    assert len(placer.calls) == 0


def test_dispatch_with_headroom_engine():
    book = FIXTURE_IRON_CONDOR_NIFTY
    placer = InMemoryOrderPlacer(latency_ms=5.0)
    eng = SpanPortfolioMarginEngine()
    res = eng.dispatch(book, placer.place_order, free_collateral=500000.0, total_collateral=1000000.0)
    assert res.status == "success"
    res2 = eng.dispatch(book, placer.place_order, free_collateral=100000.0, total_collateral=1000000.0)
    assert res2.status == "throttled"


def test_fill_ack_latency_recorded():
    book = FIXTURE_IRON_CONDOR_NIFTY
    placer = InMemoryOrderPlacer(latency_ms=12.0)
    gov = SequenceGovernor()
    res = gov.dispatch_sequence(book, placer.place_order)
    assert res.total_latency_ms >= 0
    for s in res.steps:
        for a in s.acks:
            assert a.latency_ms >= 0


def test_async_dispatch():
    import asyncio
    book = FIXTURE_IRON_CONDOR_NIFTY
    placer = InMemoryOrderPlacer(latency_ms=5.0)

    async def main():
        eng = SpanPortfolioMarginEngine()
        res = await eng.dispatch_async(book, placer.place_order,
                                      free_collateral=500000.0, total_collateral=1000000.0)
        return res

    res = asyncio.run(main())
    assert res.status == "success"


def test_leg_to_order_payload():
    book = FIXTURE_IRON_CONDOR_NIFTY
    gov = SequenceGovernor()
    leg = book.legs[0]
    p = gov.leg_to_order_payload(leg, book)
    assert "symbol" in p
    assert p["action"] in ("BUY", "SELL")
    assert p["quantity"] > 0


def test_scenario_count():
    calc = SPANMarginCalculator()
    m = calc.compute(FIXTURE_IRON_CONDOR_NIFTY)
    assert len(m.scenario_losses) == 16


def test_multi_exchange_keys():
    eng = SpanPortfolioMarginEngine()
    margins, cross = eng.margin_for_books(FIXTURE_MULTI_EXCHANGE_BOOKS)
    assert len(margins) == 3
    assert len(cross.per_exchange) == 3


def test_headroom_from_collateral_manager_none():
    hs = HeadroomGuard().from_collateral_manager(None)
    assert isinstance(hs, HeadroomStatus)


def test_compute_margin_convenience():
    m = compute_margin(FIXTURE_IRON_CONDOR_NIFTY)
    assert m.total_margin >= 0


def test_builders():
    b = build_iron_condor_book()
    assert b.strategy == StrategyType.IRON_CONDOR.value
    b2 = build_ratio_spread_book()
    assert b2.strategy == StrategyType.RATIO_SPREAD.value
    b3 = build_calendar_roll_book()
    assert b3.strategy == StrategyType.CALENDAR_ROLL.value
    b4 = build_box_spread_book()
    assert b4.strategy == StrategyType.BOX_SPREAD.value
