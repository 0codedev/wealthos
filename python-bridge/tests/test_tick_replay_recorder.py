"""Unit tests for python-bridge/services/tick_replay_recorder.py (Domain 116)."""
from __future__ import annotations

import os
import sys
import time
import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from services.tick_replay_recorder import (
    NanosecondTick,
    MicrosecondDriftEstimator,
    CircularTickRingBuffer,
    NanosecondTickRecorder,
    TickReplayer,
)


def test_nanosecond_tick_properties():
    t = NanosecondTick(
        symbol="NIFTY26OCT25000CE",
        exchange_ts_ns=1792278000000000000,
        local_receive_ts_ns=1792278000005000000,
        drift_us=5.0,
        ltp=150.50,
        volume=1000,
        bid_p1=150.25,
        bid_q1=75,
        ask_p1=150.75,
        ask_q1=25,
        oi=50000,
    )

    assert t.mid_price == 150.50
    assert pytest.approx(t.spread, 1e-4) == 0.50
    # OBI: (75 - 25) / (75 + 25) = 50 / 100 = +0.50
    assert pytest.approx(t.top_obi, 1e-4) == 0.50


def test_drift_estimator_convergence():
    est = MicrosecondDriftEstimator(ema_alpha=0.1)
    base_ts = 1792278000000000000
    true_drift_us = 45.0

    for i in range(50):
        ex_ts = base_ts + i * 1_000_000
        # Add small jitter around 45us
        local_ts = ex_ts + int(true_drift_us * 1000) + (i % 3 - 1) * 1000
        drift = est.update(ex_ts, local_ts)

    assert pytest.approx(drift, abs=2.0) == true_drift_us
    assert est.sample_count == 50
    assert est.outlier_count == 0


def test_drift_estimator_outlier_rejection():
    est = MicrosecondDriftEstimator(ema_alpha=0.1, max_acceptable_drift_ms=1000.0)
    base_ts = 1792278000000000000
    est.update(base_ts, base_ts + 10_000_000)  # 10ms valid

    # Inject an absurd outlier (10 seconds clock skew leap)
    outlier_local = base_ts + 10_000_000_000  # 10,000ms
    drift = est.update(base_ts, outlier_local)

    assert est.outlier_count == 1
    # Drift should not have jumped to 10s
    assert drift < 100_000.0


def test_circular_ring_buffer_fifo():
    buf = CircularTickRingBuffer(capacity=4)
    ticks = [
        NanosecondTick("TEST", i, i, 0.0, float(i), i)
        for i in range(1, 4)
    ]

    for t in ticks:
        assert buf.push(t) is True

    assert buf.count == 3
    t1 = buf.pop()
    assert t1 is not None and t1.symbol == "TEST" and t1.ltp == 1.0
    assert buf.count == 2


def test_circular_ring_buffer_drain():
    buf = CircularTickRingBuffer(capacity=8)
    for i in range(5):
        buf.push(NanosecondTick("TEST", i, i, 0.0, float(i), i))

    drained = buf.drain(max_items=3)
    assert len(drained) == 3
    assert [t.ltp for t in drained] == [0.0, 1.0, 2.0]
    assert buf.count == 2


def test_circular_ring_buffer_overflow():
    buf = CircularTickRingBuffer(capacity=4)
    for i in range(6):  # Push 6 items into capacity 4
        buf.push(NanosecondTick("TEST", i, i, 0.0, float(i), i))

    assert buf.count == 4
    assert buf.dropped == 2
    # Oldest remaining should be item 2
    t = buf.pop()
    assert t is not None and t.ltp == 2.0


def test_tick_recorder_batch_flush():
    rec = NanosecondTickRecorder(db_path=":memory:", batch_size=100)
    for i in range(25):
        rec.record_tick("RELIANCE", ltp=2500.0 + i, volume=100 * i)

    assert rec.ring_buffer.count == 25
    flushed = rec.flush()
    assert flushed == 25
    assert rec.total_recorded == 25
    assert rec.ring_buffer.count == 0


def test_tick_recorder_background_flusher():
    rec = NanosecondTickRecorder(db_path=":memory:", batch_size=50, flush_interval_sec=0.02)
    rec.start_background_flusher()

    for i in range(60):
        rec.record_tick("TCS", ltp=3500.0 + i, volume=50)

    time.sleep(0.08)
    rec.stop_background_flusher()
    assert rec.total_recorded == 60


def test_tick_replayer_asap():
    ticks = [
        NanosecondTick("INFY", 1000 + i * 100, 1000 + i * 100, 0.0, 1500.0 + i, 10)
        for i in range(100)
    ]
    replayer = TickReplayer(ticks)

    t0 = time.time()
    replayed = list(replayer.replay_stream(speed_multiplier=0.0))
    elapsed = time.time() - t0

    assert len(replayed) == 100
    assert elapsed < 0.05  # Replaying 100 ticks in ASAP mode takes <50ms


def test_tick_replayer_callbacks():
    ticks = [
        NanosecondTick("HDFC", 1000 + i, 1000 + i, 0.0, 1600.0 + i, 10)
        for i in range(10)
    ]
    replayer = TickReplayer(ticks)
    received = []

    list(replayer.replay_stream(speed_multiplier=0.0, callback=lambda t: received.append(t.ltp)))
    assert len(received) == 10
    assert received[0] == 1600.0
    assert received[-1] == 1609.0


def test_roundtrip_record_and_replay():
    rec = NanosecondTickRecorder(db_path=":memory:", batch_size=500)
    base_ns = 1792278000000000000

    for i in range(200):
        rec.record_tick(
            symbol="SBIN",
            ltp=800.0 + (i * 0.1),
            volume=50 * (i + 1),
            exchange_ts_ns=base_ns + i * 10_000_000,
            bid_p1=799.9 + (i * 0.1),
            bid_q1=100,
            ask_p1=800.1 + (i * 0.1),
            ask_q1=100,
        )

    rec.flush()
    conn = rec._get_connection()
    replayer = TickReplayer.from_sqlite(db_path=":memory:", symbol="SBIN", conn=conn)

    assert len(replayer.ticks) == 200
    replayed_ticks = list(replayer.replay_stream(speed_multiplier=0.0))
    assert len(replayed_ticks) == 200
    assert replayed_ticks[0].symbol == "SBIN"
    assert pytest.approx(replayed_ticks[0].ltp, 1e-4) == 800.0
    assert pytest.approx(replayed_ticks[-1].ltp, 1e-4) == 819.9
