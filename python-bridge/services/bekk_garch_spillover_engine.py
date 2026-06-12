"""
Domain 273 / WP-FS: Cross-Asset Continuous Covariance Forecasting & BEKK-GARCH Spillover Engine
=============================================================================================
Institutional multivariate volatility engine implementing the Baba-Engle-Kraft-Kroner (BEKK)
GARCH(1,1) covariance matrix recursion to forecast positive-definite covariance, measure cross-asset
volatility spillover transmission, and guard against systemic diversification breakdown.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Tuple, Optional
import numpy as np


class BEKKSpilloverRegime(str, Enum):
    EQUILIBRIUM_STABLE_COVARIANCE = "EQUILIBRIUM_STABLE_COVARIANCE"
    SYSTEMIC_CONTAGION_SPILLOVER_ALERT = "SYSTEMIC_CONTAGION_SPILLOVER_ALERT"
    ILL_CONDITIONED_COVARIANCE_HAZARD = "ILL_CONDITIONED_COVARIANCE_HAZARD"
    ACTIVE_VOLATILITY_EXPANSION_REGIME = "ACTIVE_VOLATILITY_EXPANSION_REGIME"


class BEKKRiskDirective(str, Enum):
    MAINTAIN_STANDARD_PORTFOLIO_WEIGHTS = "MAINTAIN_STANDARD_PORTFOLIO_WEIGHTS"
    DELEVERAGE_AND_ACTIVATE_TAIL_HEDGES = "DELEVERAGE_AND_ACTIVATE_TAIL_HEDGES"
    APPLY_COVARIANCE_EIGEN_SHRINKAGE = "APPLY_COVARIANCE_EIGEN_SHRINKAGE"
    CONTRACT_DYNAMIC_RISK_BUDGET = "CONTRACT_DYNAMIC_RISK_BUDGET"


@dataclass
class BEKKStateAssessment:
    asset_names: List[str]
    forecast_covariance_matrix: List[List[float]]
    forecast_correlation_matrix: List[List[float]]
    annualized_volatilities_pct: List[float]
    max_cross_spillover_intensity: float
    spillover_source_target: Tuple[str, str]
    covariance_condition_number: float
    min_eigenvalue: float
    regime: BEKKSpilloverRegime
    directive: BEKKRiskDirective
    rationales: List[str] = field(default_factory=list)


class BEKKGARCHSpilloverEngine:
    """
    Multivariate Bivariate/Trivariate BEKK-GARCH(1,1) Covariance Matrix Engine:
    H_t = C * C^T + A^T * (eps_{t-1} * eps_{t-1}^T) * A + B^T * H_{t-1} * B.
    Guarantees positive semi-definiteness and computes directional shock transmission.
    """

    def __init__(
        self,
        dimension: int = 2,
        spillover_contagion_hurdle: float = 0.35,  # Spillover intensity >= 0.35 indicates contagion
        max_condition_number_hurdle: float = 40.0, # Condition number >= 40.0 triggers ill-conditioned hazard
        correlation_breakdown_hurdle: float = 0.80, # Correlation >= 0.80 indicates diversification failure
    ):
        self.dim = dimension
        self.spillover_hurdle = spillover_contagion_hurdle
        self.cond_hurdle = max_condition_number_hurdle
        self.corr_hurdle = correlation_breakdown_hurdle

        # Default institutional calibrated parameters for 2-asset (e.g., BTC and ETH or SPY and QQQ)
        # C: lower triangular Cholesky intercept
        self.C = np.array([
            [0.015, 0.0],
            [0.008, 0.018],
        ])

        # A: ARCH shock transmission matrix
        self.A = np.array([
            [0.25, 0.05],  # A_11 = direct shock, A_12 = spillover from asset 1 to 2
            [0.08, 0.28],  # A_21 = spillover from asset 2 to 1, A_22 = direct shock
        ])

        # B: GARCH persistence matrix
        self.B = np.array([
            [0.92, 0.02],
            [0.03, 0.90],
        ])

        # Initial baseline covariance H_0
        self.H_prev = np.array([
            [0.0004, 0.00025],
            [0.00025, 0.0005],
        ])

    def update_covariance_step(
        self,
        eps_prev: np.ndarray,
        H_prev: Optional[np.ndarray] = None,
    ) -> np.ndarray:
        """
        Recursively updates covariance H_t from previous shock eps_{t-1} and H_{t-1}.
        """
        if H_prev is None:
            H_prev = self.H_prev

        eps = eps_prev.reshape(-1, 1)
        outer_eps = np.dot(eps, eps.T)

        # BEKK formula: H_t = C * C^T + A^T * outer_eps * A + B^T * H_{t-1} * B
        cc = np.dot(self.C, self.C.T)
        arch_term = np.dot(np.dot(self.A.T, outer_eps), self.A)
        garch_term = np.dot(np.dot(self.B.T, H_prev), self.B)

        H_t = cc + arch_term + garch_term
        # Symmetrize to eliminate machine precision numerical asymmetry
        H_t = 0.5 * (H_t + H_t.T)
        self.H_prev = H_t
        return H_t

    def evaluate_state(
        self,
        asset_names: List[str],
        recent_return_shocks: List[float],
        custom_H_prev: Optional[np.ndarray] = None,
    ) -> BEKKStateAssessment:
        rationales = []
        eps = np.array(recent_return_shocks)
        H_t = self.update_covariance_step(eps, H_prev=custom_H_prev)

        # Spectral decomposition
        eigvals, _ = np.linalg.eigh(H_t)
        min_eig = float(np.min(eigvals))
        max_eig = float(np.max(eigvals))
        cond_num = max_eig / max(1e-9, min_eig)

        # Volatilities and correlation matrix
        vols_daily = np.sqrt(np.maximum(1e-9, np.diag(H_t)))
        annual_vols = (vols_daily * np.sqrt(365.0) * 100.0).tolist()

        D_inv = np.diag(1.0 / vols_daily)
        corr_matrix = np.dot(np.dot(D_inv, H_t), D_inv)
        corr_matrix = np.clip(corr_matrix, -1.0, 1.0)

        # Compute cross-spillover intensities (off-diagonals of A and B)
        max_spillover = 0.0
        source_target = (asset_names[0], asset_names[1])

        for i in range(self.dim):
            for j in range(self.dim):
                if i != j:
                    intensity = float(abs(self.A[i, j]) + abs(self.B[i, j]))
                    if intensity > max_spillover:
                        max_spillover = intensity
                        source_target = (asset_names[i], asset_names[j])

        # Pairwise correlation between asset 0 and 1
        rho_01 = float(corr_matrix[0, 1])

        # Decision State Machine
        if cond_num >= self.cond_hurdle or min_eig <= 1e-6:
            regime = BEKKSpilloverRegime.ILL_CONDITIONED_COVARIANCE_HAZARD
            directive = BEKKRiskDirective.APPLY_COVARIANCE_EIGEN_SHRINKAGE
            rationales.append(
                f"Ill-conditioned BEKK covariance matrix across {asset_names}: Condition number={cond_num:.1f} "
                f">= {self.cond_hurdle:.1f}, Min eigenvalue={min_eig:.2e}. Optimizer weights unstable. "
                f"Apply Ledoit-Wolf eigenvalue clipping and regularize inversion."
            )
        elif max_spillover >= self.spillover_hurdle and rho_01 >= self.corr_hurdle:
            regime = BEKKSpilloverRegime.SYSTEMIC_CONTAGION_SPILLOVER_ALERT
            directive = BEKKRiskDirective.DELEVERAGE_AND_ACTIVATE_TAIL_HEDGES
            rationales.append(
                f"Systemic cross-asset contagion spillover alert: Spillover from {source_target[0]} to "
                f"{source_target[1]}={max_spillover:.2f} >= {self.spillover_hurdle:.2f}, Corr={rho_01:.2f}. "
                f"Diversification hedge failing; deleverage gross exposures and activate tail protection."
            )
        elif np.trace(H_t) >= (np.trace(self.C @ self.C.T) * 3.0):
            regime = BEKKSpilloverRegime.ACTIVE_VOLATILITY_EXPANSION_REGIME
            directive = BEKKRiskDirective.CONTRACT_DYNAMIC_RISK_BUDGET
            rationales.append(
                f"Active volatility expansion regime across {asset_names}: Portfolio total variance expanding. "
                f"Contract position sizing budgets to preserve Sharpe ratio."
            )
        else:
            regime = BEKKSpilloverRegime.EQUILIBRIUM_STABLE_COVARIANCE
            directive = BEKKRiskDirective.MAINTAIN_STANDARD_PORTFOLIO_WEIGHTS
            rationales.append(
                f"Stable BEKK covariance equilibrium across {asset_names}: Condition number={cond_num:.1f}, "
                f"Max spillover={max_spillover:.2f}, Corr={rho_01:.2f}. Normal risk budgeting."
            )

        return BEKKStateAssessment(
            asset_names=asset_names,
            forecast_covariance_matrix=H_t.tolist(),
            forecast_correlation_matrix=corr_matrix.tolist(),
            annualized_volatilities_pct=[round(v, 2) for v in annual_vols],
            max_cross_spillover_intensity=round(max_spillover, 3),
            spillover_source_target=source_target,
            covariance_condition_number=round(cond_num, 2),
            min_eigenvalue=float(min_eig),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
