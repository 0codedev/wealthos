"""10 EMA Snap Trend Pullback Strategy.

This module implements the S8: 10 EMA Snap Strategy plus the *shared lifecycle helper section*
that is replicated verbatim across the strategies in the suite.
"""

from __future__ import annotations

import datetime
import logging
import json
import os
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Optional, Tuple, Union

import numpy as np
import pandas as pd

from strategies.base_strategy import BaseStrategy, Signal

# ---------------------------------------------------------------------------
# Internal data models (reset each trading day / per open position)
# ---------------------------------------------------------------------------

@dataclass
class Position:
    """Internal tracking of a single open trade."""
    direction: str            # "BUY" | "SELL"
    entry_price: float
    stop_loss: float
    target: float
    atr_profit_hit: bool = False
    is_open: bool = True

@dataclass
class PerDayState:
    """All in-memory accumulators reset at the start of each trading day."""
    # --- shared lifecycle fields ---
    candle_count: int = 0
    last_time: Optional[datetime.time] = None     # for new-day detection
    trades_today: int = 0
    position: Optional[Position] = None

    # --- EMA Snap-specific accumulators ---
    ema_10: Optional[float] = None
    ema_20: Optional[float] = None
    adx: Optional[float] = None
    plus_di_smooth: Optional[float] = None
    minus_di_smooth: Optional[float] = None
    atr_smooth: Optional[float] = None
    
    tr_window: Deque[float] = field(default_factory=deque)
    plus_dm_window: Deque[float] = field(default_factory=deque)
    minus_dm_window: Deque[float] = field(default_factory=deque)
    vol_window: Deque[float] = field(default_factory=deque)
    high_window: Deque[float] = field(default_factory=deque)
    low_window: Deque[float] = field(default_factory=deque)
    
    # --- daily trend filter fields ---
    daily_ema_20: Optional[float] = None
    daily_ema_50: Optional[float] = None
    daily_adx: Optional[float] = None
    
    prev_close: Optional[float] = None
    prev_high: Optional[float] = None
    prev_low: Optional[float] = None
    effective_open: Optional[float] = None

