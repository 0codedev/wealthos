"""
Cross-Asset Order Flow Co-Skewness & Tail Risk Contagion Sentry
Domain 234 / Work Package WP-EF

Implements Harvey-Siddique (2000) conditional co-skewness tensors,
cross-sectional tail risk asymmetry metrics, systemic contagion indices,
and non-linear crash risk hedging triggers.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class ContagionRegimeState(str, Enum):
    SYSTEMIC_ASYMMETRIC_CONTAGION = "SYSTEMIC_ASYMMETRIC_CONTAGION" # Widespread negative co-skewness, crash contagion
    ISOLATED_IDIOSYNCRATIC_SKEW = "ISOLATED_IDIOSYNCRATIC_SKEW"     # 1-2 assets exhibit crash vulnerability
    SYMMETRIC_DIFFUSION_STABLE = "SYMMETRIC_DIFFUSION_STABLE"       # Near-zero co-skewness, Gaussian diffusion


@dataclass
class CoSkewnessMetric:
    symbol: str
    coskewness: float
    volatility: float
    is_vulnerable: bool
    tail_risk_contribution_pct: float


@dataclass
class ContagionAssessment:
    systemic_contagion_index: float
    vulnerable_assets: List[str]
    regime: ContagionRegimeState
    recommended_action: str
    recommended_hedge_ratio: float
    details: Dict[str, float] = field(default_factory=dict)


class CoSkewnessTailContagionSentry:
    """
    Measures asymmetric third-order cross-moments across cross-asset portfolios,
    detecting when market volatility spikes induce non-linear crash cascades.
    """

    def __init__(
        self,
        min_samples: int = 20,
        contagion_threshold: float = 0.40,
        critical_coskewness: float = -0.50,
    ):
        self.min_samples = min_samples
        self.contagion_threshold = contagion_threshold
        self.critical_coskewness = critical_coskewness

    @staticmethod
    def compute_coskewness(
        asset_returns: List[float],
        market_returns: List[float],
    ) -> float:
        """
        Calculates Harvey & Siddique (2000) Orthogonal Conditional Co-Skewness:
        r_i = alpha_i + beta_i * r_m + epsilon_i
        S(i, m) = E[epsilon_i * (r_m - mu_m)^2] / (sigma_epsilon * sigma_m^2)
        Projects out linear beta so S(i, m) isolates pure non-linear asymmetric crash risk.
        Negative values signify that asset i drops heavily when market volatility spikes.
        """
        n = min(len(asset_returns), len(market_returns))
        if n < 5:
            return 0.0

        r_i = asset_returns[:n]
        r_m = market_returns[:n]

        mu_i = sum(r_i) / n
        mu_m = sum(r_m) / n

        # Covariance and market variance for beta estimation
        cov_im = sum((r_i[t] - mu_i) * (r_m[t] - mu_m) for t in range(n))
        var_m = sum((r_m[t] - mu_m) ** 2 for t in range(n))

        if var_m < 1e-12:
            return 0.0

        beta = cov_im / var_m

        # Idiosyncratic residual orthogonal to linear market return
        residuals = [(r_i[t] - mu_i) - beta * (r_m[t] - mu_m) for t in range(n)]
        var_eps = sum(e * e for e in residuals) / n
        sigma_eps = math.sqrt(max(1e-12, var_eps))
        sigma_m = math.sqrt(var_m / n)

        denom = sigma_eps * (sigma_m ** 2)
        if denom < 1e-12:
            return 0.0

        # Cross-moment: sum(epsilon_i * (r_m - mu_m)^2) / n
        numerator = sum(residuals[t] * ((r_m[t] - mu_m) ** 2) for t in range(n)) / n
        coskew = numerator / denom

        return coskew

    def evaluate_portfolio_contagion(
        self,
        asset_returns_map: Dict[str, List[float]],
        market_returns: List[float],
    ) -> ContagionAssessment:
        """
        Performs full cross-sectional scan across portfolio assets against market anchor.
        Quantifies systemic tail contagion index and provides crash hedging directives.
        """
        if not asset_returns_map:
            return ContagionAssessment(
                systemic_contagion_index=0.0,
                vulnerable_assets=[],
                regime=ContagionRegimeState.SYMMETRIC_DIFFUSION_STABLE,
                recommended_action="EMPTY_PORTFOLIO: No assets to evaluate.",
                recommended_hedge_ratio=0.0,
            )

        coskew_map: Dict[str, CoSkewnessMetric] = {}
        negative_coskew_sum = 0.0
        vulnerable_list: List[str] = []

        for symbol, returns in asset_returns_map.items():
            cs = self.compute_coskewness(returns, market_returns)
            # Volatility
            n = len(returns)
            mu = sum(returns) / max(1, n)
            var = sum((x - mu) ** 2 for x in returns) / max(1, n - 1) if n > 1 else 0.001
            vol = math.sqrt(max(1e-10, var))

            is_vuln = cs <= self.critical_coskewness
            if is_vuln:
                vulnerable_list.append(symbol)

            # Contagion contribution from negative co-skewness
            neg_contribution = max(0.0, -cs)
            negative_coskew_sum += neg_contribution

            coskew_map[symbol] = CoSkewnessMetric(
                symbol=symbol,
                coskewness=cs,
                volatility=vol,
                is_vulnerable=is_vuln,
                tail_risk_contribution_pct=neg_contribution * 100.0,
            )

        total_assets = len(asset_returns_map)
        # Average negative co-skewness across portfolio
        contagion_index = negative_coskew_sum / max(1, total_assets)
        vulnerable_ratio = len(vulnerable_list) / max(1, total_assets)

        # Sentry Decision Rule Cascade
        # Systemic contagion requires widespread vulnerability across multiple assets
        is_systemic = (contagion_index >= self.contagion_threshold and len(vulnerable_list) >= 2) or (vulnerable_ratio >= 0.50)

        if is_systemic:
            regime = ContagionRegimeState.SYSTEMIC_ASYMMETRIC_CONTAGION
            # Recommend 50% gross exposure hedge
            hedge_ratio = min(0.60, max(0.25, contagion_index * 0.8))
            action = (
                f"SYSTEMIC_CONTAGION_CRITICAL: Contagion index {contagion_index:.2f} "
                f"({len(vulnerable_list)}/{total_assets} assets vulnerable). "
                f"Deploy downside crash put protection with {hedge_ratio:.0%} delta coverage."
            )
        elif len(vulnerable_list) > 0:
            regime = ContagionRegimeState.ISOLATED_IDIOSYNCRATIC_SKEW
            hedge_ratio = 0.15
            action = (
                f"ISOLATED_SKEW: {', '.join(vulnerable_list)} exhibit high tail risk "
                f"(coskew < {self.critical_coskewness}). Hedge individual constituent deltas."
            )
        else:
            regime = ContagionRegimeState.SYMMETRIC_DIFFUSION_STABLE
            hedge_ratio = 0.0
            action = f"STABLE_SYMMETRIC: Contagion index {contagion_index:.2f} within normal limits. Linear hedging valid."

        return ContagionAssessment(
            systemic_contagion_index=contagion_index,
            vulnerable_assets=vulnerable_list,
            regime=regime,
            recommended_action=action,
            recommended_hedge_ratio=hedge_ratio,
            details={
                "contagion_index": contagion_index,
                "vulnerable_count": float(len(vulnerable_list)),
                "total_assets": float(total_assets),
                "vulnerable_ratio": vulnerable_ratio,
            },
        )
