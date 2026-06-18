"""
lob_microstructure_alpha_engine.py - Sub-Millisecond Level-2/Level-3 Market Depth
==============================================================================
Microstructure alpha engine for the WealthOS F&O / cash execution stack.

Capabilities
------------
1. High-throughput circular ring buffer (O(1) push, zero reallocation) for
   5-depth / 20-depth WebSocket order-book snapshots from Upstox / OpenAlgo.
2. Order Book Imbalance (OBI) - unweighted and depth-weighted variants.
3. Micro-price  P_hat = (V_b * P_a + V_a * P_b) / (V_b + V_a).
4. Volume-Synchronized Probability of Toxicity (VPIN) with volume buckets.
5. Stealth Iceberg & Spoofing Detector - quote flashing, phantom queue
   additions, institutional absorption.
6. Execution Alpha Sentry - long/short veto rules + adaptive dynamic slippage
   predictor over the Top-3 levels.

Mathematical derivations are documented in the companion report:
  Extras/AGENT SWARM/OPENCODE/SPACE_BUNNY_1M/reports/DOMAIN_86_SUB_MILLISECOND_WEBSOCKET_ORDER_BOOK_DEPTH_AND_MICROSTRUCTURE_ALPHA.md

Design notes
------------
* Pure Python + NumPy so it runs without a compiler; the hot paths are written
  with contiguous pre-allocated arrays and integer indexing so they can be
  lifted to Cython (cdef class) without changing the public API.
* No new third-party dependencies beyond numpy (already in requirements.txt).
* Thread-safe push via an optional lock; readers take a consistent snapshot.
"""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, List, Optional, Sequence, Tuple

import numpy as np

# ---------------------------------------------------------------------------
# Constants / defaults
# ---------------------------------------------------------------------------
DEFAULT_RING_CAPACITY: int = 4096
DEFAULT_DEPTH: int = 20
MIN_DEPTH: int = 5
EPS: float = 1e-12

# VPIN defaults
DEFAULT_VPIN_BUCKET_VOLUME: float = 1_000.0   # volume units per bucket
DEFAULT_VPIN_N_BUCKETS: int = 50              # rolling window of buckets

# Iceberg / spoofing thresholds
FLASH_LIFETIME_MS: int = 250                  # quote lifetime below this = flash
PHANTOM_ADD_RATIO: float = 3.0                # add/cancel ratio triggering phantom
ABSORPTION_REFILL_RATIO: float = 0.60         # level refills to >= 60% after trade
SPOOF_SCORE_VETO: float = 0.65                # composite score above this vetoes


# ---------------------------------------------------------------------------
# Data containers
# ---------------------------------------------------------------------------
@dataclass
class DepthLevel:
    price: float
    qty: float

    def as_tuple(self) -> Tuple[float, float]:
        return (float(self.price), float(self.qty))


@dataclass
class OrderBookSnapshot:
    """A single L2/L3 depth frame."""
    symbol: str
    ts_ms: int                      # epoch millis
    bids_px: np.ndarray             # shape (D,) ascending? we store best-first (descending price)
    bids_qty: np.ndarray            # shape (D,)
    asks_px: np.ndarray             # shape (D,) best-first (ascending price)
    asks_qty: np.ndarray            # shape (D,)
    depth: int = DEFAULT_DEPTH

    def mid(self) -> float:
        if self.bids_px.size == 0 or self.asks_px.size == 0:
            return 0.0
        bp = float(self.bids_px[0]); ap = float(self.asks_px[0])
        if bp <= 0 or ap <= 0:
            return 0.0
        return 0.5 * (bp + ap)

    def spread(self) -> float:
        if self.bids_px.size == 0 or self.asks_px.size == 0:
            return 0.0
        return float(self.asks_px[0] - self.bids_px[0])

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "ts_ms": self.ts_ms,
            "bids": [[float(p), float(q)] for p, q in zip(self.bids_px.tolist(), self.bids_qty.tolist())],
            "asks": [[float(p), float(q)] for p, q in zip(self.asks_px.tolist(), self.asks_qty.tolist())],
        }


@dataclass
class MicrostructureFeatures:
    symbol: str
    ts_ms: int
    obi_unweighted: float
    obi_weighted: float
    micro_price: float
    mid: float
    spread: float
    spread_bps: float
    bid_depth_top3: float
    ask_depth_top3: float
    bid_depth_total: float
    ask_depth_total: float
    vpin: float
    spoof_score: float
    iceberg_score: float
    absorption_score: float
    flash_count: int
    phantom_count: int


@dataclass
class SentryVerdict:
    allow_long: bool
    allow_short: bool
    veto_long_reason: Optional[str] = None
    veto_short_reason: Optional[str] = None
    predicted_slippage_bps: float = 0.0
    confidence: float = 0.0


