"""Property 15 - on_tick never emits a Signal.

Feature: intraday-strategy-suite, Property 15

Validates: Requirements 14.3

*For any* tick input, ``on_tick`` returns None. Stop placement is delegated to the
broker-managed (GTT) order manager, so a Strategy never returns a Signal from
``on_tick`` - it only performs internal stop/target bookkeeping (marking an open
Position closed when a tick breaches its stop or target so the Strategy becomes
eligible for re-entry).

This module is parameterized across all five suite strategies (VWAP Mean
Reversion, EMA Trend Pullback, ORB Enhanced, Z-Score Reversion, Volatility
Squeeze Breakout). The property is suite-wide: every strategy shares the same
``on_tick`` implementation whose only return statement yields ``None``.

Construction
------------
Three complementary checks cover the property across both Per_Day_State shapes
the tick handler can observe (flat and with an open position):

1. ``test_on_tick_returns_none_when_flat`` feeds arbitrary ticks - drawn with
   and without a recognised price field - to a fresh strategy that holds no
   open position. ``on_tick`` must return None whether the tick carries a price
   or not.

2. ``test_on_tick_returns_none_with_open_position`` injects an open Position and
   then feeds arbitrary ticks. ``on_tick`` must return None for every tick,
   including the (randomly drawn) prices that breach the injected stop/target.

3. ``test_on_tick_returns_none_on_breach`` injects an open Position with a known
   stop/target and feeds a tick whose price is guaranteed to breach it. This
   exercises the exit-bookkeeping branch explicitly: ``on_tick`` marks the
   position closed internally yet still returns None (the broker-managed order
   manager owns the actual stop execution, Req 14.3).

The injected Position is built from each strategy's own module-level ``Position``
dataclass (every strategy defines an identical one), so no strategy file is
modified to support the test.
"""

from __future__ import annotations

import sys

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import generators as gen

from strategies.vwap_mean_reversion import VWAPMeanReversion
from strategies.ema_trend_pullback import EMATrendPullback
from strategies.orb_enhanced import ORBEnhanced
from strategies.zscore_reversion import ZScoreReversion
from strategies.volatility_squeeze import VolatilitySqueezeBreakout


# A complete, documented Config shared by every strategy. Strategy-specific
# tunables fall back to each strategy's documented default when absent, so this
# common subset is sufficient to construct and exercise all five.
_CONFIG = {
    "instrument": "2885",
    "quantity": 50,
    "capital": 1_000_000.0,
    "market_open": "09:15:00",
    "no_new_entry": "15:00:00",
    "square_off": "15:15:00",
    "session_close": "15:20:00",
    "warmup_period": 5,
    "max_trades_per_day": 5,
}

# All five suite strategies. Each is constructed with a fresh copy of the config.
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


def _make_strategy(strategy_cls):
    """Construct a strategy with a fresh copy of the shared config."""
    return strategy_cls(config=dict(_CONFIG))


def _inject_position(strategy, *, direction: str, entry: float, stop: float, target: float):
    """Place an open Position on ``strategy.state`` using its own Position class.

    Each strategy module defines an identical ``Position`` dataclass; we resolve
    it from the strategy class's module so the test never imports a strategy's
    internals by name nor modifies any strategy file.
    """
    position_cls = sys.modules[type(strategy).__module__].Position
    strategy.state.position = position_cls(
        direction=direction,
        entry_price=float(entry),
        stop_loss=float(stop),
        target=float(target),
        is_open=True,
    )
    return strategy.state.position


# Feature: intraday-strategy-suite, Property 15
@_STRATEGY_PARAMS
@pytest.mark.property
@settings(max_examples=100)
@given(tick=gen.ticks())
def test_on_tick_returns_none_when_flat(strategy_cls, tick):
    """With no open position, on_tick returns None for any tick (Req 14.3)."""
    strategy = _make_strategy(strategy_cls)
    assert strategy.state.position is None

    result = strategy.on_tick(tick)

    assert result is None, (
        f"{strategy_cls.__name__}: on_tick must return None when flat; "
        f"got {result!r} for tick {tick!r}"
    )


# Feature: intraday-strategy-suite, Property 15
@_STRATEGY_PARAMS
@pytest.mark.property
@settings(max_examples=100)
@given(
    tick=gen.ticks(),
    direction=st.sampled_from(["BUY", "SELL"]),
)
def test_on_tick_returns_none_with_open_position(strategy_cls, tick, direction):
    """With an open position, on_tick returns None for any tick (Req 14.3).

    The injected stop/target straddle the entry so a randomly drawn tick price
    may or may not breach them; either way the return value must be None.
    """
    strategy = _make_strategy(strategy_cls)
    if direction == "BUY":
        _inject_position(strategy, direction="BUY", entry=100.0, stop=90.0, target=110.0)
    else:
        _inject_position(strategy, direction="SELL", entry=100.0, stop=110.0, target=90.0)

    result = strategy.on_tick(tick)

    assert result is None, (
        f"{strategy_cls.__name__}: on_tick must return None with an open "
        f"{direction} position; got {result!r} for tick {tick!r}"
    )


# Feature: intraday-strategy-suite, Property 15
@_STRATEGY_PARAMS
@pytest.mark.property
@settings(max_examples=100)
@given(
    breach=st.sampled_from(["stop", "target"]),
    direction=st.sampled_from(["BUY", "SELL"]),
    price_field=st.sampled_from(gen.PRICE_FIELDS),
)
def test_on_tick_returns_none_on_breach(strategy_cls, breach, direction, price_field):
    """A breaching tick marks the position closed yet on_tick still returns None.

    Stop execution is broker-managed (GTT); the strategy only updates internal
    state and never returns a Signal from on_tick (Req 14.3). This asserts both
    halves: the return value is None AND the position was marked closed.
    """
    strategy = _make_strategy(strategy_cls)

    if direction == "BUY":
        # entry 100, stop 90 (below), target 110 (above).
        _inject_position(strategy, direction="BUY", entry=100.0, stop=90.0, target=110.0)
        price = 85.0 if breach == "stop" else 115.0   # <= stop or >= target
    else:
        # SELL: entry 100, stop 110 (above), target 90 (below).
        _inject_position(strategy, direction="SELL", entry=100.0, stop=110.0, target=90.0)
        price = 115.0 if breach == "stop" else 85.0   # >= stop or <= target

    tick = {price_field: price}
    result = strategy.on_tick(tick)

    assert result is None, (
        f"{strategy_cls.__name__}: on_tick must return None even when a tick "
        f"breaches the {direction} position {breach}; got {result!r}"
    )
    # Internal bookkeeping side effect: the breached position is now closed
    # (either cleared to None or flagged not-open), confirming the strategy
    # delegates actual stop execution to the order manager rather than emitting.
    pos = strategy.state.position
    assert pos is None or not pos.is_open, (
        f"{strategy_cls.__name__}: a breaching tick should mark the {direction} "
        f"position closed; position still open: {pos!r}"
    )
