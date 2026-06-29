"""
Unit Test Suite for Domain 262: Cross-Asset Realized Correlation Dispersion & Multi-Factor Eigen-Variance Arbitrage Engine
"""

import pytest
from services.correlation_dispersion_eigen_engine import (
    CorrelationDispersionEigenEngine,
    ComponentVarianceInput,
    DispersionMarketState,
    DispersionArbitrageRegime,
    DispersionTradingDirective,
)


@pytest.fixture
def engine():
    return CorrelationDispersionEigenEngine(
        crp_entry_threshold=0.15,
        systemic_corr_ceiling=0.85,
        min_net_edge_pct=6.0,
    )


def test_dispersion_equilibrium(engine):
    # Both implied and realized correlation ~ 0.50 -> CRP ~ 0.0
    comps = [
        ComponentVarianceInput("AAPL", 0.5, implied_vol=0.25, realized_vol=0.20),
        ComponentVarianceInput("MSFT", 0.5, implied_vol=0.25, realized_vol=0.20),
    ]
    # For equal weights and equal vols sigma, rho = (sigma_idx^2 - 0.5*sigma^2) / (sigma^2 - 0.5*sigma^2)
    # If sigma_idx = 0.2165 (approx 0.25 * sqrt(0.75)), rho ~ 0.50
    state = DispersionMarketState(
        index_symbol="TECH2",
        index_implied_vol=0.2165,
        index_realized_vol=0.1732,
        components=comps,
    )
    res = engine.evaluate_dispersion(state)
    assert res.regime == DispersionArbitrageRegime.DISPERSION_EQUILIBRIUM
    assert res.directive == DispersionTradingDirective.MAINTAIN_PASSIVE_MONITORING
    assert abs(res.correlation_risk_premium) < 0.15


def test_correlation_premium_short_index_long_basket(engine):
    # High implied correlation (0.75) vs moderate realized correlation (0.30) -> CRP = +0.45 >= +0.15
    comps = [
        ComponentVarianceInput("AAPL", 0.333, implied_vol=0.35, realized_vol=0.30),
        ComponentVarianceInput("MSFT", 0.333, implied_vol=0.35, realized_vol=0.30),
        ComponentVarianceInput("GOOG", 0.334, implied_vol=0.35, realized_vol=0.30),
    ]
    # High index implied vol (0.32) -> high implied correlation
    # Low index realized vol (0.20) -> low realized correlation
    state = DispersionMarketState(
        index_symbol="SPX",
        index_implied_vol=0.32,
        index_realized_vol=0.20,
        components=comps,
    )
    res = engine.evaluate_dispersion(state)
    assert res.regime == DispersionArbitrageRegime.CORRELATION_PREMIUM_SHORT_INDEX_LONG_BASKET
    assert res.directive == DispersionTradingDirective.EXECUTE_SHORT_INDEX_LONG_BASKET
    assert res.correlation_risk_premium > 0.20
    assert res.net_annualized_edge_pct >= engine.min_net_edge_pct


def test_systemic_correlation_spike_defense(engine):
    # Realized correlation spikes to 0.92 (macro crash / lockstep panic)
    comps = [
        ComponentVarianceInput("A", 0.5, implied_vol=0.40, realized_vol=0.40),
        ComponentVarianceInput("B", 0.5, implied_vol=0.40, realized_vol=0.40),
    ]
    # For equal weights and equal vols: rho = (sigma_idx^2 - 0.5 * 0.16) / 0.08
    # If sigma_idx = 0.392 -> rho ~ 0.92
    state = DispersionMarketState(
        index_symbol="CRASH_INDEX",
        index_implied_vol=0.395,
        index_realized_vol=0.392,
        components=comps,
    )
    res = engine.evaluate_dispersion(state)
    assert res.regime == DispersionArbitrageRegime.SYSTEMIC_CORRELATION_SPIKE_DEFENSE
    assert res.directive == DispersionTradingDirective.EMERGENCY_DISPERSION_CIRCUIT_ABORT
    assert res.realized_correlation >= 0.85


def test_empty_components(engine):
    state = DispersionMarketState(
        index_symbol="EMPTY",
        index_implied_vol=0.20,
        index_realized_vol=0.15,
        components=[],
    )
    res = engine.evaluate_dispersion(state)
    assert res.regime == DispersionArbitrageRegime.DISPERSION_EQUILIBRIUM
    assert res.directive == DispersionTradingDirective.MAINTAIN_PASSIVE_MONITORING
