r"""
Unit Test Suite for Domain 189 (WP-CM): High-Frequency Limit Order Book Jump Diffusion & Lévy Alpha Engine
"""

import math
import pytest
from services.jump_diffusion_levy_alpha_engine import (
    JumpDiffusionLevyAlphaEngine,
    LevyAlphaDirective,
)


def test_pure_gaussian_diffusion_negligible_jumps():
    """Verifies that pure continuous Brownian motion yields near-zero jump ratio and market making directive."""
    engine = JumpDiffusionLevyAlphaEngine(db_path=":memory:")

    # Generate calm continuous trajectory
    timestamps, prices = engine.simulate_kou_path(
        s0=100.0,
        mu=0.0,
        sigma=0.001,  # 10 bps per step
        lambd=0.0,  # Zero jumps
        p=0.5,
        eta1=50.0,
        eta2=50.0,
        t_total_sec=300.0,
        dt_sec=1.0,
        seed=42,
    )

    cal = engine.calibrate_merton_kou("NIFTY_FUT", timestamps, prices)

    assert cal.n_observations == 301
    assert cal.jump_count == 0
    assert cal.jump_ratio < 0.15
    assert cal.directive == LevyAlphaDirective.DIFFUSIVE_GAUSSIAN_MARKET_MAKING
    assert cal.quote_spread_multiplier <= 1.0


def test_lee_mykland_jump_detection_and_decomposition():
    """Verifies non-parametric Lee-Mykland jump detection on injected discontinuous jumps."""
    engine = JumpDiffusionLevyAlphaEngine(db_path=":memory:", jump_threshold_sigma=3.0)

    timestamps = [float(i) for i in range(100)]
    prices = [100.0]

    # Baseline calm prices
    for i in range(1, 100):
        # Small continuous noise: ~0.02%
        noise = 0.02 * math.sin(i * 0.5)
        p = prices[-1] * (1.0 + noise * 0.001)

        # Inject extreme discrete jumps
        if i == 30:
            p = prices[-1] * 1.035  # +3.5% upward jump
        elif i == 70:
            p = prices[-1] * 0.960  # -4.0% downward jump

        prices.append(round(p, 4))

    jump_events, rv, bv, jump_ratio = engine.detect_jumps(timestamps, prices)

    # Injected jumps at index 30 and 70 must be detected
    jumps_flagged = [evt for evt in jump_events if evt.is_jump]
    assert len(jumps_flagged) >= 2

    # Check timestamps or indices of flagged jumps
    jump_times = [evt.timestamp_sec for evt in jumps_flagged]
    assert 30.0 in jump_times
    assert 70.0 in jump_times

    assert jump_ratio > 0.30
    assert rv > bv


def test_downward_cascade_veto_bids_directive():
    """Verifies that an asymmetric downward jump cascade triggers bid veto & defensive widening."""
    engine = JumpDiffusionLevyAlphaEngine(db_path=":memory:", jump_threshold_sigma=3.0)

    timestamps = [float(i) for i in range(60)]
    prices = [100.0]

    # Generate trajectory with multiple downward shocks
    for i in range(1, 60):
        p = prices[-1] * 0.9998
        if i in (15, 28, 42):
            p = prices[-1] * 0.970  # -3.0% shock
        prices.append(round(p, 4))

    cal = engine.calibrate_merton_kou("BANKNIFTY", timestamps, prices)

    assert cal.downward_jump_count >= 3
    assert cal.upward_jump_count == 0
    assert cal.jump_asymmetry <= -0.50
    assert cal.directive == LevyAlphaDirective.CASCADE_DOWNWARD_JUMP_VETO_BIDS
    assert cal.quote_spread_multiplier > 1.50
    assert "VETO passive bids" in cal.rationale


def test_upward_momentum_sweep_directive():
    """Verifies that an asymmetric upward jump sweep triggers momentum chasing directive."""
    engine = JumpDiffusionLevyAlphaEngine(db_path=":memory:", jump_threshold_sigma=3.0)

    timestamps = [float(i) for i in range(60)]
    prices = [100.0]

    # Generate trajectory with multiple upward sweeps
    for i in range(1, 60):
        p = prices[-1] * 1.0002
        if i in (12, 25, 45):
            p = prices[-1] * 1.025  # +2.5% sweep
        prices.append(round(p, 4))

    cal = engine.calibrate_merton_kou("RELIANCE", timestamps, prices)

    assert cal.upward_jump_count >= 3
    assert cal.downward_jump_count == 0
    assert cal.jump_asymmetry >= 0.50
    assert cal.directive == LevyAlphaDirective.MOMENTUM_UPWARD_JUMP_SWEEP
    assert "Lift resting offers" in cal.rationale


def test_kou_double_exponential_parameter_calibration():
    """Verifies mathematical consistency of Kou model parameters (p, eta1, eta2, expected jump size)."""
    engine = JumpDiffusionLevyAlphaEngine(db_path=":memory:", jump_threshold_sigma=2.5)

    # 100 ticks with known jump events
    timestamps = [float(i) for i in range(100)]
    prices = [100.0]
    for i in range(1, 100):
        p = prices[-1] * (1.0 + 0.0001 * (1 if i % 2 == 0 else -1))
        if i == 20:
            p = prices[-1] * 1.020  # +2%
        elif i == 40:
            p = prices[-1] * 1.015  # +1.5%
        elif i == 60:
            p = prices[-1] * 0.985  # -1.5%
        prices.append(round(p, 4))

    cal = engine.calibrate_merton_kou("INFY", timestamps, prices)

    assert cal.jump_count == 3
    assert cal.upward_jump_count == 2
    assert cal.downward_jump_count == 1
    assert math.isclose(cal.kou_p, 2.0 / 3.0, rel_tol=1e-2)
    assert cal.kou_eta1 > 0.0
    assert cal.kou_eta2 > 0.0
    assert isinstance(cal.expected_jump_size, float)
    assert isinstance(cal.drift_compensator, float)


def test_sqlite_telemetry_persistence():
    """Verifies database insertion and query retrieval of jump diffusion telemetry."""
    engine = JumpDiffusionLevyAlphaEngine(db_path=":memory:")

    timestamps = [float(i) for i in range(30)]
    prices = [100.0 + 0.05 * i for i in range(30)]

    engine.calibrate_merton_kou("TCS", timestamps, prices)
    engine.calibrate_merton_kou("INFY", timestamps, prices)

    history = engine.get_recent_calibrations(limit=5)
    assert len(history) == 2
    assert history[0]["symbol"] == "INFY"
    assert history[1]["symbol"] == "TCS"

    tcs_history = engine.get_recent_calibrations(symbol="TCS", limit=5)
    assert len(tcs_history) == 1
    assert tcs_history[0]["symbol"] == "TCS"
    assert tcs_history[0]["directive"] == LevyAlphaDirective.DIFFUSIVE_GAUSSIAN_MARKET_MAKING.value
