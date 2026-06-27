"""Unit tests for python-bridge/services/cointegration_stat_arb_engine.py (Domain 115)."""
from __future__ import annotations

import os
import sys
import time
import pytest
import numpy as np

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from services.cointegration_stat_arb_engine import (
    EngleGrangerTester,
    KalmanHedgeRatioFilter,
    OUParameterEstimator,
    OUParameters,
    StatArbEngine,
    PairTradeState,
    BrokenLegReason,
)


@pytest.fixture
def synthetic_cointegrated_data():
    """Generates synthetic cointegrated price series: y_t = 100 + 1.5 * x_t + eps_t (OU spread)."""
    np.random.seed(42)
    n = 300
    # Random walk for X
    x = np.cumsum(np.random.normal(0, 1.0, n)) + 1000.0

    # Mean-reverting AR(1) spread for residuals (theta ~ 0.1, half-life ~ 7 bars)
    eps = np.zeros(n)
    for i in range(1, n):
        eps[i] = 0.90 * eps[i - 1] + np.random.normal(0, 1.5)

    y = 100.0 + 1.5 * x + eps
    return y, x


@pytest.fixture
def synthetic_spurious_data():
    """Generates two independent random walks with no cointegration."""
    np.random.seed(99)
    n = 300
    x = np.cumsum(np.random.normal(0, 1.0, n)) + 1000.0
    y = np.cumsum(np.random.normal(0, 1.0, n)) + 500.0
    return y, x


def test_engle_granger_cointegration_true_pair(synthetic_cointegrated_data):
    y, x = synthetic_cointegrated_data
    alpha, beta, adf_stat, p_val, is_coint = EngleGrangerTester.test_pair(y, x)

    assert is_coint is True
    assert p_val <= 0.05
    assert adf_stat < -3.34
    assert pytest.approx(beta, rel=0.1) == 1.5


def test_engle_granger_spurious_pair(synthetic_spurious_data):
    y, x = synthetic_spurious_data
    alpha, beta, adf_stat, p_val, is_coint = EngleGrangerTester.test_pair(y, x)

    assert is_coint is False
    assert adf_stat > -3.34


def test_kalman_filter_convergence():
    kf = KalmanHedgeRatioFilter(initial_beta=1.0, process_var=1e-5, measure_var=1e-3)
    np.random.seed(123)
    true_beta = 2.25

    for _ in range(100):
        px = np.random.uniform(500.0, 1500.0)
        py = true_beta * px + np.random.normal(0, 0.5)
        est_beta = kf.update(py, px)

    assert pytest.approx(est_beta, rel=0.05) == true_beta


def test_ornstein_uhlenbeck_parameter_estimation():
    # Simulate AR(1) with a = 0.95 -> theta = -ln(0.95)*375 ~= 19.23/day
    np.random.seed(77)
    spread = [0.0]
    for _ in range(500):
        spread.append(0.95 * spread[-1] + np.random.normal(0, 1.0))

    params = OUParameterEstimator.estimate(spread)
    assert params.theta > 0.0
    assert params.half_life_days > 0.0
    assert params.r_squared > 0.50
    assert params.is_valid is True


def test_ornstein_uhlenbeck_half_life_sieve():
    # Rapid noise spread: a = 0.01 -> half-life < 1 day (should be invalid)
    np.random.seed(88)
    noise_spread = np.random.normal(0, 1.0, 200)
    params_noise = OUParameterEstimator.estimate(noise_spread)
    assert params_noise.is_valid is False

    # Structural divergence: a = 1.0 -> no mean reversion
    divergent_spread = np.cumsum(np.random.normal(0.5, 1.0, 200))
    params_div = OUParameterEstimator.estimate(divergent_spread)
    assert params_div.is_valid is False


def test_stat_arb_engine_register_pair(synthetic_cointegrated_data):
    y, x = synthetic_cointegrated_data
    engine = StatArbEngine(db_path=":memory:")

    pair = engine.register_pair(
        symbol_y="HDFCBANK",
        symbol_x="ICICIBANK",
        sector="BANKING",
        prices_y=y,
        prices_x=x,
    )
    assert pair is not None
    assert pair.pair_id == "HDFCBANK_ICICIBANK"
    assert pair.is_active is True
    assert "HDFCBANK_ICICIBANK" in engine.pairs


def test_zscore_signal_generation_long(synthetic_cointegrated_data):
    y, x = synthetic_cointegrated_data
    engine = StatArbEngine(db_path=":memory:")
    pair = engine.register_pair("HDFCBANK", "ICICIBANK", "BANKING", y, x)
    assert pair is not None

    # Force a negative spread divergence (y plummets relative to x)
    # y = alpha + beta * x - 5.0 * spread_std
    px = 1000.0
    py = pair.alpha + pair.beta * px - 3.0 * pair.spread_std

    signal = engine.update_tick(pair.pair_id, py, px)
    assert signal is not None
    assert signal.action == "ENTER_LONG_SPREAD"
    assert signal.z_score <= -2.0


