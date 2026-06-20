"""
Domain 162 (WP-BL): Real-Time Options Pin Risk & Max Pain Gamma Gravity Engine

Implements Avellaneda-Lipkin (2003) market-maker delta-hedging gamma gravity formulation,
Open Interest (OI) Max Pain strike minimization, sub-hourly expiry pin probability estimation,
and zero-DTE iron butterfly / pin-fading execution directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import List, Dict


@dataclass
class StrikeOpenInterest:
    strike: float
    call_oi: float
    put_oi: float
    call_gamma: float = 0.0
    put_gamma: float = 0.0


@dataclass
class PinRiskReport:
    symbol: str
    underlying_price: float
    max_pain_strike: float
    distance_to_pin_pts: float
    distance_to_pin_pct: float
    hours_to_expiry: float
    total_dealer_gamma: float
    pin_probability: float
    gamma_restoring_force: float
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class OptionsPinRiskEngine:
    """
    Real-Time Expiry Day Max Pain & Gamma Pinning Gravity Engine.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        pin_prob_hurdle: float = 0.65,
        max_pin_distance_pct: float = 0.75,
    ):
        self.db_path = db_path
        self.pin_prob_hurdle = pin_prob_hurdle
        self.max_pin_distance_pct = max_pin_distance_pct
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for pin risk telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS options_pin_risk_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                underlying_price REAL NOT NULL,
                max_pain_strike REAL NOT NULL,
                dist_pts REAL NOT NULL,
                dist_pct REAL NOT NULL,
                hours_left REAL NOT NULL,
                pin_prob REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def calculate_max_pain(strikes_oi: List[StrikeOpenInterest]) -> float:
        """
        Finds the settlement strike that minimizes total option payout:
        Loss(S) = sum Call_OI * max(0, S - K) + sum Put_OI * max(0, K - S)
        """
        if not strikes_oi:
            raise ValueError("Strikes OI list cannot be empty.")

        strikes = sorted([s.strike for s in strikes_oi])
        min_loss = float("inf")
        best_strike = strikes[0]

        for s_eval in strikes:
            total_loss = 0.0
            for item in strikes_oi:
                k = item.strike
                # Call payout
                if s_eval > k:
                    total_loss += item.call_oi * (s_eval - k)
                # Put payout
                if s_eval < k:
                    total_loss += item.put_oi * (k - s_eval)

            if total_loss < min_loss:
                min_loss = total_loss
                best_strike = s_eval

        return best_strike

    def evaluate_pin_risk(
        self,
        symbol: str,
        underlying_price: float,
        hours_to_expiry: float,
        strikes_oi: List[StrikeOpenInterest],
    ) -> PinRiskReport:
        """
        Computes Max Pain strike, evaluates dealer gamma gravitational pull,
        calculates probability of terminal pin, and issues execution directives.
        """
        max_pain = self.calculate_max_pain(strikes_oi)
        dist_pts = underlying_price - max_pain
        dist_pct = (abs(dist_pts) / max_pain) * 100.0

        # Calculate Total Dealer Net Gamma
        total_gamma = sum((s.call_oi * s.call_gamma + s.put_oi * s.put_gamma) for s in strikes_oi)

        # Avellaneda-Lipkin Pinning Probability Model
        # As tau -> 0 and distance -> 0, P_pin -> 1.0
        tau_effective = max(0.20, hours_to_expiry)
        sigma_pin = 0.003 * max_pain  # 30 bps typical pin bandwidth

        # Distance penalty
        dist_term = (dist_pts**2) / (2.0 * (sigma_pin**2) * (tau_effective / 2.0))
        dist_factor = math.exp(-min(20.0, dist_term))

        # Time urgency factor: pinning intensifies after 13:30 IST (tau <= 2.0 hrs)
        time_factor = 1.0 / (1.0 + math.exp(0.8 * (tau_effective - 2.5)))

        pin_prob = max(0.0, min(0.99, dist_factor * (0.40 + 0.60 * time_factor)))

        # Dealer Gamma Restoring Force F_pin = -kappa * (S - K_pain)
        kappa = 0.50 * math.log(max(1.0, total_gamma + 1.0))
        restoring_force = -kappa * dist_pts

        # Regime & Directives
        if hours_to_expiry <= 2.5 and dist_pct <= self.max_pin_distance_pct and pin_prob >= self.pin_prob_hurdle:
            regime = "IMMINENT_EXPIRY_STRIKE_PIN"
            directive = "FADE_TOWARD_PIN_STRIKE_IRON_BUTTERFLY"
        elif hours_to_expiry <= 2.5 and dist_pct > 1.50 and pin_prob < 0.25:
            regime = "GAMMA_PIN_ESCAPE_BREAKOUT"
            directive = "BUY_MOMENTUM_RUNNER_AWAY_FROM_STRIKE"
        elif hours_to_expiry > 5.0:
            regime = "EARLY_EXPIRY_CYCLE_MONITORING"
            directive = "STAND_ASIDE_WAIT_FINAL_SESSION"
        else:
            regime = "MODERATE_PIN_GRAVITY_ZONE"
            directive = "LEAN_ON_MAX_PAIN_MAGNET"

        report = PinRiskReport(
            symbol=symbol,
            underlying_price=round(underlying_price, 2),
            max_pain_strike=round(max_pain, 2),
            distance_to_pin_pts=round(dist_pts, 2),
            distance_to_pin_pct=round(dist_pct, 2),
            hours_to_expiry=round(hours_to_expiry, 2),
            total_dealer_gamma=round(total_gamma, 4),
            pin_probability=round(pin_prob, 4),
            gamma_restoring_force=round(restoring_force, 2),
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, report: PinRiskReport) -> None:
        """Persists audit record to SQLite database."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO options_pin_risk_telemetry (
                timestamp, symbol, underlying_price, max_pain_strike,
                dist_pts, dist_pct, hours_left, pin_prob, regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report.timestamp,
                report.symbol,
                report.underlying_price,
                report.max_pain_strike,
                report.distance_to_pin_pts,
                report.distance_to_pin_pct,
                report.hours_to_expiry,
                report.pin_probability,
                report.regime,
                report.trade_directive,
            ),
        )
        conn.commit()
