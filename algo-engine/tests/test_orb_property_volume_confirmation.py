"""Property 26 - Volume confirmation gates breakout emission when volume is
present, and degrades when absent.

Feature: intraday-strategy-suite, Property 26

Validates: Requirements 11.5, 2.5

For any breakout candle while ``require_volume_confirmation`` is enabled and a
valid ``volume`` is present, the ORB Enhanced strategy emits the breakout Signal
*only* when the breakout candle ``volume`` exceeds ``volume_multiple`` times the
rolling average of the prior candles' volume (Req 11.5). When ``volume`` is
absent the volume-confirmation filter is treated as *disabled* (degraded mode)
and a price-valid breakout still emits a Signal (Req 2.5).

Construction
------------
To isolate the *volume* filter the retest filter is disabled
(``require_retest=False``) so a raw price breakout emits as soon as the volume
filter allows it; the retest filter owns its dedicated property test (5.6).

Reading ``_update_indicators`` / ``_decide`` of ``ORBEnhanced``:

  - On every candle carrying a valid ``volume`` the strategy sets ``vol_avg`` to
    the mean of the rolling window of the *prior* candles' volumes (the current
    candle's volume is appended *after* that average is computed), keeping at most
    ``volume_lookback`` (default 20) entries.
  - ``_volume_filter`` lets a breakout through only when the current candle's
    ``volume`` is strictly greater than ``volume_multiple * vol_avg`` (and
    ``vol_avg`` is a positive number).

The candle stream mirrors the breakout-entry property:

  1. An opening-range candle (09:15:00) spanning ``[or_low, or_high]``.
  2. An in-range candle (09:16:00) that does not move the range.
  3. A lock candle at exactly ``range_end`` (close inside the range -> locks).
  4. A single post-range, in-window breakout candle whose ``close`` is placed a
     strictly-positive ``excess`` beyond the relevant boundary.

The first three candles each carry the same ``base_vol`` so the rolling average
seen by the breakout candle equals ``base_vol`` exactly, giving a known threshold
``volume_multiple * base_vol``. ``capital`` is sized from
``range_size * stop_multiplier * quantity`` so the 2% risk gate never vetoes the
entry under test. Times are emitted as both ``datetime.time`` and ``"%H:%M:%S"``.
"""

from __future__ import annotations

import datetime as _dt

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from strategies.orb_enhanced import ORBEnhanced


_MARKET_OPEN_SECONDS = 9 * 3600 + 15 * 60  # 09:15:00
_STRATEGY_NAME = "ORB_Enhanced_v1"


def _mk_time(total_seconds: int, as_string: bool) -> object:
    """Build a candle time from a second-of-day offset."""
    h, rem = divmod(total_seconds, 3600)
    m, s = divmod(rem, 60)
    t = _dt.time(hour=h, minute=m, second=s)
    return t.strftime("%H:%M:%S") if as_string else t


def _candle(high, low, close, total_seconds, as_string, volume=None):
    """A candle dict; ``volume`` is included only when not None."""
    c = {
        "high": high,
        "low": low,
        "close": close,
        "time": _mk_time(total_seconds, as_string),
    }
    if volume is not None:
        c["volume"] = volume
    return c


def _flat(price, total_seconds, as_string, volume=None):
    """A flat candle with high == low == close == price."""
    return _candle(price, price, price, total_seconds, as_string, volume)


def _range_candle(or_low, or_high, total_seconds, as_string, volume=None):
    """A candle that spans the full opening range to establish [or_low, or_high]."""
    return _candle(or_high, or_low, (or_low + or_high) / 2.0,
                   total_seconds, as_string, volume)


def _base_config(or_low, range_size, stop_multiplier, target_multiplier,
                 quantity, opening_range_minutes, require_volume_confirmation):
    """Config sized so the 2% risk gate always passes for the breakout under test."""
    projected_loss = range_size * stop_multiplier * quantity
    capital = (projected_loss / 0.02) * 5.0
    return {
        "instrument": "2885",
        "quantity": quantity,
        "capital": capital,
        "opening_range_minutes": opening_range_minutes,
        # Isolate the volume filter: the retest filter has its own test (5.6).
        "require_retest": False,
        "require_volume_confirmation": require_volume_confirmation,
        "volume_multiple": 1.5,  # overridden per-test where relevant
        "stop_multiplier": stop_multiplier,
        "target_multiplier": target_multiplier,
        "warmup_period": 2,
        "max_trades_per_day": 5,
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }


