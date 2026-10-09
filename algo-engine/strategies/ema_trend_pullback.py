"""EMA Trend Pullback intraday strategy.

This module implements the EMA Trend Pullback strategy plus the *shared lifecycle
helper section* that is replicated verbatim across the other four strategies in the
suite (VWAP Mean Reversion, ORB Enhanced, Z-Score Reversion, Volatility Squeeze).

The engine forbids modifying ``base_strategy.py`` and forbids a shared base module
beyond ``BaseStrategy``. Cross-cutting behaviours (schema validation, trading-day
reset, market-hours gating, warmup, position / re-entry control, risk validation and
strategy-prefixed logging) are therefore implemented as a small, self-contained,
copy-stable helper section embedded directly in each strategy file.

The EMA-specific indicator and decision layer (incremental EMA stack, trend
classification and the pullback entry rules) is implemented in task 4.2 via the
``_update_indicators`` and ``_decide`` hooks below.

Dependencies: Python standard library, numpy and pandas only.

============================================================================
STRATEGY DOCUMENTATION
============================================================================

Statistical edge
----------------
In a sustained intraday trend, momentum and mean-reversion coexist on different
horizons: price trends on the higher-frequency drift while oscillating around its
short-term moving averages. A stacked, strictly-ordered set of EMAs (fast > medium >
slow for an uptrend, fast < medium < slow for a downtrend) is a robust, low-lag proxy
for "the trend is intact and orderly". Within such a trend, shallow pullbacks toward
the fast/medium EMA are where late longs get shaken out and disciplined trend
participants re-enter; the EMA acts as dynamic support (uptrend) or resistance
(downtrend). The edge is the continuation premium harvested by entering *with* the
trend on a pullback-and-reclaim, rather than chasing extended price. It pays a
favourable reward-to-risk because the protective stop can sit just beyond the slow EMA
or the recent swing - close to entry - while the target rides the resumption of the
trend. The edge is strongest on instruments that trend cleanly intraday and decays in
flat, mean-reverting, or choppy regimes (see Failure modes), which is precisely why a
strict EMA-stack ordering is required before any entry is considered.

Entry logic
-----------
The strategy maintains an incremental three-EMA stack updated on every candle close
(``ema_t = alpha * close_t + (1 - alpha) * ema_{t-1}``, ``alpha = 2 / (period + 1)``,
seeded with the first close), then proceeds in two steps:

  1. Trend classification (Req 10.2, 10.3, 10.7):
       - ``fast > med > slow``  -> "up"
       - ``fast < med < slow``  -> "down"
       - any other arrangement (ties, crossovers, uninitialised EMAs) -> "flat"
     A "flat" classification produces no entry - an orderly stack is mandatory.

  2. Pullback-and-reclaim trigger evaluated against the fast and then the medium EMA,
     using the effective open (the candle ``open`` if present, else the prior-candle
     close, per Req 2.6) to qualify the body:
       - Up trend -> BUY when the candle's ``low`` dips to within ``pullback_band`` of
         the EMA (the pullback), the ``close`` reclaims back above that EMA, and the
         body is bullish (``close >= effective_open``).
       - Down trend -> SELL when the candle's ``high`` rallies to within
         ``pullback_band`` of the EMA, the ``close`` reclaims back below that EMA, and
         the body is bearish (``close <= effective_open``).

Entries are only evaluated inside the configured trading window, after warmup, while
flat, and below the daily trade cap (all enforced by the shared lifecycle pipeline).
``confidence`` scales with the EMA-stack separation (``|fast - slow|``) relative to the
trade's risk, rewarding well-separated, high-conviction trends.

Exit logic
----------
Each entry sets a protective ``stop_loss`` and a profit ``target`` derived from the
configured reward-to-risk multiple ``target_rr``:

  - Stop placement is controlled by ``stop_method``:
      * ``"slow_ema"`` (default): stop beyond the slow EMA by ``pullback_band`` -
        ``ema_slow - band`` for a BUY, ``ema_slow + band`` for a SELL.
      * ``"swing"``: stop beyond the recent swing extreme over ``swing_lookback``
        candles - ``min(recent_lows) - band`` for a BUY, ``max(recent_highs) + band``
        for a SELL.
  - ``risk = |entry - stop|``; ``target = entry +/- target_rr * risk`` so that
    ``|target - entry| / |entry - stop| ~= target_rr``.
  - Degenerate geometry (stop on the wrong side of entry, or non-positive risk) vetoes
    the trade and returns None.

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
  - ``max_trades_per_day`` caps daily exposure so a chop cannot be over-traded.
  - No new entries at/after ``no_new_entry`` and ``session_close``; mandatory
    square-off at/after ``square_off`` so nothing is carried past the intraday
    session (Req 4.2, 4.3, 4.5).
  - Session gating plus the warmup gate keep the strategy out of the thin opening book
    and the unstable close.

Recommended Config
------------------
Tuned for a liquid NSE large-cap (e.g. RELIANCE) on the 1-minute timeframe. ``instrument``
is the Dhan ``security_id`` string; ``quantity`` is used verbatim as the Signal quantity
(Req 5.4). Every key has a documented default applied via ``_cfg`` when omitted (Req 5.2);
the values below mirror the code's ``_cfg`` defaults and are the recommended starting
point (Req 5.7)::

    recommended_config = {
        # --- instrument / sizing ---
        "instrument": "2885",          # Dhan security_id (RELIANCE on NSE) -- string
        "quantity": 50,                # exact Signal quantity, never risk-adjusted
        "capital": 1_000_000.0,        # account capital used for the 2% risk cap

        # --- EMA-specific tunables ---
        "ema_fast_period": 9,          # fast EMA period
        "ema_med_period": 21,          # medium EMA period
        "ema_slow_period": 50,         # slow EMA period
        "pullback_band": 1.0,          # price-unit band around the EMA for pullback/stop
        "stop_method": "slow_ema",     # "slow_ema" | "swing" stop placement
        "target_rr": 2.0,              # reward-to-risk multiple for the target
        "swing_lookback": 3,           # candles used for the swing stop (stop_method="swing")

        # --- lifecycle / gating ---
        "warmup_period": 5,            # candles observed before entries are evaluated
        "max_trades_per_day": 3,       # daily entry cap

        # --- session timing (IST, "%H:%M:%S" or datetime.time) ---
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }

Note: ``pullback_band`` is in absolute price units; size it to the instrument's typical
intraday range. For a clean EMA stack to form, ``warmup_period`` should comfortably exceed
the slow EMA period in practice (the EMA seeds on the first close but is only meaningful
once enough candles have accumulated). Ensure the resulting ``|entry - stop| * quantity``
stays well inside the 2% risk cap, otherwise entries will be vetoed by the risk gate -
``stop_method="slow_ema"`` on a wide stack can produce a large stop distance.

Expected KPIs
-------------
Indicative targets from intraday trend-pullback behaviour on cleanly-trending liquid
large-caps; treat as planning estimates to validate via backtest, not guarantees:

  - Win rate:                  ~40-50% (trend-following wins less often than it loses,
                               but winners are larger than losers)
  - Profit factor:             ~1.3-1.7
  - Average reward-to-risk:    ~1.8-2.2 R (targets are set at ``target_rr``, default 2.0;
                               realised R:R is slightly lower after partial/early exits)
  - Estimated max drawdown:    ~10-15% of allocated capital (driven by clustered losses
                               in flat/choppy regimes; bounded per-trade by the 2% cap)

KPIs degrade sharply in non-trending regimes; the strict EMA-stack ordering filter and
``max_trades_per_day`` exist to limit how much capital a flat day can bleed.

Known failure modes and handling
--------------------------------
  - Flat / range-bound days: the EMAs converge and lose strict ordering, so the trend
    classifies as "flat". Handling: a "flat" stack produces no entry (Req 10.7), keeping
    the strategy out of directionless markets entirely.
  - Choppy / whipsaw days: the EMAs flip ordering repeatedly and pullback reclaims fail
    to follow through, producing stop-outs. Handling: the pullback-and-reclaim trigger
    requires both a band touch *and* a same-direction body close (not just a tag),
    filtering marginal signals; ``max_trades_per_day`` caps how many whipsaws the day can
    take, and the 2% risk gate bounds each loss.
  - Wide / fast trends (large EMA separation): a ``slow_ema`` stop can sit far from entry,
    inflating per-trade risk. Handling: the 2% risk gate vetoes oversized stops, and
    ``stop_method="swing"`` offers a tighter alternative anchored to recent structure.
  - Degenerate geometry (stop computed on the wrong side of entry, or zero/negative
    risk): Handling: ``_decide`` returns None for such cases so no malformed trade is
    emitted.
  - Missing ``open`` field: the body-based reclaim qualifier needs an open. Handling: the
    effective open substitutes the prior-candle close (or the current close on the very
    first candle) so the bullish/bearish-body check stays well defined (Req 2.6).
  - Corrupt / incomplete candle (missing ``high``/``low``/``close``/``time`` or an
    unparseable time): handled upstream by schema validation -> returns None with a debug
    log naming the field, without mutating indicator state (Req 2.7).
  - Gap / new session: a candle ``time`` earlier than the prior candle triggers a full
    per-day state reset so a prior session's EMA stack and swing accumulators never bleed
    into the new day (Req 3.1-3.4).
  - End-of-day open position: force-squared-off at ``square_off`` regardless of P&L so no
    position is carried beyond the intraday session (Req 4.3).
"""

