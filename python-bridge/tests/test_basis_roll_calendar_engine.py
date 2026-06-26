"""
Unit Test Suite for Domain 264: Multi-Exchange Continuous Basis Roll Calendar Arbitrage & Funding Curve Interpolator
"""

import pytest
from services.basis_roll_calendar_engine import (
    BasisRollCalendarEngine,
    ContractTenorBasis,
    BasisTermStructureRegime,
    CalendarArbDirective,
)


@pytest.fixture
def engine():
    return BasisRollCalendarEngine(
        min_spread_hurdle_pct=6.0,
        butterfly_hurdle_pct=4.0,
        friction_pct=1.5,
    )


def test_smooth_term_structure_equilibrium(engine):
    # Front-month (30d) basis = 8.0% APR, Back-month (90d) basis = 9.5% APR -> Spread = 1.5% < 6.0%
    spot = 60_000.0
    # 8.0% for 30d -> price = spot * (1 + 0.08 * 30/365) = 60,000 * (1 + 0.006575) = 60,394.5
    p1 = spot * (1.0 + 0.08 * (30.0 / 365.0))
    # 9.5% for 90d -> price = spot * (1 + 0.095 * 90/365) = 60,000 * (1 + 0.023424) = 61,405.4
    p2 = spot * (1.0 + 0.095 * (90.0 / 365.0))

    contracts = [
        ContractTenorBasis("BTC-30D", 30.0, p1, spot),
        ContractTenorBasis("BTC-90D", 90.0, p2, spot),
    ]
    res = engine.evaluate_curve("BTC", contracts)
    assert res.regime == BasisTermStructureRegime.SMOOTH_TERM_STRUCTURE_EQUILIBRIUM
    assert res.directive == CalendarArbDirective.MONITOR_TERM_CURVE
    assert abs(res.roll_spread_pct) < 6.0


def test_actionable_calendar_roll_spread(engine):
    # Front-month (15d) basis = 4.0% APR, Back-month (45d) basis = 16.0% APR -> Spread = 12.0% >= 6.0%
    spot = 3000.0
    p1 = spot * (1.0 + 0.04 * (15.0 / 365.0))
    p2 = spot * (1.0 + 0.16 * (45.0 / 365.0))

    contracts = [
        ContractTenorBasis("ETH-15D", 15.0, p1, spot),
        ContractTenorBasis("ETH-45D", 45.0, p2, spot),
    ]
    res = engine.evaluate_curve("ETH", contracts)
    assert res.regime == BasisTermStructureRegime.ACTIONABLE_CALENDAR_ROLL_SPREAD
    assert res.directive == CalendarArbDirective.EXECUTE_CALENDAR_SPREAD_ROLL
    assert res.roll_spread_pct >= 10.0
    assert res.net_annualized_edge_pct > 8.0


def test_butterfly_curvature_arbitrage(engine):
    # 3 tenors: T1=30d (8% APR), T2=60d (20% APR! belly blown out), T3=90d (10% APR)
    # Benchmark at T2: (8 + 10)/2 = 9% APR -> Curvature = 20 - 9 = +11% APR >= 4.0%
    spot = 100.0
    p1 = spot * (1.0 + 0.08 * (30.0 / 365.0))
    p2 = spot * (1.0 + 0.20 * (60.0 / 365.0))
    p3 = spot * (1.0 + 0.10 * (90.0 / 365.0))

    contracts = [
        ContractTenorBasis("SOL-30D", 30.0, p1, spot),
        ContractTenorBasis("SOL-60D", 60.0, p2, spot),
        ContractTenorBasis("SOL-90D", 90.0, p3, spot),
    ]
    res = engine.evaluate_curve("SOL", contracts)
    assert res.regime == BasisTermStructureRegime.BUTTERFLY_CURVATURE_ARBITRAGE
    assert res.directive == CalendarArbDirective.EXECUTE_BUTTERFLY_CURVE_ARB
    assert res.curvature_dislocation_pct >= 8.0


def test_inversion_panic_backwardation(engine):
    # Front-month trading at deep backwardation (-25% APR)
    spot = 100.0
    p1 = spot * (1.0 - 0.25 * (10.0 / 365.0))
    p2 = spot * (1.0 + 0.02 * (40.0 / 365.0))

    contracts = [
        ContractTenorBasis("FRONT-SQUEEZE", 10.0, p1, spot),
        ContractTenorBasis("BACK", 40.0, p2, spot),
    ]
    res = engine.evaluate_curve("MEME", contracts)
    assert res.regime == BasisTermStructureRegime.INVERSION_PANIC_BACKWARDATION
    assert res.directive == CalendarArbDirective.UNWIND_BACKWARDATION_SQUEEZE
    assert res.front_tenor_yield_pct <= -15.0


def test_insufficient_contracts(engine):
    res = engine.evaluate_curve("SOLO", [ContractTenorBasis("SOLO-30D", 30.0, 100.0, 100.0)])
    assert res.regime == BasisTermStructureRegime.SMOOTH_TERM_STRUCTURE_EQUILIBRIUM
    assert res.directive == CalendarArbDirective.MONITOR_TERM_CURVE
