"""Self-tests for the shared generators (task 1.2) and reference computations.

These do not exercise any strategy. They confirm two things later test tasks
depend on:

1. The hypothesis generators in ``generators.py`` produce structurally valid
   Candle / Candle-sequence / Config / Tick inputs (and the deliberately invalid
   variants behave as advertised).
2. The numpy/pandas reference functions in ``references.py`` compute the values
   the model-based properties expect, cross-checked against pandas and small
   hand-computed examples.
"""

from __future__ import annotations

import datetime as _dt
import math

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

import generators as gen
import references as ref


# ===========================================================================
# Generator self-tests
# ===========================================================================
def _normalize_time(value) -> _dt.time:
    if isinstance(value, _dt.time):
        return value
    return _dt.datetime.strptime(value, "%H:%M:%S").time()


@given(gen.candles())
def test_candle_has_guaranteed_fields_and_valid_geometry(candle):
    for field in ("high", "low", "close", "time"):
        assert field in candle, f"missing guaranteed field {field}"
    assert isinstance(candle["high"], float)
    assert isinstance(candle["low"], float)
    assert isinstance(candle["close"], float)
    # ordered=True (default) guarantees low <= close <= high.
    assert candle["low"] <= candle["close"] <= candle["high"]
    if "open" in candle:
        assert candle["low"] <= candle["open"] <= candle["high"]
    # time normalizes to a datetime.time regardless of representation.
    assert isinstance(_normalize_time(candle["time"]), _dt.time)


@given(gen.candles(include_open=True, include_volume=True))
def test_candle_forced_optional_fields_present(candle):
    assert "open" in candle and isinstance(candle["open"], float)
    assert "volume" in candle and isinstance(candle["volume"], float)


@given(gen.candles(include_open=False, include_volume=False))
def test_candle_forced_optional_fields_absent(candle):
    assert "open" not in candle
    assert "volume" not in candle


@given(gen.candles(time_as_string=True))
def test_candle_time_as_string(candle):
    assert isinstance(candle["time"], str)
    assert _normalize_time(candle["time"])  # parseable


@given(gen.candles_missing_field())
def test_candle_missing_field_drops_exactly_one_guaranteed(candle):
    present = [f for f in gen.GUARANTEED_FIELDS if f in candle]
    assert len(present) == len(gen.GUARANTEED_FIELDS) - 1


@given(gen.candle_sequences(max_len=12, max_days=3))
def test_candle_sequence_is_monotonic_within_each_day(sequence):
    assert len(sequence) >= 1
    times = [_normalize_time(c["time"]) for c in sequence]
    # Within a day times strictly increase; a decrease marks a new-day boundary.
    day_starts = 0
    for i in range(1, len(times)):
        if times[i] < times[i - 1]:
            day_starts += 1  # regression = injected day boundary
        else:
            assert times[i] > times[i - 1], "intraday times must be strictly increasing"
    # At least the implicit first day exists.
    assert day_starts >= 0


@given(gen.candle_sequences(days=2, max_len=8))
def test_candle_sequence_two_days_has_one_regression(sequence):
    times = [_normalize_time(c["time"]) for c in sequence]
    regressions = sum(1 for i in range(1, len(times)) if times[i] < times[i - 1])
    assert regressions == 1


@given(gen.configs())
def test_config_has_required_keys_and_valid_ranges(config):
    required = {
        "instrument", "quantity", "capital", "warmup_period",
        "max_trades_per_day", "market_open", "no_new_entry",
        "square_off", "session_close",
    }
    assert required.issubset(config.keys())
    assert isinstance(config["instrument"], str) and config["instrument"]
    assert config["quantity"] >= 1
    assert config["capital"] >= 10_000.0
    assert config["warmup_period"] >= 1
    assert config["max_trades_per_day"] >= 1
    # EMA periods strictly increasing.
    fast, med, slow = config["ema_periods"]
    assert fast < med < slow
    assert 0.0 <= config["synthetic_confidence_cap"] <= 1.0
    # Timing order.
    to_t = _normalize_time
    assert to_t(config["market_open"]) < to_t(config["no_new_entry"])
    assert to_t(config["no_new_entry"]) <= to_t(config["square_off"])
    assert to_t(config["square_off"]) < to_t(config["session_close"])


@given(gen.ticks(include_price=True))
def test_tick_with_price_has_one_recognised_field(tick):
    present = [f for f in gen.PRICE_FIELDS if f in tick]
    assert len(present) == 1
    assert isinstance(tick[present[0]], float)


@given(gen.ticks(include_price=False))
def test_tick_without_price_has_no_price_field(tick):
    assert not any(f in tick for f in gen.PRICE_FIELDS)


