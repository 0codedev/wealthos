# Feature: intraday-strategy-suite, Property 20
"""Property 20 - EMA stack matches the reference recurrence.

This module owns a single model-based property: the EMA Trend Pullback strategy's
incrementally-maintained EMA stack (``state.ema_fast`` / ``state.ema_med`` /
``state.ema_slow``) must equal the pure reference recurrence

    ema_t = alpha * close_t + (1 - alpha) * ema_{t-1},   alpha = 2 / (period + 1)

(seeded with the first close) for *any* close sequence and *any* configured set of
EMA periods.

Strategy under test: ``strategies.ema_trend_pullback.EMATrendPullback`` driven via the
configurable period keys ``ema_fast_period`` / ``ema_med_period`` / ``ema_slow_period``
(defaults 9/21/50). Inputs come from the shared generators (``candle_sequences``) and
the ground-truth recurrence lives in ``references.ema_last``.

Validates: Requirements 10.1
"""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import generators as gen
import references as ref

from strategies.ema_trend_pullback import EMATrendPullback


# Periods cover the documented defaults (9/21/50) and the broader configurable space.
_PERIODS = st.integers(min_value=1, max_value=60)


@pytest.mark.property
@settings(max_examples=100)
@given(
    sequence=gen.candle_sequences(days=1, min_len=1, max_len=60),
    fast_period=_PERIODS,
    med_period=_PERIODS,
    slow_period=_PERIODS,
)
def test_ema_stack_matches_reference_recurrence(
    sequence, fast_period, med_period, slow_period
):
    """Each maintained EMA equals the reference recurrence for any close sequence.

    A single trading day is used (``days=1``) so no new-day reset clears the EMA
    accumulators midway. The strategy updates its EMA stack on every candle *before*
    any market-hours / warmup / entry gate, so the final ``state`` EMAs reflect the
    whole close sequence regardless of when (or whether) signals are emitted.
    """
    config = {
        "ema_fast_period": fast_period,
        "ema_med_period": med_period,
        "ema_slow_period": slow_period,
    }
    strategy = EMATrendPullback(config=config)

    for candle in sequence:
        strategy.on_candle(candle)

    closes = [float(c["close"]) for c in sequence]

    assert strategy.state.ema_fast == pytest.approx(
        ref.ema_last(closes, fast_period), rel=1e-9, abs=1e-9
    )
    assert strategy.state.ema_med == pytest.approx(
        ref.ema_last(closes, med_period), rel=1e-9, abs=1e-9
    )
    assert strategy.state.ema_slow == pytest.approx(
        ref.ema_last(closes, slow_period), rel=1e-9, abs=1e-9
    )
