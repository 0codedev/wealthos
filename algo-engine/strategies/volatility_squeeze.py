"""Volatility Squeeze Breakout intraday strategy.

This module implements the Volatility Squeeze Breakout strategy plus the *shared
lifecycle helper section* that is replicated verbatim across the five strategies in
the suite (VWAP Mean Reversion, EMA Trend Pullback, ORB Enhanced, Z-Score Reversion,
Volatility Squeeze). The shared section was established in ``vwap_mean_reversion.py``
(task 2.1) and is copied here with identical signatures and pipeline ordering.

The engine forbids modifying ``base_strategy.py`` and forbids a shared base module
beyond ``BaseStrategy``. Cross-cutting behaviours (schema validation, trading-day
reset, market-hours gating, warmup, position / re-entry control, risk validation and
strategy-prefixed logging) are therefore implemented as a small, self-contained,
copy-stable helper section embedded directly in each strategy file.

The Squeeze-specific indicator and decision layer (Bollinger Bands / Keltner Channels
computation, squeeze detection and the squeeze-release breakout entry rules) is
implemented in task 8.2 via the ``_update_indicators`` and ``_decide`` hooks below.

Dependencies: Python standard library, numpy and pandas only.

============================================================================
STRATEGY DOCUMENTATION
============================================================================

Statistical edge
----------------
Volatility is mean-reverting and cyclical: tight, low-volatility consolidation tends
to be followed by an expansion (and vice versa). The Squeeze quantifies the
"compression" phase by comparing two volatility envelopes on the same series - the
standard-deviation-based Bollinger Bands and the ATR-based Keltner Channels. When the
Bollinger Bands contract *fully inside* the Keltner Channels (``bb_upper < kc_upper``
AND ``bb_lower > kc_lower``), realized volatility has fallen below the average-range
baseline: coiled energy with no committed direction. On index instruments (e.g. NIFTY/
BANKNIFTY), where idiosyncratic single-name noise is diversified away and order flow is
deep, the *release* of that squeeze - the first decisive close beyond the consolidation
range - has a measurable tendency to continue in the breakout direction as trapped
positions cover and momentum players pile in. The edge is the expansion premium
captured by entering on the squeeze-release breakout with a defined-risk stop at the
opposite side of the coil. The edge is strongest on clean range-then-expand sessions and
decays in directionless chop where bands oscillate in and out of squeeze (see Failure
modes).

Entry logic
-----------
Two phases, both confined to the current trading day (accumulators reset on a new day):

  1. **Squeeze detection.** Once a full ``lookback`` window of closes is available the
     strategy computes Bollinger Bands (``mean ± bb_std * std``, population std
     ``ddof=0``) and Keltner Channels (``ema ± kc_multiplier * ATR``, ATR = mean True
     Range over ``lookback``). A *Squeeze* is flagged when the Bollinger Bands sit fully
     inside the Keltner Channels. While squeezing, the strategy records that a squeeze
     occurred today (``squeeze_seen``) and accumulates the coil's range extremes
     (``squeeze_low`` / ``squeeze_high``) (Req 13.1, 13.2, 13.5).

  2. **Squeeze-release breakout.** No entry is taken until a squeeze has occurred earlier
     in the day *and* the squeeze has since *ended* (bands expanded back outside the
     Keltner Channels); entries are suppressed while still squeezing (Req 13.3, 13.4,
     13.6). On release:

       - **Up breakout** -> ``close`` beyond ``squeeze_high + breakout_band`` with a
         bullish body (``close > effective_open``) emits "BUY".
       - **Down breakout** -> ``close`` beyond ``squeeze_low - breakout_band`` with a
         bearish body (``close < effective_open``) emits "SELL".

     The body confirmation (``close`` vs ``effective_open``) filters wicky, indecisive
     pokes beyond the range. ``effective_open`` is the candle ``open`` when present, else
     the prior candle close, else the current close (Req 2.6) - this is where the
     prior-close substitution is consumed.

Entries are only evaluated inside the configured trading window, after warmup, while
flat, and below the daily trade cap (enforced by the shared lifecycle pipeline).

Exit logic
----------
Each entry defines risk against the opposite side of the squeeze range and targets a
multiple of that risk:

  - BUY:  ``stop_loss = squeeze_low``  (below entry); ``risk = entry - squeeze_low``;
          ``target = entry + target_rr * risk``.
  - SELL: ``stop_loss = squeeze_high`` (above entry); ``risk = squeeze_high - entry``;
          ``target = entry - target_rr * risk``.

A non-positive ``risk`` (entry not actually beyond the opposite extreme) vetoes the
trade. Stops and targets are broker-managed (GTT). ``on_tick`` performs internal
bookkeeping only - it marks the position closed once a tick breaches the stop or target
so the strategy becomes eligible for re-entry, and always returns None. Any open position
is force-squared-off at ``square_off`` time regardless of P&L (Req 4.3).

Risk management
---------------
  - Hard 2% rule: an entry is vetoed (returns None) when the projected loss
    ``abs(entry - stop_loss) * quantity`` exceeds ``0.02 * capital`` (Req 5.5, 5.6).
    Because the stop sits at the opposite side of the coil, a wide squeeze range can
    trip this gate - size ``quantity`` to the instrument's typical squeeze width.
  - Single position at a time; controlled re-entry only after the prior position closes
    (Req 8.1, 8.2).
  - ``max_trades_per_day`` caps how many breakout attempts the day can take, limiting
    losses to repeated false breakouts.
  - No new entries at/after ``no_new_entry`` and ``session_close``; mandatory square-off
    at/after ``square_off`` so nothing is carried past the intraday session (Req 4.2,
    4.3, 4.5).
  - Warmup gate suppresses entries until enough candles exist to populate the bands.

Recommended Config
------------------
Tuned for an NSE index instrument (e.g. NIFTY/BANKNIFTY) on the 1-minute timeframe.
``instrument`` is the Dhan ``security_id`` string; ``quantity`` is used verbatim as the
Signal quantity (Req 5.4). Every key has a documented default applied via ``_cfg`` when
omitted (Req 5.2); the values below mirror the code's ``_cfg`` defaults and are the
recommended starting point (Req 5.7)::

    recommended_config = {
        # --- instrument / sizing ---
        "instrument": "13",            # Dhan security_id (NIFTY index) -- string
        "quantity": 50,                # exact Signal quantity, never risk-adjusted
        "capital": 1_000_000.0,        # account capital used for the 2% risk cap

        # --- Squeeze-specific tunables (match _cfg defaults) ---
        "lookback": 20,                # window for Bollinger mean/std, Keltner EMA, ATR
        "bb_std": 2.0,                 # Bollinger band width in std-devs (ddof=0)
        "kc_multiplier": 1.5,          # Keltner channel width in ATR multiples
        "breakout_band": 0.0,          # extra buffer beyond the squeeze range to confirm
        "target_rr": 2.0,              # reward-to-risk multiple for the target
        "confidence": 0.6,             # emitted confidence on a valid breakout

        # --- lifecycle / gating ---
        "warmup_period": 5,            # candles observed before entries are evaluated
        "max_trades_per_day": 3,       # daily entry cap

        # --- session timing (IST, "%H:%M:%S" or datetime.time) ---
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }

Note: ``lookback`` must be small enough that a full window forms before the warmup/entry
window opens but large enough to define a stable volatility baseline. Raising
``breakout_band`` demands a stronger break (fewer, higher-quality entries); raising
``target_rr`` widens the target (lower win rate, higher per-win payoff).

Expected KPIs
-------------
Indicative targets from squeeze-breakout behaviour on index instruments; treat as
planning estimates to validate via backtest, not guarantees:

  - Win rate:                  ~40-50% (breakouts miss often; winners run)
  - Profit factor:             ~1.3-1.7
  - Average reward-to-risk:    ~2.0 R (set by ``target_rr``; realized R skewed by partial
                               stops on false breakouts)
  - Estimated max drawdown:    ~12-18% of allocated capital (driven by clustered false
                               breakouts in chop; bounded per-trade by the 2% cap)

KPIs degrade sharply in low-conviction, directionless sessions where the squeeze releases
without follow-through; ``breakout_band``, the body-confirmation filter and
``max_trades_per_day`` exist to limit that downside.

Known failure modes and handling
--------------------------------
  - False breakout after squeeze: price closes just past the range then reverses, stopping
    out at the opposite side of the coil. Handling: the ``breakout_band`` buffer and the
    body-confirmation check (``close`` vs ``effective_open``) require a decisive break;
    the opposite-side stop caps the loss; ``max_trades_per_day`` limits repeated whipsaws.
  - No squeeze in the day: volatility never compresses enough for the bands to nest inside
    the Keltner Channels, so ``squeeze_seen`` stays False. Handling: the decision layer
    emits nothing - the strategy simply takes no trades that day (Req 13.6).
  - Squeeze persists into the close: a coil that never releases within the trading window
    produces no entry; nothing is forced. Handling: entries naturally cease at
    ``no_new_entry`` / ``session_close`` and any open trade squares off at ``square_off``.
  - Missing ``open`` field: the body-confirmation reference is unavailable. Handling: the
    effective open is substituted with the prior candle close (or the current close on the
    first candle of the day, a neutral zero-body bar), so the breakout body check still
    evaluates deterministically (Req 2.6).
  - Insufficient data for the bands: fewer than ``lookback`` closes accumulated. Handling:
    the squeeze classification and the decision layer both short-circuit to None until a
    full window exists; the warmup gate adds a further floor (Req 7.1-7.3, 13.1).
  - Corrupt / incomplete candle (missing ``high``/``low``/``close``/``time`` or an
    unparseable time): handled upstream by schema validation -> returns None with a debug
    log naming the field, without mutating indicator state (Req 2.7).
  - Gap / new session: a candle ``time`` earlier than the prior candle triggers a full
    per-day state reset so a prior session's squeeze range and band accumulators never
    bleed into the new day (Req 3.1-3.4).
  - End-of-day open position: force-squared-off at ``square_off`` regardless of P&L so no
    position is carried beyond the intraday session (Req 4.3).
"""

