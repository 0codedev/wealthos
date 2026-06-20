"""
Cross-Venue High-Frequency Order Flow Inversion & Structural Queue Imbalance Sentry
Domain 243 / Work Package WP-EO

Detects deceptive high-frequency order flow imbalances, queue exhaustion pivots,
cross-venue OFI disconnects against primary discovery anchors, and structural
level-1 liquidity vacuum air pockets.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class OFIInversionRegimeState(str, Enum):
    ALIGNED_LAMINAR_FLOW = "ALIGNED_LAMINAR_FLOW"              # Cross-venue flows aligned, strong directional momentum
    INVERSION_EXHAUSTION_PIVOT = "INVERSION_EXHAUSTION_PIVOT"  # Flow deceleration at extreme price, impending reversal
    CROSS_VENUE_FLOW_DISCONNECT = "CROSS_VENUE_FLOW_DISCONNECT"# Satellite venue flows oppose primary anchor, fakeout
    QUEUE_HOLLOW_VACUUM = "QUEUE_HOLLOW_VACUUM"                # Level 1 quote mass high with hollow depth beneath


class InversionExecutionDirective(str, Enum):
    FOLLOW_MOMENTUM_FLOW = "FOLLOW_MOMENTUM_FLOW"              # Trend following safe, ride aligned order flow
    EXECUTE_EXHAUSTION_FADE = "EXECUTE_EXHAUSTION_FADE"        # Mean reversion fade, fade overextended move
    ARBITRAGE_CROSS_VENUE_DISCONNECT = "ARBITRAGE_CROSS_VENUE_DISCONNECT" # Fade satellite venue towards anchor anchor
    EVACUATE_HOLLOW_QUEUE = "EVACUATE_HOLLOW_QUEUE"            # Widen quotes, evacuate fragile top-of-book levels


@dataclass
class VenueFlowSnapshot:
    venue_id: str
    ofi_value: float                   # Normalized Order Flow Imbalance (-1.0 to +1.0)
    ofi_velocity: float                # d(OFI)/dt
    ofi_acceleration: float            # d^2(OFI)/dt^2
    price_drift_bps: float             # Recent price move
    level1_depth_ratio: float          # Q_level1 / Q_total_top5 (e.g. 0.75 means 75% at tick 1)
    is_primary_anchor: bool = False


@dataclass
class OrderFlowInversionSignal:
    timestamp_sec: float
    anchor_venue: str
    satellite_venue: str
    anchor_ofi: float
    satellite_ofi: float
    flow_divergence: float             # |satellite_ofi - anchor_ofi|
    ofi_acceleration: float
    queue_fragility: float
    regime: OFIInversionRegimeState
    directive: InversionExecutionDirective
    recommended_side: str              # 'BUY', 'SELL', 'HOLD_NEUTRAL'
    confidence_score: float            # 0.0 to 1.0
    rationales: List[str] = field(default_factory=list)


class OrderFlowInversionSentry:
    """
    Guards trading systems against HFT bait quotes, queue exhaustion traps,
    and cross-venue deceptive price illusions.
    """

    def __init__(
        self,
        fragility_threshold: float = 0.70,       # Level 1 > 70% of top-5 depth is fragile
        disconnect_divergence_threshold: float = 0.80, # Divergence between anchor and satellite OFI
        exhaustion_acceleration_threshold: float = -0.50, # Severe deceleration during price rise
        min_price_drift_exhaustion_bps: float = 4.0, # Minimum price move before exhaustion fade
    ):
        self.fragility_threshold = fragility_threshold
        self.disconnect_divergence_threshold = disconnect_divergence_threshold
        self.exhaustion_acceleration_threshold = exhaustion_acceleration_threshold
        self.min_price_drift_exhaustion_bps = min_price_drift_exhaustion_bps

    def evaluate_flow(
        self,
        anchor: VenueFlowSnapshot,
        satellite: VenueFlowSnapshot,
        current_time_sec: float = 0.0,
    ) -> OrderFlowInversionSignal:
        """
        Synthesizes primary anchor venue flow and satellite venue flow,
        detecting structural inversions, exhaustion pivots, and queue fragility.
        """
        rationales: List[str] = []

        # Flow divergence
        flow_divergence = abs(satellite.ofi_value - anchor.ofi_value)
        opposing_directions = (satellite.ofi_value * anchor.ofi_value) < -0.05

        # Check queue fragility (highest between anchor and satellite)
        max_fragility = max(anchor.level1_depth_ratio, satellite.level1_depth_ratio)

        # 1. Check for cross-venue flow disconnect (satellite is buying but anchor is heavily selling, or vice versa)
        if opposing_directions and flow_divergence >= self.disconnect_divergence_threshold:
            regime = OFIInversionRegimeState.CROSS_VENUE_FLOW_DISCONNECT
            directive = InversionExecutionDirective.ARBITRAGE_CROSS_VENUE_DISCONNECT
            # Follow anchor, fade satellite
            recommended_side = "BUY" if anchor.ofi_value > 0 else "SELL"
            conf = min(0.95, 0.5 + 0.5 * (flow_divergence / 2.0))
            rationales.append(
                f"Cross-venue OFI disconnect: Satellite ({satellite.venue_id}) OFI={satellite.ofi_value:.2f} opposes primary anchor ({anchor.venue_id}) OFI={anchor.ofi_value:.2f}. Satellite move is deceptive; align with anchor."
            )

        # 2. Check for order flow exhaustion pivot (price moved up sharply, but OFI acceleration collapsed negative)
        elif (
            satellite.price_drift_bps >= self.min_price_drift_exhaustion_bps
            and satellite.ofi_acceleration <= self.exhaustion_acceleration_threshold
        ):
            regime = OFIInversionRegimeState.INVERSION_EXHAUSTION_PIVOT
            directive = InversionExecutionDirective.EXECUTE_EXHAUSTION_FADE
            recommended_side = "SELL"  # Fade exhausted buying climax
            conf = min(0.90, 0.6 + abs(satellite.ofi_acceleration) * 0.2)
            rationales.append(
                f"Exhaustion pivot: Price rose +{satellite.price_drift_bps:.1f} bps on {satellite.venue_id} but flow acceleration collapsed ({satellite.ofi_acceleration:.2f}). Fade buying exhaustion."
            )

        elif (
            satellite.price_drift_bps <= -self.min_price_drift_exhaustion_bps
            and satellite.ofi_acceleration >= abs(self.exhaustion_acceleration_threshold)
        ):
            regime = OFIInversionRegimeState.INVERSION_EXHAUSTION_PIVOT
            directive = InversionExecutionDirective.EXECUTE_EXHAUSTION_FADE
            recommended_side = "BUY"  # Fade exhausted selling climax
            conf = min(0.90, 0.6 + abs(satellite.ofi_acceleration) * 0.2)
            rationales.append(
                f"Exhaustion pivot: Price fell {satellite.price_drift_bps:.1f} bps on {satellite.venue_id} but selling deceleration detected ({satellite.ofi_acceleration:.2f}). Fade selling exhaustion."
            )

        # 3. Check for hollow queue vacuum
        elif max_fragility >= self.fragility_threshold:
            regime = OFIInversionRegimeState.QUEUE_HOLLOW_VACUUM
            directive = InversionExecutionDirective.EVACUATE_HOLLOW_QUEUE
            recommended_side = "HOLD_NEUTRAL"
            conf = round(max_fragility, 3)
            fragile_venue = satellite.venue_id if satellite.level1_depth_ratio > anchor.level1_depth_ratio else anchor.venue_id
            rationales.append(
                f"Queue fragility critical on {fragile_venue}: Level 1 holds {max_fragility*100:.1f}% of top-5 depth. High risk of multi-tick vacuum drop. Evacuate resting maker quotes."
            )

        # 4. Normal laminar momentum flow
        else:
            regime = OFIInversionRegimeState.ALIGNED_LAMINAR_FLOW
            directive = InversionExecutionDirective.FOLLOW_MOMENTUM_FLOW
            if satellite.ofi_value >= 0.25 and anchor.ofi_value >= 0.20:
                recommended_side = "BUY"
            elif satellite.ofi_value <= -0.25 and anchor.ofi_value <= -0.20:
                recommended_side = "SELL"
            else:
                recommended_side = "HOLD_NEUTRAL"
            conf = 0.70
            rationales.append(
                f"Order flows laminar and coherent (Anchor OFI={anchor.ofi_value:.2f}, Satellite OFI={satellite.ofi_value:.2f}). Execute directional momentum."
            )

        return OrderFlowInversionSignal(
            timestamp_sec=current_time_sec,
            anchor_venue=anchor.venue_id,
            satellite_venue=satellite.venue_id,
            anchor_ofi=round(anchor.ofi_value, 3),
            satellite_ofi=round(satellite.ofi_value, 3),
            flow_divergence=round(flow_divergence, 3),
            ofi_acceleration=round(satellite.ofi_acceleration, 3),
            queue_fragility=round(max_fragility, 3),
            regime=regime,
            directive=directive,
            recommended_side=recommended_side,
            confidence_score=round(conf, 3),
            rationales=rationales,
        )
