"""
statutory_friction_engine.py — Pre-Trade Indian Statutory Friction & Slippage Engine.

Pure-stdlib, microsecond-fast calculator for the exact rupee-and-paisa statutory
charge stack on NSE cash and F&O orders, including exact round-trip break-even
solving.

Statutory basis (effective 2024-10-01; unchanged for FY 2026-27):
  * STT (Finance (No. 2) Act 2024): equity delivery 0.1% both legs; equity
    intraday 0.025% on sell; futures 0.02% on sell; options 0.1% of premium on
    sell; exercised options 0.125% of intrinsic (settlement) value.
  * NSE transaction charges (NSE circular, w.e.f. 2024-10-01, true-to-label):
    cash 0.00297%, equity futures 0.00173%, equity options 0.03503% of premium
    turnover; charged on each side.
  * SEBI turnover fees: Rs 10 per crore (0.0001%) on each side.
  * Stamp duty on the buy leg only: delivery 0.015%, intraday 0.003%, futures
    0.002%, options 0.003%.
  * GST: 18% on (brokerage + exchange transaction charges + SEBI fees).
  * Discount brokerage (Dhan / Upstox / Zerodha): min(Rs 20, 0.03% of turnover)
    per executed order; equity delivery free. Full-service profiles supported.

Zero external dependencies, no I/O, no global mutable state, import-safe.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Iterable, List, Mapping, Optional, Tuple, Union

__version__ = "1.0.0"
RATE_CARD_VERSION = "IN-NSE-2024-10-01.v1"
RATE_CARD_EFFECTIVE_FROM = "2024-10-01"

GST_RATE = 0.18
SEBI_TURNOVER_RATE = 0.000001
OPTIONS_EXERCISE_STT_RATE = 0.00125
DISCOUNT_FLAT_CAP = 20.0
DISCOUNT_PCT_RATE = 0.0003


class Segment(str, Enum):
    EQUITY_INTRADAY = "EQUITY_INTRADAY"
    EQUITY_DELIVERY = "EQUITY_DELIVERY"
    FUTURES = "FUTURES"
    OPTIONS = "OPTIONS"


class Action(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


@dataclass(frozen=True, slots=True)
class SegmentRates:
    segment: Segment
    stt_buy: float
    stt_sell: float
    exchange: float
    stamp_duty_buy: float


RATE_CARD: Dict[Segment, SegmentRates] = {
    Segment.EQUITY_DELIVERY: SegmentRates(
        Segment.EQUITY_DELIVERY, stt_buy=0.001, stt_sell=0.001,
        exchange=0.0000297, stamp_duty_buy=0.00015,
    ),
    Segment.EQUITY_INTRADAY: SegmentRates(
        Segment.EQUITY_INTRADAY, stt_buy=0.0, stt_sell=0.00025,
        exchange=0.0000297, stamp_duty_buy=0.00003,
    ),
    Segment.FUTURES: SegmentRates(
        Segment.FUTURES, stt_buy=0.0, stt_sell=0.0002,
        exchange=0.0000173, stamp_duty_buy=0.00002,
    ),
    Segment.OPTIONS: SegmentRates(
        Segment.OPTIONS, stt_buy=0.0, stt_sell=0.001,
        exchange=0.0003503, stamp_duty_buy=0.00003,
    ),
}


@dataclass(frozen=True, slots=True)
class BrokerProfile:
    key: str
    mode: str
    flat_fee: float = DISCOUNT_FLAT_CAP
    pct_rate: float = DISCOUNT_PCT_RATE
    delivery_pct_rate: float = 0.0
    delivery_flat_fee: float = 20.0

    def brokerage(self, turnover: float, is_delivery: bool) -> float:
        if is_delivery:
            if self.mode == "DISCOUNT":
                return 0.0
            return max(self.delivery_flat_fee, self.delivery_pct_rate * turnover)
        if self.mode == "DISCOUNT":
            return min(self.flat_fee, self.pct_rate * turnover)
        return max(self.flat_fee, self.pct_rate * turnover)


BROKER_PROFILES: Dict[str, BrokerProfile] = {
    "DHAN": BrokerProfile("DHAN", "DISCOUNT"),
    "UPSTOX": BrokerProfile("UPSTOX", "DISCOUNT"),
    "ZERODHA": BrokerProfile("ZERODHA", "DISCOUNT"),
    "FULL_SERVICE": BrokerProfile(
        "FULL_SERVICE", "FULL_SERVICE", flat_fee=20.0, pct_rate=0.0005,
        delivery_pct_rate=0.003, delivery_flat_fee=20.0,
    ),
}

_BROKER_ALIASES = {
    "DHANHQ": "DHAN", "KITE": "ZERODHA", "ZERODHA": "ZERODHA",
    "ICICI": "FULL_SERVICE", "ICICIDIRECT": "FULL_SERVICE",
    "HDFC": "FULL_SERVICE", "KOTAK": "FULL_SERVICE",
    "FULLSERVICE": "FULL_SERVICE", "TRADITIONAL": "FULL_SERVICE",
}

_SEGMENT_ALIASES = {
    "EQUITY_INTRADAY": Segment.EQUITY_INTRADAY, "INTRADAY": Segment.EQUITY_INTRADAY,
    "MIS": Segment.EQUITY_INTRADAY, "EQ_INTRADAY": Segment.EQUITY_INTRADAY,
    "EQUITY_DELIVERY": Segment.EQUITY_DELIVERY, "DELIVERY": Segment.EQUITY_DELIVERY,
    "CNC": Segment.EQUITY_DELIVERY, "EQ_DELIVERY": Segment.EQUITY_DELIVERY,
    "FUTURES": Segment.FUTURES, "FUTURE": Segment.FUTURES, "FUT": Segment.FUTURES,
    "FNO_FUTURES": Segment.FUTURES, "NFO_FUT": Segment.FUTURES,
    "OPTIONS": Segment.OPTIONS, "OPTION": Segment.OPTIONS, "OPT": Segment.OPTIONS,
    "FNO_OPTIONS": Segment.OPTIONS, "NFO_OPT": Segment.OPTIONS,
    "CE": Segment.OPTIONS, "PE": Segment.OPTIONS,
}

_ACTION_ALIASES = {
    "BUY": Action.BUY, "B": Action.BUY, "LONG": Action.BUY,
    "SELL": Action.SELL, "S": Action.SELL, "SHORT": Action.SELL,
}


def _rupees(value: float) -> float:
    magnitude = int(abs(value) * 100.0 + 0.5) / 100.0
    return magnitude if value >= 0.0 else -magnitude


def _normalize_segment(segment: Union[str, Segment], is_intraday: bool) -> Segment:
    if isinstance(segment, Segment):
        return segment
    key = str(segment).strip().upper().replace("-", "_").replace(" ", "_")
    if key in ("EQUITY", "CASH", "EQ", "NSE_EQ"):
        return Segment.EQUITY_INTRADAY if is_intraday else Segment.EQUITY_DELIVERY
    if key in _SEGMENT_ALIASES:
        return _SEGMENT_ALIASES[key]
    raise ValueError(
        f"Unknown segment {segment!r}. Use EQUITY_INTRADAY, EQUITY_DELIVERY, FUTURES or OPTIONS."
    )


def _normalize_action(action: Union[str, Action]) -> Action:
    if isinstance(action, Action):
        return action
    key = str(action).strip().upper()
    if key in _ACTION_ALIASES:
        return _ACTION_ALIASES[key]
    raise ValueError(f"Unknown action {action!r}. Use BUY or SELL.")


def _validate_order(price: float, quantity: int) -> Tuple[float, int]:
    try:
        px = float(price)
        qty = int(quantity)
    except (TypeError, ValueError) as exc:
        raise ValueError("price and quantity must be numeric") from exc
    if not math.isfinite(px) or px <= 0.0:
        raise ValueError("price must be a finite positive number")
    if isinstance(quantity, bool) or float(quantity) != qty or qty <= 0:
        raise ValueError("quantity must be a positive integer")
    return px, qty


@dataclass(frozen=True, slots=True)
class ChargeBreakdown:
    segment: Segment
    action: Action
    broker: str
    price: float
    quantity: int
    turnover: float
    brokerage: float
    stt: float
    exchange_txn_charge: float
    sebi_turnover_charge: float
    stamp_duty: float
    gst: float
    total_statutory_charges: float
    breakeven_points: float
    rates: SegmentRates = field(compare=False, repr=False)
    profile: BrokerProfile = field(compare=False, repr=False)
    rate_card_version: str = RATE_CARD_VERSION

    def net_pnl_estimate(self, exit_price: float) -> float:
        """Round-trip net realised P&L after every statutory charge on both legs."""
        exit_action = Action.SELL if self.action is Action.BUY else Action.BUY
        exit_leg = _compute_breakdown(
            self.rates, exit_action, float(exit_price), self.quantity, self.profile,
            self.segment is Segment.EQUITY_DELIVERY, include_breakeven=False,
        )
        if self.action is Action.BUY:
            gross = (float(exit_price) - self.price) * self.quantity
        else:
            gross = (self.price - float(exit_price)) * self.quantity
        return _rupees(gross - self.total_statutory_charges - exit_leg.total_statutory_charges)

    def to_dict(self) -> Dict[str, object]:
        return {
            "segment": self.segment.value,
            "action": self.action.value,
            "broker": self.broker,
            "price": self.price,
            "quantity": self.quantity,
            "turnover": self.turnover,
            "brokerage": self.brokerage,
            "stt": self.stt,
            "exchangeTxnCharge": self.exchange_txn_charge,
            "sebiTurnoverCharge": self.sebi_turnover_charge,
            "stampDuty": self.stamp_duty,
            "gst": self.gst,
            "totalStatutoryCharges": self.total_statutory_charges,
            "breakevenPoints": self.breakeven_points,
            "rateCardVersion": self.rate_card_version,
        }


@dataclass(frozen=True, slots=True)
class RoundTripBreakdown:
    entry: ChargeBreakdown
    exit: ChargeBreakdown
    gross_pnl: float
    total_charges: float
    net_pnl: float
    total_turnover: float
    cost_bps: float
    breakeven_points: float

    def to_dict(self) -> Dict[str, object]:
        return {
            "entry": self.entry.to_dict(),
            "exit": self.exit.to_dict(),
            "grossPnl": self.gross_pnl,
            "totalCharges": self.total_charges,
            "netPnl": self.net_pnl,
            "totalTurnover": self.total_turnover,
            "costBps": self.cost_bps,
            "breakevenPoints": self.breakeven_points,
        }


def _leg_components(
    rates: SegmentRates, profile: BrokerProfile, action: Action,
    price: float, quantity: int, is_delivery: bool,
) -> Tuple[float, float, float, float, float, float]:
    turnover = price * quantity
    brokerage = profile.brokerage(turnover, is_delivery)
    stt = turnover * (rates.stt_buy if action is Action.BUY else rates.stt_sell)
    exchange = turnover * rates.exchange
    sebi = turnover * SEBI_TURNOVER_RATE
    stamp = turnover * rates.stamp_duty_buy if action is Action.BUY else 0.0
    return turnover, brokerage, stt, exchange, sebi, stamp


def _finalize(
    components: Tuple[float, float, float, float, float, float],
) -> Tuple[float, float, float, float, float, float, float, float]:
    turnover, brokerage, stt, exchange, sebi, stamp = components
    p_brokerage = int(brokerage * 100.0 + 0.5)
    p_exchange = int(exchange * 100.0 + 0.5)
    p_sebi = int(sebi * 100.0 + 0.5)
    p_stt = int(stt * 100.0 + 0.5)
    p_stamp = int(stamp * 100.0 + 0.5)
    p_gst = int((p_brokerage + p_exchange + p_sebi) * GST_RATE + 0.5)
    p_total = p_brokerage + p_stt + p_exchange + p_sebi + p_stamp + p_gst
    return (
        turnover, p_brokerage / 100.0, p_stt / 100.0, p_exchange / 100.0,
        p_sebi / 100.0, p_stamp / 100.0, p_gst / 100.0, p_total / 100.0,
    )


def _solve_breakeven(
    rates: SegmentRates, profile: BrokerProfile, entry_action: Action,
    price: float, quantity: int, is_delivery: bool, entry_total: float,
) -> float:
    """Exact adverse move (in price points) required to recover both legs' costs."""
    exit_action = Action.SELL if entry_action is Action.BUY else Action.BUY
    exit_var = (
        (rates.stt_buy if exit_action is Action.BUY else rates.stt_sell)
        + rates.exchange + SEBI_TURNOVER_RATE
        + GST_RATE * (rates.exchange + SEBI_TURNOVER_RATE)
    )
    if exit_action is Action.BUY:
        exit_var += rates.stamp_duty_buy
    beta = 0.0 if (is_delivery and profile.mode == "DISCOUNT") else (
        profile.delivery_pct_rate if is_delivery else profile.pct_rate
    )
    flat = profile.delivery_flat_fee if is_delivery else profile.flat_fee
    pq = price * quantity
    branches: List[Tuple[float, float, float]] = []
    if beta > 0.0:
        branches.append((beta * (1.0 + GST_RATE), 0.0, beta))
    if flat > 0.0:
        branches.append((0.0, flat * (1.0 + GST_RATE), 0.0))
    if not branches:
        branches.append((0.0, 0.0, 0.0))

    candidate: Optional[float] = None
    for lam, constant, beta_model in branches:
        variable = exit_var + lam
        if entry_action is Action.BUY:
            denominator = 1.0 - variable
            if denominator <= 0.0:
                continue
            x = (pq + entry_total + constant) / (quantity * denominator)
        else:
            x = (pq - entry_total - constant) / (quantity * (1.0 + variable))
        expected_brokerage = beta_model * x * quantity if beta_model > 0.0 else (
            flat if flat > 0.0 else 0.0
        )
        actual = profile.brokerage(max(x, 0.0) * quantity, is_delivery)
        if abs(expected_brokerage - actual) < 1e-6:
            candidate = x
            break
    if candidate is None or candidate <= 0.0:
        low = min(price, max(price - abs(entry_total) / quantity, 0.01))
        high = price + max(abs(entry_total) / quantity, 0.05) * 20.0 + 1.0
        for _ in range(64):
            mid = (low + high) / 2.0
            if _net_at(rates, profile, entry_action, price, quantity, is_delivery, entry_total, mid) < 0.0:
                low = mid
            else:
                high = mid
        candidate = (low + high) / 2.0

    for _ in range(3):
        residual = _net_at(
            rates, profile, entry_action, price, quantity, is_delivery,
            entry_total, candidate,
        )
        if abs(residual) < 0.005:
            break
        anchor = _net_at(
            rates, profile, entry_action, price, quantity, is_delivery,
            entry_total, price,
        )
        denominator = residual - anchor
        if abs(denominator) < 1e-12:
            break
        candidate = candidate - residual * (candidate - price) / denominator
    return abs(candidate - price)


