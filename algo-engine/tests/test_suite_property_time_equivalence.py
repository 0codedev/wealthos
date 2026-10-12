"""Property 4: Time representation equivalence.

# Feature: intraday-strategy-suite, Property 4

*For any* valid time value, supplying it to a strategy as a ``datetime.time``
instance versus as a ``"%H:%M:%S"`` string produces identical lifecycle gating
decisions and identical signal output.

**Validates: Requirements 2.2**

Approach
--------
Generate a single intraday candle sequence whose ``time`` fields are
``datetime.time`` objects (the generator builds them from whole-second integers,
so ``"%H:%M:%S"`` rendering is exactly lossless). Build a string twin of the
*same* sequence by rendering each candle's ``time`` via ``strftime("%H:%M:%S")``
while leaving every other field (prices, optional ``open``/``volume``) untouched.

Feed each twin to a separate strategy instance constructed with the *same*
Config, and assert the step-by-step ``on_candle`` outputs are identical: both
None, or two Signals with all eight fields equal.
"""

from __future__ import annotations

import datetime as _dt
import math

import pytest
from hypothesis import given

import generators as gen
from strategies.base_strategy import Signal
from strategies.vwap_mean_reversion import VWAPMeanReversion
from strategies.ema_trend_pullback import EMATrendPullback
from strategies.orb_enhanced import ORBEnhanced
from strategies.zscore_reversion import ZScoreReversion
from strategies.volatility_squeeze import VolatilitySqueezeBreakout

# All five strategies under test (parameterized).
STRATEGY_CLASSES = [
    VWAPMeanReversion,
    EMATrendPullback,
    ORBEnhanced,
    ZScoreReversion,
    VolatilitySqueezeBreakout,
]


def _to_string_twin(sequence: list) -> list:
    """Render a ``datetime.time``-keyed candle sequence with string times.

    Every field other than ``time`` is copied verbatim so the only difference
    between the twins is the time representation.
    """
    twin = []
    for candle in sequence:
        c = dict(candle)
        t = c["time"]
        assert isinstance(t, _dt.time), "expected datetime.time source sequence"
        c["time"] = t.strftime("%H:%M:%S")
        twin.append(c)
    return twin


def _signals_equal(a, b) -> bool:
    """Compare two ``on_candle`` outputs for exact equivalence.

    Handles the None case and NaN-vs-NaN float fields (which ``==`` treats as
    unequal) so genuinely identical computations compare equal.
    """
    if a is None or b is None:
        return a is None and b is None
    assert isinstance(a, Signal) and isinstance(b, Signal)
    for field in (
        "direction",
        "instrument",
        "quantity",
        "price",
        "stop_loss",
        "target",
        "strategy_name",
        "confidence",
    ):
        va = getattr(a, field)
        vb = getattr(b, field)
        if isinstance(va, float) and isinstance(vb, float):
            if math.isnan(va) and math.isnan(vb):
                continue
        if va != vb:
            return False
    return True


@pytest.mark.property
@pytest.mark.parametrize("strategy_cls", STRATEGY_CLASSES)
@given(
    sequence=gen.candle_sequences(
        min_len=1,
        max_len=30,
        max_days=2,
        time_as_string=False,  # datetime.time source; string twin built below
    ),
    config=gen.configs(),
)
def test_time_representation_equivalence(strategy_cls, sequence, config):
    """datetime.time and "%H:%M:%S" inputs yield identical per-candle output."""
    time_seq = sequence
    string_seq = _to_string_twin(sequence)

    # Identical config for both instances (copies so neither mutates the other).
    strat_time = strategy_cls(config=dict(config))
    strat_string = strategy_cls(config=dict(config))

    for i, (c_time, c_string) in enumerate(zip(time_seq, string_seq)):
        out_time = strat_time.on_candle(c_time)
        out_string = strat_string.on_candle(c_string)
        assert _signals_equal(out_time, out_string), (
            f"{strategy_cls.__name__}: divergent output at candle {i}\n"
            f"  time-object input -> {out_time!r}\n"
            f"  time-string input -> {out_string!r}"
        )
