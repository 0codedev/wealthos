"""
python-bridge/brokers/base_broker.py — Unified Multi-Broker Abstraction Interface

Defines standard interface for broker order placement, cancellation, and position checks.
Supports Upstox, Dhan, and Zerodha backends seamlessly.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List

class BaseBroker(ABC):
    @abstractmethod
    def place_order(self, symbol: str, direction: str, qty: int, price: float = 0.0) -> Dict[str, Any]:
        """Places order with broker API."""
        pass

    @abstractmethod
    def cancel_order(self, order_id: str) -> bool:
        """Cancels open order."""
        pass

    @abstractmethod
    def get_positions(self) -> List[Dict[str, Any]]:
        """Returns list of open positions."""
        pass
