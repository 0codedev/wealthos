"""Property 6 - New trading day resets to fresh state.

# Feature: intraday-strategy-suite, Property 6

*For any* day-1 candle sequence followed by a day-2 first candle (a ``time``
strictly earlier than the previous candle's ``time``), the strategy's
Per_Day_State after the reset equals the Per_Day_State of a freshly constructed
strategy that has observed only that day-2 candle, and a reset debug log is
emitted.

**Validates: Requirements 3.1, 3.2, 3.4**

This module is parameterized across all five suite strategies (VWAP Mean
Reversion, EMA Trend Pullback, ORB Enhanced, Z-Score Reversion, Volatility
Squeeze Breakout). Trading-day reset is a suite-wide shared lifecycle pattern:
the fixed ``on_candle`` pipeline compares the normalized ``time`` against the
previously observed time and, on a regression, calls ``_reset_day_state`` (which
rebuilds a fresh ``PerDayState``, re-initialising any strategy-specific deque
windows) and emits a reset debug log, *before* the candle's own indicator update
runs.

Construction
------------
``generators.candle_sequences(days=2, ...)`` partitions the NSE session into two
non-overlapping time bands and places day-2 in the strictly-earlier band, so the
first day-2 candle's ``time`` is guaranteed to be earlier than the last day-1
candle's ``time`` -- exactly the new-trading-day trigger (Requirement 3.1).

The single regression point in the sequence is located, splitting it into the
day-1 prefix and the day-2 first candle. Strategy A observes the whole day-1
prefix and then the day-2 first candle (so it undergoes a reset followed by one
fresh-day candle). Strategy B -- a freshly constructed instance with the *same*
config -- observes only the day-2 first candle. After processing, Strategy A's
``state`` must equal Strategy B's ``state``: the reset must wipe every day-1
accumulator so the new session is indistinguishable from a brand-new strategy.

``PerDayState`` is a ``@dataclass`` so ``A.state == B.state`` performs a
field-by-field comparison. Strategy-specific deque windows (e.g. the Z-Score /
Squeeze ``close_window``) compare by contents under ``deque.__eq__`` regardless
of ``maxlen``; a NaN-aware fallback is applied only if direct equality fails, so
genuinely identical float accumulators that happen to be NaN do not produce a
spurious mismatch.
"""

from __future__ import annotations

import datetime as _dt
import math
from collections import deque
from dataclasses import fields as _dataclass_fields

import pytest
from hypothesis import HealthCheck, given, settings

import generators as gen

from strategies.vwap_mean_reversion import VWAPMeanReversion
from strategies.ema_trend_pullback import EMATrendPullback
from strategies.orb_enhanced import ORBEnhanced
from strategies.zscore_reversion import ZScoreReversion
from strategies.volatility_squeeze import VolatilitySqueezeBreakout


# All five suite strategies, parameterized.
STRATEGY_CLASSES = [
    VWAPMeanReversion,
    EMATrendPullback,
    ORBEnhanced,
    ZScoreReversion,
    VolatilitySqueezeBreakout,
]

_STRATEGY_PARAMS = pytest.mark.parametrize(
    "strategy_cls",
    STRATEGY_CLASSES,
    ids=[cls.__name__ for cls in STRATEGY_CLASSES],
)

# Common substring of the reset debug log emitted by every strategy
# (``"... new trading day detected at <t>; per-day state reset"``).
_RESET_LOG_SUBSTRING = "per-day state reset"


def _normalize_time(value) -> _dt.time:
    """Coerce a candle ``time`` (``datetime.time`` or ``"%H:%M:%S"``) to ``time``."""
    if isinstance(value, _dt.time):
        return value
    return _dt.datetime.strptime(value, "%H:%M:%S").time()


