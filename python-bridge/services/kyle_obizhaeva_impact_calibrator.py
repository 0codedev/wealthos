r"""
Multi-Asset Kyle-Obizhaeva Invariance & Market Impact Calibrator (Domain 140 / WP-AP)
=====================================================================================

Autonomous institutional execution scheduling and transaction cost calibration engine
implementing the Kyle & Obizhaeva (2016) Market Microstructure Invariance Hypothesis,
non-linear square-root price impact laws, and optimal Percentage-of-Volume (POV) governors.

Mathematical Formulations:
--------------------------
1. Information Arrival Rate (Business Time Speed):
       I = \sigma_{\text{daily}} \cdot V_{\text{cash}} = \sigma_{\text{daily}} \cdot (P \cdot V_{\text{daily}}) \quad (\text{INR/day})

2. Invariant Bet Size Scaling:
       Q^* = c_0 \cdot \left(\frac{V_{\text{cash}}}{\sigma_{\text{daily}}}\right)^{1/3} \cdot \frac{1}{P} \quad (\text{shares})

3. Universal Square-Root Price Impact Law:
       \mathbb{E}\left[\frac{\Delta P}{P}\right] = Y \cdot \sigma_{\text{daily}} \cdot \sqrt{\frac{X}{V_{\text{daily}}}}
       \text{Impact}_{\text{bps}} = Y \cdot \sigma_{\text{daily}} \cdot \sqrt{\frac{X}{V_{\text{daily}}}} \times 10000 \quad (Y \approx 0.60)
       \text{Total Impact Cost (INR)} = X \cdot P \cdot \left(\frac{1}{2} \cdot \frac{\Delta P}{P}\right)

4. Optimal Percentage-of-Volume (POV) Governor:
       \text{POV}^* = \text{clip}\left(\left(\frac{\Delta P_{\text{max\_bps}} / 10000}{Y \cdot \sigma_{\text{daily}}}\right)^2, 0.01, 0.30\right)
"""

from dataclasses import dataclass
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class AssetMicrostructureData:
    symbol: str
    price: float
    daily_volume_shares: float
    daily_volatility: float  # e.g., 0.018 for 1.8% daily volatility


@dataclass
class OrderExecutionSpec:
    symbol: str
    order_size_shares: float
    side: str  # 'BUY' or 'SELL'
    max_acceptable_impact_bps: float = 25.0


@dataclass
class MarketImpactCalibrationReport:
    timestamp: datetime
    symbol: str
    order_size_shares: float
    daily_volume_shares: float
    volume_fraction_pct: float
    information_arrival_rate_cr: float  # In INR Crores
    invariant_bet_shares: float
    expected_impact_bps: float
    total_impact_cost_inr: float
    optimal_pov_rate: float  # e.g., 0.08 for 8% POV
    recommended_execution_style: str  # 'AGGRESSIVE_TWAP', 'PASSIVE_POV_ALGO', 'BLOCK_CROSSING_REQUIRED'
    rationale: str


class KyleObizhaevaImpactCalibrator:
    """
    Sub-millisecond Market Microstructure Invariance & Price Impact Calibrator.
    """

    def __init__(
        self,
        universal_y_constant: float = 0.60,
        invariant_scale_c0: float = 100.0,
        twap_impact_threshold_bps: float = 10.0,
        block_deal_impact_threshold_bps: float = 35.0,
        db_path: str = ":memory:",
    ):
        self.y_const = universal_y_constant
        self.c0 = invariant_scale_c0
        self.twap_thresh = twap_impact_threshold_bps
        self.block_thresh = block_deal_impact_threshold_bps
        self.db_path = db_path

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
            CREATE TABLE IF NOT EXISTS kyle_obizhaeva_impact_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                order_shares REAL NOT NULL,
                daily_volume REAL NOT NULL,
                impact_bps REAL NOT NULL,
                cost_inr REAL NOT NULL,
                optimal_pov REAL NOT NULL,
                execution_style TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def calibrate_order_impact(
        self,
        asset: AssetMicrostructureData,
        order: OrderExecutionSpec,
        timestamp: Optional[datetime] = None,
    ) -> MarketImpactCalibrationReport:
        now = timestamp if timestamp is not None else datetime.utcnow()

        P = max(asset.price, 0.01)
        V = max(asset.daily_volume_shares, 1.0)
        sigma = max(asset.daily_volatility, 0.001)
        X = max(order.order_size_shares, 1.0)

        # 1. Information arrival rate & Invariant bet size
        v_cash = P * V
        info_arrival_rate = sigma * v_cash  # in INR
        info_arrival_cr = round(info_arrival_rate / 1e7, 2)  # In Crores

        invariant_bet = round(self.c0 * ((v_cash / sigma) ** (1.0 / 3.0)) / P, 1)

        # 2. Square-Root Impact Law
        vol_fraction = X / V
        vol_fraction_pct = round(vol_fraction * 100.0, 3)

        impact_ratio = self.y_const * sigma * math.sqrt(vol_fraction)
        impact_bps = round(impact_ratio * 10000.0, 2)

        # Average execution price pays roughly 1/2 of permanent price degradation
        impact_cost_inr = round(X * P * (0.5 * impact_ratio), 2)

        # 3. Optimal POV participation rate to cap impact within max_acceptable_impact_bps
        target_bps = max(order.max_acceptable_impact_bps, 1.0)
        target_ratio = target_bps / 10000.0
        optimal_pov_raw = (target_ratio / (self.y_const * sigma)) ** 2
        optimal_pov = round(min(max(optimal_pov_raw, 0.01), 0.30), 3)

        # 4. Routing Decision & Style Recommendation
        if impact_bps <= self.twap_thresh:
            style = "AGGRESSIVE_TWAP"
            rationale = (
                f"Small order impact ({impact_bps:.1f} bps <= {self.twap_thresh:.1f} bps, {vol_fraction_pct:.2f}% of ADV). "
                f"Negligible market degradation (Cost=₹{impact_cost_inr:.0f}). Execute aggressive TWAP."
            )
        elif impact_bps >= self.block_thresh:
            style = "BLOCK_CROSSING_REQUIRED"
            rationale = (
                f"Severe market impact ({impact_bps:.1f} bps >= {self.block_thresh:.1f} bps, {vol_fraction_pct:.2f}% of ADV). "
                f"Estimated lit impact cost ₹{impact_cost_inr:.0f}. Route to institutional block deal window or dark pool."
            )
        else:
            style = "PASSIVE_POV_ALGO"
            rationale = (
                f"Moderate market impact ({impact_bps:.1f} bps, {vol_fraction_pct:.2f}% of ADV). "
                f"Slice order dynamically at optimal POV rate {optimal_pov*100:.1f}% to cap degradation."
            )

        # Persist to SQLite
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO kyle_obizhaeva_impact_telemetry (
                timestamp, symbol, order_shares, daily_volume, impact_bps,
                cost_inr, optimal_pov, execution_style
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now.isoformat(),
                order.symbol,
                X,
                V,
                impact_bps,
                impact_cost_inr,
                optimal_pov,
                style,
            ),
        )
        conn.commit()

        return MarketImpactCalibrationReport(
            timestamp=now,
            symbol=order.symbol,
            order_size_shares=X,
            daily_volume_shares=V,
            volume_fraction_pct=vol_fraction_pct,
            information_arrival_rate_cr=info_arrival_cr,
            invariant_bet_shares=invariant_bet,
            expected_impact_bps=impact_bps,
            total_impact_cost_inr=impact_cost_inr,
            optimal_pov_rate=optimal_pov,
            recommended_execution_style=style,
            rationale=rationale,
        )
