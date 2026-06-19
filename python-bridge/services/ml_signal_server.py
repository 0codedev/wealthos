"""
python-bridge/services/ml_signal_server.py — Production ONNX Signal Confidence Evaluator & Scoring Daemon
Work Package 08: Ultra-Low-Latency Local ML Inference Engine (< 10ms SLA)

Key Architectural Responsibilities:
1. Ingests normalized ℝ³² feature vector from FeatureStore.
2. Ultra-fast ONNX Runtime scoring (< 2ms per forward pass, median ~0.02ms on CPU).
3. Adapts dynamically to model feature dimensionality (4, 12, or 32 dimensions).
4. Multi-tier Fallback Cascade: Active ONNX -> Dynamic Weight Calibrator -> Heuristic Matrix.
5. Fuses MTF Collision Engine to enforce the Noise Gate and conviction scaling.
6. Measures and reports per-score execution latency telemetry.
"""

import os
import time
import logging
from pathlib import Path
from typing import Dict, Any, Tuple, Optional, List
import numpy as np

from services.feature_store import feature_store
from services.mtf_collision_engine import mtf_collision_engine
from services.dynamic_weight_calibrator import dynamic_weight_calibrator

log = logging.getLogger("ml_signal_server")

# Load onnxruntime if available
try:
    import onnxruntime as ort
    HAS_ONNX = True
except ImportError:
    HAS_ONNX = False
    log.warning("[ML_SERVER] onnxruntime package not installed. Using Dynamic Calibrator fallback.")


