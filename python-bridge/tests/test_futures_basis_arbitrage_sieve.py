"""
Unit Tests for Cross-Exchange Crypto / Futures Basis Curve Arbitrage Sieve (Domain 178 / WP-CB)
"""

import math
import pytest

from services.futures_basis_arbitrage_sieve import (
    FuturesBasisArbitrageSieve,
    BasisQuote,
    ContractType,
    ArbitrageDirective,
)


@pytest.fixture
def sieve():
    return FuturesBasisArbitrageSieve(db_path=":memory:", min_hurdle_apy_pct=8.0)


def test_cost_of_carry_theoretical_price(sieve):
    spot = 100.0
    r_f = 0.05
    days = 73.0  # 0.2 years
    # F* = 100 * exp(0.05 * 0.2) = 100 * exp(0.01) ~= 101.0050
    f_theo = sieve.calculate_cost_of_carry_price(spot, r_f, days)
    assert abs(f_theo - 101.005) < 0.01


def test_calendar_contango_cash_and_carry(sieve):
    # Spot 24,000, 30 DTE futures at 24,400 (+400 basis = +1.6667% for 1 month = ~20.27% APY)
    quote = BasisQuote(
        symbol="NIFTY_FUT",
        spot_price=24000.0,
        futures_price=24400.0,
        contract_type=ContractType.CALENDAR_FUTURES,
        days_to_expiry=30.0,
        taker_fee_bps=2.0,
        maker_fee_bps=1.0,
        slippage_bps=2.0,
    )
    res = sieve.evaluate_calendar_basis(quote)

    assert res.basis_bps > 150.0
    assert res.annualized_basis_apy > 18.0
    assert res.net_annualized_edge_pct >= 8.0
    assert res.directive == ArbitrageDirective.LONG_CASH_AND_CARRY
    assert "Strong contango basis" in res.rationale


def test_calendar_backwardation_reverse_cash_and_carry(sieve):
    # Spot 1000.0, Futures 970.0 (3% backwardation discount over 30 days = ~36.5% gross APY)
    quote = BasisQuote(
        symbol="TCS_FUT",
        spot_price=1000.0,
        futures_price=970.0,
        contract_type=ContractType.CALENDAR_FUTURES,
        days_to_expiry=30.0,
        spot_borrow_apr=0.06,  # 6% borrow cost
        taker_fee_bps=2.0,
        maker_fee_bps=1.0,
        slippage_bps=1.0,
    )
    res = sieve.evaluate_calendar_basis(quote)

    assert res.basis_bps < -250.0
    assert res.directive == ArbitrageDirective.REVERSE_CASH_AND_CARRY
    assert res.net_annualized_edge_pct > 15.0
    assert "Severe backwardation" in res.rationale


def test_perpetual_funding_rate_harvest(sieve):
    # Crypto BTC-PERP: Funding rate = 0.04% per 8 hours (0.0004) -> APY = 0.0004 * 3 * 365 = 43.8%
    quote = BasisQuote(
        symbol="BTC-PERP",
        spot_price=65000.0,
        futures_price=65100.0,
        contract_type=ContractType.PERPETUAL_SWAP,
        funding_rate_8h=0.0004,
        taker_fee_bps=4.0,
        maker_fee_bps=2.0,
        slippage_bps=2.0,
    )
    res = sieve.evaluate_perpetual_funding_basis(quote)

    assert abs(res.funding_apy - 43.8) < 0.1
    assert res.net_annualized_edge_pct > 20.0
    assert res.directive == ArbitrageDirective.PERP_FUNDING_RATE_HARVEST
    assert "Elevated perp funding rate" in res.rationale


def test_emergency_deleveraging_pinch(sieve):
    # Negative funding rate: shorts pay longs
    quote = BasisQuote(
        symbol="ETH-PERP",
        spot_price=3500.0,
        futures_price=3480.0,
        contract_type=ContractType.PERPETUAL_SWAP,
        funding_rate_8h=-0.0008,
    )
    res = sieve.evaluate_perpetual_funding_basis(quote)

    assert res.directive == ArbitrageDirective.EMERGENCY_DELEVERAGE_PINCH
    assert "Negative perp funding" in res.rationale


def test_basis_curve_and_sqlite_persistence(sieve):
    quotes = [
        BasisQuote(symbol="NIFTY_M1", spot_price=24000.0, futures_price=24150.0, days_to_expiry=15.0),
        BasisQuote(symbol="NIFTY_M2", spot_price=24000.0, futures_price=24350.0, days_to_expiry=45.0),
        BasisQuote(symbol="BTC-PERP", spot_price=65000.0, futures_price=65050.0, contract_type=ContractType.PERPETUAL_SWAP, funding_rate_8h=0.00035),
    ]
    results = sieve.evaluate_basis_curve(quotes)
    assert len(results) == 3

    telemetry = sieve.get_latest_telemetry(limit=5)
    assert len(telemetry) == 3
    symbols = [row[0] for row in telemetry]
    assert "BTC-PERP" in symbols
    assert "NIFTY_M1" in symbols
