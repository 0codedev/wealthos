# Feature: intraday-strategy-suite, Property 30
"""Property 30 - Bollinger Bands and Keltner Channels match reference formulas.

Feature: intraday-strategy-suite, Property 30

Validates: Requirements 13.1

For any ``close`` / ``high`` / ``low`` window of length ``lookback``, the Volatility
Squeeze Breakout strategy's Bollinger Bands (``mean +/- bb_std * std``) and Keltner
Channels (``ema +/- kc_multiplier * ATR``) equal the pure numpy/pandas reference
formulas (within floating-point tolerance), for any configured ``lookback``,
``bb_std`` and ``kc_multiplier``.

Strategy under test: ``strategies.volatility_squeeze.VolatilitySqueezeBreakout``.

How the bands are observed
--------------------------
``_update_indicators`` computes the four band edges on every candle once a full
``lookback`` window has accumulated, but it only persists the *derived*
classification (``state.is_squeeze``) - the raw band edges are not stored on
``state``. The two rolling windows that feed the band math *are* stored, however:

* ``state.close_window`` - the most recent ``lookback`` closes (feeds the Bollinger
  mean / population std and the Keltner EMA centre), and
* ``state.tr_window``    - the most recent ``lookback`` True-Range values (ATR is
  their mean).

So this test replicates the strategy's band reads off those two windows using the
*exact* operations ``_update_indicators`` uses (``np.mean`` / ``np.std(ddof=0)`` for
Bollinger, ``VolatilitySqueezeBreakout._ema`` and ``mean(tr_window)`` for Keltner)
and asserts they equal the independent references
(``references.bollinger_bands`` / ``references.keltner_channels``, which in turn use
``references.ema_last`` and ``references.atr``).

Window alignment
----------------
Each example feeds a single trading day of *exactly* ``lookback`` candles. With the
window length equal to the whole fed series, the most-recent-``lookback`` window the
strategy uses is the entire day, so:

* the reference ATR's first-bar ``TR = high - low`` convention coincides with the
  strategy's first-candle-of-day ``prev_close is None`` convention, and
* the reference EMA seed (first close of the series) coincides with the strategy's
  EMA seed (first element of ``close_window``).

This is precisely the "window of length ``lookback``" that Property 30 quantifies
over, and it lets the references and the strategy be compared without seeding
ambiguity. (The strategy's ``prev_close`` / ATR handling is confirmed to match the
reference under this alignment; see the ATR note above.)
"""

from __future__ import annotations

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import generators as gen
import references as ref

from strategies.volatility_squeeze import VolatilitySqueezeBreakout


# Property 30 ranges over "any configured lookback / bb_std / kc_multiplier".
_LOOKBACKS = st.integers(min_value=2, max_value=30)
_BB_STD = st.floats(min_value=1.0, max_value=3.0, allow_nan=False, allow_infinity=False)
_KC_MULT = st.floats(min_value=0.1, max_value=5.0, allow_nan=False, allow_infinity=False)

# Relative + absolute tolerance for the floating-point band comparison. Prices range
# up to ~1e5 so a relative tolerance carries the comparison; the absolute floor keeps
# near-zero band widths (degenerate flat windows) from tripping on rounding noise.
_REL = 1e-9
_ABS = 1e-9


