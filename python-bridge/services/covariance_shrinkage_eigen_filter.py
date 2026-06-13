"""
Cross-Sectional Multi-Asset Realized Covariance Shrinkage & Ledoit-Wolf Dynamic Eigen-Filter Engine
Domain 247 / Work Package WP-ES

Implements analytical Ledoit-Wolf optimal linear covariance shrinkage and Marchenko-Pastur
Random Matrix Theory (RMT) eigenvalue clipping, sanitizing ill-conditioned empirical
covariance matrices for robust minimum-variance portfolio allocation.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class CovarianceRegimeState(str, Enum):
    WELL_CONDITIONED_LAMINAR = "WELL_CONDITIONED_LAMINAR"          # Condition number <= 50, low noise ratio
    ILL_CONDITIONED_NOISE_DOMINATED = "ILL_CONDITIONED_NOISE_DOMINATED" # N/T elevated, condition number > 100, RMT noise bulk
    SINGULAR_RANK_DEFICIENT = "SINGULAR_RANK_DEFICIENT"            # T <= N, rank deficient, requires hard regularized target


class CovarianceFilterDirective(str, Enum):
    USE_MODERATE_SHRINKAGE = "USE_MODERATE_SHRINKAGE"              # Baseline analytical shrinkage, inversion safe
    APPLY_LEDOIT_WOLF_AND_RMT_FILTER = "APPLY_LEDOIT_WOLF_AND_RMT_FILTER" # Filter Marchenko-Pastur noise eigenvalues
    FORCE_TARGET_SHRINKAGE_REGULARIZATION = "FORCE_TARGET_SHRINKAGE_REGULARIZATION" # High shrinkage to diagonal/equicorrelation target


@dataclass
class CovarianceFilterResult:
    n_assets: int
    n_observations: int
    dimension_ratio: float               # c = N / T
    shrinkage_intensity: float           # delta* in [0, 1]
    initial_condition_number: float      # lambda_max / lambda_min of sample cov
    filtered_condition_number: float     # lambda_max / lambda_min of filtered cov
    signal_eigenvalues_count: int
    noise_eigenvalues_count: int
    marchenko_pastur_upper_bound: float
    state: CovarianceRegimeState
    directive: CovarianceFilterDirective
    filtered_covariance: List[List[float]]
    rationales: List[str] = field(default_factory=list)


class CovarianceShrinkageEigenFilter:
    """
    Sanitizes empirical realized covariance matrices via Ledoit-Wolf analytical
    shrinkage and Marchenko-Pastur RMT eigenvalue spectrum filtering.
    """

    def __init__(
        self,
        condition_number_threshold: float = 100.0,
        max_acceptable_condition_number: float = 60.0,
        min_signal_eigenvalue_ratio: float = 1.05,
    ):
        self.condition_number_threshold = condition_number_threshold
        self.max_acceptable_condition_number = max_acceptable_condition_number
        self.min_signal_eigenvalue_ratio = min_signal_eigenvalue_ratio

    def compute_sample_covariance(self, returns: List[List[float]]) -> Tuple[List[List[float]], int, int]:
        """
        Computes sample covariance matrix S from T x N return matrix.
        returns: list of T observations, each having N asset returns.
        """
        t_obs = len(returns)
        if t_obs < 2:
            raise ValueError("Must have at least 2 return observations.")
        n_assets = len(returns[0])

        means = [sum(returns[t][i] for t in range(t_obs)) / t_obs for i in range(n_assets)]

        cov = [[0.0] * n_assets for _ in range(n_assets)]
        for i in range(n_assets):
            for j in range(i, n_assets):
                c = sum((returns[t][i] - means[i]) * (returns[t][j] - means[j]) for t in range(t_obs)) / (t_obs - 1)
                cov[i][j] = c
                cov[j][i] = c

        return cov, t_obs, n_assets

    def compute_ledoit_wolf_shrinkage(
        self,
        cov: List[List[float]],
        returns: List[List[float]],
    ) -> Tuple[List[List[float]], float]:
        """
        Computes analytical Ledoit-Wolf optimal linear shrinkage intensity toward
        constant correlation or diagonal target: F = diag(cov).
        """
        t_obs = len(returns)
        n = len(cov)
        means = [sum(returns[t][i] for t in range(t_obs)) / t_obs for i in range(n)]

        # Target matrix F: diagonal of sample covariance
        f_target = [[cov[i][j] if i == j else 0.0 for j in range(n)] for i in range(n)]

        # gamma = ||S - F||_F^2 (Frobenius norm squared of off-diagonals)
        gamma = sum(cov[i][j] ** 2 for i in range(n) for j in range(n) if i != j)

        # pi = sum asymptotic variance of entries s_ij
        pi_sum = 0.0
        for i in range(n):
            for j in range(n):
                # Sample variance of cross product (r_ti - mu_i)*(r_tj - mu_j)
                v_ij = sum(
                    (((returns[t][i] - means[i]) * (returns[t][j] - means[j])) - cov[i][j]) ** 2
                    for t in range(t_obs)
                ) / t_obs
                pi_sum += v_ij

        # Analytical shrinkage intensity delta* = min(1, max(0, (pi / t) / gamma))
        if gamma > 1e-12:
            delta = min(1.0, max(0.0, (pi_sum / t_obs) / gamma))
        else:
            delta = 0.0

        # Construct shrunk matrix: Sigma_shrunk = delta * F + (1 - delta) * S
        shrunk = [
            [(delta * f_target[i][j] + (1.0 - delta) * cov[i][j]) for j in range(n)]
            for i in range(n)
        ]

        return shrunk, delta

    def jacobi_eigenvalues(self, matrix: List[List[float]], max_iter: int = 60) -> Tuple[List[float], List[List[float]]]:
        """
        Computes eigenvalues and eigenvectors of real symmetric matrix via classical Jacobi rotations.
        """
        n = len(matrix)
        a = [row[:] for row in matrix]
        # Eigenvector accumulator initialized to identity
        v = [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]

        for _ in range(max_iter):
            # Find largest off-diagonal element
            p, q, max_val = 0, 1, 0.0
            for i in range(n):
                for j in range(i + 1, n):
                    if abs(a[i][j]) > max_val:
                        max_val = abs(a[i][j])
                        p, q = i, j

            if max_val < 1e-10:
                break

            # Compute rotation angle
            app = a[p][p]
            aqq = a[q][q]
            apq = a[p][q]

            if abs(app - aqq) < 1e-12:
                theta = math.pi / 4.0 if apq > 0 else -math.pi / 4.0
            else:
                theta = 0.5 * math.atan(2.0 * apq / (app - aqq))

            c = math.cos(theta)
            s = math.sin(theta)

            # Update matrix A
            for i in range(n):
                if i != p and i != q:
                    aip = a[i][p]
                    aiq = a[i][q]
                    a[i][p] = c * aip + s * aiq
                    a[p][i] = a[i][p]
                    a[i][q] = -s * aip + c * aiq
                    a[q][i] = a[i][q]

            a[p][p] = c * c * app + 2.0 * s * c * apq + s * s * aqq
            a[q][q] = s * s * app - 2.0 * s * c * apq + c * c * aqq
            a[p][q] = 0.0
            a[q][p] = 0.0

            # Update eigenvectors V
            for i in range(n):
                vip = v[i][p]
                viq = v[i][q]
                v[i][p] = c * vip + s * viq
                v[i][q] = -s * vip + c * viq

        eigenvalues = [a[i][i] for i in range(n)]
        return eigenvalues, v

    def filter_covariance(
        self,
        returns: List[List[float]],
    ) -> CovarianceFilterResult:
        """
        Executes end-to-end Ledoit-Wolf shrinkage and Marchenko-Pastur RMT eigenvalue clipping.
        """
        rationales: List[str] = []
        cov, t_obs, n_assets = self.compute_sample_covariance(returns)
        c_ratio = n_assets / float(t_obs)

        # Compute initial eigenvalues and condition number
        evals_initial, _ = self.jacobi_eigenvalues(cov)
        max_ev_init = max(evals_initial)
        min_ev_init = max(1e-12, min(evals_initial))
        init_cond = max_ev_init / min_ev_init

        # Check rank deficiency
        if t_obs <= n_assets or min_ev_init < 1e-8:
            state = CovarianceRegimeState.SINGULAR_RANK_DEFICIENT
            directive = CovarianceFilterDirective.FORCE_TARGET_SHRINKAGE_REGULARIZATION
            # Enforce 70% shrinkage to diagonal target
            delta = 0.70
            diag_f = [[cov[i][j] if i == j else 0.0 for j in range(n_assets)] for i in range(n_assets)]
            shrunk_cov = [
                [(delta * diag_f[i][j] + (1.0 - delta) * cov[i][j]) for j in range(n_assets)]
                for i in range(n_assets)
            ]
            evals_filtered, _ = self.jacobi_eigenvalues(shrunk_cov)
            filt_cond = max(evals_filtered) / max(1e-8, min(evals_filtered))
            rationales.append(
                f"Rank deficient sample covariance (T={t_obs} <= N={n_assets}). Applied 70% regularized diagonal shrinkage."
            )
            return CovarianceFilterResult(
                n_assets=n_assets,
                n_observations=t_obs,
                dimension_ratio=round(c_ratio, 3),
                shrinkage_intensity=round(delta, 3),
                initial_condition_number=round(init_cond, 2),
                filtered_condition_number=round(filt_cond, 2),
                signal_eigenvalues_count=1,
                noise_eigenvalues_count=n_assets - 1,
                marchenko_pastur_upper_bound=0.0,
                state=state,
                directive=directive,
                filtered_covariance=shrunk_cov,
                rationales=rationales,
            )

        # 1. Ledoit-Wolf Analytical Shrinkage
        shrunk_cov, delta = self.compute_ledoit_wolf_shrinkage(cov, returns)

        # 2. Marchenko-Pastur Spectral Decomposition on shrunk covariance
        evals, evecs = self.jacobi_eigenvalues(shrunk_cov)

        # Sort eigenvalues descending
        sorted_indices = sorted(range(n_assets), key=lambda idx: evals[idx], reverse=True)
        sorted_evals = [evals[idx] for idx in sorted_indices]
        sorted_evecs = [[evecs[i][idx] for idx in sorted_indices] for i in range(n_assets)]

        # Average variance of assets
        avg_var = sum(shrunk_cov[i][i] for i in range(n_assets)) / n_assets

        # Marchenko-Pastur upper noise bound: lambda_+ = sigma^2 * (1 + sqrt(c))^2
        mp_lambda_plus = avg_var * ((1.0 + math.sqrt(c_ratio)) ** 2)

        # Identify signal vs noise eigenvalues
        signal_indices = [i for i, val in enumerate(sorted_evals) if val > mp_lambda_plus * self.min_signal_eigenvalue_ratio]
        noise_indices = [i for i, val in enumerate(sorted_evals) if i not in signal_indices]

        # RMT Clipping: replace noise eigenvalues with their mean to preserve trace
        if noise_indices:
            noise_mean = sum(sorted_evals[i] for i in noise_indices) / len(noise_indices)
            clipped_evals = [
                sorted_evals[i] if i in signal_indices else noise_mean
                for i in range(n_assets)
            ]
        else:
            clipped_evals = sorted_evals

        # Reconstruct filtered covariance: Sigma = V * diag(evals) * V'
        filtered = [[0.0] * n_assets for _ in range(n_assets)]
        for i in range(n_assets):
            for j in range(n_assets):
                filtered[i][j] = sum(
                    sorted_evecs[i][k] * clipped_evals[k] * sorted_evecs[j][k]
                    for k in range(n_assets)
                )

        # Ensure diagonal values are strictly positive
        for i in range(n_assets):
            filtered[i][i] = max(1e-6, filtered[i][i])

        filt_cond = max(clipped_evals) / max(1e-8, min(clipped_evals))

        # State determination
        if init_cond >= self.condition_number_threshold or c_ratio >= 0.40:
            state = CovarianceRegimeState.ILL_CONDITIONED_NOISE_DOMINATED
            directive = CovarianceFilterDirective.APPLY_LEDOIT_WOLF_AND_RMT_FILTER
            rationales.append(
                f"Ill-conditioned sample covariance (Init cond={init_cond:.1f}, c={c_ratio:.2f}). Applied Ledoit-Wolf (delta={delta:.2f}) and clipped {len(noise_indices)} RMT noise eigenvalues (Filtered cond={filt_cond:.1f})."
            )
        else:
            state = CovarianceRegimeState.WELL_CONDITIONED_LAMINAR
            directive = CovarianceFilterDirective.USE_MODERATE_SHRINKAGE
            rationales.append(
                f"Sample covariance well-behaved (Init cond={init_cond:.1f}). Retained {len(signal_indices)} signal modes."
            )

        return CovarianceFilterResult(
            n_assets=n_assets,
            n_observations=t_obs,
            dimension_ratio=round(c_ratio, 3),
            shrinkage_intensity=round(delta, 3),
            initial_condition_number=round(init_cond, 2),
            filtered_condition_number=round(filt_cond, 2),
            signal_eigenvalues_count=len(signal_indices),
            noise_eigenvalues_count=len(noise_indices),
            marchenko_pastur_upper_bound=round(mp_lambda_plus, 6),
            state=state,
            directive=directive,
            filtered_covariance=filtered,
            rationales=rationales,
        )
