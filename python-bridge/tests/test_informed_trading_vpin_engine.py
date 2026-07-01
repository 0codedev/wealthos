"""
Unit Tests for Microstructure Informed Trading Probability (VPIN & PIN) Engine (Domain 124 / WP-Z)
"""

from datetime import datetime, timedelta
import pytest

from services.informed_trading_vpin_engine import (
    InformedTradingVPINEngine,
    TradeTick,
    VPINMetrics,
    EKOPParameters,
)


@pytest.fixture
def vpin_engine():
    return InformedTradingVPINEngine(
        bucket_size=1000,
        rolling_buckets_window=5,
        toxic_vpin_threshold=0.45,
        benign_vpin_threshold=0.25,
        db_path=":memory:",
    )


def test_ekop_pin_calculation(vpin_engine):
    # \alpha = 0.5 (event 50% of days), \mu = 200, \epsilon = 100
    # PIN = (0.5 * 200) / (0.5 * 200 + 2 * 100) = 100 / (100 + 200) = 1/3 = ~0.3333
    pin = vpin_engine.calculate_ekop_pin(alpha=0.5, mu=200.0, epsilon=100.0)
    assert abs(pin - 0.3333) < 1e-3

    # Zero informed arrival -> PIN = 0.0
    pin_zero = vpin_engine.calculate_ekop_pin(alpha=0.5, mu=0.0, epsilon=100.0)
    assert pin_zero == 0.0

    # Very high informed arrival -> PIN approaches 1.0
    pin_high = vpin_engine.calculate_ekop_pin(alpha=0.9, mu=10000.0, epsilon=50.0)
    assert pin_high > 0.95


def test_tick_rule_classification_and_bucket_fill(vpin_engine):
    t0 = datetime(2026, 10, 18, 12, 30, 0)

    # Tick 1: 500 shares at 100.0
    m1 = vpin_engine.process_trade_tick(TradeTick("RELIANCE", 100.0, 500, t0))
    # Bucket not yet complete (500 / 1000)
    assert m1 is None

    # Tick 2: 500 shares at 100.10 (uptick -> BUY) -> completes bucket 1
    t1 = t0 + timedelta(seconds=1)
    m2 = vpin_engine.process_trade_tick(TradeTick("RELIANCE", 100.10, 500, t1))
    assert m2 is not None
    assert m2.rolling_buckets_count == 1
    assert m2.vpin == 1.0  # 100% buy volume in bucket 1


def test_volume_bucket_splitting(vpin_engine):
    t0 = datetime(2026, 10, 18, 12, 31, 0)

    # Tick of size 2,500 with bucket size 1,000 -> completes 2 buckets, 500 in 3rd
    m = vpin_engine.process_trade_tick(TradeTick("TCS", 4000.0, 2500, t0))
    assert m is not None
    assert m.rolling_buckets_count == 2


def test_vpin_balanced_flow(vpin_engine):
    t = datetime(2026, 10, 18, 12, 35, 0)
    p = 100.0

    # Simulate 6 balanced buckets (500 buy, 500 sell per bucket)
    m = None
    for i in range(12):
        p += (0.05 if i % 2 == 0 else -0.05)
        t += timedelta(seconds=1)
        m = vpin_engine.process_trade_tick(TradeTick("INFY", p, 500, t))

    assert m is not None
    # Buy vol ~500, sell vol ~500 per bucket -> |Buy - Sell| ~ 0
    assert m.vpin < 0.20
    assert m.regime == "BENIGN_LIQUIDITY"
    assert not m.is_passive_veto_active
    assert m.recommended_spread_multiplier == 1.0


def test_vpin_toxic_flow(vpin_engine):
    t = datetime(2026, 10, 18, 12, 40, 0)
    p = 100.0

    # Simulate persistent directional aggressive buying (every tick is an uptick)
    m = None
    for i in range(10):
        p += 0.10
        t += timedelta(seconds=1)
        m = vpin_engine.process_trade_tick(TradeTick("HIGH_VOL", p, 1000, t))

    assert m is not None
    assert m.vpin > 0.80
    assert m.regime == "TOXIC_ADVERSE_FLOW"
    assert m.is_passive_veto_active is True
    assert m.recommended_spread_multiplier > 2.0


def test_rolling_window_limit(vpin_engine):
    t = datetime(2026, 10, 18, 12, 45, 0)
    m = None
    for i in range(15):
        t += timedelta(seconds=1)
        m = vpin_engine.process_trade_tick(TradeTick("SBIN", 800.0 + (i * 0.05), 1000, t))

    # Rolling window was set to 5
    assert m is not None
    assert m.rolling_buckets_count == 5


def test_sqlite_persistence(vpin_engine):
    t = datetime(2026, 10, 18, 12, 50, 0)
    vpin_engine.process_trade_tick(TradeTick("HDFC", 1600.0, 1000, t))

    conn = vpin_engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, vpin, regime FROM vpin_telemetry WHERE symbol = 'HDFC'")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "HDFC"
    assert row[1] == 1.0
    assert row[2] == "TOXIC_ADVERSE_FLOW"
