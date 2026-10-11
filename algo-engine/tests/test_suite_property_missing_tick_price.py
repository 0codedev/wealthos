"""Property 16 - Missing tick price yields None.

Feature: intraday-strategy-suite, Property 16

**Validates: Requirements 14.4**

*For any* tick dict lacking the price field required for monitoring, ``on_tick``
returns None and produces a debug log entry naming the missing field.

This module is parameterized across all five suite strategies (VWAP Mean
Reversion, EMA Trend Pullback, ORB Enhanced, Z-Score Reversion, Volatility
Squeeze Breakout).

Every strategy's ``on_tick`` method extracts the tick price via ``_tick_price``
which inspects the three recognised aliases (``price``, ``ltp``, ``last_price``).
When none of those keys is present the helper returns ``None``, the method emits
a debug log containing ``"missing tick price"`` and immediately returns ``None``
without touching the position state. This property validates both the return
value and the log emission across two state shapes:

1. Flat state (no open position).
2. With an open position.
"""

from __future__ import annotations

import sys

import logging
from typing import List

import pytest
from hypothesis import HealthCheck, given, settings

import generators as gen

from strategies.vwap_mean_reversion import VWAPMeanReversion
from strategies.ema_trend_pullback import EMATrendPullback
from strategies.orb_enhanced import ORBEnhanced
from strategies.zscore_reversion import ZScoreReversion
from strategies.volatility_squeeze import VolatilitySqueezeBreakout


# ---------------------------------------------------------------------------
# Shared config
# ---------------------------------------------------------------------------

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

# All five suite strategies
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


# ---------------------------------------------------------------------------
# Inline log capture (avoids function-scoped fixture issues with Hypothesis)
# ---------------------------------------------------------------------------

class _ListHandler(logging.Handler):
    """Minimal handler that appends formatted messages to a list."""

    def __init__(self, sink: List[str]) -> None:
        super().__init__()
        self._sink = sink

    def emit(self, record: logging.LogRecord) -> None:
        self._sink.append(record.getMessage())


class _LogCapture:
    """Attaches to a named logger and records messages. Context-manager safe."""

    def __init__(self, logger_name: str) -> None:
        self._messages: List[str] = []
        self._handler = _ListHandler(self._messages)
        self._handler.setLevel(logging.DEBUG)
        self._logger = logging.getLogger(logger_name)

    def __enter__(self) -> "_LogCapture":
        self._logger.addHandler(self._handler)
        if self._logger.level == logging.NOTSET or self._logger.level > logging.DEBUG:
            self._logger.setLevel(logging.DEBUG)
        return self

    def __exit__(self, *_) -> None:
        self._logger.removeHandler(self._handler)

    def contains(self, substring: str) -> bool:
        return any(substring in m for m in self._messages)

    @property
    def messages(self) -> List[str]:
        return list(self._messages)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_strategy(strategy_cls):
    """Construct a fresh strategy instance with a copy of the shared config."""
    return strategy_cls(config=dict(_CONFIG))


def _inject_position(strategy, *, direction: str, entry: float, stop: float, target: float):
    """Place an open Position on ``strategy.state`` using the strategy module's own Position class."""
    position_cls = sys.modules[type(strategy).__module__].Position
    strategy.state.position = position_cls(
        direction=direction,
        entry_price=float(entry),
        stop_loss=float(stop),
        target=float(target),
        is_open=True,
    )
    return strategy.state.position


# ---------------------------------------------------------------------------
# Property 16 - flat state (no open position)
# ---------------------------------------------------------------------------

