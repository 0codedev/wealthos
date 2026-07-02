"""
Unit Test Suite for Domain 263: High-Frequency Limit Order Book Level-2 Queue Depletion Intensity & Flash Fill Sentry
"""

import pytest
from services.lob_queue_intensity_fill_sentry import (
    LOBQueueIntensityFillSentry,
    L2DepthSnapshot,
    L2QueueDepletionRegime,
    L2MakerDirective,
)


@pytest.fixture
def sentry():
    return LOBQueueIntensityFillSentry(
        critical_hit_prob=0.50,
        warning_hit_prob=0.20,
        critical_vacuum_ratio=0.25,
    )


def test_nominal_queue_buffer(sentry):
    # Deep Level 1 (50,000 shares), moderate drain (500/sec) -> lifetime 100 sec >> 25ms RTT
    snap = L2DepthSnapshot(
        symbol="SPY",
        level1_shares=50_000.0,
        level2_shares=60_000.0,
        level3_shares=80_000.0,
        level1_drain_rate_sec=500.0,
        historical_mean_depth_3levels=200_000.0,
        network_rtt_sec=0.025,
    )
    res = sentry.evaluate_l2_state(snap)
    assert res.regime == L2QueueDepletionRegime.NOMINAL_QUEUE_BUFFER
    assert res.directive == L2MakerDirective.MAINTAIN_L2_QUOTE
    assert res.level2_hit_probability_rtt < 0.10


def test_accelerated_l1_depletion(sentry):
    # L1 has 500 shares, drain rate 5,000 shares/sec -> lifetime 100 ms
    snap = L2DepthSnapshot(
        symbol="AAPL",
        level1_shares=500.0,
        level2_shares=2000.0,
        level3_shares=3000.0,
        level1_drain_rate_sec=5000.0,
        historical_mean_depth_3levels=10_000.0,
        network_rtt_sec=0.025,
    )
    res = sentry.evaluate_l2_state(snap)
    assert res.regime in [
        L2QueueDepletionRegime.ACCELERATED_L1_DEPLETION,
        L2QueueDepletionRegime.MULTI_LEVEL_SWEEP_IMMINENT,
    ]
    if res.regime == L2QueueDepletionRegime.ACCELERATED_L1_DEPLETION:
        assert res.directive == L2MakerDirective.ARM_FAST_CANCEL_GATEWAY


def test_multi_level_sweep_imminent(sentry):
    # L1 has only 40 shares, aggressive sweep of 3,000 shares/sec -> lifetime 13.3 ms < 25ms RTT!
    snap = L2DepthSnapshot(
        symbol="BTC-USDT",
        level1_shares=40.0,
        level2_shares=100.0,
        level3_shares=200.0,
        level1_drain_rate_sec=3000.0,
        historical_mean_depth_3levels=5000.0,
        network_rtt_sec=0.025,
    )
    res = sentry.evaluate_l2_state(snap)
    assert res.regime == L2QueueDepletionRegime.MULTI_LEVEL_SWEEP_IMMINENT
    assert res.directive == L2MakerDirective.EXECUTE_PREEMPTIVE_L2_CANCEL
    assert res.level1_lifetime_ms <= 30.0


def test_vacuum_collapse_fluid(sentry):
    # Both L1 and L2 are 0
    snap = L2DepthSnapshot(
        symbol="ETH-USDT",
        level1_shares=0.0,
        level2_shares=0.0,
        level3_shares=50.0,
        level1_drain_rate_sec=1000.0,
        historical_mean_depth_3levels=5000.0,
    )
    res = sentry.evaluate_l2_state(snap)
    assert res.regime == L2QueueDepletionRegime.VACUUM_COLLAPSE_FLUID
    assert res.directive == L2MakerDirective.EMERGENCY_FLUID_EVACUATION
    assert res.level2_hit_probability_rtt == 1.0


def test_air_pocket_vacuum_trigger(sentry):
    # L1 lifetime seems okay, but total depth is tiny (vacuum ratio = 15% < 25%)
    snap = L2DepthSnapshot(
        symbol="SOL-USDT",
        level1_shares=500.0,
        level2_shares=500.0,
        level3_shares=500.0, # Total = 1,500 vs 10,000 mean -> 15%
        level1_drain_rate_sec=500.0, # lifetime 1 sec
        historical_mean_depth_3levels=10_000.0,
        network_rtt_sec=0.025,
    )
    res = sentry.evaluate_l2_state(snap)
    assert res.air_pocket_vacuum_ratio <= 0.20
    assert res.regime == L2QueueDepletionRegime.MULTI_LEVEL_SWEEP_IMMINENT
    assert res.directive == L2MakerDirective.EXECUTE_PREEMPTIVE_L2_CANCEL
