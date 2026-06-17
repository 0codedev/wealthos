"""
Multi-Venue Cross-Exchange Latency Arbitrage & Sub-Millisecond Slip Matrix
Domain 242 / Work Package WP-EN

Evaluates cross-venue price discrepancies, models two-legged execution race hazard
probabilities under asynchronous network latency jitter, constructs empirical
slippage matrices, and enforces atomic uncrossed cross-routing.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class LatencyArbDirective(str, Enum):
    EXECUTE_ATOMIC_CROSS = "EXECUTE_ATOMIC_CROSS"              # Win probability >= 75%, positive net edge after slip
    ABORT_LATENCY_RACE_RISK = "ABORT_LATENCY_RACE_RISK"        # High network jitter/latency, one-legged risk intolerable
    UNPROFITABLE_FEE_BARRIER = "UNPROFITABLE_FEE_BARRIER"      # Gross spread positive, but fees and slip eliminate edge
    NO_CROSS_OPPORTUNITY = "NO_CROSS_OPPORTUNITY"              # Books uncrossed (best bid < best ask)


class ArbRegimeState(str, Enum):
    CROSS_ARBITRAGE_ACTIVE = "CROSS_ARBITRAGE_ACTIVE"          # Executable negative spread across venues
    JITTER_HAZARD_ELEVATED = "JITTER_HAZARD_ELEVATED"          # Cross exists, but network latency jitter threatens fill
    UNCROSSED_EQUILIBRIUM = "UNCROSSED_EQUILIBRIUM"            # Market in tight non-arbitrage equilibrium


@dataclass
class VenueLOBState:
    venue_id: str
    bid_price: float
    ask_price: float
    bid_size: float
    ask_size: float
    fee_bps: float                      # Taker fee in bps (e.g. 2.0 bps)
    latency_mean_ms: float              # One-way network latency (e.g. 5.0 ms)
    latency_jitter_ms: float            # Standard deviation of latency (e.g. 1.2 ms)


@dataclass
class ArbitrageOpportunity:
    buy_venue: str
    sell_venue: str
    buy_price: float
    sell_price: float
    gross_spread_bps: float             # (sell_price - buy_price) / buy_price * 10000
    total_fees_bps: float
    expected_slip_bps: float
    net_edge_bps: float
    win_probability: float              # Probability of completing both legs before market moves
    max_executable_size: float
    directive: LatencyArbDirective
    rationales: List[str] = field(default_factory=list)


@dataclass
class MultiVenueArbAssessment:
    timestamp_sec: float
    regime: ArbRegimeState
    best_opportunity: Optional[ArbitrageOpportunity]
    all_opportunities: List[ArbitrageOpportunity]
    slip_matrix: Dict[str, Dict[str, float]]
    rationales: List[str] = field(default_factory=list)


class LatencyArbitrageSlipMatrix:
    """
    Scans multi-venue order books for cross-exchange crossed markets, computes
    probabilistic race survival under network jitter, and issues atomic cross-routing.
    """

    def __init__(
        self,
        decay_hazard_lambda: float = 0.08,   # Opportunity decay rate (half-life ~8.6 ms)
        min_win_prob_threshold: float = 0.70, # Minimum acceptable dual-leg completion probability
        min_net_edge_bps: float = 1.0,       # Minimum 1 bps net edge after all friction
        unhedged_leg_loss_bps: float = 15.0, # Estimated loss if leg 1 fills but leg 2 is missed
    ):
        self.decay_hazard_lambda = decay_hazard_lambda
        self.min_win_prob_threshold = min_win_prob_threshold
        self.min_net_edge_bps = min_net_edge_bps
        self.unhedged_leg_loss_bps = unhedged_leg_loss_bps

    def compute_slip(
        self,
        v_buy: VenueLOBState,
        v_sell: VenueLOBState,
        size: float,
    ) -> float:
        """
        Computes expected 2-legged slippage in basis points based on order size vs top-of-book depth
        and network jitter latency.
        """
        # Base technological slip (e.g. 0.4 bps)
        base_slip = 0.40

        # Market impact from depth consumption: quadratic impact
        buy_impact = 1.5 * ((size / max(1e-4, v_buy.ask_size)) ** 1.5)
        sell_impact = 1.5 * ((size / max(1e-4, v_sell.bid_size)) ** 1.5)

        # Jitter slip penalty: higher jitter increases price variance during transit
        jitter_penalty = 0.20 * (v_buy.latency_jitter_ms + v_sell.latency_jitter_ms)

        return base_slip + buy_impact + sell_impact + jitter_penalty

    def calculate_win_probability(
        self,
        v_buy: VenueLOBState,
        v_sell: VenueLOBState,
    ) -> float:
        """
        Calculates the probability that both legs complete without the quote being swept
        by competing HFTs during network transit:
        P_win = exp(-lambda * max_transit_time) * (1 - jitter_risk)
        """
        # Max transit time with 2-sigma jitter buffer
        max_transit_ms = max(
            v_buy.latency_mean_ms + 1.5 * v_buy.latency_jitter_ms,
            v_sell.latency_mean_ms + 1.5 * v_sell.latency_jitter_ms,
        )

        # Asynchronous arrival gap: Delta_tau = |tau_buy - tau_sell|
        transit_gap_ms = abs(v_buy.latency_mean_ms - v_sell.latency_mean_ms)

        # Base survival probability over duration
        p_survival = math.exp(-self.decay_hazard_lambda * (max_transit_ms / 10.0))

        # Penalty for gap between legs (increased chance second leg is picked off)
        gap_penalty = min(0.40, 0.05 * (transit_gap_ms / 2.0))
        win_prob = max(0.01, min(0.99, p_survival * (1.0 - gap_penalty)))
        return win_prob

    def evaluate_pair(
        self,
        v_buy: VenueLOBState,
        v_sell: VenueLOBState,
        order_size: float,
    ) -> ArbitrageOpportunity:
        """
        Evaluates potential arbitrage: Buy on v_buy (at ask), Sell on v_sell (at bid).
        """
        rationales: List[str] = []
        buy_p = v_buy.ask_price
        sell_p = v_sell.bid_price

        # Check if crossed
        if sell_p <= buy_p:
            return ArbitrageOpportunity(
                buy_venue=v_buy.venue_id,
                sell_venue=v_sell.venue_id,
                buy_price=buy_p,
                sell_price=sell_p,
                gross_spread_bps=round(((sell_p - buy_p) / buy_p) * 10000.0, 2),
                total_fees_bps=round(v_buy.fee_bps + v_sell.fee_bps, 2),
                expected_slip_bps=0.0,
                net_edge_bps=0.0,
                win_probability=0.0,
                max_executable_size=0.0,
                directive=LatencyArbDirective.NO_CROSS_OPPORTUNITY,
                rationales=["Order books not crossed."],
            )

        gross_spread_bps = ((sell_p - buy_p) / buy_p) * 10000.0
        total_fees_bps = v_buy.fee_bps + v_sell.fee_bps
        max_size = min(order_size, v_buy.ask_size, v_sell.bid_size)

        expected_slip_bps = self.compute_slip(v_buy, v_sell, max_size)
        win_prob = self.calculate_win_probability(v_buy, v_sell)

        # Expected value formula:
        # E[Edge] = P_win * (Gross - Fees - Slip) - (1 - P_win) * UnhedgedLoss
        gross_net_margin = gross_spread_bps - total_fees_bps - expected_slip_bps
        expected_edge_bps = (win_prob * gross_net_margin) - ((1.0 - win_prob) * self.unhedged_leg_loss_bps)

        # Directives
        if gross_net_margin <= 0:
            directive = LatencyArbDirective.UNPROFITABLE_FEE_BARRIER
            rationales.append(
                f"Gross spread ({gross_spread_bps:.2f} bps) devoured by fees ({total_fees_bps:.2f} bps) and slippage ({expected_slip_bps:.2f} bps)."
            )
        elif win_prob < self.min_win_prob_threshold:
            directive = LatencyArbDirective.ABORT_LATENCY_RACE_RISK
            rationales.append(
                f"Race win probability ({win_prob*100:.1f}%) below safety threshold ({self.min_win_prob_threshold*100:.1f}%). High network latency jitter risk."
            )
        elif expected_edge_bps >= self.min_net_edge_bps:
            directive = LatencyArbDirective.EXECUTE_ATOMIC_CROSS
            rationales.append(
                f"Cross executable: Buy {v_buy.venue_id} @ {buy_p:.2f}, Sell {v_sell.venue_id} @ {sell_p:.2f}. Net expected edge: +{expected_edge_bps:.2f} bps (Win prob: {win_prob*100:.1f}%)."
            )
        else:
            directive = LatencyArbDirective.ABORT_LATENCY_RACE_RISK
            rationales.append(f"Net expected edge ({expected_edge_bps:.2f} bps) below hurdle ({self.min_net_edge_bps:.2f} bps).")

        return ArbitrageOpportunity(
            buy_venue=v_buy.venue_id,
            sell_venue=v_sell.venue_id,
            buy_price=buy_p,
            sell_price=sell_p,
            gross_spread_bps=round(gross_spread_bps, 2),
            total_fees_bps=round(total_fees_bps, 2),
            expected_slip_bps=round(expected_slip_bps, 2),
            net_edge_bps=round(expected_edge_bps, 2),
            win_probability=round(win_prob, 3),
            max_executable_size=round(max_size, 3),
            directive=directive,
            rationales=rationales,
        )

    def scan_all_venues(
        self,
        venues: List[VenueLOBState],
        order_size: float,
        current_time_sec: float = 0.0,
    ) -> MultiVenueArbAssessment:
        """
        Scans all ordered pairs of venues to detect crossed markets and builds
        the full pairwise slippage matrix.
        """
        rationales: List[str] = []
        n = len(venues)
        opportunities: List[ArbitrageOpportunity] = []
        slip_matrix: Dict[str, Dict[str, float]] = {}

        # Initialize slip matrix
        for v1 in venues:
            slip_matrix[v1.venue_id] = {}
            for v2 in venues:
                if v1.venue_id != v2.venue_id:
                    slip = self.compute_slip(v1, v2, order_size)
                    slip_matrix[v1.venue_id][v2.venue_id] = round(slip, 2)
                else:
                    slip_matrix[v1.venue_id][v2.venue_id] = 0.0

        # Scan pairs
        for i in range(n):
            for j in range(n):
                if i != j:
                    opp = self.evaluate_pair(venues[i], venues[j], order_size)
                    if opp.directive != LatencyArbDirective.NO_CROSS_OPPORTUNITY:
                        opportunities.append(opp)

        # Sort opportunities by expected net edge
        executable = [o for o in opportunities if o.directive == LatencyArbDirective.EXECUTE_ATOMIC_CROSS]
        best_opp: Optional[ArbitrageOpportunity] = None

        if executable:
            best_opp = max(executable, key=lambda o: o.net_edge_bps)
            regime = ArbRegimeState.CROSS_ARBITRAGE_ACTIVE
            rationales.append(
                f"Active cross-arbitrage found: Buy {best_opp.buy_venue} / Sell {best_opp.sell_venue} with net edge +{best_opp.net_edge_bps:.2f} bps."
            )
        elif any(o.directive == LatencyArbDirective.ABORT_LATENCY_RACE_RISK for o in opportunities):
            regime = ArbRegimeState.JITTER_HAZARD_ELEVATED
            best_opp = max(opportunities, key=lambda o: o.gross_spread_bps) if opportunities else None
            rationales.append("Crossed quotes exist but network jitter and latency render race survival hazardous.")
        else:
            regime = ArbRegimeState.UNCROSSED_EQUILIBRIUM
            rationales.append("All venue books uncrossed. Market in low-latency competitive equilibrium.")

        return MultiVenueArbAssessment(
            timestamp_sec=current_time_sec,
            regime=regime,
            best_opportunity=best_opp,
            all_opportunities=opportunities,
            slip_matrix=slip_matrix,
            rationales=rationales,
        )
