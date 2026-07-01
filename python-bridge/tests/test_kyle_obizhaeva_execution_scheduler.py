"""
Unit tests for Domain 171 (WP-BU): Multi-Regime Cross-Impact Kyle-Obizhaeva Optimal Execution Scheduler
"""

import pytest
from services.kyle_obizhaeva_execution_scheduler import (
    KyleObizhaevaExecutionScheduler,
    MicrostructureParams,
    ObizhaevaScheduleReport,
)


def test_compute_obizhaeva_weights_conservation():
    scheduler = KyleObizhaevaExecutionScheduler()
    # 10 steps over 30 minutes with rho = 0.20
    w_0, w_interior, w_N = scheduler.compute_obizhaeva_weights(num_steps=10, horizon_minutes=30.0, rho=0.20)
    # Exact weight conservation
    total_weight = w_0 + w_N + 9 * w_interior
    assert abs(total_weight - 1.0) < 1e-5
    # Initial and terminal blocks must be equal and larger than individual interior slices
    assert abs(w_0 - w_N) < 1e-5
    assert w_0 > w_interior


def test_generate_schedule_blocks():
    scheduler = KyleObizhaevaExecutionScheduler()
    params = MicrostructureParams(
        symbol="RELIANCE",
        kyle_lambda=0.08,  # 0.08 pts per 10k shares
        resilience_rho=0.15,
        daily_volume=5000000.0,
        spread=0.05,
    )
    total_shares = 100000.0
    rep = scheduler.generate_schedule(
        total_shares=total_shares,
        horizon_minutes=60.0,
        num_steps=12,
        params=params,
    )
    assert rep.symbol == "RELIANCE"
    assert rep.regime == "STANDARD_TRANSIENT_RESILIENCE_OPTIMAL"
    assert rep.trade_directive == "EXECUTE_OBIZHAEVA_WANG_BLOCK_SCHEDULE"

    # Slice checks
    assert len(rep.schedule) == 13  # Step 0 + 11 interior + Step 12 terminal
    assert rep.schedule[0].is_block is True
    assert rep.schedule[-1].is_block is True
    assert rep.schedule[1].is_block is False

    # Exact total volume conservation
    total_executed = sum(s.shares for s in rep.schedule)
    assert abs(total_executed - total_shares) < 1.0


def test_toxic_flow_regime_adjustment():
    scheduler = KyleObizhaevaExecutionScheduler()
    params = MicrostructureParams(
        symbol="NIFTY_FUT",
        kyle_lambda=0.10,
        resilience_rho=0.25,
        daily_volume=10000000.0,
        spread=0.05,
    )
    # Standard schedule
    rep_normal = scheduler.generate_schedule(50000.0, 30.0, 6, params, is_toxic_flow=False)
    # Toxic schedule
    rep_toxic = scheduler.generate_schedule(50000.0, 30.0, 6, params, is_toxic_flow=True)

    assert rep_toxic.regime == "TOXIC_FLOW_WIDE_RESILIENCE_EXPANSION"
    assert rep_toxic.trade_directive == "THROTTLE_EXECUTION_DAMPENED_SCHEDULE"
    # Toxic flow has higher price impact cost
    assert rep_toxic.expected_cost_bps > rep_normal.expected_cost_bps


def test_anemic_resilience_pause():
    scheduler = KyleObizhaevaExecutionScheduler()
    params = MicrostructureParams(
        symbol="ILLIQUID_STOCK",
        kyle_lambda=0.50,
        resilience_rho=0.02,  # Book recovers exceptionally slowly
        daily_volume=50000.0,
        spread=0.50,
    )
    rep = scheduler.generate_schedule(10000.0, 60.0, 5, params)
    assert rep.regime == "ANEMIC_ORDER_BOOK_RESILIENCE"
    assert rep.trade_directive == "PAUSE_LIQUIDATION_WAIT_FOR_REFILL"


def test_sqlite_persistence():
    scheduler = KyleObizhaevaExecutionScheduler(db_path=":memory:")
    params = MicrostructureParams(
        symbol="INFY",
        kyle_lambda=0.05,
        resilience_rho=0.20,
        daily_volume=3000000.0,
        spread=0.05,
    )
    rep = scheduler.generate_schedule(20000.0, 20.0, 4, params)
    assert rep.symbol == "INFY"

    rows = scheduler.get_latest_telemetry(5)
    assert len(rows) == 1
    assert rows[0][0] == "INFY"
    assert rows[0][1] == 20000.0
