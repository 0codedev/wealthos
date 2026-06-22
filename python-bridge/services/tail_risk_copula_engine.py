r"""
Portfolio CVaR & Non-Gaussian Tail-Risk Copula Engine (Domain 121 / WP-W)
========================================================================

Autonomous portfolio tail-risk and non-Gaussian dependence engine implementing
Extreme Value Theory (EVT), Student-t Copula lower tail dependence, and
Conditional Value-at-Risk (CVaR 95% / 99% Expected Shortfall) to prevent
systemic margin calls and catastrophic drawdowns in Indian F&O portfolios.

Mathematical Specifications:
-----------------------------
1. Non-Gaussian Tail-Risk Modeling & Fat Tails:
   Asset returns exhibit excess kurtosis (\kappa > 3). Standard Gaussian VaR
   understates tail crash risk by up to 300%.

2. Peaks-Over-Threshold (POT) & Generalized Pareto Distribution (GPD):
   For loss exceedances Y = X - u over high quantile threshold u:
       G_{\xi, \beta}(y) = 1 - \left( 1 + \frac{\xi y}{\beta} \right)^{-1/\xi}, \quad \xi \neq 0
   Tail VaR and CVaR / Expected Shortfall (ES):
       \text{VaR}_\alpha = u + \frac{\beta}{\xi} \left[ \left( \frac{N}{N_u} (1 - \alpha) \right)^{-\xi} - 1 \right]
       \text{CVaR}_\alpha = \frac{\text{VaR}_\alpha + \beta - \xi u}{1 - \xi}

3. Student-t Copula Lower Tail Dependence:
   Measures joint crash probability when both assets collapse simultaneously:
       \lambda_L = 2 t_{\nu + 1}\left( - \sqrt{\frac{(\nu + 1)(1 - \rho)}{1 + \rho}} \right)
   In Gaussian copulas, \lambda_L \equiv 0. In Student-t, \lambda_L > 0, capturing
   cross-asset contagion during Indian market circuit down-moves.

4. Portfolio CVaR Aggregation & Stress Allocator:
   Given portfolio weights \mathbf{w} and simulated joint non-linear loss distribution \mathbf{L}:
       \text{CVaR}_\alpha(\mathbf{w}) = \frac{1}{|K_\alpha|} \sum_{k \in K_\alpha} L_k
   where K_\alpha = \{k \mid L_k \ge \text{VaR}_\alpha\}.

5. Systemic Margin Call Prevention:
   Monitors ratio of \text{CVaR}_{99\%} to available liquidity.
   Triggers deleveraging instruction if tail loss breaches 50% of available margin.
"""

from dataclasses import dataclass, field
from datetime import datetime
import math
import random
from typing import Dict, List, Optional, Tuple
import sqlite3


@dataclass
class AssetPosition:
    symbol: str
    asset_class: str  # 'EQUITY', 'FUTURE', 'OPTION'
    weight: float
    current_value_inr: float
    historical_daily_returns: List[float]


@dataclass
class TailRiskMetrics:
    timestamp: datetime
    var_95_inr: float
    var_99_inr: float
    cvar_95_inr: float
    cvar_99_inr: float
    tail_shape_xi: float
    lower_tail_dependence: float
    cvar_to_capital_ratio: float
    risk_regime: str  # 'NORMAL', 'ELEVATED', 'CRITICAL_DELEVERAGE'
    recommended_hedging_notional_inr: float


