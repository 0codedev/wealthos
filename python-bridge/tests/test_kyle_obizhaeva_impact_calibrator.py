"""
Unit Tests for Multi-Asset Kyle-Obizhaeva Invariance & Market Impact Calibrator (Domain 140 / WP-AP)
"""

from datetime import datetime
import pytest

from services.kyle_obizhaeva_impact_calibrator import (
    KyleObizhaevaImpactCalibrator,
    AssetMicrostructureData,
    OrderExecutionSpec,
    MarketImpactCalibrationReport,
)


@pytest.fixture
def calibrator():
    return KyleObizhaevaImpactCalibrator(
        universal_y_constant=0.60,
        invariant_scale_c0=100.0,
        twap_impact_threshold_bps=10.0,
        block_deal_impact_threshold_bps=35.0,
        db_path=":memory:",
    )


@pytest.fixture
def reliance_asset():
    # RELIANCE: Price 3000 INR, 5,000,000 shares ADV, 1.5% daily volatility
    return AssetMicrostructureData(
        symbol="RELIANCE",
        price=3000.0,
        daily_volume_shares=5000000.0,
        daily_volatility=0.015,
    )


def test_small_order_aggressive_twap(calibrator, reliance_asset):
    # Small 5,000 share order (0.1% ADV)
    order = OrderExecutionSpec(symbol="RELIANCE", order_size_shares=5000.0, side="BUY")
    rep = calibrator.calibrate_order_impact(reliance_asset, order)

    assert rep.volume_fraction_pct == 0.1
    assert rep.expected_impact_bps < 10.0
    assert rep.recommended_execution_style == "AGGRESSIVE_TWAP"
    assert "Execute aggressive TWAP" in rep.rationale


def test_moderate_order_passive_pov(calibrator, reliance_asset):
    # Moderate 100,000 share order (2.0% ADV)
    order = OrderExecutionSpec(symbol="RELIANCE", order_size_shares=100000.0, side="BUY", max_acceptable_impact_bps=20.0)
    rep = calibrator.calibrate_order_impact(reliance_asset, order)

    assert rep.volume_fraction_pct == 2.0
    assert 10.0 <= rep.expected_impact_bps <= 20.0
    assert rep.recommended_execution_style == "PASSIVE_POV_ALGO"
    assert 0.04 <= rep.optimal_pov_rate <= 0.25


def test_large_order_block_crossing_required(calibrator, reliance_asset):
    # Massive 1,000,000 share order (20.0% ADV)
    order = OrderExecutionSpec(symbol="RELIANCE", order_size_shares=1000000.0, side="BUY")
    rep = calibrator.calibrate_order_impact(reliance_asset, order)

    assert rep.volume_fraction_pct == 20.0
    assert rep.expected_impact_bps >= 35.0
    assert rep.recommended_execution_style == "BLOCK_CROSSING_REQUIRED"
    assert "Route to institutional block deal" in rep.rationale
    assert rep.total_impact_cost_inr > 500000.0


def test_invariant_bet_size_and_information_rate(calibrator, reliance_asset):
    order = OrderExecutionSpec(symbol="RELIANCE", order_size_shares=20000.0, side="BUY")
    rep = calibrator.calibrate_order_impact(reliance_asset, order)

    assert rep.information_arrival_rate_cr > 10.0  # > 10 Crores/day
    assert rep.invariant_bet_shares > 10.0


def test_sqlite_persistence(calibrator, reliance_asset):
    order = OrderExecutionSpec(symbol="RELIANCE", order_size_shares=10000.0, side="SELL")
    calibrator.calibrate_order_impact(reliance_asset, order)

    conn = calibrator._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, execution_style, impact_bps FROM kyle_obizhaeva_impact_telemetry WHERE symbol = 'RELIANCE'")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "RELIANCE"
    assert row[1] == "AGGRESSIVE_TWAP"
