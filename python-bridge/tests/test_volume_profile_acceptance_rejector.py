"""
Unit Tests for Intraday Volume Profile Point of Acceptance & Low Volume Node Rejector (Domain 138 / WP-AN)
"""

from datetime import datetime, timedelta
import pytest

from services.volume_profile_acceptance_rejector import (
    VolumeProfileAcceptanceRejector,
    ProfileBin,
    VolumeProfileAnalysis,
)


@pytest.fixture
def vp_engine():
    return VolumeProfileAcceptanceRejector(
        hvn_sigma_threshold=0.8,
        lvn_sigma_threshold=-0.5,
        fast_pass_velocity_threshold=2.0,
        db_path=":memory:",
    )


@pytest.fixture
def bimodal_profile():
    # Construct bimodal profile: Peak at 25000 (HVN1), Valley at 25050 (LVN), Peak at 25100 (HVN2)
    bins = [
        ProfileBin(24980.0, 100.0),
        ProfileBin(24990.0, 300.0),
        ProfileBin(25000.0, 1000.0),  # HVN 1
        ProfileBin(25010.0, 400.0),
        ProfileBin(25030.0, 150.0),
        ProfileBin(25050.0, 20.0),   # LVN (valley)
        ProfileBin(25070.0, 180.0),
        ProfileBin(25090.0, 450.0),
        ProfileBin(25100.0, 1100.0), # HVN 2
        ProfileBin(25110.0, 350.0),
        ProfileBin(25120.0, 100.0),
    ]
    return bins


def test_identify_hvn_and_lvn(vp_engine, bimodal_profile):
    hvns, lvns = vp_engine.identify_hvn_and_lvn(bimodal_profile)

    assert 25000.0 in hvns
    assert 25100.0 in hvns
    assert 25050.0 in lvns


def test_fast_pass_through_expansion_regime(vp_engine, bimodal_profile):
    t0 = datetime(2026, 10, 18, 9, 30, 0)
    vp_engine.analyze_market_state(25040.0, bimodal_profile, timestamp=t0)

    # 1 second later: price sweeps into LVN at 25050 (speed = 10 pts/sec >= 2.0 pts/sec)
    t1 = t0 + timedelta(seconds=1.0)
    res = vp_engine.analyze_market_state(25050.0, bimodal_profile, timestamp=t1)

    assert res.is_in_lvn_vacuum is True
    assert res.regime == "FAST_PASS_THROUGH_EXPANSION"
    assert res.trade_recommendation == "MOMENTUM_LONG_SWEEP"
    assert res.profit_target_anchor == 25100.0  # Next higher HVN
    assert "Rapid pass-through" in res.rationale


def test_lvn_boundary_rejection_regime(vp_engine, bimodal_profile):
    t0 = datetime(2026, 10, 18, 10, 0, 0)
    vp_engine.analyze_market_state(25045.0, bimodal_profile, timestamp=t0)

    # 5 seconds later: price barely moves to 25046 (speed = 0.2 pts/sec < 2.0 pts/sec near LVN 25050)
    t1 = t0 + timedelta(seconds=5.0)
    res = vp_engine.analyze_market_state(25046.0, bimodal_profile, timestamp=t1)

    assert res.regime == "LVN_BOUNDARY_REJECTION"
    assert res.trade_recommendation == "FADE_REJECTION_SHORT"
    assert res.profit_target_anchor == 25000.0  # nearest HVN fair value


def test_hvn_fair_value_chop_regime(vp_engine, bimodal_profile):
    t0 = datetime(2026, 10, 18, 11, 0, 0)
    res = vp_engine.analyze_market_state(25000.0, bimodal_profile, timestamp=t0)

    assert res.regime == "HVN_FAIR_VALUE_CHOP"
    assert res.trade_recommendation == "MEAN_REVERSION_GRID"
    assert res.nearest_hvn == 25000.0


def test_sqlite_persistence(vp_engine, bimodal_profile):
    t0 = datetime(2026, 10, 18, 12, 0, 0)
    vp_engine.analyze_market_state(25100.0, bimodal_profile, timestamp=t0)

    conn = vp_engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT current_price, regime, recommendation FROM volume_profile_acceptance_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == 25100.0
    assert row[1] == "HVN_FAIR_VALUE_CHOP"
