"""Property 19 - VWAP deviation determines entry direction and exit geometry.

Feature: intraday-strategy-suite, Property 19

Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6

For any flat, in-window state where ``close`` is below VWAP by at least
``entry_deviation``, the VWAP Mean Reversion strategy emits a "BUY" with
``stop_loss`` below entry by ``stop_distance`` and ``target`` toward VWAP (above
entry). Where ``close`` is above VWAP by at least ``entry_deviation``, it emits a
"SELL" with ``stop_loss`` above entry by ``stop_distance`` and ``target`` toward
VWAP (below entry).

Construction
------------
To force a *known* VWAP we feed ``warmup_period`` "flat" warmup candles whose
high == low == close == ``P`` (typical price == ``P``) carrying a constant
``volume`` so the strategy follows its true-VWAP path. With equal volumes the
running VWAP is the simple mean of the typical prices, so after the flat warmup
the VWAP equals ``P`` exactly.

A single final in-window candle then deviates. Because the final candle's own
typical price is folded into the running VWAP, we solve for the exact close that
lands the post-update deviation at ``-(entry_deviation + excess)`` (BUY) or
``+(entry_deviation + excess)`` (SELL):

    close = P  -/+  (entry_deviation + excess) * (N + 1) / N

where ``N`` is the number of warmup candles. This guarantees the deviation is
strictly beyond ``entry_deviation`` (by ``excess > 0``) regardless of the drawn
parameters, so the entry must fire.

``capital`` is sized from ``stop_distance * quantity`` so the 2% risk gate always
passes and never vetoes the entry under test.
"""

from __future__ import annotations

import datetime as _dt
import math

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from strategies.vwap_mean_reversion import VWAPMeanReversion


_CONST_VOLUME = 1000.0
_FIRST_CANDLE_SECONDS = 9 * 3600 + 20 * 60  # 09:20:00 -- safely inside the window


def _time_at(index: int, as_string: bool) -> object:
    """Return the in-window candle time for position ``index`` (one minute apart)."""
    total = _FIRST_CANDLE_SECONDS + index * 60
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    t = _dt.time(hour=h, minute=m, second=s)
    return t.strftime("%H:%M:%S") if as_string else t


def _flat_candle(price: float, index: int, as_string: bool) -> dict:
    """A candle with high == low == close == price (typical price == price)."""
    return {
        "high": price,
        "low": price,
        "close": price,
        "time": _time_at(index, as_string),
        "volume": _CONST_VOLUME,
    }


# Feature: intraday-strategy-suite, Property 19
@pytest.mark.property
@settings(max_examples=100)
@given(
    base_price=st.floats(min_value=500.0, max_value=5000.0,
                         allow_nan=False, allow_infinity=False),
    entry_deviation=st.floats(min_value=0.5, max_value=50.0,
                              allow_nan=False, allow_infinity=False),
    excess=st.floats(min_value=0.5, max_value=20.0,
                     allow_nan=False, allow_infinity=False),
    stop_distance=st.floats(min_value=0.5, max_value=50.0,
                            allow_nan=False, allow_infinity=False),
    warmup_n=st.integers(min_value=2, max_value=8),
    quantity=st.integers(min_value=1, max_value=100),
    side=st.sampled_from(["BUY", "SELL"]),
    as_string=st.booleans(),
)
def test_vwap_deviation_entry_direction_and_geometry(
    base_price,
    entry_deviation,
    excess,
    stop_distance,
    warmup_n,
    quantity,
    side,
    as_string,
):
    """Deviation past the threshold fixes the entry direction and exit geometry."""
    p = base_price
    n = warmup_n
    dev_total = entry_deviation + excess          # deviation magnitude past 0
    shift = dev_total * (n + 1) / n               # close offset so deviation == dev_total

    # Solve the final close so the post-update deviation is exactly -/+ dev_total.
    if side == "BUY":
        final_close = p - shift
    else:
        final_close = p + shift
    # Stay strictly positive (parameter ranges keep shift well below base_price).
    assert final_close > 0.0

    # Size capital so the 2% risk gate comfortably passes (never vetoes the entry).
    # projected_loss = stop_distance * quantity must be <= 0.02 * capital.
    capital = (stop_distance * quantity / 0.02) * 5.0

    config = {
        "instrument": "1333",
        "quantity": quantity,
        "capital": capital,
        "entry_deviation": entry_deviation,
        "stop_distance": stop_distance,
        "warmup_period": n,
        "max_trades_per_day": 5,
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }
    strategy = VWAPMeanReversion(config=config)

    # Flat warmup at price P -> running VWAP == P, no signal (deviation 0).
    for i in range(n):
        warmup_signal = strategy.on_candle(_flat_candle(p, i, as_string))
        assert warmup_signal is None, "flat warmup candle must not emit a signal"
    assert strategy.state.position is None, "strategy must be flat before the entry"

    # Reference VWAP after the final candle: equal volumes -> mean of typicals.
    typicals = [p] * n + [final_close]
    expected_vwap = sum(typicals) / len(typicals)

    final_candle = _flat_candle(final_close, n, as_string)
    final_candle["close"] = final_close
    final_candle["high"] = final_close
    final_candle["low"] = final_close

    signal = strategy.on_candle(final_candle)

    assert signal is not None, (
        f"deviation {dev_total} >= entry_deviation {entry_deviation} must emit an entry"
    )
    entry = signal.price

    # Direction follows the side of the deviation (Req 9.2, 9.3).
    assert signal.direction == side

    # Entry price is the deviating close.
    assert math.isclose(entry, final_close, rel_tol=1e-9, abs_tol=1e-6)

    # Target is at / toward VWAP (Req 9.4, 9.5).
    assert math.isclose(signal.target, expected_vwap, rel_tol=1e-7, abs_tol=1e-6), (
        f"target {signal.target!r} != VWAP {expected_vwap!r}"
    )

    if side == "BUY":
        # stop_loss below entry by stop_distance; target above entry toward VWAP.
        assert math.isclose(signal.stop_loss, entry - stop_distance,
                            rel_tol=1e-9, abs_tol=1e-6)
        assert signal.stop_loss < entry, "BUY stop must sit below entry"
        assert signal.target > entry, "BUY target must sit above entry (toward VWAP)"
    else:
        # stop_loss above entry by stop_distance; target below entry toward VWAP.
        assert math.isclose(signal.stop_loss, entry + stop_distance,
                            rel_tol=1e-9, abs_tol=1e-6)
        assert signal.stop_loss > entry, "SELL stop must sit above entry"
        assert signal.target < entry, "SELL target must sit below entry (toward VWAP)"
