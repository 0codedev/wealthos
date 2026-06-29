r"""Unit Tests for Multi-Asset Cross-Gamma & Convexity Squeeze Arbitrage Engine (Domain 203 / WP-DA)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.cross_gamma_convexity_squeeze_engine import (
    CrossGammaConvexitySqueezeEngine,
    ConstituentOptionData,
    ConvexityRegime,
    CrossGammaArbitrageSignal,
)


@pytest.fixture
def engine() -> CrossGammaConvexitySqueezeEngine:
    return CrossGammaConvexitySqueezeEngine(
        squeeze_threshold_cr=-3.0,
        dislocation_z_threshold=1.80,
    )


@pytest.fixture
def sample_constituents() -> list[ConstituentOptionData]:
    return [
        ConstituentOptionData("RELIANCE", weight=0.30, beta=1.1, spot_price=2900.0, atm_gamma=0.0012, atm_vega=12.0, net_dealer_gex=1.5),
        ConstituentOptionData("HDFCBANK", weight=0.30, beta=1.0, spot_price=1650.0, atm_gamma=0.0018, atm_vega=8.0, net_dealer_gex=1.2),
        ConstituentOptionData("ICICIBANK", weight=0.20, beta=1.2, spot_price=1250.0, atm_gamma=0.0022, atm_vega=6.0, net_dealer_gex=0.8),
        ConstituentOptionData("INFOSYS", weight=0.20, beta=0.9, spot_price=1500.0, atm_gamma=0.0020, atm_vega=7.0, net_dealer_gex=0.5),
    ]


def test_convexity_squeeze_extreme_hazard(
    engine: CrossGammaConvexitySqueezeEngine,
    sample_constituents: list[ConstituentOptionData],
):
    # Severe dealer short gamma on the index
    res = engine.calculate_cross_gamma_spread(
        index_symbol="NIFTY",
        index_spot=25000.0,
        index_net_gex=-6.5,
        index_vega=45.0,
        constituents=sample_constituents,
    )

    assert res.regime == ConvexityRegime.EXTREME_SHORT_SQUEEZE_HAZARD
    assert res.arbitrage_signal == CrossGammaArbitrageSignal.CONVEXITY_SQUEEZE_RIDER
    assert res.forced_rebalance_shares_per_100pt > 500.0
    assert "CRITICAL SQUEEZE HAZARD" in res.tactical_directive


def test_buy_index_convexity_dislocation(
    engine: CrossGammaConvexitySqueezeEngine,
    sample_constituents: list[ConstituentOptionData],
):
    # Index gamma depressed relative to high constituent gamma
    res = engine.calculate_cross_gamma_spread(
        index_symbol="NIFTY",
        index_spot=25000.0,
        index_net_gex=-2.0,
        index_vega=45.0,
        constituents=sample_constituents,
        historical_spread_std_cr=1.5,
    )

    # Implied constituent GEX is ~ 0.3*1.5 + 0.3*1.2 + 0.2*0.8 + 0.2*0.5 = 0.45 + 0.36 + 0.16 + 0.10 = 1.07
    # Spread = -2.0 - 1.07 = -3.07
    # Z = -3.07 / 1.5 = -2.05 < -1.80
    assert res.z_score < -1.80
    assert res.arbitrage_signal == CrossGammaArbitrageSignal.BUY_INDEX_CONVEXITY
    assert "Index gamma is underpriced" in res.tactical_directive


def test_sell_index_convexity_dislocation(
    engine: CrossGammaConvexitySqueezeEngine,
    sample_constituents: list[ConstituentOptionData],
):
    # Index gamma inflated
    res = engine.calculate_cross_gamma_spread(
        index_symbol="NIFTY",
        index_spot=25000.0,
        index_net_gex=5.5,
        index_vega=45.0,
        constituents=sample_constituents,
        historical_spread_std_cr=2.0,
    )

    assert res.z_score > 1.80
    assert res.arbitrage_signal == CrossGammaArbitrageSignal.SELL_INDEX_CONVEXITY
    assert "Index gamma is overpriced" in res.tactical_directive


def test_vega_neutral_dispersion_weights(
    engine: CrossGammaConvexitySqueezeEngine,
    sample_constituents: list[ConstituentOptionData],
):
    res = engine.calculate_cross_gamma_spread(
        index_symbol="NIFTY",
        index_spot=25000.0,
        index_net_gex=1.0,
        index_vega=50.0,
        constituents=sample_constituents,
    )

    weights = res.recommended_basket_weights
    assert "RELIANCE" in weights
    assert "HDFCBANK" in weights
    assert all(w > 0.0 for w in weights.values())
    # Reliance weight: 0.30 * 50.0 / 12.0 = 1.25
    assert math.isclose(weights["RELIANCE"], 1.25, abs_tol=1e-3)
