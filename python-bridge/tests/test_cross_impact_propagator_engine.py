r"""
Unit Test Suite for Domain 190 (WP-CN): Multi-Asset Cross-Impact Propagator & Square-Root Law Optimal Liquidation Engine
"""

import math
import pytest
from services.cross_impact_propagator_engine import (
    AssetMicrostructureProfile,
    CrossImpactDirective,
    CrossImpactPropagatorEngine,
    LiquidationLeg,
)


def test_square_root_self_impact_scaling():
    """Verifies that self-impact scales strictly with sqrt(Q) and cost scales with Q^(3/2)."""
    engine = CrossImpactPropagatorEngine(db_path=":memory:", universal_y=0.60)

    profile = AssetMicrostructureProfile(
        symbol="NIFTY",
        current_price=25000.0,
        daily_volume=1000000.0,
        daily_volatility=0.015,  # 1.5% daily vol
    )

    duration = 900.0  # 15 minutes

    bps_1, cost_1 = engine.compute_square_root_self_impact(profile, quantity=10000.0, duration_sec=duration)
    bps_4, cost_4 = engine.compute_square_root_self_impact(profile, quantity=40000.0, duration_sec=duration)

    # sqrt(40000) / sqrt(10000) = 2.0 -> impact bps must double
    assert math.isclose(bps_4 / bps_1, 2.0, rel_tol=1e-2)

    # Dollar cost = Q * avg_slippage \propto Q * sqrt(Q) = Q^(3/2)
    # (40000 / 10000)^(1.5) = 4^(1.5) = 8.0
    assert math.isclose(cost_4 / cost_1, 8.0, rel_tol=1e-2)


def test_single_asset_liquidation():
    """Verifies single-asset liquidation emits single-leg equilibrium directive and zero cross impact."""
    engine = CrossImpactPropagatorEngine(db_path=":memory:")

    profile = AssetMicrostructureProfile(
        symbol="RELIANCE",
        current_price=3000.0,
        daily_volume=500000.0,
        daily_volatility=0.02,
    )
    profiles = {"RELIANCE": profile}

    legs = [LiquidationLeg(symbol="RELIANCE", quantity=-5000.0, target_duration_sec=600.0)]
    correlations = {}

    schedule = engine.optimize_multi_asset_liquidation(profiles, legs, correlations, target_tranches=5)

    assert schedule.directive == CrossImpactDirective.EQUILIBRIUM_SINGLE_LEG
    assert schedule.cross_interference_index == 0.0
    assert schedule.cross_impact_bps.get("RELIANCE", 0.0) == 0.0
    assert schedule.self_impact_bps["RELIANCE"] > 0.0
    assert len(schedule.tranche_schedule) == 5


def test_adverse_cross_impact_desynchronization():
    """Verifies that liquidating positively correlated assets in same direction triggers desynchronization."""
    engine = CrossImpactPropagatorEngine(
        db_path=":memory:",
        universal_y=0.60,
        adverse_interference_threshold=0.30,
    )

    prof_nifty = AssetMicrostructureProfile(
        symbol="NIFTY",
        current_price=25000.0,
        daily_volume=2000000.0,
        daily_volatility=0.015,
    )
    prof_bnifty = AssetMicrostructureProfile(
        symbol="BANKNIFTY",
        current_price=52000.0,
        daily_volume=1500000.0,
        daily_volatility=0.018,
    )

    profiles = {"NIFTY": prof_nifty, "BANKNIFTY": prof_bnifty}

    # Both legs are liquidations (SELL)
    legs = [
        LiquidationLeg(symbol="NIFTY", quantity=-50000.0, target_duration_sec=900.0),
        LiquidationLeg(symbol="BANKNIFTY", quantity=-30000.0, target_duration_sec=900.0),
    ]

    # Strong positive correlation: \rho = 0.85
    correlations = {("NIFTY", "BANKNIFTY"): 0.85, ("BANKNIFTY", "NIFTY"): 0.85}

    schedule = engine.optimize_multi_asset_liquidation(profiles, legs, correlations, target_tranches=5)

    assert schedule.cross_interference_index >= 0.30
    assert schedule.directive == CrossImpactDirective.DESYNCHRONIZE_TRANCHES_ADVERSE_CROSS_IMPACT
    assert schedule.recommended_tranches >= 8
    assert "DESYNCHRONIZE" in schedule.rationale

    # Check that desynchronized schedule alternates active legs
    tranche_1 = schedule.tranche_schedule[0]["tranche_allocations"]
    assert tranche_1["NIFTY"]["active"] != tranche_1["BANKNIFTY"]["active"]


