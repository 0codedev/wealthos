"""
python-bridge/services/mtf_collision_engine.py — Multi-Timeframe Feature Collision Engine
Work Package 08: Temporal Zero-Lookahead Alignment & Multi-Cadence Collision Matrix

Enforces:
1. Zero-Lookahead Invariant: Strict causal backward time alignment (5m at T joins 15m closed at <= T).
2. Multi-Timeframe Collision Matrix: Resolves directional conflict across 15m Structural Anchor,
   5m Tactical Momentum, and 1m Microstructure Orderflow.
3. Universal Noise Gate: Suppresses execution when CleanTrend ER is low and timeframes are in conflict.
"""

import math
import logging
from typing import Dict, Any, List, Optional, Tuple
import numpy as np

from services.feature_store import FEATURE_NAMES_32, feature_store

log = logging.getLogger("mtf_collision_engine")


class MTFCollisionEngine:
    def __init__(self):
        self.feature_indices = {name: idx for idx, name in enumerate(FEATURE_NAMES_32)}

    def verify_zero_lookahead(self, bar_5m_ts: float, bar_15m_close_ts: float) -> bool:
        """
        Zero-Lookahead Invariant Guard:
        The 15m bar close timestamp MUST be strictly less than or equal to the 5m bar timestamp.
        Returns True if invariant holds, False if future leakage is detected.
        """
        return bar_15m_close_ts <= bar_5m_ts

    def align_asof_bars(
        self,
        bars_5m: List[Dict[str, Any]],
        bars_15m: List[Dict[str, Any]],
    ) -> List[Tuple[Dict[str, Any], Dict[str, Any]]]:
        """
        Performs causal backward merge_asof alignment between 5m tactical bars
        and 15m structural bars with strict zero-lookahead verification.
        """
        aligned_pairs = []
        if not bars_5m or not bars_15m:
            return aligned_pairs

        # Sort strictly by timestamp ascending
        sorted_5m = sorted(bars_5m, key=lambda b: float(b.get("timestamp", 0)))
        sorted_15m = sorted(bars_15m, key=lambda b: float(b.get("timestamp", 0)))

        idx_15m = 0
        latest_valid_15m = None

        for b5 in sorted_5m:
            t5 = float(b5.get("timestamp", 0))

            # Advance 15m pointer only up to bars closed at or before t5
            while idx_15m < len(sorted_15m) and float(sorted_15m[idx_15m].get("timestamp", 0)) <= t5:
                latest_valid_15m = sorted_15m[idx_15m]
                idx_15m += 1

            if latest_valid_15m is not None:
                # Invariant assert
                assert self.verify_zero_lookahead(t5, float(latest_valid_15m.get("timestamp", 0))), (
                    f"Lookahead leakage! 5m bar at {t5} joined with 15m bar at {latest_valid_15m.get('timestamp')}"
                )
                aligned_pairs.append((b5, latest_valid_15m))

        return aligned_pairs

    def resolve_collision(
        self,
        features_32: np.ndarray,
        symbol: str = "NIFTY",
    ) -> Dict[str, Any]:
        """
        Resolves directional conflicts across 15m, 5m, and 1m horizons
        using the normalized 32-dimensional feature vector.
        """
        f = features_32
        idx = self.feature_indices

        # Extract relevant features
        ret_5m = float(f[idx["ret_5m"]])
        ret_15m = float(f[idx["ret_15m"]])
        cleantrend_er = float(f[idx["cleantrend_er"]])
        rsi_5m = float(f[idx["rsi_14_5m"]])    # Centered: [-1.0, 1.0]
        rsi_15m = float(f[idx["rsi_14_15m"]])  # Centered: [-1.0, 1.0]
        squeeze_ratio = float(f[idx["squeeze_ratio"]])
        rvol_5m = float(f[idx["rvol_5m"]])
        cvd_slope = float(f[idx["cvd_slope_3m"]])
        obi = float(f[idx["obi_l1_l5"]])
        call_wall_dist = float(f[idx["call_wall_dist_pct"]])
        put_wall_dist = float(f[idx["put_wall_dist_pct"]])
        nifty_trend = float(f[idx["nifty_trend"]])

        # 1. Structural Anchor (15m Horizon)
        if ret_15m > 0.002 and rsi_15m > 0.10:
            structural_bias = "BULLISH"
        elif ret_15m < -0.002 and rsi_15m < -0.10:
            structural_bias = "BEARISH"
        else:
            structural_bias = "NEUTRAL"

        # 2. Tactical Momentum (5m Horizon)
        if ret_5m > 0.001 and rsi_5m > 0.05 and cleantrend_er >= 0.50:
            tactical_bias = "BULLISH"
        elif ret_5m < -0.001 and rsi_5m < -0.05 and cleantrend_er >= 0.50:
            tactical_bias = "BEARISH"
        else:
            tactical_bias = "NEUTRAL"

        # 3. Microstructure Order Flow (1m Horizon)
        if cvd_slope > 0.20 and obi > 0.10:
            micro_bias = "BULLISH"
        elif cvd_slope < -0.20 and obi < -0.10:
            micro_bias = "BEARISH"
        else:
            micro_bias = "NEUTRAL"

        # 4. GEX Boundary Proximity
        at_call_wall = abs(call_wall_dist) < 0.50
        at_put_wall = abs(put_wall_dist) < 0.50

        # ==========================================
        # Collision Resolution Matrix
        # ==========================================

        # Case A: Full Multi-Timeframe Concordance (Triple Alignment)
        if structural_bias == tactical_bias == micro_bias and structural_bias != "NEUTRAL":
            collision_state = "CONCORDANT_EXPANSION"
            directional_bias = structural_bias
            conviction_multiplier = 1.35
            is_noise = False
            dominant_tf = "15m+5m+1m"
            explanation = f"All 3 horizons in clean concordant {structural_bias} momentum with ER={cleantrend_er:.2f}."

        # Case B: Mean-Reversion at Structural GEX Wall
        elif (at_call_wall and rsi_5m > 0.40 and micro_bias == "BEARISH") or \
             (at_put_wall and rsi_5m < -0.40 and micro_bias == "BULLISH"):
            collision_state = "MEAN_REVERSION_AT_WALL"
            directional_bias = "BEARISH" if at_call_wall else "BULLISH"
            conviction_multiplier = 1.15
            is_noise = False
            dominant_tf = "15m_GEX_WALL"
            explanation = "Price reached structural wall with tactical momentum exhaustion and orderflow rejection."

        # Case C: Volatility Compression (Squeeze Pre-Expansion)
        elif squeeze_ratio < 0.70 and rvol_5m < 1.0:
            collision_state = "VOLATILITY_COMPRESSION"
            directional_bias = "NEUTRAL"
            conviction_multiplier = 0.50
            is_noise = False
            dominant_tf = "15m_SQUEEZE"
            explanation = f"Bollinger/Keltner squeeze ratio={squeeze_ratio:.2f} under 0.70 with volume dry-up. Breakout imminent."

        # Case D: Counter-Trend Pullback in Major Trend (Trap Defense)
        elif structural_bias != "NEUTRAL" and tactical_bias != structural_bias and cleantrend_er >= 0.55:
            collision_state = "COUNTER_TREND_PULLBACK"
            directional_bias = structural_bias  # Trust higher timeframe
            conviction_multiplier = 0.85
            is_noise = False
            dominant_tf = "15m_STRUCTURE"
            explanation = f"Tactical 5m counter-move against prevailing 15m {structural_bias} structure. Gated for pullback entry."

        # Case E: Low Efficiency Chop Collision (Noise Gate)
        elif cleantrend_er < 0.40 or (tactical_bias != "NEUTRAL" and micro_bias != "NEUTRAL" and tactical_bias != micro_bias):
            collision_state = "CHOP_COLLISION"
            directional_bias = "NEUTRAL"
            conviction_multiplier = 0.00
            is_noise = True
            dominant_tf = "NONE"
            explanation = f"Low fractal efficiency (ER={cleantrend_er:.2f}) or 5m vs 1m directional collision. Execution locked by Noise Gate."

        # Default Case: Ambiguous / Standard Drift
        else:
            collision_state = "REGIME_DRIFT"
            directional_bias = structural_bias if structural_bias != "NEUTRAL" else tactical_bias
            conviction_multiplier = 0.75
            is_noise = False
            dominant_tf = "5m"
            explanation = "Moderate momentum without complete multi-timeframe consensus."

        return {
            "symbol": symbol.upper(),
            "collision_state": collision_state,
            "directional_bias": directional_bias,
            "conviction_multiplier": round(float(conviction_multiplier), 3),
            "is_noise": is_noise,
            "dominant_timeframe": dominant_tf,
            "structural_15m": structural_bias,
            "tactical_5m": tactical_bias,
            "micro_1m": micro_bias,
            "cleantrend_er": round(cleantrend_er, 3),
            "explanation": explanation,
        }


# Global singleton instance
mtf_collision_engine = MTFCollisionEngine()
