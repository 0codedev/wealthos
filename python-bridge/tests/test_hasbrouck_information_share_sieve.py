"""
Unit Tests for Multi-Asset Cross-Exchange Order Flow Toxicity Information Share & Hasbrouck Factor Sieve
Domain 229 / Work Package WP-EA
"""

import pytest
import math
import random
from services.hasbrouck_information_share_sieve import (
    HasbrouckInformationShareSieve,
    VenueDominanceState,
)


def generate_cointegrated_venues(
    n_ticks: int = 150,
    leader_weight: float = 0.85,
    seed: int = 42,
):
    random.seed(seed)
    p0 = 100.0

    prices_a = [p0]
    prices_b = [p0]

    # Latent fundamental walk
    m = p0
    for _ in range(n_ticks - 1):
        # Fundamental innovation
        eta = random.gauss(0.0, 0.20)
        m += eta

        # If A is the leader: A reflects fundamental innovation immediately, B adjusts with lag
        if leader_weight > 0.7:
            p_a = m + random.gauss(0.0, 0.02)
            # B adjusts to previous spread (error correction)
            spread = prices_b[-1] - prices_a[-1]
            p_b = prices_b[-1] - 0.40 * spread + random.gauss(0.0, 0.05)
        elif leader_weight < 0.3:
            p_b = m + random.gauss(0.0, 0.02)
            spread = prices_a[-1] - prices_b[-1]
            p_a = prices_a[-1] - 0.40 * spread + random.gauss(0.0, 0.05)
        else:
            # Symmetric
            p_a = m + random.gauss(0.0, 0.05)
            p_b = m + random.gauss(0.0, 0.05)

        prices_a.append(max(1.0, p_a))
        prices_b.append(max(1.0, p_b))

    return prices_a, prices_b


def test_bivariate_bounds_consistency():
    sieve = HasbrouckInformationShareSieve()
    pa, pb = generate_cointegrated_venues(n_ticks=100, leader_weight=0.5)

    (is_a_l, is_a_u, is_a_m), (is_b_l, is_b_u, is_b_m), cs_a, cs_b = sieve.compute_bivariate_shares(pa, pb)

    # Lower bound <= midpoint <= upper bound
    assert is_a_l <= is_a_m <= is_a_u
    assert is_b_l <= is_b_m <= is_b_u

    # Gonzalo-Granger partition
    assert pytest.approx(cs_a + cs_b, 1e-4) == 1.0


def test_asymmetric_leader_discovery():
    sieve = HasbrouckInformationShareSieve()
    # A is strong leader
    pa, pb = generate_cointegrated_venues(n_ticks=200, leader_weight=0.90)

    (is_a_l, is_a_u, is_a_m), (is_b_l, is_b_u, is_b_m), cs_a, cs_b = sieve.compute_bivariate_shares(pa, pb)

    # Leader A should have significantly higher information share and component share
    assert is_a_m > is_b_m
    assert cs_a > 0.60
    assert cs_b < 0.40


def test_multi_venue_dominance_report():
    sieve = HasbrouckInformationShareSieve()
    pa, pb = generate_cointegrated_venues(n_ticks=150, leader_weight=0.85, seed=10)
    # Venue C is also a follower of A
    pc = [p * (1.0 + random.gauss(0.0, 0.001)) for p in pb]

    venue_data = {
        "binance": pa,
        "bybit": pb,
        "okx": pc,
    }

    report = sieve.evaluate_multi_venue_dominance(venue_data)

    assert report.primary_leader_venue == "binance"
    assert report.venue_metrics["binance"].is_price_leader is True
    assert report.regime in [VenueDominanceState.LEADER_DOMINANT, VenueDominanceState.FRAGMENTED_EQUAL]
    assert "binance" in report.recommended_routing
