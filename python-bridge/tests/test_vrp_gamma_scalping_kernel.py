"""
Unit tests for Domain 268 / WP-FN: VRP Harvesting & Gamma Scalping Kernel
"""

import pytest
from services.vrp_gamma_scalping_kernel import (
    VRPGammaScalpingKernel,
    PortfolioGreeks,
    VRPRegime,
    VRPDirective,
)


@pytest.fixture
def kernel():
    return VRPGammaScalpingKernel(
        min_short_vrp_pts=3.5,
        min_short_vrp_ratio=1.20,
        inverted_vrp_threshold_pts=-2.0,
        base_delta_band=0.05,
        transaction_cost_bps=4.0,
    )


def test_short_vrp_harvest_delta_neutral(kernel):
    # Implied vol = 24.0%, Realized vol = 18.0% -> Spread = +6.0 pts, Ratio = 1.33x
    greeks = PortfolioGreeks(
        underlying_price=100.0,
        net_delta=0.01,
        net_gamma=0.02,
        net_vega_usd=-500.0,
        net_theta_usd_day=150.0,
    )
    res = kernel.evaluate_vrp_and_hedging("SPY", 24.0, 18.0, greeks)
    assert res.regime == VRPRegime.SHORT_VRP_HARVEST_DELTA_NEUTRAL
    assert res.directive == VRPDirective.DEPLOY_SHORT_VARIANCE_CARRY
    assert res.vrp_spread_pts == 6.0
    assert res.vrp_ratio > 1.20


def test_long_gamma_explosive_convexity(kernel):
    # Implied vol = 20.0%, Realized vol = 26.0% -> Spread = -6.0 pts (Inverted)
    greeks = PortfolioGreeks(
        underlying_price=100.0,
        net_delta=0.005,
        net_gamma=0.05,
        net_vega_usd=800.0,
        net_theta_usd_day=-200.0,
    )
    res = kernel.evaluate_vrp_and_hedging("BTC", 20.0, 26.0, greeks)
    assert res.regime == VRPRegime.LONG_GAMMA_EXPLOSIVE_CONVEXITY
    assert res.directive == VRPDirective.DEPLOY_LONG_GAMMA_STRADDLE
    assert res.vrp_spread_pts <= -2.0


def test_gamma_scalp_rebalance_trigger(kernel):
    # Delta drift = +0.12 (exceeds band ~ 0.05)
    greeks = PortfolioGreeks(
        underlying_price=100.0,
        net_delta=0.12,
        net_gamma=0.03,
        net_vega_usd=200.0,
        net_theta_usd_day=-50.0,
    )
    res = kernel.evaluate_vrp_and_hedging("ETH", 25.0, 20.0, greeks)
    assert res.regime == VRPRegime.GAMMA_SCALP_REBALANCE_TRIGGER
    assert res.directive == VRPDirective.EXECUTE_UNDERLYING_DELTA_HEDGE
    assert res.recommended_hedge_shares == -0.12


def test_delta_bandwidth_scaling(kernel):
    # As gamma increases, bandwidth should narrow (more frequent smaller hedges needed)
    band_low_gamma = kernel.calculate_delta_bandwidth(gamma=0.005, spot=100.0, realized_vol=0.20)
    band_high_gamma = kernel.calculate_delta_bandwidth(gamma=0.08, spot=100.0, realized_vol=0.20)
    assert band_high_gamma < band_low_gamma
