r"""Unit Tests for Limit Order Book Queue Position Estimation & Rebate Capture Engine (Domain 208 / WP-DF)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.lob_queue_position_rebate_engine import (
    LOBQueuePositionRebateEngine,
    QueueHealthStatus,
    QueueTacticalAction,
)


@pytest.fixture
def engine() -> LOBQueuePositionRebateEngine:
    return LOBQueuePositionRebateEngine(
        maker_rebate_bps=0.50,
        base_spread_bps=2.00,
        trade_drain_rate_shares_sec=250.0,
        opportunity_cost_bps=0.40,
    )


def test_initialize_order_queue(engine: LOBQueuePositionRebateEngine):
    order = engine.initialize_order_queue(
        order_id="ORD_001",
        price=25000.0,
        side="BID",
        order_size=100.0,
        existing_level_depth=900.0,
    )

    assert order.order_id == "ORD_001"
    assert order.volume_ahead == 900.0
    assert order.volume_behind == 0.0
    assert order.total_level_volume == 1000.0
    assert order.queue_fraction_ahead == 0.90

    diag = engine.analyze_queue_diagnostics(order)
    assert diag.queue_status == QueueHealthStatus.BACK_OF_QUEUE_TRAPPED


def test_process_queue_events_trade_drain(engine: LOBQueuePositionRebateEngine):
    order = engine.initialize_order_queue(
        order_id="ORD_002",
        price=25000.0,
        side="BID",
        order_size=100.0,
        existing_level_depth=500.0,
    )

    # 350 shares traded at price level
    updated = engine.process_queue_events(order, trades_at_price=350.0, cancels_at_price=0.0)
    assert updated.volume_ahead == 150.0
    assert updated.total_level_volume == 250.0


def test_process_queue_events_cancellation(engine: LOBQueuePositionRebateEngine):
    # Total volume = 1000 (ahead 400, our size 100, behind 500)
    order = engine.initialize_order_queue(
        order_id="ORD_003",
        price=25000.0,
        side="BID",
        order_size=100.0,
        existing_level_depth=400.0,
    )
    # Add 500 behind
    order.volume_behind = 500.0
    order.total_level_volume = 1000.0

    # 200 shares canceled at price level: ahead portion = 200 * (400 / 1000) = 80
    updated = engine.process_queue_events(order, trades_at_price=0.0, cancels_at_price=200.0)
    assert updated.volume_ahead == 320.0


def test_front_of_queue_rebate_harvest(engine: LOBQueuePositionRebateEngine):
    order = engine.initialize_order_queue(
        order_id="ORD_004",
        price=25000.0,
        side="BID",
        order_size=100.0,
        existing_level_depth=40.0,
    )
    order.volume_behind = 2000.0
    order.total_level_volume = 2140.0
    order.queue_fraction_ahead = 40.0 / 2140.0

    diag = engine.analyze_queue_diagnostics(order)
    assert diag.queue_status == QueueHealthStatus.FRONT_OF_QUEUE
    assert diag.fill_probability_5s > 0.80
    assert diag.recommended_action == QueueTacticalAction.HOLD_AND_HARVEST_REBATE
    assert "Prime queue position" in diag.tactical_directive


def test_back_of_queue_repositioning(engine: LOBQueuePositionRebateEngine):
    order = engine.initialize_order_queue(
        order_id="ORD_005",
        price=25000.0,
        side="BID",
        order_size=50.0,
        existing_level_depth=10000.0,
    )

    # Slow drain rate of 20 shares/sec
    diag = engine.analyze_queue_diagnostics(order, custom_drain_rate=20.0)
    assert diag.queue_status == QueueHealthStatus.BACK_OF_QUEUE_TRAPPED
    assert diag.fill_probability_5s < 0.10
    assert diag.recommended_action == QueueTacticalAction.REPOSITION_INSIDE_SPREAD
    assert "Cancel and re-post inside spread" in diag.tactical_directive
