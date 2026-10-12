"""Property 7: Entries occur only inside the configured trading window.

# Feature: intraday-strategy-suite, Property 7

*For any* candle whose normalized ``time`` is before the configured
``market_open``, at or after the configured ``no_new_entry``, or at or after the
configured ``session_close``, the strategy emits no entry Signal; the boundaries
always track the Config-supplied values.

**Validates: Requirements 4.1, 4.2, 4.4, 4.5**

Approach
--------
This is a *suite-wide* property: it is parameterized across all five strategy
classes. For each example we draw a randomized full Config (so strategy-specific
tunables vary) and then override the four session-timing values with *drawn*
values that sit strictly inside the NSE session band and in the logically valid
order ``market_open < no_new_entry <= square_off < session_close``. The drawn
``market_open`` is pushed later than 09:15 and ``no_new_entry`` well before close,
so a single-day candle sequence (whose times span 09:15-15:30) is guaranteed to
contain candles *before* ``market_open``, *inside* the window, and *at/after*
``no_new_entry`` / ``session_close``. Varying the timings proves the boundaries
track Config rather than hardcoded defaults (Req 4.4).

We feed a single-day sequence (so no trading-day reset occurs and ``trades_today``
is monotonically non-decreasing). An *entry* is detected as an increment of
``state.trades_today`` across an ``on_candle`` call -- square-off signals do not
increment that counter, so they are correctly excluded (they are exits that fire
at/after ``square_off``, not entries). For every detected entry we assert the
candle's normalized ``time`` (computed via the strategy's own ``_normalize_time``)
lies within ``[market_open, no_new_entry)`` and ``< session_close``.
"""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import generators as gen
from strategies.vwap_mean_reversion import VWAPMeanReversion
from strategies.ema_trend_pullback import EMATrendPullback
from strategies.orb_enhanced import ORBEnhanced
from strategies.zscore_reversion import ZScoreReversion
from strategies.volatility_squeeze import VolatilitySqueezeBreakout


# All five strategies gate entries through the same shared lifecycle pipeline; the
# trading-window invariant must hold identically for each (Req 4.1, 4.2, 4.4, 4.5).
STRATEGY_CLASSES = [
    VWAPMeanReversion,
    EMATrendPullback,
    ORBEnhanced,
    ZScoreReversion,
    VolatilitySqueezeBreakout,
]


# NSE intraday session bounds (seconds since midnight), mirroring generators.py.
_SESSION_START = 9 * 3600 + 15 * 60   # 09:15:00
_SESSION_END = 15 * 3600 + 30 * 60    # 15:30:00


def _secs_to_str(total_seconds: int) -> str:
    """Render whole-second seconds-since-midnight as a "%H:%M:%S" string."""
    h, rem = divmod(total_seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


@st.composite
def trading_window_timings(draw) -> dict:
    """Draw four session-timing values in valid chronological order.

    The values are deliberately non-default and spaced so that a full-session
    single-day candle sequence contains candles before ``market_open`` and at/after
    ``no_new_entry`` / ``session_close``. Order enforced:
    ``market_open < no_new_entry <= square_off < session_close``.
    """
    # market_open pushed later than 09:15 so candles can precede it (Req 4.1, 4.4).
    market_open = draw(st.integers(min_value=_SESSION_START + 300,
                                   max_value=_SESSION_START + 5400))   # 09:20 .. 10:45
    # at least a 30-minute window, ending well before close so candles follow it.
    no_new_entry = draw(st.integers(min_value=market_open + 1800,
                                    max_value=_SESSION_END - 3600))    # .. 14:30
    # square_off may equal no_new_entry (defaults: 15:00 <= 15:15).
    square_off = draw(st.integers(min_value=no_new_entry,
                                  max_value=_SESSION_END - 1800))      # .. 15:00
    # session_close strictly after square_off, within the session.
    session_close = draw(st.integers(min_value=square_off + 60,
                                     max_value=_SESSION_END))          # .. 15:30
    return {
        "market_open": _secs_to_str(market_open),
        "no_new_entry": _secs_to_str(no_new_entry),
        "square_off": _secs_to_str(square_off),
        "session_close": _secs_to_str(session_close),
    }


# Feature: intraday-strategy-suite, Property 7
@pytest.mark.property
@pytest.mark.parametrize("strategy_cls", STRATEGY_CLASSES)
@settings(max_examples=100)
@given(
    base_config=gen.configs(),
    timings=trading_window_timings(),
    sequence=gen.candle_sequences(days=1, min_len=1, max_len=60),
    warmup=st.integers(min_value=1, max_value=4),
)
def test_entries_only_inside_trading_window(
    strategy_cls,
    base_config,
    timings,
    sequence,
    warmup,
):
    """No entry Signal is emitted outside ``[market_open, no_new_entry)`` & ``< session_close``."""
    config = dict(base_config)
    # Override the four session-timing values with the drawn (non-default) ones so the
    # boundaries are proven to track Config rather than hardcoded values (Req 4.4).
    config.update(timings)
    # Small warmup + large capital so entries actually occur (keeps the property
    # exercised against real emissions rather than passing vacuously).
    config["warmup_period"] = warmup
    config["capital"] = 1e12

    strategy = strategy_cls(config=config)

    market_open = strategy._normalize_time(config["market_open"])
    no_new_entry = strategy._normalize_time(config["no_new_entry"])
    session_close = strategy._normalize_time(config["session_close"])

    for i, candle in enumerate(sequence):
        t = strategy._normalize_time(candle["time"])
        before = strategy.state.trades_today
        strategy.on_candle(candle)
        after = strategy.state.trades_today

        if after > before:
            # An entry fired on this candle (square-offs never touch trades_today).
            assert market_open <= t < no_new_entry, (
                f"{strategy_cls.__name__}: entry at candle {i} time {t} is outside "
                f"[market_open={market_open}, no_new_entry={no_new_entry})"
            )
            assert t < session_close, (
                f"{strategy_cls.__name__}: entry at candle {i} time {t} is at/after "
                f"session_close={session_close}"
            )
