"""
Unit Test Suite for Domain 236: High-Frequency Limit Order Book Fill Rate Survival Analysis & Kaplan-Meier Sentry
"""

import pytest
import math
from services.lob_fill_survival_sentry import (
    LOBFillSurvivalSentry,
    OrderFillObservation,
    FillRegimeState,
    MakerExecutionDirective,
)


@pytest.fixture
def sentry():
    return LOBFillSurvivalSentry(
        min_sample_size=10,
        marginal_hazard_threshold=0.02,
        asymptotic_fill_target=0.85,
        default_ttl_sec=5.0,
        toxic_drift_threshold_bps=3.5,
    )


@pytest.fixture
def sample_observations():
    # 20 observations with mixed fills and cancellations
    # Durations from 0.2s to 8.0s
    obs = []
    # 12 fills
    fill_durations = [0.2, 0.4, 0.5, 0.8, 1.1, 1.5, 2.0, 2.4, 3.1, 3.8, 4.5, 6.0]
    for i, d in enumerate(fill_durations):
        obs.append(OrderFillObservation(
            order_id=f"fill_{i}",
            duration_sec=d,
            is_filled=True,
            queue_percentile=0.2 + 0.05 * i,
        ))
    # 8 cancellations (censored)
    cancel_durations = [0.7, 1.2, 1.8, 2.5, 3.5, 5.0, 7.0, 8.0]
    for i, d in enumerate(cancel_durations):
        obs.append(OrderFillObservation(
            order_id=f"cancel_{i}",
            duration_sec=d,
            is_filled=False,
            queue_percentile=0.6 + 0.04 * i,
        ))
    return obs


def test_insufficient_sample(sentry):
    tiny_obs = [
        OrderFillObservation("o1", 0.5, True),
        OrderFillObservation("o2", 1.0, False),
    ]
    profile = sentry.calibrate(tiny_obs)
    assert profile.regime == FillRegimeState.INSUFFICIENT_SAMPLE
    assert profile.optimal_ttl_sec == 5.0
    assert len(profile.curve) == 0


def test_kaplan_meier_monotonic_decay_and_hazard(sentry, sample_observations):
    profile = sentry.calibrate(sample_observations)
    assert profile.total_orders == 20
    assert profile.total_fills == 12
    assert profile.total_censored == 8
    assert len(profile.curve) > 0

    # Verify monotonic decay of S(t)
    prev_s = 1.0
    prev_h = 0.0
    for pt in profile.curve:
        assert 0.0 <= pt.survival_prob <= 1.0
        assert pt.survival_prob <= prev_s + 1e-6
        # Nelson-Aalen cumulative hazard must be monotonically non-decreasing
        assert pt.cumulative_hazard >= prev_h - 1e-6
        prev_s = pt.survival_prob
        prev_h = pt.cumulative_hazard

    # Fill probabilities at horizons
    assert 0.0 <= profile.fill_prob_1s <= 1.0
    assert profile.fill_prob_1s <= profile.fill_prob_5s <= profile.fill_prob_10s
    assert profile.optimal_ttl_sec > 0.0


def test_optimal_ttl_and_median_fill(sentry, sample_observations):
    profile = sentry.calibrate(sample_observations)
    assert profile.median_fill_time_sec is not None
    assert profile.median_fill_time_sec > 0.0
    # Optimal TTL should be calibrated appropriately
    assert 1.0 <= profile.optimal_ttl_sec <= 8.0


def test_live_order_directives(sentry, sample_observations):
    profile = sentry.calibrate(sample_observations)

    # Case 1: Healthy young order with favorable drift
    d1 = sentry.evaluate_live_order(
        order_id="ord_healthy",
        order_age_sec=0.5,
        adverse_drift_bps=0.2,
        profile=profile,
        queue_percentile=0.2,
    )
    assert d1.directive == MakerExecutionDirective.MAINTAIN_PASSIVE_QUOTE
    assert not d1.exceeded_optimal_ttl

    # Case 2: TTL expired
    d2 = sentry.evaluate_live_order(
        order_id="ord_stale",
        order_age_sec=profile.optimal_ttl_sec + 1.0,
        adverse_drift_bps=0.5,
        profile=profile,
        queue_percentile=0.3,
    )
    assert d2.directive == MakerExecutionDirective.CANCEL_TTL_EXPIRED
    assert d2.exceeded_optimal_ttl

    # Case 3: Emergency snipe abort on toxic price drift
    d3 = sentry.evaluate_live_order(
        order_id="ord_toxic",
        order_age_sec=1.0,
        adverse_drift_bps=4.8,  # > 3.5 threshold
        profile=profile,
        queue_percentile=0.1,
    )
    assert d3.directive == MakerExecutionDirective.EMERGENCY_SNIPE_ABORT
    assert d3.risk_score >= 0.50

    # Case 4: Deep queue starvation
    d4 = sentry.evaluate_live_order(
        order_id="ord_starved",
        order_age_sec=1.5,
        adverse_drift_bps=0.1,
        profile=profile,
        queue_percentile=0.92,
    )
    # At 92% queue percentile and 1.5s, if conditional fill prob is low, should revise priority
    if d4.conditional_fill_prob_next_1s < 0.05:
        assert d4.directive == MakerExecutionDirective.REVISE_QUEUE_PRIORITY
    else:
        assert d4.directive in [MakerExecutionDirective.MAINTAIN_PASSIVE_QUOTE, MakerExecutionDirective.REVISE_QUEUE_PRIORITY]
