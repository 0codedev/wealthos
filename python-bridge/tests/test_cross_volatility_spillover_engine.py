r"""Unit Tests for Multi-Horizon Cross-Correlation & Volatility Spillover Lead-Lag Engine (Domain 197 / WP-CU)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.cross_volatility_spillover_engine import (
    CrossVolatilitySpilloverEngine,
    MarketRole,
    ContagionRegime,
)


@pytest.fixture
def engine() -> CrossVolatilitySpilloverEngine:
    return CrossVolatilitySpilloverEngine(
        default_horizon=10,
        significance_threshold=0.30,
        elevated_tsi_threshold=60.0,
        crisis_tsi_threshold=75.0,
    )


def test_log_realized_variances(engine: CrossVolatilitySpilloverEngine):
    # Constant return series
    returns = {
        "NIFTY": [0.01 * ((-1) ** i) for i in range(50)],
        "BANKNIFTY": [0.015 * ((-1) ** (i // 2)) for i in range(50)],
    }
    log_vars = engine.calculate_log_realized_variances(returns, window=10)
    assert len(log_vars["NIFTY"]) == 41
    assert len(log_vars["BANKNIFTY"]) == 41
    # Check all are finite float numbers
    assert all(math.isfinite(x) for x in log_vars["NIFTY"])
    assert all(math.isfinite(x) for x in log_vars["BANKNIFTY"])


def test_var1_estimation_and_invertibility(engine: CrossVolatilitySpilloverEngine):
    # Create two correlated AR(1) series with stochastic innovations
    import random
    rng = random.Random(42)
    n = 250
    s1 = [0.0] * n
    s2 = [0.0] * n
    for t in range(1, n):
        e1 = rng.gauss(0, 0.5)
        e2 = rng.gauss(0, 0.5)
        s1[t] = 0.5 * s1[t - 1] + e1
        s2[t] = 0.3 * s2[t - 1] + 0.4 * s1[t - 1] + e2

    series_matrix = [s1, s2]
    phi, sigma = engine.fit_var1_coefficients(series_matrix)

    assert len(phi) == 2 and len(phi[0]) == 2
    assert len(sigma) == 2 and len(sigma[0]) == 2
    # Diagonal variance of sigma should be positive
    assert sigma[0][0] > 0
    assert sigma[1][1] > 0
    # Phi cross-loading from s1 to s2 should be positive (~0.4)
    assert phi[1][0] > 0.25


def test_gfevd_spillover_matrix_normalization(engine: CrossVolatilitySpilloverEngine):
    phi = [
        [0.6, 0.1],
        [0.4, 0.5],
    ]
    sigma = [
        [0.04, 0.01],
        [0.01, 0.05],
    ]
    gfevd = engine.compute_gfevd_spillover_matrix(phi, sigma, horizon=10)
    assert len(gfevd) == 2
    assert len(gfevd[0]) == 2

    # Every row must sum to 1.0 (within numerical tolerance)
    for row in gfevd:
        assert math.isclose(sum(row), 1.0, abs_tol=1e-5)
        # All individual probabilities must be in [0, 1]
        for val in row:
            assert 0.0 <= val <= 1.0


def test_lead_lag_cross_correlation_asymmetry(engine: CrossVolatilitySpilloverEngine):
    # Construct synthetic lead-lag: A leads B by 2 steps
    n = 120
    base = [math.sin(t * 0.15) + 0.2 * math.cos(t * 0.45) for t in range(n)]
    series_a = base[:]
    # B is delayed by 2 steps: B[t] = A[t - 2] + small noise
    series_b = [0.0] * n
    for t in range(2, n):
        series_b[t] = base[t - 2] * 0.9 + 0.05 * math.sin(t * 2.0)

    rel = engine.compute_lead_lag_cross_correlation(
        series_a=series_a,
        series_b=series_b,
        symbol_a="LEAD_ASSET",
        symbol_b="LAG_ASSET",
        max_lag=5,
    )

    assert rel.lead_symbol == "LEAD_ASSET"
    assert rel.lag_symbol == "LAG_ASSET"
    assert rel.optimal_lag_steps == 2
    assert rel.peak_correlation > 0.70
    assert rel.statistically_significant is True
    assert rel.asymmetry_ratio > 1.2


def test_end_to_end_cross_market_spillover(engine: CrossVolatilitySpilloverEngine):
    # 3 assets: LEADER (high spillover generator), FOLLOWER1 (absorber), FOLLOWER2 (absorber)
    n = 150
    leader = [math.sin(t * 0.1) for t in range(n)]
    foll1 = [0.0] * n
    foll2 = [0.0] * n
    for t in range(1, n):
        foll1[t] = 0.4 * foll1[t - 1] + 0.5 * leader[t - 1]
        foll2[t] = 0.3 * foll2[t - 1] + 0.4 * leader[t - 1]

    symbol_series = {
        "LEADER": leader,
        "FOLLOWER_1": foll1,
        "FOLLOWER_2": foll2,
    }

    result = engine.analyze_cross_market_spillover(symbol_series, horizon=10, max_cross_lag=4)

    assert result.symbols == ["LEADER", "FOLLOWER_1", "FOLLOWER_2"]
    assert 0.0 <= result.total_spillover_index <= 100.0
    assert result.primary_transmitter == "LEADER"
    assert result.asset_profiles["LEADER"].role == MarketRole.NET_TRANSMITTER
    assert result.asset_profiles["LEADER"].net_spillover > 0.0

    # Lead-lag relations should be detected
    assert len(result.lead_lag_pairs) == 3
    # Check pre-hedge recommendations
    assert any(rec.get("action") == "ANTICIPATORY_PRE_HEDGE" for rec in result.pre_hedge_recommendations)


def test_contagion_regimes(engine: CrossVolatilitySpilloverEngine):
    # Independent white-noise assets -> Low TSI (DECOUPLED)
    n = 120
    indep_series = {
        "ASSET_A": [math.sin(t * 1.7) for t in range(n)],
        "ASSET_B": [math.cos(t * 3.1) for t in range(n)],
        "ASSET_C": [math.sin(t * 5.3) for t in range(n)],
    }
    result_decoupled = engine.analyze_cross_market_spillover(indep_series, horizon=5)
    assert result_decoupled.contagion_regime in (ContagionRegime.DECOUPLED, ContagionRegime.MODERATE)
