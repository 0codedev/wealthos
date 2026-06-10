import os
import sys
import time
import random
import threading
import httpx

# Global connection pooled HTTPX Client for outbound calls
httpx_client = httpx.Client(
    limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
    timeout=httpx.Timeout(10.0, connect=2.5, read=5.0),
    trust_env=False
)
import traceback
import json
import re
from datetime import datetime, timedelta, timezone
from typing import List

# Ensure python-bridge root is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from logger import get_logger
log = get_logger("shared", tag="SHARED")

import db
import telemetry
from greeks import calculate_option_delta
from upstox import (
    download_and_sync_instruments, 
    update_historical_volume_avg, 
    update_bulk_volume_averages, 
    bulk_vol_progress
)
from upstox_resilience import resilient_upstox as upstox_client
from upstox_ws import upstox_ws_client
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

try:
    from pnsea import NSE
except ImportError:
    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../.venv/Lib/site-packages")))
    from pnsea import NSE

APP_START_TIME = time.time()

# Global singleton for NSE stealth session
log.info("Launching stealth NSE session...")
try:
    nse = NSE()
    log.info("Stealth session initialized successfully.")
except Exception as e:
    log.error(f"Failed to initialize NSE stealth session on startup: {e}")
    nse = None

# User-Agents for browser fingerprint rotation
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
]

def rotate_stealth_headers(nse_instance):
    """
    Dynamically swaps User-Agent headers on the stealth session client 
    to prevent IP-based fingerprint tracking from the stock exchange.
    """
    try:
        ua = random.choice(USER_AGENTS)
        if hasattr(nse_instance, 'session'):
            if hasattr(nse_instance.session, 'headers'):
                nse_instance.session.headers.update({"User-Agent": ua})
        elif hasattr(nse_instance, 'headers'):
            nse_instance.headers.update({"User-Agent": ua})
    except Exception as e:
        log.warning("Failed to rotate headers: %s", e)

def run_with_retry(func, *args, retries=3, backoff=1.5, **kwargs):
    """
    Executes an NSE fetch function with auto-retry, exponential backoff,
    and stealth header rotation.
    """
    last_err = None
    for attempt in range(retries):
        try:
            rotate_stealth_headers(nse)
            return func(*args, **kwargs)
        except Exception as e:
            last_err = e
            func_name = getattr(func, '__name__', 'NSE API call')
            log.warning("Attempt %d/%d failed for function '%s': %s", attempt+1, retries, func_name, e)
            if attempt < retries - 1:
                sleep_time = (backoff ** attempt) + random.uniform(0.5, 1.5)
                time.sleep(sleep_time)
    if last_err is not None:
        raise last_err
    raise RuntimeError("NSE API call failed with unknown error")

def fetch_endpoint_with_retry(url, retries=3, backoff=1.5):
    """
    Specialized retry wrapper for endpoint_tester to retry on non-200 block codes.
    """
    last_err = None
    for attempt in range(retries):
        try:
            rotate_stealth_headers(nse)
            if nse and hasattr(nse, 'endpoint_tester'):
                res = nse.endpoint_tester(url)
                if res and hasattr(res, 'status_code') and res.status_code == 200:
                    return res
                raise Exception(f"NSE returned status {getattr(res, 'status_code', 'unknown')}")
            raise Exception("NSE stealth session not initialized")
        except Exception as e:
            last_err = e
            log.warning("Endpoint fetch attempt %d/%d failed for %s: %s", attempt+1, retries, url, e)
            if attempt < retries - 1:
                sleep_time = (backoff ** attempt) + random.uniform(0.5, 1.5)
                time.sleep(sleep_time)
    if last_err is not None:
        raise last_err
    raise RuntimeError("Endpoint fetch failed with unknown error")

# Global state to track background scanning progress
scan_progress = {
    "is_scanning": False,
    "total": 0,
    "current": 0,
    "current_symbol": "",
    "error_count": 0,
    "last_completed": None
}

# --- Indian stock market hours (IST 9:15 - 15:30, Mon-Fri, NSE holidays excluded) ---
#
# CC116: The previous `is_market_hours()` only checked weekday + time-of-day,
# which falsely returned True on NSE holidays (Republic Day, Holi, Independence
# Day, Diwali, Gandhi Jayanti, Christmas, etc). It also had no notion of "next
# state change", which forced the BridgeStatusBanner (and other consumers) to
# poll every 3s forever just to keep an `is_open` flag fresh.
#
# This module now exposes:
#   - `market_status()` -> {is_open, opens_at, closes_at, seconds_until_change}
#   - `is_market_hours()` -> bool (backward-compatible wrapper; uses the same cache)
#
# The cache TTL is `min(30s, seconds_until_change)` so a high-frequency caller
# (e.g. a request handler) gets a fresh value at most every 30s, while the
# `seconds_until_change` field lets low-frequency callers (BridgeStatusBanner,
# poller loops) schedule a single setTimeout until the next state change
# instead of polling.

# NSE 2026 holidays (F&O / Cash equity trading holidays). Source: NSE circular
# NSE/CA/2026/13 dated 2025-12-19. Update this set once per year after the
# annual NSE holiday calendar is published (typically late November).
# Format: set of "YYYY-MM-DD" IST calendar dates.
_NSE_HOLIDAYS_2026 = {
    "2026-01-26",  # Republic Day
    "2026-02-19",  # Maha Shivaratri
    "2026-03-03",  # Holi
    "2026-03-31",  # Eid al-Fitr (tentative)
    "2026-04-03",  # Good Friday
    "2026-04-14",  # Dr. Ambedkar Jayanti
    "2026-04-30",  # Buddha Purnima
    "2026-05-01",  # Maharashtra Day / Labour Day
    "2026-06-16",  # Eid al-Adha (tentative)
    "2026-08-15",  # Independence Day
    "2026-09-14",  # Ganesh Chaturthi
    "2026-10-02",  # Gandhi Jayanti / Dussehra
    "2026-10-19",  # Diwali (Lakshmi Puja)
    "2026-11-08",  # Diwali Balipratipada
    "2026-11-25",  # Guru Nanak Jayanti
    "2026-12-25",  # Christmas
}

