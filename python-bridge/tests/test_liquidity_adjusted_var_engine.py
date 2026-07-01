"""
Unit Tests for Liquidity-Adjusted Value at Risk (LVaR) & Optimal Liquidation Horizon Sieve (Domain 144 / WP-AT)
"""

import math
import pytest

from services.liquidity_adjusted_var_engine import (
    LiquidityAdjustedVaREngine,
    PositionRiskParameters,
    LVaRReport,
)


@pytest.fixture
def engine():
    return LiquidityAdjustedVaREngine(db_path=":memory:")


def test_liquid_large_cap_lvar(engine):
    # Reliance: 10,000 shares @ 3000 INR (3 Cr INR), ADV 5M shares
    pos = PositionRiskParameters(
        symbol="RELIANCE",
        quantity=10000.0,
        price=3000.0,
        daily_volatility=0.015,
        adv_shares=5000000.0,
        mean_spread_bps=3.0,
        spread_vol_bps=1.5,
        confidence_level=0.99,
    )
    rep = engine.compute_lvar(pos)

    assert rep.position_value_inr == 30000000.0
    assert rep.classical_var_1d_inr > 0.0
    assert rep.optimal_horizon_days < 0.10  # Less than an hour
    assert rep.optimal_horizon_hours < 1.0
    assert rep.liquidity_multiplier < 1.30
    assert rep.risk_regime == "LIQUID_OPTIMAL_EXECUTION"
    assert rep.recommended_action == "STANDARD_VWAP_OR_TWAP"
    assert rep.required_margin_buffer_pct == 15.0


def test_illiquid_position_impact_escalation(engine):
    # Illiquid position: 500,000 shares @ 500 INR (25 Cr), ADV only 200,000 shares (250% of ADV!)
    pos = PositionRiskParameters(
        symbol="ILLIQUID_CORP",
        quantity=500000.0,
        price=500.0,
        daily_volatility=0.035,
        adv_shares=200000.0,
        mean_spread_bps=45.0,
        spread_vol_bps=25.0,
        confidence_level=0.99,
    )
    rep = engine.compute_lvar(pos)

    assert rep.optimal_horizon_days > 0.20  # Multiple hours or days
    assert rep.endogenous_impact_cost_inr > 1000000.0  # Significant impact
    assert rep.risk_regime in ("MODERATE_IMPACT_THROTTLE", "ACUTE_LIQUIDITY_STRESS", "PROHIBITIVE_LIQUIDATION_HAZARD")
    assert rep.required_margin_buffer_pct >= 30.0


def test_spread_shock_exogenous_cost(engine):
    pos_tight = PositionRiskParameters(
        symbol="TIGHT_SPREAD",
        quantity=10000.0,
        price=1000.0,
        daily_volatility=0.02,
        adv_shares=1000000.0,
        mean_spread_bps=2.0,
        spread_vol_bps=1.0,
    )
    pos_blown = PositionRiskParameters(
        symbol="BLOWN_SPREAD",
        quantity=10000.0,
        price=1000.0,
        daily_volatility=0.02,
        adv_shares=1000000.0,
        mean_spread_bps=50.0,
        spread_vol_bps=25.0,
    )

    rep_tight = engine.compute_lvar(pos_tight)
    rep_blown = engine.compute_lvar(pos_blown)

    assert rep_blown.exogenous_spread_risk_inr > 10.0 * rep_tight.exogenous_spread_risk_inr
    assert rep_blown.lvar_optimal_inr > rep_tight.lvar_optimal_inr


def test_optimal_horizon_monotonicity(engine):
    """
    Mathematical Invariant: Optimal liquidation horizon T* scales as sqrt(Q).
    A 4x increase in position size must double T*.
    """
    base_pos = PositionRiskParameters(
        symbol="MONOTONIC_TEST",
        quantity=10000.0,
        price=1000.0,
        daily_volatility=0.02,
        adv_shares=500000.0,
    )
    quad_pos = PositionRiskParameters(
        symbol="MONOTONIC_TEST",
        quantity=40000.0,
        price=1000.0,
        daily_volatility=0.02,
        adv_shares=500000.0,
    )

    rep_base = engine.compute_lvar(base_pos)
    rep_quad = engine.compute_lvar(quad_pos)

    # Ratio T*_quad / T*_base should be approximately 2.0 (sqrt(4) = 2)
    ratio = rep_quad.optimal_horizon_days / rep_base.optimal_horizon_days
    assert math.isclose(ratio, 2.0, rel_tol=0.05)


def test_sqlite_persistence(engine):
    pos = PositionRiskParameters(
        symbol="PERSIST_TEST",
        quantity=5000.0,
        price=2000.0,
        daily_volatility=0.018,
        adv_shares=1000000.0,
    )
    engine.compute_lvar(pos)

    conn = engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, position_value, optimal_horizon_days, risk_regime FROM lvar_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_TEST"
    assert row[1] == 10000000.0
    assert row[2] > 0.0
    assert isinstance(row[3], str)
