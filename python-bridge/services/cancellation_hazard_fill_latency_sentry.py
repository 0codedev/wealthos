"""
High-Frequency Limit Order Book Cancellations Hazard & Fill Latency Sentry
Domain 233 / Work Package WP-EE

Implements Cox (1972) proportional hazards models with Weibull baselines for order
cancellation dynamics, queue evaporation tracking, and in-flight cancellation
stale fill latency risk containment.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class CancellationRegimeState(str, Enum):
    STABLE_MAKER_QUEUE = "STABLE_MAKER_QUEUE"             # Low hazard rate, safe maker queue priority
    QUEUE_ATTRITION_ELEVATED = "QUEUE_ATTRITION_ELEVATED" # Moderate cancellations, queue thinning
    TOXIC_EVAPORATION_SURGE = "TOXIC_EVAPORATION_SURGE"   # Sudden cascade of cancels, toxic snipe risk


@dataclass
class OrderMicrostructureState:
    order_id: str
    distance_to_mid_bps: float
    queue_ahead_volume: float
    order_flow_imbalance: float  # -1.0 to +1.0 (toxic when opposing maker quote)
    hf_volatility_bps: float
    order_age_sec: float


@dataclass
class HazardModelParameters:
    baseline_lambda: float = 0.50      # Scale parameter
    weibull_shape_gamma: float = 1.20  # Shape parameter (> 1.0 indicates aging orders cancel faster)
    beta_distance: float = -0.15       # Orders further from mid cancel less
    beta_queue: float = -0.0005        # Large queue ahead dampens urgency
    beta_ofi: float = 2.20             # Adverse order flow imbalance sharply accelerates cancels
    beta_vol: float = 0.08             # Higher volatility accelerates cancellations


@dataclass
class HazardAssessment:
    order_id: str
    instantaneous_hazard_rate: float
    hazard_ratio: float
    survival_prob_100ms: float
    stale_fill_risk_pct: float
    regime: CancellationRegimeState
    recommended_action: str
    details: Dict[str, float] = field(default_factory=dict)


class CancellationHazardFillLatencySentry:
    """
    Models resting limit order survival vs cancellation hazard in real-time,
    guarding maker quotes against adverse sweeps and in-flight cancel races.
    """

    def __init__(self, custom_params: Optional[HazardModelParameters] = None):
        self.params = custom_params if custom_params is not None else HazardModelParameters()

    def compute_instantaneous_hazard(
        self,
        state: OrderMicrostructureState,
    ) -> Tuple[float, float]:
        """
        Computes Cox proportional hazard rate:
        h(t | Z) = h_0(t) * exp(beta' * Z)
        where h_0(t) = lambda * gamma * (lambda * t)^(gamma - 1)
        Returns:
          (instantaneous_hazard_rate, hazard_ratio_relative_to_baseline)
        """
        p = self.params
        t = max(1e-4, state.order_age_sec)

        # Baseline Weibull hazard
        h0 = p.baseline_lambda * p.weibull_shape_gamma * ((p.baseline_lambda * t) ** (p.weibull_shape_gamma - 1.0))

        # Covariate linear combination: beta' * Z
        # Note: If state.order_flow_imbalance > 0, adverse pressure accelerates cancels
        lin_pred = (
            p.beta_distance * state.distance_to_mid_bps
            + p.beta_queue * state.queue_ahead_volume
            + p.beta_ofi * max(0.0, state.order_flow_imbalance)
            + p.beta_vol * state.hf_volatility_bps
        )

        # Clamp linear predictor to prevent math overflow
        clamped_lin = max(-10.0, min(10.0, lin_pred))
        hazard_ratio = math.exp(clamped_lin)

        instantaneous_h = h0 * hazard_ratio
        return instantaneous_h, hazard_ratio

    def compute_survival_probability(
        self,
        state: OrderMicrostructureState,
        horizon_sec: float = 0.10,
    ) -> float:
        """
        Calculates cumulative survival probability over future time horizon:
        S(t + dt | t) = exp(- int_t^{t+dt} h(u) du)
        For Weibull baseline with constant covariates:
        Cumulative baseline hazard H_0(t) = (lambda * t)^gamma
        """
        p = self.params
        t0 = max(1e-4, state.order_age_sec)
        t1 = t0 + max(1e-4, horizon_sec)

        _, hr = self.compute_instantaneous_hazard(state)

        # Delta cumulative baseline hazard
        h0_delta = ((p.baseline_lambda * t1) ** p.weibull_shape_gamma) - ((p.baseline_lambda * t0) ** p.weibull_shape_gamma)
        cum_hazard = max(0.0, h0_delta * hr)

        survival_prob = math.exp(-cum_hazard)
        return max(0.0, min(1.0, survival_prob))

    def evaluate_stale_fill_risk(
        self,
        state: OrderMicrostructureState,
        cancel_network_latency_ms: float = 25.0,
    ) -> float:
        """
        Estimates the probability that an aggressive market order fills the quote
        during the network latency window before the cancellation reaches the matching engine.
        P_stale = 1 - S(transit_time) modulated by adverse OFI
        """
        latency_sec = max(1.0, cancel_network_latency_ms) / 1000.0
        survival_in_transit = self.compute_survival_probability(state, horizon_sec=latency_sec)

        # Failure to survive transit means either cancelled by peer or sniped by market order
        # When OFI is highly adverse, non-survival translates directly to toxic snipe
        base_snipe_prob = 1.0 - survival_in_transit
        ofi_amplifier = 1.0 + max(0.0, state.order_flow_imbalance) * 2.0

        stale_risk = max(0.0, min(1.0, base_snipe_prob * ofi_amplifier))
        return stale_risk * 100.0

    def assess_order_hazard(
        self,
        state: OrderMicrostructureState,
        cancel_latency_ms: float = 25.0,
    ) -> HazardAssessment:
        """
        Full sentry evaluation of resting order cancellation hazard and stale fill latency risk.
        """
        inst_hazard, hazard_ratio = self.compute_instantaneous_hazard(state)
        surv_100ms = self.compute_survival_probability(state, horizon_sec=0.10)
        stale_risk_pct = self.evaluate_stale_fill_risk(state, cancel_latency_ms)

        # Sentry Decision Rule Cascade
        if hazard_ratio >= 3.0 or stale_risk_pct >= 40.0:
            regime = CancellationRegimeState.TOXIC_EVAPORATION_SURGE
            action = (
                f"EMERGENCY_CANCEL_IOC: Hazard ratio {hazard_ratio:.2f}x, "
                f"stale fill risk {stale_risk_pct:.1f}%. Sweep imminent; cancel and hedge with IOC market order."
            )
        elif hazard_ratio >= 1.75 or stale_risk_pct >= 15.0:
            regime = CancellationRegimeState.QUEUE_ATTRITION_ELEVATED
            action = (
                f"WIDEN_MAKER_SPREAD: Hazard ratio {hazard_ratio:.2f}x, queue thinning. "
                f"Widen quote distance past {state.distance_to_mid_bps + 2.0:.1f} bps."
            )
        else:
            regime = CancellationRegimeState.STABLE_MAKER_QUEUE
            action = (
                f"MAINTAIN_QUEUE_PRIORITY: Queue stable (HR={hazard_ratio:.2f}x, "
                f"100ms survival={surv_100ms:.1%}). Retain maker priority."
            )

        return HazardAssessment(
            order_id=state.order_id,
            instantaneous_hazard_rate=inst_hazard,
            hazard_ratio=hazard_ratio,
            survival_prob_100ms=surv_100ms,
            stale_fill_risk_pct=stale_risk_pct,
            regime=regime,
            recommended_action=action,
            details={
                "hazard_ratio": hazard_ratio,
                "instantaneous_hazard": inst_hazard,
                "stale_risk_pct": stale_risk_pct,
                "order_age_sec": state.order_age_sec,
            },
        )
