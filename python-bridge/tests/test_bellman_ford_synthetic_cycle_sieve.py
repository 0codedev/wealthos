r"""Unit Tests for Multi-Asset Synthetic Arbitrage & Bellman-Ford Negative Cycle Sieve (Domain 219 / WP-DQ)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import pytest
from services.bellman_ford_synthetic_cycle_sieve import (
    BellmanFordSyntheticCycleSieve,
    ExchangeRateEdge,
    SyntheticArbRegime,
    MultiLegExecutionAction,
)


@pytest.fixture
def sieve() -> BellmanFordSyntheticCycleSieve:
    return BellmanFordSyntheticCycleSieve(
        min_net_edge_bps=2.50,
        max_loop_hops=5,
    )


def test_empty_edge_graph(sieve: BellmanFordSyntheticCycleSieve):
    res = sieve.find_negative_cycles([])
    assert res.regime == SyntheticArbRegime.ARBITRAGE_FREE_EQUILIBRIUM
    assert res.recommended_action == MultiLegExecutionAction.STANDBY_MONITOR
    assert res.net_edge_bps == 0.0


def test_arbitrage_free_equilibrium(sieve: BellmanFordSyntheticCycleSieve):
    # Perfect non-arbitrage triangle: USD -> EUR -> GBP -> USD = 1.00000
    r_usd_eur = 0.90
    r_eur_gbp = 0.85
    r_gbp_usd = 1.0 / (r_usd_eur * r_eur_gbp) # 1.3071895...

    edges = [
        ExchangeRateEdge(source="USD", target="EUR", rate=r_usd_eur, available_liquidity_source=10000.0, taker_fee_bps=0.50),
        ExchangeRateEdge(source="EUR", target="GBP", rate=r_eur_gbp, available_liquidity_source=10000.0, taker_fee_bps=0.50),
        ExchangeRateEdge(source="GBP", target="USD", rate=r_gbp_usd, available_liquidity_source=10000.0, taker_fee_bps=0.50),
    ]

    res = sieve.find_negative_cycles(edges)
    assert res.regime == SyntheticArbRegime.ARBITRAGE_FREE_EQUILIBRIUM
    assert res.recommended_action == MultiLegExecutionAction.STANDBY_MONITOR


def test_executable_triangular_arbitrage(sieve: BellmanFordSyntheticCycleSieve):
    # Mispriced triangle: GBP -> USD pays 1.312 instead of 1.3072 (gross ~ +36 bps)
    # Fees are 3 * 0.50 = 1.50 bps -> net edge ~ +34.5 bps!
    r_usd_eur = 0.90
    r_eur_gbp = 0.85
    r_gbp_usd = 1.3120

    edges = [
        ExchangeRateEdge(source="USD", target="EUR", rate=r_usd_eur, available_liquidity_source=10000.0, taker_fee_bps=0.50),
        ExchangeRateEdge(source="EUR", target="GBP", rate=r_eur_gbp, available_liquidity_source=2500.0, taker_fee_bps=0.50),
        ExchangeRateEdge(source="GBP", target="USD", rate=r_gbp_usd, available_liquidity_source=8000.0, taker_fee_bps=0.50),
    ]

    res = sieve.find_negative_cycles(edges)
    assert res.regime == SyntheticArbRegime.EXECUTABLE_NEGATIVE_CYCLE
    assert res.recommended_action == MultiLegExecutionAction.EXECUTE_ATOMIC_LOOP
    assert res.net_edge_bps >= sieve.min_net_edge_bps
    assert res.bottleneck_source_capacity == 2500.0
    assert "Execute atomic multi-leg sweep!" in res.tactical_directive


def test_sub_economic_friction_cycle(sieve: BellmanFordSyntheticCycleSieve):
    # Barely profitable gross loop (+1.0 bps), but fee is 3 * 0.80 = 2.40 bps
    # Net edge is negative!
    r_usd_eur = 0.90
    r_eur_gbp = 0.85
    r_gbp_usd = (1.0 / (0.90 * 0.85)) * 1.0001 # +1 bps gross

    edges = [
        ExchangeRateEdge(source="USD", target="EUR", rate=r_usd_eur, available_liquidity_source=5000.0, taker_fee_bps=0.80),
        ExchangeRateEdge(source="EUR", target="GBP", rate=r_eur_gbp, available_liquidity_source=5000.0, taker_fee_bps=0.80),
        ExchangeRateEdge(source="GBP", target="USD", rate=r_gbp_usd, available_liquidity_source=5000.0, taker_fee_bps=0.80),
    ]

    res = sieve.find_negative_cycles(edges)
    # Since net rate is < 1.0, it is either no negative cycle or sub-economic
    assert res.regime in (SyntheticArbRegime.ARBITRAGE_FREE_EQUILIBRIUM, SyntheticArbRegime.SUB_ECONOMIC_FRICTION_CYCLE)
    assert res.recommended_action in (MultiLegExecutionAction.STANDBY_MONITOR, MultiLegExecutionAction.REJECT_INSUFFICIENT_MARGIN)
