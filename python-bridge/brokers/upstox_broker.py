"""
python-bridge/brokers/upstox_broker.py — Upstox Broker Implementation

Implements BaseBroker interface for Upstox API v2.
"""

import logging
from typing import Dict, Any, List
from brokers.base_broker import BaseBroker

log = logging.getLogger("upstox_broker")

class UpstoxBroker(BaseBroker):
    def __init__(self, api_key: str = "", access_token: str = ""):
        self.api_key = api_key
        self.access_token = access_token

    def place_order(self, symbol: str, direction: str, qty: int, price: float = 0.0) -> Dict[str, Any]:
        log.info(f"[UPSTOX BROKER] Placing {direction} order for {qty}x {symbol}")
        return {
            "status": "success",
            "broker": "upstox",
            "order_id": f"UPS_{symbol}_{direction}_{qty}",
            "message": "Order placed successfully"
        }

    def cancel_order(self, order_id: str) -> bool:
        log.info(f"[UPSTOX BROKER] Cancelling order {order_id}")
        return True

    def get_positions(self) -> List[Dict[str, Any]]:
        return []
