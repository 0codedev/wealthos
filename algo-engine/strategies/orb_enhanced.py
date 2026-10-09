"""Opening Range Breakout (Enhanced) intraday strategy.

This module implements the enhanced Opening Range Breakout (ORB) strategy plus the
*shared lifecycle helper section* that is replicated verbatim across the five
strategies in the suite (VWAP Mean Reversion, EMA Trend Pullback, ORB Enhanced,
Z-Score Reversion, Volatility Squeeze). It complements the existing
``orb_breakout.py`` with volume-confirmation and retest filters that reduce false
breakouts.

The engine forbids modifying ``base_strategy.py`` and forbids a shared base module
beyond ``BaseStrategy``. Cross-cutting behaviours (schema validation, trading-day
reset, market-hours gating, warmup, position / re-entry control, risk validation and
strategy-prefixed logging) are therefore implemented as a small, self-contained,
copy-stable helper section embedded directly in each strategy file.

The ORB-specific indicator and decision layer (opening-range accumulation, breakout /
retest / volume-confirmation entry rules and range-sized exits) is implemented in
``_update_indicators`` and ``_decide`` (task 5.2).

Dependencies: Python standard library, numpy and pandas only.

============================================================================
STRATEGY DOCUMENTATION
============================================================================

Statistical edge
----------------
The first 15-30 minutes of the session establish the "opening range" - the high/low
band carved out while overnight order flow, gap reactions and the prior-session
inventory are repriced. Once that range is set, a decisive break of either boundary
marks the point where one side of the book has been exhausted and price is free to
trend. The naive opening-range breakout (see ``orb_breakout.py``) captures this, but
its edge is badly diluted by *false breakouts*: thin pushes through the boundary that
immediately fade back inside the range. This enhanced variant adds two confirmation
filters that target exactly that weakness:

  - **Retest filter** - after the break, demand that price returns to the broken
    boundary and *resumes* in the breakout direction. A boundary that flips from
    resistance to support (or vice-versa) is far more likely to hold, so the retest
    weeds out one-bar fakeouts and entries on exhausted thrusts.
  - **Volume-confirmation filter** - require the breakout candle to trade on volume
    well above the recent average. Genuine breakouts are accompanied by a surge in
    participation; low-volume pokes through the boundary are the signature of a trap.

The edge is the directional follow-through harvested from *confirmed* range breaks,
with the two filters shifting the win-rate / frequency trade-off toward fewer but
higher-quality entries. It is strongest on instruments that build a clean, contained
opening range and then trend; it decays in rotational, gap-and-fill or news-whipsaw
regimes (see Failure modes).

Entry logic
-----------
1. **Range accumulation (Req 11.1)**: from Market_Open until
   ``opening_range_minutes`` later, every candle extends ``or_high``/``or_low``. The
   first candle at/after the range-period end *locks* the range and breakout
   evaluation begins.
2. **Breakout (Req 11.2, 11.3)**: with the range locked, ``close > or_high`` is a raw
   "BUY" break and ``close < or_low`` is a raw "SELL" break.
3. **Retest (Req 11.4)**: when ``require_retest`` is enabled, a raw break only *arms*
   the strategy. No signal is emitted until price retests the broken boundary
   (``low <= or_high`` for a BUY break / ``high >= or_low`` for a SELL break) and then
   a later candle *resumes* through it (``close > or_high`` / ``close < or_low``). An
   opposite break while armed flips the tracked direction and re-arms. With
   ``require_retest`` disabled, a raw break emits immediately.
4. **Volume confirmation (Req 11.5, 2.5)**: when ``require_volume_confirmation`` is
   enabled *and* a valid ``volume`` is present, the breakout candle must trade above
   ``volume_multiple`` times the rolling average of the prior ``volume_lookback``
   candles' volume; otherwise the break is rejected. When ``volume`` is absent the
   filter is treated as disabled (degraded mode) and the price-based break stands.

Entries are only evaluated inside the configured trading window, after warmup, while
flat, and below the daily trade cap (enforced by the shared lifecycle pipeline).
``confidence`` starts at a 0.6 base and is boosted +0.2 for a retest-confirmed entry
and +0.2 for a real-volume-confirmed entry (clamped to [0.0, 1.0]).

Exit logic
----------
Stops and targets are sized *relative to the opening-range size*
``range_size = or_high - or_low`` (Req 11.6):

  - BUY:  ``stop_loss = close - range_size * stop_multiplier``,
          ``target   = close + range_size * target_multiplier``.
  - SELL: ``stop_loss = close + range_size * stop_multiplier``,
          ``target   = close - range_size * target_multiplier``.

With the default ``stop_multiplier=1.0`` / ``target_multiplier=2.0`` every entry
carries a 2:1 reward-to-risk geometry tied to the day's own volatility. Stops and
targets are broker-managed (GTT); ``on_tick`` performs internal bookkeeping only - it
marks the position closed once a tick breaches the stop or target so the strategy
becomes eligible for re-entry, and always returns None. Any open position is
force-squared-off at ``square_off`` time regardless of P&L (Req 4.3).

Risk management
---------------
  - Hard 2% rule: an entry is vetoed (returns None) when the projected loss
    ``abs(entry - stop_loss) * quantity`` exceeds ``0.02 * capital`` (Req 5.5, 5.6).
    Because the stop scales with the opening-range size, wide-range days can trip this
    gate - size ``quantity`` so ``range_size * stop_multiplier * quantity`` stays
    inside the cap.
  - Single position at a time; controlled re-entry only after the prior position
    closes (Req 8.1, 8.2).
  - ``max_trades_per_day`` caps daily exposure so repeated fakeouts cannot bleed the
    account.
  - Session gating: no new entries at/after ``no_new_entry`` and ``session_close``;
    mandatory square-off at/after ``square_off`` so nothing is carried past the
    intraday session (Req 4.2, 4.3, 4.5).

Recommended Config
------------------
Tuned for a liquid NSE large-cap or index future on the 1-minute timeframe.
``instrument`` is the Dhan ``security_id`` string; ``quantity`` is used verbatim as the
Signal quantity (Req 5.4). Every key has a documented default applied via ``_cfg`` when
omitted (Req 5.2); the values below match the code's defaults and are the recommended
starting point (Req 5.7)::

    recommended_config = {
        # --- instrument / sizing ---
        "instrument": "2885",          # Dhan security_id (RELIANCE on NSE) -- string
        "quantity": 50,                # exact Signal quantity, never risk-adjusted
        "capital": 1_000_000.0,        # account capital used for the 2% risk cap

        # --- ORB-specific tunables ---
        "opening_range_minutes": 15,   # range window length (15 or 30)
        "require_retest": False,        # demand a retest-and-resume before entry
        "require_volume_confirmation": False,  # demand a volume surge on the break
        "volume_multiple": 1.5,        # breakout volume must exceed 1.5x rolling avg
        "volume_lookback": 20,         # candles in the rolling volume average
        "stop_multiplier": 1.0,        # stop distance = range_size * 1.0
        "target_multiplier": 2.0,      # target distance = range_size * 2.0 (2:1 R:R)

        # --- lifecycle / gating ---
        "warmup_period": 5,            # candles observed before entries are evaluated
        "max_trades_per_day": 3,       # daily entry cap

        # --- session timing (IST, "%H:%M:%S" or datetime.time) ---
        "market_open": "09:15:00",
        "no_new_entry": "10:30:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }

Note: ``warmup_period`` should comfortably exceed the candle count of the opening-range
window so the range is locked before entries are evaluated; on a 1-minute timeframe a
15-minute range implies the range locks well within the first dozen candles. Set
``volume_lookback`` to cover a representative slice of the session without spanning the
opening-range distortion.

Expected KPIs
-------------
Indicative targets from confirmed opening-range breakout behaviour on trending
instruments; treat as planning estimates to validate via backtest, not guarantees:

  - Win rate:                  ~40-50% (breakouts win less often but run further; the
                               retest/volume filters lift this above the naive ORB)
  - Profit factor:             ~1.4-1.8
  - Average reward-to-risk:    ~2.0 R (the default ``target_multiplier=2.0`` /
                               ``stop_multiplier=1.0`` geometry; winners pay ~2x the
                               risked amount)
  - Estimated max drawdown:    ~10-15% of allocated capital (driven by strings of
                               false-breakout stop-outs on rotational days; bounded
                               per-trade by the 2% cap)

KPIs degrade on choppy / range-bound days and in degraded (volume-filter-disabled)
mode; ``require_retest``, ``require_volume_confirmation`` and ``max_trades_per_day``
exist to limit that downside.

Known failure modes and handling
--------------------------------
  - False breakouts (the dominant ORB failure): a thin push through the boundary that
    immediately reverses back inside the range. Handling: the ``require_retest`` filter
    only enters after a retest-and-resume, discarding one-bar fakeouts, and the
    ``require_volume_confirmation`` filter rejects low-participation pokes; the
    range-sized stop caps the loss when a confirmed break still fails.
  - Low-volume chop / rotational days: price oscillates across both boundaries
    generating alternating armed breakouts. Handling: ``max_trades_per_day`` caps how
    many times the day can chase the range, the warmup gate avoids trading a thin
    opening book, and the volume filter suppresses breaks that lack participation.
  - Missing volume (no ``volume`` field): the volume-confirmation filter cannot be
    evaluated. Handling: the strategy degrades to a *disabled* volume filter, emits a
    single degraded-mode debug log, and continues on the price-based breakout and
    retest filters alone; entries in this mode are not volume-confirmed and therefore
    do not receive the volume confidence boost (Req 2.5, 2.8).
  - Zero / non-positive opening range (flat range period): a degenerate range yields a
    zero-distance stop/target. Handling: ``_build_entry`` detects ``range_size <= 0``,
    logs it, and returns None rather than emitting a malformed signal.
  - Oversized range tripping the risk cap: on very wide-range days the range-sized stop
    can project a loss above 2% of capital. Handling: the risk gate vetoes the entry
    (returns None with a debug log) so position size never exceeds the mandate
    (Req 5.5, 5.6).
  - Corrupt / incomplete candle (missing ``high``/``low``/``close``/``time`` or an
    unparseable time): handled upstream by schema validation -> returns None with a
    debug log naming the field, without mutating indicator state (Req 2.7).
  - Gap / new session: a candle ``time`` earlier than the prior candle triggers a full
    per-day state reset so a prior session's opening range, retest arming and volume
    window never bleed into the new day (Req 3.1-3.4).
  - End-of-day open position: force-squared-off at ``square_off`` regardless of P&L so
    no position is carried beyond the intraday session (Req 4.3).
"""