def _net_at(
    rates: SegmentRates, profile: BrokerProfile, entry_action: Action,
    entry_price: float, quantity: int, is_delivery: bool,
    entry_total: float, exit_price: float,
) -> float:
    exit_action = Action.SELL if entry_action is Action.BUY else Action.BUY
    components = _leg_components(rates, profile, exit_action, exit_price, quantity, is_delivery)
    exit_total = _finalize(components)[-1]
    if entry_action is Action.BUY:
        gross = (exit_price - entry_price) * quantity
    else:
        gross = (entry_price - exit_price) * quantity
    return gross - entry_total - exit_total


def _compute_breakdown(
    rates: SegmentRates, action: Action, price: float, quantity: int,
    profile: BrokerProfile, is_delivery: bool, include_breakeven: bool = True,
) -> ChargeBreakdown:
    components = _leg_components(rates, profile, action, price, quantity, is_delivery)
    turnover, brokerage, stt, exchange, sebi, stamp, gst, total = _finalize(components)
    breakeven = 0.0
    if include_breakeven:
        breakeven = _solve_breakeven(rates, profile, action, price, quantity, is_delivery, total)
    return ChargeBreakdown(
        segment=rates.segment, action=action, broker=profile.key, price=price,
        quantity=quantity, turnover=turnover, brokerage=brokerage, stt=stt,
        exchange_txn_charge=exchange, sebi_turnover_charge=sebi, stamp_duty=stamp,
        gst=gst, total_statutory_charges=total, breakeven_points=breakeven,
        rates=rates, profile=profile,
    )


