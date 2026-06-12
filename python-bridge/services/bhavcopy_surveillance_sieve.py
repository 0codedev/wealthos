"""
bhavcopy_surveillance_sieve.py — Mechanical EOD Bhavcopy Ingestion, Settlement
Reconciliation & Surveillance Sieve (Domain 84).

Production-grade, stdlib + pandas only. Provides:

  * Automated 16:30 IST ingestion of NSE Bhavcopy (sec_bhavdata_full.csv),
    BSE Bhavcopy, PR (price-range / circuit) files, SEBI/NSE F&O MWPL ban
    list (>95%), ASM/GSM Stage I-IV + T2T (BE series) surveillance lists.
  * Dynamic circuit-band tracking (5/10/20%) and spot-cushion computation.
  * Settlement-price ingestion and tradebook fill audit against official NSE
    settlement prices, with statutory-friction discrepancy flagging
    (STT, CTT, GST, Stamp Duty, SEBI turnover fees).
  * SQLite schema + blacklist query helpers for intraday leverage / algo
    rotation gating.

Zero network I/O in the core parsers; fetchers are intentionally left to the
caller so the module stays unit-testable and deterministic.
"""

from __future__ import annotations

import csv
import io
import json
import os
import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple, Union

import pandas as pd

IST = timezone(timedelta(hours=5, minutes=30))

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
def _default_db_path() -> str:
    try:
        import db as _db  # type: ignore

        return getattr(_db, "DB_FILE", os.path.join(os.path.dirname(__file__), "..", "cache.db"))
    except Exception:
        return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cache.db")


def db_path() -> str:
    return os.environ.get("BHAVCOPY_DB_PATH", _default_db_path())


def configure_db(path: str) -> None:
    os.environ["BHAVCOPY_DB_PATH"] = path


# ---------------------------------------------------------------------------
# Thresholds / governance constants
# ---------------------------------------------------------------------------
PRICE_VARIANCE_TOL_PCT = 0.0025          # 0.25% fill vs settlement tolerance
CHARGE_VARIANCE_ALERT_INR = 5.00         # statutory charge variance alert
MWPL_BAN_THRESHOLD_PCT = 95.0            # >95% MWPL => ban
CIRCUIT_BUFFER_PCT = 0.5                 # safety buffer inside band
DEFAULT_BAND_PCT = 20.0

# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------
def _now_ist() -> datetime:
    return datetime.now(IST)


def _iso_date(d: Any = None) -> str:
    if d is None:
        return _now_ist().date().isoformat()
    if isinstance(d, datetime):
        return d.date().isoformat() if d.tzinfo else d.date().isoformat()
    if isinstance(d, pd.Timestamp):
        return d.date().isoformat()
    s = str(d).strip()
    if not s:
        return _now_ist().date().isoformat()
    try:
        return pd.to_datetime(s, dayfirst=True, errors="raise").date().isoformat()
    except Exception:
        try:
            return pd.to_datetime(s, errors="raise").date().isoformat()
        except Exception:
            return s


def _to_float(v: Any, default: float = 0.0) -> float:
    if v is None:
        return default
    if isinstance(v, float) and v != v:  # NaN
        return default
    try:
        s = str(v).strip().replace(",", "")
        if s == "" or s.lower() in ("nan", "none", "null", "-"):
            return default
        return float(s)
    except (TypeError, ValueError):
        return default


def _to_int(v: Any, default: int = 0) -> int:
    try:
        return int(float(str(v).strip().replace(",", "")))
    except (TypeError, ValueError):
        return default


def _clean_str(v: Any) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    if s.lower() in ("nan", "none", "null"):
        return ""
    return s


def _read_tabular(source: Any) -> pd.DataFrame:
    """Read CSV/XLSX/path/bytes/file-like/DataFrame into a DataFrame."""
    if isinstance(source, pd.DataFrame):
        return source.copy()
    if isinstance(source, (str, os.PathLike)):
        path = str(source)
        if path.lower().endswith((".xlsx", ".xls")):
            return pd.read_excel(path)
        return pd.read_csv(path)
    if isinstance(source, (bytes, bytearray)):
        return pd.read_csv(io.BytesIO(source))
    # file-like
    try:
        pos = getattr(source, "tell", lambda: None)()
        df = pd.read_csv(source)
        return df
    except Exception:
        try:
            source.seek(0)
        except Exception:
            pass
        return pd.read_csv(source)


def _col(df: pd.DataFrame, *candidates: str) -> Optional[str]:
    """Case-insensitive column resolver with fuzzy contains fallback."""
    lower = {str(c).lower().strip().replace(" ", "_"): str(c) for c in df.columns}
    for cand in candidates:
        key = str(cand).lower().strip().replace(" ", "_")
        if key in lower:
            return lower[key]
    for cand in candidates:
        cl = str(cand).lower().strip()
        for k, v in lower.items():
            if cl in k:
                return v
    return None


def _connect(write: bool = False, path: Optional[str] = None) -> sqlite3.Connection:
    p = path or db_path()
    os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True) if os.path.dirname(p) else None
    conn = sqlite3.connect(p, timeout=30.0, isolation_level=None if write else None)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA busy_timeout = 30000;")
    except sqlite3.Error:
        pass
    return conn


