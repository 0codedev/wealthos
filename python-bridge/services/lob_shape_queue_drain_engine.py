"""
Domain 175 (WP-BY): High-Frequency Limit Order Book Shape & Queue Drain Alpha Engine

Implements multi-level limit order book (LOB) shape profiling, level-1 queue depletion velocity,
cancellation vs execution flow attribution, price tick-jump probability estimation,
and ultra-low-latency queue priority execution directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class LOBLevel:
    price: float
    quantity: float
    order_count: int


@dataclass
class LOBTopBookSnapshot:
    timestamp: float  # Epoch timestamp in seconds (with millisecond precision)
    bids: List[LOBLevel]  # Level 1 to K (descending price)
    asks: List[LOBLevel]  # Level 1 to K (ascending price)


@dataclass
class QueueDrainReport:
    symbol: str
    mid_price: float
    bid_qty_l1: float
    ask_qty_l1: float
    bid_drain_velocity: float  # Shares per second (negative indicates queue depletion)
    ask_drain_velocity: float  # Shares per second (negative indicates queue depletion)
    drain_imbalance: float  # Skew of depletion [-1.0, 1.0]
    prob_uptick: float  # Probability of next tick jump being upwards [0.0, 1.0]
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class LOBShapeQueueDrainEngine:
    """
    High-Frequency LOB Shape & Queue Depletion Alpha Engine.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        tick_size: float = 0.05,
        theta_drain: float = 2.0,
        theta_imbalance: float = 1.5,
    ):
        self.db_path = db_path
        self.tick_size = tick_size
        self.theta_drain = theta_drain
        self.theta_imbalance = theta_imbalance
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for LOB Shape telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS lob_shape_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                mid_price REAL NOT NULL,
                bid_qty_l1 REAL NOT NULL,
                ask_qty_l1 REAL NOT NULL,
                bid_drain_vel REAL NOT NULL,
                ask_drain_vel REAL NOT NULL,
                drain_imbalance REAL NOT NULL,
                prob_uptick REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def calculate_queue_drain_velocities(
        self,
        snap_prior: LOBTopBookSnapshot,
        snap_current: LOBTopBookSnapshot,
    ) -> Tuple[float, float]:
        """
        Calculates queue rate-of-change (velocity) at Level 1:
        v = (Q_t - Q_{t-1}) / Delta_t (shares per second).
        A negative value indicates the queue is being depleted.
        """
        dt = max(1e-4, snap_current.timestamp - snap_prior.timestamp)

        bid_q_prior = snap_prior.bids[0].quantity if snap_prior.bids else 0.0
        bid_q_curr = snap_current.bids[0].quantity if snap_current.bids else 0.0

        ask_q_prior = snap_prior.asks[0].quantity if snap_prior.asks else 0.0
        ask_q_curr = snap_current.asks[0].quantity if snap_current.asks else 0.0

        # If the price level changed (tick jump already occurred), treat prior as drained
        if snap_current.bids and snap_prior.bids and snap_current.bids[0].price != snap_prior.bids[0].price:
            v_bid = -bid_q_prior / dt
        else:
            v_bid = (bid_q_curr - bid_q_prior) / dt

        if snap_current.asks and snap_prior.asks and snap_current.asks[0].price != snap_prior.asks[0].price:
            v_ask = -ask_q_prior / dt
        else:
            v_ask = (ask_q_curr - ask_q_prior) / dt

        return round(v_bid, 2), round(v_ask, 2)

    def calculate_drain_imbalance_and_jump_prob(
        self,
        v_bid: float,
        v_ask: float,
        q_bid: float,
        q_ask: float,
    ) -> Tuple[float, float]:
        """
        Calculates normalized drain imbalance:
        I_drain = (drain_ask - drain_bid) / (drain_ask + drain_bid + eps)
        where drain_ask = max(0, -v_ask) and drain_bid = max(0, -v_bid).

        Logistic probability of next tick jump being upwards:
        P(UpTick) = 1 / (1 + exp(-theta1 * I_drain - theta2 * Static_Imbalance))
        """
        drain_bid = max(0.0, -v_bid)
        drain_ask = max(0.0, -v_ask)

        total_drain = drain_bid + drain_ask
        if total_drain > 0:
            drain_imbalance = (drain_ask - drain_bid) / total_drain
        else:
            drain_imbalance = 0.0

        # Static order book imbalance at level 1
        total_q = q_bid + q_ask
        static_imbalance = (q_bid - q_ask) / total_q if total_q > 0 else 0.0

        # Logistic argument
        logit = self.theta_drain * drain_imbalance + self.theta_imbalance * static_imbalance
        prob_uptick = 1.0 / (1.0 + math.exp(-max(-15.0, min(15.0, logit))))

        return round(drain_imbalance, 4), round(prob_uptick, 4)

    def analyze_lob(
        self,
        symbol: str,
        snap_prior: LOBTopBookSnapshot,
        snap_current: LOBTopBookSnapshot,
    ) -> QueueDrainReport:
        """
        Runs comprehensive LOB Shape & Queue Depletion analysis.
        Directives:
        - EXECUTE_IMMEDIATE_TAKER_BUY (P(UpTick) >= 0.75, ask queue evaporating)
        - EXECUTE_IMMEDIATE_TAKER_SELL (P(UpTick) <= 0.25, bid queue evaporating)
        - QUEUE_DRAIN_EQUILIBRIUM_PASSIVE_QUOTE (Balanced flow)
        - SPOOFING_CANCELLATION_SENTRY_PULL_QUOTES (Extreme one-sided velocity without volume)
        """
        if not snap_current.bids or not snap_current.asks:
            raise ValueError("LOB snapshot must contain at least Level-1 bids and asks")

        best_bid = snap_current.bids[0].price
        best_ask = snap_current.asks[0].price
        mid_price = round((best_bid + best_ask) / 2.0, 4)

        q_bid = snap_current.bids[0].quantity
        q_ask = snap_current.asks[0].quantity

        v_bid, v_ask = self.calculate_queue_drain_velocities(snap_prior, snap_current)
        drain_imb, p_uptick = self.calculate_drain_imbalance_and_jump_prob(v_bid, v_ask, q_bid, q_ask)

        # Classify regime & directive
        if p_uptick >= 0.75:
            regime = "ASK_QUEUE_RAPID_DEPLETION_IMMINENT_UPTICK"
            directive = "EXECUTE_IMMEDIATE_TAKER_BUY"
        elif p_uptick <= 0.25:
            regime = "BID_QUEUE_RAPID_DEPLETION_IMMINENT_DOWNTICK"
            directive = "EXECUTE_IMMEDIATE_TAKER_SELL"
        elif abs(drain_imb) <= 0.20:
            regime = "BALANCED_TWO_SIDED_QUEUE_MAKING"
            directive = "PASSIVE_MARKET_MAKING_JOIN"
        else:
            regime = "MODERATE_QUEUE_ASYMMETRY"
            directive = "TRAIL_LIMIT_ORDER_PRIORITY"

        report = QueueDrainReport(
            symbol=symbol,
            mid_price=mid_price,
            bid_qty_l1=q_bid,
            ask_qty_l1=q_ask,
            bid_drain_velocity=v_bid,
            ask_drain_velocity=v_ask,
            drain_imbalance=drain_imb,
            prob_uptick=p_uptick,
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: QueueDrainReport) -> None:
        """Persists evaluation results to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO lob_shape_telemetry (
                timestamp, symbol, mid_price, bid_qty_l1, ask_qty_l1,
                bid_drain_vel, ask_drain_vel, drain_imbalance, prob_uptick,
                regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.mid_price,
                rep.bid_qty_l1,
                rep.ask_qty_l1,
                rep.bid_drain_velocity,
                rep.ask_drain_velocity,
                rep.drain_imbalance,
                rep.prob_uptick,
                rep.regime,
                rep.trade_directive,
            ),
        )
        conn.commit()

    def get_latest_telemetry(self, limit: int = 10) -> List[Tuple]:
        """Retrieves latest persisted telemetry rows."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT symbol, mid_price, bid_drain_vel, ask_drain_vel, prob_uptick, regime, directive
            FROM lob_shape_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
