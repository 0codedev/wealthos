r"""
Hawkes Self-Exciting Jump Process & Order Arrival Intensity Sieve (Domain 139 / WP-AO)
======================================================================================

Autonomous microsecond point process and algorithmic cascade surveillance engine
implementing bivariate Hawkes self-exciting jump intensities, recursive O(1)
exponential decay updating, branching ratio reflexivity \eta = \alpha/\beta, and
spectral radius \rho(\mathbf{\Gamma}) cascade risk sentry.

Mathematical Formulations:
--------------------------
1. Bivariate Hawkes Conditional Intensity:
   For Buy and Sell order arrivals with exponential kernel e^{-\beta(t - t_i)}:
       \lambda_B(t) = \mu_B + \alpha_{BB} \sum_{t_i^B < t} e^{-\beta(t - t_i^B)} + \alpha_{BS} \sum_{t_j^S < t} e^{-\beta(t - t_j^S)}
       \lambda_S(t) = \mu_S + \alpha_{SS} \sum_{t_i^S < t} e^{-\beta(t - t_i^S)} + \alpha_{SB} \sum_{t_j^B < t} e^{-\beta(t - t_j^B)}

2. Recursive O(1) Exponential Updating:
   Between event at t_{k-1} and current time t with \Delta t = t - t_{k-1}:
       R_B(t) = e^{-\beta \Delta t} R_B(t_{k-1}) + \mathbf{1}_{\{\text{Buy at } t\}}
       R_S(t) = e^{-\beta \Delta t} R_S(t_{k-1}) + \mathbf{1}_{\{\text{Sell at } t\}}
       \lambda_B(t) = \mu_B + \alpha_{BB} R_B(t) + \alpha_{BS} R_S(t)
       \lambda_S(t) = \mu_S + \alpha_{SS} R_S(t) + \alpha_{SB} R_B(t)

3. Branching Ratio & Spectral Radius Reflexivity:
   Interaction matrix \mathbf{\Gamma} = \frac{1}{\beta} \begin{pmatrix} \alpha_{BB} & \alpha_{BS} \\ \alpha_{SB} & \alpha_{SS} \end{pmatrix}
   Spectral radius:
       \rho(\mathbf{\Gamma}) = \frac{(\alpha_{BB} + \alpha_{SS}) + \sqrt{(\alpha_{BB} - \alpha_{SS})^2 + 4\alpha_{BS}\alpha_{SB}}}{2\beta}
   - \rho < 0.70: Exogenous stationary flow.
   - \rho \ge 0.85: Critical cascade regime (self-feeding algorithmic sweep). Spreads widen by up to 3.0x.
"""

from dataclasses import dataclass
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class OrderArrivalEvent:
    timestamp_sec: float  # e.g., epoch seconds or relative monotonic seconds
    side: str  # 'BUY' or 'SELL'
    quantity: float = 1.0


@dataclass
class HawkesIntensityReport:
    timestamp_sec: float
    intensity_buy: float  # arrivals per second
    intensity_sell: float
    total_intensity: float
    flow_asymmetry: float  # [-1.0, 1.0]
    spectral_radius_rho: float
    branching_ratio_eta: float
    regime: str  # 'REFLEXIVE_CASCADE_BURST', 'DIRECTIONAL_BUY_FLOW', 'DIRECTIONAL_SELL_FLOW', 'STATIONARY_EXOGENOUS'
    quoting_spread_multiplier: float
    execution_action: str
    rationale: str


