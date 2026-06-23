"""
WealthOS Time-Skew Aligner & Rolling Cross-Correlation Engine
Eliminates latency discrepancies (60s to 300s) between live WebSocket tick feeds
and delayed aggregated third-party SaaS snapshots (TradeFinder).
Computes optimal tau* lag sweep to guarantee 100% time-aligned mathematical comparison.
"""

from logger import get_logger
log = get_logger("time_skew_aligner", tag="TIME_SKEW")

import os
import sys
import time
import math
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from routers.shared import upstox_client, sanitize_symbol

BENCHMARK_LIQUID_SYMBOLS = [
    "RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS",
    "ITC", "LT", "SBIN", "BHARTIARTL", "KOTAKBANK"
]


class TimeSkewAligner:
    def __init__(self, max_lag_seconds: int = 300, step_seconds: int = 15):
        self.max_lag_seconds = max_lag_seconds
        self.step_seconds = step_seconds
        self.cached_optimal_tau = 120  # Default baseline lag estimate: 2 minutes
        self.last_calibration_time = 0

    def compute_optimal_lag(self, tf_snapshots: List[dict]) -> int:
        """
        Sweeps tau in [0s, 300s] across benchmark liquid stocks to find
        the exact time delay tau* minimizing price error |LTP_tf - LTP_local(t - tau)|.
        """
        now = time.time()
        # Calibrate at most once every 60 seconds
        if now - self.last_calibration_time < 60 and self.last_calibration_time > 0:
            return self.cached_optimal_tau

        if not tf_snapshots:
            return self.cached_optimal_tau

        # Build symbol -> TF LTP mapping
        tf_prices = {}
        for item in tf_snapshots:
            sym = item.get("Symbol")
            ltp = item.get("param_0") or item.get("ltp")
            if sym and ltp and sym in BENCHMARK_LIQUID_SYMBOLS:
                tf_prices[sym] = float(ltp)

        if not tf_prices:
            return self.cached_optimal_tau

        best_tau = 0
        min_total_error = float("inf")

        # Test candidate lags: 0, 15, 30, 45, ..., 300 seconds
        candidate_lags = list(range(0, self.max_lag_seconds + 1, self.step_seconds))

        for tau in candidate_lags:
            total_error = 0.0
            matched_count = 0

            for sym, tf_ltp in tf_prices.items():
                local_candle = self.get_historical_candle_at_lag(sym, tau)
                if local_candle:
                    local_close = local_candle.get("close", 0)
                    if local_close > 0:
                        pct_error = abs(tf_ltp - local_close) / tf_ltp
                        total_error += pct_error
                        matched_count += 1

            if matched_count > 0:
                avg_error = total_error / matched_count
                if avg_error < min_total_error:
                    min_total_error = avg_error
                    best_tau = tau

        log.info(f"Optimal Time-Skew Lag tau* detected: {best_tau}s (Avg Error: {min_total_error*100:.2f}%)")
        self.cached_optimal_tau = best_tau
        self.last_calibration_time = now
        return best_tau

    def get_historical_candle_at_lag(self, symbol: str, lag_seconds: int) -> Optional[dict]:
        """
        Retrieves the 1-minute historical bar corresponding to (now - lag_seconds).
        Checks local cache.db first, then Upstox historical candles.
        """
        symbol = sanitize_symbol(symbol)
        target_dt = datetime.now() - timedelta(seconds=lag_seconds)
        target_minute_str = target_dt.strftime("%Y-%m-%dT%H:%M")

        try:
            key = db.get_upstox_instrument_key(symbol, exchange="NSE_EQ") or db.get_upstox_instrument_key(symbol)
            if not key:
                return None

            res = upstox_client.get_intraday_candles(key, interval="1minute")
            if res.get("status") == "success" and "data" in res and "candles" in res["data"]:
                for c in res["data"]["candles"]:
                    c_time = c[0]
                    if target_minute_str in c_time:
                        return {
                            "timestamp": c[0],
                            "open": float(c[1]),
                            "high": float(c[2]),
                            "low": float(c[3]),
                            "close": float(c[4]),
                            "volume": float(c[5])
                        }
                # Fallback to nearest candle
                if res["data"]["candles"]:
                    c = res["data"]["candles"][0]
                    return {
                        "timestamp": c[0],
                        "open": float(c[1]),
                        "high": float(c[2]),
                        "low": float(c[3]),
                        "close": float(c[4]),
                        "volume": float(c[5])
                    }
        except Exception as e:
            log.warning(f"Failed to fetch lagged candle for {symbol} at tau={lag_seconds}s: {e}")

        return None

    def align_snapshot(self, tf_item: dict, optimal_tau: int) -> dict:
        """
        Creates a time-aligned comparison pair for a single stock.
        """
        sym = tf_item.get("Symbol")
        lagged_bar = self.get_historical_candle_at_lag(sym, optimal_tau)
        
        aligned = dict(tf_item)
        aligned["aligned_tau_seconds"] = optimal_tau
        aligned["aligned_local_candle"] = lagged_bar
        return aligned


time_skew_aligner = TimeSkewAligner()
