"""
Unit tests for Domain 267 / WP-FM: Crypto Funding Rate Convexity & Squeeze Engine
"""

import pytest
from services.funding_rate_convexity_squeeze_engine import (
    FundingRateConvexitySqueezeEngine,
    VenueFundingRate,
    FundingRegime,
    FundingDirective,
)


@pytest.fixture
def engine():
    return FundingRateConvexitySqueezeEngine(
        min_arb_hurdle_apr_pct=12.0,
        crowded_oi_ratio_hurdle=2.0,
        extreme_long_rate_8h_pct=0.06,
        extreme_short_rate_8h_pct=-0.04,
        taker_fee_total_bps=8.0,
    )


def test_balanced_funding_equilibrium(engine):
    venues = [
        VenueFundingRate("Binance", 0.01, 1000000.0, 1000000.0),  # OI/Vol = 1.0
        VenueFundingRate("Bybit", 0.011, 800000.0, 800000.0),
    ]
    res = engine.evaluate_funding("BTCUSDT", venues)
    assert res.regime == FundingRegime.BALANCED_FUNDING_EQUILIBRIUM
    assert res.directive == FundingDirective.MONITOR_RATES
    assert res.open_interest_to_volume_ratio == 1.0


def test_crowded_long_liquidation_hazard(engine):
    # Extreme positive funding (+0.08% / 8h) with 3.0x OI/Vol
    venues = [
        VenueFundingRate("Binance", 0.08, 3000000.0, 1000000.0),
    ]
    res = engine.evaluate_funding("ETHUSDT", venues)
    assert res.regime == FundingRegime.CROWDED_LONG_LIQUIDATION_HAZARD
    assert res.directive == FundingDirective.DEFENSIVE_UNWIND_LONG_POSITIONS
    assert res.primary_annualized_yield_pct >= 80.0


def test_crowded_short_squeeze_hazard(engine):
    # Extreme negative funding (-0.05% / 8h) with 2.5x OI/Vol
    venues = [
        VenueFundingRate("Binance", -0.05, 2500000.0, 1000000.0),
    ]
    res = engine.evaluate_funding("SOLUSDT", venues)
    assert res.regime == FundingRegime.CROWDED_SHORT_SQUEEZE_HAZARD
    assert res.directive == FundingDirective.PRIME_SHORT_SQUEEZE_MOMENTUM
    assert res.primary_rate_8h_pct <= -0.04


def test_cross_exchange_funding_convexity_arb(engine):
    # Binance at 0.01% / 8h (10.95% APR), OKX at 0.04% / 8h (43.8% APR) -> spread ~ 32.8% APR
    venues = [
        VenueFundingRate("Binance", 0.01, 500000.0, 1000000.0),
        VenueFundingRate("OKX", 0.04, 500000.0, 1000000.0),
    ]
    res = engine.evaluate_funding("AVAXUSDT", venues)
    assert res.regime == FundingRegime.CROSS_EXCHANGE_FUNDING_CONVEXITY_ARB
    assert res.directive == FundingDirective.EXECUTE_CROSS_VENUE_FUNDING_ARB
    assert res.best_counter_venue == "OKX"
    assert res.best_arb_spread_apr_pct >= 12.0


def test_convexity_adjustment_monotonicity(engine):
    rate = 0.02
    simple_apr = rate * 1095.0
    adj_apr_pos_corr = engine.calculate_convexity_adjusted_apr(rate, correlation=0.60)
    adj_apr_zero_corr = engine.calculate_convexity_adjusted_apr(rate, correlation=0.0)

    assert adj_apr_pos_corr > simple_apr
    assert adj_apr_zero_corr == simple_apr
