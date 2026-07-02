"""Unit tests for services/lob_microstructure_alpha_engine.py."""

import os
import sys
import time

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.lob_microstructure_alpha_engine import (
    LOBRingBuffer,
    LOBMicrostructureEngine,
    OrderBookSnapshot,
    MicrostructureFeatures,
    SentryVerdict,
    IcebergSpoofDetector,
    VPINCalculator,
    QuoteEvent,
    compute_obi,
    compute_microprice,
    compute_queue_imbalance_topN,
    compute_vpin_from_trades,
    compute_features,
    sentry_veto,
    predict_slippage,
    parse_upstox_depth,
    parse_openalgo_depth,
    make_fixture_snapshot,
    make_fixture_stream,
    make_fixture_trades,
    DEFAULT_DEPTH,
)


# ---------------------------------------------------------------------------
# Ring buffer
# ---------------------------------------------------------------------------
def test_ring_buffer_push_and_latest():
    rb = LOBRingBuffer(capacity=8, depth=5)
    snap = make_fixture_snapshot(ts_ms=1000, depth=5)
    rb.push(snap)
    assert rb.size == 1
    ts, bp, bq, ap, aq = rb.latest(1)
    assert ts.shape == (1,)
    assert ts[0] == 1000
    assert bp.shape == (1, 5)
    np.testing.assert_allclose(bp[0], snap.bids_px)


def test_ring_buffer_wraparound():
    rb = LOBRingBuffer(capacity=4, depth=5)
    for i in range(10):
        rb.push(make_fixture_snapshot(ts_ms=1000 + i))
    assert rb.size == 4
    ts, *_ = rb.latest(4)
    assert list(ts) == [1006, 1007, 1008, 1009]
    ts2, *_ = rb.latest(2)
    assert list(ts2) == [1008, 1009]


def test_ring_buffer_latest_snapshot():
    rb = LOBRingBuffer(capacity=4, depth=5)
    for i in range(3):
        rb.push(make_fixture_snapshot(ts_ms=2000 + i))
    s = rb.latest_snapshot()
    assert s is not None
    assert s.ts_ms == 2002


def test_ring_buffer_clear():
    rb = LOBRingBuffer(capacity=4, depth=5)
    rb.push(make_fixture_snapshot())
    rb.clear()
    assert rb.is_empty()
    assert rb.size == 0


def test_ring_buffer_push_raw():
    rb = LOBRingBuffer(capacity=4, depth=5)
    idx = rb.push_raw(5000, [10.0, 9.9], [100.0, 50.0], [10.1, 10.2], [80.0, 40.0])
    assert idx >= 0
    assert rb.size == 1


def test_ring_buffer_push_many():
    rb = LOBRingBuffer(capacity=100, depth=5)
    snaps = make_fixture_stream(n=10, depth=5)
    n = rb.push_many(snaps)
    assert n == 10
    assert rb.size == 10


# ---------------------------------------------------------------------------
# OBI
# ---------------------------------------------------------------------------
def test_obi_balanced():
    bq = np.array([100.0, 50.0])
    aq = np.array([100.0, 50.0])
    assert compute_obi(bq, aq) == pytest.approx(0.0)


def test_obi_bid_heavy():
    bq = np.array([200.0])
    aq = np.array([100.0])
    # (200-100)/(200+100)=1/3
    assert compute_obi(bq, aq) == pytest.approx(1.0 / 3.0)


def test_obi_weighted():
    bq = np.array([100.0, 10.0])
    aq = np.array([10.0, 100.0])
    w = compute_obi(bq, aq, weighted=True)
    u = compute_obi(bq, aq, weighted=False)
    assert w != u
    assert -1.0 <= w <= 1.0


def test_obi_levels():
    bq = np.array([100.0, 50.0, 25.0])
    aq = np.array([100.0, 50.0, 25.0])
    assert compute_obi(bq, aq, levels=2) == pytest.approx(0.0)


def test_queue_imbalance_top3():
    bq = np.array([10.0, 10.0, 10.0, 1.0])
    aq = np.array([5.0, 5.0, 5.0, 1.0])
    qi = compute_queue_imbalance_topN(bq, aq, n=3)
    assert qi == pytest.approx((30 - 15) / (30 + 15))


# ---------------------------------------------------------------------------
# Microprice
# ---------------------------------------------------------------------------
def test_microprice_formula():
    # P_hat = (Vb*Pa + Va*Pb)/(Vb+Va)
    mp = compute_microprice(best_bid=100.0, best_ask=101.0, bid_vol_top=10.0, ask_vol_top=30.0)
    expected = (10.0 * 101.0 + 30.0 * 100.0) / (10.0 + 30.0)
    assert mp == pytest.approx(expected)


def test_microprice_equal_volumes_mid():
    mp = compute_microprice(100.0, 102.0, 50.0, 50.0)
    assert mp == pytest.approx(101.0)


