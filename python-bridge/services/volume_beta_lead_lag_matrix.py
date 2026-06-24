"""
Intraday Volume Profile Beta & Continuous Multi-Factor Lead-Lag Matrix
Domain 246 / Work Package WP-ER

Extracts multi-lag cross-correlation tensors, computes Hayashi-Yoshida lead-lag
asymmetry scores, models volume-modulated price discovery betas, and executes
predictive cross-asset latency arbitrage before lagging books update.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class LeadLagRegimeState(str, Enum):
    STRONG_PREDICTIVE_LEAD_LAG = "STRONG_PREDICTIVE_LEAD_LAG"  # Clear leader with peak correlation at tau > 0
    SYNCHRONOUS_EQUILIBRIUM = "SYNCHRONOUS_EQUILIBRIUM"        # Zero lag, assets update simultaneously
    VOLUME_BURST_LEAD_FLIP = "VOLUME_BURST_LEAD_FLIP"          # Follower volume surge temporarily captures lead
    UNCORRELATED_DIFFUSION = "UNCORRELATED_DIFFUSION"          # Cross-correlation negligible, independent paths


class LeadLagExecutionDirective(str, Enum):
    EXECUTE_PREDICTIVE_LEAD_LAG_SWEEP = "EXECUTE_PREDICTIVE_LEAD_LAG_SWEEP" # Sweep lagging asset ahead of price propagation
    HOLD_COMOVING_NEUTRAL = "HOLD_COMOVING_NEUTRAL"            # No lead edge, books synchronous
    RECALIBRATE_LEAD_ANCHOR = "RECALIBRATE_LEAD_ANCHOR"        # Re-assign dominant price discovery leader
    DECOUPLE_PAIR_TRADING = "DECOUPLE_PAIR_TRADING"            # Avoid stat-arb on uncoupled pairs


@dataclass
class AssetSeries:
    asset_id: str
    returns: List[float]
    volume_ratio: float = 1.0          # Current volume / normal diurnal baseline volume


@dataclass
class PairLeadLagMetrics:
    leader: str
    follower: str
    optimal_lag_steps: int             # Positive means leader leads follower by k steps
    peak_correlation: float
    lead_asymmetry_score: float        # Area positive lags - area negative lags
    predicted_forward_drift_bps: float # Expected price change in follower in bps
    executable_edge_bps: float         # Forward drift minus taker fee and slip


@dataclass
class LeadLagMatrixAssessment:
    timestamp_sec: float
    lead_scores: Dict[str, float]      # Aggregate leadership score per asset
    dominant_anchor: str
    pairwise_metrics: List[PairLeadLagMetrics]
    regime: LeadLagRegimeState
    directive: LeadLagExecutionDirective
    best_trade: Optional[PairLeadLagMetrics]
    rationales: List[str] = field(default_factory=list)


class VolumeBetaLeadLagMatrix:
    """
    Computes cross-asset lagged cross-correlation matrices across discrete time shifts,
    identifying predictable lead-lag propagation pathways modulated by volume activity.
    """

    def __init__(
        self,
        max_lag_steps: int = 5,                # Max time shift in steps (e.g. 5 ticks / seconds)
        min_peak_corr_threshold: float = 0.40, # Min correlation to qualify as coherent link
        min_executable_edge_bps: float = 1.50, # Min edge after 2.0 bps fee/slip friction
        friction_cost_bps: float = 2.00,       # Taker fee + half-spread on follower
    ):
        self.max_lag_steps = max_lag_steps
        self.min_peak_corr_threshold = min_peak_corr_threshold
        self.min_executable_edge_bps = min_executable_edge_bps
        self.friction_cost_bps = friction_cost_bps

    def compute_lagged_cross_correlation(
        self,
        r1: List[float],
        r2: List[float],
        lag: int,  # lag > 0: r1 leads r2 (r1 at t, r2 at t + lag)
    ) -> float:
        """Computes Pearson correlation between r1[t] and r2[t + lag]."""
        n = len(r1)
        if lag > 0:
            s1 = r1[:n - lag]
            s2 = r2[lag:]
        elif lag < 0:
            s1 = r1[-lag:]
            s2 = r2[:n + lag]
        else:
            s1 = r1
            s2 = r2

        m = len(s1)
        if m < 10:
            return 0.0

        m1 = sum(s1) / m
        m2 = sum(s2) / m

        cov = sum((s1[t] - m1) * (s2[t] - m2) for t in range(m)) / m
        v1 = sum((x - m1) ** 2 for x in s1) / m
        v2 = sum((x - m2) ** 2 for x in s2) / m

        denom = math.sqrt(max(1e-12, v1 * v2))
        return cov / denom

    def analyze_pair(
        self,
        a1: AssetSeries,
        a2: AssetSeries,
        recent_leader_shock_bps: float = 0.0,
    ) -> PairLeadLagMetrics:
        """
        Calculates the full cross-correlation curve over [-max_lag, +max_lag],
        determines the optimal lag, and models the forward predictive drift.
        """
        lags = list(range(-self.max_lag_steps, self.max_lag_steps + 1))
        corr_curve = [self.compute_lagged_cross_correlation(a1.returns, a2.returns, k) for k in lags]

        # Optimal lag: argmax |rho(k)|
        best_idx = max(range(len(lags)), key=lambda idx: abs(corr_curve[idx]))
        opt_lag = lags[best_idx]
        peak_corr = corr_curve[best_idx]

        # Asymmetry score: integral(positive lags) - integral(negative lags)
        pos_area = sum(corr_curve[i] ** 2 for i, k in enumerate(lags) if k > 0)
        neg_area = sum(corr_curve[i] ** 2 for i, k in enumerate(lags) if k < 0)
        asymmetry = pos_area - neg_area

        # Identify leader and follower
        if opt_lag > 0 or (opt_lag == 0 and asymmetry > 0.05):
            leader_id = a1.asset_id
            follower_id = a2.asset_id
            lag_steps = abs(opt_lag)
            # Volume boost on leader enhances price transmission
            vol_boost = math.sqrt(max(0.2, a1.volume_ratio))
        elif opt_lag < 0 or (opt_lag == 0 and asymmetry < -0.05):
            leader_id = a2.asset_id
            follower_id = a1.asset_id
            lag_steps = abs(opt_lag)
            vol_boost = math.sqrt(max(0.2, a2.volume_ratio))
        else:
            leader_id = a1.asset_id
            follower_id = a2.asset_id
            lag_steps = 0
            vol_boost = 1.0

        # Predict forward move on follower
        predicted_drift_bps = recent_leader_shock_bps * peak_corr * vol_boost
        executable_edge = abs(predicted_drift_bps) - self.friction_cost_bps

        return PairLeadLagMetrics(
            leader=leader_id,
            follower=follower_id,
            optimal_lag_steps=lag_steps,
            peak_correlation=round(peak_corr, 4),
            lead_asymmetry_score=round(asymmetry, 4),
            predicted_forward_drift_bps=round(predicted_drift_bps, 2),
            executable_edge_bps=round(executable_edge, 2),
        )

    def evaluate_universe(
        self,
        assets: List[AssetSeries],
        recent_shocks: Optional[Dict[str, float]] = None,
        current_time_sec: float = 0.0,
    ) -> LeadLagMatrixAssessment:
        """
        Scans all pairwise combinations, calculates the global lead score tensor,
        identifies the dominant price anchor, and detects executable latency sweeps.
        """
        rationales: List[str] = []
        n = len(assets)
        shocks = recent_shocks or {}

        pairwise_metrics: List[PairLeadLagMetrics] = []
        lead_scores: Dict[str, float] = {a.asset_id: 0.0 for a in assets}

        for i in range(n):
            for j in range(i + 1, n):
                a1 = assets[i]
                a2 = assets[j]
                shock_val = shocks.get(a1.asset_id, 0.0) or shocks.get(a2.asset_id, 0.0)
                metric = self.analyze_pair(a1, a2, shock_val)
                pairwise_metrics.append(metric)

                # Accumulate lead scores
                if metric.optimal_lag_steps > 0:
                    lead_scores[metric.leader] += abs(metric.peak_correlation)
                    lead_scores[metric.follower] -= abs(metric.peak_correlation)
                elif metric.lead_asymmetry_score > 0.02:
                    lead_scores[metric.leader] += 0.5 * abs(metric.peak_correlation)
                    lead_scores[metric.follower] -= 0.5 * abs(metric.peak_correlation)

        dominant_anchor = max(lead_scores.keys(), key=lambda k: lead_scores[k]) if lead_scores else ""

        # Filter executable trades
        viable_trades = [
            m for m in pairwise_metrics
            if m.optimal_lag_steps > 0
            and abs(m.peak_correlation) >= self.min_peak_corr_threshold
            and m.executable_edge_bps >= self.min_executable_edge_bps
        ]

        best_trade: Optional[PairLeadLagMetrics] = None
        if viable_trades:
            best_trade = max(viable_trades, key=lambda m: m.executable_edge_bps)

        # Volume flip check
        volume_flipped = any(
            a.volume_ratio >= 3.0 and lead_scores[a.asset_id] < 0
            for a in assets
        )

        max_corr = max((abs(m.peak_correlation) for m in pairwise_metrics), default=0.0)

        # Decision State Machine
        if best_trade is not None:
            regime = LeadLagRegimeState.STRONG_PREDICTIVE_LEAD_LAG
            directive = LeadLagExecutionDirective.EXECUTE_PREDICTIVE_LEAD_LAG_SWEEP
            rationales.append(
                f"Predictive latency lead edge active: {best_trade.leader} leads {best_trade.follower} by {best_trade.optimal_lag_steps} steps (rho={best_trade.peak_correlation:.2f}). Forward drift: {best_trade.predicted_forward_drift_bps:.1f} bps, Net edge: +{best_trade.executable_edge_bps:.1f} bps."
            )
        elif volume_flipped:
            regime = LeadLagRegimeState.VOLUME_BURST_LEAD_FLIP
            directive = LeadLagExecutionDirective.RECALIBRATE_LEAD_ANCHOR
            rationales.append("Unusual volume surge in secondary asset has flipped information flow. Recalibrate lead-lag matrix.")
        elif max_corr < 0.20:
            regime = LeadLagRegimeState.UNCORRELATED_DIFFUSION
            directive = LeadLagExecutionDirective.DECOUPLE_PAIR_TRADING
            rationales.append("Asset universe exhibits low cross-correlation (|rho| < 0.20). Decouple pair trading.")
        else:
            regime = LeadLagRegimeState.SYNCHRONOUS_EQUILIBRIUM
            directive = LeadLagExecutionDirective.HOLD_COMOVING_NEUTRAL
            rationales.append("Market in synchronous equilibrium (optimal lag = 0). Cross-asset latency arbitrage closed.")

        return LeadLagMatrixAssessment(
            timestamp_sec=current_time_sec,
            lead_scores={k: round(v, 3) for k, v in lead_scores.items()},
            dominant_anchor=dominant_anchor,
            pairwise_metrics=pairwise_metrics,
            regime=regime,
            directive=directive,
            best_trade=best_trade,
            rationales=rationales,
        )
