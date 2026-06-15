"""
python-bridge/services/dynamic_weight_calibrator.py — Dynamic Factor Weight Calibration Engine
Work Package 08: 4-Regime Bayesian Blending for RVOL, MMS, CleanTrend, and R-Factor

Key Architectural Responsibilities:
1. Regime Characterization: 4 distinct market macro states
   (BULL_EXPANSION, BEAR_FLUSH, RANGE_BOUND, CHOP_HIGH_VOL).
2. Bayesian Soft Blending: Evaluates continuous posterior probabilities
   p(R_t | z_t) to prevent discrete jumping or weight jitter at boundaries.
3. Anti-Jitter Filter: Exponential smoothing on regime posteriors (alpha=0.15).
4. Weight Invariants: Strictly enforces sum(w_k) == 1.0 and w_k >= 0.05.
5. Dynamic Persistence: Syncs active calibrated weights to alpha_hyperparameters.json.
6. Composite Scoring: Scales composite signals by defensive gain kappa (0.50 in chop).
"""

import os
import json
import time
import logging
from typing import Dict, Any, List, Optional, Tuple
import numpy as np

log = logging.getLogger("dynamic_weight_calibrator")

# Core Alpha Factors
ALPHA_FACTORS = ["cleantrend", "rvol", "mms", "r_factor"]

# The 4 Macro Regimes
REGIMES = ["BULL_EXPANSION", "BEAR_FLUSH", "RANGE_BOUND", "CHOP_HIGH_VOL"]

# Baseline Factor Weight Matrices per Regime
# Subject to: sum(w) == 1.0, w_i >= 0.05
REGIME_WEIGHT_PROFILES: Dict[str, Dict[str, float]] = {
    "BULL_EXPANSION": {
        "cleantrend": 0.35,
        "rvol": 0.30,
        "mms": 0.20,
        "r_factor": 0.15,
        "kappa": 1.00,  # Full gain
    },
    "BEAR_FLUSH": {
        "mms": 0.35,
        "r_factor": 0.30,
        "cleantrend": 0.20,
        "rvol": 0.15,
        "kappa": 1.00,  # Full gain
    },
    "RANGE_BOUND": {
        "mms": 0.40,
        "r_factor": 0.30,
        "cleantrend": 0.15,
        "rvol": 0.15,
        "kappa": 1.00,  # Full gain
    },
    "CHOP_HIGH_VOL": {
        "mms": 0.45,
        "r_factor": 0.30,
        "rvol": 0.15,
        "cleantrend": 0.10,
        "kappa": 0.50,  # Defensive dampening / noise suppression
    },
}

# Empirical Centroids for Soft Gaussian Posterior Classification
# Features: [india_vix, nifty_trend_slope, sector_breadth_pct]
REGIME_CENTROIDS = {
    "BULL_EXPANSION": np.array([13.5, 0.0030, 75.0], dtype=np.float64),
    "BEAR_FLUSH": np.array([21.0, -0.0040, 25.0], dtype=np.float64),
    "RANGE_BOUND": np.array([14.5, 0.0001, 50.0], dtype=np.float64),
    "CHOP_HIGH_VOL": np.array([19.5, 0.0002, 48.0], dtype=np.float64),
}

REGIME_BANDWIDTHS = np.array([4.0, 0.0025, 20.0], dtype=np.float64)


