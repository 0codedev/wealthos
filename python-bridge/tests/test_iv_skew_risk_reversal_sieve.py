"""
Unit Tests for Options Implied Volatility Surface Skew Arbitrage & Risk Reversal Sieve (Domain 184 / WP-CH)
"""

import pytest

from services.iv_skew_risk_reversal_sieve import (
    IVSkewRiskReversalSieve,
    OptionSmilePillars,
    SkewArbitrageDirective,
)


@pytest.fixture
def sieve():
    return IVSkewRiskReversalSieve(
        db_path=":memory:",
        baseline_mean_rr=-0.045,  # -4.5%
        baseline_std_rr=0.012,   # 1.2%
        extreme_z_threshold=2.0,
    )


def test_normal_equilibrium_skew(sieve):
    # NIFTY 30 DTE: Spot 25000, ATM=15%, 25P=19%, 25C=14.5%
    # RR = 14.5% - 19.0% = -4.5% (Z = 0.0)
    # BF = 0.5 * (14.5 + 19) - 15 = 16.75 - 15 = +1.75%
    pillars = OptionSmilePillars(
        symbol="NIFTY",
        underlying_price=25000.0,
        days_to_expiry=30.0,
        atm_vol=0.15,
        put_25d_vol=0.19,
        call_25d_vol=0.145,
        put_25d_strike=24400.0,
        call_25d_strike=25600.0,
    )

    rep = sieve.evaluate_smile_skew(pillars)

    assert rep.risk_reversal_25d == -0.045
    assert rep.butterfly_25d == 0.0175
    assert rep.z_score_skew == 0.0
    assert rep.directive == SkewArbitrageDirective.NORMAL_EQUILIBRIUM_SKEW
    assert "equilibrium" in rep.rationale


def test_extreme_downside_put_skew(sieve):
    # Market crash panic: 25P IV explodes to 24%, 25C drops to 13%, ATM=16%
    # RR = 13% - 24% = -11.0% (Z = (-0.11 - (-0.045)) / 0.012 = -0.065 / 0.012 = -5.42 sigma)
    # BF = 0.5 * (13 + 24) - 16 = 18.5 - 16 = +2.5%
    pillars = OptionSmilePillars(
        symbol="NIFTY",
        underlying_price=25000.0,
        days_to_expiry=15.0,
        atm_vol=0.16,
        put_25d_vol=0.24,
        call_25d_vol=0.13,
        put_25d_strike=24200.0,
        call_25d_strike=25700.0,
    )

    rep = sieve.evaluate_smile_skew(pillars)

    assert rep.z_score_skew <= -2.0
    assert rep.directive == SkewArbitrageDirective.LONG_RISK_REVERSAL_CHEAP_CALLS
    assert "Extreme downside put skew" in rep.rationale


def test_flat_inverted_skew(sieve):
    # Retail call meme frenzy: 25C IV explodes to 22%, 25P is only 17%, ATM=16%
    # RR = 22% - 17% = +5.0% (Z = (+0.05 - (-0.045)) / 0.012 = +7.91 sigma)
    pillars = OptionSmilePillars(
        symbol="MEME_STK",
        underlying_price=1000.0,
        days_to_expiry=20.0,
        atm_vol=0.16,
        put_25d_vol=0.17,
        call_25d_vol=0.22,
        put_25d_strike=950.0,
        call_25d_strike=1060.0,
    )

    rep = sieve.evaluate_smile_skew(pillars)

    assert rep.z_score_skew >= 2.0
    assert rep.directive == SkewArbitrageDirective.SHORT_RISK_REVERSAL_CHEAP_PUTS
    assert "Abnormally flat or inverted skew" in rep.rationale


def test_negative_butterfly_curvature_arbitrage(sieve):
    # Frown instead of smile: ATM=22%, 25P=19%, 25C=18%
    # BF = 0.5 * (19 + 18) - 22 = 18.5 - 22 = -3.5%
    pillars = OptionSmilePillars(
        symbol="BROKEN_SMILE",
        underlying_price=500.0,
        days_to_expiry=10.0,
        atm_vol=0.22,
        put_25d_vol=0.19,
        call_25d_vol=0.18,
        put_25d_strike=475.0,
        call_25d_strike=525.0,
    )

    rep = sieve.evaluate_smile_skew(pillars)

    assert rep.butterfly_25d <= 0.0
    assert rep.directive == SkewArbitrageDirective.BUTTERFLY_CONVEXITY_ARBITRAGE
    assert "Negative smile curvature" in rep.rationale


def test_sqlite_persistence(sieve):
    pillars = OptionSmilePillars(
        symbol="PERSIST_OPT",
        underlying_price=25000.0,
        days_to_expiry=30.0,
        atm_vol=0.15,
        put_25d_vol=0.19,
        call_25d_vol=0.145,
        put_25d_strike=24400.0,
        call_25d_strike=25600.0,
    )
    sieve.evaluate_smile_skew(pillars)

    telemetry = sieve.get_latest_telemetry(limit=5)
    assert len(telemetry) == 1
    assert telemetry[0][0] == "PERSIST_OPT"
    assert telemetry[0][1] == 30.0
    assert abs(telemetry[0][3] - (-0.045)) < 1e-4