# IST is always UTC+5:30; do not depend on the host timezone.
IST = timezone(timedelta(hours=5, minutes=30))

# Module-level cache. Refreshed on demand; safe under threading because every
# call site reads a tuple atomically and the cache is short-lived (max 30s).
_market_status_cache: dict = {"value": None, "expires_at": 0.0}


def _compute_market_status(now_utc: datetime) -> dict:
    """Pure function. Returns the current market status given UTC `now_utc`.
    `opens_at` is the moment the market most recently opened (or will open next
    if currently closed); `closes_at` is the next moment it closes.
    """
    now_ist = now_utc.astimezone(IST)
    today_ist_date = now_ist.date()
    market_open_time = now_ist.replace(hour=9, minute=15, second=0, microsecond=0)
    market_close_time = now_ist.replace(hour=15, minute=30, second=0, microsecond=0)
    today_key = today_ist_date.isoformat()

    # Closed on weekends or NSE holidays.
    is_weekend = today_ist_date.weekday() >= 5  # 5=Sat, 6=Sun
    is_holiday = today_key in _NSE_HOLIDAYS_2026
    if is_weekend or is_holiday:
        opens_at = _next_open(now_ist)
        return {
            "is_open": False,
            "opens_at": opens_at.isoformat(),
            "closes_at": opens_at.isoformat(),  # closes_at == opens_at while closed; updated when open
            "now_ist": now_ist.isoformat(),
            "reason": "weekend" if is_weekend else "holiday",
        }

    # Weekday: depends on time-of-day.
    if now_ist < market_open_time:
        return {
            "is_open": False,
            "opens_at": market_open_time.isoformat(),
            "closes_at": market_close_time.isoformat(),
            "now_ist": now_ist.isoformat(),
            "reason": "pre_open",
        }
    if now_ist > market_close_time:
        next_o = _next_open(now_ist)
        return {
            "is_open": False,
            "opens_at": next_o.isoformat(),
            "closes_at": next_o.isoformat(),
            "now_ist": now_ist.isoformat(),
            "reason": "post_close",
        }
    return {
        "is_open": True,
        "opens_at": market_open_time.isoformat(),
        "closes_at": market_close_time.isoformat(),
        "now_ist": now_ist.isoformat(),
        "reason": "open",
    }


def _next_open(now_ist: datetime) -> datetime:
    """Return the next IST datetime the market will open (next weekday, not a
    holiday), at 9:15 local. The returned datetime is the future opening time;
    if we're currently between close and midnight, return tomorrow's open; if
    we're past midweek close, return Monday's open.
    """
    # Walk forward one day at a time, building up a fresh datetime at 9:15 IST
    # for each candidate (the `+ timedelta` on a date gives a date, not datetime,
    # so we re-anchor via `replace(hour=9, minute=15)` after the date math).
    for offset in range(1, 9):  # up to 8 days ahead — bail at the first valid opening
        candidate_date = now_ist.date() + timedelta(days=offset)
        if candidate_date.weekday() >= 5:
            continue
        if candidate_date.isoformat() in _NSE_HOLIDAYS_2026:
            continue
        return datetime.combine(candidate_date, datetime.min.time()).replace(
            hour=9, minute=15, tzinfo=IST
        )
    # Extreme fallback (e.g. 8 consecutive holidays): return a sensible default.
    return (now_ist + timedelta(days=1)).replace(hour=9, minute=15)


def market_status() -> dict:
    """Cached market status. Returns dict with `is_open`, `opens_at`,
    `closes_at`, `now_ist`, `reason`, and `seconds_until_change`.
    """
    now_utc = datetime.now(timezone.utc)
    cached = _market_status_cache
    if cached["value"] is not None and now_utc.timestamp() < cached["expires_at"]:
        return cached["value"]

    status = _compute_market_status(now_utc)
    opens_at_dt = datetime.fromisoformat(status["opens_at"]).replace(tzinfo=IST)
    closes_at_dt = datetime.fromisoformat(status["closes_at"]).replace(tzinfo=IST)
    if status["is_open"]:
        # Next change is the close.
        secs = max(1, int((closes_at_dt - now_utc).total_seconds()))
    else:
        next_change_dt = opens_at_dt if opens_at_dt > now_utc.astimezone(IST) else opens_at_dt
        secs = max(1, int((next_change_dt - now_utc).total_seconds()))
    status["seconds_until_change"] = secs

    # Cache for at most 30s, but never past the next state change.
    ttl = min(30, secs) if secs > 0 else 30
    cached["value"] = status
    cached["expires_at"] = now_utc.timestamp() + ttl
    return status


def is_market_hours() -> bool:
    """Backward-compatible wrapper. Returns True only during trading hours on
    a non-holiday weekday (IST 9:15 - 15:30).
    """
    return market_status()["is_open"]


def serialize(data):
    if isinstance(data, pd.DataFrame) if 'pd' in globals() else False:
         return data.to_dict(orient="records")
    # Quick fallback for pandas serialization
    try:
        import pandas as pd
        if isinstance(data, pd.DataFrame):
            return data.to_dict(orient="records")
    except ImportError:
        pass
    return data

def sanitize_symbol(symbol: str) -> str:
    if not symbol:
        return ""
    return re.sub(r'[^A-Za-z0-9\-\&\_]', '', symbol).upper().strip()

nse_cache = {}
nse_cache_lock = threading.Lock()

def prune_nse_cache():
    global nse_cache
    now = time.time()
    expired_keys = [k for k, (ts, _) in nse_cache.items() if now - ts > 300]
    for k in expired_keys:
        nse_cache.pop(k, None)
    if len(nse_cache) > 100:
        sorted_keys = sorted(nse_cache.keys(), key=lambda k: nse_cache[k][0])
        for k in sorted_keys[:-100]:
            nse_cache.pop(k, None)

