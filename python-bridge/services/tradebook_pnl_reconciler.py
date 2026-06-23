"""
Tradebook P&L Reconciler & Truth Sentry — Domain 112.

End-of-day multi-broker tradebook audit, paisa-level reconciliation of
Gross P&L, statutory charges, and Net Realized P&L between WealthOS's
internal trade ledger (IndexedDB / SQLite) and the broker's official
cleared tradebook (DhanHQ `/tradebook`, Upstox `/trades`).

Self-contained: pure Python standard library only.
No FastAPI route changes. No Dexie schema changes (frozen at v50).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("tradebook_pnl_reconciler")

# ---------------------------------------------------------------------------
# Thresholds (governance-fixed; do not loosen without a compliance ticket)
# ---------------------------------------------------------------------------
PNL_VARIANCE_ALERT_INR = 1.00          # flag any net P&L variance > ₹1.00
SLIPPAGE_ANOMALY_PCT = 0.005           # fill vs trigger deviated > 0.5%
FEE_MISMATCH_ALERT_INR = 5.00          # statutory charge variance > ₹5.00
FILL_PRICE_TOLERANCE_PCT = 0.0025      # 0.25% avg fill price tolerance


class FlagCode(str, Enum):
    FLAG_ORPHAN_BROKER_EXECUTION = "FLAG_ORPHAN_BROKER_EXECUTION"
    FLAG_ORPHAN_INTERNAL_RECORD = "FLAG_ORPHAN_INTERNAL_RECORD"
    FLAG_SLIPPAGE_ANOMALY = "FLAG_SLIPPAGE_ANOMALY"
    FLAG_FEE_MISMATCH = "FLAG_FEE_MISMATCH"
    FLAG_QTY_MISMATCH = "FLAG_QTY_MISMATCH"
    FLAG_FILL_PRICE_MISMATCH = "FLAG_FILL_PRICE_MISMATCH"
    FLAG_PNL_VARIANCE_THRESHOLD = "FLAG_PNL_VARIANCE_THRESHOLD"


class Severity(str, Enum):
    INFO = "INFO"
    WARN = "WARN"
    CRITICAL = "CRITICAL"


@dataclass(frozen=True)
class AnomalyFlag:
    code: FlagCode
    severity: Severity
    order_id: Optional[str]
    symbol: Optional[str]
    detail: str
    variance_inr: Optional[float] = None


@dataclass
class TradeFill:
    """Normalized single-fill view used internally regardless of source."""
    order_id: str
    exchange_trade_id: Optional[str]
    symbol: str
    side: str                      # BUY / SELL
    quantity: int
    avg_fill_price: float
    trigger_price: Optional[float]
    gross_pnl: float
    statutory_charges: float
    net_pnl: float
    exchange: Optional[str] = None
    trade_time: Optional[str] = None

    @property
    def key(self) -> str:
        return self.order_id or (self.exchange_trade_id or "")


@dataclass
class ReconciliationReport:
    session_date: str
    generated_at: str
    broker_trade_count: int
    internal_trade_count: int
    matched_count: int
    orphan_broker: List[TradeFill] = field(default_factory=list)
    orphan_internal: List[TradeFill] = field(default_factory=list)
    broker_gross_pnl: float = 0.0
    internal_gross_pnl: float = 0.0
    broker_charges: float = 0.0
    internal_charges: float = 0.0
    broker_net_pnl: float = 0.0
    internal_net_pnl: float = 0.0
    net_pnl_variance: float = 0.0
    flags: List[AnomalyFlag] = field(default_factory=list)

    @property
    def is_clean(self) -> bool:
        return not self.flags and abs(self.net_pnl_variance) <= PNL_VARIANCE_ALERT_INR


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


class TradebookReconciler:
    """Reconciles WealthOS internal ledger against the broker tradebook."""

    # -- normalization -------------------------------------------------
    @staticmethod
    def _normalize(raw: Dict[str, Any], source: str) -> TradeFill:
        """Accepts DhanHQ, Upstox, or WealthOS internal shapes; returns TradeFill."""
        order_id = str(
            raw.get("orderId") or raw.get("order_id") or raw.get("orderNo")
            or raw.get("OrderNo") or raw.get("id") or ""
        )
        exch_trade_id = raw.get("exchangeTradeId") or raw.get("exchange_trade_id") \
            or raw.get("tradeId") or raw.get("trade_id")
        symbol = str(
            raw.get("tradingSymbol") or raw.get("trading_symbol")
            or raw.get("symbol") or raw.get("Symbol") or "UNKNOWN"
        )
        side_raw = str(
            raw.get("transactionType") or raw.get("side") or raw.get("transaction_type")
            or raw.get("TransactionType") or ""
        ).upper()
        side = "BUY" if side_raw in ("BUY", "B") else "SELL" if side_raw in ("SELL", "S") else side_raw
        qty = _to_int(raw.get("tradedQty") or raw.get("traded_qty") or raw.get("quantity") or raw.get("qty"))
        avg_price = _to_float(
            raw.get("tradedPrice") or raw.get("traded_price")
            or raw.get("averagePrice") or raw.get("average_price")
            or raw.get("price") or raw.get("avg_fill_price")
        )
        trigger = raw.get("triggerPrice") or raw.get("trigger_price") \
            or raw.get("stopPrice") or raw.get("trigger")
        gross = _to_float(raw.get("grossPnl") or raw.get("gross_pnl") or raw.get("grossProfit"))
        charges = _to_float(
            raw.get("charges") or raw.get("totalCharges") or raw.get("total_charges")
            or raw.get("statutoryCharges") or raw.get("deductedCharges")
        )
        net = _to_float(raw.get("netPnl") or raw.get("net_pnl") or raw.get("realizedPnl"))
        if net == 0.0 and (gross != 0.0 or charges != 0.0):
            net = gross - charges
        return TradeFill(
            order_id=order_id,
            exchange_trade_id=str(exch_trade_id) if exch_trade_id is not None else None,
            symbol=symbol,
            side=side,
            quantity=qty,
            avg_fill_price=avg_price,
            trigger_price=_to_float(trigger) if trigger not in (None, "", 0, "0") else None,
            gross_pnl=gross,
            statutory_charges=charges,
            net_pnl=net,
            exchange=raw.get("exchangeSegment") or raw.get("exchange") or raw.get("segment"),
            trade_time=str(raw.get("updateTime") or raw.get("trade_time") or raw.get("timestamp") or "") or None,
        )

    # -- per-fill anomaly checks ----------------------------------------
    def _check_fill_anomalies(self, broker: TradeFill, internal: Optional[TradeFill]) -> List[AnomalyFlag]:
        flags: List[AnomalyFlag] = []
        # Slippage: fill vs trigger > 0.5%
        if broker.trigger_price and broker.trigger_price > 0 and broker.avg_fill_price > 0:
            slip = abs(broker.avg_fill_price - broker.trigger_price) / broker.trigger_price
            if slip > SLIPPAGE_ANOMALY_PCT:
                flags.append(AnomalyFlag(
                    code=FlagCode.FLAG_SLIPPAGE_ANOMALY,
                    severity=Severity.WARN,
                    order_id=broker.order_id,
                    symbol=broker.symbol,
                    detail=(
                        f"Fill {broker.avg_fill_price:.2f} deviates "
                        f"{slip * 100:.2f}% from trigger {broker.trigger_price:.2f}"
                    ),
                    variance_inr=abs(broker.avg_fill_price - broker.trigger_price) * max(broker.quantity, 0),
                ))
        if internal is not None:
            # Quantity mismatch
            if broker.quantity != internal.quantity:
                flags.append(AnomalyFlag(
                    code=FlagCode.FLAG_QTY_MISMATCH,
                    severity=Severity.CRITICAL,
                    order_id=broker.order_id,
                    symbol=broker.symbol,
                    detail=f"Broker qty {broker.quantity} vs internal qty {internal.quantity}",
                ))
            # Avg fill price mismatch beyond 0.25%
            if internal.avg_fill_price > 0 and broker.avg_fill_price > 0:
                dev = abs(broker.avg_fill_price - internal.avg_fill_price) / internal.avg_fill_price
                if dev > FILL_PRICE_TOLERANCE_PCT:
                    flags.append(AnomalyFlag(
                        code=FlagCode.FLAG_FILL_PRICE_MISMATCH,
                        severity=Severity.WARN,
                        order_id=broker.order_id,
                        symbol=broker.symbol,
                        detail=(
                            f"Broker avg {broker.avg_fill_price:.2f} vs internal "
                            f"{internal.avg_fill_price:.2f} ({dev * 100:.2f}%)"
                        ),
                        variance_inr=abs(broker.avg_fill_price - internal.avg_fill_price) * max(broker.quantity, 0),
                    ))
            # Statutory charge mismatch > ₹5.00
            fee_delta = broker.statutory_charges - internal.statutory_charges
            if abs(fee_delta) > FEE_MISMATCH_ALERT_INR:
                flags.append(AnomalyFlag(
                    code=FlagCode.FLAG_FEE_MISMATCH,
                    severity=Severity.WARN,
                    order_id=broker.order_id,
                    symbol=broker.symbol,
                    detail=(
                        f"Broker charges ₹{broker.statutory_charges:.2f} vs internal "
                        f"₹{internal.statutory_charges:.2f}"
                    ),
                    variance_inr=round(fee_delta, 2),
                ))
        return flags

    # -- main entry ------------------------------------------------------
    def reconcile_session(
        self,
        broker_trades: List[Dict[str, Any]],
        internal_trades: List[Dict[str, Any]],
        session_date: Optional[str] = None,
    ) -> ReconciliationReport:
        session_date = session_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        brokers = [self._normalize(t, "broker") for t in broker_trades or []]
        internals = [self._normalize(t, "internal") for t in internal_trades or []]

        broker_by_oid: Dict[str, TradeFill] = {}
        for b in brokers:
            broker_by_oid.setdefault(b.key, b)
        internal_by_oid: Dict[str, TradeFill] = {}
        for it in internals:
            internal_by_oid.setdefault(it.key, it)

        report = ReconciliationReport(
            session_date=session_date,
            generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            broker_trade_count=len(brokers),
            internal_trade_count=len(internals),
            matched_count=0,
        )

        flags: List[AnomalyFlag] = []

        # Broker-side scan: matches, orphans, per-fill anomalies
        for key, b in broker_by_oid.items():
            it = internal_by_oid.get(key)
            if it is None:
                report.orphan_broker.append(b)
                flags.append(AnomalyFlag(
                    code=FlagCode.FLAG_ORPHAN_BROKER_EXECUTION,
                    severity=Severity.CRITICAL,
                    order_id=b.order_id,
                    symbol=b.symbol,
                    detail=f"Broker execution {b.symbol} {b.side} x{b.quantity} @ {b.avg_fill_price:.2f} missing in WealthOS",
                    variance_inr=b.net_pnl,
                ))
            else:
                report.matched_count += 1
            flags.extend(self._check_fill_anomalies(b, it))

        # Internal-side scan: orphans (dropped webhook events / manual entries)
        for key, it in internal_by_oid.items():
            if key not in broker_by_oid:
                report.orphan_internal.append(it)
                flags.append(AnomalyFlag(
                    code=FlagCode.FLAG_ORPHAN_INTERNAL_RECORD,
                    severity=Severity.WARN,
                    order_id=it.order_id,
                    symbol=it.symbol,
                    detail=f"Internal record {it.symbol} {it.side} x{it.quantity} not present in broker tradebook",
                    variance_inr=it.net_pnl,
                ))

        # Aggregate P&L
        report.broker_gross_pnl = round(sum(b.gross_pnl for b in brokers), 2)
        report.internal_gross_pnl = round(sum(t.gross_pnl for t in internals), 2)
        report.broker_charges = round(sum(b.statutory_charges for b in brokers), 2)
        report.internal_charges = round(sum(t.statutory_charges for t in internals), 2)
        report.broker_net_pnl = round(sum(b.net_pnl for b in brokers), 2)
        report.internal_net_pnl = round(sum(t.net_pnl for t in internals), 2)
        report.net_pnl_variance = round(report.broker_net_pnl - report.internal_net_pnl, 2)

        if abs(report.net_pnl_variance) > PNL_VARIANCE_ALERT_INR:
            flags.append(AnomalyFlag(
                code=FlagCode.FLAG_PNL_VARIANCE_THRESHOLD,
                severity=Severity.CRITICAL,
                order_id=None,
                symbol=None,
                detail=(
                    f"Net P&L variance ₹{report.net_pnl_variance:.2f} exceeds "
                    f"₹{PNL_VARIANCE_ALERT_INR:.2f} tolerance"
                ),
                variance_inr=report.net_pnl_variance,
            ))

        report.flags = flags
        logger.info(
            "reconcile_session %s: broker=%d internal=%d matched=%d orphans(broker/internal)=%d/%d "
            "net_variance=₹%.2f flags=%d",
            session_date, len(brokers), len(internals), report.matched_count,
            len(report.orphan_broker), len(report.orphan_internal),
            report.net_pnl_variance, len(flags),
        )
        return report

    # -- UI summary --------------------------------------------------------
    def generate_eod_reconciliation_summary(self, report: ReconciliationReport) -> Dict[str, Any]:
        return {
            "sessionDate": report.session_date,
            "generatedAt": report.generated_at,
            "status": "CLEAN" if report.is_clean else "DISCREPANCY",
            "tradeCounts": {
                "broker": report.broker_trade_count,
                "internal": report.internal_trade_count,
                "matched": report.matched_count,
                "orphanBroker": len(report.orphan_broker),
                "orphanInternal": len(report.orphan_internal),
            },
            "pnl": {
                "brokerGross": report.broker_gross_pnl,
                "internalGross": report.internal_gross_pnl,
                "brokerCharges": report.broker_charges,
                "internalCharges": report.internal_charges,
                "brokerNet": report.broker_net_pnl,
                "internalNet": report.internal_net_pnl,
                "netVariance": report.net_pnl_variance,
            },
            "flags": [
                {
                    "code": f.code.value,
                    "severity": f.severity.value,
                    "orderId": f.order_id,
                    "symbol": f.symbol,
                    "detail": f.detail,
                    "varianceInr": f.variance_inr,
                }
                for f in report.flags
            ],
            "telegramDigest": self._telegram_digest(report),
        }

    @staticmethod
    def _telegram_digest(report: ReconciliationReport) -> str:
        icon = "✅" if report.is_clean else "🚨"
        lines = [
            f"{icon} EOD Tradebook Reconciliation — {report.session_date}",
            f"Matched {report.matched_count}/{report.broker_trade_count} broker fills",
            f"Net P&L variance: ₹{report.net_pnl_variance:+.2f}",
            f"Orphans: broker {len(report.orphan_broker)} / internal {len(report.orphan_internal)}",
            f"Flags: {len(report.flags)}",
        ]
        for f in report.flags[:5]:
            lines.append(f"• [{f.severity.value}] {f.code.value}: {f.detail}")
        if len(report.flags) > 5:
            lines.append(f"… and {len(report.flags) - 5} more")
        return "\n".join(lines)


_DEFAULT_RECONCILER = TradebookReconciler()


def reconcile_session(broker_trades: List[Dict[str, Any]], internal_trades: List[Dict[str, Any]],
                      session_date: Optional[str] = None) -> ReconciliationReport:
    return _DEFAULT_RECONCILER.reconcile_session(broker_trades, internal_trades, session_date)


def generate_eod_reconciliation_summary(report: ReconciliationReport) -> Dict[str, Any]:
    return _DEFAULT_RECONCILER.generate_eod_reconciliation_summary(report)
