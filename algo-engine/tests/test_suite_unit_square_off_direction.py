"""Unit tests anchoring square-off direction – Task 10.16.

Feature: intraday-strategy-suite, Unit Test (square-off direction)

Validates: Requirements 4.3

Requirement 4.3 states:
    WHEN the Candle ``time`` reaches or exceeds the configured Square_Off_Time
    (default 15:15 IST) AND a Position is open, THE Strategy SHALL emit a
    square-off Signal **in the direction that closes the Position**.

These concrete unit tests parameterize across all five suite strategies and
exercise two mirror-image cases:

1. Open BUY position  (entry=100, stop=90, target=110) -> square-off Signal
   must carry direction="SELL" and strategy_name == strategy.name.
2. Open SELL position (entry=100, stop=110, target=90) -> square-off Signal
   must carry direction="BUY".
3. After the square-off Signal is returned, the position must be cleared
   (strategy.state.position is None or not is_open).

Construction
------------
Each test:
  * Constructs the strategy with warmup_period=1 so a single pre-warmup candle
    is enough to satisfy the warmup gate.
  * Feeds one "initialisation" candle at 09:15:00 (within normal trading hours)
    so the day's state is seeded and the candle count reaches the warmup period.
  * Injects an open Position directly onto ``strategy.state`` using each
    strategy's own module-level ``Position`` dataclass (resolved via
    ``sys.modules``) – no strategy file is modified.
  * Feeds one "square-off trigger" candle at 15:16:00 (past the configured
    15:15:00 square_off time).  The candle uses prices that would *not* breach
    the injected position's stop/target so the only exit path is the square-off
    gate.
  * Asserts the returned Signal has the expected closing direction and that the
    position is subsequently cleared.
"""

from __future__ import annotations

import sys

import pytest

from strategies.vwap_mean_reversion import VWAPMeanReversion
from strategies.ema_trend_pullback import EMATrendPullback
from strategies.orb_enhanced import ORBEnhanced
from strategies.zscore_reversion import ZScoreReversion
from strategies.volatility_squeeze import VolatilitySqueezeBreakout


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

# Minimal config: warmup_period=1 means the very first candle completes warmup
# so the second candle (the square-off candle) hits the square-off gate on its
# first eligible evaluation.
_CONFIG = {
    "instrument": "2885",
    "quantity": 50,
    "capital": 1_000_000.0,
    "market_open": "09:15:00",
    "no_new_entry": "15:00:00",
    "square_off": "15:15:00",
    "session_close": "15:20:00",
    "warmup_period": 1,
    "max_trades_per_day": 5,
}

# All five suite strategies parameterized by class.
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
# Helpers
# ---------------------------------------------------------------------------

def _make_strategy(strategy_cls):
    """Construct a strategy with a fresh copy of the shared minimal config."""
    return strategy_cls(config=dict(_CONFIG))


