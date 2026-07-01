r"""Unit Tests for High-Frequency Limit Order Book Hidden Liquidity Dark Pool Sieve (Domain 198 / WP-CV)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.hidden_liquidity_dark_pool_sieve import (
    HiddenLiquidityDarkPoolSieve,
    QuoteState,
    TradePrint,
    LiquidityCushionRegime,
)


@pytest.fixture
def sieve() -> HiddenLiquidityDarkPoolSieve:
    return HiddenLiquidityDarkPoolSieve(
        alpha_0=0.20,
        alpha_1=1.80,
        alpha_2=0.50,
        dark_fee_rebate_bps=0.5,
        lit_base_spread_bps=2.0,
    )


def test_hidden_liquidity_detection_bid(sieve: HiddenLiquidityDarkPoolSieve):
    initial = QuoteState(
        timestamp_ms=1000,
        bid_price=25000.0,
        bid_size=500.0,
        ask_price=25001.0,
        ask_size=600.0,
    )
    final = QuoteState(
        timestamp_ms=1500,
        bid_price=25000.0,
        bid_size=400.0,
        ask_price=25001.0,
        ask_size=700.0,
    )
    # Taker sells hitting the bid
    trades = [
        TradePrint(timestamp_ms=1100, price=25000.0, size=600.0, taker_side="SELL"),
        TradePrint(timestamp_ms=1200, price=25000.0, size=700.0, taker_side="SELL"),
        TradePrint(timestamp_ms=1300, price=25000.0, size=500.0, taker_side="SELL"),
    ]

    res = sieve.detect_hidden_liquidity(initial, final, trades, side="BID")

    assert res.price == 25000.0
    assert res.side == "BID"
    assert res.executed_volume == 1800.0
    # Expected vis depletion = 500 - 400 = 100
    # Inferred hidden = 1800 - 100 = 1700
    assert res.inferred_hidden_volume == 1700.0
    assert res.hidden_to_visible_ratio == 3.4
    assert res.cushion_regime == LiquidityCushionRegime.HEAVY_ICEBERG


def test_hidden_liquidity_detection_ask_wall(sieve: HiddenLiquidityDarkPoolSieve):
    initial = QuoteState(
        timestamp_ms=2000,
        bid_price=25000.0,
        bid_size=1000.0,
        ask_price=25001.0,
        ask_size=1000.0,
    )
    final = QuoteState(
        timestamp_ms=2500,
        bid_price=25000.0,
        bid_size=1200.0,
        ask_price=25001.0,
        ask_size=900.0,
    )
    # Massive taker buy sweep of 10,000 shares hitting ask
    trades = [
        TradePrint(timestamp_ms=2100, price=25001.0, size=5000.0, taker_side="BUY"),
        TradePrint(timestamp_ms=2200, price=25001.0, size=5000.0, taker_side="BUY"),
    ]

    res = sieve.detect_hidden_liquidity(initial, final, trades, side="ASK")

    assert res.executed_volume == 10000.0
    # Expected vis drop = 1000 - 900 = 100
    assert res.inferred_hidden_volume == 9900.0
    assert res.hidden_to_visible_ratio >= 4.0
    assert res.cushion_regime == LiquidityCushionRegime.INSTITUTIONAL_WALL


def test_dark_fill_probability_decay(sieve: HiddenLiquidityDarkPoolSieve):
    depth = 1000.0
    p_small = sieve.calculate_dark_fill_probability(order_size=100.0, avg_depth=depth, order_flow_imbalance=0.0)
    p_med = sieve.calculate_dark_fill_probability(order_size=1000.0, avg_depth=depth, order_flow_imbalance=0.0)
    p_huge = sieve.calculate_dark_fill_probability(order_size=5000.0, avg_depth=depth, order_flow_imbalance=0.0)

    # Must be monotonically decreasing with order size
    assert 0.0 < p_huge < p_med < p_small < 1.0
    # Positive OFI (favorable incoming retail flow) increases fill probability
    p_fav = sieve.calculate_dark_fill_probability(order_size=1000.0, avg_depth=depth, order_flow_imbalance=1.5)
    assert p_fav > p_med


def test_optimize_dark_lit_routing(sieve: HiddenLiquidityDarkPoolSieve):
    total_q = 5000.0
    avg_depth = 2000.0

    alloc = sieve.optimize_dark_lit_routing(
        total_order_size=total_q,
        avg_market_depth=avg_depth,
        order_flow_imbalance=0.5,
        lit_daily_volatility=0.015,
    )

    # Sanity checks
    assert math.isclose(alloc.dark_tranche_size + alloc.lit_tranche_size, total_q, abs_tol=1e-2)
    assert 0.0 <= alloc.dark_tranche_size <= total_q
    assert 0.0 <= alloc.lit_tranche_size <= total_q
    assert 0.0 < alloc.dark_fill_probability < 1.0
    assert alloc.total_expected_shortfall_bps > 0.0
    assert len(alloc.recommended_venue_sequence) >= 2


def test_cushion_support_resistance_aggregation(sieve: HiddenLiquidityDarkPoolSieve):
    # Bid estimates show massive accumulation
    bids = [
        sieve.detect_hidden_liquidity(
            initial_quote=QuoteState(1, 25000.0, 500.0, 25001.0, 500.0),
            final_quote=QuoteState(2, 25000.0, 500.0, 25001.0, 500.0),
            trades=[TradePrint(1, 25000.0, 4000.0, "SELL")],
            side="BID",
        )
    ]
    # Asks show small transparent depth
    asks = [
        sieve.detect_hidden_liquidity(
            initial_quote=QuoteState(1, 25000.0, 500.0, 25001.0, 500.0),
            final_quote=QuoteState(2, 25000.0, 500.0, 25001.0, 200.0),
            trades=[TradePrint(1, 25001.0, 300.0, "BUY")],
            side="ASK",
        )
    ]

    analysis = sieve.evaluate_cushion_support_resistance(bids, asks)
    assert analysis["bias"] == "INSTITUTIONAL_ACCUMULATION_BID"
    assert analysis["total_hidden_bids"] > analysis["total_hidden_asks"]
    assert "Favor long fills" in analysis["directive"]
