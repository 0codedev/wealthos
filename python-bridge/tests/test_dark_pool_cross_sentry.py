"""
Unit Test Suite for Domain 240: Multi-Venue Dark Pool Ping & Hidden Liquidity Cross Sentry
"""

import pytest
from services.dark_pool_cross_sentry import (
    DarkPoolCrossSentry,
    DarkVenueProfile,
    PingProbeObservation,
    DarkPoolRegimeState,
    DarkRoutingDirective,
)


@pytest.fixture
def sentry():
    return DarkPoolCrossSentry(
        toxic_drift_threshold_bps=2.50,
        sniffing_probe_size_max=100.0,
        min_acceptable_fill_rate=0.15,
        lit_half_spread_bps=4.0,
    )


def test_detect_sniffing_probes(sentry):
    probes = [
        PingProbeObservation("POOL_A", 50.0, True, 12.0, 3.2),   # Sniffing probe! (<=100 shares, >2.5 bps drift)
        PingProbeObservation("POOL_B", 500.0, True, 15.0, 3.0),  # Not a probe (size 500 > 100)
        PingProbeObservation("POOL_C", 50.0, False, 20.0, 0.0),  # Not filled
        PingProbeObservation("POOL_D", 80.0, True, 10.0, 0.5),   # Filled, but safe drift 0.5 < 2.5
    ]
    detected, venues = sentry.detect_sniffing_probes(probes)
    assert detected
    assert venues == ["POOL_A"]


def test_tranquil_clean_cross(sentry):
    venues = [
        DarkVenueProfile("SIGMA_X", 0.65, 0.8, 15.0, 10_000.0),
        DarkVenueProfile("CROSSFINDER", 0.55, 0.9, 18.0, 15_000.0),
    ]
    res = sentry.evaluate_routing(
        target_shares=12_000.0,
        dark_venues=venues,
        recent_probes=[],
    )
    assert res.state == DarkPoolRegimeState.TRANQUIL_CLEAN_CROSS
    assert res.directive == DarkRoutingDirective.ALLOCATE_STEALTH_DARK
    assert res.total_allocated_dark == 12_000.0
    assert res.total_allocated_lit == 0.0
    assert res.dark_participation_ratio == 1.0
    assert len(res.blacklisted_venues) == 0


def test_sniffing_probe_detected_state(sentry):
    venues = [
        DarkVenueProfile("POOL_A", 0.70, 0.5, 10.0, 10_000.0),
        DarkVenueProfile("POOL_B", 0.60, 0.6, 12.0, 10_000.0),
    ]
    probes = [
        PingProbeObservation("POOL_A", 50.0, True, 8.0, 3.5),
    ]
    res = sentry.evaluate_routing(
        target_shares=5_000.0,
        dark_venues=venues,
        recent_probes=probes,
    )
    assert res.state == DarkPoolRegimeState.SNIFFING_PROBE_DETECTED
    assert res.directive == DarkRoutingDirective.DEPLOY_RANDOMIZED_DELAY_SLICE
    assert "POOL_A" in res.blacklisted_venues


def test_toxic_adverse_selection_blacklist(sentry):
    # Over 50% of venues toxic
    venues = [
        DarkVenueProfile("POOL_TOXIC_1", 0.80, 3.8, 10.0, 10_000.0),
        DarkVenueProfile("POOL_TOXIC_2", 0.75, 4.2, 12.0, 10_000.0),
        DarkVenueProfile("POOL_CLEAN", 0.50, 0.8, 15.0, 5_000.0),
    ]
    res = sentry.evaluate_routing(
        target_shares=10_000.0,
        dark_venues=venues,
        recent_probes=[],
    )
    assert res.state == DarkPoolRegimeState.TOXIC_ADVERSE_SELECTION
    assert res.directive == DarkRoutingDirective.BLACKLIST_TOXIC_VENUES
    assert "POOL_TOXIC_1" in res.blacklisted_venues
    assert "POOL_TOXIC_2" in res.blacklisted_venues


def test_zero_liquidity_desert_fallback(sentry):
    # Venues have fill rate < 0.15
    venues = [
        DarkVenueProfile("DRY_POOL_1", 0.05, 0.2, 30.0, 10_000.0),
        DarkVenueProfile("DRY_POOL_2", 0.08, 0.1, 25.0, 10_000.0),
    ]
    res = sentry.evaluate_routing(
        target_shares=5_000.0,
        dark_venues=venues,
        recent_probes=[],
    )
    assert res.state == DarkPoolRegimeState.ZERO_LIQUIDITY_DESERT
    assert res.directive == DarkRoutingDirective.ABORT_DARK_AND_FALLBACK_LIT
    assert res.total_allocated_dark == 0.0
    assert res.total_allocated_lit == 5_000.0


def test_share_conservation(sentry):
    venues = [
        DarkVenueProfile("CLEAN_POOL", 0.60, 0.5, 10.0, 3_000.0),
    ]
    target = 10_000.0
    res = sentry.evaluate_routing(
        target_shares=target,
        dark_venues=venues,
        recent_probes=[],
    )
    assert res.total_allocated_dark + res.total_allocated_lit == target
    assert res.total_allocated_dark == 3_000.0
    assert res.total_allocated_lit == 7_000.0
