"""
corporate_catalyst_radar.py — WealthOS Alpha Engine 2.0
=======================================================

Automated corporate-catalyst ingestion + asymmetric scoring radar for the
Indian market. Scrapes NSE and BSE corporate disclosures, parses them into
typed events, classifies the catalyst, and produces an *asymmetric* score used
to shortlist 3:00 PM BTST (buy-today-sell-tomorrow) candidates.

What it ingests
---------------
* NSE corporate announcements   (order wins, regulatory actions, project awards)
* NSE board meeting outcomes    (results, dividends, fund-raising, buybacks)
* NSE corporate actions         (dividend / bonus / split / buyback ex-dates)
* BSE corporate disclosures     (redundant cross-check, SME coverage)

What it computes
----------------
* `CatalystEvent`  — a normalized, typed disclosure (symbol, category, parsed
  order value, dividend, earnings beat, dates, provenance).
* `CatalystScore`  — direction (bullish/bearish/neutral), impact tier 1-3, an
  *asymmetry score* in [-100, +100], conviction, expected move, and a BTST flag.

Asymmetry model
---------------
    raw      = base_weight[category] + event_boost            (>= 0 magnitude)
    signed   = direction_sign * raw                           (+1 / -1 / 0)
    decayed  = signed * decay(age, half_life_hours)
    asym     = decayed * (upside_mult if signed > 0 else downside_mult)
                       * liquidity_factor * novelty_factor
    asym     = clip(asym, -100, +100)

* **Upside multiplier** (> 1) captures the fact that positive Indian catalysts
  (order wins, earnings beats, buybacks) have fat right tails, while downside is
  bounded by circuit limits / regulatory floors — hence "asymmetric".
* **Liquidity factor** scales the edge by traded value (illiquid names are
  un-BTST-able even on a great catalyst).
* **Novelty factor** crushes re-published/recycled/routine-filing noise.

Robustness
----------
* Every network path is wrapped and fails soft to `None` / `[]`; a DNS outage
  or NSE cookie wall degrades to an empty report, never a crash.
* `httpx` is optional at import time (`_HTTPX_AVAILABLE`); parsing/classification
  and scoring remain fully functional offline for tests and backfills.
* A built-in `offline=True` mode replays representative mock disclosures so the
  whole pipeline is exercisable without a live network.

Public API
----------
    classify_catalyst(headline, body="") -> str
    parse_event(raw, source="NSE") -> Optional[CatalystEvent]
    score_catalyst(event, ...) -> CatalystScore
    build_radar(events, ...) -> RadarReport
    scan_radar(offline=False, ...) -> RadarReport
    select_btst_candidates(report, ...) -> List[CatalystScore]
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, time as dtime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

try:  # httpx is in python-bridge/requirements.txt; keep import optional.
    import httpx

    _HTTPX_AVAILABLE = True
except Exception:  # pragma: no cover - import guard
    httpx = None  # type: ignore[assignment]
    _HTTPX_AVAILABLE = False

try:  # Polars is used only for the tabular export path.
    import polars as pl

    _POLARS_AVAILABLE = True
except Exception:  # pragma: no cover - import guard
    pl = None  # type: ignore[assignment]
    _POLARS_AVAILABLE = False

__version__ = "1.0.0"

log = logging.getLogger("corporate_catalyst_radar")

IST = ZoneInfo("Asia/Kolkata")
BTST_CUTOFF = dtime(15, 0, tzinfo=IST)  # 3:00 PM IST decision point

# ==============================================================================
# CONFIGURATION
# ==============================================================================

NSE_BASE = "https://www.nseindia.com"
NSE_ANNOUNCEMENTS = f"{NSE_BASE}/api/corporate-announcements"
NSE_BOARD_MEETINGS = f"{NSE_BASE}/api/corporate-board-meetings"
NSE_CORPORATE_ACTIONS = f"{NSE_BASE}/api/corporates-corporateActions"
NSE_HOME = NSE_BASE
NSE_ANN_PAGE = f"{NSE_BASE}/companies-listing/corporate-filings-announcements"
BSE_ANNOUNCEMENTS = "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w"

_HTTP_HEADERS: Dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
    "Connection": "keep-alive",
}

# Phrases that are by themselves routine filings — checked before all else so a
# "Newspaper Publication of Results" is never scored as a real earnings catalyst.
_HARD_NOISE = (
    "newspaper publication",
    "newspaper clipping",
    "loss of share certificate",
    "duplicate share certificate",
    "compliance certificate",
    "secretarial compliance",
    "trading window",
    "certificate under",
)

# Category priority — most-impactful/decided first. First match wins.
_CATEGORY_RULES: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    ("ORDER_WIN", ("order win", "bags order", "bagged order", "order worth", "letter of award",
                   "loa ", "work order", "contract awarded", "receives order", "wins order",
                   "awarded", "purchase order", "epc contract", "new order", "order from")),
    ("EARNINGS", ("financial result", "quarterly result", "net profit", "q1 results", "q2 results",
                  "q3 results", "q4 results", "provisional result", "un-audited", "unaudited",
                  "revenue from operations", "ebitda", "earnings")),
    ("DIVIDEND", ("dividend", "interim dividend", "final dividend", "special dividend", "record date")),
    ("CORPORATE_ACTION", ("bonus issue", "stock split", "sub-division", "buyback", "buy back",
                          "demerger", "amalgamation", "scheme of arrangement", "rights issue", "bonus")),
    ("FUNDRAISE", ("qip", "qualified institutions placement", "preferential allotment", "fund rais",
                   "fundrais", "rights entitlement", "ncd", "debenture", "commercial paper")),
    ("CREDIT_RATING", ("credit rating", "rating action", "crisil", "icra", "care ratings", "ind-ra",
                       "downgrade", "upgrade")),
    ("REGULATORY", ("sebi", "rbi", "penalty", "show cause", "enforcement", "cbi", "ed raid",
                    "income tax raid", "gst notice", "search and seizure", "fraud", "insolvency",
                    "ibc", "nclt", "default", "defaulter", "trading halt", "suspension")),
    ("MANAGEMENT", ("resignation", "resign", "appointment", "appointed", "cessation", "ceo", "cfo",
                    "managing director", "whole-time director", "independent director", "kmp")),
    ("BOARD_MEETING", ("board meeting", "board of directors", "meeting of the board", "scheduled to meet")),
    ("INSIDER", ("insider", "pit regulation", "prohibition of insider", "promoter acquisition",
                 "promoter purchase", "sast", "shareholding")),
    ("NOISE", ("newspaper publication", "newspaper clipping", "compliance certificate",
               "trading window", "loss of share certificate", "duplicate share certificate",
               "analyst meet", "investor presentation", "clarification", "reg. 74",
               "certificate under", "secretarial compliance")),
)

_BULLISH_TERMS = (
    "order win", "bags order", "bags ", "order worth", "awarded", "wins", "profit rises",
    "profit up", "profit jumps", "revenue up", "revenue rises", "growth", "dividend", "bonus",
    "buyback", "buy back", "upgrade", "record date", "new order", "acquires", "acquisition",
    "expansion", "approval", "in-principle", "commercial production", "commences", "partnership",
    "mou", "highest ever", "all-time high", "beat",
)
_BEARISH_TERMS = (
    "penalty", "show cause", "raid", "search and seizure", "fraud", "default", "downgrade",
    "resign", "resignation", "profit falls", "profit down", "loss", "net loss", "declines",
    "decreases", "sebi order", "nclt", "insolvency", "ibc", "suspension", "recall", "probe",
    "disruption", "shutdown", "plant closure", "strike",
)
_NOISE_TERMS = (
    "newspaper publication", "newspaper clipping", "compliance certificate", "trading window",
    "loss of share certificate", "duplicate share certificate", "investor presentation",
    "analyst meet", "clarification", "routine", "intimation of",
)

# Magnitude base weights by category.
_BASE_WEIGHT: Dict[str, float] = {
    "ORDER_WIN": 55.0,
    "EARNINGS": 50.0,
    "CORPORATE_ACTION": 38.0,
    "DIVIDEND": 30.0,
    "CREDIT_RATING": 30.0,
    "MANAGEMENT": 28.0,
    "REGULATORY": 58.0,
    "FUNDRAISE": 18.0,
    "BOARD_MEETING": 12.0,
    "INSIDER": 22.0,
    "NOISE": 3.0,
    "OTHER": 10.0,
}

_CRORE = 1_00_00_000.0  # 1 crore = 10,000,000
_LAKH = 1_00_000.0
_MILLION = 1_000_000.0
_BILLION = 1_000_000_000.0


@dataclass(frozen=True, slots=True)
class RadarConfig:
    """Tunable scoring + BTST selection parameters (all instantiable for tests)."""

    value_area_pct: float = 0.70  # kept for API symmetry with the VP engine
    decay_half_life_hours: float = 6.0
    upside_mult: float = 1.15
    downside_mult: float = 0.90
    hvn_sigma: float = 1.0  # unused here; reserved
    tier1_threshold: float = 55.0
    tier2_threshold: float = 30.0
    btst_min_asymmetry: float = 35.0
    btst_min_adv_inr: float = 5.0 * _CRORE  # ~Rs 5 Cr traded value floor
    order_mcap_tier1_ratio: float = 0.15
    earnings_beat_profit_pct: float = 15.0
    earnings_beat_revenue_pct: float = 10.0
    btst_after: dtime = BTST_CUTOFF
    max_events: int = 400


# ==============================================================================
# DATA CONTRACTS
# ==============================================================================


@dataclass(frozen=True, slots=True)
class DividendInfo:
    amount_inr: Optional[float] = None
    rate_pct: Optional[float] = None
    ex_date: Optional[date] = None
    record_date: Optional[date] = None
    dividend_type: str = "unknown"  # interim / final / special / unknown

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["ex_date"] = self.ex_date.isoformat() if self.ex_date else None
        d["record_date"] = self.record_date.isoformat() if self.record_date else None
        return d


@dataclass(frozen=True, slots=True)
class EarningsInfo:
    quarter: Optional[str] = None
    revenue_inr: Optional[float] = None
    net_profit_inr: Optional[float] = None
    revenue_growth_pct: Optional[float] = None
    profit_growth_pct: Optional[float] = None
    is_beat: Optional[bool] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class CatalystEvent:
    event_id: str
    symbol: str
    company: str
    source: str
    category: str
    headline: str
    raw_text: str
    published_at: datetime
    url: Optional[str] = None
    attachment: Optional[str] = None
    order_value_inr: Optional[float] = None
    order_value_pct_of_mcap: Optional[float] = None
    acquisition_value_inr: Optional[float] = None
    dividend: Optional[DividendInfo] = None
    earnings: Optional[EarningsInfo] = None
    tags: Tuple[str, ...] = ()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_id": self.event_id,
            "symbol": self.symbol,
            "company": self.company,
            "source": self.source,
            "category": self.category,
            "headline": self.headline,
            "raw_text": self.raw_text,
            "published_at": self.published_at.isoformat(),
            "url": self.url,
            "attachment": self.attachment,
            "order_value_inr": self.order_value_inr,
            "order_value_pct_of_mcap": self.order_value_pct_of_mcap,
            "acquisition_value_inr": self.acquisition_value_inr,
            "dividend": self.dividend.to_dict() if self.dividend else None,
            "earnings": self.earnings.to_dict() if self.earnings else None,
            "tags": list(self.tags),
        }


@dataclass(frozen=True, slots=True)
class CatalystScore:
    event_id: str
    symbol: str
    category: str
    direction: str  # bullish / bearish / neutral
    impact_tier: int  # 1 (highest) / 2 / 3
    asymmetry_score: float  # -100 .. +100
    magnitude: float
    conviction: float  # 0 .. 1
    decay_factor: float  # 0 .. 1
    liquidity_factor: float
    novelty_factor: float
    expected_move_pct: Optional[float]
    rationale: Tuple[str, ...]
    btst_eligible: bool

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["asymmetry_score"] = round(self.asymmetry_score, 4)
        d["magnitude"] = round(self.magnitude, 4)
        d["conviction"] = round(self.conviction, 4)
        d["expected_move_pct"] = (
            None if self.expected_move_pct is None else round(self.expected_move_pct, 4)
        )
        d["rationale"] = list(self.rationale)
        return d


@dataclass(frozen=True, slots=True)
class RadarReport:
    generated_at: datetime
    source_mode: str
    events_scanned: int
    events_parsed: int
    candidates: List[CatalystScore] = field(default_factory=list)
    all_scores: List[CatalystScore] = field(default_factory=list)
    errors: Tuple[str, ...] = ()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "generated_at": self.generated_at.isoformat(),
            "source_mode": self.source_mode,
            "events_scanned": self.events_scanned,
            "events_parsed": self.events_parsed,
            "candidates": [c.to_dict() for c in self.candidates],
            "all_scores": [s.to_dict() for s in self.all_scores],
            "errors": list(self.errors),
        }


# ==============================================================================
# LOW-LEVEL PARSING HELPERS
# ==============================================================================

_AMOUNT_RE = re.compile(
    r"(?P<cur>rs\.?|inr|₹|usd|\$|eur|gbp)?\s*"
    r"(?P<num>\d[\d,]*(?:\.\d+)?)\s*"
    r"(?P<unit>crores?|crs?|cr\b|lakhs?|lacs?|million|mn|billion|bn|trillion|tn)?",
    re.IGNORECASE,
)


def parse_amount_inr(text: str) -> Tuple[Optional[float], Optional[str]]:
    """
    Extract the first monetary amount from free text and normalize to INR.

    Handles crore / lakh / million / billion suffixes and Rs/INR/USD prefixes.
    USD is converted at a conservative fixed FX (documented, not live) so upstream
    ranking stays deterministic; callers that need exactness should override.
    Returns (value_inr, matched_phrase).
    """
    if not text:
        return None, None
    for m in _AMOUNT_RE.finditer(text):
        num_raw = m.group("num").replace(",", "")
        try:
            num = float(num_raw)
        except ValueError:
            continue
        unit = (m.group("unit") or "").lower()
        cur = (m.group("cur") or "").lower()
        mult = 1.0
        if unit.startswith("cr"):
            mult = _CRORE
        elif unit.startswith("lakh") or unit.startswith("lac"):
            mult = _LAKH
        elif unit.startswith("mn") or "million" in unit:
            mult = _MILLION
        elif unit.startswith("bn") or "billion" in unit:
            mult = _BILLION
        elif unit.startswith("tn") or "trillion" in unit:
            mult = 1_000_000_000_000.0
        value = num * mult
        if cur in ("usd", "$"):
            value *= 83.0  # fixed documented FX; deterministic for ranking
        elif cur in ("eur",):
            value *= 90.0
        elif cur in ("gbp",):
            value *= 105.0
        return value, m.group(0).strip()
    return None, None


_PCT_RE = re.compile(r"([+-]?\d+(?:\.\d+)?)\s*%")
_DATE_PATTERNS = (
    "%d-%b-%Y",
    "%d-%b-%y",
    "%d %b %Y",
    "%d-%m-%Y",
    "%d/%m/%Y",
    "%Y-%m-%d",
    "%b %d, %Y",
    "%d-%B-%Y",
    "%d %B %Y",
)


def parse_pct(text: str, *, keyword: Optional[str] = None) -> Optional[float]:
    """Parse the first (or keyword-adjacent) percentage from text."""
    if not text:
        return None
    haystack = text
    if keyword:
        idx = text.lower().find(keyword.lower())
        if idx >= 0:
            haystack = text[idx: idx + 160]
    m = _PCT_RE.search(haystack)
    if not m:
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


def parse_date(text: str) -> Optional[date]:
    """Parse a date from free text across the common NSE/BSE disclosure formats."""
    if not text:
        return None
    cleaned = text.strip()
    # Fast path: ISO date prefix.
    iso = re.search(r"(\d{4}-\d{2}-\d{2})", cleaned)
    if iso:
        try:
            return date.fromisoformat(iso.group(1))
        except ValueError:
            pass
    token = re.search(
        r"(\d{1,2}[-/ ](?:[A-Za-z]{3,9}|\d{1,2})[-/ ]\d{2,4})", cleaned
    )
    candidates = [token.group(1)] if token else []
    candidates.append(cleaned[:24])
    for cand in candidates:
        for fmt in _DATE_PATTERNS:
            try:
                return datetime.strptime(cand.strip(), fmt).date()
            except ValueError:
                continue
    return None


def parse_ist_datetime(value: Any, default: Optional[datetime] = None) -> datetime:
    """Coerce an NSE/BSE timestamp (str/datetime/epoch) into tz-aware IST."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=IST)
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=IST)
        except (OverflowError, OSError, ValueError):
            pass
    if isinstance(value, str) and value.strip():
        text = value.strip()
        for fmt in (
            "%d-%b-%Y %H:%M:%S",
            "%d-%b-%Y %H:%M",
            "%d-%m-%Y %H:%M:%S",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%dT%H:%M:%S%z",
            "%Y-%m-%dT%H:%M:%S",
        ):
            try:
                dt = datetime.strptime(text, fmt)
                return dt if dt.tzinfo else dt.replace(tzinfo=IST)
            except ValueError:
                continue
        d = parse_date(text)
        if d:
            return datetime.combine(d, dtime(0, 0), tzinfo=IST)
    return default or datetime.now(tz=IST)


