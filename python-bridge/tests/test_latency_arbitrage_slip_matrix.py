"""
Unit Test Suite for Domain 242: Multi-Venue Cross-Exchange Latency Arbitrage & Sub-Millisecond Slip Matrix
"""

import pytest
from services.latency_arbitrage_slip_matrix import (
    LatencyArbitrageSlipMatrix,
    VenueLOBState,
    LatencyArbDirective,
    ArbRegimeState,
)


@pytest.fixture
def engine():
    return LatencyArbitrageSlipMatrix(
        decay_hazard_lambda=0.08,
        min_win_prob_threshold=0.70,
        min_net_edge_bps=1.0,
        unhedged_leg_loss_bps=15.0,
    )


def test_uncrossed_books_no_arb(engine):
    v1 = VenueLOBState("BINANCE", 100.0, 100.2, 50.0, 50.0, 1.5, 3.0, 0.5)
    v2 = VenueLOBState("COINBASE", 99.9, 100.3, 40.0, 40.0, 2.0, 4.0, 0.6)

    opp = engine.evaluate_pair(v1, v2, order_size=5.0)
    assert opp.directive == LatencyArbDirective.NO_CROSS_OPPORTUNITY

    assessment = engine.scan_all_venues([v1, v2], order_size=5.0)
    assert assessment.regime == ArbRegimeState.UNCROSSED_EQUILIBRIUM
    assert assessment.best_opportunity is None


def test_crossed_profitable_arbitrage(engine):
    # Buy on V1 (Ask=100.0), Sell on V2 (Bid=100.25) => 25 bps gross spread
    # Fees = 1.0 + 1.0 = 2.0 bps
    # Fast fiber connection: 2.0 ms latency, 0.3 ms jitter
    v1 = VenueLOBState("FAST_VENUE_A", 99.90, 100.00, 100.0, 100.0, 1.0, 2.0, 0.3)
    v2 = VenueLOBState("FAST_VENUE_B", 100.25, 100.35, 100.0, 100.0, 1.0, 2.2, 0.3)

    opp = engine.evaluate_pair(v1, v2, order_size=10.0)
    assert opp.directive == LatencyArbDirective.EXECUTE_ATOMIC_CROSS
    assert opp.gross_spread_bps == 25.0
    assert opp.net_edge_bps > 5.0
    assert opp.win_probability >= engine.min_win_prob_threshold

    assessment = engine.scan_all_venues([v1, v2], order_size=10.0)
    assert assessment.regime == ArbRegimeState.CROSS_ARBITRAGE_ACTIVE
    assert assessment.best_opportunity is not None
    assert assessment.best_opportunity.buy_venue == "FAST_VENUE_A"
    assert assessment.best_opportunity.sell_venue == "FAST_VENUE_B"


def test_unprofitable_fee_barrier(engine):
    # Buy on V1 @ 100.00, Sell on V2 @ 100.03 => 3 bps gross spread
    # Total fees = 2.5 + 2.5 = 5.0 bps > 3.0 bps
    v1 = VenueLOBState("VENUE_A", 99.95, 100.00, 100.0, 100.0, 2.5, 3.0, 0.5)
    v2 = VenueLOBState("VENUE_B", 100.03, 100.08, 100.0, 100.0, 2.5, 3.0, 0.5)

    opp = engine.evaluate_pair(v1, v2, order_size=5.0)
    assert opp.directive == LatencyArbDirective.UNPROFITABLE_FEE_BARRIER


def test_jitter_hazard_abort(engine):
    # Crossed books: Buy @ 100.00, Sell @ 100.20 => 20 bps gross spread
    # But horrible network connection: 45ms latency, 15ms jitter!
    v1 = VenueLOBState("SLOW_VENUE_A", 99.80, 100.00, 100.0, 100.0, 1.0, 45.0, 15.0)
    v2 = VenueLOBState("SLOW_VENUE_B", 100.20, 100.40, 100.0, 100.0, 1.0, 48.0, 18.0)

    opp = engine.evaluate_pair(v1, v2, order_size=5.0)
    assert opp.directive == LatencyArbDirective.ABORT_LATENCY_RACE_RISK
    assert opp.win_probability < engine.min_win_prob_threshold


def test_slip_matrix_scaling(engine):
    v1 = VenueLOBState("VENUE_1", 100.0, 100.1, 50.0, 50.0, 1.0, 3.0, 0.5)
    v2 = VenueLOBState("VENUE_2", 100.0, 100.1, 50.0, 50.0, 1.0, 3.0, 0.5)

    slip_small = engine.compute_slip(v1, v2, size=5.0)
    slip_large = engine.compute_slip(v1, v2, size=45.0)
    assert slip_large > slip_small
