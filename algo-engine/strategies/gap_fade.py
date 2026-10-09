"""Gap Fade & Continuation Filter intraday strategy.

This module implements the S6: Gap Fade & Continuation Filter strategy.
"""

from strategies.base_strategy import BaseStrategy, Signal
from typing import Optional, Tuple
import datetime
import json
import os
import collections

class Position:
    def __init__(self, direction: str, entry_price: float, stop_loss: float, target: float):
        self.direction = direction
        self.entry_price = entry_price
        self.stop_loss = stop_loss
        self.target = target
        self.is_open = True

class PerDayState:
    def __init__(self):
        self.last_time = None
        self.last_date = None
        self.yesterday_close = None
        self.today_open = None
        self.gap_pct = None
        self.gap_size = None
        self.regime = None  # "FADE", "CONTINUATION", "NO_TRADE"
        self.first_candle_direction = None  # "BULLISH", "BEARISH", "NEUTRAL"
        self.cumulative_pv = 0.0
        self.cumulative_vol = 0.0
        self.vwap = 0.0
        self.prices_5m = []
        self.vol_5m = collections.deque(maxlen=20)
        self.tr_window = collections.deque(maxlen=14)
        self.prev_close = None
        self.position = None
        self.trades_today = 0
        self.disabled_today = False

