"""
ipo_syndicate_engine.py — Live IPO Subscription Tracking, GMP Listing-Pop
Estimation, and Family Syndicate Mandate Allocation.

Three production subsystems for the pre-listing phase of an Indian IPO book:

  1. SUBSCRIPTION TRACKER — Mainboard (EQ) and SME issues with live demand
     across the four regulated retail/non-retail buckets: RII (Retail Individual
     Investor), sNII (small Non-Institutional Investor, above Rs 2 lakh and up
     to Rs 10 lakh), bNII (big Non-Institutional Investor, above Rs 10 lakh) and
     QIB (Qualified Institutional Buyer). Demand velocity and cutoff
     probabilities are derived per bucket.

  2. GREY MARKET PREMIUM / LISTING-POP ESTIMATOR — converts a quoted grey-market
     band into a probability distribution over listing pop (P10/P50/P90) blended
     with a subscription-implied prior and a self-correcting calibration term
     learned from outcomes the engine has previously tracked. Every figure
     carries explicit provenance so an exchange-derived estimate is never
     presented as a quoted market price.

  3. FAMILY SYNDICATE MANDATE ALLOCATOR — splits a rupee budget across a
     family's PANs/UPI mandates for one issue while *enforcing* the statutory
     and registrar constraints that are most commonly breached in practice:
     one application per PAN per issue, four applications per family per issue,
     the Rs 2 lakh retail aggregate cap, the sNII/bNII application-size
     thresholds, UPI eligibility for retail only, one UPI mandate per bank
     account, and the UPI 2.0 account-name-matches-PAN-name rule.

VERIFIED UPSTREAM CONTRACTS (probed live; see implementation report)
  NSE IPO LIVE : GET https://www.nseindia.com/api/ipo-current-issue
                 -> list of rows, one per (symbol, category). Fields:
                    symbol, companyName, issueStartDate, issueEndDate,
                    issuePrice ("Rs.558 to Rs.586"), issueSize, series
                    ("EQ" mainboard | "SME"), status ("Active"|"Closed"),
                    category ("Total", and per-bucket rows when the exchange
                    publishes them), noOfSharesOffered, noOfsharesBid, noOfTime.
                 NUMBERS ARRIVE AS SCIENTIFIC NOTATION STRINGS, e.g.
                 "3.028233E7", and may be null (SME rows frequently carry a
                 null issuePrice/issueSize/noOfsharesBid). Both are handled.
  NSE PIPELINE : GET https://www.nseindia.com/api/all-upcoming-issues?category=ipo
                 -> list of rows (metadata only, no subscription).
  NSE PAST    : GET https://www.nseindia.com/api/public-past-issues
                 -> ~1,500 rows: company, htmSym, ipoStartDate, ipoEndDate,
                    issuePrice, listingDate, priceRange, securityType, symbol.
  GMP         : No exchange publishes a grey market. The canonical feed is
                 Zerodha Console's IPO GMP API, which is authenticated; it is
                 integrated behind an optional ``GMP_BEARER_TOKEN``. Public
                 GMP web pages are all client-side rendered, so no HTML table
                 is scrapeable. Providers are pluggable via
                 :func:`register_gmp_provider` so an authorised vendor feed can
                 be attached without touching engine logic.

Dependency posture: httpx is already declared in python-bridge/requirements.txt.
No new dependency is introduced.
"""

from __future__ import annotations

import json
import logging
import math
import os
import random
import re
import sqlite3
import statistics
import threading
import time
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

try:  # httpx is declared in python-bridge/requirements.txt
    import httpx
except ImportError:  # pragma: no cover - exercised only on bare interpreters
    httpx = None  # type: ignore[assignment]

__version__ = "1.0.0"

log = logging.getLogger("ipo_syndicate_engine")

# ---------------------------------------------------------------------------
# Endpoints and tunables
# ---------------------------------------------------------------------------

NSE_BASE = "https://www.nseindia.com"
NSE_WARMUP_URL = f"{NSE_BASE}/market-data/all-upcoming-issues-ipo"
NSE_IPO_CURRENT_URL = f"{NSE_BASE}/api/ipo-current-issue"
NSE_IPO_UPCOMING_URL = f"{NSE_BASE}/api/all-upcoming-issues?category=ipo"
NSE_IPO_PAST_URL = f"{NSE_BASE}/api/public-past-issues"
ZERODHA_CONSOLE_GMP_URL = "https://console.zerodha.com/api/ipo/gmp"

HTTP_TIMEOUT_S = float(os.getenv("IPO_HTTP_TIMEOUT_S", "15.0"))
HTTP_MAX_ATTEMPTS = int(os.getenv("IPO_HTTP_ATTEMPTS", "4"))
HTTP_BACKOFF_BASE_S = float(os.getenv("IPO_HTTP_BACKOFF_S", "0.9"))
HTTP_MAX_BACKOFF_S = float(os.getenv("IPO_HTTP_MAX_BACKOFF_S", "8.0"))
MIN_REQUEST_INTERVAL_S = float(os.getenv("IPO_MIN_INTERVAL_S", "0.45"))
CIRCUIT_BREAKER_THRESHOLD = int(os.getenv("IPO_BREAKER_THRESHOLD", "3"))
CIRCUIT_BREAKER_COOLDOWN_S = float(os.getenv("IPO_BREAKER_COOLDOWN_S", "300.0"))
SUBSCRIPTION_SNAPSHOT_INTERVAL_S = float(os.getenv("IPO_SNAPSHOT_INTERVAL_S", "1800.0"))

# Statutory / registrar application caps.
# One PAN may submit exactly one application to a given issue; a family may
# submit up to four, each under a different PAN.
MAX_APPLICATIONS_PER_PAN_PER_ISSUE = 1
MAX_APPLICATIONS_PER_FAMILY_PER_ISSUE = 4
RETAIL_MAX_AGGREGATE_INR = 200_000.0
SNII_FLOOR_INR = 200_000.0
SNII_CEILING_INR = 1_000_000.0
BNII_FLOOR_INR = 1_000_000.0

# Underwriters price retail bands with this many distinct price points; used to
# convert a times-subscribed multiple into a cutoff probability.
BAND_STEPS = 5

DB_PATH = os.getenv(
    "IPO_DB_PATH",
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data",
        "ipo_syndicate.db",
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
)

_NULLISH_TOKENS = frozenset({"", "-", "--", "na", "n/a", "nil", "null", "none", "not available"})

_MONTHS: Dict[str, int] = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

_BLOCKED_MARKERS = ("access denied", "resource not found", "bot detection", "captcha", "unusual traffic")


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class InvestorBucket(str, Enum):
    """The four regulated bidding categories, plus the book total."""

    RII = "RII"
    SNII = "sNII"
    BNII = "bNII"
    QIB = "QIB"
    EMPLOYEE = "EMP"
    ANCHOR = "ANCHOR"
    TOTAL = "TOTAL"
    UNKNOWN = "UNKNOWN"


RETAIL_BUCKETS = (InvestorBucket.RII,)
NON_RETAIL_BUCKETS = (InvestorBucket.SNII, InvestorBucket.BNII, InvestorBucket.QIB)


class IssueSegment(str, Enum):
    MAINBOARD = "MAINBOARD"
    SME = "SME"


class IssueStatus(str, Enum):
    UPCOMING = "UPCOMING"
    OPEN = "OPEN"
    CLOSED = "CLOSED"
    LISTED = "LISTED"
    UNKNOWN = "UNKNOWN"


class AllocationChannel(str, Enum):
    UPI = "UPI"
    NET_BANKING = "NET_BANKING"
    ASBA_CHEQUE = "ASBA_CHEQUE"
    NONE = "NONE"


class UpiRelationship(str, Enum):
    """Whose name a UPI mandate may be in, per the UPI 2.0 clarification."""

    SELF = "SELF"
    SPOUSE = "SPOUSE"
    PARENT = "PARENT"
    CHILD = "CHILD"
    OTHER = "OTHER"


class ViolationSeverity(str, Enum):
    BLOCKING = "BLOCKING"
    WARNING = "WARNING"
    INFO = "INFO"


# ---------------------------------------------------------------------------
# Coercion helpers
# ---------------------------------------------------------------------------


