"""
Unit Tests for High-Frequency Adaptive Limit Order Placement & Queue Position Estimator (Domain 123 / WP-Y)
"""

from datetime import datetime
import pytest

from services.queue_position_estimator import (
    QueuePositionEstimator,
    QueueState,
    OrderPlacementRecommendation,
)


@pytest.fixture
def estimator():
    return QueuePositionEstimator(
        default_cancel_rate=0.20,
        adverse_selection_veto_ratio=0.50,
        db_path=":memory:",
    )


def test_register_limit_order(estimator):
    now = datetime(2026, 10, 18, 12, 10, 0)
    q = estimator.register_limit_order(
        order_id="ORD_1001",
        symbol="RELIANCE",
        side="BUY",
        price=3000.0,
        order_qty=100,
        queue_ahead_at_entry=500,
        timestamp=now,
    )

    assert q.order_id == "ORD_1001"
    assert q.current_queue_ahead == 500
    assert not q.is_at_head_of_queue

    # If placed with 0 ahead, is immediately at head of queue
    q_zero = estimator.register_limit_order(
        order_id="ORD_1002",
        symbol="RELIANCE",
        side="BUY",
        price=3000.05,
        order_qty=50,
        queue_ahead_at_entry=0,
        timestamp=now,
    )
    assert q_zero.is_at_head_of_queue


def test_update_queue_depletion_trades(estimator):
    now = datetime(2026, 10, 18, 12, 10, 0)
    estimator.register_limit_order("ORD_1003", "INFY", "BUY", 1950.0, 100, 300, now)

    t1 = datetime(2026, 10, 18, 12, 10, 1)
    # 150 shares traded at this price level
    updated = estimator.update_queue_depletion("ORD_1003", traded_volume_at_price=150, total_level_volume_change=-150, current_time=t1)
    assert updated.current_queue_ahead == 150
    assert not updated.is_at_head_of_queue

    # Another 150 shares traded -> reaches head of queue
    t2 = datetime(2026, 10, 18, 12, 10, 2)
    updated2 = estimator.update_queue_depletion("ORD_1003", traded_volume_at_price=150, total_level_volume_change=-150, current_time=t2)
    assert updated2.current_queue_ahead == 0
    assert updated2.is_at_head_of_queue


def test_update_queue_depletion_cancellations(estimator):
    now = datetime(2026, 10, 18, 12, 10, 0)
    estimator.register_limit_order("ORD_1004", "TCS", "SELL", 4200.0, 50, 400, now)

    t1 = datetime(2026, 10, 18, 12, 10, 1)
    # Total level volume dropped by 200, but only 50 was trades -> 150 was cancellations
    updated = estimator.update_queue_depletion("ORD_1004", traded_volume_at_price=50, total_level_volume_change=-200, current_time=t1)
    # Queue ahead drops by trades (50) + proportional cancellations
    assert updated.current_queue_ahead < 350
    assert updated.current_queue_ahead > 0


def test_expected_time_to_fill_analytical(estimator):
    # With 0 queue ahead, fill time is immediate 0.0
    t0 = estimator.calculate_expected_time_to_fill(queue_ahead=0, trade_intensity_per_sec=50.0)
    assert t0 == 0.0

    # With 500 queue ahead and trade intensity 100/sec, cancel rate 0.20
    t_fill = estimator.calculate_expected_time_to_fill(queue_ahead=500, trade_intensity_per_sec=100.0, cancel_rate=0.20)
    # Without cancellations: 500 / 100 = 5.0s. With cancellations, it must be strictly less than 5.0s!
    assert 0.0 < t_fill < 5.0


def test_fill_probability_monotonicity(estimator):
    # Horizon monotonicity: P(Fill in 10s) > P(Fill in 2s)
    p_short = estimator.calculate_fill_probability(queue_ahead=200, order_qty=50, trade_intensity_per_sec=20.0, horizon_sec=2.0)
    p_long = estimator.calculate_fill_probability(queue_ahead=200, order_qty=50, trade_intensity_per_sec=20.0, horizon_sec=10.0)
    assert p_long > p_short
    assert 0.0 <= p_short <= 1.0
    assert 0.0 <= p_long <= 1.0

    # Depth monotonicity: Deeper queue ahead has lower fill probability
    p_deep = estimator.calculate_fill_probability(queue_ahead=1000, order_qty=50, trade_intensity_per_sec=20.0, horizon_sec=5.0)
    p_shallow = estimator.calculate_fill_probability(queue_ahead=100, order_qty=50, trade_intensity_per_sec=20.0, horizon_sec=5.0)
    assert p_shallow > p_deep


def test_placement_strategy_toxic_cross_spread(estimator):
    now = datetime(2026, 10, 18, 12, 15, 0)
    # High VPIN = 0.65 (very toxic adverse selection)
    rec = estimator.evaluate_placement_strategy(
        symbol="NIFTY_FUT",
        side="BUY",
        best_bid=24500.0,
        best_ask=24500.5,
        bid_depth_ahead=400,
        ask_depth_ahead=300,
        trade_intensity_per_sec=50.0,
        vpin_metric=0.65,
        timestamp=now,
    )

    assert rec.recommended_action == "CROSS_SPREAD_AGGRESSIVE"
    assert rec.target_price == 24500.5  # Cross to ask
    assert rec.expected_fill_prob == 1.0


def test_placement_strategy_wide_spread_post_inside(estimator):
    now = datetime(2026, 10, 18, 12, 16, 0)
    # Wide spread (bid 1000.0, ask 1000.50), benign flow (VPIN = 0.15)
    rec = estimator.evaluate_placement_strategy(
        symbol="MIDCAP_STK",
        side="BUY",
        best_bid=1000.0,
        best_ask=1000.50,
        bid_depth_ahead=500,
        ask_depth_ahead=500,
        trade_intensity_per_sec=10.0,
        vpin_metric=0.15,
        timestamp=now,
    )

    assert rec.recommended_action == "POST_INSIDE_SPREAD"
    assert rec.target_price == 1000.05  # Inside spread


def test_placement_strategy_tight_spread_join_queue(estimator):
    now = datetime(2026, 10, 18, 12, 17, 0)
    # Tight spread (bid 3000.0, ask 3000.05), benign flow (VPIN = 0.10)
    rec = estimator.evaluate_placement_strategy(
        symbol="RELIANCE",
        side="BUY",
        best_bid=3000.0,
        best_ask=3000.05,
        bid_depth_ahead=300,
        ask_depth_ahead=300,
        trade_intensity_per_sec=30.0,
        vpin_metric=0.10,
        timestamp=now,
    )

    assert rec.recommended_action == "JOIN_QUEUE_PASSIVE"
    assert rec.target_price == 3000.0  # Join bid


def test_sqlite_persistence(estimator):
    now = datetime(2026, 10, 18, 12, 18, 0)
    estimator.evaluate_placement_strategy(
        symbol="SBIN",
        side="SELL",
        best_bid=800.0,
        best_ask=800.05,
        bid_depth_ahead=200,
        ask_depth_ahead=200,
        trade_intensity_per_sec=25.0,
        vpin_metric=0.10,
        timestamp=now,
    )

    conn = estimator._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, action, target_price FROM queue_estimator_logs WHERE symbol = 'SBIN'")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "SBIN"
    assert row[1] == "JOIN_QUEUE_PASSIVE"
    assert row[2] == 800.05
