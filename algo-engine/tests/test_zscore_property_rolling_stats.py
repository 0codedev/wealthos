# Feature: intraday-strategy-suite, Property 27
"""Property 27 - Rolling statistics and z-score match the reference computation.

Feature: intraday-strategy-suite, Property 27

Validates: Requirements 12.1, 12.2

For any ``close`` window of length ``lookback``, the Bollinger / Z-Score Reversion
strategy's rolling mean and rolling standard deviation must equal the numpy
reference values, and the computed Z_Score must equal ``(close - mean) / std``
(within floating-point tolerance), for any configured ``lookback``.

Strategy under test: ``strategies.zscore_reversion.ZScoreReversion``. The strategy
maintains its rolling window in ``state.close_window`` (a ``deque`` with
``maxlen == lookback``) and computes the rolling mean / population standard
deviation (``np.std`` with ``ddof=0``) over that window inside ``_decide``. The
ground-truth values come from ``references.rolling_mean`` / ``references.rolling_std``
(population std, ``ddof=0``) / ``references.zscore``.

The test feeds a single-day candle sequence; once the strategy has accumulated a
full ``lookback`` window of closes it asserts that:

  1. the maintained window equals exactly the last ``lookback`` closes observed,
  2. ``np.mean`` / ``np.std(ddof=0)`` over that window equal the references, and
  3. the standardized latest close ``(close - mean) / std`` equals ``references.zscore``.

The degenerate ``std == 0`` case (identical closes over the window) is skipped here
because it is non-computable and is covered by Property 29 / task 7.6.
"""

from __future__ import annotations

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import generators as gen
import references as ref

from strategies.zscore_reversion import ZScoreReversion


# ``lookback`` is varied across configs (Property 27: "for any configured lookback").
_LOOKBACKS = st.integers(min_value=2, max_value=30)


# Feature: intraday-strategy-suite, Property 27
@pytest.mark.property
@settings(max_examples=100)
@given(
    sequence=gen.candle_sequences(days=1, min_len=1, max_len=60),
    lookback=_LOOKBACKS,
)
def test_rolling_stats_and_zscore_match_reference(sequence, lookback):
    """Strategy rolling mean/std and z-score equal the numpy reference values.

    A single trading day (``days=1``) is used so no new-day reset clears the rolling
    window midway. The window is appended on every candle *before* any market-hours /
    warmup / entry gate, so ``state.close_window`` always reflects the closes observed
    so far regardless of whether a signal is emitted.
    """
    config = {"lookback": lookback, "warmup_period": 1}
    strategy = ZScoreReversion(config=config)

    closes_so_far: list[float] = []
    for candle in sequence:
        strategy.on_candle(candle)
        closes_so_far.append(float(candle["close"]))

        window = list(strategy.state.close_window)

        # (1) The strategy retains exactly the last ``lookback`` closes.
        expected_window = closes_so_far[-lookback:]
        assert window == expected_window, (
            f"close_window={window!r} != last {lookback} closes {expected_window!r}"
        )

        # Rolling statistics are only defined once a full window exists; the strategy
        # computes them over exactly ``lookback`` samples.
        if len(window) < lookback:
            continue

        arr = np.asarray(window, dtype=float)
        strat_mean = float(np.mean(arr))
        strat_std = float(np.std(arr))  # population std (ddof=0), the strategy's choice

        ref_mean = ref.rolling_mean(closes_so_far, lookback)
        ref_std = ref.rolling_std(closes_so_far, lookback)  # ddof=0

        # (2) Rolling mean / std match the numpy reference values.
        assert strat_mean == pytest.approx(ref_mean, rel=1e-9, abs=1e-9), (
            f"rolling mean {strat_mean!r} != reference {ref_mean!r}"
        )
        assert strat_std == pytest.approx(ref_std, rel=1e-9, abs=1e-9), (
            f"rolling std {strat_std!r} != reference {ref_std!r}"
        )

        # Skip the non-computable zero-dispersion case (covered by Property 29).
        if ref_std == 0.0:
            continue

        # (3) Z_Score equals (close - mean) / std and matches the reference.
        close = closes_so_far[-1]
        strat_z = (close - strat_mean) / strat_std
        ref_z = ref.zscore(closes_so_far, lookback)
        assert strat_z == pytest.approx(ref_z, rel=1e-9, abs=1e-9), (
            f"z-score {strat_z!r} != reference {ref_z!r}"
        )
