r"""Multi-Exchange Continuous Double Auction Clearing & Latency Arb Sieve (Domain 212 / WP-DJ)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Walrasian continuous double auction and discrete call auction clearing price optimizer P^*
   maximizing matched trading volume and minimizing surplus imbalance.
2. Cross-venue clearing divergence tracking across primary and secondary liquidity venues (e.g. NSE vs BSE).
3. Sub-millisecond crossed book latency arbitrage profitability engine factoring dual taker fees
   and round-trip latency race survival probability P_{race}(\tau).
4. Synchronous child order dispatch scheduler and stale latency trap eviction sentry.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class AuctionCrossingStatus(Enum):
    """Status of cross-market clearing or crossed book condition."""
    NO_CROSS_EQUILIBRIUM = "NO_CROSS_EQUILIBRIUM"       # Normal uncrossed market books
    ARBITRAGE_CROSS_DETECTED = "ARBITRAGE_CROSS_DETECTED" # Profitable executable crossed book
    LATENCY_TRAP_DISQUALIFIED = "LATENCY_TRAP_DISQUALIFIED" # Crossed but latency/friction kills edge


class RoutingExecutionDirective(Enum):
    """Tactical routing posture for multi-venue clearing."""
    STANDBY_MONITOR = "STANDBY_MONITOR"
    EXECUTE_SYNCHRONOUS_CROSS = "EXECUTE_SYNCHRONOUS_CROSS"
    REJECT_EXECUTION_STALE_CROSS = "REJECT_EXECUTION_STALE_CROSS"


@dataclass
class OrderTier:
    """Individual price level and resting depth."""
    price: float
    volume: float


@dataclass
class VenueOrderBook:
    """Snapshot of a venue's limit order book."""
    venue_name: str
    bids: List[OrderTier]              # Sorted descending by price
    asks: List[OrderTier]              # Sorted ascending by price
    one_way_latency_ms: float = 0.50   # Network ping to venue matching engine
    taker_fee_bps: float = 0.80        # Exchange taker fee in bps


@dataclass
class AuctionClearingResult:
    """Equilibrium auction clearing price and matched volume."""
    clearing_price: float
    matched_volume: float
    surplus_imbalance: float           # Positive = excess buy volume, negative = excess sell volume
    unfilled_bid_volume: float
    unfilled_ask_volume: float


@dataclass
class CrossVenueArbitrageResult:
    """Cross-venue crossing detection, fee deduction, and latency hazard assessment."""
    venue_buy: str
    venue_sell: str
    buy_price: float                   # Ask price at Venue Buy
    sell_price: float                  # Bid price at Venue Sell
    max_executable_volume: float
    gross_edge_bps: float
    total_friction_bps: float
    net_edge_bps: float
    roundtrip_latency_ms: float
    race_survival_probability: float
    crossing_status: AuctionCrossingStatus
    recommended_directive: RoutingExecutionDirective
    tactical_directive: str


