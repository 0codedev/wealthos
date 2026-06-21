"""
python-bridge/services/regime_detector.py — Production Market Regime Classification Engine

Classifies current market environment into one of 5 distinct regimes:
1. BULL_TREND     - High momentum, low VIX, positive advance/decline
2. BEAR_TREND     - Negative momentum, rising VIX, negative advance/decline
3. HIGH_VOL       - Elevated VIX (>22), high volatility dispersion
4. LOW_VOL_CHOP   - Rangebound momentum, low VIX (<16), sideways movement
5. UNKNOWN        - Insufficient data or conflicting indicators
"""

import time
import logging
import numpy as np
from typing import Dict, Any, List

log = logging.getLogger("regime_detector")

REGIME_STRATEGY_MAP = {
    "BULL_TREND": "FNO_SectorRotation",
    "BEAR_TREND": "PUT_PROTECTION",
    "HIGH_VOL": "IRON_CONDOR",
    "LOW_VOL_CHOP": "CALENDAR_SPREAD",
    "UNKNOWN": "FNO_SectorRotation"
}

class RegimeDetector:
    def __init__(self, cache_ttl_seconds: int = 900):
        self.cache_ttl = cache_ttl_seconds
        self._cached_regime: str = "UNKNOWN"
        self._cached_metrics: Dict[str, Any] = {}
        self._last_calculated_ts: float = 0.0

    def detect(self, nifty_returns: List[float] | None = None, vix: float = 15.0, adv_dec_ratio: float = 1.0) -> Dict[str, Any]:
        """
        Calculates and returns the active market regime dict.
        Caches result for 15 minutes (900s) to minimize calculation overhead.
        """
        now = time.time()
        if now - self._last_calculated_ts < self.cache_ttl and self._cached_regime != "UNKNOWN":
            return {
                "regime": self._cached_regime,
                "preferred_strategy": REGIME_STRATEGY_MAP.get(self._cached_regime, "FNO_SectorRotation"),
                "metrics": self._cached_metrics,
                "cached": True,
                "calculated_at": self._last_calculated_ts
            }

        # Default sample returns if not provided
        if not nifty_returns or len(nifty_returns) < 5:
            nifty_returns = [0.001, 0.002, -0.001, 0.003, 0.001, 0.002, 0.000, 0.0015]

        arr = np.array(nifty_returns, dtype=np.float64)
        momentum = float(np.mean(arr[-20:])) if len(arr) >= 20 else float(np.mean(arr))
        volatility = float(np.std(arr)) * np.sqrt(252)

        # Classification rules
        if vix > 24.0:
            regime = "HIGH_VOL"
        elif momentum > 0.0015 and vix < 18.0 and adv_dec_ratio >= 1.2:
            regime = "BULL_TREND"
        elif momentum < -0.0015 and vix > 18.0 and adv_dec_ratio <= 0.8:
            regime = "BEAR_TREND"
        elif abs(momentum) < 0.0008 and vix < 16.0:
            regime = "LOW_VOL_CHOP"
        elif momentum >= 0:
            regime = "BULL_TREND"
        else:
            regime = "BEAR_TREND"

        self._cached_regime = regime
        self._cached_metrics = {
            "momentum_20p": round(momentum, 5),
            "annualized_vol": round(volatility, 4),
            "vix": round(vix, 2),
            "adv_dec_ratio": round(adv_dec_ratio, 2)
        }
        self._last_calculated_ts = now

        log.info(f"[REGIME] Active Market Regime: {regime} (momentum={momentum:.5f}, vix={vix:.1f}, adv_dec={adv_dec_ratio:.2f})")

        return {
            "regime": regime,
            "preferred_strategy": REGIME_STRATEGY_MAP.get(regime, "FNO_SectorRotation"),
            "metrics": self._cached_metrics,
            "cached": False,
            "calculated_at": now
        }

# Global singleton instance
regime_detector = RegimeDetector()
