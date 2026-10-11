"""Property 1 - Emitted signals satisfy the full Signal contract.

Feature: intraday-strategy-suite, Property 1

Validates: Requirements 1.4, 1.5, 1.6, 1.7, 5.3, 5.4

For any candle/tick sequence that causes a strategy to emit a Signal, the emitted
Signal has all eight fields populated with their dataclass-defined types,
``direction`` in {"BUY", "SELL"}, ``strategy_name`` equal to the strategy's
configured name, ``instrument`` equal to ``config["instrument"]``, ``quantity``
equal to ``config["quantity"]`` exactly (no risk-based resizing), and
``confidence`` within the inclusive range [0.0, 1.0] even when intermediate
internal confidence values fall outside that range.

This is a *suite-wide* property: it is parameterized across all five strategy
classes and applies to every Signal a strategy emits, whether it is an entry
Signal or a square-off Signal (both flow through the single ``_make_signal``
choke point).

Construction
------------
We draw a randomized full Config (covering the union of every strategy's tunables
via :func:`generators.configs`) and then pin ``instrument`` and ``quantity`` to
*known* drawn values so the test can assert the emitted Signal mirrors them
exactly. ``capital`` is forced large and ``warmup_period`` small so that the risk
gate and warmup gate do not suppress *every* emission -- this keeps the property
exercised against real emissions rather than passing vacuously. Each candle of a
single-day sequence is fed to ``on_candle``; every non-None result is checked
against the full contract. A batch of ticks (with and without a price field) is
fed to ``on_tick`` to confirm it never emits.
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


# All five strategies emit through the same ``_make_signal`` choke point; the
# contract must hold identically for each (Requirement 1.4-1.7, 5.3, 5.4).
STRATEGY_CLASSES = [
    VWAPMeanReversion,
    EMATrendPullback,
    ORBEnhanced,
    ZScoreReversion,
    VolatilitySqueezeBreakout,
]


def _assert_signal_contract(signal, strategy, config):
    """Assert a single emitted Signal honours the full Signal contract."""
    # Right type, all eight fields populated (none missing / None).
    assert isinstance(signal, Signal)
    for fieldname in (
        "direction",
        "instrument",
        "quantity",
        "price",
        "stop_loss",
        "target",
        "strategy_name",
        "confidence",
    ):
        assert getattr(signal, fieldname) is not None, f"field {fieldname!r} is None"

    # Dataclass-defined types (Req 1.4). bool is excluded for the int field.
    assert isinstance(signal.direction, str)
    assert isinstance(signal.instrument, str)
    assert isinstance(signal.quantity, int) and not isinstance(signal.quantity, bool)
    assert isinstance(signal.price, float)
    assert isinstance(signal.stop_loss, float)
    assert isinstance(signal.target, float)
    assert isinstance(signal.strategy_name, str)
    assert isinstance(signal.confidence, float)

    # direction is exactly BUY or SELL (Req 1.7).
    assert signal.direction in ("BUY", "SELL")

    # strategy_name mirrors the strategy's configured name (Req 1.5).
    assert signal.strategy_name == strategy.name

    # instrument / quantity mirror Config exactly, no resizing (Req 5.3, 5.4).
    assert signal.instrument == str(config["instrument"])
    assert signal.quantity == int(config["quantity"])

    # confidence clamped to the inclusive [0.0, 1.0] range (Req 1.6).
    assert 0.0 <= signal.confidence <= 1.0


# Feature: intraday-strategy-suite, Property 1
@pytest.mark.property
@pytest.mark.parametrize("strategy_cls", STRATEGY_CLASSES)
@settings(max_examples=100)
@given(
    base_config=gen.configs(),
    sequence=gen.candle_sequences(days=1, min_len=1, max_len=40),
    tick_batch=st.lists(gen.ticks(), min_size=0, max_size=8),
    instrument=st.text(alphabet="0123456789", min_size=1, max_size=6),
    quantity=st.integers(min_value=1, max_value=10_000),
    warmup=st.integers(min_value=1, max_value=4),
)
def test_emitted_signals_satisfy_full_contract(
    strategy_cls,
    base_config,
    sequence,
    tick_batch,
    instrument,
    quantity,
    warmup,
):
    """Every Signal emitted by any of the five strategies honours the contract."""
    config = dict(base_config)
    # Pin known values so the Signal can be checked to mirror them exactly.
    config["instrument"] = instrument
    config["quantity"] = quantity
    # Small warmup + large capital so emissions actually occur (the warmup gate and
    # the 2% risk gate do not suppress every signal), keeping the property exercised.
    config["warmup_period"] = warmup
    config["capital"] = 1e12

    strategy = strategy_cls(config=config)

    for candle in sequence:
        result = strategy.on_candle(candle)
        if result is not None:
            _assert_signal_contract(result, strategy, config)

    # on_tick never emits a Signal (stops are broker-managed); it only does internal
    # bookkeeping and always returns None.
    for tick in tick_batch:
        assert strategy.on_tick(tick) is None
