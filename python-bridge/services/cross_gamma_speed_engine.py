r"""
Sub-Millisecond Options Greeks Cross-Gamma & Speed Sieve (Domain 143 / WP-AS)
=============================================================================

Autonomous options risk engine calculating third-order Greeks (Speed, Zomma, Color),
multi-asset constituent cross-gamma tensors for index baskets, and 0DTE terminal
gamma jump hazard scores with dynamic rebalance band tightening.

Mathematical Formulations:
--------------------------
1. Analytical Black-Scholes Greeks:
       d_1 = \frac{\ln(S/K) + (r - q + \frac{1}{2}\sigma^2)T}{\sigma \sqrt{T}}, \quad d_2 = d_1 - \sigma \sqrt{T}
       \phi(x) = \frac{1}{\sqrt{2\pi}} e^{-x^2 / 2}, \quad \Phi(x) = \frac{1}{2} [1 + \text{erf}(x / \sqrt{2})]
       \Delta_C = e^{-qT} \Phi(d_1), \quad \Delta_P = -e^{-qT} \Phi(-d_1)
       \Gamma = \frac{e^{-qT}\phi(d_1)}{S \sigma \sqrt{T}}, \quad \mathcal{V} = S e^{-qT} \phi(d_1) \sqrt{T}

2. Third-Order Greeks (Curvature Dynamics):
       \text{Speed} = \frac{\partial^3 V}{\partial S^3} = \frac{\partial \Gamma}{\partial S} = -\frac{\Gamma}{S} \left( \frac{d_1}{\sigma \sqrt{T}} + 1 \right)
       \text{Zomma} = \frac{\partial^3 V}{\partial S^2 \partial \sigma} = \frac{\partial \Gamma}{\partial \sigma} = \Gamma \left( \frac{d_1 d_2 - 1}{\sigma} \right)
       \text{Color} = \frac{\partial^3 V}{\partial S^2 \partial T} = \frac{\partial \Gamma}{\partial T} = -\Gamma \left( q + \frac{1 - d_1 d_2}{2T} + \frac{r - q}{\sigma \sqrt{T}} d_1 \right)

3. Cross-Gamma Basket Formulation:
   For an index basket I = \sum_{i=1}^M w_i S_i:
       \Gamma_{ij} = \frac{\partial^2 V}{\partial S_i \partial S_j} = \Gamma_{\text{index}} \cdot w_i w_j
       \Gamma_{ii} = \Gamma_{\text{index}} \cdot w_i^2
   Second-order PnL expansion across constituent price shocks \Delta \mathbf{S}:
       \Delta \Pi_{2\text{nd}} = \frac{1}{2} \sum_{i=1}^M \sum_{j=1}^M \Gamma_{ij} \Delta S_i \Delta S_j

4. 0DTE Terminal Gamma Jump Hazard:
   As T \to 0, \Gamma \sim \mathcal{O}(1/\sqrt{T}) and \text{Speed} \sim \mathcal{O}(1/T).
   Hazard Score:
       H_\gamma = \min\left(1.0, \; \frac{|\text{Speed}| \cdot (\Delta S_{\text{step}})^2}{0.08 \cdot S} + \frac{\Gamma}{\Gamma_{\text{crit}}} \cdot e^{-T / T_{\text{day}}}\right)
"""

from dataclasses import dataclass, field
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class OptionContract:
    symbol: str
    spot: float
    strike: float
    tte_years: float  # Time to expiry in years
    volatility: float  # Annualized implied volatility (e.g. 0.18)
    rate: float = 0.065  # Risk-free rate (6.5% RBI repo baseline)
    dividend_yield: float = 0.012  # Dividend yield
    option_type: str = "CE"  # 'CE' or 'PE'
    contract_size: int = 25  # Nifty default


@dataclass
class HigherOrderGreeks:
    delta: float
    gamma: float
    vega: float
    theta: float
    speed: float  # dGamma / dSpot
    zomma: float  # dGamma / dVol
    color: float  # dGamma / dTime
    hazard_score: float
    recommended_action: str
    rebalance_tolerance_pct: float


