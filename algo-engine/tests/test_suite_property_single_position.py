"""Property 12: At most one open position at a time.

# Feature: intraday-strategy-suite, Property 12

*For any* candle sequence, the strategy holds at most one open Position
simultaneously and emits no new entry Signal while a Position is open.

**Validates: Requirements 8.1**

Approach
--------
This is a *suite-wide* property: it is parameterized across all five strategy
classes (VWAPMeanReversion, EMATrendPullback, ORBEnhanced, ZScoreReversion,
VolatilitySqueezeBreakout). All five embed the identical shared lifecycle
pipeline, in which an open trade is tracked by the single ``state.position``
field and the position / re-entry gate suppresses new entries while that field
holds an open Position (design "Position / re-entry control", Req 8.1).

For each example we draw a randomized full Config and feed a *single-day* candle
sequence (``days=1``) so no trading-day reset occurs mid-sequence -- a reset would
legitimately clear an open position and re-arm entries, which would not be a
violation but would complicate the invariant. ``capital`` is forced large and
``warmup_period`` small so that entries actually occur and the property is
exercised against real emissions rather than passing vacuously.

After every ``on_candle`` call we assert two things:

1. **Structural single-position invariant.** ``state.position`` is either ``None``
   or a *single* ``Position`` instance -- never a list/tuple/set of positions.
   The strategy stores at most one open trade.

2. **No-entry-while-open invariant.** An *entry* is detected as an increment of
   ``state.trades_today`` across the call (square-off signals never touch that
   counter). Whenever an entry fires we assert that no position was already open
   at the *start* of that call -- i.e. entries only ever originate from a flat
   state. Equivalently, while a Position is open the strategy emits no new entry
   Signal (Req 8.1).
"""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import generators as gen
from strategies.base_strategy import Signal
from strategies.vwap_mean_reversion import VWAPMeanReversion
from strategies.ema_trend_pullback import EMATrendPullback
from strategies.orb_enhanced import ORBEnhanced
from strategies.zscore_reversion import ZScoreReversion
from strategies.volatility_squeeze import VolatilitySqueezeBreakout


# All five strategies gate entries through the same shared position / re-entry
# control; the single-open-position invariant must hold identically for each
# (Requirement 8.1).
STRATEGY_CLASSES = [
    VWAPMeanReversion,
    EMATrendPullback,
    ORBEnhanced,
    ZScoreReversion,
    VolatilitySqueezeBreakout,
]


def _position_open(strategy) -> bool:
    """True when the strategy currently tracks an open Position."""
    pos = strategy.state.position
    return pos is not None and getattr(pos, "is_open", False)


def _is_single_position(pos) -> bool:
    """True when ``pos`` is a single Position-like object (not a collection).

    Each strategy module defines its *own* ``Position`` dataclass (the engine
    forbids a shared base module beyond ``BaseStrategy``), so this check is
    duck-typed rather than tied to one concrete class: a valid open-position slot
    is either ``None`` or a single object carrying the Position fields, never a
    list/tuple/set/dict of positions.
    """
    if pos is None:
        return True
    if isinstance(pos, (list, tuple, set, dict)):
        return False
    return all(hasattr(pos, attr) for attr in ("direction", "entry_price", "is_open"))


# Feature: intraday-strategy-suite, Property 12
@pytest.mark.property
@pytest.mark.parametrize("strategy_cls", STRATEGY_CLASSES)
@settings(max_examples=100)
@given(
    base_config=gen.configs(),
    sequence=gen.candle_sequences(days=1, min_len=1, max_len=60),
    warmup=st.integers(min_value=1, max_value=4),
)
def test_at_most_one_open_position(strategy_cls, base_config, sequence, warmup):
    """The strategy never holds more than one open Position and never enters while open."""
    config = dict(base_config)
    # Small warmup + large capital so entries actually occur (keeps the property
    # exercised against real emissions rather than passing vacuously). The risk
    # gate and warmup gate must not suppress every possible entry.
    config["warmup_period"] = warmup
    config["capital"] = 1e12

    strategy = strategy_cls(config=config)

    for i, candle in enumerate(sequence):
        # Capture whether a Position was open at the START of this call, before any
        # gating / decision can mutate it (single-day => no reset clears it here).
        open_before = _position_open(strategy)
        trades_before = strategy.state.trades_today

        result = strategy.on_candle(candle)

        # --- Invariant 1: at most one open Position, stored as a single object ---
        pos = strategy.state.position
        assert not isinstance(pos, (list, tuple, set)), (
            f"{strategy_cls.__name__}: state.position holds multiple positions "
            f"({type(pos)!r}) at candle {i}; only a single Position is allowed"
        )
        assert _is_single_position(pos), (
            f"{strategy_cls.__name__}: state.position is neither None nor a single "
            f"Position at candle {i}; got {type(pos)!r}"
        )

        # --- Invariant 2: no new entry while a Position is open ---
        trades_after = strategy.state.trades_today
        entry_fired = trades_after > trades_before
        if entry_fired:
            # An entry can only originate from a flat state (Req 8.1).
            assert not open_before, (
                f"{strategy_cls.__name__}: a new entry fired at candle {i} while a "
                f"Position was already open -- single-position control violated"
            )
            # Exactly one entry per call and the result is a BUY/SELL entry Signal.
            assert trades_after == trades_before + 1, (
                f"{strategy_cls.__name__}: trades_today jumped by "
                f"{trades_after - trades_before} (>1) on a single candle {i}"
            )
            assert isinstance(result, Signal) and result.direction in ("BUY", "SELL")
            # After an entry the strategy is holding exactly one open Position.
            assert _position_open(strategy), (
                f"{strategy_cls.__name__}: entry fired at candle {i} but no open "
                f"Position is being tracked afterwards"
            )
