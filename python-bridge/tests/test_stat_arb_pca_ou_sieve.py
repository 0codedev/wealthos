"""
Unit Tests for Statistical Arbitrage Factor Residual PCA & Mean-Reversion OU Sieve (Domain 156 / WP-BF)
"""

import math
import random
import pytest
from services.stat_arb_pca_ou_sieve import (
    StatArbPCAOUSieve,
    StatArbReport,
)


@pytest.fixture
def sieve():
    return StatArbPCAOUSieve(
        db_path=":memory:",
        entry_s_score=1.25,
        exit_s_score=0.50,
        stop_s_score=4.00,
        max_half_life_days=45.0,
    )


def test_strip_market_factor(sieve):
    # Simulated market returns
    market = [0.01, -0.005, 0.002, 0.015, -0.01, 0.008, -0.003, 0.012, -0.007, 0.005, 0.001, -0.002]
    # Stock with beta = 1.5, alpha = 0.001, plus small residuals
    stock = [0.001 + 1.5 * m + 0.0005 * (i % 3 - 1) for i, m in enumerate(market)]

    alpha, beta, res = sieve.strip_market_factor(stock, market)

    assert beta == pytest.approx(1.5, abs=0.1)
    assert abs(sum(res)) < 1e-4


def test_calibrate_ou_process_synthetic(sieve):
    # Synthetic stationary AR(1) series: X_{t+1} = 0.80 * X_t + noise
    random.seed(42)
    b_true = 0.80
    kappa_true = -math.log(b_true)  # ~0.223
    half_life_true = math.log(2.0) / kappa_true  # ~3.10 days

    x = [0.0]
    for _ in range(80):
        x.append(b_true * x[-1] + random.gauss(0, 0.01))

    kappa, eq_mean, half_life, sigma_ou, sigma_eq = sieve.calibrate_ou_process(x)

    assert kappa > 0.0
    assert half_life == pytest.approx(half_life_true, abs=1.5)
    assert sigma_eq > 0.0


def test_stat_arb_buy_cheap_residual(sieve):
    # Generate stationary series oscillating around 0.0
    random.seed(101)
    cum_res = [0.0]
    for _ in range(40):
        cum_res.append(0.75 * cum_res[-1] + random.gauss(0, 0.01))

    # Introduce sudden -3.0 sigma plunge on the last step
    sigma_est = 0.015
    cum_res.append(cum_res[-1] - (2.5 * sigma_est))

    # Convert back to step returns
    stock_ret = [cum_res[0]] + [cum_res[i] - cum_res[i - 1] for i in range(1, len(cum_res))]
    mkt_ret = [0.0] * len(stock_ret)

    rep = sieve.evaluate_residual_stat_arb("CHEAP_SYM", stock_ret, mkt_ret)

    assert rep.s_score <= -1.25
    assert rep.regime == "STAT_ARB_BUY_CHEAP_RESIDUAL"
    assert rep.trade_directive == "LONG_STOCK_SHORT_BETA_HEDGE"
    assert rep.half_life_days <= 45.0


def test_stat_arb_short_rich_residual(sieve):
    random.seed(202)
    cum_res = [0.0]
    for _ in range(40):
        cum_res.append(0.75 * cum_res[-1] + random.gauss(0, 0.01))

    # Sudden +2.5 sigma spike
    cum_res.append(cum_res[-1] + (2.5 * 0.015))

    stock_ret = [cum_res[0]] + [cum_res[i] - cum_res[i - 1] for i in range(1, len(cum_res))]
    mkt_ret = [0.0] * len(stock_ret)

    rep = sieve.evaluate_residual_stat_arb("RICH_SYM", stock_ret, mkt_ret)

    assert rep.s_score >= 1.25
    assert rep.regime == "STAT_ARB_SHORT_RICH_RESIDUAL"
    assert rep.trade_directive == "SHORT_STOCK_LONG_BETA_HEDGE"


def test_structural_break_abort(sieve):
    random.seed(303)
    cum_res = [0.0]
    for _ in range(60):
        cum_res.append(0.75 * cum_res[-1] + random.gauss(0, 0.003))

    # Catastrophic gap of 5.0+ sigma
    cum_res.append(cum_res[-1] - 0.15)

    stock_ret = [cum_res[0]] + [cum_res[i] - cum_res[i - 1] for i in range(1, len(cum_res))]
    mkt_ret = [0.0] * len(stock_ret)

    rep = sieve.evaluate_residual_stat_arb("BREAK_SYM", stock_ret, mkt_ret)

    assert abs(rep.s_score) >= 4.0
    assert rep.regime == "STAT_ARB_STRUCTURAL_BREAK_ABORT"
    assert rep.trade_directive == "CLOSE_ALL_POSITIONS_STOP_LOSS"


def test_sqlite_persistence(sieve):
    stock_ret = [0.001 * (i % 5 - 2) for i in range(25)]
    mkt_ret = [0.001 * (i % 3 - 1) for i in range(25)]

    sieve.evaluate_residual_stat_arb("PERSIST_SYM", stock_ret, mkt_ret)

    conn = sieve._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, s_score, regime FROM stat_arb_ou_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_SYM"
