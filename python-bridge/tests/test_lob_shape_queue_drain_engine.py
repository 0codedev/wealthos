"""
Unit tests for Domain 175 (WP-BY): High-Frequency Limit Order Book Shape & Queue Drain Alpha Engine
"""

import pytest
from services.lob_shape_queue_drain_engine import (
    LOBLevel,
    LOBTopBookSnapshot,
    LOBShapeQueueDrainEngine,
    QueueDrainReport,
)


def test_calculate_queue_drain_velocities():
    engine = LOBShapeQueueDrainEngine()
    # Snapshot 0: Ask has 10,000 shares, Bid has 8,000 shares at t = 100.0s
    snap0 = LOBTopBookSnapshot(
        timestamp=100.0,
        bids=[LOBLevel(price=100.0, quantity=8000.0, order_count=40)],
        asks=[LOBLevel(price=100.05, quantity=10000.0, order_count=50)],
    )

    # Snapshot 1: At t = 100.5s (500ms later), Ask drops to 2,000 shares (eaten by market buy)
    # Bid stays stable at 8,000 shares
    snap1 = LOBTopBookSnapshot(
        timestamp=100.5,
        bids=[LOBLevel(price=100.0, quantity=8000.0, order_count=40)],
        asks=[LOBLevel(price=100.05, quantity=2000.0, order_count=10)],
    )

    v_bid, v_ask = engine.calculate_queue_drain_velocities(snap0, snap1)
    # v_bid = (8000 - 8000) / 0.5 = 0.0
    # v_ask = (2000 - 10000) / 0.5 = -16,000.0 shares/sec
    assert v_bid == 0.0
    assert v_ask == -16000.0


def test_calculate_drain_imbalance_and_jump_prob():
    engine = LOBShapeQueueDrainEngine()
    # Ask is draining at -10,000/s while bid is steady (0/s)
    # Bid queue is 5,000, ask queue is 1,000
    imb, p_up = engine.calculate_drain_imbalance_and_jump_prob(
        v_bid=0.0, v_ask=-10000.0, q_bid=5000.0, q_ask=1000.0
    )
    # Drain imbalance should be +1.0 (pure ask depletion)
    assert imb == 1.0
    # Probability of uptick jump should be high (> 0.80)
    assert p_up > 0.80


def test_analyze_lob_imminent_uptick_directive():
    engine = LOBShapeQueueDrainEngine()
    snap0 = LOBTopBookSnapshot(
        timestamp=100.0,
        bids=[LOBLevel(price=2500.0, quantity=12000.0, order_count=30)],
        asks=[LOBLevel(price=2500.05, quantity=15000.0, order_count=35)],
    )
    # Violent sweep: ask drops to 1,500 shares in 200ms
    snap1 = LOBTopBookSnapshot(
        timestamp=100.2,
        bids=[LOBLevel(price=2500.0, quantity=12000.0, order_count=30)],
        asks=[LOBLevel(price=2500.05, quantity=1500.0, order_count=5)],
    )

    rep = engine.analyze_lob("RELIANCE", snap0, snap1)
    assert rep.symbol == "RELIANCE"
    assert rep.prob_uptick >= 0.75
    assert rep.regime == "ASK_QUEUE_RAPID_DEPLETION_IMMINENT_UPTICK"
    assert rep.trade_directive == "EXECUTE_IMMEDIATE_TAKER_BUY"


def test_analyze_lob_imminent_downtick_directive():
    engine = LOBShapeQueueDrainEngine()
    snap0 = LOBTopBookSnapshot(
        timestamp=100.0,
        bids=[LOBLevel(price=50000.0, quantity=1000.0, order_count=20)],
        asks=[LOBLevel(price=50001.0, quantity=1000.0, order_count=20)],
    )
    # Violent sweep: bid drops from 1000 to 100 in 100ms
    snap1 = LOBTopBookSnapshot(
        timestamp=100.1,
        bids=[LOBLevel(price=50000.0, quantity=100.0, order_count=3)],
        asks=[LOBLevel(price=50001.0, quantity=1000.0, order_count=20)],
    )

    rep = engine.analyze_lob("BANKNIFTY", snap0, snap1)
    assert rep.symbol == "BANKNIFTY"
    assert rep.prob_uptick <= 0.25
    assert rep.regime == "BID_QUEUE_RAPID_DEPLETION_IMMINENT_DOWNTICK"
    assert rep.trade_directive == "EXECUTE_IMMEDIATE_TAKER_SELL"


def test_sqlite_persistence():
    engine = LOBShapeQueueDrainEngine(db_path=":memory:")
    snap0 = LOBTopBookSnapshot(
        timestamp=1.0,
        bids=[LOBLevel(price=100.0, quantity=500.0, order_count=5)],
        asks=[LOBLevel(price=100.05, quantity=500.0, order_count=5)],
    )
    snap1 = LOBTopBookSnapshot(
        timestamp=1.5,
        bids=[LOBLevel(price=100.0, quantity=500.0, order_count=5)],
        asks=[LOBLevel(price=100.05, quantity=500.0, order_count=5)],
    )
    rep = engine.analyze_lob("INFY", snap0, snap1)
    assert rep.symbol == "INFY"

    rows = engine.get_latest_telemetry(5)
    assert len(rows) == 1
    assert rows[0][0] == "INFY"
    assert rows[0][1] == 100.025
