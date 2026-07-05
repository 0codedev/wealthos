"""
Unit Test Suite for Domain 245: Intraday Realized Co-Skewness Tensor & Cross-Asset Asymmetric Jump Engine
"""

import pytest
import math
from services.realized_coskewness_jump_engine import (
    RealizedCoSkewnessJumpEngine,
    AssetIntradayReturns,
    CoSkewnessRegimeState,
    CoSkewnessHedgeDirective,
)


@pytest.fixture
def engine():
    return RealizedCoSkewnessJumpEngine(
        vulnerability_threshold=-0.50,
        safe_haven_threshold=0.40,
        jump_significance_z=2.50,
        contagion_panic_threshold=0.45,
    )


def test_bipower_jump_decomposition(engine):
    # Pure small diffusion steps + one huge negative jump
    r = [0.001, -0.001, 0.0015, -0.0008, 0.0005, -0.001, 0.0012, -0.001, 0.0009] * 5
    # Insert a 4% flash crash jump at index 20
    r[20] = -0.040

    asset = AssetIntradayReturns("BTC", r)
    metrics = engine.decompose_jumps(asset)

    assert metrics.total_realized_var > metrics.bipower_var
    assert metrics.jump_var > 0.0
    assert metrics.jump_fraction > 0.30
    assert metrics.negative_jump_var > metrics.positive_jump_var
    assert metrics.jump_skew < 0.0


def test_pairwise_coskewness_vulnerable(engine):
    # Benchmark experiences high volatility on certain ticks
    # Target asset drops sharply precisely when benchmark volatility is high
    n = 50
    r_m = [0.001 * (-1)**i for i in range(n)]
    r_i = [0.001 * (-1)**(i+1) for i in range(n)]

    # Make ticks 10, 20, 30 volatile on benchmark: r_m = +0.02, -0.02, +0.025
    # Target drops on all these volatile ticks: r_i = -0.03, -0.035, -0.04
    for idx, bench_ret in [(10, 0.02), (20, -0.02), (30, 0.025)]:
        r_m[idx] = bench_ret
        r_i[idx] = -0.035

    asset_target = AssetIntradayReturns("HIGH_BETA_TECH", r_i)
    asset_bench = AssetIntradayReturns("SPY", r_m)

    pair = engine.compute_pairwise_coskewness(asset_target, asset_bench)
    assert pair.coskewness_value <= engine.vulnerability_threshold
    assert pair.is_vulnerable_to_benchmark
    assert not pair.is_safe_haven


def test_pairwise_coskewness_safe_haven(engine):
    # Safe haven rises whenever benchmark volatility is high
    n = 50
    r_m = [0.001 * (-1)**i for i in range(n)]
    r_gold = [0.0005 * (-1)**i for i in range(n)]

    for idx, bench_ret in [(10, 0.02), (20, -0.02), (30, 0.025)]:
        r_m[idx] = bench_ret
        r_gold[idx] = +0.025  # Flight to safety positive surge

    asset_gold = AssetIntradayReturns("GOLD", r_gold)
    asset_bench = AssetIntradayReturns("SPY", r_m)

    pair = engine.compute_pairwise_coskewness(asset_gold, asset_bench)
    assert pair.coskewness_value >= engine.safe_haven_threshold
    assert pair.is_safe_haven
    assert not pair.is_vulnerable_to_benchmark


def test_systemic_crash_contagion(engine):
    n = 50
    r_m = [0.001 * (-1)**i for i in range(n)]
    r_1 = [0.001 for _ in range(n)]
    r_2 = [0.001 for _ in range(n)]

    # Benchmark crashes on ticks 15, 25:
    for idx in [15, 25]:
        r_m[idx] = -0.03
        r_1[idx] = -0.04
        r_2[idx] = -0.045

    b = AssetIntradayReturns("MARKET", r_m)
    c1 = AssetIntradayReturns("STOCK_A", r_1)
    c2 = AssetIntradayReturns("STOCK_B", r_2)

    assessment = engine.evaluate_portfolio([c1, c2], b)
    assert assessment.regime == CoSkewnessRegimeState.ASYMMETRIC_CRASH_CONTAGION
    assert assessment.directive == CoSkewnessHedgeDirective.DEPLOY_DYNAMIC_PUT_HEDGE
    assert assessment.recommended_put_hedge_ratio > 0.0
    assert len(assessment.vulnerable_assets) >= 2


def test_balanced_diffusive_regime(engine):
    # Pure symmetric noise
    r_m = [0.001 * (-1)**i for i in range(60)]
    r_1 = [0.001 * (-1)**(i+1) for i in range(60)]
    r_2 = [0.0008 * (-1)**i for i in range(60)]

    b = AssetIntradayReturns("MARKET", r_m)
    c1 = AssetIntradayReturns("STOCK_A", r_1)
    c2 = AssetIntradayReturns("STOCK_B", r_2)

    assessment = engine.evaluate_portfolio([c1, c2], b)
    assert assessment.regime == CoSkewnessRegimeState.BALANCED_DIFFUSIVE_REGIME
    assert assessment.directive == CoSkewnessHedgeDirective.MAINTAIN_UNHEDGED_EXPOSURE
    assert assessment.recommended_put_hedge_ratio == 0.0
