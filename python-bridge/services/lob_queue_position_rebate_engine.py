r"""Limit Order Book Queue Position Estimation & Rebate Capture Engine (Domain 208 / WP-DF)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. FIFO price-time priority queue position tracker Q_{ahead}(t) with deterministic trade drain
   and uniform cancellation probability splitting.
2. Cont-de Larrard (2013) queue depletion survival hazard and expected time-to-fill \mathbb{E}[\tau_{fill}].
3. Net maker rebate capture optimization factoring exchange maker fee rebate R_{maker}, half-spread \frac{1}{2}S,
   and adverse selection discount.
4. Dynamic queue jumping, re-pegging, and stale cancellation sentry.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class QueueHealthStatus(Enum):
    """Priority status of resting order in limit order queue."""
    FRONT_OF_QUEUE = "FRONT_OF_QUEUE"       # Q_ahead <= 0.15 Q_total (imminent fill)
    MID_QUEUE = "MID_QUEUE"                 # 0.15 < Q_ahead <= 0.65 Q_total
    BACK_OF_QUEUE_TRAPPED = "BACK_OF_QUEUE_TRAPPED" # Q_ahead > 0.65 Q_total (low priority)
    FILLED_OR_COMPLETED = "FILLED_OR_COMPLETED" # Order filled


class QueueTacticalAction(Enum):
    """Recommended execution posture for resting limit order."""
    HOLD_AND_HARVEST_REBATE = "HOLD_AND_HARVEST_REBATE" # Maintain position; favorable expected edge
    REPOSITION_INSIDE_SPREAD = "REPOSITION_INSIDE_SPREAD" # Cancel and join tighter level
    CROSS_SPREAD_AGGRESSIVE = "CROSS_SPREAD_AGGRESSIVE" # Sweep spread ahead of adverse step
    CANCEL_STALE_QUOTE = "CANCEL_STALE_QUOTE"           # Evade impending adverse selection sweep


@dataclass
class RestingOrderState:
    """State and position of our specific resting limit order."""
    order_id: str
    price: float
    side: str                        # "BID" or "ASK"
    order_size: float
    volume_ahead: float              # Quantity in queue ahead of our order
    volume_behind: float             # Quantity in queue behind our order
    total_level_volume: float
    submission_timestamp_ms: float
    queue_fraction_ahead: float      # Q_ahead / Q_total in [0.0, 1.0]


@dataclass
class QueueDiagnosticsResult:
    """Queue depletion metrics, fill probabilities, and expected rebate edge."""
    order_id: str
    price: float
    side: str
    queue_status: QueueHealthStatus
    volume_ahead: float
    volume_behind: float
    estimated_seconds_to_fill: float
    fill_probability_5s: float
    expected_maker_rebate_bps: float
    gross_edge_bps: float            # Half-spread + maker rebate
    expected_adverse_selection_bps: float
    net_expected_edge_bps: float
    recommended_action: QueueTacticalAction
    tactical_directive: str


class LOBQueuePositionRebateEngine:
    r"""Limit Order Book Queue Position Estimation & Rebate Capture Engine.
    
    Mathematical Mechanics:
    1. Trade Fill Drain:
       Q_{ahead}(t) = \max(0, Q_{ahead}(t^-) - v_{trade})
    2. Cancellation Depletion:
       Q_{ahead}(t) = \max(0, Q_{ahead}(t^-) - v_{cancel} \cdot \frac{Q_{ahead}}{Q_{total}})
    3. Fill Hazard:
       P(fill \le \tau) = 1 - \exp\left(-\frac{\mu_{drain} \cdot \tau}{Q_{ahead} + 0.5 q}\right)
    4. Expected Edge:
       \mathbb{E}[\Pi] = P(fill) \cdot \left[ \frac{1}{2}S_{bps} + R_{maker} - \text{AdvSelect} \right] - (1 - P(fill)) \cdot \text{OppCost}
    """

    def __init__(
        self,
        maker_rebate_bps: float = 0.50,      # Exchange rebate for providing liquidity
        base_spread_bps: float = 2.00,       # Inside bid-ask spread in bps
        trade_drain_rate_shares_sec: float = 250.0, # Mean trades consuming book per sec
        opportunity_cost_bps: float = 0.40,
    ) -> None:
        self.maker_rebate_bps = maker_rebate_bps
        self.base_spread_bps = base_spread_bps
        self.trade_drain_rate_shares_sec = trade_drain_rate_shares_sec
        self.opportunity_cost_bps = opportunity_cost_bps

    def initialize_order_queue(
        self,
        order_id: str,
        price: float,
        side: str,
        order_size: float,
        existing_level_depth: float,
        timestamp_ms: float = 1000.0,
    ) -> RestingOrderState:
        """Create new resting order record positioned at the end of the current price tier."""
        total_vol = existing_level_depth + order_size
        vol_ahead = existing_level_depth
        vol_behind = 0.0
        frac_ahead = vol_ahead / max(total_vol, 1.0)

        return RestingOrderState(
            order_id=order_id,
            price=price,
            side=side.upper(),
            order_size=order_size,
            volume_ahead=vol_ahead,
            volume_behind=vol_behind,
            total_level_volume=total_vol,
            submission_timestamp_ms=timestamp_ms,
            queue_fraction_ahead=round(frac_ahead, 4),
        )

    def process_queue_events(
        self,
        order: RestingOrderState,
        trades_at_price: float,
        cancels_at_price: float,
        new_adds_behind: float = 0.0,
    ) -> RestingOrderState:
        r"""Update queue position ahead and behind after executed trades and cancellations."""
        curr_ahead = order.volume_ahead
        curr_total = max(order.total_level_volume, 1.0)

        # 1. Trades deplete strictly from the front of the queue
        depletion_trade = min(curr_ahead, trades_at_price)
        rem_trades = trades_at_price - depletion_trade
        curr_ahead -= depletion_trade

        # 2. Cancellations are distributed proportionally across the queue
        if curr_total > 0 and cancels_at_price > 0:
            prop_ahead = curr_ahead / curr_total
            depletion_cancel = cancels_at_price * prop_ahead
            curr_ahead = max(0.0, curr_ahead - depletion_cancel)

        # 3. New additions join strictly behind
        curr_behind = max(0.0, order.volume_behind + new_adds_behind - (cancels_at_price * (1.0 - (curr_ahead / curr_total))))

        new_total = curr_ahead + order.order_size + curr_behind
        frac_ahead = curr_ahead / max(new_total, 1.0)

        return RestingOrderState(
            order_id=order.order_id,
            price=order.price,
            side=order.side,
            order_size=order.order_size,
            volume_ahead=round(curr_ahead, 2),
            volume_behind=round(curr_behind, 2),
            total_level_volume=round(new_total, 2),
            submission_timestamp_ms=order.submission_timestamp_ms,
            queue_fraction_ahead=round(frac_ahead, 4),
        )

    def analyze_queue_diagnostics(
        self,
        order: RestingOrderState,
        current_spread_bps: Optional[float] = None,
        custom_drain_rate: Optional[float] = None,
    ) -> QueueDiagnosticsResult:
        r"""Evaluate queue position health, fill probabilities, adverse selection, and net edge."""
        drain_rate = custom_drain_rate or self.trade_drain_rate_shares_sec
        safe_drain = max(drain_rate, 1.0)
        spread_bps = current_spread_bps or self.base_spread_bps

        # Effective queue to deplete before our fill
        effective_depth_ahead = order.volume_ahead + 0.5 * order.order_size

        # 1. Expected seconds to fill
        seconds_to_fill = effective_depth_ahead / safe_drain

        # 2. 5-second fill probability
        # P = 1 - exp(-mu * tau / depth)
        fill_prob_5s = 1.0 - math.exp(-(safe_drain * 5.0) / max(effective_depth_ahead, 1.0))
        fill_prob_5s = max(0.0, min(1.0, fill_prob_5s))

        # 3. Queue Status Classification
        if order.volume_ahead <= 0.0:
            status = QueueHealthStatus.FILLED_OR_COMPLETED
        elif order.queue_fraction_ahead <= 0.20:
            status = QueueHealthStatus.FRONT_OF_QUEUE
        elif order.queue_fraction_ahead <= 0.65:
            status = QueueHealthStatus.MID_QUEUE
        else:
            status = QueueHealthStatus.BACK_OF_QUEUE_TRAPPED

        # 4. Adverse Selection & Edge Computation
        # Adverse selection increases when volume behind is thin relative to volume ahead
        # (meaning market is about to trade through)
        queue_support_ratio = order.volume_behind / max(order.volume_ahead + order.order_size, 1.0)
        # Sigmoid adverse penalty
        adverse_selection_bps = spread_bps * (0.60 / (1.0 + math.exp(2.0 * queue_support_ratio)))

        gross_edge = (spread_bps / 2.0) + self.maker_rebate_bps
        net_edge = fill_prob_5s * (gross_edge - adverse_selection_bps) - (1.0 - fill_prob_5s) * self.opportunity_cost_bps

        # 5. Tactical Action Recommendation
        if status == QueueHealthStatus.FILLED_OR_COMPLETED:
            action = QueueTacticalAction.HOLD_AND_HARVEST_REBATE
            directive = "Order is front-of-book or filled. Harvest rebate."
        elif status == QueueHealthStatus.FRONT_OF_QUEUE:
            if net_edge > 0:
                action = QueueTacticalAction.HOLD_AND_HARVEST_REBATE
                directive = (
                    f"Prime queue position ({order.queue_fraction_ahead:.1%} ahead). "
                    f"Expected fill in {seconds_to_fill:.1f}s (P_5s={fill_prob_5s:.1%}). "
                    f"Hold to capture {gross_edge:.2f} bps gross edge + {self.maker_rebate_bps:.2f} bps rebate."
                )
            else:
                action = QueueTacticalAction.CANCEL_STALE_QUOTE
                directive = "High adverse selection at touch despite front queue. Cancel to evade toxic fill."
        elif status == QueueHealthStatus.BACK_OF_QUEUE_TRAPPED:
            if fill_prob_5s < 0.20:
                action = QueueTacticalAction.REPOSITION_INSIDE_SPREAD
                directive = (
                    f"Trapped at back of queue ({order.queue_fraction_ahead:.1%} ahead, Q_ahead={order.volume_ahead:.0f}). "
                    f"Low fill probability ({fill_prob_5s:.1%}). Cancel and re-post inside spread."
                )
            else:
                action = QueueTacticalAction.HOLD_AND_HARVEST_REBATE
                directive = "Back of queue but heavy drain rate. Maintain position."
        else:
            action = QueueTacticalAction.HOLD_AND_HARVEST_REBATE
            directive = (
                f"Mid-queue priority ({order.queue_fraction_ahead:.1%} ahead). "
                f"Expected net edge: {net_edge:+.2f} bps. Patiently awaiting fill."
            )

        return QueueDiagnosticsResult(
            order_id=order.order_id,
            price=order.price,
            side=order.side,
            queue_status=status,
            volume_ahead=round(order.volume_ahead, 2),
            volume_behind=round(order.volume_behind, 2),
            estimated_seconds_to_fill=round(seconds_to_fill, 2),
            fill_probability_5s=round(fill_prob_5s, 4),
            expected_maker_rebate_bps=self.maker_rebate_bps,
            gross_edge_bps=round(gross_edge, 3),
            expected_adverse_selection_bps=round(adverse_selection_bps, 3),
            net_expected_edge_bps=round(net_edge, 3),
            recommended_action=action,
            tactical_directive=directive,
        )
