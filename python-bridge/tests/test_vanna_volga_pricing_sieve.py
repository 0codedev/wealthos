"""
Unit tests for Domain 169 (WP-BS): Real-Time Cross-Strike Vanna-Volga Foreign Exchange / Equity Option Pricing Sieve
"""

import pytest
from services.vanna_volga_pricing_sieve import (
    MarketQuotes,
    VannaVolgaPricingSieve,
    VannaVolgaResult,
)


def test_bs_pricing_and_greeks():
    sieve = VannaVolgaPricingSieve()
    S = 100.0
    K = 100.0
    T = 0.25
    r = 0.05
    sigma = 0.20

    c = sieve.bs_price(S, K, T, r, sigma, is_call=True)
    p = sieve.bs_price(S, K, T, r, sigma, is_call=False)
    # Put-Call Parity: C - P = S - K * exp(-rT)
    expected_parity = S - K * 0.9875778
    assert abs((c - p) - (S - K * 2.7182818 ** (-r * T))) < 1e-4

    vega = sieve.bs_vega(S, K, T, r, sigma)
    assert vega > 0.0

    vanna = sieve.bs_vanna(S, K, T, r, sigma)
    volga = sieve.bs_volga(S, K, T, r, sigma)
    assert isinstance(vanna, float)
    assert isinstance(volga, float)


def test_pillar_strikes_calculation():
    sieve = VannaVolgaPricingSieve()
    quotes = MarketQuotes(
        spot=100.0,
        r=0.05,
        t=0.25,
        atm_vol=0.20,
        rr_25=-0.02,  # Put vol higher than Call vol (typical equity skew)
        bf_25=0.01,   # Smile smile curvature
    )
    k1, k2, k3, vol_put, vol_call = sieve.calculate_pillar_strikes(quotes)
    # k1 (Put) < k2 (ATM) < k3 (Call)
    assert k1 < k2 < k3
    # Skew: vol_put should be higher than vol_call
    assert vol_put > vol_call
    assert abs(vol_call - (0.20 + 0.01 - 0.01)) < 1e-4
    assert abs(vol_put - (0.20 + 0.01 + 0.01)) < 1e-4


def test_vanna_volga_smile_interpolation():
    sieve = VannaVolgaPricingSieve()
    quotes = MarketQuotes(
        spot=100.0,
        r=0.05,
        t=0.25,
        atm_vol=0.20,
        rr_25=-0.02,
        bf_25=0.015,
    )
    # Price OTM Put at Strike 95
    res = sieve.price_vanna_volga("USDINR", target_strike=95.0, is_call=False, quotes=quotes)
    assert res.strike == 95.0
    assert res.vv_price > 0.0
    # Smile curvature + put skew should make implied vol > ATM vol (0.20)
    assert res.vv_implied_vol > 0.20


def test_mispricing_arbitrage_regimes():
    sieve = VannaVolgaPricingSieve()
    quotes = MarketQuotes(
        spot=100.0,
        r=0.05,
        t=0.25,
        atm_vol=0.20,
        rr_25=-0.02,
        bf_25=0.01,
    )
    # Strike 95 Put: Fair VV IV is around 0.22 (22%)
    # Scenario 1: Market IV is 0.25 (300 bps higher -> Rich)
    res_rich = sieve.price_vanna_volga(
        "NIFTY", target_strike=95.0, is_call=False, quotes=quotes, market_iv=0.25
    )
    assert res_rich.regime == "RICH_VOLATILITY_OVERPRICING"
    assert res_rich.trade_directive == "EXECUTE_SHORT_VEGA_HARVEST"
    assert res_rich.mispricing_bps > 50.0

    # Scenario 2: Market IV is 0.18 (400 bps lower -> Cheap)
    res_cheap = sieve.price_vanna_volga(
        "NIFTY", target_strike=95.0, is_call=False, quotes=quotes, market_iv=0.18
    )
    assert res_cheap.regime == "CHEAP_VOLATILITY_UNDERPRICING"
    assert res_cheap.trade_directive == "EXECUTE_LONG_VEGA_HARVEST"
    assert res_cheap.mispricing_bps < -50.0


def test_sqlite_persistence():
    sieve = VannaVolgaPricingSieve(db_path=":memory:")
    quotes = MarketQuotes(
        spot=100.0,
        r=0.05,
        t=0.25,
        atm_vol=0.20,
        rr_25=0.0,
        bf_25=0.01,
    )
    res = sieve.price_vanna_volga("BANKNIFTY", target_strike=105.0, is_call=True, quotes=quotes, market_iv=0.21)
    assert res.strike == 105.0

    rows = sieve.get_latest_telemetry(5)
    assert len(rows) == 1
    assert rows[0][0] == "BANKNIFTY"
    assert rows[0][2] == 105.0
