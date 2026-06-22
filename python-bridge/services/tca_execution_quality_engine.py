"""tca_execution_quality_engine.py - Real-Time Transaction Cost Analysis (TCA)
and Market Impact Engine for Indian F&O (Domain 113).

Self-contained production module (stdlib only).
"""

from __future__ import annotations

import json
import logging
import math
import os
import sqlite3
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

logger = logging.getLogger("tca_execution_quality_engine")

SCHEMA_VERSION = 113


def _default_db_path() -> str:
    try:
        import db as _db  # type: ignore

        return getattr(_db, "DB_FILE", os.path.join(os.path.dirname(__file__), "..", "cache.db"))
    except Exception:
        return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cache.db")


def db_path() -> str:
    return os.environ.get("TCA_DB_PATH", _default_db_path())


def configure_db(path: str) -> None:
    os.environ["TCA_DB_PATH"] = path


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect(write: bool = False, path: Optional[str] = None) -> sqlite3.Connection:
    p = path or db_path()
    parent = os.path.dirname(os.path.abspath(p))
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(p, timeout=30.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA busy_timeout = 30000;")
    except sqlite3.Error:
        pass
    if write:
        conn.isolation_level = None
    return conn


SCHEMA_SQL = r"""
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    migrated_at TEXT
);

CREATE TABLE IF NOT EXISTS tca_parent_orders (
    parent_id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    total_qty REAL NOT NULL,
    strategy TEXT,
    created_ts_ms INTEGER,
    venue_plan TEXT,
    status TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS tca_fills (
    fill_id TEXT PRIMARY KEY,
    parent_id TEXT,
    broker TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    qty REAL NOT NULL,
    price REAL NOT NULL,
    ts_ms INTEGER NOT NULL,
    mid0 REAL,
    venue_latency_ms REAL,
    status TEXT,
    raw_json TEXT,
    created_at TEXT,
    FOREIGN KEY (parent_id) REFERENCES tca_parent_orders(parent_id)
);

CREATE TABLE IF NOT EXISTS tca_metrics (
    metric_id TEXT PRIMARY KEY,
    fill_id TEXT NOT NULL,
    effective_spread REAL,
    effective_spread_bps REAL,
    realized_spread_1s REAL,
    realized_spread_5s REAL,
    realized_spread_30s REAL,
    price_impact_1s REAL,
    price_impact_5s REAL,
    price_impact_30s REAL,
    slippage_bps REAL,
    implementation_shortfall_bps REAL,
    mid0 REAL,
    m_1s REAL,
    m_5s REAL,
    m_30s REAL,
    computed_at TEXT,
    FOREIGN KEY (fill_id) REFERENCES tca_fills(fill_id)
);

CREATE TABLE IF NOT EXISTS market_impact_estimates (
    estimate_id TEXT PRIMARY KEY,
    parent_id TEXT,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    qty REAL NOT NULL,
    adv REAL,
    participation_rate REAL,
    trading_rate REAL,
    volume_rate REAL,
    duration_sec REAL,
    permanent_impact_bps REAL,
    temporary_impact_bps REAL,
    total_impact_bps REAL,
    gamma REAL,
    eta REAL,
    computed_at TEXT
);

CREATE TABLE IF NOT EXISTS broker_latency (
    record_id TEXT PRIMARY KEY,
    broker TEXT NOT NULL,
    symbol TEXT,
    fill_id TEXT,
    latency_ms REAL,
    slippage_bps REAL,
    qty REAL,
    ts_ms INTEGER,
    rejected INTEGER DEFAULT 0,
    partial INTEGER DEFAULT 0,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS broker_scores (
    score_id TEXT PRIMARY KEY,
    broker TEXT NOT NULL,
    window_start_ms INTEGER,
    window_end_ms INTEGER,
    fills INTEGER,
    avg_latency_ms REAL,
    avg_slippage_bps REAL,
    reject_rate REAL,
    fill_rate REAL,
    composite_score REAL,
    computed_at TEXT
);

CREATE TABLE IF NOT EXISTS leakage_events (
    event_id TEXT PRIMARY KEY,
    parent_id TEXT,
    symbol TEXT,
    ts_ms INTEGER,
    event_type TEXT,
    depth_before REAL,
    depth_after REAL,
    withdrawal_pct REAL,
    child_fill_id TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS leakage_reports (
    report_id TEXT PRIMARY KEY,
    parent_id TEXT,
    symbol TEXT,
    leakage_score REAL,
    n_withdrawals INTEGER,
    n_quote_updates INTEGER,
    n_child_fills INTEGER,
    flagged INTEGER,
    computed_at TEXT
);

CREATE TABLE IF NOT EXISTS execution_quality_scores (
    score_id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    score REAL,
    grade TEXT,
    components_json TEXT,
    computed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tca_fills_parent ON tca_fills(parent_id);
CREATE INDEX IF NOT EXISTS idx_tca_fills_symbol ON tca_fills(symbol);
CREATE INDEX IF NOT EXISTS idx_tca_metrics_fill ON tca_metrics(fill_id);
CREATE INDEX IF NOT EXISTS idx_broker_latency_broker ON broker_latency(broker);
CREATE INDEX IF NOT EXISTS idx_leakage_parent ON leakage_events(parent_id);
CREATE INDEX IF NOT EXISTS idx_quality_entity ON execution_quality_scores(entity_type, entity_id);
"""


def init_schema(db_path_override: Optional[str] = None) -> None:
    path = db_path_override or db_path()
    conn = _connect(True, path)
    try:
        conn.executescript(SCHEMA_SQL)
        conn.execute(
            "INSERT OR REPLACE INTO schema_version (version, migrated_at) VALUES (?, ?)",
            (SCHEMA_VERSION, _now_iso()),
        )
        conn.commit()
    finally:
        conn.close()


def _current_version(path: Optional[str] = None) -> int:
    p = path or db_path()
    try:
        conn = _connect(False, p)
    except sqlite3.Error:
        return 0
    try:
        row = conn.execute("SELECT MAX(version) AS v FROM schema_version").fetchone()
        return int(row["v"]) if row and row["v"] is not None else 0
    except sqlite3.Error:
        return 0
    finally:
        conn.close()


def migrate(db_path_override: Optional[str] = None) -> int:
    path = db_path_override or db_path()
    if _current_version(path) < SCHEMA_VERSION:
        init_schema(path)
    return _current_version(path)


class Side(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class FillStatus(str, Enum):
    FILLED = "FILLED"
    PARTIAL = "PARTIAL"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class BrokerVenue(str, Enum):
    DHAN_REST = "DHAN_REST"
    UPSTOX_WS = "UPSTOX_WS"
    OPENALGO = "OPENALGO"
    SANDBOX = "SANDBOX"


@dataclass
class ParentOrder:
    parent_id: str
    symbol: str
    side: Side
    total_qty: float
    strategy: str = ""
    created_ts_ms: int = 0
    venue_plan: str = ""
    status: str = "OPEN"

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["side"] = self.side.value if isinstance(self.side, Side) else str(self.side)
        return d


@dataclass
class ChildFill:
    fill_id: str
    parent_id: str
    broker: str
    symbol: str
    side: Side
    qty: float
    price: float
    ts_ms: int
    mid0: float = 0.0
    venue_latency_ms: float = 0.0
    status: FillStatus = FillStatus.FILLED
    raw: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["side"] = self.side.value if isinstance(self.side, Side) else str(self.side)
        d["status"] = self.status.value if isinstance(self.status, FillStatus) else str(self.status)
        return d


@dataclass
class MarketTick:
    ts_ms: int
    mid: float
    bid: float = 0.0
    ask: float = 0.0


@dataclass
class TCAMetrics:
    fill_id: str
    effective_spread: float
    effective_spread_bps: float
    realized_spread_1s: float
    realized_spread_5s: float
    realized_spread_30s: float
    price_impact_1s: float
    price_impact_5s: float
    price_impact_30s: float
    slippage_bps: float
    implementation_shortfall_bps: float
    mid0: float
    m_1s: float
    m_5s: float
    m_30s: float

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class AlmgrenChrissParams:
    gamma: float = 0.1
    eta: float = 0.05
    sigma: float = 0.02
    risk_aversion: float = 1e-6


@dataclass
class MarketImpactEstimate:
    estimate_id: str
    parent_id: str
    symbol: str
    side: Side
    qty: float
    adv: float
    participation_rate: float
    trading_rate: float
    volume_rate: float
    duration_sec: float
    permanent_impact_bps: float
    temporary_impact_bps: float
    total_impact_bps: float
    gamma: float
    eta: float
    computed_at: str = ""

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["side"] = self.side.value if isinstance(self.side, Side) else str(self.side)
        return d


@dataclass
class BrokerFillRecord:
    broker: str
    fill_id: str
    symbol: str
    latency_ms: float
    slippage_bps: float
    qty: float
    ts_ms: int
    rejected: bool = False
    partial: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class LeakageEvent:
    event_id: str
    parent_id: str
    symbol: str
    ts_ms: int
    event_type: str
    depth_before: float
    depth_after: float
    withdrawal_pct: float
    child_fill_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class LeakageReport:
    report_id: str
    parent_id: str
    symbol: str
    leakage_score: float
    n_withdrawals: int
    n_quote_updates: int
    n_child_fills: int
    flagged: bool
    events: List[LeakageEvent] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["events"] = [e.to_dict() for e in self.events]
        return d


def _side_sign(side: Any) -> int:
    s = side.value if isinstance(side, Side) else str(side).upper()
    return 1 if s == "BUY" else -1


def effective_spread(fill_price: float, mid0: float) -> float:
    return 2.0 * abs(float(fill_price) - float(mid0))


def effective_spread_bps(fill_price: float, mid0: float) -> float:
    if float(mid0) == 0.0:
        return 0.0
    return effective_spread(fill_price, mid0) / float(mid0) * 10000.0


def realized_spread(fill_price: float, mid_tau: float, side: Any) -> float:
    q = _side_sign(side)
    return 2.0 * q * (float(fill_price) - float(mid_tau))


def price_impact(mid0: float, mid_tau: float, side: Any) -> float:
    q = _side_sign(side)
    return 2.0 * q * (float(mid_tau) - float(mid0))


def slippage_bps(fill_price: float, mid0: float, side: Any) -> float:
    if float(mid0) == 0.0:
        return 0.0
    return (float(fill_price) - float(mid0)) / float(mid0) * 10000.0


def participation_rate(qty: float, interval_volume: float) -> float:
    if float(interval_volume) <= 0.0:
        return 0.0
    return float(qty) / float(interval_volume)


def trading_rate(qty: float, duration_sec: float) -> float:
    if float(duration_sec) <= 0.0:
        return float(qty)
    return float(qty) / float(duration_sec)


def permanent_impact_bps(qty: float, adv: float, gamma: float = 0.1) -> float:
    if float(adv) <= 0.0:
        return 0.0
    return float(gamma) * (float(qty) / float(adv)) * 10000.0


def temporary_impact_bps(qty: float, duration_sec: float, volume_rate: float, eta: float = 0.05) -> float:
    tr = trading_rate(qty, duration_sec)
    if float(volume_rate) <= 0.0:
        pr = tr
    else:
        pr = tr / float(volume_rate)
    return float(eta) * pr * 10000.0


def estimate_market_impact(
    parent_id: str,
    symbol: str,
    side: Any,
    qty: float,
    adv: float,
    duration_sec: float,
    volume_rate: float,
    params: Optional[AlmgrenChrissParams] = None,
) -> MarketImpactEstimate:
    params = params or AlmgrenChrissParams()
    pr = participation_rate(qty, adv)
    tr = trading_rate(qty, duration_sec)
    perm = permanent_impact_bps(qty, adv, params.gamma)
    temp = temporary_impact_bps(qty, duration_sec, volume_rate, params.eta)
    return MarketImpactEstimate(
        estimate_id=uuid.uuid4().hex,
        parent_id=parent_id,
        symbol=symbol,
        side=side if isinstance(side, Side) else Side(str(side).upper()),
        qty=float(qty),
        adv=float(adv),
        participation_rate=float(pr),
        trading_rate=float(tr),
        volume_rate=float(volume_rate),
        duration_sec=float(duration_sec),
        permanent_impact_bps=float(perm),
        temporary_impact_bps=float(temp),
        total_impact_bps=float(perm + temp),
        gamma=float(params.gamma),
        eta=float(params.eta),
        computed_at=_now_iso(),
    )


def calibrate_almgren_chriss(observations: Sequence[Mapping[str, Any]]) -> AlmgrenChrissParams:
    sxx = sxy = syy = sxz = syz = 0.0
    n = 0
    for obs in observations:
        x = float(obs.get("participation_rate", 0.0))
        y = float(obs.get("trading_rate", 0.0))
        z = float(obs.get("realized_impact_bps", 0.0))
        sxx += x * x
        sxy += x * y
        syy += y * y
        sxz += x * z
        syz += y * z
        n += 1
    det = sxx * syy - sxy * sxy
    if n == 0 or abs(det) < 1e-18:
        return AlmgrenChrissParams()
    gamma = (sxz * syy - sxy * syz) / det
    eta = (sxx * syz - sxz * sxy) / det
    if not math.isfinite(gamma):
        gamma = 0.1
    if not math.isfinite(eta):
        eta = 0.05
    return AlmgrenChrissParams(gamma=float(gamma), eta=float(eta))


class BrokerRoutingProfiler:
    def __init__(self, window_ms: int = 60_000):
        self.window_ms = int(window_ms)
        self._records: List[BrokerFillRecord] = []
        self._lock = threading.Lock()

    def record(self, rec: BrokerFillRecord) -> None:
        with self._lock:
            self._records.append(rec)

    def record_fill(
        self,
        broker: str,
        fill_id: str,
        symbol: str,
        latency_ms: float,
        slippage_bps: float,
        qty: float,
        ts_ms: int,
        rejected: bool = False,
        partial: bool = False,
    ) -> None:
        self.record(BrokerFillRecord(
            broker=broker, fill_id=fill_id, symbol=symbol,
            latency_ms=float(latency_ms), slippage_bps=float(slippage_bps),
            qty=float(qty), ts_ms=int(ts_ms), rejected=bool(rejected),
            partial=bool(partial),
        ))

    def _window(self, broker: str, now_ms: Optional[int]) -> List[BrokerFillRecord]:
        now = int(now_ms if now_ms is not None else int(time.time() * 1000))
        cutoff = now - self.window_ms
        with self._lock:
            return [r for r in self._records
                    if r.broker == broker and r.ts_ms >= cutoff]

    def stats(self, broker: str, now_ms: Optional[int] = None) -> Dict[str, Any]:
        recs = self._window(broker, now_ms)
        n = len(recs)
        if n == 0:
            return {
                "broker": broker, "n": 0, "avg_latency_ms": 0.0,
                "avg_slippage_bps": 0.0, "reject_rate": 0.0,
                "partial_rate": 0.0, "fill_rate": 1.0, "total_qty": 0.0,
            }
        avg_latency = sum(r.latency_ms for r in recs) / n
        avg_slippage = sum(abs(r.slippage_bps) for r in recs) / n
        rejects = sum(1 for r in recs if r.rejected)
        partials = sum(1 for r in recs if r.partial)
        reject_rate = rejects / n
        partial_rate = partials / n
        fill_rate = 1.0 - partial_rate
        total_qty = sum(r.qty for r in recs)
        return {
            "broker": broker, "n": n, "avg_latency_ms": float(avg_latency),
            "avg_slippage_bps": float(avg_slippage), "reject_rate": float(reject_rate),
            "partial_rate": float(partial_rate), "fill_rate": float(fill_rate),
            "total_qty": float(total_qty),
        }

    def score(
        self,
        broker: str,
        now_ms: Optional[int] = None,
        weights: Optional[Mapping[str, float]] = None,
    ) -> float:
        w = dict(weights or {})
        w.setdefault("latency", 0.30)
        w.setdefault("slippage", 0.35)
        w.setdefault("reject", 0.20)
        w.setdefault("completeness", 0.15)
        st = self.stats(broker, now_ms)
        if st["n"] == 0:
            return 50.0
        latency_score = max(0.0, min(100.0, 100.0 - st["avg_latency_ms"] * 0.5))
        slippage_score = max(0.0, min(100.0, 100.0 - st["avg_slippage_bps"] * 10.0))
        reject_score = (1.0 - st["reject_rate"]) * 100.0
        completeness_score = st["fill_rate"] * 100.0
        total_w = sum(w.values()) or 1.0
        composite = (
            w["latency"] * latency_score
            + w["slippage"] * slippage_score
            + w["reject"] * reject_score
            + w["completeness"] * completeness_score
        ) / total_w
        return float(max(0.0, min(100.0, composite)))

    def all_scores(self, now_ms: Optional[int] = None) -> Dict[str, float]:
        brokers = sorted({r.broker for r in self._records})
        return {b: self.score(b, now_ms) for b in brokers}

    def best_broker(self, candidates: Sequence[str], now_ms: Optional[int] = None) -> str:
        if not candidates:
            return ""
        scores = [(self.score(c, now_ms), c) for c in candidates]
        scores.sort(reverse=True)
        return scores[0][1]


class LeakageDetector:
    def __init__(self, withdrawal_threshold_pct: float = 0.20, window_ms: int = 5000):
        self.withdrawal_threshold_pct = float(withdrawal_threshold_pct)
        self.window_ms = int(window_ms)
        self._parents: Dict[str, Dict[str, Any]] = {}
        self._quotes: Dict[str, List[Tuple[int, float, float]]] = {}
        self._lock = threading.Lock()

    def register_parent(self, parent_id: str, symbol: str, ts_ms: int, total_qty: float = 0.0) -> None:
        with self._lock:
            self._parents[parent_id] = {
                "symbol": symbol, "created_ts_ms": int(ts_ms),
                "total_qty": float(total_qty), "fills": [],
            }
            self._quotes.setdefault(symbol, [])

    def on_quote(self, symbol: str, ts_ms: int, best_bid_qty: float, best_ask_qty: float) -> None:
        with self._lock:
            self._quotes.setdefault(symbol, []).append(
                (int(ts_ms), float(best_bid_qty), float(best_ask_qty))
            )

    def on_child_fill(self, parent_id: str, fill_id: str, ts_ms: int, price: float) -> None:
        with self._lock:
            p = self._parents.get(parent_id)
            if p is not None:
                p["fills"].append({"fill_id": fill_id, "ts_ms": int(ts_ms), "price": float(price)})

    def finalize(self, parent_id: str) -> LeakageReport:
        with self._lock:
            parent = self._parents.get(parent_id, {})
            symbol = str(parent.get("symbol", ""))
            fills = list(parent.get("fills", []))
            quotes = sorted(self._quotes.get(symbol, []), key=lambda x: x[0])
            created = int(parent.get("created_ts_ms", 0))
            if fills:
                last_fill_ts = max(f["ts_ms"] for f in fills)
            else:
                last_fill_ts = created + self.window_ms
            window_quotes = [q for q in quotes if created - self.window_ms <= q[0] <= last_fill_ts + self.window_ms]

        events: List[LeakageEvent] = []
        withdrawals = 0
        prev = None
        for ts, bq, aq in window_quotes:
            if prev is not None:
                for side, before, after in (("BID", prev[1], bq), ("ASK", prev[2], aq)):
                    if before > 0.0:
                        pct = (before - after) / before
                        if pct >= self.withdrawal_threshold_pct:
                            withdrawals += 1
                            events.append(LeakageEvent(
                                event_id=uuid.uuid4().hex,
                                parent_id=parent_id,
                                symbol=symbol,
                                ts_ms=int(ts),
                                event_type=f"QUOTE_WITHDRAWAL_{side}",
                                depth_before=float(before),
                                depth_after=float(after),
                                withdrawal_pct=float(pct),
                                child_fill_id=None,
                            ))
            prev = (ts, bq, aq)

        for ev in events:
            nearest = None
            best_gap = self.window_ms + 1
            for f in fills:
                gap = f["ts_ms"] - ev.ts_ms
                if 0 <= gap <= best_gap:
                    best_gap = gap
                    nearest = f["fill_id"]
            ev.child_fill_id = nearest

        n_updates = max(1, len(window_quotes))
        score = min(1.0, withdrawals / n_updates)
        if fills and withdrawals > 0:
            pre_fill_withdrawals = sum(
                1 for ev in events
                if any(0 <= f["ts_ms"] - ev.ts_ms <= self.window_ms for f in fills)
            )
            if pre_fill_withdrawals > 0:
                score = min(1.0, score + 0.1 * pre_fill_withdrawals)
        flagged = bool(score >= 0.3 or withdrawals >= 3)
        return LeakageReport(
            report_id=uuid.uuid4().hex,
            parent_id=parent_id,
            symbol=symbol,
            leakage_score=float(score),
            n_withdrawals=int(withdrawals),
            n_quote_updates=int(n_updates),
            n_child_fills=len(fills),
            flagged=flagged,
            events=events,
        )


class ExecutionQualityScorer:
    def __init__(self, weights: Optional[Mapping[str, float]] = None):
        self.weights = dict(weights or {
            "cost": 0.30, "spread": 0.20, "impact": 0.20,
            "latency": 0.15, "leakage": 0.15,
        })

    @staticmethod
    def grade(score: float) -> str:
        if score >= 90:
            return "A+"
        if score >= 80:
            return "A"
        if score >= 70:
            return "B"
        if score >= 60:
            return "C"
        if score >= 50:
            return "D"
        return "F"

    def score_fill(
        self,
        metrics: TCAMetrics,
        broker_score: Optional[float] = None,
        leakage_score: float = 1.0,
        impact_bps: Optional[float] = None,
    ) -> Tuple[float, str, Dict[str, float]]:
        cost_score = max(0.0, min(100.0, 100.0 - abs(metrics.slippage_bps) * 4.0))
        spread_score = max(0.0, min(100.0, 100.0 - metrics.effective_spread_bps * 2.0))
        imp = impact_bps if impact_bps is not None else 0.0
        impact_score = max(0.0, min(100.0, 100.0 - abs(imp) * 5.0))
        latency_score = 50.0 if broker_score is None else float(broker_score)
        leakage_component = max(0.0, min(100.0, float(leakage_score) * 100.0))
        components = {
            "cost": cost_score, "spread": spread_score, "impact": impact_score,
            "latency": latency_score, "leakage": leakage_component,
        }
        total_w = sum(self.weights.values()) or 1.0
        score = 0.0
        for k, v in components.items():
            score += self.weights.get(k, 0.0) * v
        score = score / total_w
        score = max(0.0, min(100.0, score))
        return float(score), self.grade(score), components

    def score_parent(
        self,
        metrics_list: Sequence[TCAMetrics],
        broker_score: Optional[float] = None,
        leakage_score: float = 1.0,
        impact_bps: Optional[float] = None,
    ) -> Tuple[float, str, Dict[str, float]]:
        if not metrics_list:
            return 0.0, "F", {}
        n = len(metrics_list)
        avg_slip = sum(m.slippage_bps for m in metrics_list) / n
        avg_spread = sum(m.effective_spread_bps for m in metrics_list) / n
        agg = TCAMetrics(
            fill_id="AGG",
            effective_spread=sum(m.effective_spread for m in metrics_list) / n,
            effective_spread_bps=avg_spread,
            realized_spread_1s=sum(m.realized_spread_1s for m in metrics_list) / n,
            realized_spread_5s=sum(m.realized_spread_5s for m in metrics_list) / n,
            realized_spread_30s=sum(m.realized_spread_30s for m in metrics_list) / n,
            price_impact_1s=sum(m.price_impact_1s for m in metrics_list) / n,
            price_impact_5s=sum(m.price_impact_5s for m in metrics_list) / n,
            price_impact_30s=sum(m.price_impact_30s for m in metrics_list) / n,
            slippage_bps=avg_slip,
            implementation_shortfall_bps=sum(m.implementation_shortfall_bps for m in metrics_list) / n,
            mid0=sum(m.mid0 for m in metrics_list) / n,
            m_1s=sum(m.m_1s for m in metrics_list) / n,
            m_5s=sum(m.m_5s for m in metrics_list) / n,
            m_30s=sum(m.m_30s for m in metrics_list) / n,
        )
        return self.score_fill(agg, broker_score=broker_score, leakage_score=leakage_score, impact_bps=impact_bps)


class TCAStore:
    def __init__(self, db_path_override: Optional[str] = None):
        self.db_path = db_path_override or db_path()
        self._lock = threading.Lock()
        migrate(self.db_path)

    def _connect(self, write: bool = False) -> sqlite3.Connection:
        return _connect(write, self.db_path)

    def init_schema(self) -> None:
        init_schema(self.db_path)

    def insert_parent(self, parent: ParentOrder) -> None:
        d = parent.to_dict()
        with self._lock:
            conn = self._connect(True)
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO tca_parent_orders
                       (parent_id, symbol, side, total_qty, strategy, created_ts_ms, venue_plan, status, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (
                        d["parent_id"], d["symbol"], d["side"], d["total_qty"], d["strategy"],
                        d["created_ts_ms"], d["venue_plan"], d["status"], _now_iso(),
                    ),
                )
                conn.commit()
            finally:
                conn.close()

    def get_parent(self, parent_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            conn = self._connect(False)
            try:
                row = conn.execute(
                    "SELECT * FROM tca_parent_orders WHERE parent_id=?", (parent_id,)
                ).fetchone()
                return dict(row) if row else None
            finally:
                conn.close()

    def insert_fill(self, fill: ChildFill) -> None:
        d = fill.to_dict()
        with self._lock:
            conn = self._connect(True)
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO tca_fills
                       (fill_id, parent_id, broker, symbol, side, qty, price, ts_ms, mid0, venue_latency_ms, status, raw_json, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        d["fill_id"], d["parent_id"], d["broker"], d["symbol"], d["side"],
                        d["qty"], d["price"], d["ts_ms"], d["mid0"], d["venue_latency_ms"],
                        d["status"], json.dumps(d.get("raw", {})), _now_iso(),
                    ),
                )
                conn.commit()
            finally:
                conn.close()

    def get_fill(self, fill_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            conn = self._connect(False)
            try:
                row = conn.execute("SELECT * FROM tca_fills WHERE fill_id=?", (fill_id,)).fetchone()
                if not row:
                    return None
                r = dict(row)
                try:
                    r["raw"] = json.loads(r.get("raw_json") or "{}")
                except json.JSONDecodeError:
                    r["raw"] = {}
                return r
            finally:
                conn.close()

    def list_fills(self, parent_id: Optional[str] = None, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        q = "SELECT * FROM tca_fills WHERE 1=1"
        params: List[Any] = []
        if parent_id:
            q += " AND parent_id=?"
            params.append(parent_id)
        if symbol:
            q += " AND symbol=?"
            params.append(symbol)
        with self._lock:
            conn = self._connect(False)
            try:
                rows = conn.execute(q, params).fetchall()
                out = []
                for row in rows:
                    r = dict(row)
                    try:
                        r["raw"] = json.loads(r.get("raw_json") or "{}")
                    except json.JSONDecodeError:
                        r["raw"] = {}
                    out.append(r)
                return out
            finally:
                conn.close()

    def insert_metric(self, m: TCAMetrics) -> None:
        with self._lock:
            conn = self._connect(True)
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO tca_metrics
                       (metric_id, fill_id, effective_spread, effective_spread_bps, realized_spread_1s,
                        realized_spread_5s, realized_spread_30s, price_impact_1s, price_impact_5s,
                        price_impact_30s, slippage_bps, implementation_shortfall_bps, mid0, m_1s, m_5s, m_30s, computed_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        uuid.uuid4().hex, m.fill_id, m.effective_spread, m.effective_spread_bps,
                        m.realized_spread_1s, m.realized_spread_5s, m.realized_spread_30s,
                        m.price_impact_1s, m.price_impact_5s, m.price_impact_30s,
                        m.slippage_bps, m.implementation_shortfall_bps, m.mid0, m.m_1s, m.m_5s, m.m_30s,
                        _now_iso(),
                    ),
                )
                conn.commit()
            finally:
                conn.close()

    def get_metric(self, fill_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            conn = self._connect(False)
            try:
                row = conn.execute(
                    "SELECT * FROM tca_metrics WHERE fill_id=? ORDER BY computed_at DESC LIMIT 1",
                    (fill_id,),
                ).fetchone()
                return dict(row) if row else None
            finally:
                conn.close()

    def insert_market_impact(self, est: MarketImpactEstimate) -> None:
        d = est.to_dict()
        with self._lock:
            conn = self._connect(True)
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO market_impact_estimates
                       (estimate_id, parent_id, symbol, side, qty, adv, participation_rate, trading_rate,
                        volume_rate, duration_sec, permanent_impact_bps, temporary_impact_bps, total_impact_bps,
                        gamma, eta, computed_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        d["estimate_id"], d["parent_id"], d["symbol"], d["side"], d["qty"], d["adv"],
                        d["participation_rate"], d["trading_rate"], d["volume_rate"], d["duration_sec"],
                        d["permanent_impact_bps"], d["temporary_impact_bps"], d["total_impact_bps"],
                        d["gamma"], d["eta"], d["computed_at"] or _now_iso(),
                    ),
                )
                conn.commit()
            finally:
                conn.close()

    def insert_broker_record(self, rec: BrokerFillRecord) -> None:
        with self._lock:
            conn = self._connect(True)
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO broker_latency
                       (record_id, broker, symbol, fill_id, latency_ms, slippage_bps, qty, ts_ms, rejected, partial, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        uuid.uuid4().hex, rec.broker, rec.symbol, rec.fill_id, rec.latency_ms,
                        rec.slippage_bps, rec.qty, rec.ts_ms, int(rec.rejected), int(rec.partial), _now_iso(),
                    ),
                )
                conn.commit()
            finally:
                conn.close()

    def insert_broker_score(self, broker: str, window_start_ms: int, window_end_ms: int,
                            stats: Mapping[str, Any], score: float) -> None:
        with self._lock:
            conn = self._connect(True)
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO broker_scores
                       (score_id, broker, window_start_ms, window_end_ms, fills, avg_latency_ms,
                        avg_slippage_bps, reject_rate, fill_rate, composite_score, computed_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        uuid.uuid4().hex, broker, int(window_start_ms), int(window_end_ms),
                        int(stats.get("n", 0)), float(stats.get("avg_latency_ms", 0.0)),
                        float(stats.get("avg_slippage_bps", 0.0)), float(stats.get("reject_rate", 0.0)),
                        float(stats.get("fill_rate", 1.0)), float(score), _now_iso(),
                    ),
                )
                conn.commit()
            finally:
                conn.close()

    def insert_leakage_event(self, ev: LeakageEvent) -> None:
        with self._lock:
            conn = self._connect(True)
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO leakage_events
                       (event_id, parent_id, symbol, ts_ms, event_type, depth_before, depth_after, withdrawal_pct, child_fill_id, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (
                        ev.event_id, ev.parent_id, ev.symbol, ev.ts_ms, ev.event_type,
                        ev.depth_before, ev.depth_after, ev.withdrawal_pct, ev.child_fill_id, _now_iso(),
                    ),
                )
                conn.commit()
            finally:
                conn.close()

    def insert_leakage_report(self, rep: LeakageReport) -> None:
        with self._lock:
            conn = self._connect(True)
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO leakage_reports
                       (report_id, parent_id, symbol, leakage_score, n_withdrawals, n_quote_updates, n_child_fills, flagged, computed_at)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (
                        rep.report_id, rep.parent_id, rep.symbol, rep.leakage_score,
                        rep.n_withdrawals, rep.n_quote_updates, rep.n_child_fills,
                        int(rep.flagged), _now_iso(),
                    ),
                )
                conn.commit()
            finally:
                conn.close()

    def insert_quality_score(self, entity_type: str, entity_id: str, score: float, grade: str,
                             components: Mapping[str, float]) -> None:
        with self._lock:
            conn = self._connect(True)
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO execution_quality_scores
                       (score_id, entity_type, entity_id, score, grade, components_json, computed_at)
                       VALUES (?,?,?,?,?,?,?)""",
                    (
                        uuid.uuid4().hex, entity_type, entity_id, float(score), grade,
                        json.dumps(components), _now_iso(),
                    ),
                )
                conn.commit()
            finally:
                conn.close()

    def get_quality_score(self, entity_type: str, entity_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            conn = self._connect(False)
            try:
                row = conn.execute(
                    "SELECT * FROM execution_quality_scores WHERE entity_type=? AND entity_id=? ORDER BY computed_at DESC LIMIT 1",
                    (entity_type, entity_id),
                ).fetchone()
                if not row:
                    return None
                r = dict(row)
                try:
                    r["components"] = json.loads(r.get("components_json") or "{}")
                except json.JSONDecodeError:
                    r["components"] = {}
                return r
            finally:
                conn.close()


class TCAExecutionQualityEngine:
    def __init__(self, db_path_override: Optional[str] = None):
        self.store = TCAStore(db_path_override)
        self.profiler = BrokerRoutingProfiler()
        self.leakage = LeakageDetector()
        self.scorer = ExecutionQualityScorer()
        self._mids: Dict[str, List[MarketTick]] = {}
        self._lock = threading.Lock()

    def record_market_tick(self, symbol: str, ts_ms: int, mid: float, bid: float = 0.0, ask: float = 0.0) -> None:
        with self._lock:
            self._mids.setdefault(symbol, []).append(MarketTick(int(ts_ms), float(mid), float(bid), float(ask)))
            if len(self._mids[symbol]) > 200_000:
                self._mids[symbol] = self._mids[symbol][-100_000:]

    def _nearest_mid(self, symbol: str, target_ts: int, max_gap_ms: int = 10_000) -> float:
        series = self._mids.get(symbol, [])
        if not series:
            return 0.0
        best = None
        best_gap = None
        for t in series:
            gap = abs(t.ts_ms - target_ts)
            if best_gap is None or gap < best_gap:
                best = t
                best_gap = gap
        if best is None or (best_gap is not None and best_gap > max_gap_ms):
            return 0.0
        return float(best.mid)

    def register_parent(self, parent: ParentOrder) -> None:
        self.store.insert_parent(parent)
        self.leakage.register_parent(parent.parent_id, parent.symbol, parent.created_ts_ms, parent.total_qty)

    def record_fill(self, fill: ChildFill) -> None:
        self.store.insert_fill(fill)
        if fill.mid0 == 0.0:
            fill.mid0 = self._nearest_mid(fill.symbol, fill.ts_ms)
        rec = BrokerFillRecord(
            broker=fill.broker, fill_id=fill.fill_id, symbol=fill.symbol,
            latency_ms=fill.venue_latency_ms,
            slippage_bps=slippage_bps(fill.price, fill.mid0, fill.side),
            qty=fill.qty, ts_ms=fill.ts_ms,
            rejected=(fill.status == FillStatus.REJECTED),
            partial=(fill.status == FillStatus.PARTIAL),
        )
        self.profiler.record(rec)
        self.store.insert_broker_record(rec)
        self.leakage.on_child_fill(fill.parent_id, fill.fill_id, fill.ts_ms, fill.price)

    def record_quote(self, symbol: str, ts_ms: int, best_bid_qty: float, best_ask_qty: float) -> None:
        self.leakage.on_quote(symbol, ts_ms, best_bid_qty, best_ask_qty)

    def compute_tca(self, fill_id: str, horizons_ms: Sequence[int] = (1000, 5000, 30000)) -> Tuple[TCAMetrics, float, str]:
        fill_row = self.store.get_fill(fill_id)
        if not fill_row:
            raise KeyError(f"fill not found: {fill_id}")
        fill_id_v = fill_row["fill_id"]
        symbol = fill_row["symbol"]
        side = fill_row["side"]
        price = float(fill_row["price"])
        ts_ms = int(fill_row["ts_ms"])
        mid0 = float(fill_row.get("mid0") or 0.0)
        if mid0 == 0.0:
            mid0 = self._nearest_mid(symbol, ts_ms)
        hmap = {}
        for h in horizons_ms:
            hmap[h] = self._nearest_mid(symbol, ts_ms + h)
        m1 = hmap.get(1000, 0.0)
        m5 = hmap.get(5000, 0.0)
        m30 = hmap.get(30000, 0.0)
        # if custom horizons, fill slots in order
        hs = list(horizons_ms)
        if 1000 not in hmap and len(hs) >= 1:
            m1 = hmap.get(hs[0], 0.0)
        if 5000 not in hmap and len(hs) >= 2:
            m5 = hmap.get(hs[1], 0.0)
        if 30000 not in hmap and len(hs) >= 3:
            m30 = hmap.get(hs[2], 0.0)
        metrics = TCAMetrics(
            fill_id=fill_id_v,
            effective_spread=effective_spread(price, mid0),
            effective_spread_bps=effective_spread_bps(price, mid0),
            realized_spread_1s=realized_spread(price, m1, side),
            realized_spread_5s=realized_spread(price, m5, side),
            realized_spread_30s=realized_spread(price, m30, side),
            price_impact_1s=price_impact(mid0, m1, side),
            price_impact_5s=price_impact(mid0, m5, side),
            price_impact_30s=price_impact(mid0, m30, side),
            slippage_bps=slippage_bps(price, mid0, side),
            implementation_shortfall_bps=slippage_bps(price, mid0, side),
            mid0=mid0,
            m_1s=m1, m_5s=m5, m_30s=m30,
        )
        self.store.insert_metric(metrics)
        broker_score = self.profiler.score(fill_row["broker"])
        score, grade, components = self.scorer.score_fill(metrics, broker_score=broker_score, leakage_score=1.0)
        self.store.insert_quality_score("fill", fill_id_v, score, grade, components)
        return metrics, score, grade

    def record_market_impact(
        self,
        parent_id: str,
        symbol: str,
        side: Any,
        qty: float,
        adv: float,
        duration_sec: float,
        volume_rate: float,
        params: Optional[AlmgrenChrissParams] = None,
    ) -> MarketImpactEstimate:
        est = estimate_market_impact(parent_id, symbol, side, qty, adv, duration_sec, volume_rate, params)
        self.store.insert_market_impact(est)
        return est

    def finalize_leakage(self, parent_id: str) -> LeakageReport:
        rep = self.leakage.finalize(parent_id)
        for ev in rep.events:
            self.store.insert_leakage_event(ev)
        self.store.insert_leakage_report(rep)
        return rep

    def persist_broker_scores(self, now_ms: Optional[int] = None) -> Dict[str, float]:
        now = int(now_ms if now_ms is not None else int(time.time() * 1000))
        window_start = now - self.profiler.window_ms
        scores = {}
        for broker in sorted({r.broker for r in self.profiler._records}):
            st = self.profiler.stats(broker, now)
            sc = self.profiler.score(broker, now)
            self.store.insert_broker_score(broker, window_start, now, st, sc)
            scores[broker] = sc
        return scores

    def score_parent(self, parent_id: str) -> Tuple[float, str, Dict[str, float]]:
        fills = self.store.list_fills(parent_id=parent_id)
        metrics_list = []
        for f in fills:
            m = self.store.get_metric(f["fill_id"])
            if m:
                metrics_list.append(TCAMetrics(
                    fill_id=f["fill_id"],
                    effective_spread=float(m.get("effective_spread") or 0.0),
                    effective_spread_bps=float(m.get("effective_spread_bps") or 0.0),
                    realized_spread_1s=float(m.get("realized_spread_1s") or 0.0),
                    realized_spread_5s=float(m.get("realized_spread_5s") or 0.0),
                    realized_spread_30s=float(m.get("realized_spread_30s") or 0.0),
                    price_impact_1s=float(m.get("price_impact_1s") or 0.0),
                    price_impact_5s=float(m.get("price_impact_5s") or 0.0),
                    price_impact_30s=float(m.get("price_impact_30s") or 0.0),
                    slippage_bps=float(m.get("slippage_bps") or 0.0),
                    implementation_shortfall_bps=float(m.get("implementation_shortfall_bps") or 0.0),
                    mid0=float(m.get("mid0") or 0.0),
                    m_1s=float(m.get("m_1s") or 0.0),
                    m_5s=float(m.get("m_5s") or 0.0),
                    m_30s=float(m.get("m_30s") or 0.0),
                ))
        score, grade, components = self.scorer.score_parent(metrics_list, broker_score=None, leakage_score=1.0)
        self.store.insert_quality_score("parent", parent_id, score, grade, components)
        return score, grade, components


def make_fixture_parent(
    parent_id: str = "PARENT_1",
    symbol: str = "NIFTY24JANFUT",
    side: Side = Side.BUY,
    total_qty: float = 100.0,
    created_ts_ms: int = 1_700_000_000_000,
) -> ParentOrder:
    return ParentOrder(
        parent_id=parent_id, symbol=symbol, side=side, total_qty=total_qty,
        strategy="TEST", created_ts_ms=created_ts_ms, venue_plan="DHAN_REST",
    )


def make_fixture_fill(
    fill_id: str = "FILL_1",
    parent_id: str = "PARENT_1",
    broker: str = "DHAN_REST",
    symbol: str = "NIFTY24JANFUT",
    side: Side = Side.BUY,
    qty: float = 10.0,
    price: float = 22000.0,
    ts_ms: int = 1_700_000_000_000,
    mid0: float = 21999.5,
    latency_ms: float = 45.0,
) -> ChildFill:
    return ChildFill(
        fill_id=fill_id, parent_id=parent_id, broker=broker, symbol=symbol,
        side=side, qty=qty, price=price, ts_ms=ts_ms, mid0=mid0,
        venue_latency_ms=latency_ms, status=FillStatus.FILLED,
    )


def make_fixture_market_series(
    symbol: str = "NIFTY24JANFUT",
    start_ts: int = 1_700_000_000_000,
    n: int = 100,
    step_ms: int = 100,
    start_mid: float = 21999.5,
) -> List[Tuple[int, float]]:
    out = []
    mid = start_mid
    for i in range(n):
        mid += (i % 5 - 2) * 0.25
        out.append((start_ts + i * step_ms, float(mid)))
    return out


def make_fixture_broker_records(
    broker: str = "DHAN_REST",
    n: int = 20,
    base_ts: int = 1_700_000_000_000,
) -> List[BrokerFillRecord]:
    out = []
    for i in range(n):
        out.append(BrokerFillRecord(
            broker=broker, fill_id=f"BR_{i}", symbol="NIFTY24JANFUT",
            latency_ms=50.0 + i, slippage_bps=1.0 + i * 0.1,
            qty=10.0, ts_ms=base_ts + i * 1000,
            rejected=(i % 7 == 0), partial=(i % 9 == 0),
        ))
    return out


_ENGINE: Optional[TCAExecutionQualityEngine] = None
_ENGINE_LOCK = threading.Lock()


def get_engine(db_path_override: Optional[str] = None) -> TCAExecutionQualityEngine:
    global _ENGINE
    with _ENGINE_LOCK:
        if _ENGINE is None:
            _ENGINE = TCAExecutionQualityEngine(db_path_override)
        return _ENGINE


def reset_engine() -> None:
    global _ENGINE
    with _ENGINE_LOCK:
        _ENGINE = None


__all__ = [
    "SCHEMA_VERSION", "db_path", "configure_db", "migrate", "init_schema",
    "Side", "FillStatus", "BrokerVenue", "ParentOrder", "ChildFill", "MarketTick",
    "TCAMetrics", "AlmgrenChrissParams", "MarketImpactEstimate", "BrokerFillRecord",
    "LeakageEvent", "LeakageReport", "effective_spread", "effective_spread_bps",
    "realized_spread", "price_impact", "slippage_bps", "participation_rate",
    "trading_rate", "permanent_impact_bps", "temporary_impact_bps",
    "estimate_market_impact", "calibrate_almgren_chriss", "BrokerRoutingProfiler",
    "LeakageDetector", "ExecutionQualityScorer", "TCAStore",
    "TCAExecutionQualityEngine", "get_engine", "reset_engine",
    "make_fixture_parent", "make_fixture_fill", "make_fixture_market_series",
    "make_fixture_broker_records",
]
