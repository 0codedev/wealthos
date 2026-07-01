"""
Unit Tests for Multi-Factor Lead-Lag Cross-Correlation & Information Spillover Sieve (Domain 181 / WP-CE)
"""

import math
import pytest

from services.hayashi_yoshida_lead_lag_sieve import (
    HayashiYoshidaLeadLagSieve,
    TickPrint,
    LeadLagDirective,
)


@pytest.fixture
def sieve():
    return HayashiYoshidaLeadLagSieve(
        db_path=":memory:",
        lag_search_range_sec=1.5,
        lag_step_sec=0.10,
        min_correlation_hurdle=0.40,
        min_lead_sec_threshold=0.15,
    )


def test_hayashi_yoshida_identical_synchronous_series(sieve):
    ticks_x = [
        TickPrint(0.0, 100.0),
        TickPrint(1.0, 101.0),
        TickPrint(2.0, 100.5),
        TickPrint(3.0, 102.0),
        TickPrint(4.0, 103.0),
    ]
    ticks_y = [
        TickPrint(0.0, 50.0),
        TickPrint(1.0, 50.5),
        TickPrint(2.0, 50.25),
        TickPrint(3.0, 51.0),
        TickPrint(4.0, 51.5),
    ]

    corr = sieve.compute_hayashi_yoshida_corr(ticks_x, ticks_y, tau_lag_sec=0.0)
    assert abs(corr - 1.0) < 1e-3


def test_known_lead_lag_synthetic_diffusion(sieve):
    # Asset X updates at t = 0.0, 1.0, 2.0, 3.0, 4.0, 5.0
    # Asset Y updates with exact same price innovations with a 0.50 second delay (t = 0.5, 1.5, ...)
    moves = [0.0, 1.0, -0.5, 1.5, -0.8, 2.0]
    p_x = 100.0
    p_y = 50.0

    ticks_x = []
    ticks_y = []

    for i, m in enumerate(moves):
        p_x += m
        p_y += m * 0.5
        t_x = float(i)
        t_y = float(i) + 0.50
        ticks_x.append(TickPrint(t_x, p_x))
        ticks_y.append(TickPrint(t_y, p_y))

    rep = sieve.analyze_lead_lag("RELIANCE_FUT", ticks_x, "RELIANCE_CASH", ticks_y)

    assert rep.leader_symbol == "RELIANCE_FUT"
    assert rep.follower_symbol == "RELIANCE_CASH"
    assert abs(rep.optimal_lag_sec - 0.50) <= 0.15
    assert rep.peak_correlation > 0.70
    assert rep.directive == LeadLagDirective.LEAD_LAG_ARBITRAGE_FOLLOW_LEADER
    assert "leads" in rep.rationale


def test_synchronous_co_movement(sieve):
    # Both assets jump simultaneously with alternating returns
    moves = [0.0, 1.2, -0.9, 1.5, -1.1, 0.8, -0.7, 1.3]
    p_x = 100.0
    p_y = 200.0
    ticks_x = []
    ticks_y = []
    for i, m in enumerate(moves):
        p_x += m
        p_y += m * 1.5
        t = float(i)
        ticks_x.append(TickPrint(t, p_x))
        ticks_y.append(TickPrint(t, p_y))

    rep = sieve.analyze_lead_lag("NIFTY", ticks_x, "BANKNIFTY", ticks_y)

    assert abs(rep.optimal_lag_sec) < 0.15
    assert rep.peak_correlation > 0.90
    assert rep.directive == LeadLagDirective.SYNCHRONOUS_CO_MOVEMENT_PAIR


def test_decoupled_independent_random_walks(sieve):
    # Completely decoupled patterns
    ticks_x = [TickPrint(float(i), 100.0 + (1.0 if i % 2 == 0 else -1.0)) for i in range(10)]
    ticks_y = [TickPrint(float(i), 50.0 + (1.0 if (i // 2) % 2 == 0 else -1.0)) for i in range(10)]

    rep = sieve.analyze_lead_lag("ASSET_A", ticks_x, "ASSET_B", ticks_y)

    assert rep.directive == LeadLagDirective.DECOUPLED_INDEPENDENT_FLOW


def test_inverted_negative_spillover(sieve):
    # Perfectly inverted movements
    ticks_x = [TickPrint(float(i), 100.0 + i * 1.5) for i in range(8)]
    ticks_y = [TickPrint(float(i), 200.0 - i * 1.5) for i in range(8)]

    rep = sieve.analyze_lead_lag("GOLD", ticks_x, "USDINR", ticks_y)

    assert rep.peak_correlation < -0.80
    assert rep.directive == LeadLagDirective.INVERTED_NEGATIVE_SPILLOVER


def test_sqlite_persistence(sieve):
    ticks_x = [TickPrint(0.0, 100.0), TickPrint(1.0, 102.0), TickPrint(2.0, 104.0)]
    ticks_y = [TickPrint(0.0, 50.0), TickPrint(1.0, 51.0), TickPrint(2.0, 52.0)]

    sieve.analyze_lead_lag("SYM_X", ticks_x, "SYM_Y", ticks_y)

    telemetry = sieve.get_latest_telemetry(limit=5)
    assert len(telemetry) == 1
    assert telemetry[0][0] == "SYM_X"
    assert telemetry[0][1] == "SYM_Y"
