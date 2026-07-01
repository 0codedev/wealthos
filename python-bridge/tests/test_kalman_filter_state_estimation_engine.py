"""
Unit Tests for Continuous-Time Multi-Asset Kalman Filter State Estimation Engine (Domain 188 / WP-CL)
"""

import pytest

from services.kalman_filter_state_estimation_engine import (
    KalmanFilterStateEstimationEngine,
    KalmanDirective,
)


@pytest.fixture
def engine():
    return KalmanFilterStateEstimationEngine(
        db_path=":memory:",
        process_noise_q=1e-3,
        observation_noise_r=0.04,
        drift_significance_z=2.0,
        noise_fade_z=2.0,
    )


def test_kalman_noise_smoothing(engine):
    # Noisy sequence oscillating around 100.0 with +-0.10 bid-ask bounce
    t = 0.0
    prices = [100.0, 100.10, 99.90, 100.08, 99.92, 100.05, 99.95, 100.02]
    rep = None
    for p in prices:
        t += 1.0
        rep = engine.update("NIFTY", p, t)

    assert rep is not None
    # Filtered true price should be strictly smoother and close to 100.0
    assert abs(rep.true_price - 100.0) < 0.05
    assert abs(rep.latent_drift) < 0.05
    assert rep.directive == KalmanDirective.STABLE_EQUILIBRIUM_FILTER


def test_persistent_drift_momentum(engine):
    # Steady upward drift: P(t) = 100.0 + 0.25 * t
    t = 0.0
    rep = None
    for i in range(25):
        t += 1.0
        p = 100.0 + 0.25 * i
        rep = engine.update("RELIANCE", p, t)

    assert rep.latent_drift > 0.15
    assert rep.directive == KalmanDirective.MOMENTUM_TREND_DRIFT_LONG
    assert "upward true price drift" in rep.rationale


def test_negative_drift_short(engine):
    # Steady downward drift: P(t) = 100.0 - 0.25 * t
    t = 0.0
    rep = None
    for i in range(25):
        t += 1.0
        p = 100.0 - 0.25 * i
        rep = engine.update("TCS", p, t)

    assert rep.latent_drift < -0.15
    assert rep.directive == KalmanDirective.MOMENTUM_TREND_DRIFT_SHORT
    assert "downward true price drift" in rep.rationale


def test_mean_reversion_noise_fade(engine):
    # Establish stationary baseline at 100.0
    t = 0.0
    for _ in range(15):
        t += 1.0
        engine.update("INFY", 100.0, t)

    # Sudden violent 1-tick excursion to 101.50 without prior drift
    t += 1.0
    rep = engine.update("INFY", 101.50, t)

    assert rep.z_score_residual > 2.0
    assert rep.directive == KalmanDirective.MEAN_REVERSION_NOISE_FADE
    assert "fade back toward latent price" in rep.rationale


def test_sqlite_persistence(engine):
    engine.update("PERSIST_K", 100.0, 1.0)
    engine.update("PERSIST_K", 100.5, 2.0)

    telemetry = engine.get_latest_telemetry(limit=5)
    assert len(telemetry) == 2
    assert telemetry[0][0] == "PERSIST_K"
