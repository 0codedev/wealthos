# Feature: intraday-strategy-suite, Property 5
"""Property 5 (Squeeze scope): prior-close substitution equivalence.

Validates: Requirements 2.6

For any intraday candle sequence, *omitting* the ``open`` field must be exactly
equivalent to *supplying* an ``open`` equal to the prior candle's ``close`` -- both
inputs must produce identical signal output from the Volatility Squeeze Breakout
strategy.

The first candle of a session has no prior candle, so its effective open falls back
to its own ``close``. The twin sequence built here mirrors that first-candle fallback
so the two strategy instances see logically identical effective opens throughout
(this matches ``VolatilitySqueezeBreakout._update_indicators``: ``effective_open`` is
``candle["open"]`` when present, else the prior-candle close, else -- on the very
first candle -- the current close).
"""

from __future__ import annotations

from typing import List, Optional

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import generators as gen
from strategies.base_strategy import Signal
from strategies.volatility_squeeze import VolatilitySqueezeBreakout


def _twin_with_explicit_open(sequence: List[dict]) -> List[dict]:
    """Return a copy of ``sequence`` where every candle carries an explicit ``open``.

    Each candle's ``open`` is set to the PRIOR candle's ``close``. The first candle's
    ``open`` is set to its own ``close`` to match the strategy's first-candle fallback
    (``effective_open`` is the current close when there is no prior close yet).
    """
    twin: List[dict] = []
    prev_close: Optional[float] = None
    for candle in sequence:
        clone = dict(candle)
        clone["open"] = prev_close if prev_close is not None else float(candle["close"])
        twin.append(clone)
        prev_close = float(candle["close"])
    return twin


def _signals_equal(a: Optional[Signal], b: Optional[Signal]) -> bool:
    """True when two ``on_candle`` outputs are equivalent (both None, or all fields equal)."""
    if a is None and b is None:
        return True
    if (a is None) != (b is None):
        return False
    return (
        a.direction == b.direction
        and a.price == b.price
        and a.stop_loss == b.stop_loss
        and a.target == b.target
        and a.confidence == b.confidence
        and a.instrument == b.instrument
        and a.quantity == b.quantity
        and a.strategy_name == b.strategy_name
    )


@st.composite
def _squeeze_configs(draw) -> dict:
    """A randomized but valid Volatility Squeeze Breakout Config.

    A small ``lookback`` and ``warmup_period`` keep the bands/squeeze reachable so the
    decision path -- not just the gated/None path -- is exercised by the equivalence
    check. ``breakout_band`` is kept small (often zero) so squeeze-release breakouts
    can actually fire, ensuring the body-confirmation step (``close`` vs
    ``effective_open``) -- the consumer of the prior-close substitution -- is reached.
    """
    return {
        "instrument": "13",
        "quantity": draw(st.integers(min_value=1, max_value=100)),
        "capital": 1_000_000.0,
        "warmup_period": draw(st.integers(min_value=1, max_value=5)),
        "max_trades_per_day": draw(st.integers(min_value=1, max_value=10)),
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
        "lookback": draw(st.integers(min_value=2, max_value=10)),
        "bb_std": draw(
            st.floats(min_value=0.5, max_value=3.0, allow_nan=False, allow_infinity=False)
        ),
        "kc_multiplier": draw(
            st.floats(min_value=0.5, max_value=3.0, allow_nan=False, allow_infinity=False)
        ),
        "breakout_band": draw(
            st.floats(min_value=0.0, max_value=10.0, allow_nan=False, allow_infinity=False)
        ),
        "target_rr": draw(
            st.floats(min_value=0.5, max_value=5.0, allow_nan=False, allow_infinity=False)
        ),
        "confidence": draw(
            st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)
        ),
    }


@pytest.mark.property
@settings(max_examples=100)
@given(
    sequence=gen.candle_sequences(days=1, include_open=False, min_len=1, max_len=40),
    config=_squeeze_configs(),
)
def test_prior_close_substitution_equivalence_squeeze(sequence, config):
    """Omitting ``open`` == supplying prior-close ``open`` for the Squeeze strategy (Property 5)."""
    twin = _twin_with_explicit_open(sequence)

    strat_omitted = VolatilitySqueezeBreakout(config=dict(config))
    strat_explicit = VolatilitySqueezeBreakout(config=dict(config))

    for index, (candle_omitted, candle_explicit) in enumerate(zip(sequence, twin)):
        # Guard the test's own premise: the omitted-open sequence truly lacks `open`.
        assert "open" not in candle_omitted
        sig_omitted = strat_omitted.on_candle(candle_omitted)
        sig_explicit = strat_explicit.on_candle(candle_explicit)
        assert _signals_equal(sig_omitted, sig_explicit), (
            f"signal mismatch at candle index {index}: "
            f"omitted={sig_omitted!r} explicit={sig_explicit!r}"
        )
