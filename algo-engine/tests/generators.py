"""Shared hypothesis strategies (generators) for the Intraday Strategy Suite.

These generators feed the property-based tests described in design.md
("Testing Strategy" -> "Generators"). They are intentionally *strategy-agnostic*:
they build valid (and deliberately invalid) Candle / Tick / Config inputs and
multi-day Candle sequences so every property test can draw from the same input
space.

Summary of what lives here:

* :func:`candles` - a single Candle dict with guaranteed ``high``/``low``/``close``,
  a ``time`` rendered as either a ``datetime.time`` or a ``"%H:%M:%S"`` string, and
  optional inclusion / omission of ``open`` and ``volume``.
* :func:`candle_sequences` - an intraday sequence with monotonic times, optional
  injected day-boundary regressions (multiple sessions), and configurable length
  so warmup / windowing / reset paths can all be exercised.
* :func:`configs` - a randomized Config dict (thresholds, periods, multipliers,
  timing values, warmup, ``max_trades_per_day``, ``capital``, ``quantity``).
* :func:`ticks` - a Tick dict that may carry one of the recognised price fields or
  deliberately omit the price field entirely.

Only ``hypothesis`` is imported here (a test-only dependency); the suite under
test still depends on stdlib + numpy + pandas only.
"""

from __future__ import annotations

import datetime as _dt
from typing import Optional

from hypothesis import strategies as st

# NSE intraday session bounds (seconds since midnight).
_SESSION_START = 9 * 3600 + 15 * 60   # 09:15:00
_SESSION_END = 15 * 3600 + 30 * 60    # 15:30:00

# Recognised tick price field names (design "Tick" data model).
PRICE_FIELDS = ("price", "ltp", "last_price")

# Guaranteed candle fields (design Requirement 2.1).
GUARANTEED_FIELDS = ("high", "low", "close", "time")


# ---------------------------------------------------------------------------
# Time helpers / strategies
# ---------------------------------------------------------------------------
def _seconds_to_time(total_seconds: int) -> _dt.time:
    total_seconds %= 24 * 3600
    h, rem = divmod(total_seconds, 3600)
    m, s = divmod(rem, 60)
    return _dt.time(hour=h, minute=m, second=s)


def render_time(t: _dt.time, as_string: bool) -> object:
    """Render a ``datetime.time`` as itself or as a ``"%H:%M:%S"`` string."""
    return t.strftime("%H:%M:%S") if as_string else t


@st.composite
def session_times(draw, as_string: Optional[bool] = None) -> object:
    """A single intraday time within the NSE session.

    Rendered as a ``datetime.time`` or ``"%H:%M:%S"`` string. When ``as_string``
    is None the representation is itself drawn (covers Property 4 equivalence).
    """
    secs = draw(st.integers(min_value=_SESSION_START, max_value=_SESSION_END))
    t = _seconds_to_time(secs)
    if as_string is None:
        as_string = draw(st.booleans())
    return render_time(t, as_string)


# ---------------------------------------------------------------------------
# Price strategies
# ---------------------------------------------------------------------------
def prices(min_value: float = 1.0, max_value: float = 100_000.0) -> st.SearchStrategy:
    """Finite, non-NaN float prices in a sane instrument range."""
    return st.floats(
        min_value=min_value,
        max_value=max_value,
        allow_nan=False,
        allow_infinity=False,
        width=64,
    )


@st.composite
def _ohlc(draw, price_strategy: st.SearchStrategy):
    """Draw a consistent (low, high, close, open) tuple with low <= close <= high."""
    a = draw(price_strategy)
    b = draw(price_strategy)
    low, high = (a, b) if a <= b else (b, a)
    # close sits within [low, high]
    if high == low:
        close = low
    else:
        frac = draw(st.floats(min_value=0.0, max_value=1.0, allow_nan=False,
                              allow_infinity=False))
        close = low + frac * (high - low)
    # open also within [low, high]
    if high == low:
        open_ = low
    else:
        frac_o = draw(st.floats(min_value=0.0, max_value=1.0, allow_nan=False,
                                allow_infinity=False))
        open_ = low + frac_o * (high - low)
    return low, high, close, open_


