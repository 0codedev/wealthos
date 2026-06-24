r"""Cross-Market Order Flow Microstructure Adverse Selection & VPIN Drift Sieve (Domain 222 / WP-DT)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Easley-Lopez de Prado-O'Hara (2012) Volume-Synchronized Probability of Toxicity (VPIN).
2. Bulk Volume Classification (BVC) partitioning trades into buy and sell volume buckets.
3. Rolling historical CDF toxicity percentile tracking \text{CDF}(VPIN_t).
4. Dynamic adverse selection half-spread discount and microsecond maker quote eviction sentry.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class VPINToxicityRegime(Enum):
    """Classification of order flow toxicity based on VPIN percentile."""
    BENIGN_UNINFORMED_FLOW = "BENIGN_UNINFORMED_FLOW"     # CDF(VPIN) < 0.60, noise trading
    ELEVATED_TOXICITY_WARNING = "ELEVATED_TOXICITY_WARNING" # 0.60 <= CDF(VPIN) < 0.90, informed presence
    ACUTE_TOXIC_TSUNAMI = "ACUTE_TOXIC_TSUNAMI"           # CDF(VPIN) >= 0.90, toxic market sweep


class VPINQuoteAction(Enum):
    """Tactical posture for market maker quotes."""
    MAINTAIN_PASSIVE_MAKING = "MAINTAIN_PASSIVE_MAKING"
    SHADE_INVENTORY_SPREAD = "SHADE_INVENTORY_SPREAD"     # Widen spread by 1.5x - 2.0x, shade quote
    EVACUATE_MAKER_QUOTES = "EVACUATE_MAKER_QUOTES"       # Cancel resting orders to prevent toxic fill


@dataclass
class VolumeBucket:
    """Standardized volume bucket."""
    bucket_id: int
    buy_volume: float
    sell_volume: float
    total_volume: float
    price_change: float


@dataclass
class VPINDiagnosticsResult:
    """Full quantitative diagnostics for VPIN order flow toxicity."""
    symbol: str
    current_vpin: float                # Value in [0.0, 1.0]
    vpin_cdf_percentile: float         # In [0.0, 1.0]
    total_buckets_analyzed: int
    raw_order_imbalance_shares: float
    adverse_selection_penalty_bps: float
    toxicity_regime: VPINToxicityRegime
    recommended_action: VPINQuoteAction
    spread_multiplier: float
    tactical_directive: str


class VPINAdverseSelectionSieve:
    r"""Volume-Synchronized Probability of Toxicity (VPIN) Sieve.
    
    Mathematical Formulation:
    1. Bulk Volume Classification (BVC):
       V_\tau^B = V \cdot \Phi\left(\frac{\Delta P_\tau}{\sigma_{\Delta P}}\right), \quad V_\tau^S = V - V_\tau^B
       
    2. VPIN Formulation:
       VPIN = \frac{\sum_{\tau=1}^N |V_\tau^B - V_\tau^S|}{N \cdot V}
       
    3. CDF Percentile:
       \text{CDF}(VPIN_t) = \frac{1}{M} \sum_{k=1}^M \mathbf{1}_{\{VPIN_k \le VPIN_t\}}
       
    4. Adverse Selection Penalty:
       \text{Penalty}_{\text{bps}} = S_{\text{half}} \cdot \frac{1}{1 + \exp(-4.0 (\text{CDF} - 0.50))}
    """

    def __init__(
        self,
        rolling_window_buckets: int = 50,
        critical_cdf_threshold: float = 0.90,
        elevated_cdf_threshold: float = 0.60,
        base_half_spread_bps: float = 1.50,
    ) -> None:
        self.rolling_buckets = rolling_window_buckets
        self.crit_cdf = critical_cdf_threshold
        self.elev_cdf = elevated_cdf_threshold
        self.base_half_spread = base_half_spread_bps

    @staticmethod
    def _norm_cdf(x: float) -> float:
        return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

    def create_bucket_from_trade(
        self,
        bucket_id: int,
        bucket_size: float,
        price_change: float,
        sigma_price: float,
    ) -> VolumeBucket:
        """Classify a constant-volume slice using Bulk Volume Classification (BVC)."""
        safe_sigma = max(sigma_price, 1e-4)
        z = price_change / safe_sigma
        buy_fraction = self._norm_cdf(z)
        buy_vol = bucket_size * buy_fraction
        sell_vol = bucket_size - buy_vol

        return VolumeBucket(
            bucket_id=bucket_id,
            buy_volume=round(buy_vol, 2),
            sell_volume=round(sell_vol, 2),
            total_volume=bucket_size,
            price_change=price_change,
        )

    def calculate_vpin(self, buckets: List[VolumeBucket]) -> float:
        """Compute VPIN over the most recent rolling window of buckets."""
        if not buckets:
            return 0.0

        window = buckets[-self.rolling_buckets:] if len(buckets) >= self.rolling_buckets else buckets
        total_vol = sum(b.total_volume for b in window)
        if total_vol <= 0:
            return 0.0

        abs_imbalance_sum = sum(abs(b.buy_volume - b.sell_volume) for b in window)
        vpin = abs_imbalance_sum / total_vol
        return round(max(0.0, min(1.0, vpin)), 4)

    def compute_cdf_percentile(self, current_vpin: float, historical_vpins: List[float]) -> float:
        """Compute the empirical CDF percentile of the current VPIN relative to history."""
        if not historical_vpins:
            return 0.50

        count_below = sum(1 for v in historical_vpins if v <= current_vpin)
        cdf = count_below / len(historical_vpins)
        return round(max(0.0, min(1.0, cdf)), 4)

    def evaluate_vpin_toxicity(
        self,
        symbol: str,
        recent_buckets: List[VolumeBucket],
        historical_vpins: List[float],
    ) -> VPINDiagnosticsResult:
        """Execute VPIN calculation, CDF standardization, adverse selection penalty, and tactical action."""
        vpin = self.calculate_vpin(recent_buckets)
        cdf_pct = self.compute_cdf_percentile(vpin, historical_vpins)

        # Total imbalance in recent window
        window = recent_buckets[-self.rolling_buckets:] if len(recent_buckets) >= self.rolling_buckets else recent_buckets
        net_imbalance = sum(b.buy_volume - b.sell_volume for b in window)

        # Adverse selection discount in bps
        sigmoid_factor = 1.0 / (1.0 + math.exp(-4.0 * (cdf_pct - 0.50)))
        adverse_penalty = self.base_half_spread * sigmoid_factor

        # Regimes & Decisions
        if cdf_pct >= self.crit_cdf or vpin >= 0.65:
            regime = VPINToxicityRegime.ACUTE_TOXIC_TSUNAMI
            action = VPINQuoteAction.EVACUATE_MAKER_QUOTES
            mult = 5.0
            directive = (
                f"ACUTE TOXICITY TSUNAMI: VPIN = {vpin:.1%} at {cdf_pct:.1%} percentile! "
                f"Adverse penalty {adverse_penalty:.2f} bps consumes entire spread. Evacuate all maker quotes immediately!"
            )
        elif cdf_pct >= self.elev_cdf:
            regime = VPINToxicityRegime.ELEVATED_TOXICITY_WARNING
            action = VPINQuoteAction.SHADE_INVENTORY_SPREAD
            mult = 1.60
            directive = (
                f"ELEVATED TOXICITY: VPIN = {vpin:.1%} at {cdf_pct:.1%} percentile. "
                f"Widen quoting spread by {mult:.2f}x and shade quotes away from informed net flow ({net_imbalance:+.0f} shares)."
            )
        else:
            regime = VPINToxicityRegime.BENIGN_UNINFORMED_FLOW
            action = VPINQuoteAction.MAINTAIN_PASSIVE_MAKING
            mult = 1.0
            directive = (
                f"BENIGN FLOW: VPIN = {vpin:.1%} at {cdf_pct:.1%} percentile. "
                f"Order flow dominated by uninformed noise. Full two-sided liquidity provision active."
            )

        return VPINDiagnosticsResult(
            symbol=symbol,
            current_vpin=vpin,
            vpin_cdf_percentile=cdf_pct,
            total_buckets_analyzed=len(window),
            raw_order_imbalance_shares=round(net_imbalance, 1),
            adverse_selection_penalty_bps=round(adverse_penalty, 3),
            toxicity_regime=regime,
            recommended_action=action,
            spread_multiplier=mult,
            tactical_directive=directive,
        )
