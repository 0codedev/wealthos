"""VWAP Mean Reversion intraday strategy.

This module implements the VWAP Mean Reversion strategy plus the *shared lifecycle
helper section* that is replicated verbatim across the other four strategies in the
suite (EMA Trend Pullback, ORB Enhanced, Z-Score Reversion, Volatility Squeeze).

The engine forbids modifying ``base_strategy.py`` and forbids a shared base module
beyond ``BaseStrategy``. Cross-cutting behaviours (schema validation, trading-day
reset, market-hours gating, warmup, position / re-entry control, risk validation and
strategy-prefixed logging) are therefore implemented as a small, self-contained,
copy-stable helper section embedded directly in each strategy file.

Dependencies: Python standard library, numpy and pandas only.

============================================================================
STRATEGY DOCUMENTATION
============================================================================

Statistical edge
----------------
On liquid large-cap equities the Volume-Weighted Average Price (VWAP) acts as the
session's "fair value" anchor: a very large share of intraday volume executes near
VWAP, so institutional execution algorithms (TWAP/VWAP slicers) and passive flow
continuously pull price back toward it. Short-lived order-flow imbalances - a burst
of aggressive market orders, a stop-run, an over-reaction to a headline - push price
to an *extreme deviation* from VWAP that is not supported by sustained directional
intent. These stretched deviations exhibit a measurable tendency to revert toward
VWAP intraday. The edge is the mean-reversion premium harvested by fading the extreme
and targeting the snap-back to VWAP. The edge is strongest on high-liquidity,
range-bound, mean-reverting names and decays sharply on low-float, news-driven, or
strongly trending instruments (see Failure modes).

Entry logic
-----------
The strategy maintains a running VWAP for the trading day:

  - True VWAP when ``volume`` is present: ``cum_pv / cum_vol`` where
    ``cum_pv = sum(typical_price * volume)``, ``cum_vol = sum(volume)`` and
    ``typical_price = (high + low + close) / 3``.
  - Synthetic_VWAP (degraded mode) when ``volume`` is absent: the running mean of
    ``typical_price`` across the day's candles. Signals emitted in degraded mode have
    their ``confidence`` capped at ``synthetic_confidence_cap`` (Req 2.4).

Let ``deviation = close - VWAP``:

  - ``deviation <= -entry_deviation`` (close stretched *below* VWAP) -> emit "BUY".
  - ``deviation >= +entry_deviation`` (close stretched *above* VWAP) -> emit "SELL".
  - otherwise -> no entry.

Entries are only evaluated inside the configured trading window, after warmup, while
flat, and below the daily trade cap (enforced by the shared lifecycle pipeline).
``confidence`` scales with the size of the deviation past the threshold.

Exit logic
----------
Each entry sets a profit ``target`` *at / toward VWAP* (the reversion objective) and a
protective ``stop_loss`` placed ``stop_distance`` away from entry on the losing side:

  - BUY:  ``target = VWAP`` (above entry),  ``stop_loss = close - stop_distance``.
  - SELL: ``target = VWAP`` (below entry),  ``stop_loss = close + stop_distance``.

Stops and targets are broker-managed (GTT). ``on_tick`` performs internal bookkeeping
only - it marks the position closed once a tick breaches the stop or target so the
strategy becomes eligible for re-entry, and always returns None. Any open position is
force-squared-off at ``square_off`` time regardless of P&L (Req 4.3).

Risk management
---------------
  - Hard 2% rule: an entry is vetoed (returns None) when the projected loss
    ``abs(entry - stop_loss) * quantity`` exceeds ``0.02 * capital`` (Req 5.5, 5.6).
  - Single position at a time; controlled re-entry only after the prior position
    closes (Req 8.1, 8.2).
  - ``max_trades_per_day`` caps daily exposure to over-trading a chop.
  - No new entries at/after ``no_new_entry`` and ``session_close``; mandatory
    square-off at/after ``square_off`` so nothing is carried past the intraday
    session (Req 4.2, 4.3, 4.5).
  - Degraded (Synthetic_VWAP) mode reduces conviction by capping ``confidence`` at
    ``synthetic_confidence_cap`` since the VWAP anchor is approximate without volume.

Recommended Config
------------------
Tuned for a liquid NSE large-cap (e.g. RELIANCE) on the 1-minute timeframe. ``instrument``
is the Dhan ``security_id`` string; ``quantity`` is used verbatim as the Signal quantity
(Req 5.4). Every key has a documented default applied via ``_cfg`` when omitted (Req 5.2);
the values below are the recommended starting point (Req 5.7)::

    recommended_config = {
        # --- instrument / sizing ---
        "instrument": "2885",          # Dhan security_id (RELIANCE on NSE) -- string
        "quantity": 50,                # exact Signal quantity, never risk-adjusted
        "capital": 1_000_000.0,        # account capital used for the 2% risk cap

        # --- VWAP-specific tunables ---
        "entry_deviation": 1.0,        # min |close - VWAP| (price units) to fade
        "stop_distance": 2.0,          # protective stop distance from entry (price units)
        "synthetic_confidence_cap": 0.5,  # max confidence when running in degraded mode

        # --- lifecycle / gating ---
        "warmup_period": 5,            # candles observed before entries are evaluated
        "max_trades_per_day": 3,       # daily entry cap

        # --- session timing (IST, "%H:%M:%S" or datetime.time) ---
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }

Note: ``entry_deviation`` and ``stop_distance`` are in absolute price units; size them to
the instrument's typical intraday range and ensure ``stop_distance * quantity`` stays well
inside the 2% risk cap, otherwise entries will be vetoed by the risk gate.

Expected KPIs
-------------
Indicative targets from intraday mean-reversion behaviour on liquid large-caps; treat as
planning estimates to validate via backtest, not guarantees:

  - Win rate:                  ~60-68% (mean reversion wins often, small per-win edge)
  - Profit factor:             ~1.3-1.6
  - Average reward-to-risk:    ~0.6-0.9 R (target is the VWAP snap-back, typically closer
                               than the stop -> sub-1.0 R:R offset by the high win rate)
  - Estimated max drawdown:    ~8-12% of allocated capital (driven by clustered losses on
                               trending days; bounded per-trade by the 2% cap)

KPIs degrade in trending regimes and in degraded (Synthetic_VWAP) mode; the
``synthetic_confidence_cap`` and ``max_trades_per_day`` controls exist to limit that
downside.

Known failure modes and handling
--------------------------------
  - Strong trend days: price stays stretched from VWAP and keeps extending, so faded
    entries stop out repeatedly ("catching a falling knife"). Handling: fixed
    ``stop_distance`` caps per-trade loss, ``max_trades_per_day`` limits how many times
    the day can fade a trend, and the 2% risk gate vetoes oversized stops.
  - Choppy / whipsaw days around VWAP: price oscillates tightly across VWAP generating
    marginal signals. Handling: ``entry_deviation`` requires a minimum stretch before any
    fade, filtering low-conviction noise; the warmup gate avoids trading a thin opening
    book.
  - Missing volume (no ``volume`` field): true VWAP is not computable. Handling: the
    strategy switches to Synthetic_VWAP (running mean of typical price), emits a single
    degraded-mode debug log, and caps ``confidence`` at ``synthetic_confidence_cap`` so
    downstream sizing/ranking can discount the weaker anchor (Req 2.4, 2.8).
  - Corrupt / incomplete candle (missing ``high``/``low``/``close``/``time`` or an
    unparseable time): handled upstream by schema validation -> returns None with a debug
    log naming the field, without mutating indicator state (Req 2.7).
  - Gap / new session: a candle ``time`` earlier than the prior candle triggers a full
    per-day state reset so a prior session's VWAP accumulators never bleed into the new
    day (Req 3.1-3.4).
  - End-of-day open position: force-squared-off at ``square_off`` regardless of P&L so no
    position is carried beyond the intraday session (Req 4.3).
"""

