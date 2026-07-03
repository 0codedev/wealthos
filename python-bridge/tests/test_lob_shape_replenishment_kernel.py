"""
Unit Tests for High-Frequency Limit Order Book Shape Function & Deep Liquidity Replenishment Kernel
Domain 235 / Work Package WP-EG
"""

import pytest
import math
from services.lob_shape_replenishment_kernel import (
    LOBShapeReplenishmentKernel,
    BookDepthTier,
    BookResiliencyRegimeState,
)


def test_shape_function_fitting():
    kernel = LOBShapeReplenishmentKernel()

    # Synthetic Gamma curve: rho(Delta) = 100 * Delta^1.5 * exp(-0.3 * Delta)
    # Peak should occur near Delta* = 1.5 / 0.3 = 5.0 bps
    tiers = []
    distances = [0.5, 1.0, 2.0, 3.0, 5.0, 7.0, 10.0, 15.0]
    for d in distances:
        vol = 100.0 * (d ** 1.5) * math.exp(-0.3 * d)
        tiers.append(BookDepthTier(price=100.0 + d * 0.01, volume=vol, distance_bps=d))

    fit = kernel.fit_book_shape_function(tiers)
    assert fit.alpha_shape > 0.0
    assert fit.beta_decay > 0.0
    assert pytest.approx(fit.peak_distance_bps, 1.5) == 5.0
    assert fit.r_squared > 0.80


def test_replenishment_half_life_calculation():
    kernel = LOBShapeReplenishmentKernel()

    # Case: Initial hole = 10,000 shares.
    # After dt = 50ms, current hole is 5,000 shares (exactly 1 half-life!)
    metric = kernel.track_replenishment_kernel(
        initial_cavity_volume=10000.0,
        current_cavity_volume=5000.0,
        elapsed_time_ms=50.0,
    )

    assert pytest.approx(metric.replenishment_ratio_pct, 0.1) == 50.0
    assert pytest.approx(metric.estimated_half_life_ms, 1.0) == 50.0
    assert metric.resilience_rate_hz > 0.0


def test_flash_hole_unreplenished_alert():
    kernel = LOBShapeReplenishmentKernel(critical_hole_threshold_pct=60.0)

    # 10,000 share sweep. After 100ms, 8,000 shares still missing (80% unreplenished)
    tiers = [
        BookDepthTier(price=100.05, volume=500.0, distance_bps=0.5),
        BookDepthTier(price=100.10, volume=1000.0, distance_bps=1.0),
        BookDepthTier(price=100.20, volume=3000.0, distance_bps=2.0),
    ]

    dec = kernel.evaluate_book_resiliency(
        tiers=tiers,
        initial_sweep_volume=10000.0,
        current_missing_volume=8000.0,
        elapsed_since_sweep_ms=100.0,
    )

    assert dec.regime == BookResiliencyRegimeState.FLASH_HOLE_UNREPLENISHED
    assert "AIR_POCKET_ALERT" in dec.recommended_action
    assert dec.cavity.replenishment_ratio_pct < 40.0


def test_replenishment_accelerated_regime():
    kernel = LOBShapeReplenishmentKernel(fast_recovery_half_life_ms=50.0)

    # 10,000 share sweep. After 30ms, only 2,000 shares missing (80% recovered, very fast half-life!)
    tiers = [
        BookDepthTier(price=100.05, volume=2000.0, distance_bps=0.5),
        BookDepthTier(price=100.10, volume=5000.0, distance_bps=1.0),
        BookDepthTier(price=100.20, volume=8000.0, distance_bps=2.0),
    ]

    dec = kernel.evaluate_book_resiliency(
        tiers=tiers,
        initial_sweep_volume=10000.0,
        current_missing_volume=2000.0,
        elapsed_since_sweep_ms=30.0,
    )

    assert dec.regime == BookResiliencyRegimeState.REPLENISHMENT_ACCELERATED
    assert dec.cavity.estimated_half_life_ms <= 50.0
    assert "HIGH_RESILIENCY_RECOVERY" in dec.recommended_action
