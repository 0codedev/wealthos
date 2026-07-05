"""
Unit Tests for Post-Earnings Announcement Drift (PEAD) & Standardized Unexpected Earnings Sieve (Domain 151 / WP-BA)
"""

import math
import pytest

from services.pead_earnings_sieve import (
    PEADEarningsSieve,
    QuarterlyEarningsReport,
    PEADAnalysisReport,
)


@pytest.fixture
def sieve():
    return PEADEarningsSieve(
        db_path=":memory:",
        sue_hurdle=1.80,
    )


def test_bullish_pead_underreaction(sieve):
    # Consistent 2.0 YoY EPS growth: Q_t-4 was 12.0, expected = 12.0 + 2.0 = 14.0
    # Reported is 18.0 (huge beat of 4.0). Day 0-1 reaction is only +1.5% -> Underreaction!
    history = [10.0, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5]
    report = QuarterlyEarningsReport(
        symbol="TCS",
        reported_eps=18.0,
        historical_eps=history,
        revenue_surprise_pct=5.0,
        car_day0_day1=0.015,
    )
    rep = sieve.evaluate_pead(report)

    assert rep.unexpected_earnings > 0.0
    assert rep.sue_score >= 1.80
    assert rep.pead_momentum_score > 0.60
    assert rep.regime == "PEAD_BULLISH_UNDERREACTION"
    assert rep.trade_directive == "ACCUMULATE_LONG_PEAD_MOMENTUM_RUNNER"
    assert rep.expected_drift_horizon_days == 45


def test_priced_in_exhaustion_day1(sieve):
    # Same huge beat, but stock already rallied +10% on Day 0-1
    history = [10.0, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5]
    report = QuarterlyEarningsReport(
        symbol="TCS",
        reported_eps=18.0,
        historical_eps=history,
        revenue_surprise_pct=5.0,
        car_day0_day1=0.10,
    )
    rep = sieve.evaluate_pead(report)

    assert rep.sue_score >= 1.80
    assert rep.regime == "PEAD_PRICED_IN_OR_EXHAUSTED"
    assert rep.trade_directive == "HOLD_OR_TAKE_PROFIT_DAY_1"
    assert rep.expected_drift_horizon_days == 5


def test_bearish_pead_underreaction(sieve):
    # Expected is 14.0, reported is 10.0 (miss of -4.0). Day 0-1 down only -1%
    history = [10.0, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5]
    report = QuarterlyEarningsReport(
        symbol="INFY",
        reported_eps=10.0,
        historical_eps=history,
        revenue_surprise_pct=-4.0,
        car_day0_day1=-0.01,
    )
    rep = sieve.evaluate_pead(report)

    assert rep.unexpected_earnings < 0.0
    assert rep.sue_score <= -1.80
    assert rep.pead_momentum_score < -0.60
    assert rep.regime == "PEAD_BEARISH_UNDERREACTION"
    assert rep.trade_directive == "SHORT_OR_DISTRIBUTE_EQUITY_RISK"
    assert rep.expected_drift_horizon_days == 45


def test_neutral_earnings_consensus(sieve):
    # Expected is ~14.0, reported is 14.05
    history = [10.0, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5]
    report = QuarterlyEarningsReport(
        symbol="HDFCBANK",
        reported_eps=14.05,
        historical_eps=history,
        revenue_surprise_pct=0.2,
        car_day0_day1=0.002,
    )
    rep = sieve.evaluate_pead(report)

    assert abs(rep.sue_score) < 0.80
    assert rep.regime == "NEUTRAL_EARNINGS_CONSENSUS"
    assert rep.trade_directive == "NO_PEAD_EDGE_MAINTAIN_PORTFOLIO"
    assert rep.expected_drift_horizon_days == 0


def test_sqlite_persistence(sieve):
    history = [10.0, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5]
    report = QuarterlyEarningsReport("PERSIST_SYM", 15.0, history)
    sieve.evaluate_pead(report)

    conn = sieve._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, reported_eps, sue_score, regime FROM pead_sue_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_SYM"
    assert row[1] == 15.0
    assert isinstance(row[3], str)
