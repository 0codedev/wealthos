"""Multi-Timeframe Momentum Cascade strategy.

This module implements S4: Multi-Timeframe Momentum Cascade strategy with:
- Daily trend filter: Daily EMA(20) > EMA(50) and Daily ADX(14) > 25
- Hourly momentum filter: Hourly RSI(14) > 50 and Hourly MACD Histogram > 0
- 15-minute execution: Pullback to and reclaim of the 15-minute EMA(20)
- 15-minute volume filter: Volume > 1.3x of 20-period average volume
- Trailing stop-loss: Trails at 1x ATR distance after 2x ATR profit is reached
- Standard lifecycle helper section matching the WealthOS algo engine conventions
"""

from __future__ import annotations

import datetime
import logging
import math
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Optional, Tuple

import numpy as np

from strategies.base_strategy import BaseStrategy, Signal


@dataclass
class Position:
    """Internal tracking of a single open trade (Requirements 8, 14)."""

    direction: str            # "BUY" | "SELL"
    entry_price: float
    stop_loss: float
    target: float
    atr: float
    max_price: float
    min_price: float
    trail_triggered: bool = False
    is_open: bool = True


@dataclass
class PerDayState:
    """All in-memory accumulators reset at the start of each trading day."""

    # --- shared lifecycle fields ---
    candle_count: int = 0
    last_time: Optional[datetime.time] = None     # for new-day detection
    trades_today: int = 0
    position: Optional[Position] = None

    # --- MTF-specific accumulators ---
    # 15-minute trackers
    close_15m: Deque[float] = field(default_factory=deque)
    high_15m: Deque[float] = field(default_factory=deque)
    low_15m: Deque[float] = field(default_factory=deque)
    vol_15m: Deque[float] = field(default_factory=deque)
    tr_15m: Deque[float] = field(default_factory=deque)
    
    # 15-minute indicators
    ema_20_15m: Optional[float] = None
    atr_14_15m: float = 0.0

    # Hourly candles (aggregated from 15-minute candles)
    current_hour_candles: list[dict] = field(default_factory=list)
    close_1h: Deque[float] = field(default_factory=deque)
    
    # Hourly indicators
    rsi_14_1h: float = 50.0
    macd_hist_1h: float = 0.0
    
    # Daily filter state (passed from main loop or loader)
    daily_ema_20: Optional[float] = None
    daily_ema_50: Optional[float] = None
    daily_adx_14: float = 0.0
    
    # Miscellaneous
    prev_close_15m: Optional[float] = None
    effective_open_15m: Optional[float] = None


