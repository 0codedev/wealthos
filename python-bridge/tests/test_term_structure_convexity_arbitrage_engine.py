"""
Unit Test Suite for Domain 239: Real-Time Options Surface Term-Structure Convexity Arbitrage Engine
"""

import pytest
import math
from services.term_structure_convexity_arbitrage_engine import (
    TermStructureConvexityArbitrageEngine,
    TenorQuote,
    TermStructureState,
    ConvexityExecutionDirective,
)


@pytest.fixture
def engine():
    return TermStructureConvexityArbitrageEngine(
        rich_spread_threshold_bps=40.0,
        cheap_spread_threshold_bps=-40.0,
        min_tenor_gap_years=0.04,
    )


def test_insufficient_quotes(engine):
    quotes = [
        TenorQuote(tenor_years=0.1, implied_vol=0.20),
        TenorQuote(tenor_years=0.2, implied_vol=0.20),
    ]
    assessment = engine.scan_term_structure(quotes)
    assert assessment.state == TermStructureState.BALANCED_CONCAVE_SURFACE
    assert assessment.directive == ConvexityExecutionDirective.HOLD_NEUTRAL
    assert len(assessment.triplets) == 0


def test_calendar_monotonicity_violation(engine):
    # Total variance:
    # T1 = 0.50, vol = 0.30 => w1 = 0.09 * 0.50 = 0.045
    # T2 = 0.60, vol = 0.20 => w2 = 0.04 * 0.60 = 0.024 < 0.045! (violation)
    quotes = [
        TenorQuote(tenor_years=0.25, implied_vol=0.28),
        TenorQuote(tenor_years=0.50, implied_vol=0.30),
        TenorQuote(tenor_years=0.60, implied_vol=0.20),
    ]
    assessment = engine.scan_term_structure(quotes)
    assert assessment.state == TermStructureState.MONOTONICITY_CALENDAR_BREACH
    assert assessment.directive == ConvexityExecutionDirective.EXECUTE_CALENDAR_MONOTONICITY_ARB
    assert assessment.max_dislocation > 0.0


def test_smooth_balanced_term_structure(engine):
    # Flat volatility across tenors (0.20): total variance grows linearly w = 0.04 * T
    # Linear total variance => interpolated_w2 == w2 => dislocation == 0
    quotes = [
        TenorQuote(tenor_years=0.10, implied_vol=0.20),
        TenorQuote(tenor_years=0.25, implied_vol=0.20),
        TenorQuote(tenor_years=0.50, implied_vol=0.20),
        TenorQuote(tenor_years=0.75, implied_vol=0.20),
    ]
    assessment = engine.scan_term_structure(quotes)
    assert assessment.state == TermStructureState.BALANCED_CONCAVE_SURFACE
    assert assessment.directive == ConvexityExecutionDirective.HOLD_NEUTRAL
    assert abs(assessment.max_vol_spread_bps) < 10.0


def test_rich_middle_tenor_short_butterfly(engine):
    # Middle tenor T2 has elevated implied volatility
    quotes = [
        TenorQuote(tenor_years=0.10, implied_vol=0.18),
        TenorQuote(tenor_years=0.25, implied_vol=0.26),  # Rich by > 40 bps
        TenorQuote(tenor_years=0.50, implied_vol=0.20),
    ]
    assessment = engine.scan_term_structure(quotes)
    assert assessment.state == TermStructureState.POSITIVE_CONVEXITY_RICH_SPIKE
    assert assessment.directive == ConvexityExecutionDirective.EXECUTE_SHORT_CALENDAR_BUTTERFLY
    assert assessment.max_vol_spread_bps >= engine.rich_spread_threshold_bps


def test_cheap_middle_tenor_long_butterfly(engine):
    # Middle tenor T2 has deflated implied volatility (trough)
    quotes = [
        TenorQuote(tenor_years=0.10, implied_vol=0.24),
        TenorQuote(tenor_years=0.25, implied_vol=0.16),  # Cheap by < -40 bps
        TenorQuote(tenor_years=0.50, implied_vol=0.23),
    ]
    assessment = engine.scan_term_structure(quotes)
    assert assessment.state == TermStructureState.NEGATIVE_CONVEXITY_CHEAP_TROUGH
    assert assessment.directive == ConvexityExecutionDirective.EXECUTE_LONG_CALENDAR_BUTTERFLY
    assert assessment.max_vol_spread_bps <= engine.cheap_spread_threshold_bps


def test_vega_neutral_weights(engine):
    q1 = TenorQuote(tenor_years=0.10, implied_vol=0.20)
    q2 = TenorQuote(tenor_years=0.25, implied_vol=0.20)
    q3 = TenorQuote(tenor_years=0.50, implied_vol=0.20)

    trip = engine.analyze_triplet(q1, q2, q3)
    w_t1, w_t2, w_t3 = trip.vega_weights

    v1 = engine.compute_vega(q1.spot, q1.strike, q1.implied_vol, q1.tenor_years)
    v2 = engine.compute_vega(q2.spot, q2.strike, q2.implied_vol, q2.tenor_years)
    v3 = engine.compute_vega(q3.spot, q3.strike, q3.implied_vol, q3.tenor_years)

    # Net vega of butterfly: w_t1 * v1 + w_t2 * v2 + w_t3 * v3 should be ~0 (since w_t2 = -1)
    net_vega = w_t1 * v1 + (-1.0) * v2 + w_t3 * v3
    assert pytest.approx(net_vega, abs=0.1) == 0.0
