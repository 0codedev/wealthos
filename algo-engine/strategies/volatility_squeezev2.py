"""Volatility Squeeze Breakout v2 intraday strategy.

This module implements S2: Volatility Squeeze Breakout strategy v2 with:
- Bollinger + Keltner squeeze state machine
- Momentum histogram (close - midpoint of 20-period highest-high/lowest-low)
- ATR-scaled target and opposite-side squeeze range stop loss
- Volatility-scaled trailing stop-loss (trails at 1x ATR after 1x ATR profit)
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
import pandas as pd

from strategies.base_strategy import BaseStrategy, Signal


@dataclass
class Position:
    """Internal tracking of a single open trade (Requirements 8, 14)."""

    direction: str            # "BUY" | "SELL"
    entry_price: float
    stop_loss: float
    target: float
    atr: float
    max_price: float          # Track extreme price for trailing stop
    min_price: float          # Track extreme price for trailing stop
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

    # --- Squeeze-specific accumulators ---
    close_window: Deque[float] = field(default_factory=deque)     # rolling close window
    high_window: Deque[float] = field(default_factory=deque)      # rolling high window
    low_window: Deque[float] = field(default_factory=deque)       # rolling low window
    tr_window: Deque[float] = field(default_factory=deque)        # rolling true-range window (ATR)
    
    squeeze_seen: bool = False                    # True once a squeeze occurred today
    squeeze_duration: int = 0                     # Number of bars squeeze has persisted
    squeeze_low: Optional[float] = None           # opposite-side stop reference (low)
    squeeze_high: Optional[float] = None          # opposite-side stop reference (high)
    prev_close: Optional[float] = None            # prior-candle close (effective open)
    is_squeeze: bool = False                      # current-candle squeeze classification
    prev_squeeze: bool = False                    # previous-candle squeeze classification
    effective_open: Optional[float] = None        # candle open, or prior close substitute
    momentum_hist: float = 0.0                    # Momentum histogram value
    atr: float = 0.0                              # Current candle ATR value


class VolatilitySqueezeV2(BaseStrategy):
    """Volatility Squeeze Breakout Strategy v2."""

    def __init__(self, config: Optional[dict] = None):
        super().__init__("Volatility_Squeeze_Breakout_v2", config or {})
        self._logger = logging.getLogger(self.name)
        self.state = PerDayState()

    # =====================================================================
    # Public BaseStrategy contract
    # =====================================================================

    def on_candle(self, candle: dict) -> Optional[Signal]:
        """Fixed-order lifecycle pipeline:
        schema validation -> new-day reset -> time normalization ->
        indicator update -> square-off -> market-hours gate -> warmup gate ->
        no-new-entry / session-close gate -> position / max-trades gate ->
        decision -> risk validation -> emit
        """
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

        # 7. Warmup gate (need enough candles for lookback period)
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
            atr=self.state.atr,
            max_price=float(price),
            min_price=float(price),
            trail_triggered=False,
            is_open=True,
        )
        self.state.trades_today += 1
        self._log(
            f"entry {sig.direction} @ {sig.price} stop={sig.stop_loss} "
            f"target={sig.target} confidence={sig.confidence}"
        )
        return sig

    def on_tick(self, tick: dict) -> Optional[Signal]:
        """Stop/target bookkeeping + dynamic trailing stop-loss (Requirements 8, 14)."""
        price = self._tick_price(tick)
        if price is None:
            return None

        pos = self.state.position
        if pos is None or not pos.is_open:
            return None

        # Update price extremes for trailing stop-loss
        pos.max_price = max(pos.max_price, price)
        pos.min_price = min(pos.min_price, price)

        # Volatility-scaled trailing stop-loss logic
        # If profit exceeds 1x ATR, trigger trailing stop at 1x ATR from the best price reached
        atr = pos.atr
        if not pos.trail_triggered:
            if pos.direction == "BUY" and (pos.max_price - pos.entry_price) >= atr:
                pos.trail_triggered = True
                new_sl = pos.max_price - atr
                pos.stop_loss = max(pos.stop_loss, new_sl)
                self._log(f"Trailing stop-loss activated at {pos.stop_loss:.2f} (1x ATR profit hit)")
            elif pos.direction == "SELL" and (pos.entry_price - pos.min_price) >= atr:
                pos.trail_triggered = True
                new_sl = pos.min_price + atr
                pos.stop_loss = min(pos.stop_loss, new_sl)
                self._log(f"Trailing stop-loss activated at {pos.stop_loss:.2f} (1x ATR profit hit)")
        else:
            # Update trailing stop on subsequent favorable price moves
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
            self.state.position = None  # eligible for re-entry subject to gates
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
        # Preserve historical windows across day boundaries for continuity
        close_window = self.state.close_window
        high_window = self.state.high_window
        low_window = self.state.low_window
        tr_window = self.state.tr_window
        prev_close = self.state.prev_close
        
        self.state = PerDayState()
        self.state.close_window = close_window
        self.state.high_window = high_window
        self.state.low_window = low_window
        self.state.tr_window = tr_window
        self.state.prev_close = prev_close

    def _in_warmup(self) -> bool:
        # If windows are already populated from prior day, no warmup is needed
        lookback = int(self._cfg("lookback", 20))
        return len(self.state.close_window) < lookback

    def _entries_allowed(self, t: datetime.time) -> bool:
        if t >= self._cfg_time("no_new_entry", "12:30:00"):
            return False
        if t >= self._cfg_time("session_close", "15:20:00"):
            return False
        # Filter out midday lunch lull (11:30 - 13:30)
        lull_start = datetime.time(11, 30)
        lull_end = datetime.time(13, 30)
        if lull_start <= t < lull_end:
            return False
        return True

    def _should_square_off(self, t: datetime.time) -> bool:
        if self.state.position is None or not self.state.position.is_open:
            return False
        return t >= self._cfg_time("square_off", "15:15:00")

    def _within_risk(self, entry: float, stop: float) -> bool:
        capital = float(self._cfg("capital", 100000.0))
        is_dynamic = self._cfg("dynamic_position_sizing", False) or self._cfg("dynamic_sizing", False) or True
        quantity = 1 if is_dynamic else int(self._cfg("quantity", 1))
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
            quantity=int(self._cfg("quantity", 1)),
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
            price=0.0,          # market order
            stop=0.0,
            target=0.0,
            confidence=1.0,
        )
        pos.is_open = False
        self.state.position = None
        return sig

    # =====================================================================
    # Squeeze-specific calculations
    # =====================================================================

    @staticmethod
    def _ema(values: np.ndarray, period: int) -> float:
        alpha = 2.0 / (period + 1.0)
        ema = float(values[0])
        for x in values[1:]:
            ema = alpha * float(x) + (1.0 - alpha) * ema
        return ema

    def _update_indicators(self, candle: dict, t: datetime.time) -> None:
        st = self.state
        lookback = int(self._cfg("lookback", 20))

        high = float(candle["high"])
        low = float(candle["low"])
        close = float(candle["close"])

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

        # 2. True Range + rolling ATR window (14-period standard window)
        if st.prev_close is None:
            tr = high - low
        else:
            tr = max(high - low, abs(high - st.prev_close), abs(low - st.prev_close))
        st.tr_window.append(tr)
        while len(st.tr_window) > 14:
            st.tr_window.popleft()

        # Update indicators close window
        st.close_window.append(close)
        while len(st.close_window) > lookback:
            st.close_window.popleft()

        st.high_window.append(high)
        while len(st.high_window) > lookback:
            st.high_window.popleft()

        st.low_window.append(low)
        while len(st.low_window) > lookback:
            st.low_window.popleft()

        # Update ATR
        st.atr = sum(st.tr_window) / len(st.tr_window) if st.tr_window else 0.0

        # Squeeze Detection State Machine
        st.prev_squeeze = st.is_squeeze
        st.is_squeeze = False

        if len(st.close_window) >= lookback:
            closes = np.asarray(st.close_window, dtype=float)
            highs = np.asarray(st.high_window, dtype=float)
            lows = np.asarray(st.low_window, dtype=float)
            
            bb_std = float(self._cfg("bb_std", 2.0))
            kc_multiplier = float(self._cfg("kc_multiplier", 1.5))

            # Bollinger Bands
            mean = float(np.mean(closes))
            std = float(np.std(closes, ddof=0))
            bb_upper = mean + bb_std * std
            bb_lower = mean - bb_std * std

            # Keltner Channels
            ema = self._ema(closes, lookback)
            kc_upper = ema + kc_multiplier * st.atr
            kc_lower = ema - kc_multiplier * st.atr

            # Squeeze Classifer
            st.is_squeeze = (bb_upper < kc_upper) and (bb_lower > kc_lower)

            # Momentum Histogram: close - midpoint(highest_high, lowest_low) over lookback
            highest_high = float(np.max(highs))
            lowest_low = float(np.min(lows))
            midpoint = 0.5 * (highest_high + lowest_low)
            st.momentum_hist = close - midpoint

        # Accumulate squeeze state metrics
        if st.is_squeeze:
            if not st.prev_squeeze:
                # Squeeze started today
                st.squeeze_seen = True
                st.squeeze_duration = 1
                st.squeeze_low = low
                st.squeeze_high = high
            else:
                st.squeeze_duration += 1
                st.squeeze_low = min(st.squeeze_low, low) if st.squeeze_low is not None else low
                st.squeeze_high = max(st.squeeze_high, high) if st.squeeze_high is not None else high

        st.prev_close = close

    def _decide(
        self, candle: dict, t: datetime.time
    ) -> Optional[Tuple[str, float, float, float, float]]:
        """Volatility Squeeze Breakout v2 Decision rules:
        - Must have a squeeze coiling for >= 6 bars earlier today (min_squeeze_duration).
        - Breakout triggers only on squeeze release (is_squeeze is False while prev_squeeze was True).
        - Breakout direction is filtered by momentum histogram direction.
        - Long breakout: Close > squeeze_high and Momentum > 0.
        - Short breakout: Close < squeeze_low and Momentum < 0.
        """
        st = self.state
        lookback = int(self._cfg("lookback", 20))
        min_duration = int(self._cfg("min_squeeze_duration", 6))

        if len(st.close_window) < lookback:
            return None

        # Squeeze must have occurred today, and must have been released on the current candle
        if not st.squeeze_seen or st.squeeze_low is None or st.squeeze_high is None:
            return None

        # Trigger ONLY on squeeze release candle (transition from squeeze to no-squeeze)
        squeeze_release = (not st.is_squeeze) and st.prev_squeeze
        if not squeeze_release:
            return None

        # Check squeeze duration constraint
        if st.squeeze_duration < min_duration:
            self._log(f"Squeeze released but duration ({st.squeeze_duration}) was below minimum ({min_duration})")
            return None

        close = float(candle["close"])
        eff_open = st.effective_open if st.effective_open is not None else close
        confidence = float(self._cfg("confidence", 0.6))
        
        # Volatility-scaled exit spacing
        atr = st.atr if st.atr > 0.0 else 0.001 * close

        # Long breakout: close above squeeze range high with positive momentum histogram bias
        if close > st.squeeze_high and close > eff_open and st.momentum_hist > 0:
            stop = st.squeeze_low
            # Protection against extremely large breakout bar making stop loss negative or wrong-side
            if stop >= close:
                stop = close - (1.5 * atr)
            # Guarantee 1.5x R:R relative to the technical stop distance
            target = close + 1.5 * (close - stop)
            self._log(f"Volatility Squeeze v2 LONG breakout. Squeeze duration={st.squeeze_duration}. Exit SL={stop:.2f}, Target={target:.2f}")
            return ("BUY", close, stop, target, confidence)

        # Short breakout: close below squeeze range low with negative momentum histogram bias
        if close < st.squeeze_low and close < eff_open and st.momentum_hist < 0:
            stop = st.squeeze_high
            if stop <= close:
                stop = close + (1.5 * atr)
            # Guarantee 1.5x R:R relative to the technical stop distance
            target = close - 1.5 * (stop - close)
            self._log(f"Volatility Squeeze v2 SHORT breakout. Squeeze duration={st.squeeze_duration}. Exit SL={stop:.2f}, Target={target:.2f}")
            return ("SELL", close, stop, target, confidence)

        return None
