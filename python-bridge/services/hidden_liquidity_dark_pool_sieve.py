r"""High-Frequency Limit Order Book Hidden Liquidity Dark Pool Sieve (Domain 198 / WP-CV)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Native hidden liquidity & non-display iceberg inference from L2 book replenishment
   and high-volume trade-through prints without price concession.
2. Dark venue execution fill probability model (logistic hazard as a function of order size,
   order flow imbalance (OFI), and intraday volatility).
3. Kratz-Schoneborn (2014) optimal dark-lit tranche routing scheduler:
   Minimizing combined market impact, non-execution risk, and adverse selection delay.
4. Institutional liquidity cushion detection: Hidden-to-visible ratio sieve for
   large-scale block absorption identification.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class VenueType(Enum):
    """Execution venue categorization."""
    LIT_EXCHANGE = "LIT_EXCHANGE"       # Transparent central limit order book (e.g. NSE, BSE)
    DARK_POOL = "DARK_POOL"             # Non-display crossing network / midpoint match
    INTERNALIZER = "INTERNALIZER"       # Retail wholesale / OTC bilateral liquidity provider


class LiquidityCushionRegime(Enum):
    """State of hidden liquidity presence at market boundary."""
    TRANSPARENT_ONLY = "TRANSPARENT_ONLY"       # Hidden ratio < 0.25 (pure display depth)
    MODERATE_HIDDEN = "MODERATE_HIDDEN"         # 0.25 <= Hidden ratio < 1.50
    HEAVY_ICEBERG = "HEAVY_ICEBERG"             # 1.50 <= Hidden ratio < 4.00
    INSTITUTIONAL_WALL = "INSTITUTIONAL_WALL"   # Hidden ratio >= 4.00 (massive dark cushion)


@dataclass
class TradePrint:
    """Individual trade execution tick."""
    timestamp_ms: int
    price: float
    size: float
    taker_side: str  # "BUY" or "SELL"


@dataclass
class QuoteState:
    """L2 Best Bid/Ask quote snapshot."""
    timestamp_ms: int
    bid_price: float
    bid_size: float
    ask_price: float
    ask_size: float


@dataclass
class HiddenLiquidityEstimate:
    """Inferred non-display liquidity metrics at a specific price tier."""
    price: float
    side: str                        # "BID" or "ASK"
    visible_size: float
    executed_volume: float
    inferred_hidden_volume: float
    hidden_to_visible_ratio: float
    replenishment_count: int
    cushion_regime: LiquidityCushionRegime


@dataclass
class DarkRoutingAllocation:
    """Optimal order routing division between lit and dark venues."""
    total_order_size: float
    dark_tranche_size: float
    lit_tranche_size: float
    dark_fill_probability: float
    expected_lit_impact_bps: float
    expected_adverse_selection_bps: float
    total_expected_shortfall_bps: float
    recommended_venue_sequence: List[str]


class HiddenLiquidityDarkPoolSieve:
    r"""High-Frequency Limit Order Book Hidden Liquidity & Dark Pool Sieve.
    
    Mathematical Mechanics:
    1. Hidden Liquidity Reconstruction:
       When trade volume V_{exec} executes at best quote p without price level exhaustion:
       \Delta Q_{vis} = \max(0, Q_{vis}(t_0) - Q_{vis}(t))
       \hat{Q}_{hidden} = \max(0, V_{exec} - \Delta Q_{vis})
    2. Dark Fill Hazard Rate:
       \mathcal{P}_{dark}(q) = \frac{1}{1 + \exp\left( \alpha_0 + \alpha_1 \frac{q}{\text{Depth}_{avg}} - \alpha_2 \text{OFI} \right)}
    3. Optimal Split q_{dark}^* \in [0, Q]:
       Minimizes \mathcal{C}(q_{dark}) = q_{lit} I_{lit}(q_{lit}) + \mathcal{P}_{dark} q_{dark} C_{dark} + (1-\mathcal{P}_{dark}) q_{dark} [I_{lit}(Q) + Delay]
    """

    def __init__(
        self,
        alpha_0: float = 0.20,
        alpha_1: float = 1.80,
        alpha_2: float = 0.50,
        dark_fee_rebate_bps: float = 0.5,
        lit_base_spread_bps: float = 2.0,
    ) -> None:
        self.alpha_0 = alpha_0
        self.alpha_1 = alpha_1
        self.alpha_2 = alpha_2
        self.dark_fee_rebate_bps = dark_fee_rebate_bps
        self.lit_base_spread_bps = lit_base_spread_bps

    def detect_hidden_liquidity(
        self,
        initial_quote: QuoteState,
        final_quote: QuoteState,
        trades: List[TradePrint],
        side: str = "BID",
    ) -> HiddenLiquidityEstimate:
        r"""Infer hidden non-display volume replenished or absorbed during a trading burst.
        
        Args:
            initial_quote: Pre-burst quote state.
            final_quote: Post-burst quote state.
            trades: List of executed trades within the interval.
            side: "BID" (resting buy liquidity) or "ASK" (resting sell liquidity).
        """
        if side.upper() == "BID":
            price = initial_quote.bid_price
            vis_start = initial_quote.bid_size
            vis_end = final_quote.bid_size if abs(final_quote.bid_price - price) < 1e-5 else 0.0
            # Trades hitting the bid are taker SELLs
            relevant_trades = [t for t in trades if abs(t.price - price) < 1e-4 and t.taker_side.upper() == "SELL"]
        else:
            price = initial_quote.ask_price
            vis_start = initial_quote.ask_size
            vis_end = final_quote.ask_size if abs(final_quote.ask_price - price) < 1e-5 else 0.0
            # Trades hitting the ask are taker BUYs
            relevant_trades = [t for t in trades if abs(t.price - price) < 1e-4 and t.taker_side.upper() == "BUY"]

        total_exec = sum(t.size for t in relevant_trades)
        expected_vis_depletion = max(0.0, vis_start - vis_end)

        # Inferred hidden volume is executed volume exceeding expected visible drop
        inferred_hidden = max(0.0, total_exec - expected_vis_depletion)
        
        # If quote maintained or grew despite executions, every refill is added hidden flow
        replenishments = 0
        if relevant_trades and vis_end >= vis_start:
            replenishments = max(1, len(relevant_trades))
        elif inferred_hidden > 0:
            replenishments = max(1, int(math.ceil(inferred_hidden / max(vis_start, 1.0))))

        ratio = (inferred_hidden / max(vis_start, 1.0))

        # Classify regime
        if ratio < 0.25:
            regime = LiquidityCushionRegime.TRANSPARENT_ONLY
        elif ratio < 1.50:
            regime = LiquidityCushionRegime.MODERATE_HIDDEN
        elif ratio < 4.00:
            regime = LiquidityCushionRegime.HEAVY_ICEBERG
        else:
            regime = LiquidityCushionRegime.INSTITUTIONAL_WALL

        return HiddenLiquidityEstimate(
            price=price,
            side=side.upper(),
            visible_size=vis_start,
            executed_volume=round(total_exec, 3),
            inferred_hidden_volume=round(inferred_hidden, 3),
            hidden_to_visible_ratio=round(ratio, 3),
            replenishment_count=replenishments,
            cushion_regime=regime,
        )

    def calculate_dark_fill_probability(
        self,
        order_size: float,
        avg_depth: float,
        order_flow_imbalance: float = 0.0,
    ) -> float:
        r"""Compute empirical logistic probability of full execution in dark pool / crossing network:
        
        \mathcal{P} = \frac{1}{1 + \exp(\alpha_0 + \alpha_1 (q / D) - \alpha_2 \text{OFI})}
        """
        size_ratio = order_size / max(avg_depth, 1.0)
        z = self.alpha_0 + self.alpha_1 * size_ratio - self.alpha_2 * order_flow_imbalance
        # Sigmoid clamping
        z = max(-10.0, min(10.0, z))
        prob = 1.0 / (1.0 + math.exp(z))
        return round(prob, 4)

    def optimize_dark_lit_routing(
        self,
        total_order_size: float,
        avg_market_depth: float,
        order_flow_imbalance: float = 0.0,
        lit_daily_volatility: float = 0.015,
    ) -> DarkRoutingAllocation:
        r"""Determine optimal dark vs lit tranche allocation minimizing expected execution shortfall.
        
        Cost Components:
        - Lit Permanent Impact: I_{lit}(q_{lit}) = 10000 * 0.5 * \sigma * \sqrt{q_{lit} / ADV}
        - Dark Execution Cost: dark_fee_rebate (e.g. 0.5 bps)
        - Adverse Selection Penalty on Unfilled Dark Tranche:
          When dark tranche fails, it must be dumped into lit with delay penalty.
        """
        adv = max(avg_market_depth * 100.0, 1000.0)
        steps = 50
        best_dark_q = 0.0
        min_shortfall = float("inf")
        best_p_fill = 0.0
        best_lit_impact_bps = 0.0
        best_adverse_bps = 0.0

        for s in range(steps + 1):
            q_dark = (s / steps) * total_order_size
            q_lit = total_order_size - q_dark

            p_fill_dark = self.calculate_dark_fill_probability(
                order_size=q_dark,
                avg_depth=avg_market_depth,
                order_flow_imbalance=order_flow_imbalance,
            )

            # Lit market impact in basis points
            lit_impact_bps = 10000.0 * 0.5 * lit_daily_volatility * math.sqrt(max(q_lit, 0.0) / adv)
            full_dump_impact_bps = 10000.0 * 0.5 * lit_daily_volatility * math.sqrt(total_order_size / adv)
            delay_penalty_bps = self.lit_base_spread_bps * 0.5

            # Expected cost in bps
            cost_lit = (q_lit / total_order_size) * (self.lit_base_spread_bps + lit_impact_bps)
            cost_dark_filled = p_fill_dark * (q_dark / total_order_size) * self.dark_fee_rebate_bps
            cost_dark_unfilled = (1.0 - p_fill_dark) * (q_dark / total_order_size) * (
                full_dump_impact_bps + delay_penalty_bps + self.lit_base_spread_bps
            )

            total_cost_bps = cost_lit + cost_dark_filled + cost_dark_unfilled

            if total_cost_bps < min_shortfall:
                min_shortfall = total_cost_bps
                best_dark_q = q_dark
                best_p_fill = p_fill_dark
                best_lit_impact_bps = lit_impact_bps
                best_adverse_bps = (1.0 - p_fill_dark) * (full_dump_impact_bps + delay_penalty_bps)

        best_lit_q = round(total_order_size - best_dark_q, 3)
        best_dark_q = round(best_dark_q, 3)

        # Venue routing sequence recommendation
        if best_dark_q > 0.1 * total_order_size:
            sequence = ["PING_DARK_MIDPOINT", "FALLBACK_LIT_IOC", "RESTING_PASSIVE_LIT"]
        else:
            sequence = ["DIRECT_LIT_TWAP", "RESTING_PASSIVE_LIT"]

        return DarkRoutingAllocation(
            total_order_size=total_order_size,
            dark_tranche_size=best_dark_q,
            lit_tranche_size=best_lit_q,
            dark_fill_probability=best_p_fill,
            expected_lit_impact_bps=round(best_lit_impact_bps, 3),
            expected_adverse_selection_bps=round(best_adverse_bps, 3),
            total_expected_shortfall_bps=round(min_shortfall, 3),
            recommended_venue_sequence=sequence,
        )

    def evaluate_cushion_support_resistance(
        self,
        bids_estimates: List[HiddenLiquidityEstimate],
        asks_estimates: List[HiddenLiquidityEstimate],
    ) -> Dict[str, Any]:
        """Aggregate multi-level hidden liquidity estimates to determine structural institutional cushions."""
        total_hidden_bids = sum(e.inferred_hidden_volume for e in bids_estimates)
        total_hidden_asks = sum(e.inferred_hidden_volume for e in asks_estimates)
        total_vis_bids = sum(e.visible_size for e in bids_estimates)
        total_vis_asks = sum(e.visible_size for e in asks_estimates)

        bid_cushion_ratio = (total_hidden_bids / max(total_vis_bids, 1.0))
        ask_cushion_ratio = (total_hidden_asks / max(total_vis_asks, 1.0))

        # Determine dominant institutional accumulation side
        if total_hidden_bids > total_hidden_asks * 1.5:
            bias = "INSTITUTIONAL_ACCUMULATION_BID"
            defense_directive = "Favor long fills; strong hidden bid cushion absorbs sell-side sweeps."
        elif total_hidden_asks > total_hidden_bids * 1.5:
            bias = "INSTITUTIONAL_DISTRIBUTION_ASK"
            defense_directive = "Avoid long breakout; massive hidden ask iceberg caps upward momentum."
        else:
            bias = "BALANCED_OR_TRANSPARENT"
            defense_directive = "Standard lit market routing; symmetrical hidden liquidity footprint."

        return {
            "bias": bias,
            "total_hidden_bids": round(total_hidden_bids, 2),
            "total_hidden_asks": round(total_hidden_asks, 2),
            "bid_cushion_ratio": round(bid_cushion_ratio, 3),
            "ask_cushion_ratio": round(ask_cushion_ratio, 3),
            "directive": defense_directive,
        }
