"""Unit tests for python-bridge/services/volatility_breakout_engine.py (Domain 117)."""
from __future__ import annotations

import os
import sys
import time
import pytest
import numpy as np

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from services.volatility_breakout_engine import (
    OHLCVBar,
    VolatilityEstimator,
    VolatilityBreakoutEngine,
    VolatilityRegime,
    BreakoutDirection,
)


def test_ohlcv_bar_properties():
    bar = OHLCVBar(
        timestamp=time.time(),
        open=100.0,
        high=110.0,
        low=90.0,
        close=105.0,
        volume=1000,
        buy_volume=650,
        sell_volume=350,
    )

    assert bar.range == 20.0
    assert bar.cvd == 300
    assert bar.upper_wick == 5.0    # 110 - 105
    assert bar.lower_wick == 10.0   # 100 - 90
    assert pytest.approx(bar.upper_wick_ratio, 1e-4) == 0.25  # 5 / 20
    assert pytest.approx(bar.lower_wick_ratio, 1e-4) == 0.50  # 10 / 20


def test_volatility_estimators_parkinson():
    bars = [
        OHLCVBar(float(i), 100.0, 102.0, 98.0, 100.0, 100)
        for i in range(20)
    ]
    p_vol = VolatilityEstimator.parkinson(bars)
    assert p_vol > 0.0
    assert pytest.approx(p_vol, rel=0.1) == 0.024


def test_volatility_estimators_garman_klass():
    bars = [
        OHLCVBar(float(i), 100.0, 102.5, 98.5, 101.5, 100)
        for i in range(20)
    ]
    gk_vol = VolatilityEstimator.garman_klass(bars)
    assert gk_vol > 0.0


def test_volatility_estimators_rogers_satchell():
    # Drift trending up
    bars = [
        OHLCVBar(float(i), 100.0 + i, 102.0 + i, 99.0 + i, 101.5 + i, 100)
        for i in range(20)
    ]
    rs_vol = VolatilityEstimator.rogers_satchell(bars)
    assert rs_vol > 0.0


def test_compute_atr():
    bars = [
        OHLCVBar(float(i), 100.0, 105.0, 95.0, 100.0, 100)
        for i in range(20)
    ]
    atr = VolatilityEstimator.compute_atr(bars, period=14)
    assert pytest.approx(atr, 1e-4) == 10.0


def test_volatility_regime_classification():
    engine = VolatilityBreakoutEngine(db_path=":memory:")

    # Generate compressed bars (small range)
    for i in range(35):
        bar = OHLCVBar(float(i), 100.0, 100.5, 99.5, 100.1, 100, 50, 50)
        metrics, _ = engine.ingest_bar("NIFTY", bar)

    # In steady small range, VR will be ~ 1.0 (NORMAL)
    assert metrics.regime in [VolatilityRegime.NORMAL, VolatilityRegime.EXTREME_COMPRESSION]


def test_opening_range_setup_valid_compression():
    engine = VolatilityBreakoutEngine(db_path=":memory:")
    # Daily ATR = 100.0, ORB width = 80.0 <= 1.20 * 100 (120)
    orb = engine.set_opening_range("BANKNIFTY", "2026-10-18", orb_high=52100.0, orb_low=52020.0, daily_atr=100.0)

    assert orb.is_valid_compression is True
    assert orb.orb_width == 80.0


def test_opening_range_setup_invalid_wide_range():
    engine = VolatilityBreakoutEngine(db_path=":memory:")
    # Daily ATR = 100.0, ORB width = 150.0 > 120 (exhausted range)
    orb = engine.set_opening_range("BANKNIFTY", "2026-10-18", orb_high=52200.0, orb_low=52050.0, daily_atr=100.0)

    assert orb.is_valid_compression is False


def test_bullish_orb_breakout_signal():
    engine = VolatilityBreakoutEngine(db_path=":memory:")
    engine.set_opening_range("RELIANCE", "2026-10-18", orb_high=2800.0, orb_low=2780.0, daily_atr=30.0)

    # Ingest historical bars to establish baseline
    for i in range(15):
        b = OHLCVBar(float(i), 2790.0, 2795.0, 2785.0, 2792.0, 1000, 500, 500)
        engine.ingest_bar("RELIANCE", b)

    # Breakout bar: closes at 2805 > 2800, small upper wick, positive CVD
    breakout_bar = OHLCVBar(
        timestamp=100.0,
        open=2798.0,
        high=2806.0,
        low=2797.0,
        close=2805.0,  # Closes above 2800, upper wick = 1.0 (1/9th of range)
        volume=5000,
        buy_volume=4000,
        sell_volume=1000,  # CVD = +3000
    )

    metrics, sig = engine.ingest_bar("RELIANCE", breakout_bar)
    assert sig is not None
    assert sig.direction == BreakoutDirection.BULLISH_EXPANSION
    assert sig.trigger_price == 2805.0
    assert sig.cvd == 3000
    assert sig.target_price > 2805.0


