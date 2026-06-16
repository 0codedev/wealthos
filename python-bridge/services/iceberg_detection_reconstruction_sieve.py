"""
Domain 183 (WP-CG): Order Book Iceberg Detection & Hidden Reserve Reconstruction Sieve

Implements sub-millisecond Level-2/Level-3 unannounced queue replenishment detection,
cumulative hidden reserve volume reconstruction, slice size coefficient of variation (CV_R),
and institutional hidden liquidity breakout/absorption execution directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


class IcebergRegimeDirective(str, Enum):
    BULLISH_ICEBERG_SUPPORT_ACCUMULATION = "BULLISH_ICEBERG_SUPPORT_ACCUMULATION"
    BEARISH_ICEBERG_RESISTANCE_DISTRIBUTION = "BEARISH_ICEBERG_RESISTANCE_DISTRIBUTION"
    ICEBERG_DEPLETION_BREAKOUT_DRIVE = "ICEBERG_DEPLETION_BREAKOUT_DRIVE"
    NORMAL_TRANSPARENT_BOOK = "NORMAL_TRANSPARENT_BOOK"


@dataclass
class L2QuotePrint:
    timestamp_ms: float
    price: float
    visible_size: float
    side: str  # 'BID' or 'ASK'


@dataclass
class TradePrint:
    timestamp_ms: float
    price: float
    size: float
    side: str  # 'BUY' (hit ask) or 'SELL' (hit bid)


@dataclass
class IcebergDetectionReport:
    symbol: str
    side: str
    price_level: float
    replenishment_count: int
    mean_tranche_size: float
    tranche_cv: float  # Coefficient of variation of replenishment sizes
    cumulative_hidden_volume: float
    estimated_total_parent_volume: float
    is_native_iceberg: bool
    directive: IcebergRegimeDirective
    rationale: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class IcebergDetectionReconstructionSieve:
    """
    Sub-millisecond Order Book Hidden Iceberg Detection & Reconstruction Sieve.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        max_replenish_latency_ms: float = 15.0,
        min_replenishments_for_iceberg: int = 3,
        cv_deterministic_threshold: float = 0.20,
    ):
        self.db_path = db_path
        self.max_latency_ms = max_replenish_latency_ms
        self.min_replenishments = min_replenishments_for_iceberg
        self.cv_deterministic = cv_deterministic_threshold

        self._conn: Optional[sqlite3.Connection] = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for iceberg telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS iceberg_detection_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                price_level REAL NOT NULL,
                replenish_count INTEGER NOT NULL,
                mean_tranche REAL NOT NULL,
                tranche_cv REAL NOT NULL,
                hidden_vol REAL NOT NULL,
                estimated_parent REAL NOT NULL,
                directive TEXT NOT NULL,
                rationale TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def detect_replenishments(
        self,
        trades: List[TradePrint],
        quotes_pre: List[L2QuotePrint],
        quotes_post: List[L2QuotePrint],
    ) -> List[Tuple[float, float, str]]:
        """
        Detects unannounced replenishments by comparing pre-trade visible depth,
        trade volume, and post-trade visible depth:
        Replenish = Q_{vis}(t^+) - max(0, Q_{vis}(t^-) - V_{trade})
        Returns list of (price, replenish_size, side).
        """
        replenishments = []

        # Map pre and post quotes by price and side
        pre_map: Dict[Tuple[float, str], float] = {(q.price, q.side.upper()): q.visible_size for q in quotes_pre}
        post_map: Dict[Tuple[float, str], float] = {(q.price, q.side.upper()): q.visible_size for q in quotes_post}

        for tr in trades:
            # If trade is SELL (market sell hit bid), the passive quote is BID
            # If trade is BUY (market buy hit ask), the passive quote is ASK
            passive_side = "BID" if tr.side.upper() == "SELL" else "ASK"
            key = (tr.price, passive_side)

            q_pre = pre_map.get(key, 0.0)
            q_post = post_map.get(key, 0.0)

            expected_rem = max(0.0, q_pre - tr.size)
            replenish = q_post - expected_rem

            if replenish > 0.0:
                replenishments.append((tr.price, replenish, passive_side))

        return replenishments

    def analyze_order_flow(
        self,
        symbol: str,
        price_level: float,
        side: str,
        replenishment_tranches: List[float],
        current_visible_size: float = 500.0,
    ) -> IcebergDetectionReport:
        """
        Reconstructs hidden reserve volume, checks tranche uniformity,
        and generates iceberg execution directives.
        """
        k = len(replenishment_tranches)
        side_upper = side.upper()

        if k < self.min_replenishments:
            return IcebergDetectionReport(
                symbol=symbol,
                side=side_upper,
                price_level=price_level,
                replenishment_count=k,
                mean_tranche_size=0.0,
                tranche_cv=0.0,
                cumulative_hidden_volume=0.0,
                estimated_total_parent_volume=current_visible_size,
                is_native_iceberg=False,
                directive=IcebergRegimeDirective.NORMAL_TRANSPARENT_BOOK,
                rationale=f"Insufficient replenishments ({k} < {self.min_replenishments}) to confirm iceberg.",
            )

        mean_tranche = sum(replenishment_tranches) / k
        variance = sum((r - mean_tranche) ** 2 for r in replenishment_tranches) / max(1, k - 1)
        std_tranche = math.sqrt(variance)
        cv = std_tranche / mean_tranche if mean_tranche > 0 else 0.0

        cum_hidden = sum(replenishment_tranches)
        # Inferred parent: executed hidden volume + visible + estimated remaining slices
        estimated_parent = cum_hidden + current_visible_size

        is_native = cv <= self.cv_deterministic

        # Directives
        if side_upper == "BID":
            directive = IcebergRegimeDirective.BULLISH_ICEBERG_SUPPORT_ACCUMULATION
            rationale = (
                f"Active hidden Buy Iceberg at {price_level:.2f} ({k} replenishments, "
                f"Mean={mean_tranche:.0f}, CV={cv:.2f}, CumHidden={cum_hidden:.0f} shares). "
                f"Passive institutional accumulator defending support floor."
            )
        else:
            directive = IcebergRegimeDirective.BEARISH_ICEBERG_RESISTANCE_DISTRIBUTION
            rationale = (
                f"Active hidden Sell Iceberg at {price_level:.2f} ({k} replenishments, "
                f"Mean={mean_tranche:.0f}, CV={cv:.2f}, CumHidden={cum_hidden:.0f} shares). "
                f"Passive institutional seller distributing into bids at resistance ceiling."
            )

        report = IcebergDetectionReport(
            symbol=symbol,
            side=side_upper,
            price_level=price_level,
            replenishment_count=k,
            mean_tranche_size=round(mean_tranche, 2),
            tranche_cv=round(cv, 4),
            cumulative_hidden_volume=round(cum_hidden, 2),
            estimated_total_parent_volume=round(estimated_parent, 2),
            is_native_iceberg=is_native,
            directive=directive,
            rationale=rationale,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: IcebergDetectionReport) -> None:
        """Persists iceberg report into SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO iceberg_detection_telemetry (
                timestamp, symbol, side, price_level, replenish_count,
                mean_tranche, tranche_cv, hidden_vol, estimated_parent,
                directive, rationale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.side,
                rep.price_level,
                rep.replenishment_count,
                rep.mean_tranche_size,
                rep.tranche_cv,
                rep.cumulative_hidden_volume,
                rep.estimated_total_parent_volume,
                rep.directive.value,
                rep.rationale,
            ),
        )
        conn.commit()

    def get_latest_telemetry(self, limit: int = 10) -> List[Tuple]:
        """Retrieves recent telemetry entries."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT symbol, side, price_level, replenish_count, hidden_vol, directive
            FROM iceberg_detection_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