def get_cached_nse_data(key: str, ttl_seconds: int = 15):
    with nse_cache_lock:
        entry = nse_cache.get(key)
        if entry:
            timestamp, data = entry
            if time.time() - timestamp < ttl_seconds:
                return data

    db_data = db.get_nse_db_cache(key)
    if db_data is not None:
        with nse_cache_lock:
            prune_nse_cache()
            nse_cache[key] = (time.time(), db_data)
        return db_data

    return None

def set_cached_nse_data(key: str, data, ttl_seconds: int = 15):
    with nse_cache_lock:
        prune_nse_cache()
        nse_cache[key] = (time.time(), data)
    db.set_nse_db_cache(key, data, ttl_seconds)

def format_date_for_nse(date_str):
    if not date_str:
        return None
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        return dt.strftime("%d-%m-%Y")
    except ValueError:
        return date_str

# --- BACKGROUND PROCESSES ---

orderflow_watchlist = {"RELIANCE", "SBIN", "HDFCBANK", "ICICIBANK", "INFY"}
prev_option_chain_data = {}
prev_orderflow_metrics = {}

def get_nearest_active_expiry(expiry_dates: list) -> str:
    if not expiry_dates:
        return ""
    
    utc_now = datetime.now(timezone.utc)
    ist_now = utc_now + timedelta(hours=5, minutes=30)
    nearest_expiry_str = expiry_dates[0]
    
    try:
        expiry_dt = datetime.strptime(nearest_expiry_str, "%d-%b-%Y")
        is_past_expiry = False
        if ist_now.date() > expiry_dt.date():
            is_past_expiry = True
        elif ist_now.date() == expiry_dt.date():
            if ist_now.time().hour > 15 or (ist_now.time().hour == 15 and ist_now.time().minute >= 30):
                is_past_expiry = True
                
        if is_past_expiry and len(expiry_dates) > 1:
            log.info("Expiry %s has expired. Rolling to next active expiry: %s", nearest_expiry_str, expiry_dates[1])
            return expiry_dates[1]
    except Exception as e:
        log.error("Error checking expiry rollover: %s", e)
        
    return nearest_expiry_str

def is_indian_market_open() -> bool:
    utc_now = datetime.now(timezone.utc)
    ist_now = utc_now + timedelta(hours=5, minutes=30)
    
    if ist_now.weekday() >= 5:
        return False
        
    market_start = ist_now.replace(hour=9, minute=15, second=0, microsecond=0)
    market_end = ist_now.replace(hour=15, minute=30, second=0, microsecond=0)
    
    return market_start <= ist_now <= market_end

orderflow_processing_lock = threading.Lock()
currently_processing_orderflow = set()

def prevent_duplicate_orderflow(func):
    def wrapper(symbol: str, *args, **kwargs):
        sym = symbol.upper().strip()
        with orderflow_processing_lock:
            if sym in currently_processing_orderflow:
                log.debug("Already calculating metrics for %s. Skipping duplicate task.", sym)
                return
            currently_processing_orderflow.add(sym)
        try:
            return func(symbol, *args, **kwargs)
        finally:
            with orderflow_processing_lock:
                currently_processing_orderflow.discard(sym)
    return wrapper

# Simple cache for Yahoo Finance API responses (60 seconds TTL)
yahoo_cache = {}
yahoo_cache_lock = threading.Lock()

def get_yahoo_data_cached(url: str, headers: dict) -> dict:
    global yahoo_cache
    now = time.time()
    
    with yahoo_cache_lock:
        if url in yahoo_cache:
            ts, cached_json = yahoo_cache[url]
            if now - ts <= 60.0: # 60 seconds TTL
                return cached_json
                
    # Cache miss or expired — query with strict 2.5s timeout to prevent thread stalls
    try:
        response = httpx_client.get(url, headers=headers, timeout=2.5)
        if response.status_code == 200:
            data = response.json()
            with yahoo_cache_lock:
                # Limit size of cache
                if len(yahoo_cache) >= 100:
                    oldest = min(yahoo_cache.keys(), key=lambda k: yahoo_cache[k][0])
                    yahoo_cache.pop(oldest, None)
                yahoo_cache[url] = (now, data)
            return data
        else:
            log.debug("Yahoo Finance API returned status %d for %s", response.status_code, url)
            with yahoo_cache_lock:
                if url in yahoo_cache:
                    return yahoo_cache[url][1]
    except Exception as e:
        log.debug("Yahoo Finance request timeout/bypass for %s: %s", url, e)
        with yahoo_cache_lock:
            if url in yahoo_cache:
                return yahoo_cache[url][1]
    return None