def test_bearish_orb_breakdown_signal():
    engine = VolatilityBreakoutEngine(db_path=":memory:")
    engine.set_opening_range("INFY", "2026-10-18", orb_high=1500.0, orb_low=1480.0, daily_atr=25.0)

    for i in range(15):
        b = OHLCVBar(float(i), 1490.0, 1495.0, 1485.0, 1490.0, 1000, 500, 500)
        engine.ingest_bar("INFY", b)

    # Breakdown bar: closes at 1475 < 1480, small lower wick, negative CVD
    breakdown_bar = OHLCVBar(
        timestamp=100.0,
        open=1482.0,
        high=1483.0,
        low=1474.0,
        close=1475.0,  # Closes below 1480, lower wick = 1.0
        volume=5000,
        buy_volume=1000,
        sell_volume=4000,  # CVD = -3000
    )

    metrics, sig = engine.ingest_bar("INFY", breakdown_bar)
    assert sig is not None
    assert sig.direction == BreakoutDirection.BEARISH_EXPANSION
    assert sig.trigger_price == 1475.0
    assert sig.cvd == -3000
    assert sig.target_price < 1475.0


def test_false_breakout_upper_wick_veto():
    engine = VolatilityBreakoutEngine(db_path=":memory:")
    engine.set_opening_range("TCS", "2026-10-18", orb_high=4000.0, orb_low=3980.0, daily_atr=40.0)

    for i in range(15):
        b = OHLCVBar(float(i), 3990.0, 3995.0, 3985.0, 3990.0, 1000, 500, 500)
        engine.ingest_bar("TCS", b)

    # Rejection wick: high spiked to 4030, but closed at 4005 (range 35, upper wick 25/35 = 71% > 50%)
    rejection_bar = OHLCVBar(
        timestamp=100.0,
        open=3995.0,
        high=4030.0,
        low=3995.0,
        close=4005.0,
        volume=5000,
        buy_volume=3000,
        sell_volume=2000,
    )

    metrics, sig = engine.ingest_bar("TCS", rejection_bar)
    assert sig is None  # Vetoed due to excessive upper rejection wick


def test_false_breakout_negative_cvd_veto():
    engine = VolatilityBreakoutEngine(db_path=":memory:")
    engine.set_opening_range("SBIN", "2026-10-18", orb_high=800.0, orb_low=790.0, daily_atr=15.0)

    for i in range(15):
        b = OHLCVBar(float(i), 795.0, 798.0, 792.0, 795.0, 1000, 500, 500)
        engine.ingest_bar("SBIN", b)

    # Price broke out above 800, but sellers dominated (negative CVD = -1500)
    fake_bar = OHLCVBar(
        timestamp=100.0,
        open=798.0,
        high=804.0,
        low=797.0,
        close=803.0,
        volume=5000,
        buy_volume=1750,
        sell_volume=3250,  # Negative CVD
    )

    metrics, sig = engine.ingest_bar("SBIN", fake_bar)
    assert sig is None  # Vetoed due to negative CVD


def test_sqlite_persistence():
    engine = VolatilityBreakoutEngine(db_path=":memory:")
    engine.set_opening_range("WIPRO", "2026-10-18", orb_high=500.0, orb_low=490.0, daily_atr=10.0)

    for i in range(15):
        b = OHLCVBar(float(i), 495.0, 497.0, 493.0, 495.0, 100, 50, 50)
        engine.ingest_bar("WIPRO", b)

    breakout_bar = OHLCVBar(100.0, 498.0, 505.0, 497.0, 504.0, 1000, 800, 200)
    engine.ingest_bar("WIPRO", breakout_bar)

    conn = engine._get_connection()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM volatility_regimes")
    regime_count = cur.fetchone()[0]
    assert regime_count == 16

    cur.execute("SELECT COUNT(*) FROM orb_breakout_signals")
    signal_count = cur.fetchone()[0]
    assert signal_count == 1
