"""python-bridge/ml/lightgbm_trainer.py — Model 1 in the 3-trainer tournament.

Gradient-boosted decision trees via LightGBM. Fast baseline; strong out of the
box on tabular data with missing values. We keep params conservative (200 trees,
max_depth=4, lr=0.05) to limit overfitting on the small trade-leg dataset.

ONNX export uses `onnxmltools.convert_lightgbm`, which preserves the tree
structure exactly. Round-trip delta vs the Python booster is < 1e-6 in our tests.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import numpy as np


@dataclass
class TrainerMetrics:
    """Metrics reported to the leaderboard after a CV run."""
    auc: float
    log_loss: float
    n_train: int
    n_val: int
    best_iteration: int | None = None
    extra: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        if self.extra is None:
            d.pop("extra")
        return d


class LightGBMTrainer:
    """LightGBM wrapper that fits binary classification and exports to ONNX.

    Usage:
        trainer = LightGBMTrainer()
        trainer.fit(X_train, y_train)
        proba = trainer.predict_proba(X_val)[:, 1]
        trainer.export_onnx("ml_models/2026-06-18/lightgbm.onnx", n_features=X_train.shape[1])
        trainer.save_metrics("ml_models/2026-06-18/lightgbm.json", metrics)
    """

    name = "lightgbm"

    DEFAULT_PARAMS = {
        "objective": "binary",
        "metric": "binary_logloss",
        "n_estimators": 200,
        "learning_rate": 0.05,
        "max_depth": 4,
        "num_leaves": 15,
        "min_child_samples": 10,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "reg_lambda": 1.0,
        "verbose": -1,
        "n_jobs": -1,
    }

    def __init__(self, **overrides: Any):
        self.params = {**self.DEFAULT_PARAMS, **overrides}
        self._booster = None
        self._best_iteration: int | None = None
        self._feature_count: int | None = None

    def fit(self, X: np.ndarray, y: np.ndarray, X_val: np.ndarray | None = None,
            y_val: np.ndarray | None = None) -> "LightGBMTrainer":
        import lightgbm as lgb
        X = np.asarray(X, dtype=np.float32)
        y = np.asarray(y, dtype=np.int32)
        self._feature_count = X.shape[1]
        callbacks = []
        valid_sets: list = []
        if X_val is not None and y_val is not None:
            X_val = np.asarray(X_val, dtype=np.float32)
            y_val = np.asarray(y_val, dtype=np.int32)
            valid_sets = [lgb.Dataset(X_val, label=y_val, feature_name=[f"f{i}" for i in range(self._feature_count)])]
            callbacks = [lgb.early_stopping(stopping_rounds=20, verbose=False)]
        train_ds = lgb.Dataset(X, label=y, feature_name=[f"f{i}" for i in range(self._feature_count)])
        self._booster = lgb.train(
            self.params,
            train_ds,
            num_boost_round=self.params.get("n_estimators", 200),
            valid_sets=valid_sets,
            callbacks=callbacks,
        )
        self._best_iteration = getattr(self._booster, "best_iteration", None)
        return self

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """Return shape (n, 2) probabilities [P(class 0), P(class 1)]."""
        if self._booster is None:
            raise RuntimeError("LightGBMTrainer.fit() must be called before predict_proba()")
        X = np.asarray(X, dtype=np.float32)
        raw = self._booster.predict(X, num_iteration=self._best_iteration)
        raw = np.asarray(raw, dtype=np.float64)
        # LightGBM binary objective returns P(class 1) directly
        p1 = np.clip(raw, 1e-7, 1 - 1e-7)
        p0 = 1.0 - p1
        return np.column_stack([p0, p1])

    def export_onnx(self, path: str | Path, n_features: int | None = None,
                    initial_types: list | None = None) -> Path:
        """Export the trained booster to ONNX.

        `initial_types` lets the caller attach real feature names so the ONNX
        graph is self-documenting. Defaults to `["f0", "f1", ...]`.
        """
        if self._booster is None:
            raise RuntimeError("LightGBMTrainer.fit() must be called before export_onnx()")
        from onnxmltools import convert_lightgbm
        from onnx import save
        n_features = n_features or self._feature_count
        if n_features is None:
            raise ValueError("n_features unknown; pass it explicitly")
        if initial_types is None:
            from onnxmltools.convert.common.data_types import FloatTensorType
            initial_types = [("input", FloatTensorType([None, n_features]))]
        onnx_model = convert_lightgbm(
            self._booster,
            initial_types=initial_types,
            target_opset=15,
        )
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        save(onnx_model, str(path))
        return path

    def save_metrics(self, path: str | Path, metrics: TrainerMetrics) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(metrics.to_dict(), indent=2))
        return path

    @staticmethod
    def score_auc(y_true: np.ndarray, y_proba: np.ndarray) -> float:
        """Compute ROC AUC vs sklearn (avoids a hard dependency here)."""
        from sklearn.metrics import roc_auc_score
        return float(roc_auc_score(y_true, y_proba))

    @staticmethod
    def score_log_loss(y_true: np.ndarray, y_proba: np.ndarray) -> float:
        from sklearn.metrics import log_loss
        return float(log_loss(y_true, np.clip(y_proba, 1e-7, 1 - 1e-7)))
