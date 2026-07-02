"""
Unit Tests for Structural Liquidity Freeze & Auto-Deleveraging Circuit Breaker Engine (Domain 134 / WP-AJ)
"""

from datetime import datetime
import pytest

from services.liquidity_freeze_circuit_breaker import (
    LiquidityFreezeCircuitBreaker,
    OrderBookSnapshot,
    CircuitBreakerDirective,
)


@pytest.fixture
def circuit_engine():
    return LiquidityFreezeCircuitBreaker(
        baseline_spread_pts=0.50,
        baseline_depth_qty=5000.0,
        level_1_proximity_pct=2.0,
        level_2_proximity_pct=1.0,
        level_3_proximity_pct=0.5,
        db_path=":memory:",
    )


def test_normal_liquidity_conditions(circuit_engine):
    book = OrderBookSnapshot(
        symbol="NIFTY26OCTFUT",
        ltp=25000.0,
        upper_circuit_limit=27500.0,
        lower_circuit_limit=22500.0,
        bids=[(24999.75, 500.0), (24999.50, 500.0), (24999.25, 500.0), (24999.00, 500.0), (24998.75, 500.0)],
        asks=[(25000.25, 500.0), (25000.50, 500.0), (25000.75, 500.0), (25001.00, 500.0), (25001.25, 500.0)],
    )
    d = circuit_engine.evaluate_book_snapshot(book)

    assert d.alert_level == "NORMAL"
    assert d.margin_reduction_pct == 0.0
    assert d.execution_command == "STANDARD_EXECUTION_ACTIVE"
    assert d.min_proximity_pct == 10.0


def test_level_1_warning_on_spread_blowout(circuit_engine):
    # Spread blown out to 2.0 pts (4x baseline)
    book = OrderBookSnapshot(
        symbol="NIFTY26OCTFUT",
        ltp=25000.0,
        upper_circuit_limit=27500.0,
        lower_circuit_limit=22500.0,
        bids=[(24999.00, 500.0)],
        asks=[(25001.00, 500.0)],
    )
    d = circuit_engine.evaluate_book_snapshot(book)

    assert d.alert_level == "LEVEL_1_WARNING"
    assert d.margin_reduction_pct == 0.0
    assert d.execution_command == "CANCEL_AGGRESSIVE_ORDERS_RESTRICT_IOC"


def test_level_2_throttle_50_pct(circuit_engine):
    # Proximity <= 1.0% from lower circuit limit (22500): LTP = 22700 (0.88% away)
    book = OrderBookSnapshot(
        symbol="NIFTY26OCTFUT",
        ltp=22700.0,
        upper_circuit_limit=27500.0,
        lower_circuit_limit=22500.0,
        bids=[(22699.75, 200.0)],
        asks=[(22700.25, 200.0)],
    )
    d = circuit_engine.evaluate_book_snapshot(book)

    assert d.alert_level == "LEVEL_2_THROTTLE_50"
    assert d.margin_reduction_pct == 50.0
    assert d.execution_command == "DELEVERAGE_50_PERCENT_EXPOSURE"


def test_level_3_emergency_flatten(circuit_engine):
    # Proximity <= 0.5% from lower circuit limit (22500): LTP = 22550 (0.22% away)
    book = OrderBookSnapshot(
        symbol="NIFTY26OCTFUT",
        ltp=22550.0,
        upper_circuit_limit=27500.0,
        lower_circuit_limit=22500.0,
        bids=[(22549.75, 50.0)],
        asks=[(22550.25, 50.0)],
    )
    d = circuit_engine.evaluate_book_snapshot(book)

    assert d.alert_level == "LEVEL_3_EMERGENCY_FLATTEN"
    assert d.margin_reduction_pct == 100.0
    assert d.execution_command == "FLATTEN_ALL_POSITIONS_IMMEDIATE"


def test_sqlite_persistence(circuit_engine):
    book = OrderBookSnapshot(
        symbol="BANKNIFTY26OCTFUT",
        ltp=52000.0,
        upper_circuit_limit=57200.0,
        lower_circuit_limit=46800.0,
        bids=[(51999.75, 1500.0), (51999.50, 1500.0)],
        asks=[(52000.25, 1500.0), (52000.50, 1500.0)],
    )
    circuit_engine.evaluate_book_snapshot(book)

    conn = circuit_engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, alert_level, command FROM circuit_breaker_telemetry WHERE symbol = 'BANKNIFTY26OCTFUT'")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "BANKNIFTY26OCTFUT"
    assert row[1] == "NORMAL"
