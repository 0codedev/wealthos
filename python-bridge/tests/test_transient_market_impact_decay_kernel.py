r"""Unit Tests for Cross-Market Order Slicing & Transient Market Impact Decay Kernel (Domain 216 / WP-DN)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import pytest
from services.transient_market_impact_decay_kernel import (
    TransientMarketImpactDecayKernel,
    ExecutedSlice,
    SlicingPaceRegime,
    SlicingTacticalAction,
)


@pytest.fixture
def kernel() -> TransientMarketImpactDecayKernel:
    return TransientMarketImpactDecayKernel(
        g_0=1.0,
        tau_0_recovery_sec=2.50,
        power_law_alpha=0.50,
        impact_coefficient_eta=0.40,
        adv_shares_per_sec=500.0,
        max_tolerable_impact_bps=25.0,
    )


def test_propagator_kernel_decay(kernel: TransientMarketImpactDecayKernel):
    # At tau = 0, G(0) = 1.0
    assert kernel.propagator_kernel_g(0.0) == 1.0

    # At tau = tau_0 (2.5s), G(2.5) = 1.0 / (1 + 1)^0.5 = 1 / sqrt(2) ~ 0.7071
    g_half = kernel.propagator_kernel_g(2.5)
    assert pytest.approx(g_half, 1e-3) == 0.7071

    # At tau = 10.0s, G(10) = 1.0 / (1 + 4)^0.5 = 1 / sqrt(5) ~ 0.4472
    g_10 = kernel.propagator_kernel_g(10.0)
    assert pytest.approx(g_10, 1e-3) == 0.4472
    assert g_10 < g_half < 1.0


def test_instantaneous_slice_impact(kernel: TransientMarketImpactDecayKernel):
    # 500 shares (100% of 1 sec ADV): impact = 0.40 * sqrt(1.0) * 100 = 40.0 bps
    imp_500 = kernel.instantaneous_slice_impact_bps(500.0)
    assert imp_500 == 40.0

    # 125 shares (25% of 1 sec ADV): impact = 0.40 * sqrt(0.25) * 100 = 20.0 bps
    imp_125 = kernel.instantaneous_slice_impact_bps(125.0)
    assert imp_125 == 20.0


def test_optimal_equilibrium_pace(kernel: TransientMarketImpactDecayKernel):
    # Order of 1,000 shares across 10 slices of 100 shares.
    # Slices spaced 10 seconds apart (well past 2.5s half life)
    slices = [
        ExecutedSlice(slice_id=1, timestamp_sec=0.0, shares=50.0, side="BUY"),
        ExecutedSlice(slice_id=2, timestamp_sec=10.0, shares=50.0, side="BUY"),
        ExecutedSlice(slice_id=3, timestamp_sec=20.0, shares=50.0, side="BUY"),
    ]

    res = kernel.evaluate_slicing_schedule(
        symbol="NIFTY",
        total_order_size=1000.0,
        executed_slices=slices,
        current_time_sec=25.0, # 5s after slice 3
        target_total_duration_sec=60.0,
        num_target_slices=10,
        urgency_factor=0.50,
    )

    assert res.shares_executed_so_far == 150.0
    assert res.shares_remaining == 850.0
    assert res.accumulated_transient_impact_bps < kernel.max_impact_bps
    assert res.pace_regime == SlicingPaceRegime.OPTIMAL_EQUILIBRIUM_PACE
    assert res.recommended_action == SlicingTacticalAction.DISPATCH_SCHEDULED_SLICE
    assert "OPTIMAL PACE" in res.tactical_directive


def test_overheated_impact_spike(kernel: TransientMarketImpactDecayKernel):
    # Rapid-fire executions fired every 0.2 seconds (5 slices in 1 second)
    slices = [
        ExecutedSlice(slice_id=i, timestamp_sec=i * 0.2, shares=100.0, side="BUY")
        for i in range(5)
    ]

    # Evaluate right after the 5th slice (t = 0.9s)
    res = kernel.evaluate_slicing_schedule(
        symbol="BANKNIFTY",
        total_order_size=2000.0,
        executed_slices=slices,
        current_time_sec=0.9,
        target_total_duration_sec=60.0,
        num_target_slices=10,
    )

    assert res.accumulated_transient_impact_bps >= kernel.max_impact_bps
    assert res.pace_regime == SlicingPaceRegime.OVERHEATED_IMPACT_SPIKE
    assert res.recommended_action == SlicingTacticalAction.PAUSE_AND_COOL_DOWN
    assert res.recommended_inter_slice_delay_sec > 6.0 * 2.0
    assert "Pause execution" in res.tactical_directive


def test_high_urgency_front_load(kernel: TransientMarketImpactDecayKernel):
    # Only 1 small slice executed, but urgency is set to 90%
    slices = [
        ExecutedSlice(slice_id=1, timestamp_sec=0.0, shares=10.0, side="BUY"),
    ]

    res = kernel.evaluate_slicing_schedule(
        symbol="RELIANCE",
        total_order_size=1000.0,
        executed_slices=slices,
        current_time_sec=5.0,
        target_total_duration_sec=60.0,
        num_target_slices=10,
        urgency_factor=0.90, # Very high urgency
    )

    assert res.pace_regime == SlicingPaceRegime.HIGH_URGENCY_FRONT_LOAD
    assert res.recommended_action == SlicingTacticalAction.DISPATCH_SCHEDULED_SLICE
    # Slice size expanded
    assert res.next_planned_slice_size > (990.0 / 9)
    assert "HIGH URGENCY" in res.tactical_directive
