"""
Unit Test Suite for Domain 248: Real-Time Limit Order Book Queue Depletion Martingale & Microsecond Stop-Loss Sentry
"""

import pytest
from services.queue_depletion_martingale_sentry import (
    QueueDepletionMartingaleSentry,
    QueueMicrostate,
    QueueDepletionState,
    PreemptiveStopDirective,
)


@pytest.fixture
def sentry():
    return QueueDepletionMartingaleSentry(
        preemptive_prob_threshold=0.75,
        critical_exhaustion_time_ms=35.0,
        cascade_slippage_penalty_bps=6.50,
    )


def test_healthy_queue_shield(sentry):
    # 50,000 shares ahead, total drain 500 shares/sec (lifetime 100 seconds >> 25ms RTT)
    state = QueueMicrostate(
        venue_id="BINANCE",
        level_price=100.0,
        queue_ahead_shares=50_000.0,
        market_drain_rate_shares_sec=300.0,
        cancel_drain_rate_shares_sec=200.0,
        queue_volatility_shares_sec=50.0,
        network_rtt_ms=25.0,
    )
    res = sentry.evaluate(state)
    assert res.state == QueueDepletionState.HEALTHY_QUEUE_SHIELD
    assert res.directive == PreemptiveStopDirective.MAINTAIN_RESTING_QUOTE
    assert res.exhaustion_prob_in_rtt < 0.05
    assert res.expected_slippage_avoided_bps == 0.0


def test_critical_preemptive_stop(sentry):
    # Only 80 shares left, aggressive sweep of 4,000 shares/sec (expected lifetime = 20ms < 25ms RTT)
    state = QueueMicrostate(
        venue_id="COINBASE",
        level_price=100.0,
        queue_ahead_shares=80.0,
        market_drain_rate_shares_sec=3000.0,
        cancel_drain_rate_shares_sec=1000.0,
        queue_volatility_shares_sec=100.0,
        network_rtt_ms=25.0,
    )
    res = sentry.evaluate(state)
    assert res.state == QueueDepletionState.QUEUE_DRAIN_CRITICAL_PREEMPT
    assert res.directive == PreemptiveStopDirective.EXECUTE_PREEMPTIVE_STOP_IOC
    assert res.expected_exhaustion_time_ms <= 35.0
    assert res.exhaustion_prob_in_rtt >= sentry.preemptive_prob_threshold
    assert res.expected_slippage_avoided_bps >= 6.50


def test_vacuum_collapse_emergency(sentry):
    # Queue is completely gone (0 shares)
    state = QueueMicrostate(
        venue_id="BYBIT",
        level_price=100.0,
        queue_ahead_shares=0.0,
        market_drain_rate_shares_sec=500.0,
        cancel_drain_rate_shares_sec=500.0,
        queue_volatility_shares_sec=50.0,
        network_rtt_ms=25.0,
    )
    res = sentry.evaluate(state)
    assert res.state == QueueDepletionState.VACUUM_COLLAPSE_EMERGENCY
    assert res.directive == PreemptiveStopDirective.EMERGENCY_MARKET_FLUSH
    assert res.exhaustion_prob_in_rtt == 1.0


def test_elevated_depletion_acceleration(sentry):
    # 400 shares ahead, 5000 shares/sec drain (lifetime = 80ms)
    state = QueueMicrostate(
        venue_id="OKX",
        level_price=100.0,
        queue_ahead_shares=400.0,
        market_drain_rate_shares_sec=3500.0,
        cancel_drain_rate_shares_sec=1500.0,
        queue_volatility_shares_sec=200.0,
        network_rtt_ms=20.0,
    )
    res = sentry.evaluate(state)
    assert res.state in [QueueDepletionState.ELEVATED_DEPLETION_ACCELERATION, QueueDepletionState.QUEUE_DRAIN_CRITICAL_PREEMPT]
    if res.state == QueueDepletionState.ELEVATED_DEPLETION_ACCELERATION:
        assert res.directive == PreemptiveStopDirective.PREPARE_FAST_CANCEL_ARM


def test_first_passage_monotonicity(sentry):
    q0 = 500.0
    sigma = 50.0
    tau = 0.05  # 50ms

    p_low = sentry.calculate_first_passage_probability(q0, mu_drain=1000.0, sigma=sigma, tau_sec=tau)
    p_high = sentry.calculate_first_passage_probability(q0, mu_drain=10000.0, sigma=sigma, tau_sec=tau)

    assert p_high > p_low
