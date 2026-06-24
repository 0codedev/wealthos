r"""
Intraday Volume Profile Point of Acceptance & Low Volume Node Rejector (Domain 138 / WP-AN)
===========================================================================================

Autonomous Volume Profile auction microstructure engine classifying High Volume Nodes
(HVN) as fair value acceptance attractors, Low Volume Nodes (LVN) as liquidity vacuum
rejectors, and calculating traversal velocities to execute directional expansion vs mean reversion.

Mathematical Formulations:
--------------------------
1. Volume Profile Discrete Histogram:
   For price bins P_1 < P_2 < \dots < P_K with volume V(P_k):
       \bar{V} = \frac{1}{K}\sum V(P_k), \quad \sigma_V = \sqrt{\frac{1}{K}\sum (V(P_k) - \bar{V})^2}

2. High Volume Node (HVN) Local Maxima:
       V(P_k) > V(P_{k-1}) \land V(P_k) > V(P_{k+1}) \land V(P_k) \ge \bar{V} + 0.8\sigma_V
   HVNs represent institutional fair value acceptance nodes where price consolidates.

3. Low Volume Node (LVN) Local Minima:
       V(P_k) < V(P_{k-1}) \land V(P_k) < V(P_{k+1}) \land V(P_k) \le \bar{V} - 0.5\sigma_V
   LVNs represent unfair auction prices and liquidity vacuums that cause rapid price acceleration.

4. Traversal Velocity & Rejection Sieve:
       v_{\text{traverse}} = \frac{\Delta P}{\Delta t} \quad (\text{pts/sec})
   - S_t \in \text{LVN} \land |v| \ge 2.0 \implies \text{FAST\_PASS\_THROUGH\_EXPANSION (Target next HVN)}
   - S_t \text{ near LVN boundary} \land |v| < 0.5 \implies \text{LVN\_BOUNDARY\_REJECTION (Fade back to HVN)}
   - S_t \in \text{HVN} \implies \text{HVN\_FAIR\_VALUE\_CHOP (Mean reversion)}
"""

from dataclasses import dataclass
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class ProfileBin:
    price: float
    volume: float
    time_spent_sec: float = 1.0


@dataclass
class VolumeProfileAnalysis:
    timestamp: datetime
    current_price: float
    nearest_hvn: float
    nearest_lvn: float
    is_in_lvn_vacuum: bool
    traversal_speed_pts_sec: float
    regime: str  # 'FAST_PASS_THROUGH_EXPANSION', 'LVN_BOUNDARY_REJECTION', 'HVN_FAIR_VALUE_CHOP'
    trade_recommendation: str
    stop_loss_anchor: float
    profit_target_anchor: float
    rationale: str