def _stable_id(*parts: str) -> str:
    joined = "||".join(p.strip().lower() for p in parts if p)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


def _direction(headline: str, body: str) -> str:
    text = f"{headline} {body}".lower()
    bull = sum(1 for t in _BULLISH_TERMS if t in text)
    bear = sum(1 for t in _BEARISH_TERMS if t in text)
    if bull > bear:
        return "bullish"
    if bear > bull:
        return "bearish"
    return "neutral"


def classify_catalyst(headline: str, body: str = "") -> str:
    """Priority-ordered keyword classifier; returns a category constant."""
    text = f"{headline} {body}".lower()
    if any(term in text for term in _HARD_NOISE):
        return "NOISE"
    for category, terms in _CATEGORY_RULES:
        for term in terms:
            if term in text:
                return category
    return "OTHER"


def _novelty_factor(text: str) -> float:
    """1.0 for genuinely new information; degraded for routine/recycled filings."""
    lowered = text.lower()
    hits = sum(1 for t in _NOISE_TERMS if t in lowered)
    if hits == 0:
        return 1.0
    return max(0.15, 1.0 - 0.30 * hits)


# ==============================================================================
# EVENT PARSING / NORMALIZATION
# ==============================================================================


def _first_key(raw: Dict[str, Any], keys: Sequence[str]) -> Optional[Any]:
    lowered = {str(k).lower(): v for k, v in raw.items()}
    for key in keys:
        if key.lower() in lowered and lowered[key.lower()] not in (None, ""):
            return lowered[key.lower()]
    return None