# Feature: intraday-strategy-suite, Property 30
@pytest.mark.property
@settings(max_examples=100)
@given(data=st.data())
def test_bollinger_and_keltner_match_reference(data):
    """Strategy Bollinger Bands and Keltner Channels equal the reference formulas.

    A single day of exactly ``lookback`` candles is fed so the strategy's rolling
    windows hold the full fed series once the last candle is processed; the band math
    then operates over that window and is compared to the references built from the
    same window.
    """
    lookback = data.draw(_LOOKBACKS, label="lookback")
    bb_std = data.draw(_BB_STD, label="bb_std")
    kc_multiplier = data.draw(_KC_MULT, label="kc_multiplier")

    # Exactly ``lookback`` candles in a single trading day (no new-day reset).
    sequence = data.draw(
        gen.candle_sequences(days=1, min_len=lookback, max_len=lookback),
        label="sequence",
    )

    config = {
        "lookback": lookback,
        "bb_std": bb_std,
        "kc_multiplier": kc_multiplier,
        "warmup_period": 1,
    }
    strategy = VolatilitySqueezeBreakout(config=config)

    for candle in sequence:
        strategy.on_candle(candle)

    state = strategy.state

    # The window must be full for the bands to be defined (Req 13.1: bands computed
    # once a full ``lookback`` window exists).
    assert len(state.close_window) == lookback, (
        f"close_window length {len(state.close_window)} != lookback {lookback}"
    )
    assert len(state.tr_window) == lookback, (
        f"tr_window length {len(state.tr_window)} != lookback {lookback}"
    )

    highs = [float(c["high"]) for c in sequence]
    lows = [float(c["low"]) for c in sequence]
    closes = [float(c["close"]) for c in sequence]

    # --- Reference band edges (independent numpy/pandas ground truth) ---
    ref_bb_lower, ref_bb_mid, ref_bb_upper = ref.bollinger_bands(
        closes, lookback, bb_std
    )
    ref_kc_lower, ref_kc_mid, ref_kc_upper = ref.keltner_channels(
        highs, lows, closes, lookback, kc_multiplier
    )

    # --- Strategy band edges, replicated from the stored windows exactly as
    # ``_update_indicators`` computes them (the raw edges are not stored on state). ---
    strat_closes = np.asarray(state.close_window, dtype=float)
    strat_mean = float(np.mean(strat_closes))
    strat_std = float(np.std(strat_closes, ddof=0))  # population std (numpy default)
    strat_bb_upper = strat_mean + bb_std * strat_std
    strat_bb_lower = strat_mean - bb_std * strat_std

    strat_ema = VolatilitySqueezeBreakout._ema(strat_closes, lookback)
    strat_atr = float(np.mean(np.asarray(state.tr_window, dtype=float)))
    strat_kc_upper = strat_ema + kc_multiplier * strat_atr
    strat_kc_lower = strat_ema - kc_multiplier * strat_atr

    # --- Property 30: strategy bands equal the reference formulas ---
    assert strat_mean == pytest.approx(ref_bb_mid, rel=_REL, abs=_ABS), (
        f"Bollinger mid {strat_mean!r} != reference {ref_bb_mid!r}"
    )
    assert strat_bb_upper == pytest.approx(ref_bb_upper, rel=_REL, abs=_ABS), (
        f"Bollinger upper {strat_bb_upper!r} != reference {ref_bb_upper!r}"
    )
    assert strat_bb_lower == pytest.approx(ref_bb_lower, rel=_REL, abs=_ABS), (
        f"Bollinger lower {strat_bb_lower!r} != reference {ref_bb_lower!r}"
    )
    assert strat_ema == pytest.approx(ref_kc_mid, rel=_REL, abs=_ABS), (
        f"Keltner mid (EMA) {strat_ema!r} != reference {ref_kc_mid!r}"
    )
    assert strat_kc_upper == pytest.approx(ref_kc_upper, rel=_REL, abs=_ABS), (
        f"Keltner upper {strat_kc_upper!r} != reference {ref_kc_upper!r}"
    )
    assert strat_kc_lower == pytest.approx(ref_kc_lower, rel=_REL, abs=_ABS), (
        f"Keltner lower {strat_kc_lower!r} != reference {ref_kc_lower!r}"
    )

    # Anchor: the replicated edges are genuinely the strategy's edges - the squeeze
    # classification the strategy actually stored must equal the containment test on
    # the bands computed here (Bollinger fully inside Keltner). This ties the
    # reference-equal band values to observable strategy state.
    expected_squeeze = (strat_bb_upper < strat_kc_upper) and (
        strat_bb_lower > strat_kc_lower
    )
    assert state.is_squeeze == expected_squeeze, (
        f"is_squeeze={state.is_squeeze} != containment {expected_squeeze} "
        f"(bb=[{strat_bb_lower}, {strat_bb_upper}], "
        f"kc=[{strat_kc_lower}, {strat_kc_upper}])"
    )
