"""Statistical Pairs Arbitrage strategy.

This module implements S3: Statistical Pairs Arbitrage strategy with:
- Log-spread z-score calculation (20-period lookback)
- Variance-ratio cointegration check (surrogate for ADF test)
- Dual-symbol feed via structured composite candle input
- Simultaneous output of two Signal objects (one BUY, one SELL)
- Real-time tick monitoring of z-score for exits
- Standard lifecycle helper section matching the WealthOS algo engine conventions
"""

from __future__ import annotations

import datetime
import logging
import math
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Optional, Tuple, List

import numpy as np

from strategies.base_strategy import BaseStrategy, Signal


@dataclass
class Position:
    """Internal tracking of an active pairs arbitrage trade (Requirement 8, 14)."""

    pair_type: str            # "LONG_PAIR" (Long A, Short B) | "SHORT_PAIR" (Short A, Long B)
    entry_time: datetime.datetime
    entry_price_a: float
    entry_price_b: float
    qty_a: int
    qty_b: int
    entry_z: float
    is_open: bool = True
    candle_age: int = 0       # Track trade duration in bars


@dataclass
class PerDayState:
    """All in-memory accumulators reset at the start of each trading day."""

    # --- shared lifecycle fields ---
    candle_count: int = 0
    last_time: Optional[datetime.time] = None     # for new-day detection
    trades_today: int = 0
    position: Optional[Position] = None

    # --- Pairs-specific accumulators ---
    spread_window: Deque[float] = field(default_factory=deque)     # rolling window of log-spreads
    prev_close_a: Optional[float] = None
    prev_close_b: Optional[float] = None
    last_price_a: Optional[float] = None          # last tick/candle price of symbol A
    last_price_b: Optional[float] = None          # last tick/candle price of symbol B
    
    current_z: float = 0.0
    rolling_mean: float = 0.0
    rolling_std: float = 0.0


