import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import math

import pytest

from services.volatility_surface_sabr_engine import (
    run_self_tests, calibrate_surface, FIXTURE_NIFTY_CHAIN, FIXTURE_BANKNIFTY_CHAIN,
    implied_volatility, black76_price, fit_svi, fit_sabr, surface_iv,
    iv_crush_forecast, detect_mispricing, vega_budget, contracts_to_hedge,
)


def test_self_tests_ok():
    r = run_self_tests()
    assert r["status"] == "OK"
    assert r["iv_roundtrip_err"] < 1e-4
    assert r["svi_rmse"] < 1e-3
    assert r["svi_r2"] > 0.99
    assert r["sabr_rmse"] < 1e-3


def test_iv_roundtrip():
    F = 22500.0 * math.exp(0.07 * 7 / 365.0)
    K = 22600.0
    T = 7 / 365.0
    iv0 = 0.18
    px = black76_price(F, K, T, 0.07, iv0, "CE")
    iv1 = implied_volatility(px, F, K, T, 0.07, "CE")
    assert abs(iv0 - iv1) < 1e-4


def test_surface_calibration():
    surf = calibrate_surface("NIFTY", {"7": FIXTURE_NIFTY_CHAIN}, 22500.0, r=0.07)
    assert len(surf.svi_by_expiry) == 1
    assert len(surf.sabr_by_expiry) == 1
    Tkey = list(surf.svi_by_expiry.keys())[0]
    assert surf.svi_by_expiry[Tkey].r_squared > 0.95
    assert surf.sabr_by_expiry[Tkey].rmse < 1e-2
    iv = surface_iv(surf, 22500.0, 7.0, model="svi")
    assert 0.05 < iv < 0.60


def test_banknifty_surface():
    surf = calibrate_surface("BANKNIFTY", {"3": FIXTURE_BANKNIFTY_CHAIN}, 48000.0, r=0.07)
    assert len(surf.points) > 0


def test_iv_crush_forecast():
    r = iv_crush_forecast("14:00", 1.0, 0.16, "weekly_expiry")
    assert r["status"] == "CRUSH_IN_PROGRESS"
    assert r["forecast_iv"] < 0.16
    r2 = iv_crush_forecast("16:00", 1.0, 0.16, "weekly_expiry")
    assert r2["status"] == "CRUSH_COMPLETE"


def test_vega_budget():
    b = vega_budget(100000.0, 50000.0)
    assert b.action == "OK"
    b2 = vega_budget(100000.0, 150000.0)
    assert b2.breach is True
    assert contracts_to_hedge(1000.0, 50.0) == -20


def test_mispricing_runs():
    surf = calibrate_surface("NIFTY", {"7": FIXTURE_NIFTY_CHAIN}, 22500.0, r=0.07)
    sigs = detect_mispricing(surf, 22500.0, wing_threshold_iv=0.0, atm_threshold_iv=0.0)
    assert isinstance(sigs, list)