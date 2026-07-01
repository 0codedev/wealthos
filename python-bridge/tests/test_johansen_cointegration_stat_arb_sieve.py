"""
Unit tests for Domain 170 (WP-BT): Cross-Sectional Statistical Arbitrage Residual Cointegration & Johansen Trace Sieve
"""

import math
import random
import pytest
from services.johansen_cointegration_stat_arb_sieve import (
    JohansenCointegrationStatArbSieve,
    CointegrationResult,
    JohansenReport,
)


def test_matrix_and_invert_2x2():
    sieve = JohansenCointegrationStatArbSieve()
    A = [[2.0, 1.0], [1.0, 3.0]]
    inv_A = sieve._invert_2x2(A)
    # A * inv_A should be identity
    prod = sieve._matrix_mult(A, inv_A)
    assert abs(prod[0][0] - 1.0) < 1e-4
    assert abs(prod[0][1]) < 1e-4
    assert abs(prod[1][0]) < 1e-4
    assert abs(prod[1][1] - 1.0) < 1e-4


def test_run_johansen_cointegrated_pair():
    sieve = JohansenCointegrationStatArbSieve()
    random.seed(42)

    # Generate synthetic cointegrated series:
    # y1 is a cumulative random walk
    # y2 = 2.0 * y1 + stationary_noise
    T = 100
    rw = 100.0
    series_1 = []
    series_2 = []
    noise = 0.0

    for _ in range(T):
        rw += random.gauss(0.1, 1.0)
        noise = 0.6 * noise + random.gauss(0.0, 0.5)  # Mean-reverting AR(1)
        series_1.append(rw)
        series_2.append(2.0 * rw + noise)

    res = sieve.run_johansen_2asset(series_1, series_2)
    # Trace statistic should cleanly detect cointegration
    assert res.is_cointegrated is True
    assert res.cointegration_rank == 1
    assert res.trace_statistic > res.critical_value_95
    assert len(res.hedge_ratios) == 2
    # Half-life of the mean-reverting noise should be short (< 20 days)
    assert res.half_life_days < 20.0


def test_run_johansen_independent_random_walks():
    sieve = JohansenCointegrationStatArbSieve()
    random.seed(123)

    # Two completely independent random walks with large drifts
    T = 80
    rw1, rw2 = 100.0, 200.0
    series_1 = []
    series_2 = []

    for _ in range(T):
        rw1 += random.gauss(0.5, 2.0)
        rw2 += random.gauss(-0.5, 3.0)
        series_1.append(rw1)
        series_2.append(rw2)

    rep = sieve.analyze_pair("TEST_PAIR", "ASSET_A", "ASSET_B", series_1, series_2)
    assert isinstance(rep.is_cointegrated, bool)
    assert isinstance(rep.trade_directive, str)


def test_stat_arb_directives():
    sieve = JohansenCointegrationStatArbSieve()
    random.seed(99)

    T = 60
    rw = 100.0
    s1 = []
    s2 = []
    for _ in range(T):
        rw += random.gauss(0.05, 0.5)
        s1.append(rw)
        s2.append(1.5 * rw + random.gauss(0.0, 0.2))

    # Base test
    rep_base = sieve.analyze_pair("BANKING_BASKET", "HDFCBANK", "ICICIBANK", s1, s2)
    assert rep_base.basket_name == "BANKING_BASKET"
    assert rep_base.cointegration_rank == 1

    # Inject 2-sigma spread deviation on the final observation
    s2_stretched = list(s2)
    s2_stretched[-1] -= 0.35  # s2 dipped, so z = s1 - beta*s2 jumps positive
    rep_stretch = sieve.analyze_pair("BANKING_BASKET", "HDFCBANK", "ICICIBANK", s1, s2_stretched)
    assert rep_stretch.current_z_score > 1.5


def test_sqlite_persistence():
    sieve = JohansenCointegrationStatArbSieve(db_path=":memory:")
    s1 = [100.0 + i * 0.5 for i in range(30)]
    s2 = [200.0 + i * 1.0 for i in range(30)]

    rep = sieve.analyze_pair("ENERGY", "RELIANCE", "ONGC", s1, s2)
    assert rep.basket_name == "ENERGY"

    rows = sieve.get_latest_telemetry(5)
    assert len(rows) == 1
    assert rows[0][0] == "ENERGY"
    assert "RELIANCE" in rows[0][1]
