"""
Unit Tests for Sub-Second Market Microstructure Kyle's Lambda & Invariance Flow Sieve (Domain 159 / WP-BI)
"""

import pytest
from services.kyles_lambda_sieve import (
    KylesLambdaSieve,
    TradeTick,
    TradeInterval,
    KylesLambdaReport,
)


@pytest.fixture
def sieve():
    return KylesLambdaSieve(
        db_path=":memory:",
        toxic_lambda_hurdle_bps=12.0,
        benign_lambda_hurdle_bps=4.0,
        min_intervals=20,
    )


def test_lee_ready_classification(sieve):
    # Above mid -> +1
    t1 = TradeTick("1", price=100.20, volume=100, bid=100.0, ask=100.20)
    assert sieve.classify_trade_sign_lee_ready(t1, 100.10) == 1

    # Below mid -> -1
    t2 = TradeTick("2", price=100.00, volume=100, bid=100.0, ask=100.20)
    assert sieve.classify_trade_sign_lee_ready(t2, 100.10) == -1

    # At mid, tick rule up -> +1
    t3 = TradeTick("3", price=100.10, volume=100, bid=100.0, ask=100.20)
    assert sieve.classify_trade_sign_lee_ready(t3, 100.05) == 1


def test_estimate_kyle_lambda_linear(sieve):
    # Delta P = 0.002 * Q
    intervals = []
    for i in range(30):
        q = (i - 15) * 500.0  # signed volume
        dp = 0.002 * q
        intervals.append(TradeInterval(price_change=dp, signed_volume=q))

    lam, r2 = sieve.estimate_kyle_lambda(intervals)
    assert lam == pytest.approx(0.002, abs=1e-5)
    assert r2 == pytest.approx(1.0, abs=1e-3)


def test_toxic_informed_flow_hazard(sieve):
    # Stock at 1000. Price impact is steep: 0.02 per share
    # Norm lambda = (0.02 * 1000 / 1000) * 10000 = 200 bps >> 12 bps
    intervals = []
    for i in range(25):
        q = (i - 12) * 100.0
        dp = 0.02 * q
        intervals.append(TradeInterval(price_change=dp, signed_volume=q))

    rep = sieve.evaluate_microstructure_flow("TOXIC_CO", 1000.0, intervals)

    assert rep.norm_lambda_bps >= 12.0
    assert rep.toxicity_regime == "TOXIC_INFORMED_FLOW_HAZARD"
    assert rep.execution_directive == "WIDEN_MAKER_SPREADS_RESTRICT_POV"
    assert rep.max_recommended_pov <= 0.05


def test_benign_noise_flow_deep_liquidity(sieve):
    # Deeply liquid stock at 2500 (e.g. RELIANCE)
    # Price impact is tiny: 0.00005 per share
    # Norm lambda = (0.00005 * 1000 / 2500) * 10000 = 0.20 bps <= 4 bps
    intervals = []
    for i in range(25):
        q = (i - 12) * 2000.0
        dp = 0.00005 * q
        intervals.append(TradeInterval(price_change=dp, signed_volume=q))

    rep = sieve.evaluate_microstructure_flow("RELIANCE", 2500.0, intervals)

    assert rep.norm_lambda_bps <= 4.0
    assert rep.toxicity_regime == "BENIGN_NOISE_FLOW_DEEP_LIQUIDITY"
    assert rep.execution_directive == "TIGHTEN_MAKER_SPREADS_AGGRESSIVE_TWAP"
    assert rep.max_recommended_pov >= 0.20


def test_sqlite_persistence(sieve):
    intervals = [TradeInterval(0.01 * (i % 3 - 1), 100.0 * (i % 5 - 2)) for i in range(25)]
    sieve.evaluate_microstructure_flow("PERSIST_SYM", 100.0, intervals)

    conn = sieve._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, raw_lambda, regime FROM kyles_lambda_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_SYM"
