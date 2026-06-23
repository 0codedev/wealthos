"""
High-Frequency Cross-Venue Triangular Arbitrage Routing & Latency-Jitter Sentry
Domain 226 / Work Package WP-DX

Models 3-leg triangular cross-currency and cross-venue arbitrage paths,
asynchronous leg execution latency jitter, atomic fill-or-kill slippage barriers,
and one-legged execution risk containment.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class RoutingActionState(str, Enum):
    EXECUTE_ATOMIC = "EXECUTE_ATOMIC"                  # Positive net edge, clean latency, adequate depth
    ABORT_NEGATIVE_EDGE = "ABORT_NEGATIVE_EDGE"        # Net edge after fees <= hurdle
    ABORT_JITTER_TOO_HIGH = "ABORT_JITTER_TOO_HIGH"    # Ping/execution jitter exceeds tolerance
    ABORT_INSUFFICIENT_LIQUIDITY = "ABORT_INSUFFICIENT_LIQUIDITY" # Bottleneck size < min threshold
    ABORT_RACE_TIMEOUT = "ABORT_RACE_TIMEOUT"          # Total latency exceeds edge half-life


@dataclass
class ExchangeLeg:
    symbol: str           # e.g. "BTC/USDT"
    venue: str            # e.g. "binance", "bybit"
    action: str           # "buy" (pay quote, get base) or "sell" (give base, get quote)
    price: float          # top of book ask if buying, bid if selling
    depth_usd: float      # available dollar volume at price
    taker_fee_rate: float # e.g. 0.0004 (4 bps)
    base_currency: str
    quote_currency: str


@dataclass
class ArbitrageOpportunity:
    path_name: str
    legs: List[ExchangeLeg]
    gross_multiplier: float
    net_multiplier: float
    net_edge_bps: float
    bottleneck_capacity_usd: float
    expected_latency_ms: float
    latency_jitter_ms: float
    race_survival_probability: float
    sentry_status: RoutingActionState
    recommended_action: str
    details: Dict[str, float] = field(default_factory=dict)


class TriangularArbitrageJitterSentry:
    """
    Evaluates multi-venue triangular order routing opportunities, calibrating
    adverse price drift during asynchronous execution across venues.
    """

    def __init__(
        self,
        min_edge_hurdle_bps: float = 3.0,     # minimum 3 bps net profit after all fees
        max_total_latency_ms: float = 75.0,    # 75 ms hard timeout
        max_jitter_ratio: float = 0.60,       # jitter std / mean latency limit
        min_bottleneck_usd: float = 250.0,    # minimum $250 executable size
        edge_decay_half_life_ms: float = 40.0 # 40 ms half-life for quote staleness
    ):
        self.min_edge_hurdle_bps = min_edge_hurdle_bps
        self.max_total_latency_ms = max_total_latency_ms
        self.max_jitter_ratio = max_jitter_ratio
        self.min_bottleneck_usd = min_bottleneck_usd
        self.edge_decay_half_life_ms = edge_decay_half_life_ms

    @staticmethod
    def calculate_path_multipliers(legs: List[ExchangeLeg]) -> Tuple[float, float]:
        """
        Calculates gross and net return multipliers across 3 legs.
        For a buy: we convert quote to base, multiplier = (1 / price)
        For a sell: we convert base to quote, multiplier = price
        Fee is deducted on each leg: net_leg = gross_leg * (1 - fee)
        """
        if len(legs) != 3:
            return 0.0, 0.0

        gross_mult = 1.0
        net_mult = 1.0

        for leg in legs:
            if leg.price <= 0.0:
                return 0.0, 0.0

            if leg.action.lower() == "buy":
                step_gross = 1.0 / leg.price
            else:
                step_gross = leg.price

            step_net = step_gross * max(0.0, 1.0 - leg.taker_fee_rate)

            gross_mult *= step_gross
            net_mult *= step_net

        return gross_mult, net_mult

    @staticmethod
    def calculate_bottleneck_capacity(legs: List[ExchangeLeg]) -> float:
        """
        Calculates maximum executable capital in initial USD without walking the book.
        Capacity is bounded by the minimum dollar liquidity available along the chain.
        """
        if not legs:
            return 0.0
        return min(leg.depth_usd for leg in legs)

    def calculate_race_survival_probability(
        self,
        total_latency_ms: float,
        latency_jitter_ms: float,
        net_edge_bps: float,
    ) -> float:
        """
        Estimates the probability that the triangular edge remains un-sniped and un-decayed
        throughout the entire 3-leg asynchronous execution race:
        P_survival = exp(-total_latency / tau_half_life) * sigmoid(edge_buffer / jitter_vol)
        """
        if total_latency_ms <= 0.0:
            return 1.0

        # Half-life exponential decay factor
        decay_factor = math.exp(-total_latency_ms / max(1.0, self.edge_decay_half_life_ms))

        # Jitter volatility uncertainty factor
        # If edge is large relative to jitter-induced price drift, confidence is high
        sigma_drift = max(0.5, latency_jitter_ms * 0.1) # approx 0.1 bps per ms jitter
        z = (net_edge_bps - self.min_edge_hurdle_bps) / sigma_drift
        prob_no_slippage = 1.0 / (1.0 + math.exp(-max(-10.0, min(10.0, z))))

        return decay_factor * prob_no_slippage

    def evaluate_triangular_opportunity(
        self,
        path_name: str,
        legs: List[ExchangeLeg],
        venue_latencies_ms: Dict[str, float],
        venue_jitters_ms: Dict[str, float],
    ) -> ArbitrageOpportunity:
        """
        Evaluates a complete 3-leg triangular arbitrage route.
        Combines microstructural order book pricing with network latency & jitter telemetry.
        """
        if len(legs) != 3:
            return ArbitrageOpportunity(
                path_name=path_name,
                legs=legs,
                gross_multiplier=0.0,
                net_multiplier=0.0,
                net_edge_bps=-1000.0,
                bottleneck_capacity_usd=0.0,
                expected_latency_ms=0.0,
                latency_jitter_ms=0.0,
                race_survival_probability=0.0,
                sentry_status=RoutingActionState.ABORT_NEGATIVE_EDGE,
                recommended_action="ABORT: Invalid path geometry, must have exactly 3 legs.",
            )

        gross_mult, net_mult = self.calculate_path_multipliers(legs)
        net_edge_bps = (net_mult - 1.0) * 10000.0
        bottleneck_usd = self.calculate_bottleneck_capacity(legs)

        # Sum expected latency across distinct venues
        # Latency accounts for dispatch + matching engine RTT on each leg
        total_lat_ms = 0.0
        jitter_variances = 0.0

        for leg in legs:
            lat = venue_latencies_ms.get(leg.venue, 20.0)
            jit = venue_jitters_ms.get(leg.venue, 5.0)
            total_lat_ms += lat
            jitter_variances += (jit ** 2)

        total_jitter_ms = math.sqrt(jitter_variances)
        jitter_ratio = (total_jitter_ms / total_lat_ms) if total_lat_ms > 0 else 0.0

        survival_prob = self.calculate_race_survival_probability(
            total_lat_ms, total_jitter_ms, net_edge_bps
        )

        # Sentry Decision Rule Cascade
        if net_edge_bps < self.min_edge_hurdle_bps:
            status = RoutingActionState.ABORT_NEGATIVE_EDGE
            action = f"ABORT_NEGATIVE_EDGE: Net return {net_edge_bps:.2f} bps below {self.min_edge_hurdle_bps} bps hurdle."
        elif bottleneck_usd < self.min_bottleneck_usd:
            status = RoutingActionState.ABORT_INSUFFICIENT_LIQUIDITY
            action = f"ABORT_LOW_DEPTH: Bottleneck depth ${bottleneck_usd:.2f} < ${self.min_bottleneck_usd} minimum."
        elif total_lat_ms > self.max_total_latency_ms:
            status = RoutingActionState.ABORT_RACE_TIMEOUT
            action = f"ABORT_LATENCY_TIMEOUT: Total path latency {total_lat_ms:.1f}ms exceeds {self.max_total_latency_ms}ms limit."
        elif jitter_ratio > self.max_jitter_ratio:
            status = RoutingActionState.ABORT_JITTER_TOO_HIGH
            action = f"ABORT_JITTER_UNSTABLE: Jitter ratio {jitter_ratio:.2f} exceeds {self.max_jitter_ratio} threshold."
        elif survival_prob < 0.20:
            status = RoutingActionState.ABORT_RACE_TIMEOUT
            action = f"ABORT_DECAY_RACE: Edge survival probability {survival_prob:.1%} below 20% barrier."
        else:
            status = RoutingActionState.EXECUTE_ATOMIC
            action = f"EXECUTE_ATOMIC_3LEG: Edge {net_edge_bps:.1f} bps, depth ${bottleneck_usd:.0f}, survival {survival_prob:.1%}."

        return ArbitrageOpportunity(
            path_name=path_name,
            legs=legs,
            gross_multiplier=gross_mult,
            net_multiplier=net_mult,
            net_edge_bps=net_edge_bps,
            bottleneck_capacity_usd=bottleneck_usd,
            expected_latency_ms=total_lat_ms,
            latency_jitter_ms=total_jitter_ms,
            race_survival_probability=survival_prob,
            sentry_status=status,
            recommended_action=action,
            details={
                "gross_multiplier": gross_mult,
                "net_multiplier": net_mult,
                "jitter_ratio": jitter_ratio,
                "min_edge_hurdle_bps": self.min_edge_hurdle_bps,
            },
        )