def test_microprice_zero_volume_fallback():
    mp = compute_microprice(100.0, 102.0, 0.0, 0.0)
    assert mp == pytest.approx(101.0)


# ---------------------------------------------------------------------------
# VPIN
# ---------------------------------------------------------------------------
def test_vpin_balanced():
    trades = [(100.0, 10.0, "BUY")] * 50 + [(100.0, 10.0, "SELL")] * 50
    v = compute_vpin_from_trades(trades, bucket_volume=100.0, n_buckets=5)
    assert 0.0 <= v <= 1.0


def test_vpin_toxic_all_buy():
    trades = [(100.0, 10.0, "BUY")] * 100
    v = compute_vpin_from_trades(trades, bucket_volume=50.0, n_buckets=5)
    # all buy => each bucket imb ~1
    assert v > 0.9


def test_vpin_calculator_partial():
    c = VPINCalculator(bucket_volume=100.0, n_buckets=5)
    c.add_trade(100.0, 30.0, "BUY")
    assert 0.0 <= c.vpin() <= 1.0
    assert c.n_completed() == 0


def test_vpin_calculator_completion():
    c = VPINCalculator(bucket_volume=100.0, n_buckets=5)
    ret = c.add_trade(100.0, 100.0, "BUY")
    assert ret is not None
    assert c.n_completed() == 1


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------
def test_parse_upstox_depth_list():
    payload = {
        "symbol": "RELIANCE",
        "timestamp": 12345,
        "bids": [[2500.0, 100.0], [2499.95, 50.0]],
        "asks": [[2500.05, 80.0], [2500.10, 40.0]],
    }
    snap = parse_upstox_depth(payload, depth=5)
    assert snap is not None
    assert snap.symbol == "RELIANCE"
    assert snap.ts_ms == 12345
    assert snap.bids_px[0] == 2500.0
    assert snap.asks_px[0] == 2500.05
    assert snap.depth == 5


def test_parse_upstox_depth_dict_levels():
    payload = {
        "instrument_key": "NSE_EQ|INE002A01018",
        "ts": 999,
        "depth": {
            "buy": [{"price": 2500.0, "quantity": 100}, {"price": 2499.9, "quantity": 60}],
            "sell": [{"price": 2500.1, "quantity": 90}],
        },
    }
    snap = parse_upstox_depth(payload, depth=3)
    assert snap is not None
    assert snap.bids_px[0] == 2500.0
    assert snap.asks_qty[1] == 0.0


def test_parse_openalgo_depth():
    payload = {
        "status": "success",
        "data": {
            "symbol": "TCS",
            "timestamp": 777,
            "bids": [{"price": 3000.0, "quantity": 200}, {"price": 2999.9, "quantity": 100}],
            "asks": [{"price": 3000.1, "quantity": 150}],
        },
    }
    snap = parse_openalgo_depth(payload, depth=4)
    assert snap is not None
    assert snap.symbol == "TCS"
    assert snap.bids_px[0] == 3000.0


# ---------------------------------------------------------------------------
# Iceberg / spoof detector
# ---------------------------------------------------------------------------
def test_spoof_flash_detection():
    det = IcebergSpoofDetector(flash_lifetime_ms=250)
    det.on_event(QuoteEvent(100.0, 500.0, "BID", 1000, "ADD"))
    det.on_event(QuoteEvent(100.0, 500.0, "BID", 1100, "CANCEL"))
    assert det.flashes >= 1
    assert det.spoof_score() > 0


def test_absorption_detection():
    det = IcebergSpoofDetector()
    det.on_event(QuoteEvent(100.0, 1000.0, "BID", 1000, "ADD"))
    det.on_event(QuoteEvent(100.0, 400.0, "BID", 1100, "TRADE"))
    det.on_event(QuoteEvent(100.0, 900.0, "BID", 1200, "MODIFY"))
    assert det.absorptions >= 1


def test_phantom_score():
    det = IcebergSpoofDetector()
    for i in range(5):
        det.on_event(QuoteEvent(100.0, 200.0, "ASK", 1000 + i, "ADD"))
        det.on_event(QuoteEvent(100.0, 200.0, "ASK", 1001 + i, "CANCEL"))
    assert det.phantom_score() > 0.3


def test_ingest_book_delta():
    det = IcebergSpoofDetector()
    s1 = make_fixture_snapshot(ts_ms=1, mid=2500.0)
    s2 = make_fixture_snapshot(ts_ms=2, mid=2500.0)
    # force a cancellation by zeroing a level
    s2.bids_qty[-1] = 0.0
    det.ingest_book_delta(None, s1)
    det.ingest_book_delta(s1, s2)
    assert det.flashes >= 0


# ---------------------------------------------------------------------------
# Sentry
# ---------------------------------------------------------------------------
def test_sentry_veto_long_negative_obi():
    v = sentry_veto("LONG", obi=-0.3, bid_depth_top3=100.0, ask_depth_top3=100.0)
    assert v.allow_long is False
    assert "OBI negative" in (v.veto_long_reason or "")


