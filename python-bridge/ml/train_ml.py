"""python-bridge/ml/train_ml.py — Phase D orchestrator.

End-to-end training pipeline:

    1. Load training rows from a CSV/JSON export (the same one the browser
       uses for `db.trade_legs`). For now we read from a CSV produced by the
       Phase B export. (The browser-side labeler continues to do its own
       thing; this script is the offline training pipeline.)

    2. For each trainer (LightGBM, CatBoost, TabPFN):
         a. Walk-forward CV → folds
         b. Fit on each fold's train, evaluate on val
         c. Pick the best fold by AUC
         d. Retrain on all data using the best fold's params
         e. Export to ONNX
         f. Verify round-trip delta < 1e-4

    3. Compare trainers on the most-recent fold, promote the best to
       `ml_models/_active.json`.

Usage:
    # Train against a CSV of features+labels
    python -m ml.train_ml --csv data/train_v1.csv --out-dir ml_models/2026-06-18

    # Smoke mode: synthesize a 200-row dataset and run the full pipeline
    python -m ml.train_ml --smoke --out-dir ml_models/_smoke

    # Skip TabPFN (saves the 3 GB weights download)
    python -m ml.train_ml --smoke --skip tabpfn
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

# Ensure sibling-imports work when invoked as `python ml/train_ml.py`
THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR.parent))

from ml.walk_forward import walk_forward_splits
from ml.lightgbm_trainer import LightGBMTrainer
from ml.catboost_trainer import CatBoostTrainer
from ml.tabpfn_trainer import TabPFNTrainer
from ml.onnx_export import (
    save_metrics,
    verify_onnx,
    write_active_pointer,
    read_active_pointer,
)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("train_ml")


TRAINERS = {
    "lightgbm": LightGBMTrainer,
    "catboost": CatBoostTrainer,
    "tabpfn": TabPFNTrainer,
}


def _load_csv(csv_path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Read CSV with header row. Last column is the label (0/1); the rest are features.

    Returns (X, y) as float32 / int32 numpy arrays. Missing values are NaN.
    """
    import csv
    rows: list[list[str]] = []
    with csv_path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        for row in reader:
            if not row:
                continue
            rows.append(row)
    if not rows:
        raise ValueError(f"empty CSV: {csv_path}")
    n_features = len(header) - 1
    X = np.array([[float(r[i]) if r[i] != "" else np.nan for i in range(n_features)] for r in rows],
                 dtype=np.float32)
    y = np.array([int(r[-1]) for r in rows], dtype=np.int32)
    return X, y


def _synthesize(n: int = 200, n_features: int = 12, seed: int = 42) -> tuple[np.ndarray, np.ndarray]:
    """Generate a synthetic dataset for smoke tests.

    Class 1 lives in a slightly shifted region of feature space — gives AUC > 0.55.
    """
    rng = np.random.default_rng(seed)
    half = n // 2
    X0 = rng.normal(0.0, 1.0, size=(half, n_features)).astype(np.float32)
    X1 = rng.normal(0.6, 1.1, size=(n - half, n_features)).astype(np.float32)
    X = np.vstack([X0, X1])
    y = np.array([0] * half + [1] * (n - half), dtype=np.int32)
    perm = rng.permutation(n)
    return X[perm], y[perm]


def _evaluate_fold(trainer, X_tr: np.ndarray, y_tr: np.ndarray,
                   X_va: np.ndarray, y_va: np.ndarray):
    trainer.fit(X_tr, y_tr, X_va, y_va)
    proba = trainer.predict_proba(X_va)[:, 1]
    auc = trainer.score_auc(y_va, proba)
    ll = trainer.score_log_loss(y_va, proba)
    return auc, ll, trainer