@st.composite
def candles(
    draw,
    *,
    include_open: Optional[bool] = None,
    include_volume: Optional[bool] = None,
    time_as_string: Optional[bool] = None,
    ordered: bool = True,
    time_value: object = None,
    price_strategy: Optional[st.SearchStrategy] = None,
) -> dict:
    """Generate a single Candle dict.

    Parameters
    ----------
    include_open / include_volume:
        ``True`` forces the field present, ``False`` forces it omitted, ``None``
        lets hypothesis decide (exercises degradation paths).
    time_as_string:
        Force the ``time`` representation; ``None`` draws it.
    ordered:
        When ``True`` (default) enforce ``low <= close <= high`` (and ``open`` in
        range). When ``False`` the OHLC values are drawn independently so tests
        that want relaxed/garbage geometry can opt in.
    time_value:
        If provided, used verbatim as the candle ``time`` (caller-supplied, e.g.
        for sequence building); otherwise an in-session time is drawn.
    price_strategy:
        Optional override for the float price strategy.
    """
    ps = price_strategy if price_strategy is not None else prices()

    if ordered:
        low, high, close, open_ = draw(_ohlc(ps))
    else:
        low = draw(ps)
        high = draw(ps)
        close = draw(ps)
        open_ = draw(ps)

    if time_value is not None:
        t_field = time_value
    else:
        t_field = draw(session_times(as_string=time_as_string))

    candle: dict = {"high": high, "low": low, "close": close, "time": t_field}

    inc_open = draw(st.booleans()) if include_open is None else include_open
    if inc_open:
        candle["open"] = open_

    inc_vol = draw(st.booleans()) if include_volume is None else include_volume
    if inc_vol:
        candle["volume"] = draw(
            st.floats(min_value=1.0, max_value=1e9, allow_nan=False,
                      allow_infinity=False)
        )
    return candle


@st.composite
def candles_missing_field(draw, **kwargs) -> dict:
    """A Candle with exactly one guaranteed field removed (Property 3)."""
    candle = draw(candles(**kwargs))
    victim = draw(st.sampled_from(GUARANTEED_FIELDS))
    candle.pop(victim, None)
    return candle


# ---------------------------------------------------------------------------
# Candle-sequence strategy
# ---------------------------------------------------------------------------
@st.composite
def _monotonic_times_in_band(draw, length: int, band_start: int, band_end: int) -> list:
    """A strictly increasing list of ``datetime.time`` within ``[band_start, band_end]``."""
    available = band_end - band_start + 1
    length = max(1, min(length, available))
    secs = draw(
        st.lists(
            st.integers(min_value=band_start, max_value=band_end),
            min_size=length,
            max_size=length,
            unique=True,
        )
    )
    secs.sort()
    return [_seconds_to_time(s) for s in secs]


@st.composite
def candle_sequences(
    draw,
    *,
    min_len: int = 1,
    max_len: int = 60,
    days: Optional[int] = None,
    max_days: int = 3,
    include_open: Optional[bool] = None,
    include_volume: Optional[bool] = None,
    time_as_string: Optional[bool] = None,
    ordered: bool = True,
) -> list:
    """Generate an intraday Candle sequence spanning one or more sessions.

    Times are monotonic within each day. When more than one day is generated a
    day-boundary *time regression* is injected (the first candle of day N+1 has a
    ``time`` strictly earlier than the last candle of day N), which is exactly the
    new-trading-day trigger (design Requirement 3.1). This is guaranteed by giving
    each successive day a strictly *earlier* (non-overlapping) time band, so even
    single-candle days still produce a clean boundary regression. Field
    representation flags are held fixed across the sequence so equivalence twins
    stay consistent.
    """
    if days is None:
        days = draw(st.integers(min_value=1, max_value=max_days))

    # Fix the time representation across the whole sequence unless told otherwise.
    if time_as_string is None:
        time_as_string = draw(st.booleans())

    # Partition the session into ``days`` non-overlapping bands. Day 0 occupies the
    # latest band, each later day a strictly earlier band -> guaranteed regression.
    span = _SESSION_END - _SESSION_START + 1
    band_width = span // days

    sequence: list = []
    for day_index in range(days):
        # Day 0 -> highest band, last day -> lowest band.
        band_position = days - 1 - day_index
        band_start = _SESSION_START + band_position * band_width
        if band_position == days - 1:
            band_end = _SESSION_END  # top band soaks up any remainder
        else:
            band_end = band_start + band_width - 1

        day_len = draw(st.integers(min_value=min_len, max_value=max_len))
        day_times = draw(_monotonic_times_in_band(day_len, band_start, band_end))
        for t in day_times:
            candle = draw(
                candles(
                    include_open=include_open,
                    include_volume=include_volume,
                    ordered=ordered,
                    time_value=render_time(t, time_as_string),
                )
            )
            sequence.append(candle)
    return sequence