@prevent_duplicate_orderflow
def compute_orderflow_metrics_for_symbol(symbol: str):
    global prev_option_chain_data, prev_orderflow_metrics
    if not is_indian_market_open():
        return
    try:
        symbol = symbol.upper().strip()
        indices = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"]
        
        expiry_url = f"https://www.nseindia.com/api/option-chain-contract-info?symbol={symbol}"
        time.sleep(random.uniform(0.5, 1.2))
        res_expiry = fetch_endpoint_with_retry(expiry_url)
        expiry_dates = res_expiry.json().get("expiryDates", [])
        if not expiry_dates:
            log.warning("No expiry dates found for %s", symbol)
            return
        nearest_expiry = get_nearest_active_expiry(expiry_dates)
        
        option_type = "Indices" if symbol in indices else "Equity"
        url = f"https://www.nseindia.com/api/option-chain-v3?type={option_type}&symbol={symbol}&expiry={nearest_expiry}"
            
        time.sleep(random.uniform(0.5, 1.2))
        res = fetch_endpoint_with_retry(url)
            
        opt_data = res.json()
        records = opt_data.get("records")
        filtered = opt_data.get("filtered")
        if not records or not filtered:
            log.warning("Empty records or filtered object in option chain for %s", symbol)
            return
            
        spot_price = float(records.get("underlyingValue", 0.0))
        if spot_price <= 0:
            log.warning("Spot price <= 0 for %s", symbol)
            return
            
        expiry_dates = records.get("expiryDates", [])
        if not expiry_dates:
            log.warning("No expiry dates for %s", symbol)
            return
        nearest_expiry_str = get_nearest_active_expiry(expiry_dates)
        
        try:
            expiry_dt = datetime.strptime(nearest_expiry_str, "%d-%b-%Y")
            utc_now = datetime.now(timezone.utc)
            ist_now = utc_now + timedelta(hours=5, minutes=30)
            days_to_expiry = max((expiry_dt.date() - ist_now.date()).days, 0.5)
        except Exception:
            days_to_expiry = 3.0
            
        contracts = [c for c in records.get("data", []) if (c.get("expiryDate") or c.get("expiryDates")) == nearest_expiry_str]
        if not contracts:
            log.warning("No contracts found for expiry %s in %s", nearest_expiry_str, symbol)
            return
            
        strikes = sorted([c.get("strikePrice") for c in contracts])
        atm_strike = min(strikes, key=lambda x: abs(x - spot_price))
        atm_idx = strikes.index(atm_strike)
        
        target_strikes = strikes[max(0, atm_idx - 1) : min(len(strikes), atm_idx + 2)]
        greek_strikes = strikes[max(0, atm_idx - 2) : min(len(strikes), atm_idx + 3)]
        
        if symbol not in prev_option_chain_data:
            prev_option_chain_data[symbol] = {}
        prev_symbol_opts = prev_option_chain_data[symbol]
        
        option_synergy = 0.0
        for strike in target_strikes:
            contract = next((c for c in contracts if c.get("strikePrice") == strike), None)
            if not contract or "CE" not in contract:
                continue
            ce = contract["CE"]
            current_oi = float(ce.get("openInterest", 0.0))
            current_vol = float(ce.get("totalTradedVolume", 0.0))
            
            strike_key = f"{strike}_CE"
            prev_state = prev_symbol_opts.get(strike_key, {"oi": current_oi, "vol": current_vol})
            
            delta_oi = max(current_oi - prev_state["oi"], 0.0)
            interval_vol = max(current_vol - prev_state["vol"], 0.0)
            
            prev_symbol_opts[strike_key] = {"oi": current_oi, "vol": current_vol}
            option_synergy += (delta_oi * interval_vol)
            
        p_inst = 0.0
        for strike in greek_strikes:
            contract = next((c for c in contracts if c.get("strikePrice") == strike), None)
            if not contract:
                continue
                
            if "CE" in contract:
                ce = contract["CE"]
                ce_oi = float(ce.get("openInterest", 0.0))
                ce_iv = float(ce.get("impliedVolatility", 0.0) or 0.0) / 100.0
                if ce_iv <= 0:
                    ce_iv = 0.15
                    
                prev_ce_oi = prev_symbol_opts.get(f"{strike}_CE_greek_oi", ce_oi)
                delta_ce_oi = ce_oi - prev_ce_oi
                prev_symbol_opts[f"{strike}_CE_greek_oi"] = ce_oi
                
                delta_val = calculate_option_delta(spot_price, strike, days_to_expiry, 0.07, ce_iv, "CE")
                p_inst += (delta_ce_oi * delta_val)
                
            if "PE" in contract:
                pe = contract["PE"]
                pe_oi = float(pe.get("openInterest", 0.0))
                pe_iv = float(pe.get("impliedVolatility", 0.0) or 0.0) / 100.0
                if pe_iv <= 0:
                    pe_iv = 0.15
                    
                prev_pe_oi = prev_symbol_opts.get(f"{strike}_PE_greek_oi", pe_oi)
                delta_pe_oi = pe_oi - prev_pe_oi
                prev_symbol_opts[f"{strike}_PE_greek_oi"] = pe_oi
                
                delta_val = calculate_option_delta(spot_price, strike, days_to_expiry, 0.07, pe_iv, "PE")
                p_inst -= (delta_pe_oi * delta_val)
                
        spot_ticker = symbol + ".NS"
        vol_ticker = symbol + ".NS"
        if symbol == "NIFTY":
            spot_ticker = "^NSEI"
            vol_ticker = "NIFTYBEES.NS"
        elif symbol == "BANKNIFTY":
            spot_ticker = "^NSEBANK"
            vol_ticker = "BANKBEES.NS"
        elif symbol == "FINNIFTY":
            spot_ticker = "^CNXFIN"
            vol_ticker = "HDFCBANK.NS"
            
        headers = {"User-Agent": "Mozilla/5.0"}
        
        spot_url = f"https://query1.finance.yahoo.com/v8/finance/chart/{spot_ticker}?interval=5m&range=1d"
        spot_json = get_yahoo_data_cached(spot_url, headers=headers)
        if not spot_json:
            log.warning("Yahoo Finance spot request failed for %s", spot_ticker)
            return
            
        if vol_ticker != spot_ticker:
            vol_url = f"https://query1.finance.yahoo.com/v8/finance/chart/{vol_ticker}?interval=5m&range=1d"
            vol_json = get_yahoo_data_cached(vol_url, headers=headers) or spot_json
        else:
            vol_json = spot_json
            
        res_result = spot_json.get("chart", {}).get("result", [None])[0]
        vol_result = vol_json.get("chart", {}).get("result", [None])[0]
        if not res_result:
            log.warning("Empty Yahoo chart result for %s", spot_ticker)
            return
            
        quotes = res_result.get("indicators", {}).get("quote", [{}])[0]
        timestamps = res_result.get("timestamp", [])
        
        if not timestamps or not quotes.get("close"):
            log.warning("No candles found for %s", spot_ticker)
            return
            
        last_idx = -1
        for i in range(len(timestamps) - 1, -1, -1):
            if quotes["close"][i] is not None and quotes["high"][i] is not None and quotes["low"][i] is not None:
                last_idx = i
                break
        if last_idx == -1:
            log.warning("No valid candles found for %s", spot_ticker)
            return
            
        c_close = float(quotes["close"][last_idx])
        c_high = float(quotes["high"][last_idx])
        c_low = float(quotes["low"][last_idx])
        
        v_quotes = vol_result.get("indicators", {}).get("quote", [{}])[0] if vol_result else quotes
        c_vol = float(v_quotes.get("volume", [0.0])[last_idx] or 0.0)
        
        denom = c_high - c_low
        price_factor = 0.0
        if denom > 0:
            price_factor = ((c_close - c_low) / denom - 0.5) * 2.0
        price_aggression = c_vol * price_factor
        
        composite_val = option_synergy * price_aggression
        
        utc_time = datetime.fromtimestamp(timestamps[last_idx], tz=timezone.utc)
        ist_time = utc_time + timedelta(hours=5, minutes=30)
        timestamp_str = ist_time.strftime("%Y-%m-%d %H:%M:00")
        time_slot = ist_time.strftime("%H:%M")
        
        baseline = db.get_timeslot_baseline(symbol, time_slot, limit=20)
        if abs(baseline) < 1e-5:
            baseline = 1.0
        r_factor = float(composite_val / baseline)
        
        if symbol not in prev_orderflow_metrics:
            prev_orderflow_metrics[symbol] = {"spot_price": spot_price, "p_inst": p_inst}
        prev_metrics = prev_orderflow_metrics[symbol]
        
        delta_price = spot_price - prev_metrics["spot_price"]
        delta_p_inst = p_inst - prev_metrics["p_inst"]
        
        apex_signal = "NEUTRAL"
        if delta_price > 0 and delta_p_inst <= 0:
            apex_signal = "EXHAUSTION_APEX"
        elif delta_price < 0 and delta_p_inst >= 0:
            apex_signal = "ACCUMULATION_APEX"
            
        prev_orderflow_metrics[symbol] = {"spot_price": spot_price, "p_inst": p_inst}
        
        db.save_orderflow_tick(
            symbol, timestamp_str, time_slot,
            option_synergy, price_aggression, composite_val,
            p_inst, spot_price, r_factor, apex_signal
        )
        log.debug("Saved tick for %s: spot=%.2f, r_factor=%.2f, signal=%s", symbol, spot_price, r_factor, apex_signal)
        
    except Exception as ex:
        log.error("Failed to compute orderflow metrics for %s: %s", symbol, ex, exc_info=True)