class PairsArbitrage(BaseStrategy):
    """Statistical Pairs Arbitrage Strategy."""

    def __init__(self, config: Optional[dict] = None):
        super().__init__("Pairs_Arbitrage_v1", config or {})
        self._logger = logging.getLogger(self.name)
        self.state = PerDayState()
        
        # Load configuration options
        self.symbol_a = self._cfg("symbol_a", "TCS")
        self.symbol_b = self._cfg("symbol_b", "INFY")
        self.instrument_a = self._cfg("security_id_a", "11536")
        self.instrument_b = self._cfg("security_id_b", "3506")
        self.lookback = int(self._cfg("lookback", 20))
        self.z_entry = float(self._cfg("z_entry", 2.0))
        self.z_exit = float(self._cfg("z_exit", 0.0))
        self.z_stop = float(self._cfg("z_stop", 3.5))
        self.capital_allocation = float(self._cfg("capital_allocation", 0.25))
        self.capital = float(self._cfg("capital", 1000000.0))

    # =====================================================================
    # Public BaseStrategy contract
    # =====================================================================

    def on_candle(self, candle: dict) -> Optional[List[Signal]]:
        """Dual-candle entry lifecycle pipeline.
        
        Accepts composite candle format:
        candle = {
            "symbol_a": candle_a_dict,
            "symbol_b": candle_b_dict,
            "time": time_val
        }
        """
        # 1. Validate composite candle structure
        if not isinstance(candle, dict) or "symbol_a" not in candle or "symbol_b" not in candle:
            self._log("invalid composite candle dictionary; returning None")
            return None

        candle_a = candle["symbol_a"]
        candle_b = candle["symbol_b"]

        # Validate sub-candles
        for suffix, sub_c in [("A", candle_a), ("B", candle_b)]:
            missing = self._validate_candle(sub_c)
            if missing is not None:
                self._log(f"missing candle {suffix} field '{missing}'; returning None")
                return None

        # 2. Time normalization
        try:
            t = self._normalize_time(candle.get("time") or candle_a["time"])
        except (ValueError, TypeError):
            self._log("unparseable 'time' field; returning None")
            return None

        # 3. New-day detection & reset
        if self._is_new_day(t):
            self._reset_day_state()
            self._log(f"new trading day detected at {t}; per-day state reset")

        # 4. Update indicators and trackers
        self.state.candle_count += 1
        self._update_indicators(candle_a, candle_b, t)
        self.state.last_time = t

        # Increment open position duration
        if self.state.position is not None and self.state.position.is_open:
            self.state.position.candle_age += 1

        # 5. End of day square-off gating (EOD square off)
        if self._should_square_off(t):
            sigs = self._square_off_signal()
            if sigs:
                self._log(f"square-off at {t}: closing open pair position")
                return sigs

        # 6. Market-hours gate
        if t < self._cfg_time("market_open", "09:15:00"):
            return None

        # 7. Warmup gate (need enough candles to populate rolling spread statistics)
        if self._in_warmup():
            return None

        # 8. No-new-entry / session-close gate
        if not self._entries_allowed(t):
            return None

        # 9. Check if we already have an open position or have breached the daily trade limit
        if self.state.position is not None and self.state.position.is_open:
            # Evaluate exiting based on candle close z-score
            sigs = self._check_candle_exits(t)
            if sigs:
                return sigs
            return None

        if self.state.trades_today >= int(self._cfg("max_trades_per_day", 3)):
            return None

        # 10. Strategy-specific entry decision
        decision = self._decide(candle_a, candle_b, t)
        if decision is None:
            return None

        pair_type, confidence = decision

        # 11. Emit simultaneous BUY and SELL Signals
        close_a = float(candle_a["close"])
        close_b = float(candle_b["close"])
        
        # rupeenotional per leg (25% of capital by default)
        leg_notional = self.capital * self.capital_allocation
        qty_a = max(1, int(leg_notional / close_a))
        qty_b = max(1, int(leg_notional / close_b))

        signals = []
        if pair_type == "LONG_PAIR":
            # Buy underperformer A, Sell outperformer B
            sig_a = self._make_leg_signal("BUY", self.symbol_a, self.instrument_a, qty_a, close_a, confidence)
            sig_b = self._make_leg_signal("SELL", self.symbol_b, self.instrument_b, qty_b, close_b, confidence)
            signals = [sig_a, sig_b]
        elif pair_type == "SHORT_PAIR":
            # Sell outperformer A, Buy underperformer B
            sig_a = self._make_leg_signal("SELL", self.symbol_a, self.instrument_a, qty_a, close_a, confidence)
            sig_b = self._make_leg_signal("BUY", self.symbol_b, self.instrument_b, qty_b, close_b, confidence)
            signals = [sig_a, sig_b]

        if signals:
            self.state.position = Position(
                pair_type=pair_type,
                entry_time=datetime.datetime.combine(datetime.date.today(), t),
                entry_price_a=close_a,
                entry_price_b=close_b,
                qty_a=qty_a,
                qty_b=qty_b,
                entry_z=self.state.current_z,
                is_open=True,
                candle_age=0
            )
            self.state.trades_today += 1
            self._log(f"Pairs entry: {pair_type} z-score={self.state.current_z:.2f} TCS_qty={qty_a} INFY_qty={qty_b}")
            return signals

        return None

    def on_tick(self, tick: dict) -> Optional[List[Signal]]:
        """Real-time z-score monitoring for exit triggers. Returns closing signals when breached."""
        if not isinstance(tick, dict):
            return None

        # Extract symbol/instrument
        symbol = tick.get("symbol") or tick.get("instrument")
        price = self._tick_price(tick)
        if symbol is None or price is None:
            return None

        # Update last price cache
        if str(symbol) == str(self.symbol_a) or str(symbol) == str(self.instrument_a):
            self.state.last_price_a = price
        elif str(symbol) == str(self.symbol_b) or str(symbol) == str(self.instrument_b):
            self.state.last_price_b = price

        pos = self.state.position
        if pos is None or not pos.is_open:
            return None

        # We need tick prices for both symbols to calculate real-time z-score
        price_a = self.state.last_price_a
        price_b = self.state.last_price_b
        if price_a is None or price_b is None:
            return None

        # Compute z-score dynamically using rolling mean and standard deviation from candle close
        std_dev = self.state.rolling_std
        if std_dev <= 0:
            return None

        spread = math.log(price_a) - math.log(price_b)
        z = (spread - self.state.rolling_mean) / std_dev

        # Exit criteria checks
        should_exit = False
        exit_reason = ""

        if pos.pair_type == "LONG_PAIR":
            if z >= self.z_exit:
                should_exit = True
                exit_reason = "REVERSION_TO_MEAN"
            elif z <= -self.z_stop:
                should_exit = True
                exit_reason = "STOP_LOSS"
        elif pos.pair_type == "SHORT_PAIR":
            if z <= self.z_exit:
                should_exit = True
                exit_reason = "REVERSION_TO_MEAN"
            elif z >= self.z_stop:
                should_exit = True
                exit_reason = "STOP_LOSS"

        # Check maximum holding period (5 trading days / equivalent bars)
        # Assuming 25 15-minute bars per day, 5 days = 125 bars
        if pos.candle_age >= 125:
            should_exit = True
            exit_reason = "MAX_HOLDING_AGE"

        if should_exit:
            self._log(f"Real-time pair exit triggered ({exit_reason}) at z-score={z:.2f}")
            pos.is_open = False
            self.state.position = None
            
            # Generate offsetting signals
            sig_a_dir = "SELL" if pos.pair_type == "LONG_PAIR" else "BUY"
            sig_b_dir = "BUY" if pos.pair_type == "LONG_PAIR" else "SELL"

            sig_a = self._make_leg_signal(sig_a_dir, self.symbol_a, self.instrument_a, pos.qty_a, price_a, 1.0)
            sig_b = self._make_leg_signal(sig_b_dir, self.symbol_b, self.instrument_b, pos.qty_b, price_b, 1.0)
            return [sig_a, sig_b]

        return None

    # =====================================================================
    # Indicators and Calculations
    # =====================================================================

    def _update_indicators(self, candle_a: dict, candle_b: dict, t: datetime.time) -> None:
        st = self.state

        close_a = float(candle_a["close"])
        close_b = float(candle_b["close"])

        st.last_price_a = close_a
        st.last_price_b = close_b

        # Calculate log-spread: log(close_a) - log(close_b)
        spread = math.log(close_a) - math.log(close_b)
        st.spread_window.append(spread)
        while len(st.spread_window) > self.lookback:
            st.spread_window.popleft()

        # Update mean and standard deviation
        if len(st.spread_window) >= self.lookback:
            spreads = np.array(st.spread_window, dtype=float)
            st.rolling_mean = float(np.mean(spreads))
            st.rolling_std = float(np.std(spreads, ddof=0))
            
            if st.rolling_std > 0:
                st.current_z = (spread - st.rolling_mean) / st.rolling_std
            else:
                st.current_z = 0.0

        st.prev_close_a = close_a
        st.prev_close_b = close_b

    def _variance_ratio_check(self) -> bool:
        """Surrogate ADF test using variance-ratio heuristic.
        Checks if the log spread is mean-reverting (variance ratio < 0.85).
        """
        st = self.state
        if len(st.spread_window) < self.lookback:
            return True # Not enough data, default to true

        spreads = list(st.spread_window)
        # Compute 1-step difference variance
        diffs_1 = [spreads[i] - spreads[i-1] for i in range(1, len(spreads))]
        var_1 = np.var(diffs_1) if diffs_1 else 0.0
        
        # Compute 4-step difference variance
        diffs_4 = [spreads[i] - spreads[i-4] for i in range(4, len(spreads))]
        var_4 = np.var(diffs_4) if diffs_4 else 0.0

        if var_1 <= 0 or var_4 <= 0:
            return True

        # For a random walk, var_4 should be ~4 * var_1
        # For mean reversion, var_4 / (4 * var_1) < 1.0
        ratio = var_4 / (4.0 * var_1)
        
        self._log(f"Variance Ratio (ADF Surrogate): {ratio:.2f}")
        return ratio < 0.85

    def _decide(
        self, candle_a: dict, candle_b: dict, t: datetime.time
    ) -> Optional[Tuple[str, float]]:
        """Evaluate entry criteria based on current Z-Score and Cointegration check."""
        st = self.state

        if len(st.spread_window) < self.lookback:
            return None

        # Cointegration check (variance ratio heuristic)
        if not self._variance_ratio_check():
            self._log(f"Entry vetoed: Log spread not cointegrated (failed variance ratio test)")
            return None

        z = st.current_z
        confidence = 0.7

        # Long Pair: spread falls below -2.0 -> Buy underperformer A, Sell outperformer B
        if z < -self.z_entry:
            return ("LONG_PAIR", confidence)

        # Short Pair: spread rises above +2.0 -> Sell outperformer A, Buy underperformer B
        if z > self.z_entry:
            return ("SHORT_PAIR", confidence)

        return None

    def _check_candle_exits(self, t: datetime.time) -> Optional[List[Signal]]:
        """Checks target/stop loss exits on candle close."""
        pos = self.state.position
        if pos is None or not pos.is_open:
            return None

        z = self.state.current_z
        should_exit = False
        exit_reason = ""

        if pos.pair_type == "LONG_PAIR":
            if z >= self.z_exit:
                should_exit = True
                exit_reason = "REVERSION_TO_MEAN"
            elif z <= -self.z_stop:
                should_exit = True
                exit_reason = "STOP_LOSS"
        elif pos.pair_type == "SHORT_PAIR":
            if z <= self.z_exit:
                should_exit = True
                exit_reason = "REVERSION_TO_MEAN"
            elif z >= self.z_stop:
                should_exit = True
                exit_reason = "STOP_LOSS"

        if pos.candle_age >= 125: # 5 days max
            should_exit = True
            exit_reason = "MAX_HOLDING_AGE"

        if should_exit:
            self._log(f"Candle pair exit triggered ({exit_reason}) at z-score={z:.2f}")
            pos.is_open = False
            self.state.position = None
            
            price_a = self.state.last_price_a or pos.entry_price_a
            price_b = self.state.last_price_b or pos.entry_price_b

            sig_a_dir = "SELL" if pos.pair_type == "LONG_PAIR" else "BUY"
            sig_b_dir = "BUY" if pos.pair_type == "LONG_PAIR" else "SELL"

            sig_a = self._make_leg_signal(sig_a_dir, self.symbol_a, self.instrument_a, pos.qty_a, price_a, 1.0)
            sig_b = self._make_leg_signal(sig_b_dir, self.symbol_b, self.instrument_b, pos.qty_b, price_b, 1.0)
            return [sig_a, sig_b]

        return None

    # =====================================================================
    # Lifecyle Scaffolding
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
        self.state = PerDayState()

    def _in_warmup(self) -> bool:
        return self.state.candle_count < self.lookback

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
        # Pairs trading risk is managed by allocation size, always returns True
        return True

    def _make_leg_signal(
        self,
        direction: str,
        symbol: str,
        instrument: str,
        qty: int,
        price: float,
        confidence: float
    ) -> Signal:
        return Signal(
            direction=direction,
            instrument=str(instrument),
            quantity=qty,
            price=price,
            stop_loss=0.0,      # Dynamic exit monitored internally
            target=0.0,         # Dynamic exit monitored internally
            strategy_name=self.name,
            confidence=float(max(0.0, min(1.0, float(confidence))))
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

    def _square_off_signal(self) -> Optional[List[Signal]]:
        pos = self.state.position
        if pos is None or not pos.is_open:
            return None
        
        price_a = self.state.last_price_a or pos.entry_price_a
        price_b = self.state.last_price_b or pos.entry_price_b

        sig_a_dir = "SELL" if pos.pair_type == "LONG_PAIR" else "BUY"
        sig_b_dir = "BUY" if pos.pair_type == "LONG_PAIR" else "SELL"

        sig_a = self._make_leg_signal(sig_a_dir, self.symbol_a, self.instrument_a, pos.qty_a, price_a, 1.0)
        sig_b = self._make_leg_signal(sig_b_dir, self.symbol_b, self.instrument_b, pos.qty_b, price_b, 1.0)
        
        pos.is_open = False
        self.state.position = None
        return [sig_a, sig_b]
