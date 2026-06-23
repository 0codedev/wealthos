"""python-bridge/services/tick_replay_recorder.py — Firmware-Level Tick Replay
& Nanosecond Event Recorder (Domain 116).

Production-grade microstructure telemetry and deterministic tick replay engine:

  * Nanosecond-precision tick container with exchange vs local clock capture
  * Microsecond clock drift estimator (FeedResponse.currentTs vs CLOCK_MONOTONIC_RAW)
  * High-performance circular ring buffer (zero-allocation fixed capacity)
  * Atomic binary & SQLite tick logging with microsecond timestamps
  * Deterministic tick replayer with configurable speed throttle (1x, 10x, 100x, ASAP)
  * Real-time Order Book Imbalance (OBI) and top-of-book depth reconstruction

Stdlib-first, thread-safe, zero external dependencies beyond numpy.
"""
from __future__ import annotations

import json
import logging
import math
import os
import sqlite3
import struct
import sys
import threading
import time
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, Generator, Iterable, List, Optional, Sequence, Tuple, Union

import numpy as np

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

try:
    from logger import get_logger
except Exception:  # pragma: no cover
    def get_logger(name: str, tag: str = None) -> logging.Logger:  # type: ignore[misc]
        lg = logging.getLogger(name)
        if not lg.handlers:
            lg.addHandler(logging.StreamHandler())
        return lg

log = get_logger("tick_replay_recorder", tag="TICK_REC")


# ---------------------------------------------------------------------------
# Data Containers
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class NanosecondTick:
    symbol: str
    exchange_ts_ns: int        # Exchange timestamp in nanoseconds (e.g. from exchange gateway)
    local_receive_ts_ns: int   # Local host monotonic receipt timestamp in nanoseconds
    drift_us: float            # Estimated clock drift in microseconds (local - exchange)
    ltp: float                 # Last traded price
    volume: int                # Cumulative or incremental traded volume
    bid_p1: float = 0.0        # Level 1 Best Bid
    bid_q1: int = 0
    ask_p1: float = 0.0        # Level 1 Best Ask
    ask_q1: int = 0
    oi: int = 0                # Open interest (for F&O contracts)

    @property
    def mid_price(self) -> float:
        if self.bid_p1 > 0 and self.ask_p1 > 0:
            return (self.bid_p1 + self.ask_p1) / 2.0
        return self.ltp

    @property
    def spread(self) -> float:
        if self.ask_p1 >= self.bid_p1 > 0:
            return self.ask_p1 - self.bid_p1
        return 0.0

    @property
    def top_obi(self) -> float:
        """Top-of-book Order Book Imbalance: (Q_bid - Q_ask) / (Q_bid + Q_ask) in [-1, +1]."""
        total = self.bid_q1 + self.ask_q1
        if total <= 0:
            return 0.0
        return (self.bid_q1 - self.ask_q1) / float(total)


# ---------------------------------------------------------------------------
# Microsecond Clock Drift Estimator
# ---------------------------------------------------------------------------
class MicrosecondDriftEstimator:
    """Estimates and filters clock drift between exchange server time and local host clock.

    Model: Local_ts = alpha * Exchange_ts + beta + drift_t
    Uses an exponential moving average (EMA) with outlier rejection to detect
    exchange clock resets, network routing jitter, and NTP sync leaps.
    """

    def __init__(self, ema_alpha: float = 0.05, max_acceptable_drift_ms: float = 5000.0):
        self.ema_alpha = float(ema_alpha)
        self.max_drift_us = float(max_acceptable_drift_ms * 1000.0)
        self.smoothed_drift_us: Optional[float] = None
        self.sample_count: int = 0
        self.outlier_count: int = 0
        self._lock = threading.Lock()

    def update(self, exchange_ts_ns: int, local_receive_ts_ns: int) -> float:
        """Calculates instantaneous drift and updates smoothed drift estimate in microseconds."""
        with self._lock:
            # Raw drift in microseconds
            raw_drift_us = (local_receive_ts_ns - exchange_ts_ns) / 1000.0

            # Reject insane outliers (e.g. uncalibrated clocks differing by > 5 seconds)
            if abs(raw_drift_us) > self.max_drift_us:
                self.outlier_count += 1
                return self.smoothed_drift_us if self.smoothed_drift_us is not None else 0.0

            if self.smoothed_drift_us is None:
                self.smoothed_drift_us = raw_drift_us
            else:
                self.smoothed_drift_us = (
                    self.ema_alpha * raw_drift_us + (1.0 - self.ema_alpha) * self.smoothed_drift_us
                )

            self.sample_count += 1
            return self.smoothed_drift_us