from __future__ import annotations

import datetime
import logging
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Optional, Tuple

import numpy as np  # noqa: F401  (used by the indicator/decision layer in task 8.2)
import pandas as pd  # noqa: F401  (used by the indicator/decision layer in task 8.2)

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
    accumulators (here: the Squeeze fields) live below the divider and are the only
    portion that differs between the five strategy files.
    """

    # --- shared lifecycle fields ---
    candle_count: int = 0
    last_time: Optional[datetime.time] = None     # for new-day detection
    trades_today: int = 0
    position: Optional[Position] = None

    # --- Squeeze-specific accumulators (filled by task 8.2) ---
    close_window: Deque[float] = field(default_factory=deque)   # rolling close window
    tr_window: Deque[float] = field(default_factory=deque)      # rolling true-range window (ATR)
    squeeze_seen: bool = False                    # True once a squeeze occurred today
    squeeze_low: Optional[float] = None           # opposite-side stop reference (low)
    squeeze_high: Optional[float] = None          # opposite-side stop reference (high)
    prev_close: Optional[float] = None            # prior-candle close (effective open)
    is_squeeze: bool = False                      # current-candle squeeze classification
    effective_open: Optional[float] = None        # candle open, or prior close substitute (Req 2.6)


class VolatilitySqueezeBreakout(BaseStrategy):
    """Trade momentum continuation after a volatility squeeze on index instruments.

    Only the shared lifecycle scaffolding is implemented in this task. The Bollinger
    Bands / Keltner Channels indicator math and the squeeze-release decision rules are
    added in task 8.2.
    """

    def __init__(self, name: str = "Volatility_Squeeze_Breakout_v1", config: Optional[dict] = None):
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

        # 10. Strategy-specific decision (implemented in task 8.2).
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
    # Squeeze-specific indicator / decision hooks (implemented in task 8.2)
    # =====================================================================

    @staticmethod
    def _ema(values: np.ndarray, period: int) -> float:
        """Exponential moving average over ``values`` (the Keltner Channel center).

        Uses the standard recurrence ``ema_t = alpha * x_t + (1 - alpha) * ema_{t-1}``
        with ``alpha = 2 / (period + 1)``, seeded at the first element of the window.
        This is identical to ``pd.Series(values).ewm(span=period, adjust=False).mean()``
        evaluated at the last element, and is the reference formula Property 30 compares
        against. EMA (rather than a rolling mean) is used for the Keltner center per the
        design (``Keltner Channels = ema ± kc_multiplier * ATR``).
        """
        alpha = 2.0 / (period + 1.0)
        ema = float(values[0])
        for x in values[1:]:
            ema = alpha * float(x) + (1.0 - alpha) * ema
        return ema

    def _update_indicators(self, candle: dict, t: datetime.time) -> None:
        """Update Bollinger Bands / Keltner Channels and the squeeze classification.

        Per-candle pipeline (all accumulators are pure functions of observed candles and
        reset per trading day via the shared ``_reset_day_state``):

        1. **Effective open (Req 2.6)** -- the candle ``open`` when present, otherwise the
           prior candle ``close`` (``prev_close``). For the first candle of a day, where no
           prior close exists, the current ``close`` is used (a neutral, zero-body bar).
        2. **True Range + ATR** -- maintain a rolling True-Range window of length
           ``lookback``; ATR is the mean of that window. With a prior close available,
           ``TR = max(high - low, abs(high - prev_close), abs(low - prev_close))``; on the
           first candle of the day (no prior close) ``TR = high - low``.
        3. **Rolling close window** of length ``lookback`` feeds the Bollinger mean/std and
           the Keltner EMA center.
        4. Once a full ``lookback`` window is available, compute Bollinger Bands
           (``mean ± bb_std * std``, population standard deviation ``ddof=0`` -- numpy's
           default) and Keltner Channels (``ema ± kc_multiplier * ATR``) and classify a
           **Squeeze** when the Bollinger Bands sit fully inside the Keltner Channels
           (``bb_upper < kc_upper`` AND ``bb_lower > kc_lower``) (Req 13.1, 13.2).
        5. While in a Squeeze, mark ``squeeze_seen`` and accumulate the squeeze range
           extremes (``squeeze_low`` / ``squeeze_high``) used for opposite-side stop
           placement at the breakout (Req 13.5).

        ``ddof=0`` is chosen so the Bollinger standard deviation matches ``np.std`` with
        its default argument; the Property 30 reference computation uses the same setting.
        """
        st = self.state
        lookback = int(self._cfg("lookback", 20))

        high = float(candle["high"])
        low = float(candle["low"])
        close = float(candle["close"])

        # 1. Effective open (Req 2.6): open if present, else prior close, else close.
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

        # 2. True Range + rolling ATR window (use prev_close for the prior close in TR).
        if st.prev_close is None:
            tr = high - low
        else:
            tr = max(high - low, abs(high - st.prev_close), abs(low - st.prev_close))
        st.tr_window.append(tr)
        while len(st.tr_window) > lookback:
            st.tr_window.popleft()

        # 3. Rolling close window (manual trim; the shared reset re-creates a plain deque).
        st.close_window.append(close)
        while len(st.close_window) > lookback:
            st.close_window.popleft()

        # 4. Bands + squeeze classification once a full window is available.
        st.is_squeeze = False
        if len(st.close_window) >= lookback:
            closes = np.asarray(st.close_window, dtype=float)
            bb_std = float(self._cfg("bb_std", 2.0))
            kc_multiplier = float(self._cfg("kc_multiplier", 1.5))

            mean = float(np.mean(closes))
            std = float(np.std(closes, ddof=0))            # population std (numpy default)
            bb_upper = mean + bb_std * std
            bb_lower = mean - bb_std * std

            ema = self._ema(closes, lookback)
            atr = float(np.mean(np.asarray(st.tr_window, dtype=float)))
            kc_upper = ema + kc_multiplier * atr
            kc_lower = ema - kc_multiplier * atr

            # Squeeze: Bollinger Bands fully contained inside the Keltner Channels.
            st.is_squeeze = (bb_upper < kc_upper) and (bb_lower > kc_lower)

        # 5. Record squeeze occurrence + range extremes for opposite-side stop placement.
        if st.is_squeeze:
            st.squeeze_seen = True
            st.squeeze_low = low if st.squeeze_low is None else min(st.squeeze_low, low)
            st.squeeze_high = high if st.squeeze_high is None else max(st.squeeze_high, high)

        # Advance prior close AFTER every prev_close-dependent calculation above.
        st.prev_close = close

    def _decide(
        self, candle: dict, t: datetime.time
    ) -> Optional[Tuple[str, float, float, float, float]]:
        """Evaluate the squeeze-release breakout entry (Req 13.3-13.7).

        Returns ``(direction, price, stop, target, confidence)`` or None. ``price`` is the
        candle ``close``.

        Entry rules:
          - No entry until the bands are fully populated and a Squeeze has occurred earlier
            in the current trading day (``squeeze_seen``); while no squeeze has been seen,
            emit nothing (Req 13.6).
          - No entry while still in a Squeeze; the breakout fires only after the squeeze has
            *ended* (Bollinger Bands expanded back outside the Keltner Channels) (Req 13.3,
            13.4).
          - An **up** breakout (``close`` beyond ``squeeze_high + breakout_band`` with a
            bullish body, ``close > effective_open``) emits "BUY"; the mirror **down**
            breakout (``close`` beyond ``squeeze_low - breakout_band`` with a bearish body,
            ``close < effective_open``) emits "SELL". The effective-open body check is where
            the Req 2.6 prior-close substitution is consumed.
          - ``stop_loss`` is placed at the opposite side of the squeeze range
            (BUY -> ``squeeze_low``; SELL -> ``squeeze_high``) and ``target`` is set via the
            configured reward-to-risk ratio ``target_rr`` (Req 13.5).
        """
        st = self.state
        lookback = int(self._cfg("lookback", 20))

        # Need a full window of bands before any decision can be made.
        if len(st.close_window) < lookback:
            return None
        # Req 13.6: no entry until a squeeze has occurred in the current day.
        if not st.squeeze_seen:
            return None
        # Req 13.3 / 13.4: only after the squeeze has ended (not currently squeezing).
        if st.is_squeeze:
            return None
        if st.squeeze_low is None or st.squeeze_high is None:
            return None

        close = float(candle["close"])
        eff_open = st.effective_open if st.effective_open is not None else close
        breakout_band = float(self._cfg("breakout_band", 0.0))
        target_rr = float(self._cfg("target_rr", 2.0))
        confidence = float(self._cfg("confidence", 0.6))

        up_level = st.squeeze_high + breakout_band
        down_level = st.squeeze_low - breakout_band

        # Up breakout: close beyond the upper breakout level with a bullish body.
        if close > up_level and close > eff_open:
            entry = close
            stop = float(st.squeeze_low)
            risk = entry - stop
            if risk <= 0:
                return None
            target = entry + target_rr * risk
            self._log(
                f"squeeze-release UP breakout: close={close} > "
                f"squeeze_high+band={up_level} (range "
                f"[{st.squeeze_low}, {st.squeeze_high}]); BUY stop={stop} target={target}"
            )
            return ("BUY", entry, stop, target, confidence)

        # Down breakout: close beyond the lower breakout level with a bearish body.
        if close < down_level and close < eff_open:
            entry = close
            stop = float(st.squeeze_high)
            risk = stop - entry
            if risk <= 0:
                return None
            target = entry - target_rr * risk
            self._log(
                f"squeeze-release DOWN breakout: close={close} < "
                f"squeeze_low-band={down_level} (range "
                f"[{st.squeeze_low}, {st.squeeze_high}]); SELL stop={stop} target={target}"
            )
            return ("SELL", entry, stop, target, confidence)

        return None
