r"""
Intraday Order Flow Footprint Imbalance & POC Migration Engine (Domain 132 / WP-AH)
===================================================================================

Autonomous order flow footprint analysis and Market Profile auction engine
computing diagonal bid/ask imbalances, Point of Control (POC) dynamic migration
velocity, 70% Value Area (VAH/VAL), and auction unfinished business (poor highs/lows).

Mathematical Formulations:
--------------------------
1. Diagonal Order Flow Footprint Imbalance:
   Across adjacent price ticks P_k < P_{k+1}:
       \text{BuyImbalance}_{k+1} = \frac{\text{AskVol}_{k+1}}{\max(\text{BidVol}_k, 1)} \ge \theta_{\text{imb}} \quad (\theta = 3.0)
       \text{SellImbalance}_k = \frac{\text{BidVol}_k}{\max(\text{AskVol}_{k+1}, 1)} \ge \theta_{\text{imb}}
   Stacked Imbalances: \ge 3 consecutive adjacent price levels exhibiting directional imbalances.

2. Point of Control (POC) & Migration Velocity:
       P_{\text{POC}}(t) = \arg\max_P \text{TotalVolume}(P, t)
       v_{\text{POC}}(t) = \frac{P_{\text{POC}}(t) - P_{\text{POC}}(t - \Delta t)}{\Delta t} \quad (\text{pts/min})

3. Value Area 70% (VAH and VAL):
   Let V_{\text{total}} = \sum_k \text{TotalVol}(P_k).
   The Value Area encompasses prices around POC until:
       \sum_{P_k \in [\text{VAL}, \text{VAH}]} \text{TotalVol}(P_k) \ge 0.70 \cdot V_{\text{total}}

4. Unfinished Auction Extremes (Poor High / Poor Low):
   - Poor High: \text{AskVol}(P_{\text{high}}) > 0 \land \text{BidVol}(P_{\text{high}}) > \theta_{\text{min}} (not tapered).
   - Poor Low: \text{BidVol}(P_{\text{low}}) > 0 \land \text{AskVol}(P_{\text{low}}) > \theta_{\text{min}} (not tapered).
   Unfinished business mandates a high-probability mean-reverting retest of the extreme.
"""

from dataclasses import dataclass, field
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class PriceLevelVolume:
    price: float
    bid_vol: float  # aggressive selling into bid
    ask_vol: float  # aggressive buying at ask
    total_vol: float = 0.0
    delta: float = 0.0

    def __post_init__(self):
        self.total_vol = self.bid_vol + self.ask_vol
        self.delta = self.ask_vol - self.bid_vol


@dataclass
class BarFootprintTelemetry:
    timestamp: datetime
    bar_id: str
    open_p: float
    high_p: float
    low_p: float
    close_p: float
    total_volume: float
    net_delta: float
    poc_price: float
    vah_price: float
    val_price: float
    poc_velocity_pts_per_min: float
    stacked_buy_levels: List[float]
    stacked_sell_levels: List[float]
    has_poor_high: bool
    has_poor_low: bool
    regime: str  # 'TREND_EXPANSION_UP', 'TREND_EXPANSION_DOWN', 'BALANCED_ROTATION', 'UNFINISHED_BUSINESS_RETEST'
    auction_bias: str  # 'BULLISH', 'BEARISH', 'ROTATIONAL'
    execution_trigger: str


