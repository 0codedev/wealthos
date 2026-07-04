"""
Unit Tests for Intraday Opening Range Breakout (ORB) & Volatility Expansion Sieve (Domain 152 / WP-BB)
"""

import pytest
from services.opening_range_breakout_sieve import (
    OpeningRangeBreakoutSieve,
    CandleBar,
    DailySessionStats,
    ORBAnalysisReport,
)


@pytest.fixture
def sieve():
    return OpeningRangeBreakoutSieve(
        db_path=":memory:",
        stretch_multiplier=0.20,
        volume_expansion_hurdle=1.80,
        wick_rejection_threshold=0.50,
    )


def test_crabel_stretch_calculation(sieve):
    sessions = [
        DailySessionStats(open=100.0, high=105.0, low=95.0, close=102.0),  # (5 + 5)/2 = 5.0
        DailySessionStats(open=102.0, high=108.0, low=100.0, close=106.0),  # (6 + 2)/2 = 4.0
        DailySessionStats(open=106.0, high=115.0, low=103.0, close=110.0),  # (9 + 3)/2 = 6.0
    ]
    stretch = sieve.calculate_crabel_stretch(sessions)
    assert stretch == pytest.approx(5.0, abs=1e-3)


def test_bullish_orb_expansion_confirmed(sieve):
    # 15m opening range (3 x 5m candles)
    opening_bars = [
        CandleBar("09:15", open=2500.0, high=2510.0, low=2495.0, close=2505.0, volume=10000),
        CandleBar("09:20", open=2505.0, high=2515.0, low=2500.0, close=2512.0, volume=12000),
        CandleBar("09:25", open=2512.0, high=2520.0, low=2508.0, close=2515.0, volume=11000),
    ]
    # OR: High = 2520, Low = 2495, Span = 25. Fallback stretch = 0.15 * 25 = 3.75.
    # Bull trigger = 2520 + (0.20 * 3.75) = 2520.75.

    # Breakout bar at 09:30: Surges to 2530, closes at 2528 with huge volume (25000 vs avg 11000)
    current_bar = CandleBar("09:30", open=2516.0, high=2530.0, low=2515.0, close=2528.0, volume=25000)
    rep = sieve.evaluate_orb(
        symbol="RELIANCE",
        opening_bars=opening_bars,
        current_bar=current_bar,
        average_bar_volume=11000,
    )

    assert rep.or_high == 2520.0
    assert rep.or_low == 2495.0
    assert rep.or_span == 25.0
    assert rep.bull_trigger == pytest.approx(2520.75, abs=0.01)
    assert rep.volume_expansion_ratio >= 1.80
    assert rep.regime == "BULLISH_ORB_EXPANSION_CONFIRMED"
    assert rep.trade_directive == "BUY_ORB_BREAKOUT_EXPANSION"
    assert rep.target_1 > rep.or_high
    assert rep.stop_loss < rep.or_high


def test_bearish_orb_breakdown_confirmed(sieve):
    opening_bars = [
        CandleBar("09:15", open=500.0, high=505.0, low=490.0, close=495.0, volume=5000),
        CandleBar("09:20", open=495.0, high=500.0, low=492.0, close=498.0, volume=4000),
        CandleBar("09:25", open=498.0, high=502.0, low=495.0, close=497.0, volume=4500),
    ]
    # OR: High = 505, Low = 490, Span = 15. Fallback stretch = 2.25.
    # Bear trigger = 490 - (0.20 * 2.25) = 489.55.

    # Breakdown bar at 09:30: Plunges to 480, closes at 482 with 12000 volume vs 4500 avg
    current_bar = CandleBar("09:30", open=496.0, high=497.0, low=480.0, close=482.0, volume=12000)
    rep = sieve.evaluate_orb(
        symbol="TATASTEEL",
        opening_bars=opening_bars,
        current_bar=current_bar,
        average_bar_volume=4500,
    )

    assert rep.or_low == 490.0
    assert rep.volume_expansion_ratio >= 1.80
    assert rep.regime == "BEARISH_ORB_BREAKDOWN_CONFIRMED"
    assert rep.trade_directive == "SELL_ORB_BREAKDOWN_EXPANSION"
    assert rep.target_1 < rep.or_low
    assert rep.stop_loss > rep.or_low


def test_false_breakout_bull_trap(sieve):
    opening_bars = [
        CandleBar("09:15", open=100.0, high=105.0, low=98.0, close=102.0, volume=1000),
        CandleBar("09:20", open=102.0, high=104.0, low=100.0, close=103.0, volume=1000),
        CandleBar("09:25", open=103.0, high=105.0, low=101.0, close=104.0, volume=1000),
    ]
    # OR: High = 105, Low = 98. Bull trigger = 105.21.
    # Bar at 09:30 spikes to 108.0 but closes at 103.0! Wick ratio = (108 - 104) / (108 - 101) = 4 / 7 = 0.57 >= 0.50
    current_bar = CandleBar("09:30", open=104.0, high=108.0, low=101.0, close=103.0, volume=3000)
    rep = sieve.evaluate_orb(
        symbol="TRAP_CO",
        opening_bars=opening_bars,
        current_bar=current_bar,
        average_bar_volume=1000,
    )

    assert rep.wick_ratio >= 0.50
    assert rep.regime == "FALSE_BREAKOUT_BULL_TRAP"
    assert rep.trade_directive == "FADE_FALSE_BREAKOUT_SHORT"


def test_in_range_consolidation(sieve):
    opening_bars = [
        CandleBar("09:15", open=100.0, high=110.0, low=90.0, close=105.0, volume=1000),
        CandleBar("09:20", open=105.0, high=108.0, low=95.0, close=102.0, volume=1000),
        CandleBar("09:25", open=102.0, high=106.0, low=98.0, close=101.0, volume=1000),
    ]
    # Current bar stays inside 90 - 110
    current_bar = CandleBar("09:30", open=101.0, high=104.0, low=99.0, close=102.0, volume=1200)
    rep = sieve.evaluate_orb(
        symbol="RANGE_CO",
        opening_bars=opening_bars,
        current_bar=current_bar,
        average_bar_volume=1000,
    )

    assert rep.regime == "IN_RANGE_CONSOLIDATION"
    assert rep.trade_directive == "STAND_ASIDE_INITIAL_BALANCE"


def test_sqlite_persistence(sieve):
    opening_bars = [
        CandleBar("09:15", open=100.0, high=105.0, low=95.0, close=100.0, volume=1000),
    ]
    current_bar = CandleBar("09:20", open=100.0, high=102.0, low=98.0, close=101.0, volume=1000)
    sieve.evaluate_orb("PERSIST_SYM", opening_bars, current_bar, 1000)

    conn = sieve._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, or_high, or_low, regime FROM orb_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_SYM"
