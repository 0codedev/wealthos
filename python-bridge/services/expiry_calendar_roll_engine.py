"""python-bridge/services/expiry_calendar_roll_engine.py — Cross-Exchange Calendar Roll
and Expiry Transition Engine for Indian F&O markets.

Handles:
  * Indian staggered weekly/monthly expiry cycles:
      BankNIFTY (Wed), NIFTY (Thu), SENSEX (Fri), monthly stock F&O (last Thu).
  * Liquidity cliff detection: bid-ask spread explosion + market-maker withdrawal
    post-14:00 IST on expiry day.
  * Physical Delivery Margin Surge Sieve: NSE physical-delivery margin escalation
    starting E-4 days prior to monthly stock expiry (20% -> 40% -> 60% -> 100%).
    Sieve auto-closes/rolls stock F&O positions before margin multipliers trigger
    broker auto-square-off penalties.
  * Optimal Roll Execution Protocol:
      - atomic calendar spread vs leg-by-leg synthetic slicing
      - delta-neutral roll balancing across strikes
      - roll cost vs theta decay salvage optimisation (ΔPnL_roll formula)
  * Fail-safe liquidation guards.

Self-contained, strictly typed, degrades gracefully when optional upstreams
(requests, derivatives math) are unavailable.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, date, timedelta, timezone
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

try:
    from logger import get_logger
except Exception:  # pragma: no cover
    def get_logger(name: str, tag: str = None) -> logging.Logger:  # type: ignore[misc]
        lg = logging.getLogger(name)
        if not lg.handlers:
            lg.addHandler(logging.StreamHandler())
        return lg

log = get_logger("expiry_calendar_roll_engine", tag="ROLL")

try:
    import requests as _requests
except Exception:  # pragma: no cover
    _requests = None


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
STRATEGY_TAG: str = "CROSS_EXCHANGE_CALENDAR_ROLL"

# IST offset
IST_OFFSET = timedelta(hours=5, minutes=30)

# Expiry weekday mapping (Monday=0 ... Sunday=6)
INDEX_EXPIRY_WEEKDAY: Dict[str, int] = {
    "BANKNIFTY": 2,   # Wednesday
    "NIFTY": 3,       # Thursday
    "SENSEX": 4,      # Friday
    "NIFTY50": 3,
}

# Market close
MARKET_CLOSE_HOUR = 15
MARKET_CLOSE_MIN = 30
LIQUIDITY_CLIFF_CUTOFF_HOUR = 14  # post-14:00 IST

# Physical delivery margin tiers by days-to-expiry (E-4..E-0)
PD_MARGIN_TIERS: Dict[int, float] = {
    0: 1.00,
    1: 1.00,
    2: 0.60,
    3: 0.40,
    4: 0.20,
}
PD_SIEVE_TRIGGER_TIER: float = 0.40  # close/roll when tier >= 40%

# Liquidity cliff thresholds
SPREAD_EXPLOSION_MULT: float = 3.0
DEPTH_WITHDRAWAL_RATIO: float = 0.30

# Roll defaults
DEFAULT_ROLL_COST_BPS: float = 8.0  # transaction cost in bps
DEFAULT_SLIPPAGE_BPS: float = 5.0
MAX_ROLL_ATTEMPTS: int = 3

OPENALGO_HOST_DEFAULT: str = os.getenv("OPENALGO_HOST", "http://127.0.0.1:5000")
OPENALGO_API_KEY_DEFAULT: str = os.getenv("OPENALGO_API_KEY", "openalgo_mcp_api_key_2026")

RISK_FREE_RATE: float = 0.07


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class RollPhase(str, Enum):
    IDLE = "IDLE"
    DETECT = "DETECT"
    SIEVE = "SIEVE"
    PLAN = "PLAN"
    EXECUTE = "EXECUTE"
    VERIFY = "VERIFY"
    LIQUIDATE = "LIQUIDATE"
    CLOSED = "CLOSED"
    FAILED = "FAILED"


class RollAction(str, Enum):
    HOLD = "HOLD"
    ROLL = "ROLL"
    CLOSE = "CLOSE"
    LIQUIDATE = "LIQUIDATE"
    SKIP = "SKIP"


class ExecutionMode(str, Enum):
    ATOMIC_SPREAD = "ATOMIC_SPREAD"
    LEG_BY_LEG = "LEG_BY_LEG"


class InstrumentKind(str, Enum):
    INDEX_WEEKLY = "INDEX_WEEKLY"
    STOCK_MONTHLY = "STOCK_MONTHLY"


class Exchange(str, Enum):
    NFO = "NFO"
    BFO = "BFO"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _safe_float(v: Any, d: float = 0.0) -> float:
    try:
        if v is None:
            return d
        return float(v)
    except (TypeError, ValueError):
        return d


def _safe_int(v: Any, d: int = 0) -> int:
    try:
        if v is None:
            return d
        return int(float(v))
    except (TypeError, ValueError):
        return d


def _safe_str(v: Any, d: str = "") -> str:
    if v is None:
        return d
    return str(v)


def _now_ist() -> datetime:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Asia/Kolkata"))
    except Exception:
        return datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=5, minutes=30)))


def _parse_date(v: Any) -> Optional[date]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = _safe_str(v).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y%m%d"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except Exception:
        return None


def _time_str(dt: Optional[datetime] = None) -> str:
    if dt is None:
        dt = _now_ist()
    return dt.strftime("%H:%M")


def _is_weekend(d: date) -> bool:
    return d.weekday() >= 5


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass
class RollConfig:
    underlying: str = "NIFTY"
    exchange: str = Exchange.NFO.value
    instrument_kind: str = InstrumentKind.INDEX_WEEKLY.value
    roll_cost_bps: float = DEFAULT_ROLL_COST_BPS
    slippage_bps: float = DEFAULT_SLIPPAGE_BPS
    spread_explosion_mult: float = SPREAD_EXPLOSION_MULT
    depth_withdrawal_ratio: float = DEPTH_WITHDRAWAL_RATIO
    pd_sieve_trigger_tier: float = PD_SIEVE_TRIGGER_TIER
    max_roll_attempts: int = MAX_ROLL_ATTEMPTS
    delta_tolerance: float = 0.05
    openalgo_host: str = OPENALGO_HOST_DEFAULT
    openalgo_api_key: str = OPENALGO_API_KEY_DEFAULT


@dataclass
class PositionLeg:
    side: str = "CE"          # CE / PE
    position: str = "SHORT"   # SHORT / LONG
    strike: float = 0.0
    expiry: Optional[str] = None
    premium: float = 0.0
    quantity: int = 0
    delta: float = 0.0
    theta: float = 0.0
    instrument_key: Optional[str] = None
    trading_symbol: Optional[str] = None
    meta: Dict[str, Any] = field(default_factory=dict)

    def signed_delta(self) -> float:
        mult = -1.0 if self.position.upper() == "SHORT" else 1.0
        return mult * self.delta * (abs(self.quantity) if self.quantity else 1)


@dataclass
class RollPosition:
    position_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    underlying: str = "NIFTY"
    exchange: str = Exchange.NFO.value
    instrument_kind: str = InstrumentKind.INDEX_WEEKLY.value
    expiry: Optional[str] = None
    legs: List[PositionLeg] = field(default_factory=list)
    lots: int = 1
    lot_size: int = 1
    is_stock_fo: bool = False
    physical_delivery: bool = False
    phase: RollPhase = RollPhase.IDLE
    roll_attempts: int = 0
    meta: Dict[str, Any] = field(default_factory=dict)

    def net_delta(self) -> float:
        return float(sum(l.signed_delta() for l in self.legs))

    def net_theta(self) -> float:
        mult_sign = 1.0
        total = 0.0
        for l in self.legs:
            m = -1.0 if l.position.upper() == "SHORT" else 1.0
            total += m * l.theta * (abs(l.quantity) if l.quantity else 1)
        return total

    def mark_value(self) -> float:
        total = 0.0
        for l in self.legs:
            m = -1.0 if l.position.upper() == "SHORT" else 1.0
            total += m * l.premium * (abs(l.quantity) if l.quantity else 1)
        return total


@dataclass
class LiquiditySnapshot:
    symbol: str
    timestamp: Optional[datetime] = None
    bid: float = 0.0
    ask: float = 0.0
    bid_qty: float = 0.0
    ask_qty: float = 0.0
    baseline_spread_bps: float = 0.0
    baseline_depth: float = 0.0
    is_expiry_day: bool = False

    def spread(self) -> float:
        return max(0.0, self.ask - self.bid)

    def mid(self) -> float:
        if self.bid <= 0 or self.ask <= 0:
            return 0.0
        return (self.bid + self.ask) / 2.0

    def spread_bps(self) -> float:
        m = self.mid()
        if m <= 0:
            return 0.0
        return (self.spread() / m) * 10000.0

    def depth(self) -> float:
        return self.bid_qty + self.ask_qty


@dataclass
class RollPlan:
    plan_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    position_id: str = ""
    from_expiry: Optional[str] = None
    to_expiry: Optional[str] = None
    mode: str = ExecutionMode.ATOMIC_SPREAD.value
    legs_close: List[PositionLeg] = field(default_factory=list)
    legs_open: List[PositionLeg] = field(default_factory=list)
    delta_before: float = 0.0
    delta_after: float = 0.0
    estimated_cost: float = 0.0
    theta_salvage: float = 0.0
    roll_pnl: float = 0.0
    reason: str = ""
    guard_ok: bool = True


# ---------------------------------------------------------------------------
# Expiry calendar
# ---------------------------------------------------------------------------
def instrument_kind_for(underlying: str) -> str:
    u = _safe_str(underlying).upper()
    if u in INDEX_EXPIRY_WEEKDAY:
        return InstrumentKind.INDEX_WEEKLY.value
    return InstrumentKind.STOCK_MONTHLY.value


def expiry_weekday(underlying: str) -> int:
    u = _safe_str(underlying).upper()
    return INDEX_EXPIRY_WEEKDAY.get(u, 3)  # default Thursday


def last_thursday_of_month(y: int, m: int) -> date:
    # last day of month
    if m == 12:
        last = date(y + 1, 1, 1) - timedelta(days=1)
    else:
        last = date(y, m + 1, 1) - timedelta(days=1)
    d = last
    while d.weekday() != 3:  # Thursday
        d -= timedelta(days=1)
    return d


def next_index_expiry(underlying: str, now: Optional[datetime] = None) -> date:
    if now is None:
        now = _now_ist()
    wd = expiry_weekday(underlying)
    d = now.date()
    # if today is expiry weekday and before market close -> today
    if d.weekday() == wd and (now.hour, now.minute) < (MARKET_CLOSE_HOUR, MARKET_CLOSE_MIN):
        return d
    # advance
    days_ahead = (wd - d.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7
    cand = d + timedelta(days=days_ahead)
    return cand


def next_stock_monthly_expiry(now: Optional[datetime] = None) -> date:
    if now is None:
        now = _now_ist()
    d = now.date()
    # current month last thursday
    cur = last_thursday_of_month(d.year, d.month)
    if cur >= d and not (cur == d and (now.hour, now.minute) >= (MARKET_CLOSE_HOUR, MARKET_CLOSE_MIN)):
        return cur
    # next month
    if d.month == 12:
        return last_thursday_of_month(d.year + 1, 1)
    return last_thursday_of_month(d.year, d.month + 1)


def next_expiry(underlying: str, now: Optional[datetime] = None, instrument_kind: Optional[str] = None) -> date:
    if now is None:
        now = _now_ist()
    kind = instrument_kind or instrument_kind_for(underlying)
    if kind == InstrumentKind.STOCK_MONTHLY.value:
        return next_stock_monthly_expiry(now)
    return next_index_expiry(underlying, now)


def days_to_expiry(expiry: Any, now: Optional[datetime] = None) -> int:
    if now is None:
        now = _now_ist()
    d = _parse_date(expiry)
    if d is None:
        return 7
    delta = (d - now.date()).days
    return int(delta)


def is_expiry_day(underlying: str, expiry: Any = None, now: Optional[datetime] = None) -> bool:
    if now is None:
        now = _now_ist()
    if expiry is None:
        expiry = next_expiry(underlying, now, instrument_kind_for(underlying))
    d = _parse_date(expiry)
    if d is None:
        return False
    return d == now.date()


# ---------------------------------------------------------------------------
# Physical delivery margin sieve
# ---------------------------------------------------------------------------
def physical_delivery_margin_tier(days_to_exp: int) -> float:
    """Return margin multiplier (0..1) for NSE physical delivery escalation."""
    if days_to_exp <= 0:
        return 1.00
    if days_to_exp in PD_MARGIN_TIERS:
        return PD_MARGIN_TIERS[days_to_exp]
    if days_to_exp >= 5:
        return 0.0
    # interpolate for >4? keep last known
    if days_to_exp > 4:
        return 0.0
    return PD_MARGIN_TIERS.get(4, 0.20)


def margin_surge_active(days_to_exp: int, trigger: float = PD_SIEVE_TRIGGER_TIER) -> bool:
    return physical_delivery_margin_tier(days_to_exp) >= trigger


def sieve_stock_fo_positions(
    positions: List[RollPosition],
    now: Optional[datetime] = None,
    trigger_tier: float = PD_SIEVE_TRIGGER_TIER,
) -> List[Dict[str, Any]]:
    """Return sieve decisions for stock F&O positions approaching monthly expiry.

    Each decision: {position_id, action: CLOSE|ROLL, tier, days_to_expiry, reason}
    """
    if now is None:
        now = _now_ist()
    decisions: List[Dict[str, Any]] = []
    for pos in positions or []:
        if not getattr(pos, "is_stock_fo", False) and pos.instrument_kind != InstrumentKind.STOCK_MONTHLY.value:
            continue
        if not getattr(pos, "physical_delivery", True):
            # default treat stock F&O as physical delivery eligible
            pass
        dte = days_to_expiry(pos.expiry, now)
        tier = physical_delivery_margin_tier(dte)
        if tier >= trigger_tier:
            # if enough DTE remains to roll (>=2), roll; else close
            action = RollAction.ROLL.value if dte >= 2 else RollAction.CLOSE.value
            decisions.append({
                "position_id": pos.position_id,
                "underlying": pos.underlying,
                "expiry": pos.expiry,
                "days_to_expiry": dte,
                "margin_tier": tier,
                "action": action,
                "reason": "PD margin surge tier {:.0%} at E-{} (auto-square-off avoidance)".format(tier, dte),
            })
    return decisions


# ---------------------------------------------------------------------------
# Liquidity cliff detection
# ---------------------------------------------------------------------------
def liquidity_cliff_detected(
    snap: LiquiditySnapshot,
    now: Optional[datetime] = None,
    cutoff_hour: int = LIQUIDITY_CLIFF_CUTOFF_HOUR,
    spread_mult: float = SPREAD_EXPLOSION_MULT,
    depth_ratio: float = DEPTH_WITHDRAWAL_RATIO,
) -> Tuple[bool, Dict[str, Any]]:
    """Detect liquidity cliff on expiry day post-cutoff.

    Returns (detected, diagnostics).
    """
    if now is None:
        now = _now_ist()
    diag: Dict[str, Any] = {
        "is_expiry_day": snap.is_expiry_day,
        "post_cutoff": (now.hour, now.minute) >= (cutoff_hour, 0),
        "spread_bps": round(snap.spread_bps(), 4),
        "baseline_spread_bps": snap.baseline_spread_bps,
        "depth": snap.depth(),
        "baseline_depth": snap.baseline_depth,
    }
    if not snap.is_expiry_day:
        return False, {**diag, "reason": "not expiry day"}
    if (now.hour, now.minute) < (cutoff_hour, 0):
        return False, {**diag, "reason": "before cutoff"}

    spread_exploded = False
    if snap.baseline_spread_bps > 0:
        spread_exploded = snap.spread_bps() >= spread_mult * snap.baseline_spread_bps
    depth_withdrawn = False
    if snap.baseline_depth > 0:
        depth_withdrawn = snap.depth() <= depth_ratio * snap.baseline_depth
    # also absolute: zero depth on one side
    one_sided = snap.bid_qty <= 0 or snap.ask_qty <= 0

    detected = spread_exploded or depth_withdrawn or one_sided
    reasons = []
    if spread_exploded:
        reasons.append("spread explosion: {:.1f}bps >= {:.1f}x baseline".format(snap.spread_bps(), spread_mult))
    if depth_withdrawn:
        reasons.append("market-maker withdrawal: depth {:.0f} <= {:.0%} of baseline".format(snap.depth(), depth_ratio))
    if one_sided:
        reasons.append("one-sided book")
    return detected, {**diag, "detected": detected, "reasons": reasons,
                      "spread_exploded": spread_exploded, "depth_withdrawn": depth_withdrawn, "one_sided": one_sided}


# ---------------------------------------------------------------------------
# Roll cost vs theta decay salvage
# ---------------------------------------------------------------------------
def roll_cost(
    quantity: int,
    price_per_unit_old: float,
    price_per_unit_new: float,
    roll_cost_bps: float = DEFAULT_ROLL_COST_BPS,
    slippage_bps: float = DEFAULT_SLIPPAGE_BPS,
) -> float:
    """Transaction + slippage cost of rolling (in currency units)."""
    notional = abs(quantity) * max(price_per_unit_old, price_per_unit_new, 1.0)
    return notional * (roll_cost_bps + slippage_bps) / 10000.0


def theta_salvage(
    old_theta: float,
    days_remaining_old: int,
    days_remaining_new: int,
) -> float:
    """Theta decay salvaged by rolling earlier (value of decay avoided).

    Rolling from a near-expiry high-theta position to a further-dated lower-theta
    position salvages the accelerated decay of the last days.
    """
    # old position would decay theta_old * days_remaining_old (negative for shorts? use abs)
    avoided = abs(old_theta) * max(0, days_remaining_old - days_remaining_new)
    # new position accrues less theta
    return float(avoided)


def delta_pnl_roll(
    old_value: float,
    new_value: float,
    roll_cost_value: float,
    theta_salvage_value: float,
) -> float:
    """ΔPnL_roll = (V_new - V_old) - C_roll + Θ_salvage."""
    return (new_value - old_value) - roll_cost_value + theta_salvage_value


def compute_roll_pnl(
    pos: RollPosition,
    new_legs: List[PositionLeg],
    new_expiry: Any,
    now: Optional[datetime] = None,
    roll_cost_bps: float = DEFAULT_ROLL_COST_BPS,
    slippage_bps: float = DEFAULT_SLIPPAGE_BPS,
) -> Dict[str, Any]:
    if now is None:
        now = _now_ist()
    old_value = pos.mark_value()
    new_value = 0.0
    for l in new_legs:
        m = -1.0 if l.position.upper() == "SHORT" else 1.0
        new_value += m * l.premium * (abs(l.quantity) if l.quantity else 1)
    total_qty = sum(abs(l.quantity) for l in pos.legs) or pos.lots * pos.lot_size
    rc = roll_cost(total_qty, _avg_premium(pos.legs), _avg_premium(new_legs), roll_cost_bps, slippage_bps)
    old_theta = pos.net_theta()
    dte_old = days_to_expiry(pos.expiry, now)
    dte_new = days_to_expiry(new_expiry, now)
    ts = theta_salvage(old_theta, dte_old, dte_new)
    pnl = delta_pnl_roll(old_value, new_value, rc, ts)
    return {
        "old_value": round(old_value, 4),
        "new_value": round(new_value, 4),
        "roll_cost": round(rc, 4),
        "theta_salvage": round(ts, 4),
        "delta_pnl_roll": round(pnl, 4),
        "dte_old": dte_old,
        "dte_new": dte_new,
    }


def _avg_premium(legs: List[PositionLeg]) -> float:
    if not legs:
        return 0.0
    tot = sum(abs(l.premium) for l in legs)
    return tot / len(legs)


# ---------------------------------------------------------------------------
# Delta-neutral roll balancing
# ---------------------------------------------------------------------------
def net_delta_of_legs(legs: List[PositionLeg]) -> float:
    return float(sum(l.signed_delta() for l in legs))


def balance_roll_strikes(
    candidate_legs: List[PositionLeg],
    target_delta: float = 0.0,
    tolerance: float = 0.05,
) -> Dict[str, Any]:
    """Select subset/order of candidate legs to keep net delta within tolerance of target."""
    # Greedy: sort by delta contribution, pick combination minimizing |net - target|.
    # For simplicity, evaluate all subsets if small, else greedy.
    import itertools
    best = None
    best_err = float("inf")
    legs = list(candidate_legs)
    n = len(legs)
    # try full set first
    full_delta = net_delta_of_legs(legs)
    if abs(full_delta - target_delta) <= tolerance:
        return {"selected": legs, "net_delta": full_delta, "balanced": True, "error": abs(full_delta - target_delta)}
    # search subsets of size >=1
    for r in range(1, n + 1):
        for combo in itertools.combinations(legs, r):
            nd = net_delta_of_legs(list(combo))
            err = abs(nd - target_delta)
            if err < best_err:
                best_err = err
                best = list(combo)
    if best is None:
        best = legs
        best_err = abs(net_delta_of_legs(legs) - target_delta)
    nd = net_delta_of_legs(best)
    return {"selected": best, "net_delta": nd, "balanced": best_err <= tolerance, "error": best_err}


# ---------------------------------------------------------------------------
# Execution mode decision
# ---------------------------------------------------------------------------
def choose_execution_mode(
    snap: Optional[LiquiditySnapshot] = None,
    now: Optional[datetime] = None,
    dte: int = 0,
) -> str:
    """Atomic spread vs leg-by-leg synthetic slicing."""
    if now is None:
        now = _now_ist()
    # If liquidity cliff detected -> atomic spread (single combo, less leg risk)
    if snap is not None:
        detected, _ = liquidity_cliff_detected(snap, now)
        if detected:
            return ExecutionMode.ATOMIC_SPREAD.value
    # Near expiry (<=1 DTE) -> atomic to avoid leg slippage
    if dte <= 1:
        return ExecutionMode.ATOMIC_SPREAD.value
    # Otherwise leg-by-leg can be cheaper
    return ExecutionMode.LEG_BY_LEG.value


# ---------------------------------------------------------------------------
# Fail-safe liquidation guards
# ---------------------------------------------------------------------------
class LiquidationGuard:
    def __init__(self, max_attempts: int = MAX_ROLL_ATTEMPTS) -> None:
        self.max_attempts = max_attempts
        self._attempts: Dict[str, int] = {}

    def can_roll(self, position_id: str) -> bool:
        return self._attempts.get(position_id, 0) < self.max_attempts

    def record_attempt(self, position_id: str) -> int:
        self._attempts[position_id] = self._attempts.get(position_id, 0) + 1
        return self._attempts[position_id]

    def reset(self, position_id: str) -> None:
        self._attempts.pop(position_id, None)

    def fail_safe_flatten_orders(
        self,
        positions: List[RollPosition],
        reason: str = "fail-safe",
    ) -> List[Dict[str, Any]]:
        """Generate market square-off orders for all positions (fail-safe)."""
        orders: List[Dict[str, Any]] = []
        for pos in positions or []:
            for leg in pos.legs:
                action = "BUY" if leg.position.upper() == "SHORT" else "SELL"
                orders.append({
                    "position_id": pos.position_id,
                    "underlying": pos.underlying,
                    "exchange": pos.exchange,
                    "symbol": leg.trading_symbol or "{}{}{}{}".format(pos.underlying, pos.expiry or "", int(leg.strike), leg.side),
                    "action": action,
                    "quantity": abs(leg.quantity) if leg.quantity else pos.lots * pos.lot_size,
                    "pricetype": "MARKET",
                    "reason": reason,
                    "fail_safe": True,
                })
        return orders


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------
VALID_TRANSITIONS: Dict[RollPhase, set] = {
    RollPhase.IDLE: {RollPhase.DETECT},
    RollPhase.DETECT: {RollPhase.SIEVE, RollPhase.LIQUIDATE, RollPhase.CLOSED},
    RollPhase.SIEVE: {RollPhase.PLAN, RollPhase.LIQUIDATE, RollPhase.CLOSED},
    RollPhase.PLAN: {RollPhase.EXECUTE, RollPhase.LIQUIDATE, RollPhase.FAILED},
    RollPhase.EXECUTE: {RollPhase.VERIFY, RollPhase.FAILED, RollPhase.LIQUIDATE},
    RollPhase.VERIFY: {RollPhase.CLOSED, RollPhase.FAILED, RollPhase.DETECT},
    RollPhase.LIQUIDATE: {RollPhase.CLOSED, RollPhase.FAILED},
    RollPhase.CLOSED: {RollPhase.IDLE},
    RollPhase.FAILED: {RollPhase.IDLE, RollPhase.LIQUIDATE},
}


def can_transition(src: RollPhase, dst: RollPhase) -> bool:
    return dst in VALID_TRANSITIONS.get(src, set())


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------
class ExpiryCalendarRollEngine:
    def __init__(self, config: Optional[RollConfig] = None) -> None:
        self.config = config or RollConfig()
        self.positions: Dict[str, RollPosition] = {}
        self.guard = LiquidationGuard(self.config.max_roll_attempts)
        self._running: bool = False

    # ---- expiry helpers ----
    def next_expiry_date(self, underlying: str, now: Optional[datetime] = None) -> date:
        kind = instrument_kind_for(underlying)
        if underlying.upper() in ("",) :
            pass
        # stock detection: if config says stock or unknown -> monthly? keep heuristic
        return next_expiry(underlying, now, kind)

    def days_to_expiry(self, expiry: Any, now: Optional[datetime] = None) -> int:
        return days_to_expiry(expiry, now)

    # ---- sieve ----
    def run_sieve(self, positions: Optional[List[RollPosition]] = None, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
        if positions is None:
            positions = list(self.positions.values())
        return sieve_stock_fo_positions(positions, now, self.config.pd_sieve_trigger_tier)

    # ---- plan roll ----
    def plan_roll(
        self,
        pos: RollPosition,
        new_expiry: Any,
        new_legs: List[PositionLeg],
        now: Optional[datetime] = None,
        snap: Optional[LiquiditySnapshot] = None,
    ) -> RollPlan:
        if now is None:
            now = _now_ist()
        dte = days_to_expiry(pos.expiry, now)
        mode = choose_execution_mode(snap, now, dte)
        # delta balancing
        bal = balance_roll_strikes(new_legs, target_delta=pos.net_delta(), tolerance=self.config.delta_tolerance)
        selected = bal["selected"]
        # costs
        metrics = compute_roll_pnl(pos, selected, new_expiry, now, self.config.roll_cost_bps, self.config.slippage_bps)
        plan = RollPlan(
            position_id=pos.position_id,
            from_expiry=pos.expiry,
            to_expiry=_safe_str(new_expiry),
            mode=mode,
            legs_close=list(pos.legs),
            legs_open=selected,
            delta_before=pos.net_delta(),
            delta_after=bal["net_delta"],
            estimated_cost=metrics["roll_cost"],
            theta_salvage=metrics["theta_salvage"],
            roll_pnl=metrics["delta_pnl_roll"],
            reason="calendar roll {} -> {}".format(pos.expiry, new_expiry),
            guard_ok=self.guard.can_roll(pos.position_id) and bal["balanced"],
        )
        if not bal["balanced"]:
            plan.reason += " (delta imbalance {:.4f})".format(bal["error"])
        return plan

    # ---- execute (paper: returns plan + orders) ----
    def execute_roll(self, plan: RollPlan, host: Optional[str] = None, api_key: Optional[str] = None, live: bool = False) -> Dict[str, Any]:
        host = host or self.config.openalgo_host
        api_key = api_key or self.config.openalgo_api_key
        # guard
        pos = self.positions.get(plan.position_id)
        if pos is not None and not self.guard.can_roll(plan.position_id):
            return {"status": "blocked", "reason": "max roll attempts exceeded", "plan_id": plan.plan_id}
        if pos is not None:
            self.guard.record_attempt(plan.position_id)

        # transition
        if pos is not None:
            if can_transition(pos.phase, RollPhase.EXECUTE):
                pos.phase = RollPhase.EXECUTE

        orders: List[Dict[str, Any]] = []
        # close old legs
        for leg in plan.legs_close:
            action = "BUY" if leg.position.upper() == "SHORT" else "SELL"
            orders.append({
                "leg": "CLOSE {} {} {}".format(leg.position, leg.strike, leg.side),
                "action": action,
                "symbol": leg.trading_symbol or "{}{}{}{}".format(pos.underlying if pos else "", plan.from_expiry or "", int(leg.strike), leg.side),
                "exchange": pos.exchange if pos else self.config.exchange,
                "quantity": abs(leg.quantity) if leg.quantity else 1,
                "pricetype": "MARKET",
                "mode": plan.mode,
            })
        # open new legs
        for leg in plan.legs_open:
            action = "SELL" if leg.position.upper() == "SHORT" else "BUY"
            orders.append({
                "leg": "OPEN {} {} {}".format(leg.position, leg.strike, leg.side),
                "action": action,
                "symbol": leg.trading_symbol or "{}{}{}{}".format(pos.underlying if pos else "", plan.to_expiry or "", int(leg.strike), leg.side),
                "exchange": pos.exchange if pos else self.config.exchange,
                "quantity": abs(leg.quantity) if leg.quantity else 1,
                "pricetype": "MARKET",
                "mode": plan.mode,
            })

        # dispatch if live
        dispatch_results = []
        if live and _requests is not None:
            session = _requests.Session()
            for o in orders:
                try:
                    url = "{}/api/v1/placeorder".format(host.rstrip("/"))
                    payload = {
                        "apikey": api_key,
                        "strategy": STRATEGY_TAG,
                        "symbol": o["symbol"],
                        "action": o["action"],
                        "exchange": o["exchange"],
                        "pricetype": o["pricetype"],
                        "product": "NRML",
                        "quantity": o["quantity"],
                        "price": 0.0,
                        "trigger_price": 0.0,
                        "disclosed_quantity": 0,
                        "mode": "live",
                    }
                    resp = session.post(url, json=payload, timeout=10.0)
                    dispatch_results.append({"order": o["leg"], "http_status": resp.status_code, "status": "success" if resp.status_code < 400 else "error"})
                except Exception as exc:
                    dispatch_results.append({"order": o["leg"], "status": "error", "reason": str(exc)})

        # update position on success (paper success assumed)
        if pos is not None:
            pos.expiry = plan.to_expiry
            pos.legs = list(plan.legs_open)
            if can_transition(pos.phase, RollPhase.VERIFY):
                pos.phase = RollPhase.VERIFY
            # then closed-ish -> active
            pos.phase = RollPhase.IDLE if False else pos.phase

        return {
            "status": "success",
            "plan_id": plan.plan_id,
            "mode": plan.mode,
            "orders": orders,
            "dispatch": dispatch_results,
            "roll_pnl": plan.roll_pnl,
        }

    def fail_safe_liquidate(self, positions: Optional[List[RollPosition]] = None, reason: str = "fail-safe") -> Dict[str, Any]:
        if positions is None:
            positions = list(self.positions.values())
        orders = self.guard.fail_safe_flatten_orders(positions, reason)
        for pos in positions:
            pos.phase = RollPhase.LIQUIDATE
        return {"status": "liquidating", "reason": reason, "orders": orders, "count": len(orders)}

    # ---- orchestration ----
    def run_cycle(
        self,
        positions: Optional[List[RollPosition]] = None,
        now: Optional[datetime] = None,
        liquidity: Optional[Dict[str, LiquiditySnapshot]] = None,
    ) -> Dict[str, Any]:
        if now is None:
            now = _now_ist()
        if positions is None:
            positions = list(self.positions.values())
        # register
        for p in positions:
            self.positions[p.position_id] = p

        actions: List[Dict[str, Any]] = []
        # 1. sieve
        sieve_decisions = self.run_sieve(positions, now)
        for sd in sieve_decisions:
            actions.append({"type": "sieve", **sd})

        # 2. liquidity cliff + expiry day handling
        for pos in positions:
            snap = (liquidity or {}).get(pos.underlying)
            if snap is not None and is_expiry_day(pos.underlying, pos.expiry, now):
                detected, diag = liquidity_cliff_detected(snap, now)
                if detected:
                    actions.append({"type": "liquidity_cliff", "position_id": pos.position_id, "diagnostics": diag})
                    # fail-safe liquidate if cliff
                    actions.append(self.fail_safe_liquidate([pos], reason="liquidity cliff"))

        # 3. roll decisions for positions near expiry (<=2 DTE) that are index weekly
        for pos in positions:
            dte = days_to_expiry(pos.expiry, now)
            if dte <= 2 and pos.phase not in (RollPhase.LIQUIDATE, RollPhase.CLOSED):
                # find new expiry
                new_exp = next_expiry(pos.underlying, now, pos.instrument_kind)
                # if same as current, push next
                if _safe_str(new_exp) == _safe_str(pos.expiry):
                    # advance one cycle
                    if pos.instrument_kind == InstrumentKind.STOCK_MONTHLY.value:
                        new_exp = next_stock_monthly_expiry(now + timedelta(days=7))
                    else:
                        new_exp = next_index_expiry(pos.underlying, now + timedelta(days=7))
                actions.append({
                    "type": "roll_candidate",
                    "position_id": pos.position_id,
                    "dte": dte,
                    "new_expiry": _safe_str(new_exp),
                })

        return {
            "status": "ok",
            "timestamp": now.isoformat(),
            "sieve": sieve_decisions,
            "actions": actions,
        }

    async def run_forever(self, provider: Callable[[], Tuple[List[RollPosition], Dict[str, Any]]], interval_s: float = 60.0) -> None:
        self._running = True
        try:
            while self._running:
                try:
                    positions, liq = provider()
                    self.run_cycle(positions, liquidity=liq)
                except Exception as exc:
                    log.error("roll engine loop error: %s", exc)
                await asyncio.sleep(interval_s)
        finally:
            self._running = False

    def stop(self) -> None:
        self._running = False


# ---------------------------------------------------------------------------
# Module-level aliases
# ---------------------------------------------------------------------------
ExpiryRollEngine = ExpiryCalendarRollEngine
expiry_roll_engine = ExpiryCalendarRollEngine()

# convenience
def detect_liquidity_cliff(*args: Any, **kwargs: Any) -> Tuple[bool, Dict[str, Any]]:
    # allow passing snapshot as first positional
    if args and isinstance(args[0], LiquiditySnapshot):
        return liquidity_cliff_detected(*args, **kwargs)
    return False, {}


__all__ = [
    "ExpiryCalendarRollEngine",
    "ExpiryRollEngine",
    "expiry_roll_engine",
    "RollConfig",
    "RollPosition",
    "PositionLeg",
    "LiquiditySnapshot",
    "RollPlan",
    "RollPhase",
    "RollAction",
    "ExecutionMode",
    "InstrumentKind",
    "Exchange",
    "physical_delivery_margin_tier",
    "margin_surge_active",
    "sieve_stock_fo_positions",
    "liquidity_cliff_detected",
    "delta_pnl_roll",
    "compute_roll_pnl",
    "balance_roll_strikes",
    "choose_execution_mode",
    "LiquidationGuard",
    "can_transition",
    "next_expiry",
    "next_index_expiry",
    "next_stock_monthly_expiry",
    "days_to_expiry",
    "is_expiry_day",
    "instrument_kind_for",
]
