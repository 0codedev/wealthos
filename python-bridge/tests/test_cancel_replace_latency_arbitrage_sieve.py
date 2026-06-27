r"""
Unit Test Suite for Domain 195 (WP-CS): Sub-Millisecond LOB Cancel-to-Replace Latency Arbitrage Sieve
"""

import math
import pytest
from services.cancel_replace_latency_arbitrage_sieve import (
    CancelReplaceDirective,
    CancelReplaceLatencyArbitrageSieve,
    OrderModifyContext,
)


def test_snipe_probability_scaling():
    """Verifies that snipe probability increases monotonically with latency and toxic flow intensity."""
    sieve = CancelReplaceLatencyArbitrageSieve(db_path=":memory:")

    ctx = OrderModifyContext(
        symbol="NIFTY",
        order_id="ORD_101",
        current_price=25000.0,
        target_price=25002.0,
        order_size=100.0,
        current_queue_rank=50.0,
        total_queue_depth=1000.0,
        toxic_snipe_intensity=5.0,  # 5 snipes/sec
    )

    # Fast 1ms latency
    rep_fast = sieve.evaluate_amendment(ctx, [1.0, 1.2, 0.9, 1.1])
    # Slow 20ms latency
    rep_slow = sieve.evaluate_amendment(ctx, [20.0, 22.0, 19.0, 25.0])

    assert rep_slow.snipe_probability > rep_fast.snipe_probability
    assert rep_slow.directive == CancelReplaceDirective.ABORT_MODIFY_LATENCY_JITTER_HAZARD


def test_abort_modify_under_latency_spike():
    """Verifies that high round-trip latency triggers modification abort directive."""
    sieve = CancelReplaceLatencyArbitrageSieve(db_path=":memory:", critical_rtt_ms=15.0)

    ctx = OrderModifyContext(
        symbol="BANKNIFTY",
        order_id="ORD_102",
        current_price=52000.0,
        target_price=52005.0,
        order_size=25.0,
        current_queue_rank=200.0,
        total_queue_depth=500.0,
    )

    # 18ms latency > 15ms critical threshold
    latencies = [16.0, 18.0, 19.5, 17.5, 20.0]
    rep = sieve.evaluate_amendment(ctx, latencies)

    assert rep.mean_rtt_ms > 15.0
    assert rep.directive == CancelReplaceDirective.ABORT_MODIFY_LATENCY_JITTER_HAZARD
    assert "ABORT order modification" in rep.rationale


def test_preserve_queue_priority_minor_drift():
    """Verifies that front-of-queue priority is preserved when price drift is within 1 tick."""
    sieve = CancelReplaceLatencyArbitrageSieve(db_path=":memory:", tick_size=0.05)

    ctx = OrderModifyContext(
        symbol="RELIANCE",
        order_id="ORD_103",
        current_price=3000.0,
        target_price=3000.05,  # Only 1 tick drift!
        order_size=50.0,
        current_queue_rank=30.0,  # Rank 30 of 1000 -> 3% (front of queue!)
        total_queue_depth=1000.0,
    )

    # Clean low-latency environment
    rep = sieve.evaluate_amendment(ctx, [1.5, 1.8, 1.2, 1.6])

    assert rep.directive == CancelReplaceDirective.PRESERVE_QUEUE_PRIORITY_HOLD_RESTING
    assert "HOLD resting quote" in rep.rationale


def test_execute_cancel_replace_rapid_pegging():
    """Verifies that clean latency with substantial price drift triggers immediate cancel-replace execution."""
    sieve = CancelReplaceLatencyArbitrageSieve(db_path=":memory:", tick_size=0.05)

    ctx = OrderModifyContext(
        symbol="INFY",
        order_id="ORD_104",
        current_price=1800.0,
        target_price=1801.50,  # 30 ticks away (8.3 bps drift!)
        order_size=100.0,
        current_queue_rank=400.0,
        total_queue_depth=500.0,  # Stale queue rank near the back
    )

    # Clean co-located latency: 1.2ms
    rep = sieve.evaluate_amendment(ctx, [1.1, 1.3, 1.0, 1.2])

    assert rep.directive == CancelReplaceDirective.EXECUTE_CANCEL_REPLACE_RAPID_PEGGING
    assert "Execute immediate sub-millisecond Cancel-Replace" in rep.rationale
    assert rep.price_drift_bps > rep.expected_modification_cost_bps


def test_sqlite_telemetry_persistence():
    """Verifies SQLite recording and retrieval of cancel-replace telemetry."""
    sieve = CancelReplaceLatencyArbitrageSieve(db_path=":memory:")

    ctx = OrderModifyContext(
        symbol="TCS",
        order_id="ORD_105",
        current_price=4000.0,
        target_price=4002.0,
        order_size=10.0,
        current_queue_rank=50.0,
        total_queue_depth=200.0,
    )

    sieve.evaluate_amendment(ctx, [2.0, 2.2, 1.8])

    records = sieve.get_recent_evaluations(limit=5)
    assert len(records) == 1
    assert records[0]["symbol"] == "TCS"
    assert records[0]["order_id"] == "ORD_105"
