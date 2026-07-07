"""
Unit tests for Domain 265 / WP-FK: Volume Fractal Rescaling & VWAP Execution Anchor Sentry
"""

import pytest
from services.volume_fractal_vwap_anchor_sentry import (
    VolumeFractalVWAPAnchorSentry,
    VolumeSliceObservation,
    PacingRegime,
    ExecutionDirective,
)


@pytest.fixture
def sentry():
    return VolumeFractalVWAPAnchorSentry(
        base_participation_rate=0.05,
        max_participation_cap=0.15,
        min_participation_floor=0.01,
        max_slippage_hurdle_bps=8.0,
        fractal_alpha=0.85,
    )


def test_diurnal_volume_curve_monotonicity(sentry):
    # Verify boundary conditions
    assert sentry.expected_volume_fraction(0.0) == 0.0
    assert sentry.expected_volume_fraction(1.0) == 1.0

    # Verify strict monotonicity across intraday trading hours
    times = [0.1, 0.25, 0.5, 0.75, 0.9]
    fractions = [sentry.expected_volume_fraction(t) for t in times]
    for i in range(len(fractions) - 1):
        assert fractions[i] < fractions[i + 1]


def test_optimal_aligned_pacing(sentry):
    # Midday (t=0.5), expected volume fraction approx 0.45-0.55
    t = 0.5
    expected_full_day = 100000.0
    expected_to_now = sentry.expected_volume_fraction(t) * expected_full_day

    # Realized volume matches expected
    slices = [
        VolumeSliceObservation(
            timestamp_sec=i * 60.0,
            market_price=100.0,
            market_volume=expected_to_now / 10.0,
            our_filled_volume=(expected_to_now / 10.0) * 0.05,
            our_fill_cost=(expected_to_now / 10.0) * 0.05 * 100.01,  # 1 bps slippage
        )
        for i in range(10)
    ]

    res = sentry.evaluate_execution("BTCUSDT", t, slices, expected_full_day, "BUY")
    assert res.regime == PacingRegime.OPTIMAL_ALIGNED_PACING
    assert res.directive == ExecutionDirective.MAINTAIN_TARGET_PARTICIPATION
    assert 0.9 <= res.pacing_ratio <= 1.1
    assert res.slippage_bps < 8.0


def test_volume_surge_acceleration(sentry):
    t = 0.3
    expected_full_day = 100000.0
    expected_to_now = sentry.expected_volume_fraction(t) * expected_full_day

    # Surge: 1.5x volume realized
    surged_vol = expected_to_now * 1.50
    slices = [
        VolumeSliceObservation(
            timestamp_sec=100.0,
            market_price=150.0,
            market_volume=surged_vol,
            our_filled_volume=surged_vol * 0.05,
            our_fill_cost=surged_vol * 0.05 * 150.02,
        )
    ]

    res = sentry.evaluate_execution("ETHUSDT", t, slices, expected_full_day, "BUY")
    assert res.regime == PacingRegime.VOLUME_SURGE_ACCELERATE
    assert res.directive == ExecutionDirective.EXPAND_PARTICIPATION_ALLOWANCE
    assert res.pacing_ratio >= 1.25
    assert res.recommended_participation_rate > 0.05


def test_volume_drought_deceleration(sentry):
    t = 0.6
    expected_full_day = 100000.0
    expected_to_now = sentry.expected_volume_fraction(t) * expected_full_day

    # Drought: Only 0.5x normal volume
    drought_vol = expected_to_now * 0.50
    slices = [
        VolumeSliceObservation(
            timestamp_sec=200.0,
            market_price=200.0,
            market_volume=drought_vol,
            our_filled_volume=drought_vol * 0.04,
            our_fill_cost=drought_vol * 0.04 * 200.01,
        )
    ]

    res = sentry.evaluate_execution("SOLUSDT", t, slices, expected_full_day, "BUY")
    assert res.regime == PacingRegime.VOLUME_DROUGHT_DECELERATE
    assert res.directive == ExecutionDirective.CURTAIL_EXECUTION_PACING
    assert res.pacing_ratio <= 0.75
    assert res.recommended_participation_rate < 0.05


def test_adverse_vwap_slippage_breach(sentry):
    t = 0.4
    expected_full_day = 100000.0

    # Toxic execution: filled at 100.20 when market VWAP is 100.00 (+20 bps slippage)
    slices = [
        VolumeSliceObservation(
            timestamp_sec=300.0,
            market_price=100.0,
            market_volume=20000.0,
            our_filled_volume=1000.0,
            our_fill_cost=1000.0 * 100.20,
        )
    ]

    res = sentry.evaluate_execution("AVAXUSDT", t, slices, expected_full_day, "BUY")
    assert res.regime == PacingRegime.ADVERSE_VWAP_SLIPPAGE_BREACH
    assert res.directive == ExecutionDirective.HALT_AND_REPROFILE_ORDER
    assert res.slippage_bps >= 8.0
    assert res.recommended_participation_rate == sentry.min_pr
