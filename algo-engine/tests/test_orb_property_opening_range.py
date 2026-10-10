# Feature: intraday-strategy-suite, Property 23
"""Property 23 - Opening range equals the extremes of the range period.

This module owns a single model-based property for the Opening Range Breakout
(Enhanced) strategy: after the ``opening_range_minutes`` window closes, the locked
``Opening_Range`` high must equal the maximum ``high`` and the ``Opening_Range`` low
must equal the minimum ``low`` over the candles observed *within* that window.

Strategy under test: ``strategies.orb_enhanced.ORBEnhanced``.

Window membership (confirmed against ``ORBEnhanced._update_indicators``): a candle is
inside the opening range when ``market_open <= time < market_open + opening_range_minutes``.
The first candle at/after ``market_open + opening_range_minutes`` *locks* the range
(``state.range_locked`` becomes True) and breakout evaluation begins. The indicator
update runs before any market-hours / warmup / entry gate, so the accumulated range
reflects the whole window regardless of whether signals are emitted.

To exercise the boundary deterministically the test drives a single-day candle
sequence whose times start at Market_Open (09:15:00) and advance in 1-minute steps,
spanning strictly past the opening-range window so the range is guaranteed to lock.
High/low/close values are drawn freely; only the times are controlled.

Validates: Requirements 11.1
"""

from __future__ import annotations

import datetime as _dt

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import generators as gen

from strategies.orb_enhanced import ORBEnhanced


_MARKET_OPEN = _dt.time(9, 15, 0)


def _add_minutes(t: _dt.time, minutes: int) -> _dt.time:
    base = _dt.datetime.combine(_dt.date(2000, 1, 1), t)
    return (base + _dt.timedelta(minutes=minutes)).time()


@st.composite
def orb_days(draw):
    """A single-day candle sequence at 1-minute steps from 09:15:00.

    Returns ``(opening_range_minutes, candles, time_as_string)``. The sequence always
    spans strictly past the opening-range window (at least one candle at/after the
    range end) so the range is guaranteed to lock.
    """
    or_minutes = draw(st.sampled_from([15, 30]))
    # At 1-minute steps, offsets 0..or_minutes-1 are inside the window. Require at
    # least one extra candle (offset >= or_minutes) so the range locks.
    n_candles = draw(st.integers(min_value=or_minutes + 1, max_value=or_minutes + 15))
    time_as_string = draw(st.booleans())

    candles = []
    for offset in range(n_candles):
        low = draw(gen.prices())
        high = draw(gen.prices())
        if low > high:
            low, high = high, low
        if high == low:
            close = low
        else:
            frac = draw(
                st.floats(min_value=0.0, max_value=1.0, allow_nan=False,
                          allow_infinity=False)
            )
            close = low + frac * (high - low)

        t = _add_minutes(_MARKET_OPEN, offset)
        candles.append(
            {
                "high": high,
                "low": low,
                "close": close,
                "time": gen.render_time(t, time_as_string),
            }
        )
    return or_minutes, candles, time_as_string


# Feature: intraday-strategy-suite, Property 23
@pytest.mark.property
@settings(max_examples=100)
@given(day=orb_days())
def test_opening_range_equals_window_extremes(day):
    """Locked Opening_Range high/low equal the max high / min low within the window."""
    or_minutes, candles, _ = day

    config = {
        "opening_range_minutes": or_minutes,
        "market_open": "09:15:00",
        # Keep warmup small so nothing else interferes; accumulation is gate-independent.
        "warmup_period": 1,
    }
    strategy = ORBEnhanced(config=config)

    range_end = _add_minutes(_MARKET_OPEN, or_minutes)

    # The candles whose time falls inside the opening-range window
    # (market_open <= time < market_open + opening_range_minutes).
    in_window_highs = []
    in_window_lows = []
    for offset, candle in enumerate(candles):
        t = _add_minutes(_MARKET_OPEN, offset)
        if _MARKET_OPEN <= t < range_end:
            in_window_highs.append(float(candle["high"]))
            in_window_lows.append(float(candle["low"]))

    for candle in candles:
        strategy.on_candle(candle)

    # The window closed (the sequence spans past it), so the range must be locked.
    assert strategy.state.range_locked is True
    assert in_window_highs and in_window_lows  # sanity: the window had candles

    assert strategy.state.or_high == max(in_window_highs)
    assert strategy.state.or_low == min(in_window_lows)
