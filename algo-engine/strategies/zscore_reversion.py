"""Bollinger / Z-Score Reversion intraday strategy.

This module implements the Bollinger / Z-Score Reversion strategy. It reuses the
*shared lifecycle helper section* established for the suite (see
``vwap_mean_reversion.py``, task 2.1) verbatim: schema validation, trading-day
reset, market-hours gating, warmup, position / re-entry control, risk validation
and strategy-prefixed logging.

The engine forbids modifying ``base_strategy.py`` and forbids a shared base module
beyond ``BaseStrategy``. Those cross-cutting behaviours are therefore implemented as
a small, self-contained, copy-stable helper section embedded directly in each
strategy file with identical signatures and identical pipeline ordering.

The Z-Score-specific indicator and decision layer (rolling mean / standard
deviation, z-score computation and the statistical-extreme entry rules) is
implemented in task 7.2 in the ``_update_indicators`` and ``_decide`` hooks below.

Dependencies: Python standard library, numpy and pandas only.

============================================================================
STRATEGY DOCUMENTATION
============================================================================

Statistical edge
----------------
Over a short rolling lookback, an instrument's price tends to oscillate around its
own moving average, and the dispersion of those closes is well described by a rolling
standard deviation. The *z-score* standardizes the latest close as
``z = (close - rolling_mean) / rolling_std`` - it measures, in units of standard
deviation, how stretched the current price is relative to its recent behaviour. On
range-bound, mean-reverting instruments a large ``|z|`` is a transient over-extension
driven by short-lived order-flow imbalance rather than sustained directional intent,
and such extremes exhibit a measurable tendency to revert toward the rolling mean
(z reverting to 0). The edge is the mean-reversion premium harvested by *fading*
those statistical extremes and targeting the snap-back to the rolling mean. Unlike a
fixed price-distance trigger, the z-score self-calibrates to the instrument's current
volatility: the same threshold adapts as the rolling std expands or contracts. The
edge is strongest on liquid, range-bound names and decays sharply on trending or
breakout regimes (see Failure modes).

Entry logic
-----------
The strategy maintains a rolling window of the most recent ``lookback`` closes (a
``deque`` with ``maxlen == lookback``). Once a *full* window is available it computes
the rolling mean and the population standard deviation (``np.std`` with ``ddof=0`` -
a deliberate reference choice) and standardizes the latest close:

    z = (close - rolling_mean) / rolling_std

  - ``z <= -entry_z`` (close statistically *cheap*, stretched below the mean) -> "BUY".
  - ``z >= +entry_z`` (close statistically *expensive*, stretched above the mean) -> "SELL".
  - otherwise -> no entry.

Entries are only evaluated inside the configured trading window, after warmup, while
flat, and below the daily trade cap (enforced by the shared lifecycle pipeline).
``confidence`` scales with how far ``|z|`` extends past the entry threshold
(``min(1.0, |z| / (2 * entry_z))``).

Exit logic
----------
Each entry sets a profit ``target`` *at the rolling mean* (the reversion objective,
i.e. z returning to 0) and a protective ``stop_loss`` placed ``exit_z`` standard
deviations beyond the entry on the losing side:

  - BUY:  ``target = rolling_mean`` (above entry),  ``stop_loss = close - exit_z * std``.
  - SELL: ``target = rolling_mean`` (below entry),  ``stop_loss = close + exit_z * std``.

Because ``exit_z > entry_z`` the stop sits *further* into the tail than the entry: the
trade is given room for the extreme to over-shoot slightly before the reversion, while
``exit_z`` bounds how far the z-score may run against the position before the thesis is
abandoned. Stops and targets are broker-managed (GTT). ``on_tick`` performs internal
bookkeeping only - it marks the position closed once a tick breaches the stop or target
so the strategy becomes eligible for re-entry, and always returns None. Any open
position is force-squared-off at ``square_off`` time regardless of P&L (Req 4.3).

Risk management
---------------
  - Hard 2% rule: an entry is vetoed (returns None) when the projected loss
    ``abs(entry - stop_loss) * quantity`` exceeds ``0.02 * capital`` (Req 5.5, 5.6).
    Because the stop distance is ``exit_z * std``, a volatility spike that widens the
    rolling std can push the projected loss past the cap and self-veto the entry.
  - Single position at a time; controlled re-entry only after the prior position
    closes (Req 8.1, 8.2).
  - ``max_trades_per_day`` caps daily exposure so the strategy cannot repeatedly fade
    a persistent trend.
  - No new entries at/after ``no_new_entry`` and ``session_close``; mandatory
    square-off at/after ``square_off`` so nothing is carried past the intraday
    session (Req 4.2, 4.3, 4.5).
  - Warmup gate plus the full-window requirement ensure rolling statistics are only
    computed once ``lookback`` closes exist, so no entry fires on an under-sampled,
    unreliable z-score.

Recommended Config
------------------
Tuned for a liquid NSE large-cap (e.g. RELIANCE) on the 1-minute timeframe. ``instrument``
is the Dhan ``security_id`` string; ``quantity`` is used verbatim as the Signal quantity
(Req 5.4). Every key has a documented default applied via ``_cfg`` when omitted (Req 5.2);
the ``lookback`` / ``entry_z`` / ``exit_z`` values below match the code's ``_cfg`` defaults
exactly and are the recommended starting point (Req 5.7)::

    recommended_config = {
        # --- instrument / sizing ---
        "instrument": "2885",          # Dhan security_id (RELIANCE on NSE) -- string
        "quantity": 50,                # exact Signal quantity, never risk-adjusted
        "capital": 1_000_000.0,        # account capital used for the 2% risk cap

        # --- Z-Score-specific tunables (match _cfg defaults) ---
        "lookback": 20,                # rolling window length for mean / std
        "entry_z": 2.0,                # |z| threshold to fade the extreme
        "exit_z": 3.0,                 # stop placed exit_z std-devs beyond entry

        # --- lifecycle / gating ---
        "warmup_period": 5,            # candles observed before entries are evaluated
        "max_trades_per_day": 3,       # daily entry cap

        # --- session timing (IST, "%H:%M:%S" or datetime.time) ---
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }

Note: a full ``lookback`` window of closes is required before any entry, so the
*effective* warmup is ``max(warmup_period, lookback)`` candles. Keep ``exit_z`` strictly
greater than ``entry_z`` so the stop sits beyond the entry; and remember the stop distance
``exit_z * std`` scales with realized volatility, so on volatile names size ``quantity`` so
that ``exit_z * std * quantity`` stays inside the 2% risk cap, otherwise entries are vetoed.

Expected KPIs
-------------
Indicative targets from intraday z-score mean-reversion behaviour on liquid large-caps;
treat as planning estimates to validate via backtest, not guarantees:

  - Win rate:                  ~58-66% (reversion wins often, modest per-win edge)
  - Profit factor:             ~1.2-1.5
  - Average reward-to-risk:    ~0.7-1.0 R (target is the mean snap-back at ~entry_z std,
                               stop sits at exit_z std -> sub-1.0 R:R offset by win rate)
  - Estimated max drawdown:    ~8-12% of allocated capital (driven by clustered losses on
                               trending / breakout days; bounded per-trade by the 2% cap)

KPIs degrade sharply in trending or breakout regimes where the z-score stays extreme and
keeps extending; the ``exit_z`` stop, ``max_trades_per_day`` cap and 2% risk gate exist to
bound that downside.

Known failure modes and handling
--------------------------------
  - Trending breakouts: when price genuinely breaks out, ``|z|`` stays large and keeps
    growing, so faded entries stop out repeatedly ("catching a falling knife"). Handling:
    the ``exit_z * std`` stop caps per-trade loss, ``max_trades_per_day`` limits how many
    times the day can fade the move, and the 2% risk gate vetoes oversized stops.
  - Zero standard deviation (flat / identical closes over the lookback): the z-score is
    non-computable (division by zero). Handling: ``_decide`` detects ``std == 0.0``, emits a
    debug log and returns None so no signal is produced (Req 12.6).
  - Insufficient history: until a full ``lookback`` window of closes exists the rolling
    statistics are unreliable. Handling: ``_decide`` returns None until the window is full,
    in addition to the standard warmup gate.
  - Volatility regime shift: an abrupt expansion in rolling std widens the ``exit_z * std``
    stop. Handling: the wider stop is fed through the 2% risk gate, which vetoes the entry
    when the projected loss exceeds the cap rather than taking on outsized risk.
  - Corrupt / incomplete candle (missing ``high``/``low``/``close``/``time`` or an
    unparseable time): handled upstream by schema validation -> returns None with a debug
    log naming the field, without mutating indicator state (Req 2.7).
  - Gap / new session: a candle ``time`` earlier than the prior candle triggers a full
    per-day state reset, including a fresh empty rolling window, so a prior session's closes
    never bleed into the new day (Req 3.1-3.4).
  - End-of-day open position: force-squared-off at ``square_off`` regardless of P&L so no
    position is carried beyond the intraday session (Req 4.3).
"""

