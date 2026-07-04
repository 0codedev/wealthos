r"""Unit Tests for Real-Time Options Expiry Pin Risk & Multi-Asset Delta Hedging Sentry (Domain 201 / WP-CY)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.options_expiry_pin_risk_sentry import (
    OptionsExpiryPinRiskSentry,
    DealerGammaRegime,
)


@pytest.fixture
def sentry() -> OptionsExpiryPinRiskSentry:
    return OptionsExpiryPinRiskSentry(
        lot_size=25,
        strike_step=50.0,
        kappa_gravity=0.05,
    )


def test_gamma_calculation_and_expiry_explosion(sentry: OptionsExpiryPinRiskSentry):
    spot = 25000.0
    strike = 25000.0
    iv = 0.15

    # Gamma at 30 days to expiry
    gamma_30d = sentry.calculate_black_scholes_gamma(spot, strike, tau_years=30.0 / 365.0, iv=iv)
    # Gamma at 1 hour (0.04 days) to expiry
    gamma_1h = sentry.calculate_black_scholes_gamma(spot, strike, tau_years=0.04 / 365.0, iv=iv)

    assert gamma_1h > gamma_30d * 10.0
    assert gamma_30d > 0.0
    assert gamma_1h > 0.0


def test_pin_probability_convergence(sentry: OptionsExpiryPinRiskSentry):
    spot = 25000.0
    iv = 0.12

    # Spot at 25000 with only 45 minutes (0.03 days) left
    p_pin_atm = sentry.calculate_pin_probability(spot=spot, strike=25000.0, tau_days=0.03, iv=iv)
    # Strike 300 points out of the money
    p_pin_otm = sentry.calculate_pin_probability(spot=spot, strike=25300.0, tau_days=0.03, iv=iv)

    assert p_pin_atm > 0.50
    assert p_pin_otm < 0.01
    assert 0.0 <= p_pin_atm <= 1.0


def test_dealer_gamma_regime_long_gamma_pin_harvest(sentry: OptionsExpiryPinRiskSentry):
    spot = 25000.0
    tau_days = 0.04  # ~1.5 hours remaining
    iv = 0.14

    options_chain = [
        {"strike": 24900.0, "call_oi": 50000.0, "put_oi": 20000.0},
        {"strike": 24950.0, "call_oi": 80000.0, "put_oi": 40000.0},
        {"strike": 25000.0, "call_oi": 250000.0, "put_oi": 50000.0},  # Huge call OI
        {"strike": 25050.0, "call_oi": 70000.0, "put_oi": 30000.0},
        {"strike": 25100.0, "call_oi": 40000.0, "put_oi": 20000.0},
    ]

    report = sentry.evaluate_expiry_pin_risk(spot, tau_days, iv, options_chain)

    assert report.spot_price == spot
    assert report.primary_pin_strike == 25000.0
    assert report.primary_pin_probability > 0.40
    assert report.dealer_gamma_regime in (DealerGammaRegime.STRONG_LONG_GAMMA, DealerGammaRegime.MILD_LONG_GAMMA)
    assert report.underlying_delta_rebalance_surge_shares > 0.0
    assert "25000" in report.tactical_directive


def test_gamma_squeeze_short_gamma(sentry: OptionsExpiryPinRiskSentry):
    spot = 25000.0
    tau_days = 0.04
    iv = 0.16

    # Massive put OI relative to calls (dealers short gamma on the downside)
    options_chain = [
        {"strike": 24950.0, "call_oi": 10000.0, "put_oi": 150000.0},
        {"strike": 25000.0, "call_oi": 20000.0, "put_oi": 300000.0},
        {"strike": 25050.0, "call_oi": 10000.0, "put_oi": 150000.0},
    ]

    report = sentry.evaluate_expiry_pin_risk(spot, tau_days, iv, options_chain)

    assert report.total_market_gex < -1.0
    assert report.dealer_gamma_regime in (DealerGammaRegime.STRONG_SHORT_GAMMA, DealerGammaRegime.MILD_SHORT_GAMMA)
    assert report.action_type == "GAMMA_SQUEEZE_BREAKOUT"
    assert "Dealers must chase momentum" in report.tactical_directive


def test_underlying_delta_rebalance_surge(sentry: OptionsExpiryPinRiskSentry):
    spot = 25000.0
    chain = [{"strike": 25000.0, "call_oi": 100000.0, "put_oi": 100000.0}]

    report = sentry.evaluate_expiry_pin_risk(spot, tau_days=0.05, iv=0.15, options_chain=chain)
    assert report.underlying_delta_rebalance_surge_shares > 100.0
