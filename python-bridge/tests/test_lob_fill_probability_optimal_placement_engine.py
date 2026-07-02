r"""
Unit Test Suite for Domain 192 (WP-CP): High-Frequency Limit Order Book Fill Probability & Optimal Placement Engine
"""

import math
import pytest
from services.lob_fill_probability_optimal_placement_engine import (
    LOBFillProbabilityOptimalPlacementEngine,
    LOBLevelInfo,
    PlacementDirective,
)


def test_fill_probability_queue_scaling():
    """Verifies that fill probability scales monotonically with drain rate and inversely with queue ahead."""
    engine = LOBFillProbabilityOptimalPlacementEngine(db_path=":memory:")

    # Case 1: Small queue, high drain
    p1 = engine.compute_fill_probability(queue_ahead=100.0, order_size=50.0, drain_rate_per_sec=20.0, horizon_sec=30.0)
    # Drain = 600, Queue = 125 -> Hazard = 4.8 -> p \approx 0.99
    assert p1 > 0.95

    # Case 2: Congested queue, low drain
    p2 = engine.compute_fill_probability(queue_ahead=10000.0, order_size=50.0, drain_rate_per_sec=5.0, horizon_sec=30.0)
    # Drain = 150, Queue = 10025 -> Hazard = 0.015 -> p \approx 0.015
    assert p2 < 0.05
    assert p1 > p2


def test_bbo_inside_peg_directive():
    """Verifies that a fast-clearing Level 1 queue triggers inside spread pegging directive."""
    engine = LOBFillProbabilityOptimalPlacementEngine(db_path=":memory:")

    levels = [
        LOBLevelInfo(price=25000.00, depth=500.0, queue_ahead=150.0, ticks_from_mid=1, historical_drain_rate=25.0),
        LOBLevelInfo(price=24999.95, depth=2000.0, queue_ahead=1000.0, ticks_from_mid=2, historical_drain_rate=15.0),
        LOBLevelInfo(price=24999.90, depth=5000.0, queue_ahead=3000.0, ticks_from_mid=3, historical_drain_rate=10.0),
    ]

    report = engine.evaluate_depth_levels(
        symbol="NIFTY",
        side="BUY",
        mid_price=25000.05,
        spread_bps=2.0,
        levels=levels,
        order_size=50.0,
        alpha_drift_bps=0.0,
        target_horizon_sec=30.0,
    )

    assert report.optimal_ticks_from_mid == 1
    assert report.optimal_fill_prob >= 0.70
    assert report.directive == PlacementDirective.OPTIMAL_POSTING_INSIDE_SPREAD_PEG
    assert "Peg order at BBO" in report.rationale


def test_deep_passive_rebate_directive():
    """Verifies that severe BBO queue congestion shifts the optimal placement deeper into the book."""
    engine = LOBFillProbabilityOptimalPlacementEngine(db_path=":memory:")

    # Level 1 is massively congested (50k ahead, only 5 shares/s drain)
    levels = [
        LOBLevelInfo(price=52000.0, depth=100000.0, queue_ahead=50000.0, ticks_from_mid=1, historical_drain_rate=5.0),
        LOBLevelInfo(price=51995.0, depth=500.0, queue_ahead=100.0, ticks_from_mid=2, historical_drain_rate=30.0),
        LOBLevelInfo(price=51990.0, depth=2000.0, queue_ahead=800.0, ticks_from_mid=3, historical_drain_rate=20.0),
    ]

    report = engine.evaluate_depth_levels(
        symbol="BANKNIFTY",
        side="BUY",
        mid_price=52002.0,
        spread_bps=4.0,
        levels=levels,
        order_size=25.0,
        alpha_drift_bps=0.0,
        target_horizon_sec=30.0,
    )

    assert report.optimal_ticks_from_mid >= 2
    assert report.directive == PlacementDirective.OPTIMAL_POSTING_DEEP_PASSIVE_REBATE
    assert "Queue congestion at BBO" in report.rationale


def test_urgent_cross_spread_taker_directive():
    """Verifies that strong directional alpha with low passive fill probability triggers urgent taker aggression."""
    engine = LOBFillProbabilityOptimalPlacementEngine(db_path=":memory:", min_acceptable_fill_prob=0.30)

    # Congested book where passive fill is unlikely
    levels = [
        LOBLevelInfo(price=3000.0, depth=20000.0, queue_ahead=15000.0, ticks_from_mid=1, historical_drain_rate=5.0),
        LOBLevelInfo(price=2999.0, depth=30000.0, queue_ahead=20000.0, ticks_from_mid=2, historical_drain_rate=5.0),
    ]

    # Strong alpha momentum drift (+25 bps) exceeding spread (5 bps)
    report = engine.evaluate_depth_levels(
        symbol="RELIANCE",
        side="BUY",
        mid_price=3000.5,
        spread_bps=3.0,
        levels=levels,
        order_size=100.0,
        alpha_drift_bps=12.0,  # 12 bps drift > 1.5 * 3.0 bps
        target_horizon_sec=15.0,
    )

    assert report.directive == PlacementDirective.URGENT_CROSS_SPREAD_TAKER_AGGRESSION
    assert "Cross spread immediately as taker" in report.rationale


def test_sqlite_telemetry_persistence():
    """Verifies SQLite recording and retrieval of placement evaluations."""
    engine = LOBFillProbabilityOptimalPlacementEngine(db_path=":memory:")

    levels = [
        LOBLevelInfo(price=1600.0, depth=1000.0, queue_ahead=200.0, ticks_from_mid=1, historical_drain_rate=20.0),
    ]

    engine.evaluate_depth_levels("HDFCBANK", "BUY", 1600.5, 2.0, levels, 50.0)

    records = engine.get_recent_placements(limit=5)
    assert len(records) == 1
    assert records[0]["symbol"] == "HDFCBANK"
    assert records[0]["side"] == "BUY"
    assert records[0]["optimal_ticks"] == 1