# ---------------------------------------------------------------------------
# Circular ring buffer
# ---------------------------------------------------------------------------
class LOBRingBuffer:
    """
    Fixed-capacity circular ring buffer for order-book snapshots.

    Storage is pre-allocated once (capacity x depth) for each of price/qty arrays
    on both sides plus a timestamp vector. Pushes are O(1) and never allocate.
    """

    def __init__(self, capacity: int = DEFAULT_RING_CAPACITY, depth: int = DEFAULT_DEPTH,
                 thread_safe: bool = True):
        if capacity < 1:
            raise ValueError("capacity must be >= 1")
        if depth < MIN_DEPTH:
            raise ValueError(f"depth must be >= {MIN_DEPTH}")
        self.capacity = int(capacity)
        self.depth = int(depth)
        self._prices_bid = np.zeros((self.capacity, self.depth), dtype=np.float64)
        self._qtys_bid = np.zeros((self.capacity, self.depth), dtype=np.float64)
        self._prices_ask = np.zeros((self.capacity, self.depth), dtype=np.float64)
        self._qtys_ask = np.zeros((self.capacity, self.depth), dtype=np.float64)
        self._ts = np.zeros(self.capacity, dtype=np.int64)
        self._head = 0          # next write slot
        self._size = 0          # number of valid entries (<= capacity)
        self._lock = threading.Lock() if thread_safe else None
        # Per-slot validity mask for partial frames
        self._valid = np.zeros(self.capacity, dtype=np.bool_)

    # -- core API -----------------------------------------------------------
    def push(self, snapshot: OrderBookSnapshot) -> int:
        """Push one snapshot. Returns the slot index written."""
        if self._lock is not None:
            with self._lock:
                return self._push_unlocked(snapshot)
        return self._push_unlocked(snapshot)

    def _push_unlocked(self, snapshot: OrderBookSnapshot) -> int:
        slot = self._head
        d = min(self.depth, snapshot.bids_px.shape[0], snapshot.asks_px.shape[0])
        self._prices_bid[slot, :d] = snapshot.bids_px[:d]
        self._qtys_bid[slot, :d] = snapshot.bids_qty[:d]
        self._prices_ask[slot, :d] = snapshot.asks_px[:d]
        self._qtys_ask[slot, :d] = snapshot.asks_qty[:d]
        if d < self.depth:
            self._prices_bid[slot, d:] = 0.0
            self._qtys_bid[slot, d:] = 0.0
            self._prices_ask[slot, d:] = 0.0
            self._qtys_ask[slot, d:] = 0.0
        self._ts[slot] = int(snapshot.ts_ms)
        self._valid[slot] = True
        self._head = (self._head + 1) % self.capacity
        if self._size < self.capacity:
            self._size += 1
        return slot

    def push_raw(self, ts_ms: int, bids_px: Sequence[float], bids_qty: Sequence[float],
                 asks_px: Sequence[float], asks_qty: Sequence[float], symbol: str = "") -> int:
        """Convenience push from raw sequences."""
        snap = OrderBookSnapshot(
            symbol=symbol,
            ts_ms=int(ts_ms),
            bids_px=np.asarray(bids_px, dtype=np.float64),
            bids_qty=np.asarray(bids_qty, dtype=np.float64),
            asks_px=np.asarray(asks_px, dtype=np.float64),
            asks_qty=np.asarray(asks_qty, dtype=np.float64),
            depth=self.depth,
        )
        return self.push(snap)

    def push_many(self, snapshots: Sequence[OrderBookSnapshot]) -> int:
        n = 0
        for s in snapshots:
            self.push(s)
            n += 1
        return n

    # -- readers ------------------------------------------------------------
    @property
    def size(self) -> int:
        return self._size

    def is_empty(self) -> bool:
        return self._size == 0

    def latest(self, n: int = 1) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Return last n snapshots as (ts, bids_px, bids_qty, asks_px, asks_qty).

        Arrays shapes: ts (n,), bids_px (n, D), bids_qty (n, D), asks_px (n, D), asks_qty (n, D).
        Oldest-first ordering.
        """
        n = max(1, min(n, self._size))
        if self._size == 0:
            empty = np.zeros((0, self.depth), dtype=np.float64)
            return (np.zeros(0, dtype=np.int64), empty.copy(), empty.copy(), empty.copy(), empty.copy())
        # compute slot range
        end = self._head  # exclusive
        start = (end - n) % self.capacity
        idx = np.arange(start, start + n) % self.capacity
        ts = self._ts[idx].copy()
        bp = self._prices_bid[idx].copy()
        bq = self._qtys_bid[idx].copy()
        ap = self._prices_ask[idx].copy()
        aq = self._qtys_ask[idx].copy()
        return ts, bp, bq, ap, aq

    def latest_snapshot(self) -> Optional[OrderBookSnapshot]:
        if self._size == 0:
            return None
        slot = (self._head - 1) % self.capacity
        return OrderBookSnapshot(
            symbol="",
            ts_ms=int(self._ts[slot]),
            bids_px=self._prices_bid[slot].copy(),
            bids_qty=self._qtys_bid[slot].copy(),
            asks_px=self._prices_ask[slot].copy(),
            asks_qty=self._qtys_ask[slot].copy(),
            depth=self.depth,
        )

    def clear(self) -> None:
        if self._lock is not None:
            with self._lock:
                self._clear_unlocked()
        else:
            self._clear_unlocked()

    def _clear_unlocked(self) -> None:
        self._prices_bid.fill(0.0)
        self._qtys_bid.fill(0.0)
        self._prices_ask.fill(0.0)
        self._qtys_ask.fill(0.0)
        self._ts.fill(0)
        self._valid.fill(False)
        self._head = 0
        self._size = 0


# ---------------------------------------------------------------------------
# Core microstructure math
# ---------------------------------------------------------------------------
def compute_obi(bids_qty: np.ndarray, asks_qty: np.ndarray,
                levels: Optional[int] = None, weighted: bool = False,
                decay: float = 0.5) -> float:
    """
    Order Book Imbalance.

    Unweighted:
        OBI = (sum_{i=1}^{L} V_b^i - sum_{i=1}^{L} V_a^i)
              / (sum_{i=1}^{L} V_b^i + sum_{i=1}^{L} V_a^i)

    Weighted (depth decay):
        w_i = exp(-decay * (i-1))  (or 1/i); OBI_w = (sum w_i(V_b^i - V_a^i))
              / (sum w_i(V_b^i + V_a^i))

    Range: [-1, +1]. Positive => bid pressure (bullish microstructure).
    """
    bq = np.asarray(bids_qty, dtype=np.float64).ravel()
    aq = np.asarray(asks_qty, dtype=np.float64).ravel()
    L = bq.shape[0] if levels is None else min(levels, bq.shape[0], aq.shape[0])
    if L <= 0:
        return 0.0
    bq = bq[:L]; aq = aq[:L]
    if weighted:
        w = np.exp(-decay * np.arange(L, dtype=np.float64))
    else:
        w = np.ones(L, dtype=np.float64)
    num = float(np.sum(w * (bq - aq)))
    den = float(np.sum(w * (bq + aq)))
    if den <= EPS:
        return 0.0
    return num / den


def compute_microprice(best_bid: float, best_ask: float,
                       bid_vol_top: float, ask_vol_top: float) -> float:
    """
    Micro-price (Stoikov / Cartea):
        P_hat = (V_b * P_a + V_a * P_b) / (V_b + V_a)

    where V_b = volume at best bid, P_a = best ask price,
          V_a = volume at best ask, P_b = best bid price.
    Tilts the mid toward the thinner side (higher probability of that side
    being hit).
    """
    Vb = float(bid_vol_top); Va = float(ask_vol_top)
    Pb = float(best_bid); Pa = float(best_ask)
    den = Vb + Va
    if den <= EPS:
        return 0.5 * (Pb + Pa) if (Pb > 0 and Pa > 0) else 0.0
    return (Vb * Pa + Va * Pb) / den


def compute_queue_imbalance_topN(bids_qty: np.ndarray, asks_qty: np.ndarray,
                                 n: int = 3) -> float:
    """Top-N queue imbalance QI_N = (sum_{i=1}^N V_b^i - sum_{i=1}^N V_a^i)
       / (sum_{i=1}^N V_b^i + sum_{i=1}^N V_a^i)."""
    return compute_obi(bids_qty, asks_qty, levels=n, weighted=False)


# ---------------------------------------------------------------------------
# VPIN (Volume Synchronized Probability of Toxicity)
# ---------------------------------------------------------------------------
class VPINCalculator:
    """
    Volume-synchronized bucketing.

    Trades are accumulated into buckets of fixed volume V. When a bucket fills,
    its buy-volume fraction (and sell fraction) is recorded. VPIN over the last
    n buckets:

        VPIN = (1/n) * sum_{k=1}^{n} |V_buy^k - V_sell^k| / V_bucket
             = (1/n) * sum |2 * V_buy^k / V - 1|

    Toxicity threshold typically 0.3-0.5 for equities; higher => more informed
    flow.
    """

    def __init__(self, bucket_volume: float = DEFAULT_VPIN_BUCKET_VOLUME,
                 n_buckets: int = DEFAULT_VPIN_N_BUCKETS):
        if bucket_volume <= 0:
            raise ValueError("bucket_volume must be > 0")
        if n_buckets < 1:
            raise ValueError("n_buckets must be >= 1")
        self.bucket_volume = float(bucket_volume)
        self.n_buckets = int(n_buckets)
        self._buckets: Deque[float] = deque(maxlen=n_buckets)  # stores |buy-sell|/V
        self._cur_buy = 0.0
        self._cur_sell = 0.0
        self._cur_vol = 0.0
        self._total_buckets = 0

    def reset(self) -> None:
        self._buckets.clear()
        self._cur_buy = 0.0
        self._cur_sell = 0.0
        self._cur_vol = 0.0
        self._total_buckets = 0

    def add_trade(self, price: float, qty: float, side: str) -> Optional[float]:
        """Add a trade. side in {'BUY','SELL','B','S'}. Returns VPIN if a bucket
        just completed (else None)."""
        q = float(qty)
        if q <= 0:
            return None
        is_buy = side.upper() in ("BUY", "B", "LONG")
        remaining = q
        completed_vpin: Optional[float] = None
        while remaining > EPS:
            space = self.bucket_volume - self._cur_vol
            take = min(remaining, space)
            if is_buy:
                self._cur_buy += take
            else:
                self._cur_sell += take
            self._cur_vol += take
            remaining -= take
            if self._cur_vol >= self.bucket_volume - EPS:
                imb = abs(self._cur_buy - self._cur_sell) / self.bucket_volume
                self._buckets.append(imb)
                self._total_buckets += 1
                self._cur_buy = 0.0
                self._cur_sell = 0.0
                self._cur_vol = 0.0
                completed_vpin = self.vpin()
        return completed_vpin

    def vpin(self) -> float:
        if not self._buckets:
            # partial bucket contribution
            if self._cur_vol <= EPS:
                return 0.0
            partial = abs(self._cur_buy - self._cur_sell) / self.bucket_volume
            # weight partial bucket by its fill fraction
            w = self._cur_vol / self.bucket_volume
            vals = list(self._buckets) + [partial * w]
            return float(np.mean(vals)) if vals else 0.0
        return float(np.mean(self._buckets))

    def n_completed(self) -> int:
        return self._total_buckets


def compute_vpin_from_trades(trades: Sequence[Tuple[float, float, str]],
                            bucket_volume: float = DEFAULT_VPIN_BUCKET_VOLUME,
                            n_buckets: int = DEFAULT_VPIN_N_BUCKETS) -> float:
    """Convenience: trades = list of (price, qty, side)."""
    calc = VPINCalculator(bucket_volume=bucket_volume, n_buckets=n_buckets)
    for p, q, side in trades:
        calc.add_trade(p, q, side)
    return calc.vpin()


# ---------------------------------------------------------------------------
# Iceberg / Spoofing detector
# ---------------------------------------------------------------------------
@dataclass
class QuoteEvent:
    price: float
    qty: float
    side: str           # 'BID' / 'ASK'
    ts_ms: int
    action: str         # 'ADD' / 'CANCEL' / 'TRADE' / 'MODIFY'


class IcebergSpoofDetector:
    """
    Detects:
      * Quote flashing  - large size added then cancelled within FLASH_LIFETIME_MS.
      * Phantom queues  - repeated add/cancel at a price without execution.
      * Institutional absorption - level refills after being hit (iceberg).

    Maintains a per-price level state machine over a rolling window.
    """

    def __init__(self, flash_lifetime_ms: int = FLASH_LIFETIME_MS,
                 phantom_add_ratio: float = PHANTOM_ADD_RATIO,
                 absorption_refill_ratio: float = ABSORPTION_REFILL_RATIO):
        self.flash_lifetime_ms = int(flash_lifetime_ms)
        self.phantom_add_ratio = float(phantom_add_ratio)
        self.absorption_refill_ratio = float(absorption_refill_ratio)
        # level state: key (side, price) -> dict(qty, first_ts, adds, cancels, trades, last_qty)
        self._levels: Dict[Tuple[str, float], Dict[str, Any]] = {}
        self._flashes: int = 0
        self._phantoms: int = 0
        self._absorptions: int = 0
        self._events: Deque[QuoteEvent] = deque(maxlen=10000)

    def reset(self) -> None:
        self._levels.clear()
        self._flashes = 0
        self._phantoms = 0
        self._absorptions = 0
        self._events.clear()

    def on_event(self, ev: QuoteEvent) -> None:
        self._events.append(ev)
        key = (ev.side.upper(), round(float(ev.price), 6))
        st = self._levels.setdefault(key, {
            "qty": 0.0, "first_ts": ev.ts_ms, "last_ts": ev.ts_ms,
            "adds": 0, "cancels": 0, "trades": 0, "max_qty": 0.0,
            "refill_count": 0, "last_qty": 0.0,
        })
        st["last_ts"] = ev.ts_ms
        if ev.action == "ADD":
            st["adds"] += 1
            st["qty"] += ev.qty
            st["max_qty"] = max(st["max_qty"], st["qty"])
            st["first_ts"] = st.get("first_ts", ev.ts_ms)
        elif ev.action == "CANCEL":
            # flash detection: cancelled quickly after add
            lifetime = ev.ts_ms - st.get("first_ts", ev.ts_ms)
            if lifetime <= self.flash_lifetime_ms and st.get("max_qty", 0.0) > 0:
                self._flashes += 1
            st["cancels"] += 1
            st["qty"] = max(0.0, st["qty"] - ev.qty)
        elif ev.action == "TRADE":
            st["trades"] += 1
            traded_qty = ev.qty
            pre = st["qty"]
            st["qty"] = max(0.0, st["qty"] - traded_qty)
            # absorption: if level refills back to >= ratio of pre-trade within window
            if pre > 0 and traded_qty > 0:
                st["_pending_refill"] = pre
        elif ev.action == "MODIFY":
            # refill detection
            if st.get("_pending_refill", 0.0) > 0:
                if st["qty"] >= st["_pending_refill"] * self.absorption_refill_ratio:
                    self._absorptions += 1
                    st["_pending_refill"] = 0.0
            st["qty"] = ev.qty

    def ingest_book_delta(self, prev: Optional[OrderBookSnapshot],
                         curr: OrderBookSnapshot) -> None:
        """Derive add/cancel/modify events by diffing two consecutive books."""
        if prev is None:
            # initial: treat all levels as ADD
            for px, q in zip(curr.bids_px, curr.bids_qty):
                if q > 0:
                    self.on_event(QuoteEvent(float(px), float(q), "BID", curr.ts_ms, "ADD"))
            for px, q in zip(curr.asks_px, curr.asks_qty):
                if q > 0:
                    self.on_event(QuoteEvent(float(px), float(q), "ASK", curr.ts_ms, "ADD"))
            return
        # diff bids
        prev_map_b = {round(float(p), 6): float(q) for p, q in zip(prev.bids_px, prev.bids_qty) if q > 0}
        curr_map_b = {round(float(p), 6): float(q) for p, q in zip(curr.bids_px, curr.bids_qty) if q > 0}
        for p, q in curr_map_b.items():
            old = prev_map_b.get(p, 0.0)
            if old <= 0:
                self.on_event(QuoteEvent(p, q, "BID", curr.ts_ms, "ADD"))
            elif abs(q - old) > EPS:
                self.on_event(QuoteEvent(p, q - old if q > old else old - q, "BID", curr.ts_ms,
                                        "ADD" if q > old else "CANCEL"))
        for p, q in prev_map_b.items():
            if p not in curr_map_b:
                self.on_event(QuoteEvent(p, q, "BID", curr.ts_ms, "CANCEL"))
        # asks
        prev_map_a = {round(float(p), 6): float(q) for p, q in zip(prev.asks_px, prev.asks_qty) if q > 0}
        curr_map_a = {round(float(p), 6): float(q) for p, q in zip(curr.asks_px, curr.asks_qty) if q > 0}
        for p, q in curr_map_a.items():
            old = prev_map_a.get(p, 0.0)
            if old <= 0:
                self.on_event(QuoteEvent(p, q, "ASK", curr.ts_ms, "ADD"))
            elif abs(q - old) > EPS:
                self.on_event(QuoteEvent(p, q - old if q > old else old - q, "ASK", curr.ts_ms,
                                        "ADD" if q > old else "CANCEL"))
        for p, q in prev_map_a.items():
            if p not in curr_map_a:
                self.on_event(QuoteEvent(p, q, "ASK", curr.ts_ms, "CANCEL"))

    def phantom_score(self) -> float:
        """Composite phantom-queue score in [0,1]."""
        if not self._levels:
            return 0.0
        total_adds = sum(s["adds"] for s in self._levels.values())
        total_cancels = sum(s["cancels"] for s in self._levels.values())
        if total_adds <= 0:
            return 0.0
        ratio = total_cancels / max(1, total_adds)
        # normalize: ratio >= phantom_add_ratio => 1.0
        return float(min(1.0, ratio / self.phantom_add_ratio))

    def flash_rate(self) -> float:
        if not self._events:
            return 0.0
        span_ms = max(1, self._events[-1].ts_ms - self._events[0].ts_ms)
        return self._flashes / (span_ms / 1000.0) if span_ms > 0 else 0.0

    def spoof_score(self) -> float:
        """Composite spoofing score in [0,1]."""
        ph = self.phantom_score()
        # flash intensity: flashes per level
        n_levels = max(1, len(self._levels))
        flash_intensity = min(1.0, (self._flashes / n_levels) / 5.0)
        # absorption (iceberg) raises score too if combined with flashing
        abs_intensity = min(1.0, self._absorptions / max(1, n_levels))
        return float(min(1.0, 0.5 * ph + 0.3 * flash_intensity + 0.2 * abs_intensity))

    def iceberg_score(self) -> float:
        if not self._levels:
            return 0.0
        n = len(self._levels)
        return float(min(1.0, self._absorptions / max(1, n)))

    def absorption_score(self) -> float:
        return self.iceberg_score()

    def counts(self) -> Tuple[int, int, int]:
        return self._flashes, self._phantoms, self._absorptions

    @property
    def flashes(self) -> int:
        return self._flashes

    @property
    def phantoms(self) -> int:
        return self._phantoms

    @property
    def absorptions(self) -> int:
        return self._absorptions


# ---------------------------------------------------------------------------
# Execution Alpha Sentry
# ---------------------------------------------------------------------------
def sentry_veto(side: str, obi: float, bid_depth_top3: float, ask_depth_top3: float,
                prev_ask_depth_top3: Optional[float] = None,
                prev_bid_depth_top3: Optional[float] = None,
                spoof_score: float = 0.0,
                vpin: float = 0.0,
                obi_threshold: float = 0.0,
                collapse_ratio: float = 0.5,
                absorption_ratio: float = 1.5) -> SentryVerdict:
    """
    Veto rules:
      * Veto LONG when OBI < obi_threshold (default 0) OR ask depth is
        collapsing (current ask depth < collapse_ratio * previous) OR spoof_score high.
      * Veto SHORT when bid depth is heavily absorbing (current bid depth >
        absorption_ratio * previous, i.e. refilling) OR OBI strongly positive.
      * Toxicity (VPIN) above 0.5 vetoes both sides.
    """
    side = side.upper()
    allow_long = True
    allow_short = True
    long_reason = None
    short_reason = None

    # toxicity gate
    if vpin is not None and vpin > 0.5:
        allow_long = False
        allow_short = False
        long_reason = f"VPIN toxicity {vpin:.3f} > 0.5"
        short_reason = long_reason

    # spoof gate
    if spoof_score is not None and spoof_score >= SPOOF_SCORE_VETO:
        # spoofing on ask side hurts longs; on bid side hurts shorts - here composite
        allow_long = False
        allow_short = False
        r = f"spoof_score {spoof_score:.3f} >= {SPOOF_SCORE_VETO}"
        long_reason = long_reason or r
        short_reason = short_reason or r

    # long veto
    if side in ("LONG", "BUY", "CALL"):
        if obi < obi_threshold:
            allow_long = False
            if obi >= 0:
                long_reason = long_reason or f"OBI {obi:.3f} < {obi_threshold}"
        if prev_ask_depth_top3 is not None and prev_ask_depth_top3 > EPS:
            if ask_depth_top3 < collapse_ratio * prev_ask_depth_top3:
                allow_long = False
                long_reason = long_reason or (
                    f"ask depth collapsing {ask_depth_top3:.0f} < {collapse_ratio}x {prev_ask_depth_top3:.0f}")
    # short veto
    if side in ("SHORT", "SELL", "PUT"):
        if prev_bid_depth_top3 is not None and prev_bid_depth_top3 > EPS:
            if bid_depth_top3 > absorption_ratio * prev_bid_depth_top3:
                allow_short = False
                short_reason = short_reason or (
                    f"bid depth absorbing {bid_depth_top3:.0f} > {absorption_ratio}x {prev_bid_depth_top3:.0f}")
        if obi > abs(obi_threshold) + 0.25:
            allow_short = False
            short_reason = short_reason or f"OBI {obi:.3f} strongly positive"

    # General OBI-based vetoes regardless of side request
    if obi < 0:
        # negative OBI vetoes longs
        allow_long = False
        long_reason = long_reason or f"OBI negative ({obi:.3f})"
    if obi > 0.3:
        allow_short = False
        short_reason = short_reason or f"OBI strongly positive ({obi:.3f})"

    return SentryVerdict(
        allow_long=allow_long,
        allow_short=allow_short,
        veto_long_reason=long_reason if not allow_long else None,
        veto_short_reason=short_reason if not allow_short else None,
        confidence=float(min(1.0, abs(obi) + (1.0 - min(1.0, spoof_score)) * 0.5)),
    )


def predict_slippage(side: str, qty: float, top3_prices: Sequence[float],
                     top3_qtys: Sequence[float], mid: float) -> float:
    """
    Adaptive dynamic slippage predictor walking the Top-3 levels.

    For a BUY: consume ask levels until qty filled; slippage_bps =
        (avg_fill_price - mid) / mid * 10000.
    For a SELL: consume bid levels; slippage_bps = (mid - avg_fill_price)/mid*10000.
    If insufficient depth, extrapolate last level with a penalty.
    """
    side = side.upper()
    prices = np.asarray(top3_prices, dtype=np.float64).ravel()
    qtys = np.asarray(top3_qtys, dtype=np.float64).ravel()
    if prices.size == 0 or mid <= EPS:
        return 0.0
    remaining = float(qty)
    cost = 0.0
    filled = 0.0
    n = prices.size
    for i in range(n):
        if remaining <= EPS:
            break
        take = min(remaining, float(qtys[i]))
        cost += take * float(prices[i])
        filled += take
        remaining -= take
    # extrapolate if not fully filled
    if remaining > EPS and n > 0:
        last_px = float(prices[-1])
        # penalty: 1 tick-ish = 0.05% beyond last level
        penalty = last_px * (0.0005 * (remaining / max(1.0, float(qtys[-1]))))
        extra_px = last_px + (penalty if side in ("BUY", "LONG") else -penalty)
        cost += remaining * extra_px
        filled += remaining
        remaining = 0.0
    if filled <= EPS:
        return 0.0
    avg_fill = cost / filled
    if side in ("BUY", "LONG"):
        slip = (avg_fill - mid) / mid * 10000.0
    else:
        slip = (mid - avg_fill) / mid * 10000.0
    return float(max(0.0, slip))


# ---------------------------------------------------------------------------
# Feature computation over a snapshot (+ history)
# ---------------------------------------------------------------------------
def compute_features(snapshot: OrderBookSnapshot,
                     prev_snapshot: Optional[OrderBookSnapshot] = None,
                     detector: Optional[IcebergSpoofDetector] = None,
                     vpin_calc: Optional[VPINCalculator] = None) -> MicrostructureFeatures:
    bq = snapshot.bids_qty; aq = snapshot.asks_qty
    bp = snapshot.bids_px; ap = snapshot.asks_px
    obi_u = compute_obi(bq, aq, weighted=False)
    obi_w = compute_obi(bq, aq, weighted=True)
    bb = float(bp[0]) if bp.size else 0.0
    ba = float(ap[0]) if ap.size else 0.0
    bv = float(bq[0]) if bq.size else 0.0
    av = float(aq[0]) if aq.size else 0.0
    mp = compute_microprice(bb, ba, bv, av)
    mid = snapshot.mid()
    spr = snapshot.spread()
    spr_bps = (spr / mid * 10000.0) if mid > EPS else 0.0
    bd3 = float(np.sum(bq[:3])) if bq.size >= 3 else float(np.sum(bq))
    ad3 = float(np.sum(aq[:3])) if aq.size >= 3 else float(np.sum(aq))
    bdt = float(np.sum(bq)); adt = float(np.sum(aq))

    if detector is not None and prev_snapshot is not None:
        detector.ingest_book_delta(prev_snapshot, snapshot)
    spoof = detector.spoof_score() if detector is not None else 0.0
    iceberg = detector.iceberg_score() if detector is not None else 0.0
    absorption = detector.absorption_score() if detector is not None else 0.0
    flashes, phantoms, _ = detector.counts() if detector is not None else (0, 0, 0)

    vpin_val = vpin_calc.vpin() if vpin_calc is not None else 0.0

    return MicrostructureFeatures(
        symbol=snapshot.symbol,
        ts_ms=snapshot.ts_ms,
        obi_unweighted=obi_u,
        obi_weighted=obi_w,
        micro_price=mp,
        mid=mid,
        spread=spr,
        spread_bps=spr_bps,
        bid_depth_top3=bd3,
        ask_depth_top3=ad3,
        bid_depth_total=bdt,
        ask_depth_total=adt,
        vpin=vpin_val,
        spoof_score=spoof,
        iceberg_score=iceberg,
        absorption_score=absorption,
        flash_count=flashes,
        phantom_count=phantoms,
    )


# ---------------------------------------------------------------------------
# Ingestion helpers for Upstox / OpenAlgo depth payloads
# ---------------------------------------------------------------------------
def parse_upstox_depth(payload: Dict[str, Any], depth: int = DEFAULT_DEPTH) -> Optional[OrderBookSnapshot]:
    """Parse an Upstox market-data depth payload (5/20 depth).

    Expected keys (flexible): symbol/instrument_key, timestamp, depth/buy/sell or
    bids/asks. Handles both field naming conventions.
    """
    if not isinstance(payload, dict):
        return None
    symbol = payload.get("symbol") or payload.get("instrument_key") or payload.get("instrumentKey") or ""
    ts = payload.get("timestamp") or payload.get("ts") or payload.get("ts_ms") or int(time.time() * 1000)
    try:
        ts_ms = int(ts)
    except (TypeError, ValueError):
        ts_ms = int(time.time() * 1000)
    # bids
    bids_src = payload.get("bids") or payload.get("buy") or payload.get("bid") or payload.get("buy_quantity") or []
    asks_src = payload.get("asks") or payload.get("sell") or payload.get("ask") or payload.get("sell_quantity") or []
    # Upstox sometimes nests under 'depth'
    if not bids_src and isinstance(payload.get("depth"), dict):
        d = payload["depth"]
        bids_src = d.get("buy") or d.get("bids") or []
        asks_src = d.get("sell") or d.get("asks") or []
    bids_px, bids_qty = [], []
    for lvl in bids_src[:depth]:
        if isinstance(lvl, (list, tuple)):
            p, q = lvl[0], lvl[1] if len(lvl) > 1 else 0
        elif isinstance(lvl, dict):
            p = lvl.get("price") or lvl.get("bp") or lvl.get("bid_price") or 0
            q = lvl.get("quantity") or lvl.get("bq") or lvl.get("bid_qty") or lvl.get("qty") or 0
        else:
            continue
        bids_px.append(float(p)); bids_qty.append(float(q))
    asks_px, asks_qty = [], []
    for lvl in asks_src[:depth]:
        if isinstance(lvl, (list, tuple)):
            p, q = lvl[0], lvl[1] if len(lvl) > 1 else 0
        elif isinstance(lvl, dict):
            p = lvl.get("price") or lvl.get("ap") or lvl.get("ask_price") or 0
            q = lvl.get("quantity") or lvl.get("aq") or lvl.get("ask_qty") or lvl.get("qty") or 0
        else:
            continue
        asks_px.append(float(p)); asks_qty.append(float(q))
    # sort: bids descending, asks ascending (real levels only)
    order_b = sorted(range(len(bids_px)), key=lambda i: bids_px[i], reverse=True)
    bids_px = [bids_px[i] for i in order_b]
    bids_qty = [bids_qty[i] for i in order_b]
    order_a = sorted(range(len(asks_px)), key=lambda i: asks_px[i])
    asks_px = [asks_px[i] for i in order_a]
    asks_qty = [asks_qty[i] for i in order_a]
    # pad
    while len(bids_px) < depth:
        bids_px.append(0.0); bids_qty.append(0.0)
    while len(asks_px) < depth:
        asks_px.append(0.0); asks_qty.append(0.0)
    return OrderBookSnapshot(
        symbol=str(symbol),
        ts_ms=int(ts_ms),
        bids_px=np.asarray(bids_px[:depth], dtype=np.float64),
        bids_qty=np.asarray(bids_qty[:depth], dtype=np.float64),
        asks_px=np.asarray(asks_px[:depth], dtype=np.float64),
        asks_qty=np.asarray(asks_qty[:depth], dtype=np.float64),
        depth=depth,
    )


def parse_openalgo_depth(payload: Dict[str, Any], depth: int = DEFAULT_DEPTH) -> Optional[OrderBookSnapshot]:
    """Parse an OpenAlgo depth payload. OpenAlgo returns lists of {price, quantity}."""
    if not isinstance(payload, dict):
        return None
    # OpenAlgo often wraps under 'data'
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    symbol = data.get("symbol") or data.get("instrument") or payload.get("symbol") or ""
    ts = data.get("timestamp") or data.get("ts") or int(time.time() * 1000)
    try:
        ts_ms = int(ts)
    except (TypeError, ValueError):
        ts_ms = int(time.time() * 1000)
    bids_src = data.get("bids") or data.get("buy") or data.get("depth", {}).get("buy") or []
    asks_src = data.get("asks") or data.get("sell") or data.get("depth", {}).get("sell") or []
    bids_px, bids_qty = [], []
    for lvl in bids_src[:depth]:
        if isinstance(lvl, dict):
            p = lvl.get("price", lvl.get("bp", 0)); q = lvl.get("quantity", lvl.get("bq", 0))
        elif isinstance(lvl, (list, tuple)):
            p, q = lvl[0], lvl[1]
        else:
            continue
        bids_px.append(float(p)); bids_qty.append(float(q))
    asks_px, asks_qty = [], []
    for lvl in asks_src[:depth]:
        if isinstance(lvl, dict):
            p = lvl.get("price", lvl.get("ap", 0)); q = lvl.get("quantity", lvl.get("aq", 0))
        elif isinstance(lvl, (list, tuple)):
            p, q = lvl[0], lvl[1]
        else:
            continue
        asks_px.append(float(p)); asks_qty.append(float(q))
    order_b = sorted(range(len(bids_px)), key=lambda i: bids_px[i], reverse=True)
    bids_px = [bids_px[i] for i in order_b]; bids_qty = [bids_qty[i] for i in order_b]
    order_a = sorted(range(len(asks_px)), key=lambda i: asks_px[i])
    asks_px = [asks_px[i] for i in order_a]; asks_qty = [asks_qty[i] for i in order_a]
    while len(bids_px) < depth:
        bids_px.append(0.0); bids_qty.append(0.0)
    while len(asks_px) < depth:
        asks_px.append(0.0); asks_qty.append(0.0)
    return OrderBookSnapshot(
        symbol=str(symbol),
        ts_ms=int(ts_ms),
        bids_px=np.asarray(bids_px[:depth], dtype=np.float64),
        bids_qty=np.asarray(bids_qty[:depth], dtype=np.float64),
        asks_px=np.asarray(asks_px[:depth], dtype=np.float64),
        asks_qty=np.asarray(asks_qty[:depth], dtype=np.float64),
        depth=depth,
    )


# ---------------------------------------------------------------------------
# Fixture generators (for tests / replay)
# ---------------------------------------------------------------------------
def make_fixture_snapshot(symbol: str = "RELIANCE", ts_ms: int = 1_700_000_000_000,
                         depth: int = DEFAULT_DEPTH, mid: float = 2500.0,
                         spread: float = 0.05, bid_qty: float = 1000.0,
                         ask_qty: float = 800.0, skew: float = 0.0) -> OrderBookSnapshot:
    """Synthetic L2 snapshot. skew>0 tilts bids heavier (bullish microstructure)."""
    bids_px = np.array([mid - spread/2 - i*0.05 for i in range(depth)], dtype=np.float64)
    asks_px = np.array([mid + spread/2 + i*0.05 for i in range(depth)], dtype=np.float64)
    bq = np.array([bid_qty * (1 + skew) * (0.9 ** i) for i in range(depth)], dtype=np.float64)
    aq = np.array([ask_qty * (1 - skew) * (0.9 ** i) for i in range(depth)], dtype=np.float64)
    bq = np.clip(bq, 1.0, None); aq = np.clip(aq, 1.0, None)
    return OrderBookSnapshot(symbol=symbol, ts_ms=int(ts_ms), bids_px=bids_px,
                            bids_qty=bq, asks_px=asks_px, asks_qty=aq, depth=depth)


def make_fixture_stream(n: int = 64, depth: int = DEFAULT_DEPTH, seed: int = 42,
                        symbol: str = "RELIANCE") -> List[OrderBookSnapshot]:
    rng = np.random.default_rng(seed)
    out: List[OrderBookSnapshot] = []
    mid = 2500.0
    ts = 1_700_000_000_000
    for i in range(n):
        mid += rng.normal(0, 0.05)
        skew = float(rng.normal(0, 0.15))
        snap = make_fixture_snapshot(symbol=symbol, ts_ms=ts + i * 100,
                                    depth=depth, mid=float(mid), skew=skew,
                                    bid_qty=float(rng.uniform(800, 1200)),
                                    ask_qty=float(rng.uniform(700, 1100)))
        out.append(snap)
    return out


def make_fixture_trades(n: int = 200, seed: int = 7) -> List[Tuple[float, float, str]]:
    rng = np.random.default_rng(seed)
    trades = []
    px = 2500.0
    for _ in range(n):
        px += rng.normal(0, 0.02)
        qty = float(rng.integers(1, 20))
        side = "BUY" if rng.random() < 0.55 else "SELL"
        trades.append((float(px), qty, side))
    return trades


# ---------------------------------------------------------------------------
# Convenience engine facade
# ---------------------------------------------------------------------------
class LOBMicrostructureEngine:
    """Facade tying ring buffer + detector + VPIN + sentry together."""

    def __init__(self, capacity: int = DEFAULT_RING_CAPACITY, depth: int = DEFAULT_DEPTH,
                 bucket_volume: float = DEFAULT_VPIN_BUCKET_VOLUME):
        self.depth = depth
        self.buffer = LOBRingBuffer(capacity=capacity, depth=depth)
        self.detector = IcebergSpoofDetector()
        self.vpin_calc = VPINCalculator(bucket_volume=bucket_volume)
        self._prev: Optional[OrderBookSnapshot] = None
        self._cur_top3_bid: Optional[float] = None
        self._cur_top3_ask: Optional[float] = None
        self._prev_top3_bid_before: Optional[float] = None
        self._prev_top3_ask_before: Optional[float] = None

    def ingest(self, snapshot: OrderBookSnapshot) -> MicrostructureFeatures:
        prev = self._prev
        feats = compute_features(snapshot, prev_snapshot=prev, detector=self.detector,
                                vpin_calc=self.vpin_calc)
        self._prev_top3_bid_before = self._cur_top3_bid
        self._prev_top3_ask_before = self._cur_top3_ask
        self._cur_top3_bid = feats.bid_depth_top3
        self._cur_top3_ask = feats.ask_depth_top3
        self.buffer.push(snapshot)
        self._prev = snapshot
        return feats

    def ingest_raw(self, payload: Dict[str, Any], parser=parse_upstox_depth) -> Optional[MicrostructureFeatures]:
        snap = parser(payload, depth=self.depth)
        if snap is None:
            return None
        return self.ingest(snap)

    def sentry(self, side: str, feats: MicrostructureFeatures, qty: float = 0.0,
               top3_prices: Optional[Sequence[float]] = None,
               top3_qtys: Optional[Sequence[float]] = None) -> SentryVerdict:
        # use prior (before current) by reading buffer? We stored current; for veto use previous snapshot's top3.
        # Here we approximate: previous top3 already overwritten; store separately handled below.
        verdict = sentry_veto(
            side=side, obi=feats.obi_unweighted,
            bid_depth_top3=feats.bid_depth_top3, ask_depth_top3=feats.ask_depth_top3,
            prev_ask_depth_top3=self._prev_top3_ask_before,
            prev_bid_depth_top3=self._prev_top3_bid_before,
            spoof_score=feats.spoof_score, vpin=feats.vpin,
        )
        if top3_prices is not None and top3_qtys is not None:
            mid = feats.mid if feats.mid > 0 else feats.micro_price
            verdict.predicted_slippage_bps = predict_slippage(side, qty, top3_prices, top3_qtys, mid)
        return verdict

    def record_trade(self, price: float, qty: float, side: str) -> Optional[float]:
        return self.vpin_calc.add_trade(price, qty, side)


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------
def depth_to_arrays(snapshot: OrderBookSnapshot) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    return snapshot.bids_px.copy(), snapshot.bids_qty.copy(), snapshot.asks_px.copy(), snapshot.asks_qty.copy()


__all__ = [
    "LOBRingBuffer", "LOBMicrostructureEngine", "OrderBookSnapshot", "MicrostructureFeatures",
    "SentryVerdict", "IcebergSpoofDetector", "VPINCalculator", "QuoteEvent", "DepthLevel",
    "compute_obi", "compute_microprice", "compute_queue_imbalance_topN",
    "compute_vpin_from_trades", "compute_features", "sentry_veto", "predict_slippage",
    "parse_upstox_depth", "parse_openalgo_depth", "make_fixture_snapshot",
    "make_fixture_stream", "make_fixture_trades",
]
