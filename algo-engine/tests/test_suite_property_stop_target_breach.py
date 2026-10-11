"""Property 13 - Stop/target breach closes the position.

# Feature: intraday-strategy-suite, Property 13

*For any* open Position, a candle or tick whose price reaches or breaches the
Position ``stop_loss`` or ``target`` marks the Position closed immediately, after
which the strategy is eligible for re-entry subject to all entry conditions.

**Validates: Requirements 8.2, 14.1, 14.2**

This is a *suite-wide* property: it is parameterized across all five strategy
classes (VWAP Mean Reversion, EMA Trend Pullback, ORB Enhanced, Z-Score
Reversion, Volatility Squeeze Breakout), over both Position directions
(BUY / SELL), and over the two breach routes (via ``stop_loss`` vs via
``target``).

Construction
------------
Opening a position through *natural* candles is strategy-specific, so this test
takes the robust, direct route the design permits: it constructs the strategy and
injects an open ``Position`` straight into ``strategy.state.position`` using the
``Position`` dataclass defined in that strategy's own module.

A single Tick (a dict carrying a ``price`` field) is then fed to ``on_tick``. The
design's ``on_tick`` pipeline is intentionally minimal -- it does internal stop /
target bookkeeping only and *always returns None* because stops are
broker-managed (GTT). When the tick price reaches or breaches the open Position's
``stop_loss`` or ``target`` the strategy must mark the Position closed
(``state.position is None or not state.position.is_open``), making it eligible for
re-entry; and ``on_tick`` must still return None.

Breach geometry (mirrors each strategy's ``_breaches_exit``)::

    BUY  : price <= stop_loss  OR  price >= target   breaches
    SELL : price >= stop_loss  OR  price <= target   breaches

We fix wide, unambiguous Position levels (entry 1000, stops/targets 10 away) and
draw a non-negative ``offset`` so the drawn tick price lands exactly on the
boundary (offset == 0, "reaches") or strictly past it ("breaches"). To keep the
test from passing vacuously, an *interior* tick (a price strictly inside the
stop/target band, which must NOT close the position) is fed first, then the
breaching tick.
"""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import generators as gen  # noqa: F401  (kept for parity / future use)

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

# Fixed, unambiguous Position levels. The stop/target band is (990, 1010) for
# both directions, so a single interior range works regardless of direction.
_ENTRY = 1000.0
_LEVELS = {
    # direction: (stop_loss, target)
    "BUY": (990.0, 1010.0),   # BUY breaches on price <= 990 (stop) or >= 1010 (target)
    "SELL": (1010.0, 990.0),  # SELL breaches on price >= 1010 (stop) or <= 990 (target)
}


def _make_position(position_cls, direction):
    stop_loss, target = _LEVELS[direction]
    return position_cls(
        direction=direction,
        entry_price=_ENTRY,
        stop_loss=stop_loss,
        target=target,
        is_open=True,
    )


def _breaching_price(direction: str, breach_via: str, offset: float) -> float:
    """Return a price that reaches (offset==0) or breaches (offset>0) the level."""
    stop_loss, target = _LEVELS[direction]
    if breach_via == "stop":
        level = stop_loss
    else:  # "target"
        level = target

    if direction == "BUY":
        # BUY: stop is below entry (cross downward), target is above (cross upward).
        return level - offset if breach_via == "stop" else level + offset
    # SELL: stop is above entry (cross upward), target is below (cross downward).
    return level + offset if breach_via == "stop" else level - offset


# Feature: intraday-strategy-suite, Property 13
@pytest.mark.property
@pytest.mark.parametrize("strategy_cls, position_cls", STRATEGY_POSITION)
@pytest.mark.parametrize("direction", ["BUY", "SELL"])
@pytest.mark.parametrize("breach_via", ["stop", "target"])
@settings(max_examples=100)
@given(data=st.data())
def test_stop_target_breach_closes_position(
    strategy_cls,
    position_cls,
    direction,
    breach_via,
    data,
):
    """A tick that reaches/breaches stop or target marks the open position closed."""
    strategy = strategy_cls()

    # Inject an open position directly using the strategy's own Position type.
    strategy.state.position = _make_position(position_cls, direction)
    assert strategy.state.position is not None and strategy.state.position.is_open

    # 1. An interior tick (price strictly inside the (990, 1010) band) must NOT
    #    breach either level, so the position stays open. This guards against a
    #    vacuous pass where the strategy closes on any tick.
    interior_price = data.draw(
        st.floats(
            min_value=990.0 + 1e-3,
            max_value=1010.0 - 1e-3,
            allow_nan=False,
            allow_infinity=False,
        ),
        label="interior_price",
    )
    out_interior = strategy.on_tick({"price": interior_price})
    assert out_interior is None, (
        f"{strategy_cls.__name__}: on_tick must always return None "
        f"(broker-managed stops), got {out_interior!r}"
    )
    assert (
        strategy.state.position is not None
        and strategy.state.position.is_open
    ), (
        f"{strategy_cls.__name__}: interior tick {interior_price} (inside the "
        f"stop/target band) must NOT close the {direction} position"
    )

    # 2. A breaching tick: offset == 0 reaches the level exactly; offset > 0
    #    breaches it. Both must close the position.
    offset = data.draw(
        st.floats(min_value=0.0, max_value=900.0, allow_nan=False,
                  allow_infinity=False),
        label="breach_offset",
    )
    breach_price = _breaching_price(direction, breach_via, offset)

    out = strategy.on_tick({"price": breach_price})

    # on_tick never emits a Signal (stops are broker-managed) -- always None.
    assert out is None, (
        f"{strategy_cls.__name__}: on_tick must return None even when a breach "
        f"closes the position, got {out!r}"
    )

    # The position is marked closed immediately on reaching/breaching the level,
    # making the strategy eligible for re-entry (Req 8.2, 14.1, 14.2).
    assert (
        strategy.state.position is None
        or not strategy.state.position.is_open
    ), (
        f"{strategy_cls.__name__}: a {direction} position should be closed after a "
        f"tick price {breach_price} reaches/breaches its {breach_via} "
        f"(stop={_LEVELS[direction][0]}, target={_LEVELS[direction][1]})"
    )
