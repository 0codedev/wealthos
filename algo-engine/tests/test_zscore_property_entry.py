"""Property 28 - Z-score extremes determine entry direction and exit geometry.

Feature: intraday-strategy-suite, Property 28

Validates: Requirements 12.3, 12.4, 12.5, 12.7

For any flat, in-window state where the Z_Score is at or below ``-entry_z`` the
Bollinger / Z-Score Reversion strategy emits a "BUY", and where it is at or above
``entry_z`` it emits a "SELL". For any such entry ``target`` equals the rolling
mean and ``stop_loss`` is placed ``exit_z`` standard deviations beyond entry on the
protective side (BUY: ``entry - exit_z * std``; SELL: ``entry + exit_z * std``).

Construction
------------
The strategy's rolling window is a ``deque`` with ``maxlen == lookback`` and the
*current* candle's close is appended (in ``_update_indicators``) before ``_decide``
runs. So when ``_decide`` evaluates the final candle, the window over which the
rolling mean / population std (``np.std`` with ``ddof=0``) are computed is exactly
the most recent ``lookback`` closes, *including* the final close.

To land a known, deterministic z-score we feed ``lookback`` identical "base"
candles (close == ``b``) and then a single final in-window candle (close == ``c``,
the outlier). After the final append the window is ``[b] * (lookback - 1) + [c]``
(the oldest ``b`` is evicted by ``maxlen``). For a window of ``L`` values made of
``L - 1`` identical points plus one outlier, the outlier's population z-score is
exactly ``sign(c - b) * sqrt(L - 1)`` - independent of ``b`` and the offset
magnitude. This is the maximum attainable single-point z-score for a sample of
size ``L`` (the Samuelson bound), so choosing ``entry_z = sqrt(L - 1) * frac`` with
``frac < 1`` guarantees the extreme clears the entry threshold with margin and the
entry must fire: below the base for a BUY (``z <= -entry_z``), above for a SELL
(``z >= entry_z``).

During the base-candle feed the window either is not yet full or has zero
dispersion (all closes equal -> std == 0), so the strategy emits nothing; only the
final outlier candle produces the entry under test.

The mean / std used for the assertions are recomputed with numpy over the exact
window the strategy uses. ``capital`` is sized from ``exit_z * std * quantity`` so
the 2% risk gate always passes and never vetoes the entry.
"""

from __future__ import annotations

import datetime as _dt
import math

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from strategies.zscore_reversion import ZScoreReversion


_FIRST_CANDLE_SECONDS = 9 * 3600 + 20 * 60  # 09:20:00 -- safely inside the window


def _time_at(index: int, as_string: bool) -> object:
    """Return the in-window candle time for position ``index`` (one minute apart)."""
    total = _FIRST_CANDLE_SECONDS + index * 60
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    t = _dt.time(hour=h, minute=m, second=s)
    return t.strftime("%H:%M:%S") if as_string else t


def _flat_candle(price: float, index: int, as_string: bool) -> dict:
    """A candle with high == low == close == price."""
    return {
        "high": price,
        "low": price,
        "close": price,
        "time": _time_at(index, as_string),
    }


