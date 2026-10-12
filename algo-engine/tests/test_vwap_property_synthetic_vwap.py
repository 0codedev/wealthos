"""Property 18 - Synthetic VWAP and confidence cap under missing volume.

Feature: intraday-strategy-suite, Property 18
Validates: Requirements 2.4, 9.1

This module owns a single model-based property for the VWAP Mean Reversion
strategy's *degraded* mode (no ``volume`` field on any candle):

  *For any* candle sequence in which ``volume`` is absent, the strategy's
  Synthetic_VWAP equals the running mean of ``Typical_Price = (high+low+close)/3``,
  and any **entry** Signal emitted in this degraded mode has ``confidence`` no
  greater than the configured ``synthetic_confidence_cap``.

The strategy accumulates ``synthetic_sum`` and ``candle_count`` per candle and
exposes the running Synthetic_VWAP via ``_current_vwap``; we compare that value,
candle by candle, against :func:`references.synthetic_vwap` (the numpy running
mean of Typical_Price). Separately we collect every entry Signal (detected via a
``trades_today`` increment, which only happens on entry - never on square-off)
and assert the confidence cap holds.

Single-day sequences (``days=1``) are used so there is no new-day reset and the
running accumulators grow monotonically across the whole sequence.
"""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import generators as gen
import references as ref
from strategies.vwap_mean_reversion import VWAPMeanReversion


@st.composite
def _entry_friendly_configs(draw) -> dict:
    """Config dict tuned so degraded-mode entries are reachable.

    - ``entry_deviation`` is small so a stretched ``close`` clears the threshold.
    - ``stop_distance`` * ``quantity`` stays far inside the 2% risk cap
      (``0.02 * 1_000_000 = 20_000``), so the risk gate never vetoes the entry.
    - ``warmup_period`` is small so entries become eligible quickly.
    - ``synthetic_confidence_cap`` is drawn across the full [0, 1] range so the
      cap assertion is exercised at every level.
    """
    return {
        "instrument": "1333",
        "quantity": draw(st.integers(min_value=1, max_value=10)),
        "capital": 1_000_000.0,
        "warmup_period": draw(st.integers(min_value=1, max_value=3)),
        "max_trades_per_day": 20,
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
        "entry_deviation": draw(
            st.floats(min_value=0.01, max_value=1.0, allow_nan=False,
                      allow_infinity=False)
        ),
        "stop_distance": draw(
            st.floats(min_value=0.01, max_value=1.0, allow_nan=False,
                      allow_infinity=False)
        ),
        "synthetic_confidence_cap": draw(
            st.floats(min_value=0.0, max_value=1.0, allow_nan=False,
                      allow_infinity=False)
        ),
    }


@pytest.mark.property
@settings(max_examples=100)
@given(
    sequence=gen.candle_sequences(
        include_volume=False, days=1, min_len=1, max_len=40
    ),
    config=_entry_friendly_configs(),
)
def test_synthetic_vwap_and_confidence_cap(sequence, config):
    # Feature: intraday-strategy-suite, Property 18
    # Validates: Requirements 2.4, 9.1
    strategy = VWAPMeanReversion(config=config)
    cap = config["synthetic_confidence_cap"]

    highs: list[float] = []
    lows: list[float] = []
    closes: list[float] = []

    for candle in sequence:
        highs.append(float(candle["high"]))
        lows.append(float(candle["low"]))
        closes.append(float(candle["close"]))

        # Detect entries via a trades_today increment (entries increment it;
        # square-off signals do not).
        prev_trades = strategy.state.trades_today
        sig = strategy.on_candle(candle)

        # --- Part 1: Synthetic_VWAP equals the running mean of Typical_Price. ---
        vwap, degraded = strategy._current_vwap(candle)
        assert degraded is True, "volume absent must put the strategy in degraded mode"
        expected = ref.synthetic_vwap(highs, lows, closes)
        assert vwap == pytest.approx(expected, rel=1e-9, abs=1e-9)

        # --- Part 2: any entry Signal in degraded mode respects the cap. ---
        if sig is not None and strategy.state.trades_today > prev_trades:
            assert sig.confidence <= cap + 1e-12
