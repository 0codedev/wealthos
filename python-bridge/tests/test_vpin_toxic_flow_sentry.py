"""
Unit Test Suite for Domain 261: Intraday Volume Synchronized Probability of Toxicity (VPIN) & High-Frequency Toxic Flow Sentry
"""

import pytest
from services.vpin_toxic_flow_sentry import (
    VPINToxicFlowSentry,
    VolumeBucketState,
    VPINToxicityRegime,
    ToxicityDefenseDirective,
)


@pytest.fixture
def sentry():
    return VPINToxicFlowSentry(
        num_buckets=20,
        critical_vpin_threshold=0.60,
        warning_vpin_threshold=0.30,
        critical_cdf_threshold=0.90,
    )


def test_nominal_balanced_flow(sentry):
    # 20 volume buckets of 10,000 shares each, perfectly balanced (5,000 buy, 5,000 sell)
    buckets = [
        VolumeBucketState(i, 10_000.0, 5000.0, 5000.0)
        for i in range(20)
    ]
    res = sentry.evaluate_flow("SPY", buckets)
    assert res.current_vpin == 0.0
    assert res.regime == VPINToxicityRegime.NOMINAL_BALANCED_FLOW
    assert res.directive == ToxicityDefenseDirective.MAINTAIN_STANDARD_MAKING
    assert res.recommended_spread_multiplier == 1.0


def test_elevated_informed_flow(sentry):
    # 20 volume buckets with 7,000 buy and 3,000 sell -> |7000 - 3000| / 10000 = 0.40 VPIN
    buckets = [
        VolumeBucketState(i, 10_000.0, 7000.0, 3000.0)
        for i in range(20)
    ]
    res = sentry.evaluate_flow("AAPL", buckets)
    assert res.current_vpin == pytest.approx(0.40, abs=1e-3)
    assert res.regime == VPINToxicityRegime.ELEVATED_INFORMED_FLOW
    assert res.directive == ToxicityDefenseDirective.WIDEN_TOXICITY_SPREAD_BUFFER
    assert res.recommended_spread_multiplier > 1.2


def test_toxic_tsunami_evacuation(sentry):
    # 20 volume buckets with 9,000 buy and 1,000 sell -> VPIN = 0.80 >= 0.60
    buckets = [
        VolumeBucketState(i, 10_000.0, 9000.0, 1000.0)
        for i in range(20)
    ]
    res = sentry.evaluate_flow("BTC-USDT", buckets)
    assert res.current_vpin == pytest.approx(0.80, abs=1e-3)
    assert res.regime == VPINToxicityRegime.TOXIC_TSUNAMI_CIRCUIT_EVACUATION
    assert res.directive == ToxicityDefenseDirective.EVACUATE_RESTING_MAKER_QUOTES
    assert res.recommended_spread_multiplier >= 4.0


def test_asymmetric_directional_drain(sentry):
    # Most buckets balanced, but the most recent bucket is 9,500 sell vs 500 buy (90% unilateral dump)
    buckets = [
        VolumeBucketState(i, 10_000.0, 5200.0, 4800.0)
        for i in range(19)
    ]
    # Recent bucket sudden sweep
    buckets.append(VolumeBucketState(19, 10_000.0, 500.0, 9500.0))

    res = sentry.evaluate_flow("ETH-USDT", buckets)
    assert res.regime == VPINToxicityRegime.ASYMMETRIC_DIRECTIONAL_DRAIN
    assert res.directive == ToxicityDefenseDirective.SHADE_ONE_SIDED_OFFLOAD
    assert res.dominant_direction == "SELL_PRESSURE"


def test_empty_buckets(sentry):
    res = sentry.evaluate_flow("EMPTY", [])
    assert res.current_vpin == 0.0
    assert res.regime == VPINToxicityRegime.NOMINAL_BALANCED_FLOW
    assert res.directive == ToxicityDefenseDirective.MAINTAIN_STANDARD_MAKING
