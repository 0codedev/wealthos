r"""
Microsecond Hardware Timestamp Drift & PTP/NTP Clock Synchronization Sentry (Domain 126 / WP-AB)
=================================================================================================

Autonomous sub-millisecond clock drift, skew filtering, and stale quote surveillance
engine designed for high-frequency trading between local execution servers and
exchange matching engines (NSE, BSE, Dhan, Upstox).

Mathematical Specifications:
-----------------------------
1. Clock Offset & Network Latency Decomposition:
   Let T_{local, k} be the local packet receive timestamp (in microseconds)
   and T_{exchange, k} be the exchange match/broadcast timestamp:
       D_k = T_{local, k} - T_{exchange, k} = \theta_k + d_{network, k}
   where \theta_k is the true clock offset and d_{network, k} \ge d_{min} is asymmetric network latency.

2. Minimum-Filter Line-of-Sight Estimator:
   Since network queuing delays are strictly non-negative (d_{network} \ge d_{min}),
   the minimum observed delay over rolling window M eliminates queuing noise:
       \hat{\theta}_k = \min_{j \in [k-M, k]} D_j - d_{flight\_min}

3. Frequency Skew (\omega in parts-per-million, ppm):
   Calculates rate of drift change over time:
       \omega_k = \frac{\hat{\theta}_k - \hat{\theta}_{k-L}}{\Delta t} \times 10^6 \quad \text{(ppm)}

4. Stale Quote Veto & Latency Threshold:
   True quote age in transit:
       \text{Age}_k = T_{local, k} - T_{exchange, k} - \hat{\theta}_k
   If \text{Age}_k > \tau_{max} (e.g. 150 ms):
       Flag -> STALE_FEED_VETO (reject latency-sensitive arbitrage fills)
"""

from dataclasses import dataclass, field
from datetime import datetime
import math
from typing import Dict, List, Optional, Tuple
import sqlite3


@dataclass
class TimestampPacket:
    packet_id: str
    symbol: str
    exchange_ts_us: int  # Microseconds epoch
    local_receive_ts_us: int  # Microseconds epoch
    round_trip_time_us: Optional[int] = None


@dataclass
class ClockDriftEstimate:
    timestamp: datetime
    venue: str
    estimated_offset_us: float  # Microseconds (local - exchange)
    frequency_skew_ppm: float   # Parts per million drift rate
    min_transit_delay_us: float
    jitter_std_us: float
    regime: str  # 'SYNCHRONIZED', 'DRIFT_WARNING', 'CRITICAL_DESYNC'
    is_safe_for_latency_arbitrage: bool


@dataclass
class StaleQuoteAudit:
    packet_id: str
    symbol: str
    raw_delay_ms: float
    corrected_transit_age_ms: float
    is_stale_veto_active: bool
    reason: str


