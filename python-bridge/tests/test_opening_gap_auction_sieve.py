"""
Unit Tests for Intraday Opening Gap Fade & Auction Price Discovery Equilibrium Sieve (Domain 148 / WP-AX)
"""

import pytest

from services.opening_gap_auction_sieve import (
    OpeningGapAuctionSieve,
    PreOpenAuctionData,
    GapAnalysisReport,
)


@pytest.fixture
def sieve():
    return OpeningGapAuctionSieve(
        db_path=":memory:",
        fill_prob_hurdle=0.65,
    )


def test_gap_up_exhaustion_fade(sieve):
    # Gap up 80 pts with heavy unmatched sell supply (OIR = -0.60) -> Fade short
    auction = PreOpenAuctionData(
        symbol="NIFTY",
        prev_close=25000.0,
        open_price=25080.0,
        atr_20=120.0,
        matched_volume=50000.0,
        unmatched_buy_qty=10000.0,
        unmatched_sell_qty=40000.0,
        typical_opening_volume=100000.0,
    )
    rep = sieve.evaluate_opening_gap(auction)

    assert rep.gap_pts == 80.0
    assert 0.5 < rep.gap_z_score < 1.0
    assert rep.order_imbalance_ratio < -0.50
    assert rep.gap_fill_probability >= 0.70
    assert rep.regime == "GAP_UP_EXHAUSTION_FADE"
    assert rep.execution_directive == "SELL_SHORT_TARGET_PREV_CLOSE"
    assert rep.target_price == 25000.0
    assert rep.stop_price > 25080.0
    assert rep.risk_reward_ratio >= 1.5


def test_gap_down_exhaustion_fade(sieve):
    # Gap down 80 pts with strong unmatched buy support (OIR = +0.67) -> Fade long
    auction = PreOpenAuctionData(
        symbol="NIFTY",
        prev_close=25000.0,
        open_price=24920.0,
        atr_20=120.0,
        matched_volume=50000.0,
        unmatched_buy_qty=50000.0,
        unmatched_sell_qty=10000.0,
        typical_opening_volume=100000.0,
    )
    rep = sieve.evaluate_opening_gap(auction)

    assert rep.gap_pts == -80.0
    assert rep.gap_fill_probability >= 0.70
    assert rep.regime == "GAP_DOWN_EXHAUSTION_FADE"
    assert rep.execution_directive == "BUY_LONG_TARGET_PREV_CLOSE"
    assert rep.target_price == 25000.0
    assert rep.stop_price < 24920.0


def test_runaway_gap_continuation(sieve):
    # Massive gap up 280 pts (> 2.0 ATR) with colossal buy imbalance -> Do not fade!
    auction = PreOpenAuctionData(
        symbol="NIFTY",
        prev_close=25000.0,
        open_price=25280.0,
        atr_20=120.0,
        matched_volume=200000.0,
        unmatched_buy_qty=100000.0,
        unmatched_sell_qty=5000.0,
        typical_opening_volume=100000.0,
    )
    rep = sieve.evaluate_opening_gap(auction)

    assert rep.gap_z_score > 2.0
    assert rep.gap_fill_probability < 0.35
    assert rep.regime == "RUNAWAY_GAP_CONTINUATION"
    assert rep.execution_directive == "GO_LONG_MOMENTUM_RUNNER"
    assert rep.target_price > 25280.0


def test_neutral_open_equilibrium(sieve):
    auction = PreOpenAuctionData(
        symbol="NIFTY",
        prev_close=25000.0,
        open_price=25010.0,
        atr_20=120.0,
        matched_volume=80000.0,
        unmatched_buy_qty=20000.0,
        unmatched_sell_qty=20000.0,
        typical_opening_volume=100000.0,
    )
    rep = sieve.evaluate_opening_gap(auction)

    assert abs(rep.gap_z_score) < 0.25
    assert rep.regime == "NEUTRAL_OPEN_EQUILIBRIUM"
    assert rep.execution_directive == "NO_ACTION_RANGE_OPEN"


def test_sqlite_persistence(sieve):
    auction = PreOpenAuctionData(
        symbol="PERSIST_GAP",
        prev_close=1000.0,
        open_price=1010.0,
        atr_20=15.0,
        matched_volume=5000.0,
        unmatched_buy_qty=1000.0,
        unmatched_sell_qty=1000.0,
    )
    sieve.evaluate_opening_gap(auction)

    conn = sieve._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, prev_close, open_price, gap_z, regime FROM opening_gap_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_GAP"
    assert row[1] == 1000.0
    assert row[2] == 1010.0
    assert isinstance(row[4], str)