@dataclass
class ConstituentAsset:
    symbol: str
    spot: float
    weight: float  # Normalized index weight (sum w_i = 1.0)


@dataclass
class CrossGammaMatrixReport:
    index_symbol: str
    index_spot: float
    index_gamma: float
    constituents: List[str]
    weights: List[float]
    gamma_matrix: List[List[float]]  # M x M cross gamma values
    direct_gammas: Dict[str, float]
    aggregate_basket_curvature: float


class CrossGammaSpeedEngine:
    """
    Sub-millisecond analytical Greek engine computing Speed, Zomma, Color,
    Cross-Gamma basket tensors, and 0DTE gamma jump hazard governors.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        gamma_crit: float = 0.0020,  # Critical gamma threshold for NIFTY
    ):
        self.db_path = db_path
        self.gamma_crit = gamma_crit
        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            if self._conn is None:
                self._conn = sqlite3.connect(":memory:")
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for high-order Greek and hazard telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS cross_gamma_speed_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                spot REAL NOT NULL,
                strike REAL NOT NULL,
                tte_years REAL NOT NULL,
                delta REAL NOT NULL,
                gamma REAL NOT NULL,
                speed REAL NOT NULL,
                zomma REAL NOT NULL,
                color REAL NOT NULL,
                hazard_score REAL NOT NULL,
                recommended_action TEXT NOT NULL,
                rebalance_tolerance_pct REAL NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def _std_norm_pdf(x: float) -> float:
        """Standard normal probability density function."""
        return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)

    @staticmethod
    def _std_norm_cdf(x: float) -> float:
        """Standard normal cumulative distribution function via error function."""
        return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

    def calculate_higher_order_greeks(self, contract: OptionContract) -> HigherOrderGreeks:
        """
        Calculates Delta, Gamma, Vega, Theta, Speed (dGamma/dSpot),
        Zomma (dGamma/dVol), and Color (dGamma/dTime).
        """
        S = max(1e-4, contract.spot)
        K = max(1e-4, contract.strike)
        T = max(1e-6, contract.tte_years)
        sigma = max(1e-4, contract.volatility)
        r = contract.rate
        q = contract.dividend_yield
        is_call = contract.option_type.upper() in ("CE", "CALL")

        sqrt_T = math.sqrt(T)
        sigma_sqrt_T = sigma * sqrt_T

        d1 = (math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / sigma_sqrt_T
        d2 = d1 - sigma_sqrt_T

        phi_d1 = self._std_norm_pdf(d1)
        discount_q = math.exp(-q * T)
        discount_r = math.exp(-r * T)

        # Standard Greeks
        if is_call:
            delta = discount_q * self._std_norm_cdf(d1)
            theta = (
                -(S * discount_q * phi_d1 * sigma) / (2.0 * sqrt_T)
                - r * K * discount_r * self._std_norm_cdf(d2)
                + q * S * discount_q * self._std_norm_cdf(d1)
            )
        else:
            delta = -discount_q * self._std_norm_cdf(-d1)
            theta = (
                -(S * discount_q * phi_d1 * sigma) / (2.0 * sqrt_T)
                + r * K * discount_r * self._std_norm_cdf(-d2)
                - q * S * discount_q * self._std_norm_cdf(-d1)
            )

        gamma = (discount_q * phi_d1) / (S * sigma_sqrt_T)
        vega = S * discount_q * phi_d1 * sqrt_T

        # Third-Order Greeks
        # Speed = dGamma / dS = -(Gamma / S) * (d1 / (sigma * sqrt(T)) + 1)
        speed = -(gamma / S) * (d1 / sigma_sqrt_T + 1.0)

        # Zomma = dGamma / dSigma = Gamma * ((d1 * d2 - 1) / sigma)
        zomma = gamma * ((d1 * d2 - 1.0) / sigma)

        # Color = dGamma / dT = -Gamma * [ q + (1 - d1*d2)/(2*T) + (r - q)*d1/(sigma * sqrt(T)) ]
        color = -gamma * (
            q + (1.0 - d1 * d2) / (2.0 * T) + ((r - q) * d1) / sigma_sqrt_T
        )

        # Hazard Score for 0DTE Jump Risk
        step_shock = 0.005 * S  # 50 bps move
        speed_term = (abs(speed) * (step_shock ** 2)) / (0.08 * S)
        t_day = 1.0 / 365.0
        time_decay_factor = math.exp(-T / t_day)
        gamma_term = (gamma / self.gamma_crit) * time_decay_factor

        raw_hazard = speed_term + gamma_term
        hazard_score = max(0.0, min(1.0, raw_hazard))

        # Dynamic Rebalancing Tolerance and Action Directive
        if hazard_score >= 0.85:
            action = "TERMINAL_PIN_HAZARD_CLOSE"
            rebal_tol = 2.0  # Tightest 2% band
        elif hazard_score >= 0.60:
            action = "HIGH_PIN_RISK_TIGHTEN"
            rebal_tol = 4.0
        elif hazard_score >= 0.30:
            action = "ELEVATED_SPEED_MONITOR"
            rebal_tol = 6.0
        else:
            action = "STABLE_GAMMA"
            rebal_tol = 10.0  # Normal 10% tolerance

        result = HigherOrderGreeks(
            delta=delta,
            gamma=gamma,
            vega=vega,
            theta=theta,
            speed=speed,
            zomma=zomma,
            color=color,
            hazard_score=round(hazard_score, 4),
            recommended_action=action,
            rebalance_tolerance_pct=rebal_tol,
        )

        self._record_telemetry(contract, result)
        return result

    def compute_basket_cross_gamma(
        self,
        index_contract: OptionContract,
        constituents: List[ConstituentAsset],
    ) -> CrossGammaMatrixReport:
        """
        Computes the analytical cross-gamma tensor Gamma_ij = Gamma_index * w_i * w_j
        and individual direct gammas for basket hedging.
        """
        greeks = self.calculate_higher_order_greeks(index_contract)
        gamma_idx = greeks.gamma

        n = len(constituents)
        symbols = [c.symbol for c in constituents]
        weights = [c.weight for c in constituents]

        # Verify weights sum to approximately 1.0
        total_w = sum(weights)
        if total_w <= 0.0:
            norm_weights = [1.0 / n] * n
        else:
            norm_weights = [w / total_w for w in weights]

        # Construct M x M cross gamma tensor
        matrix: List[List[float]] = []
        direct_gammas: Dict[str, float] = {}

        for i in range(n):
            row: List[float] = []
            for j in range(n):
                val = gamma_idx * norm_weights[i] * norm_weights[j]
                row.append(val)
            matrix.append(row)
            direct_gammas[symbols[i]] = gamma_idx * (norm_weights[i] ** 2)

        # Aggregate second-order curvature for an identical percentage shock
        # Sum(w_i * w_j * Gamma_idx) = Gamma_idx * (Sum w_i)^2 = Gamma_idx
        agg_curvature = gamma_idx * (sum(norm_weights) ** 2)

        return CrossGammaMatrixReport(
            index_symbol=index_contract.symbol,
            index_spot=index_contract.spot,
            index_gamma=gamma_idx,
            constituents=symbols,
            weights=norm_weights,
            gamma_matrix=matrix,
            direct_gammas=direct_gammas,
            aggregate_basket_curvature=agg_curvature,
        )

    def _record_telemetry(
        self,
        contract: OptionContract,
        greeks: HigherOrderGreeks,
    ) -> None:
        """Records telemetry into SQLite."""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO cross_gamma_speed_telemetry (
                    timestamp, symbol, spot, strike, tte_years,
                    delta, gamma, speed, zomma, color,
                    hazard_score, recommended_action, rebalance_tolerance_pct
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.utcnow().isoformat(),
                    contract.symbol,
                    contract.spot,
                    contract.strike,
                    contract.tte_years,
                    greeks.delta,
                    greeks.gamma,
                    greeks.speed,
                    greeks.zomma,
                    greeks.color,
                    greeks.hazard_score,
                    greeks.recommended_action,
                    greeks.rebalance_tolerance_pct,
                ),
            )
            conn.commit()
        except Exception:
            pass
