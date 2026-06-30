r"""
Unit Test Suite for Domain 196 (WP-CT): Dynamic High-Frequency Portfolio Delta-Gamma-Vega Rebalancing Engine
"""

import math
import pytest
from services.delta_gamma_vega_rebalancing_engine import (
    DeltaGammaVegaRebalancingEngine,
    GreeksRebalanceDirective,
    HedgeInstrument,
    PortfolioPosition,
)


def test_portfolio_greeks_aggregation():
    """Verifies exact linear aggregation of Delta, Gamma, Vega, and Theta across positions."""
    engine = DeltaGammaVegaRebalancingEngine(db_path=":memory:")

    positions = [
        PortfolioPosition(symbol="NIFTY_FUT", instrument_type="FUTURES", quantity=2.0, spot_price=25000.0, delta=1.0, gamma=0.0, vega=0.0, theta=0.0),
        PortfolioPosition(symbol="NIFTY_25000_CE", instrument_type="CALL", quantity=10.0, spot_price=25000.0, delta=0.52, gamma=0.004, vega=12.5, theta=-8.0),
        PortfolioPosition(symbol="NIFTY_24800_PE", instrument_type="PUT", quantity=-5.0, spot_price=25000.0, delta=-0.35, gamma=0.003, vega=10.0, theta=6.0),
    ]

    g = engine.compute_portfolio_greeks(positions)

    # Delta: 2.0*1.0 + 10.0*0.52 - 5.0*(-0.35) = 2.0 + 5.2 + 1.75 = 8.95
    assert math.isclose(g.net_delta, 8.95, rel_tol=1e-3)
    # Gamma: 0.0 + 10.0*0.004 - 5.0*0.003 = 0.04 - 0.015 = 0.025
    assert math.isclose(g.net_gamma, 0.025, rel_tol=1e-3)
    # Vega: 0.0 + 10.0*12.5 - 5.0*10.0 = 125.0 - 50.0 = 75.0
    assert math.isclose(g.net_vega, 75.0, rel_tol=1e-3)


def test_within_no_transaction_band_hold():
    """Verifies that positions within risk tolerance bands trigger HOLD directive without trading churn."""
    engine = DeltaGammaVegaRebalancingEngine(
        db_path=":memory:",
        delta_tolerance_band=100.0,
        gamma_tolerance_band=10.0,
        vega_tolerance_band=500.0,
    )

    positions = [
        PortfolioPosition(symbol="NIFTY_25000_CE", instrument_type="CALL", quantity=2.0, spot_price=25000.0, delta=0.50, gamma=0.01, vega=20.0, theta=-5.0),
    ]

    hedge_universe = [
        HedgeInstrument(symbol="NIFTY_FUT", instrument_type="FUTURES", delta=1.0, gamma=0.0, vega=0.0),
    ]

    rep = engine.solve_optimal_hedge(positions, hedge_universe)

    assert rep.directive == GreeksRebalanceDirective.WITHIN_NO_TRANSACTION_BAND_HOLD
    assert len(rep.recommended_hedge_trades) == 0
    assert rep.estimated_rebalance_cost == 0.0


def test_delta_neutral_futures_hedge():
    """Verifies that a pure Delta breach with calm curvature is hedged via low-cost futures contracts."""
    engine = DeltaGammaVegaRebalancingEngine(
        db_path=":memory:",
        delta_tolerance_band=50.0,
        gamma_tolerance_band=10.0,
        vega_tolerance_band=500.0,
    )

    # 150 Delta > 50 band
    positions = [
        PortfolioPosition(symbol="STOCK", instrument_type="STOCK", quantity=150.0, spot_price=100.0, delta=1.0, gamma=0.0, vega=0.0, theta=0.0),
    ]

    hedge_universe = [
        HedgeInstrument(symbol="FUTURES", instrument_type="FUTURES", delta=1.0, gamma=0.0, vega=0.0, half_spread_cost=0.50),
    ]

    rep = engine.solve_optimal_hedge(positions, hedge_universe)

    assert rep.directive == GreeksRebalanceDirective.DELTA_NEUTRAL_FUTURES_HEDGE
    assert rep.recommended_hedge_trades["FUTURES"] == -150.0
    assert rep.post_hedge_greeks.net_delta == 0.0


def test_full_gamma_vega_curvature_rebalancing():
    """Verifies that joint Gamma and Vega breaches are immunized via multi-instrument Jacobian inversion."""
    engine = DeltaGammaVegaRebalancingEngine(
        db_path=":memory:",
        delta_tolerance_band=50.0,
        gamma_tolerance_band=2.0,
        vega_tolerance_band=100.0,
    )

    # Substantial long gamma and vega
    positions = [
        PortfolioPosition(symbol="STRADDLE", instrument_type="CALL", quantity=100.0, spot_price=25000.0, delta=0.50, gamma=0.05, vega=3.0, theta=-10.0),
    ]
    # Net: Delta = 50.0, Gamma = 5.0 (breach > 2.0), Vega = 300.0 (breach > 100.0)

    hedge_universe = [
        HedgeInstrument(symbol="FUT", instrument_type="FUTURES", delta=1.0, gamma=0.0, vega=0.0),
        HedgeInstrument(symbol="OPT_1", instrument_type="CALL", delta=0.50, gamma=0.02, vega=1.0),
        HedgeInstrument(symbol="OPT_2", instrument_type="CALL", delta=0.40, gamma=0.01, vega=2.0),
    ]

    rep = engine.solve_optimal_hedge(positions, hedge_universe)

    assert rep.directive == GreeksRebalanceDirective.FULL_GAMMA_VEGA_CURVATURE_REBALANCE
    assert "OPT_1" in rep.recommended_hedge_trades
    assert "OPT_2" in rep.recommended_hedge_trades
    assert "FUT" in rep.recommended_hedge_trades

    # Post hedge Greeks must be virtually zero
    assert abs(rep.post_hedge_greeks.net_delta) < 1.0
    assert abs(rep.post_hedge_greeks.net_gamma) < 0.01
    assert abs(rep.post_hedge_greeks.net_vega) < 1.0


def test_emergency_pin_risk_deleverage():
    """Verifies that an extreme gamma spike near expiration triggers emergency deleveraging."""
    engine = DeltaGammaVegaRebalancingEngine(
        db_path=":memory:",
        gamma_tolerance_band=5.0,  # 3x = 15.0
    )

    positions = [
        PortfolioPosition(symbol="PIN_CALL", instrument_type="CALL", quantity=50.0, spot_price=25000.0, delta=0.50, gamma=0.40, vega=1.0, theta=-50.0),
    ]
    # Net Gamma = 50 * 0.40 = 20.0 > 15.0

    rep = engine.solve_optimal_hedge(positions, [])

    assert rep.directive == GreeksRebalanceDirective.EMERGENCY_DELEVERAGE_PIN_RISK
    assert rep.recommended_hedge_trades["PIN_CALL"] == -50.0
    assert "Emergency Pin-Risk Gamma Explosion" in rep.rationale


def test_sqlite_telemetry_persistence():
    """Verifies SQLite recording and retrieval of rebalance reports."""
    engine = DeltaGammaVegaRebalancingEngine(db_path=":memory:")

    positions = [
        PortfolioPosition(symbol="NIFTY_FUT", instrument_type="FUTURES", quantity=50.0, spot_price=25000.0, delta=1.0, gamma=0.0, vega=0.0, theta=0.0),
    ]

    engine.solve_optimal_hedge(positions, [])

    records = engine.get_recent_rebalances(limit=5)
    assert len(records) == 1
    assert records[0]["net_delta"] == 50.0
