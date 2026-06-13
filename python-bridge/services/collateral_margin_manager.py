"""python-bridge/services/collateral_margin_manager.py — SEBI 50:50 Collateral & Margin Manager.

Tracks cash-vs-collateral compliance for pledged-margin (GOAT) workflows:
  * Haircut computation matrix (Cash eq 10%, Bluechips 20%, Midcaps 35%,
    plus conservative defaults for other asset classes).
  * Usable margin = qty * LTP * (1 - haircut).
  * SEBI 50:50 auditor: cash_component / total_margin_required must be >= 50%.
  * Margin-call defense buffer trigger at 55% (cash ratio < 55% OR
    margin utilization >= 55%, depending on the caller's framing).
  * Defense actions: alert, propose trimming the tested wing, block new shorts.
  * Broker fund/holding ingestion (Dhan, Upstox, OpenAlgo) with graceful
    degradation when a broker is unreachable.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
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

log = get_logger("collateral_margin_manager", tag="COLLATERAL")


class AssetClass(str, Enum):
    CASH = "cash"
    CASH_EQ = "cash_eq"
    LIQUID = "liquid"
    BLUECHIP = "bluechip"
    ETF = "etf"
    MIDCAP = "midcap"
    SMALLCAP = "smallcap"
    UNKNOWN = "unknown"


# Haircut matrix (fraction of value deducted). Defaults align with the task spec:
# Cash eq 10%, Bluechips 20%, Midcaps 35%. Conservative extensions added.
DEFAULT_HAIRCUTS: Dict[str, float] = {
    AssetClass.CASH.value: 0.00,
    AssetClass.CASH_EQ.value: 0.10,
    AssetClass.LIQUID.value: 0.10,
    AssetClass.BLUECHIP.value: 0.20,
    AssetClass.ETF.value: 0.20,
    AssetClass.MIDCAP.value: 0.35,
    AssetClass.SMALLCAP.value: 0.50,
    AssetClass.UNKNOWN.value: 0.50,
}

CASH_LIKE_CLASSES = {AssetClass.CASH.value, AssetClass.CASH_EQ.value, AssetClass.LIQUID.value}


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value)


def normalize_asset_class(value: Any) -> str:
    """Coerce arbitrary input into a known AssetClass value."""
    if isinstance(value, AssetClass):
        return value.value
    s = _safe_str(value).strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "cash": AssetClass.CASH.value,
        "cash_equivalent": AssetClass.CASH_EQ.value,
        "cash_eq": AssetClass.CASH_EQ.value,
        "liquid": AssetClass.LIQUID.value,
        "liquid_fund": AssetClass.LIQUID.value,
        "liquidbees": AssetClass.LIQUID.value,
        "bluechip": AssetClass.BLUECHIP.value,
        "blue_chips": AssetClass.BLUECHIP.value,
        "largecap": AssetClass.BLUECHIP.value,
        "large_cap": AssetClass.BLUECHIP.value,
        "etf": AssetClass.ETF.value,
        "midcap": AssetClass.MIDCAP.value,
        "mid_cap": AssetClass.MIDCAP.value,
        "smallcap": AssetClass.SMALLCAP.value,
        "small_cap": AssetClass.SMALLCAP.value,
    }
    if s in aliases:
        return aliases[s]
    if s in DEFAULT_HAIRCUTS:
        return s
    return AssetClass.UNKNOWN.value


def get_haircut(asset_class: Any, haircuts: Optional[Dict[str, float]] = None) -> float:
    hc = haircuts if haircuts is not None else DEFAULT_HAIRCUTS
    key = normalize_asset_class(asset_class)
    if key in hc:
        return float(hc[key])
    # Fall back to unknown conservative haircut.
    return float(hc.get(AssetClass.UNKNOWN.value, 0.50))


def usable_value(
    quantity: float,
    ltp: float,
    asset_class: Any = AssetClass.UNKNOWN.value,
    haircut: Optional[float] = None,
    haircuts: Optional[Dict[str, float]] = None,
) -> float:
    """Usable margin contribution = qty * LTP * (1 - haircut)."""
    q = _safe_float(quantity)
    price = _safe_float(ltp)
    h = haircut if haircut is not None else get_haircut(asset_class, haircuts)
    h = min(max(h, 0.0), 1.0)
    return q * price * (1.0 - h)


@dataclass
class Holding:
    symbol: str
    asset_class: Any = AssetClass.UNKNOWN.value
    quantity: float = 0.0
    ltp: float = 0.0
    pledged_qty: float = 0.0
    isin: Optional[str] = None
    broker: Optional[str] = None
    haircut_override: Optional[float] = None

    def gross_value(self) -> float:
        return _safe_float(self.quantity) * _safe_float(self.ltp)

    def usable(self, haircuts: Optional[Dict[str, float]] = None) -> float:
        qty = self.pledged_qty if self.pledged_qty and self.pledged_qty > 0 else self.quantity
        hc = self.haircut_override
        return usable_value(qty, self.ltp, self.asset_class, haircut=hc, haircuts=haircuts)

    def is_cash_like(self) -> bool:
        return normalize_asset_class(self.asset_class) in CASH_LIKE_CLASSES


@dataclass
class MarginSnapshot:
    timestamp: str
    cash_available: float
    collateral_value: float
    cash_like_collateral: float
    total_margin_available: float
    total_margin_required: float
    used_margin: float
    available_margin: float
    cash_ratio: float
    utilization: float
    sebi_compliant: bool
    defense_triggered: bool
    block_new_entries: bool
    holdings: List[Dict[str, Any]] = field(default_factory=list)
    actions: List[str] = field(default_factory=list)


class CollateralMarginManager:
    """SEBI 50:50 cash-to-collateral compliance tracker + margin-call defense."""

    def __init__(
        self,
        haircuts: Optional[Dict[str, float]] = None,
        sebi_floor: float = 0.50,
        defense_buffer: float = 0.55,
        utilization_defense: float = 0.55,
        margin_call_utilization: float = 0.85,
    ) -> None:
        self.haircuts: Dict[str, float] = dict(DEFAULT_HAIRCUTS)
        if haircuts:
            for k, v in haircuts.items():
                self.haircuts[normalize_asset_class(k)] = float(v)
        self.sebi_floor = float(sebi_floor)
        self.defense_buffer = float(defense_buffer)
        self.utilization_defense = float(utilization_defense)
        self.margin_call_utilization = float(margin_call_utilization)
        self._snapshot: Optional[MarginSnapshot] = None
        self._history: List[MarginSnapshot] = []

    # ------------------------------------------------------------------ #
    # Haircut / usable margin
    # ------------------------------------------------------------------ #
    def haircut_for(self, asset_class: Any) -> float:
        return get_haircut(asset_class, self.haircuts)

    def usable_for_holding(self, holding: Holding) -> float:
        return holding.usable(self.haircuts)

    def portfolio_usable_margin(self, holdings: List[Holding]) -> float:
        return sum(h.usable(self.haircuts) for h in holdings)

    def cash_like_value(self, cash_available: float, holdings: List[Holding]) -> float:
        total = _safe_float(cash_available)
        for h in holdings:
            if h.is_cash_like():
                total += h.usable(self.haircuts)
        return total

    # ------------------------------------------------------------------ #
    # Compliance evaluation
    # ------------------------------------------------------------------ #
    def evaluate(
        self,
        cash_available: float = 0.0,
        total_margin_required: float = 0.0,
        holdings: Optional[List[Holding]] = None,
        used_margin: Optional[float] = None,
        available_margin: Optional[float] = None,
        collateral_holdings: Optional[List[Dict[str, Any]]] = None,
    ) -> MarginSnapshot:
        normalized: List[Holding] = []
        for h in (holdings or []):
            if isinstance(h, dict):
                normalized.append(self._holding_from_dict(h))
            elif isinstance(h, Holding):
                normalized.append(h)
        holdings = normalized
        # Allow passing raw dicts.
        if collateral_holdings:
            for raw in collateral_holdings:
                if isinstance(raw, dict):
                    holdings.append(self._holding_from_dict(raw))
                elif isinstance(raw, Holding):
                    holdings.append(raw)

        cash = _safe_float(cash_available)
        required = _safe_float(total_margin_required)
        avail_provided = available_margin is not None
        used = _safe_float(used_margin) if used_margin is not None else required
        avail = _safe_float(available_margin)

        cash_like = self.cash_like_value(cash, holdings)
        # Non-cash collateral usable value.
        collateral_value = 0.0
        for h in holdings:
            if not h.is_cash_like():
                collateral_value += h.usable(self.haircuts)
        # Total usable margin pool.
        total_pool = cash + self.portfolio_usable_margin(holdings)
        if avail <= 0:
            avail = total_pool

        if required <= 0:
            required = used if used > 0 else 0.0

        cash_ratio = (cash_like / required) if required > 0 else 1.0
        utilization = (used / avail) if avail > 0 else 0.0

        sebi_compliant = cash_ratio >= self.sebi_floor
        # Margin-call risk at high utilization.
        margin_call_risk = avail_provided and utilization >= self.margin_call_utilization
        utilization_defense_hit = avail_provided and utilization >= self.utilization_defense
        defense_triggered = (
            cash_ratio < self.defense_buffer
            or utilization_defense_hit
            or margin_call_risk
        )

        block_new_entries = (not sebi_compliant) or defense_triggered

        actions = self._defense_actions(
            cash_ratio=cash_ratio,
            utilization=utilization,
            sebi_compliant=sebi_compliant,
            defense_triggered=defense_triggered,
            margin_call_risk=margin_call_risk,
            holdings=holdings,
        )

        snapshot = MarginSnapshot(
            timestamp=datetime.now(timezone.utc).isoformat(),
            cash_available=cash,
            collateral_value=round(collateral_value, 2),
            cash_like_collateral=round(cash_like, 2),
            total_margin_available=round(total_pool, 2),
            total_margin_required=round(required, 2),
            used_margin=round(used, 2),
            available_margin=round(avail, 2),
            cash_ratio=round(cash_ratio, 6),
            utilization=round(utilization, 6),
            sebi_compliant=sebi_compliant,
            defense_triggered=defense_triggered,
            block_new_entries=block_new_entries,
            holdings=[self._holding_to_dict(h) for h in holdings],
            actions=actions,
        )
        self._snapshot = snapshot
        self._history.append(snapshot)
        if len(self._history) > 500:
            self._history = self._history[-500:]
        return snapshot

    def _holding_from_dict(self, raw: Dict[str, Any]) -> Holding:
        asset_class = raw.get("asset_class", raw.get("assetClass", raw.get("class", raw.get("type"))))
        # Infer from symbol if not provided.
        if not asset_class:
            asset_class = self._infer_asset_class(str(raw.get("symbol", "")))
        return Holding(
            symbol=str(raw.get("symbol", raw.get("tradingSymbol", ""))),
            asset_class=asset_class,
            quantity=_safe_float(raw.get("quantity", raw.get("qty", 0.0))),
            ltp=_safe_float(raw.get("ltp", raw.get("last_price", raw.get("lastPrice", 0.0)))),
            pledged_qty=_safe_float(raw.get("pledged_qty", raw.get("pledgedQty", 0.0))),
            isin=raw.get("isin"),
            broker=raw.get("broker"),
            haircut_override=raw.get("haircut", raw.get("haircut_override")),
        )

    @staticmethod
    def _infer_asset_class(symbol: str) -> str:
        s = symbol.upper()
        if "LIQUID" in s or "CASH" in s or "TREPS" in s:
            return AssetClass.LIQUID.value
        # Conservative default: unknown midcap haircut.
        return AssetClass.MIDCAP.value

    @staticmethod
    def _holding_to_dict(h: Holding) -> Dict[str, Any]:
        return {
            "symbol": h.symbol,
            "asset_class": normalize_asset_class(h.asset_class),
            "quantity": h.quantity,
            "ltp": h.ltp,
            "pledged_qty": h.pledged_qty,
            "gross_value": round(h.gross_value(), 2),
            "usable_value": round(h.usable(DEFAULT_HAIRCUTS), 2),
            "haircut": get_haircut(h.asset_class, DEFAULT_HAIRCUTS),
            "is_cash_like": h.is_cash_like(),
        }

    def _defense_actions(
        self,
        cash_ratio: float,
        utilization: float,
        sebi_compliant: bool,
        defense_triggered: bool,
        margin_call_risk: bool,
        holdings: List[Holding],
    ) -> List[str]:
        actions: List[str] = []
        if not sebi_compliant:
            actions.append("SEBI 50:50 breach: cash component below 50% of required margin")
        if cash_ratio < self.defense_buffer:
            actions.append(f"Cash ratio {cash_ratio:.2%} below {self.defense_buffer:.0%} defense buffer")
        if utilization >= self.utilization_defense:
            actions.append(f"Margin utilization {utilization:.2%} reached {self.utilization_defense:.0%} defense threshold")
        if margin_call_risk:
            actions.append("High margin utilization: propose trimming tested wing or adding cash")
        if defense_triggered:
            # Propose releasing worst-haircut collateral first.
            worst = sorted(holdings, key=lambda h: get_haircut(h.asset_class, self.haircuts), reverse=True)
            if worst:
                actions.append(f"Consider unpledging high-haircut asset: {worst[0].symbol}")
            actions.append("Block new short option entries until compliance restored")
        if not actions:
            actions.append("Compliant: no action required")
        return actions

    # ------------------------------------------------------------------ #
    # Broker ingestion
    # ------------------------------------------------------------------ #
    def _extract_funds(self, data: Any) -> Tuple[float, float, float, float]:
        """Return (cash_available, used_margin, available_margin, total_margin_required)."""
        cash = 0.0
        used = 0.0
        avail = 0.0
        required = 0.0

        def walk(obj: Any) -> None:
            nonlocal cash, used, avail, required
            if isinstance(obj, dict):
                # OpenAlgo / Dhan style.
                for key in ("availablecash", "available_cash", "availableCash", "availabelLimit", "available"):
                    if key in obj:
                        cash = max(cash, _safe_float(obj.get(key)))
                for key in ("utiliseddebits", "utilized", "utilised", "utilizedLimit", "used_margin", "usedMargin"):
                    if key in obj:
                        used = max(used, _safe_float(obj.get(key)))
                for key in ("available_margin", "availableMargin", "net", "available"):
                    if key in obj and "cash" not in key.lower():
                        avail = max(avail, _safe_float(obj.get(key)))
                # Upstox nested equity.
                for k, v in obj.items():
                    if isinstance(v, (dict, list)):
                        walk(v)
            elif isinstance(obj, list):
                for it in obj:
                    walk(it)

        walk(data)
        if required <= 0:
            required = used
        if avail <= 0:
            avail = cash + used
        return cash, used, avail, required

    def refresh_from_payload(
        self,
        funds_payload: Any = None,
        holdings_payload: Any = None,
        total_margin_required: Optional[float] = None,
    ) -> MarginSnapshot:
        cash, used, avail, required = self._extract_funds(funds_payload) if funds_payload is not None else (0.0, 0.0, 0.0, 0.0)
        holdings: List[Holding] = []
        if isinstance(holdings_payload, list):
            for raw in holdings_payload:
                if isinstance(raw, dict):
                    holdings.append(self._holding_from_dict(raw))
                elif isinstance(raw, Holding):
                    holdings.append(raw)
        if total_margin_required is not None:
            required = float(total_margin_required)
        return self.evaluate(
            cash_available=cash,
            total_margin_required=required,
            holdings=holdings,
            used_margin=used,
            available_margin=avail,
        )

    async def refresh_from_brokers(
        self,
        fund_fetchers: Optional[List[Callable[[], Any]]] = None,
        holding_fetchers: Optional[List[Callable[[], Any]]] = None,
        total_margin_required: Optional[float] = None,
    ) -> MarginSnapshot:
        fund_payloads: List[Any] = []
        holding_payloads: List[Any] = []
        for fn in (fund_fetchers or []):
            try:
                fund_payloads.append(await asyncio.to_thread(fn) if asyncio.iscoroutinefunction(fn) else fn())
            except Exception as exc:
                log.warning("Fund fetcher failed: %s", exc)
        for fn in (holding_fetchers or []):
            try:
                holding_payloads.append(await asyncio.to_thread(fn) if asyncio.iscoroutinefunction(fn) else fn())
            except Exception as exc:
                log.warning("Holding fetcher failed: %s", exc)

        merged_funds = fund_payloads[0] if len(fund_payloads) == 1 else fund_payloads
        merged_holdings: List[Any] = []
        for hp in holding_payloads:
            if isinstance(hp, list):
                merged_holdings.extend(hp)
            else:
                merged_holdings.append(hp)
        return self.refresh_from_payload(merged_funds, merged_holdings, total_margin_required=total_margin_required)

    @property
    def snapshot(self) -> Optional[MarginSnapshot]:
        return self._snapshot

    @property
    def history(self) -> List[MarginSnapshot]:
        return list(self._history)

    def check_compliance(self, *args: Any, **kwargs: Any) -> MarginSnapshot:
        return self.evaluate(*args, **kwargs)

    def evaluate_compliance(self, *args: Any, **kwargs: Any) -> MarginSnapshot:
        return self.evaluate(*args, **kwargs)

    def trigger_defense(self, *args: Any, **kwargs: Any) -> List[str]:
        snap = self.evaluate(*args, **kwargs) if (args or kwargs) else self._snapshot
        return list(snap.actions) if snap is not None else []

    def margin_call_defense_triggered(self, *args: Any, **kwargs: Any) -> bool:
        if args or kwargs:
            snap = self.evaluate(*args, **kwargs)
            return snap.defense_triggered
        return self.is_defense_triggered()

    def is_defense_triggered(self) -> bool:
        return bool(self._snapshot.defense_triggered) if self._snapshot else False

    def should_block_new_entries(self) -> bool:
        return bool(self._snapshot.block_new_entries) if self._snapshot else False


# Convenience / module-level API.
collateral_margin_manager = CollateralMarginManager()


def compute_haircut(asset_class: Any, haircuts: Optional[Dict[str, float]] = None) -> float:
    return get_haircut(asset_class, haircuts or DEFAULT_HAIRCUTS)


def compute_usable_margin(quantity: float, ltp: float, asset_class: Any = AssetClass.UNKNOWN.value, haircut: Optional[float] = None) -> float:
    return usable_value(quantity, ltp, asset_class, haircut=haircut)


def evaluate_sebi_compliance(*args: Any, **kwargs: Any) -> MarginSnapshot:
    return collateral_margin_manager.evaluate(*args, **kwargs)


def is_margin_call_defense_triggered(*args: Any, **kwargs: Any) -> bool:
    if args or kwargs:
        snap = collateral_margin_manager.evaluate(*args, **kwargs)
        return snap.defense_triggered
    return collateral_margin_manager.is_defense_triggered()


__all__ = [
    "AssetClass",
    "CollateralMarginManager",
    "collateral_margin_manager",
    "DEFAULT_HAIRCUTS",
    "Holding",
    "MarginSnapshot",
    "get_haircut",
    "usable_value",
    "compute_haircut",
    "compute_usable_margin",
    "evaluate_sebi_compliance",
    "is_margin_call_defense_triggered",
    "normalize_asset_class",
]


def check_compliance(*args: Any, **kwargs: Any) -> MarginSnapshot:
    return collateral_margin_manager.evaluate(*args, **kwargs)


def trigger_defense(*args: Any, **kwargs: Any) -> List[str]:
    if args or kwargs:
        snap = collateral_margin_manager.evaluate(*args, **kwargs)
        return list(snap.actions)
    return []


def sebi_50_50_check(*args: Any, **kwargs: Any) -> MarginSnapshot:
    return collateral_margin_manager.evaluate(*args, **kwargs)


def compute_haircut_matrix(holdings: Any = None, **kwargs: Any) -> Any:
    if holdings is None:
        return dict(DEFAULT_HAIRCUTS)
    total = 0.0
    for h in holdings:
        if isinstance(h, dict):
            total += usable_value(
                h.get("quantity", 0.0),
                h.get("ltp", 0.0),
                h.get("asset_class", h.get("assetClass", "unknown")),
            )
    return total
