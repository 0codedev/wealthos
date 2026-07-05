"""
Unit tests for Domain 174 (WP-BX): Real-Time Options Surface SABR Calibration & Volatility Smile Engine
"""

import pytest
from services.sabr_volatility_smile_engine import (
    SABRVolatilitySmileEngine,
    SABRParameters,
    SABRSmilePoint,
    SABRReport,
)


def test_hagan_atm_and_otm_vol():
    engine = SABRVolatilitySmileEngine()
    params = SABRParameters(alpha=0.25, beta=0.70, rho=-0.30, nu=0.45)
    F = 100.0
    T = 0.50

    vol_atm = engine.hagan_implied_vol(F, K=100.0, T=T, params=params)
    assert vol_atm > 0.0

    # Limit continuity: OTM vol at K=99.99 should approach ATM vol
    vol_near = engine.hagan_implied_vol(F, K=99.99, T=T, params=params)
    assert abs(vol_near - vol_atm) < 1e-3


def test_sabr_skew_and_smile():
    engine = SABRVolatilitySmileEngine()
    # Negative rho (-0.40) creates negative skew (equity puts richer than calls)
    params_skew = SABRParameters(alpha=0.30, beta=1.0, rho=-0.40, nu=0.50)
    F = 100.0
    T = 0.25

    vol_put = engine.hagan_implied_vol(F, K=90.0, T=T, params=params_skew)
    vol_atm = engine.hagan_implied_vol(F, K=100.0, T=T, params=params_skew)
    vol_call = engine.hagan_implied_vol(F, K=110.0, T=T, params=params_skew)

    # Negative skew: vol_put > vol_atm > vol_call
    assert vol_put > vol_atm > vol_call


def test_calibrate_sabr_synthetic_smile():
    engine = SABRVolatilitySmileEngine()
    F = 100.0
    T = 0.25
    true_params = SABRParameters(alpha=0.20, beta=0.70, rho=-0.20, nu=0.40)

    # Generate synthetic market quotes across 5 strikes
    strikes = [90.0, 95.0, 100.0, 105.0, 110.0]
    market_quotes = [(k, engine.hagan_implied_vol(F, k, T, true_params)) for k in strikes]

    report = engine.calibrate_sabr("NIFTY_OPT", forward_price=F, expiry_t=T, market_quotes=market_quotes, fixed_beta=0.70)
    assert report.symbol == "NIFTY_OPT"
    assert report.density_arbitrage_free is True
    # RMSE should be extremely small (< 20 bps)
    assert report.rmse_fit_bps < 20.0
    assert report.regime == "SABR_SMILE_PRECISION_EQUILIBRIUM"
    assert report.trade_directive == "DEPLOY_SABR_CROSS_STRIKE_QUOTING"


def test_arbitrage_free_density_verification():
    engine = SABRVolatilitySmileEngine()
    params = SABRParameters(alpha=0.20, beta=0.70, rho=-0.20, nu=0.30)
    strikes = [85.0, 90.0, 95.0, 100.0, 105.0, 110.0, 115.0]
    is_arb_free = engine.verify_arbitrage_free_density(F=100.0, strikes=strikes, T=0.25, params=params)
    assert is_arb_free is True


def test_sqlite_persistence():
    engine = SABRVolatilitySmileEngine(db_path=":memory:")
    quotes = [(95.0, 0.22), (100.0, 0.20), (105.0, 0.19)]
    rep = engine.calibrate_sabr("BANKNIFTY_OPT", forward_price=100.0, expiry_t=0.10, market_quotes=quotes)
    assert rep.symbol == "BANKNIFTY_OPT"

    rows = engine.get_latest_telemetry(5)
    assert len(rows) == 1
    assert rows[0][0] == "BANKNIFTY_OPT"
    assert rows[0][1] == 100.0
