"""
Cross-Asset Structural Breakpoint Bai-Perron Multiple Shift Sentry
Domain 276 / Work Package WP-FV

Implements Bai & Perron (1998, 2003) dynamic programming multiple structural
break detection on cross-asset return series, hedge ratios, and volatility spreads.
Identifies endogenous regime fractures, estimates optimal break dates minimizing
global sum of squared residuals (SSR), and enforces real-time institutional risk
deleveraging when recent structural breakdown occurs.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class StructuralBreakRegime(str, Enum):
    HOMOGENEOUS_STABLE = "HOMOGENEOUS_STABLE"              # m* = 0, no breaks detected
    REGIME_STABILIZING = "REGIME_STABILIZING"              # m* >= 1, last break occurred > 2*h bars ago
    CRITICAL_STRUCTURAL_SHIFT = "CRITICAL_STRUCTURAL_SHIFT"  # m* >= 1, last break occurred <= 2*h bars ago (fresh fracture)


class BreakRiskDirective(str, Enum):
    FULL_OPERATIONS_MAINTAIN_LEVERAGE = "FULL_OPERATIONS_MAINTAIN_LEVERAGE"  # Baseline 1.0x capacity
    RECALIBRATE_REGIME_PRIORS = "RECALIBRATE_REGIME_PRIORS"                  # Reset Kalman priors, 0.80x capacity
    EMERGENCY_DELEVERAGE_AND_FLUSH = "EMERGENCY_DELEVERAGE_AND_FLUSH"        # Freeze pairs, flush priors, 0.30x capacity


@dataclass
class SegmentSummary:
    segment_index: int
    start_idx: int
    end_idx: int
    sample_size: int
    mean_y: float
    slope_beta: Optional[float]
    intercept_alpha: Optional[float]
    residual_variance: float
    residual_ssr: float


@dataclass
class BaiPerronConfig:
    max_breaks: int = 3                # Maximum number of structural breaks m_max
    trimming_ratio: float = 0.15       # Trimming parameter epsilon (segment fraction)
    min_segment_length: int = 6        # Strict minimum samples per segment h
    f_crit_threshold: float = 8.5      # Sequential F-test critical boundary F(l+1|l)
    bic_penalty_weight: float = 1.0    # Weight for BIC model selection
    emergency_leverage_cap: float = 0.30  # Max exposure under CRITICAL_STRUCTURAL_SHIFT


@dataclass
class BreakpointAssessment:
    asset_id: str
    total_samples: int
    optimal_breaks_count: int
    break_indices: List[int]
    regime: StructuralBreakRegime
    directive: BreakRiskDirective
    recommended_leverage: float
    bic_scores: Dict[int, float]
    f_stats: Dict[str, float]
    segments: List[SegmentSummary]
    bars_since_last_break: Optional[int]
    rationales: List[str] = field(default_factory=list)


class BaiPerronStructuralBreakSentry:
    """
    Bai-Perron dynamic programming multiple structural break partition solver.
    Operates on univariate mean-shift series or bivariate regression (pairs hedge ratios).
    """

    def __init__(self, config: Optional[BaiPerronConfig] = None):
        self.config = config or BaiPerronConfig()

    def _fit_segment(
        self,
        y: List[float],
        x: Optional[List[float]],
        s: int,
        e: int,
    ) -> Tuple[float, float, Optional[float], Optional[float]]:
        """
        Fits OLS on segment [s, e] (0-indexed inclusive).
        Returns: (ssr, mean_y, alpha, beta)
        """
        n = e - s + 1
        if n < 1:
            return 0.0, 0.0, None, None

        seg_y = y[s : e + 1]
        mean_y = sum(seg_y) / n

        if x is None:
            # Univariate mean shift model: y_t = mu + eps_t
            ssr = sum((val - mean_y) ** 2 for val in seg_y)
            return ssr, mean_y, mean_y, None

        # Bivariate model: y_t = alpha + beta * x_t + eps_t
        seg_x = x[s : e + 1]
        mean_x = sum(seg_x) / n

        s_xx = sum((seg_x[i] - mean_x) ** 2 for i in range(n))
        s_xy = sum((seg_x[i] - mean_x) * (seg_y[i] - mean_y) for i in range(n))

        if s_xx < 1e-12:
            beta = 0.0
            alpha = mean_y
            ssr = sum((seg_y[i] - mean_y) ** 2 for i in range(n))
        else:
            beta = s_xy / s_xx
            alpha = mean_y - beta * mean_x
            ssr = sum((seg_y[i] - (alpha + beta * seg_x[i])) ** 2 for i in range(n))

        return ssr, mean_y, alpha, beta

    def evaluate_series(
        self,
        asset_id: str,
        y: List[float],
        x: Optional[List[float]] = None,
    ) -> BreakpointAssessment:
        """
        Solves Bai-Perron dynamic programming segmentation and outputs risk assessment.
        """
        T = len(y)
        h = max(self.config.min_segment_length, int(math.floor(self.config.trimming_ratio * T)))
        max_m = self.config.max_breaks

        # Check feasibility
        if T < 2 * h:
            ssr_0, mean_0, a_0, b_0 = self._fit_segment(y, x, 0, T - 1)
            var_0 = ssr_0 / max(1, T)
            seg_0 = SegmentSummary(
                segment_index=0,
                start_idx=0,
                end_idx=T - 1,
                sample_size=T,
                mean_y=mean_0,
                slope_beta=b_0,
                intercept_alpha=a_0,
                residual_variance=var_0,
                residual_ssr=ssr_0,
            )
            return BreakpointAssessment(
                asset_id=asset_id,
                total_samples=T,
                optimal_breaks_count=0,
                break_indices=[],
                regime=StructuralBreakRegime.HOMOGENEOUS_STABLE,
                directive=BreakRiskDirective.FULL_OPERATIONS_MAINTAIN_LEVERAGE,
                recommended_leverage=1.0,
                bic_scores={0: math.log(max(1e-12, ssr_0 / max(1, T)))},
                f_stats={},
                segments=[seg_0],
                bars_since_last_break=None,
                rationales=[f"Sample size {T} below minimal 2*h ({2*h}) requirement. Series assumed stable."],
            )

        # Cap max_breaks by data length
        max_possible_breaks = max(1, (T // h) - 1)
        m_limit = min(max_m, max_possible_breaks)

        # Precompute segment SSRs
        # seg_ssr[s][e] stores SSR for interval [s, e]
        # To optimize, we compute dynamically with memoization
        memo_ssr: Dict[Tuple[int, int], Tuple[float, float, Optional[float], Optional[float]]] = {}

        def get_seg(s: int, e: int):
            if (s, e) not in memo_ssr:
                memo_ssr[(s, e)] = self._fit_segment(y, x, s, e)
            return memo_ssr[(s, e)]

        # Dynamic programming table
        # dp[m][t] = minimal SSR with m breaks on prefix [0 ... t] (0-indexed, length t+1)
        # parent[m][t] = optimal partition index s* such that last break is at s*, segment is [s*+1, t]
        dp: List[Dict[int, float]] = [{} for _ in range(m_limit + 1)]
        parent: List[Dict[int, int]] = [{} for _ in range(m_limit + 1)]

        # Base case: 0 breaks (m=0)
        for t in range(h - 1, T):
            ssr, _, _, _ = get_seg(0, t)
            dp[0][t] = ssr

        # Induction: m breaks (m = 1 ... m_limit)
        for m in range(1, m_limit + 1):
            for t in range((m + 1) * h - 1, T):
                best_ssr = float("inf")
                best_s = -1
                # Previous segment must end at s >= m*h - 1, and new segment [s+1, t] has length >= h
                # => s + 1 <= t - h + 1 => s <= t - h
                min_s = m * h - 1
                max_s = t - h
                for s in range(min_s, max_s + 1):
                    if s in dp[m - 1]:
                        curr_ssr = dp[m - 1][s] + get_seg(s + 1, t)[0]
                        if curr_ssr < best_ssr:
                            best_ssr = curr_ssr
                            best_s = s
                if best_s != -1:
                    dp[m][t] = best_ssr
                    parent[m][t] = best_s

        # Compute SSR and BIC for each break candidate m = 0 ... m_limit
        p_params = 2 if x is not None else 1
        bic_scores: Dict[int, float] = {}
        f_stats: Dict[str, float] = {}
        break_candidates: Dict[int, List[int]] = {}

        for m in range(m_limit + 1):
            if T - 1 in dp[m]:
                ssr_m = dp[m][T - 1]
                # BIC formulation: ln(SSR / T) + (m + 1) * p * ln(T) / T
                mean_sq_err = max(1e-12, ssr_m / T)
                bic = math.log(mean_sq_err) + (m + 1) * p_params * math.log(T) / T * self.config.bic_penalty_weight
                bic_scores[m] = bic

                # Reconstruct break points
                breaks: List[int] = []
                curr_t = T - 1
                for curr_m in range(m, 0, -1):
                    s_split = parent[curr_m][curr_t]
                    breaks.append(s_split)
                    curr_t = s_split
                breaks.reverse()
                break_candidates[m] = breaks

        # Sequential F-tests F(m+1 | m)
        for m in range(m_limit):
            if m < len(dp) and (m + 1) < len(dp) and (T - 1) in dp[m] and (T - 1) in dp[m + 1]:
                ssr_m = dp[m][T - 1]
                ssr_next = dp[m + 1][T - 1]
                denom_dof = T - (m + 2) * p_params
                if denom_dof > 0 and ssr_next > 1e-12:
                    f_val = ((ssr_m - ssr_next) / p_params) / (ssr_next / denom_dof)
                    f_stats[f"F({m+1}|{m})"] = max(0.0, f_val)

        # Determine optimal number of breaks m* using standard Bai-Perron sequential testing:
        # Starting from m=0, reject m in favor of m+1 if F(m+1|m) >= f_crit_threshold.
        opt_m = 0
        for m in range(m_limit):
            test_key = f"F({m+1}|{m})"
            if test_key in f_stats and f_stats[test_key] >= self.config.f_crit_threshold:
                opt_m = m + 1
            else:
                break

        optimal_breaks = break_candidates.get(opt_m, [])

        # Build segment summaries
        partition_points = [-1] + optimal_breaks + [T - 1]
        segments: List[SegmentSummary] = []
        for i in range(len(partition_points) - 1):
            s_idx = partition_points[i] + 1
            e_idx = partition_points[i + 1]
            seg_ssr, seg_mean, seg_alpha, seg_beta = get_seg(s_idx, e_idx)
            seg_size = e_idx - s_idx + 1
            segments.append(
                SegmentSummary(
                    segment_index=i,
                    start_idx=s_idx,
                    end_idx=e_idx,
                    sample_size=seg_size,
                    mean_y=seg_mean,
                    slope_beta=seg_beta,
                    intercept_alpha=seg_alpha,
                    residual_variance=seg_ssr / max(1, seg_size),
                    residual_ssr=seg_ssr,
                )
            )

        rationales: List[str] = []
        bars_since_last_break = None

        if opt_m == 0:
            regime = StructuralBreakRegime.HOMOGENEOUS_STABLE
            directive = BreakRiskDirective.FULL_OPERATIONS_MAINTAIN_LEVERAGE
            leverage = 1.0
            rationales.append("No statistically significant structural breaks detected; distribution is homogeneous.")
        else:
            last_break_idx = optimal_breaks[-1]
            bars_since_last_break = (T - 1) - last_break_idx

            if bars_since_last_break <= 2 * h:
                regime = StructuralBreakRegime.CRITICAL_STRUCTURAL_SHIFT
                directive = BreakRiskDirective.EMERGENCY_DELEVERAGE_AND_FLUSH
                leverage = self.config.emergency_leverage_cap
                rationales.append(
                    f"Fresh structural break detected at bar {last_break_idx} ({bars_since_last_break} bars ago <= 2*h threshold {2*h}). "
                    f"Priors invalidated; emergency deleveraging to {leverage*100:.0f}% enforced."
                )
            else:
                regime = StructuralBreakRegime.REGIME_STABILIZING
                directive = BreakRiskDirective.RECALIBRATE_REGIME_PRIORS
                leverage = 0.80
                rationales.append(
                    f"Structural break at bar {last_break_idx} stabilized ({bars_since_last_break} bars elapsed > 2*h). "
                    f"Priors recalibrated to latest regime parameters."
                )

        return BreakpointAssessment(
            asset_id=asset_id,
            total_samples=T,
            optimal_breaks_count=opt_m,
            break_indices=optimal_breaks,
            regime=regime,
            directive=directive,
            recommended_leverage=leverage,
            bic_scores=bic_scores,
            f_stats=f_stats,
            segments=segments,
            bars_since_last_break=bars_since_last_break,
            rationales=rationales,
        )