class ClockSynchronizationSentry:
    """
    Sub-millisecond clock drift, skew estimator, and stale feed governor.
    """

    def __init__(
        self,
        min_flight_delay_us: float = 150.0,  # Estimated physical fiber transit floor
        rolling_window_m: int = 50,
        drift_warning_threshold_us: float = 10000.0,   # 10ms warning
        critical_desync_threshold_us: float = 50000.0, # 50ms critical
        stale_quote_cutoff_ms: float = 150.0,          # 150ms stale veto
        db_path: str = ":memory:",
    ):
        self.min_flight_delay_us = min_flight_delay_us
        self.rolling_window_m = rolling_window_m
        self.drift_warning_threshold_us = drift_warning_threshold_us
        self.critical_desync_threshold_us = critical_desync_threshold_us
        self.stale_quote_cutoff_ms = stale_quote_cutoff_ms
        self.db_path = db_path

        # Internal state per venue
        self._delay_history: Dict[str, List[Tuple[int, float]]] = {}  # (local_ts_us, delay_us)
        self._last_offset_estimate: Dict[str, float] = {}

        self._conn: Optional[sqlite3.Connection] = None
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
            CREATE TABLE IF NOT EXISTS clock_sync_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                venue TEXT NOT NULL,
                offset_us REAL NOT NULL,
                skew_ppm REAL NOT NULL,
                jitter_us REAL NOT NULL,
                regime TEXT NOT NULL,
                is_safe INTEGER NOT NULL
            )
            """
        )
        conn.commit()

    def record_timestamp(
        self,
        venue: str,
        packet: TimestampPacket,
    ) -> ClockDriftEstimate:
        """
        Records a timestamp sample, calculates offset and frequency skew, and classifies regime.
        """
        raw_delay_us = float(packet.local_receive_ts_us - packet.exchange_ts_us)

        if venue not in self._delay_history:
            self._delay_history[venue] = []

        history = self._delay_history[venue]
        history.append((packet.local_receive_ts_us, raw_delay_us))
        if len(history) > self.rolling_window_m:
            history.pop(0)

        # Minimum-filter line-of-sight estimator
        delays = [d for _, d in history]
        min_delay = min(delays)
        offset_est = min_delay - self.min_flight_delay_us

        # Jitter standard deviation
        mean_delay = sum(delays) / len(delays)
        jitter_std = math.sqrt(sum((d - mean_delay) ** 2 for d in delays) / len(delays))

        # Skew calculation: d(offset)/dt
        skew_ppm = 0.0
        if len(history) >= 10:
            first_ts, first_del = history[0]
            last_ts, last_del = history[-1]
            dt_sec = (last_ts - first_ts) / 1e6
            if dt_sec > 0.01:
                skew_ppm = ((last_del - first_del) / dt_sec)  # Microsec drift per sec = ppm

        self._last_offset_estimate[venue] = offset_est

        # Classify regime
        abs_offset = abs(offset_est)
        if abs_offset >= self.critical_desync_threshold_us:
            regime = 'CRITICAL_DESYNC'
            is_safe = False
        elif abs_offset >= self.drift_warning_threshold_us:
            regime = 'DRIFT_WARNING'
            is_safe = True
        else:
            regime = 'SYNCHRONIZED'
            is_safe = True

        now = datetime.utcnow()
        estimate = ClockDriftEstimate(
            timestamp=now,
            venue=venue,
            estimated_offset_us=round(offset_est, 2),
            frequency_skew_ppm=round(skew_ppm, 2),
            min_transit_delay_us=round(min_delay, 2),
            jitter_std_us=round(jitter_std, 2),
            regime=regime,
            is_safe_for_latency_arbitrage=is_safe,
        )

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO clock_sync_telemetry (
                timestamp, venue, offset_us, skew_ppm, jitter_us, regime, is_safe
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now.isoformat(),
                venue,
                estimate.estimated_offset_us,
                estimate.frequency_skew_ppm,
                estimate.jitter_std_us,
                regime,
                1 if is_safe else 0,
            )
        )
        conn.commit()

        return estimate

    def audit_quote_staleness(
        self,
        venue: str,
        packet: TimestampPacket,
    ) -> StaleQuoteAudit:
        """
        Audits transit age of a quote using calibrated offset, vetoing stale quotes.
        """
        raw_delay_us = float(packet.local_receive_ts_us - packet.exchange_ts_us)
        raw_delay_ms = raw_delay_us / 1000.0

        offset_est = self._last_offset_estimate.get(venue, 0.0)
        # Corrected transit age removes steady-state clock bias
        corrected_age_us = raw_delay_us - offset_est
        corrected_age_ms = max(corrected_age_us / 1000.0, 0.0)

        is_stale = corrected_age_ms > self.stale_quote_cutoff_ms
        reason = (
            f"Quote transit age ({corrected_age_ms:.1f}ms) exceeds safety ceiling ({self.stale_quote_cutoff_ms:.1f}ms)"
            if is_stale else "Quote within sub-millisecond validity window"
        )

        return StaleQuoteAudit(
            packet_id=packet.packet_id,
            symbol=packet.symbol,
            raw_delay_ms=round(raw_delay_ms, 2),
            corrected_transit_age_ms=round(corrected_age_ms, 2),
            is_stale_veto_active=is_stale,
            reason=reason,
        )
