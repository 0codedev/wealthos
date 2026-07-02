"""
Unit Test Suite for Domain 257: High-Frequency Limit Order Book Jump-Diffusion Hazard & Pre-Crash Liquidity Evacuation Circuit
"""

import pytest
from services.lob_jump_diffusion_evacuation_circuit import (
    LOBJumpDiffusionEvacuationCircuit,
    JumpTelemetrySnapshot,
    JumpHazardRegime,
    EvacuationDirective,
)


@pytest.fixture
def circuit():
    return LOBJumpDiffusionEvacuationCircuit(
        evacuation_hazard_threshold=40.0,
        critical_intensity_hz=12.0,
        expected_jump_size_bps=35.0,
    )


def test_nominal_diffusive_flow(circuit):
    # Tranquil flow: low OFI accel, low cancels, low jump variance
    snap = JumpTelemetrySnapshot(
        symbol="BTC-USDT",
        mid_price=65000.0,
        ofi_acceleration=0.1,
        cancel_to_insert_ratio=0.8,
        jump_variation_fraction=0.05,
        network_rtt_sec=0.025,
    )
    res = circuit.evaluate(snap)
    assert res.regime == JumpHazardRegime.NOMINAL_DIFFUSIVE_FLOW
    assert res.directive == EvacuationDirective.MAINTAIN_ACTIVE_QUOTES
    assert res.jump_hazard_in_rtt_pct < 10.0


def test_elevated_jump_suspicion(circuit):
    # Rising pressure: moderate OFI accel (1.5), cancellation ratio 2.5
    snap = JumpTelemetrySnapshot(
        symbol="ETH-USDT",
        mid_price=3500.0,
        ofi_acceleration=1.5,
        cancel_to_insert_ratio=2.5,
        jump_variation_fraction=0.35,
        network_rtt_sec=0.025,
    )
    res = circuit.evaluate(snap)
    assert res.regime in [
        JumpHazardRegime.ELEVATED_JUMP_SUSPICION,
        JumpHazardRegime.SUPERCRITICAL_JUMP_EVACUATION,
    ]
    if res.regime == JumpHazardRegime.ELEVATED_JUMP_SUSPICION:
        assert res.directive == EvacuationDirective.WIDEN_DEFENSIVE_SPREADS


def test_supercritical_jump_evacuation(circuit):
    # Pre-crash signature: extreme OFI acceleration (4.0), cancel avalanche (4.5), 70% jump variance
    snap = JumpTelemetrySnapshot(
        symbol="SOL-USDT",
        mid_price=150.0,
        ofi_acceleration=4.0,
        cancel_to_insert_ratio=4.5,
        jump_variation_fraction=0.70,
        network_rtt_sec=0.030,
    )
    res = circuit.evaluate(snap)
    assert res.regime == JumpHazardRegime.SUPERCRITICAL_JUMP_EVACUATION
    assert res.directive == EvacuationDirective.EMERGENCY_MASS_CANCEL_EVACUATION
    assert res.estimated_jump_intensity_hz >= circuit.critical_intensity_hz
    assert res.expected_toxic_loss_bps > 10.0


def test_post_jump_cooldown(circuit):
    # Cooldown active
    snap = JumpTelemetrySnapshot(
        symbol="NVDA",
        mid_price=120.0,
        ofi_acceleration=0.0,
        cancel_to_insert_ratio=1.0,
        jump_variation_fraction=0.0,
        is_post_jump_cooldown=True,
    )
    res = circuit.evaluate(snap)
    assert res.regime == JumpHazardRegime.POST_JUMP_VOLATILITY_COOLDOWN
    assert res.directive == EvacuationDirective.WAIT_POST_CRASH_STABILIZATION


def test_poisson_probability_monotonicity(circuit):
    p_short = circuit.calculate_jump_probability(intensity=10.0, tau_sec=0.01)
    p_long = circuit.calculate_jump_probability(intensity=10.0, tau_sec=0.05)
    assert p_long > p_short
