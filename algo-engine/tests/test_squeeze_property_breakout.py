"""Property 32 - Squeeze release breakout triggers a direction-correct entry,
and no entry occurs without a prior squeeze.

Feature: intraday-strategy-suite, Property 32

Validates: Requirements 13.3, 13.4, 13.5, 13.6, 13.7

For any flat, in-window state where a squeeze has occurred earlier in the day and
then ends, a ``close`` breaking upward beyond ``breakout_band`` emits a "BUY" and a
downward break emits a "SELL", with ``stop_loss`` at the opposite side of the squeeze
range and ``target`` satisfying ``abs(target - entry) / abs(entry - stop) == target_rr``
(Req 13.3, 13.4, 13.5, 13.7). While no squeeze has been detected in the current trading
day, no entry Signal is ever emitted (Req 13.6).

Controlled construction
-----------------------
Random OHLC data almost never produces a *guaranteed* squeeze, so both parts use a
deterministic construction derived from the strategy's own indicator math
(``_update_indicators`` / ``_decide``):

Squeeze formation. Feed a run of candles whose ``close`` is the *constant* ``base``
while each candle carries a symmetric high/low spread ``h`` (``high = base + h``,
``low = base - h``). With constant closes the Bollinger standard deviation collapses
to zero, so the Bollinger Bands degenerate to the single point ``base``; meanwhile the
True Range stays ``2h > 0`` so the ATR - and therefore the Keltner Channel width -
stays strictly positive. The Bollinger Bands are then strictly inside the Keltner
Channels and the strategy classifies a Squeeze, latching ``squeeze_seen`` and recording
the coil range ``[base - h, base + h]`` for opposite-side stop placement (Req 13.2,
13.5).

Squeeze release + breakout. A single candle whose ``close`` jumps a large distance
``D`` away from ``base`` injects a non-zero standard deviation. Because the Bollinger
half-width grows like ``bb_std * D * sqrt(lookback - 1) / lookback`` while the Keltner
half-width grows only like ``kc_multiplier * D / lookback`` (plus the bounded ATR
baseline), a sufficiently large ``D`` forces the Bollinger Bands back *outside* the
Keltner Channels - the squeeze ends. The constraint ``D >= 40`` with ``h <= 2`` keeps
``D`` an order of magnitude above the squeeze-end threshold across every sampled
``lookback`` for the default ``bb_std = 2.0`` / ``kc_multiplier = 1.5``, so the release
is reliable. The same candle's ``close`` is placed beyond ``squeeze_high + breakout_band``
(up) or ``squeeze_low - breakout_band`` (down) with a confirming body to trigger the
breakout. ``open`` is omitted so the body check consumes the prior-close substitution
(``effective_open == base``), which the constant run guarantees is below an up-break and
above a down-break.

No-prior-squeeze gating. A strictly linear trend (constant ``step`` per candle) keeps
the Bollinger standard deviation large relative to the ATR for every window, so the
bands never nest and ``squeeze_seen`` stays ``False`` for the whole day - the decision
layer must therefore emit nothing on every candle even though price travels far enough
to look like a breakout (Req 13.6).

``capital`` is sized from the worst-case projected loss so the 2% risk gate never vetoes
the entry under test, and times are emitted as both ``datetime.time`` and ``"%H:%M:%S"``
strings.
"""

from __future__ import annotations

import datetime as _dt
import math

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from strategies.volatility_squeeze import VolatilitySqueezeBreakout


_MARKET_OPEN_SECONDS = 9 * 3600 + 15 * 60  # 09:15:00

# Fixed band parameters: the squeeze-end margin analysis in the module docstring
# is performed for these default multipliers, so they are pinned here.
_BB_STD = 2.0
_KC_MULTIPLIER = 1.5


def _mk_time(total_seconds: int, as_string: bool) -> object:
    """Build a candle time from a second-of-day offset (datetime.time or string)."""
    h, rem = divmod(total_seconds, 3600)
    m, s = divmod(rem, 60)
    t = _dt.time(hour=h, minute=m, second=s)
    return t.strftime("%H:%M:%S") if as_string else t


