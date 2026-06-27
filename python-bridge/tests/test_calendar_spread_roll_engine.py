"""
Unit Tests for Cross-Maturity Calendar Spread Term Structure & Roll Yield Harvester (Domain 141 / WP-AQ)
"""

from datetime import datetime
import pytest

from services.calendar_spread_roll_engine import (
    CalendarSpreadRollEngine,
    FuturesTermStructure,
    CalendarSpreadReport,
)


@pytest.fixture
def roll_engine():
    return CalendarSpreadRollEngine(
        mispricing_arbitrage_bps=20.0,
        super_contango_yield_pct=-12.0,
        db_path=":memory:",
    )


def test_calculate_theoretical_spread(roll_engine):
    ts = FuturesTermStructure(
        spot_price=25000.0,
        near_month_symbol="NIFTY26OCTFUT",
        near_month_price=25025.0,
        near_month_days_to_expiry=7.0,
        next_month_symbol="NIFTY26NOVFUT",
        next_month_price=25126.0,
        next_month_days_to_expiry=35.0,
        risk_free_rate=0.065,
        dividend_yield=0.012,
    )
    # Carry = 5.3% -> 25000 * 0.053 * (28/365) = ~101.6 pts
    fair = roll_engine.calculate_theoretical_spread(ts)
    assert 95.0 <= fair <= 110.0


def test_backwardation_inverted_regime(roll_engine):
    # Inverted market: Next month trades at a discount to Near month
    ts = FuturesTermStructure(
        spot_price=25000.0,
        near_month_symbol="NIFTY26OCTFUT",
        near_month_price=25100.0,
        near_month_days_to_expiry=3.0,
        next_month_symbol="NIFTY26NOVFUT",
        next_month_price=25020.0,
        next_month_days_to_expiry=31.0,
        risk_free_rate=0.065,
        dividend_yield=0.012,
    )
    rep = roll_engine.evaluate_term_structure(ts)

    assert rep.market_spread_pts == -80.0
    assert rep.annualized_roll_yield_pct > 0.0  # Positive roll yield!
    assert rep.market_structure == "BACKWARDATION_INVERTED"
    assert rep.optimal_roll_timing == "ROLL_NOW"
    assert rep.arbitrage_signal == "LONG_CALENDAR_SPREAD"
    assert "backwardation" in rep.rationale


def test_super_contango_overpriced_regime(roll_engine):
    # Super contango: Next month is ₹250 above Near (far above theoretical fair ~₹100)
    ts = FuturesTermStructure(
        spot_price=25000.0,
        near_month_symbol="NIFTY26OCTFUT",
        near_month_price=25000.0,
        near_month_days_to_expiry=2.0,  # Expiry week (<= 4 days)
        next_month_symbol="NIFTY26NOVFUT",
        next_month_price=25250.0,
        next_month_days_to_expiry=30.0,
        risk_free_rate=0.065,
        dividend_yield=0.012,
    )
    rep = roll_engine.evaluate_term_structure(ts)

    assert rep.market_structure == "SUPER_CONTANGO_OVERPRICED"
    assert rep.spread_mispricing_bps >= 20.0
    assert rep.optimal_roll_timing == "DELAY_ROLL"
    assert rep.arbitrage_signal == "SHORT_CALENDAR_SPREAD"


def test_underpriced_spread_arbitrage(roll_engine):
    # Underpriced spread: Next month is only ₹20 above Near (fair is ~₹100)
    ts = FuturesTermStructure(
        spot_price=25000.0,
        near_month_symbol="NIFTY26OCTFUT",
        near_month_price=25000.0,
        near_month_days_to_expiry=10.0,
        next_month_symbol="NIFTY26NOVFUT",
        next_month_price=25020.0,
        next_month_days_to_expiry=38.0,
        risk_free_rate=0.065,
        dividend_yield=0.012,
    )
    rep = roll_engine.evaluate_term_structure(ts)

    assert rep.market_structure == "UNDERPRICED_SPREAD"
    assert rep.spread_mispricing_bps <= -20.0
    assert rep.arbitrage_signal == "LONG_CALENDAR_SPREAD"


def test_sqlite_persistence(roll_engine):
    ts = FuturesTermStructure(
        spot_price=25000.0,
        near_month_symbol="NIFTY26OCTFUT",
        near_month_price=25050.0,
        near_month_days_to_expiry=15.0,
        next_month_symbol="NIFTY26NOVFUT",
        next_month_price=25150.0,
        next_month_days_to_expiry=43.0,
        risk_free_rate=0.065,
        dividend_yield=0.012,
    )
    roll_engine.evaluate_term_structure(ts)

    conn = roll_engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT spot, market_spread, structure FROM calendar_spread_telemetry WHERE spot = 25000.0")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == 25000.0
    assert row[1] == 100.0