# Feature: intraday-strategy-suite, Property 16
@_STRATEGY_PARAMS
@pytest.mark.property
@settings(max_examples=100)
@given(tick=gen.ticks(include_price=False))
def test_missing_tick_price_returns_none_when_flat(strategy_cls, tick):
    """With no open position and a price-absent tick, on_tick returns None (Req 14.4).

    A price-absent tick (lacking all of ``price``, ``ltp``, ``last_price``) must
    cause ``on_tick`` to return None immediately. A debug log entry mentioning the
    missing price must be emitted.
    """
    strategy = _make_strategy(strategy_cls)
    # Confirm the strategy starts flat.
    assert strategy.state.position is None

    with _LogCapture(strategy.name) as cap:
        result = strategy.on_tick(tick)

    assert result is None, (
        f"{strategy_cls.__name__}: on_tick must return None for a price-absent tick "
        f"in flat state; got {result!r} for tick {tick!r}"
    )

    # A debug log entry must have been emitted mentioning the missing price.
    assert cap.contains("missing tick price"), (
        f"{strategy_cls.__name__}: expected a debug log entry mentioning "
        f"'missing tick price' for tick {tick!r}; captured messages: {cap.messages!r}"
    )


# ---------------------------------------------------------------------------
# Property 16 - with open position
# ---------------------------------------------------------------------------

# Feature: intraday-strategy-suite, Property 16
@_STRATEGY_PARAMS
@pytest.mark.property
@settings(max_examples=100)
@given(tick=gen.ticks(include_price=False))
def test_missing_tick_price_returns_none_with_open_position(strategy_cls, tick):
    """With an open BUY position and a price-absent tick, on_tick returns None (Req 14.4).

    Even when a position is open, a tick without a recognised price field must cause
    ``on_tick`` to return None and log the missing-price debug entry. The position
    must remain open (the missing-price guard fires before any breach bookkeeping).
    """
    strategy = _make_strategy(strategy_cls)
    _inject_position(strategy, direction="BUY", entry=100.0, stop=90.0, target=110.0)

    with _LogCapture(strategy.name) as cap:
        result = strategy.on_tick(tick)

    assert result is None, (
        f"{strategy_cls.__name__}: on_tick must return None for a price-absent tick "
        f"with an open BUY position; got {result!r} for tick {tick!r}"
    )

    # The position must still be open — the missing-price guard fires before the
    # breach check, so nothing closes the position.
    pos = strategy.state.position
    assert pos is not None and pos.is_open, (
        f"{strategy_cls.__name__}: open position must remain open when tick has no "
        f"price; position after call: {pos!r}"
    )

    # A debug log entry must have been emitted mentioning the missing price.
    assert cap.contains("missing tick price"), (
        f"{strategy_cls.__name__}: expected a debug log entry mentioning "
        f"'missing tick price' for tick {tick!r}; captured messages: {cap.messages!r}"
    )


# ---------------------------------------------------------------------------
# Property 16 - with open SELL position
# ---------------------------------------------------------------------------

# Feature: intraday-strategy-suite, Property 16
@_STRATEGY_PARAMS
@pytest.mark.property
@settings(max_examples=100)
@given(tick=gen.ticks(include_price=False))
def test_missing_tick_price_returns_none_with_open_sell_position(strategy_cls, tick):
    """With an open SELL position and a price-absent tick, on_tick returns None (Req 14.4).

    Mirrors the BUY scenario to confirm the missing-price guard fires before any
    direction-specific breach logic for SELL positions too.
    """
    strategy = _make_strategy(strategy_cls)
    _inject_position(strategy, direction="SELL", entry=100.0, stop=110.0, target=90.0)

    with _LogCapture(strategy.name) as cap:
        result = strategy.on_tick(tick)

    assert result is None, (
        f"{strategy_cls.__name__}: on_tick must return None for a price-absent tick "
        f"with an open SELL position; got {result!r} for tick {tick!r}"
    )

    # Position must remain open.
    pos = strategy.state.position
    assert pos is not None and pos.is_open, (
        f"{strategy_cls.__name__}: open SELL position must remain open when tick has "
        f"no price; position after call: {pos!r}"
    )

    # Debug log must mention missing price.
    assert cap.contains("missing tick price"), (
        f"{strategy_cls.__name__}: expected a debug log entry mentioning "
        f"'missing tick price' for tick {tick!r}; captured messages: {cap.messages!r}"
    )
