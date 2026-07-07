"""
Unit Tests for High-Frequency Cross-Venue Triangular Arbitrage Routing & Latency-Jitter Sentry
Domain 226 / Work Package WP-DX
"""

import pytest
from services.triangular_arbitrage_jitter_sentry import (
    TriangularArbitrageJitterSentry,
    ExchangeLeg,
    RoutingActionState,
)


def create_sample_legs(
    p_btc_usdt: float = 60000.0,
    p_eth_btc: float = 0.055,
    p_eth_usdt: float = 3350.0,
    fee_rate: float = 0.0002,
    depth: float = 50000.0,
):
    # Path: USDT -> BTC -> ETH -> USDT
    # 1. Buy BTC with USDT: Pay USDT, get BTC (Action: buy, price: p_btc_usdt)
    # 2. Buy ETH with BTC: Pay BTC, get ETH (Action: buy, price: p_eth_btc)
    # 3. Sell ETH for USDT: Give ETH, get USDT (Action: sell, price: p_eth_usdt)
    leg1 = ExchangeLeg(
        symbol="BTC/USDT", venue="binance", action="buy",
        price=p_btc_usdt, depth_usd=depth, taker_fee_rate=fee_rate,
        base_currency="BTC", quote_currency="USDT"
    )
    leg2 = ExchangeLeg(
        symbol="ETH/BTC", venue="bybit", action="buy",
        price=p_eth_btc, depth_usd=depth, taker_fee_rate=fee_rate,
        base_currency="ETH", quote_currency="BTC"
    )
    leg3 = ExchangeLeg(
        symbol="ETH/USDT", venue="okx", action="sell",
        price=p_eth_usdt, depth_usd=depth, taker_fee_rate=fee_rate,
        base_currency="ETH", quote_currency="USDT"
    )
    return [leg1, leg2, leg3]


def test_multiplier_and_capacity_calculation():
    sentry = TriangularArbitrageJitterSentry()
    # Synthetic zero-arbitrage: 60000 * 0.055 = 3300. If ETH/USDT = 3300, gross mult = (1/60000) * (1/0.055) * 3300 = 1.0
    legs = create_sample_legs(p_btc_usdt=60000.0, p_eth_btc=0.055, p_eth_usdt=3300.0, fee_rate=0.0)
    gross, net = sentry.calculate_path_multipliers(legs)
    assert pytest.approx(gross, 1e-4) == 1.0
    assert pytest.approx(net, 1e-4) == 1.0

    capacity = sentry.calculate_bottleneck_capacity(legs)
    assert capacity == 50000.0


def test_positive_edge_execute_atomic():
    sentry = TriangularArbitrageJitterSentry(min_edge_hurdle_bps=5.0)
    # 60000 * 0.055 = 3300. But ETH/USDT = 3350 (+1.51% gross edge)
    legs = create_sample_legs(p_btc_usdt=60000.0, p_eth_btc=0.055, p_eth_usdt=3350.0, fee_rate=0.0005)

    venue_latencies = {"binance": 10.0, "bybit": 12.0, "okx": 10.0}
    venue_jitters = {"binance": 2.0, "bybit": 2.0, "okx": 2.0}

    opp = sentry.evaluate_triangular_opportunity("USDT-BTC-ETH-USDT", legs, venue_latencies, venue_jitters)

    assert opp.sentry_status == RoutingActionState.EXECUTE_ATOMIC
    assert opp.net_edge_bps > 100.0  # Big edge
    assert opp.race_survival_probability > 0.30
    assert "EXECUTE_ATOMIC" in opp.recommended_action


def test_abort_negative_edge_fees():
    sentry = TriangularArbitrageJitterSentry(min_edge_hurdle_bps=5.0)
    # Slight gross edge: ETH/USDT = 3305 (+0.15% gross), but taker fee is 0.1% per leg (3 * 10 bps = 30 bps fee)
    legs = create_sample_legs(p_btc_usdt=60000.0, p_eth_btc=0.055, p_eth_usdt=3305.0, fee_rate=0.0010)

    venue_latencies = {"binance": 10.0, "bybit": 10.0, "okx": 10.0}
    venue_jitters = {"binance": 1.0, "bybit": 1.0, "okx": 1.0}

    opp = sentry.evaluate_triangular_opportunity("USDT-BTC-ETH-USDT", legs, venue_latencies, venue_jitters)
    assert opp.sentry_status == RoutingActionState.ABORT_NEGATIVE_EDGE
    assert opp.net_edge_bps < 5.0


def test_abort_jitter_too_high():
    sentry = TriangularArbitrageJitterSentry(max_jitter_ratio=0.50)
    legs = create_sample_legs(p_btc_usdt=60000.0, p_eth_btc=0.055, p_eth_usdt=3350.0, fee_rate=0.0002)

    # Moderate latency, but extreme jitter (e.g. 15ms latency with 14ms jitter)
    venue_latencies = {"binance": 15.0, "bybit": 15.0, "okx": 15.0}  # total = 45 ms
    venue_jitters = {"binance": 16.0, "bybit": 16.0, "okx": 16.0}     # sqrt(3*256) = 27.7 ms -> ratio = 0.61

    opp = sentry.evaluate_triangular_opportunity("USDT-BTC-ETH-USDT", legs, venue_latencies, venue_jitters)
    assert opp.sentry_status == RoutingActionState.ABORT_JITTER_TOO_HIGH


def test_abort_low_liquidity_and_latency_timeout():
    sentry = TriangularArbitrageJitterSentry(min_bottleneck_usd=500.0, max_total_latency_ms=60.0)

    # Test shallow depth
    shallow_legs = create_sample_legs(p_btc_usdt=60000.0, p_eth_btc=0.055, p_eth_usdt=3350.0, depth=100.0)
    venue_latencies = {"binance": 10.0, "bybit": 10.0, "okx": 10.0}
    venue_jitters = {"binance": 1.0, "bybit": 1.0, "okx": 1.0}

    opp_shallow = sentry.evaluate_triangular_opportunity("SHALLOW", shallow_legs, venue_latencies, venue_jitters)
    assert opp_shallow.sentry_status == RoutingActionState.ABORT_INSUFFICIENT_LIQUIDITY

    # Test high latency timeout
    deep_legs = create_sample_legs(p_btc_usdt=60000.0, p_eth_btc=0.055, p_eth_usdt=3350.0, depth=10000.0)
    slow_latencies = {"binance": 30.0, "bybit": 30.0, "okx": 30.0} # 90ms > 60ms limit
    opp_slow = sentry.evaluate_triangular_opportunity("SLOW", deep_legs, slow_latencies, venue_jitters)
    assert opp_slow.sentry_status == RoutingActionState.ABORT_RACE_TIMEOUT
