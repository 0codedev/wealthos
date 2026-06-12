"""python-bridge/services/box_spread_arbitrage_engine.py — Put-Call Parity & Box Spread Funding Engine.

Production-grade engine for Indian F&O synthetic arbitrage:

  * Put-Call Parity (European, cash-settled index options) violation scanner.
  * 4-legged Box Spread structures (Long Call K1 / Short Call K2 / Long Put K2 /
    Short Put K1) used to borrow/lend capital at a synthetic implied rate.
  * Post-2024 SEBI statutory friction model (STT on option sale, exercise STT,
    GST, stamp duty, NSE transaction charges, SEBI fees, brokerage) to derive the
    minimum mispricing threshold Δ_min required for positive net yield.
  * Execution & liquidity risk sentry: all 4 legs must fill atomically within
    250 ms or be immediately squared off; European cash-settlement invariants
    (NSE index options CE/PE are European, eliminating early-exercise risk).

Stdlib-first, import-safe, gracefully degrades when optional upstreams
(statutory_friction_engine, requests) are unavailable.
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
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

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

log = get_logger("box_spread_arbitrage_engine", tag="BOXARB")

# ---------------------------------------------------------------------------
# Optional upstreams (graceful degradation)
# ---------------------------------------------------------------------------
try:
    from services.statutory_friction_engine import (
        StatutoryFrictionEngine as _StatutoryFrictionEngine,
        get_engine as _get_friction_engine,
        Segment as _Segment,
        Action as _Action,
    )
except Exception:
    try:
        from statutory_friction_engine import (  # type: ignore
            StatutoryFrictionEngine as _StatutoryFrictionEngine,
            get_engine as _get_friction_engine,
            Segment as _Segment,
            Action as _Action,
        )
    except Exception:
        _StatutoryFrictionEngine = None
        _get_friction_engine = None
        _Segment = None
        _Action = None

try:
    import requests as _requests
except Exception:  # pragma: no cover
    _requests = None

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
STRATEGY_TAG = "BOX_SPREAD_ARBITRAGE"
RATE_CARD_VERSION = "IN-NSE-2024-10-01.v1"
DAYS_PER_YEAR = 365.0
DEFAULT_RISK_FREE_RATE = 0.07  # 7% RBI benchmark (post-2024)
DEFAULT_IV = 0.15
ATOMIC_FILL_TIMEOUT_MS = 250
EUROPEAN_INDEX_UNDERLYINGS = {
    "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX",
}


class OptionStyle(str, Enum):
    EUROPEAN = "EUROPEAN"
    AMERICAN = "AMERICAN"


class BoxSide(str, Enum):
    BUY = "BUY"   # buy box  -> lend capital (pay now, receive width later)
    SELL = "SELL"  # sell box -> borrow capital (receive now, pay width later)


class ExecutionStatus(str, Enum):
    SUCCESS = "SUCCESS"
    ABORTED = "ABORTED"
    BLOCKED = "BLOCKED"
    PARTIAL = "PARTIAL"


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
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return d


def _safe_str(v: Any, d: str = "") -> str:
    if v is None:
        return d
    return str(v)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _disc(r: float, T: float) -> float:
    if T <= 0:
        return 1.0
    return math.exp(-r * T)


def _mid(q: Any) -> float:
    if isinstance(q, dict):
        bid = _safe_float(q.get("bid"))
        ask = _safe_float(q.get("ask"))
        last = _safe_float(q.get("last") or q.get("ltp"))
        if bid > 0 and ask > 0:
            return (bid + ask) / 2.0
        if last > 0:
            return last
        return 0.0
    return _safe_float(q)


def _bid(q: Any) -> float:
    if isinstance(q, dict):
        return _safe_float(q.get("bid"))
    return _safe_float(q)


def _ask(q: Any) -> float:
    if isinstance(q, dict):
        return _safe_float(q.get("ask"))
    return _safe_float(q)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass
class OptionQuote:
    strike: float
    option_type: str  # CE / PE
    bid: float = 0.0
    ask: float = 0.0
    last: float = 0.0
    volume: int = 0
    oi: int = 0
    iv: float = 0.0
    style: str = OptionStyle.EUROPEAN.value

    def mid(self) -> float:
        if self.bid > 0 and self.ask > 0:
            return (self.bid + self.ask) / 2.0
        if self.last > 0:
            return self.last
        return 0.0


@dataclass
class BoxSpreadLeg:
    side: str          # BUY / SELL
    option_type: str    # CE / PE
    strike: float
    premium: float
    quantity: int = 1
    trading_symbol: str = ""
    style: str = OptionStyle.EUROPEAN.value


@dataclass
class BoxSpread:
    underlying: str
    expiry: str
    k1: float
    k2: float
    call_k1: float
    call_k2: float
    put_k1: float
    put_k2: float
    quantity: int = 1
    lot_size: int = 1
    style: str = OptionStyle.EUROPEAN.value
    spot: float = 0.0
    forward: float = 0.0
    risk_free_rate: float = DEFAULT_RISK_FREE_RATE
    time_to_expiry_years: float = 0.0

    def width(self) -> float:
        return float(self.k2 - self.k1)

    def market_price_mid(self) -> float:
        # Long Call K1 - Short Call K2 + Long Put K2 - Short Put K1
        return self.call_k1 - self.call_k2 + self.put_k2 - self.put_k1

    def market_price_exec(self, ask_call_k1, bid_call_k2, ask_put_k2, bid_put_k1) -> float:
        return ask_call_k1 - bid_call_k2 + ask_put_k2 - bid_put_k1


@dataclass
class ParityViolation:
    strike: float
    call_price: float
    put_price: float
    spot: float
    forward: float
    strike_pv: float
    residual: float          # (call - put) - (forward - strike*disc)
    abs_residual: float
    task_raw_spread: float   # put - (forward - strike*disc)  [as written in prompt]
    timestamp: str = ""


@dataclass
class FrictionBreakdown:
    entry_charges: float = 0.0
    exercise_stt: float = 0.0
    total_friction: float = 0.0
    per_unit_friction: float = 0.0
    components: Dict[str, float] = field(default_factory=dict)
    rate_card_version: str = RATE_CARD_VERSION

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entryCharges": round(self.entry_charges, 4),
            "exerciseStt": round(self.exercise_stt, 4),
            "totalFriction": round(self.total_friction, 4),
            "perUnitFriction": round(self.per_unit_friction, 4),
            "components": {k: round(v, 4) for k, v in self.components.items()},
            "rateCardVersion": self.rate_card_version,
        }


@dataclass
class BoxCandidate:
    underlying: str
    expiry: str
    k1: float
    k2: float
    width: float
    market_price_mid: float
    market_price_exec: float
    pv: float
    mispricing_mid: float
    mispricing_exec: float
    implied_rate: float
    gross_annualized_yield: float
    net_annualized_yield: float
    friction: FrictionBreakdown
    annualized_net_profit: float
    direction: str  # BUY_BOX / SELL_BOX
    liquidity_ok: bool = True
    timestamp: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "underlying": self.underlying,
            "expiry": self.expiry,
            "k1": self.k1,
            "k2": self.k2,
            "width": round(self.width, 4),
            "marketPriceMid": round(self.market_price_mid, 4),
            "marketPriceExec": round(self.market_price_exec, 4),
            "pv": round(self.pv, 4),
            "mispricingMid": round(self.mispricing_mid, 4),
            "mispricingExec": round(self.mispricing_exec, 4),
            "impliedRate": round(self.implied_rate, 6),
            "grossAnnualizedYield": round(self.gross_annualized_yield, 6),
            "netAnnualizedYield": round(self.net_annualized_yield, 6),
            "friction": self.friction.to_dict(),
            "annualizedNetProfit": round(self.annualized_net_profit, 4),
            "direction": self.direction,
            "liquidityOk": self.liquidity_ok,
            "timestamp": self.timestamp,
        }


@dataclass
class ExecutionReport:
    box_id: str
    status: ExecutionStatus
    legs_total: int = 4
    legs_filled: int = 0
    fill_window_ms: float = 0.0
    fills: List[Dict[str, Any]] = field(default_factory=list)
    square_off_orders: List[Dict[str, Any]] = field(default_factory=list)
    reason: str = ""
    timestamp: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "boxId": self.box_id,
            "status": self.status.value,
            "legsTotal": self.legs_total,
            "legsFilled": self.legs_filled,
            "fillWindowMs": round(self.fill_window_ms, 3),
            "fills": self.fills,
            "squareOffOrders": self.square_off_orders,
            "reason": self.reason,
            "timestamp": self.timestamp,
        }


# ---------------------------------------------------------------------------
# Put-Call Parity
# ---------------------------------------------------------------------------
def put_call_parity_residual(
    call: float,
    put: float,
    spot: float,
    strike: float,
    r: float = DEFAULT_RISK_FREE_RATE,
    T: float = 0.0,
    q: float = 0.0,
    forward: Optional[float] = None,
) -> float:
    """Standard European put-call parity residual:
        residual = (call - put) - (F*e? ) ...

    Generalized: C - P = S*e^{-qT} - K*e^{-rT}  (with dividends q).
    If a forward F is supplied, F*e^{-rT} replaces S*e^{-qT}.
    residual = (C - P) - (S*e^{-qT} - K*e^{-rT}).
    """
    call = _safe_float(call)
    put = _safe_float(put)
    spot = _safe_float(spot)
    strike = _safe_float(strike)
    T = max(_safe_float(T), 0.0)
    disc = _disc(r, T)
    if forward is None:
        lhs_spot = spot * math.exp(-q * T)
    else:
        lhs_spot = _safe_float(forward) * disc
    synthetic_forward = lhs_spot - strike * disc
    return (call - put) - synthetic_forward


def parity_violation(call, put, spot, strike, r=DEFAULT_RISK_FREE_RATE, T=0.0, q=0.0, forward=None):
    return put_call_parity_residual(call, put, spot, strike, r, T, q, forward)


def task_raw_put_forward_spread(put, forward, strike, r=DEFAULT_RISK_FREE_RATE, T=0.0):
    """Literal expression from the prompt: P - (F - K e^{-rT}). Provided for
    reference / audit; NOT the standard parity residual (see put_call_parity_residual)."""
    put = _safe_float(put)
    forward = _safe_float(forward)
    strike = _safe_float(strike)
    T = max(_safe_float(T), 0.0)
    return put - (forward - strike * _disc(r, T))


def scan_parity_violations(
    chain: Dict[Any, Any],
    spot: float,
    r: float = DEFAULT_RISK_FREE_RATE,
    T: float = 0.0,
    q: float = 0.0,
    forward: Optional[float] = None,
    threshold: float = 0.0,
) -> List[ParityViolation]:
    """Scan an option chain for put-call parity violations.

    chain: {strike: {"CE": quote, "PE": quote}} where quote may be dict or number.
    """
    out: List[ParityViolation] = []
    spot = _safe_float(spot)
    T = max(_safe_float(T), 0.0)
    fwd = spot * math.exp((r - q) * T) if forward is None else _safe_float(forward)
    for strike_raw, node in (chain or {}).items():
        strike = _safe_float(strike_raw)
        if not isinstance(node, dict):
            continue
        ce = node.get("CE") or node.get("call") or node.get("C")
        pe = node.get("PE") or node.get("put") or node.get("P")
        cpx = _mid(ce) if ce is not None else 0.0
        ppx = _mid(pe) if pe is not None else 0.0
        if cpx <= 0 and ppx <= 0:
            continue
        res = put_call_parity_residual(cpx, ppx, spot, strike, r, T, q, forward)
        pv = ParityViolation(
            strike=strike,
            call_price=cpx,
            put_price=ppx,
            spot=spot,
            forward=fwd,
            strike_pv=strike * _disc(r, T),
            residual=res,
            abs_residual=abs(res),
            task_raw_spread=task_raw_put_forward_spread(ppx, fwd, strike, r, T),
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
        if abs(res) >= threshold:
            out.append(pv)
    out.sort(key=lambda x: x.abs_residual, reverse=True)
    return out


# ---------------------------------------------------------------------------
# Box spread math
# ---------------------------------------------------------------------------
def box_width(k1: float, k2: float) -> float:
    k1 = _safe_float(k1)
    k2 = _safe_float(k2)
    if k2 < k1:
        k1, k2 = k2, k1
    return k2 - k1


def box_market_price_mid(call_k1, call_k2, put_k1, put_k2) -> float:
    """Cost of BUYING the box (long call K1, short call K2, long put K2, short put K1)."""
    return _safe_float(call_k1) - _safe_float(call_k2) + _safe_float(put_k2) - _safe_float(put_k1)


def box_pv(width: float, r: float = DEFAULT_RISK_FREE_RATE, T: float = 0.0) -> float:
    w = _safe_float(width)
    T = max(_safe_float(T), 0.0)
    return w * _disc(r, T)


def box_mispricing(market_price: float, width: float, r=DEFAULT_RISK_FREE_RATE, T=0.0) -> float:
    """PV - market_price. Positive => buy-box arbitrage (lend)."""
    return box_pv(width, r, T) - _safe_float(market_price)


def implied_box_rate(market_price: float, width: float, T: float = 0.0) -> float:
    """Synthetic annualized implied rate of a box: -ln(price/width)/T."""
    mp = _safe_float(market_price)
    w = _safe_float(width)
    T = max(_safe_float(T), 1e-9)
    if mp <= 0 or w <= 0:
        return 0.0
    try:
        return -math.log(mp / w) / T
    except (ValueError, ZeroDivisionError):
        return 0.0


def annualized_box_yield(market_price: float, width: float, T: float = 0.0) -> float:
    """Gross annualized yield for the buyer of the box: (width/price)^(1/T) - 1."""
    mp = _safe_float(market_price)
    w = _safe_float(width)
    T = max(_safe_float(T), 1e-9)
    if mp <= 0 or w <= 0:
        return 0.0
    try:
        return (w / mp) ** (1.0 / T) - 1.0
    except (ValueError, ZeroDivisionError, OverflowError):
        return 0.0


# ---------------------------------------------------------------------------
# Friction model
# ---------------------------------------------------------------------------
def _friction_engine() -> Any:
    if _get_friction_engine is not None:
        try:
            return _get_friction_engine()
        except Exception:
            pass
    if _StatutoryFrictionEngine is not None:
        try:
            return _StatutoryFrictionEngine()
        except Exception:
            pass
    return None


def friction_cost_box(
    call_k1: float,
    call_k2: float,
    put_k1: float,
    put_k2: float,
    quantity: int = 1,
    broker: str = "DHAN",
    T: float = 0.0,
    r: float = DEFAULT_RISK_FREE_RATE,
    width: Optional[float] = None,
    itm_legs_exercised: int = 2,
    exercise_intrinsic_per_unit: Optional[float] = None,
    hold_to_expiry: bool = True,
) -> FrictionBreakdown:
    """Post-2024 SEBI friction for a box spread.

    Entry (4 legs):
      * sell legs (short call K2, short put K1): STT 0.1% on premium + charges
      * buy legs (long call K1, long put K2): no STT on premium, stamp duty on buy
      * transaction charges, SEBI fees, brokerage, GST on all.
    Expiry (if hold_to_expiry):
      * exercise STT 0.125% on intrinsic value of long ITM legs.
    """
    fe = _friction_engine()
    qty = max(_safe_int(quantity, 1), 1)
    c1 = _safe_float(call_k1); c2 = _safe_float(call_k2)
    p1 = _safe_float(put_k1); p2 = _safe_float(put_k2)
    w = _safe_float(width) if width is not None else 0.0
    if w <= 0:
        # infer from strikes? not available; default 0 -> no exercise stt intrinsic
        w = 0.0

    components: Dict[str, float] = {}
    entry_total = 0.0

    legs = [
        # (segment, action, price, qty)
        ("OPTIONS", "BUY", c1, qty),   # long call K1
        ("OPTIONS", "SELL", c2, qty),  # short call K2
        ("OPTIONS", "BUY", p2, qty),   # long put K2
        ("OPTIONS", "SELL", p1, qty),  # short put K1
    ]
    if fe is not None and hasattr(fe, "calculate_charges"):
        for seg, action, price, q in legs:
            try:
                bd = fe.calculate_charges(seg, action, price, q, broker)
                ch = _safe_float(getattr(bd, "total_statutory_charges", None))
                if ch == 0.0:
                    ch = _safe_float(getattr(bd, "total", 0.0))
                entry_total += ch
                # component breakdown
                components[f"stt_{action.lower()}_{seg.lower()}"] = components.get(
                    f"stt_{action.lower()}_{seg.lower()}", 0.0) + _safe_float(getattr(bd, "stt", 0.0))
                components["brokerage"] = components.get("brokerage", 0.0) + _safe_float(getattr(bd, "brokerage", 0.0))
                components["exchange_txn"] = components.get("exchange_txn", 0.0) + _safe_float(getattr(bd, "exchange_txn_charge", 0.0))
                components["sebi"] = components.get("sebi", 0.0) + _safe_float(getattr(bd, "sebi_turnover_charge", 0.0))
                components["stamp_duty"] = components.get("stamp_duty", 0.0) + _safe_float(getattr(bd, "stamp_duty", 0.0))
                components["gst"] = components.get("gst", 0.0) + _safe_float(getattr(bd, "gst", 0.0))
            except Exception:
                # fallback manual
                entry_total += _manual_option_charge(seg, action, price, q, broker)
        if entry_total == 0.0:
            for seg, action, price, q in legs:
                entry_total += _manual_option_charge(seg, action, price, q, broker)
    else:
        for seg, action, price, q in legs:
            entry_total += _manual_option_charge(seg, action, price, q, broker)

    # Exercise STT at expiry
    exercise_total = 0.0
    if hold_to_expiry:
        intrinsic = exercise_intrinsic_per_unit
        if intrinsic is None:
            intrinsic = w if w > 0 else 0.0
        intrinsic = _safe_float(intrinsic)
        if fe is not None and hasattr(fe, "exercise_stt"):
            try:
                # exercise_stt(intrinsic_value, quantity) per leg
                per_leg_qty = qty
                for _ in range(max(itm_legs_exercised, 0)):
                    exercise_total += _safe_float(fe.exercise_stt(intrinsic, per_leg_qty))
            except Exception:
                rate = 0.00125
                exercise_total = max(itm_legs_exercised, 0) * intrinsic * qty * rate
        else:
            rate = 0.00125
            exercise_total = max(itm_legs_exercised, 0) * intrinsic * qty * rate
        components["exercise_stt"] = exercise_total

    total = entry_total + exercise_total
    per_unit = total / qty if qty > 0 else total
    fb = FrictionBreakdown(
        entry_charges=entry_total,
        exercise_stt=exercise_total,
        total_friction=total,
        per_unit_friction=per_unit,
        components=components,
    )
    return fb


def _manual_option_charge(segment, action, price, qty, broker):
    # Fallback manual: STT on sell 0.1% premium, exchange 0.03503%, sebi 0.0001%, stamp buy 0.003%, brokerage min(20,0.03%), gst 18%
    turnover = _safe_float(price) * _safe_float(qty)
    stt = turnover * 0.001 if str(action).upper() == "SELL" else 0.0
    exch = turnover * 0.0003503
    sebi = turnover * 0.000001
    stamp = turnover * 0.00003 if str(action).upper() == "BUY" else 0.0
    brokerage = min(20.0, turnover * 0.0003)
    gst = (brokerage + exch + sebi) * 0.18
    return stt + exch + sebi + stamp + brokerage + gst


def min_mispricing_threshold(
    call_k1, call_k2, put_k1, put_k2, quantity=1, broker="DHAN",
    width=None, itm_legs_exercised=2, exercise_intrinsic_per_unit=None,
    safety_buffer: float = 0.0,
) -> float:
    """Minimum mispricing (PV - market) per unit required for positive net yield."""
    fb = friction_cost_box(
        call_k1, call_k2, put_k1, put_k2, quantity=quantity, broker=broker,
        width=width, itm_legs_exercised=itm_legs_exercised,
        exercise_intrinsic_per_unit=exercise_intrinsic_per_unit,
    )
    qty = max(_safe_int(quantity, 1), 1)
    return (fb.total_friction / qty) + _safe_float(safety_buffer)


# ---------------------------------------------------------------------------
# Invariants / validation
# ---------------------------------------------------------------------------
EUROPEAN_INDEX_SET = EUROPEAN_INDEX_UNDERLYINGS


def validate_box_invariants(box: Union[BoxSpread, Dict[str, Any]]) -> None:
    """European cash-settlement invariants for Indian index box spreads."""
    if isinstance(box, dict):
        underlying = _safe_str(box.get("underlying")).upper()
        style = _safe_str(box.get("style", OptionStyle.EUROPEAN.value)).upper()
        k1 = _safe_float(box.get("k1"))
        k2 = _safe_float(box.get("k2"))
        expiry = _safe_str(box.get("expiry"))
        qty = _safe_int(box.get("quantity", 1))
    else:
        underlying = _safe_str(box.underlying).upper()
        style = _safe_str(box.style).upper()
        k1 = _safe_float(box.k1)
        k2 = _safe_float(box.k2)
        expiry = _safe_str(box.expiry)
        qty = _safe_int(box.quantity)
    if underlying not in EUROPEAN_INDEX_UNDERLYINGS:
        raise ValueError(f"underlying {underlying} not an approved European index")
    if style != OptionStyle.EUROPEAN.value:
        raise ValueError("box must be EUROPEAN style (NSE index options)")
    if not (k1 > 0 and k2 > 0 and k1 < k2):
        raise ValueError("requires 0 < k1 < k2")
    if not expiry:
        raise ValueError("expiry required")
    if qty <= 0:
        raise ValueError("quantity must be positive")
    # early assignment risk: European -> none
    return None


def has_early_assignment_risk(underlying: str, style: str = OptionStyle.EUROPEAN.value) -> bool:
    return _safe_str(style).upper() != OptionStyle.EUROPEAN.value


# ---------------------------------------------------------------------------
# Scanner
# ---------------------------------------------------------------------------
def scan_box_spreads(
    chain: Dict[Any, Any],
    underlying: str = "NIFTY",
    expiry: str = "",
    spot: float = 0.0,
    forward: Optional[float] = None,
    r: float = DEFAULT_RISK_FREE_RATE,
    T: float = 0.0,
    quantity: int = 1,
    lot_size: int = 1,
    broker: str = "DHAN",
    min_volume: int = 0,
    threshold: Optional[float] = None,
    max_pairs: Optional[int] = None,
) -> List[BoxCandidate]:
    """Real-time box spread mispricing scanner over an option chain.

    chain: {strike: {"CE": quote, "PE": quote}}.
    Uses executable prices (buy at ask, sell at bid) for the cost, and mid for
    theoretical. Filters by liquidity (volume) and mispricing threshold.
    """
    underlying = _safe_str(underlying).upper()
    spot = _safe_float(spot)
    T = max(_safe_float(T), 1e-9)
    fwd = spot * math.exp((r) * T) if forward is None else _safe_float(forward)
    # risk-free forward approx; dividends ignored
    q = 0.0
    fwd = spot * math.exp((r - q) * T) if forward is None else _safe_float(forward)

    strikes = sorted(_safe_float(s) for s in (chain or {}).keys())
    # filter strikes with both CE/PE quotes
    valid = {}
    for s in strikes:
        node = (chain or {}).get(s) or (chain or {}).get(str(int(s) if s == int(s) else s))
        if not isinstance(node, dict):
            continue
        ce = node.get("CE") or node.get("call") or node.get("C")
        pe = node.get("PE") or node.get("put") or node.get("P")
        if ce is None or pe is None:
            continue
        valid[s] = (ce, pe)

    candidates: List[BoxCandidate] = []
    pairs = 0
    for i, k1 in enumerate(strikes):
        if k1 not in valid:
            continue
        for k2 in strikes[i + 1:]:
            if k2 not in valid:
                continue
            ce1, pe1 = valid[k1]
            ce2, pe2 = valid[k2]
            # liquidity filter
            v1c = _safe_int(ce1.get("volume") if isinstance(ce1, dict) else 0)
            v2c = _safe_int(ce2.get("volume") if isinstance(ce2, dict) else 0)
            v1p = _safe_int(pe1.get("volume") if isinstance(pe1, dict) else 0)
            v2p = _safe_int(pe2.get("volume") if isinstance(pe2, dict) else 0)
            if min(v1c, v2c, v1p, v2p) < min_volume:
                continue

            c1_mid = _mid(ce1); c2_mid = _mid(ce2)
            p1_mid = _mid(pe1); p2_mid = _mid(pe2)
            # executable
            c1_ask = _ask(ce1) if _ask(ce1) > 0 else c1_mid
            c2_bid = _bid(ce2) if _bid(ce2) > 0 else c2_mid
            p2_ask = _ask(pe2) if _ask(pe2) > 0 else p2_mid
            p1_bid = _bid(pe1) if _bid(pe1) > 0 else p1_mid

            mp_mid = box_market_price_mid(c1_mid, c2_mid, p1_mid, p2_mid)
            mp_exec = c1_ask - c2_bid + p2_ask - p1_bid
            w = k2 - k1
            pv = box_pv(w, r, T)
            mis_mid = pv - mp_mid
            mis_exec = pv - mp_exec

            # friction
            fb = friction_cost_box(
                c1_mid, c2_mid, p1_mid, p2_mid, quantity=quantity, broker=broker,
                width=w, itm_legs_exercised=2,
            )
            thr = threshold if threshold is not None else (fb.total_friction / max(quantity, 1))
            if mis_exec < thr:
                # also consider sell box if mispricing very negative
                if mis_exec > -thr:
                    continue
                direction = BoxSide.SELL.value
            else:
                direction = BoxSide.BUY.value

            # annualized yields
            if direction == BoxSide.BUY.value:
                gyield = annualized_box_yield(mp_exec if mp_exec > 0 else mp_mid, w, T)
                # net: invest mp_exec + entry friction, receive w - exercise stt
                invest = (mp_exec if mp_exec > 0 else mp_mid) + (fb.entry_charges / max(quantity, 1))
                receive = w - (fb.exercise_stt / max(quantity, 1))
                if invest > 0 and receive > 0:
                    net_yield = (receive / invest) ** (1.0 / T) - 1.0
                else:
                    net_yield = 0.0
            else:
                # sell box: receive mp, pay w later; cost of funds
                gyield = annualized_box_yield(mp_exec if mp_exec > 0 else mp_mid, w, T)
                net_yield = gyield
            implied_rate = implied_box_rate(mp_exec if mp_exec > 0 else mp_mid, w, T)

            cand = BoxCandidate(
                underlying=underlying,
                expiry=expiry,
                k1=k1,
                k2=k2,
                width=w,
                market_price_mid=mp_mid,
                market_price_exec=mp_exec,
                pv=pv,
                mispricing_mid=mis_mid,
                mispricing_exec=mis_exec,
                implied_rate=implied_rate,
                gross_annualized_yield=gyield,
                net_annualized_yield=net_yield,
                friction=fb,
                annualized_net_profit=(mis_exec - (fb.total_friction / max(quantity, 1))) * quantity * lot_size,
                direction=direction,
                liquidity_ok=True,
                timestamp=datetime.now(timezone.utc).isoformat(),
            )
            candidates.append(cand)
            pairs += 1
            if max_pairs is not None and pairs >= max_pairs:
                break
        if max_pairs is not None and pairs >= max_pairs:
            break

    # sort by net annualized yield desc (abs for sell)
    candidates.sort(key=lambda c: abs(c.net_annualized_yield), reverse=True)
    return candidates


# ---------------------------------------------------------------------------
# Atomic execution sentry
# ---------------------------------------------------------------------------
class OrderPlacer:
    """Minimal interface for order placement. Override in production."""

    def place(self, order: Dict[str, Any]) -> Dict[str, Any]:
        # paper fill: immediate success
        return {
            "status": "success",
            "orderid": "PAPER-" + uuid.uuid4().hex[:8],
            "filled_qty": order.get("quantity", 0),
            "timestamp": time.time(),
        }

    def square_off(self, order: Dict[str, Any]) -> Dict[str, Any]:
        return {"status": "success", "orderid": "SQOFF-" + uuid.uuid4().hex[:8], "timestamp": time.time()}


class AtomicBoxExecutor:
    def __init__(self, placer: Optional[OrderPlacer] = None, timeout_ms: int = ATOMIC_FILL_TIMEOUT_MS):
        self.placer = placer or OrderPlacer()
        self.timeout_ms = int(timeout_ms)

    def _leg_orders(self, box: BoxSpread, direction: str) -> List[Dict[str, Any]]:
        # returns 4 orders in execution order
        k1, k2 = box.k1, box.k2
        qty = box.quantity
        orders = []
        if direction == BoxSide.BUY.value:
            # buy call K1, sell call K2, buy put K2, sell put K1
            orders.append({"leg": "LC_K1", "action": "BUY", "option_type": "CE", "strike": k1, "quantity": qty, "premium": box.call_k1})
            orders.append({"leg": "SC_K2", "action": "SELL", "option_type": "CE", "strike": k2, "quantity": qty, "premium": box.call_k2})
            orders.append({"leg": "LP_K2", "action": "BUY", "option_type": "PE", "strike": k2, "quantity": qty, "premium": box.put_k2})
            orders.append({"leg": "SP_K1", "action": "SELL", "option_type": "PE", "strike": k1, "quantity": qty, "premium": box.put_k1})
        else:
            orders.append({"leg": "SC_K1", "action": "SELL", "option_type": "CE", "strike": k1, "quantity": qty, "premium": box.call_k1})
            orders.append({"leg": "LC_K2", "action": "BUY", "option_type": "CE", "strike": k2, "quantity": qty, "premium": box.call_k2})
            orders.append({"leg": "SP_K2", "action": "SELL", "option_type": "PE", "strike": k2, "quantity": qty, "premium": box.put_k2})
            orders.append({"leg": "LP_K1", "action": "BUY", "option_type": "PE", "strike": k1, "quantity": qty, "premium": box.put_k1})
        # attach common
        for o in orders:
            o["underlying"] = box.underlying
            o["expiry"] = box.expiry
            o["exchange"] = "NFO"
            o["product"] = "NRML"
            o["pricetype"] = "LIMIT"
        return orders

    def execute(self, box: BoxSpread, direction: str = BoxSide.BUY.value, live: bool = False) -> ExecutionReport:
        validate_box_invariants(box)
        box_id = f"BOX-{box.underlying}-{int(box.k1)}-{int(box.k2)}-{uuid.uuid4().hex[:6]}"
        orders = self._leg_orders(box, direction)
        start = time.time()
        fills: List[Dict[str, Any]] = []
        all_filled = True
        for o in orders:
            # timeout check
            elapsed_ms = (time.time() - start) * 1000.0
            if elapsed_ms > self.timeout_ms:
                all_filled = False
                break
            try:
                res = self.placer.place(o)
            except Exception as exc:
                res = {"status": "error", "reason": str(exc)}
            fill = {"leg": o["leg"], "order": o, "result": res}
            fills.append(fill)
            if _safe_str(res.get("status")).lower() not in ("success", "filled", "ok"):
                all_filled = False
                break
            # per-leg timeout recheck
            if (time.time() - start) * 1000.0 > self.timeout_ms:
                all_filled = False
                break

        fill_window_ms = (time.time() - start) * 1000.0
        legs_filled = len(fills)

        if all_filled and legs_filled == 4 and fill_window_ms <= self.timeout_ms:
            return ExecutionReport(
                box_id=box_id,
                status=ExecutionStatus.SUCCESS,
                legs_filled=legs_filled,
                fill_window_ms=fill_window_ms,
                fills=fills,
                reason="all 4 legs filled within {}ms".format(self.timeout_ms),
                timestamp=datetime.now(timezone.utc).isoformat(),
            )

        # square off filled legs
        sqoffs = []
        for f in fills:
            o = f["order"]
            reverse = dict(o)
            reverse["action"] = "SELL" if o["action"] == "BUY" else "BUY"
            reverse["leg"] = "SQOFF_" + o["leg"]
            try:
                sq = self.placer.square_off(reverse) if hasattr(self.placer, "square_off") else self.placer.place(reverse)
            except Exception as exc:
                sq = {"status": "error", "reason": str(exc)}
            sqoffs.append({"leg": reverse["leg"], "order": reverse, "result": sq})
        return ExecutionReport(
            box_id=box_id,
            status=ExecutionStatus.ABORTED,
            legs_filled=legs_filled,
            fill_window_ms=fill_window_ms,
            fills=fills,
            square_off_orders=sqoffs,
            reason="atomic fill failed ({} legs, {:.1f}ms) - squared off".format(legs_filled, fill_window_ms),
            timestamp=datetime.now(timezone.utc).isoformat(),
        )


# ---------------------------------------------------------------------------
# Engine class
# ---------------------------------------------------------------------------
class BoxSpreadArbitrageEngine:
    def __init__(
        self,
        risk_free_rate: float = DEFAULT_RISK_FREE_RATE,
        broker: str = "DHAN",
        timeout_ms: int = ATOMIC_FILL_TIMEOUT_MS,
    ) -> None:
        self.risk_free_rate = float(risk_free_rate)
        self.broker = broker
        self.executor = AtomicBoxExecutor(timeout_ms=timeout_ms)
        self.candidates: List[BoxCandidate] = []

    def scan(self, chain, underlying="NIFTY", expiry="", spot=0.0, forward=None,
             T=0.0, quantity=1, lot_size=1, min_volume=0, threshold=None) -> List[BoxCandidate]:
        cands = scan_box_spreads(
            chain, underlying=underlying, expiry=expiry, spot=spot, forward=forward,
            r=self.risk_free_rate, T=T, quantity=quantity, lot_size=lot_size,
            broker=self.broker, min_volume=min_volume, threshold=threshold,
        )
        self.candidates = cands
        return cands

    def parity_scan(self, chain, spot, T=0.0, threshold=0.0):
        return scan_parity_violations(chain, spot, r=self.risk_free_rate, T=T, threshold=threshold)

    def friction(self, *args, **kwargs):
        return friction_cost_box(*args, broker=self.broker, **kwargs)

    def threshold(self, *args, **kwargs):
        return min_mispricing_threshold(*args, broker=self.broker, **kwargs)

    def execute(self, box, direction=BoxSide.BUY.value, live=False):
        return self.executor.execute(box, direction=direction, live=live)


# Aliases
BoxSpreadEngine = BoxSpreadArbitrageEngine
box_spread_engine = BoxSpreadArbitrageEngine()


# ---------------------------------------------------------------------------
# Additional aliases (compatibility / discoverability)
# ---------------------------------------------------------------------------
SyntheticArbitrageEngine = BoxSpreadArbitrageEngine
PutCallParityEngine = BoxSpreadArbitrageEngine
BoxSpreadFundingEngine = BoxSpreadArbitrageEngine
synthetic_arbitrage_engine = box_spread_engine
put_call_parity_engine = box_spread_engine
box_spread_funding_engine = box_spread_engine

scan_mispricing = scan_box_spreads
calculate_friction = friction_cost_box
calculate_box_friction = friction_cost_box
minimum_mispricing = min_mispricing_threshold
compute_parity_violation = put_call_parity_residual
box_arbitrage_threshold = min_mispricing_threshold


# ---------------------------------------------------------------------------
# FIXTURES (unit test fixtures embedded)
# ---------------------------------------------------------------------------
FIXTURE_CHAIN_NIFTY = {
    22000: {"CE": {"bid": 410.0, "ask": 412.0, "last": 411.0, "volume": 5000, "oi": 12000},
            "PE": {"bid": 120.0, "ask": 122.0, "last": 121.0, "volume": 4800, "oi": 11000}},
    22100: {"CE": {"bid": 330.0, "ask": 332.0, "last": 331.0, "volume": 4500, "oi": 10000},
            "PE": {"bid": 150.0, "ask": 152.0, "last": 151.0, "volume": 4600, "oi": 10500}},
    22200: {"CE": {"bid": 260.0, "ask": 262.0, "last": 261.0, "volume": 4200, "oi": 9000},
            "PE": {"bid": 185.0, "ask": 187.0, "last": 186.0, "volume": 4300, "oi": 9500}},
    22300: {"CE": {"bid": 195.0, "ask": 197.0, "last": 196.0, "volume": 4000, "oi": 8500},
            "PE": {"bid": 225.0, "ask": 227.0, "last": 226.0, "volume": 4100, "oi": 8800}},
    22400: {"CE": {"bid": 140.0, "ask": 142.0, "last": 141.0, "volume": 3800, "oi": 8000},
            "PE": {"bid": 270.0, "ask": 272.0, "last": 271.0, "volume": 3900, "oi": 8200}},
    22500: {"CE": {"bid": 100.0, "ask": 102.0, "last": 101.0, "volume": 3500, "oi": 7500},
            "PE": {"bid": 320.0, "ask": 322.0, "last": 321.0, "volume": 3600, "oi": 7700}},
}


def _demo() -> None:
    spot = 22250.0
    T = 7.0 / 365.0
    cands = scan_box_spreads(FIXTURE_CHAIN_NIFTY, underlying="NIFTY", expiry="2026-10-22",
                             spot=spot, r=DEFAULT_RISK_FREE_RATE, T=T, quantity=50, lot_size=50,
                             min_volume=1000)
    print("candidates:", len(cands))
    for c in cands[:5]:
        print(c.to_dict())


if __name__ == "__main__":
    _demo()
