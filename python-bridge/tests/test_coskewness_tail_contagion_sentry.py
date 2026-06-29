"""
Unit Tests for Cross-Asset Order Flow Co-Skewness & Tail Risk Contagion Sentry
Domain 234 / Work Package WP-EF
"""

import pytest
import math
import random
from services.coskewness_tail_contagion_sentry import (
    CoSkewnessTailContagionSentry,
    ContagionRegimeState,
)


def generate_market_and_crash_assets(n_samples: int = 100, seed: int = 42):
    random.seed(seed)
    market = [random.gauss(0.0, 0.015) for _ in range(n_samples)]

    # Symmetric asset: linear relation + independent noise
    symmetric_asset = [0.8 * m + random.gauss(0.0, 0.005) for m in market]

    # Crash-prone asset: whenever market has high volatility (m^2 is large), this asset crashes severely
    crash_asset = []
    for m in market:
        base = 0.5 * m
        # Non-linear quadratic negative penalty
        crash_penalty = -50.0 * (m ** 2) if abs(m) > 0.015 else 0.0
        crash_asset.append(base + crash_penalty + random.gauss(0.0, 0.002))

    return market, symmetric_asset, crash_asset


def test_coskewness_calculation():
    sentry = CoSkewnessTailContagionSentry()
    market, symmetric, crash = generate_market_and_crash_assets(n_samples=150)

    # Symmetric asset should have near-zero coskewness
    cs_sym = sentry.compute_coskewness(symmetric, market)
    assert abs(cs_sym) < 0.50

    # Crash-prone asset should have deeply negative coskewness
    cs_crash = sentry.compute_coskewness(crash, market)
    assert cs_crash < -0.60


def test_systemic_contagion_regime():
    sentry = CoSkewnessTailContagionSentry(contagion_threshold=0.35)
    random.seed(1)
    market = [random.gauss(0.0, 0.015) for _ in range(120)]

    def make_crash(seed):
        random.seed(seed)
        return [0.5 * m + (-50.0 * (m ** 2) if abs(m) > 0.015 else 0.0) + random.gauss(0.0, 0.002) for m in market]

    portfolio = {
        "CRASH_TOKEN_1": make_crash(10),
        "CRASH_TOKEN_2": make_crash(20),
        "CRASH_TOKEN_3": make_crash(30),
    }

    assessment = sentry.evaluate_portfolio_contagion(portfolio, market)

    assert assessment.regime == ContagionRegimeState.SYSTEMIC_ASYMMETRIC_CONTAGION
    assert assessment.systemic_contagion_index >= 0.35
    assert len(assessment.vulnerable_assets) == 3
    assert assessment.recommended_hedge_ratio >= 0.25
    assert "SYSTEMIC_CONTAGION_CRITICAL" in assessment.recommended_action


def test_isolated_skew_regime():
    sentry = CoSkewnessTailContagionSentry()
    random.seed(10)
    market = [random.gauss(0.0, 0.015) for _ in range(120)]

    sym1 = [0.8 * m + random.gauss(0.0, 0.005) for m in market]
    sym2 = [1.1 * m + random.gauss(0.0, 0.005) for m in market]
    sym3 = [0.9 * m + random.gauss(0.0, 0.005) for m in market]
    crash = [0.5 * m + (-50.0 * (m ** 2) if abs(m) > 0.015 else 0.0) + random.gauss(0.0, 0.002) for m in market]

    portfolio = {
        "SAFE_1": sym1,
        "SAFE_2": sym2,
        "SAFE_3": sym3,
        "TOXIC_1": crash,
    }

    assessment = sentry.evaluate_portfolio_contagion(portfolio, market)

    assert assessment.regime == ContagionRegimeState.ISOLATED_IDIOSYNCRATIC_SKEW
    assert assessment.vulnerable_assets == ["TOXIC_1"]
    assert "ISOLATED_SKEW" in assessment.recommended_action


def test_symmetric_stable_regime():
    sentry = CoSkewnessTailContagionSentry()
    random.seed(99)
    market = [random.gauss(0.0, 0.015) for _ in range(120)]
    sym1 = [0.8 * m + random.gauss(0.0, 0.005) for m in market]
    sym2 = [1.2 * m + random.gauss(0.0, 0.005) for m in market]

    portfolio = {
        "BALANCED_1": sym1,
        "BALANCED_2": sym2,
    }

    assessment = sentry.evaluate_portfolio_contagion(portfolio, market)

    assert assessment.regime == ContagionRegimeState.SYMMETRIC_DIFFUSION_STABLE
    assert len(assessment.vulnerable_assets) == 0
    assert assessment.recommended_hedge_ratio == 0.0
