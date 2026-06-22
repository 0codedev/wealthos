"""
sebi_insider_radar.py — Regulatory Insider-Surveillance & Institutional Conviction Engine.

Three production subsystems over live, verified exchange/regulator data:

  1. PIT DISCLOSURE INGESTION  — SEBI (Prohibition of Insider Trading) Regulations,
     2015, Regulation 7(2) read with Regulation 6(2). Parses the exchange-filed
     Reg 7(2) disclosure stream into typed records and enforces the statutory
     disclosure-latency rule (2 trading days from execution).

  2. SAST DISCLOSURE INGESTION  — SEBI (Substantial Acquisition of Shares and
     Takeovers) Regulations, 2011. Reg 29 (substantial acquisition / disposal /
     takeover) and Reg 31-32 (creation and extinguishment of encumbrance).
     Note: SAST and PIT are two *distinct* regimes; this module treats them as
     separate signal families and never conflates them.

  3. LARGE-DEAL FLOW            — NSE bulk deals (>= 0.5% of issued capital on
     either side, SEBI circular SEBI/MRD/SE/Cir-7/2004), NSE block deals (odd-lot
     'BL' window) and disclosed short positions. BSE equivalents are attempted
     through the same resilient fetch path.

On top of the ingestion sits a transparent, fully-attributed *institutional
insider conviction* model. Every score decomposes into named factor
contributions so a human can audit exactly why a symbol scored what it did.

VERIFIED UPSTREAM CONTRACTS (probed live; see implementation report)
  NSE PIT    : GET https://www.nseindia.com/api/corporates-pit?index=equities
               -> {"acqNameList": [...], "data": [ ...29 fields... ]}
               Fields include: symbol, company, acqName, personCategory,
               tdpTransactionType, acqMode, secAcq, secVal, buyQuantity,
               sellquantity, befAcqSharesNo/Per, afterAcqSharesNo/Per,
               acqfromDt/acqtoDt, intimDt, anex ("7(2)"), derivativeType,
               tdpDerivativeContractType, xbrl, did/pid.
  NSE SAST   : GET https://www.nseindia.com/api/corporate-sast-reg29?index=equities
               -> {"acqNameList": [...], "data": [ ...24 fields... ]}
               Fields include: acqSaleType, regType ("Reg29(2)"), promoterType,
               acquirerName, acquirerDate, acquisitionMode, noOfShareAcq/Sale,
               noOfShareAft, totAcqShare/totSaleShare, totAcqDiluted/
               totSaleDiluted, totAftShare/totAftDiluted, attachement (XBRL zip).
  NSE BULK   : GET https://archives.nseindia.com/content/equities/bulk.csv
               -> CSV: Date,Symbol,Security Name,Client Name,Buy/Sell,
                       Quantity Traded,Trade Price / Wght. Avg. Price,Remarks
               NOTE: "Security Name" is truncated by the exchange to 20 chars.
  NSE BLOCK  : GET https://archives.nseindia.com/content/equities/block.csv
               -> same header minus Remarks; emits the sentinel row
               "NO RECORDS,,,,,," on empty sessions (handled explicitly).
  NSE SNAPSHOT: GET https://www.nseindia.com/api/snapshot-capital-market-largedeal
               -> {as_on_date, BULK_DEALS_DATA, BLOCK_DEALS_DATA,
                   SHORT_DEALS_DATA, BULK_DEALS, BLOCK_DEALS, SHORT_DEALS}
               Rows: {date, symbol, name, clientName, buySell, qty, watp, remarks}
  BSE BULK   : GET https://api.bseindia.com/BseIndiaAPI/api/BulkBlockDeal/w
               (Akamai-fronted; frequently 403 from datacenter egress — the
               fetcher treats that as a trippable breaker condition rather than
               an error, and the radar degrades to NSE-only with an explicit
               `sources_degraded` marker.)

Dependency posture: httpx is already declared in python-bridge/requirements.txt.
No new dependency is introduced. CSV/JSON/HTML parsing is stdlib-only, so this
module imports and unit-tests on a bare interpreter.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import random
import re
import sqlite3
import threading
import time
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

try:  # httpx is declared in python-bridge/requirements.txt
    import httpx
except ImportError:  # pragma: no cover - exercised only on bare interpreters
    httpx = None  # type: ignore[assignment]

__version__ = "1.0.0"

log = logging.getLogger("sebi_insider_radar")

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------

NSE_BASE = "https://www.nseindia.com"
NSE_ARCHIVES = "https://archives.nseindia.com"
BSE_API_BASE = "https://api.bseindia.com/BseIndiaAPI/api"
BSE_SITE = "https://www.bseindia.com"

# Cookie-warming page: NSE gates /api/* behind an Akamai bot check, so a
# plain API GET without first-party cookies is answered 403.
NSE_WARMUP_URL = f"{NSE_BASE}/market-data/all-upcoming-issues-ipo"
NSE_PIT_URL = f"{NSE_BASE}/api/corporates-pit"
NSE_SAST_URL = f"{NSE_BASE}/api/corporate-sast-reg29"
NSE_PLEDGED_URL = f"{NSE_BASE}/api/corporate-pledgedata"
NSE_LARGEDEAL_URL = f"{NSE_BASE}/api/snapshot-capital-market-largedeal"
NSE_BLOCK_DEAL_URL = f"{NSE_BASE}/api/block-deal"
NSE_BULK_CSV_URL = f"{NSE_ARCHIVES}/content/equities/bulk.csv"
NSE_BLOCK_CSV_URL = f"{NSE_ARCHIVES}/content/equities/block.csv"
BSE_BULKBLOCK_URL = f"{BSE_API_BASE}/BulkBlockDeal/w"

HTTP_TIMEOUT_S = float(os.getenv("RADAR_HTTP_TIMEOUT_S", "15.0"))
HTTP_MAX_ATTEMPTS = int(os.getenv("RADAR_HTTP_ATTEMPTS", "4"))
HTTP_BACKOFF_BASE_S = float(os.getenv("RADAR_HTTP_BACKOFF_S", "0.9"))
HTTP_MAX_BACKOFF_S = float(os.getenv("RADAR_HTTP_MAX_BACKOFF_S", "8.0"))
CIRCUIT_BREAKER_THRESHOLD = int(os.getenv("RADAR_BREAKER_THRESHOLD", "3"))
CIRCUIT_BREAKER_COOLDOWN_S = float(os.getenv("RADAR_BREAKER_COOLDOWN_S", "300.0"))
MIN_REQUEST_INTERVAL_S = float(os.getenv("RADAR_MIN_INTERVAL_S", "0.45"))
SESSION_WARM_TTL_S = float(os.getenv("RADAR_SESSION_TTL_S", "600.0"))

# Statutory: Reg 7(2) read with Reg 9(1) requires the intimation to reach the
# exchange within two trading days of the transaction.
PIT_DISCLOSURE_TRADING_DAYS = 2

# Statutory: SAST Reg 3(1) 5% acquisition / 5% disposal; Reg 3(2)/(3) 15%
# voting-rights threshold; Reg 15 control (25%).
SAST_ACQUIRE_THRESHOLD_PCT = 5.0
SAST_CONTROL_THRESHOLD_PCT = 25.0

# Bulk/block deal statutory floor (SEBI/MRD/SE/Cir-7/2004 para 1.1).
BULK_DEAL_FLOOR_PCT_OF_CAPITAL = 0.5

DB_PATH = os.getenv(
    "RADAR_DB_PATH",
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data",
        "sebi_insider_radar.db",
    ),
)

USER_AGENTS: Tuple[str, ...] = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/124.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.3 Safari/605.1.15",
)

# Sentinel tokens the exchanges use instead of an empty payload.
_NULLISH_TOKENS = frozenset({"", "-", "--", "na", "n/a", "nil", "null", "none", "not available"})

_MONTHS: Dict[str, int] = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class InsiderRole(str, Enum):
    """`personCategory` / `promoterType` as classified by the exchanges."""

    PROMOTER = "PROMOTER"
    DIRECTOR = "DIRECTOR"
    KMP = "KMP"
    EMPLOYEE = "EMPLOYEE"
    PROMOTER_GROUP = "PROMOTER_GROUP"
    TEN_HOLDER = "TEN_HOLDER"
    OTHER = "OTHER"
    UNKNOWN = "UNKNOWN"


class TradeDirection(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    NEUTRAL = "NEUTRAL"


class AcquisitionChannel(str, Enum):
    OPEN_MARKET = "OPEN_MARKET"
    ESOP = "ESOP"
    TRANSFER = "TRANSFER"
    BONUS = "BONUS"
    RIGHTS = "RIGHTS"
    TAKEOVER = "TAKEOVER"
    PLEDGE = "PLEDGE"
    OTHER = "OTHER"


class DisclosureRegime(str, Enum):
    """The two regimes are legally distinct and scored separately."""

    PIT_7_2 = "PIT_REG_7_2"
    SAST_29 = "SAST_REG_29"
    SAST_31_32 = "SAST_REG_31_32"
    UNKNOWN = "UNKNOWN"


class DealKind(str, Enum):
    BULK = "BULK"
    BLOCK = "BLOCK"
    SHORT = "SHORT"


class InvestorArchetype(str, Enum):
    """Bulk/block client-name classification used by the conviction model."""

    MUTUAL_FUND = "MUTUAL_FUND"
    FOREIGN_PORTFOLIO = "FOREIGN_PORTFOLIO"
    INSURANCE_PENSION = "INSURANCE_PENSION"
    HEDGE_FUND_PROXY = "HEDGE_FUND_PROXY"
    PE_VC = "PE_VC"
    PROPRIETARY_DESK = "PROPRIETARY_DESK"
    BROKER_PROP = "BROKER_PROP"
    FAMILY_OFFICE = "FAMILY_OFFICE"
    RETAIL_HUF = "RETAIL_HUF"
    INSTITUTIONAL_BANK = "INSTITUTIONAL_BANK"
    UNKNOWN = "UNKNOWN"


class ConvictionBand(str, Enum):
    CONVICTION_CORE = "CORE"
    STRONG_BUY = "STRONG_BUY"
    ACCUMULATION = "ACCUMULATION"
    NEUTRAL = "NEUTRAL"
    DISTRIBUTION = "DISTRIBUTION"
    RISK = "RISK"


# ---------------------------------------------------------------------------
# Coercion helpers — exchanges emit wildly inconsistent scalars
# ---------------------------------------------------------------------------


def is_nullish(value: Any) -> bool:
    """True when an exchange field carries no usable value."""
    if value is None:
        return True
    if isinstance(value, float) and value != value:  # NaN
        return True
    text = str(value).strip()
    return text.lower() in _NULLISH_TOKENS


def coerce_float(value: Any, default: Optional[float] = None) -> Optional[float]:
    """
    Parse an exchange-supplied number.

    Handles every shape observed in the wild: floats, ``"3.028233E7"``
    scientific notation, Indian lakh grouping ``"1,20,000"``, Western grouping
    ``"1,200,000"``, accounting negatives ``"(1,234)"``, trailing ``"%"``, and
    the ``"-"`` / ``"NA"`` / empty sentinels. Returns ``default`` when the value
    is nullish or unparseable — it never raises, because one bad cell must not
    discard an entire disclosure batch.
    """
    if is_nullish(value):
        return default
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return float(value)

    text = str(value).strip()
    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative = True
        text = text[1:-1].strip()
    text = text.replace(",", "").replace("₹", "").replace("Rs", "").strip()
    text = text.rstrip("%").strip()
    if text.lower().endswith("cr"):
        text = text[:-2].strip()
    if text.lower().endswith("lakh"):
        text = text[:-4].strip()
    if not text:
        return default
    try:
        result = float(text)
    except ValueError:
        # Forms like "4,571.53 Lacs" or "12.34 % of paid-up" survive prefix strip.
        match = re.search(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
        if not match:
            return default
        try:
            result = float(match.group(0))
        except ValueError:
            return default
    return -result if negative else result


def coerce_bool_flag(value: Any) -> Optional[bool]:
    """Tri-state flag: ``"Y"``/``"N"``/``1``/``0``/``true``. ``None`` when absent."""
    if is_nullish(value):
        return None
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in ("y", "yes", "true", "1"):
        return True
    if text in ("n", "no", "false", "0"):
        return False
    return None


_DATE_FORMATS = (
    "%d-%b-%Y", "%d-%B-%Y", "%d-%b-%y", "%d-%B-%y", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y",
)


def coerce_date(value: Any) -> Optional[date]:
    """Parse the date formats NSE/BSE actually emit (``29-Apr-2026``, ``16-OCT-2026``)."""
    if is_nullish(value):
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    text = str(value).strip()
    if not text:
        return None
    # Strip a trailing time component, tolerating both "02-May-2026 16:46" and
    # "2026-10-16T10:00:00". The separator must be followed by a digit so the
    # 'T' is a clock marker: a plain split on "T" would truncate "16-OCT-2026"
    # to "16-OC" because the October abbreviation itself ends in 'T'.
    head = re.split(r"[ T](?=\d)", text, maxsplit=1)[0]
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(head, fmt).date()
        except ValueError:
            continue
    match = re.match(r"(\d{1,2})-([A-Za-z]{3})[A-Za-z]*-(\d{4})", head)
    if match:
        month = _MONTHS.get(match.group(2).lower())
        if month:
            try:
                return date(int(match.group(3)), month, int(match.group(1)))
            except ValueError:
                return None
    return None


def coerce_datetime(value: Any) -> Optional[datetime]:
    """Parse ``"02-May-2026 16:46"`` / ``"16-Oct-2026, 12-07"`` / ISO-8601."""
    if is_nullish(value):
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    for fmt in ("%d-%b-%Y %H:%M:%S", "%d-%b-%Y %H:%M", "%d-%b-%Y,%H-%M", "%d-%b-%Y %I:%M %p"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    parsed = coerce_date(text)
    return datetime.combine(parsed, datetime.min.time()) if parsed else None


def normalize_symbol(value: Any) -> Optional[str]:
    """Canonical NSE/BSE symbol form: trimmed, upper-cased, no stray punctuation."""
    if is_nullish(value):
        return None
    cleaned = re.sub(r"[^A-Za-z0-9&]", "", str(value)).upper()
    return cleaned or None


def normalize_client_name(value: Any) -> Optional[str]:
    """Collapse the legal-suffix noise that makes client names hard to group."""
    if is_nullish(value):
        return None
    text = re.sub(r"\s+", " ", str(value)).strip().upper()
    text = re.sub(r"\b(LTD|LIMITED|LTD\.|LIMITED\.)\b", "LTD", text)
    text = re.sub(r"\b(PRIVATE|PVT)\b", "PVT", text)
    text = re.sub(r"\b(INDIAN|INDIA)\b", "INDIA", text)
    return text or None


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


# ---------------------------------------------------------------------------
# Domain records
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PitDisclosure:
    """One SEBI PIT Reg 7(2) intimation as filed on the exchange."""

    symbol: Optional[str]
    company: Optional[str]
    person_name: Optional[str]
    person_role: InsiderRole
    regulation: str
    transaction_type: TradeDirection
    channel: AcquisitionChannel
    securities_type: Optional[str]
    shares_acquired: Optional[float]
    shares_sold: Optional[float]
    value_inr: Optional[float]
    buy_quantity: Optional[float]
    buy_value: Optional[float]
    sell_quantity: Optional[float]
    sell_value: Optional[float]
    shares_before: Optional[float]
    pct_before: Optional[float]
    shares_after: Optional[float]
    pct_after: Optional[float]
    derivative_type: Optional[str]
    derivative_contract: Optional[str]
    trade_date: Optional[date]
    intimation_date: Optional[date]
    filed_at: Optional[datetime]
    disclosure_id: Optional[str]
    person_id: Optional[str]
    xbrl_url: Optional[str]
    remarks: Optional[str]
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False)

    @property
    def holding_delta(self) -> Optional[float]:
        """
        Signed change in the insider's holding measured in **shares**.

        Percentage points are deliberately excluded here — see
        :attr:`holding_pct_delta`. Mixing the two units inside one aggregate
        would corrupt the flow ratio the conviction model is built on.
        """
        if self.shares_after is not None and self.shares_before is not None:
            return self.shares_after - self.shares_before
        return None

    @property
    def holding_pct_delta(self) -> Optional[float]:
        """Signed change in the insider's holding in percentage points of equity."""
        if self.pct_after is not None and self.pct_before is not None:
            return self.pct_after - self.pct_before
        return None

    @property
    def net_shares(self) -> float:
        """
        Signed share delta in **shares**; positive is accumulation.

        The exchanges are inconsistent about which leg carries the size. On live
        Reg 7(2) data the buy/sell legs are frequently ``0`` while ``secAcq``
        holds the figure, so resolution is a strict priority cascade:

        1. an explicitly non-zero buy or sell leg;
        2. the pre/post share-holding delta;
        3. only as a last resort, the transaction direction times the acquired
           quantity.

        Each rung is accepted only when non-zero and non-null, which is what
        keeps a ``0`` placeholder from masking a real fill. On a disposal row the
        exchange frequently reports ``secAcq`` as the *pre-existing* holding
        rather than the size sold, so rung 3 is the weakest and is expected to
        understate some disposals; :attr:`holding_pct_delta` is the cross-check.
        """
        bought = self.buy_quantity or self.buy_value or 0.0
        sold = self.sell_quantity or self.sell_value or 0.0
        if bought or sold:
            return bought - sold

        delta = self.holding_delta
        if delta:
            return delta

        acquired = self.shares_acquired or 0.0
        disposed = self.shares_sold or 0.0
        if self.transaction_type is TradeDirection.SELL:
            return -(disposed or acquired)
        if self.transaction_type is TradeDirection.BUY:
            return disposed or acquired
        return disposed - acquired

    @property
    def net_value_inr(self) -> float:
        """Signed rupee flow, preferring the explicit leg values over ``secVal``."""
        buy = self.buy_value if self.buy_value else 0.0
        sell = self.sell_value if self.sell_value else 0.0
        if buy or sell:
            return buy - sell
        magnitude = self.value_inr or 0.0
        return -magnitude if self.transaction_type is TradeDirection.SELL else magnitude

    @property
    def is_promoter_group(self) -> bool:
        return self.person_role in (InsiderRole.PROMOTER, InsiderRole.PROMOTER_GROUP)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "company": self.company,
            "person_name": self.person_name,
            "person_role": self.person_role.value,
            "regulation": self.regulation,
            "transaction_type": self.transaction_type.value,
            "channel": self.channel.value,
            "securities_type": self.securities_type,
            "shares_acquired": self.shares_acquired,
            "shares_sold": self.shares_sold,
            "value_inr": self.value_inr,
            "shares_before": self.shares_before,
            "pct_before": self.pct_before,
            "shares_after": self.shares_after,
            "pct_after": self.pct_after,
            "derivative_type": self.derivative_type,
            "derivative_contract": self.derivative_contract,
            "trade_date": self.trade_date.isoformat() if self.trade_date else None,
            "intimation_date": self.intimation_date.isoformat() if self.intimation_date else None,
            "filed_at": self.filed_at.isoformat() if self.filed_at else None,
            "disclosure_id": self.disclosure_id,
            "xbrl_url": self.xbrl_url,
            "remarks": self.remarks,
        }


