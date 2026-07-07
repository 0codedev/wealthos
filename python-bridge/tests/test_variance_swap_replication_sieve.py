r"""Unit Tests for Multi-Asset Cross-Sectional Volatility Jump & Variance Swap Replication Sieve (Domain 214 / WP-DL)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.variance_swap_replication_sieve import (
    VarianceSwapReplicationSieve,
    OptionQuote,
    VarianceSwapRegime,
    VarianceTacticalPosture,
)


@pytest.fixture
def sieve() -> VarianceSwapReplicationSieve:
    return VarianceSwapReplicationSieve(
        risk_free_rate=0.065,
        target_vrp_min_harvest_pct=2.0,
        min_strike_coverage_ratio=0.20,
    )


def generate_synthetic_option_strip(spot: float, forward: float, tau: float, vol: float) -> list[OptionQuote]:
    """Helper to generate a realistic discrete strip of OTM options using Black-Scholes."""
    # Strikes spanning -15% to +15% around spot in 2.5% increments
    strikes = [spot * (1.0 + step * 0.025) for step in range(-6, 7)]
    quotes = []

    r = 0.065
    sqrt_tau = math.sqrt(tau)

    for k in strikes:
        d1 = (math.log(spot / k) + (r + 0.5 * vol * vol) * tau) / (vol * sqrt_tau)
        d2 = d1 - vol * sqrt_tau
        discount = math.exp(-r * tau)

        # Standard normal CDF
        def cdf(x):
            return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

        if k < forward:
            # OTM Put
            price = k * discount * cdf(-d2) - spot * cdf(-d1)
            quotes.append(OptionQuote(strike=round(k, 1), is_call=False, market_price=max(1.0, price)))
        else:
            # OTM Call
            price = spot * cdf(d1) - k * discount * cdf(d2)
            quotes.append(OptionQuote(strike=round(k, 1), is_call=True, market_price=max(1.0, price)))

    return quotes


def test_empty_or_narrow_strip_rejection(sieve: VarianceSwapReplicationSieve):
    res_empty = sieve.evaluate_variance_replication(
        symbol="NIFTY",
        spot=25000.0,
        forward=25100.0,
        tau=0.10,
        options=[],
        realized_volatility=0.15,
    )
    assert res_empty.variance_regime == VarianceSwapRegime.TRUNCATION_RISK_HALT
    assert res_empty.recommended_posture == VarianceTacticalPosture.REJECT_REPLICATION

    # Only 2 strikes (span too narrow)
    narrow_opts = [
        OptionQuote(strike=24900.0, is_call=False, market_price=50.0),
        OptionQuote(strike=25100.0, is_call=True, market_price=60.0),
    ]
    res_narrow = sieve.evaluate_variance_replication(
        symbol="NIFTY",
        spot=25000.0,
        forward=25000.0,
        tau=0.10,
        options=narrow_opts,
        realized_volatility=0.15,
    )
    assert res_narrow.variance_regime == VarianceSwapRegime.TRUNCATION_RISK_HALT


def test_normal_vrp_harvest(sieve: VarianceSwapReplicationSieve):
    spot = 25000.0
    forward = 25050.0
    tau = 0.10
    # True option pricing vol is 18%
    opts = generate_synthetic_option_strip(spot, forward, tau, vol=0.18)

    # Realized vol is 14% -> VRP approx +4% vol points
    res = sieve.evaluate_variance_replication(
        symbol="NIFTY",
        spot=spot,
        forward=forward,
        tau=tau,
        options=opts,
        realized_volatility=0.14,
    )

    assert res.num_strikes_replicated == 13
    assert res.strike_range_coverage_pct >= 0.25
    assert res.fair_volatility_strike_pct > 16.0
    assert res.variance_risk_premium_pct >= 2.0
    assert res.variance_regime == VarianceSwapRegime.NORMAL_VRP_HARVEST
    assert res.recommended_posture == VarianceTacticalPosture.SHORT_VARIANCE_SWAP
    assert "Short synthetic variance strip" in res.tactical_directive


def test_compressed_vrp_deficit(sieve: VarianceSwapReplicationSieve):
    spot = 25000.0
    forward = 25050.0
    tau = 0.10
    opts = generate_synthetic_option_strip(spot, forward, tau, vol=0.16)

    # Realized vol is higher (19%), making options cheap relative to realized
    res = sieve.evaluate_variance_replication(
        symbol="BANKNIFTY",
        spot=spot,
        forward=forward,
        tau=tau,
        options=opts,
        realized_volatility=0.19,
    )

    assert res.variance_risk_premium_pct < 0.5
    assert res.variance_regime == VarianceSwapRegime.COMPRESSED_VRP_DEFICIT
    assert res.recommended_posture == VarianceTacticalPosture.LONG_VARIANCE_SWAP
    assert "Long synthetic variance strip" in res.tactical_directive


def test_acute_volatility_jump(sieve: VarianceSwapReplicationSieve):
    spot = 25000.0
    forward = 25050.0
    tau = 0.10
    # Option pricing vol pumped to 28% (extreme panic)
    opts = generate_synthetic_option_strip(spot, forward, tau, vol=0.28)

    # Realized vol is 15% -> VRP > 10%
    res = sieve.evaluate_variance_replication(
        symbol="RELIANCE",
        spot=spot,
        forward=forward,
        tau=tau,
        options=opts,
        realized_volatility=0.15,
    )

    assert res.variance_risk_premium_pct > 5.5
    assert res.variance_regime == VarianceSwapRegime.ACUTE_VOLATILITY_JUMP
    assert res.recommended_posture == VarianceTacticalPosture.HOLD_DYNAMIC_DELTA_HEDGE
    assert "Market pricing extreme tail jump risk" in res.tactical_directive