class StatutoryFrictionEngine:
    """Exact pre-trade friction calculator for Indian equities and F&O."""

    def __init__(
        self,
        rate_card: Optional[Mapping[Segment, SegmentRates]] = None,
        broker_profiles: Optional[Mapping[str, BrokerProfile]] = None,
    ) -> None:
        self.rate_card: Dict[Segment, SegmentRates] = dict(rate_card or RATE_CARD)
        self.broker_profiles: Dict[str, BrokerProfile] = dict(broker_profiles or BROKER_PROFILES)

    def calculate_charges(
        self,
        segment: str,
        action: str,
        price: float,
        quantity: int,
        broker: str = "DHAN",
        is_intraday: bool = True,
    ) -> ChargeBreakdown:
        seg = _normalize_segment(segment, bool(is_intraday))
        act = _normalize_action(action)
        profile = self._profile(broker)
        px, qty = _validate_order(price, quantity)
        rates = self.rate_card[seg]
        return _compute_breakdown(
            rates, act, px, qty, profile, seg is Segment.EQUITY_DELIVERY, include_breakeven=True
        )

    def calculate_round_trip(
        self,
        segment: str,
        entry_price: float,
        exit_price: float,
        quantity: int,
        action: str = "BUY",
        broker: str = "DHAN",
        is_intraday: bool = True,
    ) -> RoundTripBreakdown:
        entry_action = _normalize_action(action)
        exit_action = Action.SELL if entry_action is Action.BUY else Action.BUY
        entry = self.calculate_charges(segment, entry_action, entry_price, quantity, broker, is_intraday)
        seg = _normalize_segment(segment, bool(is_intraday))
        px, qty = _validate_order(exit_price, quantity)
        profile = self._profile(broker)
        exit_leg = _compute_breakdown(
            self.rate_card[seg], exit_action, px, qty, profile,
            seg is Segment.EQUITY_DELIVERY, include_breakeven=False,
        )
        if entry_action is Action.BUY:
            gross = (px - entry.price) * qty
        else:
            gross = (entry.price - px) * qty
        total_charges = _rupees(entry.total_statutory_charges + exit_leg.total_statutory_charges)
        total_turnover = _rupees(entry.turnover + exit_leg.turnover)
        return RoundTripBreakdown(
            entry=entry, exit=exit_leg, gross_pnl=_rupees(gross),
            total_charges=total_charges, net_pnl=_rupees(gross - total_charges),
            total_turnover=total_turnover,
            cost_bps=(total_charges / total_turnover * 10000.0) if total_turnover else 0.0,
            breakeven_points=entry.breakeven_points,
        )

    def calculate_batch(
        self, orders: Iterable[Union[Mapping[str, object], Tuple, List]],
        include_breakeven: bool = False,
    ) -> List[ChargeBreakdown]:
        results: List[ChargeBreakdown] = []
        append = results.append
        compute = _compute_breakdown
        memo: Dict[Tuple[str, str, str, bool], Tuple[SegmentRates, Action, BrokerProfile, bool]] = {}
        for order in orders:
            if isinstance(order, Mapping):
                segment = order.get("segment", "EQUITY_INTRADAY")
                action = order.get("action", "BUY")
                price = order.get("price", 0.0)
                quantity = order.get("quantity", 0)
                broker = order.get("broker", "DHAN")
                is_intraday = bool(order.get("is_intraday", True))
            else:
                if len(order) < 4:
                    raise ValueError("Tuple orders require (segment, action, price, quantity)")
                segment, action, price, quantity = order[0], order[1], order[2], order[3]
                broker = order[4] if len(order) > 4 else "DHAN"
                is_intraday = bool(order[5]) if len(order) > 5 else True
            cache_key = (str(segment), str(action), str(broker), is_intraday)
            resolved = memo.get(cache_key)
            if resolved is None:
                seg = _normalize_segment(segment, is_intraday)
                resolved = (
                    self.rate_card[seg],
                    _normalize_action(action),
                    self._profile(broker),
                    seg is Segment.EQUITY_DELIVERY,
                )
                memo[cache_key] = resolved
            rates, act, profile, is_delivery = resolved
            px, qty = _validate_order(price, quantity)
            append(compute(rates, act, px, qty, profile, is_delivery, include_breakeven))
        return results

    def exercise_stt(self, intrinsic_value: float, quantity: int) -> float:
        """STT on option exercise/settlement: 0.125% of intrinsic value."""
        value = float(intrinsic_value)
        qty = int(quantity)
        if not math.isfinite(value) or value < 0.0 or qty <= 0:
            raise ValueError("intrinsic_value must be >= 0 and quantity must be > 0")
        return _rupees(value * qty * OPTIONS_EXERCISE_STT_RATE)

    def rate_card_snapshot(self) -> Dict[str, object]:
        return {
            "version": RATE_CARD_VERSION,
            "effectiveFrom": RATE_CARD_EFFECTIVE_FROM,
            "gstRate": GST_RATE,
            "sebiTurnoverRate": SEBI_TURNOVER_RATE,
            "optionsExerciseSttRate": OPTIONS_EXERCISE_STT_RATE,
            "segments": {
                rates.segment.value: {
                    "sttBuy": rates.stt_buy,
                    "sttSell": rates.stt_sell,
                    "exchangeTxnCharge": rates.exchange,
                    "stampDutyBuy": rates.stamp_duty_buy,
                }
                for rates in self.rate_card.values()
            },
            "brokers": {
                key: {
                    "mode": profile.mode,
                    "flatFee": profile.flat_fee,
                    "pctRate": profile.pct_rate,
                    "deliveryPctRate": profile.delivery_pct_rate,
                }
                for key, profile in self.broker_profiles.items()
            },
        }

    def _profile(self, broker: Union[str, BrokerProfile]) -> BrokerProfile:
        if isinstance(broker, BrokerProfile):
            return broker
        key = str(broker).strip().upper().replace(" ", "_")
        key = _BROKER_ALIASES.get(key, key)
        profile = self.broker_profiles.get(key) or BROKER_PROFILES.get(key)
        if profile is None:
            supported = sorted(set(self.broker_profiles) | set(BROKER_PROFILES))
            raise ValueError(f"Unknown broker {broker!r}. Supported: {supported}.")
        return profile


