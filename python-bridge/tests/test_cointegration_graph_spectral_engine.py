"""
Unit Test Suite for Domain 255: Multi-Exchange Cross-Asset Statistical Arbitrage Cointegration Graph & Spectral Clustering Engine
"""

import pytest
from services.cointegration_graph_spectral_engine import (
    CointegrationGraphSpectralEngine,
    AssetAffinityEdge,
    ClusterCointegrationRegime,
    StatArbActionDirective,
)


@pytest.fixture
def engine():
    return CointegrationGraphSpectralEngine(
        adf_critical_threshold=-3.45,
        max_tradable_half_life_hours=24.0,
    )


def test_strong_cointegrating_clique(engine):
    # Cluster of 4 tech stocks (GOOG, GOOGL, META, MSFT) with tight cointegration and short half-life
    assets = ["GOOG", "GOOGL", "META", "MSFT"]
    edges = [
        AssetAffinityEdge("GOOG", "GOOGL", adf_statistic=-4.8, p_value=0.001, half_life_hours=4.5),
        AssetAffinityEdge("GOOG", "META", adf_statistic=-3.9, p_value=0.008, half_life_hours=8.0),
        AssetAffinityEdge("GOOGL", "META", adf_statistic=-4.1, p_value=0.004, half_life_hours=7.2),
        AssetAffinityEdge("META", "MSFT", adf_statistic=-3.7, p_value=0.015, half_life_hours=12.0),
        AssetAffinityEdge("GOOG", "MSFT", adf_statistic=-3.6, p_value=0.018, half_life_hours=14.0),
        AssetAffinityEdge("GOOGL", "MSFT", adf_statistic=-3.8, p_value=0.010, half_life_hours=11.0),
    ]
    res = engine.evaluate_cluster("TECH_MEGA_CAP", assets, edges)
    assert res.regime == ClusterCointegrationRegime.STRONG_COINTEGRATING_CLIQUE
    assert res.directive == StatArbActionDirective.DEPLOY_BASKET_STATARB
    assert res.spectral_gap >= 0.25
    assert res.mean_half_life_hours < 24.0
    assert sum(res.portfolio_weights.values()) == pytest.approx(0.0, abs=1e-3)


def test_moderate_cluster_persistence(engine):
    # Cointegrated, but slower mean-reversion (half-life = 35h > 24h)
    assets = ["XOM", "CVX"]
    edges = [
        AssetAffinityEdge("XOM", "CVX", adf_statistic=-3.6, p_value=0.02, half_life_hours=35.0),
    ]
    res = engine.evaluate_cluster("OIL_MAJORS", assets, edges)
    assert res.regime == ClusterCointegrationRegime.MODERATE_CLUSTER_PERSISTENCE
    assert res.directive == StatArbActionDirective.MONITOR_PAIR_FORMATION
    assert res.mean_half_life_hours > 24.0


def test_decoupled_spurious_noise(engine):
    # Weak ADF (-2.5 > -3.45), failed stationarity
    assets = ["BTC", "GLD"]
    edges = [
        AssetAffinityEdge("BTC", "GLD", adf_statistic=-2.5, p_value=0.25, half_life_hours=90.0),
    ]
    res = engine.evaluate_cluster("CRYPTO_GOLD", assets, edges)
    assert res.regime == ClusterCointegrationRegime.DECOUPLED_SPURIOUS_NOISE
    assert res.directive == StatArbActionDirective.HOLD_ISOLATED


def test_structural_cluster_break(engine):
    # Severe decoupling, positive/flat ADF statistic (-0.5)
    assets = ["LUNA", "UST"]
    edges = [
        AssetAffinityEdge("LUNA", "UST", adf_statistic=-0.5, p_value=0.90, half_life_hours=999.0),
    ]
    res = engine.evaluate_cluster("DEPEG_COLLAPSE", assets, edges)
    assert res.regime == ClusterCointegrationRegime.STRUCTURAL_CLUSTER_BREAK
    assert res.directive == StatArbActionDirective.UNWIND_DECOUPLED_BASKET


def test_disconnected_empty_cluster(engine):
    res = engine.evaluate_cluster("EMPTY", [], [])
    assert res.regime == ClusterCointegrationRegime.DECOUPLED_SPURIOUS_NOISE
    assert res.directive == StatArbActionDirective.HOLD_ISOLATED
