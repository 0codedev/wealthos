r"""
Microstructure Informed Trading Probability (VPIN & PIN) Engine (Domain 124 / WP-Z)
===================================================================================

Autonomous order flow toxicity and informed trading estimation engine implementing
Volume-Synchronized Probability of Toxicity (VPIN) and the Easley-Kiefer-O'Hara-
Paperman (EKOP) Probability of Informed Trading (PIN) model for Indian equities
and derivatives.

Mathematical Specifications:
-----------------------------
1. Volume-Synchronized Probability of Toxicity (VPIN):
   Trades are segmented into constant-volume buckets of size V (e.g. 1/50th of daily volume).
   For bucket \tau with trade volume partitioned into buy volume V_\tau^B and sell volume V_\tau^S:
       V_\tau^B + V_\tau^S = V
   Over a rolling window of N buckets:
       \text{VPIN} = \frac{\sum_{\tau=1}^N |V_\tau^B - V_\tau^S|}{N \times V} \in [0.0, 1.0]

2. Tick Rule & Bulk Volume Classification (BVC):
   Standard Tick Rule:
       \text{Sign}(P_k) = \begin{cases} +1, & \text{if } P_k > P_{k-1} \\ -1, & \text{if } P_k < P_{k-1} \\ \text{Sign}(P_{k-1}), & \text{if } P_k = P_{k-1} \end{cases}
   BVC Gaussian CDF mapping for continuous bars:
       V_\tau^B = V \cdot \Phi\left( \frac{\Delta P_\tau}{\sigma_{\Delta P}} \right), \quad V_\tau^S = V - V_\tau^B

3. The EKOP Probability of Informed Trading (PIN):
   Parameters:
       \alpha: Probability of an information event occurring
       \delta: Probability of bad news given an event
       \mu: Arrival intensity of informed orders
       \epsilon_b, \epsilon_s: Arrival intensity of uninformed buyers / sellers
   Unconditional PIN formulation:
       \text{PIN} = \frac{\alpha \mu}{\alpha \mu + \epsilon_b + \epsilon_s} = \frac{\alpha \mu}{\alpha \mu + 2\epsilon}

4. Toxicity Regime & Execution Veto Guard:
   - \text{VPIN} < 0.25: BENIGN_LIQUIDITY (Safe for passive market making)
   - 0.25 \le \text{VPIN} \le 0.45: MODERATE_FLOW (Standard execution)
   - \text{VPIN} > 0.45: TOXIC_ADVERSE_FLOW (Veto passive orders, enforce taker IOC or widen SL)
"""

from dataclasses import dataclass, field
from datetime import datetime
import math
from typing import Dict, List, Optional, Tuple
import sqlite3


@dataclass
class TradeTick:
    symbol: str
    price: float
    size: int
    timestamp: datetime


@dataclass
class VolumeBucket:
    bucket_index: int
    symbol: str
    buy_volume: float
    sell_volume: float
    total_volume: float
    start_time: datetime
    end_time: datetime


@dataclass
class VPINMetrics:
    timestamp: datetime
    symbol: str
    vpin: float
    vpin_percentile: float
    rolling_buckets_count: int
    regime: str  # 'BENIGN_LIQUIDITY', 'MODERATE_FLOW', 'TOXIC_ADVERSE_FLOW'
    is_passive_veto_active: bool
    recommended_spread_multiplier: float


@dataclass
class EKOPParameters:
    alpha: float  # Information event probability
    delta: float  # Bad news probability
    mu: float  # Informed arrival intensity
    epsilon: float  # Uninformed arrival intensity
    pin_value: float  # PIN in [0.0, 1.0]