_of_tick_count = 0
def orderflow_polling_loop():
    global _of_tick_count
    log.info("Initiating background loop...")
    market_was_open = True
    while True:
        try:
            market_open = is_indian_market_open()
            if not market_open:
                if market_was_open:
                    log.info("Indian market is closed (IST). Suspending background polling.")
                    market_was_open = False
                log.debug("Indian market is closed (IST). Skipping polling.")
                time.sleep(900)
                continue
                
            if not market_was_open:
                log.info("Indian market is open (IST). Resuming background polling.")
                market_was_open = True
                
            _of_tick_count += 1
            symbols = ["NIFTY", "BANKNIFTY", "FINNIFTY"] + list(orderflow_watchlist)
            if _of_tick_count % 10 == 1:
                log.info("Background polling tick #%d for symbols: %s", _of_tick_count, symbols)
            else:
                log.debug("Background polling tick #%d for symbols: %s", _of_tick_count, symbols)
                
            for symbol in symbols:
                compute_orderflow_metrics_for_symbol(symbol)
                time.sleep(random.uniform(1.0, 2.0))
        except Exception as e:
            log.error("Order flow polling loop error: %s", e, exc_info=True)
            
        time.sleep(300)

def bulk_fetch_delivery_history(symbols: List[str]):
    global scan_progress
    scan_progress["is_scanning"] = True
    scan_progress["total"] = len(symbols)
    scan_progress["current"] = 0
    scan_progress["error_count"] = 0
    scan_progress["last_completed"] = None
    
    to_date = datetime.now().strftime("%Y-%m-%d")
    from_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    
    from_nse = format_date_for_nse(from_date)
    to_nse = format_date_for_nse(to_date)
    
    for symbol in symbols:
        if not scan_progress["is_scanning"]:
            log.info("Stopped background scan.")
            break
            
        symbol = symbol.upper().strip()
        scan_progress["current_symbol"] = symbol
        log.info("[%d/%d] Fetching delivery history for %s", scan_progress['current']+1, scan_progress['total'], symbol)
        
        try:
            time.sleep(random.uniform(1.2, 2.5))
            df = run_with_retry(nse.equity.delivery_history, symbol, from_nse, to_nse)
            db.save_delivery(symbol, df)
        except Exception as e:
            log.error("Failed to fetch delivery history for %s: %s", symbol, e)
            scan_progress["error_count"] += 1
            
        scan_progress["current"] += 1
        
    scan_progress["is_scanning"] = False
    scan_progress["current_symbol"] = ""
    scan_progress["last_completed"] = datetime.now().isoformat()
    log.info("Completed background scan.")

def run_startup_syncs():
    try:
        time.sleep(5.0)
        conn = db.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as count FROM upstox_instruments")
        row = cursor.fetchone()
        count = row["count"] if row else 0
        conn.close()
        
        if count == 0:
            log.info("Instrument cache is empty. Triggering sync...")
            download_and_sync_instruments()
        else:
            log.info("Instrument cache contains %d items. Skipping initial sync.", count)
            
        try:
            from services.instrument_registry import sync_instrument_registry
            sync_instrument_registry()
        except Exception as reg_err:
            log.error("Instrument registry sync failed: %s", reg_err)
            
        fno_json = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fno_stocks_generated.json")
        should_sync = True
        if os.path.exists(fno_json):
            mtime = os.path.getmtime(fno_json)
            age_days = (time.time() - mtime) / 86400
            if age_days < 30:
                should_sync = False
                log.info("F&O universe mapping is %.1f days old (less than 30). Skipping startup sync.", age_days)
        
        if should_sync:
            log.info("F&O universe mapping is missing or older than 30 days. Triggering sync...")
            from update_fno_universe import run_sync
            run_sync()
            log.info("F&O universe sync completed.")
    except Exception as e:
        log.error("Instrument check/sync failed: %s", e)

