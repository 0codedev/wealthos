"""
Unit tests for Domain 273 / WP-FS: BEKK-GARCH Covariance & Spillover Engine
"""

import pytest
import numpy as np
from services.bekk_garch_spillover_engine import (
    BEKKGARCHSpilloverEngine,
    BEKKSpilloverRegime,
    BEKKRiskDirective,
)


@pytest.fixture
def engine():
    return BEKKGARCHSpilloverEngine(
        dimension=2,
        spillover_contagion_hurdle=0.35,
        max_condition_number_hurdle=40.0,
        correlation_breakdown_hurdle=0.80,
    )


def test_positive_definiteness_guarantee(engine):
    # Subject to random return shocks
    np.random.seed(42)
    for _ in range(20):
        eps = np.random.normal(0, 0.03, size=2)
        H_t = engine.update_covariance_step(eps)
        eigvals = np.linalg.eigvalsh(H_t)
        assert np.all(eigvals > 0.0)


def test_covariance_symmetry(engine):
    eps = np.array([0.02, -0.015])
    H_t = engine.update_covariance_step(eps)
    # Symmetry check
    np.testing.assert_allclose(H_t, H_t.T, rtol=1e-6)

    # Correlation bound check
    res = engine.evaluate_state(["BTC", "ETH"], [0.02, -0.015])
    corr = np.array(res.forecast_correlation_matrix)
    assert np.all(corr >= -1.0) and np.all(corr <= 1.0)
    assert np.isclose(corr[0, 0], 1.0)
    assert np.isclose(corr[1, 1], 1.0)


def test_systemic_contagion_spillover_alert(engine):
    # Set high cross-spillover in A matrix
    engine.A = np.array([
        [0.25, 0.30],  # A_12 = 0.30
        [0.32, 0.28],  # A_21 = 0.32 (High spillover)
    ])
    engine.B = np.array([
        [0.85, 0.15],
        [0.15, 0.85],
    ])
    # Severe correlated shock
    eps = [0.05, 0.048]
    res = engine.evaluate_state(["BTC", "ETH"], eps)
    assert res.regime == BEKKSpilloverRegime.SYSTEMIC_CONTAGION_SPILLOVER_ALERT
    assert res.directive == BEKKRiskDirective.DELEVERAGE_AND_ACTIVATE_TAIL_HEDGES
    assert res.max_cross_spillover_intensity >= 0.35


def test_ill_conditioned_covariance_hazard(engine):
    # Set near-collinear C and H_prev to induce ill-conditioned covariance matrix
    engine.C = np.array([
        [0.01, 0.0],
        [0.01, 1e-5],
    ])
    ill_H = np.array([
        [1.0, 0.9999],
        [0.9999, 1.0],
    ]) * 0.001
    engine.cond_hurdle = 20.0
    res = engine.evaluate_state(["SPY", "QQQ"], [0.001, 0.001], custom_H_prev=ill_H)
    assert res.regime == BEKKSpilloverRegime.ILL_CONDITIONED_COVARIANCE_HAZARD
    assert res.directive == BEKKRiskDirective.APPLY_COVARIANCE_EIGEN_SHRINKAGE
    assert res.covariance_condition_number >= 20.0
