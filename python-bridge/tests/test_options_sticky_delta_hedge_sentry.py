"""
Unit tests for Domain 270 / WP-FP: Options Sticky-Strike vs Sticky-Delta Sentry
"""

import pytest
from services.options_sticky_delta_hedge_sentry import (
    OptionsStickyDeltaHedgeSentry,
    OptionWingParameters,
    SmileDynamicsRegime,
    SmileHedgeDirective,
)


@pytest.fixture
def sentry():
    return OptionsStickyDeltaHedgeSentry(
        sticky_delta_ratio_hurdle=0.70,
        sticky_strike_ratio_hurdle=0.30,
        min_leakage_shares_hurdle=5.0,
    )


def test_skew_slope_wrt_spot_formula(sentry):
    # Strike 90, Spot 100, dvol/dstrike = -0.002
    # dvol_ds = -(90 / 100) * (-0.002) = +0.0018
    dvol_ds = sentry.calculate_skew_slope_wrt_spot(90.0, 100.0, -0.002)
    assert abs(dvol_ds - 0.0018) < 1e-6


def test_sticky_strike_equilibrium(sentry):
    wing = OptionWingParameters(
        strike=90.0,
        spot=100.0,
        implied_vol=0.25,
        skew_slope_dvol_dstrike=-0.002,
        bs_delta=-0.20,
        bs_vega=20.0,
        contract_size=100.0,
    )
    res = sentry.evaluate_wing_hedging("SPY", wing, empirical_regime_ratio=0.10)
    assert res.regime == SmileDynamicsRegime.STICKY_STRIKE_EQUILIBRIUM
    assert res.directive == SmileHedgeDirective.MAINTAIN_BS_DELTA
    assert res.bs_delta == -0.20


def test_sticky_delta_wing_underhedge_hazard(sentry):
    # Pure sticky-delta regime (ratio=1.0)
    # Put wing: strike 85, spot 100, dvol_dstrike = -0.003
    # dvol_ds = -(85/100) * (-0.003) = +0.00255
    # Vega = 30.0 -> skew correction = 30 * 0.00255 = 0.0765
    # Effective delta = -0.25 + 0.0765 = -0.1735 (or for short put / long put)
    # Leakage shares = 0.0765 * 100 = 7.65 shares >= 5.0
    wing = OptionWingParameters(
        strike=85.0,
        spot=100.0,
        implied_vol=0.30,
        skew_slope_dvol_dstrike=-0.003,
        bs_delta=-0.25,
        bs_vega=30.0,
        contract_size=100.0,
    )
    res = sentry.evaluate_wing_hedging("BTC", wing, empirical_regime_ratio=1.0)
    assert res.regime == SmileDynamicsRegime.STICKY_DELTA_WING_UNDERHEDGE_HAZARD
    assert res.directive == SmileHedgeDirective.APPLY_SKEW_MODIFIED_DELTA_CORRECTION
    assert res.delta_leakage_shares >= 5.0
    assert res.effective_skew_adjusted_delta != res.bs_delta


def test_mixed_local_vol_dynamics(sentry):
    wing = OptionWingParameters(
        strike=95.0,
        spot=100.0,
        implied_vol=0.22,
        skew_slope_dvol_dstrike=-0.002,
        bs_delta=-0.35,
        bs_vega=25.0,
        contract_size=100.0,
    )
    res = sentry.evaluate_wing_hedging("ETH", wing, empirical_regime_ratio=0.50)
    assert res.regime == SmileDynamicsRegime.MIXED_LOCAL_VOL_DYNAMICS
    assert res.directive == SmileHedgeDirective.APPLY_INTERPOLATED_HYBRID_DELTA
    assert res.sticky_regime_ratio == 0.50