# Feature: intraday-strategy-suite, Property 28
@pytest.mark.property
@settings(max_examples=100)
@given(
    base_price=st.floats(min_value=500.0, max_value=5000.0,
                         allow_nan=False, allow_infinity=False),
    lookback=st.integers(min_value=5, max_value=40),
    frac=st.floats(min_value=0.3, max_value=0.9,
                   allow_nan=False, allow_infinity=False),
    offset=st.floats(min_value=1.0, max_value=50.0,
                     allow_nan=False, allow_infinity=False),
    exit_z=st.floats(min_value=0.5, max_value=5.0,
                     allow_nan=False, allow_infinity=False),
    quantity=st.integers(min_value=1, max_value=100),
    side=st.sampled_from(["BUY", "SELL"]),
    as_string=st.booleans(),
)
def test_zscore_entry_direction_and_geometry(
    base_price,
    lookback,
    frac,
    offset,
    exit_z,
    quantity,
    side,
    as_string,
):
    """A z-score extreme fixes the entry direction, target and stop geometry."""
    b = base_price
    L = lookback

    # Outlier below (BUY) / above (SELL) the base cluster. The single-point z-score
    # of the outlier in this window is exactly sign(c - b) * sqrt(L - 1).
    if side == "BUY":
        c = b - offset
    else:
        c = b + offset
    assert c > 0.0, "final close must stay strictly positive"

    # entry_z strictly below the attained |z| (== sqrt(L - 1)) so the entry fires.
    z_magnitude = math.sqrt(L - 1)
    entry_z = z_magnitude * frac
    assert entry_z < z_magnitude

    # Reference window the strategy uses when deciding on the final candle:
    # the most recent ``lookback`` closes, including the final outlier.
    window = [b] * (L - 1) + [c]
    arr = np.asarray(window, dtype=float)
    expected_mean = float(np.mean(arr))
    expected_std = float(np.std(arr))  # population std (ddof=0) -- numpy reference
    assert expected_std != 0.0, "window must have non-zero dispersion"

    # Size capital so the 2% risk gate comfortably passes (never vetoes the entry):
    # projected_loss = exit_z * std * quantity must be <= 0.02 * capital.
    projected_loss = exit_z * expected_std * quantity
    capital = (projected_loss / 0.02) * 5.0

    config = {
        "instrument": "2885",
        "quantity": quantity,
        "capital": capital,
        "lookback": L,
        "entry_z": entry_z,
        "exit_z": exit_z,
        # warmup_period == lookback + 1 keeps every base candle inside the warmup
        # gate (robustly silent, independent of floating-point std noise on a flat
        # window) while the final candle, at count lookback + 1, clears warmup.
        "warmup_period": L + 1,
        "max_trades_per_day": 5,
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }
    strategy = ZScoreReversion(config=config)

    # Feed ``lookback`` identical base candles. Every base candle stays inside the
    # warmup gate (count <= lookback < warmup_period), so none can emit a signal.
    for i in range(L):
        base_signal = strategy.on_candle(_flat_candle(b, i, as_string))
        assert base_signal is None, "flat base candle must not emit a signal"
    assert strategy.state.position is None, "strategy must be flat before the entry"

    # Final outlier candle pushes the z-score beyond the entry threshold.
    signal = strategy.on_candle(_flat_candle(c, L, as_string))

    assert signal is not None, (
        f"|z| == {z_magnitude} >= entry_z {entry_z} must emit an entry"
    )

    # Direction follows the side of the extreme (Req 12.3, 12.4).
    assert signal.direction == side

    entry = signal.price
    assert math.isclose(entry, c, rel_tol=1e-9, abs_tol=1e-6)

    # Target is the rolling mean (z reverting to zero -- Req 12.5).
    assert math.isclose(signal.target, expected_mean, rel_tol=1e-9, abs_tol=1e-6), (
        f"target {signal.target!r} != rolling mean {expected_mean!r}"
    )

    # Stop placed exit_z std-devs beyond entry on the protective side (Req 12.5, 12.7).
    if side == "BUY":
        assert math.isclose(signal.stop_loss, entry - exit_z * expected_std,
                            rel_tol=1e-9, abs_tol=1e-6)
        assert signal.stop_loss < entry, "BUY stop must sit below entry"
        assert signal.target > entry, "BUY target (rolling mean) must sit above entry"
    else:
        assert math.isclose(signal.stop_loss, entry + exit_z * expected_std,
                            rel_tol=1e-9, abs_tol=1e-6)
        assert signal.stop_loss > entry, "SELL stop must sit above entry"
        assert signal.target < entry, "SELL target (rolling mean) must sit below entry"
