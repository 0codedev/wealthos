"""Unit tests for services/volume_profile_engine.py — NumPy + Polars, pure compute."""

import os
import sys
from datetime import datetime, timedelta

import numpy as np
import polars as pl
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.volume_profile_engine import (  # noqa: E402
    compute_multi_window_profile,
    compute_volume_profile,
    load_bars,
)


def _synthetic_bars(n_days: int = 35, bars_per_day: int = 25, seed: int = 7) -> pl.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    price = 100.0
    start = datetime(2026, 1, 5, 9, 15)  # a Monday
    day = 0
    while day < n_days:
        cur = start + timedelta(days=day)
        if cur.weekday() >= 5:  # skip weekends to mimic trading days
            day += 1
            continue
        for i in range(bars_per_day):
            price = max(1.0, price + rng.normal(0, 0.4))
            hi = price + abs(rng.normal(0, 0.15))
            lo = price - abs(rng.normal(0, 0.15))
            rows.append(
                {
                    "timestamp": (cur + timedelta(minutes=5 * i)).strftime("%Y-%m-%dT%H:%M:%S+05:30"),
                    "open": price,
                    "high": max(hi, lo, price),
                    "low": min(hi, lo, price),
                    "close": price,
                    "volume": int(rng.integers(500, 50_000)),
                }
            )
        day += 1
    return pl.DataFrame(rows)


def test_volume_is_conserved_exactly():
    frame = load_bars(_synthetic_bars())
    profile = compute_volume_profile(frame, window_days=5, n_bins=80)
    window = frame.with_columns(pl.col("timestamp").dt.date().alias("d"))
    days = window.get_column("d").unique().sort(descending=True).head(5)
    expected = (
        window.filter(pl.col("d").is_in(days.to_list())).get_column("volume").sum()
    )
    assert profile.total_volume == pytest.approx(float(expected), rel=1e-9)
    assert profile.profile is not None
    assert sum(profile.profile) == pytest.approx(profile.total_volume, rel=1e-9)


def test_poc_is_arg_max_bin_and_value_area_brackets_it():
    frame = load_bars(_synthetic_bars())
    profile = compute_volume_profile(frame, window_days=10, n_bins=100)
    assert profile.profile is not None
    profile_arr = np.asarray(profile.profile)
    assert profile.value_area.poc_bin == int(np.argmax(profile_arr))
    assert profile.value_area.val <= profile.value_area.poc <= profile.value_area.vah
    assert profile.price_low <= profile.value_area.val
    assert profile.value_area.vah <= profile.price_high


def test_value_area_captures_at_least_configured_fraction():
    frame = load_bars(_synthetic_bars())
    profile = compute_volume_profile(frame, window_days=10, n_bins=100, value_area_pct=0.70)
    assert profile.value_area.captured_pct >= 0.70
    # Cannot capture materially more than one bin beyond the target.
    if profile.total_volume > 0:
        one_bin = float(np.asarray(profile.profile).max()) / profile.total_volume
        assert profile.value_area.captured_pct <= 0.70 + one_bin + 1e-9


def test_window_uses_last_n_distinct_trading_days():
    frame = load_bars(_synthetic_bars())
    five = compute_volume_profile(frame, window_days=5)
    thirty = compute_volume_profile(frame, window_days=30)
    assert five.bars_used <= thirty.bars_used
    assert five.total_volume <= thirty.total_volume


def test_flat_tape_is_handled_without_error():
    frame = load_bars(
        pl.DataFrame(
            {
                "timestamp": [
                    "2026-01-05T09:15:00+05:30",
                    "2026-01-05T09:20:00+05:30",
                ],
                "open": [10.0, 10.0],
                "high": [10.0, 10.0],
                "low": [10.0, 10.0],
                "close": [10.0, 10.0],
                "volume": [5, 7],
            }
        )
    )
    profile = compute_volume_profile(frame, window_days=5, n_bins=20)
    assert profile.total_volume == pytest.approx(12.0)
    assert profile.value_area.captured_pct == pytest.approx(1.0)


def test_zero_volume_and_empty_input_fail_soft():
    empty = compute_volume_profile(load_bars(pl.DataFrame()), window_days=5)
    assert empty.total_volume == 0.0
    assert empty.value_area.captured_pct == 0.0
    assert empty.hvn == [] and empty.lvn == []

    zeros = load_bars(
        pl.DataFrame(
            {
                "timestamp": ["2026-01-05T09:15:00+05:30"],
                "open": [10.0],
                "high": [10.0],
                "low": [10.0],
                "close": [10.0],
                "volume": [0],
            }
        )
    )
    profile = compute_volume_profile(zeros, window_days=5)
    assert profile.total_volume == 0.0


def test_hvn_and_lvn_strengths_are_normalized():
    frame = load_bars(_synthetic_bars(n_days=40))
    profile = compute_volume_profile(frame, window_days=30, n_bins=100)
    for node in profile.hvn + profile.lvn:
        assert 0.0 <= node.strength <= 1.0
        assert node.lower <= node.price <= node.upper
        assert node.volume >= 0.0


def test_relative_levels_are_on_correct_sides_of_reference():
    frame = load_bars(_synthetic_bars())
    profile = compute_volume_profile(frame, window_days=20, n_bins=100)
    rel = profile.relative
    assert rel is not None
    if rel.nearest_hvn_above is not None:
        assert rel.nearest_hvn_above >= rel.reference_price
    if rel.nearest_hvn_below is not None:
        assert rel.nearest_hvn_below <= rel.reference_price
    if rel.nearest_lvn_above is not None:
        assert rel.nearest_lvn_above >= rel.reference_price


def test_multi_window_reports_both_horizons():
    frame = load_bars(_synthetic_bars(n_days=45))
    multi = compute_multi_window_profile(frame, windows=(5, 30))
    assert set(multi.profiles.keys()) == {5, 30}
    assert multi.short_window == 5 and multi.long_window == 30
    assert multi.value_area_overlap_pct is None or 0.0 <= multi.value_area_overlap_pct <= 100.0


def test_load_bars_preserves_ist_dates_for_offset_timestamps(tmp_path):
    # Regression: Polars >= 1.x silently nulls tz-offset strings without a format.
    path = tmp_path / "bars.parquet"
    pl.DataFrame(
        {
            "timestamp": ["2026-01-05T09:15:00+05:30", "2026-01-06T09:15:00+05:30"],
            "open": [1.0, 2.0],
            "high": [2.0, 3.0],
            "low": [0.5, 1.5],
            "close": [1.5, 2.5],
            "volume": [100, 200],
        }
    ).write_parquet(path)
    frame = load_bars(path)
    assert frame.height == 2
    assert frame.schema["timestamp"].time_zone == "Asia/Kolkata"
    assert frame.get_column("timestamp").dt.date().to_list() == [
        datetime(2026, 1, 5).date(),
        datetime(2026, 1, 6).date(),
    ]
    assert "open_interest" not in frame.columns


def test_load_bars_repairs_inverted_and_negative_values():
    frame = load_bars(
        pl.DataFrame(
            {
                "timestamp": ["2026-01-05T09:15:00+05:30", "2026-01-05T09:20:00+05:30"],
                "open": [10.0, 11.0],
                "high": [9.0, 12.0],   # first row inverted
                "low": [12.0, 10.0],
                "close": [11.0, 11.5],
                "volume": [-50, 100],  # negative clipped
            }
        )
    )
    assert frame.height == 2
    assert frame.get_column("volume").to_list() == [0.0, 100.0]
    assert frame.get_column("high").to_list()[0] >= frame.get_column("low").to_list()[0]
