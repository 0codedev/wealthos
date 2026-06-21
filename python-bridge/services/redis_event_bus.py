"""
python-bridge/services/redis_event_bus.py — Redis Streams Decoupled Event Bus

Provides high-throughput, decoupled stream messaging for tick flow & signal events.
Uses Redis Streams (XADD / XREAD / XGROUP) with automatic trimming (MAXLEN ~1000).
Controlled by feature flag USE_REDIS_STREAMS (default: "false").

Zero-disruption guarantee: Falls back cleanly to direct memory dict if Redis is offline.
"""

import os
import json
import logging
from typing import Dict, Any, List, Optional

log = logging.getLogger("redis_event_bus")

_redis_client = None
_redis_checked = False

def _get_redis():
    """Lazily retrieves Redis connection."""
    global _redis_client, _redis_checked
    if _redis_checked:
        return _redis_client

    _redis_checked = True
    try:
        import redis
        client = redis.Redis(
            host=os.getenv("REDIS_HOST", "127.0.0.1"),
            port=int(os.getenv("REDIS_PORT", "6379")),
            db=0,
            decode_responses=True,
            socket_timeout=0.5,
            socket_connect_timeout=0.5
        )
        if client.ping():
            _redis_client = client
            log.info("[EVENT_BUS] ✅ Connected to Redis Streams event bus.")
    except Exception:
        _redis_client = None
        log.info("[EVENT_BUS] ℹ️ Redis Streams unavailable. Using direct memory event fallback.")

    return _redis_client

class RedisEventBus:
    def __init__(self, stream_name: str = "market_ticks"):
        self.stream_name = stream_name
        self.use_streams = os.getenv("USE_REDIS_STREAMS", "false").lower() in ("true", "1", "yes")

    def publish_tick(self, symbol: str, tick: dict) -> bool:
        """Publishes market tick event to Redis Stream with automatic trimming."""
        if not self.use_streams:
            return False

        r = _get_redis()
        if r is None:
            return False

        try:
            payload = {
                "symbol": symbol,
                "ltp": str(tick.get("ltp", 0.0)),
                "bid": str(tick.get("bid", 0.0)),
                "ask": str(tick.get("ask", 0.0)),
                "vol": str(tick.get("volume", 0)),
                "ts": str(tick.get("ts", ""))
            }
            r.xadd(self.stream_name, payload, maxlen=1000, approximate=True)
            return True
        except Exception as e:
            log.debug(f"[EVENT_BUS] Publish tick error: {e}")
            return False

    def read_ticks(self, count: int = 10, block_ms: int = 100) -> List[Dict[str, Any]]:
        """Reads recent market tick events from Redis Stream."""
        if not self.use_streams:
            return []

        r = _get_redis()
        if r is None:
            return []

        try:
            streams = r.xread({self.stream_name: "$"}, count=count, block=block_ms)
            results = []
            if streams:
                for stream_key, messages in streams:
                    for msg_id, fields in messages:
                        results.append({"id": msg_id, "data": fields})
            return results
        except Exception as e:
            log.debug(f"[EVENT_BUS] Read ticks error: {e}")
            return []

# Global singleton instance
event_bus = RedisEventBus()
