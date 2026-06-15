r"""
Intraday Volume U-Curve & Diurnal Activity Profile Engine (Domain 128 / WP-AD)
==============================================================================

Autonomous intraday volume profiling, Diurnal U-curve parameterization, and optimal
VWAP/TWAP execution schedule engine calibrated for the Indian Cash & F&O Market
session (09:15 to 15:30 IST, 375 minutes).

Mathematical Specifications:
-----------------------------
1. Normalized Intraday Time Scale:
   Session duration T_{session} = 375 minutes (09:15 - 15:30 IST).
   Normalized time t \in [0.0, 1.0]:
       t = \frac{\text{MinuteFromOpen}}{375.0}

2. Diurnal U-Curve Volume Intensity u(t):
   Parameterizes the classic U-shaped morning and afternoon volume surges vs lunchtime drought:
       u(t) = \kappa \cdot \left[ 1.0 + \gamma \cdot (2t - 1)^2 + \alpha_1 \cos(2\pi t) \right]
   where \gamma \approx 2.5 controls U-bowl depth, \alpha_1 controls opening/closing asymmetry,
   and \kappa is the normalization constant ensuring \int_0^1 u(t) dt = 1.0.

3. Cumulative Volume Distribution F(t):
   Analytical integral of volume intensity:
       F(t) = \int_0^t u(s) ds, \quad F(0) = 0.0, \quad F(1.0) = 1.0

4. Optimal VWAP Execution Slicing:
   For parent order of size Q_{total} to be liquidated or acquired across K slices:
       q_k = Q_{total} \cdot [F(t_{k}) - F(t_{k-1})]

5. Diurnal Trading Regimes & Lunchtime Blackout Guard:
   - 09:15 - 10:30 IST (t \in [0.00, 0.20]): 'MORNING_EXPANSION' (High volume, high volatility, prime momentum)
   - 10:30 - 11:30 IST (t \in [0.20, 0.36]): 'TRANSITION_STABILIZATION'
   - 11:30 - 14:00 IST (t \in [0.36, 0.76]): 'LUNCHTIME_LIQUIDITY_DROUGHT' (Mean-reverting chop; breakout veto active)
   - 14:00 - 15:20 IST (t \in [0.76, 0.97]): 'AFTERNOON_INSTITUTIONAL_CLOSING' (High volume, European open spillover)
   - 15:20 - 15:30 IST (t \in [0.97, 1.00]): 'MOC_EXPIRY_AUCTION' (Square-off cascade)
"""

from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
import math
from typing import Dict, List, Optional, Tuple
import sqlite3


@dataclass
class IntradaySliceSchedule:
    slice_index: int
    scheduled_time: str  # HH:MM
    normalized_t: float
    target_shares: int
    cumulative_target_shares: int
    fraction_of_day: float


@dataclass
class DiurnalRegimeAssessment:
    timestamp: datetime
    minute_from_open: int
    normalized_t: float
    regime: str  # 'MORNING_EXPANSION', 'TRANSITION_STABILIZATION', 'LUNCHTIME_LIQUIDITY_DROUGHT', etc.
    volume_intensity_factor: float
    is_lunch_blackout_active: bool
    recommended_breakout_hurdle_multiplier: float


