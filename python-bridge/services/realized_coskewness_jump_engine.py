"""
Intraday Realized Co-Skewness Tensor & Cross-Asset Asymmetric Jump Engine
Domain 245 / Work Package WP-EQ

Computes high-frequency third-order cross-moment co-skewness tensors, decomposes
intraday returns into continuous bipower variation and signed jump variations,
identifies safe-haven vs crash-contagion assets, and derives optimal tail hedges.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class CoSkewnessRegimeState(str, Enum):
    ASYMMETRIC_CRASH_CONTAGION = "ASYMMETRIC_CRASH_CONTAGION"  # Widespread negative co-skewness, severe downside tail risk
    SAFE_HAVEN_ASYMMETRY_ACTIVE = "SAFE_HAVEN_ASYMMETRY_ACTIVE"# Non-negative co-skewness anchors identified, flight-to-safety
    BALANCED_DIFFUSIVE_REGIME = "BALANCED_DIFFUSIVE_REGIME"    # Symmetric returns, jump variation negligible
    IDIOSYNCRATIC_JUMP_OUTLIER = "IDIOSYNCRATIC_JUMP_OUTLIER"  # Single asset jump shock without systemic transmission


class CoSkewnessHedgeDirective(str, Enum):
    DEPLOY_DYNAMIC_PUT_HEDGE = "DEPLOY_DYNAMIC_PUT_HEDGE"      # Force OTM put overlay to neutralize negative co-skewness
    OVERWEIGHT_SAFE_HAVENS = "OVERWEIGHT_SAFE_HAVENS"          # Shift capital into positive co-skewness flight assets
    MAINTAIN_UNHEDGED_EXPOSURE = "MAINTAIN_UNHEDGED_EXPOSURE"  # Baseline portfolio weights, tail risk benign
    QUARANTINE_JUMP_OUTLIER = "QUARANTINE_JUMP_OUTLIER"        # Hedge isolated jump stock, avoid broad macro expense


@dataclass
class AssetIntradayReturns:
    asset_id: str
    returns: List[float]


@dataclass
class RealizedJumpMetrics:
    asset_id: str
    total_realized_var: float
    bipower_var: float
    jump_var: float
    jump_fraction: float                # jump_var / total_realized_var
    positive_jump_var: float
    negative_jump_var: float
    jump_skew: float                    # (JV+ - JV-) / total_realized_var


@dataclass
class CoSkewnessPair:
    target_asset: str
    benchmark_asset: str
    coskewness_value: float              # E[(r_i - mu_i) * (r_m - mu_m)^2] / (sigma_i * sigma_m^2)
    is_vulnerable_to_benchmark: bool     # coskewness <= -0.60
    is_safe_haven: bool                  # coskewness >= +0.40


@dataclass
class PortfolioCoSkewnessAssessment:
    timestamp_sec: float
    jump_metrics: Dict[str, RealizedJumpMetrics]
    pairwise_coskewness: List[CoSkewnessPair]
    systemic_contagion_index: float
    recommended_put_hedge_ratio: float   # 0.0 to 1.0
    safe_haven_assets: List[str]
    vulnerable_assets: List[str]
    regime: CoSkewnessRegimeState
    directive: CoSkewnessHedgeDirective
    rationales: List[str] = field(default_factory=list)


class RealizedCoSkewnessJumpEngine:
    """
    Analyzes high-frequency cross-asset return tensors to detect asymmetric crash
    contagion, signed jumps, and safe-haven dynamics.
    """

    def __init__(
        self,
        vulnerability_threshold: float = -0.50, # Co-skewness <= -0.50 marks crash vulnerability
        safe_haven_threshold: float = 0.40,     # Co-skewness >= +0.40 marks positive tail resilience
        jump_significance_z: float = 2.50,      # Jump threshold: 2.5 sigma relative to continuous local vol
        contagion_panic_threshold: float = 0.45,# Systemic contagion index >= 0.45 triggers macro collar
    ):
        self.vulnerability_threshold = vulnerability_threshold
        self.safe_haven_threshold = safe_haven_threshold
        self.jump_significance_z = jump_significance_z
        self.contagion_panic_threshold = contagion_panic_threshold

    def decompose_jumps(self, asset: AssetIntradayReturns) -> RealizedJumpMetrics:
        """
        Decomposes high-frequency intraday returns into continuous Bipower Variation (BV)
        and signed Realized Jump Variations (JV+ and JV-) via Barndorff-Nielsen & Shephard.
        """
        r = asset.returns
        m = len(r)
        if m < 5:
            return RealizedJumpMetrics(
                asset_id=asset.asset_id,
                total_realized_var=0.0001,
                bipower_var=0.0001,
                jump_var=0.0,
                jump_fraction=0.0,
                positive_jump_var=0.0,
                negative_jump_var=0.0,
                jump_skew=0.0,
            )

        # Realized Variance: sum(r_t^2)
        rv = sum(x * x for x in r)

        # Bipower Variation: (pi/2) * (m / (m-1)) * sum(|r_t| * |r_{t-1}|)
        abs_prod_sum = sum(abs(r[t]) * abs(r[t - 1]) for t in range(1, m))
        bv = (math.pi / 2.0) * (m / float(m - 1)) * abs_prod_sum

        # Jump variation: max(0, RV - BV)
        jv = max(0.0, rv - bv)
        jump_fraction = jv / max(1e-8, rv)

        # Signed jump extraction: individual moves > threshold
        threshold = self.jump_significance_z * math.sqrt(max(1e-8, bv / m))
        pos_jv = sum(x * x for x in r if x > threshold)
        neg_jv = sum(x * x for x in r if x < -threshold)
        jump_skew = (pos_jv - neg_jv) / max(1e-8, rv)

        return RealizedJumpMetrics(
            asset_id=asset.asset_id,
            total_realized_var=round(rv, 6),
            bipower_var=round(bv, 6),
            jump_var=round(jv, 6),
            jump_fraction=round(jump_fraction, 4),
            positive_jump_var=round(pos_jv, 6),
            negative_jump_var=round(neg_jv, 6),
            jump_skew=round(jump_skew, 4),
        )

    def compute_pairwise_coskewness(
        self,
        asset_i: AssetIntradayReturns,
        benchmark_m: AssetIntradayReturns,
    ) -> CoSkewnessPair:
        """
        Calculates normalized co-skewness:
        S(i, m) = E[(r_i - mu_i) * (r_m - mu_m)^2] / (sigma_i * sigma_m^2)
        """
        r_i = asset_i.returns
        r_m = benchmark_m.returns
        n = min(len(r_i), len(r_m))
        if n < 5:
            return CoSkewnessPair(asset_i.asset_id, benchmark_m.asset_id, 0.0, False, False)

        mu_i = sum(r_i[:n]) / n
        mu_m = sum(r_m[:n]) / n

        var_i = sum((x - mu_i) ** 2 for x in r_i[:n]) / n
        var_m = sum((x - mu_m) ** 2 for x in r_m[:n]) / n

        sigma_i = math.sqrt(max(1e-8, var_i))
        sigma_m_sq = max(1e-8, var_m)

        # Cross-skewness expectation
        cross_moment = sum((r_i[t] - mu_i) * ((r_m[t] - mu_m) ** 2) for t in range(n)) / n
        coskewness = cross_moment / (sigma_i * sigma_m_sq)

        is_vulnerable = coskewness <= self.vulnerability_threshold
        is_safe_haven = coskewness >= self.safe_haven_threshold

        return CoSkewnessPair(
            target_asset=asset_i.asset_id,
            benchmark_asset=benchmark_m.asset_id,
            coskewness_value=round(coskewness, 4),
            is_vulnerable_to_benchmark=is_vulnerable,
            is_safe_haven=is_safe_haven,
        )

    def evaluate_portfolio(
        self,
        constituents: List[AssetIntradayReturns],
        benchmark: AssetIntradayReturns,
        portfolio_weights: Optional[Dict[str, float]] = None,
        current_time_sec: float = 0.0,
    ) -> PortfolioCoSkewnessAssessment:
        """
        Synthesizes high-frequency jumps and co-skewness tensor into portfolio tail risk
        assessments and macro put hedging recommendations.
        """
        rationales: List[str] = []
        n_assets = len(constituents)

        # Compute jump metrics for all assets + benchmark
        jump_dict: Dict[str, RealizedJumpMetrics] = {}
        for a in constituents:
            jump_dict[a.asset_id] = self.decompose_jumps(a)
        benchmark_jumps = self.decompose_jumps(benchmark)
        jump_dict[benchmark.asset_id] = benchmark_jumps

        # Pairwise co-skewness against benchmark
        pairs: List[CoSkewnessPair] = []
        safe_havens: List[str] = []
        vulnerables: List[str] = []

        for a in constituents:
            pair = self.compute_pairwise_coskewness(a, benchmark)
            pairs.append(pair)
            if pair.is_safe_haven:
                safe_havens.append(a.asset_id)
            if pair.is_vulnerable_to_benchmark:
                vulnerables.append(a.asset_id)

        # Compute systemic contagion index (weighted average of negative co-skewness)
        if portfolio_weights is None:
            weights = {a.asset_id: 1.0 / max(1, n_assets) for a in constituents}
        else:
            weights = portfolio_weights

        contagion_index = sum(
            weights.get(p.target_asset, 0.0) * max(0.0, -p.coskewness_value)
            for p in pairs
        )

        # Dynamic put hedge ratio
        # Scaled by systemic contagion and benchmark negative jump fraction
        bench_neg_factor = math.sqrt(max(0.0, benchmark_jumps.negative_jump_var / max(1e-8, benchmark_jumps.total_realized_var)))
        hedge_ratio = min(1.0, max(0.0, 1.8 * contagion_index * (1.0 + bench_neg_factor)))

        # Decision State Machine
        # 1. Systemic Asymmetric Crash Contagion
        if contagion_index >= self.contagion_panic_threshold or len(vulnerables) >= max(2, int(0.5 * n_assets)):
            regime = CoSkewnessRegimeState.ASYMMETRIC_CRASH_CONTAGION
            directive = CoSkewnessHedgeDirective.DEPLOY_DYNAMIC_PUT_HEDGE
            rationales.append(
                f"Severe systemic tail contagion detected (Index={contagion_index:.3f}, {len(vulnerables)}/{n_assets} vulnerable assets). Deploy macro put hedge with ratio {hedge_ratio:.2f}."
            )

        # 2. Safe-haven flight asymmetry
        elif len(safe_havens) > 0 and contagion_index < 0.30:
            regime = CoSkewnessRegimeState.SAFE_HAVEN_ASYMMETRY_ACTIVE
            directive = CoSkewnessHedgeDirective.OVERWEIGHT_SAFE_HAVENS
            rationales.append(
                f"Safe-haven anti-fragility active in: {', '.join(safe_havens)}. Positive co-skewness protects against benchmark shocks. Shift allocations to safe havens."
            )

        # 3. Idiosyncratic jump outlier
        elif any(j.jump_fraction >= 0.40 for j in jump_dict.values()):
            regime = CoSkewnessRegimeState.IDIOSYNCRATIC_JUMP_OUTLIER
            directive = CoSkewnessHedgeDirective.QUARANTINE_JUMP_OUTLIER
            outliers = [k for k, v in jump_dict.items() if v.jump_fraction >= 0.40]
            rationales.append(
                f"Idiosyncratic discontinuous jump shock detected in {', '.join(outliers)} (Jump fraction >= 40%). Isolate and quarantine single-stock risk."
            )

        # 4. Balanced diffusive regime
        else:
            regime = CoSkewnessRegimeState.BALANCED_DIFFUSIVE_REGIME
            directive = CoSkewnessHedgeDirective.MAINTAIN_UNHEDGED_EXPOSURE
            hedge_ratio = 0.0
            rationales.append(
                "Co-skewness tensor symmetric and continuous bipower variation dominates. Maintain unhedged equity exposure."
            )

        return PortfolioCoSkewnessAssessment(
            timestamp_sec=current_time_sec,
            jump_metrics=jump_dict,
            pairwise_coskewness=pairs,
            systemic_contagion_index=round(contagion_index, 4),
            recommended_put_hedge_ratio=round(hedge_ratio, 3),
            safe_haven_assets=safe_havens,
            vulnerable_assets=vulnerables,
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
