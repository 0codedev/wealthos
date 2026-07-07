"""
Unit Test Suite for Domain 251: Multi-Exchange Continuous Triangular Flow Inversion & Atomic Flash Path Sentry
"""

import pytest
from services.triangular_flow_inversion_sentry import (
    TriangularFlowInversionSentry,
    LegQuote,
    TriangularPathInput,
    TriangularPathRegime,
    AtomicExecutionDirective,
)


@pytest.fixture
def sentry():
    return TriangularFlowInversionSentry(
        default_hurdle_bps=2.5,
        emergency_abort_loss_bps=-5.0,
    )


def test_negative_yield_equilibrium(sentry):
    # Standard equilibrium loop: USDT -> BTC -> ETH -> USDT
    # Leg 1: Buy BTC at 65,000 USDT
    # Leg 2: Buy ETH at 0.05 BTC (ETH = 3,250 USDT)
    # Leg 3: Sell ETH at 3,249 USDT (Gross rate = (1/65000) * (1/0.05) * 3249 = 0.999692 < 1.0)
    path = TriangularPathInput(
        path_id="USDT->BTC->ETH->USDT",
        base_currency="USDT",
        leg1=LegQuote("BTC/USDT", "BUY", 65000.0, available_volume=1.0),
        leg2=LegQuote("ETH/BTC", "BUY", 0.05, available_volume=20.0),
        leg3=LegQuote("ETH/USDT", "SELL", 3249.0, available_volume=20.0),
        min_capacity_base=500.0,
    )
    res = sentry.evaluate_path(path)
    assert res.regime == TriangularPathRegime.NEGATIVE_YIELD_EQUILIBRIUM
    assert res.directive == AtomicExecutionDirective.HOLD_OBSERVATION
    assert res.expected_profit_base == 0.0


def test_sub_economic_spread(sentry):
    # Gross edge exists (+5 bps), but fees are 3 * 4 = 12 bps, slippage is 3 bps
    # Leg 1: Buy BTC at 65,000
    # Leg 2: Buy ETH at 0.05 BTC
    # Leg 3: Sell ETH at 3251.625 (+5 bps) -> net will be negative
    path = TriangularPathInput(
        path_id="USDT->BTC->ETH->USDT",
        base_currency="USDT",
        leg1=LegQuote("BTC/USDT", "BUY", 65000.0, available_volume=1.0, taker_fee_bps=4.0, expected_slip_bps=1.0),
        leg2=LegQuote("ETH/BTC", "BUY", 0.05, available_volume=20.0, taker_fee_bps=4.0, expected_slip_bps=1.0),
        leg3=LegQuote("ETH/USDT", "SELL", 3251.625, available_volume=20.0, taker_fee_bps=4.0, expected_slip_bps=1.0),
        min_capacity_base=500.0,
    )
    res = sentry.evaluate_path(path)
    assert res.regime == TriangularPathRegime.SUB_ECONOMIC_SPREAD
    assert res.directive == AtomicExecutionDirective.HOLD_OBSERVATION
    assert res.expected_profit_base == 0.0


def test_profitable_triangular_path(sentry):
    # Discrepancy yielding +25 bps gross. Total fees = 6 bps (2 bps per leg VIP), slip = 3 bps. Net = ~16 bps > 2.5 bps hurdle.
    # Leg 1: Buy BTC at 60,000 USDT
    # Leg 2: Buy ETH at 0.05 BTC (Synthetic ETH = 3,000 USDT)
    # Leg 3: Sell ETH at 3,007.5 USDT (+25 bps gross)
    path = TriangularPathInput(
        path_id="USDT->BTC->ETH->USDT",
        base_currency="USDT",
        leg1=LegQuote("BTC/USDT", "BUY", 60000.0, available_volume=2.0, taker_fee_bps=2.0, expected_slip_bps=1.0),
        leg2=LegQuote("ETH/BTC", "BUY", 0.05, available_volume=40.0, taker_fee_bps=2.0, expected_slip_bps=1.0),
        leg3=LegQuote("ETH/USDT", "SELL", 3007.5, available_volume=40.0, taker_fee_bps=2.0, expected_slip_bps=1.0),
        min_capacity_base=1000.0,
    )
    res = sentry.evaluate_path(path)
    assert res.regime == TriangularPathRegime.PROFITABLE_TRIANGULAR_PATH
    assert res.directive == AtomicExecutionDirective.DISPATCH_ATOMIC_TRIANGLE_IOC
    assert res.net_edge_bps > 10.0
    assert res.bottleneck_capacity_base >= 1000.0
    assert res.expected_profit_base > 0.0


def test_bottleneck_liquidity_violation(sentry):
    # Great price edge, but leg 2 has only 0.001 ETH available (odd-lot trap)
    path = TriangularPathInput(
        path_id="USDT->BTC->ETH->USDT",
        base_currency="USDT",
        leg1=LegQuote("BTC/USDT", "BUY", 60000.0, available_volume=2.0, taker_fee_bps=2.0, expected_slip_bps=1.0),
        leg2=LegQuote("ETH/BTC", "BUY", 0.05, available_volume=0.001, taker_fee_bps=2.0, expected_slip_bps=1.0), # $60 volume!
        leg3=LegQuote("ETH/USDT", "SELL", 3007.5, available_volume=40.0, taker_fee_bps=2.0, expected_slip_bps=1.0),
        min_capacity_base=1000.0,
    )
    res = sentry.evaluate_path(path)
    assert res.regime == TriangularPathRegime.BOTTLENECK_LIQUIDITY_VIOLATION
    assert res.directive == AtomicExecutionDirective.HOLD_OBSERVATION
    assert res.expected_profit_base == 0.0


def test_in_flight_emergency_abort(sentry):
    # In-flight path experiences severe mid-trade slippage (-10 bps realized)
    path = TriangularPathInput(
        path_id="USDT->BTC->ETH->USDT",
        base_currency="USDT",
        leg1=LegQuote("BTC/USDT", "BUY", 60000.0, available_volume=2.0, taker_fee_bps=4.0, expected_slip_bps=2.0),
        leg2=LegQuote("ETH/BTC", "BUY", 0.05, available_volume=40.0, taker_fee_bps=4.0, expected_slip_bps=2.0),
        leg3=LegQuote("ETH/USDT", "SELL", 3000.0, available_volume=40.0, taker_fee_bps=4.0, expected_slip_bps=2.0),
        min_capacity_base=500.0,
        is_in_flight=True,
        intermediate_fill_slip_bps=20.0, # Massive slippage during execution
    )
    res = sentry.evaluate_path(path)
    assert res.regime == TriangularPathRegime.INVERSION_FLASH_ABORT
    assert res.directive == AtomicExecutionDirective.ABORT_ATOMIC_UNWIND_REMAINDER
