"""
Unit tests for Domain 172 (WP-BV): Intraday VWAP Elasticity & Mean-Reversion Half-Life Sieve
"""

import pytest
from services.vwap_elasticity_sieve import (
    CandleBar,
    VWAPElasticitySieve,
    VWAPBandResult,
    VWAPElasticityReport,
)


def test_calculate_vwap_and_dispersion_bands():
    sieve = VWAPElasticitySieve()
    bars = [
        CandleBar(timestamp="09:15", open=100.0, high=102.0, low=99.0, close=101.0, volume=1000.0),
        CandleBar(timestamp="09:20", open=101.0, high=103.0, low=100.0, close=102.0, volume=2000.0),
        CandleBar(timestamp="09:25", open=102.0, high=104.0, low=101.0, close=103.0, volume=1500.0),
    ]
    bands = sieve.calculate_vwap_and_bands(bars)
    assert bands.vwap > 100.0
    assert bands.sigma > 0.0
    # Monotonic dispersion bands: L3 < L2 < L1 < VWAP < U1 < U2 < U3
    assert bands.lower_3 < bands.lower_2 < bands.lower_1 < bands.vwap < bands.upper_1 < bands.upper_2 < bands.upper_3


def test_ou_half_life_estimation():
    sieve = VWAPElasticitySieve()
    # Create mean-reverting price oscillations around 100.0
    bars = []
    prices = [100.0, 102.0, 101.0, 99.0, 98.0, 100.0, 101.5, 99.5, 100.2, 99.8]
    for i, p in enumerate(prices):
        bars.append(CandleBar(timestamp=f"09:{15 + i*5:02d}", open=p, high=p + 0.5, low=p - 0.5, close=p, volume=1000.0))

    kappa, half_life = sieve.calculate_ou_half_life(bars, vwap=100.0, bar_interval_min=5.0)
    assert kappa > 0.0
    assert half_life > 0.0
    assert half_life <= 60.0  # Should mean revert in under an hour


def test_elastic_reversion_directives():
    sieve = VWAPElasticitySieve()
    # 10 bars oscillating tightly around 100.0 with typical volume
    base_bars = [
        CandleBar(timestamp=f"09:{15 + i*5:02d}", open=100.0, high=100.5, low=99.5, close=100.0, volume=1000.0)
        for i in range(10)
    ]

    # Upper overextension bar: close jumps to 102.0 on standard volume (z >= 1.8)
    upper_stretch = base_bars + [
        CandleBar(timestamp="10:05", open=101.5, high=102.2, low=101.5, close=102.0, volume=1100.0)
    ]
    rep_upper = sieve.analyze_vwap_elasticity("NIFTY", upper_stretch)
    assert rep_upper.z_score >= 1.8
    assert rep_upper.regime == "OVEREXTENDED_UPPER_VWAP_BAND"
    assert rep_upper.trade_directive == "EXECUTE_SHORT_ELASTIC_REVERSION_TO_VWAP"

    # Lower overextension bar: close drops to 98.0 on standard volume (z <= -1.8)
    lower_stretch = base_bars + [
        CandleBar(timestamp="10:05", open=98.5, high=98.5, low=97.8, close=98.0, volume=1100.0)
    ]
    rep_lower = sieve.analyze_vwap_elasticity("NIFTY", lower_stretch)
    assert rep_lower.z_score <= -1.8
    assert rep_lower.regime == "OVEREXTENDED_LOWER_VWAP_BAND"
    assert rep_lower.trade_directive == "EXECUTE_LONG_ELASTIC_REVERSION_TO_VWAP"


def test_vwap_trend_expansion_breakout():
    sieve = VWAPElasticitySieve()
    base_bars = [
        CandleBar(timestamp=f"09:{15 + i*5:02d}", open=100.0, high=100.5, low=99.5, close=100.0, volume=1000.0)
        for i in range(10)
    ]
    # Breakout bar: price surges with 3.0x volume expansion
    breakout_bars = base_bars + [
        CandleBar(timestamp="10:05", open=102.0, high=103.5, low=101.8, close=103.0, volume=3500.0)
    ]
    rep = sieve.analyze_vwap_elasticity("BANKNIFTY", breakout_bars)
    assert rep.z_score >= 1.75
    assert rep.volume_surge_ratio >= 2.0
    assert rep.regime == "VWAP_TREND_EXPANSION_BULLISH"
    assert rep.trade_directive == "INITIATIVE_LONG_CONTINUATION"


def test_sqlite_persistence():
    sieve = VWAPElasticitySieve(db_path=":memory:")
    bars = [
        CandleBar(timestamp="09:15", open=100.0, high=101.0, low=99.0, close=100.0, volume=1000.0),
        CandleBar(timestamp="09:20", open=100.0, high=101.0, low=99.0, close=100.0, volume=1000.0),
    ]
    rep = sieve.analyze_vwap_elasticity("TCS", bars)
    assert rep.symbol == "TCS"

    rows = sieve.get_latest_telemetry(5)
    assert len(rows) == 1
    assert rows[0][0] == "TCS"
    assert rows[0][2] == 100.0