class VolumeProfileAcceptanceRejector:
    """
    Sub-millisecond Volume Profile Acceptance & LVN Rejection Engine.
    """

    def __init__(
        self,
        hvn_sigma_threshold: float = 0.8,
        lvn_sigma_threshold: float = -0.5,
        fast_pass_velocity_threshold: float = 2.0,  # pts/sec
        db_path: str = ":memory:",
    ):
        self.hvn_thresh = hvn_sigma_threshold
        self.lvn_thresh = lvn_sigma_threshold
        self.fast_pass_thresh = fast_pass_velocity_threshold
        self.db_path = db_path

        self._last_tick: Optional[Tuple[float, datetime]] = None  # (price, timestamp)
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
            CREATE TABLE IF NOT EXISTS volume_profile_acceptance_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                current_price REAL NOT NULL,
                nearest_hvn REAL NOT NULL,
                nearest_lvn REAL NOT NULL,
                is_in_vacuum INTEGER NOT NULL,
                traversal_speed REAL NOT NULL,
                regime TEXT NOT NULL,
                recommendation TEXT NOT NULL,
                stop_loss REAL NOT NULL,
                profit_target REAL NOT NULL
            )
            """
        )
        conn.commit()

    def identify_hvn_and_lvn(self, bins_sorted_asc: List[ProfileBin]) -> Tuple[List[float], List[float]]:
        """
        Identifies local volume maxima (HVNs) and local volume minima (LVNs).
        """
        n = len(bins_sorted_asc)
        if n < 5:
            return [], []

        volumes = [b.volume for b in bins_sorted_asc]
        mean_v = sum(volumes) / n
        var_v = sum((v - mean_v) ** 2 for v in volumes) / n
        std_v = math.sqrt(var_v) if var_v > 1e-4 else 1.0

        hvn_prices = []
        lvn_prices = []

        for i in range(1, n - 1):
            cur_v = bins_sorted_asc[i].volume
            prev_v = bins_sorted_asc[i - 1].volume
            next_v = bins_sorted_asc[i + 1].volume
            z_v = (cur_v - mean_v) / std_v

            # HVN: Local peak + high volume
            if cur_v >= prev_v and cur_v >= next_v and z_v >= self.hvn_thresh:
                hvn_prices.append(bins_sorted_asc[i].price)

            # LVN: Local trough + low volume
            if cur_v <= prev_v and cur_v <= next_v and z_v <= self.lvn_thresh:
                lvn_prices.append(bins_sorted_asc[i].price)

        return hvn_prices, lvn_prices

    def analyze_market_state(
        self,
        current_price: float,
        profile_bins: List[ProfileBin],
        timestamp: Optional[datetime] = None,
    ) -> VolumeProfileAnalysis:
        now = timestamp if timestamp is not None else datetime.utcnow()
        sorted_bins = sorted(profile_bins, key=lambda b: b.price)

        # 1. Traversal velocity
        speed = 0.0
        direction = 1.0
        if self._last_tick is not None:
            prev_p, prev_t = self._last_tick
            dt = max((now - prev_t).total_seconds(), 0.01)
            dp = current_price - prev_p
            speed = round(abs(dp) / dt, 2)
            direction = 1.0 if dp >= 0 else -1.0
        self._last_tick = (current_price, now)

        # 2. Extract HVN & LVN nodes
        hvns, lvns = self.identify_hvn_and_lvn(sorted_bins)

        # Fallbacks if distribution is uniform
        default_p = sorted_bins[len(sorted_bins) // 2].price if sorted_bins else current_price
        nearest_hvn = min(hvns, key=lambda p: abs(p - current_price)) if hvns else default_p
        nearest_lvn = min(lvns, key=lambda p: abs(p - current_price)) if lvns else default_p

        # Check if inside LVN vacuum zone (+/- 5 pts)
        in_vacuum = abs(current_price - nearest_lvn) <= 5.05 and bool(lvns)

        # 3. Formulate Auction Regimes
        if in_vacuum and speed >= self.fast_pass_thresh:
            regime = "FAST_PASS_THROUGH_EXPANSION"
            # Fast momentum pass through vacuum to next HVN
            if direction > 0:
                rec = "MOMENTUM_LONG_SWEEP"
                stop = round(nearest_lvn - 6.0, 2)
                # Next HVN above current price
                higher_hvns = [p for p in hvns if p > current_price]
                target = higher_hvns[0] if higher_hvns else round(current_price + 25.0, 2)
            else:
                rec = "MOMENTUM_SHORT_SWEEP"
                stop = round(nearest_lvn + 6.0, 2)
                lower_hvns = [p for p in hvns if p < current_price]
                target = lower_hvns[-1] if lower_hvns else round(current_price - 25.0, 2)
            rationale = (
                f"Price in LVN liquidity vacuum (LVN=₹{nearest_lvn:.2f}) with rapid traversal speed "
                f"({speed:.1f} pts/sec >= {self.fast_pass_thresh:.1f}). Rapid pass-through to target ₹{target:.2f}."
            )
        elif abs(current_price - nearest_lvn) <= 6.0 and speed < self.fast_pass_thresh and bool(lvns):
            regime = "LVN_BOUNDARY_REJECTION"
            # Bounce off boundary back to nearest HVN
            if current_price < nearest_lvn:
                rec = "FADE_REJECTION_SHORT"
                stop = round(nearest_lvn + 4.0, 2)
                target = nearest_hvn
            else:
                rec = "FADE_REJECTION_BUY"
                stop = round(nearest_lvn - 4.0, 2)
                target = nearest_hvn
            rationale = (
                f"Price stalling at LVN rejection threshold (LVN=₹{nearest_lvn:.2f}, speed={speed:.1f} pts/sec). "
                f"Unfair price rejection. Revert back to fair value HVN ₹{target:.2f}."
            )
        else:
            regime = "HVN_FAIR_VALUE_CHOP"
            rec = "MEAN_REVERSION_GRID"
            stop = round(current_price - 15.0 if direction > 0 else current_price + 15.0, 2)
            target = nearest_hvn
            rationale = (
                f"Trading near fair value node (Nearest HVN=₹{nearest_hvn:.2f}, dist={abs(current_price - nearest_hvn):.1f} pts). "
                f"Rotational balance dominant."
            )

        # Persist to SQLite
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO volume_profile_acceptance_telemetry (
                timestamp, current_price, nearest_hvn, nearest_lvn, is_in_vacuum,
                traversal_speed, regime, recommendation, stop_loss, profit_target
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now.isoformat(),
                current_price,
                nearest_hvn,
                nearest_lvn,
                1 if in_vacuum else 0,
                speed,
                regime,
                rec,
                stop,
                target,
            ),
        )
        conn.commit()

        return VolumeProfileAnalysis(
            timestamp=now,
            current_price=current_price,
            nearest_hvn=nearest_hvn,
            nearest_lvn=nearest_lvn,
            is_in_lvn_vacuum=in_vacuum,
            traversal_speed_pts_sec=speed,
            regime=regime,
            trade_recommendation=rec,
            stop_loss_anchor=stop,
            profit_target_anchor=target,
            rationale=rationale,
        )
