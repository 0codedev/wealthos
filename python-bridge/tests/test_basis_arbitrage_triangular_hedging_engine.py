r"""Unit Tests for Multi-Exchange Cross-Asset Basis Arbitrage & Triangular Hedging Engine (Domain 207 / WP-DE)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.basis_arbitrage_triangular_hedging_engine import (
    BasisArbitrageTriangularHedgingEngine,
    BasisArbitrageType,
    MarginRiskState,
)


@pytest.fixture
def engine() -> BasisArbitrageTriangularHedgingEngine:
    return BasisArbitrageTriangularHedgingEngine(
        borrowing_rate_pct=6.50,
        lending_rate_pct=5.00,
        min_basis_edge_bps=30.0,
        min_triangular_edge_bps=2.0,
        default_taker_fee_bps=1.5,
    )


def test_cash_and_carry_profitable_basis(engine: BasisArbitrageTriangularHedgingEngine):
    # Spot 25000, Futures 25250 in 30 days
    # Annualized basis: (250 / 25000) * (365 / 30) = 1.0% * 12.167 = 12.167%
    # Fair basis: 6.5 - 1.2 = 5.3%
    # Spread: ~6.86% = 686 bps > 30 bps
    res = engine.evaluate_cash_and_carry_basis(
        symbol="NIFTY",
        spot_price=25000.0,
        futures_price=25250.0,
        days_to_expiry=30.0,
        dividend_yield_pct=1.20,
    )

    assert res.is_actionable is True
    assert res.annualized_basis_pct > 12.0
    assert res.net_spread_bps > 500.0
    assert res.annualized_net_apr_pct > 5.0


def test_cash_and_carry_fair_equilibrium(engine: BasisArbitrageTriangularHedgingEngine):
    # Futures priced exactly at fair basis: 25000 * (1 + 0.053 * 30 / 365) = 25108.9
    res = engine.evaluate_cash_and_carry_basis(
        symbol="NIFTY",
        spot_price=25000.0,
        futures_price=25110.0,
        days_to_expiry=30.0,
        dividend_yield_pct=1.20,
    )

    assert res.is_actionable is False
    assert abs(res.annualized_basis_pct - res.fair_basis_pct) < 1.0


def test_triangular_synthetic_loop_dislocation(engine: BasisArbitrageTriangularHedgingEngine):
    # AB: EUR/USD = 1.0800
    # BC: USD/INR = 84.00
    # AC: EUR/INR = 90.00
    # Synthetic AC: 1.08 * 84 = 90.72 vs Direct 90.00
    res = engine.evaluate_triangular_synthetic_loop(
        pair_ab="EURUSD",
        pair_bc="USDINR",
        pair_ac="EURINR",
        rate_ab=1.0800,
        rate_bc=84.00,
        rate_ac=90.00,
    )

    assert res.implied_synthetic_rate == 90.72
    assert res.gross_dislocation_bps > 70.0
    assert res.net_profit_bps > 60.0
    assert res.is_actionable is True


def test_perp_funding_rate_carry(engine: BasisArbitrageTriangularHedgingEngine):
    # 0.04% per 8h = 0.04 * 3 * 365 = 43.8% APR
    report = engine.analyze_multi_asset_basis(
        perp_funding_8h_rate=0.0004,
        margin_equity=300_000.0,
        maint_margin_req=100_000.0,
    )

    assert report.perp_funding_annualized_apr > 40.0
    assert report.primary_arbitrage_type == BasisArbitrageType.PERP_FUNDING_HARVEST
    assert "PERPETUAL FUNDING RATE CARRY" in report.tactical_directive


def test_critical_margin_buffer_defense(engine: BasisArbitrageTriangularHedgingEngine):
    # Equity only 1.1x maintenance margin (urgent liquidation danger)
    report = engine.analyze_multi_asset_basis(
        cnc_candidate=("NIFTY", 25000.0, 25300.0, 30.0),
        margin_equity=110_000.0,
        maint_margin_req=100_000.0,
    )

    assert report.margin_risk_state == MarginRiskState.CRITICAL_MARGIN_CALL
    assert report.collateral_margin_buffer_ratio == 1.10
    assert "EMERGENCY MARGIN DEFENSE" in report.tactical_directive
    # Arbitrage halted due to critical margin risk
    assert report.primary_arbitrage_type == BasisArbitrageType.NO_ARBITRAGE_EQUILIBRIUM