def test_netting_cross_impact_concurrency():
    """Verifies that trading positively correlated assets in opposite directions triggers concurrency netting discount."""
    engine = CrossImpactPropagatorEngine(
        db_path=":memory:",
        universal_y=0.60,
        netting_interference_threshold=-0.15,
    )

    prof_nifty = AssetMicrostructureProfile(
        symbol="NIFTY",
        current_price=25000.0,
        daily_volume=2000000.0,
        daily_volatility=0.015,
    )
    prof_bnifty = AssetMicrostructureProfile(
        symbol="BANKNIFTY",
        current_price=52000.0,
        daily_volume=1500000.0,
        daily_volatility=0.018,
    )

    profiles = {"NIFTY": prof_nifty, "BANKNIFTY": prof_bnifty}

    # Opposing directions: BUY NIFTY, SELL BANKNIFTY
    legs = [
        LiquidationLeg(symbol="NIFTY", quantity=+40000.0, target_duration_sec=900.0),
        LiquidationLeg(symbol="BANKNIFTY", quantity=-30000.0, target_duration_sec=900.0),
    ]

    # Strong positive correlation: \rho = 0.85
    correlations = {("NIFTY", "BANKNIFTY"): 0.85, ("BANKNIFTY", "NIFTY"): 0.85}

    schedule = engine.optimize_multi_asset_liquidation(profiles, legs, correlations, target_tranches=5)

    # Negative interference index (netting savings)
    assert schedule.cross_interference_index <= -0.15
    assert schedule.directive == CrossImpactDirective.CONCURRENT_NETTED_LIQUIDATION
    assert "Execute CONCURRENTLY" in schedule.rationale


def test_propagator_matrix_symmetry_and_bounds():
    """Verifies that the cross-impact propagator matrix is symmetric and bounded."""
    engine = CrossImpactPropagatorEngine(db_path=":memory:", universal_y=0.60)

    symbols = ["INFY", "TCS", "WIPRO"]
    correlations = {
        ("INFY", "TCS"): 0.75,
        ("INFY", "WIPRO"): 0.60,
        ("TCS", "WIPRO"): 0.70,
    }

    propagator = engine.build_cross_impact_matrix(symbols, correlations)

    # Check diagonals
    assert propagator[("INFY", "INFY")] == 0.60
    assert propagator[("TCS", "TCS")] == 0.60
    assert propagator[("WIPRO", "WIPRO")] == 0.60

    # Check symmetry: \Lambda_{ij} = \Lambda_{ji}
    assert math.isclose(propagator[("INFY", "TCS")], propagator[("TCS", "INFY")], rel_tol=1e-5)
    assert math.isclose(propagator[("INFY", "TCS")], 0.60 * 0.75, rel_tol=1e-5)


def test_sqlite_telemetry_persistence():
    """Verifies database insertion and query retrieval of multi-asset execution schedules."""
    engine = CrossImpactPropagatorEngine(db_path=":memory:")

    prof = AssetMicrostructureProfile(
        symbol="HDFCBANK",
        current_price=1600.0,
        daily_volume=1000000.0,
        daily_volatility=0.015,
    )
    profiles = {"HDFCBANK": prof}
    legs = [LiquidationLeg(symbol="HDFCBANK", quantity=-2000.0, target_duration_sec=300.0)]

    engine.optimize_multi_asset_liquidation(profiles, legs, {})

    records = engine.get_recent_schedules(limit=5)
    assert len(records) == 1
    assert records[0]["symbols"] == "HDFCBANK"
    assert records[0]["n_legs"] == 1
    assert records[0]["directive"] == CrossImpactDirective.EQUILIBRIUM_SINGLE_LEG.value
