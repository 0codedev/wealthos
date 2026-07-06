"""
Unit Tests for Multi-Asset Synthetic Carry & Implied Yield Curve Arbitrage Sieve (Domain 161 / WP-BK)
"""

import pytest
from services.synthetic_carry_box_arb_sieve import (
    SyntheticCarryBoxArbSieve,
    OptionQuote,
    BoxSpreadInput,
    SyntheticCarryReport,
)


@pytest.fixture
def sieve():
    return SyntheticCarryBoxArbSieve(
        db_path=":memory:",
        spread_hurdle_bps=35.0,
    )


def test_box_spread_synthetic_lending_arbitrage(sieve):
    # NIFTY 24000 - 24500 Box Spread (Width = 500 points)
    # Expiry in 91 days (~0.25 yr). Benchmark G-Sec rate = 6.50% (0.065)
    # Fair discount price approx 500 * exp(-0.065 * 0.25) = 491.93
    # If the market misprices the box cheap at 485.00:
    # Implied rate = 4 * ln(500 / 485) = 4 * 0.03046 = 12.18%!
    # Lending spread = (12.18% - 6.50%) - 8 bps = +560 bps >> 35 bps
    c1 = OptionQuote(24000.0, bid=620.0, ask=622.0)
    p1 = OptionQuote(24000.0, bid=135.0, ask=137.0)
    c2 = OptionQuote(24500.0, bid=220.0, ask=222.0)
    p2 = OptionQuote(24500.0, bid=218.0, ask=220.0)

    # Buy cost = (Ask_C1 - Bid_P1) - (Bid_C2 - Ask_P2)
    #          = (622.0 - 135.0) - (220.0 - 220.0) = 487.0
    # Implied rate = (365 / 91) * ln(500 / 487) = 4.01 * 0.02635 = 10.57%
    inp = BoxSpreadInput(
        symbol="NIFTY",
        strike_1=24000.0,
        strike_2=24500.0,
        days_to_expiry=91.0,
        call_1=c1,
        put_1=p1,
        call_2=c2,
        put_2=p2,
        benchmark_yield_annual=0.065,
        friction_bps=8.0,
    )

    rep = sieve.evaluate_box_spread(inp)

    assert rep.box_width == 500.0
    assert rep.implied_lending_rate > rep.benchmark_rate
    assert rep.lending_spread_bps >= 35.0
    assert rep.regime == "SYNTHETIC_LENDING_CARRY_ARBITRAGE"
    assert rep.trade_directive == "BUY_BOX_LOCK_HIGH_SYNTHETIC_YIELD"


def test_box_spread_synthetic_borrowing_arbitrage(sieve):
    # Desk can SELL the box at 496.0 points (almost full width 500):
    # Implied borrowing cost = (365 / 91) * ln(500 / 496) = 4.01 * 0.00803 = 3.22%
    # Benchmark G-Sec yield = 6.50%
    # Borrow at 3.22%, lend to RBI / G-Sec at 6.50% -> Spread = +320 bps >> 35 bps
    c1 = OptionQuote(24000.0, bid=630.0, ask=632.0)
    p1 = OptionQuote(24000.0, bid=130.0, ask=132.0)
    c2 = OptionQuote(24500.0, bid=220.0, ask=222.0)
    p2 = OptionQuote(24500.0, bid=216.0, ask=218.0)

    # Proceeds = (Bid_C1 - Ask_P1) - (Ask_C2 - Bid_P2)
    #          = (630.0 - 132.0) - (222.0 - 216.0) = 498.0 - 6.0 = 492.0
    # Implied borrowing rate = 4.01 * ln(500 / 492) = 4.01 * 0.01613 = 6.47%
    # To get ultra-cheap borrowing (e.g. 3%), proceeds should be 496.0:
    c1_cheap = OptionQuote(24000.0, bid=634.0, ask=635.0)
    p1_cheap = OptionQuote(24000.0, bid=130.0, ask=131.0)
    c2_cheap = OptionQuote(24500.0, bid=220.0, ask=221.0)
    p2_cheap = OptionQuote(24500.0, bid=213.0, ask=214.0)
    # Proceeds = (634 - 131) - (221 - 213) = 503 - 8 = 495.0
    # Implied borrowing rate = 4.01 * ln(500 / 495) = 4.01 * 0.01005 = 4.03%

    inp = BoxSpreadInput(
        symbol="NIFTY",
        strike_1=24000.0,
        strike_2=24500.0,
        days_to_expiry=91.0,
        call_1=c1_cheap,
        put_1=p1_cheap,
        call_2=c2_cheap,
        put_2=p2_cheap,
        benchmark_yield_annual=0.065,
        friction_bps=8.0,
    )

    rep = sieve.evaluate_box_spread(inp)

    assert rep.implied_borrowing_rate < rep.benchmark_rate
    assert rep.borrowing_spread_bps >= 35.0
    assert rep.regime == "SYNTHETIC_BORROWING_CARRY_ARBITRAGE"
    assert rep.trade_directive == "SELL_BOX_BORROW_CHEAP_CASH"


def test_box_spread_fair_equilibrium(sieve):
    # Fairly priced box at 492.0 (implied rate ~6.5%)
    c1 = OptionQuote(24000.0, bid=622.0, ask=623.0)
    p1 = OptionQuote(24000.0, bid=130.0, ask=131.0)
    c2 = OptionQuote(24500.0, bid=220.0, ask=221.0)
    p2 = OptionQuote(24500.0, bid=220.0, ask=221.0)

    inp = BoxSpreadInput(
        symbol="NIFTY",
        strike_1=24000.0,
        strike_2=24500.0,
        days_to_expiry=91.0,
        call_1=c1,
        put_1=p1,
        call_2=c2,
        put_2=p2,
        benchmark_yield_annual=0.065,
        friction_bps=8.0,
    )

    rep = sieve.evaluate_box_spread(inp)

    assert rep.regime == "CARRY_EFFICIENT_MARKET_EQUILIBRIUM"
    assert rep.trade_directive == "NO_CARRY_EDGE_STAND_ASIDE"


def test_sqlite_persistence(sieve):
    c1 = OptionQuote(100.0, bid=10.0, ask=11.0)
    p1 = OptionQuote(100.0, bid=2.0, ask=3.0)
    c2 = OptionQuote(110.0, bid=4.0, ask=5.0)
    p2 = OptionQuote(110.0, bid=5.0, ask=6.0)

    inp = BoxSpreadInput("PERSIST_SYM", 100.0, 110.0, 30.0, c1, p1, c2, p2, 0.065)
    sieve.evaluate_box_spread(inp)

    conn = sieve._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, box_width, regime FROM synthetic_carry_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_SYM"
