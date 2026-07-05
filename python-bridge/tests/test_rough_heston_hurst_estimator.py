"""
Unit Test Suite for Domain 259: Intraday Realized Volatility Rough Heston Fractional Hurst Exponent Estimator
"""

import pytest
import math
from services.rough_heston_hurst_estimator import (
    RoughHestonHurstEstimator,
    RealizedVolSeriesInput,
    RoughnessRegime,
    VolSurfaceCalibrationDirective,
)


@pytest.fixture
def estimator():
    return RoughHestonHurstEstimator(min_data_points=20)


def test_ultra_rough_volatility_synthetic(estimator):
    # Construct a synthetic rough process where |v_{t+Delta} - v_t| ~ Delta^0.10
    # Generating 100 points with rough step increments
    vols = [0.0]
    for i in range(1, 100):
        # High-frequency alternating rough jumps
        step = ((-1) ** i) * (0.05 * math.sin(i * 1.5))
        vols.append(vols[-1] + step)

    series = RealizedVolSeriesInput(
        asset_id="BTC-PERP",
        log_realized_vols=vols,
        max_lag=10,
    )
    res = estimator.evaluate(series)
    assert res.estimated_hurst_h < 0.35
    assert res.regime in [
        RoughnessRegime.ULTRA_ROUGH_FRACTAL_SURFACE,
        RoughnessRegime.MODERATELY_ROUGH_HESTON,
    ]
    assert res.short_dated_skew_scaling_exponent < 0.0


def test_classical_markovian_random_walk(estimator):
    # Standard Gaussian random walk increments scale as Delta^0.50
    import random
    random.seed(42)
    vols = [0.0]
    for _ in range(400):
        vols.append(vols[-1] + random.gauss(0.0, 1.0))

    series = RealizedVolSeriesInput(
        asset_id="SPX-INDEX",
        log_realized_vols=vols,
        max_lag=15,
    )
    res = estimator.evaluate(series)
    assert 0.35 <= res.estimated_hurst_h <= 0.60
    assert res.regime == RoughnessRegime.CLASSICAL_MARKOVIAN_DIFFUSION
    assert res.directive == VolSurfaceCalibrationDirective.USE_CLASSICAL_HESTON_DIFFUSION


def test_insufficient_data_fallback(estimator):
    # Less than 20 points
    series = RealizedVolSeriesInput(
        asset_id="TINY",
        log_realized_vols=[0.1, 0.2, 0.15],
    )
    res = estimator.evaluate(series)
    assert res.estimated_hurst_h == 0.50
    assert res.regime == RoughnessRegime.CLASSICAL_MARKOVIAN_DIFFUSION
    assert res.directive == VolSurfaceCalibrationDirective.USE_CLASSICAL_HESTON_DIFFUSION


def test_variogram_monotonicity(estimator):
    # Variogram moments must be positive
    vols = [math.sin(i * 0.1) for i in range(50)]
    vario = estimator.calculate_variogram(vols, max_lag=5, q=1.0)
    assert len(vario) == 5
    for delta, m in vario:
        assert delta > 0.0
        assert m > 0.0