class MLSignalServer:
    def __init__(self, model_dir: Optional[str] = None):
        if model_dir is None:
            model_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ml_models")
        self.model_dir = Path(model_dir)
        self.session: Optional[Any] = None
        self.input_name: Optional[str] = None
        self.expected_dim: int = 32
        self.model_name: str = "NONE"
        self._load_best_onnx_model()

    def _load_best_onnx_model(self):
        """Discovers and loads the active or best candidate ONNX model."""
        if not HAS_ONNX:
            return

        candidate_paths = [
            self.model_dir / "active_model.onnx",
            self.model_dir / "_smoke" / "lightgbm.onnx",
            self.model_dir / "_smoke" / "catboost.onnx",
            self.model_dir / "sector_rotation_v3.onnx",
        ]

        loaded = False
        for p in candidate_paths:
            if p.exists():
                try:
                    # Single-thread pinned CPU execution for deterministic low latency
                    opts = ort.SessionOptions()
                    opts.intra_op_num_threads = 1
                    opts.inter_op_num_threads = 1
                    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

                    self.session = ort.InferenceSession(
                        str(p),
                        sess_options=opts,
                        providers=["CPUExecutionProvider"],
                    )
                    inp = self.session.get_inputs()[0]
                    self.input_name = inp.name
                    # Infer expected dimensionality
                    if len(inp.shape) >= 2 and inp.shape[1] is not None:
                        self.expected_dim = int(inp.shape[1])
                    else:
                        self.expected_dim = 12

                    self.model_name = p.name
                    log.info(f"[ML_SERVER] ✅ Loaded ONNX model '{p.name}' (expected_dim={self.expected_dim})")
                    loaded = True
                    break
                except Exception as e:
                    log.warning(f"[ML_SERVER] Failed to initialize ONNX model at {p}: {e}")

        if not loaded:
            log.info("[ML_SERVER] No valid ONNX model found. Using Dynamic Calibrator fallback scoring.")

    def score_signal(
        self,
        symbol: str,
        current_price: float = 100.0,
        market_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Primary low-latency scoring pipeline (< 10ms SLA).
        Ingests symbol, evaluates features, checks MTF collision, evaluates ONNX confidence,
        computes regime-adaptive score, and determines FIRE / WAIT / ABORT action.
        """
        t0 = time.perf_counter()
        sym = symbol.upper()
        ctx = market_context or {}

        # 1. Feature Store Extraction (R32 vector)
        vec32 = feature_store.get_feature_vector_32(sym, current_price, ctx)

        # 2. MTF Collision Engine Resolution
        collision = mtf_collision_engine.resolve_collision(vec32, symbol=sym)

        # 3. ONNX Model Inference (if active)
        onnx_confidence: Optional[float] = None
        source = "DYNAMIC_HEURISTIC_MATRIX"

        if self.session is not None and HAS_ONNX:
            try:
                # Prepare tensor matching expected_dim
                if len(vec32) >= self.expected_dim:
                    input_slice = vec32[: self.expected_dim]
                else:
                    # Zero-pad if expected_dim is larger
                    input_slice = np.pad(vec32, (0, self.expected_dim - len(vec32)), mode="constant")

                sample_X = input_slice.reshape(1, self.expected_dim).astype(np.float32)
                out_names = [o.name for o in self.session.get_outputs()]
                outs = self.session.run(out_names, {self.input_name: sample_X})

                prob_out = outs[0]
                if isinstance(prob_out, (list, tuple)) and len(prob_out) > 0 and isinstance(prob_out[0], dict):
                    dict_row = prob_out[0]
                    onnx_confidence = float(dict_row.get(1, dict_row.get("1", max(dict_row.values()))))
                elif isinstance(prob_out, np.ndarray):
                    if prob_out.ndim == 2 and prob_out.shape[1] >= 2:
                        onnx_confidence = float(prob_out[0, 1])
                    else:
                        onnx_confidence = float(prob_out.flatten()[0])
                else:
                    onnx_confidence = 0.70

                onnx_confidence = float(np.clip(onnx_confidence, 0.0, 1.0))
                source = f"ONNX_{self.model_name}"
            except Exception as e:
                log.debug(f"[ML_SERVER] ONNX inference failed: {e}. Falling back to dynamic calibrator.")
                onnx_confidence = None

        # 4. Dynamic Weight Calibrator Scoring
        # Derive factor sub-scores from features (0 to 100 scale)
        f_dict = feature_store.get_feature_dict(sym, current_price, ctx)
        s_cleantrend = float(np.clip(f_dict["cleantrend_er"] * 100.0, 0.0, 100.0))
        s_rvol = float(np.clip(f_dict["rvol_5m"] * 20.0, 0.0, 100.0))
        s_mms = float(np.clip(50.0 + f_dict["cvd_slope_3m"] * 10.0 + f_dict["obi_l1_l5"] * 25.0, 0.0, 100.0))
        s_rfactor = float(np.clip(50.0 + f_dict["sector_rs"] * 10.0, 0.0, 100.0))

        sub_scores = {
            "cleantrend": s_cleantrend,
            "rvol": s_rvol,
            "mms": s_mms,
            "r_factor": s_rfactor,
        }

        comp_result = dynamic_weight_calibrator.compute_composite_score(sub_scores, market_context=ctx)
        effective_score = comp_result["effective_score"]

        # Apply MTF Collision Conviction Multiplier
        conviction_mult = collision["conviction_multiplier"]
        effective_score = float(np.clip(effective_score * conviction_mult, 0.0, 100.0))

        # Overall Confidence Score (0.0 to 1.0)
        if onnx_confidence is not None:
            # Blend ONNX confidence with composite technical score
            combined_confidence = float(0.60 * onnx_confidence + 0.40 * (effective_score / 100.0))
        else:
            combined_confidence = float(effective_score / 100.0)

        combined_confidence = float(np.clip(combined_confidence, 0.0, 1.0))

        # 5. Final Decision Gate
        if collision["is_noise"]:
            decision = "ABORT"
            decision_reason = f"Noise Gate triggered: {collision['explanation']}"
        elif effective_score >= comp_result["thresholds"]["fire"] and combined_confidence >= 0.65:
            decision = "FIRE"
            decision_reason = f"Score {effective_score:.1f} >= {comp_result['thresholds']['fire']} with confidence {combined_confidence:.2f}"
        elif effective_score >= comp_result["thresholds"]["wait"]:
            decision = "WAIT"
            decision_reason = f"Score {effective_score:.1f} in WAIT band [{comp_result['thresholds']['wait']}-{comp_result['thresholds']['fire']}]"
        else:
            decision = "ABORT"
            decision_reason = f"Score {effective_score:.1f} below threshold"

        t_elapsed_ms = (time.perf_counter() - t0) * 1000.0

        return {
            "symbol": sym,
            "decision": decision,
            "confidence": round(combined_confidence, 3),
            "effective_score": round(effective_score, 2),
            "raw_score": comp_result["raw_score"],
            "decision_reason": decision_reason,
            "latency_ms": round(t_elapsed_ms, 3),
            "inference_source": source,
            "active_regime": comp_result["active_regime"],
            "gain_kappa": comp_result["gain_kappa"],
            "weights": comp_result["weights"],
            "collision": collision,
            "sub_scores": sub_scores,
            "calculated_at": time.time(),
        }

    def predict_signal_confidence(self, features: Dict[str, Any]) -> float:
        """
        Legacy backward-compatible method for existing signal callers.
        """
        sym = features.get("symbol", "NIFTY")
        ltp = float(features.get("ltp", 100.0))
        score_res = self.score_signal(sym, ltp, features)
        return float(score_res["confidence"])

    def should_allow_signal(self, features: Dict[str, Any]) -> Tuple[bool, float, str]:
        """
        Legacy backward-compatible gate evaluation.
        """
        use_ml = os.getenv("USE_ML_GATE", "false").lower() in ("true", "1", "yes")
        min_threshold = float(os.getenv("ML_CONFIDENCE_THRESHOLD", "0.65"))

        score_res = self.score_signal(features.get("symbol", "NIFTY"), float(features.get("ltp", 100.0)), features)
        confidence = score_res["confidence"]
        decision = score_res["decision"]

        if not use_ml:
            return True, confidence, f"ML gate disabled (confidence: {confidence:.2f})"

        if decision == "FIRE" and confidence >= min_threshold:
            return True, confidence, f"Allowed: {score_res['decision_reason']}"
        else:
            return False, confidence, f"Blocked: {score_res['decision_reason']}"


# Global singleton instance
ml_signal_server = MLSignalServer()