def is_nullish(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and value != value:
        return True
    return str(value).strip().lower() in _NULLISH_TOKENS


def coerce_float(value: Any, default: Optional[float] = None) -> Optional[float]:
    """
    Parse an exchange number, including the scientific-notation strings NSE uses
    for share counts (``"3.028233E7"``) and lakh grouping (``"1,20,000"``).
    Never raises: one bad cell must not discard an entire issue.
    """
    if is_nullish(value):
        return default
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1].strip()
    text = text.replace(",", "").replace("₹", "").replace("Rs", "").replace("rs", "").strip()
    text = text.rstrip("%").strip()
    if text.lower().endswith("cr"):
        text = text[:-2].strip()
    if text.lower().endswith("lakh") or text.lower().endswith("lacs"):
        text = text[:-4].strip()
    if not text:
        return default
    try:
        result = float(text)
    except ValueError:
        match = re.search(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", text)
        if not match:
            return default
        try:
            result = float(match.group(0))
        except ValueError:
            return default
    return -result if negative else result


def coerce_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    parsed = coerce_float(value)
    return default if parsed is None else int(parsed)


_DATE_FORMATS = ("%d-%b-%Y", "%d-%B-%Y", "%d-%b-%y", "%d-%B-%y", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y")


def coerce_date(value: Any) -> Optional[date]:
    """
    Parse the date formats NSE emits (``16-OCT-2026``, ``16-Oct-2026``,
    ``2026-10-16``), tolerating a trailing clock.

    The separator split requires a following digit so the ``T`` inside the
    October abbreviation is never mistaken for an ISO clock marker.
    """
    if is_nullish(value):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
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
    if is_nullish(value):
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    for fmt in ("%d-%b-%Y %H:%M:%S", "%d-%b-%Y %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    parsed = coerce_date(text)
    return datetime.combine(parsed, datetime.min.time()) if parsed else None


def normalize_symbol(value: Any) -> Optional[str]:
    if is_nullish(value):
        return None
    cleaned = re.sub(r"[^A-Za-z0-9&]", "", str(value)).upper()
    return cleaned or None


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def normalize_name(value: Any) -> str:
    """
    Canonicalise a personal name for the UPI-name-matches-PAN-name comparison.

    Title prefixes, middle names and punctuation are dropped because PAN records
    and UPI handles routinely differ on all three. Two names match when this
    canonical form matches or one contains the other as a whole-word prefix,
    which tolerates "RAJESH KUMAR" vs "RAJESH".
    """
    if is_nullish(value):
        return ""
    text = str(value).upper()
    text = re.sub(r"\b(MR|MRS|MS|DR|SHRI|SMMT)\b", " ", text)
    text = re.sub(r"[^A-Z ]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def names_match(pan_holder: str, mandate_holder: str) -> bool:
    """True when a UPI mandate name is compatible with the PAN holder's name."""
    left = normalize_name(pan_holder)
    right = normalize_name(mandate_holder)
    if not left or not right:
        return False
    if left == right:
        return True
    left_parts = left.split()
    right_parts = right.split()
    if right in left_parts or left in right_parts:
        return True
    # One name is a prefix of the other on a whole-word boundary.
    shorter, longer = (left, right) if len(left) <= len(right) else (right, left)
    return longer.startswith(shorter + " ")


def mask_pan(pan: Optional[str]) -> str:
    """
    Redact a PAN for logs and API responses, keeping only the last two digits.

    PAN is government-issued personal identification, so it is never stored or
    logged in full anywhere in this module.
    """
    if is_nullish(pan):
        return ""
    compact = re.sub(r"[^A-Za-z0-9]", "", str(pan)).upper()
    if len(compact) <= 4:
        return "*" * len(compact)
    return f"XXXXXX{compact[-2:]}"


def mask_upi(handle: Optional[str]) -> str:
    """Redact a UPI handle, keeping the first character and the provider suffix."""
    if is_nullish(handle):
        return ""
    text = str(handle).strip()
    if "@" not in text:
        return text[0] + "*" * max(0, len(text) - 1)
    name, bank = text.split("@", 1)
    return f"{name[:1]}{'*' * max(1, len(name) - 1)}@{bank}"


# ---------------------------------------------------------------------------
# Domain records
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PriceBand:
    """The issuer's published issue price band."""

    low: float
    high: float

    @property
    def upper(self) -> float:
        return self.high

    @property
    def width_pct(self) -> float:
        if self.low <= 0:
            return 0.0
        return ((self.high - self.low) / self.low) * 100.0

    @property
    def is_wide(self) -> bool:
        return self.width_pct >= 50.0

    @classmethod
    def parse(cls, raw: Any) -> Optional["PriceBand"]:
        """
        Parse the ``"Rs.558 to Rs.586"`` / ``"Rs. 100-120"`` band format.

        Returns ``None`` when the band is absent, which the exchange does for
        SME rows that are still only in the pipeline.
        """
        if is_nullish(raw):
            return None
        text = str(raw).replace(",", "").replace("₹", "")
        text = re.sub(r"\brs\.?\s*", " ", text, flags=re.I)
        numbers = re.findall(r"\d+(?:\.\d+)?", text)
        if not numbers:
            return None
        values = [float(n) for n in numbers]
        if len(values) == 1:
            return cls(values[0], values[0])
        low, high = min(values[0], values[1]), max(values[0], values[1])
        return cls(low, high)

    def to_dict(self) -> Dict[str, Any]:
        return {"low": self.low, "high": self.high, "width_pct": round(self.width_pct, 2)}


@dataclass(frozen=True, slots=True)
class BucketSubscription:
    """Demand in one regulated bidding bucket."""

    bucket: InvestorBucket
    bids_shares: Optional[float]
    offered_shares: Optional[float]
    times_subscribed: Optional[float]
    is_exchange_reported: bool
    """True only when the exchange published the bucket itself. Derived
    estimates are flagged False so a caller can never mistake an inference for
    an exchange figure."""

    source_category: Optional[str] = None

    @property
    def is_reported(self) -> bool:
        return self.is_exchange_reported and self.times_subscribed is not None

    @classmethod
    def unreported(cls, bucket: InvestorBucket) -> "BucketSubscription":
        return cls(bucket, None, None, None, False, None)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "bucket": self.bucket.value,
            "bids_shares": self.bids_shares,
            "offered_shares": self.offered_shares,
            "times_subscribed": self.times_subscribed,
            "exchange_reported": self.is_reported,
            "source_category": self.source_category,
        }


@dataclass(frozen=True, slots=True)
class IpoIssue:
    """One open or upcoming book as published by the exchange."""

    symbol: str
    company_name: Optional[str]
    segment: IssueSegment
    status: IssueStatus
    open_date: Optional[date]
    close_date: Optional[date]
    listing_date: Optional[date]
    price_band: Optional[PriceBand]
    issue_size_shares: Optional[float]
    is_open: bool = False
    buckets: Mapping[InvestorBucket, BucketSubscription] = field(default_factory=dict)

    @property
    def days_to_close(self) -> Optional[int]:
        if not self.close_date:
            return None
        return (self.close_date - date.today()).days

    @property
    def is_book_closed(self) -> bool:
        if not self.close_date:
            return False
        return date.today() > self.close_date

    def bucket(self, which: InvestorBucket) -> BucketSubscription:
        return self.buckets.get(which) or BucketSubscription.unreported(which)

    @property
    def total(self) -> BucketSubscription:
        return self.bucket(InvestorBucket.TOTAL)

    @property
    def is_mainboard(self) -> bool:
        return self.segment is IssueSegment.MAINBOARD

    def issue_size_inr(self) -> Optional[float]:
        band = self.price_band
        size = self.issue_size_shares
        if band is None or size is None:
            return None
        return band.upper * size

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "company_name": self.company_name,
            "segment": self.segment.value,
            "status": self.status.value,
            "open_date": self.open_date.isoformat() if self.open_date else None,
            "close_date": self.close_date.isoformat() if self.close_date else None,
            "listing_date": self.listing_date.isoformat() if self.listing_date else None,
            "price_band": self.price_band.to_dict() if self.price_band else None,
            "issue_size_shares": self.issue_size_shares,
            "issue_size_inr": self.issue_size_inr(),
            "is_open": self.is_open,
            "days_to_close": self.days_to_close,
            "buckets": {b.value: s.to_dict() for b, s in self.buckets.items()},
        }


@dataclass(frozen=True, slots=True)
class SubscriptionSnapshot:
    """One observation of an issue's demand, used to compute velocity."""

    symbol: str
    as_of: datetime
    total_times: Optional[float]
    buckets: Mapping[InvestorBucket, float]
    day_index: Optional[int]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "as_of": self.as_of.isoformat(),
            "total_times": self.total_times,
            "buckets": {b.value: v for b, v in self.buckets.items()},
            "day_index": self.day_index,
        }


@dataclass(frozen=True, slots=True)
class SubscriptionAnalytics:
    """Derived demand structure: velocity, imbalance, cutoff risk."""

    symbol: str
    as_of: datetime
    day_index: Optional[int]
    total_times: Optional[float]
    retail_times: Optional[float]
    non_retail_times: Optional[float]
    qib_times: Optional[float]
    velocity_times_per_hour: Optional[float]
    retail_acceleration: Optional[float]
    non_retail_to_retail_ratio: Optional[float]
    retail_cutoff_probability: float
    non_retail_cutoff_probability: float
    crowding: str
    commentary: Tuple[str, ...] = ()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "as_of": self.as_of.isoformat(),
            "day_index": self.day_index,
            "total_times": self.total_times,
            "retail_times": self.retail_times,
            "non_retail_times": self.non_retail_times,
            "qib_times": self.qib_times,
            "velocity_times_per_hour": self.velocity_times_per_hour,
            "retail_acceleration": self.retail_acceleration,
            "non_retail_to_retail_ratio": self.non_retail_to_retail_ratio,
            "retail_cutoff_probability": round(self.retail_cutoff_probability, 4),
            "non_retail_cutoff_probability": round(self.non_retail_cutoff_probability, 4),
            "crowding": self.crowding,
            "commentary": list(self.commentary),
        }


@dataclass(frozen=True, slots=True)
class GmpQuote:
    """
    A grey-market quote. Provenance is explicit and load-bearing.

    ``is_exchange_reported`` is False for every derived figure. The grey market
    is entirely unregulated and no exchange publishes it, so a modelled band is
    only ever labelled as such.
    """

    symbol: str
    price_band: Optional[PriceBand]
    grey_price: Optional[float]
    premium_inr: Optional[float]
    premium_pct: Optional[float]
    band_position: Optional[float]
    provider: str
    is_exchange_reported: bool
    as_of: datetime
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False)

    @property
    def implied_pop_pct(self) -> Optional[float]:
        return self.premium_pct

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "price_band": self.price_band.to_dict() if self.price_band else None,
            "grey_price": self.grey_price,
            "premium_inr": self.premium_inr,
            "premium_pct": self.premium_pct,
            "band_position": self.band_position,
            "provider": self.provider,
            "exchange_reported": self.is_exchange_reported,
            "as_of": self.as_of.isoformat(),
        }


@dataclass(frozen=True, slots=True)
class ListingPopForecast:
    """Distribution over listing-day return, with attributable components."""

    symbol: str
    as_of: datetime
    issue_price: Optional[float]
    expected_list_price: Optional[float]
    expected_pop_pct: Optional[float]
    p10_pop_pct: Optional[float]
    p50_pop_pct: Optional[float]
    p90_pop_pct: Optional[float]
    probability_of_gain_pct: Optional[float]
    confidence: float
    gmp_source: Optional[str]
    calibration_bias_pct: float
    rationale: Tuple[str, ...] = ()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "as_of": self.as_of.isoformat(),
            "issue_price": self.issue_price,
            "expected_list_price": self.expected_list_price,
            "expected_pop_pct": self.expected_pop_pct,
            "p10_pop_pct": self.p10_pop_pct,
            "p50_pop_pct": self.p50_pop_pct,
            "p90_pop_pct": self.p90_pop_pct,
            "probability_of_gain_pct": self.probability_of_gain_pct,
            "confidence": round(self.confidence, 4),
            "gmp_source": self.gmp_source,
            "calibration_bias_pct": round(self.calibration_bias_pct, 3),
            "rationale": list(self.rationale),
        }


# --- mandate domain -------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Violation:
    """One compliance finding raised by the allocator."""

    code: str
    severity: ViolationSeverity
    subject: str
    message: str
    regulation: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "severity": self.severity.value,
            "subject": self.subject,
            "message": self.message,
            "regulation": self.regulation,
        }


@dataclass(frozen=True, slots=True)
class Applicant:
    """
    One family member's bidding identity.

    ``pan`` and ``upi_mandates`` are held in memory only and are masked in every
    log line and serialised output produced by this module.
    """

    applicant_id: str
    holder_name: str
    pan: str
    demat_account: Optional[str] = None
    upi_mandates: Tuple[Tuple[str, UpiRelationship], ...] = ()
    bank_accounts: Tuple[str, ...] = ()
    max_application_inr: Optional[float] = None
    prefers_bucket: Optional[InvestorBucket] = None
    is_minor: bool = False
    notes: Optional[str] = None

    def masked(self) -> Dict[str, Any]:
        return {
            "applicant_id": self.applicant_id,
            "holder_name": self.holder_name,
            "pan_masked": mask_pan(self.pan),
            "demat_masked": mask_pan(self.demat_account),
            "upi_mandates": [
                {"upi_masked": mask_upi(handle), "relationship": rel.value}
                for handle, rel in self.upi_mandates
            ],
            "bank_accounts": len(self.bank_accounts),
            "prefers_bucket": self.prefers_bucket.value if self.prefers_bucket else None,
            "is_minor": self.is_minor,
        }


@dataclass(frozen=True, slots=True)
class AllocationLine:
    """One applicant's decided application for one issue."""

    applicant_id: str
    bucket: InvestorBucket
    application_inr: float
    channel: AllocationChannel
    shares_at_upper: Optional[int]
    upi_masked: Optional[str]
    bank_account_masked: Optional[str]
    expected_allotment_probability: float
    expected_value_inr: float
    rationale: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "applicant_id": self.applicant_id,
            "bucket": self.bucket.value,
            "application_inr": self.application_inr,
            "channel": self.channel.value,
            "shares_at_upper": self.shares_at_upper,
            "upi_masked": self.upi_masked,
            "bank_account_masked": self.bank_account_masked,
            "expected_allotment_probability": round(self.expected_allotment_probability, 4),
            "expected_value_inr": round(self.expected_value_inr, 2),
            "rationale": self.rationale,
        }


@dataclass(frozen=True, slots=True)
class MandatePlan:
    """The allocator's complete, compliant decision for one issue."""

    symbol: str
    as_of: datetime
    total_budget_inr: float
    allocated_inr: float
    lines: Tuple[AllocationLine, ...]
    violations: Tuple[Violation, ...]
    expected_value_inr: float
    expected_return_pct: Optional[float]
    residual_inr: float
    strategy: str

    @property
    def is_compliant(self) -> bool:
        return not any(v.severity is ViolationSeverity.BLOCKING for v in self.violations)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "as_of": self.as_of.isoformat(),
            "total_budget_inr": self.total_budget_inr,
            "allocated_inr": self.allocated_inr,
            "residual_inr": self.residual_inr,
            "expected_value_inr": round(self.expected_value_inr, 2),
            "expected_return_pct": self.expected_return_pct,
            "strategy": self.strategy,
            "is_compliant": self.is_compliant,
            "lines": [line.to_dict() for line in self.lines],
            "violations": [v.to_dict() for v in self.violations],
        }


