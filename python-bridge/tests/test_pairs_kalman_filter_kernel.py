"""
Unit tests for Domain 271 / WP-FQ: Pairs Kalman Filter Hedge Ratio Kernel
"""

import pytest
import numpy as np
from services.pairs_kalman_filter_kernel import (
    PairsKalmanFilterKernel,
    PairsStatArbRegime,
    PairsStatArbDirective,
)


@pytest.fixture
def kernel():
    return PairsKalmanFilterKernel(
        delta_transition_noise=1e-4,
        measurement_noise=0.05,
        entry_z_hurdle=2.0,
        exit_z_hurdle=0.5,
        abort_z_hurdle=4.5,
    )


def test_kalman_beta_convergence(kernel):
    # True relationship: y = 2.0 * x + 5.0
    np.random.seed(42)
    for i in range(200):
        x = 50.0 + np.sin(i * 0.1) * 5.0 + np.random.normal(0, 0.5)
        y = 2.0 * x + 5.0 + np.random.normal(0, 0.05)
        kernel.update_tick(x, y)

    # Beta should be close to 2.0 (+/- 0.10)
    assert abs(kernel.theta[1] - 2.0) < 0.10


def test_spread_long_dislocation_entry(kernel):
    # Pre-train with known relation y = 1.5 * x
    for x in np.linspace(10, 20, 50):
        kernel.update_tick(x, 1.5 * x)

    # Dislocation shock on Y: x=20, expected y=30, observed y=29.1 (spread = -0.9 -> z approx -2.6)
    res = kernel.evaluate_pair("ETH", "BTC", price_y=29.1, price_x=20.0)
    assert res.regime == PairsStatArbRegime.SPREAD_LONG_DISLOCATION_ENTRY
    assert res.directive == PairsStatArbDirective.LONG_ASSET_Y_SHORT_BETA_X
    assert -4.5 < res.spread_z_score <= -2.0


def test_spread_short_dislocation_entry(kernel):
    # Pre-train with known relation y = 1.5 * x
    for x in np.linspace(10, 20, 50):
        kernel.update_tick(x, 1.5 * x)

    # Dislocation shock on Y: x=20, expected y=30, observed y=30.9 (spread = +0.9 -> z approx +2.6)
    res = kernel.evaluate_pair("ETH", "BTC", price_y=30.9, price_x=20.0)
    assert res.regime == PairsStatArbRegime.SPREAD_SHORT_DISLOCATION_ENTRY
    assert res.directive == PairsStatArbDirective.SHORT_ASSET_Y_LONG_BETA_X
    assert 2.0 <= res.spread_z_score < 4.5


def test_structural_breakdown_abort(kernel):
    # Pre-train
    for x in np.linspace(10, 20, 50):
        kernel.update_tick(x, 1.5 * x)

    # Massive decoupling shock: observed y=50.0 (expected 30.0) -> extreme z-score > 4.5
    res = kernel.evaluate_pair("SOL", "BTC", price_y=50.0, price_x=20.0)
    assert res.regime == PairsStatArbRegime.STRUCTURAL_BREAKDOWN_ABORT
    assert res.directive == PairsStatArbDirective.EMERGENCY_UNWIND_DECOUPLED_PAIR
    assert abs(res.spread_z_score) >= 4.5