def _extract_dividend(text: str) -> Optional[DividendInfo]:
    lowered = text.lower()
    if "dividend" not in lowered and "record date" not in lowered:
        return None
    amount, _ = parse_amount_inr(text)
    rate = None
    rate_match = re.search(r"(?:rs\.?\s*)?(\d+(?:\.\d+)?)\s*(?:%|per\s*share|/-)", lowered)
    if rate_match:
        try:
            rate = float(rate_match.group(1))
        except ValueError:
            rate = None
    ex_date = None
    record_date = None
    for key, target in (("ex-date", "ex"), ("ex date", "ex"), ("record date", "rec")):
        idx = lowered.find(key)
        if idx >= 0:
            parsed = parse_date(text[idx: idx + 48])
            if target == "ex":
                ex_date = ex_date or parsed
            else:
                record_date = record_date or parsed
    if "interim" in lowered:
        dtype = "interim"
    elif "special" in lowered:
        dtype = "special"
    elif "final" in lowered:
        dtype = "final"
    else:
        dtype = "unknown"
    if amount is None and rate is None and ex_date is None and record_date is None:
        return None
    return DividendInfo(
        amount_inr=amount,
        rate_pct=rate,
        ex_date=ex_date,
        record_date=record_date,
        dividend_type=dtype,
    )


