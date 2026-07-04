"""
Unit Test Suite for Domain 254: Cross-Asset Options Volatility Surface Skew Arbitrage & Local Volatility Mixture Calibration Engine
"""

import pytest
from services.options_skew_local_vol_engine import (
    OptionsSkewLocalVolEngine,
    StrikeMaturityPoint,
    SurfaceArbitrageRegime,
    OptionsArbDirective,
)


@pytest.fixture
def engine():
    return OptionsSkewLocalVolEngine(min_arb_edge_bps=5.0)


def test_clean_surface_no_arbitrage(engine):
    # Monotonically increasing total variance and smooth positive density
    # T1 = 0.25 (3M), IV = 0.20 -> w1 = 0.20^2 * 0.25 = 0.010
    # T2 = 0.50 (6M), IV = 0.22 -> w2 = 0.22^2 * 0.50 = 0.0242 (> w1)
    p1 = StrikeMaturityPoint(strike=100.0, maturity_years=0.25, implied_vol=0.20, forward_price=100.0)
    p2 = StrikeMaturityPoint(strike=100.0, maturity_years=0.50, implied_vol=0.22, forward_price=100.0)

    # dw_dy = 0 (ATM), d2w_dy2 = 0.05
    res = engine.evaluate_surface("SPY", p1, p2, dw_dy=0.0, d2w_dy2=0.05)
    assert res.regime == SurfaceArbitrageRegime.SURFACE_NO_ARBITRAGE_VALIDATED
    assert res.directive == OptionsArbDirective.MONITOR_CLEAN_SURFACE
    assert res.calendar_min_forward_variance > 0.0
    assert res.butterfly_min_density_curvature > 0.0
    assert res.calibrated_local_vol > 0.0


def test_calendar_variance_inversion(engine):
    # w2 < w1 (implied vol drops drastically from 0.40 at 1M to 0.10 at 2M)
    # T1 = 0.0833 (1M), IV = 0.40 -> w1 = 0.16 * 0.0833 = 0.0133
    # T2 = 0.1666 (2M), IV = 0.15 -> w2 = 0.0225 * 0.1666 = 0.00375 (< w1!)
    p1 = StrikeMaturityPoint(strike=100.0, maturity_years=0.0833, implied_vol=0.40, forward_price=100.0)
    p2 = StrikeMaturityPoint(strike=100.0, maturity_years=0.1666, implied_vol=0.15, forward_price=100.0)

    res = engine.evaluate_surface("QQQ", p1, p2, dw_dy=0.0, d2w_dy2=0.02)
    assert res.regime == SurfaceArbitrageRegime.CALENDAR_VARIANCE_INVERSION
    assert res.directive == OptionsArbDirective.EXECUTE_FREE_CALENDAR_ARBITRAGE
    assert res.arbitrage_edge_bps > 0.0


def test_butterfly_density_negative(engine):
    # Calendar is fine, but extreme skew slope at ATM creates negative risk-neutral density
    p1 = StrikeMaturityPoint(strike=100.0, maturity_years=0.25, implied_vol=0.25, forward_price=100.0)
    p2 = StrikeMaturityPoint(strike=100.0, maturity_years=0.50, implied_vol=0.28, forward_price=100.0)

    # Steep slope dw_dy = 0.5 at ATM (y=0) drives term2 > 1.0 -> g(y) < 0
    res = engine.evaluate_surface("TSLA", p1, p2, dw_dy=0.5, d2w_dy2=-1.0)
    assert res.regime == SurfaceArbitrageRegime.BUTTERFLY_DENSITY_NEGATIVE
    assert res.directive == OptionsArbDirective.EXECUTE_BUTTERFLY_SPREAD_ARBITRAGE
    assert res.butterfly_min_density_curvature < 0.0


def test_extreme_surface_distortion(engine):
    # Both calendar variance drops AND density curvature becomes negative
    p1 = StrikeMaturityPoint(strike=90.0, maturity_years=0.10, implied_vol=0.50, forward_price=100.0)
    p2 = StrikeMaturityPoint(strike=90.0, maturity_years=0.15, implied_vol=0.10, forward_price=100.0)

    res = engine.evaluate_surface("NVDA", p1, p2, dw_dy=-0.8, d2w_dy2=-3.0)
    assert res.regime == SurfaceArbitrageRegime.EXTREME_SURFACE_DISTORTION
    assert res.directive == OptionsArbDirective.PULL_VOL_SURFACE_QUOTES


def test_durrleman_density_formula(engine):
    # At ATM (y=0) with zero slope (dw_dy=0) and zero curvature (d2w_dy2=0):
    # g(0) = (1 - 0)^2 - 0 + 0 = 1.0
    g = engine.calculate_durrleman_density_curvature(w=0.04, dw_dy=0.0, d2w_dy2=0.0, y=0.0)
    assert abs(g - 1.0) < 1e-6
