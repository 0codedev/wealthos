"""
Unit Test Suite for Domain 277: High-Frequency Limit Order Book Order Flow Imbalance (OFI) Multi-Level Ridge Predictor
"""

import pytest
from services.lob_ofi_ridge_predictor import (
    LOBMultiLevelOFIRidgePredictor,
    RidgeCalibrationConfig,
    BookLevel,
    LOBLevelState,
    OFIFlowRegime,
    OFIExecutionDirective,
)


@pytest.fixture
def predictor():
    config = RidgeCalibrationConfig(
        num_levels=5,
        ridge_lambda=1e-3,
        adverse_z_threshold=2.5,
    )
    return LOBMultiLevelOFIRidgePredictor(config=config)


def test_level_ofi_calculation(predictor):
    # Test bid price jump (e_b = curr_size)
    l_prev = BookLevel(level=1, bid_price=100.0, bid_size=10.0, ask_price=101.0, ask_size=12.0)
    l_curr = BookLevel(level=1, bid_price=100.5, bid_size=15.0, ask_price=101.0, ask_size=12.0)
    # bid increased from 100.0 to 100.5 -> e_b = 15.0
    # ask unchanged -> e_a = 12.0 - 12.0 = 0.0
    # ofi = 15.0 - 0.0 = 15.0
    assert predictor.compute_level_ofi(l_prev, l_curr) == 15.0

    # Test ask price improvement (ask decreases -> e_a = +curr_size, selling pressure pushing mid down)
    l_curr2 = BookLevel(level=1, bid_price=100.0, bid_size=10.0, ask_price=100.8, ask_size=8.0)
    # bid unchanged -> e_b = 0
    # ask decreased from 101.0 to 100.8 -> e_a = +8.0
    # ofi = 0 - 8.0 = -8.0
    assert predictor.compute_level_ofi(l_prev, l_curr2) == -8.0


def test_balanced_equilibrium_flow(predictor):
    levels_t0 = [BookLevel(level=k, bid_price=100.0 - 0.1 * k, bid_size=10.0, ask_price=100.1 + 0.1 * k, ask_size=10.0) for k in range(1, 6)]
    levels_t1 = [BookLevel(level=k, bid_price=100.0 - 0.1 * k, bid_size=10.2, ask_price=100.1 + 0.1 * k, ask_size=10.1) for k in range(1, 6)]

    book_t0 = LOBLevelState(levels=levels_t0)
    book_t1 = LOBLevelState(levels=levels_t1)

    res = predictor.evaluate_order_flow("BTC-USDT", book_t0, book_t1, baseline_pred_std=0.50)

    assert res.regime == OFIFlowRegime.BALANCED_EQUILIBRIUM
    assert res.directive == OFIExecutionDirective.SYMMETRIC_MARKET_MAKING
    assert res.recommended_spread_skew_bps == 0.0
    assert abs(res.z_score) < 1.0


def test_toxic_buy_assault_pull_asks(predictor):
    # Aggressive upward sweep: best bid lifts, higher bids added across levels
    levels_t0 = [BookLevel(level=k, bid_price=100.0 - 0.1 * (k - 1), bid_size=5.0, ask_price=100.1 + 0.1 * (k - 1), ask_size=10.0) for k in range(1, 6)]
    # T1: bids jump up by 1 tick, ask queue wiped out
    levels_t1 = [BookLevel(level=k, bid_price=100.1 - 0.1 * (k - 1), bid_size=25.0, ask_price=100.2 + 0.1 * (k - 1), ask_size=2.0) for k in range(1, 6)]

    book_t0 = LOBLevelState(levels=levels_t0)
    book_t1 = LOBLevelState(levels=levels_t1)

    res = predictor.evaluate_order_flow("ETH-USDT", book_t0, book_t1, baseline_pred_std=1.0)

    assert res.regime == OFIFlowRegime.TOXIC_BUY_ASSAULT
    assert res.directive == OFIExecutionDirective.PULL_ASKS_SNIPE_BUY
    assert res.z_score >= 2.5
    assert res.recommended_spread_skew_bps > 0


def test_toxic_sell_cascade_pull_bids(predictor):
    # Aggressive downward sweep: ask price steps down, huge sell volume
    levels_t0 = [BookLevel(level=k, bid_price=100.0 - 0.1 * (k - 1), bid_size=10.0, ask_price=100.1 + 0.1 * (k - 1), ask_size=5.0) for k in range(1, 6)]
    # T1: asks jump down by 1 tick, bid queue wiped out
    levels_t1 = [BookLevel(level=k, bid_price=99.9 - 0.1 * (k - 1), bid_size=2.0, ask_price=100.0 + 0.1 * (k - 1), ask_size=30.0) for k in range(1, 6)]

    book_t0 = LOBLevelState(levels=levels_t0)
    book_t1 = LOBLevelState(levels=levels_t1)

    res = predictor.evaluate_order_flow("SOL-USDT", book_t0, book_t1, baseline_pred_std=1.0)

    assert res.regime == OFIFlowRegime.TOXIC_SELL_CASCADE
    assert res.directive == OFIExecutionDirective.PULL_BIDS_SNIPE_SELL
    assert res.z_score <= -2.5
    assert res.recommended_spread_skew_bps < 0


def test_ridge_coefficient_calibration(predictor):
    # Synthetic calibration history with 20 ticks
    # y ~ 0.5 * OFI_1 + 0.25 * OFI_2
    X = []
    y = []
    for i in range(25):
        row = [float(i + 1), float(i * 0.5), 1.0, 0.5, 0.2]
        target = 0.5 * row[0] + 0.25 * row[1]
        X.append(row)
        y.append(target)

    betas = predictor.fit_ridge_coefficients(X, y)
    assert len(betas) == 5
    # beta_0 should be highest positive impact
    assert betas[0] > betas[2]
    assert betas[0] > 0.0
