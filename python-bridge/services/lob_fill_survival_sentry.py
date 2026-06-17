"""
High-Frequency Limit Order Book Fill Rate Survival Analysis & Kaplan-Meier Sentry
Domain 236 / Work Package WP-EH

Provides institutional non-parametric Kaplan-Meier limit order fill curve calibration,
Nelson-Aalen cumulative hazard estimation, optimal maker order Time-To-Live (TTL)
derivation, and adverse selection pick-off prevention.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class FillRegimeState(str, Enum):
    FAST_FILL_HEALTHY = "FAST_FILL_HEALTHY"                      # Rapid execution within median lifetime
    QUEUE_CONGESTED_STARVATION = "QUEUE_CONGESTED_STARVATION"    # Fill probability plateaus, capital trapped
    ADVERSE_SELECTION_VULNERABLE = "ADVERSE_SELECTION_VULNERABLE"# Long lingering orders exposed to toxic pick-off
    INSUFFICIENT_SAMPLE = "INSUFFICIENT_SAMPLE"                  # Too few observations for robust calibration


class MakerExecutionDirective(str, Enum):
    MAINTAIN_PASSIVE_QUOTE = "MAINTAIN_PASSIVE_QUOTE"      # Queue priority favorable, expected fill within TTL
    REVISE_QUEUE_PRIORITY = "REVISE_QUEUE_PRIORITY"        # Queue starvation, adjust tick or cancel
    CANCEL_TTL_EXPIRED = "CANCEL_TTL_EXPIRED"              # Order exceeded optimal TTL, cancel to evade toxicity
    EMERGENCY_SNIPE_ABORT = "EMERGENCY_SNIPE_ABORT"        # Adverse price drift + high conditional hazard, pull quote


@dataclass
class OrderFillObservation:
    order_id: str
    duration_sec: float              # Time until fill or cancel
    is_filled: bool                  # True if filled, False if cancelled/censored
    queue_percentile: float = 0.5    # 0.0 (front of queue) to 1.0 (back of queue)
    spread_bps: float = 2.0
    imbalance_ratio: float = 0.0     # -1.0 to +1.0


@dataclass
class KaplanMeierPoint:
    time_sec: float
    at_risk_count: int
    fill_count: int
    censored_count: int
    survival_prob: float             # S(t) = P(T > t)
    cumulative_fill_prob: float      # F(t) = 1 - S(t)
    cumulative_hazard: float         # H(t) via Nelson-Aalen


@dataclass
class SurvivalFillProfile:
    total_orders: int
    total_fills: int
    total_censored: int
    median_fill_time_sec: Optional[float]
    mean_restricted_fill_time_sec: float
    fill_prob_1s: float
    fill_prob_5s: float
    fill_prob_10s: float
    optimal_ttl_sec: float
    regime: FillRegimeState
    curve: List[KaplanMeierPoint] = field(default_factory=list)


@dataclass
class OrderSurvivalDecision:
    order_id: str
    order_age_sec: float
    conditional_fill_prob_next_1s: float
    exceeded_optimal_ttl: bool
    adverse_drift_bps: float
    directive: MakerExecutionDirective
    risk_score: float                # 0.0 to 1.0 (1.0 = highest toxicity risk)
    rationales: List[str] = field(default_factory=list)


class LOBFillSurvivalSentry:
    """
    Evaluates resting limit order fill probabilities using non-parametric survival analysis.
    Prevents adverse selection by enforcing dynamic Time-To-Live limits derived from
    the empirical hazard decay curve.
    """

    def __init__(
        self,
        min_sample_size: int = 10,
        marginal_hazard_threshold: float = 0.02,
        asymptotic_fill_target: float = 0.85,
        default_ttl_sec: float = 5.0,
        toxic_drift_threshold_bps: float = 3.5,
    ):
        self.min_sample_size = min_sample_size
        self.marginal_hazard_threshold = marginal_hazard_threshold
        self.asymptotic_fill_target = asymptotic_fill_target
        self.default_ttl_sec = default_ttl_sec
        self.toxic_drift_threshold_bps = toxic_drift_threshold_bps

    def calibrate(self, observations: List[OrderFillObservation]) -> SurvivalFillProfile:
        """
        Calibrates Kaplan-Meier survival curve and Nelson-Aalen cumulative hazard
        from historical order execution life-cycle observations.
        """
        n = len(observations)
        if n < self.min_sample_size:
            return SurvivalFillProfile(
                total_orders=n,
                total_fills=sum(1 for o in observations if o.is_filled),
                total_censored=sum(1 for o in observations if not o.is_filled),
                median_fill_time_sec=None,
                mean_restricted_fill_time_sec=self.default_ttl_sec,
                fill_prob_1s=0.20,
                fill_prob_5s=0.50,
                fill_prob_10s=0.70,
                optimal_ttl_sec=self.default_ttl_sec,
                regime=FillRegimeState.INSUFFICIENT_SAMPLE,
                curve=[],
            )

        # Sort observations by duration
        sorted_obs = sorted(observations, key=lambda x: x.duration_sec)
        total_fills = sum(1 for o in sorted_obs if o.is_filled)
        total_censored = n - total_fills

        # Group by distinct event times
        unique_times = sorted(list(set(round(o.duration_sec, 4) for o in sorted_obs if o.duration_sec > 0)))

        curve: List[KaplanMeierPoint] = []
        current_surv = 1.0
        current_cum_hazard = 0.0

        for t in unique_times:
            # At risk: orders whose duration is >= t
            at_risk = sum(1 for o in sorted_obs if o.duration_sec >= t)
            # Events at time t
            fills_at_t = sum(1 for o in sorted_obs if round(o.duration_sec, 4) == t and o.is_filled)
            cancels_at_t = sum(1 for o in sorted_obs if round(o.duration_sec, 4) == t and not o.is_filled)

            if at_risk > 0:
                if fills_at_t > 0:
                    current_surv *= (1.0 - (fills_at_t / at_risk))
                    current_cum_hazard += (fills_at_t / at_risk)
                current_surv = max(0.0, min(1.0, current_surv))

            curve.append(
                KaplanMeierPoint(
                    time_sec=t,
                    at_risk_count=at_risk,
                    fill_count=fills_at_t,
                    censored_count=cancels_at_t,
                    survival_prob=current_surv,
                    cumulative_fill_prob=1.0 - current_surv,
                    cumulative_hazard=current_cum_hazard,
                )
            )

        # Determine median fill time (first time survival <= 0.50)
        median_time: Optional[float] = None
        for pt in curve:
            if pt.survival_prob <= 0.50:
                median_time = pt.time_sec
                break

        # Compute restricted mean survival time (area under S(t))
        restricted_mean = 0.0
        prev_t = 0.0
        prev_s = 1.0
        for pt in curve:
            dt = pt.time_sec - prev_t
            restricted_mean += prev_s * dt
            prev_t = pt.time_sec
            prev_s = pt.survival_prob

        # Fill probabilities at benchmark horizons via step interpolation
        def get_fill_prob(tau: float) -> float:
            ans = 0.0
            for pt in curve:
                if pt.time_sec <= tau:
                    ans = pt.cumulative_fill_prob
                else:
                    break
            return ans

        fill_1s = get_fill_prob(1.0)
        fill_5s = get_fill_prob(5.0)
        fill_10s = get_fill_prob(10.0)

        # Determine optimal TTL: point where marginal fill gain flattens
        # or where asymptotic target fraction of fills is reached
        max_fill_prob = curve[-1].cumulative_fill_prob if curve else 0.5
        target_fill_threshold = max_fill_prob * self.asymptotic_fill_target

        optimal_ttl = self.default_ttl_sec
        ttl_found = False

        for i in range(1, len(curve)):
            pt_prev = curve[i - 1]
            pt_curr = curve[i]
            dt = pt_curr.time_sec - pt_prev.time_sec
            dfill = pt_curr.cumulative_fill_prob - pt_prev.cumulative_fill_prob
            marginal_hazard = (dfill / dt) if dt > 0.001 else 0.0

            # Condition 1: reached 85% of ultimate fill asymptote
            if pt_curr.cumulative_fill_prob >= target_fill_threshold and not ttl_found:
                optimal_ttl = pt_curr.time_sec
                ttl_found = True
                break

            # Condition 2: marginal hazard has collapsed below threshold
            if marginal_hazard < self.marginal_hazard_threshold and pt_curr.time_sec >= 1.5:
                optimal_ttl = pt_curr.time_sec
                ttl_found = True
                break

        if not ttl_found and curve:
            optimal_ttl = min(curve[-1].time_sec, self.default_ttl_sec * 2.0)

        # Classify overall fill regime
        if fill_1s >= 0.40 or (median_time is not None and median_time <= 2.0):
            regime = FillRegimeState.FAST_FILL_HEALTHY
        elif max_fill_prob < 0.25:
            regime = FillRegimeState.QUEUE_CONGESTED_STARVATION
        else:
            regime = FillRegimeState.ADVERSE_SELECTION_VULNERABLE

        return SurvivalFillProfile(
            total_orders=n,
            total_fills=total_fills,
            total_censored=total_censored,
            median_fill_time_sec=median_time,
            mean_restricted_fill_time_sec=round(restricted_mean, 3),
            fill_prob_1s=round(fill_1s, 4),
            fill_prob_5s=round(fill_5s, 4),
            fill_prob_10s=round(fill_10s, 4),
            optimal_ttl_sec=round(optimal_ttl, 3),
            regime=regime,
            curve=curve,
        )

    def evaluate_live_order(
        self,
        order_id: str,
        order_age_sec: float,
        adverse_drift_bps: float,
        profile: SurvivalFillProfile,
        queue_percentile: float = 0.5,
    ) -> OrderSurvivalDecision:
        """
        Evaluates an active maker order against calibrated survival profile,
        recommending immediate cancellation, quote pull, or queue maintenance.
        """
        rationales: List[str] = []

        # Find survival prob at current age and at current age + 1s
        def get_surv(tau: float) -> float:
            if not profile.curve:
                return math.exp(-0.2 * tau)
            s = 1.0
            for pt in profile.curve:
                if pt.time_sec <= tau:
                    s = pt.survival_prob
                else:
                    break
            return s

        s_now = get_surv(order_age_sec)
        s_next = get_surv(order_age_sec + 1.0)

        # Conditional fill probability in the next 1 second given survival to now:
        # P(T <= t+1 | T > t) = 1 - S(t+1)/S(t)
        if s_now > 1e-6:
            cond_fill_prob_1s = max(0.0, 1.0 - (s_next / s_now))
        else:
            cond_fill_prob_1s = 0.0

        exceeded_ttl = order_age_sec >= profile.optimal_ttl_sec
        risk_score = 0.0

        # Base risk from age vs TTL
        age_ratio = order_age_sec / max(0.1, profile.optimal_ttl_sec)
        risk_score += min(0.5, 0.25 * age_ratio)

        # Risk from adverse price drift
        if adverse_drift_bps > 0:
            drift_factor = min(0.5, (adverse_drift_bps / self.toxic_drift_threshold_bps) * 0.4)
            risk_score += drift_factor

        # Risk from deep queue starvation
        if queue_percentile > 0.8:
            risk_score += 0.15

        risk_score = min(1.0, max(0.0, risk_score))

        # Decision Directives:
        # 1. Emergency snipe abort if toxic drift breaches threshold
        if adverse_drift_bps >= self.toxic_drift_threshold_bps:
            directive = MakerExecutionDirective.EMERGENCY_SNIPE_ABORT
            rationales.append(f"Adverse price drift ({adverse_drift_bps:.2f} bps) exceeds critical threshold ({self.toxic_drift_threshold_bps:.2f} bps). Immediate quote pull required.")

        # 2. TTL expired
        elif exceeded_ttl:
            directive = MakerExecutionDirective.CANCEL_TTL_EXPIRED
            rationales.append(f"Order age ({order_age_sec:.2f}s) exceeded optimal TTL ({profile.optimal_ttl_sec:.2f}s). Remaining fill edge exhausted; cancel to evade adverse selection.")

        # 3. Queue starvation
        elif queue_percentile >= 0.85 and cond_fill_prob_1s < 0.05:
            directive = MakerExecutionDirective.REVISE_QUEUE_PRIORITY
            rationales.append(f"Queue position ({queue_percentile*100:.1f}%) too deep with negligible forward fill hazard ({cond_fill_prob_1s*100:.1f}%/s). Revise placement.")

        # 4. Healthy maintenance
        else:
            directive = MakerExecutionDirective.MAINTAIN_PASSIVE_QUOTE
            rationales.append(f"Order within safe TTL horizon ({order_age_sec:.2f}s / {profile.optimal_ttl_sec:.2f}s), conditional 1s fill probability = {cond_fill_prob_1s*100:.1f}%.")

        return OrderSurvivalDecision(
            order_id=order_id,
            order_age_sec=order_age_sec,
            conditional_fill_prob_next_1s=round(cond_fill_prob_1s, 4),
            exceeded_optimal_ttl=exceeded_ttl,
            adverse_drift_bps=round(adverse_drift_bps, 2),
            directive=directive,
            risk_score=round(risk_score, 3),
            rationales=rationales,
        )