@dataclass(frozen=True, slots=True)
class SastDisclosure:
    """One SAST Reg 29 / Reg 31-32 intimation as filed on the exchange."""

    symbol: Optional[str]
    company: Optional[str]
    acquirer_name: Optional[str]
    regulation: str
    regime: DisclosureRegime
    acquirer_is_promoter: Optional[bool]
    acquirer_category: InsiderRole
    deal_direction: TradeDirection
    channel: AcquisitionChannel
    period_start: Optional[date]
    period_end: Optional[date]
    shares_acquired: Optional[float]
    shares_sold: Optional[float]
    shares_after: Optional[float]
    pct_acquired: Optional[float]
    pct_sold: Optional[float]
    pct_after: Optional[float]
    pct_after_diluted: Optional[float]
    file_url: Optional[str]
    application_no: Optional[str]
    filed_at: Optional[datetime]
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False)

    @property
    def is_encumbrance(self) -> bool:
        return self.regime is DisclosureRegime.SAST_31_32

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "company": self.company,
            "acquirer_name": self.acquirer_name,
            "regulation": self.regulation,
            "regime": self.regime.value,
            "acquirer_is_promoter": self.acquirer_is_promoter,
            "acquirer_category": self.acquirer_category.value,
            "deal_direction": self.deal_direction.value,
            "channel": self.channel.value,
            "period_start": self.period_start.isoformat() if self.period_start else None,
            "period_end": self.period_end.isoformat() if self.period_end else None,
            "shares_acquired": self.shares_acquired,
            "shares_sold": self.shares_sold,
            "shares_after": self.shares_after,
            "pct_acquired": self.pct_acquired,
            "pct_sold": self.pct_sold,
            "pct_after": self.pct_after,
            "pct_after_diluted": self.pct_after_diluted,
            "file_url": self.file_url,
            "application_no": self.application_no,
            "filed_at": self.filed_at.isoformat() if self.filed_at else None,
        }


@dataclass(frozen=True, slots=True)
class PledgeDisclosure:
    """Promoter shareholding encumbrance (pledge) snapshot for one company."""

    symbol: Optional[str]
    company: Optional[str]
    promoter_name: Optional[str]
    promoter_category: InsiderRole
    pledged_qty: Optional[float]
    total_holding: Optional[float]
    pct_pledged: Optional[float]
    as_on: Optional[date]
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "company": self.company,
            "promoter_name": self.promoter_name,
            "promoter_category": self.promoter_category.value,
            "pledged_qty": self.pledged_qty,
            "total_holding": self.total_holding,
            "pct_pledged": self.pct_pledged,
            "as_on": self.as_on.isoformat() if self.as_on else None,
        }


@dataclass(frozen=True, slots=True)
class LargeDeal:
    """One disclosed bulk, block or short position."""

    kind: DealKind
    deal_date: Optional[date]
    symbol: Optional[str]
    security_name: Optional[str]
    client_name: Optional[str]
    client_name_normalized: Optional[str]
    side: TradeDirection
    quantity: Optional[float]
    price: Optional[float]
    notional_inr: Optional[float]
    remarks: Optional[str]
    archetype: InvestorArchetype = InvestorArchetype.UNKNOWN
    source: str = "nse"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind.value,
            "deal_date": self.deal_date.isoformat() if self.deal_date else None,
            "symbol": self.symbol,
            "security_name": self.security_name,
            "client_name": self.client_name,
            "side": self.side.value,
            "quantity": self.quantity,
            "price": self.price,
            "notional_inr": self.notional_inr,
            "remarks": self.remarks,
            "archetype": self.archetype.value,
            "source": self.source,
        }


@dataclass(frozen=True, slots=True)
class FactorContribution:
    """One named, weighted contribution to a conviction score."""

    name: str
    weight: float
    raw_value: Optional[float]
    points: float
    rationale: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "weight": self.weight,
            "raw_value": self.raw_value,
            "points": round(self.points, 3),
            "rationale": self.rationale,
        }


@dataclass(frozen=True, slots=True)
class InsiderConvictionScore:
    """Auditable insider-conviction verdict for one symbol."""

    symbol: str
    score: float
    band: ConvictionBand
    as_of: datetime
    insider_buys: int
    insider_sells: int
    promoter_buys: int
    promoter_sells: int
    net_insider_shares: float
    net_insider_value_inr: float
    distinct_insiders: int
    late_disclosure_count: int
    pledge_pressure_pct: Optional[float]
    institutional_net_quantity: float
    institutional_net_notional_inr: float
    institutional_buyer_count: int
    sast_acquisition_events: int
    sast_disposal_events: int
    encumbrance_events: int
    factors: Tuple[FactorContribution, ...]
    data_quality: float
    provenance: Mapping[str, Any] = field(default_factory=dict, repr=False)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "score": round(self.score, 2),
            "band": self.band.value,
            "as_of": self.as_of.isoformat(),
            "insider_buys": self.insider_buys,
            "insider_sells": self.insider_sells,
            "promoter_buys": self.promoter_buys,
            "promoter_sells": self.promoter_sells,
            "net_insider_shares": self.net_insider_shares,
            "net_insider_value_inr": self.net_insider_value_inr,
            "distinct_insiders": self.distinct_insiders,
            "late_disclosure_count": self.late_disclosure_count,
            "pledge_pressure_pct": self.pledge_pressure_pct,
            "institutional_net_quantity": self.institutional_net_quantity,
            "institutional_net_notional_inr": self.institutional_net_notional_inr,
            "institutional_buyer_count": self.institutional_buyer_count,
            "sast_acquisition_events": self.sast_acquisition_events,
            "sast_disposal_events": self.sast_disposal_events,
            "encumbrance_events": self.encumbrance_events,
            "factors": [f.to_dict() for f in self.factors],
            "data_quality": round(self.data_quality, 3),
            "provenance": dict(self.provenance),
        }


@dataclass(frozen=True, slots=True)
class RadarSnapshot:
    """A complete, timestamped radar observation across all sources."""

    as_of: datetime
    pit_disclosures: Tuple[PitDisclosure, ...]
    sast_disclosures: Tuple[SastDisclosure, ...]
    pledges: Tuple[PledgeDisclosure, ...]
    deals: Tuple[LargeDeal, ...]
    scores: Tuple[InsiderConvictionScore, ...]
    sources_ok: Mapping[str, bool]
    sources_degraded: Tuple[str, ...]
    notes: Tuple[str, ...] = ()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "as_of": self.as_of.isoformat(),
            "pit_count": len(self.pit_disclosures),
            "sast_count": len(self.sast_disclosures),
            "pledge_count": len(self.pledges),
            "deal_count": len(self.deals),
            "scores": [s.to_dict() for s in self.scores],
            "sources_ok": dict(self.sources_ok),
            "sources_degraded": list(self.sources_degraded),
            "notes": list(self.notes),
        }


@dataclass(frozen=True, slots=True)
class FetchOutcome:
    """Result of one resilient fetch attempt sequence."""

    ok: bool
    payload: Optional[Any]
    source: str
    status_code: Optional[int] = None
    attempts: int = 0
    error: Optional[str] = None
    degraded: bool = False
    elapsed_ms: float = 0.0
    attempted: bool = True
    """False for sources deliberately skipped this cycle. A skipped source is
    not a degraded one and must not be reported as a failure."""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ok": self.ok,
            "source": self.source,
            "status_code": self.status_code,
            "attempts": self.attempts,
            "error": self.error,
            "degraded": self.degraded,
            "attempted": self.attempted,
            "elapsed_ms": round(self.elapsed_ms, 2),
        }


# ---------------------------------------------------------------------------
# Client-name archetype classification
# ---------------------------------------------------------------------------

