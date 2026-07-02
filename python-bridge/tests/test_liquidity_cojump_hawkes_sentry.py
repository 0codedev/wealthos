"""
Unit Test Suite for Domain 238: Multi-Asset Intraday Liquidity Co-Jumps & Hawkes Branching Contagion Sentry
"""

import pytest
import math
from services.liquidity_cojump_hawkes_sentry import (
    LiquidityCoJumpHawkesSentry,
    LiquidityEvent,
    CoJumpRegimeState,
    LiquidityCircuitDirective,
)


@pytest.fixture
def sentry():
    return LiquidityCoJumpHawkesSentry(
        jump_zscore_threshold=3.0,
        jump_depth_threshold_pct=0.60,
        sync_window_sec=0.50,
        baseline_decay_beta=2.0,
        supercritical_threshold=0.95,
    )


def test_is_liquidity_jump(sentry):
    # Below thresholds
    assert not sentry.is_liquidity_jump(spread_zscore=1.5, depth_drop_pct=0.20)
    # Spread z-score breach
    assert sentry.is_liquidity_jump(spread_zscore=3.2, depth_drop_pct=0.20)
    # Depth drop breach
    assert sentry.is_liquidity_jump(spread_zscore=1.0, depth_drop_pct=0.65)


def test_power_iteration_spectral_radius(sentry):
    # Symmetric matrix: [[0.4, 0.2], [0.2, 0.4]]
    # Eigenvalues: 0.4 + 0.2 = 0.6, 0.4 - 0.2 = 0.2. Spectral radius = 0.6
    matrix = [
        [0.4, 0.2],
        [0.2, 0.4],
    ]
    spec_rad, eigenvector = sentry.calculate_spectral_radius(matrix)
    assert pytest.approx(spec_rad, abs=1e-3) == 0.60
    assert len(eigenvector) == 2
    assert pytest.approx(eigenvector[0], abs=1e-3) == eigenvector[1]


def test_tranquil_state(sentry):
    assets = ["BTC", "ETH", "SOL"]
    assessment = sentry.assess_contagion(
        assets=assets,
        current_time_sec=100.0,
        recent_events=[],
    )
    assert assessment.regime == CoJumpRegimeState.TRANQUIL_STABLE
    assert assessment.directive == LiquidityCircuitDirective.MAINTAIN_NORMAL_QUOTING
    assert assessment.active_cojumps_count == 0
    assert assessment.spectral_radius < 0.60


def test_localized_contained_shock(sentry):
    assets = ["BTC", "ETH", "SOL"]
    events = [
        LiquidityEvent(asset="SOL", timestamp_sec=99.8, spread_zscore=3.8, depth_drop_pct=0.70)
    ]
    assessment = sentry.assess_contagion(
        assets=assets,
        current_time_sec=100.0,
        recent_events=events,
    )
    assert assessment.regime == CoJumpRegimeState.LOCALIZED_CONTAINED_SHOCK
    assert assessment.directive == LiquidityCircuitDirective.WIDEN_LOCAL_SPREADS
    assert assessment.active_cojumps_count == 1
    assert assessment.shocked_assets == ["SOL"]


def test_systemic_cluster(sentry):
    assets = ["BTC", "ETH", "SOL", "AVAX"]
    events = [
        LiquidityEvent(asset="BTC", timestamp_sec=99.7, spread_zscore=3.5, depth_drop_pct=0.65),
        LiquidityEvent(asset="ETH", timestamp_sec=99.8, spread_zscore=4.0, depth_drop_pct=0.68),
    ]
    assessment = sentry.assess_contagion(
        assets=assets,
        current_time_sec=100.0,
        recent_events=events,
    )
    assert assessment.regime in [CoJumpRegimeState.SYSTEMIC_COJUMP_CLUSTER, CoJumpRegimeState.SUPERCRITICAL_FLASH_CRASH_RUN]
    assert assessment.directive in [LiquidityCircuitDirective.THROTTLE_CROSS_CORRELATION_RISK, LiquidityCircuitDirective.EMERGENCY_GLOBAL_CIRCUIT_PULL]
    assert assessment.active_cojumps_count == 2


def test_supercritical_flash_crash_circuit(sentry):
    assets = ["BTC", "ETH", "SOL", "AVAX"]
    # Coordinated massive liquidity sweep across all 4 assets within 100ms
    events = [
        LiquidityEvent(asset="BTC", timestamp_sec=99.90, spread_zscore=5.5, depth_drop_pct=0.85),
        LiquidityEvent(asset="ETH", timestamp_sec=99.92, spread_zscore=6.0, depth_drop_pct=0.90),
        LiquidityEvent(asset="SOL", timestamp_sec=99.93, spread_zscore=5.8, depth_drop_pct=0.88),
        LiquidityEvent(asset="AVAX", timestamp_sec=99.95, spread_zscore=4.9, depth_drop_pct=0.80),
    ]
    assessment = sentry.assess_contagion(
        assets=assets,
        current_time_sec=100.0,
        recent_events=events,
    )
    assert assessment.regime == CoJumpRegimeState.SUPERCRITICAL_FLASH_CRASH_RUN
    assert assessment.directive == LiquidityCircuitDirective.EMERGENCY_GLOBAL_CIRCUIT_PULL
    assert assessment.active_cojumps_count >= 3
    assert assessment.systemic_risk_score >= 0.70