_EARNINGS_QUARTER_RE = re.compile(r"\bq([1-4])\b", re.IGNORECASE)


def _extract_earnings(text: str) -> Optional[EarningsInfo]:
    lowered = text.lower()
    if not any(k in lowered for k in ("result", "net profit", "revenue", "ebitda", "quarter")):
        return None
    quarter = None
    qm = _EARNINGS_QUARTER_RE.search(text)
    if qm:
        fy = re.search(r"\bFY\s*(\d{2,4})\b", text, re.IGNORECASE)
        cal_year = None if fy else re.search(r"\b(20\d{2})\b", text)
        if fy:
            yr = fy.group(1)
            yr = yr if len(yr) == 4 else f"20{yr}"
            quarter = f"Q{qm.group(1)} FY{yr[2:]}"
        elif cal_year:
            quarter = f"Q{qm.group(1)} FY{int(cal_year.group(1)) % 100:02d}"
        else:
            quarter = f"Q{qm.group(1)}"
    profit_idx = lowered.find("net profit")
    if profit_idx < 0:
        profit_idx = lowered.find("pat")
    revenue_idx = lowered.find("revenue")
    if revenue_idx < 0:
        revenue_idx = lowered.find("total income")
    net_profit, _ = (parse_amount_inr(text[profit_idx: profit_idx + 120]) if profit_idx >= 0 else (None, None))
    revenue, _ = (parse_amount_inr(text[revenue_idx: revenue_idx + 120]) if revenue_idx >= 0 else (None, None))
    profit_growth = parse_pct(text, keyword="net profit") or parse_pct(text, keyword="pat")
    revenue_growth = parse_pct(text, keyword="revenue") or parse_pct(text, keyword="income")
    if all(v is None for v in (quarter, revenue, net_profit, profit_growth, revenue_growth)):
        return None
    return EarningsInfo(
        quarter=quarter,
        revenue_inr=revenue,
        net_profit_inr=net_profit,
        revenue_growth_pct=revenue_growth,
        profit_growth_pct=profit_growth,
        is_beat=None,
    )


def _detect_category_tags(text: str) -> Tuple[str, ...]:
    lowered = text.lower()
    tags: List[str] = []
    if any(k in lowered for k in ("usfda", "us fda", "fda approval", "anda", "form 483", "import alert")):
        tags.append("FDA")
    if any(k in lowered for k in ("order", "contract", "loa", "epc")):
        tags.append("ORDER")
    if "buyback" in lowered or "buy back" in lowered:
        tags.append("BUYBACK")
    if "bonus" in lowered:
        tags.append("BONUS")
    if "split" in lowered or "sub-division" in lowered:
        tags.append("SPLIT")
    if "qip" in lowered or "preferential" in lowered:
        tags.append("FUNDRAISE")
    if "raid" in lowered or "cbi" in lowered or "sebi" in lowered or "penalty" in lowered:
        tags.append("REGULATORY")
    return tuple(tags)


