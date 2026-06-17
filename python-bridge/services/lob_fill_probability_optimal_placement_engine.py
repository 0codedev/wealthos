r"""
Domain 192 (WP-CP): High-Frequency Limit Order Book Fill Probability & Optimal Placement Engine

Implements queue survival analysis, fill probability forecasting, and optimal depth quote placement:
- Cont-Kukanov-Stoikov (2014) & Maglaras-Yao-Zehavi (2015) queue priority depletion modeling:
    P(\text{Fill} \mid Q_{ahead}, q_{my}, \tau) = 1 - \exp\left(-\frac{\mu_{drain} \cdot \tau}{Q_{ahead} + q_{my}}\right)
- Adverse selection / Winner's curse trade-off curve across discrete price depths \delta \in \{1, 2, 3, \dots\} ticks
- Net expected edge optimization balancing fill probability, spread capture, and post-fill adverse impact
- Quantitative limit order routing directives:
    * Inside spread aggressive pegging for low-queue / low-toxicity regimes
    * Deep passive rebate posting for congested queues
    * Immediate taker spread crossing for high opportunity cost / fast alpha drift
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


class PlacementDirective(str, Enum):
    OPTIMAL_POSTING_INSIDE_SPREAD_PEG = "OPTIMAL_POSTING_INSIDE_SPREAD_PEG"
    OPTIMAL_POSTING_DEEP_PASSIVE_REBATE = "OPTIMAL_POSTING_DEEP_PASSIVE_REBATE"
    URGENT_CROSS_SPREAD_TAKER_AGGRESSION = "URGENT_CROSS_SPREAD_TAKER_AGGRESSION"
    CANCEL_REPLACE_QUEUE_PRIORITY_LOST = "CANCEL_REPLACE_QUEUE_PRIORITY_LOST"
    EQUILIBRIUM_PASSIVE_POSTING = "EQUILIBRIUM_PASSIVE_POSTING"


@dataclass
class LOBLevelInfo:
    price: float
    depth: float  # Total visible depth at level
    queue_ahead: float  # Quantity ahead of our order in queue
    ticks_from_mid: int  # 1 for BBO, 2 for second level, etc.
    historical_drain_rate: float  # Depletion rate in shares/sec (trades + cancels)


@dataclass
class PlacementEvaluation:
    ticks_from_mid: int
    quote_price: float
    queue_ahead: float
    fill_probability_horizon: float  # P(Fill within target horizon)
    gross_spread_bps: float
    expected_adverse_selection_bps: float
    net_expected_edge_bps: float  # P(Fill) * (Spread - AdverseSelection)
    is_optimal: bool


@dataclass
class PlacementReport:
    symbol: str
    side: str  # "BUY" or "SELL"
    mid_price: float
    spread_bps: float
    order_size: float
    evaluations: List[PlacementEvaluation]
    optimal_ticks_from_mid: int
    optimal_quote_price: float
    optimal_fill_prob: float
    net_max_edge_bps: float
    directive: PlacementDirective
    rationale: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class LOBFillProbabilityOptimalPlacementEngine:
    r"""
    Microstructure Queue Fill Probability & Optimal Placement Engine.
    Maximizes risk-adjusted limit order alpha by dynamically balancing
    fill probability against queue congestion and post-trade adverse selection.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        tick_size: float = 0.05,
        default_horizon_sec: float = 30.0,
        min_acceptable_fill_prob: float = 0.25,
    ):
        self.db_path = db_path
        self.tick_size = tick_size
        self.default_horizon = default_horizon_sec
        self.min_fill_prob = min_acceptable_fill_prob

        self._conn: Optional[sqlite3.Connection] = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for optimal order placement telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS placement_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                mid_price REAL NOT NULL,
                order_size REAL NOT NULL,
                optimal_ticks INTEGER NOT NULL,
                optimal_price REAL NOT NULL,
                optimal_fill_prob REAL NOT NULL,
                net_edge_bps REAL NOT NULL,
                directive TEXT NOT NULL,
                rationale TEXT NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def compute_fill_probability(
        queue_ahead: float,
        order_size: float,
        drain_rate_per_sec: float,
        horizon_sec: float,
    ) -> float:
        r"""
        Calculates cumulative fill probability via Cox/Poisson queue survival hazard:
        P(\text{Fill} \mid Q_{ahead}, q_{my}, \tau) = 1 - \exp\left(-\frac{\mu_{drain} \cdot \tau}{Q_{ahead} + 0.5 \cdot q_{my}}\right)
        """
        effective_queue = max(1.0, queue_ahead + 0.5 * order_size)
        drain_volume = max(0.0, drain_rate_per_sec * horizon_sec)

        hazard = drain_volume / effective_queue
        # Cumulative probability
        p_fill = 1.0 - math.exp(-hazard)
        return min(0.999, max(0.001, p_fill))

    def evaluate_depth_levels(
        self,
        symbol: str,
        side: str,
        mid_price: float,
        spread_bps: float,
        levels: List[LOBLevelInfo],
        order_size: float,
        alpha_drift_bps: float = 0.0,  # Expected price trend during horizon
        target_horizon_sec: Optional[float] = None,
    ) -> PlacementReport:
        r"""
        Evaluates queue fill probabilities and net expected alpha across discrete depth levels.
        Finds \delta^* = \arg\max_\delta P(Fill \mid \delta) \cdot \left(\text{Edge}(\delta) - \text{AdverseImpact}(\delta)\right).
        """
        now_ts = datetime.now(timezone.utc).isoformat()
        horizon = target_horizon_sec if target_horizon_sec is not None else self.default_horizon

        if not levels:
            return PlacementReport(
                symbol=symbol,
                side=side,
                mid_price=mid_price,
                spread_bps=spread_bps,
                order_size=order_size,
                evaluations=[],
                optimal_ticks_from_mid=1,
                optimal_quote_price=mid_price,
                optimal_fill_prob=0.0,
                net_max_edge_bps=0.0,
                directive=PlacementDirective.EQUILIBRIUM_PASSIVE_POSTING,
                rationale="No order book levels provided.",
                timestamp=now_ts,
            )

        evaluations: List[PlacementEvaluation] = []
        best_edge = -999.0
        best_level_idx = 0

        for idx, lvl in enumerate(levels):
            # Compute fill probability
            p_fill = self.compute_fill_probability(
                lvl.queue_ahead, order_size, lvl.historical_drain_rate, horizon
            )

            # Captured spread / edge in basis points
            dist_bps = (abs(lvl.price - mid_price) / max(1.0, mid_price)) * 10000.0
            gross_bps = 0.5 * spread_bps + dist_bps

            # Empirical adverse selection model:
            # Informed traders fill shallow orders when price is about to move against them.
            # Adverse selection decreases with depth: \text{Impact}(\delta) = \text{BaseImpact} / \sqrt{\delta}
            base_adverse_bps = 0.25 * spread_bps
            adverse_bps = base_adverse_bps / math.sqrt(max(1, lvl.ticks_from_mid))

            # Opportunity cost of non-fill if alpha drift is strong:
            # If price is drifting upward and we are buying, non-fill costs us alpha_drift_bps
            opp_cost_bps = abs(alpha_drift_bps) * (1.0 - p_fill)

            # Net expected edge: P(Fill) * (GrossSpread - AdverseImpact) - OppCost
            net_edge = p_fill * (gross_bps - adverse_bps) - opp_cost_bps

            if net_edge > best_edge:
                best_edge = net_edge
                best_level_idx = idx

            evaluations.append(
                PlacementEvaluation(
                    ticks_from_mid=lvl.ticks_from_mid,
                    quote_price=lvl.price,
                    queue_ahead=lvl.queue_ahead,
                    fill_probability_horizon=round(p_fill, 4),
                    gross_spread_bps=round(gross_bps, 2),
                    expected_adverse_selection_bps=round(adverse_bps, 2),
                    net_expected_edge_bps=round(net_edge, 2),
                    is_optimal=False,
                )
            )

        # Mark optimal
        evaluations[best_level_idx].is_optimal = True
        opt_eval = evaluations[best_level_idx]

        # Determine Placement Directive
        if alpha_drift_bps > 1.5 * spread_bps and opt_eval.fill_probability_horizon < self.min_fill_prob:
            directive = PlacementDirective.URGENT_CROSS_SPREAD_TAKER_AGGRESSION
            rationale = (
                f"Urgent directional alpha drift ({alpha_drift_bps:.1f} bps) exceeds spread ({spread_bps:.1f} bps). "
                f"Passive fill prob only {opt_eval.fill_probability_horizon*100:.1f}%. Cross spread immediately as taker."
            )
        elif opt_eval.ticks_from_mid == 1 and opt_eval.fill_probability_horizon >= 0.70:
            directive = PlacementDirective.OPTIMAL_POSTING_INSIDE_SPREAD_PEG
            rationale = (
                f"High queue depletion velocity at BBO (Fill Prob: {opt_eval.fill_probability_horizon*100:.1f}%). "
                f"Peg order at BBO ({opt_eval.quote_price:.2f}) for rapid fill."
            )
        elif opt_eval.ticks_from_mid >= 2:
            directive = PlacementDirective.OPTIMAL_POSTING_DEEP_PASSIVE_REBATE
            rationale = (
                f"Queue congestion at BBO. Optimal risk-adjusted edge achieved at depth "
                f"{opt_eval.ticks_from_mid} ticks ({opt_eval.quote_price:.2f}, Edge: {opt_eval.net_expected_edge_bps:.2f} bps)."
            )
        else:
            directive = PlacementDirective.EQUILIBRIUM_PASSIVE_POSTING
            rationale = (
                f"Equilibrium posting at level {opt_eval.ticks_from_mid} ticks. "
                f"Expected edge {opt_eval.net_expected_edge_bps:.2f} bps."
            )

        report = PlacementReport(
            symbol=symbol,
            side=side,
            mid_price=mid_price,
            spread_bps=spread_bps,
            order_size=order_size,
            evaluations=evaluations,
            optimal_ticks_from_mid=opt_eval.ticks_from_mid,
            optimal_quote_price=opt_eval.quote_price,
            optimal_fill_prob=opt_eval.fill_probability_horizon,
            net_max_edge_bps=opt_eval.net_expected_edge_bps,
            directive=directive,
            rationale=rationale,
            timestamp=now_ts,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: PlacementReport) -> None:
        """Persists placement evaluation to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO placement_telemetry (
                timestamp, symbol, side, mid_price, order_size, optimal_ticks,
                optimal_price, optimal_fill_prob, net_edge_bps, directive, rationale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.side,
                rep.mid_price,
                rep.order_size,
                rep.optimal_ticks_from_mid,
                rep.optimal_quote_price,
                rep.optimal_fill_prob,
                rep.net_max_edge_bps,
                rep.directive.value,
                rep.rationale,
            ),
        )
        conn.commit()

    def get_recent_placements(
        self, symbol: Optional[str] = None, limit: int = 10
    ) -> List[Dict]:
        """Retrieves recent placement evaluations from SQLite telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        if symbol:
            cursor.execute(
                """
                SELECT timestamp, symbol, side, mid_price, order_size, optimal_ticks,
                       optimal_price, optimal_fill_prob, net_edge_bps, directive, rationale
                FROM placement_telemetry
                WHERE symbol = ?
                ORDER BY id DESC LIMIT ?
                """,
                (symbol, limit),
            )
        else:
            cursor.execute(
                """
                SELECT timestamp, symbol, side, mid_price, order_size, optimal_ticks,
                       optimal_price, optimal_fill_prob, net_edge_bps, directive, rationale
                FROM placement_telemetry
                ORDER BY id DESC LIMIT ?
                """,
                (limit,),
            )
        rows = cursor.fetchall()
        results = []
        for r in rows:
            results.append(
                {
                    "timestamp": r[0],
                    "symbol": r[1],
                    "side": r[2],
                    "mid_price": r[3],
                    "order_size": r[4],
                    "optimal_ticks": r[5],
                    "optimal_price": r[6],
                    "optimal_fill_prob": r[7],
                    "net_edge_bps": r[8],
                    "directive": r[9],
                    "rationale": r[10],
                }
            )
        return results