def _inject_position(strategy, *, direction: str, entry: float, stop: float, target: float):
    """Inject an open Position using the strategy's own module-level Position class.

    Every strategy module defines an identical ``Position`` dataclass; we resolve
    it from the module so no strategy internals are imported by name and no
    strategy file is modified.
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


def _init_candle(time_str: str = "09:15:00") -> dict:
    """A valid, quiet candle that won't trigger any entry or breach any position.

    Prices cluster tightly around 100 so they lie comfortably between the test
    position's stop (90) and target (110), preventing the injected position from
    being closed by the on_candle decision layer before the square-off gate fires.
    """
    return {
        "high": 101.0,
        "low": 99.0,
        "close": 100.0,
        "time": time_str,
    }


def _square_off_candle(time_str: str = "15:16:00") -> dict:
    """A valid candle past the square_off boundary (15:15:00).

    Prices are the same neutral cluster, so the candle neither triggers a new
    entry nor breaches the injected position's stop/target through any tick path.
    The only exit mechanism for this candle is the square-off gate.
    """
    return {
        "high": 101.0,
        "low": 99.0,
        "close": 100.0,
        "time": time_str,
    }


# ---------------------------------------------------------------------------
# Test 1 – open BUY → square-off Signal must be SELL
# ---------------------------------------------------------------------------

@_STRATEGY_PARAMS
@pytest.mark.unit
def test_square_off_buy_position_emits_sell(strategy_cls):
    """Open BUY position squared off at 15:16 produces a SELL Signal (Req 4.3).

    Steps:
      1. Feed an initialisation candle at 09:15 to seed the day state and pass
         warmup (warmup_period=1).
      2. Inject an open BUY position (entry=100, stop=90, target=110).
      3. Feed a square-off candle at 15:16.
      4. Assert the returned Signal has direction="SELL" and the correct strategy name.
    """
    strategy = _make_strategy(strategy_cls)

    # Step 1: seed day state / satisfy warmup.
    strategy.on_candle(_init_candle("09:15:00"))

    # Step 2: inject an open BUY position.
    _inject_position(strategy, direction="BUY", entry=100.0, stop=90.0, target=110.0)
    assert strategy.state.position is not None, (
        f"{strategy_cls.__name__}: position injection failed"
    )

    # Step 3: trigger square-off.
    signal = strategy.on_candle(_square_off_candle("15:16:00"))

    # Step 4: assertions.
    assert signal is not None, (
        f"{strategy_cls.__name__}: expected a square-off Signal for an open BUY "
        f"position at 15:16; got None"
    )
    assert signal.direction == "SELL", (
        f"{strategy_cls.__name__}: square-off of a BUY position must emit direction='SELL'; "
        f"got {signal.direction!r}"
    )
    assert signal.strategy_name == strategy.name, (
        f"{strategy_cls.__name__}: signal.strategy_name should be {strategy.name!r}; "
        f"got {signal.strategy_name!r}"
    )


# ---------------------------------------------------------------------------
# Test 2 – open SELL → square-off Signal must be BUY
# ---------------------------------------------------------------------------

@_STRATEGY_PARAMS
@pytest.mark.unit
def test_square_off_sell_position_emits_buy(strategy_cls):
    """Open SELL position squared off at 15:16 produces a BUY Signal (Req 4.3).

    Steps:
      1. Feed an initialisation candle at 09:15 to seed the day state and pass
         warmup (warmup_period=1).
      2. Inject an open SELL position (entry=100, stop=110, target=90).
      3. Feed a square-off candle at 15:16.
      4. Assert the returned Signal has direction="BUY".
    """
    strategy = _make_strategy(strategy_cls)

    # Step 1: seed day state / satisfy warmup.
    strategy.on_candle(_init_candle("09:15:00"))

    # Step 2: inject an open SELL position.
    _inject_position(strategy, direction="SELL", entry=100.0, stop=110.0, target=90.0)
    assert strategy.state.position is not None, (
        f"{strategy_cls.__name__}: position injection failed"
    )

    # Step 3: trigger square-off.
    signal = strategy.on_candle(_square_off_candle("15:16:00"))

    # Step 4: assertions.
    assert signal is not None, (
        f"{strategy_cls.__name__}: expected a square-off Signal for an open SELL "
        f"position at 15:16; got None"
    )
    assert signal.direction == "BUY", (
        f"{strategy_cls.__name__}: square-off of a SELL position must emit direction='BUY'; "
        f"got {signal.direction!r}"
    )
    assert signal.strategy_name == strategy.name, (
        f"{strategy_cls.__name__}: signal.strategy_name should be {strategy.name!r}; "
        f"got {signal.strategy_name!r}"
    )


# ---------------------------------------------------------------------------
# Test 3 – position is cleared after the square-off Signal is returned
# ---------------------------------------------------------------------------

@_STRATEGY_PARAMS
@pytest.mark.unit
@pytest.mark.parametrize(
    "open_direction,close_direction",
    [("BUY", "SELL"), ("SELL", "BUY")],
    ids=["BUY_position", "SELL_position"],
)
def test_square_off_clears_position(strategy_cls, open_direction, close_direction):
    """After the square-off Signal is returned the position must be cleared (Req 4.3).

    Verifies both the BUY and SELL mirror cases:
      * strategy.state.position is None, OR
      * strategy.state.position.is_open is False.

    Either form of "cleared" is acceptable; the contract only requires the strategy
    to be flat after a square-off so it is eligible for a new session's re-entry.
    """
    strategy = _make_strategy(strategy_cls)

    # Seed day state and satisfy warmup.
    strategy.on_candle(_init_candle("09:15:00"))

    # Inject the appropriate open position.
    if open_direction == "BUY":
        _inject_position(strategy, direction="BUY", entry=100.0, stop=90.0, target=110.0)
    else:
        _inject_position(strategy, direction="SELL", entry=100.0, stop=110.0, target=90.0)

    assert strategy.state.position is not None and strategy.state.position.is_open, (
        f"{strategy_cls.__name__}: pre-condition failed – position not open before square-off"
    )

    # Trigger square-off.
    signal = strategy.on_candle(_square_off_candle("15:16:00"))

    # The signal must have been returned (direction is verified in the other two tests).
    assert signal is not None, (
        f"{strategy_cls.__name__}: expected a square-off Signal for an open "
        f"{open_direction} position at 15:16; got None"
    )
    assert signal.direction == close_direction, (
        f"{strategy_cls.__name__}: expected direction={close_direction!r} for "
        f"square-off of {open_direction} position; got {signal.direction!r}"
    )

    # Position must now be cleared.
    pos = strategy.state.position
    position_cleared = (pos is None) or (not pos.is_open)
    assert position_cleared, (
        f"{strategy_cls.__name__}: position must be cleared after square-off "
        f"Signal is returned; state.position={pos!r}"
    )