class MTFMomentum(BaseStrategy):
    """Multi-Timeframe Momentum Cascade Strategy."""

    def __init__(self, config: Optional[dict] = None):
        super().__init__("MTF_Momentum_Cascade_v1", config or {})
        self._logger = logging.getLogger(self.name)
        self.state = PerDayState()
        
        # Load hourly indicator states for RSI/MACD across sessions
        self._hour_rsi_avg_gain = None
        self._hour_rsi_avg_loss = None
        self._hour_macd_ema_12 = None
        self._hour_macd_ema_26 = None
        self._hour_macd_signal = None
        self._hour_macd_signals = deque(maxlen=50)

    # =====================================================================
    # Public BaseStrategy contract
    # =====================================================================

    def on_candle(self, candle: dict) -> Optional[Signal]:
        """Fixed-order lifecycle pipeline."""
        # 1. Schema validation
        missing = self._validate_candle(candle)
        if missing is not None:
            self._log(f"missing guaranteed candle field '{missing}'; returning None")
            return None

        # 2. Time normalization
        try:
            t = self._normalize_time(candle["time"])
        except (ValueError, TypeError):
            self._log("unparseable 'time' field; returning None")
            return None

        # 3. New-day detection & reset
        if self._is_new_day(t):
            self._reset_day_state()
            self._log(f"new trading day detected at {t}; per-day state reset")

        # 4. Indicator / accumulator update + candle count
        self.state.candle_count += 1
        self._update_indicators(candle, t)
        self.state.last_time = t

        # 5. Square-off (MTF swing trades can hold multi-day, so EOD square-off is DISABLED here!
        # Instead, we hold positions across days unless daily trend flips.
        # However, if square_off is configured, we follow it.)
        if self._cfg("force_intraday_exit", False) and self._should_square_off(t):
            sig = self._square_off_signal()
            if sig is not None:
                self._log(f"square-off at {t}: closing {sig.direction} position")
                return sig

        # Regime Exit Check (Daily trend exit: close position if daily EMA trend reverses)
        daily_exit_sig = self._check_regime_exits()
        if daily_exit_sig:
            return daily_exit_sig

        # 6. Market-hours gate
        if t < self._cfg_time("market_open", "09:15:00"):
            return None

        # 7. Warmup gate (need enough candles for lookbacks)
        if self._in_warmup():
            return None

        # 8. No-new-entry / session-close gate
        if not self._entries_allowed(t):
            return None

        # 9. Position / max-trades gate
        if self.state.position is not None and self.state.position.is_open:
            return None
        if self.state.trades_today >= int(self._cfg("max_trades_per_day", 3)):
            return None

        # 10. Strategy-specific decision
        decision = self._decide(candle, t)
        if decision is None:
            return None
        direction, price, stop, target, confidence = decision

        # 11. Risk validation
        if not self._within_risk(price, stop):
            self._log(
                f"risk limit exceeded (entry={price}, stop={stop}, "
                f"qty={self._cfg('quantity', 1)}); returning None"
            )
            return None

        # 12. Emit Signal
        sig = self._make_signal(direction, price, stop, target, confidence)
        self.state.position = Position(
            direction=direction,
            entry_price=float(price),
            stop_loss=float(stop),
            target=float(target),
            atr=self.state.atr_14_15m,
            max_price=float(price),
            min_price=float(price),
            trail_triggered=False,
            is_open=True,
        )
        self.state.trades_today += 1
        self._log(
            f"entry {sig.direction} @ {sig.price} stop={sig.stop_loss:.2f} "
            f"target={sig.target:.2f} confidence={sig.confidence}"
        )
        return sig

    def on_tick(self, tick: dict) -> Optional[Signal]:
        """Real-time monitoring of SL, target, and trailing stops."""
        price = self._tick_price(tick)
        if price is None:
            return None

        pos = self.state.position
        if pos is None or not pos.is_open:
            return None

        # Update extremes
        pos.max_price = max(pos.max_price, price)
        pos.min_price = min(pos.min_price, price)

        # 2x ATR profit trigger trailing stop at 1x ATR distance
        atr = pos.atr
        if not pos.trail_triggered:
            if pos.direction == "BUY" and (pos.max_price - pos.entry_price) >= (2.0 * atr):
                pos.trail_triggered = True
                new_sl = pos.max_price - atr
                pos.stop_loss = max(pos.stop_loss, new_sl)
                self._log(f"Trailing stop activated at SL={pos.stop_loss:.2f} (2x ATR profit hit)")
            elif pos.direction == "SELL" and (pos.entry_price - pos.min_price) >= (2.0 * atr):
                pos.trail_triggered = True
                new_sl = pos.min_price + atr
                pos.stop_loss = min(pos.stop_loss, new_sl)
                self._log(f"Trailing stop activated at SL={pos.stop_loss:.2f} (2x ATR profit hit)")
        else:
            if pos.direction == "BUY":
                new_sl = pos.max_price - atr
                if new_sl > pos.stop_loss:
                    pos.stop_loss = new_sl
            elif pos.direction == "SELL":
                new_sl = pos.min_price + atr
                if new_sl < pos.stop_loss:
                    pos.stop_loss = new_sl

        # Check exits
        if self._breaches_exit(pos, price):
            pos.is_open = False
            self.state.position = None
            self._log(
                f"tick {price} breached {pos.direction} position "
                f"(stop={pos.stop_loss:.2f}, target={pos.target:.2f}); marked closed"
            )
        return None

    # =====================================================================
    # Shared lifecycle helpers
    # =====================================================================

    def _cfg(self, key: str, default):
        value = self.config.get(key, default)
        return default if value is None else value

    def _validate_candle(self, candle: dict) -> Optional[str]:
        if not isinstance(candle, dict):
            return "candle"
        for fieldname in ("high", "low", "close", "time"):
            if fieldname not in candle or candle[fieldname] is None:
                return fieldname
        return None

    def _normalize_time(self, value) -> datetime.time:
        if isinstance(value, datetime.time):
            return value
        if isinstance(value, datetime.datetime):
            return value.time()
        if isinstance(value, str):
            return datetime.datetime.strptime(value, "%H:%M:%S").time()
        raise TypeError(f"unsupported time type: {type(value)!r}")

    def _is_new_day(self, t: datetime.time) -> bool:
        return self.state.last_time is not None and t < self.state.last_time

    def _reset_day_state(self) -> None:
        # Save indicators that bridge across days
        close_15m = self.state.close_15m
        high_15m = self.state.high_15m
        low_15m = self.state.low_15m
        vol_15m = self.state.vol_15m
        tr_15m = self.state.tr_15m
        close_1h = self.state.close_1h
        ema_20_15m = self.state.ema_20_15m
        prev_close_15m = self.state.prev_close_15m
        pos = self.state.position
        
        # Save hourly states
        current_hour_candles = self.state.current_hour_candles
        rsi_14_1h = self.state.rsi_14_1h
        macd_hist_1h = self.state.macd_hist_1h
        
        # Save daily indicators
        daily_ema_20 = self.state.daily_ema_20
        daily_ema_50 = self.state.daily_ema_50
        daily_adx_14 = self.state.daily_adx_14

        self.state = PerDayState()
        
        # Restore indicators for continuity across sessions
        self.state.close_15m = close_15m
        self.state.high_15m = high_15m
        self.state.low_15m = low_15m
        self.state.vol_15m = vol_15m
        self.state.tr_15m = tr_15m
        self.state.close_1h = close_1h
        self.state.ema_20_15m = ema_20_15m
        self.state.prev_close_15m = prev_close_15m
        self.state.position = pos
        self.state.current_hour_candles = current_hour_candles
        self.state.rsi_14_1h = rsi_14_1h
        self.state.macd_hist_1h = macd_hist_1h
        self.state.daily_ema_20 = daily_ema_20
        self.state.daily_ema_50 = daily_ema_50
        self.state.daily_adx_14 = daily_adx_14

    def _in_warmup(self) -> bool:
        # Warmup for MTF trend checks requires daily state to be populated
        if self.state.daily_ema_20 is None or self.state.daily_ema_50 is None:
            return True
        # Need enough 15-minute candles to calculate rolling EMA(20) and ATR(14)
        return len(self.state.close_15m) < 20

    def _entries_allowed(self, t: datetime.time) -> bool:
        if t >= self._cfg_time("no_new_entry", "15:00:00"):
            return False
        if t >= self._cfg_time("session_close", "15:20:00"):
            return False
        return True

    def _should_square_off(self, t: datetime.time) -> bool:
        if self.state.position is None or not self.state.position.is_open:
            return False
        return t >= self._cfg_time("square_off", "15:15:00")

    def _within_risk(self, entry: float, stop: float) -> bool:
        capital = float(self._cfg("capital", 1000000.0))
        is_dynamic = self._cfg("dynamic_position_sizing", False) or self._cfg("dynamic_sizing", False) or True
        quantity = 1 if is_dynamic else int(self._cfg("quantity", 50))
        projected_loss = abs(float(entry) - float(stop)) * quantity
        risk_per_trade = 0.02 * capital
        return projected_loss <= risk_per_trade

    def _make_signal(
        self,
        direction: str,
        price: float,
        stop: float,
        target: float,
        confidence: float,
    ) -> Signal:
        assert direction in ("BUY", "SELL"), f"invalid direction: {direction!r}"
        return Signal(
            direction=str(direction),
            instrument=str(self._cfg("instrument", "2885")),
            quantity=int(self._cfg("quantity", 50)),
            price=float(price),
            stop_loss=float(stop),
            target=float(target),
            strategy_name=self.name,
            confidence=float(max(0.0, min(1.0, float(confidence)))),
        )

    def _log(self, msg: str) -> None:
        try:
            self._logger.debug("[%s] %s", self.name, msg)
            print(f"[{self.name}] {msg}")
        except Exception:
            pass

    def _cfg_time(self, key: str, default_str: str) -> datetime.time:
        value = self._cfg(key, default_str)
        return self._normalize_time(value)

    def _tick_price(self, tick: dict) -> Optional[float]:
        if not isinstance(tick, dict):
            return None
        for key in ("price", "ltp", "last_price"):
            value = tick.get(key)
            if value is not None:
                try:
                    return float(value)
                except (ValueError, TypeError):
                    return None
        return None

    def _breaches_exit(self, pos: Position, price: float) -> bool:
        if pos.direction == "BUY":
            return price <= pos.stop_loss or price >= pos.target
        return price >= pos.stop_loss or price <= pos.target

    def _square_off_signal(self) -> Optional[Signal]:
        pos = self.state.position
        if pos is None or not pos.is_open:
            return None
        close_direction = "SELL" if pos.direction == "BUY" else "BUY"
        sig = self._make_signal(
            direction=close_direction,
            price=0.0,
            stop=0.0,
            target=0.0,
            confidence=1.0,
        )
        pos.is_open = False
        self.state.position = None
        return sig

    def update_daily_state(self, ema_20: float, ema_50: float, adx_14: float) -> None:
        """Sets the daily indicators calculated from pre-market daily candles."""
        self.state.daily_ema_20 = float(ema_20)
        self.state.daily_ema_50 = float(ema_50)
        self.state.daily_adx_14 = float(adx_14)
        self._log(f"Daily State Updated: EMA20={ema_20:.2f}, EMA50={ema_50:.2f}, ADX14={adx_14:.2f}")

    # =====================================================================
    # Strategy Indicator updates and Decisions
    # =====================================================================

    def _update_indicators(self, candle: dict, t: datetime.time) -> None:
        st = self.state

        close = float(candle["close"])
        high = float(candle["high"])
        low = float(candle["low"])
        vol = float(candle.get("volume") or 1000.0)

        # 1. Effective open
        open_val = candle.get("open")
        if open_val is not None:
            try:
                st.effective_open_15m = float(open_val)
            except (ValueError, TypeError):
                st.effective_open_15m = st.prev_close_15m if st.prev_close_15m is not None else close
        elif st.prev_close_15m is not None:
            st.effective_open_15m = st.prev_close_15m
        else:
            st.effective_open_15m = close

        # 2. 15-minute indicators update
        st.close_15m.append(close)
        st.high_15m.append(high)
        st.low_15m.append(low)
        st.vol_15m.append(vol)

        if len(st.close_15m) > 50:
            st.close_15m.popleft()
            st.high_15m.popleft()
            st.low_15m.popleft()
            st.vol_15m.popleft()

        # Update 15m True Range + ATR(14)
        if st.prev_close_15m is None:
            tr = high - low
        else:
            tr = max(high - low, abs(high - st.prev_close_15m), abs(low - st.prev_close_15m))
        st.tr_15m.append(tr)
        while len(st.tr_15m) > 14:
            st.tr_15m.popleft()
        st.atr_14_15m = sum(st.tr_15m) / len(st.tr_15m) if st.tr_15m else 0.0

        # Update 15m EMA(20)
        alpha_20 = 2.0 / (20.0 + 1.0)
        if st.ema_20_15m is None:
            st.ema_20_15m = close
        else:
            st.ema_20_15m = alpha_20 * close + (1.0 - alpha_20) * st.ema_20_15m

        # 3. Hourly Aggregator
        # We group 15-minute candles to form hourly bars.
        # An hourly bar closes at :15 after the hour (e.g. 10:15 contains 09:30, 09:45, 10:00, 10:15 closes).
        st.current_hour_candles.append(candle)
        if len(st.current_hour_candles) >= 4:
            # We have a full hour candle!
            hour_closes = [c["close"] for c in st.current_hour_candles]
            hour_close = hour_closes[-1]
            st.close_1h.append(hour_close)
            
            if len(st.close_1h) > 50:
                st.close_1h.popleft()

            # Update Hourly indicators
            self._update_hourly_indicators(hour_close)
            
            # Clear accumulator
            st.current_hour_candles = []

        st.prev_close_15m = close

    def _update_hourly_indicators(self, close: float) -> None:
        st = self.state

        # 1. Hourly RSI(14) Wilder Smoothing
        if len(st.close_1h) >= 2:
            gain = max(0.0, close - st.close_1h[-2])
            loss = max(0.0, st.close_1h[-2] - close)

            if self._hour_rsi_avg_gain is None:
                self._hour_rsi_avg_gain = gain
                self._hour_rsi_avg_loss = loss
            else:
                self._hour_rsi_avg_gain = (self._hour_rsi_avg_gain * 13.0 + gain) / 14.0
                self._hour_rsi_avg_loss = (self._hour_rsi_avg_loss * 13.0 + loss) / 14.0

            if self._hour_rsi_avg_loss > 0:
                rs = self._hour_rsi_avg_gain / self._hour_rsi_avg_loss
                st.rsi_14_1h = 100.0 - (100.0 / (1.0 + rs))
            else:
                st.rsi_14_1h = 100.0 if self._hour_rsi_avg_gain > 0 else 50.0

        # 2. Hourly MACD(12, 26, 9)
        alpha_12 = 2.0 / (12.0 + 1.0)
        alpha_26 = 2.0 / (26.0 + 1.0)
        alpha_9 = 2.0 / (9.0 + 1.0)

        if self._hour_macd_ema_12 is None:
            self._hour_macd_ema_12 = close
            self._hour_macd_ema_26 = close
        else:
            self._hour_macd_ema_12 = alpha_12 * close + (1.0 - alpha_12) * self._hour_macd_ema_12
            self._hour_macd_ema_26 = alpha_26 * close + (1.0 - alpha_26) * self._hour_macd_ema_26

        macd_line = self._hour_macd_ema_12 - self._hour_macd_ema_26
        
        if self._hour_macd_signal is None:
            self._hour_macd_signal = macd_line
        else:
            self._hour_macd_signal = alpha_9 * macd_line + (1.0 - alpha_9) * self._hour_macd_signal

        st.macd_hist_1h = macd_line - self._hour_macd_signal
        self._log(f"Hourly Indicators Updated: RSI={st.rsi_14_1h:.2f}, MACD_Hist={st.macd_hist_1h:.4f}")

    def _check_regime_exits(self) -> Optional[Signal]:
        """Regime Exit: If the daily trend direction flips while a position is open,
        trigger an immediate market square-off to protect profits/risk."""
        pos = self.state.position
        if pos is None or not pos.is_open:
            return None

        ema_20 = self.state.daily_ema_20
        ema_50 = self.state.daily_ema_50
        if ema_20 is None or ema_50 is None:
            return None

        # Uptrend reversed to downtrend
        if pos.direction == "BUY" and ema_20 < ema_50:
            self._log("Daily trend flipped bearish. Triggering regime square-off exit!")
            return self._square_off_signal()
        
        # Downtrend reversed to uptrend
        if pos.direction == "SELL" and ema_20 > ema_50:
            self._log("Daily trend flipped bullish. Triggering regime square-off exit!")
            return self._square_off_signal()

        return None

    def _decide(
        self, candle: dict, t: datetime.time
    ) -> Optional[Tuple[str, float, float, float, float]]:
        """Multi-timeframe Decision rules:
        - Daily trend: EMA(20) > EMA(50) and ADX > 25 (up direction); vice versa for down direction.
        - Hourly momentum: RSI > 50 and MACD Hist > 0 (for buy); RSI < 50 and MACD Hist < 0 (for sell).
        - 15-minute entry: Low dips below EMA(20) + pullback band, close reclaims above EMA(20) (for buy).
        - 15-minute volume check: close volume > 1.3x average volume of last 20 candles.
        """
        st = self.state

        # Verify daily trend status
        if st.daily_ema_20 is None or st.daily_ema_50 is None:
            return None

        # Check Daily ADX trending condition (ADX > 25.0 default)
        adx_threshold = float(self._cfg("daily_adx_threshold", 25.0))
        if st.daily_adx_14 < adx_threshold:
            return None

        close = float(candle["close"])
        high = float(candle["high"])
        low = float(candle["low"])
        vol = float(candle.get("volume") or 1000.0)
        eff_open = st.effective_open_15m if st.effective_open_15m is not None else close

        # Calculate average 15-minute volume over last 20 candles
        vol_arr = list(st.vol_15m)
        avg_vol = sum(vol_arr) / len(vol_arr) if vol_arr else 1000.0
        
        # Volume check: if volume data is flat (all elements equal) or missing, bypass it
        volume_threshold_mult = float(self._cfg("volume_threshold_mult", 1.3))
        is_flat_vol = len(set(vol_arr)) <= 1
        volume_ok = True
        if not is_flat_vol and avg_vol > 0.0:
            volume_ok = vol > volume_threshold_mult * avg_vol
            
        atr = st.atr_14_15m if st.atr_14_15m > 0 else 0.001 * close
        pullback_band = float(self._cfg("pullback_band", 2.0))
        band = max(pullback_band, 0.25 * atr)
        confidence = 0.7

        # LONG DECISION
        # Daily: EMA(20) > EMA(50)
        # Hourly: RSI > 50 and MACD Hist > 0
        if st.daily_ema_20 > st.daily_ema_50:
            if st.rsi_14_1h > 50.0 and st.macd_hist_1h > 0.0:
                # 15-minute pullback check
                pulled_back = low <= st.ema_20_15m + band
                reclaimed = close > st.ema_20_15m
                bullish_body = close > eff_open
                
                if pulled_back and reclaimed and bullish_body and volume_ok:
                    # Calculate exits
                    atr = st.atr_14_15m if st.atr_14_15m > 0 else 0.001 * close
                    target = close + 3.0 * atr
                    # Stop loss at recent 15-minute swing low (min low of last 3 candles) with a 1.5x ATR floor
                    recent_lows = list(st.low_15m)[-3:]
                    stop = min(recent_lows) - 1.0 if recent_lows else close - 1.5 * atr
                    if stop >= close or stop > close - 1.5 * atr:
                        stop = close - 1.5 * atr
                    
                    # Enforce 1.0% stop floor and 3.0% target floor
                    stop_dist = max(close - stop, 0.01 * close)
                    target_dist = max(target - close, 3.0 * stop_dist)
                    stop = close - stop_dist
                    target = close + target_dist
                    
                    self._log(f"MTF Momentum Long Entry. Daily ADX={st.daily_adx_14:.2f}. SL={stop:.2f}, Target={target:.2f}")
                    return ("BUY", close, stop, target, confidence)

        # SHORT DECISION
        # Daily: EMA(20) < EMA(50)
        # Hourly: RSI < 50 and MACD Hist < 0
        if st.daily_ema_20 < st.daily_ema_50:
            if st.rsi_14_1h < 50.0 and st.macd_hist_1h < 0.0:
                # 15-minute pullback check
                pulled_back = high >= st.ema_20_15m - band
                reclaimed = close < st.ema_20_15m
                bearish_body = close < eff_open
                
                if pulled_back and reclaimed and bearish_body and volume_ok:
                    # Calculate exits
                    atr = st.atr_14_15m if st.atr_14_15m > 0 else 0.001 * close
                    target = close - 3.0 * atr
                    # Stop loss at recent 15-minute swing high (max high of last 3 candles) with a 1.5x ATR floor
                    recent_highs = list(st.high_15m)[-3:]
                    stop = max(recent_highs) + 1.0 if recent_highs else close + 1.5 * atr
                    if stop <= close or stop < close + 1.5 * atr:
                        stop = close + 1.5 * atr
                    
                    # Enforce 1.0% stop floor and 3.0% target floor
                    stop_dist = max(stop - close, 0.01 * close)
                    target_dist = max(close - target, 3.0 * stop_dist)
                    stop = close + stop_dist
                    target = close - target_dist
                    
                    self._log(f"MTF Momentum Short Entry. Daily ADX={st.daily_adx_14:.2f}. SL={stop:.2f}, Target={target:.2f}")
                    return ("SELL", close, stop, target, confidence)

        return None
