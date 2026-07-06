"""
Unit Test Suite for Domain 252: Intraday Volume-Weighted Bid-Ask Spread Resiliency & Market Maker Inventory Damping Kernel
"""

import pytest
from services.spread_resiliency_inventory_kernel import (
    SpreadResiliencyInventoryKernel,
    MarketMakerParameters,
    OrderBookSweepSnapshot,
    MarketMakerRegime,
    QuoteAdjustmentDirective,
)


@pytest.fixture
def kernel():
    params = MarketMakerParameters(
        risk_aversion_gamma=0.1,
        asset_volatility_sigma=0.02,
        order_arrival_intensity_kappa=1.5,
        resiliency_decay_lambda=2.5,
        target_inventory=0.0,
        inventory_warning_threshold=5.0,
        max_inventory_limit=10.0,
        time_horizon_seconds=60.0,
    )
    return SpreadResiliencyInventoryKernel(params=params)


def test_nominal_symmetric_making(kernel):
    # Zero inventory, spread fully recovered (10 seconds post-sweep)
    snap = OrderBookSweepSnapshot(
        symbol="BTC-USDT",
        mid_price=100.0,
        baseline_spread=0.04,
        current_spread=0.04,
        seconds_since_sweep=10.0,
        current_inventory=0.0,
    )
    res = kernel.evaluate_quotes(snap)
    assert res.regime == MarketMakerRegime.NOMINAL_SYMMETRIC_MAKING
    assert res.directive == QuoteAdjustmentDirective.MAINTAIN_BALANCED_TWO_SIDED
    assert res.resiliency_spread_premium == 0.0
    assert res.inventory_skew_offset == 0.0
    assert res.optimal_bid_price < 100.0 < res.optimal_ask_price


def test_inventory_skewed_offload(kernel):
    # Significant long inventory q = 7.0 (>= 5.0 warning threshold), spread normal
    snap = OrderBookSweepSnapshot(
        symbol="ETH-USDT",
        mid_price=3000.0,
        baseline_spread=0.10,
        current_spread=0.10,
        seconds_since_sweep=15.0,
        current_inventory=7.0,
    )
    res = kernel.evaluate_quotes(snap)
    assert res.regime == MarketMakerRegime.INVENTORY_SKEWED_OFFLOAD
    assert res.directive == QuoteAdjustmentDirective.SHADE_PRICES_TOWARDS_OFFLOAD
    assert res.inventory_skew_offset > 0.0  # Reservation price shaded lower
    assert res.reservation_price < 3000.0


def test_post_sweep_resiliency_defense(kernel):
    # Immediate post-sweep: spread blown out to 0.50 (vs 0.05 baseline), 0.1s elapsed
    snap = OrderBookSweepSnapshot(
        symbol="SOL-USDT",
        mid_price=150.0,
        baseline_spread=0.05,
        current_spread=0.50,
        seconds_since_sweep=0.1,
        current_inventory=1.0,
    )
    res = kernel.evaluate_quotes(snap)
    assert res.regime == MarketMakerRegime.POST_SWEEP_RESILIENCY_DEFENSE
    assert res.directive == QuoteAdjustmentDirective.WIDEN_RESILIENCY_BUFFER
    assert res.resiliency_spread_premium > 0.10
    assert res.total_spread > snap.baseline_spread


def test_max_inventory_circuit_halt(kernel):
    # Long inventory at hard boundary q = 10.0
    snap = OrderBookSweepSnapshot(
        symbol="NVDA",
        mid_price=120.0,
        baseline_spread=0.02,
        current_spread=0.02,
        seconds_since_sweep=5.0,
        current_inventory=10.0,
    )
    res = kernel.evaluate_quotes(snap)
    assert res.regime == MarketMakerRegime.MAX_INVENTORY_CIRCUIT_HALT
    assert res.directive == QuoteAdjustmentDirective.ONE_SIDED_EMERGENCY_PULL
    assert res.optimal_bid_price == 0.0  # Bid completely pulled


def test_resiliency_decay_monotonicity(kernel):
    baseline = 0.05
    shock = 0.50
    spread_t0, prem_t0 = kernel.calculate_resiliency_spread(baseline, shock, 0.0)
    spread_t1, prem_t1 = kernel.calculate_resiliency_spread(baseline, shock, 0.5)
    spread_t2, prem_t2 = kernel.calculate_resiliency_spread(baseline, shock, 2.0)

    assert spread_t0 > spread_t1 > spread_t2
    assert prem_t2 < 0.01  # After 2 seconds (5 half-lives), premium nearly zero
