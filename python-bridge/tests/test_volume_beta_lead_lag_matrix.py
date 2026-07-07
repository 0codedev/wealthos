"""
Unit Test Suite for Domain 246: Intraday Volume Profile Beta & Continuous Multi-Factor Lead-Lag Matrix
"""

import pytest
import math
from services.volume_beta_lead_lag_matrix import (
    VolumeBetaLeadLagMatrix,
    AssetSeries,
    LeadLagRegimeState,
    LeadLagExecutionDirective,
)


@pytest.fixture
def engine():
    return VolumeBetaLeadLagMatrix(
        max_lag_steps=5,
        min_peak_corr_threshold=0.40,
        min_executable_edge_bps=1.50,
        friction_cost_bps=2.00,
    )


def test_lagged_cross_correlation_synthetic(engine):
    # Base random returns
    base = [0.002, -0.001, 0.003, -0.002, 0.0015, -0.001, 0.004, -0.003, 0.0025, -0.002] * 4
    # r2 is r1 delayed by exactly 2 steps: r2[t] = r1[t - 2]
    r1 = base
    r2 = [0.0, 0.0] + base[:-2]

    a1 = AssetSeries("BTC", r1)
    a2 = AssetSeries("ETH", r2)

    pair = engine.analyze_pair(a1, a2)
    assert pair.leader == "BTC"
    assert pair.follower == "ETH"
    assert pair.optimal_lag_steps == 2
    assert pair.peak_correlation >= 0.90


def test_strong_predictive_lead_lag(engine):
    # BTC leads SOL by 1 step
    base = [0.002, -0.001, 0.003, -0.002, 0.0015, -0.001, 0.004, -0.003] * 5
    r_btc = base
    r_sol = [0.0] + base[:-1]

    a_btc = AssetSeries("BTC", r_btc, volume_ratio=1.5)
    a_sol = AssetSeries("SOL", r_sol, volume_ratio=1.0)

    # BTC experiences +10 bps shock
    res = engine.evaluate_universe(
        [a_btc, a_sol],
        recent_shocks={"BTC": 10.0},
    )

    assert res.regime == LeadLagRegimeState.STRONG_PREDICTIVE_LEAD_LAG
    assert res.directive == LeadLagExecutionDirective.EXECUTE_PREDICTIVE_LEAD_LAG_SWEEP
    assert res.dominant_anchor == "BTC"
    assert res.best_trade is not None
    assert res.best_trade.leader == "BTC"
    assert res.best_trade.follower == "SOL"
    assert res.best_trade.executable_edge_bps >= engine.min_executable_edge_bps


def test_synchronous_equilibrium(engine):
    base = [0.002, -0.001, 0.003, -0.002, 0.0015, -0.001, 0.004] * 5
    a1 = AssetSeries("SPY", base)
    a2 = AssetSeries("QQQ", base)

    res = engine.evaluate_universe([a1, a2])
    assert res.regime == LeadLagRegimeState.SYNCHRONOUS_EQUILIBRIUM
    assert res.directive == LeadLagExecutionDirective.HOLD_COMOVING_NEUTRAL
    assert res.best_trade is None


def test_volume_burst_lead_flip(engine):
    # Normal series
    base = [0.002, -0.001, 0.003, -0.002, 0.0015, -0.001, 0.004] * 5
    a1 = AssetSeries("LEADER_OLD", base)
    # a2 has huge volume surge (4x) while having negative lead score
    a2 = AssetSeries("FOLLOWER_SURGING", [0.0] + base[:-1], volume_ratio=4.0)

    res = engine.evaluate_universe([a1, a2])
    assert res.regime == LeadLagRegimeState.VOLUME_BURST_LEAD_FLIP
    assert res.directive == LeadLagExecutionDirective.RECALIBRATE_LEAD_ANCHOR


def test_uncorrelated_diffusion(engine):
    # Two independent orthogonal step sequences
    r1 = [0.002 if i % 2 == 0 else -0.002 for i in range(50)]
    r2 = [0.002 if i % 3 == 0 else -0.001 for i in range(50)]

    a1 = AssetSeries("ASSET_A", r1)
    a2 = AssetSeries("ASSET_B", r2)

    res = engine.evaluate_universe([a1, a2])
    assert res.regime in [LeadLagRegimeState.UNCORRELATED_DIFFUSION, LeadLagRegimeState.SYNCHRONOUS_EQUILIBRIUM]
    if res.regime == LeadLagRegimeState.UNCORRELATED_DIFFUSION:
        assert res.directive == LeadLagExecutionDirective.DECOUPLE_PAIR_TRADING
