"""
Unit tests for Domain 266 / WP-FL: LOB Micro-Price Jump Markov Transition Sentry
"""

import pytest
import numpy as np
from services.lob_microprice_markov_sentry import (
    LOBMicroPriceMarkovSentry,
    LOBJumpRegime,
    MicroPriceDirective,
)


@pytest.fixture
def sentry():
    return LOBMicroPriceMarkovSentry(
        imbalance_threshold=0.60,
        jump_prob_hurdle=0.65,
        hazard_delta_bps=3.0,
    )


def test_state_classification_boundaries(sentry):
    assert sentry.classify_imbalance_state(-0.80) == 0
    assert sentry.classify_imbalance_state(-0.40) == 1
    assert sentry.classify_imbalance_state(0.0) == 2
    assert sentry.classify_imbalance_state(0.40) == 3
    assert sentry.classify_imbalance_state(0.80) == 4


def test_equilibrium_steady_state(sentry):
    # Symmetric book: Bid 100.00 (50 qty), Ask 100.04 (50 qty)
    res = sentry.evaluate_lob(
        symbol="BTCUSDT",
        best_bid=100.00,
        best_ask=100.04,
        bid_qty=50.0,
        ask_qty=50.0,
    )

    assert res.regime == LOBJumpRegime.EQUILIBRIUM_STEADY_STATE
    assert res.directive == MicroPriceDirective.MAINTAIN_SYMMETRIC_QUOTES
    assert res.imbalance == 0.0
    assert res.micro_price == res.mid_price
    assert abs(res.micro_price_delta_bps) < 0.1


def test_upward_micro_price_jump_imminent(sentry):
    # Massive bid wall: Bid 100.00 (900 qty), Ask 100.10 (100 qty)
    # Imbalance = (900 - 100) / 1000 = +0.80 (State 4)
    res = sentry.evaluate_lob(
        symbol="ETHUSDT",
        best_bid=100.00,
        best_ask=100.10,
        bid_qty=900.0,
        ask_qty=100.0,
    )

    assert res.regime == LOBJumpRegime.UPWARD_MICRO_PRICE_JUMP_IMMINENT
    assert res.directive == MicroPriceDirective.PULL_RESTING_ASKS_BIAS_BID
    assert res.imbalance == 0.80
    assert res.current_regime_index == 4
    assert res.p_upward_jump >= 0.65
    assert res.micro_price > res.mid_price


def test_downward_micro_price_jump_imminent(sentry):
    # Massive ask wall: Bid 100.00 (100 qty), Ask 100.10 (900 qty)
    # Imbalance = (100 - 900) / 1000 = -0.80 (State 0)
    res = sentry.evaluate_lob(
        symbol="SOLUSDT",
        best_bid=100.00,
        best_ask=100.10,
        bid_qty=100.0,
        ask_qty=900.0,
    )

    assert res.regime == LOBJumpRegime.DOWNWARD_MICRO_PRICE_JUMP_IMMINENT
    assert res.directive == MicroPriceDirective.PULL_RESTING_BIDS_BIAS_ASK
    assert res.imbalance == -0.80
    assert res.current_regime_index == 0
    assert res.p_downward_jump >= 0.65
    assert res.micro_price < res.mid_price


def test_transition_matrix_update(sentry):
    # Custom empirical count matrix
    raw_counts = np.ones((5, 5)) * 10.0
    sentry.update_transition_matrix(raw_counts)

    # Check row sums are all 1.0
    row_sums = sentry.transition_matrix.sum(axis=1)
    np.testing.assert_allclose(row_sums, np.ones(5), rtol=1e-5)