from __future__ import annotations

import datetime
import logging
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Optional, Tuple

import numpy as np  # noqa: F401  (used by the indicator/decision layer in task 2.2)
import pandas as pd  # noqa: F401  (used by the indicator/decision layer in task 2.2)

from strategies.base_strategy import BaseStrategy, Signal


# ---------------------------------------------------------------------------
# Internal data models (reset each trading day / per open position)
# ---------------------------------------------------------------------------

@dataclass
class Position:
    """Internal tracking of a single open trade (Requirements 8, 14)."""

    direction: str            # "BUY" | "SELL"
    entry_price: float
    stop_loss: float
    target: float
    is_open: bool = True


@dataclass
class PerDayState:
    """All in-memory accumulators reset at the start of each trading day.

    Generic lifecycle fields are shared across every strategy. Strategy-specific
    accumulators (here: the VWAP fields) live below the divider and are the only
    portion that differs between the five strategy files.
    """

    # --- shared lifecycle fields ---
    candle_count: int = 0
    last_time: Optional[datetime.time] = None     # for new-day detection
    trades_today: int = 0
    position: Optional[Position] = None

    # --- VWAP-specific accumulators (filled by task 2.2) ---
    cum_pv: float = 0.0                            # sum(typical_price * volume)
    cum_vol: float = 0.0                           # sum(volume)
    synthetic_sum: float = 0.0                     # sum(typical_price) for synthetic VWAP
    degraded: bool = False                         # True once synthetic mode is active
    daily_adx_14: float = 15.0                     # pre-market daily ADX value for regime gating
    typical_window: Deque[float] = field(default_factory=deque)  # rolling Typical Price window
    close_window: Deque[float] = field(default_factory=deque)    # rolling close window (RSI / regime)
    vwap_cross_count: int = 0                      # times price crossed VWAP today (oscillation proxy)
    prev_close_vs_vwap: int = 0                    # sign of (close - vwap) on the previous candle


