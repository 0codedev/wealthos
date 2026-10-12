"""Property 17 - True VWAP matches the reference computation.

Feature: intraday-strategy-suite, Property 17

Validates: Requirements 2.3, 9.1

For any candle sequence in which every candle carries a valid ``volume``, the
VWAP Mean Reversion strategy's running VWAP must equal the reference value
``sum(typical_price_i * volume_i) / sum(volume_i)`` accumulated over the trading
day (within floating-point tolerance).

The strategy maintains ``state.cum_pv`` / ``state.cum_vol`` and exposes the
running value via ``_current_vwap``; both are checked after every candle against
the numpy/pandas reference in :mod:`references` over the candles observed so far.
The sequence is constrained to a single trading day (``days=1``) so the running
VWAP accumulates cleanly with no day-boundary regression / reset.
"""

from __future__ import annotations

import math

import pytest
from hypothesis import given, settings

import generators as gen
import references as ref

from strategies.vwap_mean_reversion import VWAPMeanReversion


# Feature: intraday-strategy-suite, Property 17
@pytest.mark.property
@settings(max_examples=100)
@given(candles=gen.candle_sequences(include_volume=True, days=1, min_len=1, max_len=60))
def test_true_vwap_matches_reference(candles):
    """The strategy's running true VWAP equals the reference over the day."""
    strategy = VWAPMeanReversion(config={})

    highs: list[float] = []
    lows: list[float] = []
    closes: list[float] = []
    volumes: list[float] = []

    for candle in candles:
        # Every candle in this sequence carries a valid volume (Req 2.3).
        assert "volume" in candle

        strategy.on_candle(candle)

        highs.append(float(candle["high"]))
        lows.append(float(candle["low"]))
        closes.append(float(candle["close"]))
        volumes.append(float(candle["volume"]))

        reference = ref.true_vwap(highs, lows, closes, volumes)

        # 1. Internal accumulators reconstruct the reference VWAP.
        assert strategy.state.cum_vol > 0.0
        accumulated = strategy.state.cum_pv / strategy.state.cum_vol
        assert math.isclose(accumulated, reference, rel_tol=1e-9, abs_tol=1e-9), (
            f"cum_pv/cum_vol={accumulated!r} != reference={reference!r}"
        )

        # 2. The exposed running VWAP matches too, and is reported as non-degraded
        #    because the current candle carries valid volume (Req 9.1).
        vwap, degraded = strategy._current_vwap(candle)
        assert degraded is False
        assert math.isclose(vwap, reference, rel_tol=1e-9, abs_tol=1e-9), (
            f"_current_vwap={vwap!r} != reference={reference!r}"
        )
