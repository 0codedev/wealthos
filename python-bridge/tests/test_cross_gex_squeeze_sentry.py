"""
Unit Tests for Cross-Asset Options Cross-GEX Imbalance & Forced Feedback Squeeze Sentry
Domain 224 / Work Package WP-DV
"""

import pytest
import math
from services.cross_gex_squeeze_sentry import (
    CrossGEXSqueezeSentry,
    OptionContract,
    SentryAlertState,
)


def test_bs_gamma_calculation():
    sentry = CrossGEXSqueezeSentry()
    spot = 5000.0
    strike = 5000.0
    t = 30.0 / 365.0
    iv = 0.20

    gamma = sentry.compute_bs_gamma(spot, strike, t, iv)
    assert gamma > 0.0
    # For ATM option S=5000, sigma=0.20, T=30/365 (~0.0822), sqrt(T) ~ 0.2867
    # phi(0) = 0.3989. denominator = 5000 * 0.20 * 0.2867 = 286.7
    # gamma ~ 0.3989 / 286.7 ~ 0.00139
    assert 0.0010 < gamma < 0.0020

    # Test edge cases: T -> 0 and iv -> 0 do not throw
    gamma_zero_t = sentry.compute_bs_gamma(spot, strike, 0.0, iv)
    assert gamma_zero_t > 0.0
    gamma_zero_spot = sentry.compute_bs_gamma(0.0, strike, t, iv)
    assert gamma_zero_spot == 0.0


def test_gex_profile_and_gamma_flip():
    sentry = CrossGEXSqueezeSentry()
    spot = 100.0

    # Construct portfolio: Heavy calls at 105 (positive GEX), heavy puts at 95 (negative GEX)
    contracts = [
        OptionContract(strike=105.0, option_type="call", open_interest=1000.0, spot=spot, iv=0.25, time_to_expiry=0.1),
        OptionContract(strike=95.0, option_type="put", open_interest=1500.0, spot=spot, iv=0.25, time_to_expiry=0.1),
    ]

    profile = sentry.compute_profile(contracts, current_spot=spot, spot_range_pct=0.15)
    assert profile.spot == 100.0
    assert profile.call_gex_usd > 0.0
    assert profile.put_gex_usd < 0.0
    assert profile.max_gamma_strike in [95.0, 105.0]

    # Check flip price was calculated or exists within the range
    if profile.gamma_flip_price is not None:
        assert 85.0 <= profile.gamma_flip_price <= 115.0


def test_cross_asset_dislocation():
    sentry = CrossGEXSqueezeSentry()
    index_net_gex = -5000000.0  # Index deeply negative dealer gamma

    constituent_map = {
        "AAPL": 2000000.0,
        "MSFT": 1500000.0,
        "NVDA": 1000000.0,
    }
    weights = {
        "AAPL": 0.4,
        "MSFT": 0.3,
        "NVDA": 0.3,
    }
    # Weighted basket: 0.4*2M + 0.3*1.5M + 0.3*1M = 800k + 450k + 300k = 1,550,000
    res = sentry.evaluate_cross_asset_dislocation(index_net_gex, constituent_map, weights)

    assert pytest.approx(res["synthetic_basket_gex"], 1e-2) == 1550000.0
    assert pytest.approx(res["dislocation_usd"], 1e-2) == -6550000.0
    assert res["relative_dislocation_pct"] < 0.0


def test_sentry_normal_dampened_state():
    sentry = CrossGEXSqueezeSentry()
    spot = 500.0

    # Net positive gamma (lots of calls)
    contracts = [
        OptionContract(strike=500.0, option_type="call", open_interest=5000.0, spot=spot, iv=0.18, time_to_expiry=0.2),
        OptionContract(strike=480.0, option_type="put", open_interest=500.0, spot=spot, iv=0.18, time_to_expiry=0.2),
    ]

    # Large depth
    decision = sentry.assess_squeeze_risk(contracts, current_spot=spot, order_book_depth_top3_usd=50000000.0)
    assert decision.alert_state == SentryAlertState.NORMAL_DAMPENED
    assert decision.net_gex_usd > 0.0
    assert decision.feedback_ratio < 1.0


def test_sentry_cascade_feedback_and_pin_risk():
    sentry = CrossGEXSqueezeSentry(critical_feedback_ratio=1.0)
    spot = 100.0

    # Severe negative gamma with massive puts below spot
    contracts_cascade = [
        OptionContract(strike=98.0, option_type="put", open_interest=20000.0, spot=spot, iv=0.30, time_to_expiry=0.05),
        OptionContract(strike=102.0, option_type="call", open_interest=1000.0, spot=spot, iv=0.20, time_to_expiry=0.05),
    ]

    # Fragile liquidity depth ($10,000 top 3 levels)
    decision = sentry.assess_squeeze_risk(
        contracts_cascade, current_spot=spot, order_book_depth_top3_usd=10000.0, price_shock_pct=0.02
    )

    assert decision.net_gex_usd < 0.0
    assert decision.feedback_ratio > 1.0
    assert decision.alert_state in [
        SentryAlertState.FEEDBACK_CASCADE_DOWN,
        SentryAlertState.FEEDBACK_CASCADE_UP,
        SentryAlertState.VOLATILITY_EXPANSION,
    ]

    # Test Pin Risk Lock: Contract exactly at spot with high OI and ultra-short expiry (1 day)
    contracts_pin = [
        OptionContract(strike=100.0, option_type="call", open_interest=50000.0, spot=100.0, iv=0.25, time_to_expiry=1.0 / 365.0),
    ]
    pin_decision = sentry.assess_squeeze_risk(
        contracts_pin, current_spot=100.05, order_book_depth_top3_usd=5000000.0
    )
    assert pin_decision.pin_risk_detected is True
    assert pin_decision.alert_state == SentryAlertState.PIN_RISK_LOCK
