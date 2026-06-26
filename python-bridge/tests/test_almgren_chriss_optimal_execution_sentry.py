"""
Unit Test Suite for Domain 256: Intraday Algorithmic Order Slicing VWAP/TWAP Slippage Bound & Almgren-Chriss Optimal Execution Sentry
"""

import pytest
from services.almgren_chriss_optimal_execution_sentry import (
    AlmgrenChrissOptimalExecutionSentry,
    ExecutionParameters,
    IntervalExecutionUpdate,
    ExecutionTrackingRegime,
    ExecutionPacingDirective,
)


@pytest.fixture
def sentry():
    params = ExecutionParameters(
        total_shares_x0=10_000.0,
        total_time_horizon_sec=3600.0,
        num_intervals=10,
        temporary_impact_eta=2.5e-6,
        permanent_impact_gamma=1.0e-7,
        asset_volatility_sigma=0.015,
        urgency_lambda=1.0e-5,
    )
    return AlmgrenChrissOptimalExecutionSentry(params=params)


def test_trajectory_precomputation(sentry):
    path = sentry.scheduled_path
    assert len(path) == 11
    assert path[0] == 10_000.0
    assert path[-1] == 0.0
    # Strictly non-increasing
    for i in range(len(path) - 1):
        assert path[i] >= path[i + 1]


def test_optimal_execution_on_schedule(sentry):
    # Step 1: executed 1000 shares, realized price near VWAP (slippage 0.5 bps)
    update = IntervalExecutionUpdate(
        step_index=1,
        shares_executed_this_step=1000.0,
        realized_execution_price=99.995,
        benchmark_vwap_price=100.0,
        remaining_shares=9000.0,
    )
    res = sentry.evaluate_step(update)
    assert res.regime == ExecutionTrackingRegime.OPTIMAL_ALMGREN_CHRISS_ON_SCHEDULE
    assert res.directive == ExecutionPacingDirective.MAINTAIN_OPTIMAL_SCHEDULE
    assert res.recommended_slice_size > 0.0


def test_elevated_slippage_drift(sentry):
    # Step 2: realized slippage is elevated (e.g. 5 bps vs ~1 bps expected)
    update = IntervalExecutionUpdate(
        step_index=2,
        shares_executed_this_step=1000.0,
        realized_execution_price=99.95,
        benchmark_vwap_price=100.0,  # 5 bps slip
        remaining_shares=8000.0,
    )
    res = sentry.evaluate_step(update)
    assert res.regime in [
        ExecutionTrackingRegime.ELEVATED_SLIPPAGE_DRIFT,
        ExecutionTrackingRegime.SEVERE_IMPACT_BREACH_ABORT,
    ]
    if res.regime == ExecutionTrackingRegime.ELEVATED_SLIPPAGE_DRIFT:
        assert res.directive == ExecutionPacingDirective.THROTTLE_SLICING_URGENCY


def test_severe_impact_breach_abort(sentry):
    # Extreme slippage (50 bps)
    update = IntervalExecutionUpdate(
        step_index=3,
        shares_executed_this_step=1000.0,
        realized_execution_price=99.50,
        benchmark_vwap_price=100.0,  # 50 bps slip
        remaining_shares=7000.0,
    )
    res = sentry.evaluate_step(update)
    assert res.regime == ExecutionTrackingRegime.SEVERE_IMPACT_BREACH_ABORT
    assert res.directive == ExecutionPacingDirective.HALT_EXECUTION_IMPACT_SPIKE
    assert res.recommended_slice_size == 0.0


def test_trajectory_completed(sentry):
    update = IntervalExecutionUpdate(
        step_index=10,
        shares_executed_this_step=500.0,
        realized_execution_price=100.0,
        benchmark_vwap_price=100.0,
        remaining_shares=0.0,
    )
    res = sentry.evaluate_step(update)
    assert res.regime == ExecutionTrackingRegime.TRAJECTORY_COMPLETED
    assert res.recommended_slice_size == 0.0