from __future__ import annotations

import datetime
import logging
from dataclasses import dataclass, field
from typing import Optional, Tuple

import numpy as np  # noqa: F401  (used by the indicator/decision layer in task 4.2)
import pandas as pd  # noqa: F401  (used by the indicator/decision layer in task 4.2)

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
    accumulators (here: the EMA fields) live below the divider and are the only
    portion that differs between the five strategy files.
    """

    # --- shared lifecycle fields ---
    candle_count: int = 0
    last_time: Optional[datetime.time] = None     # for new-day detection
    trades_today: int = 0
    position: Optional[Position] = None

    # --- EMA-specific accumulators (filled by task 4.2) ---
    ema_fast: Optional[float] = None              # incremental fast EMA (period 9)
    ema_med: Optional[float] = None               # incremental medium EMA (period 21)
    ema_slow: Optional[float] = None              # incremental slow EMA (period 50)
    prev_close: Optional[float] = None            # prior-candle close (effective-open substitution)
    eff_open: Optional[float] = None              # effective open for the current candle (Req 2.6)
    recent_highs: list = field(default_factory=list)   # recent candle highs (swing stop)
    recent_lows: list = field(default_factory=list)    # recent candle lows (swing stop)


class EMATrendPullback(BaseStrategy):
    """Enter pullbacks to the fast/medium EMA in the direction of the EMA-stack trend.

    Only the shared lifecycle scaffolding is implemented in this task. The EMA stack
    update and pullback decision rules are added in task 4.2.
    """

    def __init__(self, name: str = "EMA_Trend_Pullback_v1", config: Optional[dict] = None):
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

        # 10. Strategy-specific decision (implemented in task 4.2).
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
        self.state = PerDayState()

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
    # EMA-specific indicator / decision hooks (task 4.2)
    # =====================================================================

    @staticmethod
    def _ema_step(prev: Optional[float], close: float, period: int) -> float:
        """One incremental EMA step (Req 10.1).

        ``ema_t = alpha * close_t + (1 - alpha) * ema_{t-1}`` with
        ``alpha = 2 / (period + 1)``; the first value is seeded with the first close.
        """
        if prev is None:
            return close
        alpha = 2.0 / (float(period) + 1.0)
        return alpha * close + (1.0 - alpha) * prev

    @staticmethod
    def _effective_open(candle: dict, prev_close: Optional[float], close: float) -> float:
        """Effective open: the candle ``open`` if present, else the prior-candle close (Req 2.6).

        On the very first candle (no prior close yet) the current close is used so the
        body-based reclaim check is well defined.
        """
        value = candle.get("open")
        if value is not None:
            try:
                return float(value)
            except (ValueError, TypeError):
                pass
        return prev_close if prev_close is not None else close

    def _update_indicators(self, candle: dict, t: datetime.time) -> None:
        """Update the incremental EMA stack and swing accumulators (Req 10.1, 2.6).

        Order matters: the effective open is resolved from the *previous* candle's close
        before ``prev_close`` is advanced to the current close at the end of the method.
        """
        close = float(candle["close"])
        high = float(candle["high"])
        low = float(candle["low"])

        # Effective open from the prior candle's close when 'open' is absent (Req 2.6).
        self.state.eff_open = self._effective_open(candle, self.state.prev_close, close)

        # Incremental EMA stack (Req 10.1) with configurable periods (Req 10.8).
        fast_p = int(self._cfg("ema_fast_period", 9))
        med_p = int(self._cfg("ema_med_period", 21))
        slow_p = int(self._cfg("ema_slow_period", 50))
        self.state.ema_fast = self._ema_step(self.state.ema_fast, close, fast_p)
        self.state.ema_med = self._ema_step(self.state.ema_med, close, med_p)
        self.state.ema_slow = self._ema_step(self.state.ema_slow, close, slow_p)

        # Recent swing tracking for stop_method == "swing"; keep a bounded tail.
        lookback = max(1, int(self._cfg("swing_lookback", 3)))
        self.state.recent_highs.append(high)
        self.state.recent_lows.append(low)
        if len(self.state.recent_highs) > lookback:
            self.state.recent_highs = self.state.recent_highs[-lookback:]
            self.state.recent_lows = self.state.recent_lows[-lookback:]

        # Advance prev_close AFTER effective-open resolution for the next candle.
        self.state.prev_close = close

    def _classify_trend(self) -> str:
        """Classify the EMA stack: 'up', 'down' or 'flat' (Req 10.2, 10.3, 10.7).

        Strict ordering fast > med > slow ⇒ up; fast < med < slow ⇒ down; any other
        arrangement (including ties or uninitialised EMAs) ⇒ flat (no entry).
        """
        f, m, s = self.state.ema_fast, self.state.ema_med, self.state.ema_slow
        if f is None or m is None or s is None:
            return "flat"
        if f > m > s:
            return "up"
        if f < m < s:
            return "down"
        return "flat"

    def _stop_for_buy(self, stop_method: str, ema_slow: float, band: float) -> float:
        """Protective stop for a BUY: beyond the slow EMA or below the recent swing low."""
        if stop_method == "swing" and self.state.recent_lows:
            return min(self.state.recent_lows) - band
        return ema_slow - band

    def _stop_for_sell(self, stop_method: str, ema_slow: float, band: float) -> float:
        """Protective stop for a SELL: beyond the slow EMA or above the recent swing high."""
        if stop_method == "swing" and self.state.recent_highs:
            return max(self.state.recent_highs) + band
        return ema_slow + band

    def _decide(
        self, candle: dict, t: datetime.time
    ) -> Optional[Tuple[str, float, float, float, float]]:
        """Evaluate the trend-aligned pullback-and-reclaim entry (Req 10.2-10.8).

        Up trend: when the candle pulls back to within ``pullback_band`` of the fast or
        medium EMA (low dips into the band) and then closes back above that EMA with a
        bullish body, emit a BUY. Down trend mirrors the logic for a SELL. ``stop_loss``
        is placed beyond the slow EMA or the recent swing per ``stop_method`` and
        ``target`` is derived from ``target_rr`` so ``|target-entry| / |entry-stop| ≈
        target_rr``.

        Returns ``(direction, price, stop, target, confidence)`` or None.
        """
        trend = self._classify_trend()
        if trend == "flat":
            return None  # Req 10.7: no entry without a strictly ordered stack.

        close = float(candle["close"])
        high = float(candle["high"])
        low = float(candle["low"])
        eff_open = self.state.eff_open if self.state.eff_open is not None else close

        band = float(self._cfg("pullback_band", 1.0))
        target_rr = float(self._cfg("target_rr", 2.0))
        stop_method = str(self._cfg("stop_method", "slow_ema"))

        ema_fast = self.state.ema_fast
        ema_med = self.state.ema_med
        ema_slow = self.state.ema_slow

        if trend == "up":
            # Pullback to within band of the fast or medium EMA then reclaim above it.
            triggered = None
            for ema in (ema_fast, ema_med):
                pulled_back = low <= ema + band      # dipped to within band of the EMA
                reclaimed = close > ema              # closed back above the EMA
                bullish_body = close >= eff_open     # body closed up across the pullback
                if pulled_back and reclaimed and bullish_body:
                    triggered = ema
                    break
            if triggered is None:
                return None
            direction = "BUY"
            price = close
            stop = self._stop_for_buy(stop_method, ema_slow, band)
            if stop >= price:
                return None  # degenerate geometry; no valid trade.
            risk = price - stop
            target = price + target_rr * risk
        else:  # trend == "down"
            triggered = None
            for ema in (ema_fast, ema_med):
                pulled_back = high >= ema - band     # rallied to within band of the EMA
                reclaimed = close < ema              # closed back below the EMA
                bearish_body = close <= eff_open     # body closed down across the pullback
                if pulled_back and reclaimed and bearish_body:
                    triggered = ema
                    break
            if triggered is None:
                return None
            direction = "SELL"
            price = close
            stop = self._stop_for_sell(stop_method, ema_slow, band)
            if stop <= price:
                return None  # degenerate geometry; no valid trade.
            risk = stop - price
            target = price - target_rr * risk

        if risk <= 0.0:
            return None

        # Confidence scales with EMA-stack separation relative to the trade's risk;
        # always finite and clamped to [0.0, 1.0] downstream in _make_signal.
        separation = abs(ema_fast - ema_slow)
        confidence = 0.5 + 0.5 * min(1.0, separation / risk)

        self._log(
            f"ema-decision {direction}: close={close} fast={ema_fast:.6f} "
            f"med={ema_med:.6f} slow={ema_slow:.6f} trend={trend} "
            f"stop={stop:.6f} target={target:.6f} rr={target_rr}"
        )
        return direction, price, stop, target, confidence
