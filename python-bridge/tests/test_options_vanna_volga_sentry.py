"""
Unit tests for Domain 275 / WP-FU: Options Vanna-Volga Pricing & Tail Risk Sentry
"""

import pytest
from services.options_vanna_volga_sentry import (
    OptionsVannaVolgaSentry,
    LiquidBenchmarkQuotes,
    VannaVolgaRegime,
    VannaVolgaDirective,
)


@pytest.fixture
def sentry():
    return OptionsVannaVolgaSentry(
        overpricing_hurdle_pts=3.0,
        underpricing_hurdle_pts=-2.5,
    )


@pytest.fixture
def benchmarks():
    return LiquidBenchmarkQuotes(
        spot=100.0,
        atm_strike=100.0,
        atm_vol_pct=20.0,
        put_25d_strike=85.0,
        put_25d_vol_pct=24.0,  # Put skew
        call_25d_strike=115.0,
        call_25d_vol_pct=18.0, # Call skew
    )


def test_vv_weights_boundary_conditions(sentry, benchmarks):
    # At ATM strike: w_atm=1, w_p=0, w_c=0
    w_p, w_atm, w_c = sentry.calculate_vv_weights(
        benchmarks.atm_strike,
        benchmarks.put_25d_strike,
        benchmarks.atm_strike,
        benchmarks.call_25d_strike,
    )
    assert abs(w_atm - 1.0) < 1e-6
    assert abs(w_p) < 1e-6
    assert abs(w_c) < 1e-6

    # At 25D put strike: w_p=1, w_atm=0, w_c=0
    w_p2, w_atm2, w_c2 = sentry.calculate_vv_weights(
        benchmarks.put_25d_strike,
        benchmarks.put_25d_strike,
        benchmarks.atm_strike,
        benchmarks.call_25d_strike,
    )
    assert abs(w_p2 - 1.0) < 1e-6
    assert abs(w_atm2) < 1e-6
    assert abs(w_c2) < 1e-6


def test_vanna_volga_equilibrium(sentry, benchmarks):
    # Deep wing strike K = 80.0
    theo = sentry.calculate_theoretical_vol(80.0, benchmarks)
    res = sentry.evaluate_wing("SPY", target_strike=80.0, market_quoted_iv_pct=theo, benchmarks=benchmarks)
    assert res.regime == VannaVolgaRegime.VANNA_VOLGA_EQUILIBRIUM
    assert res.directive == VannaVolgaDirective.MAINTAIN_CURRENT_QUOTES
    assert res.iv_dislocation_pts == 0.0


def test_overpriced_wing_volga_arbitrage(sentry, benchmarks):
    # Deep wing strike K = 75.0, theoretical approx 26.5%, market is blown out at 32.0%
    theo = sentry.calculate_theoretical_vol(75.0, benchmarks)
    res = sentry.evaluate_wing("BTC", target_strike=75.0, market_quoted_iv_pct=theo + 5.0, benchmarks=benchmarks)
    assert res.regime == VannaVolgaRegime.OVERPRICED_WING_VOLGA_ARBITRAGE
    assert res.directive == VannaVolgaDirective.DEPLOY_SHORT_WING_VANNA_HEDGE
    assert res.iv_dislocation_pts >= 3.0


def test_underpriced_wing_crash_barrier(sentry, benchmarks):
    # Deep wing strike K = 75.0, market is dumped to theo - 4.0%
    theo = sentry.calculate_theoretical_vol(75.0, benchmarks)
    res = sentry.evaluate_wing("ETH", target_strike=75.0, market_quoted_iv_pct=theo - 4.0, benchmarks=benchmarks)
    assert res.regime == VannaVolgaRegime.UNDERPRICED_WING_CRASH_BARRIER
    assert res.directive == VannaVolgaDirective.ACQUIRE_UNDERPRICED_TAIL_CONVEXITY
    assert res.iv_dislocation_pts <= -2.5
