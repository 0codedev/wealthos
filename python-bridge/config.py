"""
python-bridge/config.py — Typed Configuration & Environment Validation Schema

Provides centralized, typed, and validated access to all platform environment variables.
Enforces range bounds and types on risk limits while maintaining 100% backward compatibility
and fallback defaults for missing env vars (zero-disruption guarantee).
"""

import os
import logging
from typing import Dict, Any

log = logging.getLogger("config")

class AppConfig:
    def __init__(self):
        self.reload()

    def reload(self):
        """Loads and validates environment variables."""
        # Risk & Trading Limits
        self.MAX_DAILY_LOSS_INR = self._get_float("MAX_DAILY_LOSS_INR", 10000.0, min_val=500.0, max_val=500000.0)
        self.MAX_ORDER_QUANTITY = self._get_int("MAX_ORDER_QUANTITY", 50, min_val=1, max_val=500)
        self.MAX_ORDER_NOTIONAL = self._get_float("MAX_ORDER_NOTIONAL", 500000.0, min_val=1000.0, max_val=10000000.0)
        self.MAX_TRADE_LOSS = self._get_float("MAX_TRADE_LOSS", 2000.0, min_val=100.0, max_val=50000.0)

        # Broker Configs
        self.UPSTOX_API_KEY = os.getenv("UPSTOX_API_KEY", "")
        self.UPSTOX_REDIRECT_URI = os.getenv("UPSTOX_REDIRECT_URI", "http://127.0.0.1:8765/api/upstox/callback")
        self.DHAN_CLIENT_ID = os.getenv("DHAN_CLIENT_ID", "")
        self.DHAN_ACCESS_TOKEN = os.getenv("DHAN_ACCESS_TOKEN", "")

        # Infrastructure & Network
        self.REDIS_HOST = os.getenv("REDIS_HOST", "127.0.0.1")
        self.REDIS_PORT = self._get_int("REDIS_PORT", 6379, min_val=1, max_val=65535)
        self.BRIDGE_API_SECRET = os.getenv("BRIDGE_API_SECRET", "")
        self.ALLOWED_IP_CIDR = os.getenv("ALLOWED_IP_CIDR", "")

        # Feature Flags (default false for safe non-disruptive execution)
        self.USE_ML_GATE = self._get_bool("USE_ML_GATE", False)
        self.ML_CONFIDENCE_THRESHOLD = self._get_float("ML_CONFIDENCE_THRESHOLD", 0.65, min_val=0.1, max_val=1.0)
        self.USE_KELLY_SIZING = self._get_bool("USE_KELLY_SIZING", False)
        self.REQUIRE_LIQUIDITY_CHECK = self._get_bool("REQUIRE_LIQUIDITY_CHECK", False)
        self.USE_REDIS_STREAMS = self._get_bool("USE_REDIS_STREAMS", False)
        self.ENABLE_PG_DUALWRITE = self._get_bool("ENABLE_PG_DUALWRITE", False)

    def _get_float(self, key: str, default: float, min_val: float = 0.0, max_val: float = 1e9) -> float:
        val_str = os.getenv(key)
        if not val_str:
            return default
        try:
            val = float(val_str)
            if min_val <= val <= max_val:
                return val
            log.warning(f"[CONFIG] Value for {key} ({val}) out of bounds [{min_val}, {max_val}]. Using default {default}.")
            return default
        except ValueError:
            log.warning(f"[CONFIG] Invalid float for {key}: '{val_str}'. Using default {default}.")
            return default

    def _get_int(self, key: str, default: int, min_val: int = 0, max_val: int = 1000000) -> int:
        val_str = os.getenv(key)
        if not val_str:
            return default
        try:
            val = int(val_str)
            if min_val <= val <= max_val:
                return val
            log.warning(f"[CONFIG] Value for {key} ({val}) out of bounds [{min_val}, {max_val}]. Using default {default}.")
            return default
        except ValueError:
            log.warning(f"[CONFIG] Invalid int for {key}: '{val_str}'. Using default {default}.")
            return default

    def _get_bool(self, key: str, default: bool) -> bool:
        val_str = os.getenv(key)
        if not val_str:
            return default
        return val_str.lower() in ("true", "1", "yes")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "max_daily_loss_inr": self.MAX_DAILY_LOSS_INR,
            "max_order_quantity": self.MAX_ORDER_QUANTITY,
            "max_order_notional": self.MAX_ORDER_NOTIONAL,
            "max_trade_loss": self.MAX_TRADE_LOSS,
            "redis_host": self.REDIS_HOST,
            "redis_port": self.REDIS_PORT,
            "feature_flags": {
                "use_ml_gate": self.USE_ML_GATE,
                "ml_confidence_threshold": self.ML_CONFIDENCE_THRESHOLD,
                "use_kelly_sizing": self.USE_KELLY_SIZING,
                "require_liquidity_check": self.REQUIRE_LIQUIDITY_CHECK,
                "use_redis_streams": self.USE_REDIS_STREAMS,
                "enable_pg_dualwrite": self.ENABLE_PG_DUALWRITE,
            }
        }

# Global singleton instance
config = AppConfig()