def _split_at_day_boundary(sequence: list) -> tuple[list, dict]:
    """Split a two-day sequence into (day-1 prefix, day-2 first candle).

    The day boundary is the first index whose normalized ``time`` is strictly
    earlier than its predecessor's -- the new-trading-day trigger. Returns the
    day-1 candles (everything before the regression) and the single day-2 first
    candle (at the regression point).
    """
    for i in range(1, len(sequence)):
        if _normalize_time(sequence[i]["time"]) < _normalize_time(sequence[i - 1]["time"]):
            return sequence[:i], sequence[i]
    raise AssertionError(
        "candle_sequences(days=2) must contain a day-boundary time regression"
    )


def _values_equal(a, b) -> bool:
    """Equality for a single PerDayState field, NaN- and deque-aware."""
    if isinstance(a, deque) or isinstance(b, deque):
        # deque.__eq__ already ignores maxlen and compares contents; fall through
        # to element-wise comparison so NaN-vs-NaN contents still match.
        la, lb = list(a), list(b)
        return len(la) == len(lb) and all(_values_equal(x, y) for x, y in zip(la, lb))
    if isinstance(a, float) and isinstance(b, float):
        if math.isnan(a) and math.isnan(b):
            return True
    return a == b


def _states_equal(a, b) -> bool:
    """Field-by-field PerDayState comparison (NaN/deque tolerant).

    Used only as a diagnostic fallback when the direct dataclass ``==`` is False,
    so that an identical-but-NaN accumulator is not reported as a reset bug.
    """
    if type(a) is not type(b):
        return False
    for f in _dataclass_fields(a):
        if not _values_equal(getattr(a, f.name), getattr(b, f.name)):
            return False
    return True


# Feature: intraday-strategy-suite, Property 6
@_STRATEGY_PARAMS
@pytest.mark.property
@settings(
    max_examples=100,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    sequence=gen.candle_sequences(days=2, min_len=1, max_len=20),
    config=gen.configs(),
)
def test_new_day_resets_to_fresh_state(strategy_cls, sequence, config, logger_capture):
    """A new-day regression resets state to match a fresh strategy + day-2 candle."""
    day1, day2_first = _split_at_day_boundary(sequence)

    # Strategy A observes the full day-1 prefix, then the day-2 first candle, so
    # it crosses the day boundary and undergoes a reset followed by one fresh-day
    # candle. A fresh capture is attached so we can assert the reset log fires on
    # exactly the boundary candle.
    strat_a = strategy_cls(config=dict(config))
    cap = logger_capture(strat_a.name)

    for candle in day1:
        strat_a.on_candle(candle)

    # Isolate the reset log to the boundary candle.
    cap.clear()
    strat_a.on_candle(day2_first)

    # Strategy B is brand-new and observes ONLY the day-2 first candle.
    strat_b = strategy_cls(config=dict(config))
    strat_b.on_candle(day2_first)

    # Req 3.4: the reset emits a debug log recording the new trading day.
    assert cap.contains(_RESET_LOG_SUBSTRING), (
        f"{strategy_cls.__name__}: expected a reset debug log containing "
        f"'{_RESET_LOG_SUBSTRING}' on the day-boundary candle; "
        f"captured: {cap.messages!r}"
    )

    # Req 3.1/3.2: after the reset + first day-2 candle, A's Per_Day_State equals
    # that of a fresh strategy that has seen only the day-2 candle -- no day-1
    # accumulator (count, range, rolling window, position, ...) survives.
    if strat_a.state != strat_b.state:
        # NaN-tolerant fallback so identical-but-NaN float/deque accumulators are
        # not misreported; a real surviving day-1 value still fails here.
        assert _states_equal(strat_a.state, strat_b.state), (
            f"{strategy_cls.__name__}: Per_Day_State after reset does not match a "
            f"freshly constructed strategy.\n"
            f"  after-reset state: {strat_a.state!r}\n"
            f"  fresh state:       {strat_b.state!r}"
        )

    # Sanity: the reset truly happened (the day-2 candle is the only one counted).
    assert strat_a.state.candle_count == 1, (
        f"{strategy_cls.__name__}: expected candle_count == 1 after reset, got "
        f"{strat_a.state.candle_count}"
    )
