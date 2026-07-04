"""
Unit Test Suite for Domain 278: Cross-Asset Options Volatility Surface Term-Structure Level, Slope, Curvature Nelson-Siegel Kernel
"""

import pytest
from services.options_nelson_siegel_kernel import (
    OptionsNelsonSiegelKernel,
    NelsonSiegelConfig,
    TenorQuote,
    VolTermStructureRegime,
    CalendarArbitrageDirective,
)


@pytest.fixture
def kernel():
    config = NelsonSiegelConfig(
        decay_lambda=8.0,
        ridge_regularizer=1e-3,
        inversion_threshold=0.08,
        contango_threshold=-0.08,
        curvature_threshold=0.20,
    )
    return OptionsNelsonSiegelKernel(config=config)


def test_factor_loadings_properties(kernel):
    # At tau close to 0: f1=1, f2 close to 1, f3 close to 0
    f1_0, f2_0, f3_0 = kernel.compute_factor_loadings(0.001)
    assert f1_0 == 1.0
    assert pytest.approx(f2_0, abs=0.02) == 1.0
    assert pytest.approx(f3_0, abs=0.02) == 0.0

    # At large tau (e.g. 5.0 years): f2 and f3 decay towards 0
    f1_inf, f2_inf, f3_inf = kernel.compute_factor_loadings(5.0)
    assert f1_inf == 1.0
    assert f2_inf < 0.05
    assert f3_inf < 0.05

    # Intermediate tau has peak curvature around 90 days (0.247 yr)
    _, _, f3_mid = kernel.compute_factor_loadings(0.247)
    assert f3_mid > 0.20


def test_normal_equilibrium_term_structure(kernel):
    # Gentle upward slope: 7d=0.30, 30d=0.31, 90d=0.32, 180d=0.33, 360d=0.34
    quotes = [
        TenorQuote(tenor_years=7/365, implied_vol=0.30),
        TenorQuote(tenor_years=30/365, implied_vol=0.31),
        TenorQuote(tenor_years=90/365, implied_vol=0.32),
        TenorQuote(tenor_years=180/365, implied_vol=0.33),
        TenorQuote(tenor_years=360/365, implied_vol=0.34),
    ]

    res = kernel.evaluate_surface_term_structure("BTC-OPT", quotes)

    assert res.regime == VolTermStructureRegime.NORMAL_EQUILIBRIUM
    assert res.directive == CalendarArbitrageDirective.MAINTAIN_STANDARD_HEDGE
    assert res.recommended_calendar_spread == "NO_CALENDAR_SKEW_REQUIRED"
    assert res.rmse < 0.02


def test_severe_inversion_panic(kernel):
    # Extreme panic inversion: front vol exploded (7d=0.75, 30d=0.55, 90d=0.45, 180d=0.38, 360d=0.35)
    quotes = [
        TenorQuote(tenor_years=7/365, implied_vol=0.75),
        TenorQuote(tenor_years=30/365, implied_vol=0.55),
        TenorQuote(tenor_years=90/365, implied_vol=0.45),
        TenorQuote(tenor_years=180/365, implied_vol=0.38),
        TenorQuote(tenor_years=360/365, implied_vol=0.35),
    ]

    res = kernel.evaluate_surface_term_structure("ETH-OPT", quotes)

    assert res.regime == VolTermStructureRegime.SEVERE_INVERSION_PANIC
    assert res.directive == CalendarArbitrageDirective.HARVEST_CALENDAR_ROLL_SHORT_FRONT
    assert res.beta_slope >= 0.08
    assert "SHORT_T1_LONG_T3_CALENDAR" in res.recommended_calendar_spread


def test_steep_contango_expansion(kernel):
    # Steep contango: front vol compressed, back-end elevated (7d=0.20, 30d=0.24, 90d=0.32, 180d=0.40, 360d=0.45)
    quotes = [
        TenorQuote(tenor_years=7/365, implied_vol=0.20),
        TenorQuote(tenor_years=30/365, implied_vol=0.24),
        TenorQuote(tenor_years=90/365, implied_vol=0.32),
        TenorQuote(tenor_years=180/365, implied_vol=0.40),
        TenorQuote(tenor_years=360/365, implied_vol=0.45),
    ]

    res = kernel.evaluate_surface_term_structure("SOL-OPT", quotes)

    assert res.regime == VolTermStructureRegime.STEEP_CONTANGO_EXPANSION
    assert res.directive == CalendarArbitrageDirective.BUY_CHEAP_FRONT_GAMMA
    assert res.beta_slope <= -0.08
    assert "LONG_T1_SHORT_T3_CALENDAR" in res.recommended_calendar_spread


def test_belly_curvature_arbitrage(kernel):
    # Hump in intermediate belly (90d and 180d spiked due to expected event)
    # 7d=0.30, 30d=0.32, 90d=0.52, 180d=0.48, 360d=0.31
    quotes = [
        TenorQuote(tenor_years=7/365, implied_vol=0.30),
        TenorQuote(tenor_years=30/365, implied_vol=0.32),
        TenorQuote(tenor_years=90/365, implied_vol=0.52),
        TenorQuote(tenor_years=180/365, implied_vol=0.48),
        TenorQuote(tenor_years=360/365, implied_vol=0.31),
    ]

    res = kernel.evaluate_surface_term_structure("SPX-OPT", quotes)

    assert res.regime == VolTermStructureRegime.BELLY_CURVATURE_ARBITRAGE
    assert res.directive == CalendarArbitrageDirective.DEPLOY_CALENDAR_BUTTERFLY_ARB
    assert abs(res.beta_curvature) >= 0.20
    assert "CALENDAR_BUTTERFLY" in res.recommended_calendar_spread