# --- APSCHEDULER JOBS ---

# Initial values
default_history = {
    "bulk_volume_avg": {"last_run": None, "status": "idle", "error": None},
    "instrument_sync": {"last_run": None, "status": "idle", "error": None},
    "ohlc_cache": {"last_run": None, "status": "idle", "error": None},
    "fii_dii_sync": {"last_run": None, "status": "idle", "error": None},
    "fundamentals_refresh": {"last_run": None, "status": "idle", "error": None},
    "database_cleanup": {"last_run": None, "status": "idle", "error": None},
    "parquet_archive": {"last_run": None, "status": "idle", "error": None}
}

# Merge with persisted database values
job_execution_history = default_history.copy()
try:
    persisted_history = db.get_all_job_metadata()
    for job_id, details in persisted_history.items():
        if job_id in job_execution_history:
            job_execution_history[job_id] = details
except Exception as e:
    log.error(f"Failed to load persisted scheduler job history: {e}")

def update_job_status(job_id: str, status: str, error: str = None):
    global job_execution_history
    if job_id not in job_execution_history:
        job_execution_history[job_id] = {"last_run": None, "status": "idle", "error": None}
    
    if status == "running":
        job_execution_history[job_id]["last_run"] = datetime.now().isoformat()
    
    job_execution_history[job_id]["status"] = status
    job_execution_history[job_id]["error"] = error
    
    last_run = job_execution_history[job_id].get("last_run")
    db.save_job_metadata(job_id, last_run, status, error)


scheduler = None

