r"""Unit Tests for High-Frequency Limit Order Book Hawkes Self-Excitation & Flash Cascade Sentry (Domain 220 / WP-DR)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.lob_hawkes_flash_cascade_sentry import (
    LOBHawkesFlashCascadeSentry,
    HawkesKernelParams,
    HawkesCascadeRegime,
    HawkesTacticalAction,
)


@pytest.fixture
def sentry() -> LOBHawkesFlashCascadeSentry:
    return LOBHawkesFlashCascadeSentry(
        critical_spectral_radius=0.85,
        elevated_spectral_radius=0.60,
    )


def test_subcritical_stable_flow(sentry: LOBHawkesFlashCascadeSentry):
    # Low excitation: alpha / beta = 0.20 / 1.0 = 0.20
    params = HawkesKernelParams(
        mu_buy=5.0,
        mu_sell=5.0,
        alpha_buy_buy=0.20,
        alpha_buy_sell=0.10,
        alpha_sell_buy=0.10,
        alpha_sell_sell=0.20,
        beta_decay=1.0,
    )

    res = sentry.evaluate_hawkes_sentry(
        symbol="NIFTY",
        params=params,
        buy_timestamps=[10.0, 11.0, 12.0],
        sell_timestamps=[10.5, 11.5],
        current_time_sec=15.0,
    )

    assert res.spectral_radius == 0.30
    assert res.cascade_regime == HawkesCascadeRegime.SUBCRITICAL_STABLE
    assert res.recommended_action == HawkesTacticalAction.MAINTAIN_NORMAL_SPREAD
    assert res.quote_spread_multiplier == 1.0
    assert "Maintain standard quoting spread" in res.tactical_directive


def test_elevated_clustering_watch(sentry: LOBHawkesFlashCascadeSentry):
    # Moderate excitation: alpha / beta ~ 0.70
    params = HawkesKernelParams(
        mu_buy=5.0,
        mu_sell=5.0,
        alpha_buy_buy=0.45,
        alpha_buy_sell=0.25,
        alpha_sell_buy=0.25,
        alpha_sell_sell=0.45,
        beta_decay=1.0,
    )

    res = sentry.evaluate_hawkes_sentry(
        symbol="BANKNIFTY",
        params=params,
        buy_timestamps=[10.0, 11.0],
        sell_timestamps=[10.5],
        current_time_sec=12.0,
    )

    assert 0.60 <= res.spectral_radius < 0.85
    assert res.cascade_regime == HawkesCascadeRegime.ELEVATED_CLUSTERING
    assert res.recommended_action == HawkesTacticalAction.WIDEN_MAKER_SPREAD
    assert res.quote_spread_multiplier == 1.75
    assert "Widen maker spread" in res.tactical_directive


def test_supercritical_flash_cascade_halt(sentry: LOBHawkesFlashCascadeSentry):
    # Runaway excitation: alpha / beta ~ 0.90
    params = HawkesKernelParams(
        mu_buy=10.0,
        mu_sell=10.0,
        alpha_buy_buy=0.60,
        alpha_buy_sell=0.35,
        alpha_sell_buy=0.35,
        alpha_sell_sell=0.60,
        beta_decay=1.0,
    )

    res = sentry.evaluate_hawkes_sentry(
        symbol="RELIANCE",
        params=params,
        buy_timestamps=[10.0, 10.1, 10.2],
        sell_timestamps=[10.05, 10.15],
        current_time_sec=10.25,
    )

    assert res.spectral_radius >= 0.85
    assert res.cascade_regime == HawkesCascadeRegime.SUPERCRITICAL_CASCADE
    assert res.recommended_action == HawkesTacticalAction.EMERGENCY_CANCEL_ALL
    assert res.quote_spread_multiplier == 5.0
    assert "SUPERCRITICAL FLASH CASCADE" in res.tactical_directive


def test_instantaneous_intensity_decay(sentry: LOBHawkesFlashCascadeSentry):
    params = HawkesKernelParams(
        mu_buy=2.0,
        mu_sell=2.0,
        alpha_buy_buy=1.0,
        alpha_buy_sell=0.0,
        alpha_sell_buy=0.0,
        alpha_sell_sell=1.0,
        beta_decay=0.5, # Half life = ln(2)/0.5 = 1.386s
    )

    # Immediate tick at t = 10.0
    res_immediate = sentry.evaluate_hawkes_sentry(
        symbol="TCS",
        params=params,
        buy_timestamps=[10.0],
        sell_timestamps=[],
        current_time_sec=10.0,
    )
    # At t = 10.0, lambda_b = 2.0 + 1.0 * exp(0) = 3.0
    assert pytest.approx(res_immediate.instantaneous_buy_intensity, 0.05) == 3.0

    # 4 seconds later (t = 14.0): decay = exp(-0.5 * 4) = exp(-2) ~ 0.135
    res_later = sentry.evaluate_hawkes_sentry(
        symbol="TCS",
        params=params,
        buy_timestamps=[10.0],
        sell_timestamps=[],
        current_time_sec=14.0,
    )
    expected_later = 2.0 + 1.0 * math.exp(-2.0)
    assert pytest.approx(res_later.instantaneous_buy_intensity, 0.05) == expected_later
    assert res_later.instantaneous_buy_intensity < res_immediate.instantaneous_buy_intensity