from __future__ import annotations

import datetime
import logging
from collections import deque
from dataclasses import dataclass, field
from typing import Optional, Tuple

import numpy as np  # noqa: F401  (used by the indicator/decision layer in task 5.2)
import pandas as pd  # noqa: F401  (used by the indicator/decision layer in task 5.2)

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
    accumulators (here: the ORB fields) live below the divider and are the only
    portion that differs between the five strategy files.
    """

    # --- shared lifecycle fields ---
    candle_count: int = 0
    last_time: Optional[datetime.time] = None     # for new-day detection
    trades_today: int = 0
    position: Optional[Position] = None

    # --- ORB-specific accumulators (filled by task 5.2) ---
    or_high: Optional[float] = None               # opening-range high
    or_low: Optional[float] = None                # opening-range low
    range_locked: bool = False                    # True once the opening range closes
    retest_armed: bool = False                    # True after a breakout awaiting retest
    vol_window: deque = field(default_factory=deque)   # rolling volume for confirmation
    degraded: bool = False                        # True once the volume filter is disabled
    breakout_dir: Optional[str] = None            # "BUY"/"SELL" breakout awaiting retest/resume
    retested: bool = False                        # True once price retested the broken boundary
    vol_avg: Optional[float] = None               # rolling average volume of prior candles


class ORBEnhanced(BaseStrategy):
    """Breakout of the first 15/30-minute range with volume and retest filters.

    Only the shared lifecycle scaffolding is implemented in this task. The
    opening-range accumulation and breakout decision rules are added in task 5.2.
    """

    def __init__(self, name: str = "ORB_Enhanced_v1", config: Optional[dict] = None):
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

        # 10. Strategy-specific decision (implemented in task 5.2).
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
        if t >= self._cfg_time("no_new_entry", "10:30:00"):
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
    # ORB-specific indicator / decision hooks (implemented in task 5.2)
    # =====================================================================

    def _update_indicators(self, candle: dict, t: datetime.time) -> None:
        """Accumulate the opening range and maintain rolling volume statistics.

        - During the first ``opening_range_minutes`` after Market_Open, extend the
          Opening_Range high/low with each candle (Req 11.1).
        - Once the range period closes, lock the range so breakout evaluation begins
          (Req 11.2, 11.3).
        - When a valid ``volume`` is present, maintain a rolling average over the most
          recent ``volume_lookback`` candles for the volume-confirmation filter
          (Req 11.5). When ``volume`` is absent, the filter degrades to disabled and a
          debug log records the degraded mode once per trading day (Req 2.5, 2.8).
        """
        s = self.state

        # --- rolling volume statistics (volume-confirmation filter, Req 11.5) ---
        vol = candle.get("volume")
        if vol is None:
            # Degraded mode: volume-confirmation filter is disabled (Req 2.5, 2.8).
            if bool(self._cfg("require_volume_confirmation", True)) and not s.degraded:
                s.degraded = True
                self._log(
                    "volume absent; volume-confirmation filter disabled (degraded mode)"
                )
        else:
            try:
                vol_f = float(vol)
            except (ValueError, TypeError):
                vol_f = None
            if vol_f is not None:
                window = s.vol_window
                # Rolling average of PRIOR candles (excludes the current candle).
                s.vol_avg = (
                    float(sum(window) / len(window)) if len(window) > 0 else None
                )
                window.append(vol_f)
                lookback = int(self._cfg("volume_lookback", 20))
                while len(window) > lookback:
                    window.popleft()

        # --- opening-range accumulation / locking (Req 11.1) ---
        market_open = self._cfg_time("market_open", "09:15:00")
        or_minutes = int(self._cfg("opening_range_minutes", 15))
        range_end = self._add_minutes(market_open, or_minutes)

        high = float(candle["high"])
        low = float(candle["low"])

        if t < range_end:
            # Inside the opening-range window (and at/after Market_Open).
            if t >= market_open:
                s.or_high = high if s.or_high is None else max(s.or_high, high)
                s.or_low = low if s.or_low is None else min(s.or_low, low)
        elif not s.range_locked:
            # First candle at/after the range period end locks the range.
            s.range_locked = True
            self._log(
                f"opening range locked: high={s.or_high}, low={s.or_low}"
            )
        return None

    def _decide(
        self, candle: dict, t: datetime.time
    ) -> Optional[Tuple[str, float, float, float, float]]:
        """Evaluate the enhanced breakout entry.

        Reached only when flat, in-window, past warmup, and below the daily trade cap
        (the lifecycle pipeline enforces those gates). Applies the breakout, optional
        retest, and optional volume-confirmation filters, then sizes the stop/target
        from the range size.

        Returns ``(direction, price, stop, target, confidence)`` or None. ``price`` is
        the candle close.
        """
        s = self.state

        # The range must be locked before any breakout can be evaluated (Req 11.2/11.3).
        if not s.range_locked or s.or_high is None or s.or_low is None:
            return None

        close = float(candle["close"])
        require_retest = bool(self._cfg("require_retest", True))

        # Raw breakout direction for this candle (Req 11.2, 11.3).
        if close > s.or_high:
            raw_dir = "BUY"
        elif close < s.or_low:
            raw_dir = "SELL"
        else:
            raw_dir = None

        # ---- No-retest path: emit immediately on a filtered breakout ----
        if not require_retest:
            if raw_dir is None:
                return None
            allowed, confirmed = self._volume_filter(candle)
            if not allowed:
                return None
            self._log(
                f"breakout {raw_dir}: close={close} vs OR "
                f"[{s.or_low}, {s.or_high}] (no-retest)"
            )
            return self._build_entry(raw_dir, close, retest_used=False,
                                     volume_confirmed=confirmed)

        # ---- Retest path: arm on first breakout, emit only on retest-and-resume ----
        if s.breakout_dir is None:
            if raw_dir is not None:
                s.breakout_dir = raw_dir
                s.retest_armed = True
                s.retested = False
                self._log(
                    f"breakout {raw_dir} detected (close={close}); awaiting retest"
                )
            return None

        # An active breakout is being tracked. Allow re-arming on an opposite breakout.
        if s.breakout_dir == "BUY" and close < s.or_low:
            s.breakout_dir = "SELL"
            s.retested = False
            self._log("breakout flipped to SELL; re-awaiting retest")
            return None
        if s.breakout_dir == "SELL" and close > s.or_high:
            s.breakout_dir = "BUY"
            s.retested = False
            self._log("breakout flipped to BUY; re-awaiting retest")
            return None

        high = float(candle["high"])
        low = float(candle["low"])
        boundary = s.or_high if s.breakout_dir == "BUY" else s.or_low

        # Detect the retest of the broken boundary.
        if not s.retested:
            if s.breakout_dir == "BUY" and low <= boundary:
                s.retested = True
                self._log(f"retest of OR high ({boundary}) observed")
            elif s.breakout_dir == "SELL" and high >= boundary:
                s.retested = True
                self._log(f"retest of OR low ({boundary}) observed")

        # After a retest, require resumption in the breakout direction (Req 11.4).
        if s.retested:
            resumed = (
                (s.breakout_dir == "BUY" and close > boundary)
                or (s.breakout_dir == "SELL" and close < boundary)
            )
            if resumed:
                allowed, confirmed = self._volume_filter(candle)
                if not allowed:
                    return None
                direction = s.breakout_dir
                s.breakout_dir = None
                s.retest_armed = False
                s.retested = False
                self._log(
                    f"retest-and-resume {direction}: close={close} vs boundary {boundary}"
                )
                return self._build_entry(direction, close, retest_used=True,
                                         volume_confirmed=confirmed)

        return None

    # ---- ORB-specific helper utilities (task 5.2) ----

    def _add_minutes(self, t: datetime.time, minutes: int) -> datetime.time:
        """Return ``t`` advanced by ``minutes`` (clamped within a single day)."""
        base = datetime.datetime.combine(datetime.date(2000, 1, 1), t)
        return (base + datetime.timedelta(minutes=int(minutes))).time()

    def _volume_filter(self, candle: dict) -> Tuple[bool, bool]:
        """Apply the volume-confirmation filter (Req 11.5, 2.5).

        Returns ``(allowed, confirmed_by_real_volume)`` where ``allowed`` indicates the
        breakout may proceed and ``confirmed_by_real_volume`` is True only when a real
        volume reading cleared the ``volume_multiple`` threshold.

        - Filter disabled in Config -> always allowed, not confirmed.
        - ``volume`` absent -> degraded mode, filter disabled -> allowed, not confirmed.
        - ``volume`` present -> allowed only when it exceeds ``volume_multiple`` times
          the rolling average of prior candle volume.
        """
        if not bool(self._cfg("require_volume_confirmation", True)):
            return True, False

        vol = candle.get("volume")
        if vol is None:
            # Degraded: filter disabled, price-based breakout still valid (Req 2.5).
            return True, False
        try:
            vol_f = float(vol)
        except (ValueError, TypeError):
            return True, False

        avg = self._cfg("reference_volume", None)
        if avg is None:
            avg = self.state.vol_avg
            
        if avg is None or avg <= 0:
            # No volume average yet -> cannot confirm the breakout against volume.
            return False, False

        multiple = float(self._cfg("volume_multiple", 1.5))
        if vol_f > multiple * avg:
            return True, True
        return False, False

    def _build_entry(
        self,
        direction: str,
        close: float,
        retest_used: bool,
        volume_confirmed: bool,
    ) -> Optional[Tuple[str, float, float, float, float]]:
        """Size the stop/target from the range and assemble the decision tuple (Req 11.6).

        ``stop_loss`` and ``target`` distances are ``range_size * stop_multiplier`` and
        ``range_size * target_multiplier`` respectively, placed on the correct side of
        the entry. ``price`` is the candle close.
        """
        s = self.state
        range_size = float(s.or_high - s.or_low)
        if range_size <= 0:
            self._log(f"non-positive opening range size ({range_size}); skipping entry")
            return None

        stop_mult = float(self._cfg("stop_multiplier", 1.0))
        target_mult = float(self._cfg("target_multiplier", 2.0))
        stop_dist = range_size * stop_mult
        target_dist = range_size * target_mult

        if direction == "BUY":
            stop = close - stop_dist
            target = close + target_dist
        else:  # SELL
            stop = close + stop_dist
            target = close - target_dist

        # Deterministic confidence: a base breakout, boosted by passing filters.
        confidence = 0.6
        if retest_used:
            confidence += 0.2
        if volume_confirmed:
            confidence += 0.2

        return (direction, float(close), float(stop), float(target), float(confidence))
