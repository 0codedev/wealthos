"""
Unit Test Suite for Domain 249: Cross-Exchange Crypto Perpetual-Spot Basis & Cointegrated Funding Rate Arb Engine
"""

import pytest
from services.perp_spot_basis_funding_arb_engine import (
    PerpSpotBasisFundingArbEngine,
    PerpSpotMarketState,
    ArbExecutionRegime,
    FundingActionDirective,
)


@pytest.fixture
def engine():
    return PerpSpotBasisFundingArbEngine(
        z_entry_threshold=1.75,
        z_exit_threshold=0.35,
        z_emergency_threshold=4.0,
        min_net_yield_hurdle_pct=8.0,
        round_trip_fee_bps=10.0,
    )


def test_neutral_equilibrium(engine):
    # Basis is near zero, funding is small
    state = PerpSpotMarketState(
        symbol="BTC/USDT",
        perp_venue="BINANCE_FUTURES",
        spot_venue="COINBASE",
        perp_price=65010.0,
        spot_price=65000.0,
        funding_rate_8h=0.0001,  # 0.01% per 8h = ~10.95% APR
        hours_to_funding=4.0,
        annualized_borrow_rate=0.06,  # 6% APR
        historical_basis_mean_bps=1.5,
        historical_basis_std_bps=5.0,
        cointegration_beta=1.0,
        mean_reversion_half_life_hours=12.0,
    )
    res = engine.evaluate(state)
    assert res.regime == ArbExecutionRegime.NEUTRAL_EQUILIBRIUM
    assert res.directive == FundingActionDirective.HOLD_PASSIVE_CARRY
    assert res.capital_allocation_pct == 0.0


def test_cash_and_carry_entry(engine):
    # Perpetual trading at premium ($65,500 vs $65,000 spot = +76.9 bps basis)
    # Basis z-score = (76.9 - 2.0) / 10.0 = 7.49 (wait, let's keep it under 4.0 emergency threshold!)
    # Let's calibrate: mean = 0, std = 20.0 bps. Basis = 45 bps -> z = 2.25
    state = PerpSpotMarketState(
        symbol="ETH/USDT",
        perp_venue="OKX_PERP",
        spot_venue="KRAKEN",
        perp_price=3515.75,
        spot_price=3500.0,  # Basis = 45 bps
        funding_rate_8h=0.0004,  # +0.04% per 8h = 43.8% APR
        hours_to_funding=2.0,
        annualized_borrow_rate=0.05,  # 5% APR
        historical_basis_mean_bps=0.0,
        historical_basis_std_bps=20.0,
        cointegration_beta=1.0,
        mean_reversion_half_life_hours=16.0,
    )
    res = engine.evaluate(state)
    assert res.regime == ArbExecutionRegime.CASH_AND_CARRY_LONG_SPOT_SHORT_PERP
    assert res.directive == FundingActionDirective.DEPLOY_BASIS_CARRY_LEG
    assert res.basis_z_score == 2.25
    assert res.annualized_funding_yield_pct > 40.0
    assert res.net_annualized_edge_pct >= engine.min_net_yield_hurdle_pct
    assert res.capital_allocation_pct >= 50.0


def test_reverse_cash_and_carry_entry(engine):
    # Perpetual trading at deep discount ($98.5 vs $100.0 spot = -150 bps basis)
    # Negative funding: -0.05% per 8h (-54.75% APR)
    # Mean = 0, std = 60.0 bps -> z = -2.50
    state = PerpSpotMarketState(
        symbol="SOL/USDT",
        perp_venue="BYBIT_PERP",
        spot_venue="BINANCE_SPOT",
        perp_price=98.5,
        spot_price=100.0,
        funding_rate_8h=-0.0005,
        hours_to_funding=3.0,
        annualized_borrow_rate=0.04,
        historical_basis_mean_bps=0.0,
        historical_basis_std_bps=60.0,
        cointegration_beta=1.0,
        mean_reversion_half_life_hours=8.0,
    )
    res = engine.evaluate(state)
    assert res.regime == ArbExecutionRegime.REVERSE_CASH_AND_CARRY_SHORT_SPOT_LONG_PERP
    assert res.directive == FundingActionDirective.DEPLOY_BASIS_CARRY_LEG
    assert res.basis_z_score == -2.50
    assert res.net_annualized_edge_pct >= engine.min_net_yield_hurdle_pct
    assert res.capital_allocation_pct >= 50.0


def test_emergency_depeg_unwind(engine):
    # Severe dislocation: Spot = $100, Perp = $115 (+1500 bps, z > 10)
    state = PerpSpotMarketState(
        symbol="LUNA/USDT",
        perp_venue="BINANCE_FUTURES",
        spot_venue="COINBASE",
        perp_price=115.0,
        spot_price=100.0,
        funding_rate_8h=0.0050,
        hours_to_funding=1.0,
        annualized_borrow_rate=0.10,
        historical_basis_mean_bps=0.0,
        historical_basis_std_bps=20.0,
        cointegration_beta=1.0,
        mean_reversion_half_life_hours=12.0,
    )
    res = engine.evaluate(state)
    assert res.regime == ArbExecutionRegime.EMERGENCY_DEPEG_UNWIND
    assert res.directive == FundingActionDirective.EMERGENCY_CIRCUIT_ABORT
    assert res.capital_allocation_pct == 0.0


def test_convergence_unwind_trigger(engine):
    # Active position exists, basis has converged to z = 0.20 <= 0.35
    state = PerpSpotMarketState(
        symbol="BTC/USDT",
        perp_venue="BINANCE_FUTURES",
        spot_venue="COINBASE",
        perp_price=65005.0,
        spot_price=65000.0,  # Basis = +0.77 bps
        funding_rate_8h=0.0001,
        hours_to_funding=5.0,
        annualized_borrow_rate=0.05,
        historical_basis_mean_bps=0.0,
        historical_basis_std_bps=10.0,
        cointegration_beta=1.0,
        mean_reversion_half_life_hours=12.0,
        active_position_regime=ArbExecutionRegime.CASH_AND_CARRY_LONG_SPOT_SHORT_PERP,
    )
    res = engine.evaluate(state)
    assert res.regime == ArbExecutionRegime.NEUTRAL_EQUILIBRIUM
    assert res.directive == FundingActionDirective.UNWIND_CONVERGENCE_TARGET
    assert res.capital_allocation_pct == 0.0
