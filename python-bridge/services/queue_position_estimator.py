r"""
High-Frequency Adaptive Limit Order Placement & Queue Position Estimator (Domain 123 / WP-Y)
============================================================================================

Autonomous high-frequency order placement and queue position estimation engine
modeling FIFO price-time priority, Poisson cancellation intensity, and adverse
selection spread-crossing thresholds on NSE and BSE Limit Order Books.

Mathematical Specifications:
-----------------------------
1. FIFO Queue Depletion Dynamics:
   When an order of size Q_self is placed at level p with prior depth Q_ahead:
   The volume ahead evolves via incoming trade arrivals \mu and proportional cancellations \lambda:
       \frac{d Q_{ahead}}{dt} = - \mu_{trade} - \lambda_{cancel} Q_{ahead}
   Integrated expected remaining depth ahead at time t:
       Q_{ahead}(t) = \left( Q_{ahead}(0) + \frac{\mu}{\lambda} \right) e^{-\lambda t} - \frac{\mu}{\lambda}
   Expected Time to Priority (Q_{ahead} -> 0):
       T_{priority} = \frac{1}{\lambda_{cancel}} \ln\left( 1 + \frac{\lambda_{cancel} \cdot Q_{ahead}(0)}{\mu_{trade}} \right)

2. Fill Probability over Horizon H:
       P(\text{Fill} \le H) = 1 - \exp\left( - \frac{\mu_{trade} \cdot H + \lambda_{cancel} Q_{ahead}(0) \cdot H}{Q_{ahead}(0) + Q_{self}} \right)
   Bounded strictly in [0.0, 1.0].

3. Adverse Selection & Spread-Crossing Decision:
   Trading off passive maker rebate/half-spread capture vs toxic adverse selection:
       \text{ExpectedMakerEdge} = P(\text{Fill}) \cdot \left( \frac{\text{Spread}}{2} - \text{AdverseSelection} \right)
       \text{TakerCost} = \frac{\text{Spread}}{2} + \text{ImpactCost}
   If \text{AdverseSelection} > \frac{\text{Spread}}{2} \cdot \theta_{veto}:
       Recommendation -> 'CROSS_SPREAD_AGGRESSIVE'
   Else:
       Recommendation -> 'JOIN_QUEUE_PASSIVE' or 'POST_INSIDE_SPREAD'
"""

from dataclasses import dataclass, field
from datetime import datetime
import math
from typing import Dict, List, Optional, Tuple
import sqlite3


@dataclass
class QueueState:
    order_id: str
    symbol: str
    side: str  # 'BUY' or 'SELL'
    price: float
    order_qty: int
    initial_queue_ahead: int
    current_queue_ahead: int
    placed_at: datetime
    last_updated: datetime
    is_at_head_of_queue: bool


@dataclass
class OrderPlacementRecommendation:
    timestamp: datetime
    symbol: str
    side: str
    recommended_action: str  # 'JOIN_QUEUE_PASSIVE', 'POST_INSIDE_SPREAD', 'CROSS_SPREAD_AGGRESSIVE'
    target_price: float
    expected_fill_prob: float
    expected_time_to_fill_sec: float
    adverse_selection_cost_bps: float
    queue_ahead_est: int
    rationale: str


