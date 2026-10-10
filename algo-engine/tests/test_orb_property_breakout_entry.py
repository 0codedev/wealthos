"""Property 24 - Breakout beyond the range triggers a direction-correct entry
with sized exits.

Feature: intraday-strategy-suite, Property 24

Validates: Requirements 11.2, 11.3, 11.6, 11.7

For any flat, in-window, post-range state where ``close`` exceeds the
Opening_Range high (and all enabled filters pass) the ORB Enhanced strategy emits
a "BUY"; where ``close`` falls below the Opening_Range low it emits a "SELL". For
any such entry the ``stop_loss`` and ``target`` *distances* equal
``range_size * stop_multiplier`` and ``range_size * target_multiplier``
respectively, placed on the correct side of the entry (Req 11.6). ``range_size``
is the locked Opening_Range size ``or_high - or_low`` (Req 11.7 exposes the
multipliers as Config).

Construction
------------
To isolate the *breakout geometry* the two confirmation filters are disabled for
this property: ``require_retest=False`` and ``require_volume_confirmation=False``
(those filters own their dedicated tests 5.6 / 5.7). The candle stream is:

  1. An opening-range candle (09:15:00) carrying ``high == or_high`` and
     ``low == or_low`` - this establishes the known range ``[or_low, or_high]``.
  2. A second in-window candle wholly *inside* the range (does not move it).
  3. A "lock" candle at exactly ``range_end`` whose close sits inside the range
     so it locks the range without itself breaking out.
  4. A single post-range, in-window breakout candle whose ``close`` is placed a
     strictly-positive ``excess`` beyond the relevant boundary.

``warmup_period`` is small enough that the breakout candle clears the warmup gate,
and ``capital`` is sized from ``range_size * stop_multiplier * quantity`` so the
2% risk gate always passes and never vetoes the entry under test. The opening-range
window length is parametrized over the two supported values (15 / 30 minutes) and
times are emitted as both ``datetime.time`` and ``"%H:%M:%S"`` strings.
"""

from __future__ import annotations

import datetime as _dt
import math

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from strategies.orb_enhanced import ORBEnhanced


_MARKET_OPEN_SECONDS = 9 * 3600 + 15 * 60  # 09:15:00


def _mk_time(total_seconds: int, as_string: bool) -> object:
    """Build a candle time from a second-of-day offset."""
    h, rem = divmod(total_seconds, 3600)
    m, s = divmod(rem, 60)
    t = _dt.time(hour=h, minute=m, second=s)
    return t.strftime("%H:%M:%S") if as_string else t


def _flat_candle(price: float, total_seconds: int, as_string: bool) -> dict:
    """A candle with high == low == close == price (no volume field)."""
    return {
        "high": price,
        "low": price,
        "close": price,
        "time": _mk_time(total_seconds, as_string),
    }


def _range_candle(or_low: float, or_high: float, total_seconds: int,
                  as_string: bool) -> dict:
    """A candle that spans the full opening range to establish [or_low, or_high]."""
    return {
        "high": or_high,
        "low": or_low,
        "close": (or_low + or_high) / 2.0,
        "time": _mk_time(total_seconds, as_string),
    }


