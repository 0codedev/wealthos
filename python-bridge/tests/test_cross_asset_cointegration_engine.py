"""
Unit Tests for Cross-Asset Lead-Lag Granger Causality & Cointegration Sieve (Domain 135 / WP-AK)
"""

import math
from datetime import datetime
import pytest

from services.cross_asset_cointegration_engine import (
    CrossAssetCointegrationEngine,
    CointegrationReport,
)


@pytest.fixture
def coint_engine():
    return CrossAssetCointegrationEngine(
        z_score_entry_threshold=2.0,
        z_score_exit_threshold=0.25,
        max_half_life_bars=50.0,
        adf_critical_t_stat=-2.86,
        db_path=":memory:",
    )


def test_compute_ols_hedge_ratio(coint_engine):
    # Proportional log series: Y_t = 1.5 * X_t
    x = [100.0 * (1.0 + 0.01 * i) for i in range(50)]
    y = [1.5 * val for val in x]

    beta, alpha, spread = coint_engine.compute_ols_hedge_ratio(x, y)
    assert abs(beta - 1.0) < 0.05
    assert abs(alpha - math.log(1.5)) < 0.05
    for s in spread:
        assert abs(s) < 1e-3


def test_estimate_half_life_and_stationarity(coint_engine):
    # Mean-reverting AR(1) series: S_t = 0.75 * S_{t-1} + eps
    # Delta S_t = -0.25 * S_{t-1} -> gamma = -0.25 -> half life ~ ln(2)/0.25 = 2.77 bars
    spread = [0.0]
    import random
    rng = random.Random(42)
    for i in range(150):
        prev = spread[-1]
        cur = 0.75 * prev + rng.gauss(0.0, 0.02)
        spread.append(cur)

    half_life, t_stat, is_stat = coint_engine.estimate_half_life_and_stationarity(spread)
    assert 1.5 <= half_life <= 6.0
    assert t_stat <= -2.86
    assert is_stat is True


def test_test_granger_causality_f_stat(coint_engine):
    # Construct X strictly leading Y by 1 lag
    import random
    rng = random.Random(101)
    x = [100.0]
    y = [100.0]

    # Generate 100 observations
    prev_ret_x = 0.0
    for i in range(100):
        # Current X return
        ret_x = rng.gauss(0.0, 0.02)
        x.append(x[-1] * math.exp(ret_x))

        # Y return is driven by X's PREVIOUS return (lag 1 lead)
        ret_y = 0.85 * prev_ret_x + rng.gauss(0.0, 0.005)
        y.append(y[-1] * math.exp(ret_y))

        prev_ret_x = ret_x

    f_x_to_y = coint_engine.test_granger_causality_f_stat(x, y)
    f_y_to_x = coint_engine.test_granger_causality_f_stat(y, x)

    assert f_x_to_y > 3.84  # X causes Y (significant F-stat)
    assert f_x_to_y > f_y_to_x


def test_evaluate_pair_trading_signal(coint_engine):
    # Construct cointegrated pair with AR(1) mean-reverting error
    import random
    rng = random.Random(99)
    x = [1000.0]
    s = [0.0]

    # Stationary AR(1) spread
    for i in range(120):
        s_next = 0.70 * s[-1] + rng.gauss(0.0, 0.01)
        s.append(s_next)
        dx = rng.gauss(0.0, 0.01)
        x.append(x[-1] * (1.0 + dx))

    # On final bar, spread dips to -2.8 standard deviations
    std_s = math.sqrt(sum(val ** 2 for val in s) / len(s))
    s[-1] = -2.8 * std_s

    # y = x * exp(s)
    y = [x[i] * math.exp(s[i]) for i in range(len(x))]

    rep = coint_engine.evaluate_pair("HDFCBANK", "ICICIBANK", x, y)
    assert rep.is_cointegrated is True
    assert rep.spread_z_score <= -2.0
    assert rep.trading_signal == "LONG_SPREAD"
    assert "Long ICICIBANK, Short" in rep.rationale


def test_sqlite_persistence(coint_engine):
    x = [100.0 + i for i in range(20)]
    y = [200.0 + 2 * i for i in range(20)]
    coint_engine.evaluate_pair("NIFTY", "BANKNIFTY", x, y)

    conn = coint_engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT asset_a, asset_b, beta FROM cross_asset_cointegration_telemetry WHERE asset_a = 'NIFTY'")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "NIFTY"
    assert row[1] == "BANKNIFTY"
