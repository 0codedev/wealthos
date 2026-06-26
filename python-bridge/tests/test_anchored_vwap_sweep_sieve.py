"""
Unit Tests for Intraday Anchored VWAP (AVWAP) & Institutional Liquidity Sweep Sieve (Domain 160 / WP-BJ)
"""

import pytest
from services.anchored_vwap_sweep_sieve import (
    AnchoredVWAPSweepSieve,
    CandleBar,
    AVWAPReport,
)


@pytest.fixture
def sieve():
    return AnchoredVWAPSweepSieve(
        db_path=":memory:",
        volume_surge_hurdle=1.75,
        wick_rejection_hurdle=0.50,
    )


def test_calculate_avwap_series(sieve):
    # Constant price 100 with constant volume 1000
    bars = [CandleBar(f"t_{i}", 100.0, 102.0, 98.0, 100.0, 1000.0) for i in range(10)]
    avwap, sigma = sieve.calculate_avwap_series(bars, anchor_index=0)
    assert avwap == pytest.approx(100.0, abs=1e-3)
    assert sigma >= 0.0


def test_bullish_liquidity_sweep_spring(sieve):
    # Anchor at bar 0: baseline price ~2500, sigma ~20
    bars = []
    for i in range(20):
        bars.append(CandleBar(f"t_{i}", 2500.0, 2520.0, 2480.0, 2500.0, 10000.0))

    # AVWAP is ~2500. Lower Band 2 is ~2460.
    # Bar 20 sweeps down to 2440 (< Lower Band 2), but aggressive buyers absorb:
    # Open 2470, Low 2440, High 2490, Close 2485 (> Lower Band 1 of ~2480).
    # Lower wick = min(2470, 2485) - 2440 = 30. Total span = 2490 - 2440 = 50. Wick ratio = 30/50 = 0.60 >= 0.50!
    # Volume = 25000 (> 1.75x avg 10000)
    sweep_bar = CandleBar("t_20", open=2470.0, high=2490.0, low=2440.0, close=2485.0, volume=25000.0)
    bars.append(sweep_bar)

    rep = sieve.evaluate_anchor_and_sweep(
        symbol="RELIANCE",
        anchor_event_name="EARNINGS_RELEASE_0915",
        bars=bars,
        anchor_index=0,
        average_volume=10000.0,
    )

    assert rep.wick_ratio >= 0.50
    assert rep.volume_surge_ratio >= 1.75
    assert rep.regime == "BULLISH_LIQUIDITY_SWEEP_SPRING"
    assert rep.trade_directive == "BUY_LIQUIDITY_ABSORPTION_REVERSAL"


def test_bearish_liquidity_sweep_upthrust(sieve):
    bars = []
    for i in range(20):
        bars.append(CandleBar(f"t_{i}", 500.0, 510.0, 490.0, 500.0, 5000.0))

    # AVWAP is 500. Upper Band 2 is ~516.
    # Spikes up to 530, but rejects violently:
    # Open 515, High 530, Low 505, Close 508 (< Upper Band 1 of ~508)
    # Upper wick = 530 - 515 = 15. Total span = 530 - 505 = 25. Wick ratio = 15/25 = 0.60 >= 0.50
    upthrust_bar = CandleBar("t_20", open=515.0, high=530.0, low=505.0, close=508.0, volume=12000.0)
    bars.append(upthrust_bar)

    rep = sieve.evaluate_anchor_and_sweep(
        symbol="SBIN",
        anchor_event_name="RBI_POLICY_1000",
        bars=bars,
        anchor_index=0,
        average_volume=5000.0,
    )

    assert rep.wick_ratio >= 0.50
    assert rep.volume_surge_ratio >= 1.75
    assert rep.regime == "BEARISH_LIQUIDITY_SWEEP_UPTHRUST"
    assert rep.trade_directive == "SELL_LIQUIDITY_ABSORPTION_REVERSAL"


def test_bullish_anchor_trend_hold(sieve):
    bars = [CandleBar(f"t_{i}", 100.0 + i, 102.0 + i, 99.0 + i, 101.0 + i, 1000.0) for i in range(20)]
    rep = sieve.evaluate_anchor_and_sweep("TREND_CO", "DAY_OPEN", bars, 0, 1000.0)

    assert rep.regime in ["BULLISH_ANCHOR_TREND_HOLD", "OVEREXTENDED_BULLISH_EXPANSION"]


def test_sqlite_persistence(sieve):
    bars = [CandleBar(f"t_{i}", 100.0, 102.0, 98.0, 100.0, 1000.0) for i in range(5)]
    sieve.evaluate_anchor_and_sweep("PERSIST_SYM", "TEST_EVENT", bars, 0, 1000.0)

    conn = sieve._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, anchor_event, regime FROM anchored_vwap_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_SYM"
