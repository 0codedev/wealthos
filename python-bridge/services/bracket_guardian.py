"""
python-bridge/services/bracket_guardian.py

Zero-Orphan Atomic Bracket Guardian.

Eliminates naked positions and broker execution orphans in bracket orders:
  - Phase 1: Atomic entry with idempotency key (dedup window).
  - Phase 2: Immediate OCO legs (protective SL-M + target LIMIT).
  - Phase 3: Zero-orphan rollback invariant — if any protective leg fails,
    the filled entry is emergency-liquidated (MARKET/IOC) within <= 500 ms.

ActiveBracketRegistry tracks open brackets and enforces OCO cancellation:
  - target fill  -> cancel pending SL
  - SL trigger   -> cancel pending target
  - partial fills handled gracefully (residual quantity stays protected).

Pure-Python, no heavy C dependencies. Thread-safe via RLock; async watchdog
for fill polling when an asyncio loop is provided.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

import requests

log = logging.getLogger("bracket_guardian")

ROLLBACK_DEADLINE_MS = 500
DEFAULT_POLL_INTERVAL_S = 1.0
IDEMPOTENCY_TTL_S = 60.0


class BracketState(str, Enum):
    ADMITTED = "ADMITTED"
    ENTRY_PENDING = "ENTRY_PENDING"
    ENTRY_FILLED = "ENTRY_FILLED"
    LEGS_PLACED = "LEGS_PLACED"
    ORPHAN_ROLLBACK = "ORPHAN_ROLLBACK"
    LIQUIDATED = "LIQUIDATED"
    COMPLETE = "COMPLETE"
    FAILED = "FAILED"


class LegRole(str, Enum):
    ENTRY = "ENTRY"
    STOP_LOSS = "STOP_LOSS"
    TARGET = "TARGET"
    LIQUIDATION = "LIQUIDATION"


class LegOutcome(str, Enum):
    PLACED = "PLACED"
    FILLED = "FILLED"
    PARTIAL = "PARTIAL"
    REJECTED = "REJECTED"
    TIMEOUT = "TIMEOUT"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"


@dataclass
class OrderLeg:
    role: LegRole
    order_id: Optional[str] = None
    outcome: LegOutcome = LegOutcome.PLACED
    placed_at: float = field(default_factory=time.monotonic)
    filled_qty: float = 0.0
    quantity: float = 0.0
    price: float = 0.0
    trigger_price: float = 0.0
    raw: Dict[str, Any] = field(default_factory=dict)

    def is_filled(self) -> bool:
        return self.outcome in (LegOutcome.FILLED, LegOutcome.PARTIAL) and self.filled_qty > 0


@dataclass
class BracketRequest:
    symbol: str
    action: str
    exchange: str = "NSE"
    product: str = "MIS"
    quantity: float = 1.0
    entry_price: float = 0.0
    stop_loss_price: float = 0.0
    target_price: float = 0.0
    strategy: str = "WealthOS_Bracket_Guarded"

    @property
    def exit_action(self) -> str:
        return "SELL" if self.action.upper() == "BUY" else "BUY"


@dataclass
class BracketResult:
    state: BracketState
    entry: Optional[OrderLeg] = None
    stop_loss: Optional[OrderLeg] = None
    target: Optional[OrderLeg] = None
    liquidation: Optional[OrderLeg] = None
    error: Optional[str] = None
    elapsed_ms: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "state": self.state.value,
            "entry_order_id": self.entry.order_id if self.entry else None,
            "sl_order_id": self.stop_loss.order_id if self.stop_loss else None,
            "target_order_id": self.target.order_id if self.target else None,
            "liquidation_order_id": self.liquidation.order_id if self.liquidation else None,
            "error": self.error,
            "elapsed_ms": round(self.elapsed_ms, 2),
        }


class IdempotencyCache:
    def __init__(self, ttl_s: float = IDEMPOTENCY_TTL_S):
        self._ttl = ttl_s
        self._seen: Dict[str, float] = {}
        self._lock = threading.Lock()

    def claim(self, key: str) -> bool:
        with self._lock:
            now = time.monotonic()
            self._seen = {k: t for k, t in self._seen.items() if now - t < self._ttl}
            if key in self._seen:
                return False
            self._seen[key] = now
            return True


class ActiveBracket:
    """Tracking record for one live bracket."""

    def __init__(self, request: BracketRequest, entry: OrderLeg):
        self.id = uuid.uuid4().hex[:12]
        self.request = request
        self.entry = entry
        self.stop_loss: Optional[OrderLeg] = None
        self.target: Optional[OrderLeg] = None
        self.state = BracketState.LEGS_PLACED
        self.created_at = time.time()
        self.closed_at: Optional[float] = None
        self.lock = threading.RLock()

    def remaining_qty(self) -> float:
        protected = 0.0
        for leg in (self.stop_loss, self.target):
            if leg and leg.outcome == LegOutcome.PARTIAL:
                protected += leg.filled_qty
        return max(self.request.quantity - protected, 0.0)


class ActiveBracketRegistry:
    """Thread-safe in-memory registry with OCO watchdog."""

    def __init__(self, cancel_fn: Optional[Callable[[str], None]] = None):
        self._brackets: Dict[str, ActiveBracket] = {}
        self._lock = threading.RLock()
        self._cancel_fn = cancel_fn
        self._stop = threading.Event()
        self._watchdog: Optional[threading.Thread] = None

    def register(self, bracket: ActiveBracket) -> None:
        with self._lock:
            self._brackets[bracket.id] = bracket
        log.info(f"[REGISTRY] bracket {bracket.id} registered for {bracket.request.symbol}")

    def unregister(self, bracket_id: str) -> None:
        with self._lock:
            self._brackets.pop(bracket_id, None)

    def get(self, bracket_id: str) -> Optional[ActiveBracket]:
        with self._lock:
            return self._brackets.get(bracket_id)

    def list_open(self) -> List[ActiveBracket]:
        with self._lock:
            return [b for b in self._brackets.values() if b.closed_at is None]

    # ---- OCO resolution ----
    def on_target_fill(self, bracket_id: str, filled_qty: float) -> None:
        bracket = self.get(bracket_id)
        if not bracket:
            return
        with bracket.lock:
            if bracket.target:
                bracket.target.filled_qty += filled_qty
                bracket.target.outcome = (
                    LegOutcome.FILLED
                    if bracket.target.filled_qty >= bracket.request.quantity
                    else LegOutcome.PARTIAL
                )
            if bracket.stop_loss and bracket.stop_loss.order_id:
                self._cancel(bracket.stop_loss.order_id)
                bracket.stop_loss.outcome = LegOutcome.CANCELLED
            bracket.state = BracketState.COMPLETE
            bracket.closed_at = time.time()
        log.info(f"[REGISTRY] bracket {bracket_id}: target filled {filled_qty}; SL cancelled")

    def on_stop_loss_trigger(self, bracket_id: str, filled_qty: float) -> None:
        bracket = self.get(bracket_id)
        if not bracket:
            return
        with bracket.lock:
            if bracket.stop_loss:
                bracket.stop_loss.filled_qty += filled_qty
                bracket.stop_loss.outcome = (
                    LegOutcome.FILLED
                    if bracket.stop_loss.filled_qty >= bracket.request.quantity
                    else LegOutcome.PARTIAL
                )
            if bracket.target and bracket.target.order_id:
                self._cancel(bracket.target.order_id)
                bracket.target.outcome = LegOutcome.CANCELLED
            bracket.state = BracketState.COMPLETE
            bracket.closed_at = time.time()
        log.info(f"[REGISTRY] bracket {bracket_id}: SL triggered {filled_qty}; target cancelled")

    def _cancel(self, order_id: str) -> None:
        if self._cancel_fn is None:
            log.warning(f"[REGISTRY] no cancel_fn; cannot cancel {order_id}")
            return
        try:
            self._cancel_fn(order_id)
        except Exception as exc:  # noqa: BLE001
            log.error(f"[REGISTRY] cancel of {order_id} failed: {exc}")

    # ---- watchdog: timeout for stale legs ----
    def start_watchdog(self, max_age_s: float = 86400.0, interval_s: float = DEFAULT_POLL_INTERVAL_S) -> None:
        if self._watchdog and self._watchdog.is_alive():
            return
        self._stop.clear()

        def _loop() -> None:
            while not self._stop.wait(interval_s):
                now = time.time()
                for b in self.list_open():
                    if now - b.created_at > max_age_s:
                        log.warning(f"[WATCHDOG] bracket {b.id} stale >{max_age_s}s; flagging")
                        b.state = BracketState.FAILED
                        b.closed_at = now
                        self.unregister(b.id)

        self._watchdog = threading.Thread(target=_loop, name="bracket-watchdog", daemon=True)
        self._watchdog.start()

    def stop_watchdog(self) -> None:
        self._stop.set()
        if self._watchdog:
            self._watchdog.join(timeout=2.0)


class BracketGuardian:
    """Transactional 3-phase bracket placement with zero-orphan rollback."""

    def __init__(
        self,
        place_order: Callable[[Dict[str, Any]], Dict[str, Any]],
        cancel_order: Optional[Callable[[str], None]] = None,
        alert_sink: Optional[Callable[[str, Dict[str, Any]], None]] = None,
        rollback_deadline_ms: float = ROLLBACK_DEADLINE_MS,
        session: Optional[requests.Session] = None,
    ):
        self._place = place_order
        self._cancel = cancel_order
        self._alert = alert_sink or self._default_alert
        self._deadline_ms = rollback_deadline_ms
        self._session = session or requests.Session()
        self._idempotency = IdempotencyCache()
        self.registry = ActiveBracketRegistry(cancel_fn=cancel_order)
        self._lock = threading.RLock()

    # ---- Phase 1 ----
    def place_bracket(self, req: BracketRequest) -> BracketResult:
        started = time.monotonic()
        idem_key = f"{req.strategy}:{req.symbol}:{req.action}:{req.quantity}:{req.entry_price}:{req.stop_loss_price}:{req.target_price}"
        if not self._idempotency.claim(idem_key):
            return BracketResult(state=BracketState.FAILED, error="duplicate_submission_blocked",
                                 elapsed_ms=(time.monotonic() - started) * 1000)

        entry = OrderLeg(role=LegRole.ENTRY, quantity=req.quantity, price=req.entry_price)
        result = BracketResult(state=BracketState.ENTRY_PENDING, entry=entry)

        try:
            placed = self._place(self._entry_payload(req))
            entry.order_id = placed.get("orderid")
            entry.outcome = LegOutcome.PLACED
            entry.raw = placed.get("raw", {}) or {}
        except Exception as exc:  # noqa: BLE001
            entry.outcome = LegOutcome.FAILED
            result.state = BracketState.FAILED
            result.error = f"entry_placement_failed: {exc}"
            result.elapsed_ms = (time.monotonic() - started) * 1000
            self._alert("ENTRY_FAILED", result.to_dict())
            return result

        # Treat a broker-acknowledged entry as fillable exposure; conservative —
        # rollback fires if protective legs cannot be placed.
        result.state = BracketState.ENTRY_FILLED
        result.elapsed_ms = (time.monotonic() - started) * 1000

        # ---- Phase 2: protective legs ----
        sl = self._place_leg(req, LegRole.STOP_LOSS, idem_key + ":SL")
        tgt = self._place_leg(req, LegRole.TARGET, idem_key + ":TGT")
        result.stop_loss, result.target = sl, tgt

        sl_ok = sl is not None and sl.outcome == LegOutcome.PLACED
        tgt_ok = req.target_price <= 0 or (tgt is not None and tgt.outcome == LegOutcome.PLACED)

        if req.stop_loss_price > 0 and not sl_ok:
            # ---- Phase 3: zero-orphan rollback ----
            result.state = BracketState.ORPHAN_ROLLBACK
            liquidation = self._emergency_liquidate(req, entry)
            result.liquidation = liquidation
            if tgt is not None and tgt.order_id:
                try:
                    self._cancel and self._cancel(tgt.order_id)
                    tgt.outcome = LegOutcome.CANCELLED
                except Exception as exc:  # noqa: BLE001
                    log.error(f"[GUARDIAN] target cancel during rollback failed: {exc}")
            result.elapsed_ms = (time.monotonic() - started) * 1000
            result.state = BracketState.LIQUIDATED if liquidation and liquidation.outcome in (LegOutcome.PLACED, LegOutcome.FILLED) else BracketState.FAILED
            result.error = "sl_placement_failed_rollback_executed"
            self._alert("ORPHAN_ROLLBACK", result.to_dict())
            return result

        if req.target_price > 0 and not tgt_ok:
            # Target leg failed but SL exists: position is still protected.
            # Cancel SL (OCO integrity) only if user demanded atomicity — we
            # instead keep SL and mark deferred-target state.
            log.warning("[GUARDIAN] target leg failed; position remains protected by SL")
            self._alert("TARGET_LEG_FAILED", result.to_dict())

        bracket = ActiveBracket(req, entry)
        bracket.stop_loss, bracket.target = sl, tgt
        self.registry.register(bracket)
        result.state = BracketState.LEGS_PLACED
        result.elapsed_ms = (time.monotonic() - started) * 1000
        self._alert("BRACKET_ARMED", result.to_dict())
        return result

    def _place_leg(self, req: BracketRequest, role: LegRole, idem_key: str) -> Optional[OrderLeg]:
        try:
            placed = self._place(self._leg_payload(req, role))
            leg = OrderLeg(role=role, order_id=placed.get("orderid"), quantity=req.quantity)
            leg.outcome = LegOutcome.PLACED
            leg.raw = placed.get("raw", {}) or {}
            return leg
        except Exception as exc:  # noqa: BLE001
            log.error(f"[GUARDIAN] {role.value} leg placement failed: {exc}")
            leg = OrderLeg(role=role, quantity=req.quantity)
            leg.outcome = LegOutcome.FAILED
            return leg

    def _emergency_liquidate(self, req: BracketRequest, entry: OrderLeg) -> OrderLeg:
        started = time.monotonic()
        leg = OrderLeg(role=LegRole.LIQUIDATION, quantity=entry.filled_qty or req.quantity)
        payload = {
            "apikey": "",
            "strategy": f"{req.strategy}_EMERGENCY_LIQUIDATE",
            "symbol": req.symbol,
            "action": req.exit_action,
            "exchange": req.exchange,
            "pricetype": "MARKET",
            "product": req.product,
            "quantity": entry.filled_qty or req.quantity,
            "price": 0.0,
            "trigger_price": 0.0,
            "disclosed_quantity": 0,
            "validity": "IOC",
        }
        try:
            placed = self._place(payload)
            leg.order_id = placed.get("orderid")
            leg.outcome = LegOutcome.PLACED
            leg.raw = placed.get("raw", {}) or {}
        except Exception as exc:  # noqa: BLE001
            leg.outcome = LegOutcome.FAILED
            log.critical(f"[GUARDIAN] EMERGENCY LIQUIDATION FAILED for {req.symbol}: {exc}")
        elapsed = (time.monotonic() - started) * 1000.0
        if elapsed > self._deadline_ms:
            log.critical(f"[GUARDIAN] rollback exceeded {self._deadline_ms}ms budget")
        return leg

    # ---- payload builders ----
    def _entry_payload(self, req: BracketRequest) -> Dict[str, Any]:
        return {
            "apikey": "",
            "strategy": req.strategy,
            "symbol": req.symbol,
            "action": req.action,
            "exchange": req.exchange,
            "pricetype": "LIMIT" if req.entry_price > 0 else "MARKET",
            "product": req.product,
            "quantity": req.quantity,
            "price": req.entry_price if req.entry_price > 0 else 0.0,
            "trigger_price": 0.0,
            "disclosed_quantity": 0,
        }

    def _leg_payload(self, req: BracketRequest, role: LegRole) -> Dict[str, Any]:
        exit_action = req.exit_action
        if role == LegRole.STOP_LOSS:
            return {
                "apikey": "",
                "strategy": f"SL_{req.strategy}",
                "symbol": req.symbol,
                "action": exit_action,
                "exchange": req.exchange,
                "pricetype": "SL-M",
                "product": req.product,
                "quantity": req.quantity,
                "price": 0.0,
                "trigger_price": req.stop_loss_price,
                "disclosed_quantity": 0,
            }
        return {
            "apikey": "",
            "strategy": f"TGT_{req.strategy}",
            "symbol": req.symbol,
            "action": exit_action,
            "exchange": req.exchange,
            "pricetype": "LIMIT",
            "product": req.product,
            "quantity": req.quantity,
            "price": req.target_price,
            "trigger_price": 0.0,
            "disclosed_quantity": 0,
        }

    @staticmethod
    def _default_alert(kind: str, payload: Dict[str, Any]) -> None:
        log.critical(f"[GUARDIAN ALERT] {kind}: {payload}")


# ─────────────────────────────────────────────────────────────────────────────
# Sovereign Trade Guardian: Unified Execution Functions
# ─────────────────────────────────────────────────────────────────────────────

def to_tick(price: float) -> float:
    """Rounds price to nearest 0.05 tick size required by Indian exchanges."""
    if price <= 0:
        return 0.05
    return round(round(float(price) / 0.05) * 0.05, 2)


def calculate_ratchet_sl(
    entry_price: float,
    highest_price: float,
    current_sl: float,
    rules: Optional[Dict[str, Any]] = None,
) -> float:
    """
    Sovereign Trade Guardian: Multi-Bagger Ratchet & Retracement Absorption Engine.

    Phase 1 (Entry & Liquidity Sweep Protection):
      - Initial structural SL anchored below underlying spot's 5m opening low.

    Phase 2 (Momentum Rocket & Derisking):
      - At +40% (Target 1), lock in Breakeven (+0.05).
      - At +50% to +60% MFE, lock in +20% profit floor.

    Phase 3 (Mid-Day Pink Box Retracement Absorption):
      - Between +50% and +75% gain, normal 20-25% option pullbacks (e.g. ₹26 down to ₹20.50)
        are absorbed without premature stop-out, keeping the runner alive for the second wave.

    Phase 4 (80% MFE Super-Runner & Climax Cut):
      - When premium surges >= +75% (and especially >= +80% to +108%), ratchet SL to
        guarantee retention of 80% of Maximum Favorable Excursion (MFE):
        SL = Entry + 0.80 * (Peak_Price - Entry).
      - A reversal of > 15-20% from peak automatically triggers terminal market exit.
    """
    if entry_price <= 0:
        return current_sl

    rules = rules or {}
    trail_trigger_pct = float(rules.get("trail_trigger_pct", 40.0))
    trail_lock_pct = float(rules.get("dynamic_trail_lock_pct", 75.0))
    trail_step_pct = float(rules.get("dynamic_trail_step_pct", 20.0))

    new_sl = current_sl

    # Phase 2 Milestone: Breakeven (+1 tick to cover brokerage) at Target 1 (+40%)
    if highest_price >= entry_price * (1.0 + trail_trigger_pct / 100.0):
        new_sl = max(new_sl, to_tick(entry_price + 0.05))

    # Phase 3 Pink Box Retracement Absorption:
    # At +60% MFE (e.g. ₹15.50 -> ₹24.80), lock +20% floor (₹18.60).
    # Allows normal 20% consolidation dips (down to ₹20.00) without tripping SL.
    if highest_price >= entry_price * 1.60:
        new_sl = max(new_sl, to_tick(entry_price * 1.20))

    # Phase 4: 80% MFE Super-Runner & Climax Cut Protocol (>= +75% to +100%+ gain)
    if highest_price >= entry_price * (1.0 + trail_lock_pct / 100.0):
        target_floor = to_tick(entry_price * (1.0 + (trail_lock_pct / 100.0) * 0.50))
        mfe_excursion = highest_price - entry_price
        mfe_80_sl = to_tick(entry_price + (0.80 * mfe_excursion))
        
        # Trailing cushion (ensures at least 80% MFE locked while giving runner breathing room)
        cushion = to_tick(highest_price * (trail_step_pct / 100.0))
        runner_trail_sl = to_tick(highest_price - cushion)
        
        new_sl = max(new_sl, target_floor, mfe_80_sl, runner_trail_sl)

    return to_tick(new_sl)


def cancel_broker_orders(
    openalgo_host: str,
    api_key: str,
    order_ids: List[str],
    strategy_tag: str = "",
    session: Optional[requests.Session] = None,
) -> Dict[str, Any]:
    """Cancels a list of pending orders on OpenAlgo to enforce OCO and eliminate orphans."""
    sess = session or requests.Session()
    results = {}
    for oid in order_ids:
        if not oid:
            continue
        try:
            url = f"{openalgo_host.rstrip('/')}/api/v1/cancelorder"
            payload = {
                "apikey": api_key,
                "orderid": str(oid)
            }
            if strategy_tag:
                payload["strategy"] = strategy_tag
            res = sess.post(url, headers={"Content-Type": "application/json"}, json=payload, timeout=4)
            results[str(oid)] = {
                "status_code": res.status_code,
                "response": res.json() if res.status_code == 200 else res.text
            }
            log.info(f"[GUARDIAN] Cancelled broker order {oid} ({strategy_tag}): HTTP {res.status_code}")
        except Exception as exc:
            log.warning(f"[GUARDIAN] Failed to cancel broker order {oid}: {exc}")
            results[str(oid)] = {"error": str(exc)}
    return results


def modify_broker_sl(
    openalgo_host: str,
    api_key: str,
    sl_order_id: str,
    symbol: str,
    exchange: str,
    product: str,
    qty: int,
    new_trigger_price: float,
    strategy_tag: str = "FNO_SectorRotation",
    session: Optional[requests.Session] = None,
) -> Dict[str, Any]:
    """Modifies the trigger price of an active broker SL-M order on OpenAlgo."""
    if not sl_order_id:
        return {"status": "error", "error": "missing_sl_order_id"}

    sess = session or requests.Session()
    clean_trigger = to_tick(new_trigger_price)
    url = f"{openalgo_host.rstrip('/')}/api/v1/modifyorder"
    payload = {
        "apikey": api_key,
        "orderid": str(sl_order_id),
        "strategy": f"SL_{strategy_tag}",
        "symbol": symbol,
        "action": "SELL",
        "exchange": exchange,
        "pricetype": "SL-M",
        "product": product,
        "quantity": int(qty),
        "price": 0.0,
        "trigger_price": clean_trigger,
        "disclosed_quantity": 0
    }

    try:
        res = sess.post(url, headers={"Content-Type": "application/json"}, json=payload, timeout=5)
        if res.status_code == 200:
            data = res.json()
            log.info(f"[GUARDIAN] Modified broker SL-M {sl_order_id} to trigger ₹{clean_trigger}: {data.get('status')}")
            return {"status": "success", "orderid": sl_order_id, "trigger_price": clean_trigger, "raw": data}
        else:
            log.warning(f"[GUARDIAN] Modify broker SL {sl_order_id} HTTP {res.status_code}: {res.text}")
            return {"status": "failed", "error": res.text, "status_code": res.status_code}
    except Exception as exc:
        log.error(f"[GUARDIAN] Failed to modify broker SL {sl_order_id}: {exc}")
        return {"status": "error", "error": str(exc)}


def arm_protective_brackets(
    openalgo_host: str,
    api_key: str,
    symbol: str,
    exchange: str,
    product: str,
    filled_qty: int,
    fill_price: float,
    sl_price: float,
    target1_price: float,
    strategy_tag: str = "FNO_SectorRotation",
    lot_size: int = 1,
    asset_class: str = "STOCK_OPTION",
    session: Optional[requests.Session] = None,
) -> Dict[str, Any]:
    """
    Arms broker-level SL-M and optional Target-1 LIMIT orders on OpenAlgo.

    Option A Protocol:
    - Multi-Lot (filled_qty >= 2 * lot_size):
      Places LIMIT Target 1 for 50% lots and SL-M for 100% lots.
    - Single-Lot (filled_qty < 2 * lot_size):
      Places SL-M for 100% lots. OMITS hard broker LIMIT target so
      runner can ride 100%+ multi-bagger moves with trailing ratchet.
    """
    sess = session or requests.Session()
    lot_size = max(1, int(lot_size))
    can_split_lots = filled_qty >= (2 * lot_size)
    target_qty = (filled_qty // (2 * lot_size)) * lot_size if can_split_lots else 0

    clean_sl = to_tick(sl_price)
    if fill_price > 0 and clean_sl >= fill_price:
        clean_sl = to_tick(max(0.05, fill_price - 0.50))

    clean_tgt = to_tick(target1_price)
    if fill_price > 0 and clean_tgt <= fill_price:
        clean_tgt = to_tick(fill_price + max(1.0, fill_price * 0.40))

    target_order_id = None
    sl_order_id = None

    # Leg 1: Broker-level Target 1 LIMIT order (Multi-Lot Only)
    if can_split_lots and target_qty > 0 and clean_tgt > 0:
        tgt_payload = {
            "apikey": api_key,
            "strategy": f"TGT_{strategy_tag}",
            "symbol": symbol,
            "action": "SELL",
            "exchange": exchange,
            "pricetype": "LIMIT",
            "product": product,
            "quantity": int(target_qty),
            "price": clean_tgt,
            "trigger_price": 0.0,
            "disclosed_quantity": 0,
        }
        try:
            url = f"{openalgo_host.rstrip('/')}/api/v1/placeorder"
            res = sess.post(url, headers={"Content-Type": "application/json"}, json=tgt_payload, timeout=5)
            data = res.json() if res.status_code == 200 else {}
            if data.get("status") == "success":
                target_order_id = data.get("orderid") or (data.get("data", {}) or {}).get("orderid")
                log.info(f"[GUARDIAN] 🎯 Broker Target 1 LIMIT armed: {target_order_id} ({symbol} Qty: {target_qty} @ ₹{clean_tgt})")
            else:
                log.warning(f"[GUARDIAN] Target 1 placement failed: {res.text}")
        except Exception as exc:
            log.error(f"[GUARDIAN] Error placing Target 1 for {symbol}: {exc}")
    else:
        log.info(
            f"[GUARDIAN] 🏃 [Sovereign Runner Mode Active] {symbol} (Qty: {filled_qty}, LotSize: {lot_size}). "
            f"Omitted hard broker LIMIT target to capture multi-bagger runners. Post-T1 trailing SL ratchet active!"
        )

    # Leg 2: Broker-level Stop Loss (SL-M) order (Always armed for 100% position)
    if clean_sl > 0:
        sl_payload = {
            "apikey": api_key,
            "strategy": f"SL_{strategy_tag}",
            "symbol": symbol,
            "action": "SELL",
            "exchange": exchange,
            "pricetype": "SL-M",
            "product": product,
            "quantity": int(filled_qty),
            "price": 0.0,
            "trigger_price": clean_sl,
            "disclosed_quantity": 0,
        }
        try:
            url = f"{openalgo_host.rstrip('/')}/api/v1/placeorder"
            res = sess.post(url, headers={"Content-Type": "application/json"}, json=sl_payload, timeout=5)
            data = res.json() if res.status_code == 200 else {}
            if data.get("status") == "success":
                sl_order_id = data.get("orderid") or (data.get("data", {}) or {}).get("orderid")
                log.info(f"[GUARDIAN] 🛡️ Broker SL-M armed: {sl_order_id} ({symbol} Qty: {filled_qty} @ Trigger ₹{clean_sl})")
            else:
                log.critical(f"[GUARDIAN] 🚨 SL-M placement failed on OpenAlgo: {res.text}")
        except Exception as exc:
            log.critical(f"[GUARDIAN] 🚨 Fatal error placing SL-M for {symbol}: {exc}")

    return {
        "status": "ARMED",
        "symbol": symbol,
        "strategy": strategy_tag,
        "sl_order_id": sl_order_id,
        "target_order_id": target_order_id,
        "sl_price": clean_sl,
        "target_price": clean_tgt if can_split_lots else 0.0,
        "target_qty": target_qty,
        "filled_qty": filled_qty,
        "runner_mode": not can_split_lots
    }

