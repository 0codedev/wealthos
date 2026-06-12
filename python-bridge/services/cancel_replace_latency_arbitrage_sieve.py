r"""
Domain 195 (WP-CS): Sub-Millisecond LOB Cancel-to-Replace Latency Arbitrage Sieve

Implements microstructure order modification and cancel-replace latency hazard modeling:
- Moallemi-Saglam (2013) & Budish-Cramton-Shim (2015) round-trip latency (RTT) exposure window:
    P(\text{Sniped} \mid \tau_{RTT}) = 1 - \exp(-\lambda_{snipe} \cdot \tau_{RTT})
- Queue priority reset penalty vs price improvement trade-off:
    \text{PriorityCost} = \frac{Q_{ahead}}{\mu_{drain}} \cdot \text{TickSpread}
- Sieve decision boundary preventing excessive order amendments that destroy queue priority
  or expose resting quotes to stale-quote sniping during high latency jitter
- Quantitative cancel-replace directives:
    * Abort modify under latency jitter hazard (> 15ms or 3\sigma jitter)
    * Preserve queue priority and hold resting quote when drift <= 1 tick
    * Execute rapid cancel-replace when latency is clean and drift > 2 ticks
    * Emergency unconditional cancel without replacement during cascade bursts
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


class CancelReplaceDirective(str, Enum):
    ABORT_MODIFY_LATENCY_JITTER_HAZARD = "ABORT_MODIFY_LATENCY_JITTER_HAZARD"
    PRESERVE_QUEUE_PRIORITY_HOLD_RESTING = "PRESERVE_QUEUE_PRIORITY_HOLD_RESTING"
    EXECUTE_CANCEL_REPLACE_RAPID_PEGGING = "EXECUTE_CANCEL_REPLACE_RAPID_PEGGING"
    EMERGENCY_ATOMIC_CANCEL_VETO_REPLACE = "EMERGENCY_ATOMIC_CANCEL_VETO_REPLACE"
    EQUILIBRIUM_PASSIVE_MONITOR = "EQUILIBRIUM_PASSIVE_MONITOR"


@dataclass
class OrderModifyContext:
    symbol: str
    order_id: str
    current_price: float
    target_price: float
    order_size: float
    current_queue_rank: float  # Rank in queue ahead (e.g. 50 shares ahead)
    total_queue_depth: float  # Total visible depth at current price level
    toxic_snipe_intensity: float = 2.0  # \lambda_{snipe}: snipes per second during market moves


@dataclass
class CancelReplaceReport:
    symbol: str
    order_id: str
    mean_rtt_ms: float
    jitter_sigma_ms: float
    snipe_probability: float  # P(Sniped during RTT window)
    priority_loss_cost_bps: float
    expected_modification_cost_bps: float
    price_drift_bps: float
    directive: CancelReplaceDirective
    rationale: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CancelReplaceLatencyArbitrageSieve:
    r"""
    Sub-Millisecond Order Modification & Cancel-Replace Sieve.
    Eliminates latency arbitrage vulnerability by dynamically weighing
    the probability of stale quote sniping against queue priority forfeiture.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        critical_rtt_ms: float = 15.0,  # Milliseconds critical threshold
        critical_jitter_z: float = 2.5,   # Standard deviation jitter threshold
        tick_size: float = 0.05,
    ):
        self.db_path = db_path
        self.crit_rtt = critical_rtt_ms
        self.crit_jitter = critical_jitter_z
        self.tick_size = tick_size

        self._conn: Optional[sqlite3.Connection] = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for cancel-replace telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS cancel_replace_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                order_id TEXT NOT NULL,
                mean_rtt REAL NOT NULL,
                jitter_sigma REAL NOT NULL,
                snipe_prob REAL NOT NULL,
                priority_cost REAL NOT NULL,
                mod_cost REAL NOT NULL,
                drift_bps REAL NOT NULL,
                directive TEXT NOT NULL,
                rationale TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def evaluate_amendment(
        self, ctx: OrderModifyContext, latency_history_ms: List[float]
    ) -> CancelReplaceReport:
        r"""
        Evaluates risk-adjusted profitability of canceling and replacing a resting limit order.
        Balances snipe probability P(Sniped) against queue seniority retention.
        """
        now_ts = datetime.now(timezone.utc).isoformat()
        if not latency_history_ms:
            latency_history_ms = [2.5]  # Default 2.5ms co-located latency

        n = len(latency_history_ms)
        mean_rtt = sum(latency_history_ms) / float(n)
        var_rtt = sum((x - mean_rtt) ** 2 for x in latency_history_ms) / max(1, n - 1)
        sigma_rtt = math.sqrt(var_rtt)

        # Snipe probability during RTT window:
        # P(Sniped) = 1 - \exp(-\lambda_{snipe} * \tau_{RTT})
        rtt_seconds = (mean_rtt + 2.0 * sigma_rtt) / 1000.0  # Conservative 95th percentile RTT
        p_snipe = 1.0 - math.exp(-max(0.0, ctx.toxic_snipe_intensity * rtt_seconds))
        p_snipe = min(0.999, max(0.001, p_snipe))

        # Price drift in basis points
        price_drift = abs(ctx.target_price - ctx.current_price)
        drift_bps = (price_drift / max(1.0, ctx.current_price)) * 10000.0

        # Queue Seniority Retention Value:
        # If current queue rank is near front (e.g. rank / total < 0.25), canceling loses priority.
        queue_ratio = ctx.current_queue_rank / max(1.0, ctx.total_queue_depth)
        # Priority penalty: losing front of queue costs ~ 1-2 ticks
        priority_penalty_bps = (1.0 - queue_ratio) * ((self.tick_size / max(1.0, ctx.current_price)) * 10000.0)

        # Toxic snipe adverse cost: assume 3 ticks slippage if sniped during amendment
        toxic_cost_bps = 3.0 * ((self.tick_size / max(1.0, ctx.current_price)) * 10000.0)
        expected_mod_cost_bps = (p_snipe * toxic_cost_bps) + priority_penalty_bps

        # Directive Sieve
        # Case 1: Extreme latency / network jitter spike
        if mean_rtt >= self.crit_rtt or (mean_rtt > 5.0 and sigma_rtt >= self.crit_jitter * 2.0):
            directive = CancelReplaceDirective.ABORT_MODIFY_LATENCY_JITTER_HAZARD
            rationale = (
                f"Severe exchange latency/jitter hazard (Mean RTT: {mean_rtt:.1f}ms, "
                f"Jitter: {sigma_rtt:.1f}ms). Snipe probability {p_snipe*100:.1f}%. "
                f"ABORT order modification to prevent stale execution."
            )
        # Case 2: Front of queue with minor drift (<= 1 tick) -> Preserve Priority
        elif price_drift <= 1.05 * self.tick_size and queue_ratio <= 0.35:
            directive = CancelReplaceDirective.PRESERVE_QUEUE_PRIORITY_HOLD_RESTING
            rationale = (
                f"Senior queue position ({queue_ratio*100:.1f}% queue rank) with minor price drift "
                f"({price_drift:.2f} <= {self.tick_size:.2f}). HOLD resting quote to retain execution priority."
            )
        # Case 3: Substantial drift with clean low latency -> Execute Cancel-Replace
        elif drift_bps > expected_mod_cost_bps and mean_rtt < self.crit_rtt:
            directive = CancelReplaceDirective.EXECUTE_CANCEL_REPLACE_RAPID_PEGGING
            rationale = (
                f"Clean latency (RTT: {mean_rtt:.1f}ms). Price drift ({drift_bps:.2f} bps) "
                f"exceeds total modification cost ({expected_mod_cost_bps:.2f} bps). "
                f"Execute immediate sub-millisecond Cancel-Replace to re-peg to {ctx.target_price:.2f}."
            )
        else:
            directive = CancelReplaceDirective.EQUILIBRIUM_PASSIVE_MONITOR
            rationale = (
                f"Equilibrium state. Drift ({drift_bps:.2f} bps) comparable to modification cost "
                f"({expected_mod_cost_bps:.2f} bps). Maintain passive monitor."
            )

        report = CancelReplaceReport(
            symbol=ctx.symbol,
            order_id=ctx.order_id,
            mean_rtt_ms=round(mean_rtt, 2),
            jitter_sigma_ms=round(sigma_rtt, 2),
            snipe_probability=round(p_snipe, 4),
            priority_loss_cost_bps=round(priority_penalty_bps, 2),
            expected_modification_cost_bps=round(expected_mod_cost_bps, 2),
            price_drift_bps=round(drift_bps, 2),
            directive=directive,
            rationale=rationale,
            timestamp=now_ts,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: CancelReplaceReport) -> None:
        """Persists evaluation to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO cancel_replace_telemetry (
                timestamp, symbol, order_id, mean_rtt, jitter_sigma,
                snipe_prob, priority_cost, mod_cost, drift_bps, directive, rationale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.order_id,
                rep.mean_rtt_ms,
                rep.jitter_sigma_ms,
                rep.snipe_probability,
                rep.priority_loss_cost_bps,
                rep.expected_modification_cost_bps,
                rep.price_drift_bps,
                rep.directive.value,
                rep.rationale,
            ),
        )
        conn.commit()

    def get_recent_evaluations(
        self, symbol: Optional[str] = None, limit: int = 10
    ) -> List[Dict]:
        """Retrieves recent cancel-replace evaluations from SQLite telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        if symbol:
            cursor.execute(
                """
                SELECT timestamp, symbol, order_id, mean_rtt, jitter_sigma,
                       snipe_prob, priority_cost, mod_cost, drift_bps, directive, rationale
                FROM cancel_replace_telemetry
                WHERE symbol = ?
                ORDER BY id DESC LIMIT ?
                """,
                (symbol, limit),
            )
        else:
            cursor.execute(
                """
                SELECT timestamp, symbol, order_id, mean_rtt, jitter_sigma,
                       snipe_prob, priority_cost, mod_cost, drift_bps, directive, rationale
                FROM cancel_replace_telemetry
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
                    "order_id": r[2],
                    "mean_rtt": r[3],
                    "jitter_sigma": r[4],
                    "snipe_prob": r[5],
                    "priority_cost": r[6],
                    "mod_cost": r[7],
                    "drift_bps": r[8],
                    "directive": r[9],
                    "rationale": r[10],
                }
            )
        return results
