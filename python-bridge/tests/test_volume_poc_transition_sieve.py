"""
Unit tests for Domain 166 (WP-BP): Intraday Volume POC Transition & Market Profile Value Area Sieve
"""

import pytest
from services.volume_poc_transition_sieve import (
    CandleBar,
    VolumePOCTransitionSieve,
    ValueAreaResult,
    VolumePOCReport,
)


def test_build_volume_profile():
    sieve = VolumePOCTransitionSieve(bin_size=1.0)
    bars = [
        CandleBar(timestamp="09:15", open=100.0, high=102.0, low=100.0, close=101.0, volume=300.0),
        CandleBar(timestamp="09:20", open=101.0, high=103.0, low=101.0, close=102.0, volume=300.0),
    ]
    profile = sieve.build_volume_profile(bars)
    assert len(profile) > 0
    total_vol = sum(profile.values())
    assert abs(total_vol - 600.0) < 1e-4
    # Check bin 101.0 received volume from both bars
    assert profile[101.0] > 0.0


def test_calculate_value_area_70_percent():
    sieve = VolumePOCTransitionSieve(bin_size=1.0, va_ratio_target=0.70)
    # Construct a bell-shaped volume profile centered at 100.0
    profile = {
        97.0: 50.0,
        98.0: 100.0,
        99.0: 200.0,
        100.0: 500.0,  # POC
        101.0: 250.0,
        102.0: 120.0,
        103.0: 40.0,
    }
    va = sieve.calculate_value_area(profile)
    assert va.poc == 100.0
    assert va.poc_volume == 500.0
    assert va.va_ratio >= 0.70
    assert va.val <= va.poc <= va.vah
    assert va.val >= 97.0
    assert va.vah <= 103.0


def test_poc_migration_velocity():
    sieve = VolumePOCTransitionSieve(bin_size=1.0)
    # Window 1: Centered at 100
    win1 = [CandleBar(timestamp="09:15", open=99.0, high=101.0, low=99.0, close=100.0, volume=500.0)]
    # Window 2: Centered at 105
    win2 = [CandleBar(timestamp="09:30", open=104.0, high=106.0, low=104.0, close=105.0, volume=500.0)]

    velocity = sieve.calculate_poc_migration_velocity([win1, win2], window_minutes=15.0)
    # Delta POC = 105 - 100 = 5.0 points in 0.25 hours -> 20.0 pts/hour
    assert velocity > 0.0
    assert abs(velocity - 20.0) < 0.1


def test_find_virgin_pocs():
    sieve = VolumePOCTransitionSieve()
    hist_pocs = [95.0, 100.0, 110.0]
    # Price traded between 98 and 105
    subsequent_bars = [
        CandleBar(timestamp="10:00", open=98.0, high=105.0, low=98.0, close=102.0, volume=1000.0),
    ]
    virgin_pocs = sieve.find_virgin_pocs(hist_pocs, subsequent_bars)
    # 100.0 was traversed (98 <= 100 <= 105), 95.0 and 110.0 remain virgin
    assert 100.0 not in virgin_pocs
    assert 95.0 in virgin_pocs
    assert 110.0 in virgin_pocs


def test_analyze_market_profile_regimes():
    sieve = VolumePOCTransitionSieve(bin_size=1.0)
    # Base bars around 100.0
    base_bars = [
        CandleBar(timestamp="09:15", open=98.0, high=102.0, low=98.0, close=100.0, volume=500.0),
        CandleBar(timestamp="09:20", open=99.0, high=101.0, low=99.0, close=100.0, volume=800.0),
    ]

    # Test 1: Rotational inside VA
    rep_rot = sieve.analyze_market_profile("NIFTY", base_bars)
    assert "ROTATIONAL" in rep_rot.regime
    assert rep_rot.poc == 100.0

    # Test 2: Virgin POC Magnet Pull
    # Price is at 100.0, virgin POC at 100.20 (within 30 bps, above the bar high 100.10)
    magnet_bars = [
        CandleBar(timestamp="09:15", open=99.5, high=100.10, low=99.5, close=100.0, volume=500.0),
    ]
    rep_magnet = sieve.analyze_market_profile(
        "NIFTY", magnet_bars, historical_pocs=[100.20]
    )
    assert rep_magnet.regime == "VPOC_MAGNET_ATTRACTION"
    assert rep_magnet.trade_directive == "EXECUTE_LONG_MAGNET_TARGET"

    # Test 3: Value Area Expansion Bullish with velocity
    breakout_bar = CandleBar(
        timestamp="09:25", open=103.0, high=105.0, low=103.0, close=104.5, volume=200.0
    )
    win2 = [
        CandleBar(timestamp="09:30", open=104.0, high=106.0, low=104.0, close=105.0, volume=500.0)
    ]
    rep_exp = sieve.analyze_market_profile(
        "NIFTY",
        base_bars + [breakout_bar],
        prior_windows=[base_bars, win2],
    )
    assert rep_exp.regime == "VALUE_AREA_EXPANSION_BULLISH"
    assert rep_exp.trade_directive == "INITIATIVE_LONG_BREAKOUT"


def test_sqlite_persistence():
    sieve = VolumePOCTransitionSieve(db_path=":memory:", bin_size=1.0)
    bars = [
        CandleBar(timestamp="09:15", open=98.0, high=102.0, low=98.0, close=100.0, volume=500.0),
    ]
    rep = sieve.analyze_market_profile("BANKNIFTY", bars)
    assert rep.symbol == "BANKNIFTY"

    rows = sieve.get_latest_telemetry(5)
    assert len(rows) == 1
    assert rows[0][0] == "BANKNIFTY"
    assert rows[0][2] == 100.0  # POC
