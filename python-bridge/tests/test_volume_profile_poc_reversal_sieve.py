r"""
Unit Test Suite for Domain 193 (WP-CQ): Intraday Volume Profile Point-of-Control (POC) & Value Area Reversal Sieve
"""

import math
import pytest
from services.volume_profile_poc_reversal_sieve import (
    TradeTick,
    VolumeProfileDirective,
    VolumeProfilePOCReversalSieve,
)


def _generate_synthetic_gaussian_profile_ticks(center: float = 25000.0, std: float = 10.0):
    """Generates synthetic trade ticks around a modal price center."""
    ticks = []
    t = 0.0
    for offset in range(-30, 31):
        price = center + float(offset)
        # Gaussian volume distribution
        vol = 1000.0 * math.exp(-0.5 * (offset / std) ** 2)
        ticks.append(TradeTick(timestamp_sec=t, price=price, volume=round(vol, 2)))
        t += 1.0
    return ticks


def test_poc_and_value_area_calculation():
    """Verifies that the Point-of-Control (POC) and 70% Value Area [VAL, VAH] are correctly computed."""
    sieve = VolumeProfilePOCReversalSieve(db_path=":memory:", price_step=1.0, value_area_ratio=0.70)
    ticks = _generate_synthetic_gaussian_profile_ticks(center=25000.0, std=10.0)

    profile, poc, vah, val, hvns, lvns = sieve.build_profile(ticks)

    assert poc == 25000.0
    assert val < poc < vah
    assert val >= 24985.0
    assert vah <= 25015.0

    total_vol = sum(profile.values())
    va_vol = sum(profile[p] for p in profile if val <= p <= vah)
    assert (va_vol / total_vol) >= 0.70
    assert 25000.0 in hvns


def test_value_area_rejection_long_at_val():
    """Verifies that price testing Value Area Low triggers responsive buyer reversal long."""
    sieve = VolumeProfilePOCReversalSieve(db_path=":memory:", price_step=1.0)
    ticks = _generate_synthetic_gaussian_profile_ticks(center=25000.0, std=10.0)

    # First get VAL
    _, poc, vah, val, _, _ = sieve.build_profile(ticks)

    # Current price testing VAL
    report = sieve.evaluate_market_profile("NIFTY", current_price=val, ticks=ticks)

    assert report.directive == VolumeProfileDirective.VALUE_AREA_REJECTION_REVERSAL_LONG
    assert report.recommended_take_profit == poc
    assert report.recommended_stop_loss < val
    assert "Responsive buyers defending Value Area Low" in report.rationale


def test_value_area_rejection_short_at_vah():
    """Verifies that price testing Value Area High triggers responsive seller reversal short."""
    sieve = VolumeProfilePOCReversalSieve(db_path=":memory:", price_step=1.0)
    ticks = _generate_synthetic_gaussian_profile_ticks(center=25000.0, std=10.0)

    _, poc, vah, val, _, _ = sieve.build_profile(ticks)

    # Current price testing VAH
    report = sieve.evaluate_market_profile("NIFTY", current_price=vah, ticks=ticks)

    assert report.directive == VolumeProfileDirective.VALUE_AREA_REJECTION_REVERSAL_SHORT
    assert report.recommended_take_profit == poc
    assert report.recommended_stop_loss > vah
    assert "Responsive sellers rejecting Value Area High" in report.rationale


def test_initiative_breakout_chase_into_lvn():
    """Verifies that price breaking outside the Value Area triggers breakout expansion chase."""
    sieve = VolumeProfilePOCReversalSieve(db_path=":memory:", price_step=1.0)
    ticks = _generate_synthetic_gaussian_profile_ticks(center=25000.0, std=10.0)

    _, poc, vah, val, _, _ = sieve.build_profile(ticks)

    # Current price far above VAH (breakout)
    report = sieve.evaluate_market_profile("NIFTY", current_price=vah + 25.0, ticks=ticks)

    assert report.directive == VolumeProfileDirective.VALUE_AREA_BREAKOUT_EXPANSION_CHASE
    assert "initiative breakout outside Value Area" in report.rationale
    assert report.recommended_take_profit > report.current_price


def test_sqlite_telemetry_persistence():
    """Verifies SQLite recording and retrieval of volume profile telemetry."""
    sieve = VolumeProfilePOCReversalSieve(db_path=":memory:")
    ticks = _generate_synthetic_gaussian_profile_ticks(center=52000.0, std=20.0)

    sieve.evaluate_market_profile("BANKNIFTY", current_price=52000.0, ticks=ticks)

    records = sieve.get_recent_profiles(limit=5)
    assert len(records) == 1
    assert records[0]["symbol"] == "BANKNIFTY"
    assert records[0]["poc"] == 52000.0
