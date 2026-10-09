from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

@dataclass
class Signal:
    direction: str          # "BUY" or "SELL"
    instrument: str         # e.g., "13" (Dhan security id) or symbol name
    quantity: int
    price: float            # Limit price (use 0 for market)
    stop_loss: float
    target: float
    strategy_name: str
    confidence: float       # 0.0 to 1.0
    symbol: Optional[str] = None
    exchange: str = "NSE"

class BaseStrategy(ABC):
    def __init__(self, name: str, config: dict):
        self.name = name
        self.config = config
        self.is_active = True
    
    @abstractmethod
    def on_candle(self, candle: dict) -> Optional[Signal]:
        """Called every time a new candle closes. Return Signal or None."""
        pass
    
    @abstractmethod
    def on_tick(self, tick: dict) -> Optional[Signal]:
        """Called on every live tick. Used for stop-loss monitoring."""
        pass
