r"""Unit Tests for Sub-Millisecond Order Flow Cancellation Velocity & Spoofing Sieve (Domain 205 / WP-DC)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.order_flow_cancellation_spoofing_sieve import (
    OrderFlowCancellationSpoofingSieve,
    OrderLifeEvent,
    MarketManipulationRegime,
    DefensePosture,
)


@pytest.fixture
def sieve() -> OrderFlowCancellationSpoofingSieve:
    return OrderFlowCancellationSpoofingSieve(
        flash_cancel_threshold_ms=15.0,
        high_cfr_threshold=15.0,
        extreme_qtr_threshold=25.0,
    )


def test_clean_organic_flow(sieve: OrderFlowCancellationSpoofingSieve):
    events = [
        OrderLifeEvent("O1", "BID", 25000.0, 100.0, 100.0, 350.0, "FILL"),
        OrderLifeEvent("O2", "ASK", 25001.0, 100.0, 120.0, 400.0, "FILL"),
        OrderLifeEvent("O3", "BID", 24999.0, 100.0, 150.0, 450.0, "FILL"),
        OrderLifeEvent("O4", "ASK", 25002.0, 100.0, 200.0, 600.0, "CANCEL"),
    ]

    res = sieve.analyze_order_flow_cancellations(events, window_ms=1000.0)

    assert res.total_orders == 4
    assert res.num_fills == 3
    assert res.num_cancels == 1
    assert res.cancel_to_fill_ratio < 1.0
    assert res.sub_15ms_cancel_ratio == 0.0
    assert res.manipulation_regime == MarketManipulationRegime.CLEAN_ORGANIC_FLOW
    assert res.defense_posture == DefensePosture.STANDARD_QUOTING


def test_flash_cancellation_toxic_burst(sieve: OrderFlowCancellationSpoofingSieve):
    # 20 flash cancellations within 5ms of entry
    events = [
        OrderLifeEvent(f"C_{i}", "BID", 25000.0 - i * 0.05, 500.0, 100.0 + i * 10, 104.0 + i * 10, "CANCEL")
        for i in range(20)
    ]
    # Single tiny fill
    events.append(OrderLifeEvent("F1", "ASK", 25001.0, 50.0, 150.0, 160.0, "FILL"))

    res = sieve.analyze_order_flow_cancellations(events, window_ms=1000.0)

    assert res.num_cancels == 20
    assert res.sub_15ms_cancel_ratio == 1.0
    assert res.spoofing_pressure_index > 0.80
    assert res.manipulation_regime == MarketManipulationRegime.TOXIC_SPOOFING_BURST
    assert res.defense_posture == DefensePosture.WIDEN_MAKER_SPREAD
    assert res.filtered_bid_depth_discount_pct >= 50.0


def test_layering_phantom_depth_detection(sieve: OrderFlowCancellationSpoofingSieve):
    # Aggressive Sell Fill at Ask on Level 1 at t=1000ms
    events = [
        OrderLifeEvent("REAL_FILL", "ASK", 25001.0, 200.0, 950.0, 1000.0, "FILL")
    ]
    # 5 phantom Bid orders totaling 2500 units placed and canceled at t=1010ms (10ms after fill)
    for i in range(5):
        events.append(
            OrderLifeEvent(f"PHANTOM_BID_{i}", "BID", 25000.0 - i * 0.05, 500.0, 960.0, 1010.0, "CANCEL")
        )

    res = sieve.analyze_order_flow_cancellations(events, window_ms=500.0)

    assert res.phantom_volume_ratio >= 5.0
    assert res.manipulation_regime == MarketManipulationRegime.CONFIRMED_LAYERING
    assert res.defense_posture == DefensePosture.STRIP_PHANTOM_DEPTH
    assert res.filtered_bid_depth_discount_pct > 50.0
    assert "CONFIRMED BID LAYERING" in res.tactical_directive


def test_quote_stuffing_high_cfr(sieve: OrderFlowCancellationSpoofingSieve):
    # 18 cancels with 50ms duration (not sub-15ms flash, but extreme cancel-to-fill churn)
    events = [
        OrderLifeEvent(f"C_{i}", "BID", 25000.0, 100.0, 100.0 + i * 20, 150.0 + i * 20, "CANCEL")
        for i in range(18)
    ]
    events.append(OrderLifeEvent("F1", "BID", 25000.0, 100.0, 200.0, 300.0, "FILL"))

    res = sieve.analyze_order_flow_cancellations(events, window_ms=1000.0)

    assert res.cancel_to_fill_ratio == 18.0
    assert res.manipulation_regime == MarketManipulationRegime.SUSPICIOUS_QUOTE_STUFFING
    assert res.defense_posture == DefensePosture.STRIP_PHANTOM_DEPTH
