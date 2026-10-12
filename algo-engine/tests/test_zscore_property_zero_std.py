"""Property 29 - Zero standard deviation is non-computable and emits nothing.

Feature: intraday-strategy-suite, Property 29

Validates: Requirements 12.6

*For any* ``close`` window whose values are all equal (rolling standard deviation
of zero), the Bollinger / Z-Score Reversion strategy returns None and emits a debug
log entry noting a non-computable Z_Score.

Construction
------------
The strategy's rolling window is a ``deque`` with ``maxlen == lookback`` and the
current candle's close is appended (in ``_update_indicators``) before ``_decide``
runs. ``_decide`` only computes rolling statistics once the window holds a *full*
``lookback`` samples. To exercise the zero-dispersion guard we therefore:

  - set ``warmup_period`` to 1 so the warmup gate clears well before the window is
    full (the warmup gate is otherwise the only thing keeping the strategy silent
    on the early, under-filled window), and
  - feed at least ``lookback`` candles whose ``high == low == close`` are all the
    *same* constant value, so once the window is full it has exactly zero dispersion.

On the candle that completes (and on any subsequent candle that maintains) the
all-equal full window, ``_decide`` runs with a numerically flat window. Requirement
12.6 demands the z-score be treated as non-computable: ``on_candle`` must return
None and a debug log noting a non-computable z-score must be emitted.

Note on floating point: for identical float closes ``np.std`` can return a tiny
non-zero value (~1e-13) because ``np.mean`` of identical floats is off by ~1 ULP.
A correct zero-dispersion guard must still classify such a window as non-computable
(its peak-to-peak range is exactly zero), so the property holds for every constant
price and lookback regardless of that rounding noise.
"""

from __future__ import annotations

import datetime as _dt

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from hypothesis import HealthCheck

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
    """A candle with high == low == close == price (zero intra-candle range)."""
    return {
        "high": price,
        "low": price,
        "close": price,
        "time": _time_at(index, as_string),
    }


# Feature: intraday-strategy-suite, Property 29
@pytest.mark.property
@settings(max_examples=100)
@given(
    price=st.floats(min_value=1.0, max_value=10000.0,
                    allow_nan=False, allow_infinity=False),
    lookback=st.integers(min_value=3, max_value=40),
    extra=st.integers(min_value=0, max_value=5),
    as_string=st.booleans(),
)
def test_zscore_zero_std_is_non_computable(price, lookback, extra, as_string):
    """An all-equal close window yields no signal and a non-computable-z debug log."""
    L = lookback

    config = {
        "instrument": "2885",
        "quantity": 50,
        "capital": 1_000_000.0,
        "lookback": L,
        "entry_z": 2.0,
        "exit_z": 3.0,
        # Clear warmup almost immediately so the *only* thing that could keep the
        # strategy silent on the full window is the zero-dispersion guard itself.
        "warmup_period": 1,
        "max_trades_per_day": 5,
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }
    strategy = ZScoreReversion(config=config)

    # Feed L + extra identical candles. Once the window is full (>= L closes) every
    # remaining candle maintains a zero-dispersion window and must stay silent.
    signals = []
    for i in range(L + extra):
        signals.append(strategy.on_candle(_flat_candle(price, i, as_string)))

    # No candle in an all-equal sequence may ever emit a signal (Req 12.6).
    assert all(sig is None for sig in signals), (
        "an all-equal (zero-std) close window must never emit a signal"
    )
    assert strategy.state.position is None, "strategy must remain flat throughout"

    # The candle that completes the full window (index L - 1) is the first one on
    # which _decide computes rolling statistics; on it the zero-dispersion guard
    # must fire and emit the non-computable-z debug log.
    assert signals[L - 1] is None


# Feature: intraday-strategy-suite, Property 29
@pytest.mark.property
@settings(max_examples=100,
          suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    price=st.floats(min_value=1.0, max_value=10000.0,
                    allow_nan=False, allow_infinity=False),
    lookback=st.integers(min_value=3, max_value=40),
    as_string=st.booleans(),
)
def test_zscore_zero_std_emits_debug_log(price, lookback, as_string, logger_capture):
    """The zero-dispersion guard emits a debug log noting a non-computable z-score."""
    L = lookback

    config = {
        "instrument": "2885",
        "quantity": 50,
        "capital": 1_000_000.0,
        "lookback": L,
        "entry_z": 2.0,
        "exit_z": 3.0,
        "warmup_period": 1,
        "max_trades_per_day": 5,
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }
    strategy = ZScoreReversion(config=config)
    cap = logger_capture(strategy.name)
    cap.clear()

    # Feed exactly L identical candles so the final candle completes a full,
    # zero-dispersion window and _decide evaluates the guard.
    for i in range(L):
        signal = strategy.on_candle(_flat_candle(price, i, as_string))
        assert signal is None, "flat candle must not emit a signal"

    # A debug log noting the non-computable z-score must have been emitted (Req 12.6).
    assert cap.contains("non-computable z-score"), (
        f"expected a non-computable z-score debug log; captured: {cap.messages!r}"
    )
