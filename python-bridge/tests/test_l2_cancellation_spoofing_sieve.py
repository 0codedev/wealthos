"""
Unit Tests for Order Book Level-2 Cancellation Flow & Spoofing Phantom Liquidity Sieve (Domain 146 / WP-AV)
"""

import pytest

from services.l2_cancellation_spoofing_sieve import (
    L2CancellationSpoofingSieve,
    OrderBookEvent,
    SpoofingAnalysisReport,
)


@pytest.fixture
def sieve():
    return L2CancellationSpoofingSieve(
        db_path=":memory:",
        flash_distance_threshold_ticks=2.0,
    )


def test_organic_market_making_stream(sieve):
    # Benign stream: orders stay in book for 1200ms, moderate cancellations, healthy trades
    events = [
        OrderBookEvent("NEW", "BID", 25000.0, 500.0, 1000.0, order_id="ord_1"),
        OrderBookEvent("TRADE", "BID", 25000.0, 200.0, 1500.0),
        OrderBookEvent("CANCEL", "BID", 25000.0, 300.0, 2200.0, order_id="ord_1", distance_to_mid_ticks=4.0),
        OrderBookEvent("NEW", "BID", 25000.0, 400.0, 2300.0, order_id="ord_2"),
        OrderBookEvent("TRADE", "BID", 25000.0, 300.0, 2800.0),
    ]

    rep = sieve.analyze_event_stream("NIFTY", events, current_raw_depth=1000.0, side="BID")

    assert rep.cancellation_to_trade_ratio <= 1.0  # 300 / 500 = 0.60
    assert rep.avg_quote_lifetime_ms > 1000.0  # 1200 ms
    assert rep.flash_cancellation_ratio == 0.0  # cancelled at 4 ticks > 2 ticks threshold
    assert rep.phantom_hazard_index <= 0.25
    assert rep.regime == "ORGANIC_LIQUIDITY"
    assert rep.execution_directive == "PROCEED_STANDARD_ROUTING"
    assert rep.effective_depth >= 800.0


def test_predatory_spoofing_flash_cancellation(sieve):
    # Spoofing attack: 50,000 shares inserted, price ticks closer (1 tick), cancelled after 35 ms! Zero trades.
    events = [
        OrderBookEvent("NEW", "BID", 25000.0, 50000.0, 10000.0, order_id="spoof_1"),
        OrderBookEvent("CANCEL", "BID", 25000.0, 50000.0, 10035.0, order_id="spoof_1", distance_to_mid_ticks=1.0),
    ]

    rep = sieve.analyze_event_stream("NIFTY", events, current_raw_depth=50000.0, side="BID")

    assert rep.cancellation_to_trade_ratio >= 150.0  # 50,000 / max(1, 0) = 50,000
    assert rep.avg_quote_lifetime_ms == 35.0
    assert rep.flash_cancellation_ratio == 1.0  # 100% flash cancelled near mid
    assert rep.phantom_hazard_index >= 0.85
    assert rep.regime == "CRITICAL_PHANTOM_LIQUIDITY_TRAP"
    assert rep.execution_directive == "VETO_DEPTH_FADE_ARTIFICIAL_WALL"
    assert rep.effective_depth < 10000.0  # Severely discounted


def test_mild_phantom_noise(sieve):
    # Moderate activity: some fleeting orders but also genuine trading
    events = [
        OrderBookEvent("NEW", "ASK", 25050.0, 1000.0, 1000.0, order_id="ask_1"),
        OrderBookEvent("CANCEL", "ASK", 25050.0, 500.0, 1120.0, order_id="ask_1", distance_to_mid_ticks=1.5),
        OrderBookEvent("TRADE", "ASK", 25050.0, 100.0, 1200.0),
    ]

    rep = sieve.analyze_event_stream("NIFTY", events, current_raw_depth=2000.0, side="ASK")

    assert 0.25 < rep.phantom_hazard_index <= 0.80
    assert rep.regime in ("MILD_PHANTOM_NOISE", "ELEVATED_SPOOFING_ALERT")


def test_side_filtering_bid_vs_ask(sieve):
    events = [
        # Massive BID spoof
        OrderBookEvent("NEW", "BID", 24990.0, 20000.0, 1000.0, order_id="bid_spoof"),
        OrderBookEvent("CANCEL", "BID", 24990.0, 20000.0, 1020.0, order_id="bid_spoof", distance_to_mid_ticks=1.0),
        # Clean ASK flow
        OrderBookEvent("NEW", "ASK", 25010.0, 500.0, 1000.0, order_id="ask_clean"),
        OrderBookEvent("TRADE", "ASK", 25010.0, 500.0, 2000.0),
    ]

    rep_ask = sieve.analyze_event_stream("NIFTY", events, current_raw_depth=1000.0, side="ASK")
    assert rep_ask.regime == "ORGANIC_LIQUIDITY"
    assert rep_ask.phantom_hazard_index <= 0.25

    rep_bid = sieve.analyze_event_stream("NIFTY", events, current_raw_depth=20000.0, side="BID")
    assert rep_bid.regime == "CRITICAL_PHANTOM_LIQUIDITY_TRAP"
    assert rep_bid.phantom_hazard_index > 0.80


def test_sqlite_persistence(sieve):
    events = [
        OrderBookEvent("NEW", "BID", 25000.0, 500.0, 1000.0, order_id="ord_p"),
        OrderBookEvent("TRADE", "BID", 25000.0, 200.0, 1500.0),
    ]
    sieve.analyze_event_stream("PERSIST_SYM", events, current_raw_depth=500.0, side="BID")

    conn = sieve._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, side, raw_depth, effective_depth, regime FROM l2_spoofing_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_SYM"
    assert row[1] == "BID"
    assert row[2] == 500.0
    assert isinstance(row[4], str)
