"""
python-bridge/__tests__/test_dynamic_weights.py — Unit Tests for Dynamic Weight Calibrator
"""

import sys
import os
import json
import pytest
import numpy as np

# Add python-bridge directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.dynamic_weight_calibrator import (
    DynamicWeightCalibrator,
    ALPHA_FACTORS,
    REGIMES,
    dynamic_weight_calibrator,
)


def test_weights_sum_to_one_and_floor_invariant():
    """Verify that blended weights always sum to exactly 1.0 and respect the 0.05 floor."""
    calibrator = DynamicWeightCalibrator()

    # Sweep across various market conditions
    test_cases = [
        {"vix": 11.5, "slope": 0.004, "breadth": 85.0},  # Extreme Bull
        {"vix": 26.0, "slope": -0.006, "breadth": 15.0}, # Panic Bear
        {"vix": 14.0, "slope": 0.000, "breadth": 50.0},  # Flat Range
        {"vix": 21.0, "slope": 0.000, "breadth": 45.0},  # Violent Chop
        {"vix": 50.0, "slope": -0.020, "breadth": 0.0},  # Black swan crash
    ]

    for tc in test_cases:
        res = calibrator.calibrate_weights(
            vix=tc["vix"],
            trend_slope=tc["slope"],
            sector_breadth=tc["breadth"],
            sync_persistence=False,
        )
        weights = res["weights"]
        total_w = sum(weights.values())

        # Exact summation invariant
        assert abs(total_w - 1.0) < 1e-4, f"Sum of weights was {total_w} for {tc}"

        # Floor weight invariant
        for factor in ALPHA_FACTORS:
            assert weights[factor] >= 0.05, f"Weight for {factor} was {weights[factor]} < 0.05"


def test_bull_expansion_weight_profile():
    """Verify that bull trend prioritizes CleanTrend and RVOL with full gain."""
    calibrator = DynamicWeightCalibrator()
    res = calibrator.calibrate_weights(vix=13.0, trend_slope=0.0035, sector_breadth=78.0, sync_persistence=False)

    assert res["dominant_regime"] == "BULL_EXPANSION"
    assert res["gain_kappa"] >= 0.95
    weights = res["weights"]

    # In bull expansion, CleanTrend and RVOL lead
    assert weights["cleantrend"] >= weights["r_factor"]
    assert weights["rvol"] >= weights["r_factor"]


def test_chop_high_vol_defensive_dampening():
    """Verify that violent chop applies kappa=0.50 dampening and prioritizes MMS."""
    calibrator = DynamicWeightCalibrator()
    res = calibrator.calibrate_weights(vix=21.0, trend_slope=0.0001, sector_breadth=48.0, sync_persistence=False)

    assert res["dominant_regime"] == "CHOP_HIGH_VOL"
    # Gain kappa should be significantly dampened
    assert res["gain_kappa"] < 0.70

    # Composite score evaluation
    sub_scores = {"cleantrend": 80.0, "rvol": 75.0, "mms": 70.0, "r_factor": 65.0}
    comp = calibrator.compute_composite_score(sub_scores, market_context={"india_vix": 21.0, "trend_slope": 0.0001, "sector_breadth": 48.0})

    # Effective score should be dampened below raw score
    assert comp["effective_score"] < comp["raw_score"]
    assert comp["decision"] in ("WAIT", "ABORT")


def test_smooth_bayesian_transition():
    """Verify no discontinuous jumps in weights during smooth regime shifts."""
    calibrator = DynamicWeightCalibrator(smoothing_alpha=0.15)

    # Transition from Bull (13.0 VIX) to Chop (21.0 VIX) in 15 steps
    vix_steps = np.linspace(13.0, 21.0, 15)
    prev_weights = None

    for vix in vix_steps:
        res = calibrator.calibrate_weights(vix=vix, trend_slope=0.001, sector_breadth=55.0, sync_persistence=False)
        curr_weights = res["weights"]

        if prev_weights is not None:
            for factor in ALPHA_FACTORS:
                step_delta = abs(curr_weights[factor] - prev_weights[factor])
                # No discrete jump greater than 0.12 in a single incremental step
                assert step_delta < 0.12, f"Jump of {step_delta} detected on {factor}"

        prev_weights = curr_weights


def test_hyperparameters_persistence(tmp_path):
    """Verify calibration saves and reads from JSON hyperparameters correctly."""
    cfg_file = tmp_path / "test_hyperparameters.json"
    initial_data = {"version": "2.0.0", "r_factor": {"lookback_days": 20}}
    with open(cfg_file, "w") as f:
        json.dump(initial_data, f)

    calibrator = DynamicWeightCalibrator(config_path=str(cfg_file))
    res = calibrator.calibrate_weights(vix=13.0, trend_slope=0.003, sector_breadth=75.0, sync_persistence=True)

    with open(cfg_file, "r") as f:
        saved_data = json.load(f)

    assert "dynamic_regime_weights" in saved_data
    assert saved_data["dynamic_regime_weights"]["dominant_regime"] == "BULL_EXPANSION"
    assert "weights" in saved_data["dynamic_regime_weights"]
    # Existing keys preserved
    assert saved_data["r_factor"]["lookback_days"] == 20
