r"""High-Frequency Limit Order Book Liquidity Imbalance & Microstructure Drift Engine (Domain 202 / WP-CZ)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Stoikov (2018) micro-price martingale formulation and multi-level depth decay weighting.
2. Level-5 depth liquidity imbalance I_{multi} and order flow imbalance (OFI) integration.
3. Instantaneous quote curve slopes (Slope_{bid}, Slope_{ask}) and slope asymmetry \mathcal{S}_{asym}.
4. Micro-price expected drift forecast \hat{\Delta P}_{\tau} and fair value adjustment g(I, S).
5. Asymmetric quoting skew directives and adverse selection quote cancellation sentry.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class MicroDriftDirection(Enum):
    """Directional expectation of short-horizon mid-price adjustment."""
    STRONG_UPWARD_DRIFT = "STRONG_UPWARD_DRIFT"       # g(I, S) > +0.30 Spread
    MILD_UPWARD_DRIFT = "MILD_UPWARD_DRIFT"           # +0.10 Spread < g(I, S) <= +0.30 Spread
    BALANCED_MARTINGALE = "BALANCED_MARTINGALE"       # -0.10 Spread <= g(I, S) <= +0.10 Spread
    MILD_DOWNWARD_DRIFT = "MILD_DOWNWARD_DRIFT"       # -0.30 Spread <= g(I, S) < -0.10 Spread
    STRONG_DOWNWARD_DRIFT = "STRONG_DOWNWARD_DRIFT"   # g(I, S) < -0.30 Spread


class SkewedQuoteAction(Enum):
    """Market making quote placement posture."""
    LEAN_BID_AGGRESSIVE = "LEAN_BID_AGGRESSIVE"   # Place bid at BBO, widen ask (drift up)
    LEAN_ASK_AGGRESSIVE = "LEAN_ASK_AGGRESSIVE"   # Place ask at BBO, widen bid (drift down)
    SYMMETRIC_INSIDE_SPREAD = "SYMMETRIC_INSIDE_SPREAD" # Post symmetrical quotes
    EMERGENCY_BID_CANCEL = "EMERGENCY_BID_CANCEL" # Cancel resting bids (toxic sell cascade)
    EMERGENCY_ASK_CANCEL = "EMERGENCY_ASK_CANCEL" # Cancel resting asks (toxic buy cascade)


@dataclass
class BookLevel:
    """Individual price and size tier."""
    price: float
    size: float


@dataclass
class L2DepthSnapshot:
    """Full 5-depth limit order book snapshot."""
    timestamp_ms: int
    bids: List[BookLevel]  # Ordered best (highest) to worst (lowest)
    asks: List[BookLevel]  # Ordered best (lowest) to worst (highest)


@dataclass
class MicroDriftAnalysisResult:
    """Quantitative diagnostics of LOB imbalance and micro-price drift."""
    mid_price: float
    spread: float
    top_level_imbalance: float       # I_1 in [-1.0, 1.0]
    multi_level_imbalance: float     # I_multi in [-1.0, 1.0]
    stoikov_micro_price: float       # P* expected fair martingale price
    fair_value_adjustment: float     # g(I, S) = P* - P_mid
    bid_quote_slope: float           # Elasticity of bid book
    ask_quote_slope: float           # Elasticity of ask book
    slope_asymmetry: float           # Relative slope steepness [-1.0, 1.0]
    drift_direction: MicroDriftDirection
    recommended_quote_action: SkewedQuoteAction
    optimal_bid_offset_ticks: int
    optimal_ask_offset_ticks: int


class LOBLiquidityImbalanceDriftEngine:
    r"""High-Frequency Limit Order Book Liquidity Imbalance & Microstructure Drift Engine.
    
    Mathematical Foundations:
    1. Multi-Level Imbalance (Depth Decay Weighting):
       w_k = \exp(-\lambda_{decay} \cdot (k - 1)), \quad k = 1..K
       I_{multi} = \frac{\sum_{k=1}^K w_k (Q_{bid}^k - Q_{ask}^k)}{\sum_{k=1}^K w_k (Q_{bid}^k + Q_{ask}^k)}
    2. Stoikov Micro-Price Martingale:
       P^* = P_{mid} + \frac{S}{2} \cdot \tanh(\alpha_I \cdot I_{multi})
    3. Instantaneous Quote Slope:
       \text{Slope}_{bid} = \frac{\sum_{k=1}^K (P_{bid}^1 - P_{bid}^k)}{\sum_{k=1}^K Q_{bid}^k}
       \text{Slope}_{ask} = \frac{\sum_{k=1}^K (P_{ask}^k - P_{ask}^1)}{\sum_{k=1}^K Q_{ask}^k}
       \mathcal{S}_{asym} = \frac{\text{Slope}_{ask} - \text{Slope}_{bid}}{\text{Slope}_{ask} + \text{Slope}_{bid} + \epsilon}
    """

    def __init__(
        self,
        depth_levels: int = 5,
        decay_factor: float = 0.35,
        alpha_imbalance: float = 1.80,
        tick_size: float = 0.05,
    ) -> None:
        self.depth_levels = depth_levels
        self.decay_factor = decay_factor
        self.alpha_imbalance = alpha_imbalance
        self.tick_size = tick_size

    def calculate_imbalance_and_drift(
        self,
        book: L2DepthSnapshot,
    ) -> MicroDriftAnalysisResult:
        r"""Compute multi-depth weighted imbalance, Stoikov micro-price, and quote slopes."""
        if not book.bids or not book.asks:
            raise ValueError("L2 book must contain at least one bid and one ask tier")

        best_bid = book.bids[0].price
        best_ask = book.asks[0].price
        spread = max(best_ask - best_bid, self.tick_size)
        mid = (best_bid + best_ask) / 2.0

        # Top-level imbalance
        q_b1 = book.bids[0].size
        q_a1 = book.asks[0].size
        top_imb = (q_b1 - q_a1) / max(q_b1 + q_a1, 1e-6)

        # Multi-depth level decay imbalance
        k_levels = min(self.depth_levels, len(book.bids), len(book.asks))
        w_bids_diff = 0.0
        w_total_vol = 0.0

        for k in range(k_levels):
            w = math.exp(-self.decay_factor * k)
            qb = book.bids[k].size
            qa = book.asks[k].size
            w_bids_diff += w * (qb - qa)
            w_total_vol += w * (qb + qa)

        multi_imb = w_bids_diff / max(w_total_vol, 1e-6)
        multi_imb = max(-1.0, min(1.0, multi_imb))

        # Stoikov micro-price adjustment
        # g(I, S) = (S / 2) * tanh(alpha * I_multi)
        drift_adj = (spread / 2.0) * math.tanh(self.alpha_imbalance * multi_imb)
        micro_price = mid + drift_adj

        # Quote slope calculation
        sum_disp_bid = sum(best_bid - book.bids[k].price for k in range(k_levels))
        sum_vol_bid = sum(book.bids[k].size for k in range(k_levels))
        slope_bid = sum_disp_bid / max(sum_vol_bid, 1e-6)

        sum_disp_ask = sum(book.asks[k].price - best_ask for k in range(k_levels))
        sum_vol_ask = sum(book.asks[k].size for k in range(k_levels))
        slope_ask = sum_disp_ask / max(sum_vol_ask, 1e-6)

        slope_asym = (slope_ask - slope_bid) / max(slope_ask + slope_bid, 1e-6)
        slope_asym = max(-1.0, min(1.0, slope_asym))

        # Directional Classification
        spread_ratio = drift_adj / spread
        if spread_ratio > 0.30:
            direction = MicroDriftDirection.STRONG_UPWARD_DRIFT
        elif spread_ratio > 0.10:
            direction = MicroDriftDirection.MILD_UPWARD_DRIFT
        elif spread_ratio < -0.30:
            direction = MicroDriftDirection.STRONG_DOWNWARD_DRIFT
        elif spread_ratio < -0.10:
            direction = MicroDriftDirection.MILD_DOWNWARD_DRIFT
        else:
            direction = MicroDriftDirection.BALANCED_MARTINGALE

        # Tactical Quoting Posture & Adverse Selection Sentry
        if multi_imb < -0.70 and slope_asym < -0.40:
            quote_action = SkewedQuoteAction.EMERGENCY_BID_CANCEL
            bid_offset = 5
            ask_offset = 0
        elif multi_imb > 0.70 and slope_asym > 0.40:
            quote_action = SkewedQuoteAction.EMERGENCY_ASK_CANCEL
            bid_offset = 0
            ask_offset = 5
        elif direction in (MicroDriftDirection.STRONG_UPWARD_DRIFT, MicroDriftDirection.MILD_UPWARD_DRIFT):
            quote_action = SkewedQuoteAction.LEAN_BID_AGGRESSIVE
            bid_offset = 0   # Tight at BBO
            ask_offset = 2   # Widen ask to capture upside drift
        elif direction in (MicroDriftDirection.STRONG_DOWNWARD_DRIFT, MicroDriftDirection.MILD_DOWNWARD_DRIFT):
            quote_action = SkewedQuoteAction.LEAN_ASK_AGGRESSIVE
            bid_offset = 2   # Widen bid to protect against drop
            ask_offset = 0   # Tight at BBO
        else:
            quote_action = SkewedQuoteAction.SYMMETRIC_INSIDE_SPREAD
            bid_offset = 1
            ask_offset = 1

        return MicroDriftAnalysisResult(
            mid_price=round(mid, 4),
            spread=round(spread, 4),
            top_level_imbalance=round(top_imb, 4),
            multi_level_imbalance=round(multi_imb, 4),
            stoikov_micro_price=round(micro_price, 4),
            fair_value_adjustment=round(drift_adj, 4),
            bid_quote_slope=round(slope_bid, 6),
            ask_quote_slope=round(slope_ask, 6),
            slope_asymmetry=round(slope_asym, 4),
            drift_direction=direction,
            recommended_quote_action=quote_action,
            optimal_bid_offset_ticks=bid_offset,
            optimal_ask_offset_ticks=ask_offset,
        )