def _squeeze_candle(base: float, h: float, total_seconds: int, as_string: bool) -> dict:
    """A constant-close candle (close == base) with a symmetric high/low spread.

    ``open`` is intentionally omitted; constant closes drive the Bollinger std to zero
    while the ``2h`` True Range keeps the Keltner width positive -> a guaranteed squeeze.
    """
    return {
        "high": base + h,
        "low": base - h,
        "close": base,
        "time": _mk_time(total_seconds, as_string),
    }


def _breakout_candle(close: float, total_seconds: int, as_string: bool) -> dict:
    """A doji-bodied breakout candle (high == low == close); ``open`` omitted.

    high/low collapse to ``close`` so the candle's True Range is exactly the breakout
    distance; ``open`` omission makes ``effective_open`` fall back to the prior close.
    """
    return {
        "high": close,
        "low": close,
        "close": close,
        "time": _mk_time(total_seconds, as_string),
    }


# ---------------------------------------------------------------------------
# Part 1 - No prior squeeze: a trending day emits no entry Signal (Req 13.6)
# ---------------------------------------------------------------------------
# Feature: intraday-strategy-suite, Property 32
@pytest.mark.property
@settings(max_examples=100)
@given(
    base=st.floats(min_value=100.0, max_value=5000.0,
                   allow_nan=False, allow_infinity=False),
    step=st.floats(min_value=1.0, max_value=50.0,
                   allow_nan=False, allow_infinity=False),
    n_candles=st.integers(min_value=25, max_value=40),
    lookback=st.sampled_from([10, 12, 15, 20]),
    trend_up=st.booleans(),
    as_string=st.booleans(),
)
def test_no_prior_squeeze_emits_no_entry(
    base, step, n_candles, lookback, trend_up, as_string,
):
    """A trending (never-squeezing) day must never emit an entry Signal (Req 13.6)."""
    config = {
        "instrument": "13",
        "quantity": 50,
        "capital": 1_000_000.0,
        "lookback": lookback,
        "bb_std": _BB_STD,
        "kc_multiplier": _KC_MULTIPLIER,
        "breakout_band": 0.0,
        "target_rr": 2.0,
        "warmup_period": 5,
        "max_trades_per_day": 5,
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }
    strategy = VolatilitySqueezeBreakout(config=config)

    direction = 1.0 if trend_up else -1.0
    for i in range(n_candles):
        close = base + direction * step * i
        # Zero-range candles: TR is driven purely by the trend step so the ATR
        # baseline stays small relative to the (large) Bollinger std of a trend.
        candle = {
            "high": close,
            "low": close,
            "close": close,
            "time": _mk_time(_MARKET_OPEN_SECONDS + i * 60, as_string),
        }
        signal = strategy.on_candle(candle)
        assert signal is None, (
            f"no squeeze has occurred, yet an entry was emitted on candle {i} "
            f"(close={close})"
        )

    # The defining condition: a squeeze was never detected this day.
    assert strategy.state.squeeze_seen is False, (
        "construction error: the trending sequence unexpectedly formed a squeeze"
    )


