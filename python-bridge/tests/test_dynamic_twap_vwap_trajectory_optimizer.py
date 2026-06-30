r"""Unit Tests for Intraday Volume Clustering & Dynamic TWAP-VWAP Trajectory Optimizer (Domain 204 / WP-DB)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.dynamic_twap_vwap_trajectory_optimizer import (
    DynamicTWAPVWAPTrajectoryOptimizer,
    ExecutionUrgency,
    VolumeSurgeState,
)


@pytest.fixture
def optimizer() -> DynamicTWAPVWAPTrajectoryOptimizer:
    return DynamicTWAPVWAPTrajectoryOptimizer(
        default_intervals=12,
        max_participation_rate=0.15,
        base_spread_bps=2.0,
    )


def test_diurnal_volume_curve_u_shape(optimizer: DynamicTWAPVWAPTrajectoryOptimizer):
    total_vol = 1_000_000.0
    vols = optimizer.generate_diurnal_volume_curve(num_intervals=12, total_day_volume=total_vol)

    assert len(vols) == 12
    assert math.isclose(sum(vols), total_vol, rel_tol=1e-5)
    # Morning (vols[0]) and Closing (vols[11]) should exceed Midday (vols[5], vols[6])
    assert vols[0] > vols[5]
    assert vols[11] > vols[6]


def test_compute_optimal_trajectory_conservation(optimizer: DynamicTWAPVWAPTrajectoryOptimizer):
    order_shares = 10_000.0
    plan = optimizer.compute_optimal_trajectory(
        total_order_shares=order_shares,
        trading_duration_minutes=120,
        daily_adv_shares=500_000.0,
        urgency=ExecutionUrgency.BALANCED_HYBRID,
        num_intervals=6,
    )

    assert plan.num_intervals == 6
    assert plan.total_order_shares == order_shares
    assert len(plan.slices) == 6

    # Cumulative shares must equal total order shares
    total_scheduled = sum(s.planned_slice_shares for s in plan.slices)
    assert math.isclose(total_scheduled, order_shares, abs_tol=1.0)
    assert math.isclose(plan.slices[-1].cumulative_planned_shares, order_shares, abs_tol=1.0)
    assert plan.total_expected_impact_bps > 0.0


def test_urgency_modes_comparison(optimizer: DynamicTWAPVWAPTrajectoryOptimizer):
    order_shares = 10_000.0
    # Aggressive TWAP
    plan_agg = optimizer.compute_optimal_trajectory(
        total_order_shares=order_shares,
        trading_duration_minutes=120,
        daily_adv_shares=500_000.0,
        urgency=ExecutionUrgency.AGGRESSIVE_TWAP,
        num_intervals=6,
    )
    # Passive VWAP
    plan_pas = optimizer.compute_optimal_trajectory(
        total_order_shares=order_shares,
        trading_duration_minutes=120,
        daily_adv_shares=500_000.0,
        urgency=ExecutionUrgency.PASSIVE_VWAP,
        num_intervals=6,
    )

    # Aggressive front-loads more in first two slices
    agg_early = plan_agg.slices[0].planned_slice_shares + plan_agg.slices[1].planned_slice_shares
    pas_early = plan_pas.slices[0].planned_slice_shares + plan_pas.slices[1].planned_slice_shares
    assert agg_early >= pas_early


def test_adapt_slice_for_volume_clustering_surge(optimizer: DynamicTWAPVWAPTrajectoryOptimizer):
    plan = optimizer.compute_optimal_trajectory(
        total_order_shares=5_000.0,
        trading_duration_minutes=60,
        daily_adv_shares=200_000.0,
        num_intervals=4,
    )
    slice_1 = plan.slices[0]

    # Actual volume is 2.2x expected (huge liquidity surge)
    actual_vol = slice_1.expected_market_volume * 2.2
    res = optimizer.adapt_slice_for_volume_clustering(
        planned_slice=slice_1,
        actual_interval_volume=actual_vol,
        remaining_order_shares=5_000.0,
    )

    assert res.surge_state == VolumeSurgeState.SURGE_CLUSTERED
    assert res.volume_surprise_ratio > 1.40
    assert res.adjusted_slice_shares > slice_1.planned_slice_shares
    assert "IOC" in res.recommended_order_type or "PEG" in res.recommended_order_type


def test_adapt_slice_for_volume_clustering_drought(optimizer: DynamicTWAPVWAPTrajectoryOptimizer):
    plan = optimizer.compute_optimal_trajectory(
        total_order_shares=5_000.0,
        trading_duration_minutes=60,
        daily_adv_shares=200_000.0,
        num_intervals=4,
    )
    slice_1 = plan.slices[0]

    # Actual volume is only 0.4x expected (liquidity vacuum)
    actual_vol = slice_1.expected_market_volume * 0.40
    res = optimizer.adapt_slice_for_volume_clustering(
        planned_slice=slice_1,
        actual_interval_volume=actual_vol,
        remaining_order_shares=5_000.0,
    )

    assert res.surge_state == VolumeSurgeState.LIQUIDITY_DROUGHT
    assert res.volume_surprise_ratio < 0.75
    assert res.adjusted_slice_shares < slice_1.planned_slice_shares
    assert "PASSIVE" in res.recommended_order_type
