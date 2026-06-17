"""
Domain 272 / WP-FR: High-Frequency Limit Order Book Multi-Level Market Impact Decay & Resiliency Kernel
========================================================================================================
Institutional quantitative market microstructure kernel implementing the Bouchaud-Farmer-Lillo
propagator model for transient market impact decay, cumulative self-impact avoidance, and optimal
order book replenishment pacing.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional
import math


class LOBResiliencyRegime(str, Enum):
    OPTIMAL_RESILIENT_RECOVERY_COMPLETE = "OPTIMAL_RESILIENT_RECOVERY_COMPLETE"
    PARTIALLY_RELAXED_THROTTLED_PACING = "PARTIALLY_RELAXED_THROTTLED_PACING"
    SEVERE_UNRELAXED_SELF_IMPACT_HAZARD = "SEVERE_UNRELAXED_SELF_IMPACT_HAZARD"


class ImpactPacingDirective(str, Enum):
    EXECUTE_NEXT_ORDER_SLICE = "EXECUTE_NEXT_ORDER_SLICE"
    THROTTLE_SLICE_SIZE_EXTEND_DELAY = "THROTTLE_SLICE_SIZE_EXTEND_DELAY"
    PAUSE_AGGRESSIONS_AWAIT_REPLENISHMENT = "PAUSE_AGGRESSIONS_AWAIT_REPLENISHMENT"


@dataclass
class TradeSliceImpact:
    timestamp_ms: float
    order_size: float
    instantaneous_impact_bps: float


@dataclass
class LOBResiliencyAssessment:
    symbol: str
    elapsed_time_since_last_slice_ms: float
    instantaneous_initial_impact_bps: float
    current_transient_impact_bps: float
    permanent_impact_bps: float
    accumulated_self_impact_bps: float
    resiliency_recovery_pct: float
    recommended_min_delay_ms: float
    regime: LOBResiliencyRegime
    directive: ImpactPacingDirective
    rationales: List[str] = field(default_factory=list)


class LOBImpactResiliencyKernel:
    """
    Evaluates transient order book impact relaxation via power-law propagator decay kernels:
    G(t) = (1 + t / tau)^(-gamma). Prevents self-impact cannibalization by governing execution spacing.
    """

    def __init__(
        self,
        tau_relaxation_ms: float = 200.0,       # Characteristic relaxation timescale (200 ms)
        gamma_decay_exponent: float = 0.35,     # Power-law decay exponent gamma
        permanent_impact_ratio: float = 0.40,   # 40% of instantaneous impact is permanent
        target_resiliency_recovery: float = 0.80, # 80% recovery required for full pacing
        max_transient_hazard_bps: float = 5.0,  # 5 bps unrelaxed impact triggers pause
    ):
        self.tau = tau_relaxation_ms
        self.gamma = gamma_decay_exponent
        self.perm_ratio = permanent_impact_ratio
        self.target_recovery = target_resiliency_recovery
        self.max_hazard_bps = max_transient_hazard_bps

    def propagator_decay(self, elapsed_ms: float) -> float:
        """
        Bare memory propagator kernel: G(t) = (1 + t / tau)^(-gamma)
        """
        t = max(0.0, elapsed_ms)
        return float(math.pow(1.0 + (t / self.tau), -self.gamma))

    def calculate_required_delay_ms(self, desired_recovery_fraction: float) -> float:
        """
        Inverts propagator G(t) = (1 - recovery):
        t = tau * ((1 - recovery)^(-1/gamma) - 1)
        """
        target_rem = max(0.01, min(0.99, 1.0 - desired_recovery_fraction))
        ratio = math.pow(target_rem, -1.0 / self.gamma)
        return max(0.0, self.tau * (ratio - 1.0))

    def evaluate_resiliency(
        self,
        symbol: str,
        current_time_ms: float,
        recent_slices: List[TradeSliceImpact],
    ) -> LOBResiliencyAssessment:
        if not recent_slices:
            return LOBResiliencyAssessment(
                symbol=symbol,
                elapsed_time_since_last_slice_ms=999999.0,
                instantaneous_initial_impact_bps=0.0,
                current_transient_impact_bps=0.0,
                permanent_impact_bps=0.0,
                accumulated_self_impact_bps=0.0,
                resiliency_recovery_pct=100.0,
                recommended_min_delay_ms=0.0,
                regime=LOBResiliencyRegime.OPTIMAL_RESILIENT_RECOVERY_COMPLETE,
                directive=ImpactPacingDirective.EXECUTE_NEXT_ORDER_SLICE,
                rationales=["Order book in quiescent equilibrium with zero prior slice impact."],
            )

        rationales = []
        last_slice = recent_slices[-1]
        elapsed_ms = max(0.0, current_time_ms - last_slice.timestamp_ms)

        # Instantaneous and permanent components of the last trade
        i_init = last_slice.instantaneous_impact_bps
        i_perm = i_init * self.perm_ratio
        i_trans_init = i_init - i_perm

        # Propagator decay of transient component
        g_t = self.propagator_decay(elapsed_ms)
        current_trans = i_trans_init * g_t

        # Resiliency recovery percentage
        recovery_pct = (1.0 - g_t) * 100.0 if i_trans_init > 0 else 100.0

        # Accumulated self-impact across all recent in-memory slices
        accumulated_impact = 0.0
        for s in recent_slices:
            dt = max(0.0, current_time_ms - s.timestamp_ms)
            s_trans = (s.instantaneous_impact_bps * (1.0 - self.perm_ratio)) * self.propagator_decay(dt)
            accumulated_impact += s_trans + (s.instantaneous_impact_bps * self.perm_ratio)

        # Recommended delay for target recovery
        rec_delay_ms = self.calculate_required_delay_ms(self.target_recovery)

        # Decision State Machine
        if (recovery_pct < 40.0 and current_trans >= self.max_hazard_bps) or (accumulated_impact >= (self.max_hazard_bps * 1.5)):
            regime = LOBResiliencyRegime.SEVERE_UNRELAXED_SELF_IMPACT_HAZARD
            directive = ImpactPacingDirective.PAUSE_AGGRESSIONS_AWAIT_REPLENISHMENT
            delay_needed = max(0.0, rec_delay_ms - elapsed_ms)
            rationales.append(
                f"Severe unrelaxed order book impact on {symbol}: Elapsed={elapsed_ms:.1f} ms, "
                f"Transient Impact={current_trans:.2f} bps, Accumulated Self-Impact={accumulated_impact:.2f} bps. "
                f"Book recovery only {recovery_pct:.1f}%. Immediate execution will cannibalize fills. "
                f"Pause aggressions for {delay_needed:.1f} ms until queues replenish."
            )
        elif recovery_pct < (self.target_recovery * 100.0):
            regime = LOBResiliencyRegime.PARTIALLY_RELAXED_THROTTLED_PACING
            directive = ImpactPacingDirective.THROTTLE_SLICE_SIZE_EXTEND_DELAY
            delay_needed = max(0.0, rec_delay_ms - elapsed_ms)
            rationales.append(
                f"Partial order book recovery on {symbol}: Recovery={recovery_pct:.1f}% "
                f"(Target={self.target_recovery*100:.0f}%). Transient impact={current_trans:.2f} bps. "
                f"Throttle slice size by 50% and extend inter-slice delay by {delay_needed:.1f} ms."
            )
        else:
            regime = LOBResiliencyRegime.OPTIMAL_RESILIENT_RECOVERY_COMPLETE
            directive = ImpactPacingDirective.EXECUTE_NEXT_ORDER_SLICE
            rationales.append(
                f"Order book resiliency recovery complete on {symbol}: Elapsed={elapsed_ms:.1f} ms, "
                f"Recovery={recovery_pct:.1f}%, Residual transient impact={current_trans:.2f} bps. "
                f"Queues fully replenished; clear to fire next scheduled order slice."
            )

        return LOBResiliencyAssessment(
            symbol=symbol,
            elapsed_time_since_last_slice_ms=round(elapsed_ms, 2),
            instantaneous_initial_impact_bps=round(i_init, 2),
            current_transient_impact_bps=round(current_trans, 2),
            permanent_impact_bps=round(i_perm, 2),
            accumulated_self_impact_bps=round(accumulated_impact, 2),
            resiliency_recovery_pct=round(recovery_pct, 1),
            recommended_min_delay_ms=round(rec_delay_ms, 1),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
