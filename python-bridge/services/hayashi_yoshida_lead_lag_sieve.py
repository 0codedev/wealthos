"""
Domain 181 (WP-CE): Multi-Factor Lead-Lag Cross-Correlation & Information Spillover Sieve

Implements high-frequency Hayashi-Yoshida (2005) non-synchronous realized covariance
and cross-correlation estimation, Epps effect mitigation, rolling lead-lag delay surface \tau^*,
and cross-asset predictive information spillover execution directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


class LeadLagDirective(str, Enum):
    LEAD_LAG_ARBITRAGE_FOLLOW_LEADER = "LEAD_LAG_ARBITRAGE_FOLLOW_LEADER"
    SYNCHRONOUS_CO_MOVEMENT_PAIR = "SYNCHRONOUS_CO_MOVEMENT_PAIR"
    DECOUPLED_INDEPENDENT_FLOW = "DECOUPLED_INDEPENDENT_FLOW"
    INVERTED_NEGATIVE_SPILLOVER = "INVERTED_NEGATIVE_SPILLOVER"


@dataclass
class TickPrint:
    timestamp_sec: float  # Monotonic or epoch timestamp in seconds
    price: float


@dataclass
class LeadLagReport:
    leader_symbol: str
    follower_symbol: str
    optimal_lag_sec: float  # \tau^* where peak correlation occurs (positive if X leads Y)
    peak_correlation: float  # \rho_{HY}(\tau^*)
    synchronous_correlation: float  # \rho_{HY}(\tau = 0)
    spillover_asymmetry: float  # Directional information transmission index
    directive: LeadLagDirective
    rationale: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class HayashiYoshidaLeadLagSieve:
    """
    Sub-second Hayashi-Yoshida Asynchronous Cross-Correlation & Lead-Lag Sieve.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        lag_search_range_sec: float = 2.0,
        lag_step_sec: float = 0.10,
        min_correlation_hurdle: float = 0.40,
        min_lead_sec_threshold: float = 0.15,
    ):
        self.db_path = db_path
        self.lag_search_range = lag_search_range_sec
        self.lag_step = lag_step_sec
        self.min_corr_hurdle = min_correlation_hurdle
        self.min_lead_threshold = min_lead_sec_threshold

        self._conn: Optional[sqlite3.Connection] = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for lead-lag telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS lead_lag_correlation_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                leader_symbol TEXT NOT NULL,
                follower_symbol TEXT NOT NULL,
                optimal_lag_sec REAL NOT NULL,
                peak_correlation REAL NOT NULL,
                sync_correlation REAL NOT NULL,
                spillover_asymmetry REAL NOT NULL,
                directive TEXT NOT NULL,
                rationale TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def compute_hayashi_yoshida_corr(
        self,
        ticks_x: List[TickPrint],
        ticks_y: List[TickPrint],
        tau_lag_sec: float = 0.0,
    ) -> float:
        r"""
        Computes Hayashi-Yoshida realized correlation between non-synchronous tick streams:
        \rho_{HY}(\tau) = \frac{\sum_{i,j} \Delta X_i \Delta Y_j \mathbf{1}_{\{I_i \cap J_j(\tau) \neq \emptyset\}}}{\sqrt{\sum_i (\Delta X_i)^2 \sum_j (\Delta Y_j)^2}}
        """
        if len(ticks_x) < 2 or len(ticks_y) < 2:
            return 0.0

        # Construct return intervals for X: I_i = (t_{i-1}, t_i], dX_i = ln(P_i) - ln(P_{i-1})
        intervals_x = []
        sum_sq_dx = 0.0
        for i in range(1, len(ticks_x)):
            t_start = ticks_x[i - 1].timestamp_sec
            t_end = ticks_x[i].timestamp_sec
            if t_end > t_start and ticks_x[i].price > 0 and ticks_x[i - 1].price > 0:
                dx = math.log(ticks_x[i].price / ticks_x[i - 1].price)
                intervals_x.append((t_start, t_end, dx))
                sum_sq_dx += dx * dx

        # Construct shifted return intervals for Y: J_j = (t_{j-1} + \tau, t_j + \tau], dY_j
        intervals_y = []
        sum_sq_dy = 0.0
        for j in range(1, len(ticks_y)):
            t_start = ticks_y[j - 1].timestamp_sec + tau_lag_sec
            t_end = ticks_y[j].timestamp_sec + tau_lag_sec
            if t_end > t_start and ticks_y[j].price > 0 and ticks_y[j - 1].price > 0:
                dy = math.log(ticks_y[j].price / ticks_y[j - 1].price)
                intervals_y.append((t_start, t_end, dy))
                sum_sq_dy += dy * dy

        if sum_sq_dx <= 1e-12 or sum_sq_dy <= 1e-12:
            return 0.0

        # Cumulative overlapping cross-product
        cross_cov = 0.0
        for x_start, x_end, dx in intervals_x:
            for y_start, y_end, dy in intervals_y:
                # Interval overlap condition: max(x_start, y_start) < min(x_end, y_end)
                if max(x_start, y_start) < min(x_end, y_end):
                    cross_cov += dx * dy

        denom = math.sqrt(sum_sq_dx * sum_sq_dy)
        corr = cross_cov / denom if denom > 0 else 0.0
        return max(-1.0, min(1.0, round(corr, 4)))

    def analyze_lead_lag(
        self,
        symbol_x: str,
        ticks_x: List[TickPrint],
        symbol_y: str,
        ticks_y: List[TickPrint],
    ) -> LeadLagReport:
        """
        Scans lag horizon [-search_range, +search_range] to find optimal lead-lag delay tau^*
        and evaluates directional information spillover.
        """
        if len(ticks_x) < 3 or len(ticks_y) < 3:
            return LeadLagReport(
                leader_symbol=symbol_x,
                follower_symbol=symbol_y,
                optimal_lag_sec=0.0,
                peak_correlation=0.0,
                synchronous_correlation=0.0,
                spillover_asymmetry=0.0,
                directive=LeadLagDirective.DECOUPLED_INDEPENDENT_FLOW,
                rationale="Insufficient tick samples for Hayashi-Yoshida evaluation.",
            )

        sync_corr = self.compute_hayashi_yoshida_corr(ticks_x, ticks_y, tau_lag_sec=0.0)

        best_shift = 0.0
        best_corr = sync_corr
        max_abs_corr = abs(sync_corr)

        # Discretized lag search
        num_steps = int(self.lag_search_range / self.lag_step)
        pos_corrs = []
        neg_corrs = []

        for step in range(-num_steps, num_steps + 1):
            shift = round(step * self.lag_step, 4)
            c = self.compute_hayashi_yoshida_corr(ticks_x, ticks_y, tau_lag_sec=shift)
            if shift > 0:
                pos_corrs.append(abs(c))
            elif shift < 0:
                neg_corrs.append(abs(c))

            # Strictly higher or tied but closer to zero
            if abs(c) > max_abs_corr + 1e-4:
                max_abs_corr = abs(c)
                best_corr = c
                best_shift = shift
            elif abs(abs(c) - max_abs_corr) <= 1e-4 and abs(shift) < abs(best_shift):
                max_abs_corr = abs(c)
                best_corr = c
                best_shift = shift

        avg_pos = sum(pos_corrs) / len(pos_corrs) if pos_corrs else 0.0
        avg_neg = sum(neg_corrs) / len(neg_corrs) if neg_corrs else 0.0
        tot_asym = avg_pos + avg_neg
        spillover_asym = (avg_pos - avg_neg) / tot_asym if tot_asym > 1e-4 else 0.0

        # Note: best_shift is applied to Y. If best_shift < 0, Y occurred after X -> X leads Y!
        # Thus optimal lead of X over Y is: lead_sec = -best_shift
        lead_sec = round(-best_shift, 4)

        # Classify leader vs follower and directive
        if max_abs_corr < self.min_corr_hurdle:
            directive = LeadLagDirective.DECOUPLED_INDEPENDENT_FLOW
            rationale = (
                f"Peak cross-correlation ({best_corr:.2f}) below hurdle {self.min_corr_hurdle:.2f}. "
                f"Assets trade largely independently."
            )
            leader = symbol_x
            follower = symbol_y
        elif best_corr < -self.min_corr_hurdle:
            directive = LeadLagDirective.INVERTED_NEGATIVE_SPILLOVER
            rationale = (
                f"Strong inverted cross-correlation ({best_corr:.2f}) at lead {lead_sec:+.2f}s. "
                f"Hedging or negative correlation regime detected."
            )
            leader = symbol_x if lead_sec >= 0 else symbol_y
            follower = symbol_y if lead_sec >= 0 else symbol_x
        elif abs(lead_sec) < self.min_lead_threshold:
            directive = LeadLagDirective.SYNCHRONOUS_CO_MOVEMENT_PAIR
            rationale = (
                f"High synchronous correlation ({sync_corr:.2f}) with negligible lag ({lead_sec:+.2f}s). "
                f"Co-moving pair suitable for statistical arbitrage / spread trading."
            )
            leader = symbol_x
            follower = symbol_y
        else:
            directive = LeadLagDirective.LEAD_LAG_ARBITRAGE_FOLLOW_LEADER
            if lead_sec > 0:
                leader = symbol_x
                follower = symbol_y
                rationale = (
                    f"{symbol_x} leads {symbol_y} by {lead_sec:.2f}s (Peak Rho={best_corr:.2f} vs Sync={sync_corr:.2f}). "
                    f"Follow {symbol_x} price innovations to front-run {symbol_y} fills."
                )
            else:
                leader = symbol_y
                follower = symbol_x
                rationale = (
                    f"{symbol_y} leads {symbol_x} by {abs(lead_sec):.2f}s (Peak Rho={best_corr:.2f} vs Sync={sync_corr:.2f}). "
                    f"Follow {symbol_y} price innovations to front-run {symbol_x} fills."
                )

        report = LeadLagReport(
            leader_symbol=leader,
            follower_symbol=follower,
            optimal_lag_sec=lead_sec,
            peak_correlation=best_corr,
            synchronous_correlation=sync_corr,
            spillover_asymmetry=round(spillover_asym, 4),
            directive=directive,
            rationale=rationale,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: LeadLagReport) -> None:
        """Persists lead-lag evaluation into SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO lead_lag_correlation_telemetry (
                timestamp, leader_symbol, follower_symbol, optimal_lag_sec,
                peak_correlation, sync_correlation, spillover_asymmetry,
                directive, rationale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.leader_symbol,
                rep.follower_symbol,
                rep.optimal_lag_sec,
                rep.peak_correlation,
                rep.synchronous_correlation,
                rep.spillover_asymmetry,
                rep.directive.value,
                rep.rationale,
            ),
        )
        conn.commit()

    def get_latest_telemetry(self, limit: int = 10) -> List[Tuple]:
        """Retrieves latest lead-lag records."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT leader_symbol, follower_symbol, optimal_lag_sec, peak_correlation, sync_correlation, directive
            FROM lead_lag_correlation_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