def parse_event(raw: Dict[str, Any], source: str = "NSE") -> Optional[CatalystEvent]:
    """
    Normalize an NSE/BSE raw announcement dict into a typed CatalystEvent.

    Accepts either NSE-style keys (`symbol`, `subject`, `desc`, `an_dt`,
    `attchmntFile`) or BSE-style keys (`SLONGNAME`, `NEWSSUB`, `NEWS_DT`, `NSURL`,
    `SCRIP_CD`). Returns None when no symbol/headline can be recovered.
    """
    if not isinstance(raw, dict):
        return None

    normalized = {str(k).upper(): v for k, v in raw.items()}

    symbol = _first_key(normalized, ("SYMBOL", "SCRIP_CD", "SCRIPCODE", "NSE_SYMBOL", "TICKER"))
    company = _first_key(normalized, ("COMPANY", "SLONGNAME", "COMPANYNAME", "SCRIP_NAME", "NAME"))
    headline = _first_key(
        normalized,
        ("SUBJECT", "NEWSSUB", "SUBJECT_LINE", "HEADLINE", "ANNOUNCEMENT", "NEWS_SUB"),
    )
    body = _first_key(
        normalized,
        ("DESC", "ATTCHMNTTEXT", "MORE", "BODY", "DETAILS", "ANNOUNCEMENT_TEXT", "NEWSSUB"),
    ) or ""
    dt_raw = _first_key(
        normalized,
        ("AN_DT", "NEWS_DT", "DT", "SORT_DATE", "BROADCAST_DATE", "NEWS_DATE", "DATE"),
    )
    url = _first_key(normalized, ("ATTCHMNTFILE", "NSURL", "URL", "ATTACHMENT", "PDFLINK"))
    attachment = _first_key(normalized, ("ATTACHMENTNAME", "ATTACHMENT", "ATTCHMNTFILE"))

    symbol_s = str(symbol).strip() if symbol not in (None, "") else ""
    headline_s = str(headline).strip() if headline not in (None, "") else ""
    body_s = str(body).strip() if body else ""
    if not symbol_s and not headline_s:
        return None
    if not symbol_s:
        symbol_s = _stable_id(headline_s)[:8].upper()

    text_all = f"{headline_s} {body_s}"
    category = classify_catalyst(headline_s, body_s)
    published = parse_ist_datetime(dt_raw)

    order_value, _ = parse_amount_inr(text_all) if category == "ORDER_WIN" else (None, None)
    acquisition_value = None
    if "acquisition" in text_all.lower() or "acquires" in text_all.lower():
        acquisition_value, _ = parse_amount_inr(text_all)

    if source.upper() == "BSE" and not headline_s:
        headline_s = body_s[:180]

    event_id = _stable_id(symbol_s, headline_s, published.strftime("%Y-%m-%d"), source)

    return CatalystEvent(
        event_id=event_id,
        symbol=symbol_s.upper(),
        company=str(company).strip() if company else symbol_s.upper(),
        source=source.upper(),
        category=category,
        headline=headline_s or body_s[:180],
        raw_text=text_all.strip(),
        published_at=published,
        url=str(url).strip() if url else None,
        attachment=str(attachment).strip() if attachment else None,
        order_value_inr=order_value,
        acquisition_value_inr=acquisition_value,
        dividend=_extract_dividend(text_all),
        earnings=_extract_earnings(text_all),
        tags=_detect_category_tags(text_all),
    )


# ==============================================================================
# ASYMMETRIC SCORING
# ==============================================================================


def _decay(age_hours: float, half_life: float) -> float:
    if half_life <= 0:
        return 1.0
    age = max(0.0, age_hours)
    return float(0.5 ** (age / half_life))


def _event_boost(
    event: CatalystEvent,
    *,
    market_cap_inr: Optional[float],
    price: Optional[float],
    config: RadarConfig,
) -> Tuple[float, List[str], Optional[float]]:
    """Category-specific magnitude boost + human rationale + expected move."""
    boost = 0.0
    reasons: List[str] = []
    expected_move: Optional[float] = None
    text = event.raw_text.lower()

    if event.category == "ORDER_WIN":
        value = event.order_value_inr
        if value and market_cap_inr and market_cap_inr > 0:
            ratio = value / market_cap_inr
            boost += min(25.0, ratio * 100.0 * 1.6)
            expected_move = min(20.0, ratio * 100.0 * 0.9)
            reasons.append(f"order {ratio * 100:.1f}% of market cap")
            if ratio >= config.order_mcap_tier1_ratio:
                reasons.append("order >= 15% of market cap")
        else:
            boost += 8.0
            reasons.append("order win (size unquantified)")
    elif event.category == "EARNINGS":
        e = event.earnings
        if e:
            if e.profit_growth_pct is not None:
                boost += max(-22.0, min(25.0, e.profit_growth_pct * 0.5))
                reasons.append(f"PAT growth {e.profit_growth_pct:+.1f}%")
                expected_move = min(15.0, max(2.0, abs(e.profit_growth_pct) * 0.25))
            if e.revenue_growth_pct is not None:
                boost += max(-15.0, min(15.0, e.revenue_growth_pct * 0.3))
                reasons.append(f"revenue growth {e.revenue_growth_pct:+.1f}%")
        else:
            boost += 4.0
    elif event.category == "DIVIDEND":
        d = event.dividend
        if d and d.amount_inr and price and price > 0:
            yield_pct = d.amount_inr / price * 100.0
            boost += min(18.0, yield_pct * 3.0)
            reasons.append(f"dividend yield {yield_pct:.2f}%")
            expected_move = min(8.0, yield_pct * 1.2)
        else:
            boost += 5.0
            reasons.append("dividend announced")
    elif event.category == "CORPORATE_ACTION":
        if "buyback" in text or "buy back" in text:
            boost += 10.0
            reasons.append("buyback (float reduction)")
        if "bonus" in text or "split" in text or "sub-division" in text:
            boost += 6.0
            reasons.append("bonus/split (liquidity + sentiment)")
        if "demerger" in text or "amalgamation" in text:
            boost += 8.0
            reasons.append("restructuring event")
    elif event.category == "CREDIT_RATING":
        if "upgrade" in text or "upgraded" in text:
            boost += 12.0
            reasons.append("rating upgrade")
        elif "downgrade" in text or "downgraded" in text or "default" in text:
            boost += 14.0
            reasons.append("rating downgrade/default risk")
    elif event.category == "MANAGEMENT":
        if "resign" in text or "cessation" in text:
            boost += 8.0
            reasons.append("senior management exit")
        else:
            boost += 4.0
    elif event.category == "REGULATORY":
        if any(k in text for k in ("raid", "search and seizure", "fraud", "cbi", "ed ")):
            boost += 20.0
            reasons.append("enforcement/raid action")
        elif "penalty" in text or "show cause" in text:
            boost += 12.0
            reasons.append("regulatory penalty/notice")
        else:
            boost += 8.0
    elif event.category == "FUNDRAISE":
        if "qip" in text or "preferential" in text:
            boost += 5.0
            reasons.append("capital raise (dilution risk)")
    elif event.category == "INSIDER":
        boost += 6.0
        reasons.append("insider/promoter disclosure")

    if event.acquisition_value_inr and event.category not in ("ORDER_WIN",):
        boost += 5.0
        reasons.append("acquisition/M&A event")

    return boost, reasons, expected_move


