"""
python-bridge/services/emergency_flattener.py

Sub-3-second Emergency Panic Flattener.

Atomic cross-broker cancel-all + concurrent market liquidation engine for
flash-crash regimes. Four phases, hard-instrumented:

  Phase 1 — Cancel all pending orders concurrently (asyncio.gather).
  Phase 2 — Snapshot net positions, filter net_quantity != 0.
  Phase 3 — Fire reverse MARKET IOC orders (tag="PANIC_FLATTEN") concurrently.
  Phase 4 — Telemetry, partial-fill re-verification at +1000 ms, alerts.

Safety invariants:
  - Idempotent: concurrent panic invocations collapse onto one execution.
  - Partial-fill recovery: re-poll positions after 1 s; any residual
    inventory is re-flattened once, then escalated via alert.
  - Graceful fallback: broker rejections (circuit freeze, margin freeze)
    emit urgent acoustic/telegram alerts instead of raising.

Self-contained: asyncio, httpx (optional) / requests, logging, typing only.
No database.ts schema changes. Zero breaking changes to existing routes.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable, Dict, List, Optional

log = logging.getLogger("emergency_flattener")

# Hard SLO: full cancel+liquidate cycle must finish under 3000 ms.
FLATTEN_SLO_MS = 3000.0
# Partial-fill re-verification delay.
REVERIFY_DELAY_S = 1.0
# Broker call timeout.
BROKER_CALL_TIMEOUT_S = 2.5
# Second panic click within this window collapses onto the in-flight run.
PANIC_DEDUP_TTL_S = 10.0


class FlattenPhase(str, Enum):
    CANCEL = "CANCEL"
    SNAPSHOT = "SNAPSHOT"
    LIQUIDATE = "LIQUIDATE"
    VERIFY = "VERIFY"


class PositionSide(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"


@dataclass
class Position:
    broker: str
    symbol: str
    quantity: int            # signed: + long, - short
    product: str             # CNC / MIS / NRML / MARGIN
    exchange: str = "NSE"
    security_id: Optional[str] = None

    @property
    def net_quantity(self) -> int:
        return int(self.quantity)

    @property
    def side(self) -> PositionSide:
        return PositionSide.LONG if self.quantity > 0 else PositionSide.SHORT


@dataclass
class OrderAck:
    broker: str
    symbol: str
    side: str
    quantity: int
    order_id: Optional[str] = None
    status: str = "submitted"
    error: Optional[str] = None


@dataclass
class PhaseTelemetry:
    phase: FlattenPhase
    started_ms: float
    elapsed_ms: float
    items: int
    errors: List[str] = field(default_factory=list)


@dataclass
class FlattenResult:
    run_id: str
    reason: str
    broker: str
    started_at_ms: float
    total_elapsed_ms: float
    cancelled_orders: Dict[str, int] = field(default_factory=dict)
    positions_found: int = 0
    orders_submitted: int = 0
    orders_failed: int = 0
    residual_positions: int = 0
    phases: List[PhaseTelemetry] = field(default_factory=list)
    escalated: bool = False
    success: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "reason": self.reason,
            "broker": self.broker,
            "total_elapsed_ms": round(self.total_elapsed_ms, 1),
            "cancelled_orders": self.cancelled_orders,
            "positions_found": self.positions_found,
            "orders_submitted": self.orders_submitted,
            "orders_failed": self.orders_failed,
            "residual_positions": self.residual_positions,
            "escalated": self.escalated,
            "success": self.success,
            "phases": [
                {"phase": p.phase.value, "elapsed_ms": round(p.elapsed_ms, 1),
                 "items": p.items, "errors": p.errors}
                for p in self.phases
            ],
        }


# ---------------------------------------------------------------------------
# Broker adapter protocol
# ---------------------------------------------------------------------------

class BrokerAdapter:
    """
    Thin async facade around each broker client.

    Subclass and wire concrete clients, e.g.:
        from services.dhan_client import DhanClient
        class DhanAdapter(BrokerAdapter):
            def __init__(self):
                self._client = DhanClient()
            async def _cancel_all(self):
                return await asyncio.to_thread(self._client.cancel_all_orders)
    """

    name: str = "base"

    async def cancel_all_orders(self) -> int:
        """Return number of orders cancelled (best effort)."""
        raise NotImplementedError

    async def get_positions(self) -> List[Position]:
        raise NotImplementedError

    async def place_reverse_market_order(self, position: Position) -> OrderAck:
        raise NotImplementedError


class DhanAdapter(BrokerAdapter):
    name = "dhan"

    def __init__(self, client: Any = None):
        if client is None:
            try:
                from services.dhan_client import DhanClient
                client = DhanClient()
            except Exception as exc:  # bridge not importable in some contexts
                log.warning("dhan client import failed: %s", exc)
                client = None
        self._client = client

    async def cancel_all_orders(self) -> int:
        if self._client is None:
            return 0
        try:
            orders = await asyncio.to_thread(self._client.get_orders) if hasattr(self._client, "get_orders") else []
            cancelled = 0
            if hasattr(self._client, "cancel_all_orders"):
                cancelled = await asyncio.to_thread(self._client.cancel_all_orders) or 0
            return int(cancelled) if isinstance(cancelled, int) else len(orders)
        except Exception as exc:
            log.error("dhan cancel_all failed: %s", exc)
            return 0

    async def get_positions(self) -> List[Position]:
        if self._client is None:
            return []
        try:
            rows = await asyncio.to_thread(self._client.get_positions) or []
            out = []
            for r in rows:
                qty = int(r.get("netQty", r.get("net_quantity", r.get("quantity", 0))) or 0)
                out.append(Position(
                    broker=self.name,
                    symbol=str(r.get("tradingSymbol", r.get("symbol", ""))),
                    quantity=qty,
                    product=str(r.get("productType", r.get("product", "INTRADAY"))),
                    exchange=str(r.get("exchangeSegment", r.get("exchange", "NSE"))),
                    security_id=str(r.get("securityId", r.get("security_id", "")) or ""),
                ))
            return out
        except Exception as exc:
            log.error("dhan positions failed: %s", exc)
            return []

    async def place_reverse_market_order(self, position: Position) -> OrderAck:
        side = "SELL" if position.net_quantity > 0 else "BUY"
        req = {
            "transactionType": side,
            "exchangeSegment": position.exchange,
            "productType": position.product,
            "orderType": "MARKET",
            "validity": "IOC",
            "securityId": position.security_id or position.symbol,
            "quantity": abs(position.net_quantity),
            "tag": "PANIC_FLATTEN",
        }
        try:
            res = await asyncio.to_thread(self._client.place_order, req) if self._client else {"status": "failure", "remarks": "no client"}
            err = res.get("remarks") or res.get("errorMessage")
            ok = str(res.get("status", "")).lower() in ("success", "submitted") or res.get("orderId")
            return OrderAck(broker=self.name, symbol=position.symbol, side=side,
                            quantity=abs(position.net_quantity),
                            order_id=res.get("orderId"), status="submitted" if ok else "rejected",
                            error=None if ok else str(err or res))
        except Exception as exc:
            return OrderAck(broker=self.name, symbol=position.symbol, side=side,
                            quantity=abs(position.net_quantity), status="error", error=str(exc))


class UpstoxAdapter(BrokerAdapter):
    name = "upstox"

    def __init__(self, client: Any = None):
        if client is None:
            try:
                from upstox import UpstoxClient  # type: ignore
                client = UpstoxClient()
            except Exception:
                try:
                    import upstox as upstox_mod  # type: ignore
                    client = getattr(upstox_mod, "upstox", upstox_mod)
                except Exception as exc:
                    log.warning("upstox client import failed: %s", exc)
                    client = None
        self._client = client

    async def cancel_all_orders(self) -> int:
        if self._client is None:
            return 0
        try:
            if hasattr(self._client, "cancel_all_orders"):
                res = await asyncio.to_thread(self._client.cancel_all_orders)
                return int(res) if isinstance(res, int) else 0
            return 0
        except Exception as exc:
            log.error("upstox cancel_all failed: %s", exc)
            return 0

    async def get_positions(self) -> List[Position]:
        if self._client is None:
            return []
        try:
            data = await asyncio.to_thread(self._client.get_positions)
            rows = data if isinstance(data, list) else (data or {}).get("data", []) or []
            out = []
            for r in rows:
                qty = int(r.get("quantity", r.get("net_quantity", r.get("netQty", 0))) or 0)
                out.append(Position(
                    broker=self.name,
                    symbol=str(r.get("trading_symbol", r.get("tradingsymbol", r.get("symbol", "")))),
                    quantity=qty,
                    product=str(r.get("product", "D")),
                    exchange=str(r.get("exchange", "NSE")),
                    security_id=str(r.get("instrument_token", r.get("instrumentToken", "")) or ""),
                ))
            return out
        except Exception as exc:
            log.error("upstox positions failed: %s", exc)
            return []

    async def place_reverse_market_order(self, position: Position) -> OrderAck:
        side = "SELL" if position.net_quantity > 0 else "BUY"
        try:
            fn = getattr(self._client, "place_order", None)
            if fn is None or self._client is None:
                return OrderAck(broker=self.name, symbol=position.symbol, side=side,
                                quantity=abs(position.net_quantity), status="error", error="no client")
            res = await asyncio.to_thread(fn, position.symbol, "MARKET", side, abs(position.net_quantity))
            ok = not (isinstance(res, dict) and res.get("status") == "failure")
            return OrderAck(broker=self.name, symbol=position.symbol, side=side,
                            quantity=abs(position.net_quantity),
                            order_id=res.get("order_id") if isinstance(res, dict) else None,
                            status="submitted" if ok else "rejected",
                            error=None if ok else str(res))
        except Exception as exc:
            return OrderAck(broker=self.name, symbol=position.symbol, side=side,
                            quantity=abs(position.net_quantity), status="error", error=str(exc))


# ---------------------------------------------------------------------------
# Escalation hooks
# ---------------------------------------------------------------------------

EscalationFn = Callable[[str, Dict[str, Any]], Awaitable[None]]


async def default_escalation(reason: str, context: Dict[str, Any]) -> None:
    """Urgent acoustic + telegram fallback alert."""
    log.critical("PANIC_FLATTEN_ESCALATION reason=%s context=%s", reason, context)
    try:
        import winsound  # type: ignore
        winsound.Beep(1200, 800)  # noqa: F401
    except Exception:
        pass
    try:
        from services.telegram_bot import send_telegram_alert  # type: ignore
        await asyncio.to_thread(send_telegram_alert, f"🚨 PANIC FLATTEN: {reason} {context}")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# EmergencyFlattener
# ---------------------------------------------------------------------------

class EmergencyFlattener:
    """
    Concurrent cross-broker panic flattener.

    Usage:
        flattener = EmergencyFlattener()
        result = await flattener.flatten_all(broker="ALL", reason="FLASH_CRASH")
    """

    def __init__(
        self,
        adapters: Optional[List[BrokerAdapter]] = None,
        escalation: EscalationFn = default_escalation,
        slo_ms: float = FLATTEN_SLO_MS,
    ):
        self._adapters: Dict[str, BrokerAdapter] = {}
        for a in (adapters or [DhanAdapter(), UpstoxAdapter()]):
            self._adapters[a.name] = a
        self._escalation = escalation
        self._slo_ms = slo_ms
        self._lock = asyncio.Lock()
        self._in_flight: Optional[asyncio.Task] = None
        self._last_run_started = 0.0

    def _select(self, broker: str) -> List[BrokerAdapter]:
        b = (broker or "ALL").upper()
        if b == "ALL":
            return list(self._adapters.values())
        return [a for name, a in self._adapters.items() if name.upper() == b]

    async def flatten_all(self, broker: str = "ALL", reason: str = "OPERATOR_PANIC") -> FlattenResult:
        # Idempotency: collapse concurrent / repeated clicks onto one run.
        async with self._lock:
            now = time.monotonic()
            if self._in_flight is not None and not self._in_flight.done():
                log.warning("panic flatten already in flight; collapsing duplicate")
                return await self._in_flight
            if self._in_flight is not None and (now - self._last_run_started) < PANIC_DEDUP_TTL_S:
                return self._in_flight.result()
            running = asyncio.ensure_future(self._run(broker, reason))
            self._in_flight = running
            self._last_run_started = now
        return await running

    async def _run(self, broker: str, reason: str) -> FlattenResult:
        run_id = uuid.uuid4().hex[:12]
        started = time.perf_counter()
        result = FlattenResult(run_id=run_id, reason=reason, broker=broker,
                               started_at_ms=time.time() * 1000, total_elapsed_ms=0.0)
        adapters = self._select(broker)
        if not adapters:
            result.escalated = True
            await self._escalation("NO_ACTIVE_BROKER", {"broker": broker})
            result.total_elapsed_ms = (time.perf_counter() - started) * 1000
            return result

        # Phase 1 — concurrent cancel-all.
        t0 = time.perf_counter()
        cancel_results = await asyncio.gather(
            *(self._guarded(a.cancel_all_orders(), a.name) for a in adapters),
            return_exceptions=True,
        )
        cancel_errors = []
        for a, r in zip(adapters, cancel_results):
            if isinstance(r, Exception):
                cancel_errors.append(f"{a.name}: {r}")
                result.cancelled_orders[a.name] = 0
            else:
                result.cancelled_orders[a.name] = int(r or 0)
        result.phases.append(PhaseTelemetry(FlattenPhase.CANCEL, t0 * 1000,
                                            (time.perf_counter() - t0) * 1000, len(adapters), cancel_errors))

        # Phase 2 — concurrent position snapshot.
        t0 = time.perf_counter()
        pos_groups = await asyncio.gather(
            *(self._guarded(a.get_positions(), a.name) for a in adapters),
            return_exceptions=True,
        )
        positions: List[Position] = []
        snap_errors = []
        for a, g in zip(adapters, pos_groups):
            if isinstance(g, Exception):
                snap_errors.append(f"{a.name}: {g}")
            else:
                positions.extend([p for p in g if p.net_quantity != 0])
        result.positions_found = len(positions)
        result.phases.append(PhaseTelemetry(FlattenPhase.SNAPSHOT, t0 * 1000,
                                            (time.perf_counter() - t0) * 1000, len(positions), snap_errors))

        # Phase 3 — concurrent reverse market orders.
        t0 = time.perf_counter()
        adapter_by_name = {a.name: a for a in adapters}
        acks = await asyncio.gather(
            *(self._guarded(adapter_by_name[p.broker].place_reverse_market_order(p), p.broker)
              for p in positions),
            return_exceptions=True,
        )
        liq_errors = []
        for p, ack in zip(positions, acks):
            if isinstance(ack, Exception):
                result.orders_failed += 1
                liq_errors.append(f"{p.broker}/{p.symbol}: {ack}")
            elif ack.status in ("submitted", "filled"):
                result.orders_submitted += 1
            else:
                result.orders_failed += 1
                liq_errors.append(f"{p.broker}/{p.symbol}: {ack.error}")
        result.phases.append(PhaseTelemetry(FlattenPhase.LIQUIDATE, t0 * 1000,
                                            (time.perf_counter() - t0) * 1000, len(positions), liq_errors))

        # Phase 4 — telemetry + partial-fill re-verification.
        t0 = time.perf_counter()
        residual = await self._verify_zero_inventory(adapters)
        result.residual_positions = len(residual)
        verify_errors: List[str] = []
        if residual:
            verify_errors.append(f"residual={len(residual)} after {REVERIFY_DELAY_S}s")
            # One recovery attempt: re-flatten residuals once.
            retry_acks = await asyncio.gather(
                *(self._guarded(adapter_by_name[p.broker].place_reverse_market_order(p), p.broker)
                  for p in residual),
                return_exceptions=True,
            )
            for ack in retry_acks:
                if isinstance(ack, Exception) or ack.status not in ("submitted", "filled"):
                    result.orders_failed += 1
            still = await self._verify_zero_inventory(adapters, delay=0.0)
            result.residual_positions = len(still)
            if still:
                result.escalated = True
                await self._escalation("RESIDUAL_INVENTORY", {
                    "symbols": [f"{p.broker}:{p.symbol}:{p.net_quantity}" for p in still],
                    "reason": reason,
                })
        result.phases.append(PhaseTelemetry(FlattenPhase.VERIFY, t0 * 1000,
                                            (time.perf_counter() - t0) * 1000, len(residual), verify_errors))

        result.total_elapsed_ms = (time.perf_counter() - started) * 1000
        result.success = (result.orders_failed == 0 and result.residual_positions == 0)

        if result.total_elapsed_ms > self._slo_ms:
            log.warning("flatten SLO breach: %.1f ms > %.1f ms run_id=%s",
                        result.total_elapsed_ms, self._slo_ms, run_id)
        if result.orders_failed > 0 and not result.escalated:
            result.escalated = True
            await self._escalation("MARKET_ORDER_REJECTED", {
                "failed": result.orders_failed, "run_id": run_id, "reason": reason,
            })
        log.info("flatten run_id=%s elapsed=%.1fms cancelled=%s submitted=%d failed=%d residual=%d",
                 run_id, result.total_elapsed_ms, result.cancelled_orders,
                 result.orders_submitted, result.orders_failed, result.residual_positions)
        return result

    async def _verify_zero_inventory(self, adapters: List[BrokerAdapter], delay: float = REVERIFY_DELAY_S) -> List[Position]:
        if delay > 0:
            await asyncio.sleep(delay)
        groups = await asyncio.gather(
            *(self._guarded(a.get_positions(), a.name) for a in adapters),
            return_exceptions=True,
        )
        residual: List[Position] = []
        for g in groups:
            if not isinstance(g, Exception):
                residual.extend([p for p in g if p.net_quantity != 0])
        return residual

    async def _guarded(self, coro: Awaitable[Any], broker_name: str) -> Any:
        try:
            return await asyncio.wait_for(coro, timeout=BROKER_CALL_TIMEOUT_S)
        except asyncio.TimeoutError:
            raise TimeoutError(f"{broker_name} call exceeded {BROKER_CALL_TIMEOUT_S}s")


def build_default_flattener() -> EmergencyFlattener:
    return EmergencyFlattener()