_ARCHETYPE_RULES: Tuple[Tuple[InvestorArchetype, Tuple[str, ...]], ...] = (
    (
        InvestorArchetype.MUTUAL_FUND,
        ("MUTUAL FUND", "MUTUAL FUND", "MF", "SBI MUTUAL", "HDFC MUTUAL", "ICICI MUTUAL",
         "AXIS MUTUAL", "KOTAK MUTUAL", "ADITYA BIRLA MUTUAL", "UTI", "LIC MUTUAL",
         "NILSON", "FRANKLIN", "DSP", "TATA MUTUAL", "BIRLA SUNLIFE", "MFSL", "LIC MF"),
    ),
    (
        InvestorArchetype.FOREIGN_PORTFOLIO,
        ("FPI", "FII", "FOREIGN", "GOLDMAN SACHS", "MORGAN STANLEY", "J.P. MORGAN",
         "CITI", "HSBC", "NOMURA", "UBS", "BARCLAYS", "DEUTSCHE", "BNP PARIBAS",
         "CREDIT SUISSE", "INSTITUTIONAL", "FOREIGN PORTFOLIO", "MARA", "VIKRAM"),
    ),
    (
        InvestorArchetype.INSURANCE_PENSION,
        ("LIFE INSURANCE", "GENERAL INSURANCE", "INSURANCE", "PENSION", "EPFO", "NPS TRUST",
         "SBI LIFE", "HDFC LIFE", "ICICI PRU", "LIC", "MAX HEALTH", "STAR HEALTH"),
    ),
    (
        InvestorArchetype.HEDGE_FUND_PROXY,
        ("HEDGE FUND", "PARTNERS", "CAPITAL PARTNERS", "HFT", "ARBITRAGE", "PROPRIETARY FUND",
         "QUANT", "MULTISTRATEGY", "ALPHA", "ORBIT", "ZEAL", "EDELWEISS", "IIFL",
         "MORGAN STANLEY INDIA", "CLSA", "JAMIE FERGUSON", "COALITION", "KRISNA"),
    ),
    (
        InvestorArchetype.PE_VC,
        ("VENTURE CAPITAL", "PRIVATE EQUITY", "GROWTH FUND", "VENTURES", "CAPITAL VENTURES",
         "CA VENTURE", "STEADVIEW", "ACCEL", "SEQUOIA", "MATRIX", "HELION", "BPEA"),
    ),
    (
        InvestorArchetype.BROKER_PROP,
        ("BROKERAGE", "BROKING", "SECURITIES LTD", "COMMODITY BROKERS", "INVESTORS TRUST",
         "SHAREKAN", "SHOURYA", "MOTILAL OSWAL", "ICICI SECURITIES", "AXIS SECURITIES",
         "KOTAK SECURITIES", "IIFL SECURITIES", "5ZEC", "ANGEL ONE", "UPSTOX", "ZERODHA",
         "GROWW", "ZERODHA", "ANANTHA", "SUDHARSHAN", "PRABHUDUT", "JAINAM"),
    ),
    (
        InvestorArchetype.PROPRIETARY_DESK,
        ("PROPRIETARY", "OWN ACCOUNT", "PROP DESK", "PROPRIETARY TRADING"),
    ),
    (
        InvestorArchetype.FAMILY_OFFICE,
        ("HUF", "HU F", "FAMILY OFFICE", "TRUST", "ESTATE", "PVT LTD", "PRIVATE LIMITED",
         "ENTERPRISES", "HOLDINGS", "GROUP", "INTERNATIONAL LTD"),
    ),
    (
        InvestorArchetype.INSTITUTIONAL_BANK,
        ("BANK LTD", "BANK LIMITED", "BANKING", "CAPITAL LTD"),
    ),
)

_ARCHETYPE_RETIRED_HUF = ("HUF",)


def classify_investor(client_name: Optional[str]) -> InvestorArchetype:
    """
    Map a disclosed bulk/block client name onto an investor archetype.

    This is a name-based heuristic and is deliberately conservative: an
    unrecognised name yields :attr:`InvestorArchetype.UNKNOWN` rather than a
    guess, and the conviction model gives UNKNOWN the neutral weight so a bad
    classification cannot manufacture a signal.
    """
    normalized = normalize_client_name(client_name)
    if not normalized:
        return InvestorArchetype.UNKNOWN
    if any(token in normalized for token in _ARCHETYPE_RETIRED_HUF):
        return InvestorArchetype.RETAIL_HUF
    # Longest-token-wins avoids "CAPITAL" in "CAPITAL VENTURES" matching "bank".
    best: Tuple[int, InvestorArchetype] = (0, InvestorArchetype.UNKNOWN)
    for archetype, tokens in _ARCHETYPE_RULES:
        for token in tokens:
            if token in normalized and len(token) > best[0]:
                best = (len(token), archetype)
    return best[1]


# ---------------------------------------------------------------------------
# Regulatory timing
# ---------------------------------------------------------------------------


class TradingCalendar:
    """
    Minimal trading-day calculator for statutory deadline arithmetic.

    Weekends are excluded unconditionally. Exchange holiday lists are injected
    (see :meth:`with_holidays`) because SEBI Reg 9(1) counts *trading* days, and
    the holiday calendar is not hard-coded here on purpose — it changes every
    fiscal year and is sourced at runtime by the caller.
    """

    __slots__ = ("_holidays",)

    def __init__(self, holidays: Optional[Iterable[date]] = None) -> None:
        self._holidays: Set[date] = set(holidays or ())

    def with_holidays(self, holidays: Iterable[date]) -> "TradingCalendar":
        self._holidays = set(holidays)
        return self

    def is_trading_day(self, day: date) -> bool:
        return day.weekday() < 5 and day not in self._holidays

    def previous_trading_day(self, day: date) -> date:
        cursor = day - timedelta(days=1)
        while not self.is_trading_day(cursor):
            cursor -= timedelta(days=1)
        return cursor

    def next_trading_day(self, day: date) -> date:
        cursor = day + timedelta(days=1)
        while not self.is_trading_day(cursor):
            cursor += timedelta(days=1)
        return cursor

    def trading_days_between(self, start: date, end: date) -> int:
        """Count trading days in ``(start, end]``; negative if ``end`` precedes ``start``."""
        if start == end:
            return 0
        if end < start:
            return -self.trading_days_between(end, start)
        cursor = start
        count = 0
        while cursor < end:
            cursor += timedelta(days=1)
            if self.is_trading_day(cursor):
                count += 1
        return count

    def disclosure_deadline(self, trade_date: date) -> date:
        """Reg 7(2): intimation due within two trading days of execution."""
        deadline = trade_date
        for _ in range(PIT_DISCLOSURE_TRADING_DAYS):
            deadline = self.next_trading_day(deadline)
        return deadline


DEFAULT_CALENDAR = TradingCalendar()


def classify_person_category(value: Any, promoter_flag: Any = None) -> InsiderRole:
    """Map the exchanges' free-text person category onto :class:`InsiderRole`."""
    if coerce_bool_flag(promoter_flag) is True:
        return InsiderRole.PROMOTER
    if is_nullish(value):
        return InsiderRole.UNKNOWN
    text = re.sub(r"[^A-Z ]", " ", str(value).upper())
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return InsiderRole.UNKNOWN
    if "PROMOTER GROUP" in text or "PROMOTER CATEGORY" in text or "PROMOTER" in text:
        if "GROUP" in text:
            return InsiderRole.PROMOTER_GROUP
        return InsiderRole.PROMOTER
    if "KEY MANAGERIAL" in text or text == "KMP" or "KMP" in text.split():
        return InsiderRole.KMP
    if "DIRECTOR" in text:
        return InsiderRole.DIRECTOR
    if "EMPLOYEE" in text:
        return InsiderRole.EMPLOYEE
    if "TEN PERCENT" in text or "10%" in text or "TEN HOLDER" in text:
        return InsiderRole.TEN_HOLDER
    return InsiderRole.OTHER


def classify_acquisition_mode(value: Any) -> AcquisitionChannel:
    """Map the exchanges' free-text acquisition mode onto :class:`AcquisitionChannel`."""
    if is_nullish(value):
        return AcquisitionChannel.OTHER
    text = str(value).upper()
    if "OPEN MARKET" in text or text in ("MARKET", "NORMAL MARKET"):
        return AcquisitionChannel.OPEN_MARKET
    if "ESOP" in text or "EMPLOYEE STOCK" in text:
        return AcquisitionChannel.ESOP
    if "TAKEOVER" in text:
        return AcquisitionChannel.TAKEOVER
    if "PLEDGE" in text or "ENCUMBRANCE" in text:
        return AcquisitionChannel.PLEDGE
    if "BONUS" in text:
        return AcquisitionChannel.BONUS
    if "RIGHTS" in text:
        return AcquisitionChannel.RIGHTS
    if "TRANSFER" in text or "GIFT" in text or "INTER VIVOS" in text or "WILL" in text:
        return AcquisitionChannel.TRANSFER
    return AcquisitionChannel.OTHER


def classify_trade_direction(value: Any) -> TradeDirection:
    """Map free-text transaction type onto :class:`TradeDirection`."""
    if is_nullish(value):
        return TradeDirection.NEUTRAL
    text = str(value).upper()
    if "SELL" in text or "DISPOS" in text or text == "S":
        return TradeDirection.SELL
    if "BUY" in text or "ACQUISITION" in text or "ACQUIRE" in text or text == "B":
        return TradeDirection.BUY
    return TradeDirection.NEUTRAL


# ---------------------------------------------------------------------------
# Resilient HTTP layer
# ---------------------------------------------------------------------------


class _Breaker:
    """Consecutive-failure circuit breaker with a cooldown window."""

    __slots__ = ("_failures", "_opened_at", "_threshold", "_cooldown")

    def __init__(self, threshold: int = CIRCUIT_BREAKER_THRESHOLD, cooldown_s: float = CIRCUIT_BREAKER_COOLDOWN_S) -> None:
        self._failures: Dict[str, int] = {}
        self._opened_at: Dict[str, float] = {}
        self._threshold = threshold
        self._cooldown = cooldown_s

    def is_open(self, key: str, now: float) -> bool:
        opened = self._opened_at.get(key)
        if opened is None:
            return False
        if now - opened >= self._cooldown:
            # Half-open: let the next call probe the source again.
            self._opened_at.pop(key, None)
            self._failures[key] = 0
            return False
        return True

    def record_success(self, key: str) -> None:
        self._failures[key] = 0
        self._opened_at.pop(key, None)

    def record_failure(self, key: str, now: float) -> None:
        count = self._failures.get(key, 0) + 1
        self._failures[key] = count
        if count >= self._threshold:
            self._opened_at[key] = now
            log.warning("[radar] circuit opened for %s after %d failures", key, count)

    def state(self) -> Dict[str, int]:
        return dict(self._failures)


_BLOCKED_MARKERS = (
    "access denied",
    "resource not found",
    "bot detection",
    "captcha",
    "unusual traffic",
    "request unsuccessful",
)