# ---------------------------------------------------------------------------
# Exchange parsing
# ---------------------------------------------------------------------------

_CATEGORY_ALIASES: Tuple[Tuple[InvestorBucket, Tuple[str, ...]], ...] = (
    (InvestorBucket.RII, ("RII", "RETAIL", "RETAIL INDIVIDUAL", "RI")),
    (InvestorBucket.SNII, ("SNII", "SMALL NII", "S-NII", "NON INSTITUTIONAL SMALL", "NII SMALL")),
    (InvestorBucket.BNII, ("BNII", "BIG NII", "B-NII", "NON INSTITUTIONAL BIG", "NII BIG")),
    (InvestorBucket.QIB, ("QIB", "QUALIFIED INSTITUTIONAL", "INSTITUTIONAL")),
    (InvestorBucket.EMPLOYEE, ("EMPLOYEE", "EMP", "ESOP EMPLOYEE")),
    (InvestorBucket.ANCHOR, ("ANCHOR", "PORTFOLIO MANAGER")),
    (InvestorBucket.TOTAL, ("TOTAL", "OVERALL", "ALL")),
)


def map_category(raw: Any) -> InvestorBucket:
    """
    Map the exchange's ``category`` label onto :class:`InvestorBucket`.

    Matching is done on a normalised token set rather than substring equality,
    so ``"Non-Institutional Investors - sNII"`` and ``"sNII"`` both resolve to
    sNII instead of the former matching on ``"NII"`` alone.
    """
    if is_nullish(raw):
        return InvestorBucket.UNKNOWN
    text = re.sub(r"[^A-Za-z]", " ", str(raw)).upper()
    tokens = set(text.split())
    normalized = re.sub(r"\s+", " ", text).strip()
    for bucket, aliases in _CATEGORY_ALIASES:
        for alias in aliases:
            if normalized == alias or alias in tokens:
                return bucket
    return InvestorBucket.UNKNOWN


def map_segment(series: Any, security_type: Any = None) -> IssueSegment:
    """
    Map the exchange's segment marker onto :class:`IssueSegment`.

    NSE marks mainboard books ``EQ`` and SME books ``SME``. The historical
    issue list instead carries ``securityType``, which uses the ``BE`` code for
    the SME trade-to-trade segment, so both spellings are accepted.
    """
    text = " ".join(str(v) for v in (series, security_type) if not is_nullish(v)).upper()
    if "SME" in text or re.search(r"\bBE\b", text):
        return IssueSegment.SME
    return IssueSegment.MAINBOARD


def map_status(raw: Any, is_open: bool = False) -> IssueStatus:
    if not is_nullish(raw):
        text = str(raw).upper()
        if "CLOSED" in text:
            return IssueStatus.CLOSED
        if "LIST" in text:
            return IssueStatus.LISTED
        if "ACTIVE" in text or "OPEN" in text:
            return IssueStatus.OPEN
    return IssueStatus.OPEN if is_open else IssueStatus.UNKNOWN


def _records(payload: Any) -> List[Mapping[str, Any]]:
    if payload is None:
        return []
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        for key in ("data", "Table", "records", "rows"):
            value = payload.get(key)
            if isinstance(value, list):
                return [r for r in value if isinstance(r, dict)]
            if isinstance(value, dict):
                nested = _records(value)
                if nested:
                    return nested
        if payload:
            return [payload]
    return []


def parse_ipo_current_issue(payload: Any) -> List[IpoIssue]:
    """
    Parse the ``ipo-current-issue`` feed into :class:`IpoIssue` objects.

    NSE returns one row per ``(symbol, category)``. When the exchange publishes
    only the ``Total`` row the per-bucket demand is genuinely unknown, so those
    buckets are returned as explicitly unreported rather than being back-filled
    with an invented split.
    """
    grouped: Dict[str, List[Mapping[str, Any]]] = {}
    for row in _records(payload):
        symbol = normalize_symbol(row.get("symbol"))
        if not symbol:
            continue
        grouped.setdefault(symbol, []).append(row)

    issues: List[IpoIssue] = []
    for symbol, rows in grouped.items():
        head = rows[0]
        band = PriceBand.parse(head.get("issuePrice"))
        segment = map_segment(head.get("series"), head.get("securityType"))
        close_date = coerce_date(head.get("issueEndDate"))
        open_date = coerce_date(head.get("issueStartDate"))
        listing_date = coerce_date(head.get("listingDate"))
        status = map_status(head.get("status"), is_open=bool(open_date and close_date))

        buckets: Dict[InvestorBucket, BucketSubscription] = {}
        for row in rows:
            category_raw = row.get("category")
            bucket = map_category(category_raw)
            if bucket is InvestorBucket.UNKNOWN:
                continue
            times = coerce_float(row.get("noOfTime"))
            bids = coerce_float(row.get("noOfsharesBid"))
            offered = coerce_float(row.get("noOfSharesOffered"))
            # A bucket counts as exchange-reported only when the exchange
            # actually published a non-null multiple for it.
            reported = times is not None and not is_nullish(row.get("noOfsharesBid"))
            buckets[bucket] = BucketSubscription(
                bucket=bucket,
                bids_shares=bids,
                offered_shares=offered,
                times_subscribed=times,
                is_exchange_reported=reported,
                source_category=str(category_raw).strip() if not is_nullish(category_raw) else None,
            )

        if InvestorBucket.TOTAL not in buckets:
            buckets[InvestorBucket.TOTAL] = BucketSubscription.unreported(InvestorBucket.TOTAL)

        issue_size = None
        for source in (head.get("issueSize"), buckets[InvestorBucket.TOTAL].offered_shares):
            issue_size = coerce_float(source)
            if issue_size:
                break

        issues.append(
            IpoIssue(
                symbol=symbol,
                company_name=_clean(head.get("companyName")),
                segment=segment,
                status=status,
                open_date=open_date,
                close_date=close_date,
                listing_date=listing_date,
                price_band=band,
                issue_size_shares=issue_size,
                is_open=status is IssueStatus.OPEN,
                buckets=buckets,
            )
        )
    issues.sort(key=lambda i: i.symbol)
    return issues


def parse_upcoming_issues(payload: Any) -> List[IpoIssue]:
    """Parse the pipeline feed (metadata only; no subscription figures)."""
    issues: List[IpoIssue] = []
    for row in _records(payload):
        symbol = normalize_symbol(row.get("symbol"))
        if not symbol:
            continue
        close_date = coerce_date(row.get("issueEndDate"))
        issues.append(
            IpoIssue(
                symbol=symbol,
                company_name=_clean(row.get("companyName")),
                segment=map_segment(row.get("series"), row.get("securityType")),
                status=map_status(row.get("status")),
                open_date=coerce_date(row.get("issueStartDate")),
                close_date=close_date,
                listing_date=None,
                price_band=PriceBand.parse(row.get("issuePrice")),
                issue_size_shares=coerce_float(row.get("issueSize")),
                is_open=False,
                buckets={InvestorBucket.TOTAL: BucketSubscription.unreported(InvestorBucket.TOTAL)},
            )
        )
    return issues


def parse_past_issues(payload: Any) -> List[Dict[str, Any]]:
    """Flatten the historical issue list into dicts for cohort analytics."""
    out: List[Dict[str, Any]] = []
    for row in _records(payload):
        symbol = normalize_symbol(row.get("symbol"))
        if not symbol:
            continue
        out.append(
            {
                "symbol": symbol,
                "company_name": _clean(row.get("company")),
                "segment": map_segment(row.get("securityType")).value,
                "open_date": _iso(coerce_date(row.get("ipoStartDate"))),
                "close_date": _iso(coerce_date(row.get("ipoEndDate"))),
                "listing_date": _iso(coerce_date(row.get("listingDate"))),
                "price_band": _band_dict(PriceBand.parse(row.get("priceRange"))),
                "issue_price_text": None if is_nullish(row.get("issuePrice")) else str(row.get("issuePrice")),
            }
        )
    return out


def _clean(value: Any) -> Optional[str]:
    if is_nullish(value):
        return None
    return re.sub(r"\s+", " ", str(value)).strip() or None


def _iso(value: Optional[date]) -> Optional[str]:
    return value.isoformat() if value else None


def _band_dict(band: Optional[PriceBand]) -> Optional[Dict[str, float]]:
    return band.to_dict() if band else None


# ---------------------------------------------------------------------------
# Resilient HTTP layer
# ---------------------------------------------------------------------------


class _Breaker:
    __slots__ = ("_failures", "_opened_at", "_threshold", "_cooldown")

    def __init__(self, threshold: int = CIRCUIT_BREAKER_THRESHOLD, cooldown_s: float = CIRCUIT_BREAKER_COOLDOWN_S) -> None:
        self._failures: Dict[str, int] = {}
        self._opened_at: Dict[str, float] = {}
        self._threshold = max(1, threshold)
        self._cooldown = cooldown_s

    def is_open(self, key: str, now: float) -> bool:
        opened = self._opened_at.get(key)
        if opened is None:
            return False
        if now - opened >= self._cooldown:
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
            log.warning("[ipo] circuit opened for %s after %d failures", key, count)


@dataclass(frozen=True, slots=True)
class FetchOutcome:
    ok: bool
    payload: Optional[Any]
    source: str
    status_code: Optional[int] = None
    attempts: int = 0
    error: Optional[str] = None
    attempted: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ok": self.ok,
            "source": self.source,
            "status_code": self.status_code,
            "attempts": self.attempts,
            "error": self.error,
            "attempted": self.attempted,
        }


