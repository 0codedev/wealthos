r"""
Order Book Level-2 Cancellation Flow & Spoofing Phantom Liquidity Sieve (Domain 146 / WP-AV)
=============================================================================================

Autonomous market microstructure engine analyzing sub-millisecond Level-2/Level-3 order book
events to compute Order Cancellation-to-Trade Ratios (CTR), fleeting quote persistence
lifetimes (\tau_{\text{life}}), and asymmetric flash cancellation ratios to filter out
predatory spoofing and quantify true effective market depth.

Mathematical Formulations:
--------------------------
1. Cancellation-to-Trade Ratio (CTR):
       \text{CTR}_{\text{side}} = \frac{\sum V_{\text{cancelled, side}}}{\max(1.0, \sum V_{\text{traded, side}})}

2. Volume-Weighted Median Quote Lifetime:
       \bar{\tau}_{\text{life}} = \frac{\sum_k Q_k (t_{\text{cancel}, k} - t_{\text{insert}, k})}{\sum_k Q_k} \quad \text{(in milliseconds)}

3. Asymmetric Flash Pull Ratio (\Xi_{\text{flash}}):
   Proportion of resting volume cancelled immediately as market price approaches within \delta ticks:
       \Xi_{\text{flash}} = \frac{V_{\text{cancelled when } |P - \text{Mid}| \le \delta}}{V_{\text{cancelled, total}}}

4. Composite Spoofing Phantom Hazard Index (S_{\text{phantom}} \in [0.0, 1.0]):
       S_{\text{phantom}} = \min\left(1.0, \; 0.40 \cdot \min\left(1.0, \frac{\text{CTR}}{150.0}\right) + 0.35 \cdot \Xi_{\text{flash}} + 0.25 \cdot \max\left(0.0, 1.0 - \frac{\bar{\tau}_{\text{life}}}{200.0}\right)\right)

5. Real Vetted Effective Depth:
       D_{\text{effective}} = D_{\text{raw}} \cdot (1.0 - S_{\text{phantom}})
"""

from dataclasses import dataclass, field
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class OrderBookEvent:
    event_type: str  # 'NEW', 'CANCEL', 'TRADE'
    side: str  # 'BID' or 'ASK'
    price: float
    quantity: float
    timestamp_ms: float
    order_id: Optional[str] = None
    distance_to_mid_ticks: float = 5.0


@dataclass
class SpoofingAnalysisReport:
    symbol: str
    side: str
    raw_depth: float
    effective_depth: float
    cancellation_to_trade_ratio: float
    avg_quote_lifetime_ms: float
    flash_cancellation_ratio: float
    phantom_hazard_index: float
    regime: str
    execution_directive: str


