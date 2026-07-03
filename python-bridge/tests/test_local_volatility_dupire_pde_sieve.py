r"""Unit Tests for Real-Time Options Surface Local Volatility Dupire Jump Diffusion Sieve (Domain 217 / WP-DO)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.local_volatility_dupire_pde_sieve import (
    LocalVolatilityDupirePDESieve,
    LocalVolSurfaceRegime,
    VolSurfaceTacticalAction,
)


@pytest.fixture
def sieve() -> LocalVolatilityDupirePDESieve:
    return LocalVolatilityDupirePDESieve(
        risk_free_rate=0.065,
        max_local_vol_multiplier=3.0,
    )


def test_arbitrage_free_atm_point(sieve: LocalVolatilityDupirePDESieve):
    # At ATM (y = 0, dw/dy = 0), w = 0.18^2 * 0.25 = 0.0081
    # dw_dt = 0.18^2 = 0.0324, d2w_dy2 = 0.02
    # D = 1 - 0 + 0 + 0.5 * 0.02 = 1.01
    # Local vol = sqrt(0.0324 / 1.01) ~ 0.179
    res = sieve.evaluate_local_vol_point(
        spot=25000.0,
        strike=25000.0 * math.exp(0.065 * 0.25), # Forward strike (y = 0)
        tau=0.25,
        implied_vol=0.18,
        dw_dt=0.0324,
        dw_dy=0.0,
        d2w_dy2=0.02,
    )

    assert res.regime == LocalVolSurfaceRegime.ARBITRAGE_FREE_STABLE
    assert res.action == VolSurfaceTacticalAction.CALIBRATE_EXOTIC_PDE
    assert pytest.approx(res.local_volatility, 1e-3) == 0.1791
    assert "ready for PDE/Monte Carlo pricing" in res.tactical_directive


def test_calendar_arbitrage_negative_forward_variance(sieve: LocalVolatilityDupirePDESieve):
    # dw_dt < 0 (longer maturity has less total variance than shorter)
    res = sieve.evaluate_local_vol_point(
        spot=25000.0,
        strike=25000.0,
        tau=0.25,
        implied_vol=0.18,
        dw_dt=-0.015, # Negative forward variance!
        dw_dy=0.0,
        d2w_dy2=0.02,
    )

    assert res.regime == LocalVolSurfaceRegime.CALENDAR_ARBITRAGE
    assert res.action == VolSurfaceTacticalAction.EXECUTE_CALENDAR_ARB
    assert res.local_variance == 0.0
    assert "CALENDAR ARBITRAGE" in res.tactical_directive


def test_butterfly_arbitrage_negative_density(sieve: LocalVolatilityDupirePDESieve):
    # Severe negative curvature d2w_dy2 = -2.5 driving D < 0
    res = sieve.evaluate_local_vol_point(
        spot=25000.0,
        strike=25000.0 * math.exp(0.065 * 0.25),
        tau=0.25,
        implied_vol=0.18,
        dw_dt=0.0324,
        dw_dy=0.0,
        d2w_dy2=-2.50, # Extreme concavity violates butterfly convexity
    )

    assert res.regime == LocalVolSurfaceRegime.BUTTERFLY_ARBITRAGE
    assert res.action == VolSurfaceTacticalAction.EXECUTE_BUTTERFLY_ARB
    assert res.density_denominator_d < 0.0
    assert "BUTTERFLY ARBITRAGE" in res.tactical_directive


def test_local_vol_blowout(sieve: LocalVolatilityDupirePDESieve):
    # Denominator D is tiny positive (0.005), blowing up local vol to > 3x implied vol
    res = sieve.evaluate_local_vol_point(
        spot=25000.0,
        strike=25000.0 * math.exp(0.065 * 0.25),
        tau=0.25,
        implied_vol=0.18,
        dw_dt=0.0324,
        dw_dy=0.0,
        d2w_dy2=-1.99, # D = 1.0 - 0.995 = 0.005 -> var = 0.0324 / 0.005 = 6.48 -> vol = 2.54 (>> 3x 0.18)
    )

    assert res.regime == LocalVolSurfaceRegime.LOCAL_VOL_BLOWOUT
    assert res.action == VolSurfaceTacticalAction.CLAMP_AND_REGULARIZE
    assert res.local_volatility > 0.18 * 3.0
    assert "LOCAL VOL BLOWOUT" in res.tactical_directive


def test_skewed_otm_point_stability(sieve: LocalVolatilityDupirePDESieve):
    # Downside put moneyness (y = -0.05), slope dw_dy = -0.04, curvature d2w_dy2 = 0.08
    res = sieve.evaluate_local_vol_point(
        spot=25000.0,
        strike=24000.0,
        tau=0.20,
        implied_vol=0.20,
        dw_dt=0.040,
        dw_dy=-0.04,
        d2w_dy2=0.08,
    )

    assert res.regime == LocalVolSurfaceRegime.ARBITRAGE_FREE_STABLE
    assert res.action == VolSurfaceTacticalAction.CALIBRATE_EXOTIC_PDE
    assert res.density_denominator_d > 0.5
    assert res.local_volatility > 0.0
