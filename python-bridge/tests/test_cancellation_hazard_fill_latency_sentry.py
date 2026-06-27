"""
Unit Tests for High-Frequency Limit Order Book Cancellations Hazard & Fill Latency Sentry
Domain 233 / Work Package WP-EE
"""

import pytest
import math
from services.cancellation_hazard_fill_latency_sentry import (
    CancellationHazardFillLatencySentry,
    OrderMicrostructureState,
    HazardModelParameters,
    CancellationRegimeState,
)


def test_hazard_rate_covariate_sensitivity():
    sentry = CancellationHazardFillLatencySentry()

    # Calm state: far from mid (10 bps), high queue ahead (5000), neutral OFI (0.0), low vol (2.0)
    calm_state = OrderMicrostructureState(
        order_id="ORD_CALM",
        distance_to_mid_bps=10.0,
        queue_ahead_volume=5000.0,
        order_flow_imbalance=0.0,
        hf_volatility_bps=2.0,
        order_age_sec=1.0,
    )
    h_calm, hr_calm = sentry.compute_instantaneous_hazard(calm_state)

    # Toxic state: at top of book (0.5 bps), small queue ahead (100), strong adverse OFI (0.90), high vol (15.0)
    toxic_state = OrderMicrostructureState(
        order_id="ORD_TOXIC",
        distance_to_mid_bps=0.5,
        queue_ahead_volume=100.0,
        order_flow_imbalance=0.90,
        hf_volatility_bps=15.0,
        order_age_sec=1.0,
    )
    h_toxic, hr_toxic = sentry.compute_instantaneous_hazard(toxic_state)

    assert hr_toxic > hr_calm
    assert h_toxic > h_calm


def test_survival_probability_monotonicity():
    sentry = CancellationHazardFillLatencySentry()
    state = OrderMicrostructureState(
        order_id="ORD_1",
        distance_to_mid_bps=3.0,
        queue_ahead_volume=1000.0,
        order_flow_imbalance=0.20,
        hf_volatility_bps=5.0,
        order_age_sec=0.50,
    )

    s_50ms = sentry.compute_survival_probability(state, horizon_sec=0.05)
    s_200ms = sentry.compute_survival_probability(state, horizon_sec=0.20)
    s_500ms = sentry.compute_survival_probability(state, horizon_sec=0.50)

    # Monotonically decaying survival over longer horizons
    assert 1.0 >= s_50ms >= s_200ms >= s_500ms >= 0.0


def test_stale_fill_risk_scaling():
    sentry = CancellationHazardFillLatencySentry()
    state = OrderMicrostructureState(
        order_id="ORD_RISK",
        distance_to_mid_bps=1.0,
        queue_ahead_volume=200.0,
        order_flow_imbalance=0.75,
        hf_volatility_bps=8.0,
        order_age_sec=2.0,
    )

    # Fast 5ms cancel vs slow 80ms cancel
    risk_fast = sentry.evaluate_stale_fill_risk(state, cancel_network_latency_ms=5.0)
    risk_slow = sentry.evaluate_stale_fill_risk(state, cancel_network_latency_ms=80.0)

    assert risk_slow > risk_fast
    assert 0.0 <= risk_fast <= 100.0
    assert 0.0 <= risk_slow <= 100.0


def test_toxic_evaporation_sentry_alert():
    sentry = CancellationHazardFillLatencySentry()

    # Extreme toxic sweep scenario
    state = OrderMicrostructureState(
        order_id="ORD_SWEEP",
        distance_to_mid_bps=0.2,
        queue_ahead_volume=50.0,
        order_flow_imbalance=1.0, # 100% adverse OFI
        hf_volatility_bps=25.0,
        order_age_sec=5.0,
    )

    assessment = sentry.assess_order_hazard(state, cancel_latency_ms=40.0)

    assert assessment.regime == CancellationRegimeState.TOXIC_EVAPORATION_SURGE
    assert assessment.hazard_ratio >= 3.0
    assert "EMERGENCY_CANCEL" in assessment.recommended_action


def test_stable_maker_queue_decision():
    sentry = CancellationHazardFillLatencySentry()

    state = OrderMicrostructureState(
        order_id="ORD_STABLE",
        distance_to_mid_bps=8.0,
        queue_ahead_volume=10000.0,
        order_flow_imbalance=0.0,
        hf_volatility_bps=1.0,
        order_age_sec=0.20,
    )

    assessment = sentry.assess_order_hazard(state, cancel_latency_ms=10.0)

    assert assessment.regime == CancellationRegimeState.STABLE_MAKER_QUEUE
    assert assessment.survival_prob_100ms > 0.80
    assert "MAINTAIN_QUEUE_PRIORITY" in assessment.recommended_action
