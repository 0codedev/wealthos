"""
Unit tests for Domain 272 / WP-FR: LOB Market Impact Decay & Resiliency Kernel
"""

import pytest
from services.lob_impact_resiliency_kernel import (
    LOBImpactResiliencyKernel,
    TradeSliceImpact,
    LOBResiliencyRegime,
    ImpactPacingDirective,
)


@pytest.fixture
def kernel():
    return LOBImpactResiliencyKernel(
        tau_relaxation_ms=200.0,
        gamma_decay_exponent=0.35,
        permanent_impact_ratio=0.40,
        target_resiliency_recovery=0.80,
        max_transient_hazard_bps=5.0,
    )


def test_propagator_decay_monotonicity(kernel):
    assert kernel.propagator_decay(0.0) == 1.0
    times = [50.0, 200.0, 1000.0, 5000.0]
    vals = [kernel.propagator_decay(t) for t in times]
    for i in range(len(vals) - 1):
        assert vals[i] > vals[i + 1]


def test_empty_slice_quiescent(kernel):
    res = kernel.evaluate_resiliency("BTCUSDT", current_time_ms=1000.0, recent_slices=[])
    assert res.regime == LOBResiliencyRegime.OPTIMAL_RESILIENT_RECOVERY_COMPLETE
    assert res.directive == ImpactPacingDirective.EXECUTE_NEXT_ORDER_SLICE
    assert res.resiliency_recovery_pct == 100.0


def test_severe_unrelaxed_self_impact_hazard(kernel):
    # Slice of 10 bps impact fired just 10 ms ago
    slices = [
        TradeSliceImpact(timestamp_ms=1000.0, order_size=500.0, instantaneous_impact_bps=10.0),
    ]
    res = kernel.evaluate_resiliency("ETHUSDT", current_time_ms=1010.0, recent_slices=slices)
    assert res.regime == LOBResiliencyRegime.SEVERE_UNRELAXED_SELF_IMPACT_HAZARD
    assert res.directive == ImpactPacingDirective.PAUSE_AGGRESSIONS_AWAIT_REPLENISHMENT
    assert res.current_transient_impact_bps >= 5.0
    assert res.resiliency_recovery_pct < 40.0


def test_partially_relaxed_throttled_pacing(kernel):
    # Slice of 6 bps fired 300 ms ago -> recovery between 40% and 80%
    slices = [
        TradeSliceImpact(timestamp_ms=1000.0, order_size=200.0, instantaneous_impact_bps=6.0),
    ]
    res = kernel.evaluate_resiliency("SOLUSDT", current_time_ms=1300.0, recent_slices=slices)
    assert res.regime == LOBResiliencyRegime.PARTIALLY_RELAXED_THROTTLED_PACING
    assert res.directive == ImpactPacingDirective.THROTTLE_SLICE_SIZE_EXTEND_DELAY


def test_optimal_resilient_recovery_complete(kernel):
    # Slice of 5 bps fired 100,000 ms ago -> fully recovered (> 80%)
    slices = [
        TradeSliceImpact(timestamp_ms=1000.0, order_size=100.0, instantaneous_impact_bps=5.0),
    ]
    res = kernel.evaluate_resiliency("AVAXUSDT", current_time_ms=101000.0, recent_slices=slices)
    assert res.regime == LOBResiliencyRegime.OPTIMAL_RESILIENT_RECOVERY_COMPLETE
    assert res.directive == ImpactPacingDirective.EXECUTE_NEXT_ORDER_SLICE
    assert res.resiliency_recovery_pct >= 80.0