def score_catalyst(
    event: CatalystEvent,
    *,
    market_cap_inr: Optional[float] = None,
    price: Optional[float] = None,
    adv_inr: Optional[float] = None,
    now: Optional[datetime] = None,
    config: Optional[RadarConfig] = None,
) -> CatalystScore:
    """
    Score a single catalyst with the asymmetric model.

    Parameters
    ----------
    market_cap_inr : float | None
        Market cap in INR — enables order-size / market-cap normalization.
    price : float | None
        Last traded price — enables dividend-yield computation.
    adv_inr : float | None
        Average daily traded value (INR) — liquidity gate for BTST.
    now : datetime | None
        Scoring clock (IST-aware); defaults to now.
    """
    cfg = config or RadarConfig()
    now_ist = (now or datetime.now(tz=IST)).astimezone(IST)

    base = _BASE_WEIGHT.get(event.category, _BASE_WEIGHT["OTHER"])
    boost, reasons, expected_move = _event_boost(
        event, market_cap_inr=market_cap_inr, price=price, config=cfg
    )
    magnitude = max(0.0, base + boost)

    direction = _direction(event.headline, event.raw_text)
    if direction == "neutral" and event.category in ("ORDER_WIN", "DIVIDEND", "EARNINGS"):
        direction = "bullish"
    if direction == "neutral" and event.category == "REGULATORY":
        direction = "bearish" if any(k in event.raw_text.lower() for k in _BEARISH_TERMS) else "neutral"

    sign = 1.0 if direction == "bullish" else (-1.0 if direction == "bearish" else 0.0)

    age_hours = max(0.0, (now_ist - event.published_at).total_seconds() / 3600.0)
    decay = _decay(age_hours, cfg.decay_half_life_hours)
    novelty = _novelty_factor(event.raw_text)

    liquidity = 1.0
    if adv_inr is not None:
        if adv_inr <= 0:
            liquidity = 0.25
        else:
            liquidity = float(min(1.0, 0.4 + math.log10(max(adv_inr, 1.0) / _CRORE + 1.0) * 0.35))
    else:
        reasons.append("liquidity unverified")

    directional = sign * magnitude
    if directional > 0:
        asym = directional * cfg.upside_mult
    elif directional < 0:
        asym = directional * cfg.downside_mult
    else:
        asym = 0.0
    asym = float(max(-100.0, min(100.0, asym * decay * liquidity * novelty)))

    conviction = float(
        min(
            1.0,
            (magnitude / 80.0)
            * (1.0 if sign != 0.0 else 0.15)
            * decay
            * novelty,
        )
    )
    if direction == "neutral":
        conviction *= 0.5

    abs_asym = abs(asym)
    if abs_asym >= cfg.tier1_threshold:
        tier = 1
    elif abs_asym >= cfg.tier2_threshold:
        tier = 2
    else:
        tier = 3

    btst_eligible = (
        direction == "bullish"
        and tier <= 2
        and asym >= cfg.btst_min_asymmetry
        and event.category != "NOISE"
        and novelty >= 0.5
        and (adv_inr is None or adv_inr >= cfg.btst_min_adv_inr)
    )

    if not reasons:
        reasons.append(f"{event.category.lower().replace('_', ' ')} disclosure")
    if abs_asym >= cfg.tier1_threshold:
        reasons.append(f"tier-1 asymmetry ({asym:+.1f})")

    return CatalystScore(
        event_id=event.event_id,
        symbol=event.symbol,
        category=event.category,
        direction=direction,
        impact_tier=tier,
        asymmetry_score=asym,
        magnitude=magnitude,
        conviction=conviction,
        decay_factor=decay,
        liquidity_factor=liquidity,
        novelty_factor=novelty,
        expected_move_pct=expected_move,
        rationale=tuple(reasons),
        btst_eligible=btst_eligible,
    )


# ==============================================================================
# ORCHESTRATION
# ==============================================================================


