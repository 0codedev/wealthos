r"""Machine-Learned Dynamic Margin & Liquidation Cascade Predictor (Domain 209 / WP-DG)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Multi-tier dynamic maintenance margin (MM) scheduling incorporating position size brackets
   and real-time volatility scaling.
2. Distance-to-liquidation calculus \Delta P_{liq} across leveraged long/short positions.
3. Mark-price fire-sale liquidation cascade hazard estimation P_{cascade} based on
   aggregate liquidation density versus order book absorptive depth.
4. Autonomous pre-emptive de-leveraging (ADL) sentry to evade predatory exchange liquidation penalties.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class CascadeRiskRegime(Enum):
    """Systemic liquidation contagion risk classification."""
    BENIGN = "BENIGN"                           # P_cascade < 0.20, normal liquidity depth
    ELEVATED_WATCH = "ELEVATED_WATCH"           # 0.20 <= P_cascade < 0.60, thinning liquidity
    ACUTE_CASCADE_WARNING = "ACUTE_CASCADE_WARNING" # P_cascade >= 0.60, high fire-sale contagion risk


class AccountLiquidationPosture(Enum):
    """Account margin health status."""
    HEALTHY_SAFE = "HEALTHY_SAFE"               # Margin ratio > 2.0x
    MARGIN_STRESSED = "MARGIN_STRESSED"         # 1.25x < Margin ratio <= 2.0x
    IMMINENT_LIQUIDATION = "IMMINENT_LIQUIDATION" # Margin ratio <= 1.25x


class DeleveragingAction(Enum):
    """Recommended risk remediation action."""
    MAINTAIN_NORMAL = "MAINTAIN_NORMAL"         # Normal operation
    SCALE_DOWN_LEVERAGE = "SCALE_DOWN_LEVERAGE" # Proactively reduce exposure by 25-50%
    EMERGENCY_PROACTIVE_EXIT = "EMERGENCY_PROACTIVE_EXIT" # Market flatten to avoid liquidation penalty


@dataclass
class PositionMarginState:
    """State and margin metrics for an individual leveraged position."""
    symbol: str
    side: str                          # "LONG" or "SHORT"
    position_size: float
    entry_price: float
    mark_price: float
    account_equity: float
    base_maintenance_margin_rate: float # e.g., 0.05 (5% for 20x max leverage)
    realized_volatility: float          # Annualized or daily volatility
    reference_volatility: float = 0.20  # Baseline reference vol


@dataclass
class LiquidationClusterTier:
    """Estimated resting liquidation volume at a given price level."""
    trigger_price: float
    estimated_volume: float
    distance_pct: float                # Distance from current mark price


@dataclass
class LiquidationCascadePredictionResult:
    """Diagnostic outcome of dynamic margin and cascade prediction."""
    symbol: str
    side: str
    position_size: float
    mark_price: float
    account_equity: float
    effective_maintenance_margin_rate: float
    maintenance_margin_required: float
    margin_ratio: float                # Equity / Maintenance Margin
    liquidation_price: float
    distance_to_liquidation_pct: float
    account_posture: AccountLiquidationPosture
    cascade_probability: float
    cascade_regime: CascadeRiskRegime
    recommended_action: DeleveragingAction
    suggested_size_reduction: float    # Shares/contracts to reduce proactively
    tactical_directive: str


class DynamicMarginLiquidationCascadePredictor:
    r"""Machine-Learned Dynamic Margin & Liquidation Cascade Predictor.
    
    Mathematical Formulation:
    1. Volatility-Scaled Dynamic Maintenance Margin Rate:
       MM_{rate} = MM_{base} \cdot \left[ 1.0 + \alpha \cdot \max\left(0, \frac{\sigma - \sigma_{ref}}{\sigma_{ref}}\right) \right]
    
    2. Liquidation Price:
       For Long:
       P_{liq} = \frac{P_{mark} \cdot Q - \text{Equity}}{Q \cdot (1 - MM_{rate})}
       For Short:
       P_{liq} = \frac{\text{Equity} + P_{mark} \cdot Q}{Q \cdot (1 + MM_{rate})}
       
    3. Cascade Hazard P_{cascade}:
       Logit Z = \theta_0 + \theta_1 \cdot \frac{V_{liq, near}}{D_{lob}} + \theta_2 \cdot \frac{\sigma}{\sigma_{ref}} - \theta_3 \cdot \Delta P_{buffer}
       P_{cascade} = \frac{1}{1 + \exp(-Z)}
    """

    def __init__(
        self,
        vol_scaling_alpha: float = 0.50,
        theta_0: float = -2.50,
        theta_density: float = 1.80,
        theta_vol: float = 0.80,
        theta_buffer: float = 12.0,
    ) -> None:
        self.vol_scaling_alpha = vol_scaling_alpha
        self.theta_0 = theta_0
        self.theta_density = theta_density
        self.theta_vol = theta_vol
        self.theta_buffer = theta_buffer

    def calculate_effective_margin_rate(
        self,
        base_rate: float,
        realized_vol: float,
        ref_vol: float = 0.20,
    ) -> float:
        """Compute volatility-adjusted maintenance margin requirement rate."""
        vol_excess = max(0.0, (realized_vol - ref_vol) / max(ref_vol, 0.01))
        effective_rate = base_rate * (1.0 + self.vol_scaling_alpha * vol_excess)
        return min(1.0, max(base_rate, effective_rate))

    def calculate_liquidation_price(
        self,
        side: str,
        position_size: float,
        mark_price: float,
        account_equity: float,
        effective_mm_rate: float,
    ) -> float:
        """Calculate exact price at which equity equals maintenance margin requirement."""
        if position_size <= 0:
            return 0.0

        q = position_size
        side_upper = side.upper()

        if side_upper == "LONG":
            # At liquidation: Equity - Q * (mark - P_liq) = Q * P_liq * MM_rate
            # Equity - Q*mark + Q*P_liq = Q*P_liq*MM_rate
            # Q * P_liq * (1 - MM_rate) = Q*mark - Equity
            denom = q * (1.0 - effective_mm_rate)
            if denom <= 0:
                return mark_price
            p_liq = (mark_price * q - account_equity) / denom
            return max(0.0, p_liq)
        else: # SHORT
            # At liquidation: Equity - Q * (P_liq - mark) = Q * P_liq * MM_rate
            # Equity + Q*mark - Q*P_liq = Q*P_liq*MM_rate
            # Q * P_liq * (1 + MM_rate) = Equity + Q*mark
            denom = q * (1.0 + effective_mm_rate)
            p_liq = (account_equity + mark_price * q) / denom
            return max(0.0, p_liq)

    def estimate_cascade_probability(
        self,
        nearest_cluster_volume: float,
        order_book_depth_near: float,
        realized_vol: float,
        ref_vol: float,
        distance_to_liq_pct: float,
    ) -> float:
        """Estimate logistic cascade probability based on liquidation cluster depth and volatility."""
        depth_safe = max(order_book_depth_near, 1.0)
        density_ratio = nearest_cluster_volume / depth_safe
        vol_ratio = realized_vol / max(ref_vol, 0.01)

        # Logit link
        z = (
            self.theta_0
            + self.theta_density * density_ratio
            + self.theta_vol * vol_ratio
            - self.theta_buffer * distance_to_liq_pct
        )
        # Cap z to prevent overflow
        z = max(-15.0, min(15.0, z))
        prob = 1.0 / (1.0 + math.exp(-z))
        return max(0.0, min(1.0, prob))

    def evaluate_margin_and_cascade(
        self,
        position: PositionMarginState,
        liquidation_clusters: Optional[List[LiquidationClusterTier]] = None,
        order_book_bid_ask_depth_near: float = 50000.0,
    ) -> LiquidationCascadePredictionResult:
        """Evaluate account margin health and external fire-sale cascade probability."""
        effective_mm_rate = self.calculate_effective_margin_rate(
            base_rate=position.base_maintenance_margin_rate,
            realized_vol=position.realized_volatility,
            ref_vol=position.reference_volatility,
        )

        position_notional = position.position_size * position.mark_price
        maintenance_margin_req = position_notional * effective_mm_rate
        margin_ratio = position.account_equity / max(maintenance_margin_req, 1e-4)

        # Liquidation price
        liq_price = self.calculate_liquidation_price(
            side=position.side,
            position_size=position.position_size,
            mark_price=position.mark_price,
            account_equity=position.account_equity,
            effective_mm_rate=effective_mm_rate,
        )

        dist_pct = abs(position.mark_price - liq_price) / max(position.mark_price, 1e-4)

        # Account Posture
        if margin_ratio > 2.0:
            posture = AccountLiquidationPosture.HEALTHY_SAFE
        elif margin_ratio > 1.25:
            posture = AccountLiquidationPosture.MARGIN_STRESSED
        else:
            posture = AccountLiquidationPosture.IMMINENT_LIQUIDATION

        # Cluster depth analysis
        near_cluster_vol = 0.0
        if liquidation_clusters:
            # Aggregate volume within 3% of current price
            for cluster in liquidation_clusters:
                if cluster.distance_pct <= 0.03:
                    near_cluster_vol += cluster.estimated_volume

        cascade_prob = self.estimate_cascade_probability(
            nearest_cluster_volume=near_cluster_vol,
            order_book_depth_near=order_book_bid_ask_depth_near,
            realized_vol=position.realized_volatility,
            ref_vol=position.reference_volatility,
            distance_to_liq_pct=dist_pct,
        )

        # Cascade Regime
        if cascade_prob < 0.20:
            regime = CascadeRiskRegime.BENIGN
        elif cascade_prob < 0.60:
            regime = CascadeRiskRegime.ELEVATED_WATCH
        else:
            regime = CascadeRiskRegime.ACUTE_CASCADE_WARNING

        # Recommended Action
        suggested_reduction = 0.0
        if posture == AccountLiquidationPosture.IMMINENT_LIQUIDATION or regime == CascadeRiskRegime.ACUTE_CASCADE_WARNING:
            action = DeleveragingAction.EMERGENCY_PROACTIVE_EXIT
            suggested_reduction = position.position_size * 0.75
            directive = (
                f"CRITICAL: Acute cascade hazard (P_casc={cascade_prob:.1%}) or margin stress (MR={margin_ratio:.2f}x). "
                f"Proactively liquidate {suggested_reduction:.1f} units immediately to avoid exchange liquidation fee."
            )
        elif posture == AccountLiquidationPosture.MARGIN_STRESSED or regime == CascadeRiskRegime.ELEVATED_WATCH:
            action = DeleveragingAction.SCALE_DOWN_LEVERAGE
            suggested_reduction = position.position_size * 0.35
            directive = (
                f"CAUTION: Elevated liquidation risk. Margin ratio: {margin_ratio:.2f}x, P_cascade: {cascade_prob:.1%}. "
                f"Recommend reducing exposure by {suggested_reduction:.1f} units to restore buffer."
            )
        else:
            action = DeleveragingAction.MAINTAIN_NORMAL
            directive = (
                f"BENIGN: Account margin robust ({margin_ratio:.2f}x). "
                f"Distance to liq: {dist_pct:.1%}. Cascade probability low ({cascade_prob:.1%})."
            )

        return LiquidationCascadePredictionResult(
            symbol=position.symbol,
            side=position.side.upper(),
            position_size=position.position_size,
            mark_price=position.mark_price,
            account_equity=round(position.account_equity, 2),
            effective_maintenance_margin_rate=round(effective_mm_rate, 4),
            maintenance_margin_required=round(maintenance_margin_req, 2),
            margin_ratio=round(margin_ratio, 3),
            liquidation_price=round(liq_price, 2),
            distance_to_liquidation_pct=round(dist_pct, 4),
            account_posture=posture,
            cascade_probability=round(cascade_prob, 4),
            cascade_regime=regime,
            recommended_action=action,
            suggested_size_reduction=round(suggested_reduction, 2),
            tactical_directive=directive,
        )