class ResilientFetcher:
    """
    Session-warmed, retrying, rate-limited HTTP client for exchange endpoints.

    Behaviour mirrors the bridge's existing ``nse_stealth`` resilience profile:
    first-party cookie warming, per-attempt User-Agent rotation, session reset
    on a blocked response, exponential backoff with jitter, a per-source
    circuit breaker, and a polite inter-request floor. It never raises — every
    caller receives a :class:`FetchOutcome`.
    """

    def __init__(
        self,
        timeout_s: float = HTTP_TIMEOUT_S,
        max_attempts: int = HTTP_MAX_ATTEMPTS,
        breaker: Optional[_Breaker] = None,
        sleep: Any = time.sleep,
        clock: Any = time.time,
        perf: Any = time.perf_counter,
    ) -> None:
        self._timeout_s = timeout_s
        self._max_attempts = max(1, int(max_attempts))
        self._breaker = breaker or _Breaker()
        self._sleep = sleep
        self._clock = clock
        self._perf = perf
        self._client: Any = None
        self._lock = threading.Lock()
        self._last_request_at = 0.0
        self._warmed_at = 0.0
        self.stats: Dict[str, int] = {}

    # -- session -----------------------------------------------------------

    def _base_headers(self, referer: str, accept: str) -> Dict[str, str]:
        return {
            "User-Agent": random.choice(USER_AGENTS),
            "Accept": accept,
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": referer,
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "Connection": "keep-alive",
        }

    def _new_session(self, referer: str, accept: str) -> Any:
        if httpx is None:
            return None
        return httpx.Client(
            timeout=self._timeout_s,
            trust_env=False,
            follow_redirects=True,
            headers=self._base_headers(referer, accept),
        )

    def _reset_session(self, referer: str, accept: str) -> None:
        """Drop cookies and rebuild the session — Akamai ties bot-tracks to cookies."""
        if self._client is not None:
            try:
                self._client.close()
            except Exception:  # pragma: no cover - defensive
                pass
        self._client = self._new_session(referer, accept)
        self._warmed_at = 0.0

    def _ensure_session(self, referer: str, accept: str, force_warm: bool = False) -> Any:
        with self._lock:
            stale = (self._clock() - self._warmed_at) > SESSION_WARM_TTL_S
            if self._client is None or stale or force_warm:
                self._client = self._new_session(referer, accept)
                self._warmed_at = self._clock()
                if self._client is not None and self._client is not None:
                    try:
                        self._client.get(NSE_WARMUP_URL)
                        self._last_request_at = self._clock()
                    except Exception as exc:  # pragma: no cover - network dependent
                        log.debug("[radar] cookie warm failed: %s", exc)
            return self._client

    def _throttle(self) -> None:
        elapsed = self._clock() - self._last_request_at
        if elapsed < MIN_REQUEST_INTERVAL_S:
            self._sleep(MIN_REQUEST_INTERVAL_S - elapsed)
        self._last_request_at = self._clock()

    # -- fetch -------------------------------------------------------------

    def get_text(
        self,
        url: str,
        source: str,
        referer: str = NSE_BASE,
        accept: str = "application/json, text/plain, */*",
        force_warm: bool = False,
    ) -> FetchOutcome:
        """GET ``url`` and return the decoded body text. Never raises."""
        if httpx is None:
            return FetchOutcome(False, None, source, error="httpx unavailable", degraded=True)

        if self._breaker.is_open(source, self._clock()):
            self._bump(source, "breaker_skipped")
            return FetchOutcome(
                False, None, source, attempts=0,
                error=f"circuit open for {source}", degraded=True,
            )

        last_error: Optional[str] = None
        last_status: Optional[int] = None
        started = self._perf()

        for attempt in range(1, self._max_attempts + 1):
            client = self._ensure_session(referer, accept, force_warm=force_warm and attempt == 1)
            if client is None:
                return FetchOutcome(False, None, source, attempts=attempt, error="session unavailable", degraded=True)
            try:
                self._throttle()
                response = client.get(url)
                last_status = response.status_code
                if response.status_code == 200:
                    self._breaker.record_success(source)
                    self._bump(source, "ok")
                    return FetchOutcome(
                        True, response.text, source, status_code=200, attempts=attempt,
                        elapsed_ms=(self._perf() - started) * 1000.0,
                    )

                body = response.text[:400].lower()
                blocked = response.status_code in (401, 403, 429) or any(m in body for m in _BLOCKED_MARKERS)
                last_error = f"HTTP {response.status_code}: {response.text[:160]!r}"
                if blocked:
                    # Cookies are implicated; rebuild before the next attempt.
                    self._reset_session(referer, accept)
                # 4xx other than 429 are deterministic; retrying just wastes quota.
                if 400 <= response.status_code < 500 and response.status_code != 429:
                    self._breaker.record_failure(source, self._clock())
                    return FetchOutcome(
                        False, None, source, status_code=response.status_code, attempts=attempt,
                        error=last_error, degraded=blocked,
                        elapsed_ms=(self._perf() - started) * 1000.0,
                    )
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                if isinstance(exc, (httpx.TimeoutException, httpx.ConnectError, httpx.TransportError)):
                    self._reset_session(referer, accept)

            if attempt < self._max_attempts:
                backoff = min(
                    HTTP_MAX_BACKOFF_S,
                    HTTP_BACKOFF_BASE_S * (2 ** (attempt - 1)) + random.uniform(0.25, 0.9),
                )
                self._sleep(backoff)

        self._breaker.record_failure(source, self._clock())
        self._bump(source, "failed")
        log.warning("[radar] %s exhausted %d attempts: %s", source, self._max_attempts, last_error)
        return FetchOutcome(
            False, None, source, status_code=last_status, attempts=self._max_attempts,
            error=last_error, degraded=True, elapsed_ms=(self._perf() - started) * 1000.0,
        )

    def get_json(
        self,
        url: str,
        source: str,
        referer: str = NSE_BASE,
        accept: str = "application/json, text/plain, */*",
        force_warm: bool = False,
    ) -> FetchOutcome:
        """GET and JSON-decode. A non-JSON 200 body is treated as a source change."""
        outcome = self.get_text(url, source, referer=referer, accept=accept, force_warm=force_warm)
        if not outcome.ok or outcome.payload is None:
            return outcome
        try:
            decoded = json.loads(outcome.payload)
        except (ValueError, TypeError) as exc:
            self._breaker.record_failure(source, self._clock())
            self._bump(source, "bad_json")
            return FetchOutcome(
                False, None, source, status_code=outcome.status_code, attempts=outcome.attempts,
                error=f"invalid JSON: {exc}", degraded=True, elapsed_ms=outcome.elapsed_ms,
            )
        return FetchOutcome(
            True, decoded, source, status_code=outcome.status_code, attempts=outcome.attempts,
            elapsed_ms=outcome.elapsed_ms,
        )

    def _bump(self, source: str, key: str) -> None:
        self.stats[f"{source}:{key}"] = self.stats.get(f"{source}:{key}", 0) + 1

    def close(self) -> None:
        if self._client is not None:
            try:
                self._client.close()
            except Exception:  # pragma: no cover - defensive
                pass
            self._client = None

    def breaker_state(self) -> Dict[str, int]:
        return self._breaker.state()


# ---------------------------------------------------------------------------
# Parsers — every function is pure so it can be unit-tested offline
# ---------------------------------------------------------------------------


def _iter_records(payload: Any, *preferred_keys: str) -> List[Mapping[str, Any]]:
    """
    Normalise the several envelope shapes the exchanges use into a record list.

    Handles ``{"data": [...]}``, ``{"Table": [...]}``, a bare list, a single
    dict, and the ``{"data": {"records": [...]}}`` nesting. Returns ``[]`` when
    nothing record-shaped is present, so a schema change degrades to "no data"
    rather than an exception.
    """
    if payload is None:
        return []
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if not isinstance(payload, dict):
        return []
    for key in preferred_keys + ("data", "Table", "records", "rows"):
        value = payload.get(key)
        if isinstance(value, list):
            return [r for r in value if isinstance(r, dict)]
        if isinstance(value, dict):
            nested = _iter_records(value, *preferred_keys)
            if nested:
                return nested
    # A flat dict that itself looks like one record.
    if any(k in payload for k in ("symbol", "Symbol", "scrip_code", "ScripCode")):
        return [payload]
    return []


def parse_pit_payload(payload: Any) -> List[PitDisclosure]:
    """
    Parse a ``corporates-pit`` envelope into :class:`PitDisclosure` records.

    Malformed rows are skipped individually and counted in the log; the batch
    survives because partial disclosure data is far better than none.
    """
    records = _iter_records(payload, "data")
    out: List[PitDisclosure] = []
    skipped = 0
    for row in records:
        try:
            symbol = normalize_symbol(row.get("symbol"))
            if not symbol:
                skipped += 1
                continue
            regulation = str(row.get("anex") or "7(2)").strip()
            out.append(
                PitDisclosure(
                    symbol=symbol,
                    company=_clean_text(row.get("company")),
                    person_name=_clean_text(row.get("acqName")),
                    person_role=classify_person_category(row.get("personCategory")),
                    regulation=regulation,
                    transaction_type=classify_trade_direction(row.get("tdpTransactionType")),
                    channel=classify_acquisition_mode(row.get("acqMode")),
                    securities_type=_clean_text(row.get("secType")),
                    shares_acquired=coerce_float(row.get("secAcq")),
                    shares_sold=coerce_float(row.get("sellquantity")),
                    value_inr=coerce_float(row.get("secVal")),
                    buy_quantity=coerce_float(row.get("buyQuantity")),
                    buy_value=coerce_float(row.get("buyValue")),
                    sell_quantity=coerce_float(row.get("sellquantity")),
                    sell_value=coerce_float(row.get("sellValue")),
                    shares_before=coerce_float(row.get("befAcqSharesNo")),
                    pct_before=coerce_float(row.get("befAcqSharesPer")),
                    shares_after=coerce_float(row.get("afterAcqSharesNo")),
                    pct_after=coerce_float(row.get("afterAcqSharesPer")),
                    derivative_type=_clean_text(row.get("derivativeType")),
                    derivative_contract=_clean_text(row.get("tdpDerivativeContractType")),
                    trade_date=_coerce_period_end(row.get("acqtoDt")) or _coerce_period_start(row.get("acqfromDt")),
                    intimation_date=coerce_date(row.get("intimDt")),
                    filed_at=coerce_datetime(row.get("date")),
                    disclosure_id=_clean_text(row.get("did")),
                    person_id=_clean_text(row.get("pid")),
                    xbrl_url=_clean_text(row.get("xbrl")),
                    remarks=_clean_text(row.get("remarks")),
                    raw=dict(row),
                )
            )
        except Exception as exc:  # pragma: no cover - defensive per-row guard
            skipped += 1
            log.debug("[radar] PIT row skipped: %s", exc)
    if skipped:
        log.info("[radar] PIT parse: %d rows skipped of %d", skipped, len(records))
    return out


def parse_sast_payload(payload: Any) -> List[SastDisclosure]:
    """Parse a ``corporate-sast-reg29`` envelope into :class:`SastDisclosure` records."""
    records = _iter_records(payload, "data")
    out: List[SastDisclosure] = []
    skipped = 0
    for row in records:
        try:
            symbol = normalize_symbol(row.get("symbol"))
            if not symbol:
                skipped += 1
                continue
            reg_text = str(row.get("regType") or "").upper()
            if "31" in reg_text or "32" in reg_text:
                regime = DisclosureRegime.SAST_31_32
            elif "29" in reg_text:
                regime = DisclosureRegime.SAST_29
            else:
                regime = DisclosureRegime.UNKNOWN
            direction = classify_trade_direction(row.get("acqSaleType"))
            if direction is TradeDirection.NEUTRAL:
                # Reg 31/32 encumbrance rows carry neither marker reliably.
                if coerce_float(row.get("noOfShareAcq")) and not coerce_float(row.get("noOfShareSale")):
                    direction = TradeDirection.BUY
                elif coerce_float(row.get("noOfShareSale")):
                    direction = TradeDirection.SELL
            out.append(
                SastDisclosure(
                    symbol=symbol,
                    company=_clean_text(row.get("company")),
                    acquirer_name=_clean_text(row.get("acquirerName")),
                    regulation=_clean_text(row.get("regType")) or "Reg29",
                    regime=regime,
                    acquirer_is_promoter=coerce_bool_flag(row.get("promoterType")),
                    acquirer_category=classify_person_category(
                        row.get("promoterType"), row.get("promoterType")
                    ),
                    deal_direction=direction,
                    channel=classify_acquisition_mode(row.get("acquisitionMode")),
                    period_start=_coerce_period_start(row.get("acquirerDate")),
                    period_end=_coerce_period_end(row.get("acquirerDate")),
                    shares_acquired=coerce_float(row.get("noOfShareAcq")),
                    shares_sold=coerce_float(row.get("noOfShareSale")),
                    shares_after=coerce_float(row.get("noOfShareAft")),
                    pct_acquired=coerce_float(row.get("totAcqShare")),
                    pct_sold=coerce_float(row.get("totSaleShare")),
                    pct_after=coerce_float(row.get("totAftShare")),
                    pct_after_diluted=coerce_float(row.get("totAftDiluted")),
                    file_url=_clean_text(row.get("attachement")),
                    application_no=_clean_text(row.get("application_no")),
                    filed_at=coerce_datetime(row.get("timestamp")) or coerce_datetime(row.get("sysTime")),
                    raw=dict(row),
                )
            )
        except Exception as exc:  # pragma: no cover - defensive per-row guard
            skipped += 1
            log.debug("[radar] SAST row skipped: %s", exc)
    if skipped:
        log.info("[radar] SAST parse: %d rows skipped of %d", skipped, len(records))
    return out


def parse_pledged_payload(payload: Any) -> List[PledgeDisclosure]:
    """Parse a ``corporate-pledgedata`` envelope into :class:`PledgeDisclosure`."""
    records = _iter_records(payload, "data")
    out: List[PledgeDisclosure] = []
    for row in records:
        try:
            symbol = normalize_symbol(
                row.get("symbol") or row.get("Symbol") or row.get("ScripCode")
            )
            if not symbol:
                continue
            out.append(
                PledgeDisclosure(
                    symbol=symbol,
                    company=_clean_text(row.get("comName") or row.get("company") or row.get("SymbolName")),
                    promoter_name=_clean_text(row.get("promoterName") or row.get("PromoterName")),
                    promoter_category=classify_person_category(
                        row.get("promoterCategory") or row.get("PromoterCategory")
                    ),
                    pledged_qty=coerce_float(
                        row.get("pledgedQuantity") or row.get("PledgedQty") or row.get("pledgeQty")
                    ),
                    total_holding=coerce_float(
                        row.get("totalHolding") or row.get("TotalHolding") or row.get("promoterHolding")
                    ),
                    pct_pledged=coerce_float(
                        row.get("pledgePercentage") or row.get("PledgePerc") or row.get("pctPledged")
                    ),
                    as_on=coerce_date(row.get("asOnDate") or row.get("reportDate") or row.get("Date")),
                    raw=dict(row),
                )
            )
        except Exception as exc:  # pragma: no cover - defensive
            log.debug("[radar] pledge row skipped: %s", exc)
    return out


_NO_RECORDS_TOKENS = ("no records", "no record", "no data")


