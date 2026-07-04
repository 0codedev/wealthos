r"""
Unit Test Suite for Domain 194 (WP-CR): Cross-Asset Options Smile Dispersion & Volatility Arbitrage Engine
"""

import math
import pytest
from services.options_dispersion_arbitrage_engine import (
    ConstituentOption,
    DispersionDirective,
    OptionsDispersionArbitrageEngine,
)


def test_implied_correlation_inversion_identity():
    """Verifies that the analytical inversion for implied correlation exactly recovers theoretical values."""
    engine = OptionsDispersionArbitrageEngine(db_path=":memory:")

    # Two equal-weighted assets with 20% IV
    constituents = [
        ConstituentOption(symbol="STOCK_A", weight=0.5, spot=100.0, atm_iv=0.20, vega_per_contract=10.0),
        ConstituentOption(symbol="STOCK_B", weight=0.5, spot=100.0, atm_iv=0.20, vega_per_contract=10.0),
    ]

    # If Index IV = 20%, implied correlation must be 1.0
    rho_1, basket_iv, _ = engine.compute_implied_correlation(0.20, constituents)
    assert math.isclose(rho_1, 1.0, rel_tol=1e-3)
    assert math.isclose(basket_iv, 0.20, rel_tol=1e-3)

    # If Index IV = 20% * sqrt(0.5) \approx 0.141421, implied correlation must be 0.0
    idx_iv_uncorr = 0.20 * math.sqrt(0.5)
    rho_0, _, _ = engine.compute_implied_correlation(idx_iv_uncorr, constituents)
    assert math.isclose(rho_0, 0.0, abs_tol=1e-3)


def test_classic_dispersion_directive():
    """Verifies that an elevated Correlation Risk Premium triggers classic dispersion (Sell Index / Buy Basket)."""
    engine = OptionsDispersionArbitrageEngine(db_path=":memory:", dispersion_threshold=0.15)

    constituents = [
        ConstituentOption(symbol="RELIANCE", weight=0.40, spot=3000.0, atm_iv=0.22, vega_per_contract=25.0),
        ConstituentOption(symbol="HDFCBANK", weight=0.35, spot=1600.0, atm_iv=0.20, vega_per_contract=20.0),
        ConstituentOption(symbol="INFY", weight=0.25, spot=1800.0, atm_iv=0.24, vega_per_contract=15.0),
    ]

    # Index IV = 19.5% (High relative to constituents -> high implied correlation ~0.70)
    opp = engine.evaluate_dispersion(
        index_symbol="NIFTY",
        index_spot=25000.0,
        index_iv=0.195,
        index_vega=100.0,
        constituents=constituents,
        realized_correlation=0.35,  # Realized is only 35% -> CRP > 0.15
    )

    assert opp.implied_correlation > 0.60
    assert opp.correlation_risk_premium >= 0.15
    assert opp.directive == DispersionDirective.DISPERSION_SELL_INDEX_BUY_BASKET
    assert "SHORT Index Vol" in opp.rationale

    # Check vega allocations
    assert opp.vega_neutral_allocations["RELIANCE"] > 0
    assert opp.vega_neutral_allocations["HDFCBANK"] > 0
    assert opp.vega_neutral_allocations["INFY"] > 0


def test_reverse_dispersion_directive():
    """Verifies that unusually cheap implied correlation triggers reverse dispersion (Buy Index / Sell Basket)."""
    engine = OptionsDispersionArbitrageEngine(db_path=":memory:", reverse_threshold=-0.10)

    constituents = [
        ConstituentOption(symbol="RELIANCE", weight=0.50, spot=3000.0, atm_iv=0.28, vega_per_contract=25.0),
        ConstituentOption(symbol="TCS", weight=0.50, spot=4000.0, atm_iv=0.26, vega_per_contract=20.0),
    ]

    # Low Index IV = 16% (yields implied correlation ~0.20)
    opp = engine.evaluate_dispersion(
        index_symbol="NIFTY",
        index_spot=25000.0,
        index_iv=0.16,
        index_vega=100.0,
        constituents=constituents,
        realized_correlation=0.55,  # Realized is 55% -> CRP < -0.10
    )

    assert opp.correlation_risk_premium <= -0.10
    assert opp.directive == DispersionDirective.REVERSE_DISPERSION_BUY_INDEX_SELL_BASKET
    assert "LONG Index Vol" in opp.rationale


def test_dispersion_arbitrage_bound_violation():
    """Verifies that impossible implied correlation (> 1.0) flags a mathematical arbitrage violation."""
    engine = OptionsDispersionArbitrageEngine(db_path=":memory:")

    # Basket IV is 20%, but index IV is priced at 25% (impossible in arbitrage-free pricing)
    constituents = [
        ConstituentOption(symbol="STOCK_A", weight=0.5, spot=100.0, atm_iv=0.20, vega_per_contract=10.0),
        ConstituentOption(symbol="STOCK_B", weight=0.5, spot=100.0, atm_iv=0.20, vega_per_contract=10.0),
    ]

    opp = engine.evaluate_dispersion(
        index_symbol="INDEX",
        index_spot=1000.0,
        index_iv=0.25,  # 25% > 20%
        index_vega=50.0,
        constituents=constituents,
        realized_correlation=0.50,
    )

    assert opp.implied_correlation > 1.0
    assert opp.directive == DispersionDirective.DISPERSION_ARBITRAGE_BOUND_VIOLATION
    assert "arbitrage bound violated" in opp.rationale


def test_sqlite_telemetry_persistence():
    """Verifies SQLite recording and retrieval of dispersion opportunities."""
    engine = OptionsDispersionArbitrageEngine(db_path=":memory:")

    constituents = [
        ConstituentOption(symbol="AXISBANK", weight=0.5, spot=1200.0, atm_iv=0.22, vega_per_contract=10.0),
        ConstituentOption(symbol="ICICIBANK", weight=0.5, spot=1250.0, atm_iv=0.20, vega_per_contract=10.0),
    ]

    engine.evaluate_dispersion("BANKNIFTY", 52000.0, 0.18, 50.0, constituents, 0.40)

    records = engine.get_recent_opportunities(limit=5)
    assert len(records) == 1
    assert records[0]["index_symbol"] == "BANKNIFTY"
    assert records[0]["index_iv"] == 0.18
