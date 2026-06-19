"""
Multi-Asset Intraday Momentum & Kyle's Lambda Price Impact Calibration Engine
Domain 227 / Work Package WP-DY

Calibrates continuous Kyle's lambda permanent price impact from signed order flow,
models cross-asset intraday lead-lag momentum propagation matrices,
and filters out false momentum signals where execution impact cost exceeds alpha.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class IlliquidityRegimeState(str, Enum):
    LOW_IMPACT_LIQUID = "LOW_IMPACT_LIQUID"        # Deep liquidity, minimal price displacement
    MODERATE_IMPACT = "MODERATE_IMPACT"            # Normal execution friction
    HIGH_IMPACT_ILLIQUID = "HIGH_IMPACT_ILLIQUID"  # High Kyle's lambda, toxic adverse selection


class MomentumTradeState(str, Enum):
    EXECUTE_MOMENTUM_LONG = "EXECUTE_MOMENTUM_LONG"
    EXECUTE_MOMENTUM_SHORT = "EXECUTE_MOMENTUM_SHORT"
    THROTTLE_IMPACT_EXCESS = "THROTTLE_IMPACT_EXCESS" # Alpha eaten up by Kyle's lambda impact
    NEUTRAL_HOLD = "NEUTRAL_HOLD"


@dataclass
class OrderFlowTick:
    price: float
    signed_volume: float  # positive for buyer-initiated, negative for seller-initiated
    timestamp: float


@dataclass
class KyleLambdaCalibration:
    lambda_kyle: float         # dPrice / dSignedVolume
    r_squared: float
    t_statistic: float
    sample_size: int
    regime: IlliquidityRegimeState


@dataclass
class LeadLagRelationship:
    leader: str
    follower: str
    optimal_lag_steps: int
    cross_correlation: float
    lead_score: float


@dataclass
class MomentumExecutionDecision:
    target_asset: str
    raw_momentum_zscore: float
    expected_alpha_usd: float
    kyle_lambda: float
    expected_impact_usd: float
    net_edge_usd: float
    recommendation: MomentumTradeState
    action_notes: str
    details: Dict[str, float] = field(default_factory=dict)


class MomentumKyleLambdaCalibrationEngine:
    """
    Calibrates Kyle's lambda from high-frequency trade order flow,
    extracts cross-asset lead-lag momentum signals, and enforces impact gating.
    """

    def __init__(
        self,
        min_samples: int = 15,
        alpha_scaling_factor: float = 1.0,
        significance_t_stat: float = 1.96,
    ):
        self.min_samples = min_samples
        self.alpha_scaling = alpha_scaling_factor
        self.significance_t = significance_t_stat

    def calibrate_kyle_lambda(self, ticks: List[OrderFlowTick]) -> KyleLambdaCalibration:
        """
        Calibrates Kyle's Lambda via OLS regression of price changes on signed volume:
        Delta P_t = alpha + lambda * Q_t + epsilon_t
        lambda = Cov(Delta P, Q) / Var(Q)
        """
        if len(ticks) < max(4, self.min_samples):
            return KyleLambdaCalibration(
                lambda_kyle=0.0,
                r_squared=0.0,
                t_statistic=0.0,
                sample_size=len(ticks),
                regime=IlliquidityRegimeState.MODERATE_IMPACT,
            )

        delta_p = []
        signed_q = []

        for i in range(1, len(ticks)):
            dp = ticks[i].price - ticks[i - 1].price
            q = ticks[i].signed_volume
            delta_p.append(dp)
            signed_q.append(q)

        n = len(delta_p)
        mean_dp = sum(delta_p) / n
        mean_q = sum(signed_q) / n

        var_q = sum((q - mean_q) ** 2 for q in signed_q)
        cov_p_q = sum((signed_q[i] - mean_q) * (delta_p[i] - mean_dp) for i in range(n))

        if var_q <= 1e-12:
            lambda_k = 0.0
            r_sq = 0.0
            t_stat = 0.0
        else:
            # Enforce non-negative Kyle lambda (buying increases price, selling decreases price)
            raw_lambda = cov_p_q / var_q
            lambda_k = max(0.0, raw_lambda)

            # Residual variance
            alpha_intercept = mean_dp - lambda_k * mean_q
            residuals = [delta_p[i] - (alpha_intercept + lambda_k * signed_q[i]) for i in range(n)]
            rss = sum(r * r for r in residuals)
            tss = sum((dp - mean_dp) ** 2 for dp in delta_p)

            r_sq = max(0.0, 1.0 - (rss / tss)) if tss > 1e-12 else 0.0

            df = max(1, n - 2)
            s_err = math.sqrt(rss / df) if df > 0 else 1.0
            se_lambda = s_err / math.sqrt(var_q) if var_q > 0 else 1.0
            t_stat = lambda_k / se_lambda if se_lambda > 1e-12 else 0.0

        # Regime classification based on lambda scale
        # Normalized lambda: dollar price impact per 1,000 units
        impact_per_1k = lambda_k * 1000.0
        if impact_per_1k < 0.25:
            regime = IlliquidityRegimeState.LOW_IMPACT_LIQUID
        elif impact_per_1k < 2.0:
            regime = IlliquidityRegimeState.MODERATE_IMPACT
        else:
            regime = IlliquidityRegimeState.HIGH_IMPACT_ILLIQUID

        return KyleLambdaCalibration(
            lambda_kyle=lambda_k,
            r_squared=r_sq,
            t_statistic=t_stat,
            sample_size=n,
            regime=regime,
        )

    @staticmethod
    def compute_lead_lag_cross_correlation(
        leader_series: List[float],
        follower_series: List[float],
        max_lags: int = 5,
    ) -> LeadLagRelationship:
        """
        Calculates lagged cross-correlation:
        corr(leader_{t-k}, follower_t) for k in [1, max_lags]
        Identifies the optimal predictive lead step and lead-lag score.
        """
        n = min(len(leader_series), len(follower_series))
        if n < max_lags + 5:
            return LeadLagRelationship(
                leader="leader", follower="follower",
                optimal_lag_steps=1, cross_correlation=0.0, lead_score=0.0
            )

        best_lag = 1
        best_corr = 0.0

        for k in range(1, max_lags + 1):
            x = leader_series[:n - k]
            y = follower_series[k:n]

            m_x = sum(x) / len(x)
            m_y = sum(y) / len(y)

            var_x = sum((val - m_x) ** 2 for val in x)
            var_y = sum((val - m_y) ** 2 for val in y)

            if var_x > 1e-12 and var_y > 1e-12:
                cov = sum((x[i] - m_x) * (y[i] - m_y) for i in range(len(x)))
                corr = cov / math.sqrt(var_x * var_y)
                if abs(corr) > abs(best_corr):
                    best_corr = corr
                    best_lag = k

        # Decay weight for longer lags
        lead_score = best_corr / math.sqrt(best_lag)

        return LeadLagRelationship(
            leader="leader",
            follower="follower",
            optimal_lag_steps=best_lag,
            cross_correlation=best_corr,
            lead_score=lead_score,
        )

    def evaluate_momentum_opportunity(
        self,
        target_asset: str,
        leader_returns: List[float],
        follower_returns: List[float],
        order_flow_ticks: List[OrderFlowTick],
        target_shares: float,
        current_price: float,
    ) -> MomentumExecutionDecision:
        """
        Synthesizes lead-lag momentum with Kyle's lambda price impact gating.
        Ensures trades are only executed when net executable alpha > impact friction.
        """
        # Calibrate Kyle's lambda
        kyle = self.calibrate_kyle_lambda(order_flow_ticks)

        # Calibrate cross-asset lead-lag
        lead_lag = self.compute_lead_lag_cross_correlation(leader_returns, follower_returns)

        # Recent leader momentum innovation (average of last 3 returns)
        recent_leader_move = sum(leader_returns[-3:]) / 3.0 if len(leader_returns) >= 3 else 0.0
        follower_vol = math.sqrt(sum(r * r for r in follower_returns) / max(1, len(follower_returns))) if follower_returns else 0.001

        # Projected follower alpha in basis points and USD
        expected_ret = lead_lag.lead_score * recent_leader_move * self.alpha_scaling
        raw_zscore = expected_ret / max(1e-5, follower_vol)

        trade_notional_usd = target_shares * current_price
        expected_alpha_usd = expected_ret * trade_notional_usd

        # Kyle's lambda market impact cost:
        # Permanent impact per share = lambda * shares
        # Total dollar impact = lambda * (shares^2)
        expected_impact_usd = kyle.lambda_kyle * (target_shares ** 2)

        net_edge_usd = abs(expected_alpha_usd) - expected_impact_usd

        # Decision rule
        if abs(raw_zscore) < 0.8:
            state = MomentumTradeState.NEUTRAL_HOLD
            action = f"NEUTRAL_HOLD: Weak lead-lag momentum signal z={raw_zscore:.2f}."
        elif net_edge_usd <= 0.0:
            state = MomentumTradeState.THROTTLE_IMPACT_EXCESS
            action = (
                f"THROTTLE_IMPACT: Expected alpha ${abs(expected_alpha_usd):.2f} consumed "
                f"by Kyle lambda impact ${expected_impact_usd:.2f} (Net: ${net_edge_usd:.2f})."
            )
        elif raw_zscore > 0.0:
            state = MomentumTradeState.EXECUTE_MOMENTUM_LONG
            action = (
                f"EXECUTE_LONG: Net alpha ${net_edge_usd:.2f} (Alpha: ${expected_alpha_usd:.2f}, "
                f"Impact: ${expected_impact_usd:.2f}, z={raw_zscore:.2f})."
            )
        else:
            state = MomentumTradeState.EXECUTE_MOMENTUM_SHORT
            action = (
                f"EXECUTE_SHORT: Net alpha ${net_edge_usd:.2f} (Alpha: ${expected_alpha_usd:.2f}, "
                f"Impact: ${expected_impact_usd:.2f}, z={raw_zscore:.2f})."
            )

        return MomentumExecutionDecision(
            target_asset=target_asset,
            raw_momentum_zscore=raw_zscore,
            expected_alpha_usd=expected_alpha_usd,
            kyle_lambda=kyle.lambda_kyle,
            expected_impact_usd=expected_impact_usd,
            net_edge_usd=net_edge_usd,
            recommendation=state,
            action_notes=action,
            details={
                "lead_score": lead_lag.lead_score,
                "optimal_lag": float(lead_lag.optimal_lag_steps),
                "kyle_t_stat": kyle.t_statistic,
                "kyle_r_squared": kyle.r_squared,
            },
        )
