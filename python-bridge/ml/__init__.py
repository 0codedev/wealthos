"""python-bridge/ml — Phase D world-class ML package.

Exposes the 3-trainer tournament: walk-forward CV splits, three model trainers
(LightGBM, CatBoost, TabPFN), and an ONNX export utility.

Public surface used by train_ml.py and the FastAPI ml_models router:

    from ml.walk_forward import walk_forward_splits
    from ml.lightgbm_trainer import LightGBMTrainer
    from ml.catboost_trainer import CatBoostTrainer
    from ml.tabpfn_trainer import TabPFNTrainer
    from ml.onnx_export import verify_onnx, save_metrics

Version: 1.0.0 (2026-06-18)
"""
__version__ = "1.0.0"