class EMASnap(BaseStrategy):
    """Trade pullback bounces to the 10 EMA floor in strong trending markets."""

    def __init__(self, config: Optional[dict] = None, name: str = "EMA_Snap_v1"):
        super().__init__(name, config or {})
        self._logger = logging.getLogger(self.name)
        self.state = PerDayState()

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

        # 5. Square-off
        if self._should_square_off(t):
            sig = self._square_off_signal()
            if sig is not None:
                self._log(f"square-off at {t}: closing {sig.direction} position")
                return sig

        # 6. Market-hours gate
        if t < self._cfg_time("market_open", "09:15:00"):
            return None

        # 7. Warmup gate
        if self._in_warmup():
            return None

        # 8. No-new-entry / session-close gate
        if not self._entries_allowed(t):
            return None

        # 9. Position / max-trades gate
        if self.state.position is not None and self.state.position.is_open:
            # Handle trailing stop logic on candle close
            trail_sig = self._check_trailing_stop(candle)
            if trail_sig is not None:
                return trail_sig
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

        # 12. Emit
        sig = self._make_signal(direction, price, stop, target, confidence)
        self.state.position = Position(
            direction=direction,
            entry_price=float(price),
            stop_loss=float(stop),
            target=float(target),
            is_open=True,
        )
        self.state.trades_today += 1
        self._log(
            f"entry {sig.direction} @ {sig.price} stop={sig.stop_loss:.2f} "
            f"target={sig.target:.2f} confidence={sig.confidence}"
        )
        return sig

    def on_tick(self, tick: dict) -> Optional[Signal]:
        """Internal stop/target bookkeeping only."""
        price = self._tick_price(tick)
        if price is None:
            return None

        pos = self.state.position
        if pos is None or not pos.is_open:
            return None

        if self._breaches_exit(pos, price):
            pos.is_open = False
            self.state.position = None
            self._log(
                f"tick {price} breached {pos.direction} position "
                f"(stop={pos.stop_loss}, target={pos.target}); marked closed"
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
            for fmt in ("%H:%M:%S", "%H:%M"):
                try:
                    return datetime.datetime.strptime(value, fmt).time()
                except ValueError:
                    continue
        raise TypeError(f"unsupported time type: {type(value)!r}")

    def _is_new_day(self, t: datetime.time) -> bool:
        return self.state.last_time is not None and t < self.state.last_time

    def _reset_day_state(self) -> None:
        # Preserve rolling indicator history across session resets
        ema_10 = self.state.ema_10
        ema_20 = self.state.ema_20
        adx = self.state.adx
        plus_di_smooth = self.state.plus_di_smooth
        minus_di_smooth = self.state.minus_di_smooth
        atr_smooth = self.state.atr_smooth
        
        daily_ema_20 = self.state.daily_ema_20
        daily_ema_50 = self.state.daily_ema_50
        daily_adx = self.state.daily_adx
        
        tr_window = self.state.tr_window
        plus_dm_window = self.state.plus_dm_window
        minus_dm_window = self.state.minus_dm_window
        vol_window = self.state.vol_window
        high_window = self.state.high_window
        low_window = self.state.low_window
        
        self.state = PerDayState()
        self.state.ema_10 = ema_10
        self.state.ema_20 = ema_20
        self.state.adx = adx
        self.state.plus_di_smooth = plus_di_smooth
        self.state.minus_di_smooth = minus_di_smooth
        self.state.atr_smooth = atr_smooth
        
        self.state.daily_ema_20 = daily_ema_20
        self.state.daily_ema_50 = daily_ema_50
        self.state.daily_adx = daily_adx
        
        self.state.tr_window = tr_window
        self.state.plus_dm_window = plus_dm_window
        self.state.minus_dm_window = minus_dm_window
        self.state.vol_window = vol_window
        self.state.high_window = high_window
        self.state.low_window = low_window

    def _in_warmup(self) -> bool:
        return self.state.candle_count < int(self._cfg("warmup_period", 5))

    def _entries_allowed(self, t: datetime.time) -> bool:
        # Snap specific window: 10:00 AM to 2:30 PM
        if t < self._cfg_time("entry_start", "10:00:00"):
            return False
        if t >= self._cfg_time("no_new_entry", "14:30:00"):
            return False
        if t >= self._cfg_time("session_close", "15:20:00"):
            return False
        return True

    def _should_square_off(self, t: datetime.time) -> bool:
        if self.state.position is None or not self.state.position.is_open:
            return False
        return t >= self._cfg_time("square_off", "15:10:00")

    def _within_risk(self, entry: float, stop: float) -> bool:
        capital = float(self._cfg("capital", 100000.0))
        is_dynamic = self._cfg("dynamic_position_sizing", False) or self._cfg("dynamic_sizing", False) or True
        quantity = 1 if is_dynamic else int(self._cfg("quantity", 10))
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
            instrument=str(self._cfg("instrument", "")),
            quantity=int(self._cfg("quantity", 10)),
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

    # =====================================================================
    # S8 Indicator and Decision Layer
    # =====================================================================

    def _update_indicators(self, candle: dict, t: datetime.time) -> None:
        st = self.state
        close = float(candle["close"])
        high = float(candle["high"])
        low = float(candle["low"])
        volume = float(candle.get("volume", 1000.0))

        # 1. Effective open
        open_val = candle.get("open")
        if open_val is not None:
            try:
                st.effective_open = float(open_val)
            except (ValueError, TypeError):
                st.effective_open = st.prev_close if st.prev_close is not None else close
        elif st.prev_close is not None:
            st.effective_open = st.prev_close
        else:
            st.effective_open = close

        # 2. EMAs
        alpha_10 = 2.0 / (10.0 + 1.0)
        if st.ema_10 is None:
            st.ema_10 = close
        else:
            st.ema_10 = alpha_10 * close + (1.0 - alpha_10) * st.ema_10

        alpha_20 = 2.0 / (20.0 + 1.0)
        if st.ema_20 is None:
            st.ema_20 = close
        else:
            st.ema_20 = alpha_20 * close + (1.0 - alpha_20) * st.ema_20

        # 3. ATR 14
        if st.prev_close is None:
            tr = high - low
        else:
            tr = max(high - low, abs(high - st.prev_close), abs(low - st.prev_close))
        st.tr_window.append(tr)
        while len(st.tr_window) > 14:
            st.tr_window.popleft()

        # 4. ADX 14 Wilder Smoothing
        if st.prev_close is not None:
            up = high - st.prev_high if st.prev_high is not None else 0.0
            down = st.prev_low - low if st.prev_low is not None else 0.0
            plus_dm = up if up > down and up > 0.0 else 0.0
            minus_dm = down if down > up and down > 0.0 else 0.0
        else:
            plus_dm = 0.0
            minus_dm = 0.0

        st.plus_dm_window.append(plus_dm)
        st.minus_dm_window.append(minus_dm)
        while len(st.plus_dm_window) > 14:
            st.plus_dm_window.popleft()
            st.minus_dm_window.popleft()

        alpha_adx = 1.0 / 14.0
        if st.plus_di_smooth is None:
            st.plus_di_smooth = plus_dm
            st.minus_di_smooth = minus_dm
            st.atr_smooth = tr
        else:
            st.plus_di_smooth = alpha_adx * plus_dm + (1.0 - alpha_adx) * st.plus_di_smooth
            st.minus_di_smooth = alpha_adx * minus_dm + (1.0 - alpha_adx) * st.minus_di_smooth
            st.atr_smooth = alpha_adx * tr + (1.0 - alpha_adx) * st.atr_smooth

        plus_di = 100.0 * st.plus_di_smooth / (st.atr_smooth if st.atr_smooth > 0 else 1.0)
        minus_di = 100.0 * st.minus_di_smooth / (st.atr_smooth if st.atr_smooth > 0 else 1.0)
        
        denom = plus_di + minus_di
        dx = 100.0 * abs(plus_di - minus_di) / denom if denom > 0 else 0.0
        
        if st.adx is None:
            st.adx = dx
        else:
            st.adx = alpha_adx * dx + (1.0 - alpha_adx) * st.adx

        # 5. Volume SMA
        st.vol_window.append(volume)
        while len(st.vol_window) > 20:
            st.vol_window.popleft()

        # 6. Swing Windows
        st.high_window.append(high)
        st.low_window.append(low)
        while len(st.high_window) > 10:
            st.high_window.popleft()
            st.low_window.popleft()

        # Save values for next comparison
        st.prev_high = high
        st.prev_low = low
        st.prev_close = close

    def update_daily_state(self, daily_ema_20: float, daily_ema_50: float, daily_adx: float) -> None:
        """Stores daily indicators for trend gating (Phase 2 optimization)."""
        self.state.daily_ema_20 = daily_ema_20
        self.state.daily_ema_50 = daily_ema_50
        self.state.daily_adx = daily_adx

    def _decide(self, candle: dict, t: datetime.time) -> Optional[Tuple[str, float, float, float, float]]:
        st = self.state
        if st.adx is None or st.ema_10 is None or st.ema_20 is None:
            return None

        close = float(candle["close"])
        high = float(candle["high"])
        low = float(candle["low"])
        volume = float(candle.get("volume", 1000.0))

        # Config parameters
        adx_threshold = float(self._cfg("adx_threshold", 20.0))
        vol_sma = sum(st.vol_window) / len(st.vol_window) if st.vol_window else 1.0
        is_flat_vol = len(set(st.vol_window)) <= 1
        vol_confirmed = volume > vol_sma or is_flat_vol

        # Compute ATR
        atr = sum(st.tr_window) / len(st.tr_window) if st.tr_window else 1.0

        # Swing bounds
        swing_high = max(st.high_window) if st.high_window else high
        swing_low = min(st.low_window) if st.low_window else low

        # Daily Trend Gating
        daily_bullish = st.daily_ema_20 is None or st.daily_ema_50 is None or st.daily_ema_20 > st.daily_ema_50
        daily_bearish = st.daily_ema_20 is None or st.daily_ema_50 is None or st.daily_ema_20 < st.daily_ema_50

        # CHECK BUY (BULLISH SNAP)
        # 1. Strong trend: price > 20 EMA, ADX > 20, Daily EMA slope is bullish
        trend_bullish = close > st.ema_20 and st.adx > adx_threshold and daily_bullish
        # 2. Pullback: Touch or within 0.1% of 10 EMA
        snap_bullish = low <= st.ema_10 * 1.001
        # 3. Bounce: Close above 10 EMA
        bounce_bullish = close > st.ema_10

        if trend_bullish and snap_bullish and bounce_bullish and vol_confirmed:
            stop_mult = float(self._cfg("stop_multiplier", 1.5))
            target_mult = float(self._cfg("target_multiplier", 3.0))
            
            # Enforce 1.0% stop floor and 2.0% target floor to prevent micro-stops
            stop_dist = max(stop_mult * atr, 0.01 * close)
            target_dist = max(target_mult * atr, 2.0 * stop_dist)
            
            stop = close - stop_dist
            target = close + target_dist
            if target > close and stop < close:
                return ("BUY", close, stop, target, 0.8)

        # CHECK SELL (BEARISH SNAP)
        # 1. Strong trend: price < 20 EMA, ADX > 20, Daily EMA slope is bearish
        trend_bearish = close < st.ema_20 and st.adx > adx_threshold and daily_bearish
        # 2. Pullback: Touch or within 0.1% of 10 EMA
        snap_bearish = high >= st.ema_10 * 0.999
        # 3. Bounce: Close below 10 EMA
        bounce_bearish = close < st.ema_10

        if trend_bearish and snap_bearish and bounce_bearish and vol_confirmed:
            stop_mult = float(self._cfg("stop_multiplier", 1.5))
            target_mult = float(self._cfg("target_multiplier", 3.0))
            
            # Enforce 1.0% stop floor and 2.0% target floor to prevent micro-stops
            stop_dist = max(stop_mult * atr, 0.01 * close)
            target_dist = max(target_mult * atr, 2.0 * stop_dist)
            
            stop = close + stop_dist
            target = close - target_dist
            if target < close and stop > close:
                return ("SELL", close, stop, target, 0.8)

        return None

    def _check_trailing_stop(self, candle: dict) -> Optional[Signal]:
        st = self.state
        pos = st.position
        if pos is None or not pos.is_open or st.ema_20 is None:
            return None

        close = float(candle["close"])
        
        # Calculate current ATR
        atr = sum(st.tr_window) / len(st.tr_window) if st.tr_window else 1.0

        # Check trail activation threshold (default 1.5x ATR)
        trail_act = float(self._cfg("trail_activation_atr", 1.5))
        if not pos.atr_profit_hit:
            profit = (close - pos.entry_price) if pos.direction == "BUY" else (pos.entry_price - close)
            if profit >= trail_act * atr:
                pos.atr_profit_hit = True
                self._log(f"{trail_act}x ATR profit reached. 20 EMA Trailing Stop activated.")

        if pos.atr_profit_hit:
            # Trailing exit: long close below 20 EMA or short close above 20 EMA
            if pos.direction == "BUY" and close < st.ema_20:
                self._log(f"Trailing Stop hit: close {close} < 20 EMA {st.ema_20:.2f}")
                return self._square_off_signal()
            elif pos.direction == "SELL" and close > st.ema_20:
                self._log(f"Trailing Stop hit: close {close} > 20 EMA {st.ema_20:.2f}")
                return self._square_off_signal()

        return None
