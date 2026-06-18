"""
High-Frequency Limit Order Book Level-2 Queue Depletion Intensity & Flash Fill Sentry
Domain 263 / Work Package WP-FI

Models multi-level limit order book queue depletion Markov jump intensities,
calculates Level-2 fill probabilities within exchange network RTT windows,
and triggers preemptive resting quote cancellations before multi-tick vacuum cascades.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class L2QueueDepletionRegime(str, Enum):
    NOMINAL_QUEUE_BUFFER = "NOMINAL_QUEUE_BUFFER"                      # Level 1 deep, L2 sweep probability < 20%
    ACCELERATED_L1_DEPLETION = "ACCELERATED_L1_DEPLETION"              # L1 draining rapidly (20% <= P_hit < 50%), arm cancel socket
    MULTI_LEVEL_SWEEP_IMMINENT = "MULTI_LEVEL_SWEEP_IMMINENT"          # L2 breach imminent (P_hit >= 50% or vacuum ratio < 0.25)
    VACUUM_COLLAPSE_FLUID = "VACUUM_COLLAPSE_FLUID"                    # Multi-tick void, L1 & L2 completely vaporized


class L2MakerDirective(str, Enum):
    MAINTAIN_L2_QUOTE = "MAINTAIN_L2_QUOTE"                            # Passive L2 maker quotes safe
    ARM_FAST_CANCEL_GATEWAY = "ARM_FAST_CANCEL_GATEWAY"                # Poll gateway socket at 1 kHz, prepare cancel packet
    EXECUTE_PREEMPTIVE_L2_CANCEL = "EXECUTE_PREEMPTIVE_L2_CANCEL"      # Fire immediate cancel on L2 resting quote
    EMERGENCY_FLUID_EVACUATION = "EMERGENCY_FLUID_EVACUATION"          # Emergency uncrossing market flush


@dataclass
class L2DepthSnapshot:
    symbol: str
    level1_shares: float
    level2_shares: float
    level3_shares: float
    level1_drain_rate_sec: float       # Trade + cancel consumption rate at L1 (shares / sec)
    historical_mean_depth_3levels: float = 100_000.0
    network_rtt_sec: float = 0.025     # Exchange gateway round-trip latency


@dataclass
class L2DepletionAssessment:
    symbol: str
    level1_lifetime_ms: float
    level2_hit_probability_rtt: float
    air_pocket_vacuum_ratio: float
    regime: L2QueueDepletionRegime
    directive: L2MakerDirective
    rationales: List[str] = field(default_factory=list)


class LOBQueueIntensityFillSentry:
    """
    Sub-millisecond Level-2 limit order book queue survival estimator.
    """

    def __init__(
        self,
        critical_hit_prob: float = 0.50,
        warning_hit_prob: float = 0.20,
        critical_vacuum_ratio: float = 0.25,
    ):
        self.critical_hit_prob = critical_hit_prob
        self.warning_hit_prob = warning_hit_prob
        self.critical_vacuum_ratio = critical_vacuum_ratio

    def evaluate_l2_state(self, snapshot: L2DepthSnapshot) -> L2DepletionAssessment:
        rationales: List[str] = []
        q1 = snapshot.level1_shares
        q2 = snapshot.level2_shares
        q3 = snapshot.level3_shares
        drain_rate = max(0.0, snapshot.level1_drain_rate_sec)
        rtt = max(0.001, snapshot.network_rtt_sec)

        # Total current 3-level depth and vacuum ratio
        total_3levels = max(0.0, q1 + q2 + q3)
        mean_depth = max(1.0, snapshot.historical_mean_depth_3levels)
        vacuum_ratio = total_3levels / mean_depth

        # 1. Total vacuum collapse check
        if q1 <= 0.0 and q2 <= 0.0:
            rationales.append(
                f"Multi-tick vacuum collapse on {snapshot.symbol}: Both Level 1 and Level 2 depleted. "
                f"Executing emergency fluid evacuation."
            )
            return L2DepletionAssessment(
                symbol=snapshot.symbol,
                level1_lifetime_ms=0.0,
                level2_hit_probability_rtt=1.0,
                air_pocket_vacuum_ratio=round(vacuum_ratio, 4),
                regime=L2QueueDepletionRegime.VACUUM_COLLAPSE_FLUID,
                directive=L2MakerDirective.EMERGENCY_FLUID_EVACUATION,
                rationales=rationales,
            )

        # 2. Level 1 expected lifetime in ms
        if drain_rate > 0.0:
            l1_lifetime_ms = (q1 / drain_rate) * 1000.0
        else:
            l1_lifetime_ms = 999_999.0

        # 3. Probability of Level 2 being swept within RTT
        # Volume consumed in RTT = drain_rate * rtt
        # If consumed volume >= q1, Level 1 is breached.
        # Excess volume sweeps into Level 2.
        vol_consumed_rtt = drain_rate * rtt
        if vol_consumed_rtt <= 0.0 or q1 <= 0.0:
            p_hit = 1.0 if q1 <= 0.0 else 0.0
        else:
            # Poisson / Gaussian approximation of sweep penetration
            # Ratio of consumed volume to q1 + 0.5 * q2
            sweep_penetration = vol_consumed_rtt / max(1.0, q1 + 0.3 * q2)
            # Sigmoid probability mapping
            p_hit = 1.0 / (1.0 + math.exp(-4.0 * (sweep_penetration - 1.0)))
        p_hit = max(0.0, min(1.0, p_hit))

        # 4. Decision State Machine
        if (
            p_hit >= self.critical_hit_prob
            or l1_lifetime_ms <= (snapshot.network_rtt_sec * 1000.0 * 1.2)
            or vacuum_ratio <= self.critical_vacuum_ratio
        ):
            regime = L2QueueDepletionRegime.MULTI_LEVEL_SWEEP_IMMINENT
            directive = L2MakerDirective.EXECUTE_PREEMPTIVE_L2_CANCEL
            rationales.append(
                f"Level 2 sweep imminent on {snapshot.symbol}: L1 lifetime={l1_lifetime_ms:.1f}ms <= RTT window ({snapshot.network_rtt_sec*1000:.0f}ms). "
                f"P(L2 hit in RTT)={p_hit*100:.1f}%, Vacuum ratio={vacuum_ratio*100:.1f}%. Fire preemptive cancel on L2 resting quotes."
            )

        elif p_hit >= self.warning_hit_prob or l1_lifetime_ms <= 150.0:
            regime = L2QueueDepletionRegime.ACCELERATED_L1_DEPLETION
            directive = L2MakerDirective.ARM_FAST_CANCEL_GATEWAY
            rationales.append(
                f"Accelerated L1 depletion on {snapshot.symbol}: L1 lifetime={l1_lifetime_ms:.1f}ms, "
                f"P(L2 hit)={p_hit*100:.1f}%. Arm fast cancellation gateway."
            )

        else:
            regime = L2QueueDepletionRegime.NOMINAL_QUEUE_BUFFER
            directive = L2MakerDirective.MAINTAIN_L2_QUOTE
            rationales.append(
                f"Nominal queue shield on {snapshot.symbol}: L1={q1:,.0f} shares (lifetime={l1_lifetime_ms:.1f}ms >> RTT). "
                f"L2 sweep hazard={p_hit*100:.1f}%. Maintain resting L2 quotes."
            )

        return L2DepletionAssessment(
            symbol=snapshot.symbol,
            level1_lifetime_ms=round(l1_lifetime_ms, 2),
            level2_hit_probability_rtt=round(p_hit, 4),
            air_pocket_vacuum_ratio=round(vacuum_ratio, 4),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
