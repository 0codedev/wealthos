r"""Unit Tests for Multi-Venue Limit Order Book Depth Imbalance & Micro-Price Drift Martingale Engine (Domain 223 / WP-DU)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import pytest
from services.micro_price_drift_martingale_engine import (
    MicroPriceDriftMartingaleEngine,
    BookTier,
    MicroPriceRegime,
    MicroPriceAction,
)


@pytest.fixture
def engine() -> MicroPriceDriftMartingaleEngine:
    return MicroPriceDriftMartingaleEngine(
        decay_lambda=0.35,
        alpha_sensitivity=1.60,
        drift_threshold_ratio=0.15,
    )


def test_empty_book_safety(engine: MicroPriceDriftMartingaleEngine):
    res = engine.evaluate_micro_price("NIFTY", [], [])
    assert res.mid_price == 0.0
    assert res.regime == MicroPriceRegime.BALANCED_MARTINGALE
    assert res.recommended_action == MicroPriceAction.MAINTAIN_SYMMETRIC_QUOTES


def test_balanced_martingale(engine: MicroPriceDriftMartingaleEngine):
    # Symmetrical 5-tier book
    bids = [BookTier(price=100.0 - i * 0.05, volume=500.0) for i in range(5)]
    asks = [BookTier(price=100.10 + i * 0.05, volume=500.0) for i in range(5)]

    res = engine.evaluate_micro_price("BANKNIFTY", bids, asks)
    assert res.mid_price == 100.05
    assert res.stoikov_micro_price == 100.05
    assert res.level_1_imbalance == 0.0
    assert res.multi_tier_imbalance == 0.0
    assert res.micro_price_drift_bps == 0.0
    assert res.regime == MicroPriceRegime.BALANCED_MARTINGALE
    assert res.recommended_action == MicroPriceAction.MAINTAIN_SYMMETRIC_QUOTES


def test_bullish_upward_drift(engine: MicroPriceDriftMartingaleEngine):
    # Heavy bid depth (1500 shares) vs thin ask depth (300 shares)
    bids = [BookTier(price=100.0 - i * 0.05, volume=1500.0) for i in range(5)]
    asks = [BookTier(price=100.10 + i * 0.05, volume=300.0) for i in range(5)]

    res = engine.evaluate_micro_price("RELIANCE", bids, asks)
    assert res.mid_price == 100.05
    assert res.stoikov_micro_price > res.mid_price
    assert res.multi_tier_imbalance > 0.40
    assert res.micro_price_drift_bps > 0.0
    assert res.regime == MicroPriceRegime.BULLISH_UPWARD_DRIFT
    assert res.recommended_action == MicroPriceAction.SKEW_AGGRESSIVE_BID
    assert "BULLISH DRIFT" in res.tactical_directive


def test_bearish_downward_drift(engine: MicroPriceDriftMartingaleEngine):
    # Thin bid depth (300 shares) vs heavy ask depth (1500 shares)
    bids = [BookTier(price=100.0 - i * 0.05, volume=300.0) for i in range(5)]
    asks = [BookTier(price=100.10 + i * 0.05, volume=1500.0) for i in range(5)]

    res = engine.evaluate_micro_price("INFY", bids, asks)
    assert res.mid_price == 100.05
    assert res.stoikov_micro_price < res.mid_price
    assert res.multi_tier_imbalance < -0.40
    assert res.micro_price_drift_bps < 0.0
    assert res.regime == MicroPriceRegime.BEARISH_DOWNWARD_DRIFT
    assert res.recommended_action == MicroPriceAction.SKEW_AGGRESSIVE_ASK
    assert "BEARISH DRIFT" in res.tactical_directive


def test_acute_level_collapse(engine: MicroPriceDriftMartingaleEngine):
    # Extreme 95% bid imbalance
    bids = [BookTier(price=100.0 - i * 0.05, volume=5000.0) for i in range(5)]
    asks = [BookTier(price=100.10 + i * 0.05, volume=100.0) for i in range(5)]

    res = engine.evaluate_micro_price("TCS", bids, asks)
    assert res.multi_tier_imbalance >= 0.75
    assert res.regime == MicroPriceRegime.ACUTE_LEVEL_COLLAPSE
    assert res.recommended_action == MicroPriceAction.SWEEP_OR_EVACUATE
    assert "ACUTE LEVEL COLLAPSE" in res.tactical_directive
