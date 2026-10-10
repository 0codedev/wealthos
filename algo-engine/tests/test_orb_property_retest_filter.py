"""Property 25 - Retest filter gates breakout emission.

Feature: intraday-strategy-suite, Property 25

Validates: Requirements 11.4

For any breakout while ``require_retest`` is enabled, no Signal is emitted until
price retests the broken Opening_Range boundary and resumes in the breakout
direction; with the *same* data and ``require_retest`` disabled, the breakout
Signal is emitted at the breakout candle (Req 11.4).

Construction
------------
To isolate the *retest* behaviour the volume-confirmation filter is disabled for
this property (``require_volume_confirmation=False``; that filter owns its own
dedicated test 5.7). A single candle stream is built once and replayed against
two independently-constructed ``ORBEnhanced`` instances differing only in the
``require_retest`` flag:

  1. An opening-range candle (09:15:00) spanning ``[or_low, or_high]`` - this
     establishes the known range.
  2. A second in-window candle wholly *inside* the range (warmup, no move).
  3. A "lock" candle at exactly ``range_end`` whose close sits inside the range
     so it locks the range without itself breaking out.
  4. A breakout candle whose ``close`` sits a strictly-positive ``excess`` beyond
     the relevant boundary.
  5. A retest candle that returns to / inside the broken boundary (price retests
     the boundary) without resuming through it.
  6. A resume candle whose ``close`` again clears the boundary in the breakout
     direction.

``warmup_period`` is small enough that the breakout candle clears the warmup
gate, and ``capital`` is sized from ``range_size * stop_multiplier * quantity`` so
the 2% risk gate always passes and never vetoes the entry under test. The
opening-range window length is parametrized over the two supported values
(15 / 30 minutes) and times are emitted as both ``datetime.time`` and
``"%H:%M:%S"`` strings.

Assertions
----------
  - ``require_retest=False``: the Signal fires at the breakout candle (step 4).
  - ``require_retest=True``: NO Signal at the breakout candle, NO Signal at the
    retest candle, and a Signal fires only at the resume candle (step 6), in the
    correct breakout direction.
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


def _make_strategy(config: dict, require_retest: bool) -> ORBEnhanced:
    """Build a fresh ORBEnhanced with ``require_retest`` overridden."""
    cfg = dict(config)
    cfg["require_retest"] = require_retest
    return ORBEnhanced(config=cfg)


# Feature: intraday-strategy-suite, Property 25
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
def test_orb_retest_filter_gates_breakout_emission(
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
    """The retest filter defers emission until a retest-and-resume sequence."""
    or_high = or_low + range_size
    midpoint = (or_low + or_high) / 2.0

    # The breakout / resume close sits a strictly-positive ``excess`` beyond the
    # boundary in the breakout direction.
    if side == "BUY":
        breakout_close = or_high + excess
    else:
        breakout_close = or_low - excess
    assert breakout_close > 0.0  # parameter ranges keep this safe

    # Size capital so the 2% risk gate always passes: the projected loss equals
    # range_size * stop_multiplier * quantity, which must be <= 0.02 * capital.
    projected_loss = range_size * stop_multiplier * quantity
    capital = (projected_loss / 0.02) * 5.0

    base_config = {
        "instrument": "2885",
        "quantity": quantity,
        "capital": capital,
        "opening_range_minutes": opening_range_minutes,
        # Isolate the retest behaviour -- the volume filter is tested in 5.7.
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

    range_end_seconds = _MARKET_OPEN_SECONDS + opening_range_minutes * 60

    # Build the shared candle stream once (steps 1-6).
    c_range = _range_candle(or_low, or_high, _MARKET_OPEN_SECONDS, as_string)
    c_warmup = _flat_candle(midpoint, _MARKET_OPEN_SECONDS + 60, as_string)
    c_lock = _flat_candle(midpoint, range_end_seconds, as_string)
    c_breakout = _flat_candle(breakout_close, range_end_seconds + 60, as_string)
    # Retest candle: a flat candle at the range midpoint returns price to / inside
    # the broken boundary (low <= or_high for a BUY break, high >= or_low for a
    # SELL break) without resuming through it (close stays inside the range).
    c_retest = _flat_candle(midpoint, range_end_seconds + 120, as_string)
    # Resume candle: close again clears the boundary in the breakout direction.
    c_resume = _flat_candle(breakout_close, range_end_seconds + 180, as_string)

    # -----------------------------------------------------------------
    # require_retest = False: the breakout candle emits immediately.
    # -----------------------------------------------------------------
    s_off = _make_strategy(base_config, require_retest=False)
    assert s_off.on_candle(c_range) is None
    assert s_off.on_candle(c_warmup) is None
    assert s_off.on_candle(c_lock) is None
    assert s_off.state.range_locked, "opening range must lock by range_end"

    sig_off = s_off.on_candle(c_breakout)
    assert sig_off is not None, (
        f"with require_retest disabled, close {breakout_close} beyond OR "
        f"[{or_low}, {or_high}] must emit at the breakout candle"
    )
    assert sig_off.direction == side
    assert math.isclose(sig_off.price, breakout_close, rel_tol=1e-9, abs_tol=1e-6)

    # -----------------------------------------------------------------
    # require_retest = True: emission is deferred until retest-and-resume.
    # -----------------------------------------------------------------
    s_on = _make_strategy(base_config, require_retest=True)
    assert s_on.on_candle(c_range) is None
    assert s_on.on_candle(c_warmup) is None
    assert s_on.on_candle(c_lock) is None
    assert s_on.state.range_locked, "opening range must lock by range_end"

    # The breakout candle only *arms* the retest filter -- no Signal yet.
    assert s_on.on_candle(c_breakout) is None, (
        "with require_retest enabled, the breakout candle must NOT emit a Signal"
    )
    assert s_on.state.position is None, "no position may open at the breakout candle"

    # The retest candle returns price to the boundary but does not resume -- still
    # no Signal.
    assert s_on.on_candle(c_retest) is None, (
        "the retest candle must NOT emit a Signal (price has not yet resumed)"
    )
    assert s_on.state.position is None, "no position may open at the retest candle"

    # The resume candle clears the boundary again in the breakout direction -- the
    # Signal fires now and only now.
    sig_on = s_on.on_candle(c_resume)
    assert sig_on is not None, (
        "the Signal must fire on the retest-and-resume candle"
    )
    assert sig_on.direction == side
    assert math.isclose(sig_on.price, breakout_close, rel_tol=1e-9, abs_tol=1e-6)
    assert sig_on.quantity == quantity
