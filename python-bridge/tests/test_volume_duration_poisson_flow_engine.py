"""
Unit Tests for Intraday Volume-Duration Point Process & Non-Homogeneous Poisson Flow Engine
Domain 228 / Work Package WP-DZ
"""

import pytest
import math
from services.volume_duration_poisson_flow_engine import (
    VolumeDurationPoissonFlowEngine,
    FlowRegimeState,
)


def test_diurnal_factor_shape():
    engine = VolumeDurationPoissonFlowEngine(trading_day_seconds=23400.0)
    # Open (t = 0)
    factor_open = engine.compute_diurnal_factor(0.0)
    assert pytest.approx(factor_open, 0.05) == 1.6

    # Midday (t = 11700)
    factor_mid = engine.compute_diurnal_factor(11700.0)
    assert pytest.approx(factor_mid, 0.01) == 1.0

    # Close (t = 23400)
    factor_close = engine.compute_diurnal_factor(23400.0)
    assert pytest.approx(factor_close, 0.05) == 1.6


def test_acd_parameter_calibration():
    engine = VolumeDurationPoissonFlowEngine()
    durations = [2.1, 1.9, 2.3, 1.8, 2.0, 2.5, 2.2, 1.7, 2.4, 2.0, 2.1, 1.9]

    params = engine.calibrate_acd_parameters(durations)
    assert params.persistence < 1.0
    assert params.omega > 0.0
    assert params.alpha > 0.0
    assert params.beta > 0.0
    assert pytest.approx(params.unconditional_mean_duration, 0.2) == 2.0


def test_conditional_durations_series():
    engine = VolumeDurationPoissonFlowEngine()
    durations = [1.0, 1.2, 0.8, 1.5, 1.1]

    psis = engine.compute_conditional_durations(durations)
    assert len(psis) == len(durations)
    for p in psis:
        assert p > 0.0


def test_burst_acceleration_regime():
    engine = VolumeDurationPoissonFlowEngine()
    # Baseline history of ~2.0s durations
    history = [2.0, 2.1, 1.9, 2.2, 1.8, 2.0, 2.3, 1.9, 2.0]

    # Sudden high-frequency cluster: inter-arrival duration collapses to 0.15s
    decision = engine.evaluate_flow_regime(
        current_duration=0.15,
        duration_history=history,
        intraday_timestamp_sec=1000.0,
    )

    assert decision.regime == FlowRegimeState.BURST_ACCELERATION
    assert decision.burst_acceleration_ratio > 3.0
    assert decision.instantaneous_intensity_hz > 1.0
    assert "Institutional sweep" in decision.recommended_action


def test_liquidity_drought_regime():
    engine = VolumeDurationPoissonFlowEngine()
    # Baseline history of ~1.0s durations
    history = [1.0, 1.1, 0.9, 1.0, 1.2, 0.8, 1.1, 0.9]

    # Inter-trade arrival stalls to 25.0s (25x baseline)
    decision = engine.evaluate_flow_regime(
        current_duration=25.0,
        duration_history=history,
        intraday_timestamp_sec=11700.0,
    )

    assert decision.regime == FlowRegimeState.LIQUIDITY_DROUGHT
    assert decision.standardized_residual > 3.0
    assert decision.instantaneous_intensity_hz < 0.10
    assert "Spreads widening" in decision.recommended_action


def test_normal_poisson_flow():
    engine = VolumeDurationPoissonFlowEngine()
    history = [2.0] * 15

    decision = engine.evaluate_flow_regime(
        current_duration=2.05,
        duration_history=history,
        intraday_timestamp_sec=8000.0,
    )

    assert decision.regime == FlowRegimeState.NORMAL_POISSON_FLOW
    assert pytest.approx(decision.standardized_residual, 0.2) == 1.0