_ENGINE: Optional[StatutoryFrictionEngine] = None


def get_engine() -> StatutoryFrictionEngine:
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = StatutoryFrictionEngine()
    return _ENGINE


def calculate_charges(
    segment: str, action: str, price: float, quantity: int,
    broker: str = "DHAN", is_intraday: bool = True,
) -> ChargeBreakdown:
    """Module-level convenience wrapper around the singleton engine."""
    return get_engine().calculate_charges(segment, action, price, quantity, broker, is_intraday)


def _demo_and_bench() -> None:
    engine = get_engine()
    print(f"StatutoryFrictionEngine v{__version__} | rate card {RATE_CARD_VERSION}")
    sample = engine.calculate_charges("EQUITY_INTRADAY", "BUY", 2450.50, 100, "DHAN")
    cover = sample.net_pnl_estimate(2451.40)
    print(
        f"Buy 100 @ 2450.50 -> charges Rs {sample.total_statutory_charges:.2f}, "
        f"breakeven {sample.breakeven_points:.2f} pts; exit @ 2451.40 net Rs {cover:.2f}"
    )
    orders = [
        {"segment": "OPTIONS", "action": "SELL", "price": 100.0 + i * 0.5, "quantity": 75}
        for i in range(100)
    ]
    best_us = float("inf")
    for _ in range(10):
        start = time.perf_counter()
        engine.calculate_batch(orders)
        elapsed = (time.perf_counter() - start) * 1_000_000.0
        best_us = min(best_us, elapsed)
    print(f"calculate_batch(100 orders): best {best_us:.1f} us/batch")
    start = time.perf_counter()
    for _ in range(10_000):
        engine.calculate_charges("OPTIONS", "SELL", 120.5, 75, "DHAN")
    per_call = (time.perf_counter() - start) / 10_000 * 1_000_000.0
    print(f"calculate_charges single call: {per_call:.1f} us/call")


if __name__ == "__main__":
    _demo_and_bench()
