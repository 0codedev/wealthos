"""
python-bridge/services/cash_orb_strategy_daemon.py

Cash ORB & RVOL Strategy Autonomous Daemon — Domain 111.

Implements the Captain's manual edge as an autonomous production service:
  1. 09:15–09:30 Opening Range Breakout (ORB) with RVOL validation (>= 2.5x).
  2. 10:00 AM EMA(20) snapback scalp on >3% rallies without consolidation.
  3. Fixed-risk position sizing (never risk more than max_risk_rupees).
  4. Bracket payload generation compatible with bracket_guardian.py.
  5. In-memory per-day fired-signal tracking to prevent duplicate entries.

Self-contained: Python stdlib only (dataclasses, enum, datetime, logging,
typing, asyncio, math, statistics). No FastAPI route changes required.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from dataclasses import dataclass, field
from datetime import datetime, time as dt_time, timedelta, timezone
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

log = logging.getLogger("cash_orb_daemon")

IST = timezone(timedelta(hours=5, minutes=30))

MARKET_OPEN = dt_time(9, 15)
ORB_END = dt_time(9, 30)
SCAN_START = dt_time(9, 30)
SCAN_END = dt_time(11, 30)
EMA_PULLBACK_WINDOW_START = dt_time(10, 0)
EMA_PULLBACK_WINDOW_END = dt_time(11, 0)

RVOL_MIN = 2.5
RVOL_FAKEOUT_FLAG = 1.0
ORB_RANGE_MIN_PCT = 0.002   # opening range must be >= 0.2% of price
ORB_RANGE_MAX_PCT = 0.04    # ... and <= 4% (else too volatile)
EMA_RALLY_MIN_PCT = 0.03    # stock must have rallied >3% for snapback setup
EMA_PULLBACK_TOLERANCE = 0.005  # within 0.5% of EMA20 counts as pullback
ATR_PROXY_SLIPPAGE_BPS = 5  # buffer applied to stop placement
DEFAULT_MAX_RISK_RUPEES = 1000.0
SCAN_INTERVAL_SECONDS = 10.0
MAX_SIGNALS_PER_DAY_PER_SYMBOL = 1


class SignalKind(str, Enum):
    ORB_LONG = "ORB_LONG"
    ORB_SHORT = "ORB_SHORT"
    EMA_PULLBACK_LONG = "EMA_PULLBACK_LONG"
    EMA_SNAPBACK_SHORT = "EMA_SNAPBACK_SHORT"


class SignalReject(str, Enum):
    NONE = "NONE"
    LOW_RVOL_FAKEOUT = "LOW_RVOL_FAKEOUT"
    RANGE_TOO_NARROW = "RANGE_TOO_NARROW"
    RANGE_TOO_WIDE = "RANGE_TOO_WIDE"
    NO_BREAKOUT = "NO_BREAKOUT"
    EMA_TOO_FAR = "EMA_TOO_FAR"
    NOT_IN_SESSION = "NOT_IN_SESSION"
    DUPLICATE = "DUPLICATE"
    INVALID_DATA = "INVALID_DATA"


@dataclass
class OrbSignal:
    symbol: str
    kind: SignalKind
    fired_at: datetime
    entry_price: float
    stop_loss_price: float
    target_price: float
    quantity: int
    rvol: float
    ema20: float
    opening_high: float
    opening_low: float
    opening_range_pct: float
    risk_rupees: float
    reward_to_risk: float
    reject_reason: SignalReject = SignalReject.NONE
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "kind": self.kind.value,
            "fired_at": self.fired_at.isoformat(),
            "entry_price": round(self.entry_price, 2),
            "stop_loss_price": round(self.stop_loss_price, 2),
            "target_price": round(self.target_price, 2),
            "quantity": self.quantity,
            "rvol": round(self.rvol, 2),
            "ema20": round(self.ema20, 2),
            "opening_high": round(self.opening_high, 2),
            "opening_low": round(self.opening_low, 2),
            "opening_range_pct": round(self.opening_range_pct, 4),
            "risk_rupees": round(self.risk_rupees, 2),
            "reward_to_risk": round(self.reward_to_risk, 2),
            "reject_reason": self.reject_reason.value,
            "meta": self.meta,
        }


# ---------------------------------------------------------------------------
# Candle helpers
# ---------------------------------------------------------------------------

_TS_KEYS = ("datetime", "timestamp", "ts", "time", "date", "start")


def _parse_ts(candle: Dict[str, Any]) -> Optional[datetime]:
    for key in _TS_KEYS:
        if key in candle and candle[key] is not None:
            raw = candle[key]
            if isinstance(raw, (int, float)):
                # epoch seconds or milliseconds
                secs = raw / 1000.0 if raw > 10**11 else float(raw)
                try:
                    dt = datetime.fromtimestamp(secs, tz=IST)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=IST)
                    return dt
                except (OverflowError, OSError, ValueError):
                    return None
            if isinstance(raw, str):
                for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S",
                            "%d-%m-%Y %H:%M:%S", "%Y-%m-%d %H:%M", "%H:%M:%S"):
                    try:
                        dt = datetime.strptime(raw, fmt)
                        if fmt == "%H:%M:%S":
                            today = datetime.now(IST).date()
                            dt = datetime.combine(today, dt.time())
                        return dt.replace(tzinfo=IST)
                    except ValueError:
                        continue
                try:
                    return datetime.fromisoformat(raw).replace(tzinfo=IST) \
                        if raw.endswith("+") is False else datetime.fromisoformat(raw)
                except ValueError:
                    return None
            if isinstance(raw, datetime):
                return raw if raw.tzinfo else raw.replace(tzinfo=IST)
    return None


def _float(candle: Dict[str, Any], keys: Sequence[str]) -> Optional[float]:
    for k in keys:
        if k in candle and candle[k] is not None:
            try:
                return float(candle[k])
            except (TypeError, ValueError):
                return None
    return None


def candle_ohlcv(candle: Dict[str, Any]) -> Optional[Tuple[datetime, float, float, float, float, float]]:
    ts = _parse_ts(candle)
    o = _float(candle, ("open", "o"))
    h = _float(candle, ("high", "h"))
    l = _float(candle, ("low", "l"))
    c = _float(candle, ("close", "c"))
    v = _float(candle, ("volume", "v", "vol", "tick_volume"))
    if ts is None or None in (o, h, l, c):
        return None
    return ts, o, h, l, c, v if v is not None else 0.0


def opening_range(candles: List[Dict[str, Any]]) -> Optional[Tuple[float, float, float, float]]:
    """Return (high, low, total_volume, range_pct) for 09:15–09:30 IST."""
    hi = -math.inf
    lo = math.inf
    vol = 0.0
    first_price = None
    last_close = None
    for c in candles:
        parsed = candle_ohlcv(c)
        if parsed is None:
            continue
        ts, o, h, l, cl, v = parsed
        t = ts.time()
        if MARKET_OPEN <= t < ORB_END:
            hi = max(hi, h)
            lo = min(lo, l)
            vol += v
            if first_price is None:
                first_price = o
            last_close = cl
    if hi == -math.inf or first_price is None or first_price <= 0:
        return None
    range_pct = (hi - lo) / first_price if first_price > 0 else 0.0
    return hi, lo, vol, range_pct


def current_15m_bucket_volume(candles: List[Dict[str, Any]], now: datetime) -> float:
    """Sum 1m volumes belonging to the same 15-minute bucket as `now`."""
    bucket_start = now.replace(minute=(now.minute // 15) * 15, second=0, microsecond=0)
    bucket_end = bucket_start + timedelta(minutes=15)
    total = 0.0
    for c in candles:
        parsed = candle_ohlcv(c)
        if parsed is None:
            continue
        ts, _, _, _, _, v = parsed
        if bucket_start <= ts < bucket_end:
            total += v
    return total


def compute_ema(values: Sequence[float], period: int) -> Optional[float]:
    if len(values) < period:
        return None
    k = 2.0 / (period + 1.0)
    ema = sum(values[:period]) / period
    for v in values[period:]:
        ema = v * k + ema * (1.0 - k)
    return ema


def ema_series(values: Sequence[float], period: int) -> List[Optional[float]]:
    out: List[Optional[float]] = [None] * len(values)
    if len(values) < period:
        return out
    k = 2.0 / (period + 1.0)
    ema = sum(values[:period]) / period
    out[period - 1] = ema
    for i in range(period, len(values)):
        ema = values[i] * k + ema * (1.0 - k)
        out[i] = ema
    return out


def last_closes(candles: List[Dict[str, Any]], n: int) -> List[float]:
    closes: List[float] = []
    for c in candles:
        p = candle_ohlcv(c)
        if p is not None:
            closes.append(p[4])
    return closes[-n:] if len(closes) >= n else closes


def consecutive_green_rally(candles: List[Dict[str, Any]], min_pct: float) -> bool:
    """True when the recent run-up is large consecutive green candles (> min_pct)."""
    parsed = [candle_ohlcv(c) for c in candles]
    parsed = [p for p in parsed if p is not None]
    if len(parsed) < 3:
        return False
    greens = 0
    for p in reversed(parsed[-12:]):
        if p[4] > p[1]:
            greens += 1
        else:
            break
    if greens < 3:
        return False
    span = parsed[-greens - 1][4] if len(parsed) > greens else parsed[0][4]
    base = parsed[0][4]
    if span <= 0:
        return False
    return (parsed[-1][4] - base) / base >= min_pct


# ---------------------------------------------------------------------------
# Position sizing
# ---------------------------------------------------------------------------

def calculate_position_size(entry_price: float, stop_loss_price: float,
                            max_risk_rupees: float = DEFAULT_MAX_RISK_RUPEES) -> int:
    """Fixed-risk quantity. Never risks more than max_risk_rupees per trade."""
    if entry_price <= 0 or stop_loss_price <= 0 or max_risk_rupees <= 0:
        return 0
    per_share_risk = abs(entry_price - stop_loss_price)
    if per_share_risk <= 0:
        return 0
    qty = int(math.floor(max_risk_rupees / per_share_risk))
    # hard cap: also cap implied notional at 10x max risk to bound leverage
    notional_cap = int(math.floor((max_risk_rupees * 10.0) / entry_price))
    qty = min(qty, notional_cap)
    return max(qty, 0)


# ---------------------------------------------------------------------------
# Bracket payload builder (compatible with bracket_guardian.BracketRequest)
# ---------------------------------------------------------------------------

def build_bracket_payload(signal: OrbSignal, strategy: str = "CashOrbRVOL",
                          product: str = "MIS", exchange: str = "NSE") -> Dict[str, Any]:
    """Entry LIMIT + protective SL-M + target LIMIT leg descriptors."""
    action = "BUY" if signal.kind in (SignalKind.ORB_LONG, SignalKind.EMA_PULLBACK_LONG) else "SELL"
    exit_action = "SELL" if action == "BUY" else "BUY"
    slip = 1.0 + ATR_PROXY_SLIPPAGE_BPS / 10_000.0
    entry = signal.entry_price * (slip if action == "BUY" else 1.0 / slip)
    common = {
        "symbol": signal.symbol,
        "exchange": exchange,
        "product": product,
        "quantity": signal.quantity,
        "strategy": strategy,
    }
    return {
        "entry": {
            **common,
            "action": action,
            "pricetype": "LIMIT",
            "price": round(entry, 2),
            "trigger_price": 0.0,
        },
        "stop_loss": {
            **common,
            "action": exit_action,
            "pricetype": "SL-M",
            "price": 0.0,
            "trigger_price": round(signal.stop_loss_price, 2),
        },
        "target": {
            **common,
            "action": exit_action,
            "pricetype": "LIMIT",
            "price": round(signal.target_price, 2),
            "trigger_price": 0.0,
        },
        "bracket_request": {
            "symbol": signal.symbol,
            "action": action,
            "exchange": exchange,
            "product": product,
            "quantity": signal.quantity,
            "entry_price": round(entry, 2),
            "stop_loss_price": round(signal.stop_loss_price, 2),
            "target_price": round(signal.target_price, 2),
            "strategy": strategy,
        },
    }


# ---------------------------------------------------------------------------
# Daemon
# ---------------------------------------------------------------------------

class CashOrbStrategyDaemon:
    """Autonomous 09:15 ORB + 10:00 EMA-snapback scanner."""

    def __init__(self, max_risk_rupees: float = DEFAULT_MAX_RISK_RUPEES,
                 scan_interval_s: float = SCAN_INTERVAL_SECONDS,
                 reward_multiple: float = 2.0,
                 rvol_min: float = RVOL_MIN):
        self.max_risk_rupees = max_risk_rupees
        self.scan_interval_s = scan_interval_s
        self.reward_multiple = reward_multiple
        self.rvol_min = rvol_min
        self._fired: Dict[str, datetime] = {}          # symbol -> fire date
        self._signals_today: List[OrbSignal] = []
        self._lock = asyncio.Lock() if _in_loop() else None

    # ----- state / journal -----

    def _already_fired(self, symbol: str, today) -> bool:
        fired_at = self._fired.get(symbol)
        return fired_at is not None and fired_at.date() == today

    def _mark_fired(self, symbol: str, when: datetime) -> None:
        self._fired[symbol] = when

    def reset_daily_state(self) -> None:
        self._fired.clear()
        self._signals_today.clear()

    def fired_symbols(self) -> List[str]:
        return list(self._fired.keys())

    def signals_today(self) -> List[OrbSignal]:
        return list(self._signals_today)

    # ----- core evaluation -----

    def evaluate_orb_setup(self, symbol: str, candles_1m: List[Dict],
                           avg_volume_15m: float) -> Optional[OrbSignal]:
        now = datetime.now(IST)
        if self._already_fired(symbol, now.date()):
            log.info(f"[{symbol}] duplicate suppressed")
            return None

        parsed = [candle_ohlcv(c) for c in candles_1m]
        parsed = [p for p in parsed if p is not None]
        if len(parsed) < 20:
            log.debug(f"[{symbol}] insufficient candles: {len(parsed)}")
            return None

        orb = opening_range(candles_1m)
        if orb is None:
            return None
        hi15, lo15, orb_vol, range_pct = orb

        if range_pct < ORB_RANGE_MIN_PCT:
            log.info(f"[{symbol}] ORB range too narrow: {range_pct:.4f}")
            return None
        if range_pct > ORB_RANGE_MAX_PCT:
            log.info(f"[{symbol}] ORB range too wide: {range_pct:.4f}")
            return None

        last = parsed[-1]
        price = last[4]

        closes = [p[4] for p in parsed]
        ema20 = compute_ema(closes, 20)
        if ema20 is None:
            return None

        # Instantaneous RVOL: current 15m bucket volume vs 10-day avg 15m volume
        bucket_vol = current_15m_bucket_volume(candles_1m, now)
        rvol = (bucket_vol / avg_volume_15m) if avg_volume_15m > 0 else 0.0

        midpoint = (hi15 + lo15) / 2.0

        # ---- ORB breakout branch ----
        if price > hi15:
            if rvol < self.rvol_min:
                log.info(f"[{symbol}] breakout rejected: RVOL {rvol:.2f} < {self.rvol_min}")
                return OrbSignal(
                    symbol=symbol, kind=SignalKind.ORB_LONG, fired_at=now,
                    entry_price=price, stop_loss_price=midpoint,
                    target_price=price + self.reward_multiple * (price - midpoint),
                    quantity=0, rvol=rvol, ema20=ema20,
                    opening_high=hi15, opening_low=lo15, opening_range_pct=range_pct,
                    risk_rupees=0.0, reward_to_risk=self.reward_multiple,
                    reject_reason=SignalReject.LOW_RVOL_FAKEOUT,
                )
            entry = price
            stop = min(midpoint, last[3])  # midpoint or candle low
            if entry - stop <= 0:
                return None
            target = entry + self.reward_multiple * (entry - stop)
            qty = calculate_position_size(entry, stop, self.max_risk_rupees)
            if qty <= 0:
                return None
            signal = OrbSignal(
                symbol=symbol, kind=SignalKind.ORB_LONG, fired_at=now,
                entry_price=entry, stop_loss_price=stop, target_price=target,
                quantity=qty, rvol=rvol, ema20=ema20,
                opening_high=hi15, opening_low=lo15, opening_range_pct=range_pct,
                risk_rupees=qty * (entry - stop), reward_to_risk=self.reward_multiple,
            )
            self._mark_fired(symbol, now)
            self._signals_today.append(signal)
            log.info(f"[{symbol}] ORB_LONG fired entry={entry:.2f} sl={stop:.2f} "
                     f"tgt={target:.2f} qty={qty} rvol={rvol:.2f}")
            return signal

        if price < lo15:
            if rvol < self.rvol_min:
                return None
            entry = price
            stop = max(midpoint, last[2])
            if stop - entry <= 0:
                return None
            target = entry - self.reward_multiple * (stop - entry)
            qty = calculate_position_size(entry, stop, self.max_risk_rupees)
            if qty <= 0:
                return None
            signal = OrbSignal(
                symbol=symbol, kind=SignalKind.ORB_SHORT, fired_at=now,
                entry_price=entry, stop_loss_price=stop, target_price=target,
                quantity=qty, rvol=rvol, ema20=ema20,
                opening_high=hi15, opening_low=lo15, opening_range_pct=range_pct,
                risk_rupees=qty * (stop - entry), reward_to_risk=self.reward_multiple,
            )
            self._mark_fired(symbol, now)
            self._signals_today.append(signal)
            return signal

        # ---- 10:00 EMA snapback branch ----
        t = now.time()
        if EMA_PULLBACK_WINDOW_START <= t <= EMA_PULLBACK_WINDOW_END:
            day_open = parsed[0][1] if parsed[0][1] > 0 else parsed[0][4]
            rallied = (price - day_open) / day_open >= EMA_RALLY_MIN_PCT if day_open > 0 else False
            if rallied and consecutive_green_rally(candles_1m, EMA_RALLY_MIN_PCT):
                dist = abs(price - ema20) / ema20 if ema20 > 0 else math.inf
                if dist <= EMA_PULLBACK_TOLERANCE:
                    bounce = last[4] > last[1]  # current candle green (bounce)
                    if bounce:
                        entry = price
                        stop = ema20 * (1 - EMA_PULLBACK_TOLERANCE)
                        if entry - stop <= 0:
                            return None
                        target = entry + self.reward_multiple * (entry - stop)
                        qty = calculate_position_size(entry, stop, self.max_risk_rupees)
                        if qty <= 0:
                            return None
                        signal = OrbSignal(
                            symbol=symbol, kind=SignalKind.EMA_PULLBACK_LONG, fired_at=now,
                            entry_price=entry, stop_loss_price=stop, target_price=target,
                            quantity=qty, rvol=rvol, ema20=ema20,
                            opening_high=hi15, opening_low=lo15, opening_range_pct=range_pct,
                            risk_rupees=qty * (entry - stop), reward_to_risk=self.reward_multiple,
                            meta={"setup": "ema20_snapback_bounce"},
                        )
                        self._mark_fired(symbol, now)
                        self._signals_today.append(signal)
                        return signal
                    else:
                        entry = price
                        stop = ema20 * (1 + EMA_PULLBACK_TOLERANCE)
                        if stop - entry <= 0:
                            return None
                        target = entry - self.reward_multiple * (stop - entry)
                        qty = calculate_position_size(entry, stop, self.max_risk_rupees)
                        if qty <= 0:
                            return None
                        signal = OrbSignal(
                            symbol=symbol, kind=SignalKind.EMA_SNAPBACK_SHORT, fired_at=now,
                            entry_price=entry, stop_loss_price=stop, target_price=target,
                            quantity=qty, rvol=rvol, ema20=ema20,
                            opening_high=hi15, opening_low=lo15, opening_range_pct=range_pct,
                            risk_rupees=qty * (stop - entry), reward_to_risk=self.reward_multiple,
                            meta={"setup": "ema20_exhaustion_short"},
                        )
                        self._mark_fired(symbol, now)
                        self._signals_today.append(signal)
                        return signal

        return None

    # ----- scan cycle -----

    async def run_scan_cycle(self, broker_client, candidate_symbols: List[str],
                             cycles: int = 1) -> List[OrbSignal]:
        """Scan watchlist every 10s between 09:30 and 11:30 IST.

        broker_client must expose an async or sync method:
            get_intraday_candles(symbol, interval="1m") -> List[Dict]
        and a numeric property/method avg volume:
            get_average_15m_volume(symbol) -> float
        Both are duck-typed; failures per-symbol are logged and skipped.
        `cycles` bounds testability; pass 0 for "until scan window ends".
        """
        collected: List[OrbSignal] = []
        cycle = 0
        while True:
            now = datetime.now(IST).time()
            if not (SCAN_START <= now <= SCAN_END):
                log.info("[SCAN] outside 09:30–11:30 IST window; cycle paused")
                await asyncio.sleep(self.scan_interval_s)
                cycle += 1
                if cycles and cycle >= cycles:
                    return collected
                continue

            for symbol in candidate_symbols:
                try:
                    candles = await _maybe_await(
                        broker_client.get_intraday_candles(symbol, interval="1m"))
                    avg_vol = _float_from(
                        await _maybe_await(broker_client.get_average_15m_volume(symbol)))
                    if not candles:
                        continue
                    signal = self.evaluate_orb_setup(symbol, candles, avg_vol)
                    if signal is not None and signal.quantity > 0 \
                            and signal.reject_reason == SignalReject.NONE:
                        collected.append(signal)
                        payload = build_bracket_payload(signal)
                        log.info(f"[SCAN] signal {signal.kind.value} {symbol} "
                                 f"qty={signal.quantity} rvol={signal.rvol:.2f}")
                        if hasattr(broker_client, "submit_bracket"):
                            await _maybe_await(
                                broker_client.submit_bracket(payload["bracket_request"]))
                except Exception as exc:  # noqa: BLE001 — per-symbol isolation
                    log.error(f"[SCAN] {symbol} failed: {exc}")

            cycle += 1
            if cycles and cycle >= cycles:
                return collected
            await asyncio.sleep(self.scan_interval_s)


async def _maybe_await(value):
    if asyncio.iscoroutine(value) or isinstance(value, asyncio.Future):
        return await value
    return value


def _float_from(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _in_loop() -> bool:
    try:
        asyncio.get_running_loop()
        return True
    except RuntimeError:
        return False