# ---------------------------------------------------------------------------
# SQLite schema
# ---------------------------------------------------------------------------
SCHEMA_SQL = r"""
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    migrated_at TEXT
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
    run_id TEXT PRIMARY KEY,
    job_name TEXT,
    started_at TEXT,
    finished_at TEXT,
    status TEXT,
    files TEXT,
    rows_processed INTEGER DEFAULT 0,
    errors TEXT
);

CREATE TABLE IF NOT EXISTS bhavcopy_eod (
    trade_date TEXT NOT NULL,
    exchange TEXT NOT NULL,
    symbol TEXT NOT NULL,
    series TEXT NOT NULL DEFAULT 'EQ',
    open_price REAL,
    high_price REAL,
    low_price REAL,
    close_price REAL,
    prev_close REAL,
    last_price REAL,
    avg_price REAL,
    volume INTEGER,
    turnover REAL,
    no_of_trades INTEGER,
    deliv_qty INTEGER,
    deliv_pct REAL,
    price_band_pct REAL,
    upper_circuit REAL,
    lower_circuit REAL,
    ingested_at TEXT,
    PRIMARY KEY (trade_date, exchange, symbol, series)
);

CREATE TABLE IF NOT EXISTS price_bands (
    trade_date TEXT NOT NULL,
    exchange TEXT NOT NULL DEFAULT 'NSE',
    symbol TEXT NOT NULL,
    series TEXT NOT NULL DEFAULT 'EQ',
    prev_close REAL,
    band_pct REAL,
    upper_limit REAL,
    lower_limit REAL,
    source TEXT,
    ingested_at TEXT,
    PRIMARY KEY (trade_date, exchange, symbol, series)
);

CREATE TABLE IF NOT EXISTS surveillance_blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    series TEXT,
    measure_type TEXT NOT NULL,
    stage TEXT,
    effective_date TEXT,
    reason TEXT,
    source_file TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE (symbol, series, measure_type, stage, effective_date)
);

CREATE TABLE IF NOT EXISTS mwpl_ban_list (
    trade_date TEXT NOT NULL,
    symbol TEXT NOT NULL,
    series TEXT DEFAULT 'FUT',
    mwpl REAL,
    open_interest REAL,
    pct_of_mwpl REAL,
    banned INTEGER NOT NULL DEFAULT 0,
    ingested_at TEXT,
    PRIMARY KEY (trade_date, symbol)
);

CREATE TABLE IF NOT EXISTS settlement_prices (
    trade_date TEXT NOT NULL,
    exchange TEXT NOT NULL DEFAULT 'NSE',
    symbol TEXT NOT NULL,
    series TEXT NOT NULL DEFAULT 'EQ',
    settlement_price REAL NOT NULL,
    source TEXT,
    ingested_at TEXT,
    PRIMARY KEY (trade_date, exchange, symbol, series)
);

CREATE TABLE IF NOT EXISTS tradebook_fills (
    fill_id TEXT PRIMARY KEY,
    order_id TEXT,
    symbol TEXT NOT NULL,
    series TEXT,
    side TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    fill_price REAL NOT NULL,
    fill_time TEXT,
    exchange TEXT,
    product TEXT,
    trade_date TEXT,
    ingested_at TEXT
);

CREATE TABLE IF NOT EXISTS eod_reconciliation_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    run_at TEXT NOT NULL,
    trade_date TEXT,
    fill_id TEXT,
    symbol TEXT,
    side TEXT,
    quantity INTEGER,
    fill_price REAL,
    settlement_price REAL,
    price_variance REAL,
    expected_charges REAL,
    actual_charges REAL,
    charge_variance REAL,
    status TEXT,
    flags TEXT,
    created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_bhavcopy_symbol ON bhavcopy_eod (symbol);
CREATE INDEX IF NOT EXISTS idx_blacklist_symbol ON surveillance_blacklist (symbol, active);
CREATE INDEX IF NOT EXISTS idx_mwpl_date ON mwpl_ban_list (trade_date);
CREATE INDEX IF NOT EXISTS idx_settle_lookup ON settlement_prices (trade_date, symbol);
CREATE INDEX IF NOT EXISTS idx_recon_run ON eod_reconciliation_results (run_id);
"""


def init_schema(db_path_override: Optional[str] = None) -> None:
    path = db_path_override or db_path()
    conn = _connect(True, path)
    try:
        conn.executescript(SCHEMA_SQL)
        conn.execute(
            "INSERT OR REPLACE INTO schema_version (version, migrated_at) VALUES (?, ?)",
            (84, _now_ist().isoformat()),
        )
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Ingestion result container
# ---------------------------------------------------------------------------
@dataclass
class IngestionResult:
    job: str
    status: str
    rows: int = 0
    errors: List[str] = field(default_factory=list)
    details: Dict[str, Any] = field(default_factory=dict)
    run_id: str = field(default_factory=lambda: uuid.uuid4().hex)


