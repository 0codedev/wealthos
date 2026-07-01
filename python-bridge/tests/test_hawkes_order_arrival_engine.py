"""
Unit Tests for Hawkes Self-Exciting Jump Process & Order Arrival Intensity Sieve (Domain 139 / WP-AO)
"""

import math
import pytest

from services.hawkes_order_arrival_engine import (
    HawkesOrderArrivalEngine,
    OrderArrivalEvent,
    HawkesIntensityReport,
)


@pytest.fixture
def hawkes_engine():
    return HawkesOrderArrivalEngine(
        mu_base_buy=1.0,
        mu_base_sell=1.0,
        alpha_self=6.0,
        alpha_cross=2.0,
        beta_decay=10.0,
        critical_rho_threshold=0.80,
        db_path=":memory:",
    )


def test_compute_spectral_radius(hawkes_engine):
    # With a_self = 6.0, a_cross = 2.0, beta = 10.0:
    # rho = (6.0 + 2.0) / 10.0 = 0.80
    rho = hawkes_engine.compute_spectral_radius()
    assert abs(rho - 0.80) < 1e-4


def test_recursive_exponential_decay(hawkes_engine):
    # Initial state at t=0 with 1 Buy event:
    ev = OrderArrivalEvent(timestamp_sec=0.0, side="BUY")
    rep0 = hawkes_engine.update_and_evaluate(ev)
    # lambda_B = 1.0 + 6.0 * 1.0 = 7.0
    assert abs(rep0.intensity_buy - 7.0) < 1e-2

    # Step forward by 1 half life: dt = ln(2) / 10 = 0.0693147s
    dt_half = math.log(2.0) / 10.0
    rep_half = hawkes_engine.update_and_evaluate(current_time_sec=dt_half)
    # R_B decayed from 1.0 to 0.5 -> lambda_B = 1.0 + 6.0 * 0.5 = 4.0
    assert abs(rep_half.intensity_buy - 4.0) < 0.05


def test_directional_buy_flow_regime(hawkes_engine):
    # Send 4 buy events spaced by 0.02s (decay is minimal e^(-0.2) = 0.82)
    t = 100.0
    for _ in range(4):
        t += 0.02
        rep = hawkes_engine.update_and_evaluate(OrderArrivalEvent(timestamp_sec=t, side="BUY"))

    assert rep.intensity_buy > rep.intensity_sell
    assert rep.flow_asymmetry >= 0.40
    assert rep.regime in ["DIRECTIONAL_BUY_FLOW", "REFLEXIVE_CASCADE_BURST"]
    assert "BUY" in rep.regime or "CASCADE" in rep.regime


def test_reflexive_cascade_burst_regime(hawkes_engine):
    # Rapid reciprocal burst of 10 buys and sells within 0.05 seconds
    t = 200.0
    rep = None
    for i in range(10):
        t += 0.005
        side = "BUY" if i % 2 == 0 else "SELL"
        rep = hawkes_engine.update_and_evaluate(OrderArrivalEvent(timestamp_sec=t, side=side))

    assert rep is not None
    assert rep.regime == "REFLEXIVE_CASCADE_BURST"
    assert rep.quoting_spread_multiplier >= 2.0
    assert "WIDEN_MAKER_SPREADS" in rep.execution_action


def test_sqlite_persistence(hawkes_engine):
    ev = OrderArrivalEvent(timestamp_sec=500.0, side="SELL")
    hawkes_engine.update_and_evaluate(ev)

    conn = hawkes_engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT timestamp_sec, regime, spread_mult FROM hawkes_intensity_telemetry WHERE timestamp_sec = 500.0")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == 500.0
