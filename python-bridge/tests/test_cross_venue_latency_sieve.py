"""
Unit tests for Domain 176 (WP-BZ): Cross-Venue Latency & Sub-Millisecond Order Routing Sieve
"""

import pytest
from services.cross_venue_latency_sieve import (
    CrossVenueLatencySieve,
    VenueQuote,
    CrossVenueReport,
)


def test_calculate_race_win_probability():
    sieve = CrossVenueLatencySieve(jitter_std_ms=0.40)
    # Our latency is 1.0ms, competitor is 2.0ms -> 1.0ms advantage
    p_win = sieve.calculate_race_win_probability(our_latency_ms=1.0, competitor_latency_ms=2.0)
    assert p_win > 0.95

    # Our latency is 2.0ms, competitor is 1.0ms -> 1.0ms disadvantage
    p_lose = sieve.calculate_race_win_probability(our_latency_ms=2.0, competitor_latency_ms=1.0)
    assert p_lose < 0.05

    # Equal latency
    p_tie = sieve.calculate_race_win_probability(our_latency_ms=1.5, competitor_latency_ms=1.5)
    assert abs(p_tie - 0.50) < 1e-4


def test_evaluate_arbitrage_profitable_win():
    sieve = CrossVenueLatencySieve(jitter_std_ms=0.30)
    # Venue A (NSE): Ask 100.0, Fee 1 bps, Latency 0.8ms
    quote_nse = VenueQuote(
        venue_name="NSE",
        bid_price=99.95,
        ask_price=100.00,
        bid_qty=5000.0,
        ask_qty=5000.0,
        fee_bps=1.0,
        latency_ms=0.8,
    )
    # Venue B (BSE): Bid 100.20, Fee 1 bps, Latency 0.9ms
    # Gross spread = 100.20 - 100.00 = +0.20 (+20 bps), Net = 20 - 2 = +18 bps!
    quote_bse = VenueQuote(
        venue_name="BSE",
        bid_price=100.20,
        ask_price=100.25,
        bid_qty=4000.0,
        ask_qty=4000.0,
        fee_bps=1.0,
        latency_ms=0.9,
    )

    # Competitor latency is 2.0ms -> Our 0.9ms has clear advantage
    rep = sieve.evaluate_arbitrage_opportunity("RELIANCE", quote_nse, quote_bse, competitor_latency_ms=2.0)
    assert rep.symbol == "RELIANCE"
    assert rep.net_spread_bps > 15.0
    assert rep.win_probability > 0.90
    assert rep.regime == "CROSS_VENUE_LATENCY_ARBITRAGE_ACTIVE"
    assert "BUY_NSE_SELL_BSE" in rep.trade_directive


def test_evaluate_arbitrage_adverse_selection():
    sieve = CrossVenueLatencySieve(jitter_std_ms=0.30)
    # Arb spread exists, but our network connection is slow (3.5ms vs competitor 1.5ms)
    quote_nse = VenueQuote(
        venue_name="NSE", bid_price=99.95, ask_price=100.00, bid_qty=5000.0, ask_qty=5000.0, fee_bps=1.0, latency_ms=3.5
    )
    quote_bse = VenueQuote(
        venue_name="BSE", bid_price=100.20, ask_price=100.25, bid_qty=4000.0, ask_qty=4000.0, fee_bps=1.0, latency_ms=3.5
    )

    rep = sieve.evaluate_arbitrage_opportunity("TCS", quote_nse, quote_bse, competitor_latency_ms=1.5)
    assert rep.net_spread_bps > 0.0
    assert rep.win_probability < 0.20  # We will lose the race
    assert rep.regime == "RACE_ADVERSE_SELECTION_DEFICIT"
    assert rep.trade_directive == "STAND_ASIDE_HIGH_COMPETITOR_WIN_PROBABILITY"


def test_network_latency_spike_safety_halt():
    sieve = CrossVenueLatencySieve(max_tolerable_latency_ms=20.0)
    # Venue B experiences major network fiber cut / packet loss (50ms latency)
    quote_nse = VenueQuote(
        venue_name="NSE", bid_price=100.0, ask_price=100.05, bid_qty=1000.0, ask_qty=1000.0, fee_bps=1.0, latency_ms=1.0
    )
    quote_bse = VenueQuote(
        venue_name="BSE", bid_price=100.1, ask_price=100.15, bid_qty=1000.0, ask_qty=1000.0, fee_bps=1.0, latency_ms=55.0
    )

    rep = sieve.evaluate_arbitrage_opportunity("INFY", quote_nse, quote_bse)
    assert rep.regime == "NETWORK_LATENCY_SPIKE_HALT"
    assert rep.trade_directive == "HALT_CROSS_VENUE_ROUTING_LATENCY_SPIKE"


def test_sqlite_persistence():
    sieve = CrossVenueLatencySieve(db_path=":memory:")
    q_a = VenueQuote(venue_name="NSE", bid_price=100.0, ask_price=100.05, bid_qty=500.0, ask_qty=500.0, fee_bps=1.0, latency_ms=1.0)
    q_b = VenueQuote(venue_name="BSE", bid_price=100.0, ask_price=100.05, bid_qty=500.0, ask_qty=500.0, fee_bps=1.0, latency_ms=1.2)

    rep = sieve.evaluate_arbitrage_opportunity("WIPRO", q_a, q_b)
    assert rep.symbol == "WIPRO"

    rows = sieve.get_latest_telemetry(5)
    assert len(rows) == 1
    assert rows[0][0] == "WIPRO"
    assert rows[0][1] == "NSE"
