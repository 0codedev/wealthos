"""
Unit Tests for Multi-Asset Synthetic Basket Dispersion Arbitrage & Correlation Swap Sieve (Domain 150 / WP-AZ)
"""

import math
import pytest

from services.basket_dispersion_engine import (
    BasketDispersionEngine,
    ConstituentVolQuote,
    DispersionReport,
)


@pytest.fixture
def engine():
    return BasketDispersionEngine(
        db_path=":memory:",
        high_corr_hurdle=0.55,
        low_corr_hurdle=0.22,
        min_dispersion_pts=3.0,
    )


def test_overpriced_correlation_long_dispersion(engine):
    # Constituents weighted IV ~ 23.7%, Index IV = 20.0%, Implied Corr ~ 56.5% (> 55%)
    constituents = [
        ConstituentVolQuote("HDFCBANK", 0.40, 0.22, vega_per_contract=100.0),
        ConstituentVolQuote("RELIANCE", 0.35, 0.24, vega_per_contract=100.0),
        ConstituentVolQuote("INFY", 0.25, 0.26, vega_per_contract=100.0),
    ]

    rep = engine.evaluate_dispersion("NIFTY", index_implied_vol=0.20, constituents=constituents, index_vega=1000.0)

    assert rep.dispersion_spread_pts >= 3.0
    assert rep.implied_correlation >= 0.55
    assert rep.regime == "OVERPRICED_CORRELATION_REGIME"
    assert rep.trade_directive == "LONG_DISPERSION_SELL_INDEX_BUY_BASKET"
    assert "HDFCBANK" in rep.recommended_vega_weights


def test_underpriced_correlation_short_dispersion(engine):
    # Low index IV = 14.0% gives low implied corr (< 0.22) -> Short dispersion
    constituents = [
        ConstituentVolQuote("HDFCBANK", 0.40, 0.22),
        ConstituentVolQuote("RELIANCE", 0.35, 0.24),
        ConstituentVolQuote("INFY", 0.25, 0.26),
    ]

    rep = engine.evaluate_dispersion("NIFTY", index_implied_vol=0.14, constituents=constituents)

    assert rep.implied_correlation <= 0.22
    assert rep.regime == "UNDERPRICED_CORRELATION_REGIME"
    assert rep.trade_directive == "SHORT_DISPERSION_BUY_INDEX_SELL_BASKET"


def test_perfect_correlation_identity(engine):
    # If all stocks have IV = 20% and index has IV = 20% -> Implied corr = 1.0, dispersion = 0
    constituents = [
        ConstituentVolQuote("STOCK_A", 0.50, 0.20),
        ConstituentVolQuote("STOCK_B", 0.50, 0.20),
    ]

    rep = engine.evaluate_dispersion("INDEX", index_implied_vol=0.20, constituents=constituents)

    assert math.isclose(rep.implied_correlation, 1.0, rel_tol=1e-3)
    assert math.isclose(rep.dispersion_spread_pts, 0.0, abs_tol=1e-3)


def test_vega_weight_conservation(engine):
    constituents = [
        ConstituentVolQuote("HDFCBANK", 0.50, 0.20, vega_per_contract=10.0),
        ConstituentVolQuote("RELIANCE", 0.50, 0.20, vega_per_contract=10.0),
    ]

    rep = engine.evaluate_dispersion("NIFTY", 0.18, constituents, index_vega=500.0)

    # Weights scaled to index vega
    assert sum(rep.recommended_vega_weights.values()) > 0.0


def test_sqlite_persistence(engine):
    constituents = [
        ConstituentVolQuote("S1", 0.50, 0.20),
        ConstituentVolQuote("S2", 0.50, 0.22),
    ]
    engine.evaluate_dispersion("TEST_IDX", 0.19, constituents)

    conn = engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT index_symbol, index_vol, implied_corr, regime FROM basket_dispersion_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "TEST_IDX"
    assert row[1] == 0.19
    assert isinstance(row[3], str)
