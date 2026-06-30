"""
Unit tests for Domain 173 (WP-BW): Diurnal Intraday Volume Curve & U-Shape Execution Predictor
"""

import pytest
from services.diurnal_volume_curve_predictor import (
    DiurnalVolumeCurvePredictor,
    DiurnalBucket,
    DiurnalPredictorReport,
)


def test_generate_canonical_u_shape():
    predictor = DiurnalVolumeCurvePredictor(session_minutes=375, bucket_size_min=5)
    assert len(predictor.curve) == 75
    # Exact weight conservation: sum of bucket weights == 1.0
    total_weight = sum(b.diurnal_weight for b in predictor.curve)
    assert abs(total_weight - 1.0) < 1e-4

    # Verify U-shape: Open (bucket 0) and Close (bucket 74) are higher than Lunch (bucket 37)
    w_open = predictor.curve[0].diurnal_weight
    w_midday = predictor.curve[37].diurnal_weight
    w_close = predictor.curve[74].diurnal_weight

    assert w_open > w_midday
    assert w_close > w_midday


def test_cumulative_fraction_monotonicity():
    predictor = DiurnalVolumeCurvePredictor()
    cum_prev = 0.0
    for b in predictor.curve:
        assert b.cumulative_weight >= cum_prev
        cum_prev = b.cumulative_weight
    assert abs(predictor.curve[-1].cumulative_weight - 1.0) < 1e-4

    # At minute 60, expected fraction should be roughly 15-25%
    f_60 = predictor.get_expected_fraction_at_minute(60)
    assert 0.10 < f_60 < 0.35


def test_predict_volume_pace_surge():
    predictor = DiurnalVolumeCurvePredictor(default_adv=1000000.0)
    # At minute 60, expected cumulative volume is ~200,000 shares
    expected_frac = predictor.get_expected_fraction_at_minute(60)
    expected_vol = 1000000.0 * expected_frac

    # Actual realized volume is 1.5x expected -> Surge!
    rep = predictor.predict_volume_and_govern_pov(
        symbol="RELIANCE",
        minute_offset=60,
        realized_volume_today=expected_vol * 1.5,
        baseline_adv=1000000.0,
        base_pov=0.15,
        max_pov=0.30,
    )
    assert rep.volume_pace_ratio >= 1.35
    assert rep.regime == "HIGH_VOLUME_SURGE_EXPANSION"
    assert rep.trade_directive == "EXECUTE_ACCELERATED_POV_EXPANSION"
    assert rep.governed_pov > 0.15  # Expanded POV


def test_predict_volume_pace_anemic():
    predictor = DiurnalVolumeCurvePredictor(default_adv=1000000.0)
    expected_frac = predictor.get_expected_fraction_at_minute(120)
    expected_vol = 1000000.0 * expected_frac

    # Actual realized volume is only 0.5x expected -> Drought!
    rep = predictor.predict_volume_and_govern_pov(
        symbol="INFY",
        minute_offset=120,
        realized_volume_today=expected_vol * 0.5,
        baseline_adv=1000000.0,
        base_pov=0.15,
        min_pov=0.04,
    )
    assert rep.volume_pace_ratio <= 0.70
    assert rep.regime == "ANEMIC_VOLUME_DROUGHT"
    assert rep.trade_directive == "THROTTLE_POV_PARTICIPATION_ANEMIC"
    assert rep.governed_pov < 0.15  # Compressed POV


def test_sqlite_persistence():
    predictor = DiurnalVolumeCurvePredictor(db_path=":memory:", default_adv=500000.0)
    rep = predictor.predict_volume_and_govern_pov("TATASTEEL", minute_offset=45, realized_volume_today=100000.0)
    assert rep.symbol == "TATASTEEL"

    rows = predictor.get_latest_telemetry(5)
    assert len(rows) == 1
    assert rows[0][0] == "TATASTEEL"
    assert rows[0][1] == 45
