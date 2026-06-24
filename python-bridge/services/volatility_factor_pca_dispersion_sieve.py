"""
Cross-Sectional Volatility Factor PCA & Dispersion Harvesting Sieve
Domain 231 / Work Package WP-EC

Implements implied correlation index extraction, correlation risk premium (CRP)
harvesting, PCA factor decomposition of cross-asset covariance matrices,
and PC1-neutralized volatility dispersion trading sentries.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class DispersionRegimeState(str, Enum):
    DISPERSION_HARVEST_OPTIMAL = "DISPERSION_HARVEST_OPTIMAL"       # High CRP (implied corr >> realized corr)
    CORRELATION_CRASH_EXPANSION = "CORRELATION_CRASH_EXPANSION"     # Systemic panic: corr -> 1.0
    NEGATIVE_DISPERSION_INVERSION = "NEGATIVE_DISPERSION_INVERSION" # Implied corr < realized corr (reverse dispersion)
    NEUTRAL_EQUILIBRIUM = "NEUTRAL_EQUILIBRIUM"


@dataclass
class ConstituentAsset:
    symbol: str
    weight: float
    implied_vol: float
    realized_vol: float


@dataclass
class DispersionProfile:
    index_iv: float
    index_rv: float
    basket_weighted_iv: float
    basket_weighted_rv: float
    implied_correlation: float
    realized_correlation: float
    correlation_risk_premium: float
    raw_dispersion_spread_vol: float


@dataclass
class PCAFactorDecomposition:
    num_factors: int
    pc1_market_explained_ratio: float
    pc2_sector_explained_ratio: float
    pc1_loadings: List[float]
    neutralized_weights: List[float]


@dataclass
class DispersionSentryDecision:
    profile: DispersionProfile
    pca: PCAFactorDecomposition
    regime: DispersionRegimeState
    recommended_action: str
    details: Dict[str, float] = field(default_factory=dict)


class VolatilityFactorPCADispersionSieve:
    """
    Evaluates implied vs realized correlation dislocation across equity and crypto index constituents,
    performing PCA factor decomposition to construct pure market-neutral volatility dispersion books.
    """

    def __init__(
        self,
        min_crp_threshold: float = 0.12,  # Minimum 12 percentage points correlation spread to harvest
        crash_correlation_barrier: float = 0.88,
    ):
        self.min_crp = min_crp_threshold
        self.crash_barrier = crash_correlation_barrier

    @staticmethod
    def compute_equicorrelation(
        index_vol: float,
        constituent_vols: List[float],
        weights: List[float],
    ) -> float:
        """
        Extracts the implied or realized equicorrelation rho from index volatility:
        sigma_idx^2 = rho * (sum(w_i * sigma_i))^2 + (1 - rho) * sum(w_i^2 * sigma_i^2)
        rho = (sigma_idx^2 - sum(w_i^2 * sigma_i^2)) / ((sum(w_i * sigma_i))^2 - sum(w_i^2 * sigma_i^2))
        """
        n = len(constituent_vols)
        if n < 2 or len(weights) != n or index_vol <= 0.0:
            return 0.5

        sum_w_sigma = sum(weights[i] * constituent_vols[i] for i in range(n))
        sum_sq_w_sigma = sum((weights[i] ** 2) * (constituent_vols[i] ** 2) for i in range(n))

        idx_var = index_vol ** 2
        numerator = idx_var - sum_sq_w_sigma
        denominator = (sum_w_sigma ** 2) - sum_sq_w_sigma

        if abs(denominator) < 1e-8:
            return 0.5

        raw_rho = numerator / denominator
        # Bound correlation between 0.0 and 1.0
        return max(0.0, min(1.0, raw_rho))

    def evaluate_dispersion_profile(
        self,
        index_iv: float,
        index_rv: float,
        constituents: List[ConstituentAsset],
    ) -> DispersionProfile:
        """
        Evaluates the correlation risk premium (CRP) and dispersion spread.
        """
        weights = [c.weight for c in constituents]
        # Normalize weights
        tot_w = sum(weights)
        norm_w = [w / tot_w for w in weights] if tot_w > 0 else [1.0 / len(weights)] * len(weights)

        ivs = [c.implied_vol for c in constituents]
        rvs = [c.realized_vol for c in constituents]

        basket_w_iv = sum(norm_w[i] * ivs[i] for i in range(len(constituents)))
        basket_w_rv = sum(norm_w[i] * rvs[i] for i in range(len(constituents)))

        implied_rho = self.compute_equicorrelation(index_iv, ivs, norm_w)
        realized_rho = self.compute_equicorrelation(index_rv, rvs, norm_w)

        crp = implied_rho - realized_rho
        disp_spread = basket_w_iv - index_iv

        return DispersionProfile(
            index_iv=index_iv,
            index_rv=index_rv,
            basket_weighted_iv=basket_w_iv,
            basket_weighted_rv=basket_w_rv,
            implied_correlation=implied_rho,
            realized_correlation=realized_rho,
            correlation_risk_premium=crp,
            raw_dispersion_spread_vol=disp_spread,
        )

    @staticmethod
    def compute_pca_decomposition(
        returns_matrix: List[List[float]],
        base_weights: List[float],
        num_power_iterations: int = 50,
    ) -> PCAFactorDecomposition:
        """
        Computes the dominant eigenvector (PC1: Market Factor) via power iteration
        on the sample covariance matrix, and projects base weights to be orthogonal to PC1.
        """
        m = len(returns_matrix)    # number of assets
        if m < 2:
            return PCAFactorDecomposition(
                num_factors=1,
                pc1_market_explained_ratio=1.0,
                pc2_sector_explained_ratio=0.0,
                pc1_loadings=[1.0],
                neutralized_weights=[1.0],
            )

        n_samples = len(returns_matrix[0])
        # Compute centered covariance matrix
        cov = [[0.0] * m for _ in range(m)]
        for i in range(m):
            mean_i = sum(returns_matrix[i]) / n_samples
            for j in range(i, m):
                mean_j = sum(returns_matrix[j]) / n_samples
                c = sum((returns_matrix[i][t] - mean_i) * (returns_matrix[j][t] - mean_j) for t in range(n_samples)) / max(1, n_samples - 1)
                cov[i][j] = c
                cov[j][i] = c

        # Power iteration for PC1
        v1 = [1.0 / math.sqrt(m)] * m
        for _ in range(num_power_iterations):
            # Matrix-vector multiplication: w = Cov * v1
            w = [sum(cov[i][j] * v1[j] for j in range(m)) for i in range(m)]
            norm = math.sqrt(sum(x * x for x in w))
            if norm > 1e-12:
                v1 = [x / norm for x in w]
            else:
                break

        # PC1 eigenvalue lambda_1 = v1' * Cov * v1
        w = [sum(cov[i][j] * v1[j] for j in range(m)) for i in range(m)]
        lambda_1 = sum(v1[i] * w[i] for i in range(m))

        total_trace = sum(cov[i][i] for i in range(m))
        pc1_ratio = (lambda_1 / total_trace) if total_trace > 1e-12 else 0.70

        # Deflate covariance matrix for PC2: Cov_deflated = Cov - lambda_1 * (v1 * v1')
        cov_def = [[cov[i][j] - lambda_1 * v1[i] * v1[j] for j in range(m)] for i in range(m)]
        v2 = [(-1.0 if i % 2 == 0 else 1.0) / math.sqrt(m) for i in range(m)]
        for _ in range(num_power_iterations):
            w = [sum(cov_def[i][j] * v2[j] for j in range(m)) for i in range(m)]
            norm = math.sqrt(sum(x * x for x in w))
            if norm > 1e-12:
                v2 = [x / norm for x in w]
            else:
                break
        w2 = [sum(cov_def[i][j] * v2[j] for j in range(m)) for i in range(m)]
        lambda_2 = sum(v2[i] * w2[i] for i in range(m))
        pc2_ratio = (lambda_2 / total_trace) if total_trace > 1e-12 else 0.15

        # Factor neutralization: project base_weights onto the orthogonal complement of v1
        # w_proj = w - (w . v1) * v1
        dot_wv = sum(base_weights[i] * v1[i] for i in range(m))
        neutral_w = [base_weights[i] - dot_wv * v1[i] for i in range(m)]

        # Normalize absolute weights to 1.0
        abs_sum = sum(abs(x) for x in neutral_w)
        if abs_sum > 1e-12:
            neutral_w = [x / abs_sum for x in neutral_w]

        return PCAFactorDecomposition(
            num_factors=2,
            pc1_market_explained_ratio=pc1_ratio,
            pc2_sector_explained_ratio=pc2_ratio,
            pc1_loadings=v1,
            neutralized_weights=neutral_w,
        )

    def evaluate_harvest_opportunity(
        self,
        index_iv: float,
        index_rv: float,
        constituents: List[ConstituentAsset],
        returns_history_matrix: List[List[float]],
    ) -> DispersionSentryDecision:
        """
        Executes end-to-end dispersion analysis, evaluates CRP, neutralizes market factor,
        and generates actionable sentry trading directives.
        """
        profile = self.evaluate_dispersion_profile(index_iv, index_rv, constituents)
        base_w = [c.weight for c in constituents]
        pca = self.compute_pca_decomposition(returns_history_matrix, base_w)

        # Sentry Decision Rule Cascade
        if profile.implied_correlation >= self.crash_barrier:
            regime = DispersionRegimeState.CORRELATION_CRASH_EXPANSION
            action = (
                f"ABORT_DISPERSION: Implied correlation {profile.implied_correlation:.1%} "
                f"exceeds crash barrier {self.crash_barrier:.1%}. Systemic contagion active."
            )
        elif profile.correlation_risk_premium < -0.05:
            regime = DispersionRegimeState.NEGATIVE_DISPERSION_INVERSION
            action = (
                f"REVERSE_DISPERSION: Implied correlation {profile.implied_correlation:.1%} "
                f"< realized {profile.realized_correlation:.1%} (CRP={profile.correlation_risk_premium:.1%}). "
                f"Buy index vol, sell single-stock vol."
            )
        elif profile.correlation_risk_premium >= self.min_crp:
            regime = DispersionRegimeState.DISPERSION_HARVEST_OPTIMAL
            action = (
                f"HARVEST_DISPERSION: Rich CRP={profile.correlation_risk_premium:.1%}. "
                f"Sell index straddles, buy PC1-neutralized constituent basket."
            )
        else:
            regime = DispersionRegimeState.NEUTRAL_EQUILIBRIUM
            action = (
                f"NEUTRAL_HOLD: CRP={profile.correlation_risk_premium:.1%} below "
                f"{self.min_crp:.1%} execution hurdle."
            )

        return DispersionSentryDecision(
            profile=profile,
            pca=pca,
            regime=regime,
            recommended_action=action,
            details={
                "implied_correlation": profile.implied_correlation,
                "realized_correlation": profile.realized_correlation,
                "crp": profile.correlation_risk_premium,
                "pc1_explained": pca.pc1_market_explained_ratio,
                "pc2_explained": pca.pc2_sector_explained_ratio,
            },
        )
