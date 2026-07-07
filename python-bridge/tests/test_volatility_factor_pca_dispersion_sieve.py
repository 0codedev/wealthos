"""
Unit Tests for Cross-Sectional Volatility Factor PCA & Dispersion Harvesting Sieve
Domain 231 / Work Package WP-EC
"""

import pytest
import math
import random
from services.volatility_factor_pca_dispersion_sieve import (
    VolatilityFactorPCADispersionSieve,
    ConstituentAsset,
    DispersionRegimeState,
)


def generate_correlated_returns(n_assets: int = 4, n_samples: int = 80, market_beta: float = 0.8, seed: int = 42):
    random.seed(seed)
    matrix = []

    # Common market factor
    market = [random.gauss(0.0, 0.015) for _ in range(n_samples)]

    for _ in range(n_assets):
        asset_ret = [market_beta * m + random.gauss(0.0, 0.008) for m in market]
        matrix.append(asset_ret)

    return matrix


def test_equicorrelation_bounds():
    sieve = VolatilityFactorPCADispersionSieve()

    # Case: perfect correlation (index vol = weighted constituent vol)
    # sigma_idx = 0.25, constituents = [0.25, 0.25, 0.25, 0.25], weights = [0.25, 0.25, 0.25, 0.25]
    vols = [0.25, 0.25, 0.25, 0.25]
    weights = [0.25, 0.25, 0.25, 0.25]

    rho_1 = sieve.compute_equicorrelation(0.25, vols, weights)
    assert pytest.approx(rho_1, 1e-4) == 1.0

    # Lower correlation when index vol is smaller than individual vols (diversification)
    rho_low = sieve.compute_equicorrelation(0.15, vols, weights)
    assert 0.0 <= rho_low < 1.0


def test_dispersion_profile_and_crp():
    sieve = VolatilityFactorPCADispersionSieve(min_crp_threshold=0.10)

    constituents = [
        ConstituentAsset(symbol="A", weight=0.25, implied_vol=0.35, realized_vol=0.28),
        ConstituentAsset(symbol="B", weight=0.25, implied_vol=0.32, realized_vol=0.26),
        ConstituentAsset(symbol="C", weight=0.25, implied_vol=0.30, realized_vol=0.25),
        ConstituentAsset(symbol="D", weight=0.25, implied_vol=0.33, realized_vol=0.27),
    ]

    # Index IV is rich (high implied correlation), Index RV is low (low realized correlation)
    index_iv = 0.28
    index_rv = 0.16

    profile = sieve.evaluate_dispersion_profile(index_iv, index_rv, constituents)

    assert profile.implied_correlation > profile.realized_correlation
    assert profile.correlation_risk_premium > 0.10
    assert profile.raw_dispersion_spread_vol > 0.0


def test_pca_market_factor_orthogonalization():
    sieve = VolatilityFactorPCADispersionSieve()
    returns = generate_correlated_returns(n_assets=4, n_samples=100, market_beta=0.85)
    base_w = [0.25, 0.25, 0.25, 0.25]

    pca = sieve.compute_pca_decomposition(returns, base_w)

    assert pca.pc1_market_explained_ratio > 0.60
    assert len(pca.pc1_loadings) == 4
    assert len(pca.neutralized_weights) == 4

    # Verify orthogonality: dot(neutralized_weights, pc1_loadings) ~ 0
    dot_prod = sum(pca.neutralized_weights[i] * pca.pc1_loadings[i] for i in range(4))
    assert pytest.approx(dot_prod, abs=1e-5) == 0.0


def test_harvest_optimal_and_crash_regimes():
    sieve = VolatilityFactorPCADispersionSieve(min_crp_threshold=0.10, crash_correlation_barrier=0.88)
    returns = generate_correlated_returns(n_assets=4, n_samples=60)

    # 1. Optimal harvest scenario: rich CRP
    constituents_opt = [
        ConstituentAsset(symbol="AAPL", weight=0.25, implied_vol=0.30, realized_vol=0.22),
        ConstituentAsset(symbol="MSFT", weight=0.25, implied_vol=0.28, realized_vol=0.20),
        ConstituentAsset(symbol="GOOG", weight=0.25, implied_vol=0.32, realized_vol=0.24),
        ConstituentAsset(symbol="AMZN", weight=0.25, implied_vol=0.34, realized_vol=0.25),
    ]
    dec_opt = sieve.evaluate_harvest_opportunity(
        index_iv=0.26, index_rv=0.14, constituents=constituents_opt, returns_history_matrix=returns
    )
    assert dec_opt.regime == DispersionRegimeState.DISPERSION_HARVEST_OPTIMAL
    assert "Sell index straddles" in dec_opt.recommended_action

    # 2. Crash scenario: implied correlation >= 0.88
    # High index IV relative to constituents -> rho -> 1.0
    dec_crash = sieve.evaluate_harvest_opportunity(
        index_iv=0.305, index_rv=0.25, constituents=constituents_opt, returns_history_matrix=returns
    )
    assert dec_crash.regime == DispersionRegimeState.CORRELATION_CRASH_EXPANSION
    assert "ABORT_DISPERSION" in dec_crash.recommended_action