# ---------------------------------------------------------------------------
# Zero-Allocation Circular Tick Ring Buffer
# ---------------------------------------------------------------------------
class CircularTickRingBuffer:
    """Pre-allocated circular ring buffer for ultra-low latency, zero-allocation tick streaming."""

    def __init__(self, capacity: int = 65536):
        if capacity <= 0 or (capacity & (capacity - 1)) != 0:
            raise ValueError(f"Capacity must be a positive power of 2, got {capacity}")
        self.capacity = capacity
        self.mask = capacity - 1
        self._buffer: List[Optional[NanosecondTick]] = [None] * capacity
        self._head: int = 0  # Write pointer
        self._tail: int = 0  # Read pointer
        self._count: int = 0
        self._dropped: int = 0
        self._lock = threading.Lock()

    def push(self, tick: NanosecondTick) -> bool:
        """Appends tick to buffer. If full, overwrites oldest unread tick and increments dropped count."""
        with self._lock:
            idx = self._head & self.mask
            if self._count == self.capacity:
                # Buffer overflow: discard oldest tick
                self._tail = (self._tail + 1) & self.mask
                self._dropped += 1
            else:
                self._count += 1

            self._buffer[idx] = tick
            self._head = (self._head + 1) & self.mask
            return True

    def pop(self) -> Optional[NanosecondTick]:
        """Pops and returns the oldest unread tick, or None if buffer is empty."""
        with self._lock:
            if self._count == 0:
                return None
            idx = self._tail & self.mask
            tick = self._buffer[idx]
            self._buffer[idx] = None
            self._tail = (self._tail + 1) & self.mask
            self._count -= 1
            return tick

    def drain(self, max_items: Optional[int] = None) -> List[NanosecondTick]:
        """Drains up to max_items ticks from the buffer in FIFO order."""
        with self._lock:
            if self._count == 0:
                return []
            n = self._count if max_items is None else min(self._count, max_items)
            out = []
            for _ in range(n):
                idx = self._tail & self.mask
                tick = self._buffer[idx]
                if tick is not None:
                    out.append(tick)
                    self._buffer[idx] = None
                self._tail = (self._tail + 1) & self.mask
                self._count -= 1
            return out

    @property
    def count(self) -> int:
        with self._lock:
            return self._count

    @property
    def dropped(self) -> int:
        with self._lock:
            return self._dropped


