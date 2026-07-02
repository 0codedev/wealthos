r"""Unit Tests for High-Frequency Limit Order Book Liquidity Imbalance & Microstructure Drift Engine (Domain 202 / WP-CZ)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.lob_liquidity_imbalance_drift_engine import (
    LOBLiquidityImbalanceDriftEngine,
    BookLevel,
    L2DepthSnapshot,
    MicroDriftDirection,
    SkewedQuoteAction,
)


@pytest.fixture
def engine() -> LOBLiquidityImbalanceDriftEngine:
    return LOBLiquidityImbalanceDriftEngine(
        depth_levels=5,
        decay_factor=0.35,
        alpha_imbalance=1.80,
        tick_size=0.05,
    )


def test_symmetric_book_martingale(engine: LOBLiquidityImbalanceDriftEngine):
    bids = [
        BookLevel(price=25000.0 - i * 0.05, size=500.0)
        for i in range(5)
    ]
    asks = [
        BookLevel(price=25000.10 + i * 0.05, size=500.0)
        for i in range(5)
    ]
    snapshot = L2DepthSnapshot(timestamp_ms=1000, bids=bids, asks=asks)

    res = engine.calculate_imbalance_and_drift(snapshot)

    assert math.isclose(res.top_level_imbalance, 0.0, abs_tol=1e-4)
    assert math.isclose(res.multi_level_imbalance, 0.0, abs_tol=1e-4)
    assert math.isclose(res.stoikov_micro_price, res.mid_price, abs_tol=1e-4)
    assert res.drift_direction == MicroDriftDirection.BALANCED_MARTINGALE
    assert res.recommended_quote_action == SkewedQuoteAction.SYMMETRIC_INSIDE_SPREAD


def test_bullish_imbalance_drift(engine: LOBLiquidityImbalanceDriftEngine):
    # Heavy bid queue (2000 per level) vs thin ask queue (200 per level)
    bids = [
        BookLevel(price=25000.0 - i * 0.05, size=2000.0)
        for i in range(5)
    ]
    asks = [
        BookLevel(price=25000.10 + i * 0.05, size=200.0)
        for i in range(5)
    ]
    snapshot = L2DepthSnapshot(timestamp_ms=2000, bids=bids, asks=asks)

    res = engine.calculate_imbalance_and_drift(snapshot)

    assert res.top_level_imbalance > 0.70
    assert res.multi_level_imbalance > 0.70
    assert res.stoikov_micro_price > res.mid_price
    assert res.drift_direction in (MicroDriftDirection.STRONG_UPWARD_DRIFT, MicroDriftDirection.MILD_UPWARD_DRIFT)
    assert res.optimal_bid_offset_ticks == 0  # Lean bid at BBO


def test_toxic_sell_cascade_emergency_bid_cancel(engine: LOBLiquidityImbalanceDriftEngine):
    # Fragile bid book: very small bids far down vs gigantic ask wall pressing at top of book
    bids = [
        BookLevel(price=25000.0, size=50.0),
        BookLevel(price=24999.0, size=50.0),
        BookLevel(price=24998.0, size=50.0),
        BookLevel(price=24997.0, size=50.0),
        BookLevel(price=24996.0, size=50.0),
    ]
    asks = [
        BookLevel(price=25000.10, size=5000.0),
        BookLevel(price=25000.15, size=5000.0),
        BookLevel(price=25000.20, size=5000.0),
        BookLevel(price=25000.25, size=5000.0),
        BookLevel(price=25000.30, size=5000.0),
    ]
    snapshot = L2DepthSnapshot(timestamp_ms=3000, bids=bids, asks=asks)

    res = engine.calculate_imbalance_and_drift(snapshot)

    assert res.multi_level_imbalance < -0.80
    assert res.stoikov_micro_price < res.mid_price
    assert res.recommended_quote_action == SkewedQuoteAction.EMERGENCY_BID_CANCEL
    assert res.optimal_bid_offset_ticks >= 5


def test_quote_slope_and_elasticity(engine: LOBLiquidityImbalanceDriftEngine):
    bids = [BookLevel(25000.0 - i * 0.10, 100.0 * (i + 1)) for i in range(5)]
    asks = [BookLevel(25000.10 + i * 0.10, 100.0 * (i + 1)) for i in range(5)]
    snapshot = L2DepthSnapshot(timestamp_ms=4000, bids=bids, asks=asks)

    res = engine.calculate_imbalance_and_drift(snapshot)
    assert res.bid_quote_slope > 0.0
    assert res.ask_quote_slope > 0.0
    assert -1.0 <= res.slope_asymmetry <= 1.0
