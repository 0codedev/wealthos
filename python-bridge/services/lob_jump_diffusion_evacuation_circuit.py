"""
High-Frequency Limit Order Book Jump-Diffusion Hazard & Pre-Crash Liquidity Evacuation Circuit
Domain 257 / Work Package WP-FC

Computes instantaneous compound Poisson jump intensities from microsecond order flow acceleration
and cancellation velocity, calculates jump hazard probabilities within exchange RTT windows,
and dispatches pre-crash mass-quote evacuations to protect resting liquidity from toxic sweeps.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class JumpHazardRegime(str, Enum):
    NOMINAL_DIFFUSIVE_FLOW = "NOMINAL_DIFFUSIVE_FLOW"                  # Pure Brownian diffusion, jump hazard < 10%
    ELEVATED_JUMP_SUSPICION = "ELEVATED_JUMP_SUSPICION"                # Rising jump intensity (10% <= P_jump < 40%)
    SUPERCRITICAL_JUMP_EVACUATION = "SUPERCRITICAL_JUMP_EVACUATION"    # Jump imminent (P_jump >= 40%), mass quote pull
    POST_JUMP_VOLATILITY_COOLDOWN = "POST_JUMP_VOLATILITY_COOLDOWN"    # Immediate post-jump shock, quoting halted


class EvacuationDirective(str, Enum):
    MAINTAIN_ACTIVE_QUOTES = "MAINTAIN_ACTIVE_QUOTES"                  # Normal two-sided quoting active
    WIDEN_DEFENSIVE_SPREADS = "WIDEN_DEFENSIVE_SPREADS"                # Widen spreads by 2x, pull 50% resting size
    EMERGENCY_MASS_CANCEL_EVACUATION = "EMERGENCY_MASS_CANCEL_EVACUATION" # Fire emergency fast-cancel across all book levels
    WAIT_POST_CRASH_STABILIZATION = "WAIT_POST_CRASH_STABILIZATION"    # Stay dark, wait for book depth replenishment


@dataclass
class JumpTelemetrySnapshot:
    symbol: str
    mid_price: float
    ofi_acceleration: float            # Second derivative of order flow imbalance
    cancel_to_insert_ratio: float      # Cancellation rate / Insertion rate (> 2.0 indicates thinning)
    jump_variation_fraction: float     # Ratio of jump variance to total realized variance (JV / RV)
    network_rtt_sec: float = 0.025     # Gateway round-trip latency (e.g. 25ms)
    resting_exposure_shares: float = 1000.0
    is_post_jump_cooldown: bool = False


@dataclass
class JumpEvacuationAssessment:
    symbol: str
    estimated_jump_intensity_hz: float
    jump_hazard_in_rtt_pct: float
    expected_toxic_loss_bps: float
    regime: JumpHazardRegime
    directive: EvacuationDirective
    rationales: List[str] = field(default_factory=list)


class LOBJumpDiffusionEvacuationCircuit:
    """
    Sub-millisecond Poisson jump hazard estimator and resting quote evacuation circuit.
    """

    def __init__(
        self,
        evacuation_hazard_threshold: float = 40.0,  # 40% jump probability in RTT triggers evacuation
        critical_intensity_hz: float = 12.0,        # 12 jumps/sec intensity is critical
        expected_jump_size_bps: float = 35.0,       # Average jump magnitude in bps
    ):
        self.evacuation_hazard_threshold = evacuation_hazard_threshold
        self.critical_intensity_hz = critical_intensity_hz
        self.expected_jump_size_bps = expected_jump_size_bps

    def calculate_jump_intensity(
        self, ofi_accel: float, cancel_ratio: float, jv_fraction: float
    ) -> float:
        """
        Estimates instantaneous Poisson jump arrival intensity lambda_J (Hz):
        lambda = lambda_0 * exp(beta_1 * |ofi_accel| + beta_2 * max(0, cancel_ratio - 1) + beta_3 * jv_fraction)
        """
        lambda_0 = 0.5  # Baseline quiescent jump rate (0.5 jumps / sec)
        exponent = (
            0.6 * min(5.0, abs(ofi_accel))
            + 0.5 * min(4.0, max(0.0, cancel_ratio - 1.0))
            + 2.0 * min(1.0, max(0.0, jv_fraction))
        )
        # Cap exponent to avoid numerical overflow
        exponent = min(10.0, exponent)
        return lambda_0 * math.exp(exponent)

    def calculate_jump_probability(self, intensity: float, tau_sec: float) -> float:
        """
        Computes probability of at least one Poisson jump arrival within tau:
        P(N(tau) >= 1) = 1 - exp(-lambda * tau)
        """
        if intensity <= 0.0 or tau_sec <= 0.0:
            return 0.0
        prob = 1.0 - math.exp(-intensity * tau_sec)
        return max(0.0, min(1.0, prob))

    def evaluate(self, snapshot: JumpTelemetrySnapshot) -> JumpEvacuationAssessment:
        rationales: List[str] = []

        # 1. Post-jump cooldown check
        if snapshot.is_post_jump_cooldown:
            rationales.append(
                f"Post-jump volatility cooldown active for {snapshot.symbol}. "
                f"Order book stabilizing. Quoting remains suspended."
            )
            return JumpEvacuationAssessment(
                symbol=snapshot.symbol,
                estimated_jump_intensity_hz=0.0,
                jump_hazard_in_rtt_pct=0.0,
                expected_toxic_loss_bps=0.0,
                regime=JumpHazardRegime.POST_JUMP_VOLATILITY_COOLDOWN,
                directive=EvacuationDirective.WAIT_POST_CRASH_STABILIZATION,
                rationales=rationales,
            )

        # 2. Intensity and Hazard calculation
        intensity = self.calculate_jump_intensity(
            snapshot.ofi_acceleration,
            snapshot.cancel_to_insert_ratio,
            snapshot.jump_variation_fraction,
        )
        p_jump = self.calculate_jump_probability(intensity, snapshot.network_rtt_sec)
        p_jump_pct = p_jump * 100.0

        # Expected toxic fill loss if resting orders are swept
        # Loss = P(jump) * expected_jump_size_bps
        expected_toxic_loss = p_jump * self.expected_jump_size_bps

        # 3. Decision State Machine
        if (
            p_jump_pct >= self.evacuation_hazard_threshold
            or intensity >= self.critical_intensity_hz
        ):
            regime = JumpHazardRegime.SUPERCRITICAL_JUMP_EVACUATION
            directive = EvacuationDirective.EMERGENCY_MASS_CANCEL_EVACUATION
            rationales.append(
                f"Supercritical jump hazard on {snapshot.symbol}: Intensity={intensity:.1f} Hz, "
                f"P(jump in {snapshot.network_rtt_sec*1000:.0f}ms RTT)={p_jump_pct:.1f}% >= {self.evacuation_hazard_threshold}%. "
                f"Cancel all resting quotes immediately to prevent {expected_toxic_loss:.1f} bps toxic fill loss."
            )

        elif p_jump_pct >= 15.0 or intensity >= 3.0:
            regime = JumpHazardRegime.ELEVATED_JUMP_SUSPICION
            directive = EvacuationDirective.WIDEN_DEFENSIVE_SPREADS
            rationales.append(
                f"Elevated jump suspicion on {snapshot.symbol}: Intensity={intensity:.1f} Hz, "
                f"Hazard={p_jump_pct:.1f}%. OFI accel={snapshot.ofi_acceleration:.2f}, Cancel ratio={snapshot.cancel_to_insert_ratio:.1f}. "
                f"Widen spreads by 2x and halve resting maker exposure."
            )

        else:
            regime = JumpHazardRegime.NOMINAL_DIFFUSIVE_FLOW
            directive = EvacuationDirective.MAINTAIN_ACTIVE_QUOTES
            rationales.append(
                f"Nominal diffusive market flow: Jump intensity={intensity:.2f} Hz, "
                f"RTT jump hazard={p_jump_pct:.2f}%. Maintain standard two-sided quotes."
            )

        return JumpEvacuationAssessment(
            symbol=snapshot.symbol,
            estimated_jump_intensity_hz=round(intensity, 2),
            jump_hazard_in_rtt_pct=round(p_jump_pct, 2),
            expected_toxic_loss_bps=round(expected_toxic_loss, 2),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
