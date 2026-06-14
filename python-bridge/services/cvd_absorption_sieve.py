r"""
Dynamic Order Flow CVD Imbalance & Microstructure Absorption Sieve (Domain 127 / WP-AC)
========================================================================================

Autonomous order flow Cumulative Volume Delta (CVD) divergence and passive institutional
absorption engine detecting hidden iceberg orders, absorption exhaustion (AR >= 3.0\sigma),
and high-conviction intraday reversal triggers for Indian equities and index futures.

Mathematical Specifications:
-----------------------------
1. Cumulative Volume Delta (\text{CVD}_t):
   For discrete trade arrivals k with price P_k and size s_k:
       \Delta V_k = \text{Sign}(P_k - P_{k-1}) \cdot s_k
       \text{CVD}_t = \sum_{k=1}^t \Delta V_k

2. Microstructure Absorption Ratio (AR_t):
   Measures the volume delta consumed per unit of price displacement:
       AR_t = \frac{|\Delta \text{CVD}_t|}{\max(|\Delta P_t|, \text{TickSize})}
   A massive volume delta with negligible price movement indicates heavy passive
   limit order replenishment (iceberg absorption).

3. Statistical Absorption Sieve (Z-Score):
   Over a rolling window of W bars:
       Z_{AR, t} = \frac{AR_t - \mu_{AR}}{\sigma_{AR}}
   Absorption is flagged when Z_{AR, t} \ge 3.0\sigma.

4. Directional Reversal Classifier:
   - Bullish Absorption:
       \Delta \text{CVD}_t < -V_{\text{threshold}} \quad \text{AND} \quad \Delta P_t \ge -\text{TickSize} \quad \text{AND} \quad Z_{AR, t} \ge 3.0
       -> Signal: 'BULLISH_ABSORPTION_REVERSAL'
   - Bearish Absorption:
       \Delta \text{CVD}_t > +V_{\text{threshold}} \quad \text{AND} \quad \Delta P_t \le +\text{TickSize} \quad \text{AND} \quad Z_{AR, t} \ge 3.0
       -> Signal: 'BEARISH_ABSORPTION_REVERSAL'
"""

from dataclasses import dataclass, field
from datetime import datetime
import math
from typing import Dict, List, Optional, Tuple
import sqlite3


@dataclass
class BarOrderFlow:
    bar_id: str
    symbol: str
    open_price: float
    high_price: float
    low_price: float
    close_price: float
    total_volume: int
    delta_volume: int  # Buy volume - Sell volume
    timestamp: datetime


@dataclass
class AbsorptionSignal:
    timestamp: datetime
    symbol: str
    signal_type: str  # 'BULLISH_ABSORPTION_REVERSAL', 'BEARISH_ABSORPTION_REVERSAL', 'NEUTRAL'
    bar_close: float
    delta_volume: int
    price_change: float
    absorption_ratio: float
    z_score: float
    is_actionable: bool
    confidence_score: float  # [0.0, 1.0]
    invalidation_stop_price: float
    rationale: str


