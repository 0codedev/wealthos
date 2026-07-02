"""
Unit Test Suite for Domain 253: High-Frequency Limit Order Book Hidden Liquidity Iceberg Detection & Execution Footprint Sentry
"""

import pytest
from services.lob_iceberg_footprint_sentry import (
    LOBIcebergFootprintSentry,
    LevelTradeObservation,
    IcebergDetectionState,
    IcebergTacticalDirective,
)


@pytest.fixture
def sentry():
    return LOBIcebergFootprintSentry(
        min_replenishments=3,
        max_reload_latency_ms=5.0,
        confidence_threshold=85.0,
    )


def test_standard_lit_book_flow(sentry):
    # Single trade sweeps visible depth, book does not reload
    obs = [
        LevelTradeObservation(
            price=100.0,
            visible_depth_before=1000.0,
            trade_volume=1000.0,
            visible_depth_after=0.0,
            reload_latency_ms=999.0,
            timestamp_ms=1000.0,
        )
    ]
    res = sentry.evaluate_level(100.0, "BID", obs)
    assert res.state == IcebergDetectionState.STANDARD_LIT_BOOK_FLOW
    assert res.directive == IcebergTacticalDirective.PROCEED_STANDARD_ROUTING
    assert res.observed_replenishments == 0
    assert res.hidden_liquidity_ratio == 1.0


def test_suspected_micro_iceberg(sentry):
    # 1 rapid reload observed
    obs = [
        LevelTradeObservation(
            price=100.0,
            visible_depth_before=500.0,
            trade_volume=500.0,
            visible_depth_after=500.0,
            reload_latency_ms=1.5,
            timestamp_ms=1000.0,
        )
    ]
    res = sentry.evaluate_level(100.0, "ASK", obs)
    assert res.state == IcebergDetectionState.SUSPECTED_MICRO_ICEBERG
    assert res.directive == IcebergTacticalDirective.MONITOR_SUSPECTED_RELOAD
    assert res.observed_replenishments == 1


def test_detected_active_iceberg_anchor(sentry):
    # 4 consecutive reloads of 1,000 shares each within 1.0ms
    obs = [
        LevelTradeObservation(100.0, 1000.0, 1000.0, 1000.0, 0.8, 1000.0),
        LevelTradeObservation(100.0, 1000.0, 1000.0, 1000.0, 0.9, 1010.0),
        LevelTradeObservation(100.0, 1000.0, 1000.0, 1000.0, 0.7, 1020.0),
        LevelTradeObservation(100.0, 1000.0, 1000.0, 1000.0, 1.1, 1030.0),
    ]
    res = sentry.evaluate_level(100.0, "BID", obs)
    assert res.state == IcebergDetectionState.DETECTED_ACTIVE_ICEBERG_ANCHOR
    assert res.directive == IcebergTacticalDirective.HALT_AGGRESSIVE_FLOW_INTO_WALL
    assert res.observed_replenishments == 4
    assert res.detection_confidence_pct >= 85.0
    assert res.estimated_total_iceberg_size >= 4000.0


def test_iceberg_exhaustion_breakthrough(sentry):
    # 3 reloads of 500 shares, then final trade of 500 with zero depth after
    obs = [
        LevelTradeObservation(100.0, 500.0, 500.0, 500.0, 1.2, 1000.0),
        LevelTradeObservation(100.0, 500.0, 500.0, 500.0, 1.0, 1010.0),
        LevelTradeObservation(100.0, 500.0, 500.0, 500.0, 0.9, 1020.0),
        # Final sweep consumes depth and no replenishment follows
        LevelTradeObservation(100.0, 500.0, 500.0, 0.0, 999.0, 1030.0),
    ]
    res = sentry.evaluate_level(100.0, "ASK", obs)
    # Remaining hidden is 0
    assert res.estimated_remaining_hidden == 0.0
    assert res.state == IcebergDetectionState.ICEBERG_EXHAUSTION_BREAKTHROUGH
    assert res.directive == IcebergTacticalDirective.PREPARE_BREAKOUT_CHASE


def test_empty_observations(sentry):
    res = sentry.evaluate_level(50.0, "BID", [])
    assert res.state == IcebergDetectionState.STANDARD_LIT_BOOK_FLOW
    assert res.observed_replenishments == 0
