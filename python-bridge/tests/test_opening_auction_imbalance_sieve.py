"""
Unit tests for Domain 168 (WP-BR): Intraday Opening Auction Microstructure Imbalance & Price Discovery Sieve
"""

import pytest
from services.opening_auction_imbalance_sieve import (
    AuctionOrder,
    OpeningAuctionImbalanceSieve,
    EquilibriumResult,
    OpeningAuctionReport,
)


def test_calculate_equilibrium_maximum_matched():
    sieve = OpeningAuctionImbalanceSieve()
    orders = [
        # Buyers willing to buy at or below their limit
        AuctionOrder(price=100.0, quantity=500.0, side="BUY"),
        AuctionOrder(price=101.0, quantity=800.0, side="BUY"),
        AuctionOrder(price=102.0, quantity=1000.0, side="BUY"),
        # Sellers willing to sell at or above their limit
        AuctionOrder(price=101.0, quantity=1200.0, side="SELL"),
        AuctionOrder(price=102.0, quantity=700.0, side="SELL"),
    ]
    eq = sieve.calculate_equilibrium(orders, prior_close=100.0)
    # At 101.0:
    # Cum Buy (>=101.0): 800 + 1000 = 1800
    # Cum Sell (<=101.0): 1200
    # Matched = min(1800, 1200) = 1200
    # At 102.0:
    # Cum Buy (>=102.0): 1000
    # Cum Sell (<=102.0): 1200 + 700 = 1900
    # Matched = min(1000, 1900) = 1000
    # Maximum matched is 1200 at IEP = 101.0
    assert eq.iep == 101.0
    assert eq.matched_volume == 1200.0
    assert eq.unmet_buy_volume == 600.0  # 1800 - 1200
    assert eq.unmet_sell_volume == 0.0


def test_calculate_equilibrium_minimum_unmet_tiebreaker():
    sieve = OpeningAuctionImbalanceSieve()
    # Construct scenario where matched volume is equal at 100.0 and 101.0, but unmet quantity differs
    orders = [
        # At 100: buy 1000, sell 1000 (matched 1000, unmet 0)
        # At 101: buy 1000, sell 1500 (matched 1000, unmet 500)
        AuctionOrder(price=101.0, quantity=1000.0, side="BUY"),
        AuctionOrder(price=100.0, quantity=1000.0, side="SELL"),
        AuctionOrder(price=101.0, quantity=500.0, side="SELL"),
    ]
    eq = sieve.calculate_equilibrium(orders, prior_close=99.0)
    # At 100: cum buy = 1000, cum sell = 1000 -> matched 1000, unmet 0
    # At 101: cum buy = 1000, cum sell = 1500 -> matched 1000, unmet 500
    assert eq.iep == 100.0
    assert eq.matched_volume == 1000.0


def test_calculate_equilibrium_closest_to_close_tiebreaker():
    sieve = OpeningAuctionImbalanceSieve()
    # Symmetrical orders at 98.0 and 102.0, prior close 99.0
    orders = [
        AuctionOrder(price=98.0, quantity=1000.0, side="BUY"),
        AuctionOrder(price=98.0, quantity=1000.0, side="SELL"),
        AuctionOrder(price=102.0, quantity=1000.0, side="BUY"),
        AuctionOrder(price=102.0, quantity=1000.0, side="SELL"),
    ]
    eq = sieve.calculate_equilibrium(orders, prior_close=99.0)
    # Both 98 and 102 match equal volume and equal unmet.
    # |98 - 99| = 1.0 < |102 - 99| = 3.0 -> Pick 98.0
    assert eq.iep == 98.0


def test_anemic_liquidity_trap():
    sieve = OpeningAuctionImbalanceSieve(min_matched_volume=5000.0)
    orders = [
        AuctionOrder(price=105.0, quantity=200.0, side="BUY"),
        AuctionOrder(price=105.0, quantity=200.0, side="SELL"),
    ]
    rep = sieve.analyze_opening_auction("RELIANCE", orders, prior_close=100.0)
    assert rep.regime == "ANEMIC_AUCTION_LIQUIDITY_TRAP"
    assert rep.trade_directive == "STAND_ASIDE_WAIT_FOR_REGULAR_MARKET"


def test_bullish_gap_continuation_vs_fading():
    sieve = OpeningAuctionImbalanceSieve(min_matched_volume=100.0)

    # 1. Bullish Gap with strong unmet buy demand -> Continuation
    orders_bull = [
        AuctionOrder(price=102.0, quantity=5000.0, side="BUY"),
        AuctionOrder(price=102.0, quantity=2000.0, side="SELL"),
    ]
    rep_cont = sieve.analyze_opening_auction("NIFTY", orders_bull, prior_close=100.0)
    assert rep_cont.gap_percent == 2.0
    assert rep_cont.imbalance_ratio > 0.15
    assert rep_cont.regime == "BULLISH_GAP_SURPLUS_ACCUMULATION"
    assert rep_cont.trade_directive == "EXECUTE_OPENING_DRIVE_LONG"

    # 2. Bullish Gap with sell overhang -> Fade
    orders_fade = [
        AuctionOrder(price=101.0, quantity=2000.0, side="BUY"),
        AuctionOrder(price=101.0, quantity=5000.0, side="SELL"),
    ]
    rep_fade = sieve.analyze_opening_auction("NIFTY", orders_fade, prior_close=100.0)
    assert rep_fade.gap_percent == 1.0
    assert rep_fade.imbalance_ratio < -0.10
    assert rep_fade.regime == "BULLISH_GAP_EXHAUSTION_OVERHANG"
    assert rep_fade.trade_directive == "FADE_GAP_SHORT_TO_PRIOR_CLOSE"


def test_sqlite_persistence():
    sieve = OpeningAuctionImbalanceSieve(db_path=":memory:", min_matched_volume=100.0)
    orders = [
        AuctionOrder(price=100.0, quantity=500.0, side="BUY"),
        AuctionOrder(price=100.0, quantity=500.0, side="SELL"),
    ]
    rep = sieve.analyze_opening_auction("INFY", orders, prior_close=100.0)
    assert rep.symbol == "INFY"

    rows = sieve.get_latest_telemetry(5)
    assert len(rows) == 1
    assert rows[0][0] == "INFY"
    assert rows[0][1] == 100.0
