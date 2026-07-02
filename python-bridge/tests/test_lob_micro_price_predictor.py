"""
Unit Tests for High-Frequency Limit Order Book Micro-Price & Imbalance Drift Predictor (Domain 155 / WP-BE)
"""

import pytest
from services.lob_micro_price_predictor import (
    LOBMicroPricePredictor,
    LOBLevel,
    LOBDepthSnapshot,
    MicroPriceReport,
)


@pytest.fixture
def predictor():
    return LOBMicroPricePredictor(
        db_path=":memory:",
        decay_lambda=0.50,
        drift_hurdle_bps=3.0,
        imbalance_hurdle=0.75,
        markov_sensitivity=6.0,
    )


def test_symmetric_book_equilibrium(predictor):
    bids = [
        LOBLevel(100.0, 1000),
        LOBLevel(99.9, 1000),
        LOBLevel(99.8, 1000),
    ]
    asks = [
        LOBLevel(100.2, 1000),
        LOBLevel(100.3, 1000),
        LOBLevel(100.4, 1000),
    ]
    snap = LOBDepthSnapshot("SYMM_SYM", bids, asks)
    rep = predictor.calculate_micro_price(snap)

    assert rep.mid_price == 100.1
    assert rep.micro_price == pytest.approx(100.1, abs=1e-3)
    assert rep.imbalance_ratio == 0.5
    assert rep.multi_level_imbalance == pytest.approx(0.5, abs=1e-3)
    assert abs(rep.drift_bps) < 0.01
    assert rep.prob_next_tick_ask == pytest.approx(0.5, abs=1e-3)
    assert rep.regime == "BALANCED_BOOK_EQUILIBRIUM"
    assert rep.trade_directive == "POST_PASSIVE_BID_ASK_LIQUIDITY"


def test_strong_upward_imbalance_drift(predictor):
    # Bid side has massive wall: 10,000 shares at 100.0
    # Ask side is paper-thin: 200 shares at 100.2
    bids = [
        LOBLevel(100.0, 10000),
        LOBLevel(99.9, 8000),
        LOBLevel(99.8, 7000),
    ]
    asks = [
        LOBLevel(100.2, 200),
        LOBLevel(100.3, 300),
        LOBLevel(100.4, 250),
    ]
    snap = LOBDepthSnapshot("BULL_LOB", bids, asks)
    rep = predictor.calculate_micro_price(snap)

    assert rep.micro_price > rep.mid_price
    assert rep.multi_level_imbalance > 0.80
    assert rep.drift_bps >= 3.0
    assert rep.prob_next_tick_ask > 0.80
    assert rep.regime == "STRONG_UPWARD_IMBALANCE_DRIFT"
    assert rep.trade_directive == "CROSS_SPREAD_AGGRESSIVE_BUY"


def test_strong_downward_imbalance_drift(predictor):
    # Ask side is heavily stacked (15,000 shares), bids are scarce (300 shares)
    bids = [
        LOBLevel(500.0, 300),
        LOBLevel(499.5, 200),
    ]
    asks = [
        LOBLevel(501.0, 15000),
        LOBLevel(501.5, 12000),
    ]
    snap = LOBDepthSnapshot("BEAR_LOB", bids, asks)
    rep = predictor.calculate_micro_price(snap)

    assert rep.micro_price < rep.mid_price
    assert rep.multi_level_imbalance < 0.20
    assert rep.drift_bps <= -3.0
    assert rep.prob_next_tick_ask < 0.20
    assert rep.regime == "STRONG_DOWNWARD_IMBALANCE_DRIFT"
    assert rep.trade_directive == "CROSS_SPREAD_AGGRESSIVE_SELL"


def test_markov_tick_probability_monotonicity(predictor):
    probs = []
    for bid_q in [100, 500, 1000, 2000, 5000]:
        snap = LOBDepthSnapshot(
            "MONO_SYM",
            bids=[LOBLevel(100.0, bid_q)],
            asks=[LOBLevel(100.5, 1000)],
        )
        rep = predictor.calculate_micro_price(snap)
        probs.append(rep.prob_next_tick_ask)

    # Must be strictly increasing
    for i in range(len(probs) - 1):
        assert probs[i] < probs[i + 1]


def test_sqlite_persistence(predictor):
    snap = LOBDepthSnapshot(
        "PERSIST_SYM",
        bids=[LOBLevel(100.0, 500)],
        asks=[LOBLevel(100.5, 500)],
    )
    predictor.calculate_micro_price(snap)

    conn = predictor._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, best_bid, best_ask, regime FROM lob_micro_price_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_SYM"