class QueuePositionEstimator:
    """
    Sub-millisecond LOB queue position tracker and adaptive placement engine.
    """

    def __init__(
        self,
        default_cancel_rate: float = 0.25,  # 25% of queue cancelled per second
        adverse_selection_veto_ratio: float = 0.60,
        db_path: str = ":memory:",
    ):
        self.default_cancel_rate = default_cancel_rate
        self.adverse_selection_veto_ratio = adverse_selection_veto_ratio
        self.db_path = db_path

        self._conn: Optional[sqlite3.Connection] = None
        self._tracked_queues: Dict[str, QueueState] = {}
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            if self._conn is None:
                self._conn = sqlite3.connect(":memory:")
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS queue_estimator_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                action TEXT NOT NULL,
                target_price REAL NOT NULL,
                fill_prob REAL NOT NULL,
                expected_sec REAL NOT NULL,
                adverse_selection_bps REAL NOT NULL,
                queue_ahead INTEGER NOT NULL
            )
            """
        )
        conn.commit()

    def register_limit_order(
        self,
        order_id: str,
        symbol: str,
        side: str,
        price: float,
        order_qty: int,
        queue_ahead_at_entry: int,
        timestamp: datetime,
    ) -> QueueState:
        """
        Registers an active limit order and snapshots the initial queue depth ahead.
        """
        state = QueueState(
            order_id=order_id,
            symbol=symbol,
            side=side,
            price=price,
            order_qty=order_qty,
            initial_queue_ahead=max(queue_ahead_at_entry, 0),
            current_queue_ahead=max(queue_ahead_at_entry, 0),
            placed_at=timestamp,
            last_updated=timestamp,
            is_at_head_of_queue=(queue_ahead_at_entry <= 0),
        )
        self._tracked_queues[order_id] = state
        return state

    def update_queue_depletion(
        self,
        order_id: str,
        traded_volume_at_price: int,
        total_level_volume_change: int,
        current_time: datetime,
    ) -> Optional[QueueState]:
        """
        Updates queue position based on observed trades and book depth changes.
        """
        state = self._tracked_queues.get(order_id)
        if not state:
            return None

        # Traded volume strictly depletes queue ahead
        new_ahead = state.current_queue_ahead - max(traded_volume_at_price, 0)

        # Level volume change includes cancellations + trades
        # If total depth dropped more than traded volume, the rest was cancellations ahead
        total_drop = max(0, -total_level_volume_change)
        cancellations = max(0, total_drop - traded_volume_at_price)
        # Proportionate cancellation allocation
        if state.initial_queue_ahead > 0:
            prop_cancel = int(cancellations * (state.current_queue_ahead / float(state.initial_queue_ahead + state.order_qty)))
            new_ahead -= prop_cancel

        new_ahead = max(0, new_ahead)
        state.current_queue_ahead = new_ahead
        state.last_updated = current_time
        state.is_at_head_of_queue = (new_ahead == 0)
        return state

    def calculate_expected_time_to_fill(
        self,
        queue_ahead: int,
        trade_intensity_per_sec: float,
        cancel_rate: Optional[float] = None,
    ) -> float:
        """
        Calculates theoretical time to reach queue priority (T_priority).
        """
        if queue_ahead <= 0:
            return 0.0

        mu = max(trade_intensity_per_sec, 1e-4)
        lam = cancel_rate if cancel_rate is not None else self.default_cancel_rate

        if lam < 1e-6:
            return float(queue_ahead) / mu

        # T = (1 / \lambda) * ln(1 + (\lambda * Q_ahead) / \mu)
        t_fill = (1.0 / lam) * math.log(1.0 + (lam * float(queue_ahead)) / mu)
        return max(t_fill, 0.0)

    def calculate_fill_probability(
        self,
        queue_ahead: int,
        order_qty: int,
        trade_intensity_per_sec: float,
        horizon_sec: float,
        cancel_rate: Optional[float] = None,
    ) -> float:
        """
        Computes fill probability P(Fill <= H) in [0.0, 1.0].
        """
        if queue_ahead <= 0:
            return 1.0
        if horizon_sec <= 0:
            return 0.0

        mu = max(trade_intensity_per_sec, 1e-4)
        lam = cancel_rate if cancel_rate is not None else self.default_cancel_rate

        total_queue = max(float(queue_ahead + order_qty), 1.0)
        numerator = (mu * horizon_sec) + (lam * float(queue_ahead) * horizon_sec)
        arg = - (numerator / total_queue)
        prob = 1.0 - math.exp(max(arg, -50.0))
        return min(max(prob, 0.0), 1.0)

    def evaluate_placement_strategy(
        self,
        symbol: str,
        side: str,
        best_bid: float,
        best_ask: float,
        bid_depth_ahead: int,
        ask_depth_ahead: int,
        trade_intensity_per_sec: float,
        vpin_metric: float,  # Order flow toxicity measure in [0.0, 1.0]
        timestamp: datetime,
        order_qty: int = 100,
        horizon_sec: float = 5.0,
    ) -> OrderPlacementRecommendation:
        """
        Determines whether to place passively in queue, post inside spread, or cross aggressively.
        """
        spread = max(best_ask - best_bid, 0.05)
        spread_bps = (spread / best_bid) * 10000.0

        queue_ahead = bid_depth_ahead if side == 'BUY' else ask_depth_ahead

        fill_prob = self.calculate_fill_probability(
            queue_ahead=queue_ahead,
            order_qty=order_qty,
            trade_intensity_per_sec=trade_intensity_per_sec,
            horizon_sec=horizon_sec,
        )

        expected_time_sec = self.calculate_expected_time_to_fill(
            queue_ahead=queue_ahead,
            trade_intensity_per_sec=trade_intensity_per_sec,
        )

        # Adverse selection cost scales with VPIN toxicity and spread
        adverse_selection_bps = vpin_metric * (spread_bps * 0.5)

        # Spread crossing decision logic
        half_spread_bps = spread_bps * 0.5
        if adverse_selection_bps > (half_spread_bps * self.adverse_selection_veto_ratio) and vpin_metric > 0.40:
            action = 'CROSS_SPREAD_AGGRESSIVE'
            target_price = best_ask if side == 'BUY' else best_bid
            rationale = f"High toxic flow (VPIN={vpin_metric:.2f}); queueing poses adverse selection risk. Cross spread."
            fill_prob = 1.0
            expected_time_sec = 0.001
        elif spread > 0.10:  # Wide spread -> opportunity to price improve
            action = 'POST_INSIDE_SPREAD'
            tick_size = 0.05
            target_price = (best_bid + tick_size) if side == 'BUY' else (best_ask - tick_size)
            rationale = f"Wide spread ({spread:.2f}); post inside spread to gain queue priority."
            fill_prob = min(fill_prob * 1.5, 0.95)
            expected_time_sec *= 0.5
        else:
            action = 'JOIN_QUEUE_PASSIVE'
            target_price = best_bid if side == 'BUY' else best_ask
            rationale = f"Benign flow (VPIN={vpin_metric:.2f}); join queue passively to earn maker spread."

        rec = OrderPlacementRecommendation(
            timestamp=timestamp,
            symbol=symbol,
            side=side,
            recommended_action=action,
            target_price=round(target_price, 2),
            expected_fill_prob=round(fill_prob, 4),
            expected_time_to_fill_sec=round(expected_time_sec, 3),
            adverse_selection_cost_bps=round(adverse_selection_bps, 2),
            queue_ahead_est=queue_ahead,
            rationale=rationale,
        )

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO queue_estimator_logs (
                timestamp, symbol, side, action, target_price, fill_prob,
                expected_sec, adverse_selection_bps, queue_ahead
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                timestamp.isoformat(),
                symbol,
                side,
                action,
                rec.target_price,
                rec.expected_fill_prob,
                rec.expected_time_to_fill_sec,
                rec.adverse_selection_cost_bps,
                queue_ahead,
            )
        )
        conn.commit()

        return rec