class GapFade(BaseStrategy):
    def __init__(self, config: dict):
        super().__init__("Gap_Fade_v1", config)
        self.state = PerDayState()
        
        # Load event calendar
        self.no_trade_dates = set()
        self._load_event_calendar()

    def _load_event_calendar(self):
        # Locate config relative to project root or workspace
        # Standard location: config/event_calendar.json
        possible_paths = [
            os.path.join(os.path.dirname(os.path.dirname(__file__)), "config", "event_calendar.json"),
            "config/event_calendar.json",
            "algo-engine/config/event_calendar.json"
        ]
        for path in possible_paths:
            if os.path.exists(path):
                try:
                    with open(path, "r") as f:
                        data = json.load(f)
                        dates = data.get("no_trade_dates", [])
                        self.no_trade_dates = set(dates)
                        print(f"[{self.name}] Loaded {len(self.no_trade_dates)} no-trade dates from {path}")
                    break
                except Exception as e:
                    print(f"[{self.name}] Failed to load event calendar from {path}: {e}")

    def update_prev_close(self, prev_close: float) -> None:
        """Update the previous day's close price."""
        self.state.yesterday_close = float(prev_close)

    def _log(self, msg: str) -> None:
        print(f"[{self.name}] {msg}")

    def _reset_day_state(self, new_date) -> None:
        # Preserve yesterday_close across session resets
        yesterday_close = self.state.yesterday_close
        pos = self.state.position
        vol_5m = self.state.vol_5m
        tr_window = self.state.tr_window
        prev_close = self.state.prev_close
        
        self.state = PerDayState()
        self.state.last_date = new_date
        self.state.yesterday_close = yesterday_close
        self.state.position = pos
        self.state.vol_5m = vol_5m
        self.state.tr_window = tr_window
        self.state.prev_close = prev_close if prev_close is not None else yesterday_close
        
        # Check if new date is a no-trade date
        date_str = str(new_date)
        if date_str in self.no_trade_dates:
            self.state.disabled_today = True
            self.state.regime = "NO_TRADE"
            self._log(f"Date {date_str} is in event calendar. Trading is disabled today.")

    def _normalize_time(self, val) -> datetime.time:
        if isinstance(val, datetime.time):
            return val
        if isinstance(val, datetime.datetime):
            return val.time()
        if isinstance(val, str):
            # Try parsing HH:MM:SS or HH:MM
            for fmt in ("%H:%M:%S", "%H:%M"):
                try:
                    return datetime.datetime.strptime(val, fmt).time()
                except ValueError:
                    continue
        raise TypeError(f"Unsupported time type: {type(val)}")

    def _normalize_date(self, val) -> datetime.date:
        if isinstance(val, datetime.date):
            return val
        if isinstance(val, datetime.datetime):
            return val.date()
        if isinstance(val, str):
            try:
                return datetime.datetime.strptime(val, "%Y-%m-%d").date()
            except ValueError:
                pass
        return datetime.date.today()

    def on_candle(self, candle: dict) -> Optional[Signal]:
        # 1. Parse date and check reset
        candle_date = self._normalize_date(candle.get("date") or candle.get("time"))
        if self.state.last_date is None or candle_date != self.state.last_date:
            self._reset_day_state(candle_date)

        # 2. Parse time and validate
        t = self._normalize_time(candle["time"])
        self.state.last_time = t

        # 3. Retrieve candle values
        close = float(candle["close"])
        open_price = float(candle.get("open") or close)
        high = float(candle.get("high") or close)
        low = float(candle.get("low") or close)
        volume = float(candle.get("volume") or 1.0)
        
        # 4. Check time exit: square off at 3:15 PM IST (15:15)
        time_exit = self.config.get("square_off", datetime.time(15, 15))
        if isinstance(time_exit, str):
            time_exit = datetime.datetime.strptime(time_exit, "%H:%M:%S").time()
        if t >= time_exit:
            if self.state.position is not None and self.state.position.is_open:
                pos = self.state.position
                pos.is_open = False
                self.state.position = None
                self._log(f"Time stop reached at {t}. Squaring off position at {close}.")
                # Return square off signal
                return Signal(
                    direction="SELL" if pos.direction == "BUY" else "BUY",
                    instrument=self.config["instrument"],
                    quantity=self.config["quantity"],
                    price=0.0,
                    stop_loss=0.0,
                    target=0.0,
                    strategy_name=self.name,
                    confidence=0.5
                )
            return None

        # 5. Process first candle of the day
        if self.state.today_open is None:
            self.state.today_open = open_price
            if self.state.yesterday_close is not None:
                gap = self.state.today_open - self.state.yesterday_close
                self.state.gap_size = abs(gap)
                self.state.gap_pct = (gap / self.state.yesterday_close) * 100.0
                
                # Classify regime
                abs_gap = abs(self.state.gap_pct)
                if self.state.disabled_today:
                    self.state.regime = "NO_TRADE"
                elif 0.6 <= abs_gap <= 1.5:
                    self.state.regime = "FADE"
                elif abs_gap > 2.0:
                    self.state.regime = "CONTINUATION"
                else:
                    self.state.regime = "NO_TRADE"
                
                self._log(f"Open: {self.state.today_open:.2f}, Prev Close: {self.state.yesterday_close:.2f}, Gap: {self.state.gap_pct:.2f}%, Regime: {self.state.regime}")
            else:
                self.state.regime = "NO_TRADE"
                self._log("Yesterday close not set. Forcing NO_TRADE regime.")

        # 6. Track first candle direction (closes at 09:20:00)
        # Assuming 5-minute candles:
        # Candle 1: 09:15 to 09:20
        # Candle 2: 09:20 to 09:25
        # Candle 3: 09:25 to 09:30
        if t == datetime.time(9, 20):
            if close > open_price:
                self.state.first_candle_direction = "BULLISH"
            elif close < open_price:
                self.state.first_candle_direction = "BEARISH"
            else:
                self.state.first_candle_direction = "NEUTRAL"
            self._log(f"First candle direction: {self.state.first_candle_direction}")

        # 7. Update running VWAP and ATR windows
        self.state.prices_5m.append(close)
        self.state.vol_5m.append(volume)
        self.state.cumulative_pv += close * volume
        self.state.cumulative_vol += volume
        self.state.vwap = self.state.cumulative_pv / self.state.cumulative_vol
        
        # Calculate True Range and append to window
        if self.state.prev_close is None:
            tr = high - low
        else:
            tr = max(high - low, abs(high - self.state.prev_close), abs(low - self.state.prev_close))
        self.state.tr_window.append(tr)
        self.state.prev_close = close

        # 8. Check Entry Decisions
        if self.state.position is None and self.state.trades_today < self.config.get("max_trades_per_day", 1):
            sig = self._decide(t, open_price, close, volume)
            if sig is not None:
                self.state.position = Position(
                    direction=sig.direction,
                    entry_price=close,
                    stop_loss=sig.stop_loss,
                    target=sig.target
                )
                self.state.trades_today += 1
                self._log(f"Entry {sig.direction} @ {close} stop={sig.stop_loss:.2f} target={sig.target:.2f}")
                return sig

        return None

    def _decide(self, t: datetime.time, open_price: float, close: float, volume: float) -> Optional[Signal]:
        st = self.state
        if st.regime == "NO_TRADE" or st.disabled_today:
            return None

        # Calculate average volume: use pre-calculated reference_volume if available
        ref_vol = self.config.get("reference_volume")
        if ref_vol is not None:
            avg_vol = float(ref_vol)
            is_flat_vol = False
        else:
            avg_vol = sum(st.vol_5m) / len(st.vol_5m) if st.vol_5m else 1.0
            is_flat_vol = len(set(st.vol_5m)) <= 1

        volume_threshold_mult = float(self.config.get("volume_threshold_mult", 1.5))
        volume_ok = True
        if not is_flat_vol and avg_vol > 1.0:
            volume_ok = volume > volume_threshold_mult * avg_vol

        # Calculate ATR and ATR stop floor
        atr = sum(st.tr_window) / len(st.tr_window) if st.tr_window else 0.005 * close
        atr_stop_mult = float(self.config.get("atr_stop_multiplier", 1.5))
        atr_stop = atr_stop_mult * atr

        # FADE DECISION (at 09:25 close)
        if st.regime == "FADE" and t == datetime.time(9, 25):
            if st.gap_pct > 0.0:  # Gap up fade -> SHORT
                if st.first_candle_direction == "BEARISH" and volume_ok:
                    target = st.yesterday_close
                    stop = close + max(0.5 * st.gap_size, atr_stop)
                    if target < close:
                        return Signal(
                            direction="SELL",
                            instrument=self.config["instrument"],
                            quantity=self.config["quantity"],
                            price=0.0,
                            stop_loss=stop,
                            target=target,
                            strategy_name=self.name,
                            confidence=0.75
                        )
            elif st.gap_pct < 0.0:  # Gap down fade -> LONG
                if st.first_candle_direction == "BULLISH" and volume_ok:
                    target = st.yesterday_close
                    stop = close - max(0.5 * st.gap_size, atr_stop)
                    if target > close:
                        return Signal(
                            direction="BUY",
                            instrument=self.config["instrument"],
                            quantity=self.config["quantity"],
                            price=0.0,
                            stop_loss=stop,
                            target=target,
                            strategy_name=self.name,
                            confidence=0.75
                        )

        # CONTINUATION DECISION (at 09:30 close)
        elif st.regime == "CONTINUATION" and t == datetime.time(9, 30):
            if st.gap_pct > 0.0:  # Gap up continuation -> LONG
                if close > st.vwap and volume_ok:
                    target = close + 2.0 * atr
                    stop = close - max(0.5 * st.gap_size, atr_stop)
                    return Signal(
                        direction="BUY",
                        instrument=self.config["instrument"],
                        quantity=self.config["quantity"],
                        price=0.0,
                        stop_loss=stop,
                        target=target,
                        strategy_name=self.name,
                        confidence=0.80
                    )
            elif st.gap_pct < 0.0:  # Gap down continuation -> SHORT
                if close < st.vwap and volume_ok:
                    target = close - 2.0 * atr
                    stop = close + max(0.5 * st.gap_size, atr_stop)
                    return Signal(
                        direction="SELL",
                        instrument=self.config["instrument"],
                        quantity=self.config["quantity"],
                        price=0.0,
                        stop_loss=stop,
                        target=target,
                        strategy_name=self.name,
                        confidence=0.80
                    )

        return None

    def on_tick(self, tick: dict) -> Optional[Signal]:
        pos = self.state.position
        if pos is None or not pos.is_open:
            return None

        price = float(tick.get("price") or tick.get("last_price"))
        
        # Check stop loss and target breaches
        breached = False
        if pos.direction == "BUY":
            if price <= pos.stop_loss or price >= pos.target:
                breached = True
        elif pos.direction == "SELL":
            if price >= pos.stop_loss or price <= pos.target:
                breached = True

        if breached:
            pos.is_open = False
            self.state.position = None
            self._log(f"Tick {price} breached position {pos.direction} (SL={pos.stop_loss:.2f}, Target={pos.target:.2f})")
            # Return exit signal
            return Signal(
                direction="SELL" if pos.direction == "BUY" else "BUY",
                instrument=self.config["instrument"],
                quantity=self.config["quantity"],
                price=0.0,
                stop_loss=0.0,
                target=0.0,
                strategy_name=self.name,
                confidence=0.7
            )
        return None
