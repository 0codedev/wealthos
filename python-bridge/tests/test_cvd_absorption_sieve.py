"""
Unit Tests for Dynamic Order Flow CVD Imbalance & Microstructure Absorption Sieve (Domain 127 / WP-AC)
"""

from datetime import datetime, timedelta
import pytest

from services.cvd_absorption_sieve import (
    CVDAbsorptionSieve,
    BarOrderFlow,
    AbsorptionSignal,
)


@pytest.fixture
def sieve():
    return CVDAbsorptionSieve(
        tick_size=0.05,
        rolling_window_bars=15,
        z_score_threshold=3.0,
        min_delta_imbalance_shares=2000,
        db_path=":memory:",
    )


def test_cvd_accumulation(sieve):
    t0 = datetime(2026, 10, 18, 14, 0, 0)

    # Ingest 3 bars with deltas +500, -200, +800
    b1 = BarOrderFlow("B1", "NIFTY", 24500.0, 24510.0, 24495.0, 24505.0, 10000, 500, t0)
    b2 = BarOrderFlow("B2", "NIFTY", 24505.0, 24508.0, 24490.0, 24495.0, 8000, -200, t0 + timedelta(minutes=1))
    b3 = BarOrderFlow("B3", "NIFTY", 24495.0, 24520.0, 24492.0, 24515.0, 12000, 800, t0 + timedelta(minutes=2))

    sieve.process_bar(b1)
    sieve.process_bar(b2)
    sieve.process_bar(b3)

    assert sieve._cumulative_cvd["NIFTY"] == (500 - 200 + 800)


def test_bullish_absorption_signal(sieve):
    t = datetime(2026, 10, 18, 14, 10, 0)

    # Establish baseline history of normal moderate volume deltas
    for i in range(15):
        t += timedelta(minutes=1)
        b = BarOrderFlow(f"BASE_{i}", "RELIANCE", 3000.0, 3005.0, 2998.0, 3002.0, 5000, 200 if i % 2 == 0 else -200, t)
        sieve.process_bar(b)

    # Massive aggressive sell sweep of -6,000 delta, but price holds flat at 3002.0
    t += timedelta(minutes=1)
    b_shock = BarOrderFlow("SHOCK_BUY", "RELIANCE", 3002.0, 3002.5, 2999.0, 3002.0, 25000, -6000, t)
    sig = sieve.process_bar(b_shock)

    assert sig.signal_type == "BULLISH_ABSORPTION_REVERSAL"
    assert sig.is_actionable is True
    assert sig.z_score >= 3.0
    assert sig.confidence_score >= 0.70
    # Stop price pegged 1 tick below bar low (2999.0 - 0.05 = 2998.95)
    assert abs(sig.invalidation_stop_price - 2998.95) < 1e-3


def test_bearish_absorption_signal(sieve):
    t = datetime(2026, 10, 18, 14, 30, 0)

    # Establish baseline history
    for i in range(15):
        t += timedelta(minutes=1)
        b = BarOrderFlow(f"BASE_{i}", "TCS", 4000.0, 4005.0, 3998.0, 4002.0, 4000, 150 if i % 2 == 0 else -150, t)
        sieve.process_bar(b)

    # Massive aggressive buy sweep of +7,500 delta, but price is completely capped at 4002.0
    t += timedelta(minutes=1)
    b_shock = BarOrderFlow("SHOCK_SELL", "TCS", 4002.0, 4002.05, 3999.0, 4002.0, 30000, 7500, t)
    sig = sieve.process_bar(b_shock)

    assert sig.signal_type == "BEARISH_ABSORPTION_REVERSAL"
    assert sig.is_actionable is True
    assert sig.z_score >= 3.0
    # Stop price pegged 1 tick above bar high (4002.05 + 0.05 = 4002.10)
    assert abs(sig.invalidation_stop_price - 4002.10) < 1e-3


def test_neutral_normal_market_flow(sieve):
    t = datetime(2026, 10, 18, 14, 50, 0)

    # Normal trending bar: price moved +10.0 on +1000 delta (displacement is proportional)
    b = BarOrderFlow("TREND", "INFY", 1950.0, 1962.0, 1948.0, 1960.0, 8000, 1000, t)
    sig = sieve.process_bar(b)

    assert sig.signal_type == "NEUTRAL"
    assert sig.is_actionable is False


def test_sqlite_persistence(sieve):
    t = datetime(2026, 10, 18, 15, 0, 0)
    b = BarOrderFlow("B_LOG", "HDFC", 1600.0, 1605.0, 1595.0, 1602.0, 5000, 300, t)
    sieve.process_bar(b)

    conn = sieve._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, signal_type, close_price FROM cvd_absorption_telemetry WHERE symbol = 'HDFC'")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "HDFC"
    assert row[1] == "NEUTRAL"
    assert row[2] == 1602.0
