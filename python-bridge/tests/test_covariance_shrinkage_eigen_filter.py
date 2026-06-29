"""
Unit Test Suite for Domain 247: Cross-Sectional Multi-Asset Realized Covariance Shrinkage & Ledoit-Wolf Dynamic Eigen-Filter Engine
"""

import pytest
import math
from services.covariance_shrinkage_eigen_filter import (
    CovarianceShrinkageEigenFilter,
    CovarianceRegimeState,
    CovarianceFilterDirective,
)


@pytest.fixture
def filter_engine():
    return CovarianceShrinkageEigenFilter(
        condition_number_threshold=50.0,
        max_acceptable_condition_number=40.0,
        min_signal_eigenvalue_ratio=1.05,
    )


def test_jacobi_eigenvalues(filter_engine):
    # Symmetric 2x2 matrix: [[2.0, 1.0], [1.0, 2.0]]
    # Eigenvalues: 3.0 and 1.0
    mat = [[2.0, 1.0], [1.0, 2.0]]
    evals, evecs = filter_engine.jacobi_eigenvalues(mat)
    sorted_evals = sorted(evals)
    assert pytest.approx(sorted_evals[0], abs=1e-3) == 1.0
    assert pytest.approx(sorted_evals[1], abs=1e-3) == 3.0


def test_singular_rank_deficient(filter_engine):
    # T = 3 observations for N = 5 assets (rank <= 2 < 5)
    returns = [
        [0.01, -0.02, 0.015, -0.01, 0.005],
        [-0.01, 0.02, -0.01, 0.015, -0.005],
        [0.02, -0.01, 0.01, -0.02, 0.01],
    ]
    res = filter_engine.filter_covariance(returns)
    assert res.state == CovarianceRegimeState.SINGULAR_RANK_DEFICIENT
    assert res.directive == CovarianceFilterDirective.FORCE_TARGET_SHRINKAGE_REGULARIZATION
    assert res.shrinkage_intensity == 0.70
    assert res.n_observations == 3
    assert res.n_assets == 5


def test_ill_conditioned_noise_rmt_clipping(filter_engine):
    # N = 4 assets, T = 12 observations (c = 4/12 = 0.33)
    # Assets 0 and 1 strongly collinear (r0 ~ r1) causing small eigenvalue and high condition number
    returns = []
    for t in range(12):
        base = 0.01 * math.sin(t * 0.8)
        noise1 = 0.0005 * math.cos(t * 1.5)
        noise2 = 0.003 * math.sin(t * 2.1)
        noise3 = 0.004 * math.cos(t * 0.5)
        # Collinear: asset 0 and asset 1 are almost identical
        returns.append([base, base + noise1 * 0.1, noise2, noise3])

    res = filter_engine.filter_covariance(returns)
    assert res.n_assets == 4
    assert res.n_observations == 12
    # Filtered condition number must be strictly better (smaller) than initial condition number
    assert res.filtered_condition_number <= res.initial_condition_number
    assert res.noise_eigenvalues_count >= 1


def test_well_conditioned_laminar(filter_engine):
    # N = 3 assets, T = 60 observations (c = 3/60 = 0.05)
    # 3 largely independent orthogonal assets
    returns = []
    for t in range(60):
        r1 = 0.01 * math.sin(t * 0.5)
        r2 = 0.015 * math.cos(t * 0.7)
        r3 = 0.012 * math.sin(t * 1.3)
        returns.append([r1, r2, r3])

    res = filter_engine.filter_covariance(returns)
    assert res.state == CovarianceRegimeState.WELL_CONDITIONED_LAMINAR
    assert res.directive == CovarianceFilterDirective.USE_MODERATE_SHRINKAGE
    assert res.dimension_ratio <= 0.10
    assert res.initial_condition_number < filter_engine.condition_number_threshold