def parse_deal_csv(csv_text: str, kind: DealKind, source: str = "nse") -> List[LargeDeal]:
    """
    Parse the NSE bulk/block deal CSV.

    Handles the exchange's empty-session sentinel row (``NO RECORDS,,,,,,``),
    the 20-character truncation NSE applies to ``Security Name``, and header
    aliases across the bulk/block variants.
    """
    if not csv_text or not csv_text.strip():
        return []
    out: List[LargeDeal] = []
    reader = csv.reader(io.StringIO(csv_text))
    try:
        header = next(reader)
    except StopIteration:
        return []

    header_norm = [_normalize_header(h) for h in header]
    idx = {name: position for position, name in enumerate(header_norm)}

    def pick(row: Sequence[str], *names: str) -> Optional[str]:
        for name in names:
            position = idx.get(name)
            if position is not None and position < len(row):
                cell = row[position].strip()
                if cell:
                    return cell
        return None

    for row in reader:
        if not row or all(not str(cell).strip() for cell in row):
            continue
        # The empty-session sentinel occupies the first cell only.
        if any(token in str(row[0]).strip().lower() for token in _NO_RECORDS_TOKENS):
            continue

        symbol = normalize_symbol(pick(row, "symbol", "scrip"))
        if not symbol:
            continue

        client_raw = pick(row, "clientname", "client")
        quantity = coerce_float(pick(row, "quantitytraded", "quantity"))
        price = coerce_float(
            pick(row, "tradepricewghtavgprice", "tradepricewghtavg", "tradeprice", "price")
        )
        notional = None
        if quantity is not None and price is not None:
            notional = abs(quantity) * price
        elif quantity is not None and not is_nullish(client_raw):
            # Quantity alone still identifies flow direction and size.
            notional = None

        side = classify_trade_direction(pick(row, "buysell", "side"))
        if side is TradeDirection.NEUTRAL:
            side = TradeDirection.NEUTRAL

        out.append(
            LargeDeal(
                kind=kind,
                deal_date=coerce_date(pick(row, "date", "dealdate", "tradedate")),
                symbol=symbol,
                security_name=_clean_text(pick(row, "securityname", "security")),
                client_name=_clean_text(client_raw),
                client_name_normalized=normalize_client_name(client_raw),
                side=side,
                quantity=abs(quantity) if quantity is not None else None,
                price=price,
                notional_inr=notional,
                remarks=_clean_text(pick(row, "remarks", "remark")),
                archetype=classify_investor(client_raw),
                source=source,
            )
        )
    return out


def parse_largedeal_payload(payload: Any, source: str = "nse") -> List[LargeDeal]:
    """
    Parse the ``snapshot-capital-market-largedeal`` envelope.

    The snapshot carries bulk, block and short books in parallel arrays. Short
    rows legitimately have null client/price/remarks, and are retained with a
    neutral side so the short-interest aggregate stays correct.
    """
    out: List[LargeDeal] = []
    if not isinstance(payload, dict):
        return out
    books: Tuple[Tuple[str, DealKind], ...] = (
        ("BULK_DEALS_DATA", DealKind.BULK),
        ("BLOCK_DEALS_DATA", DealKind.BLOCK),
        ("SHORT_DEALS_DATA", DealKind.SHORT),
    )
    for key, kind in books:
        rows = payload.get(key)
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            try:
                symbol = normalize_symbol(row.get("symbol"))
                if not symbol:
                    continue
                client_raw = row.get("clientName")
                quantity = coerce_float(row.get("qty"))
                price = coerce_float(row.get("watp"))
                out.append(
                    LargeDeal(
                        kind=kind,
                        deal_date=coerce_date(row.get("date")),
                        symbol=symbol,
                        security_name=_clean_text(row.get("name")),
                        client_name=_clean_text(client_raw),
                        client_name_normalized=normalize_client_name(client_raw),
                        side=classify_trade_direction(row.get("buySell")),
                        quantity=abs(quantity) if quantity is not None else None,
                        price=price,
                        notional_inr=(abs(quantity) * price) if (quantity is not None and price is not None) else None,
                        remarks=_clean_text(row.get("remarks")),
                        archetype=classify_investor(client_raw),
                        source=source,
                    )
                )
            except Exception as exc:  # pragma: no cover - defensive
                log.debug("[radar] largedeal row skipped: %s", exc)
    return out


def _clean_text(value: Any) -> Optional[str]:
    if is_nullish(value):
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or None


def _normalize_header(header: str) -> str:
    return re.sub(r"[^a-z]", "", str(header).lower())


def _coerce_period_start(value: Any) -> Optional[date]:
    """Parse the leading date of a SAST period such as ``"23-SEP-2026 to 23-SEP-2026"``."""
    if is_nullish(value):
        return None
    return coerce_date(str(value).split(" to ")[0])


def _coerce_period_end(value: Any) -> Optional[date]:
    """Parse the trailing date of a SAST period string."""
    if is_nullish(value):
        return None
    text = str(value)
    if " to " in text:
        return coerce_date(text.split(" to ")[1])
    return coerce_date(text)


# ---------------------------------------------------------------------------
# Conviction model
# ---------------------------------------------------------------------------

# Factor weights. These sum to 1.0 on the *positive* side; the conviction score
# is assembled as a signed sum so distribution signals subtract.
FACTOR_WEIGHTS: Dict[str, float] = {
    "insider_net_direction": 0.26,
    "promoter_participation": 0.20,
    "holding_delta_magnitude": 0.12,
    "channel_quality": 0.08,
    "cluster_strength": 0.09,
    "disclosure_timeliness": 0.07,
    "institutional_confirmation": 0.16,
    "sast_alignment": 0.10,
    "encumbrance_pressure": 0.12,
}

# Archetype trust weights for institutional confirmation. UNKNOWN is neutral so
# an unclassifiable client name can never manufacture a signal.
ARCHETYPE_TRUST: Dict[InvestorArchetype, float] = {
    InvestorArchetype.MUTUAL_FUND: 1.00,
    InvestorArchetype.FOREIGN_PORTFOLIO: 0.95,
    InvestorArchetype.INSURANCE_PENSION: 0.80,
    InvestorArchetype.PE_VC: 0.70,
    InvestorArchetype.BROKER_PROP: 0.45,
    InvestorArchetype.INSTITUTIONAL_BANK: 0.35,
    InvestorArchetype.HEDGE_FUND_PROXY: 0.25,
    InvestorArchetype.PROPRIETARY_DESK: 0.10,
    InvestorArchetype.FAMILY_OFFICE: 0.15,
    InvestorArchetype.RETAIL_HUF: -0.30,
    InvestorArchetype.UNKNOWN: 0.0,
}

# Non-market acquisition channels are informative but weakly directional.
CHANNEL_CONVICTION: Dict[AcquisitionChannel, float] = {
    AcquisitionChannel.OPEN_MARKET: 1.00,
    AcquisitionChannel.TAKEOVER: 0.80,
    AcquisitionChannel.TRANSFER: 0.35,
    AcquisitionChannel.RIGHTS: 0.25,
    AcquisitionChannel.BONUS: 0.15,
    AcquisitionChannel.ESOP: 0.10,
    AcquisitionChannel.PLEDGE: 0.0,
    AcquisitionChannel.OTHER: 0.20,
}

ROLE_WEIGHT: Dict[InsiderRole, float] = {
    InsiderRole.PROMOTER: 1.00,
    InsiderRole.PROMOTER_GROUP: 0.85,
    InsiderRole.DIRECTOR: 0.70,
    InsiderRole.KMP: 0.65,
    InsiderRole.TEN_HOLDER: 0.50,
    InsiderRole.EMPLOYEE: 0.25,
    InsiderRole.OTHER: 0.40,
    InsiderRole.UNKNOWN: 0.30,
}


def band_for_score(score: float) -> ConvictionBand:
    """Map a -100..100 conviction score onto an actionable band."""
    if score >= 45:
        return ConvictionBand.CONVICTION_CORE
    if score >= 20:
        return ConvictionBand.STRONG_BUY
    if score >= 5:
        return ConvictionBand.ACCUMULATION
    if score > -5:
        return ConvictionBand.NEUTRAL
    if score > -20:
        return ConvictionBand.DISTRIBUTION
    return ConvictionBand.RISK


