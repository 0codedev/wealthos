r"""Unit Tests for Microstructure Level-3 Cancel-Replace Game & Priority Queue Depletion Sentry (Domain 218 / WP-DP)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import pytest
from services.cancel_replace_queue_depletion_sentry import (
    CancelReplaceQueueDepletionSentry,
    RestingQuoteState,
    TargetLevelState,
    QueuePriorityStatus,
    CancelReplaceTacticalAction,
)


@pytest.fixture
def sentry() -> CancelReplaceQueueDepletionSentry:
    return CancelReplaceQueueDepletionSentry(
        cancel_replace_friction_bps=0.15,
        amendment_rtt_latency_sec=0.005,
        horizon_sec=5.0,
    )


def test_prime_front_priority_hold(sentry: CancelReplaceQueueDepletionSentry):
    order = RestingQuoteState(
        order_id="ORD_101",
        price=100.0,
        side="BID",
        size=100.0,
        volume_ahead=150.0,
        volume_behind=850.0,
        total_level_volume=1100.0,
        drain_rate_shares_sec=50.0,
    )

    res = sentry.evaluate_cancel_replace_decision(order)
    assert res.queue_fraction_ahead <= 0.25
    assert res.priority_status == QueuePriorityStatus.PRIME_FRONT_PRIORITY
    assert res.recommended_action == CancelReplaceTacticalAction.MAINTAIN_RESTING_PRIORITY
    assert "HOLD PRIORITY" in res.tactical_directive


def test_race_condition_amendment_reject(sentry: CancelReplaceQueueDepletionSentry):
    # Only 2 shares ahead with huge drain rate 500 shares/sec -> fill in 4ms!
    order = RestingQuoteState(
        order_id="ORD_102",
        price=100.0,
        side="BID",
        size=2.0,
        volume_ahead=1.0,
        volume_behind=1000.0,
        total_level_volume=1003.0,
        drain_rate_shares_sec=500.0,
    )

    res = sentry.evaluate_cancel_replace_decision(order)
    assert res.priority_status == QueuePriorityStatus.PRIME_FRONT_PRIORITY
    assert res.recommended_action == CancelReplaceTacticalAction.REJECT_AMENDMENT_RACE
    assert "RACE REJECT" in res.tactical_directive


def test_imminent_toxic_sweep_evacuation(sentry: CancelReplaceQueueDepletionSentry):
    order = RestingQuoteState(
        order_id="ORD_103",
        price=100.0,
        side="BID",
        size=100.0,
        volume_ahead=200.0,
        volume_behind=500.0,
        total_level_volume=800.0,
        drain_rate_shares_sec=100.0,
    )

    # 1,500 shares sweep incoming in last 100ms
    res = sentry.evaluate_cancel_replace_decision(
        current_order=order,
        incoming_sweep_volume_last_100ms=1500.0,
    )

    assert res.priority_status == QueuePriorityStatus.IMMINENT_TOXIC_SWEEP
    assert res.recommended_action == CancelReplaceTacticalAction.IMMEDIATE_CANCEL_EVACUATION
    assert "EMERGENCY EVACUATION" in res.tactical_directive


def test_trapped_tail_queue_jump(sentry: CancelReplaceQueueDepletionSentry):
    # Order trapped at back: 8,500 ahead out of 10,000 (85%)
    order = RestingQuoteState(
        order_id="ORD_104",
        price=100.0,
        side="BID",
        size=100.0,
        volume_ahead=8500.0,
        volume_behind=1400.0,
        total_level_volume=10000.0,
        drain_rate_shares_sec=200.0, # Will take ~42 seconds to fill
    )

    target = TargetLevelState(
        price=100.05,
        existing_depth=300.0,
        drain_rate_shares_sec=250.0, # Will take ~1.4 seconds to fill
    )

    res = sentry.evaluate_cancel_replace_decision(
        current_order=order,
        target_level=target,
    )

    assert res.priority_status == QueuePriorityStatus.TRAPPED_TAIL_PRIORITY
    assert res.recommended_action == CancelReplaceTacticalAction.EXECUTE_CANCEL_REPLACE_JUMP
    assert res.net_jump_economic_value_bps > 0
    assert "QUEUE JUMP" in res.tactical_directive


def test_mid_queue_advancing_hold(sentry: CancelReplaceQueueDepletionSentry):
    order = RestingQuoteState(
        order_id="ORD_105",
        price=100.0,
        side="BID",
        size=100.0,
        volume_ahead=400.0,
        volume_behind=600.0,
        total_level_volume=1100.0,
        drain_rate_shares_sec=200.0,
    )

    # Target has higher depth, so jumping is not worth it
    target = TargetLevelState(
        price=100.05,
        existing_depth=1200.0,
        drain_rate_shares_sec=100.0,
    )

    res = sentry.evaluate_cancel_replace_decision(
        current_order=order,
        target_level=target,
    )

    assert res.priority_status == QueuePriorityStatus.MID_QUEUE_ADVANCING
    assert res.recommended_action == CancelReplaceTacticalAction.MAINTAIN_RESTING_PRIORITY
