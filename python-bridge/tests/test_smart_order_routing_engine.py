r"""Unit Tests for Multi-Exchange Smart Order Routing (SOR) Structural Arbitrage Engine (Domain 200 / WP-CX)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.smart_order_routing_engine import (
    SmartOrderRoutingEngine,
    VenueBookSnapshot,
    RoutingStrategy,
)


@pytest.fixture
def sor() -> SmartOrderRoutingEngine:
    return SmartOrderRoutingEngine(
        min_arb_profit_bps=0.50,
        latency_penalty_factor_bps_per_ms=0.05,
    )


def test_structural_arbitrage_detection(sor: SmartOrderRoutingEngine):
    venues = [
        VenueBookSnapshot(
            venue_id="NSE",
            bid_price=24998.0,
            bid_size=1000.0,
            ask_price=25000.0,
            ask_size=500.0,
            taker_fee_bps=1.0,
            maker_rebate_bps=-0.5,
            latency_rtt_ms=2.0,
        ),
        VenueBookSnapshot(
            venue_id="BSE",
            bid_price=25012.0,  # Crosses with NSE ask!
            bid_size=600.0,
            ask_price=25014.0,
            ask_size=1000.0,
            taker_fee_bps=1.0,
            maker_rebate_bps=-0.5,
            latency_rtt_ms=4.0,
        ),
    ]

    arb = sor.detect_structural_arbitrage(venues)
    assert arb is not None
    assert arb.buy_venue == "NSE"
    assert arb.sell_venue == "BSE"
    assert arb.executable_size == 500.0
    assert arb.net_spread_after_fees > 5.0
    assert arb.net_profit_bps > 2.0
    assert arb.is_actionable is True


def test_no_arbitrage_when_fees_exceed_spread(sor: SmartOrderRoutingEngine):
    venues = [
        VenueBookSnapshot(
            venue_id="EXCHANGE_A",
            bid_price=25000.0,
            bid_size=1000.0,
            ask_price=25001.0,
            ask_size=500.0,
            taker_fee_bps=15.0,  # High fee destroys minor spread
            maker_rebate_bps=0.0,
            latency_rtt_ms=5.0,
        ),
        VenueBookSnapshot(
            venue_id="EXCHANGE_B",
            bid_price=25002.0,
            bid_size=1000.0,
            ask_price=25003.0,
            ask_size=500.0,
            taker_fee_bps=15.0,
            maker_rebate_bps=0.0,
            latency_rtt_ms=5.0,
        ),
    ]

    arb = sor.detect_structural_arbitrage(venues)
    assert arb is None


def test_water_filling_buy_allocation(sor: SmartOrderRoutingEngine):
    venues = [
        VenueBookSnapshot(
            venue_id="VENUE_CHEAP",
            bid_price=24999.0,
            bid_size=500.0,
            ask_price=25000.0,
            ask_size=600.0,
            taker_fee_bps=1.0,
            maker_rebate_bps=0.0,
            latency_rtt_ms=4.0,
        ),
        VenueBookSnapshot(
            venue_id="VENUE_EXPENSIVE",
            bid_price=24999.5,
            bid_size=500.0,
            ask_price=25001.0,
            ask_size=1200.0,
            taker_fee_bps=1.0,
            maker_rebate_bps=0.0,
            latency_rtt_ms=8.0,
        ),
    ]

    total_q = 1000.0
    plan = sor.optimize_routing_schedule(side="BUY", total_order_size=total_q, venues=venues)

    assert plan.side == "BUY"
    assert plan.total_order_size == total_q
    assert plan.strategy_used == RoutingStrategy.BALANCED_WATER_FILLING
    assert len(plan.allocations) == 2

    # First venue fills 600, second venue fills remaining 400
    assert plan.allocations[0].venue_id == "VENUE_CHEAP"
    assert plan.allocations[0].allocated_size == 600.0
    assert plan.allocations[1].venue_id == "VENUE_EXPENSIVE"
    assert plan.allocations[1].allocated_size == 400.0

    # Isochronous delay: (8 - 4) / 2 = 2.0ms on faster venue
    assert plan.allocations[0].dispatch_delay_ms == 2.0
    assert plan.allocations[1].dispatch_delay_ms == 0.0


def test_water_filling_sell_allocation(sor: SmartOrderRoutingEngine):
    venues = [
        VenueBookSnapshot(
            venue_id="VENUE_HIGH_BID",
            bid_price=25010.0,
            bid_size=400.0,
            ask_price=25012.0,
            ask_size=500.0,
            taker_fee_bps=1.0,
            maker_rebate_bps=0.0,
            latency_rtt_ms=3.0,
        ),
        VenueBookSnapshot(
            venue_id="VENUE_LOW_BID",
            bid_price=25008.0,
            bid_size=800.0,
            ask_price=25010.0,
            ask_size=500.0,
            taker_fee_bps=1.0,
            maker_rebate_bps=0.0,
            latency_rtt_ms=5.0,
        ),
    ]

    plan = sor.optimize_routing_schedule(side="SELL", total_order_size=600.0, venues=venues)
    assert plan.allocations[0].venue_id == "VENUE_HIGH_BID"
    assert plan.allocations[0].allocated_size == 400.0
    assert plan.allocations[1].venue_id == "VENUE_LOW_BID"
    assert plan.allocations[1].allocated_size == 200.0
    assert plan.estimated_price_improvement_bps > 0.0


def test_isochronous_arrival_delay(sor: SmartOrderRoutingEngine):
    venues = [
        VenueBookSnapshot("V1", 25000.0, 100.0, 25001.0, 100.0, 1.0, 0.0, latency_rtt_ms=2.0),
        VenueBookSnapshot("V2", 25000.0, 100.0, 25001.0, 100.0, 1.0, 0.0, latency_rtt_ms=6.0),
        VenueBookSnapshot("V3", 25000.0, 100.0, 25001.0, 100.0, 1.0, 0.0, latency_rtt_ms=10.0),
    ]

    plan = sor.optimize_routing_schedule("BUY", 300.0, venues)
    alloc_map = {a.venue_id: a.dispatch_delay_ms for a in plan.allocations}

    # Delays relative to 10.0ms: V1 -> (10-2)/2 = 4.0, V2 -> (10-6)/2 = 2.0, V3 -> 0.0
    assert alloc_map["V1"] == 4.0
    assert alloc_map["V2"] == 2.0
    assert alloc_map["V3"] == 0.0
    assert plan.isochronous_arrival_guaranteed is True