class InsiderConvictionEngine:
    """
    Scores institutional-insider conviction per symbol with full attribution.

    The model is deliberately additive and interpretable rather than a black
    box: every factor returns a signed point contribution plus a human-readable
    rationale, and the caller receives the complete factor list alongside the
    scalar score. Weights live in :data:`FACTOR_WEIGHTS` so they can be tuned
    without touching scoring logic.

    Absent inputs reduce ``data_quality`` rather than silently scoring zero,
    so a symbol with only one weak disclosure can never be mistaken for a
    high-conviction name.
    """

    def __init__(
        self,
        lookback_days: int = 180,
        calendar: TradingCalendar = DEFAULT_CALENDAR,
        min_disclosures_for_full_confidence: int = 4,
    ) -> None:
        self.lookback_days = max(1, int(lookback_days))
        self.calendar = calendar
        self.min_disclosures = max(1, int(min_disclosures_for_full_confidence))

    # -- public API --------------------------------------------------------

    def score(
        self,
        symbol: str,
        pit: Sequence[PitDisclosure],
        sast: Sequence[SastDisclosure],
        pledges: Sequence[PledgeDisclosure],
        deals: Sequence[LargeDeal],
        as_of: Optional[datetime] = None,
    ) -> InsiderConvictionScore:
        """Score one symbol from all four signal families."""
        moment = as_of or datetime.now()
        cutoff = moment.date() - timedelta(days=self.lookback_days)

        # Every family is filtered to THIS symbol. score_all() hands the engine
        # the full cross-section, so an unfiltered read here would give every
        # symbol the same market-wide aggregate.
        pit_rows = [
            d for d in pit
            if d.symbol == symbol and d.trade_date and d.trade_date >= cutoff
        ]
        if not pit_rows:
            # Fall back to the symbol's most recent filings when the whole
            # window predates the cutoff, so an old-but-material signal is not
            # silently discarded.
            pit_rows = [d for d in pit if d.symbol == symbol][-20:]
        sast_rows = [
            d for d in sast
            if d.symbol == symbol and d.period_end and d.period_end >= cutoff
        ]
        pledge_rows = [p for p in pledges if p.symbol == symbol]
        deal_rows = [
            d for d in deals
            if d.symbol == symbol and d.deal_date and d.deal_date >= cutoff
        ]

        factors: List[FactorContribution] = []

        # Flow magnitude basis. The direction factor is a net/gross *ratio*, which
        # is scale-invariant but NOT unit-invariant — summing percentage points
        # together with share counts would distort it. So one unit is chosen per
        # symbol: shares when the disclosure carries share quantities,
        # otherwise the percentage-point delta of the same holdings.
        share_flows = [d.net_shares for d in pit_rows]
        if any(abs(v) > 0.0 for v in share_flows):
            unit = "shares"
            flows = share_flows
        else:
            unit = "pct_points"
            flows = [
                d.holding_pct_delta
                if d.holding_pct_delta is not None
                else (1.0 if d.transaction_type is TradeDirection.BUY else -1.0 if d.transaction_type is TradeDirection.SELL else 0.0)
                for d in pit_rows
            ]

        # Pair each disclosure with its flow so downstream factors never have to
        # recompute (and potentially disagree about) the magnitude.
        paired: List[Tuple[PitDisclosure, float]] = list(zip(pit_rows, flows))
        buys = [d for d, flow in paired if flow > 0]
        sells = [d for d, flow in paired if flow < 0]
        promoter_buys = [d for d, flow in paired if flow > 0 and d.is_promoter_group]
        promoter_sells = [d for d, flow in paired if flow < 0 and d.is_promoter_group]
        distinct_insiders = {d.person_name for d in pit_rows if d.person_name}

        gross_buy = sum(abs(flow) for flow in flows if flow > 0)
        gross_sell = sum(abs(flow) for flow in flows if flow < 0)
        gross_flow = gross_buy + gross_sell
        net_shares = gross_buy - gross_sell
        net_share_quantity = sum(share_flows) if unit == "shares" else 0.0
        buy_value = sum(max(0.0, d.net_value_inr) for d in buys)
        sell_value = sum(max(0.0, -d.net_value_inr) for d in sells)
        net_value = buy_value - sell_value

        # F1 — insider net direction.
        direction_ratio = (net_shares / gross_flow) if gross_flow > 0 else 0.0
        f1_points = clamp(direction_ratio, -1.0, 1.0) * FACTOR_WEIGHTS["insider_net_direction"] * 100.0
        factors.append(
            FactorContribution(
                "insider_net_direction",
                FACTOR_WEIGHTS["insider_net_direction"],
                round(direction_ratio, 4),
                f1_points,
                (
                    f"{len(buys)} buy / {len(sells)} sell intimation(s); net {net_shares:,.4g} "
                    f"{unit} ({direction_ratio:+.2f} of gross flow)"
                    if gross_flow > 0
                    else "no usable insider flow in window"
                ),
            )
        )

        # F2 — promoter participation (the highest-information insider class).
        promoter_buy_flow = sum(abs(flow) for d, flow in paired if flow > 0 and d.is_promoter_group)
        promoter_sell_flow = sum(abs(flow) for d, flow in paired if flow < 0 and d.is_promoter_group)
        promoter_gross = promoter_buy_flow + promoter_sell_flow
        promoter_ratio = (
            (promoter_buy_flow - promoter_sell_flow) / promoter_gross if promoter_gross > 0 else 0.0
        )
        promoter_weight = ROLE_WEIGHT[InsiderRole.PROMOTER]
        f2_points = clamp(promoter_ratio, -1.0, 1.0) * FACTOR_WEIGHTS["promoter_participation"] * 100.0 * promoter_weight
        factors.append(
            FactorContribution(
                "promoter_participation",
                FACTOR_WEIGHTS["promoter_participation"],
                round(promoter_ratio, 4),
                f2_points,
                (
                    f"{len(promoter_buys)} promoter buy / {len(promoter_sells)} promoter sell"
                    if promoter_gross > 0
                    else "no promoter-level intimation in window"
                ),
            )
        )

        # F3 — magnitude of the disclosed holding delta (% of equity capital).
        pct_deltas = [
            abs((d.pct_after or 0.0) - (d.pct_before or 0.0))
            for d in pit_rows
            if d.pct_after is not None and d.pct_before is not None
        ]
        max_pct_delta = max(pct_deltas) if pct_deltas else None
        f3_points = (
            clamp(max_pct_delta / 5.0, 0.0, 1.0) * FACTOR_WEIGHTS["holding_delta_magnitude"] * 100.0
            if max_pct_delta is not None
            else 0.0
        )
        factors.append(
            FactorContribution(
                "holding_delta_magnitude",
                FACTOR_WEIGHTS["holding_delta_magnitude"],
                max_pct_delta,
                f3_points,
                (
                    f"largest disclosed holding change {max_pct_delta:.2f}% of equity capital"
                    if max_pct_delta is not None
                    else "disclosures did not carry pre/post holding percentages"
                ),
            )
        )

        # F4 — acquisition channel quality.
        channel_signal = sum(
            CHANNEL_CONVICTION.get(d.channel, 0.2) * (1.0 if d.net_shares > 0 else -1.0)
            for d in pit_rows
        )
        channel_norm = channel_signal / max(1, len(pit_rows))
        f4_points = clamp(channel_norm, -1.0, 1.0) * FACTOR_WEIGHTS["channel_quality"] * 100.0
        factors.append(
            FactorContribution(
                "channel_quality",
                FACTOR_WEIGHTS["channel_quality"],
                round(channel_norm, 4),
                f4_points,
                "open-market acquisitions carry full weight; ESOP/bonus/transfers are discounted",
            )
        )

        # F5 — cluster strength (multiple independent insiders on one name).
        cluster = min(1.0, len(distinct_insiders) / 4.0) if distinct_insiders else 0.0
        cluster_sign = 1.0 if net_shares >= 0 else -1.0
        f5_points = cluster * cluster_sign * FACTOR_WEIGHTS["cluster_strength"] * 100.0
        factors.append(
            FactorContribution(
                "cluster_strength",
                FACTOR_WEIGHTS["cluster_strength"],
                float(len(distinct_insiders)),
                f5_points,
                (
                    f"{len(distinct_insiders)} distinct insider(s) disclosed"
                    if distinct_insiders
                    else "single-insider disclosure only"
                ),
            )
        )

        # F6 — disclosure timeliness (Reg 7(2) two-trading-day rule).
        late = self.late_disclosures(pit_rows)
        timely_ratio = (
            (len(pit_rows) - len(late)) / len(pit_rows) if pit_rows else 0.0
        )
        f6_points = clamp(timely_ratio, 0.0, 1.0) * FACTOR_WEIGHTS["disclosure_timeliness"] * 100.0 * 2.0 - FACTOR_WEIGHTS["disclosure_timeliness"] * 50.0
        factors.append(
            FactorContribution(
                "disclosure_timeliness",
                FACTOR_WEIGHTS["disclosure_timeliness"],
                round(timely_ratio, 4),
                f6_points,
                (
                    f"{len(late)} of {len(pit_rows)} intimation(s) breached the 2-trading-day Reg 7(2) window"
                    if pit_rows
                    else "no intimation dates to test"
                ),
            )
        )

        # F7 — institutional confirmation from disclosed large deals.
        inst_buys = [
            d
            for d in deal_rows
            if d.side is TradeDirection.BUY and ARCHETYPE_TRUST.get(d.archetype, 0.0) > 0
        ]
        inst_sells = [
            d
            for d in deal_rows
            if d.side is TradeDirection.SELL and ARCHETYPE_TRUST.get(d.archetype, 0.0) > 0
        ]
        inst_qty_buy = sum(d.quantity or 0.0 for d in inst_buys)
        inst_qty_sell = sum(d.quantity or 0.0 for d in inst_sells)
        inst_net_qty = inst_qty_buy - inst_qty_sell
        inst_gross = inst_qty_buy + inst_qty_sell
        inst_ratio = (inst_net_qty / inst_gross) if inst_gross > 0 else 0.0
        # Confirmation only counts in the direction the insiders took.
        insider_sign = net_shares if net_shares != 0 else 0.0
        confirm_sign = 1.0 if inst_net_qty * insider_sign >= 0 else -0.5
        f7_points = clamp(inst_ratio, -1.0, 1.0) * FACTOR_WEIGHTS["institutional_confirmation"] * 100.0 * confirm_sign
        factors.append(
            FactorContribution(
                "institutional_confirmation",
                FACTOR_WEIGHTS["institutional_confirmation"],
                round(inst_ratio, 4),
                f7_points,
                (
                    f"{len(inst_buys)} institutional buy leg(s) vs {len(inst_sells)} sell leg(s) "
                    f"in disclosed bulk/block flow"
                    if inst_gross > 0
                    else "no classified institutional bulk/block flow"
                ),
            )
        )

        # F8 — SAST alignment (independent regime corroborating the PIT signal).
        sast_buy = sum(d.shares_acquired or 0.0 for d in sast_rows if d.shares_acquired)
        sast_sell = sum(d.shares_sold or 0.0 for d in sast_rows if d.shares_sold)
        sast_net = sast_buy - sast_sell
        sast_gross = sast_buy + sast_sell
        sast_ratio = (sast_net / sast_gross) if sast_gross > 0 else 0.0
        f8_points = clamp(sast_ratio, -1.0, 1.0) * FACTOR_WEIGHTS["sast_alignment"] * 100.0
        factors.append(
            FactorContribution(
                "sast_alignment",
                FACTOR_WEIGHTS["sast_alignment"],
                round(sast_ratio, 4),
                f8_points,
                (
                    f"SAST Reg 29 net {sast_net:,.0f} sh across {len(sast_rows)} filing(s)"
                    if sast_gross > 0
                    else "no SAST Reg 29 flow in window"
                ),
            )
        )

        # F9 — encumbrance / pledge pressure (a structural negative).
        pledge_pct = 0.0
        for pledge in pledge_rows:
            candidate = pledge.pct_pledged
            if candidate is None and pledge.pledged_qty and pledge.total_holding:
                candidate = (pledge.pledged_qty / pledge.total_holding) * 100.0
            pledge_pct = max(pledge_pct, candidate or 0.0)
        encumbrance_events = len([d for d in sast_rows if d.is_encumbrance])
        encumbrance_penalty = pledge_pct / 100.0 * 100.0
        if encumbrance_events:
            encumbrance_penalty += min(30.0, encumbrance_events * 5.0)
        f9_points = -clamp(encumbrance_penalty, 0.0, 100.0) * FACTOR_WEIGHTS["encumbrance_pressure"]
        factors.append(
            FactorContribution(
                "encumbrance_pressure",
                FACTOR_WEIGHTS["encumbrance_pressure"],
                round(pledge_pct, 3),
                f9_points,
                (
                    f"peak promoter pledge {pledge_pct:.1f}% of holding"
                    + (f"; {encumbrance_events} SAST Reg 31/32 encumbrance event(s)" if encumbrance_events else "")
                    if pledge_pct > 0 or encumbrance_events
                    else "no pledge or encumbrance stress detected"
                ),
            )
        )

        raw_score = sum(f.points for f in factors)
        score = clamp(raw_score, -100.0, 100.0)

        # Data quality: how much of the intended evidence base was actually present.
        expected = self.min_disclosures
        present = min(len(pit_rows), expected)
        quality = 0.40 * (present / expected)
        if sast_rows:
            quality += 0.20
        if inst_gross > 0:
            quality += 0.20
        if pledge_rows:
            quality += 0.10
        if deal_rows:
            quality += 0.10
        quality = clamp(quality, 0.0, 1.0)

        return InsiderConvictionScore(
            symbol=symbol,
            score=score,
            band=band_for_score(score),
            as_of=moment,
            insider_buys=len(buys),
            insider_sells=len(sells),
            promoter_buys=len(promoter_buys),
            promoter_sells=len(promoter_sells),
            net_insider_shares=net_share_quantity,
            net_insider_value_inr=net_value,
            distinct_insiders=len(distinct_insiders),
            late_disclosure_count=len(late),
            pledge_pressure_pct=pledge_pct or None,
            institutional_net_quantity=inst_net_qty,
            institutional_net_notional_inr=sum(
                (d.notional_inr or 0.0) * (1.0 if d.side is TradeDirection.BUY else -1.0)
                for d in inst_buys + inst_sells
            ),
            institutional_buyer_count=len(inst_buys),
            sast_acquisition_events=len([d for d in sast_rows if d.shares_acquired]),
            sast_disposal_events=len([d for d in sast_rows if d.shares_sold]),
            encumbrance_events=encumbrance_events,
            factors=tuple(factors),
            data_quality=quality,
            provenance={
                "lookback_days": self.lookback_days,
                "flow_unit": unit,
                "pit_rows_considered": len(pit_rows),
                "sast_rows_considered": len(sast_rows),
                "deal_rows_considered": len(deal_rows),
                "pledge_rows_considered": len(pledge_rows),
                "regime_window_start": cutoff.isoformat(),
            },
        )

    def score_all(
        self,
        pit: Sequence[PitDisclosure],
        sast: Sequence[SastDisclosure],
        pledges: Sequence[PledgeDisclosure],
        deals: Sequence[LargeDeal],
        as_of: Optional[datetime] = None,
        top_n: int = 25,
        min_data_quality: float = 0.0,
    ) -> List[InsiderConvictionScore]:
        """Score every symbol present in any signal family, strongest first."""
        moment = as_of or datetime.now()
        symbols: Set[str] = set()
        for collection in (pit, sast, pledges, deals):
            for item in collection:
                symbol = getattr(item, "symbol", None)
                if symbol:
                    symbols.add(symbol)

        scores: List[InsiderConvictionScore] = []
        for symbol in sorted(symbols):
            try:
                result = self.score(symbol, pit, sast, pledges, deals, as_of=moment)
            except Exception as exc:  # pragma: no cover - defensive per-symbol guard
                log.warning("[radar] scoring failed for %s: %s", symbol, exc)
                continue
            if result.data_quality < min_data_quality:
                continue
            scores.append(result)
        scores.sort(key=lambda s: (-s.score, -s.data_quality))
        return scores[:top_n] if top_n > 0 else scores

    def late_disclosures(
        self,
        disclosures: Sequence[PitDisclosure],
        calendar: Optional[TradingCalendar] = None,
    ) -> List[PitDisclosure]:
        """
        Reg 7(2) compliance test: intimation due within two trading days of the
        transaction. Rows with only an end-of-period date are checked against the
        period start so the stricter of the two is enforced.
        """
        cal = calendar or self.calendar
        late: List[PitDisclosure] = []
        for d in disclosures:
            trade_date = d.trade_date
            intimation = d.intimation_date
            if trade_date is None or intimation is None:
                continue
            deadline = cal.disclosure_deadline(trade_date)
            if intimation > deadline:
                late.append(d)
        return late


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS pit_disclosures (
    fingerprint      TEXT PRIMARY KEY,
    symbol           TEXT NOT NULL,
    company          TEXT,
    person_name      TEXT,
    person_role      TEXT,
    regulation       TEXT,
    transaction_type TEXT,
    channel          TEXT,
    shares_acquired  REAL,
    shares_sold      REAL,
    value_inr        REAL,
    pct_before       REAL,
    pct_after        REAL,
    trade_date       TEXT,
    intimation_date  TEXT,
    filed_at         TEXT,
    disclosure_id    TEXT,
    xbrl_url         TEXT,
    payload_json     TEXT,
    ingested_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pit_symbol ON pit_disclosures (symbol, trade_date);
CREATE INDEX IF NOT EXISTS idx_pit_filed ON pit_disclosures (ingested_at);

CREATE TABLE IF NOT EXISTS sast_disclosures (
    fingerprint      TEXT PRIMARY KEY,
    symbol           TEXT NOT NULL,
    company          TEXT,
    acquirer_name    TEXT,
    regulation       TEXT,
    regime           TEXT,
    is_promoter      INTEGER,
    deal_direction   TEXT,
    channel          TEXT,
    shares_acquired  REAL,
    shares_sold      REAL,
    shares_after     REAL,
    pct_after        REAL,
    period_start     TEXT,
    period_end       TEXT,
    file_url         TEXT,
    ingested_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sast_symbol ON sast_disclosures (symbol, period_end);

CREATE TABLE IF NOT EXISTS large_deals (
    fingerprint  TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    deal_date    TEXT,
    symbol       TEXT,
    client_name  TEXT,
    side         TEXT,
    quantity     REAL,
    price        REAL,
    notional_inr REAL,
    archetype    TEXT,
    source       TEXT,
    ingested_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deal_symbol ON large_deals (symbol, deal_date);

CREATE TABLE IF NOT EXISTS conviction_scores (
    symbol       TEXT NOT NULL,
    as_of        TEXT NOT NULL,
    score        REAL NOT NULL,
    band         TEXT,
    data_quality REAL,
    factors_json TEXT,
    payload_json TEXT,
    PRIMARY KEY (symbol, as_of)
);
CREATE INDEX IF NOT EXISTS idx_score_asof ON conviction_scores (as_of);

CREATE TABLE IF NOT EXISTS ingest_state (
    source     TEXT NOT NULL,
    last_ok_at INTEGER,
    last_error TEXT,
    PRIMARY KEY (source)
);
"""


def _fingerprint(*parts: Any) -> str:
    """Stable dedup key across re-ingestions of the same upstream disclosure."""
    return "|".join("" if p is None else str(p) for p in parts)


class RadarStore:
    """
    Idempotent SQLite sink for disclosures, deals, scores and ingest health.

    Uses the bridge's documented "service owns its own database file" pattern
    (``services/journedge_provider.py``) so this module adds no schema-version
    coupling to the shared ``cache.db``.
    """

    def __init__(self, db_path: str = DB_PATH) -> None:
        self.db_path = db_path
        self._lock = threading.Lock()
        self._ready = False

    def connect(self, write: bool = False) -> sqlite3.Connection:
        directory = os.path.dirname(self.db_path)
        if directory and not os.path.isdir(directory):
            os.makedirs(directory, exist_ok=True)
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        if write:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def ensure_schema(self) -> None:
        if self._ready:
            return
        with self._lock:
            if self._ready:
                return
            conn = self.connect(write=True)
            try:
                conn.executescript(_SCHEMA)
                conn.commit()
            finally:
                conn.close()
            self._ready = True

    # -- writes ------------------------------------------------------------

    def save_pit(self, records: Sequence[PitDisclosure]) -> int:
        self.ensure_schema()
        rows = []
        now = int(time.time())
        for d in records:
            rows.append(
                (
                    _fingerprint("pit", d.symbol, d.disclosure_id, d.person_id, d.trade_date,
                                 d.buy_quantity, d.sell_quantity, d.regulation),
                    d.symbol,
                    d.company,
                    d.person_name,
                    d.person_role.value,
                    d.regulation,
                    d.transaction_type.value,
                    d.channel.value,
                    d.shares_acquired,
                    d.shares_sold,
                    d.value_inr,
                    d.pct_before,
                    d.pct_after,
                    d.trade_date.isoformat() if d.trade_date else None,
                    d.intimation_date.isoformat() if d.intimation_date else None,
                    d.filed_at.isoformat() if d.filed_at else None,
                    d.disclosure_id,
                    d.xbrl_url,
                    json.dumps(d.to_dict(), default=str),
                    now,
                )
            )
        return self._executemany(
            "INSERT OR REPLACE INTO pit_disclosures ("
            "fingerprint,symbol,company,person_name,person_role,regulation,"
            "transaction_type,channel,shares_acquired,shares_sold,value_inr,"
            "pct_before,pct_after,trade_date,intimation_date,filed_at,"
            "disclosure_id,xbrl_url,payload_json,ingested_at"
            ") VALUES (" + ",".join("?" * 20) + ")",
            rows,
        )

    def save_sast(self, records: Sequence[SastDisclosure]) -> int:
        self.ensure_schema()
        rows = []
        now = int(time.time())
        for d in records:
            rows.append(
                (
                    _fingerprint("sast", d.symbol, d.acquirer_name, d.regulation, d.period_start,
                                 d.period_end, d.shares_acquired, d.shares_sold),
                    d.symbol,
                    d.company,
                    d.acquirer_name,
                    d.regulation,
                    d.regime.value,
                    None if d.acquirer_is_promoter is None else int(d.acquirer_is_promoter),
                    d.deal_direction.value,
                    d.channel.value,
                    d.shares_acquired,
                    d.shares_sold,
                    d.shares_after,
                    d.pct_after,
                    d.period_start.isoformat() if d.period_start else None,
                    d.period_end.isoformat() if d.period_end else None,
                    d.file_url,
                    now,
                )
            )
        return self._executemany(
            "INSERT OR REPLACE INTO sast_disclosures ("
            "fingerprint,symbol,company,acquirer_name,regulation,regime,is_promoter,"
            "deal_direction,channel,shares_acquired,shares_sold,shares_after,"
            "pct_after,period_start,period_end,file_url,ingested_at"
            ") VALUES (" + ",".join("?" * 17) + ")",
            rows,
        )

    def save_deals(self, records: Sequence[LargeDeal]) -> int:
        self.ensure_schema()
        rows = []
        now = int(time.time())
        for d in records:
            rows.append(
                (
                    _fingerprint("deal", d.kind.value, d.source, d.deal_date, d.symbol,
                                 d.client_name_normalized, d.side.value, d.quantity, d.price),
                    d.kind.value,
                    d.deal_date.isoformat() if d.deal_date else None,
                    d.symbol,
                    d.client_name,
                    d.side.value,
                    d.quantity,
                    d.price,
                    d.notional_inr,
                    d.archetype.value,
                    d.source,
                    now,
                )
            )
        return self._executemany(
            "INSERT OR REPLACE INTO large_deals ("
            "fingerprint,kind,deal_date,symbol,client_name,side,quantity,price,"
            "notional_inr,archetype,source,ingested_at"
            ") VALUES (" + ",".join("?" * 12) + ")",
            rows,
        )

    def save_scores(self, scores: Sequence[InsiderConvictionScore]) -> int:
        self.ensure_schema()
        rows = []
        for s in scores:
            rows.append(
                (
                    s.symbol,
                    s.as_of.replace(microsecond=0).isoformat(),
                    s.score,
                    s.band.value,
                    s.data_quality,
                    json.dumps([f.to_dict() for f in s.factors]),
                    json.dumps(s.to_dict(), default=str),
                )
            )
        return self._executemany(
            "INSERT OR REPLACE INTO conviction_scores ("
            "symbol,as_of,score,band,data_quality,factors_json,payload_json"
            ") VALUES (" + ",".join("?" * 7) + ")",
            rows,
        )

    def mark_source(self, source: str, ok: bool, error: Optional[str] = None) -> None:
        self.ensure_schema()
        conn = self.connect(write=True)
        try:
            conn.execute(
                "INSERT OR REPLACE INTO ingest_state (source, last_ok_at, last_error) VALUES (?,?,?)",
                (source, int(time.time()) if ok else None, error),
            )
            conn.commit()
        except Exception as exc:  # pragma: no cover - defensive
            log.warning("[radar] mark_source(%s) failed: %s", source, exc)
        finally:
            conn.close()

    def _executemany(self, sql: str, rows: Sequence[Tuple[Any, ...]]) -> int:
        if not rows:
            return 0
        conn = self.connect(write=True)
        try:
            with self._lock:
                conn.executemany(sql, rows)
                conn.commit()
            return len(rows)
        except Exception as exc:
            log.warning("[radar] bulk write failed: %s", exc)
            return 0
        finally:
            conn.close()

    # -- reads -------------------------------------------------------------

    def recent_pit(self, symbol: Optional[str] = None, days: int = 180, limit: int = 500) -> List[PitDisclosure]:
        self.ensure_schema()
        conn = self.connect()
        try:
            clauses = ["ingested_at >= ?"]
            params: List[Any] = [int(time.time()) - days * 86400]
            if symbol:
                clauses.append("symbol = ?")
                params.append(symbol)
            params.append(limit)
            query = (
                "SELECT payload_json FROM pit_disclosures WHERE "
                + " AND ".join(clauses)
                + " ORDER BY trade_date DESC LIMIT ?"
            )
            return [
                _pit_from_dict(json.loads(row["payload_json"]))
                for row in conn.execute(query, params)
            ]
        except Exception as exc:
            log.warning("[radar] recent_pit failed: %s", exc)
            return []
        finally:
            conn.close()

    def source_health(self) -> Dict[str, Any]:
        self.ensure_schema()
        conn = self.connect()
        try:
            return {
                row["source"]: {
                    "last_ok_at": row["last_ok_at"],
                    "last_error": row["last_error"],
                }
                for row in conn.execute("SELECT * FROM ingest_state")
            }
        except Exception as exc:  # pragma: no cover - defensive
            log.warning("[radar] source_health failed: %s", exc)
            return {}
        finally:
            conn.close()


def _pit_from_dict(payload: Mapping[str, Any]) -> PitDisclosure:
    """Rehydrate a persisted PIT record (used by offline replays and backtests)."""
    return PitDisclosure(
        symbol=payload.get("symbol"),
        company=payload.get("company"),
        person_name=payload.get("person_name"),
        person_role=InsiderRole(payload.get("person_role") or InsiderRole.UNKNOWN.value),
        regulation=payload.get("regulation") or "7(2)",
        transaction_type=TradeDirection(payload.get("transaction_type") or TradeDirection.NEUTRAL.value),
        channel=AcquisitionChannel(payload.get("channel") or AcquisitionChannel.OTHER.value),
        securities_type=payload.get("securities_type"),
        shares_acquired=payload.get("shares_acquired"),
        shares_sold=payload.get("shares_sold"),
        value_inr=payload.get("value_inr"),
        buy_quantity=payload.get("buy_quantity"),
        buy_value=payload.get("buy_value"),
        sell_quantity=payload.get("sell_quantity"),
        sell_value=payload.get("sell_value"),
        shares_before=payload.get("shares_before"),
        pct_before=payload.get("pct_before"),
        shares_after=payload.get("shares_after"),
        pct_after=payload.get("pct_after"),
        derivative_type=payload.get("derivative_type"),
        derivative_contract=payload.get("derivative_contract"),
        trade_date=coerce_date(payload.get("trade_date")),
        intimation_date=coerce_date(payload.get("intimation_date")),
        filed_at=coerce_datetime(payload.get("filed_at")),
        disclosure_id=payload.get("disclosure_id"),
        person_id=payload.get("person_id"),
        xbrl_url=payload.get("xbrl_url"),
        remarks=payload.get("remarks"),
        raw=dict(payload),
    )


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


class SebiInsiderRadar:
    """
    Top-level facade: ingest every regulatory signal family, then score.

    Typical bridge usage::

        radar = SebiInsiderRadar()
        snapshot = radar.scan()
        for score in snapshot.scores:
            ...  # score.factors carries full attribution

    ``scan`` never raises: a source that is blocked, rate-limited or offline is
    recorded in ``sources_degraded`` and the remaining families still produce a
    usable radar picture.
    """

    def __init__(
        self,
        fetcher: Optional[ResilientFetcher] = None,
        store: Optional[RadarStore] = None,
        engine: Optional[InsiderConvictionEngine] = None,
        persist: bool = True,
        include_bse: bool = True,
    ) -> None:
        self.fetcher = fetcher or ResilientFetcher()
        self.store = store or RadarStore()
        self.engine = engine or InsiderConvictionEngine()
        self.persist = persist
        self.include_bse = include_bse
        self._calendar = DEFAULT_CALENDAR

    def set_trading_holidays(self, holidays: Iterable[date]) -> None:
        """Inject the exchange holiday calendar used for Reg 7(2) deadline maths."""
        self._calendar = TradingCalendar(holidays)
        self.engine.calendar = self._calendar

    # -- individual ingestion ---------------------------------------------

    def fetch_pit(
        self,
        symbol: Optional[str] = None,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
    ) -> Tuple[List[PitDisclosure], FetchOutcome]:
        """Ingest SEBI PIT Reg 7(2) intimations from the exchange."""
        url = f"{NSE_PIT_URL}?index=equities"
        if symbol:
            url += f"&symbol={normalize_symbol(symbol)}"
        params: List[str] = []
        if from_date:
            params.append(f"from_date={from_date.strftime('%d-%m-%Y')}")
        if to_date:
            params.append(f"to_date={to_date.strftime('%d-%m-%Y')}")
        if params:
            url += "&" + "&".join(params)
        outcome = self.fetcher.get_json(url, "nse_pit")
        if not outcome.ok:
            self._mark("nse_pit", outcome)
            return [], outcome
        records = parse_pit_payload(outcome.payload)
        # Drop the (potentially multi-megabyte) upstream payload once parsed.
        outcome = replace(outcome, payload={"records": len(records)})
        self._persist(self.store.save_pit(records), "pit")
        self._mark("nse_pit", outcome)
        log.info("[radar] PIT: %d disclosure(s)", len(records))
        return records, outcome

    def fetch_sast(
        self,
        symbol: Optional[str] = None,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
    ) -> Tuple[List[SastDisclosure], FetchOutcome]:
        """Ingest SAST Reg 29 substantial-acquisition / takeover disclosures."""
        url = f"{NSE_SAST_URL}?index=equities"
        if symbol:
            url += f"&symbol={normalize_symbol(symbol)}"
        params: List[str] = []
        if from_date:
            params.append(f"from_date={from_date.strftime('%d-%m-%Y')}")
        if to_date:
            params.append(f"to_date={to_date.strftime('%d-%m-%Y')}")
        if params:
            url += "&" + "&".join(params)
        outcome = self.fetcher.get_json(url, "nse_sast")
        if not outcome.ok:
            self._mark("nse_sast", outcome)
            return [], outcome
        records = parse_sast_payload(outcome.payload)
        # Drop the (potentially multi-megabyte) upstream payload once parsed.
        outcome = replace(outcome, payload={"records": len(records)})
        self._persist(self.store.save_sast(records), "sast")
        self._mark("nse_sast", outcome)
        log.info("[radar] SAST: %d disclosure(s)", len(records))
        return records, outcome

    def fetch_pledges(self, symbol: str) -> Tuple[List[PledgeDisclosure], FetchOutcome]:
        """Fetch the promoter encumbrance (pledge) snapshot for one company."""
        sym = normalize_symbol(symbol)
        outcome = self.fetcher.get_json(
            f"{NSE_PLEDGED_URL}?index=equities&symbol={sym}", "nse_pledge"
        )
        if not outcome.ok:
            self._mark("nse_pledge", outcome)
            return [], outcome
        records = parse_pledged_payload(outcome.payload)
        # Drop the (potentially multi-megabyte) upstream payload once parsed.
        outcome = replace(outcome, payload={"records": len(records)})
        self._mark("nse_pledge", outcome)
        return records, outcome

    def fetch_nse_bulk_deals(self) -> Tuple[List[LargeDeal], FetchOutcome]:
        """Ingest NSE bulk deals (>= 0.5% of issued capital on either side)."""
        outcome = self.fetcher.get_text(
            NSE_BULK_CSV_URL, "nse_bulk_csv", accept="text/csv, text/plain, */*",
            force_warm=True,
        )
        if not outcome.ok:
            self._mark("nse_bulk_csv", outcome)
            return [], outcome
        deals = parse_deal_csv(str(outcome.payload), DealKind.BULK, source="nse_archives")
        self._persist(self.store.save_deals(deals), "bulk")
        self._mark("nse_bulk_csv", outcome)
        log.info("[radar] bulk deals: %d row(s)", len(deals))
        return deals, outcome

    def fetch_nse_block_deals(self) -> Tuple[List[LargeDeal], FetchOutcome]:
        """Ingest NSE block deals (odd-lot 'BL' window)."""
        outcome = self.fetcher.get_text(
            NSE_BLOCK_CSV_URL, "nse_block_csv", accept="text/csv, text/plain, */*",
            force_warm=True,
        )
        if not outcome.ok:
            self._mark("nse_block_csv", outcome)
            return [], outcome
        deals = parse_deal_csv(str(outcome.payload), DealKind.BLOCK, source="nse_archives")
        self._persist(self.store.save_deals(deals), "block")
        self._mark("nse_block_csv", outcome)
        log.info("[radar] block deals: %d row(s)", len(deals))
        return deals, outcome

    def fetch_largedeal_snapshot(self) -> Tuple[List[LargeDeal], FetchOutcome]:
        """
        Ingest the combined bulk/block/short snapshot in a single request.

        This is the primary large-deal source because it returns all three books
        atomically with a published ``as_on_date``; the CSVs remain as a
        fallback and a cross-check.
        """
        outcome = self.fetcher.get_json(NSE_LARGEDEAL_URL, "nse_largedeal")
        if not outcome.ok:
            self._mark("nse_largedeal", outcome)
            return [], outcome
        deals = parse_largedeal_payload(outcome.payload)
        self._persist(self.store.save_deals(deals), "largedeal")
        self._mark("nse_largedeal", outcome)
        log.info("[radar] large-deal snapshot: %d row(s)", len(deals))
        return deals, outcome

    def fetch_bse_deals(self) -> Tuple[List[LargeDeal], FetchOutcome]:
        """
        Attempt the BSE bulk/block book.

        ``api.bseindia.com`` sits behind Akamai and answers 403 to datacenter
        egress regardless of headers. That is treated as a trippable breaker
        condition: the attempt is recorded as degraded and the radar continues on
        NSE data alone rather than failing the scan.
        """
        outcome = self.fetcher.get_json(
            BSE_BULKBLOCK_URL,
            "bse_bulkblock",
            referer="https://www.bseindia.com/markets/equity/eqreports/bulk_deals",
            force_warm=True,
        )
        if not outcome.ok:
            self._mark("bse_bulkblock", outcome)
            return [], outcome
        deals = self._parse_bse_deals(outcome.payload)
        self._persist(self.store.save_deals(deals), "bse")
        self._mark("bse_bulkblock", outcome)
        return deals, outcome

    @staticmethod
    def _parse_bse_deals(payload: Any) -> List[LargeDeal]:
        """
        Normalise BSE bulk/block rows into :class:`LargeDeal`.

        BSE names its columns differently (``ScripCode``/``Scrip_Name``,
        ``Client_Name``, ``QuantityTraded``, ``TradePrice``) and keys the deal
        type off the ``DealType``/``BulkBlockDealType`` column.
        """
        rows = _iter_records(payload, "Table", "data")
        out: List[LargeDeal] = []
        for row in rows:
            try:
                symbol = normalize_symbol(
                    row.get("ScripCode") or row.get("scrip_code") or row.get("Scrip_Code") or row.get("symbol")
                )
                if not symbol:
                    continue
                raw_kind = str(
                    row.get("DealType") or row.get("BulkBlockDealType") or row.get("Type") or ""
                ).upper()
                kind = DealKind.BLOCK if "BLOCK" in raw_kind else DealKind.BULK
                client_raw = row.get("Client_Name") or row.get("ClientName") or row.get("clientName")
                quantity = coerce_float(row.get("QuantityTraded") or row.get("QtyTraded"))
                price = coerce_float(row.get("TradePrice") or row.get("Trade_Price") or row.get("Price"))
                out.append(
                    LargeDeal(
                        kind=kind,
                        deal_date=coerce_date(row.get("TradeDate") or row.get("DealDate") or row.get("Date")),
                        symbol=symbol,
                        security_name=_clean_text(row.get("Scrip_Name") or row.get("SecurityName")),
                        client_name=_clean_text(client_raw),
                        client_name_normalized=normalize_client_name(client_raw),
                        side=classify_trade_direction(row.get("Buy/Sell") or row.get("BuySell")),
                        quantity=abs(quantity) if quantity is not None else None,
                        price=price,
                        notional_inr=(abs(quantity) * price) if (quantity is not None and price is not None) else None,
                        remarks=_clean_text(row.get("Remarks")),
                        archetype=classify_investor(client_raw),
                        source="bse",
                    )
                )
            except Exception as exc:  # pragma: no cover - defensive
                log.debug("[radar] BSE deal row skipped: %s", exc)
        return out

    # -- orchestration -----------------------------------------------------

    def scan(
        self,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        top_n: int = 25,
        min_data_quality: float = 0.0,
    ) -> RadarSnapshot:
        """Ingest every enabled source and produce a scored radar snapshot."""
        moment = datetime.now()
        pit, pit_outcome = self.fetch_pit(from_date=from_date, to_date=to_date)
        sast, sast_outcome = self.fetch_sast(from_date=from_date, to_date=to_date)
        snapshot_deals, snapshot_outcome = self.fetch_largedeal_snapshot()

        csv_bulk: List[LargeDeal] = []
        csv_block: List[LargeDeal] = []
        csv_attempted = False

        # The snapshot is the richer book; only fall back to the CSVs when it
        # yields nothing, to avoid duplicating every row into the store.
        if not snapshot_deals:
            csv_attempted = True
            csv_bulk, bulk_outcome = self.fetch_nse_bulk_deals()
            csv_block, block_outcome = self.fetch_nse_block_deals()
            snapshot_deals = list(csv_bulk) + list(csv_block)
        else:
            bulk_outcome = FetchOutcome(
                False, None, "nse_bulk_csv", error=None,
                attempted=False,
            )
            block_outcome = FetchOutcome(
                False, None, "nse_block_csv", error=None,
                attempted=False,
            )

        deals: List[LargeDeal] = list(snapshot_deals)
        if self.include_bse:
            bse_deals, bse_outcome = self.fetch_bse_deals()
            deals.extend(bse_deals)
        else:
            bse_outcome = FetchOutcome(
                False, None, "bse_bulkblock", error=None, attempted=False,
            )

        pledges = self._load_pledges_for(pit, sast)

        scores = self.engine.score_all(
            pit, sast, pledges, deals, as_of=moment, top_n=top_n, min_data_quality=min_data_quality
        )
        self._persist(self.store.save_scores(scores), "scores")

        outcomes = {
            "nse_pit": pit_outcome,
            "nse_sast": sast_outcome,
            "nse_largedeal": snapshot_outcome,
            "nse_bulk_csv": bulk_outcome,
            "nse_block_csv": block_outcome,
            "bse_bulkblock": bse_outcome,
        }
        attempted = {name: out for name, out in outcomes.items() if out.attempted}
        sources_ok = {name: out.ok for name, out in attempted.items()}
        degraded = tuple(sorted(name for name, ok in sources_ok.items() if not ok))
        notes = tuple(
            f"{name}: {out.error}" for name, out in attempted.items() if not out.ok and out.error
        )
        if not csv_attempted:
            notes = notes + (
                "nse bulk/block CSVs skipped: the large-deal snapshot returned data, "
                "so the archive fallback was not needed",
            )

        return RadarSnapshot(
            as_of=moment,
            pit_disclosures=tuple(pit),
            sast_disclosures=tuple(sast),
            pledges=tuple(pledges),
            deals=tuple(deals),
            scores=tuple(scores),
            sources_ok=sources_ok,
            sources_degraded=degraded,
            notes=notes,
        )

    def screen_symbol(self, symbol: str, lookback_days: int = 180) -> InsiderConvictionScore:
        """
        Deep-dive one company across every regulatory family.

        Pulls the symbol-scoped PIT and SAST streams plus the pledge snapshot and
        the matching large-deal rows, then returns the attributed score.
        """
        sym = normalize_symbol(symbol)
        if not sym:
            raise ValueError(f"invalid symbol: {symbol!r}")
        moment = datetime.now()
        pit, _ = self.fetch_pit(symbol=sym)
        sast, _ = self.fetch_sast(symbol=sym)
        pledges, _ = self.fetch_pledges(sym)
        deals: List[LargeDeal] = []
        for fetch in (self.fetch_largedeal_snapshot, self.fetch_nse_bulk_deals, self.fetch_nse_block_deals):
            fetched, _ = fetch()
            deals.extend(fetched)
        relevant = [d for d in deals if d.symbol == sym]
        engine = InsiderConvictionEngine(lookback_days=lookback_days, calendar=self._calendar)
        return engine.score(sym, pit, sast, pledges, relevant, as_of=moment)

    # -- internals ---------------------------------------------------------

    def _load_pledges_for(
        self,
        pit: Sequence[PitDisclosure],
        sast: Sequence[SastDisclosure],
        max_symbols: int = 12,
    ) -> List[PledgeDisclosure]:
        """
        Fetch pledge snapshots for the promoter names actually in play.

        Bounded deliberately: the pledge endpoint is per-symbol and rate-limited,
        so we cover the highest-signal names rather than the whole universe.
        """
        promoter_symbols: List[str] = []
        for disclosure in sast:
            if disclosure.acquirer_is_promoter and disclosure.symbol:
                promoter_symbols.append(disclosure.symbol)
        for disclosure in pit:
            if disclosure.is_promoter_group and disclosure.symbol:
                promoter_symbols.append(disclosure.symbol)

        pledges: List[PledgeDisclosure] = []
        for symbol in list(dict.fromkeys(promoter_symbols))[:max_symbols]:
            try:
                records, _ = self.fetch_pledges(symbol)
                pledges.extend(records)
            except Exception as exc:  # pragma: no cover - defensive
                log.debug("[radar] pledge fetch failed for %s: %s", symbol, exc)
        return pledges

    def _mark(self, source: str, outcome: FetchOutcome) -> None:
        if not self.persist:
            return
        try:
            self.store.mark_source(source, outcome.ok, outcome.error)
        except Exception as exc:  # pragma: no cover - defensive
            log.debug("[radar] mark_source failed: %s", exc)

    def _persist(self, written: int, what: str) -> None:
        if self.persist and written:
            log.debug("[radar] persisted %d %s row(s)", written, what)

    def close(self) -> None:
        self.fetcher.close()


# ---------------------------------------------------------------------------
# Module singleton + CLI
# ---------------------------------------------------------------------------

radar = SebiInsiderRadar()


def get_radar() -> SebiInsiderRadar:
    """Accessor for the process-wide radar instance (bridge router convention)."""
    return radar


def _main() -> int:  # pragma: no cover - operator entry point
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="SEBI insider / SAST conviction radar")
    parser.add_argument("--symbol", help="screen a single company end-to-end")
    parser.add_argument("--top", type=int, default=25, help="how many ranked scores to print")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    parser.add_argument("--no-persist", action="store_true", help="skip SQLite writes")
    parser.add_argument("--no-bse", action="store_true", help="skip the BSE bulk/block attempt")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    instance = SebiInsiderRadar(persist=not args.no_persist, include_bse=not args.no_bse)

    if args.symbol:
        try:
            result = instance.screen_symbol(args.symbol)
        except ValueError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        payload = result.to_dict()
        if args.json:
            print(json.dumps(payload, indent=2, default=str))
        else:
            print(f"{payload['symbol']:12} {payload['score']:>7.2f}  {payload['band']}")
            for factor in payload["factors"]:
                print(f"    {factor['name']:28} {factor['points']:>7.2f}  {factor['rationale']}")
        instance.close()
        return 0

    snapshot = instance.scan(top_n=args.top)
    if args.json:
        print(json.dumps(snapshot.to_dict(), indent=2, default=str))
    else:
        print(f"radar as_of={snapshot.as_of.isoformat()}")
        print(f"  pit={len(snapshot.pit_disclosures)} sast={len(snapshot.sast_disclosures)} "
              f"pledges={len(snapshot.pledges)} deals={len(snapshot.deals)}")
        if snapshot.sources_degraded:
            print(f"  degraded: {', '.join(snapshot.sources_degraded)}")
        print()
        for score in snapshot.scores:
            print(f"  {score.symbol:14} {score.score:>7.2f}  {score.band.value:<14} "
                  f"dq={score.data_quality:.2f}  net={score.net_insider_shares:,.0f}sh "
                  f"inst={score.institutional_net_quantity:,.0f}sh")
    instance.close()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(_main())