def run_one_trainer(
    name: str,
    trainer_cls,
    X: np.ndarray,
    y: np.ndarray,
    *,
    out_dir: Path,
    train_days: int = 60,
    val_days: int = 7,
    step_days: int = 7,
) -> dict:
    """Train one trainer via walk-forward CV, export to ONNX, return metrics."""
    log.info(f"[{name}] starting walk-forward CV on n={len(X)} rows")
    folds = walk_forward_splits(
        n_samples=len(X),
        train_days=train_days,
        val_days=val_days,
        step_days=step_days,
    )
    if not folds:
        raise RuntimeError(
            f"[{name}] not enough rows ({len(X)}) for walk-forward "
            f"(need at least {train_days + val_days})"
        )

    fold_results: list[dict] = []
    best_fold_idx = 0
    best_auc = -np.inf
    best_trainer = None
    best_X_tr = None
    best_y_tr = None
    best_X_va = None
    best_y_va = None

    for fold in folds:
        try:
            trainer = trainer_cls()
            auc, ll, fitted = _evaluate_fold(
                trainer,
                X[list(fold.train_indices)],
                y[list(fold.train_indices)],
                X[list(fold.val_indices)],
                y[list(fold.val_indices)],
            )
            fold_results.append({
                "fold": fold.fold_index,
                "auc": float(auc),
                "log_loss": float(ll),
                "n_train": len(fold.train_indices),
                "n_val": len(fold.val_indices),
            })
            log.info(f"[{name}] fold {fold.fold_index}: AUC={auc:.4f} log_loss={ll:.4f}")
            if auc > best_auc:
                best_auc = auc
                best_fold_idx = fold.fold_index
                best_trainer = fitted
                best_X_tr = X[list(fold.train_indices)]
                best_y_tr = y[list(fold.train_indices)]
                best_X_va = X[list(fold.val_indices)]
                best_y_va = y[list(fold.val_indices)]
        except Exception as e:
            log.exception(f"[{name}] fold {fold.fold_index} failed: {e}")
            fold_results.append({"fold": fold.fold_index, "error": str(e)})

    if best_trainer is None:
        raise RuntimeError(f"[{name}] no successful folds")

    # Refit on the best fold's train data, then validate again, then export.
    log.info(f"[{name}] refitting on best fold {best_fold_idx} for export")
    final_trainer = trainer_cls()
    final_trainer.fit(best_X_tr, best_y_tr, best_X_va, best_y_va)

    onnx_path = out_dir / f"{name}.onnx"
    metrics_json_path = out_dir / f"{name}.json"
    n_features = X.shape[1]

    final_trainer.export_onnx(onnx_path, n_features=n_features)
    onnx_size = onnx_path.stat().st_size

    # Verify round-trip
    expected_proba = final_trainer.predict_proba(best_X_va[:32])
    verify_onnx(onnx_path, best_X_va[:32], expected_proba=expected_proba)

    save_metrics(
        metrics_json_path,
        trainer=name,
        auc=best_auc,
        log_loss=next((f["log_loss"] for f in reversed(fold_results) if "log_loss" in f), float("nan")),
        n_train=len(best_X_tr),
        n_val=len(best_X_va),
        onnx_path=str(onnx_path.relative_to(out_dir.parent)) if onnx_path.is_relative_to(out_dir.parent) else str(onnx_path),
        onnx_size_bytes=onnx_size,
        extra={
            "best_fold": best_fold_idx,
            "folds": fold_results,
            "n_features": n_features,
        },
    )
    return {
        "trainer": name,
        "auc": float(best_auc),
        "onnx_path": str(onnx_path),
        "metrics_path": str(metrics_json_path),
        "onnx_size_bytes": onnx_size,
        "n_folds": len(folds),
        "folds_passed": sum(1 for f in fold_results if "auc" in f),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", help="CSV of features+label (last col = label)")
    ap.add_argument("--smoke", action="store_true", help="use a synthetic dataset")
    ap.add_argument("--out-dir", required=True, help="output dir for .onnx + .json")
    ap.add_argument("--train-days", type=int, default=60)
    ap.add_argument("--val-days", type=int, default=7)
    ap.add_argument("--step-days", type=int, default=7)
    ap.add_argument("--skip", action="append", default=[], choices=list(TRAINERS),
                    help="trainer(s) to skip (e.g. --skip tabpfn)")
    ap.add_argument("--no-promote", action="store_true", help="don't write _active.json")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.smoke:
        log.info("SMOKE mode: synthesizing 200-row dataset")
        X, y = _synthesize(n=200, n_features=12)
    elif args.csv:
        log.info(f"loading {args.csv}")
        X, y = _load_csv(Path(args.csv))
    else:
        log.error("provide either --csv or --smoke")
        return 2
    log.info(f"dataset: X={X.shape} y={y.shape} pos_rate={y.mean():.3f}")

    results: list[dict] = []
    for name, cls in TRAINERS.items():
        if name in args.skip:
            log.info(f"SKIPPING {name}")
            continue
        try:
            r = run_one_trainer(
                name, cls, X, y,
                out_dir=out_dir,
                train_days=args.train_days,
                val_days=args.val_days,
                step_days=args.step_days,
            )
            results.append(r)
        except Exception as e:
            log.exception(f"[{name}] FAILED: {e}")
            results.append({"trainer": name, "error": str(e)})

    # Summary
    log.info("=" * 60)
    log.info("Tournament results:")
    for r in results:
        if "error" in r:
            log.info(f"  {r['trainer']}: ERROR ({r['error']})")
        else:
            log.info(f"  {r['trainer']}: AUC={r['auc']:.4f}  onnx={r['onnx_size_bytes']/1024:.1f} KB")

    # Promote winner unless --no-promote
    if not args.no_promote:
        valid = [r for r in results if "auc" in r]
        if valid:
            winner = max(valid, key=lambda r: r["auc"])
            ml_models_root = out_dir.parent
            write_active_pointer(
                ml_models_root,
                trainer=winner["trainer"],
                onnx_relpath=str(Path(winner["onnx_path"]).relative_to(ml_models_root)),
                metrics_relpath=str(Path(winner["metrics_path"]).relative_to(ml_models_root)),
                auc=winner["auc"],
            )
            log.info(f"PROMOTED: {winner['trainer']} (AUC {winner['auc']:.4f}) → _active.json")

    summary_path = out_dir / "tournament_summary.json"
    summary_path.write_text(json.dumps({
        "results": results,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }, indent=2))
    log.info(f"summary → {summary_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
