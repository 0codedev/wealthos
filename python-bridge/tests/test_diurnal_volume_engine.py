"""
Unit Tests for Intraday Volume U-Curve & Diurnal Activity Profile Engine (Domain 128 / WP-AD)
"""

from datetime import datetime, time
import pytest

from services.diurnal_volume_engine import (
    DiurnalVolumeEngine,
    IntradaySliceSchedule,
    DiurnalRegimeAssessment,
)


@pytest.fixture
def diurnal_engine():
    return DiurnalVolumeEngine(
        market_open_time=time(9, 15, 0),
        market_close_time=time(15, 30, 0),
        u_curve_gamma=2.5,
        asymmetry_alpha=0.20,
        db_path=":memory:",
    )


def test_u_curve_shape(diurnal_engine):
    # Morning open (t=0)
    u_open = diurnal_engine.volume_intensity_u(0.0)
    # Afternoon close (t=1.0)
    u_close = diurnal_engine.volume_intensity_u(1.0)
    # Mid-day trough (t=0.5)
    u_mid = diurnal_engine.volume_intensity_u(0.5)

    # U-shape properties:
    assert u_open > u_mid
    assert u_close > u_mid
    assert u_mid < 1.0  # Trough intensity is below average 1.0


def test_cumulative_volume_fraction_endpoints(diurnal_engine):
    # F(0) == 0.0 and F(1.0) == 1.0
    f0 = diurnal_engine.cumulative_volume_fraction_f(0.0)
    f1 = diurnal_engine.cumulative_volume_fraction_f(1.0)
    f_mid = diurnal_engine.cumulative_volume_fraction_f(0.5)

    assert abs(f0 - 0.0) < 1e-4
    assert abs(f1 - 1.0) < 1e-4
    # Monotonicity
    assert 0.0 < f_mid < 1.0


def test_vwap_slice_schedule_conservation(diurnal_engine):
    total_shares = 10000
    schedule = diurnal_engine.generate_vwap_slice_schedule(total_shares, slice_interval_minutes=15)

    # Total 375 mins / 15 mins = 25 slices
    assert len(schedule) == 25
    # Strict conservation of shares
    allocated_sum = sum(s.target_shares for s in schedule)
    assert allocated_sum == total_shares
    assert schedule[-1].cumulative_target_shares == total_shares


def test_vwap_slice_schedule_u_distribution(diurnal_engine):
    schedule = diurnal_engine.generate_vwap_slice_schedule(10000, slice_interval_minutes=15)

    # Slice 1 (09:15-09:30) vs Slice 13 (12:15-12:30)
    morning_slice = schedule[0]
    lunch_slice = schedule[12]
    afternoon_slice = schedule[-2]

    # Morning and afternoon slices must be substantially larger than lunchtime slices
    assert morning_slice.target_shares > lunch_slice.target_shares
    assert afternoon_slice.target_shares > lunch_slice.target_shares


def test_diurnal_regime_morning(diurnal_engine):
    t_morning = datetime(2026, 10, 18, 9, 30, 0)
    assessment = diurnal_engine.assess_diurnal_regime(t_morning)

    assert assessment.regime == "MORNING_EXPANSION"
    assert not assessment.is_lunch_blackout_active
    assert assessment.recommended_breakout_hurdle_multiplier == 1.0
    assert assessment.minute_from_open == 15


def test_diurnal_regime_lunch_drought(diurnal_engine):
    t_lunch = datetime(2026, 10, 18, 12, 45, 0)
    assessment = diurnal_engine.assess_diurnal_regime(t_lunch)

    assert assessment.regime == "LUNCHTIME_LIQUIDITY_DROUGHT"
    assert assessment.is_lunch_blackout_active is True
    assert assessment.recommended_breakout_hurdle_multiplier == 1.80
    assert assessment.volume_intensity_factor < 1.0


def test_diurnal_regime_afternoon(diurnal_engine):
    t_afternoon = datetime(2026, 10, 18, 14, 45, 0)
    assessment = diurnal_engine.assess_diurnal_regime(t_afternoon)

    assert assessment.regime == "AFTERNOON_INSTITUTIONAL_CLOSING"
    assert not assessment.is_lunch_blackout_active


def test_sqlite_persistence(diurnal_engine):
    t = datetime(2026, 10, 18, 10, 0, 0)
    diurnal_engine.assess_diurnal_regime(t)

    conn = diurnal_engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT minute_from_open, regime FROM diurnal_volume_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == 45
    assert row[1] == "MORNING_EXPANSION"
