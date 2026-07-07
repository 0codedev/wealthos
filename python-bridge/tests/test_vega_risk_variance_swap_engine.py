"""
Unit Tests for Cross-Strike Vega Risk Budgeting & Dynamic Variance Swap Rebalancer (Domain 133 / WP-AI)
"""

from datetime import datetime
import pytest

from services.vega_risk_variance_swap_engine import (
    VegaRiskVarianceSwapEngine,
    OptionPosition,
    OptionGreeks,
    PortfolioVegaReport,
)


@pytest.fixture
def vega_engine():
    return VegaRiskVarianceSwapEngine(
        vega_budget_inr=50000.0,
        db_path=":memory:",
    )


def test_calculate_greeks(vega_engine):
    # ATM NIFTY Call: Spot 25000, Strike 25000, 7 days to expiry, 15% IV, 1 lot (25 shares)
    pos = OptionPosition(
        strike=25000.0,
        expiry_days=7.0,
        option_type="CE",
        quantity=1,
        iv=0.15,
        spot=25000.0,
        rate=0.065,
        lot_size=25,
    )
    g = vega_engine.calculate_greeks(pos)

    assert g.price > 100.0
    assert g.vega > 0.0  # Long option has positive Vega
    assert g.theta < 0.0  # Long option bleeds daily theta
    assert g.volga > 0.0


def test_replicate_fair_variance(vega_engine):
    # Construct a flat 15% IV strike chain around 25000
    spot = 25000.0
    strikes = [24600.0, 24800.0, 25000.0, 25200.0, 25400.0]
    chain = []
    for k in strikes:
        opt_type = "PE" if k <= 25000.0 else "CE"
        pos = OptionPosition(k, 14.0, opt_type, 1, 0.15, spot, 0.065, 25)
        g = vega_engine.calculate_greeks(pos)
        chain.append((k, opt_type, g.price))

    fair_var, fair_vol = vega_engine.replicate_fair_variance(spot, 14.0, 0.065, chain)
    assert fair_var > 0.0
    # For a 5-strike discrete truncated grid around ATM, captures ~12-16%
    assert 11.0 <= fair_vol <= 17.0


def test_portfolio_vega_within_budget(vega_engine):
    # Small position: 2 lots long 25000 CE
    positions = [
        OptionPosition(25000.0, 7.0, "CE", 2, 0.15, 25000.0, 0.065, 25),
        OptionPosition(25000.0, 7.0, "PE", 2, 0.15, 25000.0, 0.065, 25),
    ]
    rep = vega_engine.evaluate_portfolio_risk(positions)

    assert rep.is_within_budget is True
    assert rep.hedging_required is False
    assert rep.hedge_action is None
    assert rep.total_vega_inr < 50000.0


def test_portfolio_vega_breach_and_hedge_action(vega_engine):
    # Massive long position: 120 lots long ATM CE -> Net Vega ~ ₹58,000+ > ₹50,000 limit
    positions = [
        OptionPosition(25000.0, 14.0, "CE", 120, 0.15, 25000.0, 0.065, 25),
    ]
    rep = vega_engine.evaluate_portfolio_risk(positions)

    assert rep.is_within_budget is False
    assert rep.hedging_required is True
    assert rep.hedge_action is not None
    assert "SELL" in rep.hedge_action
    assert rep.total_vega_inr > 50000.0


def test_sqlite_persistence(vega_engine):
    positions = [
        OptionPosition(25000.0, 7.0, "CE", 1, 0.15, 25000.0, 0.065, 25),
    ]
    vega_engine.evaluate_portfolio_risk(positions)

    conn = vega_engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT total_vega, is_within_budget FROM vega_risk_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[1] == 1  # True