# ===========================================================================
# Reference computation self-tests
# ===========================================================================
def test_typical_price_example():
    tp = ref.typical_price([10.0], [4.0], [7.0])
    assert tp[0] == pytest.approx((10.0 + 4.0 + 7.0) / 3.0)


def test_true_vwap_hand_computed():
    highs = [10.0, 12.0]
    lows = [8.0, 10.0]
    closes = [9.0, 11.0]
    volumes = [100.0, 300.0]
    tp0 = (10 + 8 + 9) / 3.0
    tp1 = (12 + 10 + 11) / 3.0
    expected = (tp0 * 100 + tp1 * 300) / 400.0
    assert ref.true_vwap(highs, lows, closes, volumes) == pytest.approx(expected)


def test_true_vwap_zero_volume_raises():
    with pytest.raises(ValueError):
        ref.true_vwap([10.0], [8.0], [9.0], [0.0])


def test_synthetic_vwap_is_running_mean_of_typical_price():
    highs = [10.0, 12.0, 14.0]
    lows = [8.0, 10.0, 12.0]
    closes = [9.0, 11.0, 13.0]
    tps = ref.typical_price(highs, lows, closes)
    assert ref.synthetic_vwap(highs, lows, closes) == pytest.approx(float(np.mean(tps)))
    series = ref.synthetic_vwap_series(highs, lows, closes)
    assert series[-1] == pytest.approx(float(np.mean(tps)))
    assert series[0] == pytest.approx(tps[0])


@given(
    st.lists(gen.prices(min_value=1.0, max_value=1000.0), min_size=1, max_size=50),
    st.integers(min_value=1, max_value=50),
)
def test_ema_recurrence_matches_pandas(closes, period):
    assert ref.ema_last(closes, period) == pytest.approx(
        ref.ema_last_pandas(closes, period), rel=1e-9, abs=1e-9
    )


def test_ema_seeded_with_first_close():
    series = ref.ema_series([5.0, 7.0, 9.0], period=3)
    assert series[0] == pytest.approx(5.0)
    alpha = 2.0 / (3.0 + 1.0)
    assert series[1] == pytest.approx(alpha * 7.0 + (1 - alpha) * 5.0)


def test_rolling_mean_std_zscore_hand_computed():
    values = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert ref.rolling_mean(values, 5) == pytest.approx(3.0)
    # population std of 1..5
    assert ref.rolling_std(values, 5) == pytest.approx(math.sqrt(2.0))
    assert ref.zscore(values, 5) == pytest.approx((5.0 - 3.0) / math.sqrt(2.0))


def test_rolling_uses_only_last_lookback():
    values = [100.0, 1.0, 2.0, 3.0]
    assert ref.rolling_mean(values, 3) == pytest.approx(2.0)


def test_zscore_zero_std_raises():
    with pytest.raises(ZeroDivisionError):
        ref.zscore([5.0, 5.0, 5.0], 3)


def test_bollinger_bands_hand_computed():
    closes = [1.0, 2.0, 3.0, 4.0, 5.0]
    lower, mid, upper = ref.bollinger_bands(closes, 5, bb_std=2.0)
    std = math.sqrt(2.0)
    assert mid == pytest.approx(3.0)
    assert lower == pytest.approx(3.0 - 2.0 * std)
    assert upper == pytest.approx(3.0 + 2.0 * std)


def test_true_range_first_bar_is_high_minus_low():
    tr = ref.true_range([10.0], [8.0], [9.0])
    assert tr[0] == pytest.approx(2.0)


def test_true_range_uses_prev_close():
    highs = [10.0, 11.0]
    lows = [8.0, 9.0]
    closes = [9.0, 10.5]
    tr = ref.true_range(highs, lows, closes)
    # bar 1: max(11-9, |11-9|, |9-9|) = max(2,2,0)=2
    assert tr[1] == pytest.approx(2.0)


def test_keltner_channels_symmetric_around_ema():
    highs = [10.0, 11.0, 12.0, 13.0]
    lows = [8.0, 9.0, 10.0, 11.0]
    closes = [9.0, 10.0, 11.0, 12.0]
    lower, mid, upper = ref.keltner_channels(highs, lows, closes, lookback=4,
                                             kc_multiplier=1.5)
    assert mid == pytest.approx(ref.ema_last(closes, 4))
    channel = 1.5 * ref.atr(highs, lows, closes, 4)
    assert upper - mid == pytest.approx(channel)
    assert mid - lower == pytest.approx(channel)


@given(
    st.lists(gen.prices(min_value=1.0, max_value=1000.0), min_size=2, max_size=40),
    st.integers(min_value=2, max_value=40),
)
def test_rolling_std_matches_numpy_population(values, lookback):
    window = np.asarray(values[-lookback:], dtype=float)
    assert ref.rolling_std(values, lookback) == pytest.approx(
        float(np.std(window, ddof=0))
    )
