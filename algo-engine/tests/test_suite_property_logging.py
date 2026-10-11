"""Property 10 - Logging is prefixed and never blocks emission.

Feature: intraday-strategy-suite, Property 10

Validates: Requirements 6.1, 6.2

For any emission scenario, every debug log line produced by a strategy begins
with the strategy's configured name, AND injecting a logger that raises on every
call still results in the same Signal being returned.

This is a *suite-wide* property: it is parameterized across all five strategy
classes. Both halves are checked independently:

1. **Prefix (Requirement 6.1).** A :class:`LogCapture` is attached to the
   strategy's own logger (``logging.getLogger(strategy.name)``) via the
   ``logger_capture`` fixture. After feeding a candle sequence, *every* captured
   message must start with ``f"[{strategy.name}]"`` -- the prefix the strategy's
   ``_log`` helper stamps onto each line.

2. **Non-blocking (Requirement 6.2).** The same sequence is run twice on two
   freshly constructed (identical) strategies: once normally, and once with a
   handler that raises on every ``emit`` attached to the strategy's logger (the
   ``raising_logger`` fixture). The strategy's ``_log`` wraps the underlying
   logger call in ``try/except``, so a failing logger must neither suppress nor
   alter any Signal: the full sequence of ``on_candle`` outputs must be identical
   between the two runs.

Construction
------------
Sequences deliberately let hypothesis decide whether ``open`` / ``volume`` are
present so degraded-mode and reset log lines (which still must be prefixed) are
exercised. ``capital`` is forced large and ``warmup_period`` small so real
emissions actually occur, keeping the non-blocking half exercised against true
Signals rather than passing vacuously.
"""

from __future__ import annotations

import logging

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

import generators as gen
from strategies.base_strategy import Signal
from strategies.vwap_mean_reversion import VWAPMeanReversion
from strategies.ema_trend_pullback import EMATrendPullback
from strategies.orb_enhanced import ORBEnhanced
from strategies.zscore_reversion import ZScoreReversion
from strategies.volatility_squeeze import VolatilitySqueezeBreakout


# All five strategies log through the same prefixed, try/except-wrapped ``_log``
# choke point; Property 10 must hold identically for each.
STRATEGY_CLASSES = [
    VWAPMeanReversion,
    EMATrendPullback,
    ORBEnhanced,
    ZScoreReversion,
    VolatilitySqueezeBreakout,
]

# These tests legitimately use function-scoped fixtures (a log capture and a
# raising-logger handler) inside ``@given``. The capture only accumulates
# already-prefixed records and the raising handler is removed per example, so the
# fixtures are safe to reuse across generated inputs. The remaining suppressions
# mirror the shared "intraday-suite" profile (longer candle sequences).
_SUPPRESSED = [
    HealthCheck.function_scoped_fixture,
    HealthCheck.too_slow,
    HealthCheck.data_too_large,
]


def _signal_key(result):
    """Comparable representation of an ``on_candle`` result (Signal or None)."""
    if result is None:
        return None
    assert isinstance(result, Signal)
    return (
        result.direction,
        result.instrument,
        result.quantity,
        result.price,
        result.stop_loss,
        result.target,
        result.strategy_name,
        result.confidence,
    )


# Feature: intraday-strategy-suite, Property 10
@pytest.mark.property
@pytest.mark.parametrize("strategy_cls", STRATEGY_CLASSES)
@settings(max_examples=100, suppress_health_check=_SUPPRESSED)
@given(
    base_config=gen.configs(),
    sequence=gen.candle_sequences(min_len=1, max_len=40),
    warmup=st.integers(min_value=1, max_value=4),
)
def test_every_log_line_is_prefixed(strategy_cls, base_config, sequence, warmup, logger_capture):
    """Requirement 6.1: every emitted debug log line is strategy-name prefixed."""
    config = dict(base_config)
    config["warmup_period"] = warmup
    config["capital"] = 1e12  # keep emissions (and their rationale logs) flowing

    strategy = strategy_cls(config=config)

    # Attach the capture to the strategy's *own* logger (Req 6.1 target).
    cap = logger_capture(strategy.name)

    for candle in sequence:
        strategy.on_candle(candle)

    prefix = f"[{strategy.name}]"
    for message in cap.messages:
        assert message.startswith(prefix), (
            f"log line not prefixed with {prefix!r}: {message!r}"
        )


# Feature: intraday-strategy-suite, Property 10
@pytest.mark.property
@pytest.mark.parametrize("strategy_cls", STRATEGY_CLASSES)
@settings(max_examples=100, suppress_health_check=_SUPPRESSED)
@given(
    base_config=gen.configs(),
    sequence=gen.candle_sequences(min_len=1, max_len=40),
    warmup=st.integers(min_value=1, max_value=4),
)
def test_raising_logger_never_alters_signals(
    strategy_cls, base_config, sequence, warmup, raising_logger
):
    """Requirement 6.2: a logger that raises on emit must not change any Signal."""
    config = dict(base_config)
    config["warmup_period"] = warmup
    config["capital"] = 1e12

    # Run 1: normal logging. Capture the full ordered sequence of outputs.
    normal_strategy = strategy_cls(config=config)
    normal_outputs = [_signal_key(normal_strategy.on_candle(c)) for c in sequence]

    # Run 2: identical strategy, but with a handler that raises on every emit
    # attached to the strategy's own logger (logging.getLogger(strategy.name)).
    raising_strategy = strategy_cls(config=config)
    handler = raising_logger(raising_strategy.name)
    try:
        raising_outputs = [_signal_key(raising_strategy.on_candle(c)) for c in sequence]
    finally:
        # Remove the raising handler immediately so it cannot leak into the next
        # hypothesis example's Run 1 (the fixture also detaches at teardown).
        logging.getLogger(raising_strategy.name).removeHandler(handler)

    assert raising_outputs == normal_outputs, (
        "raising logger altered the strategy's Signal output"
    )
