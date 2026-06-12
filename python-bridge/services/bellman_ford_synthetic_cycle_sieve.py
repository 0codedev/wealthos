r"""Multi-Asset Synthetic Arbitrage & Bellman-Ford Negative Cycle Sieve (Domain 219 / WP-DQ)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Multi-asset directed exchange-rate graph construction with logarithmic transformation w = -\ln(R \cdot (1 - \text{Fee})).
2. Bellman-Ford O(|V| \cdot |E|) negative cycle detection discovering riskless circular arbitrage loops.
3. Liquidity bottleneck capacity extraction across cycle legs: Q^*_{cycle} = \min_i(Depth_i).
4. Atomic multi-leg execution routing and sub-economic friction rejection sentry.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class SyntheticArbRegime(Enum):
    """Classification of cross-asset arbitrage opportunities."""
    ARBITRAGE_FREE_EQUILIBRIUM = "ARBITRAGE_FREE_EQUILIBRIUM" # All cycles non-negative; market in equilibrium
    EXECUTABLE_NEGATIVE_CYCLE = "EXECUTABLE_NEGATIVE_CYCLE"   # Net profitable cycle after fees (>= 2.5 bps)
    SUB_ECONOMIC_FRICTION_CYCLE = "SUB_ECONOMIC_FRICTION_CYCLE" # Negative cycle exists before fees, but friction kills edge


class MultiLegExecutionAction(Enum):
    """Tactical execution directive for multi-asset loop."""
    STANDBY_MONITOR = "STANDBY_MONITOR"
    EXECUTE_ATOMIC_LOOP = "EXECUTE_ATOMIC_LOOP"         # Fire simultaneous atomic child orders
    REJECT_INSUFFICIENT_MARGIN = "REJECT_INSUFFICIENT_MARGIN"


@dataclass
class ExchangeRateEdge:
    """Directed edge representing exchange rate from source to destination asset."""
    source: str
    target: str
    rate: float                        # Units of target per 1 unit of source
    available_liquidity_source: float  # Maximum volume available at this rate
    taker_fee_bps: float = 0.50        # Statutory taker fee in bps


@dataclass
class ArbitrageCycleResult:
    """Discovered arbitrage loop, net basis point edge, and executable volume."""
    cycle_path: List[str]              # e.g., ["USD", "EUR", "GBP", "USD"]
    num_legs: int
    gross_rate_multiplier: float       # Product of raw rates
    net_multiplier_after_fees: float   # Product of (rate * (1 - fee))
    gross_edge_bps: float
    total_fee_friction_bps: float
    net_edge_bps: float
    bottleneck_source_capacity: float
    regime: SyntheticArbRegime
    recommended_action: MultiLegExecutionAction
    tactical_directive: str


class BellmanFordSyntheticCycleSieve:
    r"""Bellman-Ford Graph Arbitrage & Cycle Sieve.
    
    Mathematical Formulation:
    Edge Weight Transformation:
    w(u, v) = -\ln(R(u \to v) \cdot (1 - \text{Fee}_{\text{bps}} \times 10^{-4}))
    
    Negative Cycle Condition:
    \sum_{e \in \mathcal{C}} w(e) < 0 \iff \prod_{e \in \mathcal{C}} R_e (1 - \text{Fee}_e) > 1.0
    
    Net Edge in Basis Points:
    \text{NetEdge}_{\text{bps}} = \left( \exp(-\sum_{e \in \mathcal{C}} w(e)) - 1.0 \right) \times 10000
    """

    def __init__(
        self,
        min_net_edge_bps: float = 2.50,
        max_loop_hops: int = 5,
    ) -> None:
        self.min_net_edge_bps = min_net_edge_bps
        self.max_loop_hops = max_loop_hops

    def find_negative_cycles(
        self,
        edges: List[ExchangeRateEdge],
    ) -> ArbitrageCycleResult:
        """Execute Bellman-Ford relaxation on logarithmic edge weights to detect profitable cycles."""
        if not edges:
            return ArbitrageCycleResult(
                cycle_path=[], num_legs=0, gross_rate_multiplier=1.0, net_multiplier_after_fees=1.0,
                gross_edge_bps=0.0, total_fee_friction_bps=0.0, net_edge_bps=0.0,
                bottleneck_source_capacity=0.0,
                regime=SyntheticArbRegime.ARBITRAGE_FREE_EQUILIBRIUM,
                recommended_action=MultiLegExecutionAction.STANDBY_MONITOR,
                tactical_directive="No trading edges in graph.",
            )

        # Collect unique vertices
        vertices = sorted(list(set([e.source for e in edges] + [e.target for e in edges])))
        v_count = len(vertices)

        # Build log-weights
        # edge: (source, target, log_weight, raw_rate, fee_mult, capacity)
        graph_edges = []
        for e in edges:
            fee_mult = 1.0 - (e.taker_fee_bps * 1e-4)
            if e.rate > 0 and fee_mult > 0:
                net_rate = e.rate * fee_mult
                log_w = -math.log(net_rate)
                graph_edges.append((e.source, e.target, log_w, e.rate, fee_mult, e.available_liquidity_source))

        # Bellman-Ford from virtual super-source connected to all vertices with weight 0
        dist = {v: 0.0 for v in vertices}
        predecessor: Dict[str, Optional[Tuple[str, float, float, float, float]]] = {v: None for v in vertices}

        # Relax V - 1 times
        for _ in range(v_count - 1):
            updated = False
            for u, v, w, r, f, cap in graph_edges:
                if dist[u] + w < dist[v] - 1e-9:
                    dist[v] = dist[u] + w
                    predecessor[v] = (u, w, r, f, cap)
                    updated = True
            if not updated:
                break

        # V-th iteration to detect negative cycle
        cycle_vertex = None
        for u, v, w, r, f, cap in graph_edges:
            if dist[u] + w < dist[v] - 1e-9:
                cycle_vertex = v
                predecessor[v] = (u, w, r, f, cap)
                break

        if cycle_vertex is None:
            return ArbitrageCycleResult(
                cycle_path=[], num_legs=0, gross_rate_multiplier=1.0, net_multiplier_after_fees=1.0,
                gross_edge_bps=0.0, total_fee_friction_bps=0.0, net_edge_bps=0.0,
                bottleneck_source_capacity=0.0,
                regime=SyntheticArbRegime.ARBITRAGE_FREE_EQUILIBRIUM,
                recommended_action=MultiLegExecutionAction.STANDBY_MONITOR,
                tactical_directive="Market in equilibrium. No negative arbitrage cycle found.",
            )

        # Trace back to find cycle
        visited = {}
        curr = cycle_vertex
        for _ in range(v_count):
            if predecessor[curr] is not None:
                curr = predecessor[curr][0]

        # Extract cycle path
        cycle_nodes = [curr]
        cycle_edges = []
        p = curr
        while True:
            pred_info = predecessor[p]
            if pred_info is None:
                break
            prev_node, w, r, f, cap = pred_info
            cycle_edges.append((prev_node, p, w, r, f, cap))
            if prev_node == curr:
                cycle_nodes.append(prev_node)
                break
            cycle_nodes.append(prev_node)
            p = prev_node
            if len(cycle_nodes) > self.max_loop_hops + 2:
                break

        cycle_nodes.reverse()
        cycle_edges.reverse()

        # Compute cycle product
        gross_prod = 1.0
        net_prod = 1.0
        bottleneck_cap = float("inf")

        for u, v, w, r, f, cap in cycle_edges:
            gross_prod *= r
            net_prod *= (r * f)
            bottleneck_cap = min(bottleneck_cap, cap)

        gross_bps = (gross_prod - 1.0) * 10000.0
        net_bps = (net_prod - 1.0) * 10000.0
        friction_bps = gross_bps - net_bps

        if net_bps >= self.min_net_edge_bps:
            regime = SyntheticArbRegime.EXECUTABLE_NEGATIVE_CYCLE
            action = MultiLegExecutionAction.EXECUTE_ATOMIC_LOOP
            directive = (
                f"ARBITRAGE CYCLE: Path {' -> '.join(cycle_nodes)} ({len(cycle_edges)} legs). "
                f"Net Edge: +{net_bps:.2f} bps (Gross: {gross_bps:.2f} bps, Friction: {friction_bps:.2f} bps). "
                f"Max Capacity: {bottleneck_cap:.0f}. Execute atomic multi-leg sweep!"
            )
        else:
            regime = SyntheticArbRegime.SUB_ECONOMIC_FRICTION_CYCLE
            action = MultiLegExecutionAction.REJECT_INSUFFICIENT_MARGIN
            directive = (
                f"SUB-ECONOMIC: Cycle {' -> '.join(cycle_nodes)} yields net edge {net_bps:+.2f} bps < {self.min_net_edge_bps:.2f} bps. "
                f"Friction ({friction_bps:.2f} bps) consumes edge. Reject execution."
            )

        return ArbitrageCycleResult(
            cycle_path=cycle_nodes,
            num_legs=len(cycle_edges),
            gross_rate_multiplier=round(gross_prod, 6),
            net_multiplier_after_fees=round(net_prod, 6),
            gross_edge_bps=round(gross_bps, 2),
            total_fee_friction_bps=round(friction_bps, 2),
            net_edge_bps=round(net_bps, 2),
            bottleneck_source_capacity=round(bottleneck_cap, 2) if bottleneck_cap < float("inf") else 0.0,
            regime=regime,
            recommended_action=action,
            tactical_directive=directive,
        )
