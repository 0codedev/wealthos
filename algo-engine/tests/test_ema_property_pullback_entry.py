# Feature: intraday-strategy-suite, Property 22
"""Property 22 - Trend-aligned pullback-and-reclaim triggers entry with correct exit geometry.

For any flat, in-window state in an *up* trend where ``close`` pulls back within
``pullback_band`` of the fast or medium EMA and then closes back above it (with a
bullish body), the EMA Trend Pullback strategy emits a ``"BUY"``. The mirror case in a
*down* trend emits a ``"SELL"``. For any such entry:

  - ``stop_loss`` sits beyond the slow EMA on the correct side of entry
    (``stop_method="slow_ema"`` default: ``ema_slow - band`` for BUY,
    ``ema_slow + band`` for SELL), and
  - ``target`` satisfies ``abs(target - entry) / abs(entry - stop) ~= target_rr``.

Validates: Requirements 10.4, 10.5, 10.6, 10.8

Construction
------------
Constructing a guaranteed pullback-and-reclaim from purely random candle streams is
hard, so we drive the strategy to a *known, strictly-ordered* EMA stack with a
controlled warmup and then craft a single trigger candle from the established EMA state:

  1. Feed ``N`` warmup candles whose closes form a strict linear ramp - rising for an
     up trend (yields ``fast > med > slow``) or falling for a down trend (yields
     ``fast < med < slow``). ``warmup_period`` is set to ``N + 1`` so the entry gate
     stays closed throughout warmup and *no* signal can fire before the trigger candle.

  2. Read the established pre-trigger EMA stack (``state.ema_fast`` / ``ema_slow``).
     Because the EMA recurrence depends only on ``close`` (never on ``high`` / ``low``),
     the post-update EMAs after the trigger close ``C`` are fully determined by
     ``ema_step(prev_ema, C, period)`` - we compute them with the strategy's own
     ``_ema_step`` so the trigger candle's ``low`` / ``high`` can be placed exactly at
     the post-update fast EMA.

  3. Craft the trigger candle:
       - Up trend: continue the ramp up (``C`` above the prior close), dip ``low`` to the
         post-update fast EMA (a pullback to within ``pullback_band``) and close back
         above it with a bullish body -> must emit BUY.
       - Down trend: continue the ramp down, rally ``high`` to the post-update fast EMA
         and close back below it with a bearish body -> must emit SELL.

``capital`` is sized from the realised ``risk * quantity`` so the 2% risk gate always
passes and never vetoes the entry under test.
"""

from __future__ import annotations

import datetime as _dt
import math

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from strategies.ema_trend_pullback import EMATrendPullback


_FIRST_CANDLE_SECONDS = 9 * 3600 + 20 * 60  # 09:20:00 -- safely inside the window

# Fixed, well-separated EMA periods so the warmup ramp produces a strictly-ordered
# stack deterministically (independent of the hypothesis-drawn band / rr / step).
_FAST_P = 9
_MED_P = 21
_SLOW_P = 50


def _time_at(index: int, as_string: bool) -> object:
    """Return the candle time for position ``index`` (one minute apart)."""
    total = _FIRST_CANDLE_SECONDS + index * 60
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    t = _dt.time(hour=h, minute=m, second=s)
    return t.strftime("%H:%M:%S") if as_string else t


def _flat_candle(price: float, index: int, as_string: bool) -> dict:
    """A warmup candle with high == low == close == price (close-only drives the EMAs)."""
    return {
        "high": price,
        "low": price,
        "close": price,
        "time": _time_at(index, as_string),
    }


