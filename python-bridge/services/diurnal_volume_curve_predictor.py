"""
Domain 173 (WP-BW): Diurnal Intraday Volume Curve & U-Shape Execution Predictor

Implements Andersen-Bollerslev Flexible Fourier Form (FFF) intraday diurnal volume seasonality,
dynamic end-of-day (EOD) volume projection, Volume Deviation Factor tracking,
and adaptive institutional Percentage of Volume (POV) participation rate governing.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class DiurnalBucket:
    minute_offset: int  # Minute from open (0 to 375 for 09:15 to 15:30 IST)
    time_label: str  # "09:15", "11:30", etc.
    diurnal_weight: float  # Fraction of daily volume expected in this bucket
    cumulative_weight: float  # Cumulative fraction from open


@dataclass
class DiurnalPredictorReport:
    symbol: str
    current_minute: int
    realized_volume: float
    projected_eod_volume: float
    expected_cumulative_volume: float
    volume_pace_ratio: float  # realized / expected
    base_pov: float
    governed_pov: float
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class DiurnalVolumeCurvePredictor:
    """
    Diurnal Intraday Volume Curve & U-Shape Execution Predictor.
    Models the 375-minute Indian market session (09:15 to 15:30 IST).
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        session_minutes: int = 375,
        bucket_size_min: int = 5,
        default_adv: float = 10000000.0,
    ):
        self.db_path = db_path
        self.session_minutes = session_minutes
        self.bucket_size_min = max(1, bucket_size_min)
        self.num_buckets = session_minutes // self.bucket_size_min
        self.default_adv = default_adv

        # Generate standard empirical U-shaped curve weights
        self.curve = self._generate_canonical_u_shape()

        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for Diurnal Volume telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS diurnal_volume_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                minute_offset INTEGER NOT NULL,
                realized_vol REAL NOT NULL,
                projected_eod_vol REAL NOT NULL,
                expected_cum_vol REAL NOT NULL,
                volume_pace_ratio REAL NOT NULL,
                governed_pov REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def _generate_canonical_u_shape(self) -> List[DiurnalBucket]:
        """
        Synthesizes the canonical U-shape volume distribution using a quadratic + cosine Fourier mode:
        u(t) = a0 + a1*(t - T/2)^2 + a2*cos(2*pi*t/T)
        Normalized so that sum(u(t)) == 1.0.
        """
        raw_weights = []
        mid = (self.num_buckets - 1) / 2.0

        for i in range(self.num_buckets):
            norm_t = (i - mid) / mid  # -1.0 to +1.0
            # U-curve: high at edges (norm_t = +/-1.0), low at center (norm_t = 0.0)
            # Add morning asymmetry (open has higher volume than close)
            open_boost = 1.35 if norm_t < -0.6 else 1.0
            w = (0.50 + 1.20 * (norm_t ** 2) + 0.30 * math.cos(math.pi * norm_t)) * open_boost
            raw_weights.append(max(0.1, w))

        total_w = sum(raw_weights)
        norm_weights = [w / total_w for w in raw_weights]

        buckets = []
        cum = 0.0
        for i, nw in enumerate(norm_weights):
            cum += nw
            m_offset = i * self.bucket_size_min
            h = 9 + (15 + m_offset) // 60
            m = (15 + m_offset) % 60
            time_str = f"{h:02d}:{m:02d}"
            buckets.append(
                DiurnalBucket(
                    minute_offset=m_offset,
                    time_label=time_str,
                    diurnal_weight=round(nw, 6),
                    cumulative_weight=round(min(1.0, cum), 6),
                )
            )

        return buckets

    def get_expected_fraction_at_minute(self, minute_offset: int) -> float:
        """Returns the cumulative diurnal volume fraction expected by minute_offset."""
        if minute_offset <= 0:
            return 0.0
        if minute_offset >= self.session_minutes:
            return 1.0

        idx = min(len(self.curve) - 1, minute_offset // self.bucket_size_min)
        return self.curve[idx].cumulative_weight

    def predict_volume_and_govern_pov(
        self,
        symbol: str,
        minute_offset: int,
        realized_volume_today: float,
        baseline_adv: Optional[float] = None,
        base_pov: float = 0.15,
        max_pov: float = 0.30,
        min_pov: float = 0.04,
    ) -> DiurnalPredictorReport:
        """
        Projects End-of-Day volume and dynamically governs optimal Percentage of Volume (POV).
        Governed POV = clip(base_pov * sqrt(pace_ratio), min_pov, max_pov).
        """
        adv = baseline_adv if baseline_adv and baseline_adv > 0 else self.default_adv
        cum_expected_frac = max(0.01, self.get_expected_fraction_at_minute(minute_offset))

        # Expected volume up to this point given standard ADV
        expected_cum_vol = round(adv * cum_expected_frac, 2)

        # Projected EOD volume: extrapolate realized volume by expected remaining fraction
        projected_eod_vol = round(realized_volume_today / cum_expected_frac, 2)

        # Volume Pace Ratio
        pace_ratio = round(realized_volume_today / max(1.0, expected_cum_vol), 3)

        # Dynamic POV Participation Rate Governor
        # When pace is high, expand participation; when anemic, compress participation
        governed_pov = round(max(min_pov, min(max_pov, base_pov * math.sqrt(pace_ratio))), 4)

        # Directives
        bucket_idx = min(len(self.curve) - 1, minute_offset // self.bucket_size_min)
        current_bucket_weight = self.curve[bucket_idx].diurnal_weight

        if pace_ratio >= 1.35:
            regime = "HIGH_VOLUME_SURGE_EXPANSION"
            directive = "EXECUTE_ACCELERATED_POV_EXPANSION"
        elif pace_ratio <= 0.70:
            regime = "ANEMIC_VOLUME_DROUGHT"
            directive = "THROTTLE_POV_PARTICIPATION_ANEMIC"
        elif current_bucket_weight < 0.010 and 90 <= minute_offset <= 240:
            regime = "MIDDAY_LULL_QUIET_PERIOD"
            directive = "DIURNAL_MIDDAY_LULL_CONSERVATION"
        else:
            regime = "STANDARD_DIURNAL_PACING"
            directive = "STANDARD_DIURNAL_VWAP_TRACKING"

        report = DiurnalPredictorReport(
            symbol=symbol,
            current_minute=minute_offset,
            realized_volume=realized_volume_today,
            projected_eod_volume=projected_eod_vol,
            expected_cumulative_volume=expected_cum_vol,
            volume_pace_ratio=pace_ratio,
            base_pov=base_pov,
            governed_pov=governed_pov,
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: DiurnalPredictorReport) -> None:
        """Persists evaluation results to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO diurnal_volume_telemetry (
                timestamp, symbol, minute_offset, realized_vol,
                projected_eod_vol, expected_cum_vol, volume_pace_ratio,
                governed_pov, regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.current_minute,
                rep.realized_volume,
                rep.projected_eod_volume,
                rep.expected_cumulative_volume,
                rep.volume_pace_ratio,
                rep.governed_pov,
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
            SELECT symbol, minute_offset, realized_vol, projected_eod_vol, volume_pace_ratio, governed_pov, regime, directive
            FROM diurnal_volume_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
