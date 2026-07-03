"""
Unit Tests for Multi-Asset Intraday Momentum & Kyle's Lambda Price Impact Calibration Engine
Domain 227 / Work Package WP-DY
"""

import pytest
import math
import random
from services.momentum_kyle_lambda_calibration_engine import (
    MomentumKyleLambdaCalibrationEngine,
    OrderFlowTick,
    IlliquidityRegimeState,
    MomentumTradeState,
)


def generate_order_flow_ticks(n: int = 50, true_lambda: float = 0.001, seed: int = 42):
    random.seed(seed)
    p = 100.0
    ticks = []
    t = 0.0

    for _ in range(n):
        q = random.gauss(0.0, 500.0)  # signed volume
        dp = true_lambda * q + random.gauss(0.0, 0.05)
        p += dp
        t += 1.0
        ticks.append(OrderFlowTick(price=p, signed_volume=q, timestamp=t))

    return ticks


def test_kyle_lambda_calibration():
    engine = MomentumKyleLambdaCalibrationEngine()
    ticks = generate_order_flow_ticks(n=100, true_lambda=0.0012)

    calib = engine.calibrate_kyle_lambda(ticks)
    assert calib.sample_size == 99
    assert calib.lambda_kyle > 0.0
    assert pytest.approx(0.0012, abs=0.0003) == calib.lambda_kyle
    assert calib.t_statistic > 2.0
    assert calib.r_squared > 0.10


def test_lead_lag_cross_correlation():
    engine = MomentumKyleLambdaCalibrationEngine()
    random.seed(123)

    # Leader is white noise
    leader = [random.gauss(0.0, 0.01) for _ in range(60)]
    # Follower lags leader by 2 steps with noise
    follower = [0.0, 0.0] + [0.8 * leader[i] + random.gauss(0.0, 0.002) for i in range(58)]

    res = engine.compute_lead_lag_cross_correlation(leader, follower, max_lags=4)
    assert res.optimal_lag_steps == 2
    assert res.cross_correlation > 0.60
    assert res.lead_score > 0.40


def test_execute_momentum_long():
    engine = MomentumKyleLambdaCalibrationEngine(alpha_scaling_factor=1.5)
    ticks = generate_order_flow_ticks(n=60, true_lambda=0.00005)  # highly liquid, tiny lambda

    # Leader has strong upward returns recently
    leader = [0.001] * 30 + [0.008, 0.009, 0.010]
    follower = [0.001] * 30 + [0.002, 0.003, 0.003]

    dec = engine.evaluate_momentum_opportunity(
        target_asset="ETHUSDT",
        leader_returns=leader,
        follower_returns=follower,
        order_flow_ticks=ticks,
        target_shares=10.0,  # small size
        current_price=3000.0,
    )

    assert dec.recommendation == MomentumTradeState.EXECUTE_MOMENTUM_LONG
    assert dec.expected_alpha_usd > dec.expected_impact_usd
    assert dec.net_edge_usd > 0.0


def test_throttle_impact_excess():
    engine = MomentumKyleLambdaCalibrationEngine()
    # High Kyle's lambda market (illiquid)
    ticks = generate_order_flow_ticks(n=60, true_lambda=0.005)

    leader = [0.001] * 30 + [0.003, 0.004, 0.004]
    follower = [0.001] * 30 + [0.001, 0.001, 0.002]

    # Large trade size: 5,000 shares at $100 -> impact = lambda * shares^2 = 0.005 * 25M = $125,000!
    dec = engine.evaluate_momentum_opportunity(
        target_asset="ILLIQUID_TOKEN",
        leader_returns=leader,
        follower_returns=follower,
        order_flow_ticks=ticks,
        target_shares=5000.0,
        current_price=100.0,
    )

    assert dec.recommendation == MomentumTradeState.THROTTLE_IMPACT_EXCESS
    assert dec.expected_impact_usd > abs(dec.expected_alpha_usd)
    assert dec.net_edge_usd <= 0.0


def test_neutral_hold_weak_signal():
    engine = MomentumKyleLambdaCalibrationEngine()
    ticks = generate_order_flow_ticks(n=60, true_lambda=0.0001)

    # Flat returns
    leader = [0.0001] * 40
    follower = [0.0001] * 40

    dec = engine.evaluate_momentum_opportunity(
        target_asset="FLAT_ASSET",
        leader_returns=leader,
        follower_returns=follower,
        order_flow_ticks=ticks,
        target_shares=100.0,
        current_price=50.0,
    )

    assert dec.recommendation == MomentumTradeState.NEUTRAL_HOLD
