"""
Unit Test Suite for Domain 244: Cross-Asset Implied Correlation Term-Structure & Volatility Index Basis Engine
"""

import pytest
import math
from services.implied_correlation_term_structure_engine import (
    ImpliedCorrelationTermStructureEngine,
    TenorConstituentVols,
    CorrelationRegimeState,
    CorrelationExecutionDirective,
)


@pytest.fixture
def engine():
    return ImpliedCorrelationTermStructureEngine(
        systemic_crash_threshold=0.80,
        rich_crp_threshold=0.18,
        tranquil_corr_threshold=0.38,
        inverted_slope_threshold=-0.35,
    )


def test_analytical_equicorrelation_bounds(engine):
    # 4 constituents, each with 25% weight and 20% IV
    # Perfect co-movement (rho=1.0) => Index IV = 20%
    data_perf = TenorConstituentVols(
        tenor_years=0.25,
        index_iv=0.20,
        constituent_weights=[0.25, 0.25, 0.25, 0.25],
        constituent_ivs=[0.20, 0.20, 0.20, 0.20],
        realized_corr=0.40,
    )
    res_perf = engine.compute_tenor_implied_correlation(data_perf)
    assert pytest.approx(res_perf.implied_corr, abs=1e-3) == 1.00
    assert not res_perf.is_arbitrage_breach

    # Zero correlation (rho=0.0) => Index Var = sum(w_i^2 * 0.20^2) = 4 * 0.0625 * 0.04 = 0.01 => Index IV = 0.10 (10%)
    data_zero = TenorConstituentVols(
        tenor_years=0.25,
        index_iv=0.10,
        constituent_weights=[0.25, 0.25, 0.25, 0.25],
        constituent_ivs=[0.20, 0.20, 0.20, 0.20],
        realized_corr=0.10,
    )
    res_zero = engine.compute_tenor_implied_correlation(data_zero)
    assert pytest.approx(res_zero.implied_corr, abs=1e-3) == 0.00
    assert not res_zero.is_arbitrage_breach


def test_tranquil_idiosyncratic_regime(engine):
    # Implied correlation around 20-28% (floor is sqrt(0.02) ~ 14.14%)
    curve = [
        TenorConstituentVols(0.25, 0.155, [0.5, 0.5], [0.20, 0.20], realized_corr=0.20),
        TenorConstituentVols(0.50, 0.160, [0.5, 0.5], [0.20, 0.20], realized_corr=0.20),
    ]
    assessment = engine.evaluate_term_structure(curve)
    assert assessment.regime == CorrelationRegimeState.IDIOSYNCRATIC_ALPHA_TRANQUIL
    assert assessment.directive == CorrelationExecutionDirective.ALLOCATE_IDIOSYNCRATIC_MOMENTUM
    assert assessment.dispersion_hedge_ratio == 0.0


def test_systemic_crash_panic(engine):
    # Front tenor implied correlation elevated (e.g. index vol is 19.5% vs constituents 20% -> rho ~ 93%)
    # Inverted term structure: near rho=0.93, far rho=0.50
    curve = [
        TenorConstituentVols(0.083, 0.195, [0.5, 0.5], [0.20, 0.20], realized_corr=0.40),
        TenorConstituentVols(0.500, 0.150, [0.5, 0.5], [0.20, 0.20], realized_corr=0.40),
    ]
    assessment = engine.evaluate_term_structure(curve)
    assert assessment.regime == CorrelationRegimeState.SYSTEMIC_CORRELATION_CRASH_PANIC
    assert assessment.directive == CorrelationExecutionDirective.DEPLOY_SYSTEMIC_MACRO_COLLAR
    assert assessment.tenor_results[0].implied_corr >= engine.systemic_crash_threshold


def test_dispersion_harvest(engine):
    # Implied correlation = ~60%, realized correlation = 25% => CRP = +35% (> 18% threshold)
    # Index IV = 16.5% for two 20% vol stocks => var = 0.0272, rho = (0.0272 - 0.02) / (0.04 - 0.02) = 0.0072/0.02 = 0.36
    # For rho ~ 0.65: index var = 0.02 + 0.65 * 0.02 = 0.033 => index vol ~ 18.2%
    curve = [
        TenorConstituentVols(0.25, 0.182, [0.5, 0.5], [0.20, 0.20], realized_corr=0.20),
        TenorConstituentVols(0.50, 0.185, [0.5, 0.5], [0.20, 0.20], realized_corr=0.20),
    ]
    assessment = engine.evaluate_term_structure(curve)
    assert assessment.regime == CorrelationRegimeState.CORRELATION_DISPERSION_HARVEST
    assert assessment.directive == CorrelationExecutionDirective.HARVEST_CORRELATION_DISPERSION
    assert assessment.average_crp >= engine.rich_crp_threshold
    assert assessment.dispersion_hedge_ratio >= 0.40


def test_arbitrage_boundary_breach(engine):
    # Index IV = 0.25 when constituents are only 0.20!
    # Max possible index IV is 0.20 (when rho=1.0)
    curve = [
        TenorConstituentVols(0.25, 0.25, [0.5, 0.5], [0.20, 0.20], realized_corr=0.30),
    ]
    assessment = engine.evaluate_term_structure(curve)
    assert assessment.regime == CorrelationRegimeState.ARBITRAGE_CORRELATION_BOUNDARY
    assert assessment.directive == CorrelationExecutionDirective.EXECUTE_INDEX_BASIS_ARBITRAGE
    assert assessment.tenor_results[0].is_arbitrage_breach