class InformedTradingVPINEngine:
    """
    Sub-millisecond VPIN and PIN informed trading analytics engine.
    """

    def __init__(
        self,
        bucket_size: int = 5000,  # e.g., 5,000 shares per bucket
        rolling_buckets_window: int = 20,
        toxic_vpin_threshold: float = 0.45,
        benign_vpin_threshold: float = 0.25,
        db_path: str = ":memory:",
    ):
        self.bucket_size = bucket_size
        self.rolling_buckets_window = rolling_buckets_window
        self.toxic_vpin_threshold = toxic_vpin_threshold
        self.benign_vpin_threshold = benign_vpin_threshold
        self.db_path = db_path

        # Internal state per symbol
        self._last_price: Dict[str, float] = {}
        self._last_tick_direction: Dict[str, int] = {}  # +1 for buy, -1 for sell
        self._current_bucket: Dict[str, Dict] = {}
        self._completed_buckets: Dict[str, List[VolumeBucket]] = {}

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
            CREATE TABLE IF NOT EXISTS vpin_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                vpin REAL NOT NULL,
                regime TEXT NOT NULL,
                veto_active INTEGER NOT NULL,
                spread_mult REAL NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def standard_normal_cdf(x: float) -> float:
        return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

    def calculate_ekop_pin(
        self,
        alpha: float,
        mu: float,
        epsilon: float,
    ) -> float:
        r"""
        Calculates theoretical EKOP PIN value:
            PIN = (\alpha * \mu) / (\alpha * \mu + 2 * \epsilon)
        """
        clamped_alpha = min(max(alpha, 0.0), 1.0)
        clamped_mu = max(mu, 0.0)
        clamped_eps = max(epsilon, 1e-6)

        denom = (clamped_alpha * clamped_mu) + (2.0 * clamped_eps)
        if denom <= 0:
            return 0.0

        pin = (clamped_alpha * clamped_mu) / denom
        return min(max(pin, 0.0), 1.0)

    def process_trade_tick(
        self,
        tick: TradeTick,
    ) -> Optional[VPINMetrics]:
        """
        Ingests a live trade tick, applies tick classification, aggregates
        into volume buckets, and computes rolling VPIN metric.
        """
        sym = tick.symbol
        prev_p = self._last_price.get(sym, tick.price)
        prev_dir = self._last_tick_direction.get(sym, 1)

        # Tick rule classification
        if tick.price > prev_p:
            direction = 1
        elif tick.price < prev_p:
            direction = -1
        else:
            direction = prev_dir

        self._last_price[sym] = tick.price
        self._last_tick_direction[sym] = direction

        # Accumulate in current volume bucket
        if sym not in self._current_bucket:
            self._current_bucket[sym] = {
                'buy_vol': 0,
                'sell_vol': 0,
                'start_time': tick.timestamp,
                'bucket_idx': len(self._completed_buckets.get(sym, [])),
            }

        cb = self._current_bucket[sym]
        remaining_in_tick = tick.size

        while remaining_in_tick > 0:
            current_total = cb['buy_vol'] + cb['sell_vol']
            space_in_bucket = self.bucket_size - current_total

            fill_qty = min(remaining_in_tick, space_in_bucket)
            if direction == 1:
                cb['buy_vol'] += fill_qty
            else:
                cb['sell_vol'] += fill_qty

            remaining_in_tick -= fill_qty

            # If bucket reached capacity, seal it
            if cb['buy_vol'] + cb['sell_vol'] >= self.bucket_size:
                sealed = VolumeBucket(
                    bucket_index=cb['bucket_idx'],
                    symbol=sym,
                    buy_volume=cb['buy_vol'],
                    sell_volume=cb['sell_vol'],
                    total_volume=cb['buy_vol'] + cb['sell_vol'],
                    start_time=cb['start_time'],
                    end_time=tick.timestamp,
                )
                if sym not in self._completed_buckets:
                    self._completed_buckets[sym] = []
                self._completed_buckets[sym].append(sealed)

                # Reset new bucket
                cb['buy_vol'] = 0
                cb['sell_vol'] = 0
                cb['start_time'] = tick.timestamp
                cb['bucket_idx'] = len(self._completed_buckets[sym])

        # Compute rolling VPIN if we have at least 1 completed bucket
        buckets = self._completed_buckets.get(sym, [])
        if not buckets:
            return None

        window_buckets = buckets[-self.rolling_buckets_window:]
        total_imbalance = sum(abs(b.buy_volume - b.sell_volume) for b in window_buckets)
        total_vol = sum(b.total_volume for b in window_buckets)

        vpin = total_imbalance / float(total_vol) if total_vol > 0 else 0.0
        vpin = min(max(vpin, 0.0), 1.0)

        # Classify toxicity regime
        if vpin >= self.toxic_vpin_threshold:
            regime = 'TOXIC_ADVERSE_FLOW'
            veto_active = True
            spread_mult = 2.0 + (vpin - self.toxic_vpin_threshold) * 4.0
        elif vpin <= self.benign_vpin_threshold:
            regime = 'BENIGN_LIQUIDITY'
            veto_active = False
            spread_mult = 1.0
        else:
            regime = 'MODERATE_FLOW'
            veto_active = False
            spread_mult = 1.25

        metrics = VPINMetrics(
            timestamp=tick.timestamp,
            symbol=sym,
            vpin=round(vpin, 4),
            vpin_percentile=round(vpin * 100.0, 1),
            rolling_buckets_count=len(window_buckets),
            regime=regime,
            is_passive_veto_active=veto_active,
            recommended_spread_multiplier=round(spread_mult, 2),
        )

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO vpin_telemetry (
                timestamp, symbol, vpin, regime, veto_active, spread_mult
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                tick.timestamp.isoformat(),
                sym,
                metrics.vpin,
                regime,
                1 if veto_active else 0,
                metrics.recommended_spread_multiplier,
            )
        )
        conn.commit()

        return metrics
