"""Property 8 - Square-off closes open positions at the cutoff.

# Feature: intraday-strategy-suite, Property 8

*For any* open Position, the first candle whose ``time`` is at or after the
configured ``square_off`` produces a Signal whose ``direction`` is opposite to the
Position direction (closing it).

**Validates: Requirements 4.3**

This is a *suite-wide* property: it is parameterized across all five strategy
classes (VWAP Mean Reversion, EMA Trend Pullback, ORB Enhanced, Z-Score
Reversion, Volatility Squeeze Breakout) and over both Position directions
(BUY / SELL).

Construction
------------
Opening a position through *natural* candles is strategy-specific, so this test
takes the robust, direct route the design permits: it constructs the strategy and
injects an open ``Position`` straight into ``strategy.state.position`` using the
``Position`` dataclass defined in that strategy's own module. A freshly built
strategy has ``state.last_time is None``, so the first candle never triggers a
new-trading-day reset (which would wipe the injected position) -- the position
survives into the square-off check.

A single well-formed candle is then fed whose normalized ``time`` is at or after a
drawn ``square_off`` cutoff. The design's ``on_candle`` pipeline evaluates
square-off *before* the market-hours, warmup and no-new-entry gates (closing an
open position is a risk-reduction action that must fire regardless of entry
eligibility -- Requirement 4.3), so a Signal must be emitted. The property asserts
the emitted Signal's ``direction`` is the exact opposite of the Position
direction: a BUY position is closed by a SELL Signal and vice versa.
"""

from __future__ import annotations

import datetime as _dt

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import generators as gen
from strategies.base_strategy import Signal

from strategies.vwap_mean_reversion import (
    VWAPMeanReversion,
    Position as VWAPPosition,
)
from strategies.ema_trend_pullback import (
    EMATrendPullback,
    Position as EMAPosition,
)
from strategies.orb_enhanced import (
    ORBEnhanced,
    Position as ORBPosition,
)
from strategies.zscore_reversion import (
    ZScoreReversion,
    Position as ZScorePosition,
)
from strategies.volatility_squeeze import (
    VolatilitySqueezeBreakout,
    Position as SqueezePosition,
)


# NSE intraday session bounds (seconds since midnight), mirroring generators.py.
_SESSION_START = 9 * 3600 + 15 * 60   # 09:15:00
_SESSION_END = 15 * 3600 + 30 * 60    # 15:30:00


def _seconds_to_time(total_seconds: int) -> _dt.time:
    total_seconds %= 24 * 3600
    h, rem = divmod(total_seconds, 3600)
    m, s = divmod(rem, 60)
    return _dt.time(hour=h, minute=m, second=s)


# Each strategy defines its own copy-stable ``Position`` dataclass; pair every
# strategy class with the Position type from its own module so injection uses the
# exact type the strategy's pipeline expects.
STRATEGY_POSITION = [
    (VWAPMeanReversion, VWAPPosition),
    (EMATrendPullback, EMAPosition),
    (ORBEnhanced, ORBPosition),
    (ZScoreReversion, ZScorePosition),
    (VolatilitySqueezeBreakout, SqueezePosition),
]

# Opposite-direction mapping: an open BUY is closed by a SELL and vice versa.
_OPPOSITE = {"BUY": "SELL", "SELL": "BUY"}


# Feature: intraday-strategy-suite, Property 8
@pytest.mark.property
@pytest.mark.parametrize("strategy_cls, position_cls", STRATEGY_POSITION)
@pytest.mark.parametrize("direction", ["BUY", "SELL"])
@settings(max_examples=100)
@given(data=st.data(), base_config=gen.configs())
def test_square_off_closes_open_position(
    strategy_cls,
    position_cls,
    direction,
    data,
    base_config,
):
    """A candle at/after square_off emits a Signal opposite to the open position."""
    # Draw a square-off cutoff and a candle time at or after it (both in-session).
    square_off_secs = data.draw(
        st.integers(min_value=_SESSION_START, max_value=_SESSION_END),
        label="square_off_secs",
    )
    candle_secs = data.draw(
        st.integers(min_value=square_off_secs, max_value=_SESSION_END),
        label="candle_secs",
    )
    square_off_t = _seconds_to_time(square_off_secs)
    candle_t = _seconds_to_time(candle_secs)

    # The candle's time may be supplied as a datetime.time or a "%H:%M:%S" string;
    # square-off behaviour must be identical for both representations.
    as_string = data.draw(st.booleans(), label="time_as_string")
    candle = data.draw(
        gen.candles(
            ordered=True,
            time_value=gen.render_time(candle_t, as_string),
        ),
        label="candle",
    )

    # Pin the configured square-off cutoff to the drawn value (the boundary must
    # always track the Config-supplied value, Requirement 4.3 / 4.4).
    config = dict(base_config)
    config["square_off"] = square_off_t.strftime("%H:%M:%S")

    strategy = strategy_cls(config=config)

    # Inject an open position directly. A fresh strategy has last_time is None, so
    # the first candle cannot be misread as a new trading day (no reset wipes it).
    strategy.state.position = position_cls(
        direction=direction,
        entry_price=100.0,
        stop_loss=98.0 if direction == "BUY" else 102.0,
        target=104.0 if direction == "BUY" else 96.0,
        is_open=True,
    )

    out = strategy.on_candle(candle)

    # Square-off fires before any entry gate, so a Signal MUST be emitted.
    assert out is not None, (
        f"{strategy_cls.__name__}: expected a square-off Signal for an open "
        f"{direction} position at time {candle_t} >= square_off {square_off_t}, "
        f"got None"
    )
    assert isinstance(out, Signal)

    # The square-off Signal closes the position: its direction is the opposite.
    expected = _OPPOSITE[direction]
    assert out.direction == expected, (
        f"{strategy_cls.__name__}: open {direction} position should be closed by a "
        f"{expected} Signal at square-off, got {out.direction!r}"
    )

    # The position is marked closed once squared off (no longer open in state).
    assert (
        strategy.state.position is None
        or not strategy.state.position.is_open
    ), f"{strategy_cls.__name__}: position should be closed after square-off"