# ---------------------------------------------------------------------------
# Part 2 - Squeeze release breakout: direction + exit geometry (Req 13.3-13.5, 13.7)
# ---------------------------------------------------------------------------
# Feature: intraday-strategy-suite, Property 32
@pytest.mark.property
@settings(max_examples=100)
@given(
    base=st.floats(min_value=100.0, max_value=5000.0,
                   allow_nan=False, allow_infinity=False),
    h=st.floats(min_value=0.5, max_value=2.0,
                allow_nan=False, allow_infinity=False),
    breakout_distance=st.floats(min_value=40.0, max_value=300.0,
                                allow_nan=False, allow_infinity=False),
    breakout_band=st.floats(min_value=0.0, max_value=5.0,
                            allow_nan=False, allow_infinity=False),
    target_rr=st.floats(min_value=1.0, max_value=4.0,
                        allow_nan=False, allow_infinity=False),
    lookback=st.sampled_from([10, 12, 15, 20]),
    quantity=st.integers(min_value=1, max_value=100),
    side=st.sampled_from(["BUY", "SELL"]),
    as_string=st.booleans(),
)
def test_squeeze_release_breakout_direction_and_geometry(
    base, h, breakout_distance, breakout_band, target_rr,
    lookback, quantity, side, as_string,
):
    """A squeeze-release break fixes direction, opposite-side stop, and target_rr."""
    # Squeeze coil range recorded during the constant-close run.
    squeeze_low = base - h
    squeeze_high = base + h

    # Breakout close sits ``breakout_distance`` beyond ``base`` in the chosen
    # direction; this clears both the squeeze range and the ``breakout_band`` buffer
    # (breakout_distance >= 40 >> h + breakout_band <= 7) and is large enough to end
    # the squeeze (see the module docstring's margin analysis).
    if side == "BUY":
        breakout_close = base + breakout_distance
        expected_stop = squeeze_low
        risk = breakout_close - expected_stop
    else:
        breakout_close = base - breakout_distance
        expected_stop = squeeze_high
        risk = expected_stop - breakout_close
    assert risk > 0.0  # the entry is genuinely beyond the opposite extreme

    # Size capital so the 2% risk gate always passes: projected loss = risk * quantity.
    projected_loss = risk * quantity
    capital = (projected_loss / 0.02) * 5.0

    config = {
        "instrument": "13",
        "quantity": quantity,
        "capital": capital,
        "lookback": lookback,
        "bb_std": _BB_STD,
        "kc_multiplier": _KC_MULTIPLIER,
        "breakout_band": breakout_band,
        "target_rr": target_rr,
        "warmup_period": 5,
        "max_trades_per_day": 5,
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }
    strategy = VolatilitySqueezeBreakout(config=config)

    # Phase A: a constant-close run that forms (and holds) a squeeze. Feed a few more
    # than ``lookback`` candles so the squeeze is detected and the coil range latches.
    squeeze_len = lookback + 3
    t = 0
    for _ in range(squeeze_len):
        sig = strategy.on_candle(
            _squeeze_candle(base, h, _MARKET_OPEN_SECONDS + t * 60, as_string)
        )
        assert sig is None, "no entry may occur while the squeeze is still in progress"
        t += 1

    # The construction must actually have produced a squeeze and recorded its range.
    assert strategy.state.squeeze_seen is True, (
        "construction error: the constant-close run did not form a squeeze"
    )
    assert strategy.state.is_squeeze is True, "expected to still be squeezing pre-break"
    assert math.isclose(strategy.state.squeeze_low, squeeze_low,
                        rel_tol=1e-9, abs_tol=1e-9)
    assert math.isclose(strategy.state.squeeze_high, squeeze_high,
                        rel_tol=1e-9, abs_tol=1e-9)
    assert strategy.state.position is None, "strategy must be flat before the breakout"

    # Phase B: the squeeze-release breakout candle.
    signal = strategy.on_candle(
        _breakout_candle(breakout_close, _MARKET_OPEN_SECONDS + t * 60, as_string)
    )

    # The large jump must have ended the squeeze and fired a breakout entry.
    assert strategy.state.is_squeeze is False, (
        "construction error: the breakout candle did not end the squeeze"
    )
    assert signal is not None, (
        f"squeeze-release break of {breakout_close} beyond "
        f"[{squeeze_low}, {squeeze_high}] (band={breakout_band}) must emit an entry"
    )

    # Direction follows the break side (Req 13.3, 13.4).
    assert signal.direction == side

    entry = signal.price
    assert math.isclose(entry, breakout_close, rel_tol=1e-9, abs_tol=1e-9)

    # Stop sits at the opposite side of the squeeze range (Req 13.5).
    assert math.isclose(signal.stop_loss, expected_stop, rel_tol=1e-9, abs_tol=1e-9)

    # Target satisfies abs(target - entry) / abs(entry - stop) == target_rr (Req 13.5).
    realized_rr = abs(signal.target - entry) / abs(entry - signal.stop_loss)
    assert math.isclose(realized_rr, target_rr, rel_tol=1e-7, abs_tol=1e-7)

    # Direction-correct sidedness of stop and target.
    if side == "BUY":
        assert signal.stop_loss < entry, "BUY stop must sit below entry"
        assert signal.target > entry, "BUY target must sit above entry"
    else:
        assert signal.stop_loss > entry, "SELL stop must sit above entry"
        assert signal.target < entry, "SELL target must sit below entry"

    # Config quantity is used verbatim (Req 13.7 exposes config; sizing came from it).
    assert signal.quantity == quantity