class HawkesOrderArrivalEngine:
    """
    Sub-microsecond Bivariate Hawkes Self-Exciting Point Process Engine.
    """

    def __init__(
        self,
        mu_base_buy: float = 1.0,
        mu_base_sell: float = 1.0,
        alpha_self: float = 6.0,    # \alpha_{BB} = \alpha_{SS}
        alpha_cross: float = 2.0,   # \alpha_{BS} = \alpha_{SB}
        beta_decay: float = 10.0,   # \beta = 10.0 s^-1 (decay half-life = ln(2)/10 = 69.3ms)
        critical_rho_threshold: float = 0.80,
        db_path: str = ":memory:",
    ):
        self.mu_b = mu_base_buy
        self.mu_s = mu_base_sell
        self.alpha_self = alpha_self
        self.alpha_cross = alpha_cross
        self.beta = beta_decay
        self.crit_rho = critical_rho_threshold
        self.db_path = db_path

        # State variables for recursive updating
        self._last_t: Optional[float] = None
        self._rb: float = 0.0  # Recursive Buy decay accumulator
        self._rs: float = 0.0  # Recursive Sell decay accumulator

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
            CREATE TABLE IF NOT EXISTS hawkes_intensity_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp_sec REAL NOT NULL,
                intensity_buy REAL NOT NULL,
                intensity_sell REAL NOT NULL,
                total_intensity REAL NOT NULL,
                flow_asymmetry REAL NOT NULL,
                spectral_radius REAL NOT NULL,
                regime TEXT NOT NULL,
                spread_mult REAL NOT NULL,
                action TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def compute_spectral_radius(self) -> float:
        r"""
        Computes spectral radius \rho(\mathbf{\Gamma}) of the Hawkes kernel.
        """
        a11 = self.alpha_self
        a22 = self.alpha_self
        a12 = self.alpha_cross
        a21 = self.alpha_cross

        term1 = (a11 + a22) / (2.0 * self.beta)
        disc = math.sqrt((a11 - a22) ** 2 + 4.0 * a12 * a21) / (2.0 * self.beta)
        rho = term1 + disc
        return round(rho, 4)

    def update_and_evaluate(self, event: Optional[OrderArrivalEvent] = None, current_time_sec: Optional[float] = None) -> HawkesIntensityReport:
        """
        Processes an incoming order event or time step using O(1) recursive decay.
        """
        t = current_time_sec if current_time_sec is not None else (event.timestamp_sec if event else 0.0)

        # 1. Decay existing accumulators
        if self._last_t is not None and t > self._last_t:
            dt = t - self._last_t
            decay = math.exp(-self.beta * dt)
            self._rb *= decay
            self._rs *= decay
        self._last_t = t

        # 2. Add event innovation
        if event is not None:
            if event.side.upper() == 'BUY':
                self._rb += 1.0
            else:
                self._rs += 1.0

        # 3. Calculate conditional intensities
        lambda_b = self.mu_b + self.alpha_self * self._rb + self.alpha_cross * self._rs
        lambda_s = self.mu_s + self.alpha_self * self._rs + self.alpha_cross * self._rb
        tot_lambda = lambda_b + lambda_s

        # Flow asymmetry
        asym = (lambda_b - lambda_s) / max(tot_lambda, 1e-4)

        # Spectral radius & branching ratio
        rho = self.compute_spectral_radius()
        eta = round((self.alpha_self + self.alpha_cross) / self.beta, 4)

        # 4. Cascade Detection & Regime Classification
        # Instantaneous burst factor based on ratio of total intensity to base intensity
        base_intensity = self.mu_b + self.mu_s
        burst_ratio = tot_lambda / base_intensity

        if burst_ratio >= 4.0 or (rho >= self.crit_rho and burst_ratio >= 2.5):
            regime = "REFLEXIVE_CASCADE_BURST"
            spread_mult = round(min(1.0 + 0.35 * burst_ratio, 3.0), 2)
            action = "WIDEN_MAKER_SPREADS_HALT_TAKERS"
            rationale = (
                f"Severe Hawkes self-exciting cascade (Total intensity={tot_lambda:.1f}/s, "
                f"Burst={burst_ratio:.1f}x base, Rho={rho:.2f}). Liquidity sweep in progress. Widen quoting spreads by {spread_mult:.1f}x."
            )
        elif asym >= 0.50 and lambda_b >= 3.0 * self.mu_b:
            regime = "DIRECTIONAL_BUY_FLOW"
            spread_mult = 1.25
            action = "ALIGNED_LONG_FLOW_MOMENTUM"
            rationale = (
                f"Strong buy intensity dominance (Lambda_B={lambda_b:.1f}/s vs Lambda_S={lambda_s:.1f}/s, "
                f"Asym={asym:+.2f}). Follow aggressive institutional buy order arrivals."
            )
        elif asym <= -0.50 and lambda_s >= 3.0 * self.mu_s:
            regime = "DIRECTIONAL_SELL_FLOW"
            spread_mult = 1.25
            action = "ALIGNED_SHORT_FLOW_MOMENTUM"
            rationale = (
                f"Strong sell intensity dominance (Lambda_S={lambda_s:.1f}/s vs Lambda_B={lambda_b:.1f}/s, "
                f"Asym={asym:+.2f}). Follow aggressive institutional sell order arrivals."
            )
        else:
            regime = "STATIONARY_EXOGENOUS"
            spread_mult = 1.00
            action = "STANDARD_QUOTING_ACTIVE"
            rationale = (
                f"Calm exogenous Poisson order flow (Total intensity={tot_lambda:.1f}/s, "
                f"Rho={rho:.2f}). Standard market making active."
            )

        # Persist to SQLite
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO hawkes_intensity_telemetry (
                timestamp_sec, intensity_buy, intensity_sell, total_intensity,
                flow_asymmetry, spectral_radius, regime, spread_mult, action
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                t,
                round(lambda_b, 2),
                round(lambda_s, 2),
                round(tot_lambda, 2),
                round(asym, 3),
                rho,
                regime,
                spread_mult,
                action,
            ),
        )
        conn.commit()

        return HawkesIntensityReport(
            timestamp_sec=t,
            intensity_buy=round(lambda_b, 2),
            intensity_sell=round(lambda_s, 2),
            total_intensity=round(tot_lambda, 2),
            flow_asymmetry=round(asym, 3),
            spectral_radius_rho=rho,
            branching_ratio_eta=eta,
            regime=regime,
            quoting_spread_multiplier=spread_mult,
            execution_action=action,
            rationale=rationale,
        )
