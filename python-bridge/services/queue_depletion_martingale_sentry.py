"""
Real-Time Limit Order Book Queue Depletion Martingale & Microsecond Stop-Loss Sentry
Domain 248 / Work Package WP-ET

Models first passage time to order book queue exhaustion via continuous drift-diffusion
martingales, calculates microsecond exhaustion probabilities within network RTT windows,
and triggers preemptive atomic IOC stops before post-evaporation slippage avalanches.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class QueueDepletionState(str, Enum):
    HEALTHY_QUEUE_SHIELD = "HEALTHY_QUEUE_SHIELD"              # Ample volume ahead, low exhaustion hazard (< 15%)
    ELEVATED_DEPLETION_ACCELERATION = "ELEVATED_DEPLETION_ACCELERATION" # Rapid drainage, queue ahead thinning (< 30% left)
    QUEUE_DRAIN_CRITICAL_PREEMPT = "QUEUE_DRAIN_CRITICAL_PREEMPT"       # Exhaustion probability >= 75% within RTT, preemptive trigger
    VACUUM_COLLAPSE_EMERGENCY = "VACUUM_COLLAPSE_EMERGENCY"    # Queue wiped out instantly, multi-tick void emergency


class PreemptiveStopDirective(str, Enum):
    MAINTAIN_RESTING_QUOTE = "MAINTAIN_RESTING_QUOTE"          # Queue shield safe, maintain passive stop
    PREPARE_FAST_CANCEL_ARM = "PREPARE_FAST_CANCEL_ARM"        # Arm fast-cancel socket, increase polling rate
    EXECUTE_PREEMPTIVE_STOP_IOC = "EXECUTE_PREEMPTIVE_STOP_IOC"# Preemptively fire IOC into remaining queue before slip cascade
    EMERGENCY_MARKET_FLUSH = "EMERGENCY_MARKET_FLUSH"          # Book crossed, execute emergency market flush


@dataclass
class QueueMicrostate:
    venue_id: str
    level_price: float
    queue_ahead_shares: float
    market_drain_rate_shares_sec: float  # Trade execution rate consuming queue
    cancel_drain_rate_shares_sec: float  # Cancellation rate evaporating queue
    queue_volatility_shares_sec: float   # Brownian diffusion volatility sigma_Q
    network_rtt_ms: float = 25.0         # Exchange gateway round-trip latency


@dataclass
class QueueExhaustionAssessment:
    venue_id: str
    level_price: float
    remaining_queue_shares: float
    total_drain_velocity_shares_sec: float
    expected_exhaustion_time_ms: float
    exhaustion_prob_in_rtt: float
    state: QueueDepletionState
    directive: PreemptiveStopDirective
    expected_slippage_avoided_bps: float
    rationales: List[str] = field(default_factory=list)


class QueueDepletionMartingaleSentry:
    """
    Evaluates resting queue survival against aggressive trade sweeps and cancellation
    cascades, firing preemptive stop executions before queue evaporation traps traders.
    """

    def __init__(
        self,
        preemptive_prob_threshold: float = 0.75,     # 75% probability of exhaustion in RTT triggers stop
        critical_exhaustion_time_ms: float = 35.0,   # Less than 35ms of queue left is critical
        cascade_slippage_penalty_bps: float = 6.50,  # Expected slip if waiting for complete evaporation
    ):
        self.preemptive_prob_threshold = preemptive_prob_threshold
        self.critical_exhaustion_time_ms = critical_exhaustion_time_ms
        self.cascade_slippage_penalty_bps = cascade_slippage_penalty_bps

    def calculate_first_passage_probability(
        self,
        q0: float,
        mu_drain: float,
        sigma: float,
        tau_sec: float,
    ) -> float:
        """
        Computes the first passage probability P(T_exhaust <= tau | Q_0 = q0)
        under drift-diffusion martingale: dQ_t = -mu dt + sigma dW_t
        Formula (Inverse Gaussian CDF / Bachelier absorption):
        P(T <= tau) = Phi((-q0 + mu * tau) / (sigma * sqrt(tau))) +
                      exp(2 * mu * q0 / sigma^2) * Phi((-q0 - mu * tau) / (sigma * sqrt(tau)))
        """
        if q0 <= 0.0:
            return 1.0
        if tau_sec <= 0.0001:
            return 0.0

        # High drainage deterministic limit
        diff = q0 - (mu_drain * tau_sec)
        vol_term = sigma * math.sqrt(tau_sec)

        def norm_cdf(z: float) -> float:
            return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))

        if vol_term > 1e-6:
            z1 = -diff / vol_term
            p1 = norm_cdf(z1)

            # Second term with exponential scaling guarded against overflow
            exp_arg = (2.0 * mu_drain * q0) / max(1e-4, sigma ** 2)
            if exp_arg < 50.0:
                z2 = (-q0 - (mu_drain * tau_sec)) / vol_term
                p2 = math.exp(exp_arg) * norm_cdf(z2)
            else:
                p2 = 0.0

            prob = p1 + p2
        else:
            # Deterministic linear drift: exhaust if mu * tau >= q0
            prob = 1.0 if diff <= 0.0 else 0.0

        return max(0.0, min(1.0, prob))

    def evaluate(self, state: QueueMicrostate) -> QueueExhaustionAssessment:
        """
        Evaluates queue exhaustion hazard, issuing preemptive stop liquidation
        before the market sweeps through the level.
        """
        rationales: List[str] = []
        q0 = state.queue_ahead_shares
        total_drain = max(0.0, state.market_drain_rate_shares_sec + state.cancel_drain_rate_shares_sec)
        rtt_sec = state.network_rtt_ms / 1000.0

        # Instant vacuum collapse check
        if q0 <= 0.0:
            return QueueExhaustionAssessment(
                venue_id=state.venue_id,
                level_price=state.level_price,
                remaining_queue_shares=0.0,
                total_drain_velocity_shares_sec=total_drain,
                expected_exhaustion_time_ms=0.0,
                exhaustion_prob_in_rtt=1.0,
                state=QueueDepletionState.VACUUM_COLLAPSE_EMERGENCY,
                directive=PreemptiveStopDirective.EMERGENCY_MARKET_FLUSH,
                expected_slippage_avoided_bps=0.0,
                rationales=["Queue completely wiped out. Emergency market flush required."],
            )

        # Expected time to exhaustion: q0 / total_drain
        if total_drain > 1e-4:
            expected_time_ms = (q0 / total_drain) * 1000.0
        else:
            expected_time_ms = 999_999.0

        sigma = max(1.0, state.queue_volatility_shares_sec)
        p_exhaust_rtt = self.calculate_first_passage_probability(q0, total_drain, sigma, rtt_sec)

        # Decision State Machine
        # 1. Critical Preemptive Stop: P(exhaustion in RTT) >= 75% or expected time < 35ms
        if p_exhaust_rtt >= self.preemptive_prob_threshold or expected_time_ms <= self.critical_exhaustion_time_ms:
            dep_state = QueueDepletionState.QUEUE_DRAIN_CRITICAL_PREEMPT
            directive = PreemptiveStopDirective.EXECUTE_PREEMPTIVE_STOP_IOC
            slip_avoided = self.cascade_slippage_penalty_bps
            rationales.append(
                f"Queue exhaustion imminent: Remaining={q0:.0f} shares, Drain velocity={total_drain:.0f}/s (Expected lifetime={expected_time_ms:.1f}ms < RTT={state.network_rtt_ms:.1f}ms). Exhaustion prob={p_exhaust_rtt*100:.1f}%. Fire preemptive IOC stop now to save {slip_avoided:.1f} bps."
            )

        # 2. Elevated Depletion Acceleration: expected time < 120ms or exhaustion prob >= 35%
        elif expected_time_ms <= 120.0 or p_exhaust_rtt >= 0.35:
            dep_state = QueueDepletionState.ELEVATED_DEPLETION_ACCELERATION
            directive = PreemptiveStopDirective.PREPARE_FAST_CANCEL_ARM
            slip_avoided = 0.0
            rationales.append(
                f"Queue depleting rapidly (Expected lifetime={expected_time_ms:.1f}ms, P_exhaust={p_exhaust_rtt*100:.1f}%). Arm fast cancellation gateway."
            )

        # 3. Healthy Queue Shield
        else:
            dep_state = QueueDepletionState.HEALTHY_QUEUE_SHIELD
            directive = PreemptiveStopDirective.MAINTAIN_RESTING_QUOTE
            slip_avoided = 0.0
            rationales.append(
                f"Queue shield robust: {q0:.0f} shares ahead (Expected lifetime={expected_time_ms:.1f}ms >> RTT={state.network_rtt_ms:.1f}ms). Exhaustion hazard negligible ({p_exhaust_rtt*100:.1f}%)."
            )

        return QueueExhaustionAssessment(
            venue_id=state.venue_id,
            level_price=state.level_price,
            remaining_queue_shares=round(q0, 2),
            total_drain_velocity_shares_sec=round(total_drain, 2),
            expected_exhaustion_time_ms=round(expected_time_ms, 2),
            exhaustion_prob_in_rtt=round(p_exhaust_rtt, 4),
            state=dep_state,
            directive=directive,
            expected_slippage_avoided_bps=round(slip_avoided, 2),
            rationales=rationales,
        )