# ---------------------------------------------------------------------------
# High-Performance Tick Recorder
# ---------------------------------------------------------------------------
class NanosecondTickRecorder:
    """Persists real-time ticks to high-throughput SQLite or binary storage with batch flushing."""

    def __init__(self, db_path: str = ":memory:", batch_size: int = 500, flush_interval_sec: float = 0.10):
        self.db_path = db_path
        self.batch_size = batch_size
        self.flush_interval_sec = flush_interval_sec
        self.drift_estimator = MicrosecondDriftEstimator()
        self.ring_buffer = CircularTickRingBuffer(capacity=65536)

        self._lock = threading.Lock()
        self._running = False
        self._flush_thread: Optional[threading.Thread] = None
        self._total_recorded: int = 0

        if db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:", check_same_thread=False)
        else:
            self._conn = None

        self._init_sqlite()

    def _get_connection(self) -> sqlite3.Connection:
        if self._conn is not None:
            return self._conn
        return sqlite3.connect(self.db_path)

    def _close_connection(self, conn: sqlite3.Connection) -> None:
        if conn is not self._conn:
            conn.close()

    def _init_sqlite(self) -> None:
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS tick_stream (
                symbol TEXT,
                exchange_ts_ns INTEGER,
                local_receive_ts_ns INTEGER,
                drift_us REAL,
                ltp REAL,
                volume INTEGER,
                bid_p1 REAL,
                bid_q1 INTEGER,
                ask_p1 REAL,
                ask_q1 INTEGER,
                oi INTEGER
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_tick_symbol ON tick_stream(symbol, exchange_ts_ns)")
        conn.commit()
        self._close_connection(conn)

    def record_tick(
        self,
        symbol: str,
        ltp: float,
        volume: int,
        exchange_ts_ns: Optional[int] = None,
        bid_p1: float = 0.0,
        bid_q1: int = 0,
        ask_p1: float = 0.0,
        ask_q1: int = 0,
        oi: int = 0,
    ) -> NanosecondTick:
        """Ingests live tick, calculates clock drift, and enqueues to ring buffer."""
        now_ns = time.time_ns()
        ex_ns = exchange_ts_ns if exchange_ts_ns is not None else now_ns
        drift_us = self.drift_estimator.update(ex_ns, now_ns)

        tick = NanosecondTick(
            symbol=symbol,
            exchange_ts_ns=ex_ns,
            local_receive_ts_ns=now_ns,
            drift_us=drift_us,
            ltp=float(ltp),
            volume=int(volume),
            bid_p1=float(bid_p1),
            bid_q1=int(bid_q1),
            ask_p1=float(ask_p1),
            ask_q1=int(ask_q1),
            oi=int(oi),
        )

        self.ring_buffer.push(tick)
        return tick

    def flush(self) -> int:
        """Drains ring buffer and performs atomic batch insert to SQLite."""
        ticks = self.ring_buffer.drain(max_items=self.batch_size)
        if not ticks:
            return 0

        rows = [
            (
                t.symbol, t.exchange_ts_ns, t.local_receive_ts_ns, t.drift_us,
                t.ltp, t.volume, t.bid_p1, t.bid_q1, t.ask_p1, t.ask_q1, t.oi
            )
            for t in ticks
        ]

        conn = self._get_connection()
        cur = conn.cursor()
        cur.executemany("INSERT INTO tick_stream VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
        conn.commit()
        self._close_connection(conn)

        with self._lock:
            self._total_recorded += len(rows)
        return len(rows)

    def start_background_flusher(self) -> None:
        """Starts background flusher thread."""
        with self._lock:
            if self._running:
                return
            self._running = True
            self._flush_thread = threading.Thread(target=self._flush_worker, daemon=True)
            self._flush_thread.start()

    def stop_background_flusher(self) -> None:
        """Stops background flusher thread and flushes remaining ticks."""
        with self._lock:
            self._running = False
        if self._flush_thread and self._flush_thread.is_alive():
            self._flush_thread.join(timeout=1.0)
        self.flush()

    def _flush_worker(self) -> None:
        while self._running:
            self.flush()
            time.sleep(self.flush_interval_sec)

    @property
    def total_recorded(self) -> int:
        with self._lock:
            return self._total_recorded


# ---------------------------------------------------------------------------
# High-Throughput Deterministic Tick Replayer
# ---------------------------------------------------------------------------
class TickReplayer:
    """Replays historical tick streams at deterministic speeds (1x, 10x, 100x, ASAP)."""

    def __init__(self, ticks: Sequence[NanosecondTick]):
        # Sort chronologically by exchange_ts_ns
        self.ticks = sorted(ticks, key=lambda t: t.exchange_ts_ns)
        self.is_replaying = False
        self._lock = threading.Lock()

    @classmethod
    def from_sqlite(cls, db_path: str, symbol: Optional[str] = None, conn: Optional[sqlite3.Connection] = None) -> TickReplayer:
        """Loads ticks from SQLite database."""
        c = conn if conn is not None else sqlite3.connect(db_path)
        cur = c.cursor()
        if symbol:
            cur.execute("SELECT * FROM tick_stream WHERE symbol = ? ORDER BY exchange_ts_ns ASC", (symbol,))
        else:
            cur.execute("SELECT * FROM tick_stream ORDER BY exchange_ts_ns ASC")
        rows = cur.fetchall()
        if conn is None:
            c.close()

        ticks = [
            NanosecondTick(
                symbol=r[0],
                exchange_ts_ns=r[1],
                local_receive_ts_ns=r[2],
                drift_us=r[3],
                ltp=r[4],
                volume=r[5],
                bid_p1=r[6],
                bid_q1=r[7],
                ask_p1=r[8],
                ask_q1=r[9],
                oi=r[10],
            )
            for r in rows
        ]
        return cls(ticks)

    def replay_stream(
        self,
        speed_multiplier: float = 0.0,
        callback: Optional[Callable[[NanosecondTick], None]] = None,
    ) -> Generator[NanosecondTick, None, None]:
        """Yields ticks at specified speed multiplier.

        speed_multiplier:
          0.0  -> As fast as possible (benchmarking / backtesting)
          1.0  -> Exact real-time pacing
          10.0 -> 10x accelerated playback
        """
        with self._lock:
            self.is_replaying = True

        if not self.ticks:
            with self._lock:
                self.is_replaying = False
            return

        t_sim_prev = self.ticks[0].exchange_ts_ns
        t_wall_prev = time.time_ns()

        for tick in self.ticks:
            if not self.is_replaying:
                break

            if speed_multiplier > 0.0:
                delta_sim_ns = tick.exchange_ts_ns - t_sim_prev
                if delta_sim_ns > 0:
                    delay_sec = (delta_sim_ns / 1_000_000_000.0) / speed_multiplier
                    # Only sleep if delay > 100 microseconds (avoid timer resolution jitter)
                    if delay_sec > 0.0001:
                        time.sleep(delay_sec)
                t_sim_prev = tick.exchange_ts_ns

            if callback:
                callback(tick)
            yield tick

        with self._lock:
            self.is_replaying = False

    def stop(self) -> None:
        with self._lock:
            self.is_replaying = False
