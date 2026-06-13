r"""Microstructure Level-3 Cancel-Replace Game & Priority Queue Depletion Sentry (Domain 218 / WP-DP)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Level-3 FIFO priority queue loss calculus \Delta Q_{priority} upon order modification.
2. Cont-de Larrard expected fill horizon comparison \mathbb{E}[\tau_{curr}] vs \mathbb{E}[\tau_{jump}].
3. Dynamic cancel-replace net economic value \Delta V_{jump} incorporating half-spread, adverse selection,
   and exchange quote amendment friction.
4. Microsecond adverse sweep evacuation sentry and race-condition amendment rejector.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class QueuePriorityStatus(Enum):
    """Priority state of current resting order relative to queue depth."""
    PRIME_FRONT_PRIORITY = "PRIME_FRONT_PRIORITY"       # Ahead fraction <= 0.25; high priority capital
    MID_QUEUE_ADVANCING = "MID_QUEUE_ADVANCING"         # 0.25 < Ahead fraction <= 0.65
    TRAPPED_TAIL_PRIORITY = "TRAPPED_TAIL_PRIORITY"     # Ahead fraction > 0.65; low priority queue waste
    IMMINENT_TOXIC_SWEEP = "IMMINENT_TOXIC_SWEEP"       # Aggressive sweep incoming; emergency evacuation


class CancelReplaceTacticalAction(Enum):
    """Recommended execution action for resting order."""
    MAINTAIN_RESTING_PRIORITY = "MAINTAIN_RESTING_PRIORITY" # Keep resting order, priority value is high
    EXECUTE_CANCEL_REPLACE_JUMP = "EXECUTE_CANCEL_REPLACE_JUMP" # Cancel and join higher/tighter tier
    IMMEDIATE_CANCEL_EVACUATION = "IMMEDIATE_CANCEL_EVACUATION" # Pull order immediately to evade toxic sweep
    REJECT_AMENDMENT_RACE = "REJECT_AMENDMENT_RACE"     # RTT latency exceeds fill horizon; do not amend


@dataclass
class RestingQuoteState:
    """State of our resting order in the order book."""
    order_id: str
    price: float
    side: str                          # "BID" or "ASK"
    size: float
    volume_ahead: float
    volume_behind: float
    total_level_volume: float
    drain_rate_shares_sec: float       # Trade consumption rate at this price


@dataclass
class TargetLevelState:
    """State of candidate price level to jump to."""
    price: float
    existing_depth: float
    drain_rate_shares_sec: float


@dataclass
class CancelReplaceDiagnosticsResult:
    """Full quantitative diagnostics and directive for cancel-replace game."""
    order_id: str
    current_price: float
    queue_fraction_ahead: float
    expected_seconds_to_fill_current: float
    target_price: float
    expected_seconds_to_fill_target: float
    net_jump_economic_value_bps: float
    priority_status: QueuePriorityStatus
    recommended_action: CancelReplaceTacticalAction
    tactical_directive: str


class CancelReplaceQueueDepletionSentry:
    r"""Microstructure Cancel-Replace Game & Priority Sentry.
    
    Mathematical Formulation:
    1. Expected Time to Fill:
       \mathbb{E}[\tau] = \frac{Q_{ahead} + 0.5 \cdot q}{\mu_{drain}}
       
    2. Fill Probability over Horizon H:
       P(fill \le H) = 1 - \exp\left(-\frac{\mu \cdot H}{Q_{ahead} + 0.5 \cdot q}\right)
       
    3. Net Economic Jump Value:
       \Delta V_{\text{jump}} = P(\text{fill}_{tgt}) \cdot \text{Edge}_{tgt} - P(\text{fill}_{curr}) \cdot \text{Edge}_{curr} - \text{Friction}
    """

    def __init__(
        self,
        cancel_replace_friction_bps: float = 0.15,
        amendment_rtt_latency_sec: float = 0.005, # 5ms
        horizon_sec: float = 5.0,
    ) -> None:
        self.friction_bps = cancel_replace_friction_bps
        self.rtt_sec = amendment_rtt_latency_sec
        self.horizon_sec = horizon_sec

    def evaluate_cancel_replace_decision(
        self,
        current_order: RestingQuoteState,
        target_level: Optional[TargetLevelState] = None,
        incoming_sweep_volume_last_100ms: float = 0.0,
        current_spread_bps: float = 2.0,
    ) -> CancelReplaceDiagnosticsResult:
        """Evaluate trade-off between resting queue priority and jumping to tighter tier."""
        curr_total = max(current_order.total_level_volume, 1.0)
        frac_ahead = current_order.volume_ahead / curr_total

        # Expected fill time current
        eff_depth_curr = current_order.volume_ahead + 0.5 * current_order.size
        safe_drain_curr = max(current_order.drain_rate_shares_sec, 1.0)
        tau_fill_curr = eff_depth_curr / safe_drain_curr

        p_fill_curr = 1.0 - math.exp(-safe_drain_curr * self.horizon_sec / max(eff_depth_curr, 1.0))

        # Check for toxic sweep hazard (sweep volume > 80% of volume ahead)
        sweep_ratio = incoming_sweep_volume_last_100ms / max(current_order.volume_ahead, 1.0)

        if sweep_ratio > 0.80 and incoming_sweep_volume_last_100ms > current_order.size * 2.0:
            status = QueuePriorityStatus.IMMINENT_TOXIC_SWEEP
            action = CancelReplaceTacticalAction.IMMEDIATE_CANCEL_EVACUATION
            net_jump_val = -10.0
            tgt_price = current_order.price
            tau_fill_tgt = 0.0
            directive = (
                f"EMERGENCY EVACUATION: Toxic sweep incoming ({incoming_sweep_volume_last_100ms:.0f} shares vs Q_ahead={current_order.volume_ahead:.0f}). "
                f"Cancel quote immediately without re-posting to evade adverse selection fill!"
            )
        elif tau_fill_curr < self.rtt_sec * 2.0:
            # Fill is imminent in under 10ms; do not attempt amendment
            status = QueuePriorityStatus.PRIME_FRONT_PRIORITY
            action = CancelReplaceTacticalAction.REJECT_AMENDMENT_RACE
            net_jump_val = 0.0
            tgt_price = current_order.price
            tau_fill_tgt = tau_fill_curr
            directive = (
                f"RACE REJECT: Order is front of book (fill horizon {tau_fill_curr*1000:.1f}ms <= 2x RTT). "
                f"Do not cancel-replace; fill is already occurring."
            )
        elif frac_ahead <= 0.25:
            # Prime priority: keep order
            status = QueuePriorityStatus.PRIME_FRONT_PRIORITY
            action = CancelReplaceTacticalAction.MAINTAIN_RESTING_PRIORITY
            net_jump_val = 0.0
            tgt_price = current_order.price
            tau_fill_tgt = tau_fill_curr
            directive = (
                f"HOLD PRIORITY: Excellent queue position ({frac_ahead:.1%} ahead, Q_ahead={current_order.volume_ahead:.0f}). "
                f"Preserve accumulated queue priority."
            )
        elif target_level is not None:
            # Evaluate jumping to target level
            eff_depth_tgt = target_level.existing_depth + 0.5 * current_order.size
            safe_drain_tgt = max(target_level.drain_rate_shares_sec, 1.0)
            tau_fill_tgt = eff_depth_tgt / safe_drain_tgt
            p_fill_tgt = 1.0 - math.exp(-safe_drain_tgt * self.horizon_sec / max(eff_depth_tgt, 1.0))

            # Economic value: jumping to target yields tighter spread (0.8x base) but higher fill prob
            edge_curr = current_spread_bps * 0.50
            edge_tgt = current_spread_bps * 0.40 # Slightly tighter half-spread

            net_jump_val = (p_fill_tgt * edge_tgt) - (p_fill_curr * edge_curr) - self.friction_bps
            tgt_price = target_level.price

            if frac_ahead > 0.65 and net_jump_val > 0 and tau_fill_tgt < tau_fill_curr * 0.5:
                status = QueuePriorityStatus.TRAPPED_TAIL_PRIORITY
                action = CancelReplaceTacticalAction.EXECUTE_CANCEL_REPLACE_JUMP
                directive = (
                    f"QUEUE JUMP: Trapped at back of queue ({frac_ahead:.1%} ahead). "
                    f"Target price {tgt_price:.2f} reduces fill time from {tau_fill_curr:.1f}s to {tau_fill_tgt:.1f}s (Net Value: +{net_jump_val:.2f} bps). Amend order!"
                )
            else:
                status = QueuePriorityStatus.MID_QUEUE_ADVANCING
                action = CancelReplaceTacticalAction.MAINTAIN_RESTING_PRIORITY
                directive = (
                    f"MID QUEUE: Advancing smoothly ({frac_ahead:.1%} ahead). "
                    f"Net jump value ({net_jump_val:+.2f} bps) does not justify forfeiting priority."
                )
        else:
            status = QueuePriorityStatus.MID_QUEUE_ADVANCING
            action = CancelReplaceTacticalAction.MAINTAIN_RESTING_PRIORITY
            tgt_price = current_order.price
            tau_fill_tgt = tau_fill_curr
            net_jump_val = 0.0
            directive = f"MID QUEUE: Maintain resting priority ({frac_ahead:.1%} ahead)."

        return CancelReplaceDiagnosticsResult(
            order_id=current_order.order_id,
            current_price=current_order.price,
            queue_fraction_ahead=round(frac_ahead, 4),
            expected_seconds_to_fill_current=round(tau_fill_curr, 3),
            target_price=tgt_price,
            expected_seconds_to_fill_target=round(tau_fill_tgt, 3),
            net_jump_economic_value_bps=round(net_jump_val, 3),
            priority_status=status,
            recommended_action=action,
            tactical_directive=directive,
        )
