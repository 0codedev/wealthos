r"""Unit Tests for Multi-Exchange Continuous Double Auction Clearing & Latency Arb Sieve (Domain 212 / WP-DJ)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import pytest
from services.continuous_double_auction_clearing_sieve import (
    ContinuousDoubleAuctionClearingSieve,
    OrderTier,
    VenueOrderBook,
    AuctionCrossingStatus,
    RoutingExecutionDirective,
)


@pytest.fixture
def sieve() -> ContinuousDoubleAuctionClearingSieve:
    return ContinuousDoubleAuctionClearingSieve(
        min_net_edge_bps=1.00,
        arb_half_life_ms=1.50,
        modeled_slippage_bps=0.30,
    )


def test_auction_clearing_empty_books(sieve: ContinuousDoubleAuctionClearingSieve):
    res = sieve.compute_auction_clearing_price([], [])
    assert res.clearing_price == 0.0
    assert res.matched_volume == 0.0


def test_auction_clearing_price_maximization(sieve: ContinuousDoubleAuctionClearingSieve):
    # Bids willing to buy at or below:
    # 102.0: 100 shares
    # 101.0: 200 shares (cum = 300)
    # 100.0: 300 shares (cum = 600)
    bids = [
        OrderTier(price=102.0, volume=100.0),
        OrderTier(price=101.0, volume=200.0),
        OrderTier(price=100.0, volume=300.0),
    ]

    # Asks willing to sell at or above:
    # 100.0: 150 shares (cum = 150)
    # 101.0: 250 shares (cum = 400)
    # 102.0: 200 shares (cum = 600)
    asks = [
        OrderTier(price=100.0, volume=150.0),
        OrderTier(price=101.0, volume=250.0),
        OrderTier(price=102.0, volume=200.0),
    ]

    # At P=101.0:
    # cum_bid = 300 (bids at 102 and 101)
    # cum_ask = 400 (asks at 100 and 101)
    # matched = min(300, 400) = 300 shares!
    res = sieve.compute_auction_clearing_price(bids, asks)
    assert res.clearing_price == 101.0
    assert res.matched_volume == 300.0
    assert res.surplus_imbalance == -100.0 # 300 bid vs 400 ask
    assert res.unfilled_ask_volume == 100.0


def test_cross_venue_uncrossed_books(sieve: ContinuousDoubleAuctionClearingSieve):
    venue_nse = VenueOrderBook(
        venue_name="NSE",
        bids=[OrderTier(price=2500.0, volume=500.0)],
        asks=[OrderTier(price=2500.50, volume=400.0)],
        one_way_latency_ms=0.40,
        taker_fee_bps=0.50,
    )
    venue_bse = VenueOrderBook(
        venue_name="BSE",
        bids=[OrderTier(price=2499.80, volume=300.0)],
        asks=[OrderTier(price=2500.40, volume=350.0)],
        one_way_latency_ms=0.45,
        taker_fee_bps=0.50,
    )

    arb = sieve.evaluate_cross_venue_arbitrage(venue_nse, venue_bse)
    assert arb.crossing_status == AuctionCrossingStatus.NO_CROSS_EQUILIBRIUM
    assert arb.recommended_directive == RoutingExecutionDirective.STANDBY_MONITOR
    assert arb.max_executable_volume == 0.0


def test_cross_venue_executable_arbitrage(sieve: ContinuousDoubleAuctionClearingSieve):
    # Crossed: BSE Bid is 2502.00, NSE Ask is 2500.00
    venue_nse = VenueOrderBook(
        venue_name="NSE",
        bids=[OrderTier(price=2499.50, volume=500.0)],
        asks=[OrderTier(price=2500.00, volume=200.0)],
        one_way_latency_ms=0.30,
        taker_fee_bps=0.60,
    )
    venue_bse = VenueOrderBook(
        venue_name="BSE",
        bids=[OrderTier(price=2502.00, volume=300.0)],
        asks=[OrderTier(price=2502.50, volume=400.0)],
        one_way_latency_ms=0.35,
        taker_fee_bps=0.60,
    )

    arb = sieve.evaluate_cross_venue_arbitrage(venue_nse, venue_bse)
    assert arb.crossing_status == AuctionCrossingStatus.ARBITRAGE_CROSS_DETECTED
    assert arb.recommended_directive == RoutingExecutionDirective.EXECUTE_SYNCHRONOUS_CROSS
    assert arb.venue_buy == "NSE"
    assert arb.venue_sell == "BSE"
    assert arb.buy_price == 2500.00
    assert arb.sell_price == 2502.00
    assert arb.max_executable_volume == 200.0
    assert arb.gross_edge_bps > 7.0
    assert arb.net_edge_bps > 5.0
    assert arb.race_survival_probability > 0.50
    assert "Dispatch immediate child sweep!" in arb.tactical_directive


def test_cross_venue_latency_trap(sieve: ContinuousDoubleAuctionClearingSieve):
    # Barely crossed: BSE Bid is 2500.05, NSE Ask is 2500.00 (gross 0.20 bps)
    # Fees are 0.80 + 0.80 = 1.60 bps -> net edge is negative!
    venue_nse = VenueOrderBook(
        venue_name="BINANCE",
        bids=[OrderTier(price=2499.90, volume=100.0)],
        asks=[OrderTier(price=2500.00, volume=50.0)],
        one_way_latency_ms=2.50,
        taker_fee_bps=0.80,
    )
    venue_bse = VenueOrderBook(
        venue_name="OKX",
        bids=[OrderTier(price=2500.05, volume=80.0)],
        asks=[OrderTier(price=2500.15, volume=60.0)],
        one_way_latency_ms=2.50,
        taker_fee_bps=0.80,
    )

    arb = sieve.evaluate_cross_venue_arbitrage(venue_nse, venue_bse)
    assert arb.crossing_status == AuctionCrossingStatus.LATENCY_TRAP_DISQUALIFIED
    assert arb.recommended_directive == RoutingExecutionDirective.REJECT_EXECUTION_STALE_CROSS
    assert arb.net_edge_bps < 0.0
    assert "Reject to prevent orphan fill" in arb.tactical_directive
