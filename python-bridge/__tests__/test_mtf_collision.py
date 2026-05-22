"""
python-bridge/__tests__/test_mtf_collision.py — Unit Tests for MTF Collision Engine
"""

import sys
import os
import pytest
import numpy as np

# Add python-bridge directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.feature_store import FeatureStore
from services.mtf_collision_engine import MTFCollisionEngine, mtf_collision_engine


def test_zero_lookahead_temporal_guard():
    """Verify that 5m bars never join with 15m bars closed in the future."""
    engine = MTFCollisionEngine()

    # Invariant checks
    assert engine.verify_zero_lookahead(bar_5m_ts=1000.0, bar_15m_close_ts=900.0) is True
    assert engine.verify_zero_lookahead(bar_5m_ts=1000.0, bar_15m_close_ts=1000.0) is True
    assert engine.verify_zero_lookahead(bar_5m_ts=1000.0, bar_15m_close_ts=1001.0) is False

    # Simulate chronological series of bars
    bars_15m = [
        {"timestamp": 900.0, "close": 100.0},
        {"timestamp": 1800.0, "close": 102.0},
        {"timestamp": 2700.0, "close": 105.0},
    ]
    bars_5m = [
        {"timestamp": 600.0, "close": 99.0},
        {"timestamp": 900.0, "close": 100.0},
        {"timestamp": 1200.0, "close": 100.5},
        {"timestamp": 1500.0, "close": 101.0},
        {"timestamp": 1800.0, "close": 102.0},
        {"timestamp": 2100.0, "close": 103.0},
    ]

    aligned = engine.align_asof_bars(bars_5m, bars_15m)
    # The bar at 600 cannot join any 15m bar since first 15m closed at 900
    assert len(aligned) == 5

    for b5, b15 in aligned:
        t5 = float(b5["timestamp"])
        t15 = float(b15["timestamp"])
        assert t15 <= t5, f"Lookahead violation detected: 15m ({t15}) > 5m ({t5})"


def test_concordant_expansion_collision():
    """Verify that triple bullish alignment yields CONCORDANT_EXPANSION with high conviction."""
    store = FeatureStore()
    engine = MTFCollisionEngine()

    sym = "NIFTY"
    # Seed bars and context indicating strong upward momentum
    for i in range(20):
        p5 = 24000 + i * 10
        store.update_bar(sym, "5m", p5, p5 + 5, p5 - 2, p5 + 8, 50000)
        p15 = 23900 + i * 12
        store.update_bar(sym, "15m", p15, p15 + 8, p15 - 3, p15 + 10, 150000)

    store.update_quote(sym, ltp=24250.0, bid_qty=5000, ask_qty=1000, cvd=50000.0)
    vec = store.get_feature_vector_32(sym, current_price=24250.0)

    res = engine.resolve_collision(vec, symbol=sym)

    assert res["collision_state"] == "CONCORDANT_EXPANSION"
    assert res["directional_bias"] == "BULLISH"
    assert res["conviction_multiplier"] >= 1.25
    assert res["is_noise"] is False


def test_chop_noise_gate_filtering():
    """Verify that choppy, low-efficiency conditions trigger the Noise Gate (0.0 conviction)."""
    store = FeatureStore()
    engine = MTFCollisionEngine()

    sym = "HDFCBANK"
    # Seed flat alternating chop (ER will be low)
    for i in range(20):
        p = 1500.0 + (5.0 if i % 2 == 0 else -5.0)
        store.update_bar(sym, "5m", p, p + 2, p - 2, p, 10000)

    # Low directional flow
    store.update_quote(sym, ltp=1500.0, bid_qty=1000, ask_qty=1000, cvd=0.0)
    vec = store.get_feature_vector_32(sym, current_price=1500.0)

    res = engine.resolve_collision(vec, symbol=sym)

    assert res["collision_state"] == "CHOP_COLLISION"
    assert res["is_noise"] is True
    assert res["conviction_multiplier"] == 0.00