class ContinuousDoubleAuctionClearingSieve:
    r"""Multi-Exchange Continuous Double Auction Clearing & Latency Arb Sieve.
    
    Mathematical Formulation:
    1. Uniform Call Auction Clearing:
       P^* = \arg\max_P \min(Q_{cum}^{bid}(P), Q_{cum}^{ask}(P))
       
    2. Sub-Millisecond Cross Arbitrage:
       \text{GrossEdge}_{\text{bps}} = \frac{P_{bid}^{sell} - P_{ask}^{buy}}{P_{mid}} \times 10000
       \text{NetEdge}_{\text{bps}} = \text{GrossEdge}_{\text{bps}} - (\text{Fee}_{buy} + \text{Fee}_{sell} + \text{Slippage})
       
    3. Latency Race Survival:
       P_{\text{race}}(\tau) = \exp\left(-\frac{\tau_{\text{RTT}}}{\tau_{\text{decay}}}\right)
       where \tau_{\text{decay}} \approx 1.50\text{ ms}
    """

    def __init__(
        self,
        min_net_edge_bps: float = 1.00,
        arb_half_life_ms: float = 1.50,
        modeled_slippage_bps: float = 0.30,
    ) -> None:
        self.min_net_edge_bps = min_net_edge_bps
        self.arb_half_life_ms = arb_half_life_ms
        self.modeled_slippage_bps = modeled_slippage_bps

    def compute_auction_clearing_price(
        self,
        bids: List[OrderTier],
        asks: List[OrderTier],
    ) -> AuctionClearingResult:
        """Find the uniform market clearing price that maximizes tradable matched volume."""
        if not bids or not asks:
            return AuctionClearingResult(
                clearing_price=0.0, matched_volume=0.0,
                surplus_imbalance=0.0, unfilled_bid_volume=0.0, unfilled_ask_volume=0.0
            )

        # Collect all unique candidate price levels
        all_prices = sorted(list(set([b.price for b in bids] + [a.price for a in asks])))
        best_price = 0.0
        max_matched = 0.0
        min_imbalance = float("inf")
        best_bid_cum = 0.0
        best_ask_cum = 0.0

        for p in all_prices:
            cum_bid = sum(b.volume for b in bids if b.price >= p)
            cum_ask = sum(a.volume for a in asks if a.price <= p)
            matched = min(cum_bid, cum_ask)
            imbalance = abs(cum_bid - cum_ask)

            if matched > max_matched:
                max_matched = matched
                min_imbalance = imbalance
                best_price = p
                best_bid_cum = cum_bid
                best_ask_cum = cum_ask
            elif matched == max_matched and matched > 0:
                # Tie-breaker: minimize surplus imbalance
                if imbalance < min_imbalance:
                    min_imbalance = imbalance
                    best_price = p
                    best_bid_cum = cum_bid
                    best_ask_cum = cum_ask

        surplus = best_bid_cum - best_ask_cum
        unfilled_bids = max(0.0, surplus)
        unfilled_asks = max(0.0, -surplus)

        return AuctionClearingResult(
            clearing_price=best_price,
            matched_volume=round(max_matched, 2),
            surplus_imbalance=round(surplus, 2),
            unfilled_bid_volume=round(unfilled_bids, 2),
            unfilled_ask_volume=round(unfilled_asks, 2),
        )

    def evaluate_cross_venue_arbitrage(
        self,
        venue_a: VenueOrderBook,
        venue_b: VenueOrderBook,
    ) -> CrossVenueArbitrageResult:
        """Evaluate if top-of-book prices across venues cross with net positive edge."""
        if not venue_a.bids or not venue_a.asks or not venue_b.bids or not venue_b.asks:
            return CrossVenueArbitrageResult(
                venue_buy="NONE", venue_sell="NONE", buy_price=0.0, sell_price=0.0,
                max_executable_volume=0.0, gross_edge_bps=0.0, total_friction_bps=0.0,
                net_edge_bps=0.0, roundtrip_latency_ms=0.0, race_survival_probability=0.0,
                crossing_status=AuctionCrossingStatus.NO_CROSS_EQUILIBRIUM,
                recommended_directive=RoutingExecutionDirective.STANDBY_MONITOR,
                tactical_directive="Insufficient order book depth across venues.",
            )

        best_bid_a = venue_a.bids[0].price
        best_ask_a = venue_a.asks[0].price
        best_bid_b = venue_b.bids[0].price
        best_ask_b = venue_b.asks[0].price

        # Check Direction 1: Buy Venue A, Sell Venue B (Bid B > Ask A)
        cross_1 = best_bid_b - best_ask_a
        # Check Direction 2: Buy Venue B, Sell Venue A (Bid A > Ask B)
        cross_2 = best_bid_a - best_ask_b

        if cross_1 > 0 and cross_1 >= cross_2:
            venue_buy = venue_a.venue_name
            venue_sell = venue_b.venue_name
            buy_price = best_ask_a
            sell_price = best_bid_b
            exec_vol = min(venue_a.asks[0].volume, venue_b.bids[0].volume)
            fee_buy = venue_a.taker_fee_bps
            fee_sell = venue_b.taker_fee_bps
            rtt = max(venue_a.one_way_latency_ms, venue_b.one_way_latency_ms) * 2.0
        elif cross_2 > 0:
            venue_buy = venue_b.venue_name
            venue_sell = venue_a.venue_name
            buy_price = best_ask_b
            sell_price = best_bid_a
            exec_vol = min(venue_b.asks[0].volume, venue_a.bids[0].volume)
            fee_buy = venue_b.taker_fee_bps
            fee_sell = venue_a.taker_fee_bps
            rtt = max(venue_a.one_way_latency_ms, venue_b.one_way_latency_ms) * 2.0
        else:
            # Uncrossed
            mid = 0.5 * (best_bid_a + best_ask_a)
            return CrossVenueArbitrageResult(
                venue_buy=venue_a.venue_name,
                venue_sell=venue_b.venue_name,
                buy_price=best_ask_a,
                sell_price=best_bid_b,
                max_executable_volume=0.0,
                gross_edge_bps=round(((best_bid_b - best_ask_a) / max(mid, 1.0)) * 10000.0, 2),
                total_friction_bps=round(venue_a.taker_fee_bps + venue_b.taker_fee_bps + self.modeled_slippage_bps, 2),
                net_edge_bps=0.0,
                roundtrip_latency_ms=0.0,
                race_survival_probability=0.0,
                crossing_status=AuctionCrossingStatus.NO_CROSS_EQUILIBRIUM,
                recommended_directive=RoutingExecutionDirective.STANDBY_MONITOR,
                tactical_directive="Markets uncrossed. No arbitrage opportunity.",
            )

        mid_price = 0.5 * (buy_price + sell_price)
        gross_bps = ((sell_price - buy_price) / max(mid_price, 1e-4)) * 10000.0
        total_friction = fee_buy + fee_sell + self.modeled_slippage_bps
        net_bps = gross_bps - total_friction

        # Race survival probability: P = exp(-RTT / tau)
        p_race = math.exp(-rtt / max(self.arb_half_life_ms, 0.1))

        if net_bps >= self.min_net_edge_bps and p_race >= 0.40:
            status = AuctionCrossingStatus.ARBITRAGE_CROSS_DETECTED
            directive = RoutingExecutionDirective.EXECUTE_SYNCHRONOUS_CROSS
            msg = (
                f"EXECUTABLE CROSS: Buy {venue_buy} @ {buy_price:.2f}, Sell {venue_sell} @ {sell_price:.2f}. "
                f"Net edge: +{net_bps:.2f} bps, Size: {exec_vol:.0f}, P_race: {p_race:.1%}. Dispatch immediate child sweep!"
            )
        else:
            status = AuctionCrossingStatus.LATENCY_TRAP_DISQUALIFIED
            directive = RoutingExecutionDirective.REJECT_EXECUTION_STALE_CROSS
            msg = (
                f"DISQUALIFIED LATENCY TRAP: Gross: {gross_bps:.2f} bps, Friction: {total_friction:.2f} bps, "
                f"Net: {net_bps:+.2f} bps, P_race: {p_race:.1%}. Reject to prevent orphan fill."
            )

        return CrossVenueArbitrageResult(
            venue_buy=venue_buy,
            venue_sell=venue_sell,
            buy_price=buy_price,
            sell_price=sell_price,
            max_executable_volume=exec_vol,
            gross_edge_bps=round(gross_bps, 3),
            total_friction_bps=round(total_friction, 3),
            net_edge_bps=round(net_bps, 3),
            roundtrip_latency_ms=round(rtt, 3),
            race_survival_probability=round(p_race, 4),
            crossing_status=status,
            recommended_directive=directive,
            tactical_directive=msg,
        )
