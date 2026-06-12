r"""
Cross-Maturity Calendar Spread Term Structure & Roll Yield Harvester (Domain 141 / WP-AQ)
========================================================================================

Autonomous futures term structure and rollover optimization engine implementing
the Cost-of-Carry pricing model, annualized roll yield \mathcal{R} harvesting,
calendar spread mispricing sieves, and expiry-week roll timing execution governors.

Mathematical Formulations:
--------------------------
1. Cost-of-Carry Theoretical Fair Spread:
       F^*(T) = S_0 \cdot \exp((r - q)T)
       \text{Spread}^* = F^*(T_2) - F^*(T_1) = S_0 \left[\exp((r - q)T_2) - \exp((r - q)T_1)\right]
       \Delta_{\text{misprice}} = \frac{(F_2 - F_1) - \text{Spread}^*}{S_0} \times 10000 \quad (\text{bps})

2. Annualized Roll Yield (\mathcal{R}):
       \Delta T_{\text{years}} = \frac{T_2 - T_1}{365.0}
       \mathcal{R} = -\frac{F(T_2) - F(T_1)}{F(T_1) \cdot \Delta T_{\text{years}}} \times 100\%
   - \mathcal{R} < 0: Contango (drag on long rollovers).
   - \mathcal{R} > 0: Backwardation (positive cash accretion on long rollovers).

3. Arbitrage & Rollover Sieve:
   - \Delta_{\text{misprice}} \ge +25.0 \text{ bps} \implies \text{SHORT\_CALENDAR\_SPREAD (Short Next, Long Near)}
   - \Delta_{\text{misprice}} \le -25.0 \text{ bps} \implies \text{LONG\_CALENDAR\_SPREAD (Long Next, Short Near)}
   - Expiry week (T_1 \le 4 days): Delay roll if super-contango (\mathcal{R} \le -12.0\%); roll immediately if backwardation.
"""

from dataclasses import dataclass
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class FuturesTermStructure:
    spot_price: float
    near_month_symbol: str
    near_month_price: float
    near_month_days_to_expiry: float
    next_month_symbol: str
    next_month_price: float
    next_month_days_to_expiry: float
    risk_free_rate: float = 0.065  # 6.5% RBI repo rate
    dividend_yield: float = 0.012  # 1.2% NIFTY dividend yield


@dataclass
class CalendarSpreadReport:
    timestamp: datetime
    spot_price: float
    market_spread_pts: float  # F_next - F_near
    theoretical_spread_pts: float
    spread_mispricing_bps: float
    annualized_roll_yield_pct: float
    market_structure: str  # 'CONTANGO_NORMAL', 'SUPER_CONTANGO_OVERPRICED', 'BACKWARDATION_INVERTED', 'UNDERPRICED_SPREAD'
    optimal_roll_timing: str  # 'ROLL_NOW', 'DELAY_ROLL', 'ROLL_GRADUALLY'
    arbitrage_signal: str  # 'LONG_CALENDAR_SPREAD', 'SHORT_CALENDAR_SPREAD', 'NEUTRAL'
    rationale: str


