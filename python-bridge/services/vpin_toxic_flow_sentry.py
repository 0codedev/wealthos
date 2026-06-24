"""
Intraday Volume Synchronized Probability of Toxicity (VPIN) & High-Frequency Toxic Flow Sentry
Domain 261 / Work Package WP-FG

Computes Easley-Lopez de Prado-O'Hara Volume-Synchronized Probability of Toxicity (VPIN)
across volume-clock buckets, maps current toxicity to empirical CDF percentiles,
and dynamically adjusts market maker spread multipliers to prevent adverse selection from informed flow.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class VPINToxicityRegime(str, Enum):
    NOMINAL_BALANCED_FLOW = "NOMINAL_BALANCED_FLOW"                      # VPIN < 0.30, normal two-sided liquidity
    ELEVATED_INFORMED_FLOW = "ELEVATED_INFORMED_FLOW"                    # 0.30 <= VPIN < 0.60, widen spreads defensively
    TOXIC_TSUNAMI_CIRCUIT_EVACUATION = "TOXIC_TSUNAMI_CIRCUIT_EVACUATION"# VPIN >= 0.60 or CDF >= 90%, flash crash/toxic wave imminent
    ASYMMETRIC_DIRECTIONAL_DRAIN = "ASYMMETRIC_DIRECTIONAL_DRAIN"        # Extreme unilateral bias (|B - S|/V >= 0.85)


class ToxicityDefenseDirective(str, Enum):
    MAINTAIN_STANDARD_MAKING = "MAINTAIN_STANDARD_MAKING"                # Standard 1.0x maker quote spreads
    WIDEN_TOXICITY_SPREAD_BUFFER = "WIDEN_TOXICITY_SPREAD_BUFFER"        # Widen spreads by 1.8x - 2.5x, halve maker size
    EVACUATE_RESTING_MAKER_QUOTES = "EVACUATE_RESTING_MAKER_QUOTES"      # Completely pull resting passive maker quotes
    SHADE_ONE_SIDED_OFFLOAD = "SHADE_ONE_SIDED_OFFLOAD"                  # Unilaterally cancel quotes opposing informed flow


@dataclass
class VolumeBucketState:
    bucket_id: int
    bucket_volume: float
    buy_volume: float
    sell_volume: float


@dataclass
class VPINAssessment:
    symbol: str
    current_vpin: float
    vpin_percentile_cdf: float
    order_flow_imbalance_ratio: float
    dominant_direction: str            # "BALANCED", "BUY_PRESSURE", "SELL_PRESSURE"
    regime: VPINToxicityRegime
    directive: ToxicityDefenseDirective
    recommended_spread_multiplier: float
    rationales: List[str] = field(default_factory=list)


class VPINToxicFlowSentry:
    """
    Sub-millisecond volume-clock toxicity calculator and maker spread sentry.
    """

    def __init__(
        self,
        num_buckets: int = 50,
        critical_vpin_threshold: float = 0.60,
        warning_vpin_threshold: float = 0.30,
        critical_cdf_threshold: float = 0.90,
    ):
        self.num_buckets = num_buckets
        self.critical_vpin_threshold = critical_vpin_threshold
        self.warning_vpin_threshold = warning_vpin_threshold
        self.critical_cdf_threshold = critical_cdf_threshold

    def calculate_vpin(self, buckets: List[VolumeBucketState]) -> float:
        """
        VPIN = sum |V_tau^B - V_tau^S| / (N * V)
        """
        if not buckets:
            return 0.0

        eval_buckets = buckets[-self.num_buckets:] if len(buckets) >= self.num_buckets else buckets
        total_vol = sum(b.bucket_volume for b in eval_buckets)
        if total_vol <= 0.0:
            return 0.0

        total_imbalance = sum(abs(b.buy_volume - b.sell_volume) for b in eval_buckets)
        vpin = total_imbalance / total_vol
        return max(0.0, min(1.0, vpin))

    def compute_empirical_cdf(
        self, current_vpin: float, hist_vpins: Optional[List[float]] = None
    ) -> float:
        """Computes empirical CDF percentile: P(VPIN_hist <= current_vpin)"""
        if not hist_vpins:
            # Baseline parametric approximation: map [0, 1] with normal-like distribution around 0.25
            return 0.5 * (1.0 + math.erf((current_vpin - 0.25) / (0.15 * math.sqrt(2.0))))

        count = sum(1 for v in hist_vpins if v <= current_vpin)
        return count / max(1, len(hist_vpins))

    def evaluate_flow(
        self,
        symbol: str,
        buckets: List[VolumeBucketState],
        historical_vpins: Optional[List[float]] = None,
    ) -> VPINAssessment:
        rationales: List[str] = []

        if not buckets:
            return VPINAssessment(
                symbol=symbol,
                current_vpin=0.0,
                vpin_percentile_cdf=0.0,
                order_flow_imbalance_ratio=0.0,
                dominant_direction="BALANCED",
                regime=VPINToxicityRegime.NOMINAL_BALANCED_FLOW,
                directive=ToxicityDefenseDirective.MAINTAIN_STANDARD_MAKING,
                recommended_spread_multiplier=1.0,
                rationales=["No volume buckets available."],
            )

        vpin = self.calculate_vpin(buckets)
        cdf = self.compute_empirical_cdf(vpin, historical_vpins)

        # Most recent bucket imbalance
        recent_b = buckets[-1]
        imb_ratio = (
            abs(recent_b.buy_volume - recent_b.sell_volume) / max(1.0, recent_b.bucket_volume)
        )
        if recent_b.buy_volume > recent_b.sell_volume * 1.5:
            direction = "BUY_PRESSURE"
        elif recent_b.sell_volume > recent_b.buy_volume * 1.5:
            direction = "SELL_PRESSURE"
        else:
            direction = "BALANCED"

        # Decision State Machine
        if vpin >= self.critical_vpin_threshold or cdf >= self.critical_cdf_threshold:
            regime = VPINToxicityRegime.TOXIC_TSUNAMI_CIRCUIT_EVACUATION
            directive = ToxicityDefenseDirective.EVACUATE_RESTING_MAKER_QUOTES
            spread_mult = 4.0
            rationales.append(
                f"Critical toxic flow tsunami on {symbol}: VPIN={vpin:.3f} >= {self.critical_vpin_threshold:.2f} "
                f"(CDF={cdf*100:.1f}%). Informed taker volume overwhelming book. Evacuate all resting maker quotes."
            )

        elif imb_ratio >= 0.85:
            regime = VPINToxicityRegime.ASYMMETRIC_DIRECTIONAL_DRAIN
            directive = ToxicityDefenseDirective.SHADE_ONE_SIDED_OFFLOAD
            spread_mult = 2.5
            rationales.append(
                f"Asymmetric directional sweep on {symbol} ({direction}): Imbalance ratio={imb_ratio*100:.1f}%. "
                f"VPIN={vpin:.3f}. Pull quotes opposing {direction} to prevent inventory exhaustion."
            )

        elif vpin >= self.warning_vpin_threshold:
            regime = VPINToxicityRegime.ELEVATED_INFORMED_FLOW
            directive = ToxicityDefenseDirective.WIDEN_TOXICITY_SPREAD_BUFFER
            spread_mult = 1.0 + (vpin - self.warning_vpin_threshold) * 5.0
            spread_mult = min(3.0, round(spread_mult, 2))
            rationales.append(
                f"Elevated informed toxicity on {symbol}: VPIN={vpin:.3f} (CDF={cdf*100:.1f}%). "
                f"Widen maker spread buffer to {spread_mult:.2f}x to price in adverse selection risk."
            )

        else:
            regime = VPINToxicityRegime.NOMINAL_BALANCED_FLOW
            directive = ToxicityDefenseDirective.MAINTAIN_STANDARD_MAKING
            spread_mult = 1.0
            rationales.append(
                f"Nominal balanced volume-clock flow on {symbol}: VPIN={vpin:.3f} < {self.warning_vpin_threshold:.2f}. "
                f"Flow is predominantly uninformed/random. Standard 1.0x market maker quotes permitted."
            )

        return VPINAssessment(
            symbol=symbol,
            current_vpin=round(vpin, 4),
            vpin_percentile_cdf=round(cdf, 4),
            order_flow_imbalance_ratio=round(imb_ratio, 4),
            dominant_direction=direction,
            regime=regime,
            directive=directive,
            recommended_spread_multiplier=round(spread_mult, 2),
            rationales=rationales,
        )
