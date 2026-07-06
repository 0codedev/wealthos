"""
Unit Test Suite for Domain 250: Multi-Asset Intraday Structural Breakpoint CUSUM & Regime Shift Barrier
"""

import pytest
from services.structural_breakpoint_cusum_barrier import (
    StructuralBreakpointCUSUMBarrier,
    CUSUMDetectorConfig,
    AssetResidualInput,
    StructuralRegimeState,
    BarrierRiskDirective,
)


@pytest.fixture
def detector():
    config = CUSUMDetectorConfig(
        target_mean=0.0,
        baseline_std=1.0,
        slack_k=0.5,
        threshold_h=4.5,
        deleveraging_ratio=0.35,
    )
    return StructuralBreakpointCUSUMBarrier(config=config)


def test_stable_gaussian_flow(detector):
    # Small noise residual around 0
    inp = AssetResidualInput(
        asset_id="BTC-USDT",
        current_residual=0.2,
        prev_s_pos=0.1,
        prev_s_neg=0.0,
    )
    res = detector.evaluate_asset(inp)
    assert res.regime == StructuralRegimeState.STABLE_GAUSSIAN_FLOW
    assert res.directive == BarrierRiskDirective.NORMAL_OPERATIONS
    assert res.deleveraging_factor == 1.0
    assert res.shift_direction == "NONE"


def test_transitional_turbulence_warning(detector):
    # Moderate accumulation reaching half of threshold h (4.5 / 2 = 2.25)
    inp = AssetResidualInput(
        asset_id="ETH-USDT",
        current_residual=1.5,
        prev_s_pos=2.0,
        prev_s_neg=0.0,
    )
    # S^+ = 2.0 + 1.5 - 0.5 = 3.0 (>= 2.25, < 4.5)
    res = detector.evaluate_asset(inp)
    assert res.regime == StructuralRegimeState.TRANSITIONAL_TURBULENCE
    assert res.directive == BarrierRiskDirective.TIGHTEN_MONITORING_WINDOW
    assert res.deleveraging_factor == 0.70
    assert res.shift_direction == "UPWARD_DRIFT"


def test_structural_fracture_critical_upward(detector):
    # Massive positive shock pushing S^+ over threshold h=4.5
    inp = AssetResidualInput(
        asset_id="SOL-USDT",
        current_residual=3.5,
        prev_s_pos=3.0,
        prev_s_neg=0.0,
    )
    # S^+ = 3.0 + 3.5 - 0.5 = 6.0 >= 4.5
    res = detector.evaluate_asset(inp)
    assert res.regime == StructuralRegimeState.STRUCTURAL_FRACTURE_CRITICAL
    assert res.directive == BarrierRiskDirective.TRIGGER_CIRCUIT_DELEVERAGE
    assert res.deleveraging_factor == 0.35
    assert res.shift_direction == "UPWARD_SURGE"


def test_structural_fracture_critical_downward_collapse(detector):
    # Severe negative crash shock
    inp = AssetResidualInput(
        asset_id="NVDA",
        current_residual=-4.0,
        prev_s_pos=0.0,
        prev_s_neg=2.5,
    )
    # S^- = 2.5 - (-4.0) - 0.5 = 2.5 + 4.0 - 0.5 = 6.0 >= 4.5
    res = detector.evaluate_asset(inp)
    assert res.regime == StructuralRegimeState.STRUCTURAL_FRACTURE_CRITICAL
    assert res.directive == BarrierRiskDirective.TRIGGER_CIRCUIT_DELEVERAGE
    assert res.deleveraging_factor == 0.35
    assert res.shift_direction == "DOWNWARD_COLLAPSE"


def test_systemic_batch_evaluation(detector):
    basket = [
        AssetResidualInput("BTC", current_residual=0.1, prev_s_pos=0.0, prev_s_neg=0.0),
        AssetResidualInput("ETH", current_residual=-3.5, prev_s_pos=0.0, prev_s_neg=3.0),  # Fractures
        AssetResidualInput("SOL", current_residual=1.0, prev_s_pos=1.0, prev_s_neg=0.0),   # Warning/Stable
        AssetResidualInput("BNB", current_residual=-4.0, prev_s_pos=0.0, prev_s_neg=2.5),  # Fractures
    ]
    results, systemic_ratio = detector.evaluate_batch(basket)
    assert len(results) == 4
    # 2 out of 4 fractured -> 50% systemic fracture ratio
    assert systemic_ratio == 0.50