class OrderFlowPOCMigrationEngine:
    """
    Sub-millisecond Footprint Imbalance & Market Profile Auction Engine.
    """

    def __init__(
        self,
        imbalance_ratio_threshold: float = 3.0,
        stacked_levels_min: int = 3,
        min_imbalance_volume: float = 20.0,
        value_area_pct: float = 0.70,
        poc_velocity_threshold: float = 5.0,  # pts per min for trend expansion
        db_path: str = ":memory:",
    ):
        self.ratio_thresh = imbalance_ratio_threshold
        self.stacked_min = stacked_levels_min
        self.min_imb_vol = min_imbalance_volume
        self.va_pct = value_area_pct
        self.poc_vel_thresh = poc_velocity_threshold
        self.db_path = db_path

        self._last_poc: Optional[Tuple[float, datetime]] = None  # (poc_price, timestamp)
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
            CREATE TABLE IF NOT EXISTS order_flow_poc_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                bar_id TEXT NOT NULL,
                poc_price REAL NOT NULL,
                vah_price REAL NOT NULL,
                val_price REAL NOT NULL,
                poc_velocity REAL NOT NULL,
                net_delta REAL NOT NULL,
                poor_high INTEGER NOT NULL,
                poor_low INTEGER NOT NULL,
                regime TEXT NOT NULL,
                auction_bias TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def calculate_diagonal_imbalances(
        self, levels_sorted_asc: List[PriceLevelVolume]
    ) -> Tuple[List[float], List[float]]:
        """
        Calculates diagonal bid/ask imbalances and identifies stacked price levels.
        """
        if len(levels_sorted_asc) < 2:
            return [], []

        buy_imbalance_prices = []
        sell_imbalance_prices = []

        for i in range(len(levels_sorted_asc) - 1):
            lower = levels_sorted_asc[i]
            upper = levels_sorted_asc[i + 1]

            # Diagonal Buy Imbalance: Ask volume at upper >= ratio * Bid volume at lower
            if (
                upper.ask_vol >= self.min_imb_vol
                and upper.ask_vol >= lower.bid_vol * self.ratio_thresh
            ):
                buy_imbalance_prices.append(upper.price)

            # Diagonal Sell Imbalance: Bid volume at lower >= ratio * Ask volume at upper
            if (
                lower.bid_vol >= self.min_imb_vol
                and lower.bid_vol >= upper.ask_vol * self.ratio_thresh
            ):
                sell_imbalance_prices.append(lower.price)

        # Detect consecutive stacked clusters (>= stacked_min)
        stacked_buy = self._filter_stacked_levels(buy_imbalance_prices)
        stacked_sell = self._filter_stacked_levels(sell_imbalance_prices)

        return stacked_buy, stacked_sell

    def _filter_stacked_levels(self, prices: List[float]) -> List[float]:
        if len(prices) < self.stacked_min:
            return []
        stacked = []
        current_streak = [prices[0]]
        for i in range(1, len(prices)):
            # Assuming discrete tick difference
            if abs(prices[i] - prices[i - 1]) <= 5.05:  # within 5 pts step
                current_streak.append(prices[i])
            else:
                if len(current_streak) >= self.stacked_min:
                    stacked.extend(current_streak)
                current_streak = [prices[i]]
        if len(current_streak) >= self.stacked_min:
            stacked.extend(current_streak)
        return stacked

    def compute_poc_and_value_area(
        self, levels_sorted_asc: List[PriceLevelVolume]
    ) -> Tuple[float, float, float]:
        """
        Finds the Point of Control (POC) and 70% Value Area (VAH, VAL).
        """
        if not levels_sorted_asc:
            return 0.0, 0.0, 0.0

        total_vol = sum(lvl.total_vol for lvl in levels_sorted_asc)
        if total_vol <= 0:
            p = levels_sorted_asc[0].price
            return p, p, p

        # 1. Identify POC
        poc_node = max(levels_sorted_asc, key=lambda lvl: lvl.total_vol)
        poc_price = poc_node.price

        # 2. Dual-pointer expansion for 70% Value Area
        poc_idx = levels_sorted_asc.index(poc_node)
        target_vol = total_vol * self.va_pct
        accum_vol = poc_node.total_vol

        up_idx = poc_idx + 1
        down_idx = poc_idx - 1
        n = len(levels_sorted_asc)

        val_price = poc_price
        vah_price = poc_price

        while accum_vol < target_vol and (up_idx < n or down_idx >= 0):
            vol_up = levels_sorted_asc[up_idx].total_vol if up_idx < n else -1.0
            vol_down = levels_sorted_asc[down_idx].total_vol if down_idx >= 0 else -1.0

            if vol_up >= vol_down and up_idx < n:
                accum_vol += levels_sorted_asc[up_idx].total_vol
                vah_price = levels_sorted_asc[up_idx].price
                up_idx += 1
            elif down_idx >= 0:
                accum_vol += levels_sorted_asc[down_idx].total_vol
                val_price = levels_sorted_asc[down_idx].price
                down_idx -= 1
            else:
                break

        return round(poc_price, 2), round(vah_price, 2), round(val_price, 2)

    def detect_unfinished_extremes(
        self, levels_sorted_asc: List[PriceLevelVolume]
    ) -> Tuple[bool, bool]:
        """
        Detects Poor High / Poor Low (single print non-tapered aggressive extremes).
        """
        if len(levels_sorted_asc) < 3:
            return False, False

        lowest_lvl = levels_sorted_asc[0]
        highest_lvl = levels_sorted_asc[-1]

        # Poor High: substantial 2-way aggressive bidding at the absolute high (not tapered to 0 or 1)
        poor_high = highest_lvl.ask_vol >= self.min_imb_vol and highest_lvl.bid_vol >= self.min_imb_vol
        # Poor Low: substantial 2-way aggressive offering at the absolute low
        poor_low = lowest_lvl.bid_vol >= self.min_imb_vol and lowest_lvl.ask_vol >= self.min_imb_vol

        return poor_high, poor_low

    def process_bar_footprint(
        self,
        bar_id: str,
        open_p: float,
        high_p: float,
        low_p: float,
        close_p: float,
        level_volumes: List[PriceLevelVolume],
        timestamp: Optional[datetime] = None,
    ) -> BarFootprintTelemetry:
        now = timestamp if timestamp is not None else datetime.utcnow()
        sorted_lvls = sorted(level_volumes, key=lambda x: x.price)

        total_vol = sum(lvl.total_vol for lvl in sorted_lvls)
        net_delta = sum(lvl.delta for lvl in sorted_lvls)

        # 1. POC & Value Area
        poc, vah, val = self.compute_poc_and_value_area(sorted_lvls)

        # 2. POC Migration Velocity
        poc_vel = 0.0
        if self._last_poc is not None:
            last_poc_p, last_t = self._last_poc
            dt_min = max((now - last_t).total_seconds() / 60.0, 0.01)
            poc_vel = round((poc - last_poc_p) / dt_min, 2)
        self._last_poc = (poc, now)

        # 3. Stacked Imbalances
        stacked_buy, stacked_sell = self.calculate_diagonal_imbalances(sorted_lvls)

        # 4. Unfinished Business
        poor_high, poor_low = self.detect_unfinished_extremes(sorted_lvls)

        # 5. Classify Regime & Auction Bias
        if poor_high or poor_low:
            regime = "UNFINISHED_BUSINESS_RETEST"
            bias = "ROTATIONAL"
            trigger = (
                f"RETEST_PENDING_{'HIGH' if poor_high else 'LOW'}: Auction unfinished at extreme. "
                f"Target re-test before directional expansion."
            )
        elif poc_vel >= self.poc_vel_thresh and len(stacked_buy) >= self.stacked_min and net_delta > 0:
            regime = "TREND_EXPANSION_UP"
            bias = "BULLISH"
            trigger = f"LONG_EXPANSION: Upward POC migration ({poc_vel:+.1f} pts/min) supported by {len(stacked_buy)} stacked buy levels."
        elif poc_vel <= -self.poc_vel_thresh and len(stacked_sell) >= self.stacked_min and net_delta < 0:
            regime = "TREND_EXPANSION_DOWN"
            bias = "BEARISH"
            trigger = f"SHORT_EXPANSION: Downward POC migration ({poc_vel:+.1f} pts/min) supported by {len(stacked_sell)} stacked sell levels."
        else:
            regime = "BALANCED_ROTATION"
            bias = "ROTATIONAL"
            trigger = f"ROTATIONAL_RANGE: Trading within Value Area [{val:.2f} - {vah:.2f}]. Fade VAH/VAL boundaries."

        # Relational persistence
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO order_flow_poc_telemetry (
                timestamp, bar_id, poc_price, vah_price, val_price, poc_velocity,
                net_delta, poor_high, poor_low, regime, auction_bias
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now.isoformat(),
                bar_id,
                poc,
                vah,
                val,
                poc_vel,
                net_delta,
                1 if poor_high else 0,
                1 if poor_low else 0,
                regime,
                bias,
            ),
        )
        conn.commit()

        return BarFootprintTelemetry(
            timestamp=now,
            bar_id=bar_id,
            open_p=open_p,
            high_p=high_p,
            low_p=low_p,
            close_p=close_p,
            total_volume=total_vol,
            net_delta=net_delta,
            poc_price=poc,
            vah_price=vah,
            val_price=val,
            poc_velocity_pts_per_min=poc_vel,
            stacked_buy_levels=stacked_buy,
            stacked_sell_levels=stacked_sell,
            has_poor_high=poor_high,
            has_poor_low=poor_low,
            regime=regime,
            auction_bias=bias,
            execution_trigger=trigger,
        )
