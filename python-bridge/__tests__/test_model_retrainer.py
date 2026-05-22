"""
python-bridge/__tests__/test_model_retrainer.py — Unit Tests for AutoML Retrainer & Degradation Watchdog
"""

import sys
import os
import time
import pytest
import numpy as np

# Add python-bridge directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.model_retrainer import ModelRetrainer, model_retrainer


def test_purged_walk_forward_splits_no_leakage():
    """Verify that purged walk-forward splits enforce strict chronological separation and purge buffer."""
    retrainer = ModelRetrainer()
    base_t = 100000.0

    # 100 chronological samples
    samples = [{"timestamp": base_t + i * 86400, "pnl": 100.0} for i in range(100)]

    folds = retrainer.purged_walk_forward_split(samples, train_days=30, val_days=10, purge_days=2)
    assert len(folds) > 0

    for train_fold, val_fold in folds:
        assert len(train_fold) == 30
        assert len(val_fold) == 10

        t_train_last = train_fold[-1]["timestamp"]
        t_val_first = val_fold[0]["timestamp"]

        # Assert no temporal overlap
        assert t_train_last < t_val_first
        # Assert purge gap is respected (2 days = 2 * 86400)
        assert (t_val_first - t_train_last) >= (2 * 86400)


def test_model_candidate_evaluation_metrics():
    """Verify mathematical calculation of out-of-sample metrics."""
    retrainer = ModelRetrainer()

    samples = [
        {"pnl": 1000.0, "mfe": 1500.0, "mae": 300.0},
        {"pnl": 2000.0, "mfe": 2500.0, "mae": 400.0},
        {"pnl": -500.0, "mfe": 200.0, "mae": 600.0},
        {"pnl": 1500.0, "mfe": 1800.0, "mae": 250.0},
    ]

    metrics = retrainer.evaluate_model_candidate(samples)
    assert metrics["sample_count"] == 4
    # 3 wins out of 4 = 75%
    assert metrics["hit_rate"] == 0.75
    assert metrics["sharpe"] > 0.0
    assert metrics["mfe_mae_ratio"] > 1.0


def test_promotion_gate_with_superior_and_inferior_models(tmp_path):
    """Verify candidate is PROMOTED only when meeting Sharpe >= 1.50 and HitRate >= 0.55."""
    model_dir = tmp_path / "ml_models"
    os.makedirs(model_dir / "archive", exist_ok=True)
    retrainer = ModelRetrainer(model_dir=str(model_dir))

    # Superior candidate journal
    high_perf_trades = []
    base_t = 100000.0
    for i in range(80):
        high_perf_trades.append({
            "timestamp": base_t + i * 86400,
            "pnl": 2000.0 if i % 4 != 0 else -500.0,  # 75% win rate
            "mfe": 2500.0,
            "mae": 400.0,
        })

    res_pass = retrainer.run_daily_retrain(trade_samples=high_perf_trades)
    assert res_pass["status"] == "SUCCESS"
    assert res_pass["action"] == "PROMOTED"

    # Inferior candidate journal (failing hit rate and negative Sharpe)
    low_perf_trades = []
    for i in range(80):
        low_perf_trades.append({
            "timestamp": base_t + i * 86400,
            "pnl": -1500.0 if i % 3 != 0 else 500.0,  # 33% win rate
            "mfe": 600.0,
            "mae": 1600.0,
        })

    res_fail = retrainer.run_daily_retrain(trade_samples=low_perf_trades)
    assert res_fail["status"] == "REJECTED"
    assert res_fail["action"] == "RETAINED_INCUMBENT"


def test_degradation_watchdog_circuit_breaker(tmp_path):
    """Verify that a drop in 7-day rolling win-rate below threshold triggers automatic rollback."""
    model_dir = tmp_path / "ml_models"
    archive_dir = model_dir / "archive"
    os.makedirs(archive_dir, exist_ok=True)

    # Place a dummy archive model
    backup_model = archive_dir / "model_v1_backup.onnx"
    with open(backup_model, "w") as f:
        f.write("DUMMY_ONNX_BLOB")

    retrainer = ModelRetrainer(model_dir=str(model_dir))

    # 1. Healthy recent performance
    healthy_trades = [{"pnl": 1000.0 if i % 3 != 0 else -500.0} for i in range(20)]  # 66%
    check_healthy = retrainer.check_rolling_degradation(healthy_trades)
    assert check_healthy["status"] == "HEALTHY"
    assert check_healthy["action"] == "MAINTAIN"

    # 2. Poisoned performance (degraded model yielding 10% win rate)
    degraded_trades = [{"pnl": -1500.0 if i < 18 else 500.0} for i in range(20)]  # 10%
    check_degraded = retrainer.check_rolling_degradation(degraded_trades)

    assert check_degraded["status"] == "DEGRADATION_TRIGGERED"
    assert check_degraded["action"] == "ROLLED_BACK"
    assert check_degraded["rollback_details"]["status"] == "SUCCESS"
    assert check_degraded["rollback_details"]["restored_from"] == "model_v1_backup.onnx"
