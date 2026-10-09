from strategies.base_strategy import BaseStrategy, Signal
from typing import Optional
import datetime

class ORBBreakout(BaseStrategy):
    def __init__(self, config):
        super().__init__("ORB_Breakout_v1", config)
        self.target_multiplier = self.config.get("target_multiplier", 1.5)
        self.stop_multiplier = self.config.get("stop_multiplier", 1.0)
        self.orb_high = None
        self.orb_low = None
        self.orb_captured = False
        self.position_open = False
    
    def on_candle(self, candle: dict) -> Optional[Signal]:
        # Support passing a simulated time in the candle for testing/backtesting
        if "time" in candle:
            if isinstance(candle["time"], str):
                now = datetime.datetime.strptime(candle["time"], "%H:%M:%S").time()
            else:
                now = candle["time"]
        else:
            now = datetime.datetime.now().time()
            
        market_open = datetime.time(9, 15)
        orb_end = datetime.time(9, 30)
        
        # Build the opening range during 9:15-9:30
        if market_open <= now <= orb_end:
            if self.orb_high is None:
                self.orb_high = candle["high"]
                self.orb_low = candle["low"]
            else:
                self.orb_high = max(self.orb_high, candle["high"])
                self.orb_low = min(self.orb_low, candle["low"])
            return None
        
        # After 9:30 — look for breakouts
        if now > orb_end and self.orb_high is not None and not self.position_open:
            rng = self.orb_high - self.orb_low
            
            if candle["close"] > self.orb_high:
                self.position_open = True
                return Signal(
                    direction="BUY",
                    instrument=self.config["instrument"],
                    quantity=self.config["quantity"],
                    price=0.0,                      # Market order
                    stop_loss=self.orb_high - (self.stop_multiplier * rng),
                    target=self.orb_high + (self.target_multiplier * rng),
                    strategy_name=self.name,
                    confidence=0.75
                )
        return None
    
    def on_tick(self, tick: dict) -> Optional[Signal]:
        return None  # SL managed by broker GTT orders