# ---------------------------------------------------------------------------
# Config strategy
# ---------------------------------------------------------------------------
@st.composite
def configs(draw, *, full: bool = True) -> dict:
    """Generate a randomized Config dict.

    Covers the common cross-cutting keys plus the union of strategy-specific
    tunables (thresholds, periods, multipliers, timing values). All timing values
    are emitted as ``"%H:%M:%S"`` strings (strategies normalize them) and are kept
    in the logically valid order ``market_open < no_new_entry <= square_off <
    session_close``.
    """
    quantity = draw(st.integers(min_value=1, max_value=10_000))
    capital = draw(
        st.floats(min_value=10_000.0, max_value=1e9, allow_nan=False,
                  allow_infinity=False)
    )
    warmup = draw(st.integers(min_value=1, max_value=100))
    max_trades = draw(st.integers(min_value=1, max_value=20))

    config: dict = {
        "instrument": draw(
            st.text(alphabet="0123456789", min_size=1, max_size=6)
        ),
        "quantity": quantity,
        "capital": capital,
        "warmup_period": warmup,
        "max_trades_per_day": max_trades,
        # Timing values in valid chronological order.
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }

    if not full:
        return config

    # Strategy-specific tunables (union across the five strategies).
    pos_float = st.floats(min_value=0.01, max_value=100.0, allow_nan=False,
                          allow_infinity=False)
    mult = st.floats(min_value=0.1, max_value=5.0, allow_nan=False,
                     allow_infinity=False)

    # EMA periods kept strictly increasing fast < medium < slow.
    fast = draw(st.integers(min_value=2, max_value=20))
    medium = draw(st.integers(min_value=fast + 1, max_value=fast + 30))
    slow = draw(st.integers(min_value=medium + 1, max_value=medium + 60))

    config.update(
        {
            # VWAP mean reversion
            "entry_deviation": draw(pos_float),
            "stop_distance": draw(pos_float),
            "synthetic_confidence_cap": draw(
                st.floats(min_value=0.0, max_value=1.0, allow_nan=False,
                          allow_infinity=False)
            ),
            # EMA trend pullback
            "ema_periods": [fast, medium, slow],
            "pullback_band": draw(pos_float),
            "stop_method": draw(st.sampled_from(["slow_ema", "swing"])),
            "target_rr": draw(st.floats(min_value=0.5, max_value=10.0,
                                        allow_nan=False, allow_infinity=False)),
            # ORB enhanced
            "opening_range_minutes": draw(st.sampled_from([15, 30])),
            "require_retest": draw(st.booleans()),
            "require_volume_confirmation": draw(st.booleans()),
            "volume_multiple": draw(mult),
            "stop_multiplier": draw(mult),
            "target_multiplier": draw(mult),
            # Z-score reversion
            "lookback": draw(st.integers(min_value=2, max_value=100)),
            "entry_z": draw(st.floats(min_value=0.5, max_value=5.0,
                                      allow_nan=False, allow_infinity=False)),
            "exit_z": draw(st.floats(min_value=0.5, max_value=5.0,
                                     allow_nan=False, allow_infinity=False)),
            # Volatility squeeze
            "bb_std": draw(st.floats(min_value=1.0, max_value=3.0,
                                     allow_nan=False, allow_infinity=False)),
            "kc_multiplier": draw(mult),
            "breakout_band": draw(pos_float),
        }
    )
    return config


# ---------------------------------------------------------------------------
# Tick strategy
# ---------------------------------------------------------------------------
@st.composite
def ticks(draw, *, include_price: Optional[bool] = None) -> dict:
    """Generate a Tick dict, optionally with/without a recognised price field.

    When a price is present, exactly one of ``price`` / ``ltp`` / ``last_price``
    carries the value (covering the engine's accepted aliases). When omitted, the
    tick deliberately lacks every price field (design Property 16).
    """
    inc = draw(st.booleans()) if include_price is None else include_price
    tick: dict = {}
    if inc:
        field = draw(st.sampled_from(PRICE_FIELDS))
        tick[field] = draw(prices())
    else:
        # A non-price field so the dict is plausibly tick-shaped but unusable.
        tick["instrument"] = draw(st.text(alphabet="0123456789", min_size=1,
                                          max_size=6))
    return tick