def get_fno_symbols() -> list:
    try:
        # Go up three levels to reach workspace root where data/fno_stocks.ts lives
        workspace_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        fno_path = os.path.abspath(os.path.join(workspace_root, "data/fno_stocks.ts"))
        if os.path.exists(fno_path):
            with open(fno_path, 'r', encoding='utf-8') as f:
                content = f.read()
            found_symbols = re.findall(r"symbol:\s*['\"]([A-Z0-9&-]+)['\"]", content)
            if found_symbols:
                return list(set(found_symbols))
    except Exception as e:
        log.error("Failed to parse fno_stocks.ts: %s", e)
    return ["SBIN", "RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "AXISBANK", "LT", "ITC"]

def job_bulk_volume_avg():
    update_job_status("bulk_volume_avg", "running")
    try:
        symbols = get_fno_symbols()
        log.info("Starting bulk volume avg refresh for %d symbols...", len(symbols))
        update_bulk_volume_averages(symbols, days=20)
        update_job_status("bulk_volume_avg", "success")
    except Exception as e:
        error_msg = str(e)
        log.error("Bulk volume avg job failed: %s", error_msg)
        update_job_status("bulk_volume_avg", "failed", error_msg)
        db.log_upstox_error("job_bulk_volume_avg", 500, error_msg, "none")

def job_instrument_sync():
    update_job_status("instrument_sync", "running")
    try:
        log.info("Starting instrument sync...")
        download_and_sync_instruments()
        update_job_status("instrument_sync", "success")
    except Exception as e:
        error_msg = str(e)
        log.error("Instrument sync job failed: %s", error_msg)
        update_job_status("instrument_sync", "failed", error_msg)
        db.log_upstox_error("job_instrument_sync", 500, error_msg, "none")

def job_ohlc_cache():
    update_job_status("ohlc_cache", "running")
    try:
        symbols = get_fno_symbols()
        log.info("Pre-caching OHLC for %d symbols...", len(symbols))
        keys = []
        for sym in symbols:
            key = db.get_upstox_instrument_key(sym, exchange="NSE_EQ") or db.get_upstox_instrument_key(sym)
            if key:
                keys.append(key)
        
        if keys:
            quotes = upstox_client.get_full_quotes(keys)
            log.info("Pre-cached %d OHLC quotes.", len(quotes))
        update_job_status("ohlc_cache", "success")
    except Exception as e:
        error_msg = str(e)
        log.error("OHLC caching failed: %s", error_msg)
        update_job_status("ohlc_cache", "failed", error_msg)
        db.log_upstox_error("job_ohlc_cache", 500, error_msg, "none")

def job_fii_dii_sync():
    update_job_status("fii_dii_sync", "running")
    try:
        log.info("Syncing FII/DII daily data...")
        upstox_client.get_fii_data("FO", "daily")
        upstox_client.get_dii_data("daily")
        update_job_status("fii_dii_sync", "success")
    except Exception as e:
        error_msg = str(e)
        log.error("FII/DII sync failed: %s", error_msg)
        update_job_status("fii_dii_sync", "failed", error_msg)
        db.log_upstox_error("job_fii_dii_sync", 500, error_msg, "none")

def job_fundamentals_refresh():
    update_job_status("fundamentals_refresh", "running")
    try:
        symbols = get_fno_symbols()
        log.info("Refreshing fundamentals for %d symbols...", len(symbols))
        for sym in symbols[:50]:
            key = db.get_upstox_instrument_key(sym, exchange="NSE_EQ")
            if not key:
                continue
            
            conn = db.get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT isin FROM upstox_instruments WHERE instrument_key = ?", (key,))
            row = cursor.fetchone()
            isin = row["isin"] if row else None
            conn.close()
            
            if isin:
                try:
                    upstox_client.request("GET", "fundamentals/company-profile", params={"isin": isin}, bypass_cache=True)
                    time.sleep(0.15)
                    upstox_client.request("GET", "fundamentals/key-ratios", params={"isin": isin}, bypass_cache=True)
                    time.sleep(0.15)
                    upstox_client.request("GET", "fundamentals/share-holdings", params={"isin": isin}, bypass_cache=True)
                    time.sleep(0.15)
                except Exception:
                    pass
                    
        update_job_status("fundamentals_refresh", "success")
    except Exception as e:
        error_msg = str(e)
        log.error("Fundamentals refresh failed: %s", error_msg)
        update_job_status("fundamentals_refresh", "failed", error_msg)
        db.log_upstox_error("job_fundamentals_refresh", 500, error_msg, "none")

def job_database_cleanup():
    update_job_status("database_cleanup", "running")
    try:
        log.info("Starting database cleanup job...")
        db.cleanup_expired_caches()
        update_job_status("database_cleanup", "success")
    except Exception as e:
        error_msg = str(e)
        log.error("Database cleanup job failed: %s", error_msg)
        update_job_status("database_cleanup", "failed", error_msg)
        db.log_upstox_error("job_database_cleanup", 500, error_msg, "none")

def job_news_sync():
    update_job_status("news_sync", "running")
    try:
        from services.osint_connector import run_247_news_sync
        run_247_news_sync()
        update_job_status("news_sync", "success")
    except Exception as e:
        error_msg = str(e)
        log.error("News sync job failed: %s", error_msg)
        update_job_status("news_sync", "failed", error_msg)

def job_parquet_archive():

    update_job_status("parquet_archive", "running")
    try:
        from services.parquet_archiver import run_daily_archive
        symbols = get_fno_symbols()
        indices = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"]
        all_symbols = indices + [s for s in symbols if s not in indices]
        
        log.info("Starting bulk nightly Parquet pre-fetch and archive for %d symbols...", len(all_symbols))
        run_daily_archive(all_symbols)
        
        update_job_status("parquet_archive", "success")
    except Exception as e:
        error_msg = str(e)
        log.error("Parquet archiving job failed: %s", error_msg)
        update_job_status("parquet_archive", "failed", error_msg)


def get_scheduler_jobs_status() -> dict:
    global scheduler, job_execution_history
    result = {}
    for job_id, history in job_execution_history.items():
        next_run = None
        if scheduler:
            job = scheduler.get_job(job_id)
            if job and job.next_run_time:
                next_run = job.next_run_time.isoformat()
        result[job_id] = {
            "last_run": history["last_run"],
            "status": history["status"],
            "error": history["error"],
            "next_run": next_run
        }
    return result

def _check_token_health():
    """Task 2A: Proactive morning 8:45 AM token validity check."""
    log.info("[TOKEN HEALTH] Running proactive morning token health check...")
    try:
        profile = upstox_client.get_profile()
        if profile and profile.get("status") == "success":
            log.info("[TOKEN HEALTH] ✅ Upstox access token is valid and fresh.")
        else:
            log.warning("[TOKEN HEALTH] ⚠️ Upstox token appears expired or invalid. Please re-authenticate before market open.")
    except Exception as e:
        log.error(f"[TOKEN HEALTH] ❌ Token health check error: {e}")

def _check_secrets_warden():
    """Task B5: Proactive morning 8:30 AM secrets expiry audit."""
    try:
        from services.secrets_warden import secrets_warden
        secrets_warden.run_scheduled_audit()
    except Exception as e:
        log.error(f"[SECRETS WARDEN] Scheduled audit error: {e}")

def init_scheduler():
    global scheduler
    scheduler = BackgroundScheduler(timezone="Asia/Kolkata")

    scheduler.add_job(
        _check_secrets_warden,
        trigger=CronTrigger(day_of_week="mon-fri", hour=8, minute=30),
        id="secrets_warden_audit",
        name="Secrets Expiry & Security Audit Warden"
    )

    scheduler.add_job(
        _check_token_health,
        trigger=CronTrigger(day_of_week="mon-fri", hour=8, minute=45),
        id="token_health_check",
        name="Proactive Morning Upstox Token Health Check"
    )
    
    scheduler.add_job(
        job_bulk_volume_avg,
        trigger=CronTrigger(day_of_week="mon-fri", hour=9, minute=0),
        id="bulk_volume_avg",
        name="Refresh 20-Day Volume Averages"
    )
    
    scheduler.add_job(
        job_instrument_sync,
        trigger=CronTrigger(hour=9, minute=10),
        id="instrument_sync",
        name="Sync Upstox Instrument Master"
    )
    
    scheduler.add_job(
        job_ohlc_cache,
        trigger=CronTrigger(day_of_week="mon-fri", hour=15, minute=45),
        id="ohlc_cache",
        name="Pre-cache F&O Quotes"
    )
    
    scheduler.add_job(
        job_fii_dii_sync,
        trigger=CronTrigger(day_of_week="mon-fri", hour=18, minute=30),
        id="fii_dii_sync",
        name="Sync Institutional FII/DII Flows"
    )
    
    scheduler.add_job(
        job_fundamentals_refresh,
        trigger=CronTrigger(day_of_week="sun", hour=10, minute=0),
        id="fundamentals_refresh",
        name="Weekly Fundamentals Refresh"
    )
    
    scheduler.add_job(
        job_database_cleanup,
        trigger=CronTrigger(hour=0, minute=5),
        id="database_cleanup",
        name="Daily Database Cache Cleanup"
    )
    
    scheduler.add_job(
        job_parquet_archive,
        trigger=CronTrigger(day_of_week="mon-fri", hour=16, minute=0),
        id="parquet_archive",
        name="Daily Post-Market Parquet Archiver"
    )
    
    scheduler.add_job(
        job_news_sync,
        trigger="interval",
        minutes=5,
        id="news_sync",
        name="24/7 OSINT and News Sync"
    )

    try:
        from telemetry import flush_telemetry_snapshot
        scheduler.add_job(
            flush_telemetry_snapshot,
            trigger="interval",
            minutes=15,
            id="telemetry_snapshot_flush",
            name="15m Telemetry Snapshot SQLite Flush"
        )
    except Exception as e:
        log.warning(f"Could not add telemetry_snapshot_flush job: {e}")
    
    scheduler.start()
    log.info("APScheduler background jobs scheduler started.")




# ─────────────────────────────────────────────────────────────────────
# eCAS parsing (casparser integration, CC51)
# v1: CAMS / KFintech eCAS only. NSDL / CDSL return a friendly error.
# ─────────────────────────────────────────────────────────────────────

class CASUnreadableError(RuntimeError):
    """casparser could not parse the eCAS PDF (re-printed, corrupted, wrong format)."""
    pass


class CASWrongPasswordError(RuntimeError):
    """eCAS PDF password is wrong (e.g. PAN changed or user mistyped)."""
    pass


class CASIntegrityError_(RuntimeError):
    """eCAS PDF is corrupt / incomplete / header parse failed."""
    pass


class NSDLNotSupportedError(RuntimeError):
    """NSDL / CDSL CAS detected. v1 supports CAMS / KFintech only."""
    pass


class CASParserUnavailableError(RuntimeError):
    """casparser package is not installed on the bridge host."""
    pass


def _import_casparser():
    """Lazy import so the rest of the bridge works without casparser installed."""
    try:
        import casparser
        return casparser
    except ImportError as e:
        raise CASParserUnavailableError(
            "casparser is not installed. Run: .venv/Scripts/python.exe -m pip install casparser>=1.1.0"
        ) from e


# casparser v1.1.0 puts the exception classes in the `exceptions` submodule,
# not at the top level. Import them here as module-level names so the
# `except` clauses in parse_cas_pdf can reference them by short name AND
# other modules / tests can patch them if needed.
# Wrapped in try/except so this module still loads if casparser is missing.
try:
    from casparser.exceptions import (
        CASParseError as _CASParseError,
        IncorrectPasswordError as _IncorrectPasswordError,
        CASIntegrityError as _CASIntegrityError,
        HeaderParseError as _HeaderParseError,
        IncompleteCASError as _IncompleteCASError,
        ParserException as _ParserException,
    )
except ImportError:
    # casparser not installed; the helper will raise CASParserUnavailableError
    # at call time. Stub the names so the rest of this module compiles.
    class _CASParseError(Exception):  # type: ignore[no-redef]
        pass

    class _IncorrectPasswordError(Exception):  # type: ignore[no-redef]
        pass

    class _CASIntegrityError(Exception):  # type: ignore[no-redef]
        pass

    class _HeaderParseError(Exception):  # type: ignore[no-redef]
        pass

    class _IncompleteCASError(Exception):  # type: ignore[no-redef]
        pass

    class _ParserException(Exception):  # type: ignore[no-redef]
        pass


def parse_cas_pdf(fileobj, password: str) -> dict:
    """
    Parse a CAMS / KFintech eCAS PDF (file-like object + PAN password)
    and return a normalized dict matching the EcasParseResult TS type.

    Returns:
        {
            "investorName": str,
            "statementDate": str (ISO date "YYYY-MM-DD" from statement_period.to),
            "warnings": List[str] (from CASData.parse_warnings),
            "folios": [
                {
                    "folio": str,
                    "amc": str,
                    "pan": str | None,
                    "schemes": [
                        {
                            "isin": str | None,
                            "amfiCode": str | None,
                            "name": str,
                            "units": float,
                            "currentValue": float,
                            "nav": float,
                            "navDate": str
                        }
                    ]
                }
            ]
        }

    Raises:
        CASParserUnavailableError: casparser not installed
        CASUnreadableError:         PDF is re-printed, corrupted, or wrong format
        CASWrongPasswordError:      PAN password is wrong
        CASIntegrityError_:         CASIntegrityError / HeaderParseError / IncompleteCASError
        NSDLNotSupportedError:      NSDL / CDSL CAS (v1 supports CAMS / KFintech only)
    """
    casparser = _import_casparser()
    try:
        result = casparser.read_cas_pdf(fileobj, password or "", output="dict")
    except _CASParseError as e:
        raise CASUnreadableError(
            f"eCAS unreadable: {e}. Use the original PDF from your email, not a re-print."
        ) from e
    except _IncorrectPasswordError as e:
        raise CASWrongPasswordError(
            "Wrong PAN — the eCAS PDF is password-protected with your PAN. Try the new one."
        ) from e
    except (
        _CASIntegrityError,
        _HeaderParseError,
        _IncompleteCASError,
        _ParserException,
    ) as e:
        raise CASIntegrityError_(
            "This eCAS appears corrupted or incomplete — try downloading a fresh copy."
        ) from e

    # casparser v1.1.0 returns Pydantic v2 BaseModel. Use model_dump() to get a plain dict.
    data = result.model_dump() if hasattr(result, "model_dump") else dict(result)

    # NSDLCASData has 'accounts', CASData has 'folios'. v1 supports CASData only.
    if "accounts" in data and "folios" not in data:
        # CC55: friendlier error message — explain why and what's supported.
        # v1 still rejects NSDL/CDSL; future CC can extend the parser to flatten
        # `accounts[*].folios[*].schemes` into the same shape.
        depository = "NSDL" if any(a.get("depository") == "NSDL" for a in data.get("accounts", [])) else "CDSL"
        raise NSDLNotSupportedError(
            f"{depository} eCAS detected (the PDF lists 'accounts' instead of 'folios'). "
            f"v1 supports CAMS / KFintech eCAS only. Workaround: request a CAMS or KFintech "
            f"consolidated statement from your AMC, or use the CDSL/NSDL online portal directly. "
            f"Future versions will support {depository} natively."
        )

    folios_out = []
    for f in data.get("folios") or []:
        schemes_out = []
        for s in f.get("schemes") or []:
            v = s.get("valuation") or {}
            schemes_out.append({
                "isin": s.get("isin"),
                "amfiCode": s.get("amfi"),
                "name": s.get("scheme") or "(unnamed scheme)",
                "units": float(s.get("close") or 0),
                "currentValue": float(v.get("value") or 0),
                "nav": float(v.get("nav") or 0),
                "navDate": str(v.get("date") or ""),
            })
        folios_out.append({
            "folio": f.get("folio") or "",
            "amc": f.get("amc") or "",
            "pan": f.get("PAN"),
            "schemes": schemes_out,
        })

    sp = data.get("statement_period") or {}
    to_date = sp.get("to") or sp.get("from_") or ""

    return {
        "investorName": (data.get("investor_info") or {}).get("name") or "",
        "statementDate": to_date,
        "warnings": data.get("parse_warnings") or [],
        "folios": folios_out,
    }
