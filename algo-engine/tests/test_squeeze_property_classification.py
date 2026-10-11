# Feature: intraday-strategy-suite, Property 31
"""Property 31 - Squeeze is classified when Bollinger Bands sit inside Keltner Channels.

Feature: intraday-strategy-suite, Property 31

Validates: Requirements 13.2

For any window where the Bollinger Bands are fully contained within the Keltner
Channels, the Volatility Squeeze Breakout strategy classifies the state as a
Squeeze; otherwise it does not.

Strategy under test: ``strategies.volatility_squeeze.VolatilitySqueezeBreakout``.
Its ``_update_indicators`` sets ``state.is_squeeze`` once a full ``lookback`` window
of closes exists, using::

    is_squeeze = (bb_upper < kc_upper) and (bb_lower > kc_lower)

where the Bollinger Bands are ``mean ± bb_std * std`` (population std, ``ddof=0``)
over the most-recent ``lookback`` closes, and the Keltner Channels are
``ema ± kc_multiplier * ATR`` with the EMA taken over that same ``lookback`` close
window (period ``lookback``) and ATR the mean of the last ``lookback`` True Range
values (TR computed incrementally against the prior candle's close).

The test feeds a single-day candle sequence (so no new-day reset clears the rolling
windows mid-stream) and, at every step where a full window exists, independently
reconstructs the reference Bollinger Bands and Keltner Channels from the
``references`` primitives and asserts the strategy's ``is_squeeze`` equals the
reference containment predicate ``(bb_upper < kc_upper) and (bb_lower > kc_lower)``.

Reference construction note
---------------------------
``references.bollinger_bands`` is used directly (it computes mean/std over the last
``lookback`` closes, ``ddof=0``). The Keltner Channels are assembled from the
reference primitives ``references.ema_last`` (over the *windowed* closes, matching
the strategy's windowed EMA) and ``references.atr`` (mean of the last ``lookback``
True Range values over the *full* day series, matching the strategy's incrementally
maintained ``tr_window``). This composition mirrors the strategy bit-for-bit, so the
strict band-containment inequality is compared without floating-point ambiguity.

``lookback``, ``bb_std`` and ``kc_multiplier`` are all varied so both squeeze and
non-squeeze classifications are exercised.
"""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import generators as gen
import references as ref

from strategies.volatility_squeeze import VolatilitySqueezeBreakout


# Vary the indicator parameters so both squeeze and non-squeeze states occur.
_LOOKBACKS = st.integers(min_value=2, max_value=15)
_BB_STDS = st.floats(min_value=1.0, max_value=3.0, allow_nan=False, allow_infinity=False)
_KC_MULTS = st.floats(min_value=0.5, max_value=3.0, allow_nan=False, allow_infinity=False)


def _reference_squeeze(highs, lows, closes, lookback, bb_std, kc_mult) -> bool:
    """Reference squeeze predicate over the most-recent ``lookback`` window.

    Mirrors ``VolatilitySqueezeBreakout._update_indicators`` exactly:

    * Bollinger Bands: ``references.bollinger_bands`` (mean ± bb_std·std, ddof=0)
      over the last ``lookback`` closes.
    * Keltner mid: ``references.ema_last`` over the *windowed* closes (period
      ``lookback``) - the strategy seeds its EMA at the first close of the window.
    * Keltner channel: ``kc_mult * references.atr`` where ATR is the mean of the
      last ``lookback`` True Range values computed over the full day series (the
      strategy's ``tr_window`` is built incrementally against the prior close).
    """
    window_closes = list(closes)[-lookback:]

    bb_lower, _bb_mid, bb_upper = ref.bollinger_bands(closes, lookback, bb_std)

    kc_mid = ref.ema_last(window_closes, lookback)
    kc_channel = kc_mult * ref.atr(highs, lows, closes, lookback)
    kc_upper = kc_mid + kc_channel
    kc_lower = kc_mid - kc_channel

    return (bb_upper < kc_upper) and (bb_lower > kc_lower)


# Feature: intraday-strategy-suite, Property 31
@pytest.mark.property
@settings(max_examples=100)
@given(
    sequence=gen.candle_sequences(days=1, min_len=1, max_len=60),
    lookback=_LOOKBACKS,
    bb_std=_BB_STDS,
    kc_mult=_KC_MULTS,
)
def test_squeeze_classified_iff_bands_inside_keltner(sequence, lookback, bb_std, kc_mult):
    """``state.is_squeeze`` equals the band-containment predicate at every full window.

    A single trading day (``days=1``) keeps the rolling close / True-Range windows
    intact (no new-day reset). ``_update_indicators`` runs before any market-hours /
    warmup / entry gate, so ``state.is_squeeze`` is set on every candle regardless of
    whether a signal is emitted; ``warmup_period=1`` removes any incidental gating.
    """
    config = {
        "lookback": lookback,
        "bb_std": bb_std,
        "kc_multiplier": kc_mult,
        "warmup_period": 1,
    }
    strategy = VolatilitySqueezeBreakout(config=config)

    highs: list[float] = []
    lows: list[float] = []
    closes: list[float] = []

    for candle in sequence:
        strategy.on_candle(candle)

        highs.append(float(candle["high"]))
        lows.append(float(candle["low"]))
        closes.append(float(candle["close"]))

        # Squeeze classification is only defined once a full window exists. Before
        # that the strategy leaves ``is_squeeze`` False.
        if len(closes) < lookback:
            assert strategy.state.is_squeeze is False, (
                "is_squeeze must stay False before a full window is available"
            )
            continue

        expected = _reference_squeeze(highs, lows, closes, lookback, bb_std, kc_mult)

        assert strategy.state.is_squeeze == expected, (
            f"is_squeeze={strategy.state.is_squeeze} != reference {expected} "
            f"(lookback={lookback}, bb_std={bb_std}, kc_mult={kc_mult}, "
            f"window_closes={closes[-lookback:]!r})"
        )
