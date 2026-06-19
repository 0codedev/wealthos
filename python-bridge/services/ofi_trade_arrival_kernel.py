r"""Real-Time High-Frequency Order Flow Imbalance (OFI) & Trade Arrival Kernel (Domain 213 / WP-DK)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Multi-level Cont-Kukanov-Stoikov (2014) Order Flow Imbalance (OFI) tensor across LOB price tiers.
2. Microstructure price impact regression \Delta P = \beta \cdot OFI + \epsilon.
3. OFI-modulated non-homogeneous Poisson trade arrival intensity (\lambda_{buy}, \lambda_{sell}).
4. Real-time micro-price drift and tactical quote placement alpha classifier.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class OFIAlphaRegime(Enum):
    """Regime classification based on order flow imbalance intensity."""
    NEUTRAL_EQUILIBRIUM = "NEUTRAL_EQUILIBRIUM"         # Balanced two-sided order updates
    BULLISH_FLOW_ACCUMULATION = "BULLISH_FLOW_ACCUMULATION" # Strong net bid volume addition / ask cancellations
    BEARISH_FLOW_DISTRIBUTION = "BEARISH_FLOW_DISTRIBUTION" # Strong net ask volume addition / bid cancellations
    TSUNAMI_IMBALANCE_SPIKE = "TSUNAMI_IMBALANCE_SPIKE" # Extreme one-sided imbalance, imminent level sweep


class OFITacticalDirective(Enum):
    """Tactical execution response for OFI signals."""
    MAINTAIN_PASSIVE_SPREAD = "MAINTAIN_PASSIVE_SPREAD"
    POST_AGGRESSIVE_BID_JOIN = "POST_AGGRESSIVE_BID_JOIN"
    POST_AGGRESSIVE_ASK_JOIN = "POST_AGGRESSIVE_ASK_JOIN"
    MARKET_ORDER_SURGE_FOLLOW = "MARKET_ORDER_SURGE_FOLLOW"


@dataclass
class LOBLevel:
    """Price and size at a specific order book depth tier."""
    price: float
    size: float


@dataclass
class LOBTopBookSnapshot:
    """Snapshot of top M levels for both bid and ask sides."""
    timestamp_ms: float
    bids: List[LOBLevel]               # Level 1 to M, ordered highest to lowest price
    asks: List[LOBLevel]               # Level 1 to M, ordered lowest to highest price


@dataclass
class OFIDiagnosticsResult:
    """Multi-tier OFI metrics, trade arrival rates, and predicted price drift."""
    symbol: str
    level_1_ofi_shares: float
    multi_tier_ofi_shares: float
    normalized_ofi_ratio: float        # In [-1.0, +1.0]
    expected_price_drift_bps: float
    buy_arrival_intensity_trades_sec: float
    sell_arrival_intensity_trades_sec: float
    alpha_regime: OFIAlphaRegime
    tactical_directive: OFITacticalDirective
    operational_narrative: str


class OFITradeArrivalKernel:
    r"""Cont-Kukanov-Stoikov (2014) Multi-Level OFI & Arrival Kernel.
    
    Mathematical Formulation:
    Level 1 Bid Flow:
    \Delta Q_b = \begin{cases}
       Q_n^{(b)} & \text{if } P_n^{(b)} > P_{n-1}^{(b)} \\
       Q_n^{(b)} - Q_{n-1}^{(b)} & \text{if } P_n^{(b)} = P_{n-1}^{(b)} \\
       -Q_{n-1}^{(b)} & \text{if } P_n^{(b)} < P_{n-1}^{(b)}
    \end{cases}
    
    Level 1 Ask Flow:
    \Delta Q_a = \begin{cases}
       -Q_n^{(a)} & \text{if } P_n^{(a)} > P_{n-1}^{(a)} \\
       Q_n^{(a)} - Q_{n-1}^{(a)} & \text{if } P_n^{(a)} = P_{n-1}^{(a)} \\
       Q_{n-1}^{(a)} & \text{if } P_n^{(a)} < P_{n-1}^{(a)}
    \end{cases}
    
    OFI_1 = \Delta Q_b - \Delta Q_a
    OFI_{multi} = \sum_{m=1}^M \exp(-\gamma(m - 1)) OFI_m
    """

    def __init__(
        self,
        decay_gamma: float = 0.40,
        beta_impact_bps_per_100_shares: float = 0.15,
        base_arrival_rate: float = 5.0, # Trades/sec
        arrival_sensitivity_kappa: float = 1.80,
    ) -> None:
        self.decay_gamma = decay_gamma
        self.beta_impact = beta_impact_bps_per_100_shares
        self.base_arrival_rate = base_arrival_rate
        self.kappa = arrival_sensitivity_kappa

    @staticmethod
    def _compute_single_level_bid_delta(curr: LOBLevel, prev: LOBLevel) -> float:
        if curr.price > prev.price:
            return curr.size
        elif curr.price == prev.price:
            return curr.size - prev.size
        else:
            return -prev.size

    @staticmethod
    def _compute_single_level_ask_delta(curr: LOBLevel, prev: LOBLevel) -> float:
        if curr.price > prev.price:
            return -curr.size
        elif curr.price == prev.price:
            return curr.size - prev.size
        else:
            return prev.size

    def calculate_multi_level_ofi(
        self,
        curr_snap: LOBTopBookSnapshot,
        prev_snap: LOBTopBookSnapshot,
    ) -> Tuple[float, float, float]:
        """Compute Level-1 OFI, multi-level weighted OFI, and normalized ratio."""
        if not curr_snap.bids or not curr_snap.asks or not prev_snap.bids or not prev_snap.asks:
            return 0.0, 0.0, 0.0

        # Level 1 OFI
        delta_b1 = self._compute_single_level_bid_delta(curr_snap.bids[0], prev_snap.bids[0])
        delta_a1 = self._compute_single_level_ask_delta(curr_snap.asks[0], prev_snap.asks[0])
        ofi_1 = delta_b1 - delta_a1

        # Multi-tier weighted OFI
        m_levels = min(len(curr_snap.bids), len(curr_snap.asks), len(prev_snap.bids), len(prev_snap.asks))
        weighted_ofi_sum = 0.0
        total_depth_sum = 0.0

        for m in range(m_levels):
            w = math.exp(-self.decay_gamma * m)
            db = self._compute_single_level_bid_delta(curr_snap.bids[m], prev_snap.bids[m])
            da = self._compute_single_level_ask_delta(curr_snap.asks[m], prev_snap.asks[m])
            level_ofi = db - da
            weighted_ofi_sum += w * level_ofi
            total_depth_sum += w * (curr_snap.bids[m].size + curr_snap.asks[m].size)

        norm_ratio = weighted_ofi_sum / max(total_depth_sum, 1.0)
        norm_ratio = max(-1.0, min(1.0, norm_ratio))

        return round(ofi_1, 2), round(weighted_ofi_sum, 2), round(norm_ratio, 4)

    def evaluate_ofi_kernel(
        self,
        symbol: str,
        curr_snap: LOBTopBookSnapshot,
        prev_snap: LOBTopBookSnapshot,
    ) -> OFIDiagnosticsResult:
        """Run complete OFI evaluation, price impact prediction, and trade arrival intensities."""
        ofi_1, ofi_multi, norm_ratio = self.calculate_multi_level_ofi(curr_snap, prev_snap)

        # Expected micro-price drift in bps: beta * (OFI / 100)
        drift_bps = self.beta_impact * (ofi_multi / 100.0)

        # Modulated Poisson arrival rates
        lambda_buy = self.base_arrival_rate * math.exp(self.kappa * norm_ratio)
        lambda_sell = self.base_arrival_rate * math.exp(-self.kappa * norm_ratio)

        # Regime & Directives
        if abs(norm_ratio) >= 0.60:
            regime = OFIAlphaRegime.TSUNAMI_IMBALANCE_SPIKE
            directive = OFITacticalDirective.MARKET_ORDER_SURGE_FOLLOW
            side = "BUY" if norm_ratio > 0 else "SELL"
            narrative = (
                f"TSUNAMI OFI SPIKE: Extreme {side} imbalance ({norm_ratio:+.1%}). "
                f"Multi-tier OFI: {ofi_multi:+.0f} shares. Imminent level sweep! Follow with market sweep."
            )
        elif norm_ratio > 0.15:
            regime = OFIAlphaRegime.BULLISH_FLOW_ACCUMULATION
            directive = OFITacticalDirective.POST_AGGRESSIVE_BID_JOIN
            narrative = (
                f"BULLISH ACCUMULATION: Net buy flow imbalance ({norm_ratio:+.1%}). "
                f"Expected drift: +{drift_bps:.2f} bps. Post aggressive bid inside spread."
            )
        elif norm_ratio < -0.15:
            regime = OFIAlphaRegime.BEARISH_FLOW_DISTRIBUTION
            directive = OFITacticalDirective.POST_AGGRESSIVE_ASK_JOIN
            narrative = (
                f"BEARISH DISTRIBUTION: Net sell flow imbalance ({norm_ratio:+.1%}). "
                f"Expected drift: {drift_bps:.2f} bps. Post aggressive ask inside spread."
            )
        else:
            regime = OFIAlphaRegime.NEUTRAL_EQUILIBRIUM
            directive = OFITacticalDirective.MAINTAIN_PASSIVE_SPREAD
            narrative = (
                f"NEUTRAL EQUILIBRIUM: Order flow balanced ({norm_ratio:+.1%}). "
                f"Maintain symmetric passive quoting around mid-price."
            )

        return OFIDiagnosticsResult(
            symbol=symbol,
            level_1_ofi_shares=ofi_1,
            multi_tier_ofi_shares=ofi_multi,
            normalized_ofi_ratio=norm_ratio,
            expected_price_drift_bps=round(drift_bps, 3),
            buy_arrival_intensity_trades_sec=round(lambda_buy, 2),
            sell_arrival_intensity_trades_sec=round(lambda_sell, 2),
            alpha_regime=regime,
            tactical_directive=directive,
            operational_narrative=narrative,
        )
