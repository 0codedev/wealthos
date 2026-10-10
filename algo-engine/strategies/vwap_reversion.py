from strategies.base_strategy import BaseStrategy, Signal
from typing import Optional
import datetime
import math

class VWAPReversion(BaseStrategy):
    def __init__(self, config):
        super().__init__("VWAP_Reversion_v1", config)
        self.std_dev_multiplier = self.config.get("std_dev_multiplier", 1.5)
        self.stop_multiplier = self.config.get("stop_multiplier", 2.5)  # SL at 2.5 std dev
        
        # Session state
        self.last_date = None
        self.prices = []
        self.cumulative_pv = 0.0
        self.cumulative_vol = 0.0
        self.position_open = False
        
    def _reset_session(self, current_date):
        self.last_date = current_date
        self.prices = []
        self.cumulative_pv = 0.0
        self.cumulative_vol = 0.0
        self.position_open = False
        print(f"[{self.name}] Session reset for date: {current_date}")

    def calculate_rsi(self, prices, period=14):
        if len(prices) < period + 1:
            return 50.0
        gains = []
        losses = []
        for i in range(1, len(prices)):
            diff = prices[i] - prices[i-1]
            if diff > 0:
                gains.append(diff)
                losses.append(0.0)
            else:
                gains.append(0.0)
                losses.append(abs(diff))
        avg_gain = sum(gains[:period]) / period
        avg_loss = sum(losses[:period]) / period
        for i in range(period, len(gains)):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100.0 - (100.0 / (1 + rs))

    def calculate_std_dev(self, data):
        if len(data) < 2:
            return 0.0
        mean = sum(data) / len(data)
        variance = sum((x - mean) ** 2 for x in data) / len(data)
        return math.sqrt(variance)

    def on_candle(self, candle: dict) -> Optional[Signal]:
        # Handle date parsing/detection
        candle_date = candle.get("date")
        if not candle_date and "time" in candle:
            # If date is not provided, we default to today's date
            candle_date = datetime.date.today()
            
        if self.last_date is None or (candle_date and candle_date != self.last_date):
            self._reset_session(candle_date)
            
        # Parse time
        if "time" in candle:
            if isinstance(candle["time"], str):
                now = datetime.datetime.strptime(candle["time"], "%H:%M:%S").time()
            else:
                now = candle["time"]
        else:
            now = datetime.datetime.now().time()
            
        market_open = datetime.time(9, 15)
        market_close = datetime.time(15, 10)
        
        # Don't place new trades before market open or after time-stop
        if now < market_open or now >= market_close:
            return None
            
        close_price = candle["close"]
        open_price = candle.get("open", close_price)
        volume = candle.get("volume", 1.0)
        if volume <= 0:
            volume = 1.0  # fallback
            
        self.prices.append(close_price)
        self.cumulative_pv += close_price * volume
        self.cumulative_vol += volume
        
        # Calculate Indicators
        vwap = self.cumulative_pv / self.cumulative_vol
        std_dev = self.calculate_std_dev(self.prices)
        rsi = self.calculate_rsi(self.prices)
        
        # Calculate Bands
        upper_band = vwap + (self.std_dev_multiplier * std_dev)
        lower_band = vwap - (self.std_dev_multiplier * std_dev)
        
        
        # We need at least 5 candles to get a sensible standard deviation and moving mean
        if len(self.prices) < 5:
            return None
            
        # Use a minimum standard deviation of 0.15% of close price to prevent extremely tight stops
        min_std_dev = 0.0015 * close_price
        effective_std_dev = max(std_dev, min_std_dev)
        sl_dist = self.stop_multiplier * effective_std_dev
            
        if not self.position_open:
            # Check Long Reversion: Close is below Lower Band, rejects upward, and RSI is oversold
            if close_price < lower_band and close_price > open_price and rsi < 35:
                self.position_open = True
                sl_price = close_price - sl_dist
                target_price = vwap if vwap > close_price else close_price + (self.std_dev_multiplier * effective_std_dev)
                return Signal(
                    direction="BUY",
                    instrument=self.config["instrument"],
                    quantity=self.config["quantity"],
                    price=0.0,  # Market order
                    stop_loss=sl_price,
                    target=target_price,
                    strategy_name=self.name,
                    confidence=0.70
                )
                
            # Check Short Reversion: Close is above Upper Band, rejects downward, and RSI is overbought
            if close_price > upper_band and close_price < open_price and rsi > 65:
                self.position_open = True
                sl_price = close_price + sl_dist
                target_price = vwap if vwap < close_price else close_price - (self.std_dev_multiplier * effective_std_dev)
                return Signal(
                    direction="SELL",
                    instrument=self.config["instrument"],
                    quantity=self.config["quantity"],
                    price=0.0,  # Market order
                    stop_loss=sl_price,
                    target=target_price,
                    strategy_name=self.name,
                    confidence=0.70
                )
                
        return None

    def on_tick(self, tick: dict) -> Optional[Signal]:
        return None