def test_zscore_signal_generation_short(synthetic_cointegrated_data):
    y, x = synthetic_cointegrated_data
    engine = StatArbEngine(db_path=":memory:")
    pair = engine.register_pair("HDFCBANK", "ICICIBANK", "BANKING", y, x)
    assert pair is not None

    # Force a positive spread divergence (y spikes relative to x)
    px = 1000.0
    py = pair.alpha + pair.beta * px + 3.0 * pair.spread_std

    signal = engine.update_tick(pair.pair_id, py, px)
    assert signal is not None
    assert signal.action == "ENTER_SHORT_SPREAD"
    assert signal.z_score >= 2.0


def test_zscore_signal_exit_target(synthetic_cointegrated_data):
    y, x = synthetic_cointegrated_data
    engine = StatArbEngine(db_path=":memory:")
    pair = engine.register_pair("HDFCBANK", "ICICIBANK", "BANKING", y, x)

    # First open a position
    px = 1000.0
    py = pair.alpha + pair.beta * px - 2.5 * pair.spread_std
    sig = engine.update_tick(pair.pair_id, py, px)
    assert sig is not None

    pos = engine.execute_order_pair(
        sig, qty_y=100, qty_x=150,
        fill_y_cb=lambda: (True, py),
        fill_x_cb=lambda: (True, px),
    )
    assert pos.state == PairTradeState.LONG_SPREAD_ACTIVE

    # Now spread reverts back to equilibrium (z near 0)
    py_eq = pair.alpha + pair.kalman_beta * px + 0.1 * pair.spread_std
    exit_sig = engine.update_tick(pair.pair_id, py_eq, px)
    assert exit_sig is not None
    assert exit_sig.action == "EXIT_TARGET"
    assert abs(exit_sig.z_score) <= 0.5


def test_zscore_signal_exit_stop_loss(synthetic_cointegrated_data):
    y, x = synthetic_cointegrated_data
    engine = StatArbEngine(db_path=":memory:")
    pair = engine.register_pair("HDFCBANK", "ICICIBANK", "BANKING", y, x)

    # Open position
    px = 1000.0
    py = pair.alpha + pair.beta * px - 2.2 * pair.spread_std
    sig = engine.update_tick(pair.pair_id, py, px)
    pos = engine.execute_order_pair(
        sig, qty_y=100, qty_x=150,
        fill_y_cb=lambda: (True, py),
        fill_x_cb=lambda: (True, px),
    )
    assert pos.state == PairTradeState.LONG_SPREAD_ACTIVE

    # Spread blows out further past -3.5 sigma
    py_stop = pair.alpha + pair.kalman_beta * px - 4.0 * pair.spread_std
    stop_sig = engine.update_tick(pair.pair_id, py_stop, px)
    assert stop_sig is not None
    assert stop_sig.action == "EXIT_STOP_LOSS"
    assert abs(stop_sig.z_score) >= 3.5


def test_broken_leg_guard_leg2_timeout(synthetic_cointegrated_data):
    y, x = synthetic_cointegrated_data
    engine = StatArbEngine(db_path=":memory:")
    pair = engine.register_pair("HDFCBANK", "ICICIBANK", "BANKING", y, x)

    px = 1000.0
    py = pair.alpha + pair.beta * px + 2.5 * pair.spread_std
    sig = engine.update_tick(pair.pair_id, py, px)
    assert sig is not None

    # Leg 2 takes 200ms (> 150ms timeout)
    def slow_fill_x():
        time.sleep(0.18)
        return True, px

    pos = engine.execute_order_pair(
        sig, qty_y=100, qty_x=150,
        fill_y_cb=lambda: (True, py),
        fill_x_cb=slow_fill_x,
    )
    assert pos.state == PairTradeState.BROKEN_LEG_ABORTING
    assert pos.broken_leg_reason == BrokenLegReason.LEG2_TIMEOUT


def test_broken_leg_guard_leg2_rejection(synthetic_cointegrated_data):
    y, x = synthetic_cointegrated_data
    engine = StatArbEngine(db_path=":memory:")
    pair = engine.register_pair("HDFCBANK", "ICICIBANK", "BANKING", y, x)

    px = 1000.0
    py = pair.alpha + pair.beta * px + 2.5 * pair.spread_std
    sig = engine.update_tick(pair.pair_id, py, px)
    assert sig is not None

    # Leg 2 rejects
    pos = engine.execute_order_pair(
        sig, qty_y=100, qty_x=150,
        fill_y_cb=lambda: (True, py),
        fill_x_cb=lambda: (False, 0.0),
    )
    assert pos.state == PairTradeState.BROKEN_LEG_ABORTING
    assert pos.broken_leg_reason == BrokenLegReason.LEG2_REJECTED
