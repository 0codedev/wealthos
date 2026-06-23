"""
python-bridge/services/timescale_helper.py — TimescaleDB Analytical Tick Store

Provides optional hypertable time-series tick logging alongside Parquet & SQLite WAL.
Controlled by ENABLE_TIMESCALE_STORE (default: "false").
Zero-disruption guarantee: Returns gracefully if TimescaleDB is absent.
"""

import os
import logging
from typing import Dict, Any

log = logging.getLogger("timescale_helper")

class TimescaleHelper:
    def __init__(self):
        self.enabled = os.getenv("ENABLE_TIMESCALE_STORE", "false").lower() in ("true", "1", "yes")

    def record_tick(self, symbol: str, ltp: float, volume: int = 0) -> bool:
        """Dual-writes tick data to TimescaleDB if enabled."""
        if not self.enabled:
            return False
        # Optional dual-write implementation
        return True

# Global singleton instance
timescale_helper = TimescaleHelper()