def _drive_to_breakout(strategy, or_low, or_high, opening_range_minutes,
                       as_string, prior_volume, breakout_volume, side, excess):
    """Feed the 4-candle stream and return the breakout Signal (or None).

    The opening-range, in-range and lock candles each carry ``prior_volume``;
    the breakout candle carries ``breakout_volume``. ``prior_volume`` /
    ``breakout_volume`` may be None to omit the field entirely (degraded mode).
    """
    midpoint = (or_low + or_high) / 2.0
    range_end_seconds = _MARKET_OPEN_SECONDS + opening_range_minutes * 60

    # 1. Opening-range candle spanning [or_low, or_high].
    assert strategy.on_candle(
        _range_candle(or_low, or_high, _MARKET_OPEN_SECONDS, as_string,
                      prior_volume)
    ) is None

    # 2. In-range warmup candle (does not move the range).
    assert strategy.on_candle(
        _flat(midpoint, _MARKET_OPEN_SECONDS + 60, as_string, prior_volume)
    ) is None

    # 3. Lock candle at range_end (close inside range -> locks, no breakout).
    assert strategy.on_candle(
        _flat(midpoint, range_end_seconds, as_string, prior_volume)
    ) is None
    assert strategy.state.range_locked
    assert strategy.state.position is None

    # 4. Breakout candle: close placed a strictly-positive ``excess`` beyond
    #    the relevant boundary.
    breakout_close = (or_high + excess) if side == "BUY" else (or_low - excess)
    breakout = _flat(breakout_close, range_end_seconds + 60, as_string,
                     breakout_volume)
    return strategy.on_candle(breakout), breakout_close


# ---------------------------------------------------------------------------
# Case (a): volume present and ABOVE the threshold -> the breakout emits.
# ---------------------------------------------------------------------------
# Feature: intraday-strategy-suite, Property 26
@pytest.mark.property
@settings(max_examples=100)
@given(
    or_low=st.floats(min_value=200.0, max_value=4000.0,
                     allow_nan=False, allow_infinity=False),
    range_size=st.floats(min_value=1.0, max_value=200.0,
                         allow_nan=False, allow_infinity=False),
    excess=st.floats(min_value=0.5, max_value=50.0,
                     allow_nan=False, allow_infinity=False),
    base_vol=st.floats(min_value=1_000.0, max_value=1_000_000.0,
                       allow_nan=False, allow_infinity=False),
    volume_multiple=st.floats(min_value=1.1, max_value=3.0,
                              allow_nan=False, allow_infinity=False),
    above_factor=st.floats(min_value=1.01, max_value=3.0,
                           allow_nan=False, allow_infinity=False),
    quantity=st.integers(min_value=1, max_value=100),
    opening_range_minutes=st.sampled_from([15, 30]),
    side=st.sampled_from(["BUY", "SELL"]),
    as_string=st.booleans(),
)
def test_volume_present_above_threshold_emits(
    or_low, range_size, excess, base_vol, volume_multiple, above_factor,
    quantity, opening_range_minutes, side, as_string,
):
    """A price-valid breakout whose volume clears the threshold emits a Signal."""
    or_high = or_low + range_size
    config = _base_config(or_low, range_size, 1.0, 2.0, quantity,
                          opening_range_minutes, require_volume_confirmation=True)
    config["volume_multiple"] = volume_multiple
    strategy = ORBEnhanced(config=config)

    # Rolling average seen by the breakout candle == base_vol; breakout volume is
    # placed strictly above ``volume_multiple * base_vol``.
    breakout_vol = volume_multiple * base_vol * above_factor

    signal, breakout_close = _drive_to_breakout(
        strategy, or_low, or_high, opening_range_minutes, as_string,
        prior_volume=base_vol, breakout_volume=breakout_vol,
        side=side, excess=excess,
    )

    assert signal is not None, (
        f"volume {breakout_vol} > {volume_multiple} * avg {base_vol} must emit"
    )
    assert signal.direction == side
    assert signal.price == pytest.approx(breakout_close, rel=1e-9, abs=1e-6)
    # Volume-confirmed entries receive the +0.2 volume confidence boost; with the
    # retest filter disabled the base is 0.6, so a confirmed entry reads 0.8.
    assert signal.confidence == pytest.approx(0.8, abs=1e-9)