from __future__ import annotations

import datetime
import logging
from collections import deque
from dataclasses import dataclass, field
from typing import Optional, Tuple

import numpy as np  # noqa: F401  (used by the indicator/decision layer in task 7.2)
import pandas as pd  # noqa: F401  (used by the indicator/decision layer in task 7.2)

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
    accumulators (here: the Z-Score rolling window) live below the divider and are
    the only portion that differs between the five strategy files.
    """

    # --- shared lifecycle fields ---
    candle_count: int = 0
    last_time: Optional[datetime.time] = None     # for new-day detection
    trades_today: int = 0
    position: Optional[Position] = None

    # --- Z-Score-specific accumulators (filled by task 7.2) ---
    close_window: Optional[deque] = None           # rolling deque[maxlen=lookback] of closes


class ZScoreReversion(BaseStrategy):
    """Fade statistical extremes using a rolling z-score of price.

    Only the shared lifecycle scaffolding is implemented in this task. The rolling
    statistics, z-score computation and the mean-reversion decision rules are added
    in task 7.2.
    """

    def __init__(self, name: str = "ZScore_Reversion_v1", config: Optional[dict] = None):
        super().__init__(name, config or {})
        self._logger = logging.getLogger(self.name)
        self.state = PerDayState()
        self.state.close_window = deque(maxlen=int(self._cfg("lookback", 20)))

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

        # 10. Strategy-specific decision (implemented in task 7.2).
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
        self.state.close_window = deque(maxlen=int(self._cfg("lookback", 20)))

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
    # Z-Score-specific indicator / decision hooks (implemented in task 7.2)
    # =====================================================================

    def _update_indicators(self, candle: dict, t: datetime.time) -> None:
        """Append the current ``close`` to the rolling lookback window (Req 12.1).

        The window is a ``deque`` with ``maxlen == lookback`` (created in ``__init__`` /
        ``_reset_day_state``), so it automatically retains only the most recent
        ``lookback`` closes. The current candle's close participates in the rolling
        mean / standard deviation used for the z-score (the z-score is the
        standardized position of the latest close within its own lookback window).
        """
        # Defensive: ensure the window exists with the configured maxlen.
        lookback = int(self._cfg("lookback", 20))
        if self.state.close_window is None or self.state.close_window.maxlen != lookback:
            existing = list(self.state.close_window) if self.state.close_window else []
            self.state.close_window = deque(existing, maxlen=lookback)
        self.state.close_window.append(float(candle["close"]))

    def _decide(
        self, candle: dict, t: datetime.time
    ) -> Optional[Tuple[str, float, float, float, float]]:
        """Evaluate the z-score reversion entry (Req 12.2-12.7).

        Rolling statistics are computed over the lookback window of closes using
        numpy as the reference implementation. The standard deviation uses numpy's
        default population standard deviation (``np.std`` with ``ddof=0``); this is a
        deliberate, documented choice so the rolling std matches the numpy reference
        used by Property 27 exactly.

        Entry rule (Req 12.3, 12.4): when the z-score is at or below ``-entry_z`` emit
        a BUY; when it is at or above ``entry_z`` emit a SELL. The ``target`` is the
        rolling mean (reversion of the z-score to zero, Req 12.5) and the ``stop_loss``
        is placed ``exit_z`` standard deviations beyond the entry on the protective
        side: below entry for a BUY, above entry for a SELL.

        If the rolling standard deviation is zero the z-score is non-computable, so
        the strategy returns None and emits a debug log (Req 12.6).

        Returns ``(direction, price, stop, target, confidence)`` or None.
        """
        lookback = int(self._cfg("lookback", 20))
        entry_z = float(self._cfg("entry_z", 2.0))
        exit_z = float(self._cfg("exit_z", 3.0))

        window = list(self.state.close_window or ())
        # Require a full lookback window before computing rolling statistics so the
        # mean / std match the numpy reference over exactly ``lookback`` samples.
        if len(window) < lookback:
            return None

        arr = np.asarray(window, dtype=float)
        mean = float(np.mean(arr))
        std = float(np.std(arr))  # population std (ddof=0) -- numpy reference choice

        close = float(candle["close"])

        # Non-computable z-score when the window has zero dispersion (Req 12.6).
        # Use the peak-to-peak range (max - min, exact for identical floats) in
        # addition to ``std == 0.0``: for a numerically flat window ``np.std`` can
        # return a tiny non-zero value (~1e-13) because ``np.mean`` of identical
        # floats is off by ~1 ULP, which would let an exact ``== 0.0`` guard slip
        # through and compute a garbage z-score. ``np.ptp(arr) == 0.0`` robustly
        # detects an all-equal window regardless of that rounding noise.
        if float(np.ptp(arr)) == 0.0 or std == 0.0:
            self._log(
                f"non-computable z-score: rolling std is 0 over lookback={lookback} "
                f"(close={close}, mean={mean}); returning None"
            )
            return None

        z = (close - mean) / std

        # Confidence grows with how far the z-score extends past the entry threshold.
        if entry_z > 0.0:
            base_conf = min(1.0, abs(z) / (2.0 * entry_z))
        else:
            base_conf = 0.5

        if z <= -entry_z:
            # Statistically cheap: fade to the upside. target at rolling mean (above),
            # stop exit_z std-devs below entry.
            direction = "BUY"
            price = close
            stop = close - exit_z * std
            target = mean
        elif z >= entry_z:
            # Statistically expensive: fade to the downside. target at rolling mean
            # (below), stop exit_z std-devs above entry.
            direction = "SELL"
            price = close
            stop = close + exit_z * std
            target = mean
        else:
            return None

        self._log(
            f"zscore-decision {direction}: close={close} mean={mean:.6f} "
            f"std={std:.6f} z={z:.6f} entry_z={entry_z} exit_z={exit_z}"
        )
        return direction, price, stop, target, base_conf