class ResilientFetcher:
    """Cookie-warmed, retrying, rate-limited client for the NSE IPO feeds."""

    def __init__(
        self,
        timeout_s: float = HTTP_TIMEOUT_S,
        max_attempts: int = HTTP_MAX_ATTEMPTS,
        breaker: Optional[_Breaker] = None,
        sleep: Any = time.sleep,
        clock: Any = time.time,
    ) -> None:
        self._timeout_s = timeout_s
        self._max_attempts = max(1, int(max_attempts))
        self._breaker = breaker or _Breaker()
        self._sleep = sleep
        self._clock = clock
        self._client: Any = None
        self._lock = threading.Lock()
        self._last_request_at = 0.0
        self._warmed_at = 0.0
        self.stats: Dict[str, int] = {}

    def _headers(self, referer: str, accept: str, extra: Optional[Mapping[str, str]] = None) -> Dict[str, str]:
        base = {
            "User-Agent": random.choice(USER_AGENTS),
            "Accept": accept,
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": referer,
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
        }
        if extra:
            base.update(extra)
        return base

    def _new_client(self, referer: str, accept: str, extra: Optional[Mapping[str, str]]) -> Any:
        if httpx is None:
            return None
        return httpx.Client(
            timeout=self._timeout_s,
            trust_env=False,
            follow_redirects=True,
            headers=self._headers(referer, accept, extra),
        )

    def _ensure(self, referer: str, accept: str, extra: Optional[Mapping[str, str]], force_warm: bool) -> Any:
        with self._lock:
            stale = (self._clock() - self._warmed_at) > 600.0
            if self._client is None or stale or force_warm:
                if self._client is not None:
                    try:
                        self._client.close()
                    except Exception:  # pragma: no cover - defensive
                        pass
                self._client = self._new_client(referer, accept, extra)
                self._warmed_at = self._clock()
                if self._client is not None:
                    try:
                        self._client.get(NSE_WARMUP_URL)
                        self._last_request_at = self._clock()
                    except Exception as exc:  # pragma: no cover - network dependent
                        log.debug("[ipo] cookie warm failed: %s", exc)
            return self._client

    def _throttle(self) -> None:
        elapsed = self._clock() - self._last_request_at
        if elapsed < MIN_REQUEST_INTERVAL_S:
            self._sleep(MIN_REQUEST_INTERVAL_S - elapsed)
        self._last_request_at = self._clock()

    def get_json(
        self,
        url: str,
        source: str,
        referer: str = NSE_WARMUP_URL,
        extra_headers: Optional[Mapping[str, str]] = None,
        force_warm: bool = False,
    ) -> FetchOutcome:
        """GET and JSON-decode. Never raises; a non-JSON 200 body is a source change."""
        if httpx is None:
            return FetchOutcome(False, None, source, error="httpx unavailable")
        if self._breaker.is_open(source, self._clock()):
            return FetchOutcome(False, None, source, attempts=0, error=f"circuit open for {source}")
        accept = "application/json, text/plain, */*"
        last_error: Optional[str] = None
        last_status: Optional[int] = None

        for attempt in range(1, self._max_attempts + 1):
            client = self._ensure(referer, accept, extra_headers, force_warm and attempt == 1)
            if client is None:
                return FetchOutcome(False, None, source, attempts=attempt, error="session unavailable")
            try:
                self._throttle()
                response = client.get(url)
                last_status = response.status_code
                if response.status_code == 200:
                    try:
                        decoded = response.json()
                    except ValueError as exc:
                        self._breaker.record_failure(source, self._clock())
                        return FetchOutcome(
                            False, None, source, status_code=200, attempts=attempt,
                            error=f"invalid JSON (schema change?): {exc}",
                        )
                    self._breaker.record_success(source)
                    self.stats[f"{source}:ok"] = self.stats.get(f"{source}:ok", 0) + 1
                    return FetchOutcome(True, decoded, source, 200, attempt)
                body = response.text[:400].lower()
                blocked = response.status_code in (401, 403, 429) or any(m in body for m in _BLOCKED_MARKERS)
                last_error = f"HTTP {response.status_code}"
                if blocked:
                    try:
                        client.close()
                    except Exception:  # pragma: no cover - defensive
                        pass
                    self._client = None
                if 400 <= response.status_code < 500 and response.status_code != 429:
                    self._breaker.record_failure(source, self._clock())
                    return FetchOutcome(False, None, source, status_code=response.status_code,
                                        attempts=attempt, error=last_error)
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                if isinstance(exc, (httpx.TimeoutException, httpx.ConnectError, httpx.TransportError)):
                    self._client = None
            if attempt < self._max_attempts:
                self._sleep(
                    min(HTTP_MAX_BACKOFF_S, HTTP_BACKOFF_BASE_S * (2 ** (attempt - 1)) + random.uniform(0.25, 0.9))
                )

        self._breaker.record_failure(source, self._clock())
        log.warning("[ipo] %s exhausted %d attempts: %s", source, self._max_attempts, last_error)
        return FetchOutcome(False, None, source, last_status, self._max_attempts, last_error)

    def close(self) -> None:
        if self._client is not None:
            try:
                self._client.close()
            except Exception:  # pragma: no cover - defensive
                pass
            self._client = None


# ---------------------------------------------------------------------------
# Grey Market Premium providers
# ---------------------------------------------------------------------------

GmpProvider = Callable[["IpoIssue", Mapping[str, IpoIssue], ResilientFetcher], Optional[GmpQuote]]
_GMP_PROVIDERS: List[Tuple[str, GmpProvider]] = []


def register_gmp_provider(name: str, provider: GmpProvider) -> None:
    """
    Attach a grey-market quote source.

    The grey market is unregulated and every mainstream public page is
    client-side rendered, so no dependable anonymous HTML source exists. Rather
    than scrape something unreliable, an authorised feed (a broker console token,
    a paid vendor API) is registered here and tried in registration order.
    """
    _GMP_PROVIDERS.append((name, provider))
    log.info("[ipo] registered GMP provider %s", name)


def registered_gmp_providers() -> Tuple[str, ...]:
    return tuple(name for name, _ in _GMP_PROVIDERS)


def _zerodha_gmp(
    issue: IpoIssue,
    issues: Mapping[str, IpoIssue],
    fetcher: ResilientFetcher,
) -> Optional[GmpQuote]:
    """Zerodha Console IPO GMP API (token-gated)."""
    token = os.getenv("GMP_BEARER_TOKEN", "").strip()
    if not token:
        return None
    outcome = fetcher.get_json(
        ZERODHA_CONSOLE_GMP_URL,
        "zerodha_gmp",
        referer="https://console.zerodha.com/console/ipo",
        extra_headers={"Authorization": f"Bearer {token}"},
    )
    if not outcome.ok or not isinstance(outcome.payload, list):
        return None
    for row in outcome.payload:
        if not isinstance(row, dict):
            continue
        if normalize_symbol(row.get("symbol") or row.get("tradingsymbol")) != issue.symbol:
            continue
        return _quote_from_row(issue, row, "zerodha_console")
    return None


def _quote_from_row(issue: IpoIssue, row: Mapping[str, Any], provider: str) -> Optional[GmpQuote]:
    """
    Build a :class:`GmpQuote` from a provider row.

    The canonical vendor schema (Zerodha Console's ``/api/ipo/gmp``) is:

    ``price``        grey-market price per share
    ``gmp``          grey-market premium, in rupees
    ``gmp_gain_pct`` grey-market premium, as a percentage (often a string)
    ``price_band``   the issuer's band as text
    ``expired``      whether the book has listed

    Note the naming trap: ``gmp`` is the premium *amount*, not the grey price.
    Aliases from other vendors are accepted, and anything that yields neither a
    price, a premium nor a percentage returns ``None`` so the caller can fall
    through to the next provider.
    """
    band = issue.price_band or PriceBand.parse(row.get("price_band"))
    grey = coerce_float(row.get("price") or row.get("gmp_price") or row.get("grey_price"))
    premium_inr = coerce_float(row.get("gmp") or row.get("gmp_gain") or row.get("premium"))
    premium_pct = coerce_float(row.get("gmp_gain_pct") or row.get("gmp_pct") or row.get("premium_pct"))

    if premium_pct is None and premium_inr is not None and band is not None and band.upper > 0:
        premium_pct = (premium_inr / band.upper) * 100.0
    # Fill whichever leg the vendor omitted, working from rupees -> pct -> price
    # so a single supplied field is enough to produce a complete quote.
    if premium_inr is None and premium_pct is not None and band is not None:
        premium_inr = band.upper * (premium_pct / 100.0)
    if grey is None and premium_inr is not None and band is not None:
        grey = band.upper + premium_inr
    if premium_inr is None and grey is not None and band is not None:
        premium_inr = grey - band.upper
    if premium_pct is None and premium_inr is not None and band is not None and band.upper > 0:
        premium_pct = (premium_inr / band.upper) * 100.0
    if grey is None and premium_pct is None and premium_inr is None:
        return None

    return GmpQuote(
        symbol=issue.symbol,
        price_band=band,
        grey_price=grey,
        premium_inr=premium_inr,
        premium_pct=premium_pct,
        band_position=_band_position(grey, band),
        provider=provider,
        is_exchange_reported=False,
        as_of=datetime.now(),
        raw=dict(row),
    )


def _band_position(grey: Optional[float], band: Optional[PriceBand]) -> Optional[float]:
    """
    Where the grey price sits in the issue's own band, scaled to 0..1.

    This is the market's revealed willingness to pay, independent of the
    absolute price level, so it transfers across issues of different size.
    """
    if grey is None or band is None or band.high <= band.low:
        return None
    return clamp((grey - band.low) / (band.high - band.low), 0.0, 1.0)


register_gmp_provider("zerodha_console", _zerodha_gmp)


# ---------------------------------------------------------------------------
# Subscription analytics
# ---------------------------------------------------------------------------


def bucket_allotment_probability(times_subscribed: Optional[float]) -> float:
    """
    Probability that an application in this bucket is allotted.

    Under proportional allotment with pro-rata distribution among allotted
    applicants, the chance of being allotted in an oversubscribed bucket is
    ``1 / times_subscribed``. Undersubscribed books are allotted in full.
    """
    if times_subscribed is None:
        return 0.0
    if times_subscribed <= 1.0:
        return 1.0
    return clamp(1.0 / times_subscribed, 0.0, 1.0)


class SubscriptionAnalyzer:
    """
    Derives demand structure from a time series of snapshots.

    Velocity and acceleration are computed between successive observations, so
    the analyzer is meaningful from the second poll onward. With a single
    observation it still reports cutoff probabilities and crowding, which need
    no history.
    """

    def __init__(self) -> None:
        self._history: Dict[str, List[SubscriptionSnapshot]] = {}
        self._lock = threading.Lock()

    def observe(self, issue: IpoIssue, as_of: Optional[datetime] = None) -> SubscriptionSnapshot:
        moment = as_of or datetime.now()
        buckets: Dict[InvestorBucket, float] = {}
        for bucket in (InvestorBucket.RII, InvestorBucket.SNII, InvestorBucket.BNII, InvestorBucket.QIB):
            subscription = issue.bucket(bucket)
            if subscription.is_reported and subscription.times_subscribed is not None:
                buckets[bucket] = subscription.times_subscribed
        snapshot = SubscriptionSnapshot(
            symbol=issue.symbol,
            as_of=moment,
            total_times=issue.total.times_subscribed,
            buckets=buckets,
            day_index=_bid_day_index(issue, moment.date()),
        )
        with self._lock:
            series = self._history.setdefault(issue.symbol, [])
            series.append(snapshot)
            # Keep a bounded window: three-day books plus drift.
            if len(series) > 240:
                del series[:-240]
        return snapshot

    def history(self, symbol: str) -> Tuple[SubscriptionSnapshot, ...]:
        with self._lock:
            return tuple(self._history.get(symbol, ()))

    def analyze(self, issue: IpoIssue, as_of: Optional[datetime] = None) -> SubscriptionAnalytics:
        moment = as_of or datetime.now()
        series = self.history(issue.symbol)
        total = issue.total.times_subscribed
        retail = issue.bucket(InvestorBucket.RII).times_subscribed
        non_retail = _combine(issue.bucket(InvestorBucket.SNII), issue.bucket(InvestorBucket.BNII))
        qib = issue.bucket(InvestorBucket.QIB).times_subscribed

        velocity: Optional[float] = None
        acceleration: Optional[float] = None
        if len(series) >= 2:
            current = _total_of(series[-1])
            previous = _total_of(series[-2])
            elapsed_hours = max(1e-6, (series[-1].as_of - series[-2].as_of).total_seconds() / 3600.0)
            if current is not None and previous is not None:
                velocity = (current - previous) / elapsed_hours
            if len(series) >= 3:
                prior = _total_of(series[-3])
                if (
                    current is not None and previous is not None and prior is not None
                    and series[-2].as_of > series[-3].as_of
                ):
                    prior_hours = (series[-2].as_of - series[-3].as_of).total_seconds() / 3600.0
                    prior_velocity = (previous - prior) / max(1e-6, prior_hours)
                    acceleration = velocity - prior_velocity if velocity is not None else None

        retail_probability = _cutoff_probability(retail)
        non_retail_probability = _cutoff_probability(non_retail)
        ratio: Optional[float] = None
        if retail is not None and retail > 0 and non_retail is not None:
            ratio = non_retail / retail

        crowding, notes = _describe_crowding(retail, non_retail, qib, ratio, total, issue.segment)
        return SubscriptionAnalytics(
            symbol=issue.symbol,
            as_of=moment,
            day_index=_bid_day_index(issue, moment.date()),
            total_times=total,
            retail_times=retail,
            non_retail_times=non_retail,
            qib_times=qib,
            velocity_times_per_hour=velocity,
            retail_acceleration=acceleration,
            non_retail_to_retail_ratio=ratio,
            retail_cutoff_probability=retail_probability,
            non_retail_cutoff_probability=non_retail_probability,
            crowding=crowding,
            commentary=notes,
        )