def _record_run(result: IngestionResult, path: Optional[str] = None) -> None:
    try:
        init_schema(path)
        conn = _connect(True, path)
        try:
            conn.execute(
                """INSERT OR REPLACE INTO ingestion_runs
                   (run_id, job_name, started_at, finished_at, status, files, rows_processed, errors)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (
                    result.run_id,
                    result.job,
                    _now_ist().isoformat(),
                    _now_ist().isoformat(),
                    result.status,
                    json.dumps(result.details.get("files", [])),
                    result.rows,
                    json.dumps(result.errors),
                ),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# NSE Bhavcopy
# ---------------------------------------------------------------------------
_NSE_COLMAP = {
    "symbol": ("symbol", "sc_name", "ticker"),
    "series": ("series", "sc_group"),
    "date": ("date1", "date", "trading_date", "timestamp"),
    "prev_close": ("prev_close", "previous_close", "prevclose"),
    "open": ("open_price", "open", "openprice"),
    "high": ("high_price", "high", "highprice"),
    "low": ("low_price", "low", "lowprice"),
    "last": ("last_price", "last", "lastprice"),
    "close": ("close_price", "close", "closeprice"),
    "avg": ("avg_price", "avg", "average_price"),
    "volume": ("ttl_trd_qnty", "volume", "qty", "no_of_shrs", "traded_qty"),
    "turnover": ("turnover_lacs", "turnover", "net_turnov"),
    "trades": ("no_of_trades", "trades", "no_trades"),
    "deliv_qty": ("deliv_qty", "delivery_qty", "deliv quantity"),
    "deliv_pct": ("deliv_per", "deliv_pct", "delivery_pct"),
}


def normalize_nse_bhavcopy(df: pd.DataFrame, trade_date: Optional[Any] = None) -> pd.DataFrame:
    out = pd.DataFrame()
    g = lambda *c: _col(df, *c)

    sym_col = g(*_NSE_COLMAP["symbol"])
    if sym_col is None:
        raise ValueError("NSE bhavcopy missing SYMBOL column")
    out["symbol"] = df[sym_col].astype(str).str.strip().str.upper()

    series_col = g(*_NSE_COLMAP["series"])
    out["series"] = (df[series_col].astype(str).str.strip().str.upper() if series_col else "EQ")

    date_col = g(*_NSE_COLMAP["date"])
    if trade_date is not None:
        td = _iso_date(trade_date)
    elif date_col is not None:
        td_series = pd.to_datetime(df[date_col], dayfirst=True, errors="coerce")
        td = _iso_date(td_series.dropna().iloc[0]) if not td_series.dropna().empty else _iso_date()
    else:
        td = _iso_date()
    out["trade_date"] = td

    def num(key):
        c = g(*_NSE_COLMAP[key])
        return df[c].map(_to_float) if c else 0.0

    out["prev_close"] = num("prev_close")
    out["open_price"] = num("open")
    out["high_price"] = num("high")
    out["low_price"] = num("low")
    out["last_price"] = num("last")
    out["close_price"] = num("close")
    out["avg_price"] = num("avg")
    out["volume"] = num("volume").map(lambda x: int(x))
    out["turnover"] = num("turnover")
    out["no_of_trades"] = num("trades").map(lambda x: int(x))
    out["deliv_qty"] = num("deliv_qty").map(lambda x: int(x))
    out["deliv_pct"] = num("deliv_pct")
    out["exchange"] = "NSE"
    return out


def ingest_nse_bhavcopy(source: Any, trade_date: Optional[Any] = None,
                        db_path_override: Optional[str] = None, source_file: Optional[str] = None) -> IngestionResult:
    res = IngestionResult(job="NSE_BHAVCOPY", status="success")
    try:
        df = _read_tabular(source)
        ndf = normalize_nse_bhavcopy(df, trade_date)
        res.details["files"] = [source_file or "nse_bhavcopy"]
        path = db_path_override or db_path()
        init_schema(path)
        conn = _connect(True, path)
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.executemany(
                """INSERT OR REPLACE INTO bhavcopy_eod
                   (trade_date, exchange, symbol, series, open_price, high_price, low_price,
                    close_price, prev_close, last_price, avg_price, volume, turnover,
                    no_of_trades, deliv_qty, deliv_pct, ingested_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                [
                    (
                        r.trade_date, "NSE", r.symbol, r.series, r.open_price, r.high_price,
                        r.low_price, r.close_price, r.prev_close, r.last_price, r.avg_price,
                        int(r.volume), r.turnover, int(r.no_of_trades), int(r.deliv_qty),
                        r.deliv_pct, _now_ist().isoformat(),
                    )
                    for r in ndf.itertuples(index=False)
                ],
            )
            conn.commit()
        finally:
            conn.close()
        res.rows = len(ndf)
    except Exception as e:
        res.status = "error"
        res.errors.append(str(e))
    _record_run(res, db_path_override or db_path())
    return res


# ---------------------------------------------------------------------------
# BSE Bhavcopy
# ---------------------------------------------------------------------------
def normalize_bse_bhavcopy(df: pd.DataFrame, trade_date: Optional[Any] = None) -> pd.DataFrame:
    out = pd.DataFrame()
    g = lambda *c: _col(df, *c)
    sym_col = g("sc_name", "security_name", "symbol", "scrip_name", "name")
    if sym_col is None:
        code_col = g("sc_code", "security_code", "code")
        if code_col is None:
            raise ValueError("BSE bhavcopy missing symbol/code column")
        sym_col = code_col
    out["symbol"] = df[sym_col].astype(str).str.strip().str.upper()

    series_col = g("sc_group", "series", "group")
    out["series"] = (df[series_col].astype(str).str.strip().str.upper() if series_col else "EQ")

    date_col = g("trading_date", "date", "date1", "timestamp")
    if trade_date is not None:
        td = _iso_date(trade_date)
    elif date_col is not None:
        td_series = pd.to_datetime(df[date_col], dayfirst=True, errors="coerce")
        td = _iso_date(td_series.dropna().iloc[0]) if not td_series.dropna().empty else _iso_date()
    else:
        td = _iso_date()
    out["trade_date"] = td

    def num(*keys):
        c = g(*keys)
        return df[c].map(_to_float) if c else 0.0

    out["prev_close"] = num("prevclose", "prev_close", "previous_close")
    out["open_price"] = num("open", "open_price")
    out["high_price"] = num("high", "high_price")
    out["low_price"] = num("low", "low_price")
    out["last_price"] = num("last", "last_price")
    out["close_price"] = num("close", "close_price")
    out["avg_price"] = num("avg", "avg_price", "average_price")
    out["volume"] = num("no_of_shrs", "volume", "qty", "traded_qty").map(lambda x: int(x))
    out["turnover"] = num("net_turnov", "turnover", "turnover_lacs")
    out["no_of_trades"] = num("no_trades", "trades", "no_of_trades").map(lambda x: int(x))
    out["exchange"] = "BSE"
    out["deliv_qty"] = 0
    out["deliv_pct"] = 0.0
    return out


def ingest_bse_bhavcopy(source: Any, trade_date: Optional[Any] = None,
                        db_path_override: Optional[str] = None, source_file: Optional[str] = None) -> IngestionResult:
    res = IngestionResult(job="BSE_BHAVCOPY", status="success")
    try:
        df = _read_tabular(source)
        ndf = normalize_bse_bhavcopy(df, trade_date)
        path = db_path_override or db_path()
        init_schema(path)
        conn = _connect(True, path)
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.executemany(
                """INSERT OR REPLACE INTO bhavcopy_eod
                   (trade_date, exchange, symbol, series, open_price, high_price, low_price,
                    close_price, prev_close, last_price, avg_price, volume, turnover,
                    no_of_trades, deliv_qty, deliv_pct, ingested_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                [
                    (
                        r.trade_date, "BSE", r.symbol, r.series, r.open_price, r.high_price,
                        r.low_price, r.close_price, r.prev_close, r.last_price, r.avg_price,
                        int(r.volume), r.turnover, int(r.no_of_trades), 0, 0.0,
                        _now_ist().isoformat(),
                    )
                    for r in ndf.itertuples(index=False)
                ],
            )
            conn.commit()
        finally:
            conn.close()
        res.rows = len(ndf)
        res.details["files"] = [source_file or "bse_bhavcopy"]
    except Exception as e:
        res.status = "error"
        res.errors.append(str(e))
    _record_run(res, db_path_override or db_path())
    return res


# ---------------------------------------------------------------------------
# PR / price-band file (circuit bands)
# ---------------------------------------------------------------------------
def normalize_price_bands(df: pd.DataFrame, trade_date: Optional[Any] = None,
                          exchange: str = "NSE") -> pd.DataFrame:
    out = pd.DataFrame()
    g = lambda *c: _col(df, *c)
    sym_col = g("symbol", "sc_name", "security_name", "scrip")
    if sym_col is None:
        raise ValueError("Price-band file missing SYMBOL column")
    out["symbol"] = df[sym_col].astype(str).str.strip().str.upper()

    series_col = g("series", "sc_group", "group")
    out["series"] = (df[series_col].astype(str).str.strip().str.upper() if series_col else "EQ")

    date_col = g("date", "trading_date", "date1")
    if trade_date is not None:
        td = _iso_date(trade_date)
    elif date_col is not None:
        td_series = pd.to_datetime(df[date_col], dayfirst=True, errors="coerce")
        td = _iso_date(td_series.dropna().iloc[0]) if not td_series.dropna().empty else _iso_date()
    else:
        td = _iso_date()
    out["trade_date"] = td
    out["exchange"] = exchange

    prev_col = g("prev_close", "previous_close", "prevclose", "close_price")
    out["prev_close"] = (df[prev_col].map(_to_float) if prev_col else 0.0)

    band_col = g("price_band", "priceband", "band", "band_pct", "price band")
    def parse_band(v):
        s = _clean_str(v)
        s = s.replace("%", "").strip()
        if s == "":
            return DEFAULT_BAND_PCT
        try:
            val = float(s)
            # If given as fraction like 0.05, convert
            if 0 < val < 1:
                val = val * 100.0
            return val
        except ValueError:
            low = s.lower()
            if "5" in low:
                return 5.0
            if "10" in low:
                return 10.0
            if "20" in low:
                return 20.0
            return DEFAULT_BAND_PCT
    out["band_pct"] = (df[band_col].map(parse_band) if band_col else DEFAULT_BAND_PCT)

    # Optional explicit limits
    upper_col = g("upper_limit", "upper_circuit", "uc")
    lower_col = g("lower_limit", "lower_circuit", "lc")
    out["upper_limit"] = (df[upper_col].map(_to_float) if upper_col else None)
    out["lower_limit"] = (df[lower_col].map(_to_float) if lower_col else None)

    # Fill missing limits from prev_close * band
    def fill_limits(row):
        pc = row["prev_close"]
        band = row["band_pct"]
        ul = row["upper_limit"]
        ll = row["lower_limit"]
        if (ul is None or (isinstance(ul, float) and ul != ul)) and pc > 0:
            ul = pc * (1.0 + band / 100.0)
        if (ll is None or (isinstance(ll, float) and ll != ll)) and pc > 0:
            ll = pc * (1.0 - band / 100.0)
        return pd.Series({"upper_limit": ul, "lower_limit": ll})

    limits = out.apply(fill_limits, axis=1)
    out["upper_limit"] = limits["upper_limit"]
    out["lower_limit"] = limits["lower_limit"]
    return out


def ingest_price_bands(source: Any, trade_date: Optional[Any] = None,
                       exchange: str = "NSE", db_path_override: Optional[str] = None,
                       source_file: Optional[str] = None) -> IngestionResult:
    res = IngestionResult(job="PRICE_BANDS", status="success")
    try:
        df = _read_tabular(source)
        ndf = normalize_price_bands(df, trade_date, exchange)
        path = db_path_override or db_path()
        init_schema(path)
        conn = _connect(True, path)
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.executemany(
                """INSERT OR REPLACE INTO price_bands
                   (trade_date, exchange, symbol, series, prev_close, band_pct,
                    upper_limit, lower_limit, source, ingested_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                [
                    (
                        r.trade_date, r.exchange, r.symbol, r.series, r.prev_close,
                        r.band_pct, r.upper_limit, r.lower_limit,
                        source_file or "pr_file", _now_ist().isoformat(),
                    )
                    for r in ndf.itertuples(index=False)
                ],
            )
            # Mirror into bhavcopy_eod if row exists
            for r in ndf.itertuples(index=False):
                try:
                    conn.execute(
                        """UPDATE bhavcopy_eod SET price_band_pct=?, upper_circuit=?,
                           lower_circuit=? WHERE trade_date=? AND exchange=? AND symbol=? AND series=?""",
                        (r.band_pct, r.upper_limit, r.lower_limit, r.trade_date, r.exchange, r.symbol, r.series),
                    )
                except sqlite3.Error:
                    pass
            conn.commit()
        finally:
            conn.close()
        res.rows = len(ndf)
        res.details["files"] = [source_file or "pr_file"]
    except Exception as e:
        res.status = "error"
        res.errors.append(str(e))
    _record_run(res, db_path_override or db_path())
    return res


# ---------------------------------------------------------------------------
# MWPL / F&O ban list
# ---------------------------------------------------------------------------
def normalize_mwpl(df: pd.DataFrame, trade_date: Optional[Any] = None) -> pd.DataFrame:
    out = pd.DataFrame()
    g = lambda *c: _col(df, *c)
    sym_col = g("symbol", "sc_name", "security")
    if sym_col is None:
        raise ValueError("MWPL file missing SYMBOL column")
    out["symbol"] = df[sym_col].astype(str).str.strip().str.upper()

    series_col = g("series")
    out["series"] = (df[series_col].astype(str).str.strip().str.upper() if series_col else "FUT")

    date_col = g("date", "trading_date")
    if trade_date is not None:
        td = _iso_date(trade_date)
    elif date_col is not None:
        td_series = pd.to_datetime(df[date_col], dayfirst=True, errors="coerce")
        td = _iso_date(td_series.dropna().iloc[0]) if not td_series.dropna().empty else _iso_date()
    else:
        td = _iso_date()
    out["trade_date"] = td

    mwpl_col = g("mwpl", "market_wide_position_limit", "limit")
    oi_col = g("open_interest", "oi", "current_oi")
    pct_col = g("pct_of_mwpl", "pct_mwpl", "%_of_mwpl", "percent_mwpl", "mwpl_utilization")
    banned_col = g("banned", "ban", "status")

    out["mwpl"] = (df[mwpl_col].map(_to_float) if mwpl_col else 0.0)
    out["open_interest"] = (df[oi_col].map(_to_float) if oi_col else 0.0)
    if pct_col:
        out["pct_of_mwpl"] = df[pct_col].map(_to_float)
    else:
        out["pct_of_mwpl"] = out.apply(
            lambda r: (r["open_interest"] / r["mwpl"] * 100.0) if r["mwpl"] > 0 else 0.0, axis=1
        )

    def is_banned(row):
        if banned_col:
            v = _clean_str(row[banned_col] if banned_col in row else "").lower()
            if v in ("yes", "true", "1", "banned", "ban"):
                return 1
            if v in ("no", "false", "0", "active", "not banned"):
                return 0
        return 1 if row["pct_of_mwpl"] >= MWPL_BAN_THRESHOLD_PCT else 0

    out["banned"] = out.apply(is_banned, axis=1)
    return out


def ingest_mwpl_ban_list(source: Any, trade_date: Optional[Any] = None,
                          db_path_override: Optional[str] = None,
                          source_file: Optional[str] = None) -> IngestionResult:
    res = IngestionResult(job="MWPL_BAN_LIST", status="success")
    try:
        df = _read_tabular(source)
        ndf = normalize_mwpl(df, trade_date)
        path = db_path_override or db_path()
        init_schema(path)
        conn = _connect(True, path)
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.executemany(
                """INSERT OR REPLACE INTO mwpl_ban_list
                   (trade_date, symbol, series, mwpl, open_interest, pct_of_mwpl, banned, ingested_at)
                   VALUES (?,?,?,?,?,?,?,?)""",
                [
                    (
                        r.trade_date, r.symbol, r.series, r.mwpl, r.open_interest,
                        r.pct_of_mwpl, int(r.banned), _now_ist().isoformat(),
                    )
                    for r in ndf.itertuples(index=False)
                ],
            )
            conn.commit()
        finally:
            conn.close()
        res.rows = len(ndf)
        res.details["files"] = [source_file or "mwpl_ban_list"]
    except Exception as e:
        res.status = "error"
        res.errors.append(str(e))
    _record_run(res, db_path_override or db_path())
    return res


# ---------------------------------------------------------------------------
# Surveillance lists (ASM / GSM / T2T)
# ---------------------------------------------------------------------------
_MEASURE_DETECT = {
    "asm": "ASM", "gsm": "GSM", "t2t": "T2T", "trade to trade": "T2T",
    "trade-to-trade": "T2T", "be": "T2T",
}


def _detect_measure_type(df: pd.DataFrame, hint: Optional[str] = None) -> str:
    if hint:
        h = hint.strip().upper()
        if h in ("ASM", "GSM", "T2T", "BE"):
            return "T2T" if h == "BE" else h
    # column-name based
    cols = " ".join(str(c).lower() for c in df.columns)
    for key, val in _MEASURE_DETECT.items():
        if key in cols:
            return val
    return "ASM"


def normalize_surveillance_list(df: pd.DataFrame, measure_type: Optional[str] = None,
                               trade_date: Optional[Any] = None) -> pd.DataFrame:
    out = pd.DataFrame()
    g = lambda *c: _col(df, *c)
    sym_col = g("symbol", "sc_name", "security_name", "scrip")
    if sym_col is None:
        raise ValueError("Surveillance list missing SYMBOL column")
    out["symbol"] = df[sym_col].astype(str).str.strip().str.upper()

    series_col = g("series", "sc_group", "group")
    out["series"] = (df[series_col].astype(str).str.strip().str.upper() if series_col else None)

    mt = _detect_measure_type(df, measure_type)
    out["measure_type"] = mt

    stage_col = g("stage", "asm_stage", "gsm_stage", "surveillance_stage", "level")
    if stage_col:
        def parse_stage(v):
            s = _clean_str(v)
            low = s.lower()
            roman = {"i": "I", "ii": "II", "iii": "III", "iv": "IV", "v": "V"}
            # strip "stage"
            low = low.replace("stage", "").strip()
            if low in roman:
                return roman[low]
            if low.upper() in ("I", "II", "III", "IV", "V"):
                return low.upper()
            # numeric
            try:
                n = int(float(low))
                return {1: "I", 2: "II", 3: "III", 4: "IV", 5: "V"}.get(n, str(n))
            except ValueError:
                return s if s else None
        out["stage"] = df[stage_col].map(parse_stage)
    else:
        out["stage"] = None

    date_col = g("effective_date", "date", "from_date", "applicable_from")
    if trade_date is not None:
        td = _iso_date(trade_date)
    elif date_col is not None:
        td_series = pd.to_datetime(df[date_col], dayfirst=True, errors="coerce")
        td = _iso_date(td_series.dropna().iloc[0]) if not td_series.dropna().empty else _iso_date()
    else:
        td = _iso_date()
    out["effective_date"] = td

    # T2T / BE detection: if series == BE or measure indicates T2T
    def infer_measure(row):
        mt = row["measure_type"]
        series = _clean_str(row["series"]).upper()
        if series in ("BE", "T2T", "BT"):
            return "T2T"
        return mt
    out["measure_type"] = out.apply(infer_measure, axis=1)

    out["reason"] = out.apply(
        lambda r: f"{r['measure_type']} {r['stage'] or ''}".strip(), axis=1
    )
    return out


def ingest_surveillance_list(source: Any, measure_type: Optional[str] = None,
                            trade_date: Optional[Any] = None,
                            db_path_override: Optional[str] = None,
                            source_file: Optional[str] = None) -> IngestionResult:
    res = IngestionResult(job="SURVEILLANCE_SIEVE", status="success")
    try:
        df = _read_tabular(source)
        ndf = normalize_surveillance_list(df, measure_type, trade_date)
        path = db_path_override or db_path()
        init_schema(path)
        conn = _connect(True, path)
        try:
            conn.execute("BEGIN IMMEDIATE")
            now = _now_ist().isoformat()
            for r in ndf.itertuples(index=False):
                conn.execute(
                    """INSERT OR IGNORE INTO surveillance_blacklist
                       (symbol, series, measure_type, stage, effective_date, reason,
                        source_file, active, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (
                        r.symbol, r.series, r.measure_type, r.stage, r.effective_date,
                        r.reason, source_file, 1, now,
                    ),
                )
            conn.commit()
        finally:
            conn.close()
        res.rows = len(ndf)
        res.details["files"] = [source_file or "surveillance_list"]
    except Exception as e:
        res.status = "error"
        res.errors.append(str(e))
    _record_run(res, db_path_override or db_path())
    return res


# ---------------------------------------------------------------------------
# Blacklist helpers
# ---------------------------------------------------------------------------
def get_blacklisted_symbols(db_path_override: Optional[str] = None,
                            active_only: bool = True) -> List[str]:
    path = db_path_override or db_path()
    try:
        init_schema(path)
        conn = _connect(False, path)
        try:
            q = "SELECT DISTINCT symbol FROM surveillance_blacklist"
            if active_only:
                q += " WHERE active = 1"
            rows = conn.execute(q).fetchall()
            return [r["symbol"] for r in rows]
        finally:
            conn.close()
    except Exception:
        return []


def is_blacklisted(symbol: str, db_path_override: Optional[str] = None) -> bool:
    return str(symbol).strip().upper() in set(get_blacklisted_symbols(db_path_override))


def get_blacklist_details(db_path_override: Optional[str] = None) -> List[Dict[str, Any]]:
    path = db_path_override or db_path()
    try:
        init_schema(path)
        conn = _connect(False, path)
        try:
            rows = conn.execute(
                "SELECT * FROM surveillance_blacklist WHERE active=1 ORDER BY symbol"
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()
    except Exception:
        return []


def clear_blacklist(measure_type: Optional[str] = None,
                    db_path_override: Optional[str] = None) -> int:
    path = db_path_override or db_path()
    init_schema(path)
    conn = _connect(True, path)
    try:
        conn.execute("BEGIN IMMEDIATE")
        if measure_type:
            cur = conn.execute(
                "UPDATE surveillance_blacklist SET active=0 WHERE measure_type=?",
                (measure_type.upper(),),
            )
        else:
            cur = conn.execute("UPDATE surveillance_blacklist SET active=0")
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Circuit band helpers
# ---------------------------------------------------------------------------
def get_price_band(symbol: str, trade_date: Optional[Any] = None,
                   db_path_override: Optional[str] = None) -> Optional[Dict[str, Any]]:
    path = db_path_override or db_path()
    try:
        init_schema(path)
        conn = _connect(False, path)
        try:
            if trade_date is not None:
                td = _iso_date(trade_date)
                row = conn.execute(
                    "SELECT * FROM price_bands WHERE symbol=? AND trade_date=?",
                    (str(symbol).upper(), td),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT * FROM price_bands WHERE symbol=? ORDER BY trade_date DESC LIMIT 1",
                    (str(symbol).upper(),),
                ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()
    except Exception:
        return None


def spot_cushion(symbol: str, spot_price: float, trade_date: Optional[Any] = None,
                 db_path_override: Optional[str] = None,
                 buffer_pct: float = CIRCUIT_BUFFER_PCT) -> Dict[str, Any]:
    """Compute safe price cushion inside the dynamic circuit band."""
    band = get_price_band(symbol, trade_date, db_path_override)
    band_pct = DEFAULT_BAND_PCT
    prev_close = 0.0
    upper = None
    lower = None
    if band:
        band_pct = _to_float(band.get("band_pct"), DEFAULT_BAND_PCT)
        prev_close = _to_float(band.get("prev_close"), 0.0)
        upper = _to_float(band.get("upper_limit"), 0.0) or None
        lower = _to_float(band.get("lower_limit"), 0.0) or None

    if prev_close <= 0 and spot_price > 0:
        prev_close = spot_price
    if upper is None and prev_close > 0:
        upper = prev_close * (1.0 + band_pct / 100.0)
    if lower is None and prev_close > 0:
        lower = prev_close * (1.0 - band_pct / 100.0)

    safe_band = max(0.0, band_pct - buffer_pct)
    safe_long_max = prev_close * (1.0 + safe_band / 100.0) if prev_close > 0 else None
    safe_short_min = prev_close * (1.0 - safe_band / 100.0) if prev_close > 0 else None

    near_upper = (spot_price >= (upper * (1.0 - buffer_pct / 100.0))) if upper else False
    near_lower = (spot_price <= (lower * (1.0 + buffer_pct / 100.0))) if lower else False

    return {
        "symbol": str(symbol).upper(),
        "band_pct": band_pct,
        "prev_close": prev_close,
        "upper_circuit": upper,
        "lower_circuit": lower,
        "safe_band_pct": safe_band,
        "safe_long_max": safe_long_max,
        "safe_short_min": safe_short_min,
        "spot_price": spot_price,
        "near_upper_circuit": bool(near_upper),
        "near_lower_circuit": bool(near_lower),
        "pinned_risk": bool(near_upper or near_lower),
    }


# ---------------------------------------------------------------------------
# Settlement prices
# ---------------------------------------------------------------------------
def normalize_settlement_prices(df: pd.DataFrame, trade_date: Optional[Any] = None,
                                exchange: str = "NSE") -> pd.DataFrame:
    out = pd.DataFrame()
    g = lambda *c: _col(df, *c)
    sym_col = g("symbol", "sc_name", "security")
    if sym_col is None:
        raise ValueError("Settlement file missing SYMBOL column")
    out["symbol"] = df[sym_col].astype(str).str.strip().str.upper()

    series_col = g("series")
    out["series"] = (df[series_col].astype(str).str.strip().str.upper() if series_col else "EQ")

    date_col = g("date", "trading_date", "trade_date")
    if trade_date is not None:
        td = _iso_date(trade_date)
    elif date_col is not None:
        td_series = pd.to_datetime(df[date_col], dayfirst=True, errors="coerce")
        td = _iso_date(td_series.dropna().iloc[0]) if not td_series.dropna().empty else _iso_date()
    else:
        td = _iso_date()
    out["trade_date"] = td
    out["exchange"] = exchange

    price_col = g("settle_price", "settlement_price", "close_price", "close", "settle")
    if price_col is None:
        raise ValueError("Settlement file missing price column")
    out["settlement_price"] = df[price_col].map(_to_float)
    return out


def ingest_settlement_prices(source: Any, trade_date: Optional[Any] = None,
                            exchange: str = "NSE",
                            db_path_override: Optional[str] = None,
                            source_file: Optional[str] = None) -> IngestionResult:
    res = IngestionResult(job="SETTLEMENT_PRICES", status="success")
    try:
        df = _read_tabular(source)
        ndf = normalize_settlement_prices(df, trade_date, exchange)
        path = db_path_override or db_path()
        init_schema(path)
        conn = _connect(True, path)
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.executemany(
                """INSERT OR REPLACE INTO settlement_prices
                   (trade_date, exchange, symbol, series, settlement_price, source, ingested_at)
                   VALUES (?,?,?,?,?,?,?)""",
                [
                    (
                        r.trade_date, r.exchange, r.symbol, r.series, r.settlement_price,
                        source_file or "settlement_file", _now_ist().isoformat(),
                    )
                    for r in ndf.itertuples(index=False)
                ],
            )
            conn.commit()
        finally:
            conn.close()
        res.rows = len(ndf)
        res.details["files"] = [source_file or "settlement_file"]
    except Exception as e:
        res.status = "error"
        res.errors.append(str(e))
    _record_run(res, db_path_override or db_path())
    return res


def get_settlement_price(symbol: str, trade_date: Optional[Any] = None,
                         exchange: str = "NSE", series: str = "EQ",
                         db_path_override: Optional[str] = None) -> Optional[float]:
    path = db_path_override or db_path()
    try:
        init_schema(path)
        conn = _connect(False, path)
        try:
            td = _iso_date(trade_date) if trade_date is not None else None
            if td:
                row = conn.execute(
                    "SELECT settlement_price FROM settlement_prices WHERE symbol=? AND trade_date=? AND exchange=? AND series=?",
                    (str(symbol).upper(), td, exchange, series),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT settlement_price FROM settlement_prices WHERE symbol=? AND exchange=? AND series=? ORDER BY trade_date DESC LIMIT 1",
                    (str(symbol).upper(), exchange, series),
                ).fetchone()
            return _to_float(row["settlement_price"]) if row else None
        finally:
            conn.close()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Tradebook settlement reconciliation
# ---------------------------------------------------------------------------
@dataclass
class FillRecord:
    fill_id: str
    order_id: Optional[str] = None
    symbol: str = ""
    series: Optional[str] = None
    side: str = "BUY"
    quantity: int = 0
    fill_price: float = 0.0
    fill_time: Optional[str] = None
    exchange: Optional[str] = "NSE"
    product: Optional[str] = None
    trade_date: Optional[str] = None
    actual_charges: Optional[float] = None
    trigger_price: Optional[float] = None


def _normalize_fill(f: Any) -> FillRecord:
    if isinstance(f, FillRecord):
        return f
    if isinstance(f, Mapping):
        return FillRecord(
            fill_id=str(f.get("fill_id") or f.get("trade_id") or f.get("id") or uuid.uuid4().hex),
            order_id=f.get("order_id") or f.get("orderid"),
            symbol=str(f.get("symbol") or f.get("tradingSymbol") or "").strip().upper(),
            series=f.get("series"),
            side=str(f.get("side") or f.get("action") or f.get("transactionType") or "BUY").strip().upper(),
            quantity=_to_int(f.get("quantity") or f.get("qty") or f.get("tradedQty"), 0),
            fill_price=_to_float(f.get("fill_price") or f.get("price") or f.get("avg_fill_price") or f.get("average_price"), 0.0),
            fill_time=f.get("fill_time") or f.get("trade_time") or f.get("timestamp"),
            exchange=f.get("exchange") or "NSE",
            product=f.get("product"),
            trade_date=f.get("trade_date"),
            actual_charges=(None if f.get("statutory_charges") is None and f.get("charges") is None
                           else _to_float(f.get("statutory_charges", f.get("charges")), 0.0)),
            trigger_price=(None if f.get("trigger_price") is None else _to_float(f.get("trigger_price"), 0.0)),
        )
    raise TypeError(f"Unsupported fill type: {type(f)}")


def _store_fills(fills: List[FillRecord], trade_date: Optional[str], path: str) -> None:
    init_schema(path)
    conn = _connect(True, path)
    try:
        conn.execute("BEGIN IMMEDIATE")
        now = _now_ist().isoformat()
        td = trade_date or _iso_date()
        for fr in fills:
            conn.execute(
                """INSERT OR REPLACE INTO tradebook_fills
                   (fill_id, order_id, symbol, series, side, quantity, fill_price, fill_time,
                    exchange, product, trade_date, ingested_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    fr.fill_id, fr.order_id, fr.symbol, fr.series, fr.side, fr.quantity,
                    fr.fill_price, fr.fill_time, fr.exchange, fr.product,
                    fr.trade_date or td, now,
                ),
            )
        conn.commit()
    finally:
        conn.close()


@dataclass
class ReconciliationReport:
    run_id: str
    run_at: str
    trade_date: str
    fills_audited: int = 0
    matched: int = 0
    flagged: int = 0
    price_variance_total: float = 0.0
    charge_variance_total: float = 0.0
    results: List[Dict[str, Any]] = field(default_factory=list)
    flags: List[str] = field(default_factory=list)


def audit_tradebook_fills(fills: Iterable[Any], trade_date: Optional[Any] = None,
                          db_path_override: Optional[str] = None,
                          broker: str = "DHAN",
                          segment: str = "EQUITY_INTRADAY",
                          is_intraday: bool = True) -> ReconciliationReport:
    """Audit WealthOS fills against official NSE settlement prices."""
    path = db_path_override or db_path()
    init_schema(path)
    td = _iso_date(trade_date) if trade_date is not None else _iso_date()
    fr_list = [_normalize_fill(f) for f in fills]
    _store_fills(fr_list, td, path)

    # statutory engine (optional)
    try:
        from services.statutory_friction_engine import get_engine as _get_engine
        engine = _get_engine()
    except Exception:
        try:
            from statutory_friction_engine import get_engine as _get_engine  # type: ignore
            engine = _get_engine()
        except Exception:
            engine = None

    run_id = uuid.uuid4().hex
    run_at = _now_ist().isoformat()
    report = ReconciliationReport(run_id=run_id, run_at=run_at, trade_date=td)

    conn = _connect(True, path)
    try:
        # conn.execute("BEGIN IMMEDIATE")
        for fr in fr_list:
            settle = get_settlement_price(fr.symbol, td, fr.exchange or "NSE",
                                         fr.series or "EQ", path)
            price_var = (fr.fill_price - settle) if settle is not None else 0.0
            # expected charges on fill price
            exp_fill = 0.0
            exp_settle = 0.0
            if engine is not None:
                try:
                    cb = engine.calculate_charges(segment, fr.side, fr.fill_price, fr.quantity,
                                                  broker=broker, is_intraday=is_intraday)
                    exp_fill = float(getattr(cb, "total_statutory_charges", 0.0) or 0.0)
                except Exception:
                    exp_fill = 0.0
                if settle is not None:
                    try:
                        cb2 = engine.calculate_charges(segment, fr.side, settle, fr.quantity,
                                                       broker=broker, is_intraday=is_intraday)
                        exp_settle = float(getattr(cb2, "total_statutory_charges", 0.0) or 0.0)
                    except Exception:
                        exp_settle = 0.0

            actual = fr.actual_charges if fr.actual_charges is not None else exp_fill
            # charge variance: actual vs expected-on-settlement (theoretical)
            charge_var = actual - exp_settle if settle is not None else (actual - exp_fill)

            flags: List[str] = []
            if settle is None:
                flags.append("NO_SETTLEMENT_PRICE")
            else:
                if abs(price_var) > max(0.0, fr.fill_price * PRICE_VARIANCE_TOL_PCT):
                    flags.append("FILL_VS_SETTLEMENT_MISMATCH")
            if fr.actual_charges is not None and abs(actual - exp_fill) > CHARGE_VARIANCE_ALERT_INR:
                flags.append("STATUTORY_FRICTION_MISMATCH")
            if abs(charge_var) > CHARGE_VARIANCE_ALERT_INR:
                flags.append("CHARGE_VARIANCE_THRESHOLD")
            if fr.trigger_price is not None:
                slip = abs(fr.fill_price - fr.trigger_price) / fr.trigger_price if fr.trigger_price else 0.0
                if slip > 0.005:
                    flags.append("SLIPPAGE_ANOMALY")

            status = "CLEAN" if not flags else "FLAGGED"
            if not flags:
                report.matched += 1
            else:
                report.flagged += 1

            report.price_variance_total += price_var
            report.charge_variance_total += charge_var
            report.results.append({
                "fill_id": fr.fill_id,
                "symbol": fr.symbol,
                "side": fr.side,
                "quantity": fr.quantity,
                "fill_price": fr.fill_price,
                "settlement_price": settle,
                "price_variance": round(price_var, 4),
                "expected_charges_fill": round(exp_fill, 4),
                "expected_charges_settle": round(exp_settle, 4),
                "actual_charges": round(actual, 4),
                "charge_variance": round(charge_var, 4),
                "status": status,
                "flags": flags,
            })

            conn.execute(
                """INSERT INTO eod_reconciliation_results
                   (run_id, run_at, trade_date, fill_id, symbol, side, quantity, fill_price,
                    settlement_price, price_variance, expected_charges, actual_charges,
                    charge_variance, status, flags, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, run_at, td, fr.fill_id, fr.symbol, fr.side, fr.quantity,
                    fr.fill_price, settle, price_var, exp_settle, actual, charge_var,
                    status, json.dumps(flags), _now_ist().isoformat(),
                ),
            )
        conn.commit()
    finally:
        conn.close()

    report.fills_audited = len(fr_list)
    report.flags = [f"{r['symbol']}:{','.join(r['flags'])}" for r in report.results if r["flags"]]
    return report


# ---------------------------------------------------------------------------
# EOD pipeline orchestrator
# ---------------------------------------------------------------------------
def run_eod_pipeline(trade_date: Optional[Any] = None, inputs: Optional[Mapping[str, Any]] = None,
                     db_path_override: Optional[str] = None) -> Dict[str, Any]:
    """Run the full mechanical EOD pipeline given input file paths/DataFrames."""
    td = _iso_date(trade_date) if trade_date is not None else _iso_date()
    inputs = inputs or {}
    summary: Dict[str, Any] = {"trade_date": td, "results": {}, "errors": []}

    def _call(name, func, *a, **k):
        try:
            r = func(*a, **k)
            summary["results"][name] = (r.__dict__ if hasattr(r, "__dict__") else r)
            return r
        except Exception as e:
            summary["errors"].append(f"{name}: {e}")
            summary["results"][name] = {"status": "error", "error": str(e)}
            return None

    if "nse_bhavcopy" in inputs:
        _call("nse_bhavcopy", ingest_nse_bhavcopy, inputs["nse_bhavcopy"], trade_date=td,
              db_path_override=db_path_override, source_file=inputs.get("nse_bhavcopy_file"))
    if "bse_bhavcopy" in inputs:
        _call("bse_bhavcopy", ingest_bse_bhavcopy, inputs["bse_bhavcopy"], trade_date=td,
              db_path_override=db_path_override, source_file=inputs.get("bse_bhavcopy_file"))
    if "price_bands" in inputs or "pr_file" in inputs:
        key = "price_bands" if "price_bands" in inputs else "pr_file"
        _call("price_bands", ingest_price_bands, inputs[key], trade_date=td,
              db_path_override=db_path_override, source_file=inputs.get("pr_file_name"))
    if "mwpl" in inputs or "mwpl_ban_list" in inputs:
        key = "mwpl" if "mwpl" in inputs else "mwpl_ban_list"
        _call("mwpl", ingest_mwpl_ban_list, inputs[key], trade_date=td,
              db_path_override=db_path_override, source_file=inputs.get("mwpl_file_name"))
    if "surveillance" in inputs:
        _call("surveillance", ingest_surveillance_list, inputs["surveillance"],
              measure_type=inputs.get("surveillance_measure_type"), trade_date=td,
              db_path_override=db_path_override, source_file=inputs.get("surveillance_file"))
    if "settlement" in inputs or "settlement_prices" in inputs:
        key = "settlement" if "settlement" in inputs else "settlement_prices"
        _call("settlement", ingest_settlement_prices, inputs[key], trade_date=td,
              db_path_override=db_path_override, source_file=inputs.get("settlement_file"))
    if "fills" in inputs:
        rep = _call("reconciliation", audit_tradebook_fills, inputs["fills"], trade_date=td,
                    db_path_override=db_path_override, broker=inputs.get("broker", "DHAN"),
                    segment=inputs.get("segment", "EQUITY_INTRADAY"),
                    is_intraday=inputs.get("is_intraday", True))
        if rep is not None:
            summary["reconciliation"] = {
                "fills_audited": rep.fills_audited,
                "matched": rep.matched,
                "flagged": rep.flagged,
                "price_variance_total": rep.price_variance_total,
                "charge_variance_total": rep.charge_variance_total,
            }
    return summary


# ---------------------------------------------------------------------------
# Scheduler helper (optional APScheduler)
# ---------------------------------------------------------------------------
def schedule_eod_job(run_callable, run_time: str = "16:30", tz: str = "Asia/Kolkata"):
    """Schedule run_callable daily at run_time IST. Returns scheduler or None."""
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
    except Exception:
        return None
    try:
        from zoneinfo import ZoneInfo
        tzinfo = ZoneInfo(tz)
    except Exception:
        tzinfo = IST
    hour, minute = run_time.split(":")
    sched = BackgroundScheduler(timezone=tzinfo)
    sched.add_job(run_callable, CronTrigger(hour=int(hour), minute=int(minute), timezone=tzinfo))
    sched.start()
    return sched


__all__ = [
    "init_schema", "db_path", "configure_db", "IST",
    "ingest_nse_bhavcopy", "normalize_nse_bhavcopy",
    "ingest_bse_bhavcopy", "normalize_bse_bhavcopy",
    "ingest_price_bands", "normalize_price_bands",
    "ingest_mwpl_ban_list", "normalize_mwpl",
    "ingest_surveillance_list", "normalize_surveillance_list",
    "ingest_settlement_prices", "normalize_settlement_prices",
    "get_blacklisted_symbols", "is_blacklisted", "get_blacklist_details", "clear_blacklist",
    "get_price_band", "spot_cushion",
    "get_settlement_price", "audit_tradebook_fills",
    "run_eod_pipeline", "schedule_eod_job",
]