# ---------------------------------------------------------------------------
# Case (b): volume present but BELOW the threshold -> no Signal.
# ---------------------------------------------------------------------------
# Feature: intraday-strategy-suite, Property 26
@pytest.mark.property
@settings(max_examples=100)
@given(
    or_low=st.floats(min_value=200.0, max_value=4000.0,
                     allow_nan=False, allow_infinity=False),
    range_size=st.floats(min_value=1.0, max_value=200.0,
                         allow_nan=False, allow_infinity=False),
    excess=st.floats(min_value=0.5, max_value=50.0,
                     allow_nan=False, allow_infinity=False),
    base_vol=st.floats(min_value=1_000.0, max_value=1_000_000.0,
                       allow_nan=False, allow_infinity=False),
    volume_multiple=st.floats(min_value=1.1, max_value=3.0,
                              allow_nan=False, allow_infinity=False),
    below_factor=st.floats(min_value=0.0, max_value=0.99,
                           allow_nan=False, allow_infinity=False),
    quantity=st.integers(min_value=1, max_value=100),
    opening_range_minutes=st.sampled_from([15, 30]),
    side=st.sampled_from(["BUY", "SELL"]),
    as_string=st.booleans(),
)
def test_volume_present_below_threshold_no_emit(
    or_low, range_size, excess, base_vol, volume_multiple, below_factor,
    quantity, opening_range_minutes, side, as_string,
):
    """A price-valid breakout whose volume fails the threshold is rejected."""
    or_high = or_low + range_size
    config = _base_config(or_low, range_size, 1.0, 2.0, quantity,
                          opening_range_minutes, require_volume_confirmation=True)
    config["volume_multiple"] = volume_multiple
    strategy = ORBEnhanced(config=config)

    # Breakout volume placed strictly below ``volume_multiple * base_vol``.
    breakout_vol = volume_multiple * base_vol * below_factor

    signal, _ = _drive_to_breakout(
        strategy, or_low, or_high, opening_range_minutes, as_string,
        prior_volume=base_vol, breakout_volume=breakout_vol,
        side=side, excess=excess,
    )

    assert signal is None, (
        f"volume {breakout_vol} <= {volume_multiple} * avg {base_vol} must not emit"
    )
    assert strategy.state.position is None


# ---------------------------------------------------------------------------
# Case (c): volume ABSENT -> degraded mode; a price-valid breakout still emits.
# ---------------------------------------------------------------------------
# Feature: intraday-strategy-suite, Property 26
@pytest.mark.property
@settings(max_examples=100,
          suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    or_low=st.floats(min_value=200.0, max_value=4000.0,
                     allow_nan=False, allow_infinity=False),
    range_size=st.floats(min_value=1.0, max_value=200.0,
                         allow_nan=False, allow_infinity=False),
    excess=st.floats(min_value=0.5, max_value=50.0,
                     allow_nan=False, allow_infinity=False),
    quantity=st.integers(min_value=1, max_value=100),
    opening_range_minutes=st.sampled_from([15, 30]),
    side=st.sampled_from(["BUY", "SELL"]),
    as_string=st.booleans(),
)
def test_volume_absent_degrades_and_emits(
    or_low, range_size, excess, quantity, opening_range_minutes, side,
    as_string, logger_capture,
):
    """With volume absent the filter is disabled and a price break still emits."""
    or_high = or_low + range_size
    config = _base_config(or_low, range_size, 1.0, 2.0, quantity,
                          opening_range_minutes, require_volume_confirmation=True)
    strategy = ORBEnhanced(config=config)

    cap = logger_capture(_STRATEGY_NAME)

    # Every candle omits the ``volume`` field entirely (degraded mode).
    signal, breakout_close = _drive_to_breakout(
        strategy, or_low, or_high, opening_range_minutes, as_string,
        prior_volume=None, breakout_volume=None,
        side=side, excess=excess,
    )

    assert signal is not None, "a price-valid breakout must emit in degraded mode"
    assert signal.direction == side
    assert signal.price == pytest.approx(breakout_close, rel=1e-9, abs=1e-6)
    # No volume confirmation in degraded mode -> no +0.2 volume boost; with the
    # retest filter disabled the confidence stays at the 0.6 base.
    assert signal.confidence == pytest.approx(0.6, abs=1e-9)
    assert strategy.state.degraded is True
    # A degraded-mode debug log is emitted (Req 2.5 / 2.8).
    assert cap.contains("degraded")
