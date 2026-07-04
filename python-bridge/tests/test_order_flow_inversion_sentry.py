"""
Unit Test Suite for Domain 243: Cross-Venue High-Frequency Order Flow Inversion & Structural Queue Imbalance Sentry
"""

import pytest
from services.order_flow_inversion_sentry import (
    OrderFlowInversionSentry,
    VenueFlowSnapshot,
    OFIInversionRegimeState,
    InversionExecutionDirective,
)


@pytest.fixture
def sentry():
    return OrderFlowInversionSentry(
        fragility_threshold=0.70,
        disconnect_divergence_threshold=0.80,
        exhaustion_acceleration_threshold=-0.50,
        min_price_drift_exhaustion_bps=4.0,
    )


def test_aligned_laminar_flow(sentry):
    anchor = VenueFlowSnapshot("BINANCE_PERP", 0.65, 0.20, 0.05, 3.0, 0.35, is_primary_anchor=True)
    satellite = VenueFlowSnapshot("COINBASE_SPOT", 0.58, 0.18, 0.04, 2.8, 0.40)

    sig = sentry.evaluate_flow(anchor, satellite)
    assert sig.regime == OFIInversionRegimeState.ALIGNED_LAMINAR_FLOW
    assert sig.directive == InversionExecutionDirective.FOLLOW_MOMENTUM_FLOW
    assert sig.recommended_side == "BUY"
    assert sig.flow_divergence < 0.20


def test_cross_venue_flow_disconnect(sentry):
    # Satellite has positive flow (+0.60), but anchor has heavy selling (-0.50)
    anchor = VenueFlowSnapshot("BINANCE_PERP", -0.50, -0.15, -0.05, -2.5, 0.30, is_primary_anchor=True)
    satellite = VenueFlowSnapshot("BYBIT_SPOT", 0.60, 0.10, 0.02, 1.5, 0.35)

    sig = sentry.evaluate_flow(anchor, satellite)
    assert sig.regime == OFIInversionRegimeState.CROSS_VENUE_FLOW_DISCONNECT
    assert sig.directive == InversionExecutionDirective.ARBITRAGE_CROSS_VENUE_DISCONNECT
    # Must follow anchor's side (anchor is selling, so recommended side is SELL)
    assert sig.recommended_side == "SELL"
    assert sig.confidence_score >= 0.75


def test_buying_exhaustion_fade(sentry):
    # Price moved up +5.5 bps, but OFI acceleration collapsed to -0.70
    anchor = VenueFlowSnapshot("BINANCE_PERP", 0.20, 0.0, -0.10, 2.0, 0.40, is_primary_anchor=True)
    satellite = VenueFlowSnapshot("COINBASE_SPOT", 0.30, -0.10, -0.70, 5.5, 0.45)

    sig = sentry.evaluate_flow(anchor, satellite)
    assert sig.regime == OFIInversionRegimeState.INVERSION_EXHAUSTION_PIVOT
    assert sig.directive == InversionExecutionDirective.EXECUTE_EXHAUSTION_FADE
    assert sig.recommended_side == "SELL"


def test_selling_exhaustion_fade(sentry):
    # Price moved down -6.0 bps, but selling flow deceleration (+0.65 acceleration)
    anchor = VenueFlowSnapshot("BINANCE_PERP", -0.15, 0.0, 0.05, -2.0, 0.35, is_primary_anchor=True)
    satellite = VenueFlowSnapshot("COINBASE_SPOT", -0.25, 0.10, 0.65, -6.0, 0.40)

    sig = sentry.evaluate_flow(anchor, satellite)
    assert sig.regime == OFIInversionRegimeState.INVERSION_EXHAUSTION_PIVOT
    assert sig.directive == InversionExecutionDirective.EXECUTE_EXHAUSTION_FADE
    assert sig.recommended_side == "BUY"


def test_queue_hollow_vacuum(sentry):
    # Level 1 holds 85% of depth, dangerous air pocket beneath
    anchor = VenueFlowSnapshot("BINANCE_PERP", 0.10, 0.0, 0.0, 0.5, 0.85, is_primary_anchor=True)
    satellite = VenueFlowSnapshot("COINBASE_SPOT", 0.08, 0.0, 0.0, 0.3, 0.50)

    sig = sentry.evaluate_flow(anchor, satellite)
    assert sig.regime == OFIInversionRegimeState.QUEUE_HOLLOW_VACUUM
    assert sig.directive == InversionExecutionDirective.EVACUATE_HOLLOW_QUEUE
    assert sig.recommended_side == "HOLD_NEUTRAL"