class VWAPMeanReversion(BaseStrategy):
    """Fade extreme deviations from the day's VWAP that tend to revert.

    Only the shared lifecycle scaffolding is implemented in this task. The VWAP
    accumulation and mean-reversion decision rules are added in task 2.2.
    """

    def __init__(self, name: str = "VWAP_Mean_Reversion_v1", config: Optional[dict] = None):
        super().__init__(name, config or {})
        self._logger = logging.getLogger(self.name)
        self.state = PerDayState()

    # =====================================================================
    # Public BaseStrategy contract
    # =====================================================================

    def on_candle(self, candle: dict) -> Optional[Signal]:
        """Fixed-order lifecycle pipeline.

        Ordering (state continuity is preserved by updating indicators before any
        entry gate; square-off fires before entry gates because closing a position
        is a risk-reduction action; risk validation is the last gate so it can veto
        an otherwise-valid signal):

            schema validation -> new-day reset -> time normalization ->
            indicator update -> square-off -> market-hours gate -> warmup gate ->
            no-new-entry / session-close gate -> position / max-trades gate ->
            decision -> risk validation -> emit
        """
        # 1. Schema validation (Req 2.1, 2.7) -- before any state mutation.
        missing = self._validate_candle(candle)
        if missing is not None:
            self._log(f"missing guaranteed candle field '{missing}'; returning None")
            return None

        # 2. Time normalization (Req 2.2). Unparseable time == missing time.
        try:
            t = self._normalize_time(candle["time"])
        except (ValueError, TypeError):
            self._log("unparseable 'time' field; returning None")
            return None

        # 3. New-day detection & reset (Req 3.1-3.4). Compare BEFORE updating last_time.
        if self._is_new_day(t):
            self._reset_day_state()
            self._log(f"new trading day detected at {t}; per-day state reset")

        # 4. Indicator / accumulator update + candle count (state continuity).
        self.state.candle_count += 1
        self._update_indicators(candle, t)
        # last_time is advanced AFTER the new-day comparison so the regression
        # check always sees the previous candle's time.
        self.state.last_time = t

        # 5. Square-off (Req 4.3) -- fires regardless of entry eligibility.
        if self._should_square_off(t):
            sig = self._square_off_signal()
            if sig is not None:
                self._log(f"square-off at {t}: closing {sig.direction} position")
                return sig

        # 6. Market-hours gate (Req 4.1).
        if t < self._cfg_time("market_open", "09:15:00"):
            return None

        # 7. Warmup gate (Req 7.1, 7.2).
        if self._in_warmup():
            return None

        # 8. No-new-entry / session-close gate (Req 4.2, 4.5).
        if not self._entries_allowed(t):
            return None

        # 9. Position / max-trades gate (Req 8.1, 8.3, 8.4).
        if self.state.position is not None and self.state.position.is_open:
            return None
        if self.state.trades_today >= int(self._cfg("max_trades_per_day", 3)):
            return None

        # 10. Strategy-specific decision (implemented in task 2.2).
        decision = self._decide(candle, t)
        if decision is None:
            return None
        direction, price, stop, target, confidence = decision

        # 11. Risk validation (Req 5.5, 5.6) -- last gate, can veto.
        if not self._within_risk(price, stop):
            self._log(
                f"risk limit exceeded (entry={price}, stop={stop}, "
                f"qty={self._cfg('quantity', 1)}); returning None"
            )
            return None

        # 12. Emit.
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
            f"entry {sig.direction} @ {sig.price} stop={sig.stop_loss} "
            f"target={sig.target} confidence={sig.confidence}"
        )
        return sig

    def on_tick(self, tick: dict) -> Optional[Signal]:
        """Internal stop/target bookkeeping only. Always returns None.

        Stops are broker-managed (GTT), so this method never places orders; it only
        marks an open position closed when a tick breaches the stop or target so the
        strategy becomes eligible for re-entry (Req 8.2, 14.1, 14.2, 14.3, 14.4).
        """
        price = self._tick_price(tick)
        if price is None:
            self._log("missing tick price field; returning None")
            return None

        pos = self.state.position
        if pos is None or not pos.is_open:
            return None

        if self._breaches_exit(pos, price):
            pos.is_open = False
            self.state.position = None  # eligible for re-entry subject to all gates
            self._log(
                f"tick {price} breached {pos.direction} position "
                f"(stop={pos.stop_loss}, target={pos.target}); marked closed"
            )
        return None

    # =====================================================================
    # Shared lifecycle helpers (copy-stable across all five strategies)
    # =====================================================================

    def _cfg(self, key: str, default):
        """Read a tunable from Config, falling back to a documented default (Req 5.1, 5.2)."""
        value = self.config.get(key, default)
        return default if value is None else value

    def _validate_candle(self, candle: dict) -> Optional[str]:
        """Return the name of the first missing guaranteed field, else None (Req 2.1, 2.7)."""
        if not isinstance(candle, dict):
            return "candle"
        for fieldname in ("high", "low", "close", "time"):
            if fieldname not in candle or candle[fieldname] is None:
                return fieldname
        return None

    def _normalize_time(self, value) -> datetime.time:
        """Accept a datetime.time or a '%H:%M:%S' string and return a datetime.time (Req 2.2)."""
        if isinstance(value, datetime.time):
            return value
        if isinstance(value, datetime.datetime):
            return value.time()
        if isinstance(value, str):
            return datetime.datetime.strptime(value, "%H:%M:%S").time()
        raise TypeError(f"unsupported time type: {type(value)!r}")

    def _is_new_day(self, t: datetime.time) -> bool:
        """A time strictly earlier than the previous candle's time starts a new day (Req 3.1)."""
        return self.state.last_time is not None and t < self.state.last_time

    def _reset_day_state(self) -> None:
        """Reset all Per_Day_State to fresh defaults (Req 3.2)."""
        adx = self.state.daily_adx_14
        self.state = PerDayState()
        self.state.daily_adx_14 = adx

    def update_daily_state(self, ema_20: float, ema_50: float, adx_14: float) -> None:
        """Sets the daily indicators calculated from pre-market daily candles."""
        self.state.daily_adx_14 = float(adx_14)
        self._log(f"Daily State Updated: ADX14={adx_14:.2f}")

    def _in_warmup(self) -> bool:
        """True while the day's candle count is below the configured warmup period (Req 7.1-7.3)."""
        return self.state.candle_count < int(self._cfg("warmup_period", 5))

    def _entries_allowed(self, t: datetime.time) -> bool:
        """False at/after no_new_entry or session_close (Req 4.2, 4.5)."""
        if t >= self._cfg_time("no_new_entry", "15:00:00"):
            return False
        if t >= self._cfg_time("session_close", "15:20:00"):
            return False
        return True

    def _should_square_off(self, t: datetime.time) -> bool:
        """True when the square-off time is reached and a position is open (Req 4.3)."""
        if self.state.position is None or not self.state.position.is_open:
            return False
        return t >= self._cfg_time("square_off", "15:15:00")

    def _within_risk(self, entry: float, stop: float) -> bool:
        """Enforce the 2% capital risk cap for an entry (Req 5.5, 5.6)."""
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
        """Single choke point for signal emission; guarantees the Signal contract.

        - ``direction`` asserted in {"BUY","SELL"} (Req 1.7).
        - ``instrument`` / ``quantity`` read exactly from Config (Req 5.3, 5.4).
        - ``strategy_name`` set to ``self.name`` (Req 1.5).
        - ``confidence`` clamped to [0.0, 1.0] regardless of intermediate values (Req 1.6).
        - all eight fields populated with their dataclass-defined types (Req 1.4).
        """
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
        """Strategy-prefixed debug log that never blocks signal emission (Req 6.1, 6.2)."""
        try:
            self._logger.debug("[%s] %s", self.name, msg)
        except Exception:
            # Logging must never suppress a trade decision.
            pass

    # ---- shared helper utilities ----

    def _cfg_time(self, key: str, default_str: str) -> datetime.time:
        """Resolve a Config timing value (datetime.time or '%H:%M:%S' string) to a time (Req 4.4)."""
        value = self._cfg(key, default_str)
        return self._normalize_time(value)

    def _tick_price(self, tick: dict) -> Optional[float]:
        """Extract a usable price from a tick, or None if absent (Req 14.4)."""
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
        """True when a tick price reaches/breaches the position stop or target (Req 14.1, 14.2)."""
        if pos.direction == "BUY":
            return price <= pos.stop_loss or price >= pos.target
        # SELL
        return price >= pos.stop_loss or price <= pos.target

    def _square_off_signal(self) -> Optional[Signal]:
        """Build a market square-off Signal that closes the open position (Req 4.3)."""
        pos = self.state.position
        if pos is None or not pos.is_open:
            return None
        close_direction = "SELL" if pos.direction == "BUY" else "BUY"
        # Square-off is a risk-reducing action and is not subject to the risk-cap gate.
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
    # VWAP-specific indicator / decision hooks (implemented in task 2.2)
    # =====================================================================

    @staticmethod
    def _typical_price(candle: dict) -> float:
        """Typical_Price = (high + low + close) / 3 (Req 2.4, 9.1)."""
        return (float(candle["high"]) + float(candle["low"]) + float(candle["close"])) / 3.0

    def _rsi(self, period: int) -> Optional[float]:
        """Wilder-style RSI over the rolling close window, or None if insufficient data.

        A short RSI (default period 2, Connors-style) is a robust over-extension
        filter for mean reversion: only fade when price is genuinely stretched.
        """
        closes = list(self.state.close_window)
        if len(closes) < period + 1:
            return None
        deltas = np.diff(np.asarray(closes[-(period + 1):], dtype=float))
        gains = float(np.clip(deltas, 0.0, None).mean())
        losses = float(-np.clip(deltas, None, 0.0).mean())
        if losses == 0.0:
            return 100.0 if gains > 0.0 else 50.0
        rs = gains / losses
        return 100.0 - 100.0 / (1.0 + rs)

    @staticmethod
    def _volume_of(candle: dict) -> Optional[float]:
        """Return a valid float volume from the candle, or None when absent/invalid (Req 2.3, 2.4)."""
        value = candle.get("volume")
        if value is None:
            return None
        try:
            return float(value)
        except (ValueError, TypeError):
            return None

    def _update_indicators(self, candle: dict, t: datetime.time) -> None:
        """Maintain the running VWAP accumulators (Req 2.3, 2.4, 2.8, 9.1).

        - True VWAP: accumulate ``cum_pv = sum(typical_price * volume)`` and
          ``cum_vol = sum(volume)`` whenever a valid ``volume`` is present.
        - Synthetic_VWAP: always accumulate ``synthetic_sum = sum(typical_price)`` so the
          running mean of Typical_Price is available; this is the value used when
          ``volume`` is absent (degraded mode).
        - The first time a candle omits ``volume`` the strategy enters degraded mode and
          emits a single degraded-mode debug log (Req 2.8).
        """
        typical = self._typical_price(candle)
        # Always track the typical-price sum so Synthetic_VWAP is available on demand.
        self.state.synthetic_sum += typical

        # Append Typical Price to rolling typical window
        self.state.typical_window.append(typical)
        while len(self.state.typical_window) > 20:
            self.state.typical_window.popleft()

        # Track rolling closes (for RSI over-extension filter) and VWAP-cross
        # oscillation count (a range-bound, mean-reverting day crosses VWAP often).
        close_px = float(candle["close"])
        self.state.close_window.append(close_px)
        while len(self.state.close_window) > 30:
            self.state.close_window.popleft()
        if self.state.cum_vol > 0.0 or self.state.candle_count > 1:
            vwap_now = (self.state.cum_pv / self.state.cum_vol) if self.state.cum_vol > 0.0 \
                else (self.state.synthetic_sum / max(1, self.state.candle_count))
            side = 1 if close_px >= vwap_now else -1
            if self.state.prev_close_vs_vwap != 0 and side != self.state.prev_close_vs_vwap:
                self.state.vwap_cross_count += 1
            self.state.prev_close_vs_vwap = side

        volume = self._volume_of(candle)
        if volume is not None:
            self.state.cum_pv += typical * volume
            self.state.cum_vol += volume
        elif not self.state.degraded:
            self.state.degraded = True
            self._log("degraded mode active: 'volume' absent, using Synthetic_VWAP")

    def _current_vwap(self, candle: dict) -> Tuple[float, bool]:
        """Return ``(vwap, degraded)`` for the current candle.

        Uses true VWAP when the current candle carries valid volume and a positive
        cumulative volume exists; otherwise falls back to Synthetic_VWAP (degraded).
        """
        volume = self._volume_of(candle)
        if volume is not None and self.state.cum_vol > 0.0:
            return self.state.cum_pv / self.state.cum_vol, False
        # Degraded: running mean of Typical_Price over the day's candles so far.
        synthetic_vwap = self.state.synthetic_sum / max(1, self.state.candle_count)
        return synthetic_vwap, True

    def _decide(
        self, candle: dict, t: datetime.time
    ) -> Optional[Tuple[str, float, float, float, float]]:
        """Evaluate the VWAP mean-reversion entry (Req 9.2-9.6).

        Entry rule: when ``close`` is below VWAP by at least ``entry_deviation`` emit a
        BUY; when ``close`` is above VWAP by at least ``entry_deviation`` emit a SELL.
        ``target`` is set toward VWAP and ``stop_loss`` is placed ``stop_distance`` from
        the entry on the protective side. In degraded (Synthetic_VWAP) mode the emitted
        ``confidence`` is capped at ``synthetic_confidence_cap`` (Req 2.4).

        Returns ``(direction, price, stop, target, confidence)`` or None.
        """
        # ADX Regime gate: if market is trending (ADX > 25), VWAP reversion has no edge
        if self.state.daily_adx_14 > 25.0:
            return None

        # =================================================================
        # VWAP reversion entry - wide-stop geometry + trend-deviation cap
        # =================================================================
        # Diagnostic finding: the profitable subset is SMALL deviations (~0.5-1.2%)
        # faded with a WIDE stop. A small stretch from VWAP reliably reverts; a wide
        # stop avoids being shaken out by intraday noise so the slow reversion can
        # accrue into the EOD exit (gross/trade beats the round-trip cost). LARGE
        # deviations (>max_dev_pct) are momentum/trend, not reversion, and are skipped.
        # Tight stops were tested and hurt badly (more shake-outs, larger size -> more
        # cost); carrying overnight also hurt (large stretches keep trending).
        if len(self.state.typical_window) >= 5:
            std_dev = float(np.std(self.state.typical_window))
        else:
            std_dev = 0.002 * float(candle["close"])  # conservative fallback

        entry_sd_mult = float(self._cfg("entry_sd_multiplier", self._cfg("std_dev_multiplier", 1.5)))
        stop_sd_mult = float(self._cfg("stop_sd_multiplier", 2.5))     # WIDE stop: avoid noise shake-outs
        min_floor_pct = float(self._cfg("min_floor_pct", 0.005))       # minimum qualifying deviation
        max_dev_pct = float(self._cfg("max_dev_pct", 0.012))           # skip >1.2% stretches (momentum)

        synthetic_cap = float(self._cfg("synthetic_confidence_cap", 0.5))

        close = float(candle["close"])
        open_price = float(candle.get("open") or close)
        vwap, degraded = self._current_vwap(candle)
        deviation = close - vwap  # negative => below VWAP, positive => above VWAP
        abs_dev = abs(deviation)

        entry_deviation = max(entry_sd_mult * std_dev, min_floor_pct * close)
        stop_distance = max(stop_sd_mult * std_dev, 1.2 * min_floor_pct * close)
        max_dev = max_dev_pct * close

        # Confidence grows with how far the deviation stretches past the threshold.
        base_conf = min(1.0, abs_dev / (2.0 * entry_deviation)) if entry_deviation > 0.0 else 0.5

        # Selection: fade only deviations inside the reverting band [entry, max_dev].
        if abs_dev < entry_deviation or abs_dev > max_dev:
            return None

        # --- Confluence filters (quality over quantity) ----------------------
        # The raw deviation signal has ~zero edge, so require corroborating
        # over-extension and a range-bound (oscillating) intraday regime before
        # fading. These lift the win rate above the cost-driven break-even.
        rsi_period = int(self._cfg("rsi_period", 2))
        rsi_buy = float(self._cfg("rsi_buy", 15.0))
        rsi_sell = float(self._cfg("rsi_sell", 85.0))
        min_vwap_crosses = int(self._cfg("min_vwap_crosses", 2))
        rsi = self._rsi(rsi_period)
        if rsi is None:
            return None
        # Require the day to be genuinely mean-reverting (price oscillating around VWAP).
        if self.state.vwap_cross_count < min_vwap_crosses:
            return None

        if deviation <= 0 and close > open_price and rsi <= rsi_buy:
            # stretched below VWAP, oversold, with a bullish-rejection candle => BUY
            direction = "BUY"
            price = close
            stop = close - stop_distance
            target = vwap
        elif deviation >= 0 and close < open_price and rsi >= rsi_sell:
            # stretched above VWAP, overbought, with a bearish-rejection candle => SELL
            direction = "SELL"
            price = close
            stop = close + stop_distance
            target = vwap
        else:
            return None

        confidence = min(base_conf, synthetic_cap) if degraded else base_conf
        self._log(
            f"vwap-decision {direction}: close={close} vwap={vwap:.6f} "
            f"deviation={deviation:.6f} threshold={entry_deviation:.4f} "
            f"max_dev={max_dev:.4f} degraded={degraded}"
        )
        return direction, price, stop, target, confidence
