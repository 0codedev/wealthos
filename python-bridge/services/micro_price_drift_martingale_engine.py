r"""Multi-Venue Limit Order Book Depth Imbalance & Micro-Price Drift Martingale Engine (Domain 223 / WP-DU)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Stoikov (2018) Micro-Price Martingale formulation P^* = P_{mid} + \frac{S}{2} \tanh(\alpha \cdot I_{multi}).
2. Multi-tier exponentially decayed depth imbalance tensor I_{multi} across L2/L3 tiers.
3. Order book quote elasticity slope asymmetry \mathcal{S}_{asym} across bid and ask book shapes.
4. Micro-price drift predictive alpha classifier and dynamic quote shading sentry.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class MicroPriceRegime(Enum):
    """Classification of order book micro-price drift expectation."""
    BALANCED_MARTINGALE = "BALANCED_MARTINGALE"           # |P* - P_mid| <= 0.15 * Spread
    BULLISH_UPWARD_DRIFT = "BULLISH_UPWARD_DRIFT"         # P* - P_mid > 0.15 * Spread
    BEARISH_DOWNWARD_DRIFT = "BEARISH_DOWNWARD_DRIFT"     # P* - P_mid < -0.15 * Spread
    ACUTE_LEVEL_COLLAPSE = "ACUTE_LEVEL_COLLAPSE"         # |I_multi| >= 0.75, extreme book imbalance


class MicroPriceAction(Enum):
    """Tactical quoting posture based on micro-price martingale drift."""
    MAINTAIN_SYMMETRIC_QUOTES = "MAINTAIN_SYMMETRIC_QUOTES"
    SKEW_AGGRESSIVE_BID = "SKEW_AGGRESSIVE_BID"           # Shade quote upward toward micro-price
    SKEW_AGGRESSIVE_ASK = "SKEW_AGGRESSIVE_ASK"           # Shade quote downward toward micro-price
    SWEEP_OR_EVACUATE = "SWEEP_OR_EVACUATE"               # Evacuate thin side, sweep heavy side


@dataclass
class BookTier:
    """Individual depth level."""
    price: float
    volume: float


@dataclass
class MicroPriceDiagnosticsResult:
    """Full quantitative diagnostics for Stoikov micro-price martingale drift."""
    symbol: str
    mid_price: float
    weighted_mid_price: float
    stoikov_micro_price: float
    micro_price_drift_bps: float
    level_1_imbalance: float
    multi_tier_imbalance: float
    bid_depth_slope: float
    ask_depth_slope: float
    slope_asymmetry: float
    regime: MicroPriceRegime
    recommended_action: MicroPriceAction
    optimal_bid_quote: float
    optimal_ask_quote: float
    tactical_directive: str


class MicroPriceDriftMartingaleEngine:
    r"""Stoikov (2018) Micro-Price Martingale Engine.
    
    Mathematical Formulation:
    1. Multi-Tier Imbalance:
       Q_b^{decay} = \sum_{m=1}^M Q_b^{(m)} e^{-\lambda (m - 1)}
       Q_a^{decay} = \sum_{m=1}^M Q_a^{(m)} e^{-\lambda (m - 1)}
       I_{multi} = \frac{Q_b^{decay} - Q_a^{decay}}{Q_b^{decay} + Q_a^{decay}}
       
    2. Stoikov Micro-Price Martingale:
       P^* = P_{mid} + \frac{S}{2} \cdot \tanh(\alpha \cdot I_{multi})
       
    3. Quote Elasticity Slopes:
       \mathcal{S}_b = \frac{Q_b^{(M)} - Q_b^{(1)}}{M - 1}, \quad \mathcal{S}_a = \frac{Q_a^{(M)} - Q_a^{(1)}}{M - 1}
       \mathcal{S}_{asym} = \frac{\mathcal{S}_b - \mathcal{S}_a}{\mathcal{S}_b + \mathcal{S}_a + 1e-5}
    """

    def __init__(
        self,
        decay_lambda: float = 0.35,
        alpha_sensitivity: float = 1.60,
        drift_threshold_ratio: float = 0.15, # 15% of spread
    ) -> None:
        self.decay_lambda = decay_lambda
        self.alpha = alpha_sensitivity
        self.drift_thresh_ratio = drift_threshold_ratio

    def evaluate_micro_price(
        self,
        symbol: str,
        bids: List[BookTier],
        asks: List[BookTier],
    ) -> MicroPriceDiagnosticsResult:
        """Compute Stoikov micro-price, multi-level imbalance, and quoting directives."""
        if not bids or not asks:
            return MicroPriceDiagnosticsResult(
                symbol=symbol, mid_price=0.0, weighted_mid_price=0.0, stoikov_micro_price=0.0,
                micro_price_drift_bps=0.0, level_1_imbalance=0.0, multi_tier_imbalance=0.0,
                bid_depth_slope=0.0, ask_depth_slope=0.0, slope_asymmetry=0.0,
                regime=MicroPriceRegime.BALANCED_MARTINGALE,
                recommended_action=MicroPriceAction.MAINTAIN_SYMMETRIC_QUOTES,
                optimal_bid_quote=0.0, optimal_ask_quote=0.0,
                tactical_directive="Insufficient book depth.",
            )

        best_bid = bids[0].price
        best_ask = asks[0].price
        mid = 0.5 * (best_bid + best_ask)
        spread = max(1e-4, best_ask - best_bid)

        # Level 1 Imbalance
        q_b1 = bids[0].volume
        q_a1 = asks[0].volume
        imb_1 = (q_b1 - q_a1) / max(q_b1 + q_a1, 1.0)
        weighted_mid = (q_b1 * best_ask + q_a1 * best_bid) / max(q_b1 + q_a1, 1.0)

        # Multi-level exponential depth
        m_levels = min(len(bids), len(asks), 5)
        qb_decay = sum(bids[m].volume * math.exp(-self.decay_lambda * m) for m in range(m_levels))
        qa_decay = sum(asks[m].volume * math.exp(-self.decay_lambda * m) for m in range(m_levels))
        imb_multi = (qb_decay - qa_decay) / max(qb_decay + qa_decay, 1.0)

        # Stoikov micro-price martingale
        micro_price = mid + (spread / 2.0) * math.tanh(self.alpha * imb_multi)
        drift_bps = ((micro_price - mid) / mid) * 10000.0

        # Slopes
        if m_levels > 1:
            slope_b = (bids[m_levels - 1].volume - bids[0].volume) / (m_levels - 1)
            slope_a = (asks[m_levels - 1].volume - asks[0].volume) / (m_levels - 1)
            slope_asym = (slope_b - slope_a) / max(abs(slope_b) + abs(slope_a), 1e-4)
        else:
            slope_b = 0.0
            slope_a = 0.0
            slope_asym = 0.0

        drift_dist = micro_price - mid
        drift_limit = spread * self.drift_thresh_ratio

        # Optimal quotes centered around micro-price rather than raw mid
        half_s = spread / 2.0
        opt_bid = round(micro_price - half_s, 2)
        opt_ask = round(micro_price + half_s, 2)

        # Regimes & Decisions
        if abs(imb_multi) >= 0.75:
            regime = MicroPriceRegime.ACUTE_LEVEL_COLLAPSE
            action = MicroPriceAction.SWEEP_OR_EVACUATE
            side = "BID" if imb_multi > 0 else "ASK"
            directive = (
                f"ACUTE LEVEL COLLAPSE: Extreme {side} imbalance ({imb_multi:+.1%}). "
                f"Micro-price shifted {drift_bps:+.2f} bps. Evacuate resting quotes on weak side!"
            )
        elif drift_dist > drift_limit:
            regime = MicroPriceRegime.BULLISH_UPWARD_DRIFT
            action = MicroPriceAction.SKEW_AGGRESSIVE_BID
            directive = (
                f"BULLISH DRIFT: Micro-price P* = {micro_price:.2f} above mid {mid:.2f} (+{drift_bps:.2f} bps). "
                f"Imbalance: {imb_multi:+.1%}. Skew bid higher to {opt_bid:.2f}."
            )
        elif drift_dist < -drift_limit:
            regime = MicroPriceRegime.BEARISH_DOWNWARD_DRIFT
            action = MicroPriceAction.SKEW_AGGRESSIVE_ASK
            directive = (
                f"BEARISH DRIFT: Micro-price P* = {micro_price:.2f} below mid {mid:.2f} ({drift_bps:.2f} bps). "
                f"Imbalance: {imb_multi:+.1%}. Skew ask lower to {opt_ask:.2f}."
            )
        else:
            regime = MicroPriceRegime.BALANCED_MARTINGALE
            action = MicroPriceAction.MAINTAIN_SYMMETRIC_QUOTES
            directive = (
                f"BALANCED MARTINGALE: P* = {micro_price:.2f} near mid {mid:.2f} (Drift: {drift_bps:+.2f} bps). "
                f"Maintain symmetric quotes around touch."
            )

        return MicroPriceDiagnosticsResult(
            symbol=symbol,
            mid_price=round(mid, 2),
            weighted_mid_price=round(weighted_mid, 2),
            stoikov_micro_price=round(micro_price, 2),
            micro_price_drift_bps=round(drift_bps, 2),
            level_1_imbalance=round(imb_1, 4),
            multi_tier_imbalance=round(imb_multi, 4),
            bid_depth_slope=round(slope_b, 2),
            ask_depth_slope=round(slope_a, 2),
            slope_asymmetry=round(slope_asym, 4),
            regime=regime,
            recommended_action=action,
            optimal_bid_quote=opt_bid,
            optimal_ask_quote=opt_ask,
            tactical_directive=directive,
        )
