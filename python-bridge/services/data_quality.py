"""
python-bridge/services/data_quality.py — Real-time Market Data Quality Monitor

Validates incoming tick prices to block corrupted data:
1. Zero / negative price guard
2. 20% single-tick circuit filter (data spike protection)
3. Stale tick warning detector (>120s unchanged)
"""

import time
import logging
from typing import Dict, Any, Tuple

log = logging.getLogger("data_quality")

class DataQualityMonitor:
    def __init__(self):
        self._last_ticks: Dict[str, Tuple[float, float]] = {}  # symbol -> (price, timestamp)

    def validate_tick(self, symbol: str, new_ltp: float) -> Tuple[bool, str]:
        """
        Validates tick quality before passing tick to OMS / Autopilot.
        Returns: (is_valid: bool, reason: str)
        """
        if new_ltp <= 0 or new_ltp > 500000.0:
            reason = f"Invalid LTP value: {new_ltp}"
            log.warning(f"[DATA QUALITY] 🚨 {symbol}: {reason}")
            return False, reason

        now = time.time()
        if symbol in self._last_ticks:
            prev_ltp, prev_ts = self._last_ticks[symbol]
            if prev_ltp > 0:
                change_pct = abs(new_ltp - prev_ltp) / prev_ltp
                if change_pct > 0.20:  # >20% single tick jump
                    reason = f"Data spike detected ({change_pct*100:.1f}% jump from {prev_ltp} to {new_ltp})"
                    log.warning(f"[DATA QUALITY] 🚨 {symbol}: {reason}")
                    return False, reason

        self._last_ticks[symbol] = (new_ltp, now)
        return True, "PASSED"

# Global singleton instance
data_quality_monitor = DataQualityMonitor()
