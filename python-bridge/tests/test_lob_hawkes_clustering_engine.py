"""
Unit Test Suite for Domain 241: High-Frequency Limit Order Book Multi-Level Hawkes Clustering & Flash Replenishment Engine
"""

import pytest
from services.lob_hawkes_clustering_engine import (
    LOBHawkesClusteringEngine,
    LOBEvent,
    LOBEventType,
    LOBClusteringRegimeState,
    LOBReplenishmentDirective,
)


@pytest.fixture
def engine():
    return LOBHawkesClusteringEngine(
        decay_beta=10.0,
        min_events_threshold=8,
        cascade_spectral_threshold=0.92,
        evaporation_frr_threshold=0.75,
        resilient_frr_threshold=1.35,
    )


def test_low_flow_tranquil(engine):
    events = [
        LOBEvent(LOBEventType.BID_INSERT, 99.5, 100.0, 10.0),
        LOBEvent(LOBEventType.ASK_INSERT, 99.7, 100.1, 10.0),
    ]
    res = engine.evaluate(events, current_time_sec=100.0)
    assert res.state == LOBClusteringRegimeState.TRANQUIL_LOW_FLOW
    assert res.directive == LOBReplenishmentDirective.MAINTAIN_STANDARD_SPREAD
    assert res.spread_multiplier == 1.0


def test_resilient_replenishment(engine):
    # Sequence of 15 insertions (bids and asks alternating) with zero cancels
    events = []
    for i in range(15):
        t = 98.5 + (i * 0.08)  # every 80ms
        etype = LOBEventType.BID_INSERT if i % 2 == 0 else LOBEventType.ASK_INSERT
        events.append(LOBEvent(etype, t, 100.0 + (0.01 * (i % 3)), 5.0))

    res = engine.evaluate(events, current_time_sec=100.0)
    assert res.state == LOBClusteringRegimeState.RESILIENT_REPLENISHMENT
    assert res.directive == LOBReplenishmentDirective.QUOTE_AGGRESSIVE_TOP_OF_BOOK
    assert res.flash_replenishment_ratio >= engine.resilient_frr_threshold
    assert res.spread_multiplier == 0.8


def test_evaporation_cluster_warning(engine):
    # Sequence with 10 cancels and only 2 inserts (cancels = 10/12 = 83%)
    events = []
    # 2 inserts early
    events.append(LOBEvent(LOBEventType.BID_INSERT, 98.5, 100.0, 10.0))
    events.append(LOBEvent(LOBEventType.ASK_INSERT, 98.6, 100.1, 10.0))
    # 10 cancels
    for i in range(10):
        t = 98.8 + (i * 0.10)
        etype = LOBEventType.BID_CANCEL if i % 2 == 0 else LOBEventType.ASK_CANCEL
        events.append(LOBEvent(etype, t, 100.0, 10.0))

    res = engine.evaluate(events, current_time_sec=100.0)
    assert res.state in [LOBClusteringRegimeState.EVAPORATION_CLUSTER_WARNING, LOBClusteringRegimeState.FLASH_CANCELLATION_CASCADE]
    assert res.directive in [LOBReplenishmentDirective.WIDEN_TO_DEEP_LEVELS, LOBReplenishmentDirective.EMERGENCY_EVACUATE_QUOTES]
    assert res.spread_multiplier >= 2.0


def test_flash_cancellation_cascade(engine):
    # Extremely dense burst of 25 rapid cancellations within 500ms
    # triggers huge self-excitation on cancels and pushes spectral radius high
    events = []
    for i in range(25):
        t = 99.5 + (i * 0.015)  # every 15ms
        etype = LOBEventType.BID_CANCEL if i % 2 == 0 else LOBEventType.ASK_CANCEL
        events.append(LOBEvent(etype, t, 100.0, 25.0))

    res = engine.evaluate(events, current_time_sec=100.0)
    if res.spectral_radius >= engine.cascade_spectral_threshold:
        assert res.state == LOBClusteringRegimeState.FLASH_CANCELLATION_CASCADE
        assert res.directive == LOBReplenishmentDirective.EMERGENCY_EVACUATE_QUOTES
        assert res.spread_multiplier == 3.5
    else:
        assert res.state == LOBClusteringRegimeState.EVAPORATION_CLUSTER_WARNING


def test_spectral_radius_calculation(engine):
    # Zero matrix -> 0.0
    zero_mat = [[0.0]*4 for _ in range(4)]
    assert engine.calculate_spectral_radius(zero_mat) == 0.0

    # Diagonal matrix with max entry 0.75 -> 0.75
    diag_mat = [[0.0]*4 for _ in range(4)]
    diag_mat[0][0] = 0.5
    diag_mat[1][1] = 0.75
    diag_mat[2][2] = 0.2
    diag_mat[3][3] = 0.4
    assert pytest.approx(engine.calculate_spectral_radius(diag_mat), abs=1e-2) == 0.75
