"""
Domain 165 (WP-BO): Real-Time Options Surface Local Volatility Dupire Inversion Engine

Implements Bruno Dupire's (1994) continuous local volatility PDE inversion from European call
price surfaces, finite-difference strike and maturity partial derivatives, Breeden-Litzenberger
risk-neutral probability density verification, and exotic derivative pricing grid calibration.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import Dict, Tuple, List, Optional


@dataclass
class CallGridPoint:
    strike: float
    maturity_years: float
    call_price: float


@dataclass
class LocalVolReport:
    symbol: str
    strike: float
    maturity_years: float
    local_vol: float
    dC_dT: float
    dC_dK: float
    d2C_dK2: float
    is_arbitrage_free: bool
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class DupireLocalVolatilityEngine:
    """
    Dupire (1994) Local Volatility PDE Inversion Engine.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        risk_free_rate: float = 0.065,  # 6.5% standard Indian sovereign rate
        min_local_vol: float = 0.05,
        max_local_vol: float = 1.50,
    ):
        self.db_path = db_path
        self.risk_free_rate = risk_free_rate
        self.min_local_vol = min_local_vol
        self.max_local_vol = max_local_vol
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for Dupire local volatility telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS dupire_local_vol_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                strike REAL NOT NULL,
                maturity REAL NOT NULL,
                local_vol REAL NOT NULL,
                dC_dT REAL NOT NULL,
                dC_dK REAL NOT NULL,
                d2C_dK2 REAL NOT NULL,
                is_valid INTEGER NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def calculate_local_variance(
        self,
        strike: float,
        maturity: float,
        c_k_t: float,
        c_k_plus_t: float,
        c_k_minus_t: float,
        c_k_t_plus: float,
        delta_k: float,
        delta_t: float,
    ) -> Tuple[float, float, float, float, bool]:
        """
        Calculates Dupire local variance via finite difference derivatives:
        dC/dT = (C(K, T + dT) - C(K, T)) / dT
        dC/dK = (C(K + dK, T) - C(K - dK, T)) / (2 * dK)
        d2C/dK2 = (C(K + dK, T) - 2 * C(K, T) + C(K - dK, T)) / (dK^2)
        local_var = (dC/dT + r * K * dC/dK) / (0.5 * K^2 * d2C/dK2)
        """
        if delta_k <= 0 or delta_t <= 0 or strike <= 0:
            raise ValueError("Strike and deltas must be strictly positive.")

        # Partial derivatives
        dc_dt = (c_k_t_plus - c_k_t) / delta_t
        dc_dk = (c_k_plus_t - c_k_minus_t) / (2.0 * delta_k)
        d2c_dk2 = (c_k_plus_t - 2.0 * c_k_t + c_k_minus_t) / (delta_k**2)

        # Numerator: dC/dT + r * K * dC/dK
        numerator = dc_dt + (self.risk_free_rate * strike * dc_dk)

        # Denominator: 0.5 * K^2 * d2C/dK2
        denominator = 0.5 * (strike**2) * d2c_dk2

        # Arbitrage checks
        is_arbitrage_free = True
        if d2c_dk2 <= 1e-7:
            # Butterfly convexity violation (Breeden-Litzenberger negative probability density!)
            is_arbitrage_free = False
            local_var = self.min_local_vol**2
        elif numerator <= 0:
            # Calendar negative variance violation
            is_arbitrage_free = False
            local_var = self.min_local_vol**2
        else:
            local_var = numerator / denominator

        # Clamp variance to physical boundaries
        clamped_var = max(self.min_local_vol**2, min(self.max_local_vol**2, local_var))
        return clamped_var, dc_dt, dc_dk, d2c_dk2, is_arbitrage_free

    def evaluate_dupire_local_vol(
        self,
        symbol: str,
        strike: float,
        maturity: float,
        c_k_t: float,
        c_k_plus_t: float,
        c_k_minus_t: float,
        c_k_t_plus: float,
        delta_k: float,
        delta_t: float,
    ) -> LocalVolReport:
        """
        Computes local volatility, validates absence of static surface arbitrage,
        and generates PDE exotic pricing calibration report.
        """
        local_var, dc_dt, dc_dk, d2c_dk2, is_arb_free = self.calculate_local_variance(
            strike=strike,
            maturity=maturity,
            c_k_t=c_k_t,
            c_k_plus_t=c_k_plus_t,
            c_k_minus_t=c_k_minus_t,
            c_k_t_plus=c_k_t_plus,
            delta_k=delta_k,
            delta_t=delta_t,
        )

        local_vol = math.sqrt(local_var)

        if not is_arb_free:
            if d2c_dk2 <= 1e-7:
                regime = "BUTTERFLY_CONVEXITY_ARBITRAGE_DETECTED"
                directive = "EXECUTE_STATIC_BUTTERFLY_ARBITRAGE"
            else:
                regime = "CALENDAR_NEGATIVE_TIME_DECAY_VIOLATION"
                directive = "EXECUTE_CALENDAR_SPREAD_ARBITRAGE"
        else:
            regime = "DUPIRE_LOCAL_VOLATILITY_CALIBRATED"
            directive = "VALID_FOR_EXOTIC_BARRIER_PDE_PRICING"

        report = LocalVolReport(
            symbol=symbol,
            strike=round(strike, 2),
            maturity_years=round(maturity, 4),
            local_vol=round(local_vol, 4),
            dC_dT=round(dc_dt, 4),
            dC_dK=round(dc_dk, 4),
            d2C_dK2=round(d2c_dk2, 6),
            is_arbitrage_free=is_arb_free,
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, report: LocalVolReport) -> None:
        """Persists audit record to SQLite database."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO dupire_local_vol_telemetry (
                timestamp, symbol, strike, maturity, local_vol,
                dC_dT, dC_dK, d2C_dK2, is_valid, regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report.timestamp,
                report.symbol,
                report.strike,
                report.maturity_years,
                report.local_vol,
                report.dC_dT,
                report.dC_dK,
                report.d2C_dK2,
                1 if report.is_arbitrage_free else 0,
                report.regime,
                report.trade_directive,
            ),
        )
        conn.commit()
