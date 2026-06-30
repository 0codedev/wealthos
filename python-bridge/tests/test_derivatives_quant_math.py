"""
Unit tests for Derivatives Quantitative Mathematics Engine
Verifies Black-76, Dealer GEX, 25d IV Skew, Synthetic Basis, Max Pain, and Gamma Density.
"""

import pytest
import math
import sys
import os

# Ensure python-bridge is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.derivatives_quant_math import (
    black76_price_and_greeks,
    solve_implied_volatility,
    calculate_dealer_gex,
    calculate_25d_iv_skew,
    calculate_synthetic_basis,
    calculate_max_pain,
    calculate_gamma_density_and_expected_move
)


def test_black76_and_iv_inversion():
    F = 25000.0
    K = 25000.0
    t = 10.0 / 365.0
    r = 0.07
    sigma = 0.15

    # 1. Price and Greeks
    ce_res = black76_price_and_greeks(F, K, t, r, sigma, "CE")
    pe_res = black76_price_and_greeks(F, K, t, r, sigma, "PE")

    assert ce_res["price"] > 0
    assert pe_res["price"] > 0
    assert 0.45 <= ce_res["delta"] <= 0.55
    assert -0.55 <= pe_res["delta"] <= -0.45
    assert ce_res["gamma"] > 0
    assert ce_res["vega"] > 0

    # 2. IV Inversion
    solved_iv = solve_implied_volatility(ce_res["price"], F, K, t, r, "CE")
    assert abs(solved_iv - sigma) < 1e-3


def test_dealer_gex_and_regimes():
    spot = 500.0
    chain = [
        {
            "strike_price": 490.0,
            "call_options": {"market_data": {"oi": 5000}, "option_greeks": {"gamma": 0.005}},
            "put_options": {"market_data": {"oi": 25000}, "option_greeks": {"gamma": 0.015}}
        },
        {
            "strike_price": 500.0,
            "call_options": {"market_data": {"oi": 15000}, "option_greeks": {"gamma": 0.020}},
            "put_options": {"market_data": {"oi": 15000}, "option_greeks": {"gamma": 0.020}}
        },
        {
            "strike_price": 510.0,
            "call_options": {"market_data": {"oi": 30000}, "option_greeks": {"gamma": 0.015}},
            "put_options": {"market_data": {"oi": 4000}, "option_greeks": {"gamma": 0.004}}
        }
    ]

    gex_data = calculate_dealer_gex(chain, spot, lot_size=1000)
    assert "net_gex" in gex_data
    assert "zero_gamma_strike" in gex_data
    assert gex_data["regime"] in ("SHORT_GAMMA_EXPANSION", "LONG_GAMMA_PINNED")
    assert len(gex_data["strikes_gex"]) == 3


def test_25d_iv_skew():
    spot = 1000.0
    chain = [
        {
            "strike_price": 950.0,
            "call_options": {"option_greeks": {"iv": 0.18}},
            "put_options": {"option_greeks": {"iv": 0.22}}
        },
        {
            "strike_price": 1000.0,
            "call_options": {"option_greeks": {"iv": 0.16}},
            "put_options": {"option_greeks": {"iv": 0.16}}
        },
        {
            "strike_price": 1050.0,
            "call_options": {"option_greeks": {"iv": 0.15}},
            "put_options": {"option_greeks": {"iv": 0.20}}
        }
    ]

    skew_res = calculate_25d_iv_skew(chain, spot, atm_strike=1000.0)
    assert skew_res["skew_25d"] > 0
    assert skew_res["skew_verdict"] in ("BULLISH_CALL_ACCUMULATION", "BALANCED_NORMAL", "BEARISH_HEDGE_OVERLOAD")


def test_synthetic_basis():
    spot = 500.0
    chain = [
        {
            "strike_price": 500.0,
            "call_options": {"market_data": {"ltp": 15.0}},
            "put_options": {"market_data": {"ltp": 13.5}}
        }
    ]

    basis_res = calculate_synthetic_basis(chain, spot, atm_strike=500.0)
    assert basis_res["synthetic_future"] == 501.5
    assert basis_res["basis"] == 1.5
    assert basis_res["basis_pct"] == 0.3
    assert basis_res["verdict"] == "INSTITUTIONAL_SYNTHETIC_LONG"


def test_max_pain():
    spot = 100.0
    chain = [
        {"strike_price": 90.0, "call_options": {"market_data": {"oi": 100}}, "put_options": {"market_data": {"oi": 1000}}},
        {"strike_price": 100.0, "call_options": {"market_data": {"oi": 500}}, "put_options": {"market_data": {"oi": 500}}},
        {"strike_price": 110.0, "call_options": {"market_data": {"oi": 1200}}, "put_options": {"market_data": {"oi": 50}}}
    ]

    mp_res = calculate_max_pain(chain, spot)
    assert mp_res["max_pain_strike"] == 100.0
    assert mp_res["spot_distance_pct"] == 0.0
    assert mp_res["pain_gravity_verdict"] == "AT_MAX_PAIN_PIN"


def test_gamma_density_and_expected_move():
    spot = 1000.0
    chain = [
        {
            "strike_price": 980.0,
            "call_options": {"market_data": {"oi": 2000}, "option_greeks": {"gamma": 0.002}},
            "put_options": {"market_data": {"oi": 8000}, "option_greeks": {"gamma": 0.008}}
        },
        {
            "strike_price": 1000.0,
            "call_options": {"market_data": {"oi": 5000}, "option_greeks": {"gamma": 0.015}},
            "put_options": {"market_data": {"oi": 5000}, "option_greeks": {"gamma": 0.015}}
        },
        {
            "strike_price": 1020.0,
            "call_options": {"market_data": {"oi": 10000}, "option_greeks": {"gamma": 0.010}},
            "put_options": {"market_data": {"oi": 1000}, "option_greeks": {"gamma": 0.001}}
        }
    ]

    density_res = calculate_gamma_density_and_expected_move(chain, spot, atm_iv_pct=20.0, lot_size=100)
    assert density_res["sigma_1d"] > 0
    assert density_res["one_sigma_high"] > spot
    assert density_res["one_sigma_low"] < spot
    assert density_res["two_sigma_high"] > density_res["one_sigma_high"]
