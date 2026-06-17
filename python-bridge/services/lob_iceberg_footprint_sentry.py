"""
High-Frequency Limit Order Book Hidden Liquidity Iceberg Detection & Execution Footprint Sentry
Domain 253 / Work Package WP-EY

Analyzes continuous order book fills against microsecond queue depth replenishments,
identifies institutional iceberg orders via trade-to-depth footprints, estimates total hidden reserve
volume via Bayesian German-Tank estimators, and protects aggressive routing from adverse absorption.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class IcebergDetectionState(str, Enum):
    STANDARD_LIT_BOOK_FLOW = "STANDARD_LIT_BOOK_FLOW"                  # Nominal lit queue, no hidden replenishment detected
    SUSPECTED_MICRO_ICEBERG = "SUSPECTED_MICRO_ICEBERG"                # 1-2 rapid refills, warning of potential hidden reserve
    DETECTED_ACTIVE_ICEBERG_ANCHOR = "DETECTED_ACTIVE_ICEBERG_ANCHOR"  # Confirmed institutional iceberg (>= 3 reloads, high ratio)
    ICEBERG_EXHAUSTION_BREAKTHROUGH = "ICEBERG_EXHAUSTION_BREAKTHROUGH"# Reserve exhausted; level about to break with momentum


class IcebergTacticalDirective(str, Enum):
    PROCEED_STANDARD_ROUTING = "PROCEED_STANDARD_ROUTING"              # Standard lit order routing permitted
    MONITOR_SUSPECTED_RELOAD = "MONITOR_SUSPECTED_RELOAD"              # Hold aggressive orders, track next fill signature
    LEAN_AGAINST_ICEBERG_SHIELD = "LEAN_AGAINST_ICEBERG_SHIELD"        # Post passive maker quotes directly in front of iceberg
    HALT_AGGRESSIVE_FLOW_INTO_WALL = "HALT_AGGRESSIVE_FLOW_INTO_WALL"  # Stop taking into iceberg; absorption will cause slippage
    PREPARE_BREAKOUT_CHASE = "PREPARE_BREAKOUT_CHASE"                  # Iceberg exhausted, fire momentum breakout taker orders


@dataclass
class LevelTradeObservation:
    price: float
    visible_depth_before: float
    trade_volume: float
    visible_depth_after: float
    reload_latency_ms: float           # Latency between trade match and depth reload
    timestamp_ms: float


@dataclass
class LevelIcebergAssessment:
    level_price: float
    side: str                          # "BID" or "ASK"
    cumulative_trade_volume: float
    observed_replenishments: int
    estimated_display_size: float
    estimated_total_iceberg_size: float
    estimated_remaining_hidden: float
    hidden_liquidity_ratio: float
    detection_confidence_pct: float
    state: IcebergDetectionState
    directive: IcebergTacticalDirective
    rationales: List[str] = field(default_factory=list)


class LOBIcebergFootprintSentry:
    """
    Sub-millisecond hidden liquidity detector and iceberg reserve estimator.
    """

    def __init__(
        self,
        min_replenishments: int = 3,
        max_reload_latency_ms: float = 5.0,
        confidence_threshold: float = 85.0,
    ):
        self.min_replenishments = min_replenishments
        self.max_reload_latency_ms = max_reload_latency_ms
        self.confidence_threshold = confidence_threshold

    def evaluate_level(
        self,
        level_price: float,
        side: str,
        observations: List[LevelTradeObservation],
    ) -> LevelIcebergAssessment:
        rationales: List[str] = []

        if not observations:
            return LevelIcebergAssessment(
                level_price=level_price,
                side=side,
                cumulative_trade_volume=0.0,
                observed_replenishments=0,
                estimated_display_size=0.0,
                estimated_total_iceberg_size=0.0,
                estimated_remaining_hidden=0.0,
                hidden_liquidity_ratio=1.0,
                detection_confidence_pct=0.0,
                state=IcebergDetectionState.STANDARD_LIT_BOOK_FLOW,
                directive=IcebergTacticalDirective.PROCEED_STANDARD_ROUTING,
                rationales=["No trade observations at price level."],
            )

        total_trade_volume = sum(obs.trade_volume for obs in observations)
        first_visible = observations[0].visible_depth_before
        last_visible = observations[-1].visible_depth_after

        # Count rapid replenishments
        replenishments = 0
        display_sizes: List[float] = []

        for obs in observations:
            # An iceberg reload signature: trade consumes depth, but depth immediately restores
            if (
                obs.trade_volume >= (obs.visible_depth_before * 0.8)
                and obs.visible_depth_after > 0.0
                and obs.reload_latency_ms <= self.max_reload_latency_ms
            ):
                replenishments += 1
                display_sizes.append(obs.visible_depth_after)

        avg_disp = (sum(display_sizes) / max(1, len(display_sizes))) if display_sizes else last_visible

        # Hidden liquidity ratio: total volume traded vs net visible depth change
        net_visible_drop = max(1.0, first_visible - last_visible)
        hidden_ratio = total_trade_volume / net_visible_drop

        # Bayesian German-Tank estimation of total iceberg size
        # Total = N_reload * avg_disp * (1 + 1/N_reload)
        if replenishments >= 1:
            tank_multiplier = 1.0 + (1.0 / replenishments)
            total_est = (replenishments * avg_disp) * tank_multiplier
            # Total must be at least total traded volume
            total_est = max(total_trade_volume, total_est)
            remaining_hidden = max(0.0, total_est - total_trade_volume)
        else:
            total_est = total_trade_volume
            remaining_hidden = 0.0

        # Confidence calculation
        if replenishments >= self.min_replenishments and hidden_ratio >= 3.0:
            confidence = min(99.0, 70.0 + (replenishments * 7.5))
        elif replenishments >= 1 and hidden_ratio >= 2.0:
            confidence = min(80.0, 40.0 + (replenishments * 15.0))
        else:
            confidence = max(0.0, min(35.0, hidden_ratio * 10.0))

        # Decision State Machine
        if replenishments >= self.min_replenishments and confidence >= self.confidence_threshold:
            # Check if nearly exhausted
            if remaining_hidden <= (avg_disp * 0.5):
                state = IcebergDetectionState.ICEBERG_EXHAUSTION_BREAKTHROUGH
                directive = IcebergTacticalDirective.PREPARE_BREAKOUT_CHASE
                rationales.append(
                    f"Iceberg reserve nearly exhausted on {side} at {level_price}: "
                    f"Remaining hidden est={remaining_hidden:.0f} shares <= 0.5 * display ({avg_disp:.0f}). "
                    f"Prepare for rapid breakout sweep."
                )
            else:
                state = IcebergDetectionState.DETECTED_ACTIVE_ICEBERG_ANCHOR
                directive = IcebergTacticalDirective.HALT_AGGRESSIVE_FLOW_INTO_WALL
                rationales.append(
                    f"Confirmed institutional iceberg on {side} at {level_price}: "
                    f"{replenishments} reloads detected within {self.max_reload_latency_ms}ms. "
                    f"Hidden ratio={hidden_ratio:.1f}x. Est total size={total_est:.0f} shares "
                    f"(Remaining hidden={remaining_hidden:.0f}). Halt aggressive taking into wall."
                )

        elif replenishments >= 1:
            state = IcebergDetectionState.SUSPECTED_MICRO_ICEBERG
            directive = IcebergTacticalDirective.MONITOR_SUSPECTED_RELOAD
            rationales.append(
                f"Suspected iceberg reload on {side} at {level_price}: "
                f"{replenishments} reloads observed. Confidence={confidence:.1f}%. Monitor next fill."
            )

        else:
            state = IcebergDetectionState.STANDARD_LIT_BOOK_FLOW
            directive = IcebergTacticalDirective.PROCEED_STANDARD_ROUTING
            rationales.append(
                f"Standard lit flow: Hidden ratio={hidden_ratio:.1f}x, zero automated reloads. Normal routing."
            )

        return LevelIcebergAssessment(
            level_price=level_price,
            side=side,
            cumulative_trade_volume=round(total_trade_volume, 2),
            observed_replenishments=replenishments,
            estimated_display_size=round(avg_disp, 2),
            estimated_total_iceberg_size=round(total_est, 2),
            estimated_remaining_hidden=round(remaining_hidden, 2),
            hidden_liquidity_ratio=round(hidden_ratio, 2),
            detection_confidence_pct=round(confidence, 2),
            state=state,
            directive=directive,
            rationales=rationales,
        )