class L2CancellationSpoofingSieve:
    """
    Real-time L2 order book cancellation flow tracker and spoofing sieve.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        flash_distance_threshold_ticks: float = 2.0,
    ):
        self.db_path = db_path
        self.flash_dist_thresh = flash_distance_threshold_ticks
        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            if self._conn is None:
                self._conn = sqlite3.connect(":memory:")
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for spoofing telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS l2_spoofing_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                raw_depth REAL NOT NULL,
                effective_depth REAL NOT NULL,
                ctr REAL NOT NULL,
                avg_lifetime_ms REAL NOT NULL,
                flash_ratio REAL NOT NULL,
                phantom_hazard REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def analyze_event_stream(
        self,
        symbol: str,
        events: List[OrderBookEvent],
        current_raw_depth: float,
        side: str = "BID",
    ) -> SpoofingAnalysisReport:
        """
        Analyzes a chronological window of L2 order events and returns the
        spoofing hazard index and effective book depth.
        """
        filtered = [e for e in events if e.side.upper() == side.upper()]

        total_cancelled_vol = 0.0
        total_traded_vol = 0.0
        flash_cancelled_vol = 0.0

        # Track lifetimes for orders with both NEW and CANCEL events
        insert_times: Dict[str, float] = {}
        weighted_lifetimes_sum = 0.0
        lifetime_vol_sum = 0.0

        for e in filtered:
            evt = e.event_type.upper()
            if evt == "NEW":
                if e.order_id:
                    insert_times[e.order_id] = e.timestamp_ms
            elif evt == "TRADE":
                total_traded_vol += e.quantity
            elif evt == "CANCEL":
                total_cancelled_vol += e.quantity
                if e.distance_to_mid_ticks <= self.flash_dist_thresh:
                    flash_cancelled_vol += e.quantity

                if e.order_id and e.order_id in insert_times:
                    dt = max(0.0, e.timestamp_ms - insert_times[e.order_id])
                    weighted_lifetimes_sum += dt * e.quantity
                    lifetime_vol_sum += e.quantity

        # 1. Cancellation-to-Trade Ratio
        ctr = total_cancelled_vol / max(1.0, total_traded_vol)

        # 2. Average Lifetime (ms)
        if lifetime_vol_sum > 0.0:
            avg_lifetime = weighted_lifetimes_sum / lifetime_vol_sum
        else:
            avg_lifetime = 500.0  # Default benign lifetime

        # 3. Flash Cancellation Ratio
        if total_cancelled_vol > 0.0:
            flash_ratio = flash_cancelled_vol / total_cancelled_vol
        else:
            flash_ratio = 0.0

        # 4. Composite Phantom Hazard Index S_phantom
        ctr_term = min(1.0, ctr / 150.0)
        flash_term = flash_ratio
        lifetime_term = max(0.0, 1.0 - (avg_lifetime / 200.0))

        raw_hazard = 0.40 * ctr_term + 0.35 * flash_term + 0.25 * lifetime_term
        hazard = max(0.0, min(1.0, raw_hazard))

        # 5. Vetted Effective Depth
        effective_depth = current_raw_depth * (1.0 - hazard)

        # 6. Regime Classification and Directive Ladder
        if hazard <= 0.25:
            regime = "ORGANIC_LIQUIDITY"
            directive = "PROCEED_STANDARD_ROUTING"
        elif hazard <= 0.55:
            regime = "MILD_PHANTOM_NOISE"
            directive = "DISCOUNT_DEPTH_REQUIRE_TICK_FILL"
        elif hazard <= 0.80:
            regime = "ELEVATED_SPOOFING_ALERT"
            directive = "VETO_AGGRESSIVE_ORDERS_INTO_SPOOF"
        else:
            regime = "CRITICAL_PHANTOM_LIQUIDITY_TRAP"
            directive = "VETO_DEPTH_FADE_ARTIFICIAL_WALL"

        report = SpoofingAnalysisReport(
            symbol=symbol,
            side=side.upper(),
            raw_depth=round(current_raw_depth, 2),
            effective_depth=round(effective_depth, 2),
            cancellation_to_trade_ratio=round(ctr, 2),
            avg_quote_lifetime_ms=round(avg_lifetime, 2),
            flash_cancellation_ratio=round(flash_ratio, 4),
            phantom_hazard_index=round(hazard, 4),
            regime=regime,
            execution_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: SpoofingAnalysisReport) -> None:
        """Persists spoofing telemetry into SQLite."""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO l2_spoofing_telemetry (
                    timestamp, symbol, side, raw_depth, effective_depth,
                    ctr, avg_lifetime_ms, flash_ratio, phantom_hazard,
                    regime, directive
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.utcnow().isoformat(),
                    rep.symbol,
                    rep.side,
                    rep.raw_depth,
                    rep.effective_depth,
                    rep.cancellation_to_trade_ratio,
                    rep.avg_quote_lifetime_ms,
                    rep.flash_cancellation_ratio,
                    rep.phantom_hazard_index,
                    rep.regime,
                    rep.execution_directive,
                ),
            )
            conn.commit()
        except Exception:
            pass