class CalendarSpreadRollEngine:
    """
    Sub-millisecond Futures Term Structure & Roll Yield Optimization Engine.
    """

    def __init__(
        self,
        mispricing_arbitrage_bps: float = 20.0,
        super_contango_yield_pct: float = -12.0,
        db_path: str = ":memory:",
    ):
        self.arb_bps = mispricing_arbitrage_bps
        self.super_contango_pct = super_contango_yield_pct
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
            CREATE TABLE IF NOT EXISTS calendar_spread_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                spot REAL NOT NULL,
                market_spread REAL NOT NULL,
                theoretical_spread REAL NOT NULL,
                mispricing_bps REAL NOT NULL,
                roll_yield REAL NOT NULL,
                structure TEXT NOT NULL,
                roll_timing TEXT NOT NULL,
                signal TEXT NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def calculate_theoretical_spread(ts: FuturesTermStructure) -> float:
        """
        Computes theoretical fair spread F*(T2) - F*(T1) using Cost-of-Carry.
        """
        S = ts.spot_price
        t1_years = max(ts.near_month_days_to_expiry / 365.0, 1e-4)
        t2_years = max(ts.next_month_days_to_expiry / 365.0, 1e-4)
        net_carry = ts.risk_free_rate - ts.dividend_yield

        f1_fair = S * math.exp(net_carry * t1_years)
        f2_fair = S * math.exp(net_carry * t2_years)
        return round(f2_fair - f1_fair, 2)

    @staticmethod
    def calculate_annualized_roll_yield(f_near: float, f_next: float, days_near: float, days_next: float) -> float:
        """
        Computes annualized roll yield:
        R = - (f_next - f_near) / (f_near * dt_years) * 100%
        """
        dt_years = max((days_next - days_near) / 365.0, 1.0 / 365.0)
        spread = f_next - f_near
        roll_yield = -(spread / max(f_near, 1.0)) * (1.0 / dt_years) * 100.0
        return round(roll_yield, 2)

    def evaluate_term_structure(
        self,
        ts: FuturesTermStructure,
        timestamp: Optional[datetime] = None,
    ) -> CalendarSpreadReport:
        now = timestamp if timestamp is not None else datetime.utcnow()

        mkt_spread = round(ts.next_month_price - ts.near_month_price, 2)
        fair_spread = self.calculate_theoretical_spread(ts)

        # Mispricing in bps of spot
        misprice_bps = round(((mkt_spread - fair_spread) / max(ts.spot_price, 1.0)) * 10000.0, 2)

        # Roll yield
        roll_yield = self.calculate_annualized_roll_yield(
            ts.near_month_price,
            ts.next_month_price,
            ts.near_month_days_to_expiry,
            ts.next_month_days_to_expiry,
        )

        is_expiry_week = ts.near_month_days_to_expiry <= 4.0

        # Classification & Signal Logic
        if mkt_spread < 0:
            structure = "BACKWARDATION_INVERTED"
            timing = "ROLL_NOW"
            sig = "LONG_CALENDAR_SPREAD"
            rationale = (
                f"Futures in backwardation (Spread={mkt_spread:+.2f} pts, Roll Yield=+{roll_yield:.1f}%). "
                f"Positive roll yield accretion. Execute rollover immediately."
            )
        elif misprice_bps >= self.arb_bps or roll_yield <= self.super_contango_pct:
            structure = "SUPER_CONTANGO_OVERPRICED"
            timing = "DELAY_ROLL" if is_expiry_week else "ROLL_GRADUALLY"
            sig = "SHORT_CALENDAR_SPREAD"
            rationale = (
                f"Super-contango penalty (Mispricing=+{misprice_bps:+.1f} bps, Roll Yield={roll_yield:.1f}%). "
                f"Calendar spread overpriced vs fair value ₹{fair_spread:.2f}. Short calendar spread / delay long rollover."
            )
        elif misprice_bps <= -self.arb_bps:
            structure = "UNDERPRICED_SPREAD"
            timing = "ROLL_NOW"
            sig = "LONG_CALENDAR_SPREAD"
            rationale = (
                f"Calendar spread underpriced by {abs(misprice_bps):.1f} bps vs fair carry ₹{fair_spread:.2f}. "
                f"Buy next month, sell near month to capture convergence."
            )
        else:
            structure = "CONTANGO_NORMAL"
            timing = "ROLL_GRADUALLY"
            sig = "NEUTRAL"
            rationale = (
                f"Normal contango term structure (Spread={mkt_spread:+.2f} pts vs fair ₹{fair_spread:.2f}, "
                f"Roll Yield={roll_yield:.1f}%). Standard TWAP rollover recommended."
            )

        # Persist to SQLite
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO calendar_spread_telemetry (
                timestamp, spot, market_spread, theoretical_spread, mispricing_bps,
                roll_yield, structure, roll_timing, signal
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now.isoformat(),
                ts.spot_price,
                mkt_spread,
                fair_spread,
                misprice_bps,
                roll_yield,
                structure,
                timing,
                sig,
            ),
        )
        conn.commit()

        return CalendarSpreadReport(
            timestamp=now,
            spot_price=ts.spot_price,
            market_spread_pts=mkt_spread,
            theoretical_spread_pts=fair_spread,
            spread_mispricing_bps=misprice_bps,
            annualized_roll_yield_pct=roll_yield,
            market_structure=structure,
            optimal_roll_timing=timing,
            arbitrage_signal=sig,
            rationale=rationale,
        )
