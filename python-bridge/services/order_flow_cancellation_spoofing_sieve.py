r"""Sub-Millisecond Order Flow Cancellation Velocity & Spoofing Sieve (Domain 205 / WP-DC)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Ultra-high-frequency order lifetime survival analysis and sub-millisecond cancellation hazard.
2. Quote-to-Trade Ratio (QTR) and Cancel-to-Fill Ratio (CFR) rolling microstructure sentry.
3. Multi-tier layering and phantom depth reconstruction with rapid post-fill contra cancellation tracking.
4. Instantaneous Spoofing Pressure Index (SPI) and non-bona fide quote filtration.
5. Algorithmic defense directives: Book sanitization and predatory quote counter-sniping.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class MarketManipulationRegime(Enum):
    """Microstructure manipulation state."""
    CLEAN_ORGANIC_FLOW = "CLEAN_ORGANIC_FLOW"         # SPI < 0.20 (genuine two-sided liquidity)
    SUSPICIOUS_QUOTE_STUFFING = "SUSPICIOUS_QUOTE_STUFFING" # 0.20 <= SPI < 0.55 (high cancellation churn)
    CONFIRMED_LAYERING = "CONFIRMED_LAYERING"         # 0.55 <= SPI < 0.80 (phantom depth manipulation)
    TOXIC_SPOOFING_BURST = "TOXIC_SPOOFING_BURST"     # SPI >= 0.80 (predatory quote stuffing attack)


class DefensePosture(Enum):
    """Algorithmic quoting defense posture."""
    STANDARD_QUOTING = "STANDARD_QUOTING"               # Normal market making
    STRIP_PHANTOM_DEPTH = "STRIP_PHANTOM_DEPTH"         # Disregard artificial depth in micro-price calculation
    WIDEN_MAKER_SPREAD = "WIDEN_MAKER_SPREAD"           # Widen quotes by 2.5x to evade toxic sweeps
    COUNTER_SNIPE_MANIPULATOR = "COUNTER_SNIPE_MANIPULATOR" # Attack the genuine leg of the spoofing order


@dataclass
class OrderLifeEvent:
    """Tracking lifecycle of an individual limit order."""
    order_id: str
    side: str                 # "BID" or "ASK"
    price: float
    size: float
    entry_timestamp_ms: float
    terminal_timestamp_ms: float
    event_type: str           # "FILL", "PARTIAL_FILL", or "CANCEL"
    resting_duration_ms: float = 0.0

    def __post_init__(self):
        if self.resting_duration_ms == 0.0:
            self.resting_duration_ms = max(0.0, self.terminal_timestamp_ms - self.entry_timestamp_ms)


@dataclass
class SpoofingDiagnosticsResult:
    """Comprehensive microstructure order cancellation and spoofing assessment."""
    sample_window_ms: float
    total_orders: int
    num_fills: int
    num_cancels: int
    cancel_to_fill_ratio: float
    quote_to_trade_volume_ratio: float
    mean_resting_time_ms: float
    sub_15ms_cancel_ratio: float      # % of cancels executed within 15ms of entry
    phantom_volume_ratio: float       # Ratio of artificial depth canceled post-fill
    spoofing_pressure_index: float    # SPI in [0.0, 1.0]
    manipulation_regime: MarketManipulationRegime
    defense_posture: DefensePosture
    filtered_bid_depth_discount_pct: float
    filtered_ask_depth_discount_pct: float
    tactical_directive: str


class OrderFlowCancellationSpoofingSieve:
    r"""Sub-Millisecond Order Flow Cancellation Velocity & Spoofing Sieve.
    
    Mathematical Mechanics:
    1. Cancel-to-Fill Ratio:
       \text{CFR} = \frac{N_{cancels}}{\max(N_{fills}, 1)}
    2. Quote-to-Trade Ratio:
       \text{QTR} = \frac{V_{quoted}}{\max(V_{executed}, 1.0)}
    3. Ultra-Fast Cancellation Hazard:
       H_{flash} = \frac{N_{cancels}(\tau_{life} \le 15ms)}{N_{cancels} + \epsilon}
    4. Spoofing Pressure Index:
       \text{SPI} = \tanh\left(0.35 \log(1 + \text{CFR}) + 1.20 H_{flash} + 0.50 \min(\mathcal{R}_{phantom}, 5.0)\right)
    """

    def __init__(
        self,
        flash_cancel_threshold_ms: float = 15.0,
        high_cfr_threshold: float = 15.0,
        extreme_qtr_threshold: float = 25.0,
    ) -> None:
        self.flash_cancel_threshold_ms = flash_cancel_threshold_ms
        self.high_cfr_threshold = high_cfr_threshold
        self.extreme_qtr_threshold = extreme_qtr_threshold

    def analyze_order_flow_cancellations(
        self,
        events: List[OrderLifeEvent],
        window_ms: float = 1000.0,
    ) -> SpoofingDiagnosticsResult:
        r"""Analyze order lifecycle events to detect flash cancels, quote stuffing, and layering."""
        if not events:
            return SpoofingDiagnosticsResult(
                sample_window_ms=window_ms,
                total_orders=0,
                num_fills=0,
                num_cancels=0,
                cancel_to_fill_ratio=0.0,
                quote_to_trade_volume_ratio=0.0,
                mean_resting_time_ms=0.0,
                sub_15ms_cancel_ratio=0.0,
                phantom_volume_ratio=0.0,
                spoofing_pressure_index=0.0,
                manipulation_regime=MarketManipulationRegime.CLEAN_ORGANIC_FLOW,
                defense_posture=DefensePosture.STANDARD_QUOTING,
                filtered_bid_depth_discount_pct=0.0,
                filtered_ask_depth_discount_pct=0.0,
                tactical_directive="Normal organic flow. Post two-sided quotes inside spread.",
            )

        n_total = len(events)
        cancels = [e for e in events if e.event_type.upper() == "CANCEL"]
        fills = [e for e in events if e.event_type.upper() in ("FILL", "PARTIAL_FILL")]

        n_cancels = len(cancels)
        n_fills = len(fills)

        # 1. Ratios
        cfr = n_cancels / max(n_fills, 1)
        vol_quoted = sum(e.size for e in events)
        vol_executed = sum(e.size for e in fills)
        qtr = vol_quoted / max(vol_executed, 1.0)

        # 2. Resting Duration Diagnostics
        durations = [e.resting_duration_ms for e in events]
        mean_duration = sum(durations) / max(len(durations), 1)

        flash_cancels = [c for c in cancels if c.resting_duration_ms <= self.flash_cancel_threshold_ms]
        flash_cancel_ratio = len(flash_cancels) / max(n_cancels, 1)

        # 3. Layering & Post-Fill Contra Cancellation Tracking
        # Check if cancels occurred within 25ms of a fill on the opposite side
        phantom_cancels_bid = 0.0
        phantom_cancels_ask = 0.0

        for f in fills:
            t_fill = f.terminal_timestamp_ms
            fill_side = f.side.upper()
            # Contra side cancels within 25ms
            contra_side = "ASK" if fill_side == "BID" else "BID"
            for c in cancels:
                if c.side.upper() == contra_side:
                    time_diff = abs(c.terminal_timestamp_ms - t_fill)
                    if time_diff <= 25.0:
                        if c.side.upper() == "BID":
                            phantom_cancels_bid += c.size
                        else:
                            phantom_cancels_ask += c.size

        total_phantom = phantom_cancels_bid + phantom_cancels_ask
        phantom_ratio = total_phantom / max(vol_executed, 1.0)

        # 4. Spoofing Pressure Index (SPI)
        # Scaled in [0.0, 1.0]
        z = (
            0.35 * math.log(1.0 + min(cfr, 50.0))
            + 1.20 * flash_cancel_ratio
            + 0.50 * min(phantom_ratio, 5.0)
        )
        spi = math.tanh(z)
        spi = max(0.0, min(1.0, spi))

        # 5. Regime Classification & Defense Directives
        bid_discount = 0.0
        ask_discount = 0.0

        if flash_cancel_ratio > 0.60:
            regime = MarketManipulationRegime.TOXIC_SPOOFING_BURST
            posture = DefensePosture.WIDEN_MAKER_SPREAD
            bid_discount = 60.0
            ask_discount = 60.0
            directive = (
                f"CRITICAL TOXIC SPOOFING BURST (SPI={spi:.2f}, FlashCancels={flash_cancel_ratio:.1%}). "
                "Predatory quote stuffing detected. Widen maker spreads by 2.5x and cancel resting orders."
            )
        elif phantom_ratio >= 1.50 and total_phantom > 0:
            regime = MarketManipulationRegime.CONFIRMED_LAYERING
            posture = DefensePosture.STRIP_PHANTOM_DEPTH
            if phantom_cancels_bid > phantom_cancels_ask:
                bid_discount = min(75.0, phantom_ratio * 10.0)
                directive = (
                    f"CONFIRMED BID LAYERING DETECTED (PhantomRatio={phantom_ratio:.1f}x). Artificial bid depth "
                    f"sanitized (-{bid_discount:.0f}%). Do not buy at touch; prepare counter-snipe."
                )
            else:
                ask_discount = min(75.0, phantom_ratio * 10.0)
                directive = (
                    f"CONFIRMED ASK LAYERING DETECTED (PhantomRatio={phantom_ratio:.1f}x). Artificial ask depth "
                    f"sanitized (-{ask_discount:.0f}%). Do not sell at touch; prepare counter-snipe."
                )
        elif cfr >= self.high_cfr_threshold or qtr >= self.extreme_qtr_threshold:
            regime = MarketManipulationRegime.SUSPICIOUS_QUOTE_STUFFING
            posture = DefensePosture.STRIP_PHANTOM_DEPTH
            bid_discount = 25.0
            ask_discount = 25.0
            directive = (
                f"Suspicious quote stuffing churn (CFR={cfr:.1f}, QTR={qtr:.1f}). Discount visible book "
                "depth by 25% before executing micro-price calculation."
            )
        else:
            regime = MarketManipulationRegime.CLEAN_ORGANIC_FLOW
            posture = DefensePosture.STANDARD_QUOTING
            directive = "Clean organic flow verified. Proceed with regular two-sided quoting."

        return SpoofingDiagnosticsResult(
            sample_window_ms=window_ms,
            total_orders=n_total,
            num_fills=n_fills,
            num_cancels=n_cancels,
            cancel_to_fill_ratio=round(cfr, 2),
            quote_to_trade_volume_ratio=round(qtr, 2),
            mean_resting_time_ms=round(mean_duration, 2),
            sub_15ms_cancel_ratio=round(flash_cancel_ratio, 4),
            phantom_volume_ratio=round(phantom_ratio, 3),
            spoofing_pressure_index=round(spi, 4),
            manipulation_regime=regime,
            defense_posture=posture,
            filtered_bid_depth_discount_pct=round(bid_discount, 1),
            filtered_ask_depth_discount_pct=round(ask_discount, 1),
            tactical_directive=directive,
        )
