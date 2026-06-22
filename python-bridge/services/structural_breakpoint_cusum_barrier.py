"""
Multi-Asset Intraday Structural Breakpoint CUSUM & Regime Shift Barrier
Domain 250 / Work Package WP-EV

Executes Page's Cumulative Sum (CUSUM) sequential change-point hypothesis testing
on high-frequency returns and volatility residuals, identifying structural regime fractures
in real time and triggering systemic portfolio deleveraging before volatility explosions.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class StructuralRegimeState(str, Enum):
    STABLE_GAUSSIAN_FLOW = "STABLE_GAUSSIAN_FLOW"              # CUSUM statistic < 0.5 * h, baseline regime
    TRANSITIONAL_TURBULENCE = "TRANSITIONAL_TURBULENCE"        # 0.5 * h <= CUSUM < h, warning of shifting distribution
    STRUCTURAL_FRACTURE_CRITICAL = "STRUCTURAL_FRACTURE_CRITICAL"  # CUSUM >= h, definitive structural shift confirmed


class BarrierRiskDirective(str, Enum):
    NORMAL_OPERATIONS = "NORMAL_OPERATIONS"                    # Full leverage and active maker quotes permitted
    TIGHTEN_MONITORING_WINDOW = "TIGHTEN_MONITORING_WINDOW"    # Halve maker inventory limits, arm liquidation sentry
    TRIGGER_CIRCUIT_DELEVERAGE = "TRIGGER_CIRCUIT_DELEVERAGE"  # Preemptively slash gross exposure by >= 65%


@dataclass
class CUSUMDetectorConfig:
    target_mean: float = 0.0          # Expected residual under null hypothesis
    baseline_std: float = 1.0         # Standard deviation under null hypothesis
    slack_k: float = 0.5              # Reference allowance / allowance parameter k = delta / 2
    threshold_h: float = 4.5          # Decision boundary threshold h (in std units)
    deleveraging_ratio: float = 0.35  # Capital retained during structural fracture (65% cut)
    reset_on_trigger: bool = True     # Reset cumulative sums upon barrier breach


@dataclass
class AssetResidualInput:
    asset_id: str
    current_residual: float           # Observed metric (e.g. standardized return or vol shock)
    realized_volatility: float = 0.01 # Current realized volatility
    prev_s_pos: float = 0.0           # Cumulative sum for positive deviations S^+_{t-1}
    prev_s_neg: float = 0.0           # Cumulative sum for negative deviations S^-_{t-1}


@dataclass
class BreakpointAssessment:
    asset_id: str
    s_pos: float
    s_neg: float
    max_cusum_statistic: float
    regime: StructuralRegimeState
    directive: BarrierRiskDirective
    deleveraging_factor: float
    shift_direction: str              # "NONE", "UPWARD_SURGE", "DOWNWARD_COLLAPSE"
    rationales: List[str] = field(default_factory=list)


class StructuralBreakpointCUSUMBarrier:
    """
    Real-time sequential change-point detector using two-sided Page's CUSUM recursion.
    """

    def __init__(self, config: Optional[CUSUMDetectorConfig] = None):
        self.config = config or CUSUMDetectorConfig()

    def update_cusum(
        self,
        residual: float,
        prev_s_pos: float,
        prev_s_neg: float,
    ) -> Tuple[float, float]:
        """
        Calculates two-sided Page's CUSUM recursion:
        S^+_t = max(0, S^+_{t-1} + (x_t - mu_0) - k)
        S^-_t = max(0, S^-_{t-1} - (x_t - mu_0) - k)
        """
        mu_0 = self.config.target_mean
        k = self.config.slack_k

        # Standardized deviation
        dev = residual - mu_0

        s_pos = max(0.0, prev_s_pos + dev - k)
        s_neg = max(0.0, prev_s_neg - dev - k)

        return s_pos, s_neg

    def evaluate_asset(self, input_data: AssetResidualInput) -> BreakpointAssessment:
        rationales: List[str] = []
        h = self.config.threshold_h
        warning_thresh = 0.5 * h

        s_pos, s_neg = self.update_cusum(
            input_data.current_residual, input_data.prev_s_pos, input_data.prev_s_neg
        )
        max_stat = max(s_pos, s_neg)

        # Barrier breach detection
        if max_stat >= h:
            regime = StructuralRegimeState.STRUCTURAL_FRACTURE_CRITICAL
            directive = BarrierRiskDirective.TRIGGER_CIRCUIT_DELEVERAGE
            deleveraging_factor = self.config.deleveraging_ratio

            if s_pos >= h and s_neg >= h:
                direction = "BIDIRECTIONAL_VOLATILITY_BURST"
            elif s_pos >= h:
                direction = "UPWARD_SURGE"
            else:
                direction = "DOWNWARD_COLLAPSE"

            rationales.append(
                f"Definitive structural breakpoint confirmed on {input_data.asset_id}: "
                f"CUSUM stat={max_stat:.2f} >= threshold h={h:.2f} ({direction}). "
                f"Triggering immediate systemic deleveraging to {deleveraging_factor*100:.0f}% gross capacity."
            )

        elif max_stat >= warning_thresh:
            regime = StructuralRegimeState.TRANSITIONAL_TURBULENCE
            directive = BarrierRiskDirective.TIGHTEN_MONITORING_WINDOW
            deleveraging_factor = 0.70  # Modest 30% reduction in warning zone

            direction = "UPWARD_DRIFT" if s_pos >= s_neg else "DOWNWARD_DRIFT"
            rationales.append(
                f"Elevated structural drift on {input_data.asset_id}: "
                f"CUSUM stat={max_stat:.2f} >= warning {warning_thresh:.2f} (50% of barrier). "
                f"Tightening quote bands and risk tolerance."
            )

        else:
            regime = StructuralRegimeState.STABLE_GAUSSIAN_FLOW
            directive = BarrierRiskDirective.NORMAL_OPERATIONS
            deleveraging_factor = 1.0
            direction = "NONE"
            rationales.append(
                f"Flow distribution stable on {input_data.asset_id}: "
                f"CUSUM stat={max_stat:.2f} < warning threshold {warning_thresh:.2f}. "
                f"Normal operational parameters maintained."
            )

        return BreakpointAssessment(
            asset_id=input_data.asset_id,
            s_pos=round(s_pos, 4),
            s_neg=round(s_neg, 4),
            max_cusum_statistic=round(max_stat, 4),
            regime=regime,
            directive=directive,
            deleveraging_factor=round(deleveraging_factor, 2),
            shift_direction=direction,
            rationales=rationales,
        )

    def evaluate_batch(
        self, inputs: List[AssetResidualInput]
    ) -> Tuple[Dict[str, BreakpointAssessment], float]:
        """
        Evaluates a cross-asset basket of residuals and computes systemic fracture ratio:
        Fraction of assets in STRUCTURAL_FRACTURE_CRITICAL state.
        """
        results: Dict[str, BreakpointAssessment] = {}
        fracture_count = 0

        for item in inputs:
            assessment = self.evaluate_asset(item)
            results[item.asset_id] = assessment
            if assessment.regime == StructuralRegimeState.STRUCTURAL_FRACTURE_CRITICAL:
                fracture_count += 1

        total = max(1, len(inputs))
        systemic_ratio = fracture_count / total

        return results, round(systemic_ratio, 4)
