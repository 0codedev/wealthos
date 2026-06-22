"""python-bridge/services/span_portfolio_margin_engine.py — Multi-Exchange SPAN + Portfolio Cross-Margin & Sequencing Engine.

Production-grade engine for Indian multi-exchange derivatives portfolio margining:

  * Real-time SPAN + Exposure margin calculator for complex multi-leg option
    books (Iron Condor, Ratio Spread, Calendar Roll, Box Spread) across NSE
    (NIFTY/BANKNIFTY), BSE (SENSEX) and MCX.
  * Cross-exchange margin offset rules under SEBI portfolio margining.
  * Invariant Execution Sequence Governor:
      - Hedged-Leg-First order sequencing: long OTM hedge wings are routed
        first and their fill is acknowledged (<200 ms) BEFORE any naked short
        leg is routed. Eliminates temporary intraday peak margin spikes that
        trigger broker RMS rejections / penalty interest.
      - Dynamic 20% Cash Margin Headroom Guard: auto-throttles new position
        initiation when free collateral drops below 20%.
  * Order sequencing dispatchers with injectable placers and fill-wait hooks
    (sync + async), plus an in-memory placer for unit tests.

Stdlib-first, import-safe, gracefully degrades when optional upstreams
(collateral_margin_manager) are unavailable.
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

log = get_logger("span_portfolio_margin_engine", tag="SPANPM")

# ---------------------------------------------------------------------------
# Optional upstreams (graceful degradation)
# ---------------------------------------------------------------------------
try:
    from services.collateral_margin_manager import (
        CollateralMarginManager as _CollateralMarginManager,
        collateral_margin_manager as _collateral_margin_manager,
    )
except Exception:
    try:
        from collateral_margin_manager import (  # type: ignore
            CollateralMarginManager as _CollateralMarginManager,
            collateral_margin_manager as _collateral_margin_manager,
        )
    except Exception:
        _CollateralMarginManager = None
        _collateral_margin_manager = None

try:
    import requests as _requests
except Exception:  # pragma: no cover
    _requests = None


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
FILL_ACK_TIMEOUT_MS: int = 200
HEADROOM_THRESHOLD: float = 0.20
SPAN_SCENARIO_COUNT: int = 16

# SEBI portfolio margin: maximum cross-margin benefit cap (fraction).
CROSS_MARGIN_BENEFIT_CAP: float = 0.40

# Exposure margin percentages of notional underlying value.
EXPOSURE_PCT: Dict[str, float] = {
    "NSE": 0.03,
    "BSE": 0.03,
    "MCX": 0.05,
}
# Reduced exposure for structured/hedged spreads.
SPREAD_EXPOSURE_PCT: float = 0.01

# Cross-exchange correlation-based benefit factors (fraction of smaller margin).
CROSS_CORRELATION: Dict[Tuple[str, str], float] = {
    ("NSE_NIFTY", "NSE_BANKNIFTY"): 0.75,
    ("NSE_NIFTY", "BSE_SENSEX"): 0.70,
    ("NSE_BANKNIFTY", "BSE_SENSEX"): 0.65,
    ("NSE_NIFTY", "MCX_ANY"): 0.00,
    ("NSE_BANKNIFTY", "MCX_ANY"): 0.00,
    ("BSE_SENSEX", "MCX_ANY"): 0.00,
}

# SPAN scenario grid: (price_shift_fraction, vol_shift_fraction). 16 scenarios.
SPAN_SCENARIOS: List[Tuple[float, float]] = [
    (-0.03, -0.10), (-0.03, 0.00), (-0.03, 0.10),
    (-0.02, -0.10), (-0.02, 0.00), (-0.02, 0.10),
    (-0.01, -0.10), (-0.01, 0.00), (-0.01, 0.10),
    (0.00, -0.10),  (0.00, 0.00),  (0.00, 0.10),
    (0.01, -0.10),  (0.01, 0.00),  (0.01, 0.10),
    (0.03, 0.10),
]
# pad to 16 if needed
while len(SPAN_SCENARIOS) < SPAN_SCENARIO_COUNT:
    SPAN_SCENARIOS.append((0.0, 0.0))
SPAN_SCENARIOS = SPAN_SCENARIOS[:SPAN_SCENARIO_COUNT]


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class Exchange(str, Enum):
    NSE = "NSE"
    BSE = "BSE"
    MCX = "MCX"


class StrategyType(str, Enum):
    IRON_CONDOR = "iron_condor"
    RATIO_SPREAD = "ratio_spread"
    CALENDAR_ROLL = "calendar_roll"
    BOX_SPREAD = "box_spread"
    CUSTOM = "custom"


class PositionSide(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"


class OptionType(str, Enum):
    CE = "CE"
    PE = "PE"


class LegRole(str, Enum):
    HEDGE = "HEDGE"            # long OTM wing (routed first)
    SHORT_NAKED = "SHORT_NAKED"  # naked short leg (routed after hedge ack)
    BODY = "BODY"              # neutral / spread body


class SequencePhase(str, Enum):
    HEDGE = "HEDGE"
    SHORT = "SHORT"


class SequenceStatus(str, Enum):
    PENDING = "PENDING"
    PLACED = "PLACED"
    ACKED = "ACKED"
    FAILED = "FAILED"
    ABORTED = "ABORTED"
    SKIPPED = "SKIPPED"


class DispatchStatus(str, Enum):
    SUCCESS = "success"
    ABORTED = "aborted"
    THROTTLED = "throttled"
    FAILED = "failed"
    PARTIAL = "partial"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _safe_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value)


def _now_ms() -> float:
    return time.time() * 1000.0


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass
class OptionLeg:
    leg_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    symbol: str = ""
    exchange: str = Exchange.NSE.value
    underlying: str = ""
    option_type: str = OptionType.CE.value
    side: str = PositionSide.LONG.value
    strike: float = 0.0
    expiry: Optional[str] = None
    quantity: int = 1           # signed-ish magnitude; side determines sign
    lot_size: int = 1
    premium: float = 0.0       # current option premium
    underlying_price: float = 0.0
    iv: float = 0.15
    delta: float = 0.0
    gamma: float = 0.0
    theta: float = 0.0
    vega: float = 0.0
    is_hedge: bool = False
    instrument_key: Optional[str] = None
    trading_symbol: Optional[str] = None
    meta: Dict[str, Any] = field(default_factory=dict)

    def is_long(self) -> bool:
        return self.side.upper() == PositionSide.LONG.value

    def is_short(self) -> bool:
        return self.side.upper() == PositionSide.SHORT.value

    def signed_qty(self) -> int:
        q = abs(self.quantity) * (1 if self.is_long() else -1)
        return q

    def contracts(self) -> int:
        return abs(self.quantity) * self.lot_size

    def notional(self) -> float:
        return abs(self.quantity) * self.lot_size * max(self.underlying_price, 0.0)

    def role(self) -> str:
        if self.is_long():
            return LegRole.HEDGE.value
        return LegRole.SHORT_NAKED.value


@dataclass
class StrategyBook:
    book_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    strategy: str = StrategyType.CUSTOM.value
    exchange: str = Exchange.NSE.value
    underlying: str = ""
    expiry: Optional[str] = None
    legs: List[OptionLeg] = field(default_factory=list)
    lots: int = 1
    lot_size: int = 1
    underlying_price: float = 0.0
    meta: Dict[str, Any] = field(default_factory=dict)

    def long_legs(self) -> List[OptionLeg]:
        return [l for l in self.legs if l.is_long()]

    def short_legs(self) -> List[OptionLeg]:
        return [l for l in self.legs if l.is_short()]

    def hedge_legs(self) -> List[OptionLeg]:
        return [l for l in self.legs if l.is_long()]

    def naked_short_legs(self) -> List[OptionLeg]:
        return [l for l in self.legs if l.is_short()]

    def total_notional(self) -> float:
        return sum(l.notional() for l in self.legs)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "book_id": self.book_id,
            "strategy": self.strategy,
            "exchange": self.exchange,
            "underlying": self.underlying,
            "expiry": self.expiry,
            "lots": self.lots,
            "lot_size": self.lot_size,
            "underlying_price": self.underlying_price,
            "legs": [l.__dict__ for l in self.legs],
        }


@dataclass
class ScenarioLoss:
    scenario_id: int
    price_shift: float
    vol_shift: float
    net_pnl: float
    loss: float


@dataclass
class MarginBreakdown:
    book_id: str = ""
    exchange: str = ""
    strategy: str = ""
    underlying: str = ""
    span_margin: float = 0.0
    exposure_margin: float = 0.0
    total_margin: float = 0.0
    worst_scenario_id: int = -1
    worst_scenario_loss: float = 0.0
    scenario_losses: List[ScenarioLoss] = field(default_factory=list)
    per_leg_exposure: List[Dict[str, Any]] = field(default_factory=list)
    hedge_benefit: float = 0.0
    cross_margin_benefit: float = 0.0
    net_after_cross: float = 0.0
    notes: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "book_id": self.book_id,
            "exchange": self.exchange,
            "strategy": self.strategy,
            "underlying": self.underlying,
            "span_margin": round(self.span_margin, 2),
            "exposure_margin": round(self.exposure_margin, 2),
            "total_margin": round(self.total_margin, 2),
            "worst_scenario_id": self.worst_scenario_id,
            "worst_scenario_loss": round(self.worst_scenario_loss, 2),
            "scenario_losses": [
                {"scenario_id": s.scenario_id, "price_shift": s.price_shift,
                 "vol_shift": s.vol_shift, "net_pnl": round(s.net_pnl, 2),
                 "loss": round(s.loss, 2)} for s in self.scenario_losses
            ],
            "per_leg_exposure": self.per_leg_exposure,
            "hedge_benefit": round(self.hedge_benefit, 2),
            "cross_margin_benefit": round(self.cross_margin_benefit, 2),
            "net_after_cross": round(self.net_after_cross, 2),
            "notes": self.notes,
        }


@dataclass
class CrossMarginResult:
    per_exchange: Dict[str, float] = field(default_factory=dict)
    gross_total: float = 0.0
    benefit: float = 0.0
    net_total: float = 0.0
    pairs: List[Dict[str, Any]] = field(default_factory=list)
    cap_applied: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "per_exchange": {k: round(v, 2) for k, v in self.per_exchange.items()},
            "gross_total": round(self.gross_total, 2),
            "benefit": round(self.benefit, 2),
            "net_total": round(self.net_total, 2),
            "pairs": self.pairs,
            "cap_applied": self.cap_applied,
        }


@dataclass
class FillAck:
    order_id: str = ""
    leg_id: str = ""
    status: str = "PENDING"   # ACKED / REJECTED / TIMEOUT
    filled_qty: int = 0
    avg_price: float = 0.0
    latency_ms: float = 0.0
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    raw: Any = None

    def is_acked(self) -> bool:
        return self.status.upper() in ("ACKED", "FILLED", "SUCCESS", "COMPLETE")


@dataclass
class HeadroomStatus:
    free_collateral: float = 0.0
    total_collateral: float = 0.0
    free_pct: float = 1.0
    threshold: float = HEADROOM_THRESHOLD
    throttle: bool = False
    reason: str = "ok"
    actions: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "free_collateral": round(self.free_collateral, 2),
            "total_collateral": round(self.total_collateral, 2),
            "free_pct": round(self.free_pct, 6),
            "threshold": self.threshold,
            "throttle": self.throttle,
            "reason": self.reason,
            "actions": self.actions,
        }


@dataclass
class SequenceStep:
    step_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    phase: str = SequencePhase.HEDGE.value
    leg_ids: List[str] = field(default_factory=list)
    timeout_ms: int = FILL_ACK_TIMEOUT_MS
    status: str = SequenceStatus.PENDING.value
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    acks: List[FillAck] = field(default_factory=list)
    error: Optional[str] = None

    def all_acked(self) -> bool:
        return len(self.acks) > 0 and all(a.is_acked() for a in self.acks) and len(self.acks) == len(self.leg_ids)

    def latency_ms(self) -> float:
        if self.started_at is None or self.finished_at is None:
            return 0.0
        return (self.finished_at - self.started_at) * 1000.0


@dataclass
class DispatchResult:
    status: str = DispatchStatus.SUCCESS.value
    book_id: str = ""
    steps: List[SequenceStep] = field(default_factory=list)
    total_latency_ms: float = 0.0
    aborted: bool = False
    abort_reason: Optional[str] = None
    headroom: Optional[HeadroomStatus] = None
    orders: List[Dict[str, Any]] = field(default_factory=list)
    flattened: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "book_id": self.book_id,
            "steps": [
                {
                    "step_id": s.step_id,
                    "phase": s.phase,
                    "leg_ids": s.leg_ids,
                    "status": s.status,
                    "timeout_ms": s.timeout_ms,
                    "latency_ms": round(s.latency_ms(), 2),
                    "acks": [
                        {"order_id": a.order_id, "leg_id": a.leg_id, "status": a.status,
                         "filled_qty": a.filled_qty, "latency_ms": round(a.latency_ms, 2)} for a in s.acks
                    ],
                    "error": s.error,
                } for s in self.steps
            ],
            "total_latency_ms": round(self.total_latency_ms, 2),
            "aborted": self.aborted,
            "abort_reason": self.abort_reason,
            "headroom": self.headroom.to_dict() if self.headroom else None,
            "orders": self.orders,
            "flattened": self.flattened,
        }


# ---------------------------------------------------------------------------
# SPAN margin calculator
# ---------------------------------------------------------------------------
class SPANMarginCalculator:
    """SPAN scan-risk + exposure margin for a single multi-leg book."""

    def __init__(
        self,
        scenarios: Optional[List[Tuple[float, float]]] = None,
        exposure_pct_map: Optional[Dict[str, float]] = None,
        spread_exposure_pct: float = SPREAD_EXPOSURE_PCT,
    ) -> None:
        self.scenarios = list(scenarios) if scenarios is not None else list(SPAN_SCENARIOS)
        self.exposure_pct_map = exposure_pct_map if exposure_pct_map is not None else dict(EXPOSURE_PCT)
        self.spread_exposure_pct = float(spread_exposure_pct)

    # ------------------------------------------------------------------ #
    def leg_scenario_pnl(self, leg: OptionLeg, price_shift: float, vol_shift: float) -> float:
        """Approximate P&L of a leg under a (price, vol) scenario.

        Uses delta/gamma/vega Taylor expansion on the underlying price move.
        Long positions carry positive sensitivity; shorts are inverted.
        """
        S = leg.underlying_price if leg.underlying_price > 0 else max(leg.strike, 1.0)
        dS = S * price_shift
        # Taylor: dV = delta*dS + 0.5*gamma*dS^2 + vega*vol_shift (vega in price per vol point)
        dV = leg.delta * dS + 0.5 * leg.gamma * dS * dS + leg.vega * vol_shift
        signed = leg.signed_qty() * leg.lot_size
        # long: +dV, short: -dV  (signed_qty already encodes side)
        return signed * dV

    def compute(self, book: StrategyBook, cross_benefit: float = 0.0) -> MarginBreakdown:
        breakdown = MarginBreakdown(
            book_id=book.book_id,
            exchange=book.exchange,
            strategy=book.strategy,
            underlying=book.underlying,
        )
        # Scenario scan.
        scenario_net: List[Tuple[int, float, float, float]] = []
        for idx, (ps, vs) in enumerate(self.scenarios):
            net = 0.0
            for leg in book.legs:
                net += self.leg_scenario_pnl(leg, ps, vs)
            scenario_net.append((idx, ps, vs, net))

        # SPAN = worst-case loss = max(0, -min net pnl).
        min_net = min((sn[3] for sn in scenario_net), default=0.0)
        worst_idx = min(scenario_net, key=lambda x: x[3])[0] if scenario_net else -1
        span_loss = max(0.0, -min_net)
        breakdown.span_margin = float(span_loss)
        breakdown.worst_scenario_id = int(worst_idx)
        breakdown.worst_scenario_loss = float(span_loss)
        breakdown.scenario_losses = [
            ScenarioLoss(scenario_id=sn[0], price_shift=sn[1], vol_shift=sn[2],
                        net_pnl=sn[3], loss=max(0.0, -sn[3])) for sn in scenario_net
        ]

        # Exposure margin.
        is_spread = book.strategy in (
            StrategyType.IRON_CONDOR.value, StrategyType.RATIO_SPREAD.value,
            StrategyType.CALENDAR_ROLL.value, StrategyType.BOX_SPREAD.value,
        )
        exp_pct_base = self.exposure_pct_map.get(book.exchange.upper(), 0.03)
        exp_pct = self.spread_exposure_pct if is_spread else exp_pct_base

        per_leg: List[Dict[str, Any]] = []
        exposure_total = 0.0
        hedge_notional = sum(l.notional() for l in book.long_legs())
        short_notional = sum(l.notional() for l in book.short_legs())
        # hedge benefit: long wings offset exposure of shorts.
        hedge_benefit = 0.0
        if short_notional > 0 and hedge_notional > 0:
            ratio = min(1.0, hedge_notional / short_notional)
            hedge_benefit = short_notional * exp_pct_base * ratio * 0.5
        breakdown.hedge_benefit = float(hedge_benefit)

        for leg in book.legs:
            if leg.is_short():
                leg_exp = abs(leg.quantity) * leg.lot_size * max(leg.underlying_price, 0.0) * exp_pct
                # apply hedge discount
                if is_spread and hedge_notional > 0:
                    discount = min(1.0, hedge_notional / max(short_notional, 1.0))
                    leg_exp = leg_exp * (1.0 - 0.5 * discount)
                exposure_total += leg_exp
                per_leg.append({
                    "leg_id": leg.leg_id,
                    "side": leg.side,
                    "role": leg.role(),
                    "notional": round(leg.notional(), 2),
                    "exposure_pct": round(exp_pct, 4),
                    "exposure_margin": round(leg_exp, 2),
                })
            else:
                per_leg.append({
                    "leg_id": leg.leg_id,
                    "side": leg.side,
                    "role": leg.role(),
                    "notional": round(leg.notional(), 2),
                    "exposure_pct": 0.0,
                    "exposure_margin": 0.0,
                })

        breakdown.exposure_margin = float(max(0.0, exposure_total - hedge_benefit * 0.0))  # keep exposure separate
        # Actually hedge benefit already reduces span via scenarios; keep exposure as computed.
        breakdown.per_leg_exposure = per_leg

        breakdown.total_margin = breakdown.span_margin + breakdown.exposure_margin
        breakdown.cross_margin_benefit = float(cross_benefit)
        breakdown.net_after_cross = max(0.0, breakdown.total_margin - cross_benefit)
        breakdown.notes.append(
            "SPAN scan over {} scenarios; exposure @ {:.2%}{}".format(
                len(self.scenarios), exp_pct, " (spread-adjusted)" if is_spread else ""
            )
        )
        return breakdown


# ---------------------------------------------------------------------------
# Cross-exchange margin calculator
# ---------------------------------------------------------------------------
class CrossMarginCalculator:
    """Combines per-exchange margins with SEBI portfolio margin offsets."""

    def __init__(
        self,
        correlation: Optional[Dict[Tuple[str, str], float]] = None,
        benefit_cap: float = CROSS_MARGIN_BENEFIT_CAP,
    ) -> None:
        self.correlation = correlation if correlation is not None else dict(CROSS_CORRELATION)
        self.benefit_cap = float(benefit_cap)

    def _key(self, exchange: str, underlying: str) -> str:
        ex = exchange.upper()
        und = underlying.upper()
        if ex == "MCX":
            return "MCX_ANY"
        if ex == "NSE":
            if "BANK" in und:
                return "NSE_BANKNIFTY"
            return "NSE_NIFTY"
        if ex == "BSE":
            return "BSE_SENSEX"
        return "{}_{}".format(ex, und)

    def _factor(self, a: str, b: str) -> float:
        if a == b:
            return 0.0
        pair = (a, b) if (a, b) in self.correlation else (b, a)
        # try direct
        if (a, b) in self.correlation:
            return float(self.correlation[(a, b)])
        if (b, a) in self.correlation:
            return float(self.correlation[(b, a)])
        # fallback: MCX vs anything -> 0; else 0.3
        if a.startswith("MCX") or b.startswith("MCX"):
            return 0.0
        return 0.3

    def calculate(self, exchange_margins: Dict[str, float]) -> CrossMarginResult:
        """exchange_margins: {exchange_or_key: margin}. Returns net combined."""
        res = CrossMarginResult()
        # normalize keys
        norm: Dict[str, float] = {}
        for k, v in (exchange_margins or {}).items():
            norm[str(k).upper()] = float(v)
        res.per_exchange = dict(norm)
        res.gross_total = float(sum(norm.values()))

        keys = list(norm.keys())
        pairs: List[Dict[str, Any]] = []
        total_benefit = 0.0
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                a, b = keys[i], keys[j]
                ma, mb = norm[a], norm[b]
                if ma <= 0 or mb <= 0:
                    continue
                factor = self._factor(a, b)
                if factor <= 0:
                    pairs.append({"pair": [a, b], "factor": factor, "benefit": 0.0})
                    continue
                benefit = factor * min(ma, mb)
                total_benefit += benefit
                pairs.append({"pair": [a, b], "factor": round(factor, 4),
                             "benefit": round(benefit, 2)})

        # cap benefit
        cap = res.gross_total * self.benefit_cap
        cap_applied = False
        if total_benefit > cap:
            total_benefit = cap
            cap_applied = True
        res.benefit = float(total_benefit)
        res.net_total = float(max(0.0, res.gross_total - res.benefit))
        res.pairs = pairs
        res.cap_applied = cap_applied
        return res

    def calculate_from_books(self, books: List[StrategyBook], margins: List[MarginBreakdown]) -> CrossMarginResult:
        # group margins by exchange key derived from underlying
        agg: Dict[str, float] = {}
        for b, m in zip(books, margins):
            key = self._key(b.exchange, b.underlying)
            agg[key] = agg.get(key, 0.0) + (m.net_after_cross if m.net_after_cross > 0 else m.total_margin)
        return self.calculate(agg)


# ---------------------------------------------------------------------------
# Headroom guard
# ---------------------------------------------------------------------------
class HeadroomGuard:
    """Dynamic 20% cash margin headroom guard."""

    def __init__(self, threshold: float = HEADROOM_THRESHOLD) -> None:
        self.threshold = float(threshold)

    def check(
        self,
        free_collateral: float = 0.0,
        total_collateral: float = 0.0,
        used_margin: Optional[float] = None,
        available_margin: Optional[float] = None,
    ) -> HeadroomStatus:
        total = _safe_float(total_collateral)
        free = _safe_float(free_collateral)
        if total <= 0:
            # derive total from free + used
            used = _safe_float(used_margin)
            avail = _safe_float(available_margin)
            total = free + used if (free + used) > 0 else avail
            if total <= 0:
                total = max(free, 1.0)
        if free <= 0 and available_margin is not None:
            free = _safe_float(available_margin)
        free_pct = (free / total) if total > 0 else 1.0
        throttle = free_pct < self.threshold
        status = HeadroomStatus(
            free_collateral=free,
            total_collateral=total,
            free_pct=free_pct,
            threshold=self.threshold,
            throttle=throttle,
        )
        if throttle:
            status.reason = "free collateral {:.2%} below {}% headroom guard".format(free_pct, int(self.threshold * 100))
            status.actions = [
                "throttle new position initiation",
                "block new short option entries until headroom restored",
            ]
        else:
            status.reason = "headroom ok"
            status.actions = ["no action required"]
        return status

    def from_collateral_manager(self, manager: Any = None) -> HeadroomStatus:
        mgr = manager if manager is not None else _collateral_margin_manager
        if mgr is None:
            return self.check(0.0, 0.0)
        try:
            snap = getattr(mgr, "snapshot", None)
            if snap is None and hasattr(mgr, "evaluate"):
                snap = mgr.evaluate()
            free = _safe_float(getattr(snap, "available_margin", 0.0))
            total = _safe_float(getattr(snap, "total_margin_available", 0.0))
            used = _safe_float(getattr(snap, "used_margin", 0.0))
            return self.check(free_collateral=free, total_collateral=total, used_margin=used)
        except Exception as exc:
            log.warning("headroom from collateral manager failed: %s", exc)
            return self.check(0.0, 0.0)


# ---------------------------------------------------------------------------
# In-memory order placer (for tests / simulation)
# ---------------------------------------------------------------------------
class InMemoryOrderPlacer:
    """Test/simulation placer: acknowledges orders within a configurable latency."""

    def __init__(self, latency_ms: float = 10.0, fail_legs: Optional[set] = None,
                 reject: bool = False) -> None:
        self.latency_ms = float(latency_ms)
        self.fail_legs = set(fail_legs or [])
        self.reject = bool(reject)
        self.calls: List[Dict[str, Any]] = []
        self._counter = 0

    def place_order(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        self._counter += 1
        oid = "SIM_{}".format(self._counter)
        self.calls.append({"payload": payload, "order_id": oid})
        time.sleep(self.latency_ms / 1000.0)
        leg_key = payload.get("leg_id") or payload.get("symbol")
        if self.reject or leg_key in self.fail_legs:
            return {"status": "error", "order_id": oid, "message": "simulated rejection"}
        return {"status": "success", "order_id": oid, "filled_qty": payload.get("quantity", 0)}

    def wait_for_fill(self, order_id: str, timeout_ms: int = FILL_ACK_TIMEOUT_MS) -> FillAck:
        # In-memory: already filled at placement; report acked with placement latency.
        return FillAck(order_id=order_id, status="ACKED", filled_qty=0,
                      latency_ms=self.latency_ms)


# ---------------------------------------------------------------------------
# Sequence governor
# ---------------------------------------------------------------------------
class SequenceGovernor:
    """Hedged-Leg-First order sequencing with <200 ms fill-ack invariant."""

    def __init__(
        self,
        fill_ack_timeout_ms: int = FILL_ACK_TIMEOUT_MS,
        headroom_guard: Optional[HeadroomGuard] = None,
    ) -> None:
        self.fill_ack_timeout_ms = int(fill_ack_timeout_ms)
        self.headroom_guard = headroom_guard or HeadroomGuard()

    # ------------------------------------------------------------------ #
    def classify(self, book: StrategyBook) -> Dict[str, List[OptionLeg]]:
        hedges = [l for l in book.legs if l.is_long()]
        shorts = [l for l in book.legs if l.is_short()]
        return {"hedge": hedges, "short": shorts}

    def build_sequence(self, book: StrategyBook) -> List[SequenceStep]:
        classes = self.classify(book)
        steps: List[SequenceStep] = []
        if classes["hedge"]:
            steps.append(SequenceStep(
                phase=SequencePhase.HEDGE.value,
                leg_ids=[l.leg_id for l in classes["hedge"]],
                timeout_ms=self.fill_ack_timeout_ms,
            ))
        if classes["short"]:
            steps.append(SequenceStep(
                phase=SequencePhase.SHORT.value,
                leg_ids=[l.leg_id for l in classes["short"]],
                timeout_ms=self.fill_ack_timeout_ms,
            ))
        return steps

    def _leg_by_id(self, book: StrategyBook, leg_id: str) -> Optional[OptionLeg]:
        for l in book.legs:
            if l.leg_id == leg_id:
                return l
        return None

    def _place_leg(self, leg: OptionLeg, book: StrategyBook, place_order: Callable[[Dict[str, Any]], Dict[str, Any]]) -> Tuple[Dict[str, Any], FillAck]:
        payload = self.leg_to_order_payload(leg, book)
        t0 = _now_ms()
        try:
            resp = place_order(payload) or {}
        except Exception as exc:
            lat = _now_ms() - t0
            ack = FillAck(order_id="", leg_id=leg.leg_id, status="FAILED",
                         latency_ms=lat, raw={"error": str(exc)})
            return payload, ack
        lat = _now_ms() - t0
        oid = _safe_str(resp.get("order_id") or resp.get("orderid") or resp.get("id"))
        status = _safe_str(resp.get("status", "success"))
        ack_status = "ACKED" if status.lower() in ("success", "ok", "filled", "placed", "complete") else "REJECTED"
        # honor explicit latency if provided
        if "latency_ms" in resp:
            lat = _safe_float(resp.get("latency_ms"), lat)
        ack = FillAck(order_id=oid, leg_id=leg.leg_id, status=ack_status,
                     filled_qty=_safe_int(resp.get("filled_qty", resp.get("quantity", 0))),
                     avg_price=_safe_float(resp.get("avg_price", resp.get("price", 0.0))),
                     latency_ms=lat, raw=resp)
        return payload, ack

    def leg_to_order_payload(self, leg: OptionLeg, book: StrategyBook) -> Dict[str, Any]:
        action = "BUY" if leg.is_long() else "SELL"
        symbol = leg.trading_symbol or "{}{}{}{}".format(
            book.underlying or leg.underlying, (leg.expiry or book.expiry or ""),
            int(leg.strike), leg.option_type)
        exchange = leg.exchange or book.exchange
        # map exchange to OpenAlgo exchange code
        ex_code = exchange
        if exchange.upper() == "NSE":
            ex_code = "NFO" if leg.option_type in (OptionType.CE.value, OptionType.PE.value) else "NSE"
        elif exchange.upper() == "BSE":
            ex_code = "BFO" if leg.option_type in (OptionType.CE.value, OptionType.PE.value) else "BSE"
        elif exchange.upper() == "MCX":
            ex_code = "MCX"
        return {
            "leg_id": leg.leg_id,
            "symbol": symbol,
            "action": action,
            "exchange": ex_code,
            "product": "NRML",
            "pricetype": "MARKET",
            "quantity": abs(leg.quantity) * leg.lot_size,
            "price": 0.0,
            "trigger_price": 0.0,
            "disclosed_quantity": 0,
            "strategy": "SPAN_PORTFOLIO_MARGIN",
            "underlying": book.underlying,
            "book_id": book.book_id,
        }

    def dispatch_sequence(
        self,
        book: StrategyBook,
        place_order: Callable[[Dict[str, Any]], Dict[str, Any]],
        wait_for_fill: Optional[Callable[[str, int], Optional[FillAck]]] = None,
        headroom: Optional[HeadroomStatus] = None,
        flatten_on_fail: bool = True,
        flatten_callback: Optional[Callable[[List[OptionLeg]], None]] = None,
    ) -> DispatchResult:
        result = DispatchResult(book_id=book.book_id)
        result.headroom = headroom
        t0 = _now_ms()

        # headroom guard
        if headroom is not None and headroom.throttle:
            result.status = DispatchStatus.THROTTLED.value
            result.aborted = True
            result.abort_reason = "headroom guard: free collateral below 20%"
            result.total_latency_ms = _now_ms() - t0
            return result

        steps = self.build_sequence(book)
        result.steps = steps
        all_hedge_acked = False
        aborted = False
        abort_reason = None
        orders: List[Dict[str, Any]] = []

        for step in steps:
            # gating: shorts require hedge ack
            if step.phase == SequencePhase.SHORT.value and not all_hedge_acked:
                step.status = SequenceStatus.ABORTED.value
                step.error = "short leg blocked: hedge fill not acknowledged"
                aborted = True
                abort_reason = "hedged-leg-first invariant violated: short leg cannot route before hedge ack"
                break

            step.started_at = time.time()
            step.status = SequenceStatus.PLACED.value
            leg_ids = list(step.leg_ids)
            for lid in leg_ids:
                leg = self._leg_by_id(book, lid)
                if leg is None:
                    continue
                payload, ack = self._place_leg(leg, book, place_order)
                # wait_for_fill override
                if wait_for_fill is not None and ack.order_id:
                    try:
                        wack = wait_for_fill(ack.order_id, self.fill_ack_timeout_ms)
                        if wack is not None:
                            # merge latency
                            if wack.latency_ms and wack.latency_ms > 0:
                                ack.latency_ms = wack.latency_ms
                            ack.status = wack.status if wack.status else ack.status
                            ack.filled_qty = wack.filled_qty if wack.filled_qty else ack.filled_qty
                            ack.raw = wack.raw if wack.raw is not None else ack.raw
                    except Exception as exc:
                        ack.status = "FAILED"
                        ack.raw = {"error": str(exc)}

                # enforce 200ms ack
                if ack.latency_ms > self.fill_ack_timeout_ms:
                    ack.status = "TIMEOUT"
                step.acks.append(ack)
                orders.append({"phase": step.phase, "leg_id": lid, "payload": payload,
                               "ack": {"order_id": ack.order_id, "status": ack.status,
                                       "latency_ms": round(ack.latency_ms, 2)}})

                if not ack.is_acked():
                    step.status = SequenceStatus.FAILED.value
                    step.error = "fill not acknowledged for leg {}".format(lid)
                    aborted = True
                    abort_reason = "fill ack failed for leg {} ({} ms)".format(lid, round(ack.latency_ms, 2))
                    break

            step.finished_at = time.time()
            if aborted:
                step.status = SequenceStatus.FAILED.value if step.status != SequenceStatus.ABORTED.value else step.status
                break

            if step.all_acked():
                step.status = SequenceStatus.ACKED.value
                if step.phase == SequencePhase.HEDGE.value:
                    all_hedge_acked = True
            else:
                step.status = SequenceStatus.FAILED.value
                aborted = True
                abort_reason = "not all legs acked in phase {}".format(step.phase)
                break

        # flatten on fail
        flattened = False
        if aborted and flatten_on_fail:
            hedge_legs = [self._leg_by_id(book, lid) for lid in (steps[0].leg_ids if steps else [])]
            hedge_legs = [l for l in hedge_legs if l is not None]
            if flatten_callback is not None and hedge_legs:
                try:
                    flatten_callback(hedge_legs)
                    flattened = True
                except Exception as exc:
                    log.error("flatten callback failed: %s", exc)
            elif hedge_legs:
                # default: mark flattened (no broker call) — caller may handle
                flattened = False

        result.steps = steps
        result.orders = orders
        result.aborted = aborted
        result.abort_reason = abort_reason
        result.flattened = flattened
        result.total_latency_ms = _now_ms() - t0

        if aborted:
            # if hedge phase failed -> failed; if short phase failed after hedges -> partial
            hedge_failed = any(s.phase == SequencePhase.HEDGE.value and s.status == SequenceStatus.FAILED.value for s in steps)
            result.status = DispatchStatus.FAILED.value if hedge_failed else DispatchStatus.PARTIAL.value
        else:
            result.status = DispatchStatus.SUCCESS.value
        return result

    async def dispatch_sequence_async(
        self,
        book: StrategyBook,
        place_order: Callable[[Dict[str, Any]], Any],
        wait_for_fill: Optional[Callable[[str, int], Any]] = None,
        headroom: Optional[HeadroomStatus] = None,
        flatten_on_fail: bool = True,
        flatten_callback: Optional[Callable[[List[OptionLeg]], Any]] = None,
    ) -> DispatchResult:
        # Wrap sync place_order/wait_for_fill into async via to_thread if needed.
        def _place(p):
            r = place_order(p)
            if asyncio.iscoroutine(r):
                return None
            return r

        # If place_order is coroutine function, handle.
        async def _place_async(p):
            if asyncio.iscoroutinefunction(place_order):
                return await place_order(p)
            return await asyncio.to_thread(place_order, p)

        async def _wait_async(oid, to):
            if wait_for_fill is None:
                return None
            if asyncio.iscoroutinefunction(wait_for_fill):
                return await wait_for_fill(oid, to)
            return await asyncio.to_thread(wait_for_fill, oid, to)

        # Reimplement dispatch with async calls.
        result = DispatchResult(book_id=book.book_id)
        result.headroom = headroom
        t0 = _now_ms()

        if headroom is not None and headroom.throttle:
            result.status = DispatchStatus.THROTTLED.value
            result.aborted = True
            result.abort_reason = "headroom guard: free collateral below 20%"
            result.total_latency_ms = _now_ms() - t0
            return result

        steps = self.build_sequence(book)
        result.steps = steps
        all_hedge_acked = False
        aborted = False
        abort_reason = None
        orders: List[Dict[str, Any]] = []

        for step in steps:
            if step.phase == SequencePhase.SHORT.value and not all_hedge_acked:
                step.status = SequenceStatus.ABORTED.value
                step.error = "short leg blocked: hedge fill not acknowledged"
                aborted = True
                abort_reason = "hedged-leg-first invariant violated"
                break

            step.started_at = time.time()
            step.status = SequenceStatus.PLACED.value
            for lid in list(step.leg_ids):
                leg = self._leg_by_id(book, lid)
                if leg is None:
                    continue
                payload = self.leg_to_order_payload(leg, book)
                pt0 = _now_ms()
                try:
                    resp = await _place_async(payload) or {}
                except Exception as exc:
                    lat = _now_ms() - pt0
                    ack = FillAck(order_id="", leg_id=leg.leg_id, status="FAILED",
                                 latency_ms=lat, raw={"error": str(exc)})
                    step.acks.append(ack)
                    aborted = True
                    abort_reason = "place_order exception: {}".format(exc)
                    break
                lat = _now_ms() - pt0
                oid = _safe_str(resp.get("order_id") or resp.get("orderid") or resp.get("id"))
                status = _safe_str(resp.get("status", "success"))
                ack_status = "ACKED" if status.lower() in ("success", "ok", "filled", "placed", "complete") else "REJECTED"
                if "latency_ms" in resp:
                    lat = _safe_float(resp.get("latency_ms"), lat)
                ack = FillAck(order_id=oid, leg_id=leg.leg_id, status=ack_status,
                             filled_qty=_safe_int(resp.get("filled_qty", resp.get("quantity", 0))),
                             avg_price=_safe_float(resp.get("avg_price", resp.get("price", 0.0))),
                             latency_ms=lat, raw=resp)

                if wait_for_fill is not None and ack.order_id:
                    try:
                        wack = await _wait_async(ack.order_id, self.fill_ack_timeout_ms)
                        if wack is not None:
                            if getattr(wack, "latency_ms", 0):
                                ack.latency_ms = wack.latency_ms
                            ack.status = getattr(wack, "status", ack.status) or ack.status
                            ack.filled_qty = getattr(wack, "filled_qty", ack.filled_qty) or ack.filled_qty
                            ack.raw = getattr(wack, "raw", ack.raw)
                    except Exception as exc:
                        ack.status = "FAILED"
                        ack.raw = {"error": str(exc)}

                if ack.latency_ms > self.fill_ack_timeout_ms:
                    ack.status = "TIMEOUT"

                step.acks.append(ack)
                orders.append({"phase": step.phase, "leg_id": lid, "payload": payload,
                               "ack": {"order_id": ack.order_id, "status": ack.status,
                                       "latency_ms": round(ack.latency_ms, 2)}})

                if not ack.is_acked():
                    step.status = SequenceStatus.FAILED.value
                    step.error = "fill not acknowledged for leg {}".format(lid)
                    aborted = True
                    abort_reason = "fill ack failed for leg {} ({} ms)".format(lid, round(ack.latency_ms, 2))
                    break

            step.finished_at = time.time()
            if aborted:
                break
            if step.all_acked():
                step.status = SequenceStatus.ACKED.value
                if step.phase == SequencePhase.HEDGE.value:
                    all_hedge_acked = True
            else:
                step.status = SequenceStatus.FAILED.value
                aborted = True
                abort_reason = "not all legs acked in phase {}".format(step.phase)
                break

        flattened = False
        if aborted and flatten_on_fail:
            hedge_legs = [self._leg_by_id(book, lid) for lid in (steps[0].leg_ids if steps else [])]
            hedge_legs = [l for l in hedge_legs if l is not None]
            if flatten_callback is not None and hedge_legs:
                try:
                    r = flatten_callback(hedge_legs)
                    if asyncio.iscoroutine(r):
                        await r
                    flattened = True
                except Exception as exc:
                    log.error("flatten callback failed: %s", exc)

        result.steps = steps
        result.orders = orders
        result.aborted = aborted
        result.abort_reason = abort_reason
        result.flattened = flattened
        result.total_latency_ms = _now_ms() - t0
        if aborted:
            hedge_failed = any(s.phase == SequencePhase.HEDGE.value and s.status == SequenceStatus.FAILED.value for s in steps)
            result.status = DispatchStatus.FAILED.value if hedge_failed else DispatchStatus.PARTIAL.value
        else:
            result.status = DispatchStatus.SUCCESS.value
        return result


# ---------------------------------------------------------------------------
# High-level engine facade
# ---------------------------------------------------------------------------
class SpanPortfolioMarginEngine:
    """Facade combining margin, cross-margin, headroom, and sequencing."""

    def __init__(
        self,
        span_calculator: Optional[SPANMarginCalculator] = None,
        cross_calculator: Optional[CrossMarginCalculator] = None,
        headroom_guard: Optional[HeadroomGuard] = None,
        governor: Optional[SequenceGovernor] = None,
        collateral_manager: Any = None,
    ) -> None:
        self.span = span_calculator or SPANMarginCalculator()
        self.cross = cross_calculator or CrossMarginCalculator()
        self.headroom = headroom_guard or HeadroomGuard()
        self.governor = governor or SequenceGovernor()
        self.collateral_manager = collateral_manager if collateral_manager is not None else _collateral_margin_manager

    def margin_for_book(self, book: StrategyBook) -> MarginBreakdown:
        return self.span.compute(book)

    def margin_for_books(self, books: List[StrategyBook]) -> Tuple[List[MarginBreakdown], CrossMarginResult]:
        margins = [self.span.compute(b) for b in books]
        cross = self.cross.calculate_from_books(books, margins)
        # attach cross benefit proportionally
        for m in margins:
            m.cross_margin_benefit = 0.0
            m.net_after_cross = m.total_margin
        # distribute benefit by margin weight
        gross = sum(m.total_margin for m in margins) or 1.0
        for m in margins:
            share = m.total_margin / gross
            m.cross_margin_benefit = cross.benefit * share
            m.net_after_cross = max(0.0, m.total_margin - m.cross_margin_benefit)
        return margins, cross

    def headroom_status(self, free: float = 0.0, total: float = 0.0, **kw: Any) -> HeadroomStatus:
        return self.headroom.check(free_collateral=free, total_collateral=total, **kw)

    def headroom_from_collateral(self, manager: Any = None) -> HeadroomStatus:
        return self.headroom.from_collateral_manager(manager if manager is not None else self.collateral_manager)

    def dispatch(
        self,
        book: StrategyBook,
        place_order: Callable[[Dict[str, Any]], Any],
        wait_for_fill: Optional[Callable[[str, int], Any]] = None,
        free_collateral: float = 0.0,
        total_collateral: float = 0.0,
        flatten_on_fail: bool = True,
        flatten_callback: Optional[Callable[[List[OptionLeg]], Any]] = None,
    ) -> DispatchResult:
        hs = self.headroom.check(free_collateral=free_collateral, total_collateral=total_collateral)
        return self.governor.dispatch_sequence(
            book, place_order, wait_for_fill=wait_for_fill, headroom=hs,
            flatten_on_fail=flatten_on_fail, flatten_callback=flatten_callback,
        )

    async def dispatch_async(self, book: StrategyBook, place_order: Callable[[Dict[str, Any]], Any],
                             wait_for_fill: Optional[Callable[[str, int], Any]] = None, **kw: Any) -> DispatchResult:
        free = kw.pop("free_collateral", 0.0)
        total = kw.pop("total_collateral", 0.0)
        hs = self.headroom.check(free_collateral=free, total_collateral=total)
        return await self.governor.dispatch_sequence_async(
            book, place_order, wait_for_fill=wait_for_fill, headroom=hs, **kw)


# ---------------------------------------------------------------------------
# Convenience builders for common strategies
# ---------------------------------------------------------------------------
def build_iron_condor_book(
    underlying: str = "NIFTY",
    exchange: str = Exchange.NSE.value,
    underlying_price: float = 22000.0,
    short_ce_strike: float = 22200.0,
    short_pe_strike: float = 21800.0,
    long_ce_strike: float = 22400.0,
    long_pe_strike: float = 21600.0,
    expiry: Optional[str] = None,
    quantity: int = 1,
    lot_size: int = 50,
    premium_short_ce: float = 80.0,
    premium_short_pe: float = 80.0,
    premium_long_ce: float = 20.0,
    premium_long_pe: float = 20.0,
    delta_short: float = 0.15,
    delta_long: float = 0.05,
) -> StrategyBook:
    book = StrategyBook(strategy=StrategyType.IRON_CONDOR.value, exchange=exchange,
                        underlying=underlying, expiry=expiry, lots=quantity, lot_size=lot_size,
                        underlying_price=underlying_price)
    legs = [
        OptionLeg(symbol="{}{}{}CE".format(underlying, expiry or "", int(short_ce_strike)),
                  exchange=exchange, underlying=underlying, option_type=OptionType.CE.value,
                  side=PositionSide.SHORT.value, strike=short_ce_strike, expiry=expiry,
                  quantity=quantity, lot_size=lot_size, premium=premium_short_ce,
                  underlying_price=underlying_price, delta=delta_short, is_hedge=False),
        OptionLeg(symbol="{}{}{}PE".format(underlying, expiry or "", int(short_pe_strike)),
                  exchange=exchange, underlying=underlying, option_type=OptionType.PE.value,
                  side=PositionSide.SHORT.value, strike=short_pe_strike, expiry=expiry,
                  quantity=quantity, lot_size=lot_size, premium=premium_short_pe,
                  underlying_price=underlying_price, delta=-delta_short, is_hedge=False),
        OptionLeg(symbol="{}{}{}CE".format(underlying, expiry or "", int(long_ce_strike)),
                  exchange=exchange, underlying=underlying, option_type=OptionType.CE.value,
                  side=PositionSide.LONG.value, strike=long_ce_strike, expiry=expiry,
                  quantity=quantity, lot_size=lot_size, premium=premium_long_ce,
                  underlying_price=underlying_price, delta=delta_long, is_hedge=True),
        OptionLeg(symbol="{}{}{}PE".format(underlying, expiry or "", int(long_pe_strike)),
                  exchange=exchange, underlying=underlying, option_type=OptionType.PE.value,
                  side=PositionSide.LONG.value, strike=long_pe_strike, expiry=expiry,
                  quantity=quantity, lot_size=lot_size, premium=premium_long_pe,
                  underlying_price=underlying_price, delta=-delta_long, is_hedge=True),
    ]
    book.legs = legs
    return book


def build_ratio_spread_book(
    underlying: str = "NIFTY",
    exchange: str = Exchange.NSE.value,
    underlying_price: float = 22000.0,
    short_strike: float = 22200.0,
    long_strike: float = 22600.0,
    expiry: Optional[str] = None,
    short_qty: int = 2,
    long_qty: int = 1,
    lot_size: int = 50,
    option_type: str = OptionType.CE.value,
) -> StrategyBook:
    book = StrategyBook(strategy=StrategyType.RATIO_SPREAD.value, exchange=exchange,
                        underlying=underlying, expiry=expiry, lots=short_qty, lot_size=lot_size,
                        underlying_price=underlying_price)
    legs = [
        OptionLeg(symbol="{}{}{}{}".format(underlying, expiry or "", int(short_strike), option_type),
                  exchange=exchange, underlying=underlying, option_type=option_type,
                  side=PositionSide.SHORT.value, strike=short_strike, expiry=expiry,
                  quantity=short_qty, lot_size=lot_size, premium=90.0,
                  underlying_price=underlying_price, delta=0.20),
        OptionLeg(symbol="{}{}{}{}".format(underlying, expiry or "", int(long_strike), option_type),
                  exchange=exchange, underlying=underlying, option_type=option_type,
                  side=PositionSide.LONG.value, strike=long_strike, expiry=expiry,
                  quantity=long_qty, lot_size=lot_size, premium=30.0,
                  underlying_price=underlying_price, delta=0.08, is_hedge=True),
    ]
    book.legs = legs
    return book


def build_calendar_roll_book(
    underlying: str = "NIFTY",
    exchange: str = Exchange.NSE.value,
    underlying_price: float = 22000.0,
    strike: float = 22000.0,
    near_expiry: str = "2026-10-23",
    far_expiry: str = "2026-10-30",
    quantity: int = 1,
    lot_size: int = 50,
    option_type: str = OptionType.CE.value,
) -> StrategyBook:
    book = StrategyBook(strategy=StrategyType.CALENDAR_ROLL.value, exchange=exchange,
                        underlying=underlying, expiry=near_expiry, lots=quantity, lot_size=lot_size,
                        underlying_price=underlying_price)
    legs = [
        OptionLeg(symbol="{}{}{}{}".format(underlying, near_expiry, int(strike), option_type),
                  exchange=exchange, underlying=underlying, option_type=option_type,
                  side=PositionSide.SHORT.value, strike=strike, expiry=near_expiry,
                  quantity=quantity, lot_size=lot_size, premium=100.0,
                  underlying_price=underlying_price, delta=0.50),
        OptionLeg(symbol="{}{}{}{}".format(underlying, far_expiry, int(strike), option_type),
                  exchange=exchange, underlying=underlying, option_type=option_type,
                  side=PositionSide.LONG.value, strike=strike, expiry=far_expiry,
                  quantity=quantity, lot_size=lot_size, premium=130.0,
                  underlying_price=underlying_price, delta=0.52, is_hedge=True),
    ]
    book.legs = legs
    return book


def build_box_spread_book(
    underlying: str = "NIFTY",
    exchange: str = Exchange.NSE.value,
    underlying_price: float = 22000.0,
    k1: float = 21900.0,
    k2: float = 22100.0,
    expiry: Optional[str] = None,
    quantity: int = 1,
    lot_size: int = 50,
) -> StrategyBook:
    book = StrategyBook(strategy=StrategyType.BOX_SPREAD.value, exchange=exchange,
                        underlying=underlying, expiry=expiry, lots=quantity, lot_size=lot_size,
                        underlying_price=underlying_price)
    legs = [
        OptionLeg(symbol="{}{}{}CE".format(underlying, expiry or "", int(k1)),
                  exchange=exchange, underlying=underlying, option_type=OptionType.CE.value,
                  side=PositionSide.LONG.value, strike=k1, expiry=expiry,
                  quantity=quantity, lot_size=lot_size, premium=200.0,
                  underlying_price=underlying_price, delta=0.55, is_hedge=True),
        OptionLeg(symbol="{}{}{}CE".format(underlying, expiry or "", int(k2)),
                  exchange=exchange, underlying=underlying, option_type=OptionType.CE.value,
                  side=PositionSide.SHORT.value, strike=k2, expiry=expiry,
                  quantity=quantity, lot_size=lot_size, premium=100.0,
                  underlying_price=underlying_price, delta=0.45),
        OptionLeg(symbol="{}{}{}PE".format(underlying, expiry or "", int(k2)),
                  exchange=exchange, underlying=underlying, option_type=OptionType.PE.value,
                  side=PositionSide.LONG.value, strike=k2, expiry=expiry,
                  quantity=quantity, lot_size=lot_size, premium=100.0,
                  underlying_price=underlying_price, delta=-0.45, is_hedge=True),
        OptionLeg(symbol="{}{}{}PE".format(underlying, expiry or "", int(k1)),
                  exchange=exchange, underlying=underlying, option_type=OptionType.PE.value,
                  side=PositionSide.SHORT.value, strike=k1, expiry=expiry,
                  quantity=quantity, lot_size=lot_size, premium=200.0,
                  underlying_price=underlying_price, delta=-0.55),
    ]
    book.legs = legs
    return book


# ---------------------------------------------------------------------------
# Embedded unit-test fixtures
# ---------------------------------------------------------------------------
FIXTURE_IRON_CONDOR_NIFTY = build_iron_condor_book(
    underlying="NIFTY", exchange="NSE", underlying_price=22000.0,
    short_ce_strike=22200.0, short_pe_strike=21800.0,
    long_ce_strike=22400.0, long_pe_strike=21600.0,
    expiry="2026-10-23", quantity=1, lot_size=50,
)

FIXTURE_RATIO_SPREAD_NIFTY = build_ratio_spread_book(
    underlying="NIFTY", exchange="NSE", underlying_price=22000.0,
    short_strike=22200.0, long_strike=22600.0, expiry="2026-10-23",
    short_qty=2, long_qty=1, lot_size=50,
)

FIXTURE_CALENDAR_ROLL_NIFTY = build_calendar_roll_book(
    underlying="NIFTY", exchange="NSE", underlying_price=22000.0,
    strike=22000.0, near_expiry="2026-10-23", far_expiry="2026-10-30",
    quantity=1, lot_size=50,
)

FIXTURE_BOX_SPREAD_NIFTY = build_box_spread_book(
    underlying="NIFTY", exchange="NSE", underlying_price=22000.0,
    k1=21900.0, k2=22100.0, expiry="2026-10-23", quantity=1, lot_size=50,
)

FIXTURE_SENSEX_IRON_CONDOR = build_iron_condor_book(
    underlying="SENSEX", exchange="BSE", underlying_price=74000.0,
    short_ce_strike=74500.0, short_pe_strike=73500.0,
    long_ce_strike=75000.0, long_pe_strike=73000.0,
    expiry="2026-10-23", quantity=1, lot_size=10,
)

FIXTURE_MCX_IRON_CONDOR = build_iron_condor_book(
    underlying="CRUDEOIL", exchange="MCX", underlying_price=6000.0,
    short_ce_strike=6100.0, short_pe_strike=5900.0,
    long_ce_strike=6200.0, long_pe_strike=5800.0,
    expiry="2026-10-23", quantity=1, lot_size=100,
)

FIXTURE_MULTI_EXCHANGE_BOOKS = [
    FIXTURE_IRON_CONDOR_NIFTY,
    FIXTURE_SENSEX_IRON_CONDOR,
    FIXTURE_MCX_IRON_CONDOR,
]

FIXTURE_HEADROOM_OK = {"free": 500000.0, "total": 1000000.0}
FIXTURE_HEADROOM_LOW = {"free": 100000.0, "total": 1000000.0}


# ---------------------------------------------------------------------------
# Module-level convenience
# ---------------------------------------------------------------------------
def get_engine(**kw: Any) -> SpanPortfolioMarginEngine:
    return SpanPortfolioMarginEngine(**kw)


def compute_margin(book: StrategyBook) -> MarginBreakdown:
    return SPANMarginCalculator().compute(book)


def compute_cross_margin(books: List[StrategyBook]) -> CrossMarginResult:
    eng = SpanPortfolioMarginEngine()
    _, cross = eng.margin_for_books(books)
    return cross


def check_headroom(free: float = 0.0, total: float = 0.0, **kw: Any) -> HeadroomStatus:
    return HeadroomGuard().check(free_collateral=free, total_collateral=total, **kw)


def build_sequence(book: StrategyBook) -> List[SequenceStep]:
    return SequenceGovernor().build_sequence(book)


__all__ = [
    "Exchange", "StrategyType", "PositionSide", "OptionType", "LegRole",
    "SequencePhase", "SequenceStatus", "DispatchStatus",
    "OptionLeg", "StrategyBook", "ScenarioLoss", "MarginBreakdown",
    "CrossMarginResult", "FillAck", "HeadroomStatus", "SequenceStep", "DispatchResult",
    "SPANMarginCalculator", "CrossMarginCalculator", "HeadroomGuard",
    "InMemoryOrderPlacer", "SequenceGovernor", "SpanPortfolioMarginEngine",
    "build_iron_condor_book", "build_ratio_spread_book", "build_calendar_roll_book",
    "build_box_spread_book",
    "FIXTURE_IRON_CONDOR_NIFTY", "FIXTURE_RATIO_SPREAD_NIFTY",
    "FIXTURE_CALENDAR_ROLL_NIFTY", "FIXTURE_BOX_SPREAD_NIFTY",
    "FIXTURE_SENSEX_IRON_CONDOR", "FIXTURE_MCX_IRON_CONDOR",
    "FIXTURE_MULTI_EXCHANGE_BOOKS", "FIXTURE_HEADROOM_OK", "FIXTURE_HEADROOM_LOW",
    "FILL_ACK_TIMEOUT_MS", "HEADROOM_THRESHOLD", "SPAN_SCENARIOS",
    "get_engine", "compute_margin", "compute_cross_margin", "check_headroom",
    "build_sequence",
]


def _demo() -> None:
    eng = SpanPortfolioMarginEngine()
    for name, book in [("IC", FIXTURE_IRON_CONDOR_NIFTY), ("RS", FIXTURE_RATIO_SPREAD_NIFTY),
                       ("CAL", FIXTURE_CALENDAR_ROLL_NIFTY), ("BOX", FIXTURE_BOX_SPREAD_NIFTY)]:
        m = eng.margin_for_book(book)
        print(name, "SPAN=", round(m.span_margin, 2), "EXP=", round(m.exposure_margin, 2),
              "TOTAL=", round(m.total_margin, 2))
    margins, cross = eng.margin_for_books(FIXTURE_MULTI_EXCHANGE_BOOKS)
    print("CROSS:", cross.to_dict())
    hs = eng.headroom_status(free=100000.0, total=1000000.0)
    print("HEADROOM:", hs.to_dict())


if __name__ == "__main__":
    _demo()