def build_radar(
    events: Iterable[CatalystEvent],
    *,
    market_cap_map: Optional[Dict[str, float]] = None,
    price_map: Optional[Dict[str, float]] = None,
    adv_map: Optional[Dict[str, float]] = None,
    now: Optional[datetime] = None,
    config: Optional[RadarConfig] = None,
    source_mode: str = "offline",
    errors: Sequence[str] = (),
) -> RadarReport:
    """Parse-free scoring pass: turn events into a ranked radar report."""
    cfg = config or RadarConfig()
    now_ist = (now or datetime.now(tz=IST)).astimezone(IST)
    mcap = market_cap_map or {}
    prices = price_map or {}
    advs = adv_map or {}

    events_list = list(events)[: cfg.max_events]
    scores: List[CatalystScore] = []
    for event in events_list:
        score = score_catalyst(
            event,
            market_cap_inr=mcap.get(event.symbol),
            price=prices.get(event.symbol),
            adv_inr=advs.get(event.symbol),
            now=now_ist,
            config=cfg,
        )
        scores.append(score)

    scores.sort(key=lambda s: (s.btst_eligible, s.asymmetry_score), reverse=True)
    candidates = [s for s in scores if s.btst_eligible]

    return RadarReport(
        generated_at=now_ist,
        source_mode=source_mode,
        events_scanned=len(events_list),
        events_parsed=len(events_list),
        candidates=candidates,
        all_scores=scores,
        errors=tuple(errors),
    )


def select_btst_candidates(
    report: RadarReport,
    *,
    min_asymmetry: Optional[float] = None,
    top_n: int = 10,
) -> List[CatalystScore]:
    """Filter a report to the final BTST shortlist at the 3:00 PM decision point."""
    threshold = min_asymmetry if min_asymmetry is not None else RadarConfig().btst_min_asymmetry
    eligible = [c for c in report.candidates if c.asymmetry_score >= threshold]
    eligible.sort(key=lambda s: (s.asymmetry_score, s.conviction), reverse=True)
    return eligible[:top_n]


def events_to_frame(scores: Sequence[CatalystScore]) -> Any:
    """Export scores to a Polars DataFrame (None when Polars is unavailable)."""
    if not _POLARS_AVAILABLE or not scores:
        return None
    return pl.DataFrame([s.to_dict() for s in scores])


# ==============================================================================
# NETWORK — NSE / BSE SCRAPERS (fail-soft)
# ==============================================================================


def _new_client() -> Any:
    if not _HTTPX_AVAILABLE:
        return None
    return httpx.Client(
        headers=_HTTP_HEADERS,
        timeout=httpx.Timeout(10.0),
        follow_redirects=True,
    )


def _http_get_json(
    client: Any,
    url: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    retries: int = 2,
) -> Any:
    """GET JSON with bounded exponential backoff; returns None on any failure."""
    if client is None:
        return None
    delay = 0.5
    for attempt in range(retries + 1):
        try:
            resp = client.get(url, params=params)
            if resp.status_code in (429, 503):
                time.sleep(delay)
                delay *= 2
                continue
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:  # noqa: BLE001 — network is best-effort
            log.warning("GET %s failed (attempt %d): %s", url, attempt + 1, exc)
            time.sleep(delay)
            delay *= 2
    return None


def _warm_nse_session(client: Any) -> None:
    """Hit the NSE landing pages to obtain the anti-bot cookies."""
    if client is None:
        return
    for warm in (NSE_HOME, NSE_ANN_PAGE):
        try:
            client.get(warm)
            time.sleep(0.4)
        except Exception as exc:  # noqa: BLE001
            log.debug("NSE warm-up failed for %s: %s", warm, exc)