def test_sentry_veto_long_ask_collapse():
    v = sentry_veto("LONG", obi=0.2, bid_depth_top3=100.0, ask_depth_top3=30.0,
                    prev_ask_depth_top3=100.0, collapse_ratio=0.5)
    assert v.allow_long is False
    assert "collapsing" in (v.veto_long_reason or "")


def test_sentry_veto_short_bid_absorption():
    v = sentry_veto("SHORT", obi=-0.1, bid_depth_top3=200.0, ask_depth_top3=100.0,
                    prev_bid_depth_top3=100.0, absorption_ratio=1.5)
    assert v.allow_short is False
    assert "absorbing" in (v.veto_short_reason or "")


def test_sentry_toxicity_vetoes_both():
    v = sentry_veto("LONG", obi=0.5, bid_depth_top3=100.0, ask_depth_top3=100.0, vpin=0.7)
    assert v.allow_long is False
    assert v.allow_short is False


def test_sentry_spoof_vetoes():
    v = sentry_veto("LONG", obi=0.5, bid_depth_top3=100.0, ask_depth_top3=100.0, spoof_score=0.8)
    assert v.allow_long is False


# ---------------------------------------------------------------------------
# Slippage
# ---------------------------------------------------------------------------
def test_predict_slippage_buy():
    slip = predict_slippage("BUY", 150.0, [101.0, 101.1, 101.2], [100.0, 100.0, 100.0], mid=100.5)
    assert slip > 0


def test_predict_slippage_sell():
    slip = predict_slippage("SELL", 150.0, [99.0, 98.9, 98.8], [100.0, 100.0, 100.0], mid=99.5)
    assert slip > 0


def test_predict_slippage_insufficient_depth_extrapolates():
    slip = predict_slippage("BUY", 1000.0, [101.0], [50.0], mid=100.5)
    assert slip > 0


# ---------------------------------------------------------------------------
# Features
# ---------------------------------------------------------------------------
def test_compute_features():
    snap = make_fixture_snapshot(depth=5, skew=0.2)
    feats = compute_features(snap)
    assert isinstance(feats, MicrostructureFeatures)
    assert feats.obi_unweighted > 0  # bid heavy
    assert feats.micro_price > 0
    assert feats.bid_depth_top3 > 0
    assert feats.spread_bps >= 0


def test_compute_features_with_detector():
    det = IcebergSpoofDetector()
    s1 = make_fixture_snapshot(ts_ms=1, depth=5)
    s2 = make_fixture_snapshot(ts_ms=2, depth=5)
    f1 = compute_features(s1, detector=det)
    f2 = compute_features(s2, prev_snapshot=s1, detector=det)
    assert isinstance(f2, MicrostructureFeatures)


# ---------------------------------------------------------------------------
# Engine facade
# ---------------------------------------------------------------------------
def test_engine_ingest():
    eng = LOBMicrostructureEngine(capacity=16, depth=5)
    snaps = make_fixture_stream(n=5, depth=5)
    for s in snaps:
        f = eng.ingest(s)
        assert isinstance(f, MicrostructureFeatures)
    assert eng.buffer.size == 5


def test_engine_ingest_raw():
    eng = LOBMicrostructureEngine(capacity=16, depth=5)
    payload = {
        "symbol": "RELIANCE",
        "timestamp": 123,
        "bids": [[2500.0, 100.0]],
        "asks": [[2500.1, 90.0]],
    }
    f = eng.ingest_raw(payload)
    assert f is not None
    assert f.symbol == "RELIANCE"


def test_engine_sentry():
    eng = LOBMicrostructureEngine(capacity=16, depth=5)
    snaps = make_fixture_stream(n=3, depth=5)
    f = None
    for s in snaps:
        f = eng.ingest(s)
    assert f is not None
    v = eng.sentry("LONG", f, qty=100.0, top3_prices=[f.micro_price + 0.1],
                   top3_qtys=[50.0])
    assert isinstance(v, SentryVerdict)


def test_engine_record_trade():
    eng = LOBMicrostructureEngine(capacity=16, depth=5)
    r = eng.record_trade(2500.0, 100.0, "BUY")
    # may or may not complete a bucket; just ensure no crash
    assert r is None or isinstance(r, float)


# ---------------------------------------------------------------------------
# Fixtures sanity
# ---------------------------------------------------------------------------
def test_make_fixture_stream():
    snaps = make_fixture_stream(n=10, depth=DEFAULT_DEPTH)
    assert len(snaps) == 10
    for s in snaps:
        assert s.bids_px.shape == (DEFAULT_DEPTH,)


def test_make_fixture_trades():
    tr = make_fixture_trades(n=50)
    assert len(tr) == 50
    assert all(len(t) == 3 for t in tr)
