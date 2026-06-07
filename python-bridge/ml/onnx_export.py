"""python-bridge/ml/onnx_export.py — shared ONNX verification + metrics IO.

Every trainer in this package can export to ONNX, but the round-trip behavior
varies (LightGBM and CatBoost via onnxmltools; TabPFN via skl2onnx for its
calibrator). These helpers verify that the ONNX model produces the same
predictions as the source Python model, within a tight tolerance.

If `verify_onnx` finds a delta > 1e-4, the export is broken and we abort —
shipping a silently-degraded model would corrupt live scoring.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import onnx
import onnxruntime as ort


MAX_ROUND_TRIP_DELTA = 1e-4  # abort the export if exceeded


def verify_onnx(
    onnx_path: str | Path,
    sample_X: np.ndarray,
    *,
    expected_proba: np.ndarray | None = None,
    input_name: str | None = None,
    delta: float = MAX_ROUND_TRIP_DELTA,
) -> dict[str, Any]:
    """Run the ONNX model on sample_X and compare against expected_proba.

    Args:
        onnx_path: file path of the .onnx to verify.
        sample_X: shape (n, n_features) float32 input.
        expected_proba: shape (n, 2) probability matrix from the source model.
            If None, only ONNX validity is checked.
        input_name: optional ONNX input name; defaults to the first input.
        delta: maximum allowed per-row absolute delta between ONNX and source.

    Returns:
        A dict {valid, max_delta, mean_delta, onnx_output_shape, ...}.

    Raises:
        RuntimeError if delta exceeds the threshold.
    """
    onnx_path = Path(onnx_path)
    if not onnx_path.exists():
        raise FileNotFoundError(f"ONNX model not found: {onnx_path}")

    # 1) Structural validity
    model = onnx.load(str(onnx_path))
    onnx.checker.check_model(model)

    # 2) Run via onnxruntime
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    if input_name is None:
        input_name = sess.get_inputs()[0].name
    # Prefer a probability output by name; fall back to first output.
    out_names = [o.name for o in sess.get_outputs()]
    preferred = [n for n in ("probabilities", "probability", "output_probability", "score")
                 if n in out_names]
    output_names = preferred if preferred else out_names
    sample_X = np.asarray(sample_X, dtype=np.float32)
    outs = sess.run(output_names, {input_name: sample_X})
    if len(outs) == 1:
        onnx_out = outs[0]
    else:
        # Pick the probability-shaped one. Some outputs are list-of-dict;
        # treat them as probability candidates too.
        chosen = None
        for o in outs:
            if isinstance(o, (list, tuple)) and len(o) > 0 and isinstance(o[0], dict):
                chosen = o
                break
            arr = np.asarray(o, dtype=object)
            if arr.ndim == 2 and arr.shape[1] >= 2:
                chosen = o
                break
        onnx_out = chosen if chosen is not None else outs[-1]

    # If the chosen output is a list-of-dict (LightGBM/CatBoost onnxmltools
    # sequence-of-map), pre-normalize to a (n, 2) numpy array of floats,
    # sorted by class label.
    if isinstance(onnx_out, (list, tuple)) and len(onnx_out) > 0 and isinstance(onnx_out[0], dict):
        rows = []
        for row in onnx_out:
            keys = sorted(row.keys())
            rows.append([float(row[k]) for k in keys])
        onnx_out = np.asarray(rows, dtype=np.float64)
    else:
        onnx_out = np.asarray(onnx_out, dtype=object) if not hasattr(onnx_out, "shape") else onnx_out
    result: dict[str, Any] = {
        "onnx_path": str(onnx_path),
        "onnx_size_bytes": onnx_path.stat().st_size,
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    if hasattr(onnx_out, "shape"):
        result["onnx_output_shape"] = list(onnx_out.shape)

    if expected_proba is None:
        result["valid"] = True
        result["skipped_proba_check"] = True
        return result

    expected_proba = np.asarray(expected_proba, dtype=np.float64)
    onnx_out = np.asarray(onnx_out, dtype=np.float64)

    # LightGBM and CatBoost via onnxmltools emit a sequence-of-map output
    # for binary classifiers: each row is a {class_label: probability} dict.
    # Normalize to a (n, 2) matrix sorted by class label.
    if onnx_out.dtype == object:
        rows = []
        for row in onnx_out:
            if isinstance(row, dict):
                keys = sorted(row.keys())
                rows.append([float(row[k]) for k in keys])
            else:
                # list of (label, prob) tuples
                pairs = sorted((int(k), float(v)) for k, v in row)
                rows.append([p for _, p in pairs])
        onnx_out = np.asarray(rows, dtype=np.float64)

    if onnx_out.ndim == 1:
        # Some ONNX exports only emit P(class 1); expand to (n, 2)
        onnx_out = np.column_stack([1.0 - onnx_out, onnx_out])

    if onnx_out.ndim == 3 and onnx_out.shape[0] == 1:
        # Some ONNX exports return shape (1, N, 1); flatten
        onnx_out = onnx_out.reshape(onnx_out.shape[1], onnx_out.shape[2])
        if onnx_out.shape[1] == 1:
            onnx_out = np.column_stack([1.0 - onnx_out[:, 0], onnx_out[:, 0]])

    if onnx_out.ndim == 4 and onnx_out.shape[0] == 1 and onnx_out.shape[1] == 1:
        # (1, 1, N, 1) — unusual export shape; flatten the singleton dims.
        onnx_out = onnx_out.reshape(onnx_out.shape[2], onnx_out.shape[3])

    # TabPFN lookup graph emits shape (N, 1) — a single calibrated probability
    # of the positive class. Expand to (n, 2) to match `predict_proba`'s layout.
    if onnx_out.ndim == 2 and onnx_out.shape[1] == 1 and expected_proba.shape[1] == 2:
        onnx_out = np.column_stack([1.0 - onnx_out[:, 0], onnx_out[:, 0]])

    # Some TabPFN exports (1, N, 1, 1) → (N, 1) → (N, 2)
    if onnx_out.ndim == 4 and onnx_out.shape[0] == 1 and onnx_out.shape[2] == 1 and onnx_out.shape[3] == 1:
        onnx_out = onnx_out.reshape(onnx_out.shape[1], 1)
        if expected_proba.shape[1] == 2:
            onnx_out = np.column_stack([1.0 - onnx_out[:, 0], onnx_out[:, 0]])

    if onnx_out.shape != expected_proba.shape:
        raise RuntimeError(
            f"ONNX output shape {onnx_out.shape} != expected {expected_proba.shape}"
        )
    diff = np.abs(onnx_out - expected_proba)
    max_delta = float(diff.max())
    mean_delta = float(diff.mean())
    result["max_delta"] = max_delta
    result["mean_delta"] = mean_delta
    result["threshold"] = delta
    result["valid"] = max_delta <= delta
    if not result["valid"]:
        raise RuntimeError(
            f"ONNX round-trip delta {max_delta:.6f} exceeds threshold {delta:.6f} "
            f"for {onnx_path}"
        )
    return result


def save_metrics(
    path: str | Path,
    *,
    trainer: str,
    auc: float,
    log_loss: float,
    n_train: int,
    n_val: int,
    extra: dict[str, Any] | None = None,
    onnx_path: str | None = None,
    onnx_size_bytes: int | None = None,
) -> Path:
    """Write a sidecar JSON with all the numbers the leaderboard needs.

    File format:
        {
          "trainer": "lightgbm",
          "auc": 0.642,
          "log_loss": 0.687,
          "n_train": 540,
          "n_val": 67,
          "onnx_path": "ml_models/2026-06-18/lightgbm.onnx",
          "onnx_size_bytes": 184320,
          "trained_at": "2026-06-18T10:32:11Z",
          "extra": {...}
        }
    """
    payload: dict[str, Any] = {
        "trainer": trainer,
        "auc": float(auc),
        "log_loss": float(log_loss),
        "n_train": int(n_train),
        "n_val": int(n_val),
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    if onnx_path is not None:
        payload["onnx_path"] = onnx_path
    if onnx_size_bytes is not None:
        payload["onnx_size_bytes"] = onnx_size_bytes
    if extra:
        payload["extra"] = extra

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2))
    return path


def load_metrics(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text())


def write_active_pointer(
    ml_models_dir: str | Path,
    *,
    trainer: str,
    onnx_relpath: str,
    metrics_relpath: str,
    auc: float,
) -> Path:
    """Write `ml_models/_active.json` so the API knows which model is hot."""
    ml_models_dir = Path(ml_models_dir)
    payload = {
        "active_trainer": trainer,
        "onnx_path": onnx_relpath,
        "metrics_path": metrics_relpath,
        "auc": float(auc),
        "promoted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    fp = ml_models_dir / "_active.json"
    fp.write_text(json.dumps(payload, indent=2))
    return fp


def read_active_pointer(ml_models_dir: str | Path) -> dict[str, Any] | None:
    fp = Path(ml_models_dir) / "_active.json"
    if not fp.exists():
        return None
    try:
        return json.loads(fp.read_text())
    except Exception:
        return None
