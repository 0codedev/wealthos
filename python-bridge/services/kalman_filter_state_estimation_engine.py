"""
Domain 188 (WP-CL): Continuous-Time Multi-Asset Kalman Filter State Estimation Engine

Implements state-space true equilibrium price and drift extraction, discrete Kalman filtering,
measurement noise variance R (bid-ask bounce decoupling), dynamic pairs hedge ratio tracking,
and signal-to-noise filtered trend/mean-reversion execution directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


class KalmanDirective(str, Enum):
    MOMENTUM_TREND_DRIFT_LONG = "MOMENTUM_TREND_DRIFT_LONG"
    MOMENTUM_TREND_DRIFT_SHORT = "MOMENTUM_TREND_DRIFT_SHORT"
    MEAN_REVERSION_NOISE_FADE = "MEAN_REVERSION_NOISE_FADE"
    STABLE_EQUILIBRIUM_FILTER = "STABLE_EQUILIBRIUM_FILTER"


@dataclass
class KalmanPriceState:
    symbol: str
    true_price: float  # Estimated latent true price
    price_variance: float  # Posterior variance P_00
    latent_drift: float  # Estimated velocity \mu (price units / sec)
    drift_variance: float  # Posterior variance P_11
    innovation_residual: float  # Observed - Predicted (y - H*x)
    innovation_uncertainty: float  # S = H*P*H^T + R
    z_score_residual: float  # \tilde{y} / \sqrt{S}
    kalman_gain_price: float
    kalman_gain_drift: float
    directive: KalmanDirective
    rationale: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class KalmanFilterStateEstimationEngine:
    """
    Sub-second Continuous-Discrete Kalman Filter for True Price & Drift Tracking.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        process_noise_q: float = 1e-3,  # Acceleration spectral density q
        observation_noise_r: float = 0.05,  # Microstructure bounce variance R
        drift_significance_z: float = 2.0,
        noise_fade_z: float = 2.2,
    ):
        self.db_path = db_path
        self.q = process_noise_q
        self.r = observation_noise_r
        self.drift_z_thresh = drift_significance_z
        self.fade_z_thresh = noise_fade_z

        # Per-symbol state: [p, mu]^T and 2x2 covariance P
        self._states: Dict[str, List[float]] = {}  # [price, drift]
        self._covs: Dict[str, List[List[float]]] = {}  # [[P00, P01], [P10, P11]]
        self._last_t: Dict[str, float] = {}

        self._conn: Optional[sqlite3.Connection] = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for Kalman filter telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS kalman_filter_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                true_price REAL NOT NULL,
                latent_drift REAL NOT NULL,
                innovation REAL NOT NULL,
                z_score REAL NOT NULL,
                k_gain_price REAL NOT NULL,
                directive TEXT NOT NULL,
                rationale TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def update(
        self,
        symbol: str,
        observed_price: float,
        timestamp_sec: float,
    ) -> KalmanPriceState:
        """
        Processes new tick/bar price observation through 2D Kalman filter.
        State vector: [p, mu]^T
        """
        # Initialization
        if symbol not in self._states:
            self._states[symbol] = [observed_price, 0.0]
            self._covs[symbol] = [[self.r, 0.0], [0.0, 1.0]]
            self._last_t[symbol] = timestamp_sec

            rep = KalmanPriceState(
                symbol=symbol,
                true_price=observed_price,
                price_variance=self.r,
                latent_drift=0.0,
                drift_variance=1.0,
                innovation_residual=0.0,
                innovation_uncertainty=self.r,
                z_score_residual=0.0,
                kalman_gain_price=0.5,
                kalman_gain_drift=0.0,
                directive=KalmanDirective.STABLE_EQUILIBRIUM_FILTER,
                rationale="Initialized latent state at observed price.",
            )
            self._record_telemetry(rep)
            return rep

        dt = max(1e-4, timestamp_sec - self._last_t[symbol])
        self._last_t[symbol] = timestamp_sec

        x_prev = self._states[symbol]
        P_prev = self._covs[symbol]

        # 1. State Prediction: x_{k|k-1} = F * x_{k-1|k-1}
        # F = [[1, dt], [0, 1]]
        p_pred = x_prev[0] + dt * x_prev[1]
        mu_pred = x_prev[1]

        # 2. Covariance Prediction: P_{k|k-1} = F * P * F^T + Q
        # Q = q * [[dt^3/3, dt^2/2], [dt^2/2, dt]]
        q00 = self.q * (dt ** 3) / 3.0
        q01 = self.q * (dt ** 2) / 2.0
        q11 = self.q * dt

        # F * P * F^T
        fp00 = P_prev[0][0] + dt * P_prev[1][0]
        fp01 = P_prev[0][1] + dt * P_prev[1][1]
        fp10 = P_prev[1][0]
        fp11 = P_prev[1][1]

        p00_pred = (fp00 + dt * fp01) + q00
        p01_pred = fp01 + q01
        p10_pred = (fp10 + dt * fp11) + q01
        p11_pred = fp11 + q11

        # 3. Measurement Innovation: y_tilde = y - H * x_pred (H = [1, 0])
        y_tilde = observed_price - p_pred

        # 4. Innovation Covariance: S = H * P_pred * H^T + R = p00_pred + R
        S = p00_pred + self.r

        # 5. Kalman Gain: K = P_pred * H^T * S^-1 = [p00_pred / S, p10_pred / S]^T
        k0 = p00_pred / S
        k1 = p10_pred / S

        # 6. State Update: x_{k|k} = x_pred + K * y_tilde
        p_upd = p_pred + k0 * y_tilde
        mu_upd = mu_pred + k1 * y_tilde

        # 7. Covariance Update: P_{k|k} = (I - K * H) * P_pred
        p00_upd = (1.0 - k0) * p00_pred
        p01_upd = (1.0 - k0) * p01_pred
        p10_upd = p10_pred - k1 * p00_pred
        p11_upd = p11_pred - k1 * p01_pred

        # Store updated state
        self._states[symbol] = [p_upd, mu_upd]
        self._covs[symbol] = [[p00_upd, p01_upd], [p10_upd, p11_upd]]

        # Statistical analysis
        z_res = y_tilde / math.sqrt(S) if S > 0 else 0.0
        drift_std = math.sqrt(max(1e-8, p11_upd))
        z_drift = mu_upd / drift_std

        # Directives
        prior_drift = x_prev[1]
        prior_drift_std = math.sqrt(max(1e-8, P_prev[1][1]))
        z_prior_drift = prior_drift / prior_drift_std

        if abs(z_res) >= self.fade_z_thresh and abs(z_prior_drift) < 1.0:
            directive = KalmanDirective.MEAN_REVERSION_NOISE_FADE
            rationale = (
                f"Transient price excursion ({y_tilde:+.2f}, Z_res={z_res:.2f} sigma) on calm prior drift "
                f"({prior_drift:.4f}/s). Bid-ask bounce overextension; fade back toward latent price {p_upd:.2f}."
            )
        elif z_drift >= self.drift_z_thresh:
            directive = KalmanDirective.MOMENTUM_TREND_DRIFT_LONG
            rationale = (
                f"Statistically significant upward true price drift (+{mu_upd:.4f}/s, Z={z_drift:.2f} sigma). "
                f"Microstructure noise filtered out; follow persistent institutional accumulation."
            )
        elif z_drift <= -self.drift_z_thresh:
            directive = KalmanDirective.MOMENTUM_TREND_DRIFT_SHORT
            rationale = (
                f"Statistically significant downward true price drift ({mu_upd:.4f}/s, Z={z_drift:.2f} sigma). "
                f"Follow persistent institutional distribution."
            )
        else:
            directive = KalmanDirective.STABLE_EQUILIBRIUM_FILTER
            rationale = (
                f"Latent price in equilibrium (True={p_upd:.2f}, Drift={mu_upd:.4f}/s, Z_res={z_res:.2f})."
            )

        report = KalmanPriceState(
            symbol=symbol,
            true_price=round(p_upd, 4),
            price_variance=round(p00_upd, 6),
            latent_drift=round(mu_upd, 6),
            drift_variance=round(p11_upd, 6),
            innovation_residual=round(y_tilde, 4),
            innovation_uncertainty=round(S, 6),
            z_score_residual=round(z_res, 2),
            kalman_gain_price=round(k0, 4),
            kalman_gain_drift=round(k1, 4),
            directive=directive,
            rationale=rationale,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: KalmanPriceState) -> None:
        """Persists Kalman telemetry into SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO kalman_filter_telemetry (
                timestamp, symbol, true_price, latent_drift, innovation,
                z_score, k_gain_price, directive, rationale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.true_price,
                rep.latent_drift,
                rep.innovation_residual,
                rep.z_score_residual,
                rep.kalman_gain_price,
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
            SELECT symbol, true_price, latent_drift, innovation, z_score, directive
            FROM kalman_filter_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