# Feature: intraday-strategy-suite, Property 24
@pytest.mark.property
@settings(max_examples=100)
@given(
    or_low=st.floats(min_value=200.0, max_value=4000.0,
                     allow_nan=False, allow_infinity=False),
    range_size=st.floats(min_value=1.0, max_value=200.0,
                         allow_nan=False, allow_infinity=False),
    excess=st.floats(min_value=0.5, max_value=50.0,
                     allow_nan=False, allow_infinity=False),
    stop_multiplier=st.floats(min_value=0.5, max_value=3.0,
                              allow_nan=False, allow_infinity=False),
    target_multiplier=st.floats(min_value=0.5, max_value=5.0,
                                allow_nan=False, allow_infinity=False),
    quantity=st.integers(min_value=1, max_value=100),
    opening_range_minutes=st.sampled_from([15, 30]),
    side=st.sampled_from(["BUY", "SELL"]),
    as_string=st.booleans(),
)
def test_orb_breakout_entry_direction_and_sized_exits(
    or_low,
    range_size,
    excess,
    stop_multiplier,
    target_multiplier,
    quantity,
    opening_range_minutes,
    side,
    as_string,
):
    """A post-range breakout fixes the entry direction and range-sized exits."""
    or_high = or_low + range_size
    midpoint = (or_low + or_high) / 2.0

    # The breakout close sits a strictly-positive ``excess`` beyond the boundary.
    if side == "BUY":
        breakout_close = or_high + excess
    else:
        breakout_close = or_low - excess
    assert breakout_close > 0.0  # parameter ranges keep this safe

    # Size capital so the 2% risk gate always passes: the projected loss equals
    # range_size * stop_multiplier * quantity, which must be <= 0.02 * capital.
    projected_loss = range_size * stop_multiplier * quantity
    capital = (projected_loss / 0.02) * 5.0

    config = {
        "instrument": "2885",
        "quantity": quantity,
        "capital": capital,
        "opening_range_minutes": opening_range_minutes,
        # Isolate the breakout geometry -- the confirmation filters are tested
        # in their own dedicated property tests (5.6 retest, 5.7 volume).
        "require_retest": False,
        "require_volume_confirmation": False,
        "stop_multiplier": stop_multiplier,
        "target_multiplier": target_multiplier,
        "warmup_period": 2,
        "max_trades_per_day": 5,
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }
    strategy = ORBEnhanced(config=config)

    range_end_seconds = _MARKET_OPEN_SECONDS + opening_range_minutes * 60

    # 1. Opening-range candle spanning [or_low, or_high] (09:15:00).
    sig = strategy.on_candle(_range_candle(or_low, or_high, _MARKET_OPEN_SECONDS,
                                           as_string))
    assert sig is None, "range-establishing candle must not emit a signal"

    # 2. A second in-window candle inside the range (09:16:00) -- warmup + no move.
    sig = strategy.on_candle(_flat_candle(midpoint, _MARKET_OPEN_SECONDS + 60,
                                          as_string))
    assert sig is None, "in-range warmup candle must not emit a signal"

    # 3. Lock candle at range_end with close inside the range (locks, no breakout).
    sig = strategy.on_candle(_flat_candle(midpoint, range_end_seconds, as_string))
    assert sig is None, "range-lock candle must not emit a signal"
    assert strategy.state.range_locked, "opening range must be locked after range_end"
    assert math.isclose(strategy.state.or_high, or_high, rel_tol=1e-9, abs_tol=1e-6)
    assert math.isclose(strategy.state.or_low, or_low, rel_tol=1e-9, abs_tol=1e-6)
    assert strategy.state.position is None, "strategy must be flat before the breakout"

    # 4. The breakout candle (range_end + 1 minute), still in-window and flat.
    breakout = _flat_candle(breakout_close, range_end_seconds + 60, as_string)
    signal = strategy.on_candle(breakout)

    assert signal is not None, (
        f"close {breakout_close} beyond OR [{or_low}, {or_high}] must emit an entry"
    )

    # Direction follows the broken boundary (Req 11.2, 11.3).
    assert signal.direction == side
    entry = signal.price
    assert math.isclose(entry, breakout_close, rel_tol=1e-9, abs_tol=1e-6)

    # Exit distances are sized from the range (Req 11.6, 11.7).
    expected_stop_dist = range_size * stop_multiplier
    expected_target_dist = range_size * target_multiplier

    if side == "BUY":
        assert math.isclose(signal.stop_loss, entry - expected_stop_dist,
                            rel_tol=1e-7, abs_tol=1e-6)
        assert math.isclose(signal.target, entry + expected_target_dist,
                            rel_tol=1e-7, abs_tol=1e-6)
        assert signal.stop_loss < entry, "BUY stop must sit below entry"
        assert signal.target > entry, "BUY target must sit above entry"
    else:
        assert math.isclose(signal.stop_loss, entry + expected_stop_dist,
                            rel_tol=1e-7, abs_tol=1e-6)
        assert math.isclose(signal.target, entry - expected_target_dist,
                            rel_tol=1e-7, abs_tol=1e-6)
        assert signal.stop_loss > entry, "SELL stop must sit above entry"
        assert signal.target < entry, "SELL target must sit below entry"

    # The configured quantity is used verbatim (Req 5.4 / sized for the risk gate).
    assert signal.quantity == quantity
