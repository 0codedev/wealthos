r"""Unit Tests for Real-Time High-Frequency Order Flow Imbalance (OFI) & Trade Arrival Kernel (Domain 213 / WP-DK)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import pytest
from services.ofi_trade_arrival_kernel import (
    OFITradeArrivalKernel,
    LOBLevel,
    LOBTopBookSnapshot,
    OFIAlphaRegime,
    OFITacticalDirective,
)


@pytest.fixture
def kernel() -> OFITradeArrivalKernel:
    return OFITradeArrivalKernel(
        decay_gamma=0.40,
        beta_impact_bps_per_100_shares=0.15,
        base_arrival_rate=5.0,
        arrival_sensitivity_kappa=1.80,
    )


def test_empty_snapshots(kernel: OFITradeArrivalKernel):
    s1 = LOBTopBookSnapshot(timestamp_ms=1000.0, bids=[], asks=[])
    s2 = LOBTopBookSnapshot(timestamp_ms=1010.0, bids=[], asks=[])
    ofi_1, ofi_multi, norm = kernel.calculate_multi_level_ofi(s2, s1)
    assert ofi_1 == 0.0
    assert ofi_multi == 0.0
    assert norm == 0.0


def test_neutral_equilibrium(kernel: OFITradeArrivalKernel):
    # Equal sizes, no change
    s_prev = LOBTopBookSnapshot(
        timestamp_ms=1000.0,
        bids=[LOBLevel(price=100.0, size=500.0), LOBLevel(price=99.9, size=1000.0)],
        asks=[LOBLevel(price=100.1, size=500.0), LOBLevel(price=100.2, size=1000.0)],
    )
    s_curr = LOBTopBookSnapshot(
        timestamp_ms=1010.0,
        bids=[LOBLevel(price=100.0, size=500.0), LOBLevel(price=99.9, size=1000.0)],
        asks=[LOBLevel(price=100.1, size=500.0), LOBLevel(price=100.2, size=1000.0)],
    )

    res = kernel.evaluate_ofi_kernel("NIFTY", s_curr, s_prev)
    assert res.level_1_ofi_shares == 0.0
    assert res.multi_tier_ofi_shares == 0.0
    assert res.normalized_ofi_ratio == 0.0
    assert res.alpha_regime == OFIAlphaRegime.NEUTRAL_EQUILIBRIUM
    assert res.tactical_directive == OFITacticalDirective.MAINTAIN_PASSIVE_SPREAD


def test_bullish_bid_increase_ask_cancel(kernel: OFITradeArrivalKernel):
    s_prev = LOBTopBookSnapshot(
        timestamp_ms=1000.0,
        bids=[LOBLevel(price=100.0, size=300.0)],
        asks=[LOBLevel(price=100.1, size=400.0)],
    )
    # Bids grew from 300 to 700 (+400), Asks shrank from 400 to 100 (-300)
    # Level 1 OFI = 400 - (-300) = 700!
    s_curr = LOBTopBookSnapshot(
        timestamp_ms=1010.0,
        bids=[LOBLevel(price=100.0, size=700.0)],
        asks=[LOBLevel(price=100.1, size=100.0)],
    )

    res = kernel.evaluate_ofi_kernel("BANKNIFTY", s_curr, s_prev)
    assert res.level_1_ofi_shares == 700.0
    assert res.multi_tier_ofi_shares > 600.0
    assert res.normalized_ofi_ratio > 0.50
    assert res.expected_price_drift_bps > 0.50
    assert res.buy_arrival_intensity_trades_sec > kernel.base_arrival_rate
    assert res.sell_arrival_intensity_trades_sec < kernel.base_arrival_rate


def test_bearish_bid_cancel_ask_increase(kernel: OFITradeArrivalKernel):
    s_prev = LOBTopBookSnapshot(
        timestamp_ms=1000.0,
        bids=[LOBLevel(price=100.0, size=500.0)],
        asks=[LOBLevel(price=100.1, size=200.0)],
    )
    # Bids dropped from 500 to 100 (-400), Asks jumped from 200 to 600 (+400)
    # Level 1 OFI = -400 - (400) = -800
    s_curr = LOBTopBookSnapshot(
        timestamp_ms=1010.0,
        bids=[LOBLevel(price=100.0, size=100.0)],
        asks=[LOBLevel(price=100.1, size=600.0)],
    )

    res = kernel.evaluate_ofi_kernel("RELIANCE", s_curr, s_prev)
    assert res.level_1_ofi_shares == -800.0
    assert res.normalized_ofi_ratio < -0.40
    assert res.expected_price_drift_bps < -0.50
    assert res.alpha_regime in (OFIAlphaRegime.BEARISH_FLOW_DISTRIBUTION, OFIAlphaRegime.TSUNAMI_IMBALANCE_SPIKE)
    assert res.tactical_directive in (OFITacticalDirective.POST_AGGRESSIVE_ASK_JOIN, OFITacticalDirective.MARKET_ORDER_SURGE_FOLLOW)


def test_tsunami_level_sweep(kernel: OFITradeArrivalKernel):
    # Bid price moves up from 100.0 to 100.1 with 2,000 shares (price level step!)
    s_prev = LOBTopBookSnapshot(
        timestamp_ms=1000.0,
        bids=[LOBLevel(price=100.0, size=500.0)],
        asks=[LOBLevel(price=100.1, size=500.0)],
    )
    s_curr = LOBTopBookSnapshot(
        timestamp_ms=1010.0,
        bids=[LOBLevel(price=100.1, size=2000.0)], # Stepped up
        asks=[LOBLevel(price=100.2, size=200.0)],
    )

    res = kernel.evaluate_ofi_kernel("TCS", s_curr, s_prev)
    assert res.normalized_ofi_ratio >= 0.60
    assert res.alpha_regime == OFIAlphaRegime.TSUNAMI_IMBALANCE_SPIKE
    assert res.tactical_directive == OFITacticalDirective.MARKET_ORDER_SURGE_FOLLOW
    assert "Imminent level sweep!" in res.operational_narrative