def _as_list(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        for key in ("data", "rows", "Table", "Table1", "results"):
            value = payload.get(key)
            if isinstance(value, list):
                return [x for x in value if isinstance(x, dict)]
    return []


def fetch_nse_announcements(
    client: Any,
    *,
    index: str = "equities",
    limit: int = 200,
) -> List[Dict[str, Any]]:
    """Fetch raw NSE corporate-announcement rows (empty list on failure)."""
    payload = _http_get_json(client, NSE_ANNOUNCEMENTS, params={"index": index})
    return _as_list(payload)[:limit]


def fetch_nse_board_meetings(client: Any, *, index: str = "equities", limit: int = 200) -> List[Dict[str, Any]]:
    """Fetch raw NSE board-meeting disclosures."""
    payload = _http_get_json(client, NSE_BOARD_MEETINGS, params={"index": index})
    return _as_list(payload)[:limit]


def fetch_nse_corporate_actions(client: Any, *, index: str = "equities", limit: int = 200) -> List[Dict[str, Any]]:
    """Fetch raw NSE corporate-action disclosures (dividends, splits, bonuses)."""
    payload = _http_get_json(client, NSE_CORPORATE_ACTIONS, params={"index": index})
    return _as_list(payload)[:limit]


def fetch_bse_announcements(
    client: Any,
    *,
    days_back: int = 1,
    page: int = 1,
) -> List[Dict[str, Any]]:
    """Fetch raw BSE corporate-update rows for the trailing window."""
    today = datetime.now(tz=IST).date()
    prev = today - timedelta(days=max(1, days_back))
    params = {
        "pageno": page,
        "strCat": "Company Update",
        "strPrevDate": prev.strftime("%Y%m%d"),
        "strToDate": today.strftime("%Y%m%d"),
        "strScrip": "",
        "strSearch": "P",
        "strType": "C",
    }
    payload = _http_get_json(client, BSE_ANNOUNCEMENTS, params=params)
    return _as_list(payload)[:300]


def mock_announcements(now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """Representative disclosures for offline mode and deterministic tests."""
    base = (now or datetime.now(tz=IST)).astimezone(IST)
    fmt = "%d-%b-%Y %H:%M:%S"
    return [
        {
            "symbol": "BEL",
            "company": "Bharat Electronics Ltd",
            "subject": "Bagged order worth Rs 2,450 Crore from Ministry of Defence",
            "desc": "The Company has received an order worth Rs 2,450 Crore for supply of radar systems.",
            "an_dt": (base - timedelta(hours=1)).strftime(fmt),
        },
        {
            "symbol": "TATAMOTORS",
            "company": "Tata Motors Ltd",
            "subject": "Q2 FY27 Financial Results: Net Profit Rs 5,120 Crore up 22% YoY",
            "desc": "Revenue from operations Rs 1,05,000 crore; net profit rose 22% YoY.",
            "an_dt": (base - timedelta(hours=2)).strftime(fmt),
        },
        {
            "symbol": "ITC",
            "company": "ITC Ltd",
            "subject": "Board recommends Interim Dividend of Rs 8 per share; Record Date 20-Oct-2026",
            "desc": "Interim dividend Rs 8 per share. Ex-date 19-Oct-2026, record date 20-Oct-2026.",
            "an_dt": (base - timedelta(hours=3)).strftime(fmt),
        },
        {
            "symbol": "YESBANK",
            "company": "Yes Bank Ltd",
            "subject": "SEBI imposes penalty of Rs 12 crore for disclosure lapses",
            "desc": "Regulatory penalty and show cause notice issued to the company.",
            "an_dt": (base - timedelta(hours=4)).strftime(fmt),
        },
        {
            "symbol": "RELIANCE",
            "company": "Reliance Industries Ltd",
            "subject": "Newspaper Publication of Unaudited Results",
            "desc": "Newspaper publication of financial results - routine compliance.",
            "an_dt": (base - timedelta(hours=2)).strftime(fmt),
        },
        {
            "symbol": "KPITTECH",
            "company": "KPIT Technologies Ltd",
            "subject": "Board approves Buyback of equity shares worth Rs 750 Crore",
            "desc": "Buyback at Rs 1,600 per share, representing a 12% premium to last close.",
            "an_dt": (base - timedelta(hours=5)).strftime(fmt),
        },
    ]


def scan_radar(
    *,
    offline: bool = False,
    symbols: Optional[Sequence[str]] = None,
    market_cap_map: Optional[Dict[str, float]] = None,
    price_map: Optional[Dict[str, float]] = None,
    adv_map: Optional[Dict[str, float]] = None,
    now: Optional[datetime] = None,
    config: Optional[RadarConfig] = None,
) -> RadarReport:
    """
    End-to-end scan: fetch → parse → score → BTST shortlist.

    `offline=True` replays `mock_announcements()` and never touches the network.
    A network failure degrades to an empty (but valid) report.
    """
    cfg = config or RadarConfig()
    now_ist = (now or datetime.now(tz=IST)).astimezone(IST)
    sourced_rows: List[Tuple[str, Dict[str, Any]]] = []
    errors: List[str] = []
    source_mode = "offline" if offline else "live"

    def _extend(fetcher_rows: List[Dict[str, Any]], source: str) -> None:
        for row in fetcher_rows:
            if isinstance(row, dict):
                sourced_rows.append((source, row))

    if offline or not _HTTPX_AVAILABLE:
        if not offline:
            errors.append("httpx unavailable; served offline mock data")
            source_mode = "hybrid"
        _extend(mock_announcements(now_ist), "NSE")
    else:
        client = _new_client()
        try:
            if client is not None:
                _warm_nse_session(client)
                for fetcher, label in (
                    (fetch_nse_announcements, "NSE announcements"),
                    (fetch_nse_board_meetings, "NSE board meetings"),
                    (fetch_nse_corporate_actions, "NSE corporate actions"),
                ):
                    try:
                        rows = fetcher(client)
                        _extend(rows, "NSE")
                        if not rows:
                            errors.append(f"{label}: empty response")
                    except Exception as exc:  # noqa: BLE001
                        errors.append(f"{label}: {exc}")
                    time.sleep(0.3)
                try:
                    _extend(fetch_bse_announcements(client), "BSE")
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"BSE announcements: {exc}")
        finally:
            if client is not None:
                try:
                    client.close()
                except Exception:  # noqa: BLE001
                    pass
        if not sourced_rows:
            errors.append("no live rows retrieved; falling back to offline sample")
            source_mode = "hybrid"
            _extend(mock_announcements(now_ist), "NSE")

    events: List[CatalystEvent] = []
    for source, row in sourced_rows:
        event = parse_event(row, source=source)
        if event is None:
            errors.append("unparseable disclosure row skipped")
            continue
        if symbols and event.symbol not in {s.upper() for s in symbols}:
            continue
        events.append(event)

    # De-duplicate on the stable event id.
    seen: set[str] = set()
    unique_events: List[CatalystEvent] = []
    for event in events:
        if event.event_id in seen:
            continue
        seen.add(event.event_id)
        unique_events.append(event)

    report = build_radar(
        unique_events,
        market_cap_map=market_cap_map,
        price_map=price_map,
        adv_map=adv_map,
        now=now_ist,
        config=cfg,
        source_mode=source_mode,
        errors=errors,
    )
    return report


# ==============================================================================
# SELF-TEST
# ==============================================================================


def _self_test() -> None:  # pragma: no cover - manual smoke
    report = scan_radar(offline=True)
    print(f"Mode={report.source_mode} scanned={report.events_scanned} parsed={report.events_parsed}")
    for score in report.all_scores:
        print(
            f"  {score.symbol:<12} {score.category:<16} {score.direction:<8} "
            f"tier={score.impact_tier} asym={score.asymmetry_score:+7.2f} "
            f"conv={score.conviction:.2f} btst={score.btst_eligible}"
        )
    print(f"BTST candidates: {[c.symbol for c in select_btst_candidates(report)]}")


if __name__ == "__main__":  # pragma: no cover
    logging.basicConfig(level=logging.INFO)
    _self_test()
