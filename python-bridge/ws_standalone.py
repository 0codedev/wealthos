"""
WealthOS Standalone WebSocket Process (Task 3B)
Runs as an independent PM2 process, receives Upstox market ticks, and publishes them to Redis channel 'upstox_ticks'.
Allows zero-downtime decoupling of WebSocket data feed from the main FastAPI server.
"""

import sys
import os
import time
import json
import asyncio
import logging

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from logger import get_logger
log = get_logger("ws_standalone", tag="WS_STANDALONE")

from upstox_ws import UpstoxWebSocketClient

def main():
    log.info("Starting WealthOS Standalone WebSocket Process (Task 3B)...")
    ws_client = UpstoxWebSocketClient()
    ws_client.start()
    
    redis_client = None
    try:
        import redis
        redis_client = redis.Redis(
            host=os.getenv("REDIS_HOST", "127.0.0.1"),
            port=int(os.getenv("REDIS_PORT", "6379")),
            db=0,
            decode_responses=True
        )
        if redis_client.ping():
            log.info("Connected to Redis Pub/Sub channel 'upstox_ticks'.")
    except Exception as e:
        log.warning(f"Redis unavailable for standalone WS process: {e}")

    try:
        while True:
            time.sleep(1.0)
            if redis_client and ws_client.latest_ticks:
                with ws_client._ticks_lock:
                    ticks_snapshot = dict(ws_client.latest_ticks)
                for key, tick in ticks_snapshot.items():
                    try:
                        redis_client.publish("upstox_ticks", json.dumps(tick))
                    except Exception:
                        pass
    except KeyboardInterrupt:
        log.info("Standalone WebSocket process terminating...")

if __name__ == "__main__":
    main()
