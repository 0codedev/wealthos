"""
Domain 184 (WP-CH): Options Implied Volatility Surface Skew Arbitrage & Risk Reversal Sieve

Implements 25-delta Risk Reversal (RR) and Butterfly (BF) surface decomposition,
normalized skew slope Z-scores, Breeden-Litzenberger butterfly convexity arbitrage bounds,
and delta-neutral options skew trade execution directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


class SkewArbitrageDirective(str, Enum):
    LONG_RISK_REVERSAL_CHEAP_CALLS = "LONG_RISK_REVERSAL_CHEAP_CALLS"  # Sell Rich Put, Buy Cheap Call
    SHORT_RISK_REVERSAL_CHEAP_PUTS = "SHORT_RISK_REVERSAL_CHEAP_PUTS"  # Sell Rich Call, Buy Cheap Put
    BUTTERFLY_CONVEXITY_ARBITRAGE = "BUTTERFLY_CONVEXITY_ARBITRAGE"  # Negative smile curvature violation
    NORMAL_EQUILIBRIUM_SKEW = "NORMAL_EQUILIBRIUM_SKEW"  # Skew within normal bounds


@dataclass
class OptionSmilePillars:
    symbol: str
    underlying_price: float
    days_to_expiry: float
    atm_vol: float  # \sigma_{ATM} (e.g. 0.15 = 15%)
    put_25d_vol: float  # \sigma_{25P} (e.g. 0.19 = 19%)
    call_25d_vol: float  # \sigma_{25C} (e.g. 0.13 = 13%)
    put_25d_strike: float
    call_25d_strike: float


@dataclass
class SkewEvaluationReport:
    symbol: str
    days_to_expiry: float
    atm_vol: float
    risk_reversal_25d: float  # \sigma_{25C} - \sigma_{25P}
    butterfly_25d: float  # 0.5 * (\sigma_{25C} + \sigma_{25P}) - \sigma_{ATM}
    skew_slope_per_100_pt: float
    z_score_skew: float
    directive: SkewArbitrageDirective
    rationale: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class IVSkewRiskReversalSieve:
    """
    Options Implied Volatility Surface Skew & Smile Convexity Sieve.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        baseline_mean_rr: float = -0.045,  # Typical NIFTY baseline 25d RR = -4.5%
        baseline_std_rr: float = 0.012,  # Baseline standard deviation = 1.2%
        extreme_z_threshold: float = 2.0,
    ):
        self.db_path = db_path
        self.mean_rr = baseline_mean_rr
        self.std_rr = baseline_std_rr
        self.z_thresh = extreme_z_threshold

        self._conn: Optional[sqlite3.Connection] = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for skew telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS iv_skew_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                dte REAL NOT NULL,
                atm_vol REAL NOT NULL,
                rr_25d REAL NOT NULL,
                bf_25d REAL NOT NULL,
                skew_slope REAL NOT NULL,
                z_score REAL NOT NULL,
                directive TEXT NOT NULL,
                rationale TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def evaluate_smile_skew(self, pillars: OptionSmilePillars) -> SkewEvaluationReport:
        """
        Decomposes 3-pillar volatility smile into 25d Risk Reversal and Butterfly.
        Evaluates skew steepness and Breeden-Litzenberger arbitrage bounds.
        """
        if pillars.atm_vol <= 0 or pillars.put_25d_vol <= 0 or pillars.call_25d_vol <= 0:
            raise ValueError("Implied volatilities must be strictly positive.")

        # 1. 25-Delta Risk Reversal: RR = Vol(25C) - Vol(25P)
        # Negative in equity indices (put skew)
        rr_25 = pillars.call_25d_vol - pillars.put_25d_vol

        # 2. 25-Delta Butterfly: BF = 0.5 * (Vol(25C) + Vol(25P)) - Vol(ATM)
        # Measures curvature; must be > 0 to prevent butterfly arbitrage
        bf_25 = 0.5 * (pillars.call_25d_vol + pillars.put_25d_vol) - pillars.atm_vol

        # 3. Skew slope: vol change per 100 points of underlying price move
        strike_diff = max(1.0, pillars.underlying_price - pillars.put_25d_strike)
        skew_slope = ((pillars.put_25d_vol - pillars.atm_vol) / strike_diff) * 100.0

        # 4. Statistical Z-Score of Risk Reversal against historical baseline
        z_score = (rr_25 - self.mean_rr) / self.std_rr if self.std_rr > 1e-6 else 0.0

        # 5. Regime classification and directives
        if bf_25 <= 0.001:  # Non-positive curvature violation
            directive = SkewArbitrageDirective.BUTTERFLY_CONVEXITY_ARBITRAGE
            rationale = (
                f"Negative smile curvature detected (BF_25={bf_25*100:.2f}% <= 0.1%). "
                f"Breeden-Litzenberger probability density violation; execute long butterfly (Buy wings, Sell ATM)."
            )
        elif z_score <= -self.z_thresh:
            directive = SkewArbitrageDirective.LONG_RISK_REVERSAL_CHEAP_CALLS
            rationale = (
                f"Extreme downside put skew (RR_25={rr_25*100:.2f}%, Z={z_score:.2f} sigma). "
                f"OTM Puts are excessively priced relative to calls; sell rich 25d Put and buy cheap 25d Call."
            )
        elif z_score >= self.z_thresh:
            directive = SkewArbitrageDirective.SHORT_RISK_REVERSAL_CHEAP_PUTS
            rationale = (
                f"Abnormally flat or inverted skew (RR_25={rr_25*100:.2f}%, Z={z_score:.2f} sigma). "
                f"Complacency or retail call buying; sell rich 25d Call and buy cheap 25d Put."
            )
        else:
            directive = SkewArbitrageDirective.NORMAL_EQUILIBRIUM_SKEW
            rationale = (
                f"Options volatility skew in equilibrium (RR_25={rr_25*100:.2f}%, BF_25={bf_25*100:.2f}%, "
                f"Z={z_score:.2f} sigma)."
            )

        report = SkewEvaluationReport(
            symbol=pillars.symbol,
            days_to_expiry=pillars.days_to_expiry,
            atm_vol=round(pillars.atm_vol, 4),
            risk_reversal_25d=round(rr_25, 4),
            butterfly_25d=round(bf_25, 4),
            skew_slope_per_100_pt=round(skew_slope, 4),
            z_score_skew=round(z_score, 2),
            directive=directive,
            rationale=rationale,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: SkewEvaluationReport) -> None:
        """Persists evaluation results to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO iv_skew_telemetry (
                timestamp, symbol, dte, atm_vol, rr_25d, bf_25d,
                skew_slope, z_score, directive, rationale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.days_to_expiry,
                rep.atm_vol,
                rep.risk_reversal_25d,
                rep.butterfly_25d,
                rep.skew_slope_per_100_pt,
                rep.z_score_skew,
                rep.directive.value,
                rep.rationale,
            ),
        )
        conn.commit()

    def get_latest_telemetry(self, limit: int = 10) -> List[Tuple]:
        """Retrieves latest telemetry entries."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT symbol, dte, atm_vol, rr_25d, bf_25d, z_score, directive
            FROM iv_skew_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
