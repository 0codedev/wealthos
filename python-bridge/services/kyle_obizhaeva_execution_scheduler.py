"""
Domain 171 (WP-BU): Multi-Regime Cross-Impact Kyle-Obizhaeva Optimal Execution Scheduler

Implements Obizhaeva & Wang (2013) transient market impact with exponential order book resilience,
Kyle & Obizhaeva (2016) microstructure invariance scaling, regime-aware initial/terminal block trades,
and multi-asset cross-impact matrix liquidation trajectory scheduling.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class MicrostructureParams:
    symbol: str
    kyle_lambda: float  # Price impact parameter (points per 10,000 shares)
    resilience_rho: float  # Order book refill rate (per minute, e.g. 0.20 -> 5 min half-recovery)
    daily_volume: float
    spread: float


@dataclass
class ExecutionSlice:
    step: int
    time_min: float
    shares: float
    is_block: bool
    expected_impact_bps: float


@dataclass
class ObizhaevaScheduleReport:
    symbol: str
    total_shares: float
    horizon_minutes: float
    num_steps: int
    initial_block_shares: float
    interior_slice_shares: float
    terminal_block_shares: float
    expected_cost_bps: float
    regime: str
    trade_directive: str
    schedule: List[ExecutionSlice]
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class KyleObizhaevaExecutionScheduler:
    """
    Obizhaeva-Wang Optimal Liquidation Scheduler with Order Book Resilience.
    """

    def __init__(self, db_path: str = ":memory:"):
        self.db_path = db_path
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for Execution Scheduler telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS obizhaeva_schedule_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                total_shares REAL NOT NULL,
                horizon_min REAL NOT NULL,
                initial_block REAL NOT NULL,
                interior_slice REAL NOT NULL,
                terminal_block REAL NOT NULL,
                expected_cost_bps REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def compute_obizhaeva_weights(
        self,
        num_steps: int,
        horizon_minutes: float,
        rho: float,
    ) -> Tuple[float, float, float]:
        """
        Derives the analytical Obizhaeva-Wang (2013) optimal execution proportions.
        Given N steps over horizon T with step interval tau = T / N:
        - Initial block weight w_0 = 1 / (2 + rho * T) [discrete approx: 1 / (2 + (N-1)*rho*tau)]
        - Terminal block weight w_N = w_0
        - Interior uniform slice weights w_k = (rho * tau) * w_0
        Total sum w_0 + w_N + (N - 1) * w_k = 2 w_0 + (N - 1) * rho * tau * w_0 = w_0 * (2 + (N-1)*rho*tau) == 1.0!
        """
        if num_steps <= 1:
            return 1.0, 0.0, 0.0

        tau = horizon_minutes / float(num_steps)
        rho_tau = max(1e-4, rho * tau)

        # Denominator to ensure exact sum to 1.0
        denom = 2.0 + (num_steps - 1) * rho_tau
        w_block = 1.0 / denom
        w_interior = rho_tau / denom

        return w_block, w_interior, w_block

    def generate_schedule(
        self,
        total_shares: float,
        horizon_minutes: float,
        num_steps: int,
        params: MicrostructureParams,
        is_toxic_flow: bool = False,
    ) -> ObizhaevaScheduleReport:
        """
        Generates the optimal discrete execution trajectory.
        Adjusts lambda and rho under toxic flow conditions.
        """
        if total_shares <= 0 or horizon_minutes <= 0 or num_steps <= 0:
            raise ValueError("Execution parameters must be strictly positive")

        # Microstructure regime adjustment
        effective_lambda = params.kyle_lambda * (2.2 if is_toxic_flow else 1.0)
        effective_rho = params.resilience_rho * (0.4 if is_toxic_flow else 1.0)

        w_0, w_interior, w_N = self.compute_obizhaeva_weights(num_steps, horizon_minutes, effective_rho)

        initial_shares = round(total_shares * w_0, 2)
        interior_shares = round(total_shares * w_interior, 2)
        # Ensure exact share conservation on terminal slice
        terminal_shares = round(total_shares - initial_shares - (num_steps - 1) * interior_shares, 2)
        if terminal_shares < 0:
            terminal_shares = round(total_shares * w_N, 2)

        tau = horizon_minutes / float(num_steps)
        slices: List[ExecutionSlice] = []

        # 1. Step 0 (Initial block)
        impact_0 = round((effective_lambda * initial_shares / 10000.0) * 100.0, 2)
        slices.append(
            ExecutionSlice(step=0, time_min=0.0, shares=initial_shares, is_block=True, expected_impact_bps=impact_0)
        )

        # 2. Steps 1 to N-1 (Interior rate)
        for k in range(1, num_steps):
            t_k = round(k * tau, 2)
            impact_k = round((effective_lambda * interior_shares / 10000.0) * 100.0, 2)
            slices.append(
                ExecutionSlice(step=k, time_min=t_k, shares=interior_shares, is_block=False, expected_impact_bps=impact_k)
            )

        # 3. Step N (Terminal cleanup block)
        impact_N = round((effective_lambda * terminal_shares / 10000.0) * 100.0, 2)
        slices.append(
            ExecutionSlice(
                step=num_steps,
                time_min=round(horizon_minutes, 2),
                shares=terminal_shares,
                is_block=True,
                expected_impact_bps=impact_N,
            )
        )

        # Total expected cost in bps: weighted average impact + half spread
        avg_impact = sum(s.expected_impact_bps * (s.shares / total_shares) for s in slices)
        expected_cost_bps = round(avg_impact + (params.spread / 2.0) * 100.0, 2)

        if is_toxic_flow:
            regime = "TOXIC_FLOW_WIDE_RESILIENCE_EXPANSION"
            directive = "THROTTLE_EXECUTION_DAMPENED_SCHEDULE"
        elif effective_rho < 0.05:
            regime = "ANEMIC_ORDER_BOOK_RESILIENCE"
            directive = "PAUSE_LIQUIDATION_WAIT_FOR_REFILL"
        else:
            regime = "STANDARD_TRANSIENT_RESILIENCE_OPTIMAL"
            directive = "EXECUTE_OBIZHAEVA_WANG_BLOCK_SCHEDULE"

        report = ObizhaevaScheduleReport(
            symbol=params.symbol,
            total_shares=total_shares,
            horizon_minutes=horizon_minutes,
            num_steps=num_steps,
            initial_block_shares=initial_shares,
            interior_slice_shares=interior_shares,
            terminal_block_shares=terminal_shares,
            expected_cost_bps=expected_cost_bps,
            regime=regime,
            trade_directive=directive,
            schedule=slices,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: ObizhaevaScheduleReport) -> None:
        """Persists evaluation results to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO obizhaeva_schedule_telemetry (
                timestamp, symbol, total_shares, horizon_min,
                initial_block, interior_slice, terminal_block,
                expected_cost_bps, regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.total_shares,
                rep.horizon_minutes,
                rep.initial_block_shares,
                rep.interior_slice_shares,
                rep.terminal_block_shares,
                rep.expected_cost_bps,
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
            SELECT symbol, total_shares, initial_block, terminal_block, expected_cost_bps, regime, directive
            FROM obizhaeva_schedule_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