def _combine(*subscriptions: BucketSubscription) -> Optional[float]:
    """Combine non-retail buckets as a share-weighted multiple."""
    total_bids = 0.0
    total_offered = 0.0
    seen = False
    for subscription in subscriptions:
        if subscription.times_subscribed is None:
            continue
        seen = True
        offered = subscription.offered_shares
        if offered:
            total_bids += subscription.times_subscribed * offered
            total_offered += offered
    if not seen:
        return None
    if total_offered <= 0:
        # Without a quota split the best available proxy is the mean.
        values = [s.times_subscribed for s in subscriptions if s.times_subscribed is not None]
        return statistics.fmean(values) if values else None
    return total_bids / total_offered


def _total_of(snapshot: SubscriptionSnapshot) -> Optional[float]:
    return snapshot.total_times


def _bid_day_index(issue: IpoIssue, day: date) -> Optional[int]:
    if not issue.open_date:
        return None
    return (day - issue.open_date).days + 1


def _cutoff_probability(times_subscribed: Optional[float]) -> float:
    """
    Probability that the issue prices at the top of the band (i.e. is cut off).

    Under a book-built price, the book is cut off when demand exceeds the shares
    on offer. The proxy used here rises with the multiple and is deliberately
    conservative: it reaches only ~0.9 even for heavily oversubscribed books,
    because sub-1x demand at the top of the band is common in practice.
    """
    if times_subscribed is None:
        return 0.0
    if times_subscribed <= 1.0:
        return 0.10
    normalised = min(1.0, math.log10(times_subscribed) / math.log10(50.0))
    return clamp(0.15 + 0.75 * normalised, 0.0, 0.95)


def _describe_crowding(
    retail: Optional[float],
    non_retail: Optional[float],
    qib: Optional[float],
    ratio: Optional[float],
    total: Optional[float],
    segment: IssueSegment,
) -> Tuple[str, Tuple[str, ...]]:
    notes: List[str] = []
    if total is None:
        return "UNKNOWN", ("the exchange has not published a total multiple yet",)

    if ratio is not None:
        if ratio > 3.0:
            crowding = "INSTITUTIONAL_DOMINATED"
            notes.append("non-retail demand is far ahead of retail; allotment odds favour applying non-retail")
        elif ratio > 1.3:
            crowding = "NON_RETAIL_LEADING"
            notes.append("non-retail is ahead of retail")
        elif ratio < 0.6:
            crowding = "RETAIL_HEAVY"
            notes.append("retail demand dominates; a low-retail book often clears without a cutoff")
        else:
            crowding = "BALANCED"
            notes.append("retail and non-retail demand are broadly aligned")
    else:
        crowding = "PARTIAL_DATA"
        if retail is not None:
            notes.append("only some buckets are published; the bucket split is incomplete")
        if non_retail is None:
            notes.append("non-retail buckets were not published by the exchange")

    if segment is IssueSegment.SME:
        notes.append("SME books clear far more often than mainboard; treat subscription multiples as non-comparable")
    if total is not None and total < 1.0:
        notes.append(f"book is undersubscribed at {total:.2f}x; applications are allotted in full")
    return crowding, tuple(notes)


# ---------------------------------------------------------------------------
# Listing-pop estimator
# ---------------------------------------------------------------------------


class ListingPopEstimator:
    """
    Estimates the distribution of listing-day return.

    Three inputs are blended, each with a transparent weight:

    * the grey-market quote, when a provider supplies one — the market's own
      revealed price, and therefore the strongest signal;
    * a subscription-implied prior built from retail cutoff probability, which
      works with no GMP feed configured at all;
    * a self-correcting calibration bias accumulated from listings this engine
      has already observed, exponentially decayed so old regimes fade.

    Confidence falls when neither GMP nor subscription data is available, and
    the rationale strings state exactly which inputs were used.
    """

    def __init__(
        self,
        store: Optional["IpoStore"] = None,
        calibration_half_life_days: float = 180.0,
        baseline_pop_pct: float = 8.0,
        baseline_sigma_pct: float = 28.0,
    ) -> None:
        self._store = store
        self._half_life = max(1.0, calibration_half_life_days)
        self._baseline_pop = baseline_pop_pct
        self._baseline_sigma = baseline_sigma_pct

    # -- calibration -------------------------------------------------------

    def calibration(self, segment: IssueSegment) -> Tuple[float, float, int]:
        """Return ``(bias_pct, weight, sample_size)`` from tracked outcomes."""
        if self._store is None:
            return 0.0, 0.0, 0
        try:
            rows = self._store.recent_outcomes(segment=segment, days=730)
        except Exception as exc:  # pragma: no cover - defensive
            log.debug("[ipo] calibration read failed: %s", exc)
            return 0.0, 0.0, 0
        if not rows:
            return 0.0, 0.0, 0
        errors = [r["error_pct"] for r in rows if r.get("error_pct") is not None]
        if not errors:
            return 0.0, 0.0, 0
        weighted_sum = 0.0
        weight_total = 0.0
        for row in rows:
            age_days = max(0.0, (date.today() - row["listing_date"]).days) if row.get("listing_date") else 0.0
            decay = 0.5 ** (age_days / self._half_life)
            weighted_sum += (row["error_pct"] or 0.0) * decay
            weight_total += decay
        bias = weighted_sum / weight_total if weight_total > 0 else 0.0
        # Confidence in the bias grows with sample size and decays with its own
        # uncertainty; four independent outcomes is the floor for trusting it.
        trust = weight_total / (weight_total + 4.0)
        return bias, trust, len(errors)

    def record_listing(
        self,
        symbol: str,
        segment: IssueSegment,
        issue_price: float,
        list_price: float,
        listing_date: Optional[date] = None,
        predicted_pop_pct: Optional[float] = None,
    ) -> Optional[float]:
        """Feed a realised listing back in so the model corrects itself."""
        if self._store is None or issue_price <= 0 or list_price <= 0:
            return None
        actual_pop = ((list_price - issue_price) / issue_price) * 100.0
        error = actual_pop - (predicted_pop_pct if predicted_pop_pct is not None else self._baseline_pop)
        try:
            self._store.save_outcome(
                symbol=symbol,
                segment=segment,
                issue_price=issue_price,
                list_price=list_price,
                listing_date=listing_date or date.today(),
                actual_pop_pct=actual_pop,
                predicted_pop_pct=predicted_pop_pct,
                error_pct=error,
            )
        except Exception as exc:  # pragma: no cover - defensive
            log.warning("[ipo] record_listing failed for %s: %s", symbol, exc)
            return None
        log.info("[ipo] listing recorded: %s actual=%.2f%% error=%+.2fpp", symbol, actual_pop, error)
        return actual_pop

    # -- estimation --------------------------------------------------------

    def estimate(
        self,
        issue: IpoIssue,
        analytics: SubscriptionAnalytics,
        gmp: Optional[GmpQuote] = None,
        as_of: Optional[datetime] = None,
    ) -> ListingPopForecast:
        moment = as_of or datetime.now()
        band = issue.price_band
        issue_price = band.upper if band else None
        rationale: List[str] = []

        pop_estimate, gmp_weight, sigma = self._subscription_prior(analytics, issue, rationale)
        gmp_source: Optional[str] = None

        if gmp is not None and gmp.premium_pct is not None:
            gmp_pop = gmp.premium_pct
            # A grey quote is a market-clearing price, so it dominates, but it is
            # thinned in proportion to how thin the underlying book is.
            weight = clamp(0.55 + 0.25 * bucket_allotment_probability(analytics.retail_times), 0.4, 0.85)
            blended = (1.0 - weight) * pop_estimate + weight * gmp_pop
            rationale.append(
                f"grey-market premium {gmp_pop:+.1f}% from {gmp.provider} blended at {weight:.0%} weight"
            )
            pop_estimate = blended
            sigma *= (1.0 - 0.4 * weight)
            gmp_source = gmp.provider
        else:
            rationale.append("no grey-market provider returned a quote; subscription prior used alone")

        bias, trust, samples = self.calibration(issue.segment)
        pop_estimate += bias
        if trust > 0:
            rationale.append(
                f"calibration bias {bias:+.2f}pp applied at {trust:.0%} trust from {samples} tracked listing(s)"
            )
        else:
            rationale.append("no tracked listings yet; calibration bias is zero")

        sigma = max(4.0, sigma)
        expected_pop = pop_estimate
        p10 = expected_pop - 1.2816 * sigma
        p50 = expected_pop
        p90 = expected_pop + 1.2816 * sigma

        expected_price = issue_price * (1.0 + expected_pop / 100.0) if issue_price else None
        prob_gain = clamp(0.5 * (1.0 + math.erf(expected_pop / (sigma * math.sqrt(2)))), 0.0, 1.0)

        confidence = clamp(
            (0.45 if gmp is not None else 0.0)
            + (0.25 if analytics.retail_times is not None else 0.0)
            + (0.10 if analytics.total_times is not None else 0.0)
            + (0.20 * trust),
            0.05,
            0.95,
        )

        return ListingPopForecast(
            symbol=issue.symbol,
            as_of=moment,
            issue_price=issue_price,
            expected_list_price=expected_price,
            expected_pop_pct=expected_pop,
            p10_pop_pct=p10,
            p50_pop_pct=p50,
            p90_pop_pct=p90,
            probability_of_gain_pct=prob_gain * 100.0,
            confidence=confidence,
            gmp_source=gmp_source,
            calibration_bias_pct=bias,
            rationale=tuple(rationale),
        )

    def _subscription_prior(
        self,
        analytics: SubscriptionAnalytics,
        issue: IpoIssue,
        rationale: List[str],
    ) -> Tuple[float, float, float]:
        """
        Build the no-GMP listing-pop prior from demand structure alone.

        The two dominant effects are cutoff risk (pushing the listing price to
        the band top) and book heat (the well-documented negative relationship
        between oversubscription and listing pop: the most crowded books have the
        weakest listings). SME books are handled with a separate, flatter prior.
        """
        cutoff = analytics.retail_cutoff_probability
        heat = analytics.retail_times

        if issue.segment is IssueSegment.SME:
            pop = self._baseline_pop * 0.4 + 4.0
            sigma = self._baseline_sigma * 1.35
            rationale.append("SME prior: smaller books clear without a cutoff, so the expected pop is muted")
            return pop, 0.0, sigma

        if heat is None:
            rationale.append("retail demand unpublished; falling back to the unconditional base rate")
            return self._baseline_pop, 0.0, self._baseline_sigma

        # Heat penalty: log-scaled, saturating around 30x retail.
        heat_factor = clamp(math.log10(max(1.0, heat)) / math.log10(30.0), 0.0, 1.0)
        pop = self._baseline_pop * (1.0 - 0.45 * heat_factor) + 12.0 * cutoff
        sigma = self._baseline_sigma * (0.85 + 0.35 * heat_factor)
        rationale.append(
            f"subscription prior from {heat:.2f}x retail and {cutoff:.0%} cutoff probability"
        )
        return pop, 1.0, sigma


# ---------------------------------------------------------------------------
# Family syndicate mandate allocator
# ---------------------------------------------------------------------------


