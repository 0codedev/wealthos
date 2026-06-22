"""
Intraday Volume-Weighted Bid-Ask Spread Resiliency & Market Maker Inventory Damping Kernel
Domain 252 / Work Package WP-EX

Calculates post-sweep bid-ask spread resiliency decay, solves Avellaneda-Stoikov
inventory indifference reservation pricing, and calibrates dynamic asymmetric quote shading
to protect high-frequency market makers from toxic order flow and adverse inventory drift.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class MarketMakerRegime(str, Enum):
    NOMINAL_SYMMETRIC_MAKING = "NOMINAL_SYMMETRIC_MAKING"              # Inventory balanced, spread fully recovered
    INVENTORY_SKEWED_OFFLOAD = "INVENTORY_SKEWED_OFFLOAD"              # Inventory imbalanced, quote shading to attract offload flow
    POST_SWEEP_RESILIENCY_DEFENSE = "POST_SWEEP_RESILIENCY_DEFENSE"    # Spread lingering wide post-sweep, quote buffer active
    MAX_INVENTORY_CIRCUIT_HALT = "MAX_INVENTORY_CIRCUIT_HALT"          # Inventory at hard boundary, one-sided quote pull


class QuoteAdjustmentDirective(str, Enum):
    MAINTAIN_BALANCED_TWO_SIDED = "MAINTAIN_BALANCED_TWO_SIDED"        # Post standard symmetric two-sided market
    SHADE_PRICES_TOWARDS_OFFLOAD = "SHADE_PRICES_TOWARDS_OFFLOAD"      # Skew bid/ask down (if long) or up (if short)
    WIDEN_RESILIENCY_BUFFER = "WIDEN_RESILIENCY_BUFFER"                # Widen quotes by post-sweep decay premium
    ONE_SIDED_EMERGENCY_PULL = "ONE_SIDED_EMERGENCY_PULL"              # Pull quote on building side; quote only offload side


@dataclass
class MarketMakerParameters:
    risk_aversion_gamma: float = 0.1          # Inventory risk aversion coefficient gamma
    asset_volatility_sigma: float = 0.02      # Per-second asset price volatility sigma
    order_arrival_intensity_kappa: float = 1.5# Poisson liquidity consumption intensity kappa
    resiliency_decay_lambda: float = 2.5      # Exponential spread decay rate (sec^-1)
    target_inventory: float = 0.0             # Optimal inventory level
    inventory_warning_threshold: float = 5.0  # Threshold to begin aggressive shading
    max_inventory_limit: float = 10.0         # Hard risk circuit boundary
    time_horizon_seconds: float = 60.0        # Trading session horizon (T - t)


@dataclass
class OrderBookSweepSnapshot:
    symbol: str
    mid_price: float
    baseline_spread: float                    # Nominal unshocked spread (e.g. 0.05)
    current_spread: float                     # Observed spread post-sweep (e.g. 0.20)
    seconds_since_sweep: float                # Time elapsed since aggressive sweep
    current_inventory: float                  # Current position q (positive = long, negative = short)


@dataclass
class OptimalQuoteProfile:
    symbol: str
    reservation_price: float
    optimal_bid_price: float
    optimal_ask_price: float
    bid_distance: float
    ask_distance: float
    total_spread: float
    resiliency_spread_premium: float
    inventory_skew_offset: float
    regime: MarketMakerRegime
    directive: QuoteAdjustmentDirective
    rationales: List[str] = field(default_factory=list)


class SpreadResiliencyInventoryKernel:
    """
    Solves optimal Avellaneda-Stoikov reservation prices coupled with post-sweep spread resiliency decay.
    """

    def __init__(self, params: Optional[MarketMakerParameters] = None):
        self.params = params or MarketMakerParameters()

    def calculate_resiliency_spread(
        self, baseline_spread: float, current_spread: float, elapsed_sec: float
    ) -> Tuple[float, float]:
        """
        Computes expected spread under exponential decay model:
        S(t) = S_baseline + max(0, S_shock - S_baseline) * exp(-lambda * t)
        Returns: (expected_spread, excess_spread_premium)
        """
        shock_excess = max(0.0, current_spread - baseline_spread)
        decay_factor = math.exp(-self.params.resiliency_decay_lambda * max(0.0, elapsed_sec))
        premium = shock_excess * decay_factor
        expected_spread = baseline_spread + premium
        return expected_spread, premium

    def calculate_reservation_price(
        self, mid_price: float, inventory: float, time_horizon: float
    ) -> Tuple[float, float]:
        """
        Computes Avellaneda-Stoikov reservation price:
        r(s, q, t) = s - q * gamma * sigma^2 * (T - t)
        Returns: (reservation_price, skew_offset)
        """
        gamma = self.params.risk_aversion_gamma
        sigma = self.params.asset_volatility_sigma
        t_rem = max(1.0, time_horizon)

        # Skew offset = q * gamma * sigma^2 * (T - t)
        skew_offset = inventory * gamma * (sigma ** 2) * t_rem
        reservation_price = mid_price - skew_offset
        return reservation_price, skew_offset

    def evaluate_quotes(self, snapshot: OrderBookSweepSnapshot) -> OptimalQuoteProfile:
        rationales: List[str] = []
        p = self.params
        q = snapshot.current_inventory
        s = snapshot.mid_price

        # 1. Hard Inventory Circuit Check
        if abs(q) >= p.max_inventory_limit:
            # Emergency one-sided quoting
            if q > 0:
                # Excessively long: pull bids, quote aggressively low ask
                directive = QuoteAdjustmentDirective.ONE_SIDED_EMERGENCY_PULL
                opt_bid = 0.0  # Cancel bid
                opt_ask = round(s, 4)
                bid_dist = 999.0
                ask_dist = 0.0
            else:
                # Excessively short: pull asks, quote aggressively high bid
                directive = QuoteAdjustmentDirective.ONE_SIDED_EMERGENCY_PULL
                opt_bid = round(s, 4)
                opt_ask = 999_999.0  # Cancel ask
                bid_dist = 0.0
                ask_dist = 999.0

            rationales.append(
                f"Maximum inventory limit breached (q={q:.1f} vs limit {p.max_inventory_limit:.1f}). "
                f"Activating one-sided emergency offload quotes."
            )
            return OptimalQuoteProfile(
                symbol=snapshot.symbol,
                reservation_price=round(s, 4),
                optimal_bid_price=opt_bid,
                optimal_ask_price=opt_ask,
                bid_distance=bid_dist,
                ask_distance=ask_dist,
                total_spread=999.0,
                resiliency_spread_premium=0.0,
                inventory_skew_offset=0.0,
                regime=MarketMakerRegime.MAX_INVENTORY_CIRCUIT_HALT,
                directive=directive,
                rationales=rationales,
            )

        # 2. Resiliency spread decay calculation
        expected_spread, excess_premium = self.calculate_resiliency_spread(
            snapshot.baseline_spread, snapshot.current_spread, snapshot.seconds_since_sweep
        )

        # 3. Reservation price and inventory skew
        res_price, skew_offset = self.calculate_reservation_price(
            s, q, p.time_horizon_seconds
        )

        # 4. Asymmetric optimal half-spreads
        # Avellaneda-Stoikov base half-spread: (1/gamma) * ln(1 + gamma/kappa)
        base_half_spread = (1.0 / p.risk_aversion_gamma) * math.log(
            1.0 + (p.risk_aversion_gamma / p.order_arrival_intensity_kappa)
        )
        # Ensure base half-spread is at least half of baseline spread
        base_half_spread = max(base_half_spread, snapshot.baseline_spread / 2.0)

        # Add post-sweep spread resiliency premium
        resiliency_padding = excess_premium / 2.0

        # Asymmetric bid and ask distances from reservation price
        # delta_a = base_half_spread + (1 - 2q)/2 * ...
        # Standard formulation around reservation price:
        bid_distance = base_half_spread + resiliency_padding + (skew_offset / 2.0)
        ask_distance = base_half_spread + resiliency_padding - (skew_offset / 2.0)

        # Absolute quotes relative to mid price
        opt_bid = round(res_price - (base_half_spread + resiliency_padding), 4)
        opt_ask = round(res_price + (base_half_spread + resiliency_padding), 4)

        # Ensure positive spread
        if opt_ask <= opt_bid:
            opt_ask = opt_bid + round(snapshot.baseline_spread, 4)

        total_spread = round(opt_ask - opt_bid, 4)

        # 5. Regime and Directive State Machine
        if excess_premium >= 0.4 * snapshot.baseline_spread:
            regime = MarketMakerRegime.POST_SWEEP_RESILIENCY_DEFENSE
            directive = QuoteAdjustmentDirective.WIDEN_RESILIENCY_BUFFER
            rationales.append(
                f"Post-sweep resiliency decay active: spread elevated by {excess_premium:.4f} "
                f"({snapshot.seconds_since_sweep:.2f}s post-sweep). Widening quote spread to {total_spread:.4f}."
            )
        elif abs(q) >= p.inventory_warning_threshold:
            regime = MarketMakerRegime.INVENTORY_SKEWED_OFFLOAD
            directive = QuoteAdjustmentDirective.SHADE_PRICES_TOWARDS_OFFLOAD
            side = "LONG" if q > 0 else "SHORT"
            rationales.append(
                f"Inventory imbalance ({side} q={q:.1f}). Shading reservation price by {skew_offset:+.4f} "
                f"to attract inventory-clearing flow."
            )
        else:
            regime = MarketMakerRegime.NOMINAL_SYMMETRIC_MAKING
            directive = QuoteAdjustmentDirective.MAINTAIN_BALANCED_TWO_SIDED
            rationales.append(
                f"Nominal market making equilibrium: q={q:.1f}, spread={total_spread:.4f}. "
                f"Posting balanced two-sided quotes."
            )

        return OptimalQuoteProfile(
            symbol=snapshot.symbol,
            reservation_price=round(res_price, 4),
            optimal_bid_price=opt_bid,
            optimal_ask_price=opt_ask,
            bid_distance=round(bid_distance, 4),
            ask_distance=round(ask_distance, 4),
            total_spread=total_spread,
            resiliency_spread_premium=round(excess_premium, 4),
            inventory_skew_offset=round(skew_offset, 4),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