# Feature: intraday-strategy-suite, Property 22
@pytest.mark.property
@settings(max_examples=100)
@given(
    step=st.floats(min_value=2.0, max_value=30.0, allow_nan=False, allow_infinity=False),
    pullback_band=st.floats(min_value=0.5, max_value=40.0,
                            allow_nan=False, allow_infinity=False),
    target_rr=st.floats(min_value=0.5, max_value=5.0,
                        allow_nan=False, allow_infinity=False),
    warmup_n=st.integers(min_value=55, max_value=70),
    quantity=st.integers(min_value=1, max_value=100),
    side=st.sampled_from(["BUY", "SELL"]),
    as_string=st.booleans(),
)
def test_pullback_reclaim_entry_direction_and_exit_geometry(
    step,
    pullback_band,
    target_rr,
    warmup_n,
    quantity,
    side,
    as_string,
):
    """A trend-aligned pullback-and-reclaim emits the correct side with correct geometry."""
    base = 10_000.0
    n = warmup_n
    band = pullback_band

    # ----- 1. Build the warmup ramp (rising for up, falling for down). -----
    if side == "BUY":
        warmup_closes = [base + i * step for i in range(n)]
        trigger_close = warmup_closes[-1] + step      # continue up
    else:
        warmup_closes = [base - i * step for i in range(n)]
        trigger_close = warmup_closes[-1] - step      # continue down
    assert trigger_close > 0.0  # parameter ranges keep prices well positive

    config = {
        "instrument": "1333",
        "quantity": quantity,
        # capital is patched below once the realised risk is known
        "capital": 1.0,
        "ema_fast_period": _FAST_P,
        "ema_med_period": _MED_P,
        "ema_slow_period": _SLOW_P,
        "pullback_band": band,
        "stop_method": "slow_ema",
        "target_rr": target_rr,
        # warmup_period == N + 1 so the entry gate opens exactly on the trigger candle.
        "warmup_period": n + 1,
        "max_trades_per_day": 5,
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }
    strategy = EMATrendPullback(config=config)

    # ----- 2. Feed the warmup; no signal may fire while the warmup gate is closed. -----
    for i, price in enumerate(warmup_closes):
        sig = strategy.on_candle(_flat_candle(price, i, as_string))
        assert sig is None, "warmup candle must not emit a signal"
    assert strategy.state.position is None, "strategy must be flat before the trigger"

    # Pre-trigger EMA stack must be strictly ordered in the expected direction.
    f0 = strategy.state.ema_fast
    s0 = strategy.state.ema_slow
    if side == "BUY":
        assert strategy.state.ema_fast > strategy.state.ema_med > strategy.state.ema_slow
    else:
        assert strategy.state.ema_fast < strategy.state.ema_med < strategy.state.ema_slow

    # ----- 3. Post-update EMAs (close-only recurrence -> independent of high/low). -----
    ema_fast_new = EMATrendPullback._ema_step(f0, trigger_close, _FAST_P)
    ema_slow_new = EMATrendPullback._ema_step(s0, trigger_close, _SLOW_P)

    # ----- 4. Craft the trigger candle so the pullback-and-reclaim fires. -----
    if side == "BUY":
        # close reclaims above the fast EMA; low dips to it (pullback within band);
        # bullish body via open <= close.
        expected_stop = ema_slow_new - band
        trigger = {
            "high": trigger_close,
            "low": ema_fast_new,         # touch the fast EMA from above
            "close": trigger_close,
            "open": ema_fast_new,        # bullish body: close >= open
            "time": _time_at(n, as_string),
        }
        risk = trigger_close - expected_stop
    else:
        # close reclaims below the fast EMA; high rallies to it; bearish body via open >= close.
        expected_stop = ema_slow_new + band
        trigger = {
            "high": ema_fast_new,        # rally to the fast EMA from below
            "low": trigger_close,
            "close": trigger_close,
            "open": ema_fast_new,        # bearish body: close <= open
            "time": _time_at(n, as_string),
        }
        risk = expected_stop - trigger_close

    assert risk > 0.0, "construction must yield a valid (positive) risk distance"

    # Size capital so the 2% risk gate comfortably passes (never vetoes the entry).
    config["capital"] = (risk * quantity / 0.02) * 10.0

    # ----- 5. Drive the trigger candle and assert direction + exit geometry. -----
    signal = strategy.on_candle(trigger)

    assert signal is not None, "trend-aligned pullback-and-reclaim must emit an entry"
    assert signal.direction == side, f"expected {side}, got {signal.direction}"

    entry = signal.price
    assert math.isclose(entry, trigger_close, rel_tol=1e-9, abs_tol=1e-6)

    # Stop on the correct side of entry, placed beyond the slow EMA per stop_method (Req 10.6).
    assert math.isclose(signal.stop_loss, expected_stop, rel_tol=1e-7, abs_tol=1e-6), (
        f"stop {signal.stop_loss!r} != slow-EMA stop {expected_stop!r}"
    )
    if side == "BUY":
        assert signal.stop_loss < entry, "BUY stop must sit below entry"
        assert signal.target > entry, "BUY target must sit above entry"
    else:
        assert signal.stop_loss > entry, "SELL stop must sit above entry"
        assert signal.target < entry, "SELL target must sit below entry"

    # Reward-to-risk geometry: abs(target - entry) / abs(entry - stop) ~= target_rr (Req 10.8).
    realised_rr = abs(signal.target - entry) / abs(entry - signal.stop_loss)
    assert math.isclose(realised_rr, target_rr, rel_tol=1e-6, abs_tol=1e-6), (
        f"realised R:R {realised_rr!r} != target_rr {target_rr!r}"
    )

    # Confidence is always a clamped probability (Req 1.6).
    assert 0.0 <= signal.confidence <= 1.0