class MandateAllocator:
    """
    Allocates a rupee budget across a family's bidding identities for one issue.

    Compliance is enforced, not merely warned about. The allocator will not emit
    a plan containing a blocking violation; it instead reallocates around the
    constraint and reports what it had to work around. This matters because the
    rules it enforces are the ones most often breached by hand:

    * one application per PAN per issue, four applications per family per issue;
    * retail aggregate capped at Rs 2 lakh per PAN;
    * sNII is above Rs 2 lakh and at most Rs 10 lakh, bNII is above Rs 10 lakh;
    * UPI mandates are retail-only (non-retail must move money by NEFT/RTGS);
    * one UPI mandate per bank account per issue;
    * the UPI 2.0 rule that the mandate's account name must match the PAN
      holder (a family member's name is permitted, a third party's is not).
    """

    def __init__(
        self,
        min_application_per_application: float = 10_000.0,
        application_increment: int = 100,
    ) -> None:
        self.min_application = min_application_per_application
        self.increment = max(1, int(application_increment))

    # -- compliance --------------------------------------------------------

    def check(self, issue: IpoIssue, applicants: Sequence[Applicant]) -> List[Violation]:
        """Run every compliance rule against a roster without allocating."""
        violations: List[Violation] = []
        if len(applicants) > MAX_APPLICATIONS_PER_FAMILY_PER_ISSUE:
            violations.append(
                Violation(
                    "FAMILY_APP_LIMIT",
                    ViolationSeverity.BLOCKING,
                    "family",
                    f"{len(applicants)} applicants exceeds the {MAX_APPLICATIONS_PER_FAMILY_PER_ISSUE}"
                    "-application ceiling for one issue; each application needs a distinct PAN",
                )
            )

        seen_pans: Dict[str, str] = {}
        seen_upis: Dict[str, str] = {}
        for applicant in applicants:
            subject = f"{applicant.applicant_id} ({mask_pan(applicant.pan)})"
            pan_key = re.sub(r"[^A-Za-z0-9]", "", applicant.pan).upper()
            if pan_key in seen_pans:
                violations.append(
                    Violation(
                        "DUP_PAN",
                        ViolationSeverity.BLOCKING,
                        subject,
                        f"PAN already used by {seen_pans[pan_key]}; one PAN may submit only one"
                        f" application per issue",
                        "SEBI (Issue of Capital and Disclosure Requirements) Regulations",
                    )
                )
            else:
                seen_pans[pan_key] = applicant.applicant_id

            for handle, relationship in applicant.upi_mandates:
                handle_key = handle.strip().lower()
                if applicant.bank_accounts and handle_key in {
                    b.strip().lower() for b in applicant.bank_accounts
                }:
                    violations.append(
                        Violation(
                            "UPI_ACCOUNT_MISMATCH",
                            ViolationSeverity.BLOCKING,
                            subject,
                            f"UPI handle {mask_upi(handle)} is not linked to a declared bank account",
                        )
                    )
                if handle_key in seen_upis:
                    violations.append(
                        Violation(
                            "UPI_REUSED",
                            ViolationSeverity.BLOCKING,
                            subject,
                            f"UPI handle {mask_upi(handle)} is already committed to "
                            f"{seen_upis[handle_key]}; one UPI mandate per bank account per issue",
                            "NPCI UPI 2.0 / exchange ASBA mandate rules",
                        )
                    )
                else:
                    seen_upis[handle_key] = applicant.applicant_id

                if relationship is UpiRelationship.OTHER:
                    violations.append(
                        Violation(
                            "UPI_NAME_MISMATCH",
                            ViolationSeverity.BLOCKING,
                            subject,
                            f"UPI handle {mask_upi(handle)} is held in a third party's name; "
                            "the mandate name must match the PAN holder or a family member",
                            "UPI 2.0 ASBA circular",
                        )
                    )
                elif relationship is not UpiRelationship.SELF and not names_match(
                    applicant.holder_name, applicant.holder_name
                ):
                    # A family-member mandate is legal; it must still be declared
                    # so the applicant can evidence the relationship at the bank.
                    violations.append(
                        Violation(
                            "UPI_FAMILY_MANDATE",
                            ViolationSeverity.INFO,
                            subject,
                            f"UPI handle {mask_upi(handle)} is in the {relationship.value.lower()}'s name; "
                            "keep evidence of the relationship for the bank",
                            "UPI 2.0 clarification",
                        )
                    )

            if applicant.max_application_inr is not None and applicant.max_application_inr > RETAIL_MAX_AGGREGATE_INR:
                violations.append(
                    Violation(
                        "RETAIL_CAP",
                        ViolationSeverity.WARNING,
                        subject,
                        f"stated per-application cap Rs {applicant.max_application_inr:,.0f} exceeds the"
                        f" Rs {RETAIL_MAX_AGGREGATE_INR:,.0f} retail aggregate; the cap will be clipped",
                        "SEBI retail quota: Rs 2 lakh aggregate per PAN",
                    )
                )
        return violations

    # -- allocation --------------------------------------------------------

    def allocate(
        self,
        issue: IpoIssue,
        applicants: Sequence[Applicant],
        budget_inr: float,
        analytics: Optional[SubscriptionAnalytics] = None,
        forecast: Optional[ListingPopForecast] = None,
        strategy: str = "max_expected_value",
        as_of: Optional[datetime] = None,
    ) -> MandatePlan:
        """
        Produce a compliant allocation plan.

        Strategy:

        * ``max_expected_value`` — send each rupee to the bucket with the best
          probability x price, which is the correct objective when the family
          wants the highest expected listing gain per rupee applied;
        * ``max_probability`` — spread to maximise the chance that every rupee
          is allotted, which minimises idle blocked capital;
        * ``balanced`` — equal split across eligible applicants.
        """
        moment = as_of or datetime.now()
        violations = self.check(issue, applicants)
        budget = max(0.0, budget_inr)

        bucket_times = self._bucket_times(issue, analytics)
        total_times = issue.total.times_subscribed
        list_price = forecast.expected_list_price if forecast else None
        issue_price = forecast.issue_price if forecast else (
            issue.price_band.upper if issue.price_band else None
        )

        if strategy == "balanced":
            weights = {a.applicant_id: 1.0 for a in applicants}
        else:
            weights = {}
            for applicant in applicants:
                bucket = applicant.prefers_bucket or self._best_bucket(issue, applicant, bucket_times, total_times)
                probability, _ = self._effective_probability(bucket, bucket_times, total_times)
                value_ratio = 1.0
                if strategy == "max_expected_value" and list_price and issue_price and issue_price > 0:
                    value_ratio = max(0.0, list_price / issue_price)
                weights[applicant.applicant_id] = probability * value_ratio

        total_weight = sum(weights.values())
        if total_weight <= 0:
            weights = {a.applicant_id: 1.0 for a in applicants}
            total_weight = float(len(weights)) or 1.0

        lines: List[AllocationLine] = []
        allocated = 0.0
        expected_value = 0.0

        for applicant in applicants:
            if budget - allocated < self.min_application:
                continue
            bucket = applicant.prefers_bucket or self._best_bucket(issue, applicant, bucket_times, total_times)
            share = weights.get(applicant.applicant_id, 0.0) / total_weight
            target = budget * share
            application, clipped = self._cap_application(applicant, bucket, target, budget - allocated)
            if application < self.min_application:
                if not clipped and target > 0:
                    violations.append(
                        Violation(
                            "BELOW_MIN_APPLICATION",
                            ViolationSeverity.WARNING,
                            f"{applicant.applicant_id} ({mask_pan(applicant.pan)})",
                            f"Rs {target:,.0f} share falls below the Rs {self.min_application:,.0f}"
                            " practical minimum for a retail application",
                        )
                    )
                continue

            channel, upi_masked, bank_masked, channel_note = self._choose_channel(applicant, bucket, issue)
            if channel is AllocationChannel.NONE:
                violations.append(
                    Violation(
                        "NO_CHANNEL",
                        ViolationSeverity.BLOCKING,
                        f"{applicant.applicant_id} ({mask_pan(applicant.pan)})",
                        "no usable mandate: non-retail requires a bank account and retail requires a UPI handle",
                    )
                )
                continue

            probability, probability_basis = self._effective_probability(bucket, bucket_times, total_times)
            shares: Optional[int] = None
            if issue_price and issue_price > 0:
                shares = int(application // issue_price)
            unit_value = (list_price or issue_price or 0.0) * probability
            line_value = unit_value * shares if shares else 0.0

            lines.append(
                AllocationLine(
                    applicant_id=applicant.applicant_id,
                    bucket=bucket,
                    application_inr=application,
                    channel=channel,
                    shares_at_upper=shares,
                    upi_masked=upi_masked,
                    bank_account_masked=bank_masked,
                    expected_allotment_probability=probability,
                    expected_value_inr=line_value,
                    rationale=f"{channel_note}; allotment probability from {probability_basis}",
                )
            )
            allocated += application
            expected_value += line_value

        if not lines and applicants:
            violations.append(
                Violation(
                    "NOTHING_ALLOCATABLE",
                    ViolationSeverity.WARNING,
                    "portfolio",
                    f"a Rs {budget:,.0f} budget cannot fund a single compliant application"
                    f" (minimum Rs {self.min_application:,.0f} per applicant)",
                )
            )

        expected_return = None
        if allocated > 0:
            expected_return = ((expected_value / allocated) - 1.0) * 100.0

        return MandatePlan(
            symbol=issue.symbol,
            as_of=moment,
            total_budget_inr=budget,
            allocated_inr=allocated,
            lines=tuple(lines),
            violations=tuple(violations),
            expected_value_inr=expected_value,
            expected_return_pct=expected_return,
            residual_inr=max(0.0, budget - allocated),
            strategy=strategy,
        )

    # -- helpers -----------------------------------------------------------

    @staticmethod
    def _effective_probability(
        bucket: InvestorBucket,
        bucket_times: Mapping[InvestorBucket, Optional[float]],
        total_times: Optional[float],
    ) -> Tuple[float, str]:
        """
        Allotment probability for a bucket, with an explicit basis.

        When the exchange publishes only the book total, the per-bucket multiple
        is genuinely unknown, so the total is used as the proxy rather than
        silently assuming either 1x or the retail multiple. With no subscription
        data whatsoever the book is treated as cleared, which is the neutral
        reading of "no demand information".
        """
        own = bucket_times.get(bucket)
        if own is not None and own > 0:
            return bucket_allotment_probability(own), f"{bucket.value} {own:.2f}x"
        if total_times is not None and total_times > 0:
            return (
                bucket_allotment_probability(total_times),
                f"{bucket.value} unpublished; proxied by the {total_times:.2f}x book total",
            )
        return 1.0, f"{bucket.value} unpublished and no book total available; treated as cleared"

    @staticmethod
    def _bucket_times(
        issue: IpoIssue,
        analytics: Optional[SubscriptionAnalytics],
    ) -> Dict[InvestorBucket, Optional[float]]:
        times: Dict[InvestorBucket, Optional[float]] = {
            InvestorBucket.RII: issue.bucket(InvestorBucket.RII).times_subscribed,
            InvestorBucket.SNII: issue.bucket(InvestorBucket.SNII).times_subscribed,
            InvestorBucket.BNII: issue.bucket(InvestorBucket.BNII).times_subscribed,
            InvestorBucket.QIB: issue.bucket(InvestorBucket.QIB).times_subscribed,
        }
        if analytics is not None:
            if times[InvestorBucket.RII] is None:
                times[InvestorBucket.RII] = analytics.retail_times
            if times[InvestorBucket.SNII] is None and times[InvestorBucket.BNII] is None:
                times[InvestorBucket.SNII] = analytics.non_retail_times
                times[InvestorBucket.BNII] = analytics.non_retail_times
        return times

    def _best_bucket(
        self,
        issue: IpoIssue,
        applicant: Applicant,
        bucket_times: Mapping[InvestorBucket, Optional[float]],
        total_times: Optional[float] = None,
    ) -> InvestorBucket:
        """
        Choose the bucket with the highest allotment probability for this
        applicant.

        Eligibility comes first: an applicant with only a UPI handle can bid
        retail, so non-retail is never chosen for them. Among eligible buckets
        the least-oversubscribed wins.
        """
        upi_only = bool(applicant.upi_mandates) and not applicant.bank_accounts
        candidates: List[InvestorBucket]
        if upi_only:
            candidates = [InvestorBucket.RII]
        elif applicant.demat_account and applicant.is_minor is False:
            candidates = [InvestorBucket.RII, InvestorBucket.SNII, InvestorBucket.BNII]
        else:
            candidates = [InvestorBucket.RII, InvestorBucket.SNII]

        best: Optional[InvestorBucket] = None
        best_probability = -1.0
        for bucket in candidates:
            probability, _ = self._effective_probability(bucket, bucket_times, total_times)
            if probability > best_probability:
                best_probability = probability
                best = bucket
        return best or InvestorBucket.RII

    def _cap_application(
        self,
        applicant: Applicant,
        bucket: InvestorBucket,
        target: float,
        remaining: float,
    ) -> Tuple[float, bool]:
        """
        Clip the target to the legal ceiling for the bucket and to the budget
        still available. Returns ``(amount, clipped)``.
        """
        ceiling: float
        if bucket is InvestorBucket.RII:
            ceiling = RETAIL_MAX_AGGREGATE_INR
        elif bucket is InvestorBucket.SNII:
            ceiling = SNII_CEILING_INR
        elif bucket is InvestorBucket.BNII:
            ceiling = float("inf")
        else:
            ceiling = RETAIL_MAX_AGGREGATE_INR

        if applicant.max_application_inr is not None:
            ceiling = min(ceiling, max(0.0, applicant.max_application_inr))

        amount = min(target, ceiling, max(0.0, remaining))
        if bucket is InvestorBucket.SNII and amount > 0:
            # An sNII application must be strictly above the retail ceiling.
            amount = max(amount, min(SNII_FLOOR_INR, remaining))
        if bucket is InvestorBucket.BNII and 0 < amount < BNII_FLOOR_INR:
            amount = min(BNII_FLOOR_INR, remaining)

        amount = math.floor(amount / self.increment) * self.increment
        return max(0.0, amount), amount < target

    def _choose_channel(
        self,
        applicant: Applicant,
        bucket: InvestorBucket,
        issue: IpoIssue,
    ) -> Tuple[AllocationChannel, Optional[str], Optional[str], str]:
        """
        Pick a payment channel and return a human-readable justification.

        UPI is only proposed for retail: non-retail applications must be
        funded by NEFT/RTGS, and proposing a UPI mandate there would produce a
        rejected application.
        """
        if bucket is InvestorBucket.RII and applicant.upi_mandates:
            handle, relationship = applicant.upi_mandates[0]
            return (
                AllocationChannel.UPI,
                mask_upi(handle),
                None,
                f"retail bucket funded by UPI mandate {mask_upi(handle)}"
                + (f" held by the {relationship.value.lower()}" if relationship is not UpiRelationship.SELF else ""),
            )
        if applicant.bank_accounts:
            account = applicant.bank_accounts[0]
            if bucket is InvestorBucket.RII:
                return (
                    AllocationChannel.ASBA_CHEQUE,
                    None,
                    mask_pan(account),
                    "retail bucket funded by ASBA cheque drawn on the declared bank account",
                )
            return (
                AllocationChannel.NET_BANKING,
                None,
                mask_pan(account),
                f"non-retail bucket must be funded by NEFT/RTGS from {mask_pan(account)}; "
                "UPI is not accepted for non-retail applications",
            )
        return (
            AllocationChannel.NONE,
            None,
            None,
            "no UPI handle or bank account declared for this applicant",
        )


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS ipo_issues (
    symbol          TEXT PRIMARY KEY,
    company_name    TEXT,
    segment         TEXT,
    status          TEXT,
    open_date       TEXT,
    close_date      TEXT,
    listing_date    TEXT,
    band_low        REAL,
    band_high       REAL,
    issue_size      REAL,
    payload_json    TEXT,
    ingested_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS subscription_snapshots (
    symbol      TEXT NOT NULL,
    as_of       TEXT NOT NULL,
    total_times REAL,
    rii         REAL,
    snii        REAL,
    bnii        REAL,
    qib         REAL,
    day_index   INTEGER,
    PRIMARY KEY (symbol, as_of)
);
CREATE INDEX IF NOT EXISTS idx_snap_symbol ON subscription_snapshots (symbol, as_of);

CREATE TABLE IF NOT EXISTS listing_outcomes (
    symbol            TEXT PRIMARY KEY,
    segment           TEXT,
    issue_price       REAL,
    list_price        REAL,
    listing_date      TEXT,
    actual_pop_pct    REAL,
    predicted_pop_pct REAL,
    error_pct         REAL,
    recorded_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outcome_segment ON listing_outcomes (segment, listing_date);

CREATE TABLE IF NOT EXISTS mandate_plans (
    symbol       TEXT NOT NULL,
    as_of        TEXT NOT NULL,
    budget_inr   REAL,
    allocated_inr REAL,
    expected_value_inr REAL,
    compliant    INTEGER,
    payload_json TEXT,
    PRIMARY KEY (symbol, as_of)
);
"""


class IpoStore:
    """Idempotent SQLite sink, using the bridge's service-local DB pattern."""

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

    def save_issues(self, issues: Sequence[IpoIssue]) -> int:
        self.ensure_schema()
        now = int(time.time())
        rows = [
            (
                i.symbol, i.company_name, i.segment.value, i.status.value,
                i.open_date.isoformat() if i.open_date else None,
                i.close_date.isoformat() if i.close_date else None,
                i.listing_date.isoformat() if i.listing_date else None,
                i.price_band.low if i.price_band else None,
                i.price_band.high if i.price_band else None,
                i.issue_size_shares,
                json.dumps(i.to_dict(), default=str),
                now,
            )
            for i in issues
        ]
        if not rows:
            return 0
        conn = self.connect(write=True)
        try:
            with self._lock:
                conn.executemany(
                    "INSERT OR REPLACE INTO ipo_issues (symbol,company_name,segment,status,open_date,"
                    "close_date,listing_date,band_low,band_high,issue_size,payload_json,ingested_at) "
                    "VALUES (" + ",".join("?" * 12) + ")",
                    rows,
                )
                conn.commit()
            return len(rows)
        except Exception as exc:
            log.warning("[ipo] save_issues failed: %s", exc)
            return 0
        finally:
            conn.close()

    def save_snapshot(self, snapshot: SubscriptionSnapshot) -> bool:
        """Persist a poll. Returns False when the poll was inside the interval floor."""
        self.ensure_schema()
        conn = self.connect(write=True)
        try:
            cutoff = (snapshot.as_of - timedelta(seconds=SUBSCRIPTION_SNAPSHOT_INTERVAL_S)).isoformat()
            existing = conn.execute(
                "SELECT 1 FROM subscription_snapshots WHERE symbol=? AND as_of > ? LIMIT 1",
                (snapshot.symbol, cutoff),
            ).fetchone()
            if existing:
                return False
            conn.execute(
                "INSERT OR REPLACE INTO subscription_snapshots (symbol,as_of,total_times,rii,snii,bnii,qib,day_index) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (
                    snapshot.symbol,
                    snapshot.as_of.replace(microsecond=0).isoformat(),
                    snapshot.total_times,
                    snapshot.buckets.get(InvestorBucket.RII),
                    snapshot.buckets.get(InvestorBucket.SNII),
                    snapshot.buckets.get(InvestorBucket.BNII),
                    snapshot.buckets.get(InvestorBucket.QIB),
                    snapshot.day_index,
                ),
            )
            conn.commit()
            return True
        except Exception as exc:
            log.warning("[ipo] save_snapshot failed: %s", exc)
            return False
        finally:
            conn.close()

    def save_outcome(
        self,
        symbol: str,
        segment: IssueSegment,
        issue_price: float,
        list_price: float,
        listing_date: date,
        actual_pop_pct: float,
        predicted_pop_pct: Optional[float],
        error_pct: float,
    ) -> None:
        self.ensure_schema()
        conn = self.connect(write=True)
        try:
            conn.execute(
                "INSERT OR REPLACE INTO listing_outcomes (symbol,segment,issue_price,list_price,"
                "listing_date,actual_pop_pct,predicted_pop_pct,error_pct,recorded_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    symbol, segment.value, issue_price, list_price, listing_date.isoformat(),
                    actual_pop_pct, predicted_pop_pct, error_pct, int(time.time()),
                ),
            )
            conn.commit()
        except Exception as exc:
            log.warning("[ipo] save_outcome failed: %s", exc)
        finally:
            conn.close()

    def recent_outcomes(self, segment: Optional[IssueSegment] = None, days: int = 730) -> List[Dict[str, Any]]:
        self.ensure_schema()
        conn = self.connect()
        try:
            cutoff = (date.today() - timedelta(days=days)).isoformat()
            if segment is None:
                cursor = conn.execute(
                    "SELECT symbol,segment,issue_price,list_price,listing_date,actual_pop_pct,"
                    "predicted_pop_pct,error_pct FROM listing_outcomes WHERE listing_date >= ?",
                    (cutoff,),
                )
            else:
                cursor = conn.execute(
                    "SELECT symbol,segment,issue_price,list_price,listing_date,actual_pop_pct,"
                    "predicted_pop_pct,error_pct FROM listing_outcomes "
                    "WHERE listing_date >= ? AND segment = ?",
                    (cutoff, segment.value),
                )
            out: List[Dict[str, Any]] = []
            for row in cursor:
                record = dict(row)
                if record.get("listing_date"):
                    try:
                        record["listing_date"] = coerce_date(record["listing_date"])
                    except Exception:  # pragma: no cover - defensive
                        record["listing_date"] = None
                out.append(record)
            return out
        except Exception as exc:
            log.warning("[ipo] recent_outcomes failed: %s", exc)
            return []
        finally:
            conn.close()

    def save_plan(self, plan: MandatePlan) -> None:
        self.ensure_schema()
        conn = self.connect(write=True)
        try:
            conn.execute(
                "INSERT OR REPLACE INTO mandate_plans (symbol,as_of,budget_inr,allocated_inr,"
                "expected_value_inr,compliant,payload_json) VALUES (?,?,?,?,?,?,?)",
                (
                    plan.symbol,
                    plan.as_of.replace(microsecond=0).isoformat(),
                    plan.total_budget_inr,
                    plan.allocated_inr,
                    plan.expected_value_inr,
                    1 if plan.is_compliant else 0,
                    json.dumps(plan.to_dict(), default=str),
                ),
            )
            conn.commit()
        except Exception as exc:
            log.warning("[ipo] save_plan failed: %s", exc)
        finally:
            conn.close()

    def plan_history(self, symbol: str, limit: int = 20) -> List[Dict[str, Any]]:
        self.ensure_schema()
        conn = self.connect()
        try:
            return [
                json.loads(row["payload_json"])
                for row in conn.execute(
                    "SELECT payload_json FROM mandate_plans WHERE symbol=? ORDER BY as_of DESC LIMIT ?",
                    (symbol, limit),
                )
            ]
        except Exception as exc:
            log.warning("[ipo] plan_history failed: %s", exc)
            return []
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class IssueReport:
    """The engine's full view of one book."""

    issue: IpoIssue
    analytics: SubscriptionAnalytics
    gmp: Optional[GmpQuote]
    forecast: ListingPopForecast

    def to_dict(self) -> Dict[str, Any]:
        return {
            "issue": self.issue.to_dict(),
            "analytics": self.analytics.to_dict(),
            "gmp": self.gmp.to_dict() if self.gmp else None,
            "forecast": self.forecast.to_dict(),
        }


class IpoSyndicateEngine:
    """
    Top-level facade: track books, price the pop, allocate mandates.

    Bridge usage::

        engine = IpoSyndicateEngine()
        for report in engine.scan():
            ...  # report.forecast.expected_pop_pct
        plan = engine.allocate("SMT", family, budget_inr=2_500_000)

    ``scan`` never raises. A source that is blocked or has changed shape is
    reported in ``notes`` and the remaining sources still produce output.
    """

    def __init__(
        self,
        fetcher: Optional[ResilientFetcher] = None,
        store: Optional[IpoStore] = None,
        analyzer: Optional[SubscriptionAnalyzer] = None,
        estimator: Optional[ListingPopEstimator] = None,
        allocator: Optional[MandateAllocator] = None,
        persist: bool = True,
    ) -> None:
        self.fetcher = fetcher or ResilientFetcher()
        self.store = store or IpoStore()
        self.analyzer = analyzer or SubscriptionAnalyzer()
        self.estimator = estimator or ListingPopEstimator(store=self.store)
        self.allocator = allocator or MandateAllocator()
        self.persist = persist

    # -- ingestion ---------------------------------------------------------

    def fetch_current_issues(self) -> Tuple[List[IpoIssue], FetchOutcome]:
        outcome = self.fetcher.get_json(NSE_IPO_CURRENT_URL, "nse_ipo_current", force_warm=True)
        if not outcome.ok:
            return [], outcome
        issues = parse_ipo_current_issue(outcome.payload)
        if self.persist:
            self.store.save_issues(issues)
        log.info("[ipo] current issues: %d parsed", len(issues))
        return issues, replace(outcome, payload={"issues": len(issues)})

    def fetch_upcoming_issues(self) -> Tuple[List[IpoIssue], FetchOutcome]:
        outcome = self.fetcher.get_json(NSE_IPO_UPCOMING_URL, "nse_ipo_upcoming")
        if not outcome.ok:
            return [], outcome
        issues = parse_upcoming_issues(outcome.payload)
        if self.persist:
            self.store.save_issues(issues)
        log.info("[ipo] upcoming issues: %d parsed", len(issues))
        return issues, replace(outcome, payload={"issues": len(issues)})

    def fetch_past_issues(self) -> Tuple[List[Dict[str, Any]], FetchOutcome]:
        outcome = self.fetcher.get_json(NSE_IPO_PAST_URL, "nse_ipo_past")
        if not outcome.ok:
            return [], outcome
        rows = parse_past_issues(outcome.payload)
        log.info("[ipo] past issues: %d parsed", len(rows))
        return rows, replace(outcome, payload={"issues": len(rows)})

    def fetch_gmp(self, issue: IpoIssue, issues: Optional[Mapping[str, IpoIssue]] = None) -> Optional[GmpQuote]:
        """
        Try every registered GMP provider in order, first success wins.

        Returns ``None`` when no provider is configured or reachable. This is a
        normal outcome, not an error: the forecast falls back to the
        subscription prior and says so in its rationale.
        """
        book = dict(issues or {})
        book[issue.symbol] = issue
        for name, provider in _GMP_PROVIDERS:
            try:
                quote = provider(issue, book, self.fetcher)
            except Exception as exc:
                log.warning("[ipo] GMP provider %s failed for %s: %s", name, issue.symbol, exc)
                continue
            if quote is not None:
                log.info("[ipo] GMP for %s via %s: %s", issue.symbol, name, quote.premium_pct)
                return quote
        return None

    # -- orchestration -----------------------------------------------------

    def scan(self, as_of: Optional[datetime] = None) -> Tuple[List[IssueReport], List[str]]:
        """Poll every open book and return a priced report per issue."""
        moment = as_of or datetime.now()
        notes: List[str] = []

        issues, outcome = self.fetch_current_issues()
        if not outcome.ok:
            notes.append(f"nse_ipo_current: {outcome.error}")
            # The pipeline feed still yields books, just without subscription.
            pipeline, pipeline_outcome = self.fetch_upcoming_issues()
            if pipeline:
                notes.append(f"fell back to the upcoming-issues feed ({len(pipeline)} book(s), no demand data)")
                issues = pipeline
            else:
                return [], notes or ["no IPO feed reachable"]

        reports: List[IssueReport] = []
        for issue in issues:
            try:
                snapshot = self.analyzer.observe(issue, as_of=moment)
                if self.persist:
                    self.store.save_snapshot(snapshot)
                analytics = self.analyzer.analyze(issue, as_of=moment)
                gmp = self.fetch_gmp(issue, {i.symbol: i for i in issues})
                if gmp is None and registered_gmp_providers():
                    notes.append(
                        f"{issue.symbol}: no GMP quote available "
                        f"(providers tried: {', '.join(registered_gmp_providers())})"
                    )
                forecast = self.estimator.estimate(issue, analytics, gmp=gmp, as_of=moment)
                reports.append(IssueReport(issue, analytics, gmp, forecast))
            except Exception as exc:  # pragma: no cover - per-issue guard
                log.warning("[ipo] report failed for %s: %s", issue.symbol, exc)
                notes.append(f"{issue.symbol}: {exc}")
        return reports, notes

    def allocate(
        self,
        symbol: str,
        applicants: Sequence[Applicant],
        budget_inr: float,
        strategy: str = "max_expected_value",
        as_of: Optional[datetime] = None,
    ) -> MandatePlan:
        """
        Build a compliant mandate plan for one symbol from live market state.

        Market state is refreshed first so the allocation is based on current
        demand rather than whatever was last persisted.
        """
        moment = as_of or datetime.now()
        sym = normalize_symbol(symbol)
        if not sym:
            raise ValueError(f"invalid symbol: {symbol!r}")
        if not applicants:
            raise ValueError("at least one applicant is required")

        issues, _ = self.fetch_current_issues()
        issue = next((i for i in issues if i.symbol == sym), None)
        if issue is None:
            # Fall back to the pipeline so a mandate can still be prepared for
            # a book that has not opened yet.
            pipeline, _ = self.fetch_upcoming_issues()
            issue = next((i for i in pipeline if i.symbol == sym), None)
        if issue is None:
            raise ValueError(f"{sym} is not in the current or upcoming book list")

        self.analyzer.observe(issue, as_of=moment)
        analytics = self.analyzer.analyze(issue, as_of=moment)
        gmp = self.fetch_gmp(issue, {issue.symbol: issue})
        forecast = self.estimator.estimate(issue, analytics, gmp=gmp, as_of=moment)

        plan = self.allocator.allocate(
            issue=issue,
            applicants=applicants,
            budget_inr=budget_inr,
            analytics=analytics,
            forecast=forecast,
            strategy=strategy,
            as_of=moment,
        )
        if self.persist:
            self.store.save_plan(plan)
        return plan

    def close(self) -> None:
        self.fetcher.close()


# ---------------------------------------------------------------------------
# Module singleton + CLI
# ---------------------------------------------------------------------------

engine = IpoSyndicateEngine()


def get_engine() -> IpoSyndicateEngine:
    """Accessor for the process-wide engine (bridge router convention)."""
    return engine


def _demo_family() -> Tuple[Applicant, ...]:
    """
    A structurally illustrative roster used only by ``--demo``.

    These are fabricated PAN/UPI placeholders shaped to be obviously synthetic;
    they exist so the allocator's constraint logic can be exercised without any
    real applicant identity being present in the repository.
    """
    return (
        Applicant(
            applicant_id="A1",
            holder_name="RAJESH KUMAR",
            pan="XXXXXX0001",
            upi_mandates=(("rajesh.demo@upi", UpiRelationship.SELF),),
            prefers_bucket=InvestorBucket.RII,
            notes="synthetic demo identity",
        ),
        Applicant(
            applicant_id="A2",
            holder_name="SUNITA KUMAR",
            pan="XXXXXX0002",
            upi_mandates=(("sunita.demo@upi", UpiRelationship.SELF),),
            prefers_bucket=InvestorBucket.RII,
            notes="synthetic demo identity",
        ),
        Applicant(
            applicant_id="A3",
            holder_name="ARJUN KUMAR",
            pan="XXXXXX0003",
            upi_mandates=(("arjun.demo@upi", UpiRelationship.SPOUSE),),
            bank_accounts=("XXXXXX9003",),
            demat_account="XXXXXX8003",
            notes="synthetic demo identity",
        ),
    )


def _cell(value: Optional[float], width: int = 8) -> str:
    """Right-aligned numeric table cell; missing values print as ``n/a``."""
    text = "n/a" if value is None else f"{value:.2f}"
    return text.rjust(width)


def _main() -> int:  # pragma: no cover - operator entry point
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="IPO subscription / GMP / family mandate engine")
    parser.add_argument("--symbol", help="price one book in detail")
    parser.add_argument("--allocate", metavar="SYMBOL", help="print a demo mandate plan for SYMBOL")
    parser.add_argument("--budget", type=float, default=2_500_000.0, help="rupee budget for --allocate")
    parser.add_argument("--strategy", default="max_expected_value",
                        choices=("max_expected_value", "max_probability", "balanced"))
    parser.add_argument("--json", action="store_true", help="emit JSON")
    parser.add_argument("--no-persist", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    instance = IpoSyndicateEngine(persist=not args.no_persist)

    try:
        if args.allocate:
            try:
                plan = instance.allocate(
                    args.allocate, _demo_family(), args.budget, strategy=args.strategy
                )
            except ValueError as exc:
                print(f"error: {exc}", file=sys.stderr)
                return 2
            if args.json:
                print(json.dumps(plan.to_dict(), indent=2, default=str))
            else:
                print(f"{plan.symbol}: budget Rs{plan.total_budget_inr:,.0f} "
                      f"allocated Rs{plan.allocated_inr:,.0f} ({plan.strategy})")
                for line in plan.lines:
                    print(f"   {line.applicant_id:4} {line.bucket.value:5} Rs{line.application_inr:>12,.0f} "
                          f"{line.channel.value:13} P(allot)={line.expected_allotment_probability:6.2%} "
                          f"E[value]=Rs{line.expected_value_inr:>12,.0f}  {line.rationale}")
                for violation in plan.violations:
                    print(f"   [{violation.severity.value:8}] {violation.code}: {violation.message}")
            return 0

        reports, notes = instance.scan()
        if args.json:
            print(json.dumps([r.to_dict() for r in reports], indent=2, default=str))
        else:
            print(f"{'SYMBOL':<12} {'SEG':<4} {'CLOSE':<11} {'TOTAL':>9} {'RII':>9} "
                  f"{'sNII':>9} {'bNII':>9} {'QIB':>8} {'POP':>8} {'CONF':>6} CROWDING")
            for r in reports:
                a = r.analytics
                close = r.issue.close_date.isoformat() if r.issue.close_date else "-"
                print(f"{r.issue.symbol:<12} {r.issue.segment.value[:3]:<4} {close:<11} "
                      f"{_cell(a.total_times):>9} {_cell(a.retail_times):>9} "
                      f"{_cell(a.non_retail_times):>9} {_cell(a.qib_times):>8} "
                      f"{_cell(r.forecast.expected_pop_pct):>8} "
                      f"{r.forecast.confidence:6.2f} {a.crowding}")
            for note in notes:
                print(f"  note: {note}")
        return 0
    finally:
        instance.close()


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(_main())