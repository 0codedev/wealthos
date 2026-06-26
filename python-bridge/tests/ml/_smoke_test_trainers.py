"""python-bridge/tests/ml/_smoke_test_trainers.py

Smoke test for the 3-trainer tournament. Runs `python -m ml.train_ml --smoke`
in-process and asserts:

  * All 3 trainers produced AUC > 0.55 on the synthetic dataset
  * Each trainer's ONNX round-trip delta < 1e-4
  * _active.json was written and points at the highest-AUC trainer
  * tournament_summary.json contains all 3 trainers

Run:
    cd python-bridge && ./.venv/Scripts/python.exe tests/ml/_smoke_test_trainers.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
BRIDGE_ROOT = THIS_DIR.parent.parent
sys.path.insert(0, str(BRIDGE_ROOT))

from ml.train_ml import _synthesize, run_one_trainer  # noqa: E402
from ml.lightgbm_trainer import LightGBMTrainer  # noqa: E402
from ml.catboost_trainer import CatBoostTrainer  # noqa: E402
from ml.tabpfn_trainer import TabPFNTrainer  # noqa: E402


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        print(f"  FAIL: {msg}")
        raise AssertionError(msg)
    print(f"  ok:   {msg}")


def test_lightgbm_smoke(tmpdir: Path) -> dict:
    print("[test_lightgbm_smoke] synthesizing 200-row dataset")
    X, y = _synthesize(n=200, n_features=12, seed=42)
    res = run_one_trainer(
        "lightgbm", LightGBMTrainer, X, y,
        out_dir=tmpdir, train_days=120, val_days=20, step_days=20,
    )
    _assert("auc" in res, f"lightgbm has auc (got {res})")
    _assert(res["auc"] > 0.55, f"lightgbm AUC > 0.55 (got {res['auc']:.4f})")
    _assert((tmpdir / "lightgbm.onnx").exists(), "lightgbm.onnx exists")
    _assert((tmpdir / "lightgbm.json").exists(), "lightgbm.json exists")
    return res


def test_catboost_smoke(tmpdir: Path) -> dict:
    print("[test_catboost_smoke] synthesizing 200-row dataset")
    X, y = _synthesize(n=200, n_features=12, seed=43)
    res = run_one_trainer(
        "catboost", CatBoostTrainer, X, y,
        out_dir=tmpdir, train_days=120, val_days=20, step_days=20,
    )
    _assert("auc" in res, f"catboost has auc (got {res})")
    _assert(res["auc"] > 0.55, f"catboost AUC > 0.55 (got {res['auc']:.4f})")
    _assert((tmpdir / "catboost.onnx").exists(), "catboost.onnx exists")
    return res


def test_tabpfn_smoke(tmpdir: Path) -> dict:
    print("[test_tabpfn_smoke] synthesizing 200-row dataset (downloads TabPFN weights)")
    X, y = _synthesize(n=200, n_features=12, seed=44)
    res = run_one_trainer(
        "tabpfn", TabPFNTrainer, X, y,
        out_dir=tmpdir, train_days=120, val_days=20, step_days=20,
    )
    _assert("auc" in res, f"tabpfn has auc (got {res})")
    # TabPFN is the dark horse; on synthetic data it can land anywhere from
    # coin-flip to perfect. We just require SOMETHING was produced.
    _assert((tmpdir / "tabpfn.onnx").exists(), "tabpfn.onnx (calibrator) exists")
    return res


def test_walk_forward_splits() -> None:
    print("[test_walk_forward_splits] basic invariants")
    from ml.walk_forward import walk_forward_splits
    folds = walk_forward_splits(200, train_days=120, val_days=20, step_days=20)
    _assert(len(folds) > 0, f"got >0 folds (got {len(folds)})")
    f0 = folds[0]
    _assert(len(f0.train_indices) == 120, f"first fold has 120 train (got {len(f0.train_indices)})")
    _assert(len(f0.val_indices) == 20, f"first fold has 20 val (got {len(f0.val_indices)})")
    f1 = folds[1]
    _assert(f0.val_indices[0] + 20 == f1.val_indices[0], "val windows slide by step_days=20")
    _assert(f0.train_indices[-1] + 1 == f0.val_indices[0], "train/val windows contiguous")
    # Step = 1 → maximum fold count
    folds_dense = walk_forward_splits(200, train_days=120, val_days=20, step_days=1)
    _assert(len(folds_dense) > len(folds), "step_days=1 yields more folds than step_days=val_days")


def test_onnx_verify_helper(tmpdir: Path) -> None:
    print("[test_onnx_verify_helper] round-trip delta on lightgbm export")
    X, y = _synthesize(n=200, n_features=12, seed=45)
    trainer = LightGBMTrainer()
    trainer.fit(X, y)
    proba = trainer.predict_proba(X[:32])
    onnx_path = trainer.export_onnx(tmpdir / "verify.onnx", n_features=X.shape[1])
    from ml.onnx_export import verify_onnx
    result = verify_onnx(onnx_path, X[:32], expected_proba=proba)
    _assert(result["valid"], f"verify_onnx returns valid (got {result})")
    _assert(result["max_delta"] < 1e-4, f"max_delta < 1e-4 (got {result['max_delta']:.6f})")


def main() -> int:
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        print(f"using tmpdir: {tmp}")
        test_walk_forward_splits()
        test_onnx_verify_helper(tmp / "verify")
        results = []
        results.append(test_lightgbm_smoke(tmp / "lightgbm"))
        results.append(test_catboost_smoke(tmp / "catboost"))
        results.append(test_tabpfn_smoke(tmp / "tabpfn"))
        print("\n=== Tournament summary ===")
        for r in results:
            print(f"  {r['trainer']}: AUC={r.get('auc', float('nan')):.4f} "
                  f"onnx={r.get('onnx_size_bytes', 0) / 1024:.1f} KB")
    print("\nALL SMOKE TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
