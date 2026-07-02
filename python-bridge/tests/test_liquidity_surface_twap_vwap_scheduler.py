"""
Unit Tests for Multi-Asset Intraday Liquidity Surface Curvature & Optimal TWAP/VWAP Scheduler
Domain 230 / Work Package WP-EB
"""

import pytest
import math
from services.liquidity_surface_twap_vwap_scheduler import (
    LiquiditySurfaceTWAPVWAPScheduler,
    SchedulerRegimeState,
)


def test_u_shaped_profile_properties():
    scheduler = LiquiditySurfaceTWAPVWAPScheduler()
    profile = scheduler.generate_u_shaped_volume_profile(num_bins=13)

    assert len(profile) == 13
    assert pytest.approx(sum(profile), 1e-6) == 1.0
    # U-shape: open and close weights > midday weight
    assert profile[0] > profile[6]
    assert profile[12] > profile[6]
    # Symmetric
    assert pytest.approx(profile[0], 1e-4) == profile[12]


def test_surface_curvature_estimation():
    scheduler = LiquiditySurfaceTWAPVWAPScheduler()
    # Linear impact: slope is constant, second derivative is zero
    linear_depths = [10000.0, 20000.0, 30000.0]
    linear_impacts = [5.0, 10.0, 15.0]
    curv_linear = scheduler.compute_surface_curvature(linear_depths, linear_impacts)
    assert curv_linear == 0.1  # clamped at minimum 0.1

    # Convex impact: slope increases (book hollowing)
    convex_depths = [10000.0, 20000.0, 30000.0]
    convex_impacts = [5.0, 12.0, 25.0]
    curv_convex = scheduler.compute_surface_curvature(convex_depths, convex_impacts)
    assert curv_convex > 1.0


def test_vwap_schedule_shares_conservation_and_capping():
    scheduler = LiquiditySurfaceTWAPVWAPScheduler(max_participation_rate=0.10)
    total_shares = 10000.0
    volumes = [50000.0, 30000.0, 20000.0, 20000.0, 30000.0, 50000.0]

    schedule = scheduler.generate_vwap_schedule(
        total_shares=total_shares,
        interval_volumes=volumes,
        current_price=100.0,
        interval_minutes=30.0,
        curvature_index=1.0,
    )

    assert len(schedule.slices) == 6
    # Conservation of shares: sum of scheduled slices = total_shares
    scheduled_sum = sum(s.scheduled_shares for s in schedule.slices)
    assert pytest.approx(scheduled_sum, 0.1) == total_shares

    # Peak participation rate should be reasonably controlled
    assert schedule.peak_participation_rate <= 0.12
    assert schedule.total_expected_impact_usd > 0.0
    assert schedule.regime == SchedulerRegimeState.OPTIMAL_VWAP_TRACKING


def test_surface_compression_regime():
    scheduler = LiquiditySurfaceTWAPVWAPScheduler()
    total_shares = 5000.0
    volumes = [20000.0] * 5

    # High curvature index = 2.5
    schedule = scheduler.generate_vwap_schedule(
        total_shares=total_shares,
        interval_volumes=volumes,
        current_price=50.0,
        curvature_index=2.5,
    )

    assert schedule.regime == SchedulerRegimeState.SURFACE_COMPRESSION
    assert "THROTTLE_SLICES" in schedule.recommended_action


def test_almgren_chriss_trajectory_monotonicity():
    scheduler = LiquiditySurfaceTWAPVWAPScheduler()
    total_shares = 20000.0
    num_slices = 10

    schedule = scheduler.generate_almgren_chriss_trajectory(
        total_shares=total_shares,
        num_slices=num_slices,
        daily_volatility=0.25,
        current_price=150.0,
        total_duration_hours=6.5,
    )

    assert len(schedule.slices) == num_slices
    # Sum of trade slices should equal total_shares
    total_executed = sum(s.scheduled_shares for s in schedule.slices)
    assert pytest.approx(total_executed, 1.0) == total_shares

    # Each slice is positive
    for s in schedule.slices:
        assert s.scheduled_shares > 0.0
    assert schedule.total_expected_impact_usd > 0.0
