"""
Unit Tests for Adaptive Almgren-Chriss Optimal Liquidation & Inventory Risk Engine (Domain 129 / WP-AE)
"""

from datetime import datetime
import pytest

from services.almgren_chriss_liquidation_engine import (
    AlmgrenChrissLiquidationEngine,
    LiquidationStep,
    OptimalLiquidationPlan,
)


@pytest.fixture
def ac_engine():
    return AlmgrenChrissLiquidationEngine(
        default_permanent_gamma=2.5e-7,
        default_temporary_eta=1.0e-5,
        default_annual_volatility=0.22,
        db_path=":memory:",
    )


def test_discrete_kappa_calculation(ac_engine):
    sigma = 0.05
    tau = 30.0
    eta = 1.0e-5

    # Risk neutral (\lambda = 0) -> \kappa = 0
    k_zero = ac_engine.calculate_discrete_kappa(0.0, sigma, tau, eta)
    assert k_zero == 0.0

    # Low risk aversion vs High risk aversion
    k_low = ac_engine.calculate_discrete_kappa(1e-5, sigma, tau, eta)
    k_high = ac_engine.calculate_discrete_kappa(1e-3, sigma, tau, eta)

    assert k_low > 0.0
    assert k_high > k_low


def test_inventory_conservation_and_endpoint(ac_engine):
    plan = ac_engine.generate_optimal_plan(
        symbol="RELIANCE",
        initial_shares=5000,
        horizon_sec=300.0,
        num_steps=10,
        risk_aversion_lambda=1e-4,
    )

    # Final step inventory must be zero
    assert plan.steps[-1].target_inventory_remaining == 0
    # Sum of all slice shares sold must equal initial shares
    total_sold = sum(s.slice_shares_to_sell for s in plan.steps)
    assert total_sold == 5000


def test_risk_neutral_twap_convergence(ac_engine):
    # Lambda = 0 -> exact linear TWAP
    plan = ac_engine.generate_optimal_plan(
        symbol="TCS",
        initial_shares=1000,
        horizon_sec=100.0,
        num_steps=10,
        risk_aversion_lambda=0.0,
    )

    # Every slice must sell exactly 100 shares
    for step in plan.steps:
        assert step.slice_shares_to_sell == 100
    assert plan.urgency_kappa == 0.0


def test_risk_averse_front_loading(ac_engine):
    # Significant risk aversion lambda = 5e-4
    plan = ac_engine.generate_optimal_plan(
        symbol="INFY",
        initial_shares=5000,
        horizon_sec=300.0,
        num_steps=10,
        risk_aversion_lambda=5e-4,
    )

    # Step 1 should sell more shares than Step 9
    first_slice = plan.steps[0].slice_shares_to_sell
    late_slice = plan.steps[8].slice_shares_to_sell

    assert first_slice > late_slice
    assert plan.urgency_kappa > 0.005


def test_cost_and_variance_tradeoff(ac_engine):
    # Compare low risk aversion (patient) vs high risk aversion (urgent)
    plan_patient = ac_engine.generate_optimal_plan(
        symbol="SBIN",
        initial_shares=10000,
        horizon_sec=600.0,
        num_steps=10,
        risk_aversion_lambda=1e-6,
    )
    plan_urgent = ac_engine.generate_optimal_plan(
        symbol="SBIN",
        initial_shares=10000,
        horizon_sec=600.0,
        num_steps=10,
        risk_aversion_lambda=1e-3,
    )

    # Urgent liquidation pays higher temporary impact cost (sells faster)
    assert plan_urgent.expected_total_cost_inr > plan_patient.expected_total_cost_inr
    # But urgent liquidation has substantially lower variance of cost (less market price risk)
    assert plan_urgent.variance_of_cost_inr2 < plan_patient.variance_of_cost_inr2


def test_half_life_calculation(ac_engine):
    plan_slow = ac_engine.generate_optimal_plan("HDFC", 2000, 300.0, 10, 1e-5)
    plan_fast = ac_engine.generate_optimal_plan("HDFC", 2000, 300.0, 10, 1e-3)

    assert plan_fast.half_life_sec < plan_slow.half_life_sec


def test_sqlite_persistence(ac_engine):
    plan = ac_engine.generate_optimal_plan("TATAMOTORS", 1500, 120.0, 6, 1e-4)

    conn = ac_engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, initial_shares, urgency_kappa FROM liquidation_plans_telemetry WHERE symbol = 'TATAMOTORS'")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "TATAMOTORS"
    assert row[1] == 1500
    assert row[2] > 0.0
