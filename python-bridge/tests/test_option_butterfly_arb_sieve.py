"""
Unit Tests for Real-Time Options Implied Volatility Surface Arb & Butterfly Sieve (Domain 142 / WP-AR)
"""

from datetime import datetime
import pytest

from services.option_butterfly_arb_sieve import (
    OptionButterflyArbSieve,
    OptionQuote,
    ArbitrageOpportunity,
    SurfaceArbitrageReport,
)


@pytest.fixture
def arb_sieve():
    return OptionButterflyArbSieve(
        friction_hurdle_pts=0.50,
        db_path=":memory:",
    )


def test_no_arbitrage_clean_surface(arb_sieve):
    quotes = [
        OptionQuote(25000.0, "CE", 150.0, 152.0, 25),
        OptionQuote(25050.0, "CE", 110.0, 112.0, 25),
        OptionQuote(25100.0, "CE", 75.0, 77.0, 25),
    ]
    rep = arb_sieve.scan_chain_arbitrage(quotes)

    assert rep.total_opportunities == 0
    assert rep.regime == "NO_ARBITRAGE_CONSISTENT"
    assert "strictly satisfies" in rep.rationale


def test_vertical_call_spread_arbitrage(arb_sieve):
    # Inverted vertical: 25050 CE Bid is 110, while 25000 CE Ask is 100
    quotes = [
        OptionQuote(25000.0, "CE", 98.0, 100.0, 25),
        OptionQuote(25050.0, "CE", 110.0, 112.0, 25),
    ]
    rep = arb_sieve.scan_chain_arbitrage(quotes)

    assert rep.total_opportunities == 1
    assert rep.regime == "STATIC_ARBITRAGE_DETECTED"
    opp = rep.opportunities[0]
    assert opp.arb_type == "VERTICAL_MONOTONICITY_VIOLATION"
    assert opp.option_type == "CE"
    assert opp.guaranteed_profit_inr > 200.0  # (10 - 0.5) * 25 = 237.5 INR


def test_vertical_put_spread_arbitrage(arb_sieve):
    # Inverted put: Lower strike 25000 PE Bid is 80, while higher strike 25050 PE Ask is 70
    quotes = [
        OptionQuote(25000.0, "PE", 80.0, 82.0, 25),
        OptionQuote(25050.0, "PE", 68.0, 70.0, 25),
    ]
    rep = arb_sieve.scan_chain_arbitrage(quotes)

    assert rep.total_opportunities == 1
    opp = rep.opportunities[0]
    assert opp.arb_type == "VERTICAL_MONOTONICITY_VIOLATION"
    assert opp.option_type == "PE"
    assert opp.guaranteed_profit_inr > 200.0


def test_butterfly_convexity_arbitrage(arb_sieve):
    # Equidistant strikes: 25000 (Ask 100), 25050 (Bid 80), 25100 (Ask 50)
    # Fly cost = 100 - 2*80 + 50 = -10 pts (receive 10 pts upfront!)
    quotes = [
        OptionQuote(25000.0, "CE", 98.0, 100.0, 25),
        OptionQuote(25050.0, "CE", 80.0, 82.0, 25),
        OptionQuote(25100.0, "CE", 48.0, 50.0, 25),
    ]
    rep = arb_sieve.scan_chain_arbitrage(quotes)

    assert rep.total_opportunities >= 1
    fly_opps = [o for o in rep.opportunities if o.arb_type == "BUTTERFLY_CONVEXITY_VIOLATION"]
    assert len(fly_opps) == 1
    opp = fly_opps[0]
    assert opp.strikes == (25000.0, 25050.0, 25100.0)
    assert opp.execution_net_cost_pts == -10.0
    assert opp.guaranteed_profit_inr == (10.0 - 0.50) * 25  # 237.5 INR


def test_sqlite_persistence(arb_sieve):
    quotes = [
        OptionQuote(25000.0, "CE", 98.0, 100.0, 25),
        OptionQuote(25050.0, "CE", 110.0, 112.0, 25),
    ]
    arb_sieve.scan_chain_arbitrage(quotes)

    conn = arb_sieve._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT arb_type, option_type, profit_inr FROM option_butterfly_arb_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "VERTICAL_MONOTONICITY_VIOLATION"
    assert row[1] == "CE"