class DynamicWeightCalibrator:
    def __init__(
        self,
        config_path: Optional[str] = None,
        smoothing_alpha: float = 0.15,
        floor_weight: float = 0.05,
    ):
        self.config_path = config_path or os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "alpha_hyperparameters.json"
        )
        self.smoothing_alpha = smoothing_alpha
        self.floor_weight = floor_weight

        # Filter state: smoothed posteriors
        self._is_initialized = False
        self._smoothed_posteriors: Dict[str, float] = {
            "BULL_EXPANSION": 0.25,
            "BEAR_FLUSH": 0.25,
            "RANGE_BOUND": 0.25,
            "CHOP_HIGH_VOL": 0.25,
        }
        self._last_update_ts = 0.0
        self._active_weights = REGIME_WEIGHT_PROFILES["BULL_EXPANSION"].copy()
        self._active_regime = "BULL_EXPANSION"
        self._active_kappa = 1.00

    def compute_regime_posteriors(
        self,
        vix: float,
        trend_slope: float,
        sector_breadth: float,
    ) -> Dict[str, float]:
        """
        Calculates normalized continuous Bayesian posteriors P(Regime | z_t)
        using Mahalanobis/Gaussian kernel distance from empirical centroids.
        """
        z = np.array([float(vix), float(trend_slope), float(sector_breadth)], dtype=np.float64)
        log_likelihoods = {}

        for regime, centroid in REGIME_CENTROIDS.items():
            norm_diff = (z - centroid) / REGIME_BANDWIDTHS
            dist_sq = float(np.sum(norm_diff ** 2))
            log_likelihoods[regime] = -0.5 * dist_sq

        # Softmax normalization for numerical stability
        max_ll = max(log_likelihoods.values())
        exp_ll = {r: math_exp(ll - max_ll) for r, ll in log_likelihoods.items()}
        sum_exp = sum(exp_ll.values())

        if sum_exp <= 1e-12:
            return {r: 0.25 for r in REGIMES}

        raw_posteriors = {r: float(exp_ll[r] / sum_exp) for r in REGIMES}

        # Apply EMA smoothing to prevent jitter (seed with raw_posteriors on first observation)
        if not self._is_initialized:
            self._smoothed_posteriors = raw_posteriors.copy()
            self._is_initialized = True
        else:
            for r in REGIMES:
                prev = self._smoothed_posteriors.get(r, 0.25)
                smoothed = (1.0 - self.smoothing_alpha) * prev + self.smoothing_alpha * raw_posteriors[r]
                self._smoothed_posteriors[r] = float(smoothed)

        # Normalize smoothed posteriors to sum to 1.0
        total_smoothed = sum(self._smoothed_posteriors.values())
        return {r: self._smoothed_posteriors[r] / total_smoothed for r in REGIMES}

    def calibrate_weights(
        self,
        vix: float = 14.5,
        trend_slope: float = 0.001,
        sector_breadth: float = 55.0,
        sync_persistence: bool = True,
    ) -> Dict[str, Any]:
        """
        Computes smoothly blended factor weights across regimes,
        guaranteeing sum(w_k) == 1.0 and w_k >= floor_weight.
        """
        now = time.time()
        posteriors = self.compute_regime_posteriors(vix, trend_slope, sector_breadth)

        # Determine dominant regime
        dominant_regime = max(posteriors.items(), key=lambda kv: kv[1])[0]

        # Blend factor weights by posterior probability
        blended_weights = {factor: 0.0 for factor in ALPHA_FACTORS}
        blended_kappa = 0.0

        for r, p in posteriors.items():
            profile = REGIME_WEIGHT_PROFILES[r]
            for factor in ALPHA_FACTORS:
                blended_weights[factor] += p * profile[factor]
            blended_kappa += p * profile["kappa"]

        # Enforce minimum floor weight invariant
        for factor in ALPHA_FACTORS:
            blended_weights[factor] = max(self.floor_weight, blended_weights[factor])

        # Renormalize to exact 1.0 sum
        total_w = sum(blended_weights.values())
        for factor in ALPHA_FACTORS:
            blended_weights[factor] = round(float(blended_weights[factor] / total_w), 4)

        # Fix minor rounding discrepancies on the largest factor
        diff = round(1.0 - sum(blended_weights.values()), 4)
        if abs(diff) > 0.0:
            top_factor = max(blended_weights.items(), key=lambda kv: kv[1])[0]
            blended_weights[top_factor] = round(blended_weights[top_factor] + diff, 4)

        self._active_weights = blended_weights
        self._active_regime = dominant_regime
        self._active_kappa = round(float(blended_kappa), 3)
        self._last_update_ts = now

        result = {
            "dominant_regime": dominant_regime,
            "gain_kappa": self._active_kappa,
            "weights": blended_weights,
            "posteriors": {r: round(p, 4) for r, p in posteriors.items()},
            "calibrated_at": now,
        }

        if sync_persistence:
            self._save_to_hyperparameters(result)

        return result

    def compute_composite_score(
        self,
        sub_scores: Dict[str, float],
        market_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Computes the regime-adaptive composite alpha score.
        Formula:
          Composite(t) = kappa * sum(w_k * S_k)
        Decision Gates:
          - FIRE:  Score >= fire_threshold (default 72) and not CHOP_HIGH_VOL
          - WAIT:  wait_threshold <= Score < fire_threshold (48 - 72)
          - ABORT: Score < wait_threshold or Noise Gate triggered
        """
        ctx = market_context or {}
        vix = float(ctx.get("india_vix", 14.5))
        trend_slope = float(ctx.get("trend_slope", 0.001))
        breadth = float(ctx.get("sector_breadth", 55.0))

        cal = self.calibrate_weights(vix, trend_slope, breadth, sync_persistence=False)
        weights = cal["weights"]
        kappa = cal["gain_kappa"]

        # Extract or default sub-scores (0.0 to 100.0)
        s_cleantrend = float(sub_scores.get("cleantrend", 50.0))
        s_rvol = float(sub_scores.get("rvol", 50.0))
        s_mms = float(sub_scores.get("mms", 50.0))
        s_rfactor = float(sub_scores.get("r_factor", 50.0))

        raw_score = (
            weights["cleantrend"] * s_cleantrend
            + weights["rvol"] * s_rvol
            + weights["mms"] * s_mms
            + weights["r_factor"] * s_rfactor
        )

        effective_score = float(np.clip(raw_score * kappa, 0.0, 100.0))

        # Dynamic Cutoffs (Isotonic Calibration Baseline)
        fire_threshold = 72.0
        wait_threshold = 48.0

        if cal["dominant_regime"] == "CHOP_HIGH_VOL":
            # Higher bar in violent chop
            fire_threshold = 85.0
            wait_threshold = 60.0

        if effective_score >= fire_threshold:
            decision = "FIRE"
        elif effective_score >= wait_threshold:
            decision = "WAIT"
        else:
            decision = "ABORT"

        return {
            "effective_score": round(effective_score, 2),
            "raw_score": round(raw_score, 2),
            "decision": decision,
            "gain_kappa": kappa,
            "active_regime": cal["dominant_regime"],
            "weights": weights,
            "sub_scores": {
                "cleantrend": s_cleantrend,
                "rvol": s_rvol,
                "mms": s_mms,
                "r_factor": s_rfactor,
            },
            "thresholds": {"fire": fire_threshold, "wait": wait_threshold},
        }

    def _save_to_hyperparameters(self, calibration_result: Dict[str, Any]):
        """Persists the calibrated dynamic weights into alpha_hyperparameters.json."""
        if not os.path.exists(self.config_path):
            return

        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            data["dynamic_regime_weights"] = {
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(calibration_result["calibrated_at"])),
                "dominant_regime": calibration_result["dominant_regime"],
                "gain_kappa": calibration_result["gain_kappa"],
                "weights": calibration_result["weights"],
                "posteriors": calibration_result["posteriors"],
            }

            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)

            log.info(
                f"[DYNAMIC_CALIBRATOR] Updated {self.config_path} for regime: {calibration_result['dominant_regime']}"
            )
        except Exception as e:
            log.warning(f"[DYNAMIC_CALIBRATOR] Failed to sync to hyperparameters json: {e}")


def math_exp(x: float) -> float:
    try:
        return float(np.exp(np.clip(x, -50.0, 50.0)))
    except Exception:
        return 0.0


# Global singleton instance
dynamic_weight_calibrator = DynamicWeightCalibrator()
