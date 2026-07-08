"""
Unit Tests for Intraday Volume-Weighted MACD & Dual-Momentum Divergence Sieve (Domain 158 / WP-BH)
"""

import pytest
from services.volume_weighted_macd_sieve import (
    VolumeWeightedMACDSieve,
    BarTick,
    VWMACDReport,
)


@pytest.fixture
def sieve():
    return VolumeWeightedMACDSieve(
        db_path=":memory:",
        fast_period=12,
        slow_period=26,
        signal_period=9,
        volume_hurdle=1.50,
    )


def test_vw_macd_computation_lengths(sieve):
    bars = [BarTick(f"t_{i}", close=100.0 + 0.1 * i, volume=1000.0) for i in range(40)]
    macd, sig, hist = sieve.compute_vw_macd_series(bars)
    assert len(macd) == 40
    assert len(sig) == 40
    assert len(hist) == 40


def test_bullish_vw_macd_crossover_confirmed(sieve):
    # Establish base trend where price declines, then vigorously turns up
    bars = []
    for i in range(35):
        # Declining price to make MACD negative
        bars.append(BarTick(f"t_{i}", close=100.0 - 0.2 * i, volume=1000.0))

    # Bar 35: slight turn up, MACD begins rising
    bars.append(BarTick("t_35", close=94.0, volume=1000.0))
    # Bar 36: huge bullish explosion with 3000 volume (> 1.5x avg) causing crossover
    bars.append(BarTick("t_36", close=102.0, volume=3500.0))

    rep = sieve.evaluate_vw_macd("RELIANCE", bars)

    assert rep.volume_conf_ratio >= 1.50
    assert rep.regime == "BULLISH_VW_MACD_CROSSOVER_CONFIRMED"
    assert rep.trade_directive == "BUY_MOMENTUM_EXPANSION"


def test_low_volume_false_crossover_rejected(sieve):
    bars = []
    for i in range(35):
        bars.append(BarTick(f"t_{i}", close=100.0 - 0.2 * i, volume=2000.0))

    # Crossover occurs on thin volume (400 volume vs 2000 avg)
    bars.append(BarTick("t_35", close=94.0, volume=2000.0))
    bars.append(BarTick("t_36", close=102.0, volume=400.0))  # Vol ratio = 0.20 < 1.50

    rep = sieve.evaluate_vw_macd("THIN_SYM", bars)

    assert rep.volume_conf_ratio < 1.0
    assert rep.regime == "LOW_VOLUME_FALSE_CROSSOVER_REJECTED"
    assert rep.trade_directive == "STAND_ASIDE_FILTER_NOISE"


def test_bearish_vw_macd_crossdown_confirmed(sieve):
    # Establish strong uptrend
    bars = []
    for i in range(35):
        bars.append(BarTick(f"t_{i}", close=100.0 + 0.3 * i, volume=1000.0))

    # Bar 35 & 36: steep breakdown with 3000 volume
    bars.append(BarTick("t_35", close=109.0, volume=1000.0))
    bars.append(BarTick("t_36", close=100.0, volume=3500.0))

    rep = sieve.evaluate_vw_macd("BEAR_SYM", bars)

    assert rep.volume_conf_ratio >= 1.50
    assert rep.regime == "BEARISH_VW_MACD_CROSSDOWN_CONFIRMED"
    assert rep.trade_directive == "SELL_MOMENTUM_BREAKDOWN"


def test_histogram_acceleration(sieve):
    # Stable continuation
    bars = [BarTick(f"t_{i}", close=100.0 + 0.5 * i, volume=1000.0) for i in range(50)]
    rep = sieve.evaluate_vw_macd("ACCEL_SYM", bars)

    assert rep.histogram > 0.0
    assert rep.regime in ["BULLISH_HISTOGRAM_ACCELERATING", "BULLISH_HISTOGRAM_DECELERATING"]


def test_sqlite_persistence(sieve):
    bars = [BarTick(f"t_{i}", close=100.0, volume=1000.0) for i in range(40)]
    sieve.evaluate_vw_macd("PERSIST_SYM", bars)

    conn = sieve._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, current_price, regime FROM vw_macd_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_SYM"
