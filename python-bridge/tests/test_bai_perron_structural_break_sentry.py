"""
Unit Test Suite for Domain 276: Cross-Asset Structural Breakpoint Bai-Perron Multiple Shift Sentry
"""

import math
import pytest
from services.bai_perron_structural_break_sentry import (
    BaiPerronStructuralBreakSentry,
    BaiPerronConfig,
    StructuralBreakRegime,
    BreakRiskDirective,
)


@pytest.fixture
def sentry():
    config = BaiPerronConfig(
        max_breaks=2,
        trimming_ratio=0.15,
        min_segment_length=6,
        f_crit_threshold=7.0,
        bic_penalty_weight=1.0,
        emergency_leverage_cap=0.30,
    )
    return BaiPerronStructuralBreakSentry(config=config)


def test_homogeneous_series_no_break(sentry):
    # Homogeneous series around mean 20.0 with small noise
    y = [20.0 + 0.1 * math.sin(i * 0.5) for i in range(50)]
    res = sentry.evaluate_series("BTC-VOL", y)

    assert res.optimal_breaks_count == 0
    assert len(res.break_indices) == 0
    assert res.regime == StructuralBreakRegime.HOMOGENEOUS_STABLE
    assert res.directive == BreakRiskDirective.FULL_OPERATIONS_MAINTAIN_LEVERAGE
    assert res.recommended_leverage == 1.0
    assert len(res.segments) == 1
    assert pytest.approx(res.segments[0].mean_y, abs=0.2) == 20.0


def test_single_structural_mean_shift_fresh(sentry):
    # Segment 1: 35 bars at mean 10.0
    # Segment 2: 10 bars at mean 80.0 (fresh sudden structural shift, 10 bars <= 2*h)
    seg1 = [10.0 + 0.05 * (i % 3) for i in range(35)]
    seg2 = [80.0 + 0.05 * (i % 3) for i in range(10)]
    y = seg1 + seg2

    res = sentry.evaluate_series("ETH-SPREAD", y)

    assert res.optimal_breaks_count >= 1
    assert res.regime == StructuralBreakRegime.CRITICAL_STRUCTURAL_SHIFT
    assert res.directive == BreakRiskDirective.EMERGENCY_DELEVERAGE_AND_FLUSH
    assert res.recommended_leverage == 0.30
    assert res.bars_since_last_break is not None
    assert res.bars_since_last_break <= 2 * max(6, int(math.floor(0.15 * len(y))))
    # Break index should be close to bar 34
    assert 32 <= res.break_indices[-1] <= 36


def test_single_structural_mean_shift_stabilized(sentry):
    # Segment 1: 15 bars at mean 15.0
    # Segment 2: 45 bars at mean 60.0 (stabilized regime, 45 bars > 2*h)
    seg1 = [15.0 + 0.1 * (i % 2) for i in range(15)]
    seg2 = [60.0 + 0.1 * (i % 2) for i in range(45)]
    y = seg1 + seg2

    res = sentry.evaluate_series("SOL-PREMIUM", y)

    assert res.optimal_breaks_count >= 1
    assert res.regime == StructuralBreakRegime.REGIME_STABILIZING
    assert res.directive == BreakRiskDirective.RECALIBRATE_REGIME_PRIORS
    assert res.recommended_leverage == 0.80
    assert res.bars_since_last_break is not None
    assert res.bars_since_last_break > 20


def test_bivariate_pairs_hedge_ratio_break(sentry):
    # Bivariate model: y_t = alpha + beta * x_t + eps_t
    # Segment 1: 25 bars with beta ~ 2.0
    # Segment 2: 25 bars with beta ~ -1.5
    x = [float(i) for i in range(50)]
    y = []
    for i in range(25):
        y.append(2.0 * x[i] + 0.1 * (i % 2))
    for i in range(25, 50):
        y.append(-1.5 * x[i] + 0.1 * (i % 2))

    res = sentry.evaluate_series("BTC-ETH-PAIR", y, x=x)

    assert res.optimal_breaks_count >= 1
    assert len(res.segments) >= 2
    # Verify slopes in the two distinct regimes
    assert res.segments[0].slope_beta is not None
    assert pytest.approx(res.segments[0].slope_beta, abs=0.2) == 2.0
    assert res.segments[-1].slope_beta is not None
    assert pytest.approx(res.segments[-1].slope_beta, abs=0.2) == -1.5


def test_short_series_graceful_handling(sentry):
    # Series with fewer than 2*h samples
    y = [10.0, 11.0, 10.5, 9.8, 10.2]
    res = sentry.evaluate_series("MICRO-ASSET", y)

    assert res.optimal_breaks_count == 0
    assert res.regime == StructuralBreakRegime.HOMOGENEOUS_STABLE
    assert res.recommended_leverage == 1.0
    assert len(res.segments) == 1
    assert "below minimal" in res.rationales[0]