class TailRiskCopulaEngine:
    """
    Non-Gaussian Copula & EVT Conditional Value-at-Risk Engine.
    """

    def __init__(
        self,
        cvar_elevated_threshold: float = 0.35,  # 35% of capital
        cvar_critical_threshold: float = 0.50,  # 50% of capital
        degrees_of_freedom: float = 4.0,  # Fat-tailed t-distribution nu
        db_path: str = ":memory:",
    ):
        self.cvar_elevated_threshold = cvar_elevated_threshold
        self.cvar_critical_threshold = cvar_critical_threshold
        self.nu = degrees_of_freedom
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
            CREATE TABLE IF NOT EXISTS tail_risk_surveillance_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                var_95 REAL NOT NULL,
                var_99 REAL NOT NULL,
                cvar_95 REAL NOT NULL,
                cvar_99 REAL NOT NULL,
                tail_xi REAL NOT NULL,
                tail_dependence REAL NOT NULL,
                risk_regime TEXT NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def calculate_sample_kurtosis(returns: List[float]) -> float:
        """
        Calculate sample excess kurtosis (Fisher definition: normal = 0).
        """
        n = len(returns)
        if n < 4:
            return 0.0

        mean = sum(returns) / n
        var = sum((x - mean) ** 2 for x in returns) / (n - 1)
        if var < 1e-12:
            return 0.0

        std = math.sqrt(var)
        m4 = sum((x - mean) ** 4 for x in returns) / n
        kurt = (m4 / (std ** 4)) - 3.0
        return kurt

    @staticmethod
    def calculate_lower_tail_dependence(rho: float, nu: float = 4.0) -> float:
        r"""
        Calculates bivariate Student-t copula lower tail dependence:
            \lambda_L = 2 \times F_{t, \nu+1}\left( - \sqrt{\frac{(\nu+1)(1-\rho)}{1+\rho}} \right)
        Approximates Student-t CDF via transformation or numerical bounds.
        """
        clamped_rho = max(min(rho, 0.999), -0.999)
        if clamped_rho <= -0.99:
            return 0.0
        if clamped_rho >= 0.99:
            return 1.0

        arg = math.sqrt(((nu + 1.0) * (1.0 - clamped_rho)) / (1.0 + clamped_rho))
        # Standard approximation for t_{nu+1} CDF tail at -arg
        # Using equivalent normal approximation with adjusted variance for nu >= 4
        scale = math.sqrt((nu + 1.0) / max(nu - 1.0, 1.0))
        z = -arg / scale
        p = 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))
        return min(max(2.0 * p, 0.0), 1.0)

    @staticmethod
    def fit_gpd_moments(exceedances: List[float]) -> Tuple[float, float]:
        r"""
        Method of Moments estimator for Generalized Pareto Distribution (GPD):
            mean = \beta / (1 - \xi)
            var = \beta^2 / ((1 - \xi)^2 (1 - 2\xi))
        Returns (\xi, \beta).
        """
        n = len(exceedances)
        if n < 3:
            return 0.15, 0.02  # Default robust prior

        mean_y = sum(exceedances) / n
        var_y = sum((y - mean_y) ** 2 for y in exceedances) / (n - 1)
        if var_y < 1e-12:
            return 0.10, max(mean_y, 0.01)

        # Solving for \xi and \beta:
        # var / mean^2 = 1 / (1 - 2\xi)
        ratio = var_y / (mean_y ** 2)
        # 1 - 2\xi = 1 / ratio => 2\xi = 1 - 1/ratio => \xi = 0.5 * (1 - 1/ratio)
        xi = 0.5 * (1.0 - (1.0 / max(ratio, 0.51)))
        xi = min(max(xi, -0.45), 0.45)  # Enforce finiteness of variance
        beta = mean_y * (1.0 - xi)
        return xi, max(beta, 1e-6)

    def compute_portfolio_evt_cvar(
        self,
        portfolio_returns: List[float],
        total_portfolio_value_inr: float,
        threshold_quantile: float = 0.90,
    ) -> Tuple[float, float, float, float, float]:
        """
        Computes EVT Peaks-Over-Threshold (POT) VaR and CVaR at 95% and 99% confidence.
        Returns: (VaR_95_INR, VaR_99_INR, CVaR_95_INR, CVaR_99_INR, tail_xi).
        """
        # Losses are positive: L = -returns
        losses = [-r for r in portfolio_returns]
        losses.sort()
        n = len(losses)
        if n < 20:
            # Fallback for short histories: empirical / gaussian proxy
            std = math.sqrt(sum(x ** 2 for x in losses) / max(n, 1))
            var95 = 1.645 * std * total_portfolio_value_inr
            var99 = 2.326 * std * total_portfolio_value_inr
            return var95, var99, var95 * 1.25, var99 * 1.35, 0.15

        # Threshold u at 90th percentile of losses
        idx_u = min(int(math.floor(threshold_quantile * n)), n - 2)
        u = losses[idx_u]
        exceedances = [l - u for l in losses if l > u]
        if len(exceedances) < 2:
            # Fallback for tied/discrete return distributions
            tail_slice = losses[idx_u:]
            exceedances = [max(l - u, 1e-4) for l in tail_slice]

        n_u = max(len(exceedances), 1)

        xi, beta = self.fit_gpd_moments(exceedances)

        def evt_var_cvar(alpha: float) -> Tuple[float, float]:
            tail_prob = (n / float(n_u)) * (1.0 - alpha)
            if tail_prob <= 0:
                tail_prob = 1e-5
            term = (tail_prob) ** (-xi)
            var_pct = u + (beta / xi) * (term - 1.0)
            cvar_pct = (var_pct + beta - xi * u) / (1.0 - xi)
            return max(var_pct * total_portfolio_value_inr, 0.0), max(cvar_pct * total_portfolio_value_inr, 0.0)

        var_95, cvar_95 = evt_var_cvar(0.95)
        var_99, cvar_99 = evt_var_cvar(0.99)

        return var_95, var_99, cvar_95, cvar_99, xi

    def assess_portfolio_tail_risk(
        self,
        positions: List[AssetPosition],
        total_available_margin_inr: float,
        timestamp: datetime,
    ) -> TailRiskMetrics:
        """
        Full evaluation of portfolio tail-risk, Student-t copula tail dependence,
        and margin depletion alerts.
        """
        total_val = sum(pos.current_value_inr for pos in positions)
        if total_val <= 0:
            total_val = 1.0

        # Construct aggregate weighted daily return series
        min_len = min(len(pos.historical_daily_returns) for pos in positions) if positions else 0
        if min_len == 0:
            return TailRiskMetrics(
                timestamp=timestamp,
                var_95_inr=0.0,
                var_99_inr=0.0,
                cvar_95_inr=0.0,
                cvar_99_inr=0.0,
                tail_shape_xi=0.0,
                lower_tail_dependence=0.0,
                cvar_to_capital_ratio=0.0,
                risk_regime='NORMAL',
                recommended_hedging_notional_inr=0.0,
            )

        portfolio_returns = []
        for t in range(min_len):
            ret_t = sum(
                (pos.current_value_inr / total_val) * pos.historical_daily_returns[t]
                for pos in positions
            )
            portfolio_returns.append(ret_t)

        # Estimate average correlation for tail dependence
        avg_rho = 0.50
        if len(positions) >= 2:
            r1 = positions[0].historical_daily_returns[:min_len]
            r2 = positions[1].historical_daily_returns[:min_len]
            mean1 = sum(r1) / min_len
            mean2 = sum(r2) / min_len
            cov = sum((a - mean1) * (b - mean2) for a, b in zip(r1, r2)) / (min_len - 1)
            std1 = math.sqrt(sum((a - mean1) ** 2 for a in r1) / (min_len - 1))
            std2 = math.sqrt(sum((b - mean2) ** 2 for b in r2) / (min_len - 1))
            if std1 > 1e-9 and std2 > 1e-9:
                avg_rho = cov / (std1 * std2)

        tail_dep = self.calculate_lower_tail_dependence(avg_rho, self.nu)

        var_95, var_99, cvar_95, cvar_99, xi = self.compute_portfolio_evt_cvar(
            portfolio_returns, total_val
        )

        cvar_ratio = cvar_99 / max(total_available_margin_inr, 1.0)

        if cvar_ratio >= self.cvar_critical_threshold:
            regime = 'CRITICAL_DELEVERAGE'
            hedging_notional = cvar_99 - (self.cvar_elevated_threshold * total_available_margin_inr)
        elif cvar_ratio >= self.cvar_elevated_threshold:
            regime = 'ELEVATED'
            hedging_notional = (cvar_ratio - self.cvar_elevated_threshold) * total_available_margin_inr
        else:
            regime = 'NORMAL'
            hedging_notional = 0.0

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO tail_risk_surveillance_logs (
                timestamp, var_95, var_99, cvar_95, cvar_99, tail_xi, tail_dependence, risk_regime
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                timestamp.isoformat(),
                var_95,
                var_99,
                cvar_95,
                cvar_99,
                xi,
                tail_dep,
                regime,
            )
        )
        conn.commit()

        return TailRiskMetrics(
            timestamp=timestamp,
            var_95_inr=round(var_95, 2),
            var_99_inr=round(var_99, 2),
            cvar_95_inr=round(cvar_95, 2),
            cvar_99_inr=round(cvar_99, 2),
            tail_shape_xi=round(xi, 4),
            lower_tail_dependence=round(tail_dep, 4),
            cvar_to_capital_ratio=round(cvar_ratio, 4),
            risk_regime=regime,
            recommended_hedging_notional_inr=round(max(hedging_notional, 0.0), 2),
        )
