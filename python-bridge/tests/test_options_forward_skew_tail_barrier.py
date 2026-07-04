"""
Unit Test Suite for Domain 237: Real-Time Options Surface Wing Implied Forward Skew & Tail Loss Barrier
"""

import pytest
from services.options_forward_skew_tail_barrier import (
    OptionsForwardSkewTailBarrier,
    ForwardSkewState,
    TailBarrierDirective,
)


@pytest.fixture
def barrier():
    return OptionsForwardSkewTailBarrier(
        crash_barrier_pct=0.15,
        skew_elevated_threshold=0.40,
        skew_hyperinflation_threshold=0.85,
        max_acceptable_tail_loss_bps=75.0,
    )


def test_forward_slice_tranquil(barrier):
    # Spot 100, t1=0.25 (3M), t2=0.50 (6M)
    # Balanced smile
    quotes_t1 = {"atm": 0.20, "otm_put": 0.22, "otm_call": 0.21}
    quotes_t2 = {"atm": 0.21, "otm_put": 0.23, "otm_call": 0.22}

    slice_res = barrier.compute_forward_slice(
        spot=100.0,
        t1=0.25,
        t2=0.50,
        quotes_t1=quotes_t1,
        quotes_t2=quotes_t2,
        otm_put_strike=90.0,
        otm_call_strike=110.0,
    )

    assert slice_res.state == ForwardSkewState.TRANQUIL_UNIFORM
    assert not slice_res.calendar_arbitrage_detected
    assert slice_res.forward_atm_vol > 0.0

    tail = barrier.assess_tail_risk(
        spot=100.0,
        portfolio_notional=1_000_000,
        forward_slice=slice_res,
        otm_put_strike=90.0,
    )

    assert tail.directive == TailBarrierDirective.UNHEDGED_NORMAL
    assert tail.hedge_ratio == 0.0
    assert tail.recommended_put_strike == 85.0  # 100 * (1 - 0.15)


def test_forward_slice_elevated_skew(barrier):
    # Noticeable put skew in forward slice
    quotes_t1 = {"atm": 0.18, "otm_put": 0.20, "otm_call": 0.18}
    quotes_t2 = {"atm": 0.19, "otm_put": 0.27, "otm_call": 0.19}

    slice_res = barrier.compute_forward_slice(
        spot=100.0,
        t1=0.25,
        t2=0.50,
        quotes_t1=quotes_t1,
        quotes_t2=quotes_t2,
        otm_put_strike=90.0,
        otm_call_strike=110.0,
    )

    assert slice_res.forward_skew_slope >= barrier.skew_elevated_threshold
    assert slice_res.state in [ForwardSkewState.ELEVATED_DOWNSIDE_SKEW, ForwardSkewState.CRASH_SKEW_HYPERINFLATION]

    tail = barrier.assess_tail_risk(
        spot=100.0,
        portfolio_notional=1_000_000,
        forward_slice=slice_res,
        otm_put_strike=90.0,
    )

    assert tail.directive in [TailBarrierDirective.DEPLOY_RATIO_PUT_SPREAD, TailBarrierDirective.MANDATORY_CRASH_COLLAR]
    assert tail.hedge_ratio > 0.0


def test_forward_slice_hyperinflation_collar(barrier):
    # Severe panic put buying in the forward window
    quotes_t1 = {"atm": 0.20, "otm_put": 0.22, "otm_call": 0.20}
    quotes_t2 = {"atm": 0.22, "otm_put": 0.40, "otm_call": 0.21}

    slice_res = barrier.compute_forward_slice(
        spot=100.0,
        t1=0.25,
        t2=0.50,
        quotes_t1=quotes_t1,
        quotes_t2=quotes_t2,
        otm_put_strike=90.0,
        otm_call_strike=110.0,
    )

    assert slice_res.state == ForwardSkewState.CRASH_SKEW_HYPERINFLATION
    assert slice_res.forward_skew_slope >= 0.85

    tail = barrier.assess_tail_risk(
        spot=100.0,
        portfolio_notional=1_000_000,
        forward_slice=slice_res,
        otm_put_strike=90.0,
    )

    assert tail.directive == TailBarrierDirective.MANDATORY_CRASH_COLLAR
    assert tail.hedge_ratio >= 0.50


def test_calendar_arbitrage_detection(barrier):
    # Calendar inversion: sigma(t2)^2 * t2 < sigma(t1)^2 * t1
    # Example: t1=0.50, iv1=0.40 => w1 = 0.16 * 0.50 = 0.08
    # t2=0.60, iv2=0.20 => w2 = 0.04 * 0.60 = 0.024 < 0.08
    quotes_t1 = {"atm": 0.40, "otm_put": 0.45, "otm_call": 0.38}
    quotes_t2 = {"atm": 0.20, "otm_put": 0.22, "otm_call": 0.19}

    slice_res = barrier.compute_forward_slice(
        spot=100.0,
        t1=0.50,
        t2=0.60,
        quotes_t1=quotes_t1,
        quotes_t2=quotes_t2,
        otm_put_strike=90.0,
        otm_call_strike=110.0,
    )

    assert slice_res.calendar_arbitrage_detected
    assert slice_res.state == ForwardSkewState.CALENDAR_VARIANCE_INVERSION

    tail = barrier.assess_tail_risk(
        spot=100.0,
        portfolio_notional=1_000_000,
        forward_slice=slice_res,
        otm_put_strike=90.0,
    )

    assert tail.directive == TailBarrierDirective.EXECUTE_CALENDAR_ARB


def test_invalid_expiry(barrier):
    quotes = {"atm": 0.20, "otm_put": 0.22, "otm_call": 0.20}
    with pytest.raises(ValueError):
        barrier.compute_forward_slice(
            spot=100.0,
            t1=0.50,
            t2=0.40,  # Invalid t2 < t1
            quotes_t1=quotes,
            quotes_t2=quotes,
            otm_put_strike=90.0,
            otm_call_strike=110.0,
        )
