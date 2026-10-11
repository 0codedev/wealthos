"""Property 9: Absent Config keys fall back to documented defaults.

# Feature: intraday-strategy-suite, Property 9

*For any* subset of optional Config keys omitted at construction, the strategy
constructs successfully and behaves identically to a strategy configured with
those keys set explicitly to their documented defaults.

**Validates: Requirements 5.2**

Approach
--------
Each strategy reads its tunables through ``_cfg(key, default)``; the literal
``default`` argument *is* the documented default for that key (and the module
docstrings publish the same values as the recommended Config). This test pins
those documented defaults per strategy (extracted verbatim from the ``_cfg``
calls in each strategy source), then for any randomly-chosen subset of the
optional keys:

* builds an **explicit-defaults** Config where every optional key is set to its
  documented default value, and
* builds a **partial** Config where the chosen subset of keys is *omitted* (so
  the strategy must fall back to the default for each).

The instrument / quantity / capital keys are kept present in both (they carry
the meaningful sizing/identity the Signal contract needs); the omission is
focused on the tunables that have documented defaults (warmup, max trades, the
session-timing keys, and each strategy's own tunables).

The *same* candle sequence is fed to both instances and the step-by-step
``on_candle`` output must match exactly (both None, or two Signals with all
eight fields equal). If a default applied on omission ever diverges from the
documented default supplied explicitly, the property fails and surfaces the
offending key — i.e. a real default mismatch in the code, which this test does
not paper over.
"""

from __future__ import annotations

import math

import pytest
from hypothesis import given, strategies as st

import generators as gen
from strategies.base_strategy import Signal
from strategies.vwap_mean_reversion import VWAPMeanReversion
from strategies.ema_trend_pullback import EMATrendPullback
from strategies.orb_enhanced import ORBEnhanced
from strategies.zscore_reversion import ZScoreReversion
from strategies.volatility_squeeze import VolatilitySqueezeBreakout


# ---------------------------------------------------------------------------
# Documented defaults, extracted verbatim from each strategy's ``_cfg`` calls.
# ---------------------------------------------------------------------------
# Shared lifecycle tunables (identical ``_cfg`` defaults across all five files).
# instrument / quantity / capital are deliberately excluded here -- they are kept
# present in both configs (see REQUIRED_CONFIG below).
SHARED_DEFAULTS = {
    "warmup_period": 5,
    "max_trades_per_day": 3,
    "market_open": "09:15:00",
    "no_new_entry": "15:00:00",
    "square_off": "15:15:00",
    "session_close": "15:20:00",
}

# Strategy-specific tunables with their documented ``_cfg`` defaults.
STRATEGY_DEFAULTS = {
    VWAPMeanReversion: {
        "entry_deviation": 1.0,
        "stop_distance": 2.0,
        "synthetic_confidence_cap": 0.5,
    },
    EMATrendPullback: {
        "ema_fast_period": 9,
        "ema_med_period": 21,
        "ema_slow_period": 50,
        "pullback_band": 1.0,
        "stop_method": "slow_ema",
        "target_rr": 2.0,
        "swing_lookback": 3,
    },
    ORBEnhanced: {
        "opening_range_minutes": 15,
        "require_retest": True,
        "require_volume_confirmation": True,
        "volume_multiple": 1.5,
        "volume_lookback": 20,
        "stop_multiplier": 1.0,
        "target_multiplier": 2.0,
    },
    ZScoreReversion: {
        "lookback": 20,
        "entry_z": 2.0,
        "exit_z": 3.0,
    },
    VolatilitySqueezeBreakout: {
        "lookback": 20,
        "bb_std": 2.0,
        "kc_multiplier": 1.5,
        "breakout_band": 0.0,
        "target_rr": 2.0,
        "confidence": 0.6,
    },
}

STRATEGY_CLASSES = list(STRATEGY_DEFAULTS.keys())

# Identity / sizing keys kept present in BOTH configs. A generous capital with a
# small quantity keeps the 2% risk gate from vetoing most entries, so signal
# emission (not just the all-None path) is genuinely exercised.
REQUIRED_CONFIG = {
    "instrument": "1333",
    "quantity": 1,
    "capital": 1_000_000_000.0,
}


def _optional_defaults(strategy_cls) -> dict:
    """All optional keys (with documented defaults) for ``strategy_cls``."""
    merged = dict(SHARED_DEFAULTS)
    merged.update(STRATEGY_DEFAULTS[strategy_cls])
    return merged


def _signals_equal(a, b) -> bool:
    """Exact equivalence of two ``on_candle`` outputs (None or full Signal)."""
    if a is None or b is None:
        return a is None and b is None
    assert isinstance(a, Signal) and isinstance(b, Signal)
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
        va = getattr(a, fieldname)
        vb = getattr(b, fieldname)
        if isinstance(va, float) and isinstance(vb, float):
            if math.isnan(va) and math.isnan(vb):
                continue
        if va != vb:
            return False
    return True


@pytest.mark.property
@pytest.mark.parametrize("strategy_cls", STRATEGY_CLASSES)
@given(
    sequence=gen.candle_sequences(min_len=1, max_len=30, max_days=2),
    data=st.data(),
)
def test_absent_config_keys_fall_back_to_documented_defaults(
    strategy_cls, sequence, data
):
    """Omitting optional keys == setting them to their documented defaults."""
    optional = _optional_defaults(strategy_cls)
    optional_keys = sorted(optional.keys())

    # Hypothesis chooses which subset of optional keys to omit (possibly none,
    # possibly all).
    omit = set(
        data.draw(
            st.lists(
                st.sampled_from(optional_keys),
                unique=True,
                max_size=len(optional_keys),
            ),
            label="omitted_keys",
        )
    )

    # Explicit-defaults config: every optional key set to its documented default.
    explicit_config = dict(REQUIRED_CONFIG)
    explicit_config.update(optional)

    # Partial config: the chosen subset omitted -> strategy falls back to default.
    partial_config = dict(REQUIRED_CONFIG)
    partial_config.update({k: v for k, v in optional.items() if k not in omit})

    # Both must construct successfully (Req 5.2: absent keys are tolerated).
    strat_explicit = strategy_cls(config=explicit_config)
    strat_partial = strategy_cls(config=partial_config)

    for i, candle in enumerate(sequence):
        out_explicit = strat_explicit.on_candle(dict(candle))
        out_partial = strat_partial.on_candle(dict(candle))
        assert _signals_equal(out_explicit, out_partial), (
            f"{strategy_cls.__name__}: divergent output at candle {i} when "
            f"omitting {sorted(omit)}\n"
            f"  explicit-defaults -> {out_explicit!r}\n"
            f"  omitted-subset    -> {out_partial!r}"
        )
