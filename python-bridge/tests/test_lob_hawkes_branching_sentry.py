"""
Unit tests for Domain 274 / WP-FT: LOB Hawkes Self-Excitation Branching Sentry
"""

import pytest
import numpy as np
from services.lob_hawkes_branching_sentry import (
    LOBHawkesBranchingSentry,
    HawkesCriticalityRegime,
    HawkesOrderDirective,
)


@pytest.fixture
def sentry():
    return LOBHawkesBranchingSentry(
        baseline_intensity_mu=2.0,
        alpha_jump=1.2,
        beta_decay=1.5,
        critical_branching_hurdle=0.80,
        supercritical_hurdle=1.0,
    )


def test_subcritical_stable_equilibrium(sentry):
    # Only 1 trade 5 seconds ago
    res = sentry.evaluate_lob_flow(
        symbol="BTCUSDT",
        current_time_sec=100.0,
        recent_trade_timestamps=[95.0],
        custom_alpha=0.6,
        custom_beta=1.5,  # eta = 0.40
    )
    assert res.regime == HawkesCriticalityRegime.SUBCRITICAL_STABLE_EQUILIBRIUM
    assert res.directive == HawkesOrderDirective.MAINTAIN_STANDARD_MAKER_QUOTES
    assert res.branching_ratio_eta == 0.40


def test_supercritical_cascade_evacuation(sentry):
    # Cluster of 15 trades in the last 0.05 seconds
    t_now = 100.0
    trades = [t_now - 0.003 * i for i in range(15)]
    res = sentry.evaluate_lob_flow(
        symbol="ETHUSDT",
        current_time_sec=t_now,
        recent_trade_timestamps=trades,
        custom_alpha=1.8,
        custom_beta=1.5,  # eta = 1.20 (Supercritical)
    )
    assert res.regime == HawkesCriticalityRegime.SUPERCRITICAL_CASCADE_EVACUATION
    assert res.directive == HawkesOrderDirective.EMERGENCY_EVACUATE_ALL_RESTING_QUOTES
    assert res.branching_ratio_eta >= 1.0


def test_cascade_exhaustion_mean_reversion_sniper(sentry):
    # 1. Trigger massive peak
    t_peak = 100.0
    trades_peak = [t_peak - 0.002 * i for i in range(25)]
    sentry.evaluate_lob_flow(
        symbol="SOLUSDT",
        current_time_sec=t_peak,
        recent_trade_timestamps=trades_peak,
        custom_alpha=1.5,
        custom_beta=1.5,
    )
    assert sentry.peak_intensity >= 15.0

    # 2. Advance time by 4.0 seconds with no new trades -> intensity collapses > 60%
    t_later = 104.0
    res = sentry.evaluate_lob_flow(
        symbol="SOLUSDT",
        current_time_sec=t_later,
        recent_trade_timestamps=trades_peak,  # Old trades decayed away
        custom_alpha=0.8,
        custom_beta=1.5,
    )
    assert res.regime == HawkesCriticalityRegime.CASCADE_EXHAUSTION_MEAN_REVERSION_SNIPER
    assert res.directive == HawkesOrderDirective.EXECUTE_EXHAUSTION_LIQUIDITY_SNIPE
    assert res.exhaustion_decay_pct >= 55.0


def test_critical_elevated_clustering(sentry):
    # Moderate clustering: eta = 0.85
    res = sentry.evaluate_lob_flow(
        symbol="AVAXUSDT",
        current_time_sec=100.0,
        recent_trade_timestamps=[99.8, 99.9],
        custom_alpha=1.275,
        custom_beta=1.5,  # eta = 0.85
    )
    assert res.regime == HawkesCriticalityRegime.CRITICAL_ELEVATED_CLUSTERING
    assert res.directive == HawkesOrderDirective.WIDEN_QUOTES_HALVE_SIZE
