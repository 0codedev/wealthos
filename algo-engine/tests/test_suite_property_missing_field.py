"""Property 3 - Missing guaranteed candle field yields None.

Feature: intraday-strategy-suite, Property 3

Validates: Requirements 2.1, 2.7

*For any* candle missing one or more of the guaranteed fields (``high``, ``low``,
``close``, ``time``), ``on_candle`` returns None and produces a debug log entry
naming a missing field, without mutating indicator state in a way observable to
later candles.

This module is parameterized across all five suite strategies (VWAP Mean
Reversion, EMA Trend Pullback, ORB Enhanced, Z-Score Reversion, Volatility
Squeeze Breakout). The property is suite-wide: every strategy runs the same
fixed-order ``on_candle`` pipeline whose *first* step is schema validation, so a
malformed candle is rejected before any indicator/accumulator update or candle
count increment can occur.

Construction
------------
Two complementary checks cover the property:

1. ``test_missing_field_returns_none_and_no_state_mutation`` feeds a normal,
   schema-valid warmup sequence (which advances ``candle_count`` and the
   strategy's accumulators), snapshots the full Per_Day_State, then feeds a
   candle with exactly one guaranteed field removed. It asserts ``on_candle``
   returns None and the entire Per_Day_State is byte-for-byte unchanged
   (``candle_count`` not incremented, accumulators untouched). Because schema
   validation precedes every state mutation in the pipeline, the malformed
   candle must be a complete no-op for later candles.

2. ``test_missing_field_emits_debug_log_naming_field`` feeds a malformed candle
   to a fresh strategy and asserts that a debug log naming the missing field was
   emitted (captured via the ``logger_capture`` fixture on the strategy's own
   logger).

The malformed candle is produced by ``generators.candles_missing_field()``,
which drops exactly one of the guaranteed fields.
"""

from __future__ import annotations

import copy

import pytest
from hypothesis import HealthCheck, given, settings

import generators as gen

from strategies.vwap_mean_reversion import VWAPMeanReversion
from strategies.ema_trend_pullback import EMATrendPullback
from strategies.orb_enhanced import ORBEnhanced
from strategies.zscore_reversion import ZScoreReversion
from strategies.volatility_squeeze import VolatilitySqueezeBreakout


# A complete, documented Config shared by every strategy. Strategy-specific
# tunables fall back to each strategy's documented ``_cfg`` default when absent,
# so this common subset is sufficient to construct and exercise all five.
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


def _missing_field_of(candle: dict) -> str:
    """Return the single guaranteed field absent from ``candle`` (Property 3)."""
    absent = [f for f in gen.GUARANTEED_FIELDS if f not in candle]
    assert len(absent) == 1, (
        f"generator must drop exactly one guaranteed field; absent={absent!r}"
    )
    return absent[0]


# Feature: intraday-strategy-suite, Property 3
@_STRATEGY_PARAMS
@pytest.mark.property
@settings(max_examples=100)
@given(
    warmup=gen.candle_sequences(days=1, min_len=1, max_len=10),
    malformed=gen.candles_missing_field(),
)
def test_missing_field_returns_none_and_no_state_mutation(
    strategy_cls, warmup, malformed
):
    """A candle missing a guaranteed field returns None and mutates no state."""
    strategy = strategy_cls(config=dict(_CONFIG))

    # Feed a normal, schema-valid warmup sequence so candle_count and the
    # strategy's accumulators actually advance to a non-trivial state.
    for candle in warmup:
        strategy.on_candle(candle)

    # Snapshot the full Per_Day_State (candle_count, last_time, trades_today,
    # position, and every strategy-specific accumulator) before the malformed
    # candle is observed.
    count_before = strategy.state.candle_count
    state_before = copy.deepcopy(strategy.state)

    result = strategy.on_candle(malformed)

    # Req 2.7: a candle missing any guaranteed field yields None.
    assert result is None, (
        f"{strategy_cls.__name__}: expected None for a candle missing "
        f"'{_missing_field_of(malformed)}', got {result!r}"
    )

    # Req 2.1/2.7: schema validation runs before any state mutation, so the
    # malformed candle is a no-op observable to later candles.
    assert strategy.state.candle_count == count_before, (
        f"{strategy_cls.__name__}: candle_count changed from {count_before} to "
        f"{strategy.state.candle_count} on a malformed candle"
    )
    assert strategy.state == state_before, (
        f"{strategy_cls.__name__}: Per_Day_State mutated by a malformed candle "
        f"missing '{_missing_field_of(malformed)}'"
    )


# Feature: intraday-strategy-suite, Property 3
@_STRATEGY_PARAMS
@pytest.mark.property
@settings(
    max_examples=100,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(malformed=gen.candles_missing_field())
def test_missing_field_emits_debug_log_naming_field(
    strategy_cls, malformed, logger_capture
):
    """A candle missing a guaranteed field emits a debug log naming that field."""
    strategy = strategy_cls(config=dict(_CONFIG))
    cap = logger_capture(strategy.name)
    cap.clear()

    missing = _missing_field_of(malformed)
    result = strategy.on_candle(malformed)

    assert result is None, (
        f"{strategy_cls.__name__}: expected None for a candle missing "
        f"'{missing}', got {result!r}"
    )
    # Req 2.7: the debug log must name the missing guaranteed field.
    assert cap.contains(missing), (
        f"{strategy_cls.__name__}: expected a debug log naming the missing field "
        f"'{missing}'; captured: {cap.messages!r}"
    )