class DiurnalVolumeEngine:
    """
    Sub-millisecond Diurnal U-curve and optimal execution schedule engine.
    """

    def __init__(
        self,
        market_open_time: time = time(9, 15, 0),
        market_close_time: time = time(15, 30, 0),
        u_curve_gamma: float = 2.5,
        asymmetry_alpha: float = 0.20,
        db_path: str = ":memory:",
    ):
        self.market_open = market_open_time
        self.market_close = market_close_time
        self.gamma = u_curve_gamma
        self.alpha = asymmetry_alpha
        self.db_path = db_path

        # Total session minutes = 6 hours 15 mins = 375 mins
        self.session_minutes = 375

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
            CREATE TABLE IF NOT EXISTS diurnal_volume_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                minute_from_open INTEGER NOT NULL,
                normalized_t REAL NOT NULL,
                regime TEXT NOT NULL,
                intensity REAL NOT NULL,
                is_blackout INTEGER NOT NULL
            )
            """
        )
        conn.commit()

    def get_normalized_t(self, current_time: time) -> Tuple[int, float]:
        r"""
        Converts clock time into minute from open [0, 375] and normalized t \in [0.0, 1.0].
        """
        open_mins = self.market_open.hour * 60 + self.market_open.minute
        curr_mins = current_time.hour * 60 + current_time.minute

        delta = curr_mins - open_mins
        delta_clamped = min(max(delta, 0), self.session_minutes)
        norm_t = delta_clamped / float(self.session_minutes)
        return delta_clamped, norm_t

    def volume_intensity_u(self, t: float) -> float:
        """
        Analytical volume intensity function u(t).
        Higher in morning (t=0) and close (t=1), trough in middle (t=0.5).
        """
        clamped_t = min(max(t, 0.0), 1.0)
        u_raw = 1.0 + self.gamma * ((2.0 * clamped_t - 1.0) ** 2) + self.alpha * math.cos(2.0 * math.pi * clamped_t)
        # Normalization integral over [0, 1] of (1 + gamma*(2t-1)^2 + alpha*cos(2pi*t))
        # int_0^1 1 dt = 1.0
        # int_0^1 gamma*(2t-1)^2 dt = gamma/3
        # int_0^1 alpha*cos(2pi*t) dt = 0
        norm_constant = 1.0 + (self.gamma / 3.0)
        return max(u_raw / norm_constant, 0.05)

    def cumulative_volume_fraction_f(self, t: float) -> float:
        r"""
        Closed-form analytical integral F(t) = \int_0^t u(s) ds.
        F(0) = 0.0, F(1.0) = 1.0.
        """
        clamped_t = min(max(t, 0.0), 1.0)
        norm_constant = 1.0 + (self.gamma / 3.0)

        # int_0^t 1 ds = t
        term1 = clamped_t

        # int_0^t (2s-1)^2 ds = (4s^3/3 - 2s^2 + s)_0^t = (4/3)t^3 - 2t^2 + t
        term2 = self.gamma * ((4.0 / 3.0) * (clamped_t ** 3) - 2.0 * (clamped_t ** 2) + clamped_t)

        # int_0^t cos(2pi*s) ds = sin(2pi*t) / (2pi)
        term3 = self.alpha * (math.sin(2.0 * math.pi * clamped_t) / (2.0 * math.pi))

        integral_val = (term1 + term2 + term3) / norm_constant
        return min(max(integral_val, 0.0), 1.0)

    def generate_vwap_slice_schedule(
        self,
        total_shares: int,
        slice_interval_minutes: int = 15,
    ) -> List[IntradaySliceSchedule]:
        """
        Generates optimal VWAP order slicing schedule matching the diurnal curve.
        """
        num_slices = self.session_minutes // slice_interval_minutes
        schedules: List[IntradaySliceSchedule] = []

        cum_shares = 0
        open_dt = datetime(2026, 1, 1, self.market_open.hour, self.market_open.minute)

        for i in range(num_slices):
            t_start = (i * slice_interval_minutes) / float(self.session_minutes)
            t_end = ((i + 1) * slice_interval_minutes) / float(self.session_minutes)

            f_start = self.cumulative_volume_fraction_f(t_start)
            f_end = self.cumulative_volume_fraction_f(t_end)

            slice_fraction = f_end - f_start
            slice_shares = int(round(total_shares * slice_fraction))

            # Adjust last slice to ensure exact sum = total_shares
            if i == num_slices - 1:
                slice_shares = total_shares - cum_shares

            cum_shares += slice_shares
            slice_time = (open_dt + timedelta(minutes=i * slice_interval_minutes)).strftime("%H:%M")

            schedules.append(
                IntradaySliceSchedule(
                    slice_index=i + 1,
                    scheduled_time=slice_time,
                    normalized_t=round(t_start, 4),
                    target_shares=slice_shares,
                    cumulative_target_shares=cum_shares,
                    fraction_of_day=round(slice_fraction, 4),
                )
            )

        return schedules

    def assess_diurnal_regime(
        self,
        current_time: datetime,
    ) -> DiurnalRegimeAssessment:
        """
        Classifies current intraday period, volume intensity, and lunchtime blackout status.
        """
        minute_from_open, norm_t = self.get_normalized_t(current_time.time())
        intensity = self.volume_intensity_u(norm_t)

        # Regimes based on Indian market microstructure
        if norm_t < 0.20:  # 09:15 - 10:30
            regime = 'MORNING_EXPANSION'
            is_blackout = False
            hurdle_mult = 1.0  # Normal hurdle
        elif norm_t < 0.36:  # 10:30 - 11:30
            regime = 'TRANSITION_STABILIZATION'
            is_blackout = False
            hurdle_mult = 1.15
        elif norm_t < 0.76:  # 11:30 - 14:00 (Lunchtime drought)
            regime = 'LUNCHTIME_LIQUIDITY_DROUGHT'
            is_blackout = True
            hurdle_mult = 1.80  # Much higher hurdle to prevent false chop breakouts
        elif norm_t < 0.97:  # 14:00 - 15:20
            regime = 'AFTERNOON_INSTITUTIONAL_CLOSING'
            is_blackout = False
            hurdle_mult = 1.0
        else:  # 15:20 - 15:30
            regime = 'MOC_EXPIRY_AUCTION'
            is_blackout = False
            hurdle_mult = 1.50

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO diurnal_volume_telemetry (
                timestamp, minute_from_open, normalized_t, regime, intensity, is_blackout
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                current_time.isoformat(),
                minute_from_open,
                round(norm_t, 4),
                regime,
                round(intensity, 4),
                1 if is_blackout else 0,
            )
        )
        conn.commit()

        return DiurnalRegimeAssessment(
            timestamp=current_time,
            minute_from_open=minute_from_open,
            normalized_t=round(norm_t, 4),
            regime=regime,
            volume_intensity_factor=round(intensity, 4),
            is_lunch_blackout_active=is_blackout,
            recommended_breakout_hurdle_multiplier=hurdle_mult,
        )