class CVDAbsorptionSieve:
    """
    Sub-millisecond Cumulative Volume Delta & Institutional Absorption Sieve.
    """

    def __init__(
        self,
        tick_size: float = 0.05,
        rolling_window_bars: int = 20,
        z_score_threshold: float = 3.0,
        min_delta_imbalance_shares: int = 2000,
        db_path: str = ":memory:",
    ):
        self.tick_size = tick_size
        self.rolling_window = rolling_window_bars
        self.z_score_threshold = z_score_threshold
        self.min_delta_imbalance = min_delta_imbalance_shares
        self.db_path = db_path

        # Internal state per symbol
        self._history: Dict[str, List[BarOrderFlow]] = {}
        self._cumulative_cvd: Dict[str, int] = {}
        self._ar_history: Dict[str, List[float]] = {}

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
            CREATE TABLE IF NOT EXISTS cvd_absorption_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                signal_type TEXT NOT NULL,
                close_price REAL NOT NULL,
                delta_vol INTEGER NOT NULL,
                price_change REAL NOT NULL,
                z_score REAL NOT NULL,
                confidence REAL NOT NULL,
                stop_price REAL NOT NULL
            )
            """
        )
        conn.commit()

    def process_bar(
        self,
        bar: BarOrderFlow,
    ) -> AbsorptionSignal:
        """
        Ingests a completed order flow bar and evaluates absorption dynamics.
        """
        sym = bar.symbol
        if sym not in self._history:
            self._history[sym] = []
            self._cumulative_cvd[sym] = 0
            self._ar_history[sym] = []

        hist = self._history[sym]
        ar_hist = self._ar_history[sym]

        self._cumulative_cvd[sym] += bar.delta_volume
        hist.append(bar)
        if len(hist) > self.rolling_window * 2:
            hist.pop(0)

        price_change = bar.close_price - bar.open_price
        disp = max(abs(price_change), self.tick_size)

        # Absorption ratio: delta volume consumed per rupee of price movement
        ar = abs(bar.delta_volume) / disp
        ar_hist.append(ar)
        if len(ar_hist) > self.rolling_window * 2:
            ar_hist.pop(0)

        # Z-Score of absorption ratio over rolling window
        if len(ar_hist) >= 5:
            window_slice = ar_hist[-self.rolling_window:]
            mean_ar = sum(window_slice) / len(window_slice)
            var_ar = sum((x - mean_ar) ** 2 for x in window_slice) / len(window_slice)
            std_ar = math.sqrt(var_ar) if var_ar > 1e-9 else 1.0
            z_score = (ar - mean_ar) / std_ar
        else:
            z_score = 0.0

        # Classification
        signal_type = 'NEUTRAL'
        is_actionable = False
        confidence = 0.0
        stop_price = bar.low_price - self.tick_size
        rationale = "Order flow within normal statistical boundaries"

        # Case 1: Bullish Absorption (heavy aggressive selling absorbed by passive bids)
        if (
            bar.delta_volume <= -self.min_delta_imbalance and
            price_change >= -self.tick_size and
            z_score >= self.z_score_threshold
        ):
            signal_type = 'BULLISH_ABSORPTION_REVERSAL'
            is_actionable = True
            confidence = min(0.70 + (z_score - self.z_score_threshold) * 0.10, 0.98)
            stop_price = bar.low_price - self.tick_size
            rationale = (
                f"Severe aggressive selling ({bar.delta_volume} delta) fully absorbed "
                f"with price holding ({price_change:+.2f}). Z-score={z_score:.2f} sigma."
            )

        # Case 2: Bearish Absorption (heavy aggressive buying absorbed by passive offers)
        elif (
            bar.delta_volume >= self.min_delta_imbalance and
            price_change <= self.tick_size and
            z_score >= self.z_score_threshold
        ):
            signal_type = 'BEARISH_ABSORPTION_REVERSAL'
            is_actionable = True
            confidence = min(0.70 + (z_score - self.z_score_threshold) * 0.10, 0.98)
            stop_price = bar.high_price + self.tick_size
            rationale = (
                f"Severe aggressive buying ({bar.delta_volume} delta) fully absorbed "
                f"with price capped ({price_change:+.2f}). Z-score={z_score:.2f} sigma."
            )

        sig = AbsorptionSignal(
            timestamp=bar.timestamp,
            symbol=sym,
            signal_type=signal_type,
            bar_close=bar.close_price,
            delta_volume=bar.delta_volume,
            price_change=round(price_change, 2),
            absorption_ratio=round(ar, 2),
            z_score=round(z_score, 2),
            is_actionable=is_actionable,
            confidence_score=round(confidence, 3),
            invalidation_stop_price=round(stop_price, 2),
            rationale=rationale,
        )

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO cvd_absorption_telemetry (
                timestamp, symbol, signal_type, close_price, delta_vol,
                price_change, z_score, confidence, stop_price
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                bar.timestamp.isoformat(),
                sym,
                signal_type,
                bar.close_price,
                bar.delta_volume,
                sig.price_change,
                sig.z_score,
                sig.confidence_score,
                sig.invalidation_stop_price,
            )
        )
        conn.commit()

        return sig
