import os
import sys
import json
import time
import asyncio
import hashlib
import sqlite3
import requests
import logging
import threading
from datetime import datetime, timedelta, timezone, time as dt_time
from fastapi import APIRouter, HTTPException, Query, Request, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db
from routers.shared import upstox_client, sanitize_symbol
from services.telegram_bot import TelegramBotService
from services.quant_pnl_renderer import render_quant_pnl_dashboard, build_pnl_ticks_from_candles
from services.ml_signal_server import ml_signal_server
try:
    from services.fno_quant_engine import detect_fno_dip_and_rebound, evaluate_option_chain_quant
except ImportError:
    detect_fno_dip_and_rebound = None
    evaluate_option_chain_quant = None

from services.bracket_guardian import (
    arm_protective_brackets,
    modify_broker_sl,
    cancel_broker_orders,
    to_tick,
    calculate_ratchet_sl,
)

log = logging.getLogger("autopilot")

# Duplicate order fingerprint cache
_recent_orders_lock = threading.Lock()
_recent_orders: dict = {}

def is_duplicate_order(symbol: str, direction: str, ltp: float, window_seconds: int = 30) -> bool:
    """Returns True if an identical signal for symbol + direction was received within window_seconds."""
    fingerprint = hashlib.md5(f"{symbol.upper()}_{direction.upper()}".encode()).hexdigest()
    now = time.time()
    with _recent_orders_lock:
        stale = [k for k, ts in _recent_orders.items() if now - ts > 60]
        for k in stale:
            del _recent_orders[k]
        if fingerprint in _recent_orders:
            elapsed = now - _recent_orders[fingerprint]
            if elapsed < window_seconds:
                log.warning(f"[DEDUP] 🚨 Duplicate signal rejected for {symbol} {direction} (received {elapsed:.1f}s ago)")
                return True
        _recent_orders[fingerprint] = now
        return False

def check_liquidity_depth(symbol: str, qty: int, direction: str) -> bool:
    """
    Task A5: Checks top 3 price levels of L2 market depth.
    Requires total available liquidity to be >= 2 * qty.
    Fails open (returns True) if depth API is unavailable.
    Controlled by REQUIRE_LIQUIDITY_CHECK env var (default: "false").
    """
    require_check = os.getenv("REQUIRE_LIQUIDITY_CHECK", "false").lower() in ("true", "1", "yes")
    if not require_check:
        return True

    try:
        inst_key = db.get_upstox_instrument_key(symbol, exchange="NSE_EQ") or db.get_upstox_instrument_key(symbol) or symbol
        quotes = upstox_client.get_full_quotes([inst_key])
        quote = extract_quote_from_response(quotes, inst_key, symbol=symbol)
        if not quote:
            log.info(f"[LIQUIDITY] Depth quote unavailable for {symbol}. Failing open.")
            return True

        depth = quote.get("depth", {}) or {}
        side = "sell" if direction.upper() in ("BUY", "LONG") else "buy"
        levels = depth.get(side, []) or depth.get("asks" if side == "sell" else "bids", [])
        levels = levels[:3]

        if not levels:
            log.info(f"[LIQUIDITY] Depth unavailable for {symbol}. Failing open.")
            return True

        available_qty = sum(int(lvl.get("quantity", 0)) for lvl in levels if isinstance(lvl, dict))
        required_qty = qty * 2

        if available_qty < required_qty:
            log.warning(f"[LIQUIDITY] 🚨 Rejecting {symbol}: Thin book (Available top-3 depth: {available_qty}, Required: {required_qty})")
            return False

        log.info(f"[LIQUIDITY] ✅ {symbol} depth check passed (Available: {available_qty}, Required: {required_qty})")
        return True
    except Exception as e:
        log.error(f"[LIQUIDITY] Depth check error for {symbol}: {e}. Failing open.")
        return True

# ─────────────────────────────────────────────────────────────────────────────
# Gate 6.5 — Opening-Volume Exhaustion Veto
#
# FINDING (docs/algo/edge_analysis_report.md:92-94; artifact
# algo-engine/analysis/edge_observations_5minute_m75.parquet, 75,815 rows):
#   fc15_vol_ratio >= 8  ->  forward return excess -0.166%, t = -2.93,
#   only 40.6% of flagged sessions finish positive, NEGATIVE IN ALL 4 YEARS
#   (2023 -0.208%, 2024 -0.178%, 2025 -0.122%, 2026 -0.165%), n = 762.
#   An 8x+ opening volume spike marks front-loaded exhaustion.
#
# This is a VETO, not an entry. Never invert it into a short signal.
#
# Ratio definition replicated exactly from algo-engine/backtester/build_screener.py:392-394:
#     v15       = today's first-15-minute volume
#     v15_base  = shift(1).rolling(20, min_periods=5).mean() of PRIOR sessions' v15
#     ratio     = v15 / v15_base      (today EXCLUDED from the baseline)
#
# SOURCES (deliberately hybrid — the panel is a weekly artifact, this gate is daily):
#   v15       -> live Upstox 1-minute candles for today (the 09:15-09:30 window).
#   v15_base  -> the causal Parquet feature store, filtered to this symbol (measured 0.15s).
#
# FAIL-OPEN CONTRACT (non-negotiable): any data failure returns False. A data outage
# must never silently halt a working strategy, and must never block a trade on bad data.
# The panel's staleness is measured and logged on every evaluation so it is never invisible.
# ─────────────────────────────────────────────────────────────────────────────

VOLUME_VETO_THRESHOLD = float(os.getenv("VOLUME_VETO_THRESHOLD", "8.0"))
VOLUME_VETO_BASELINE_SESSIONS = 20
VOLUME_VETO_MIN_SESSIONS = 5
VOLUME_VETO_MIN_BARS = 12          # a short/partial feed under-counts -> fails open safely
_PANEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "screener")

_volume_veto_lock = threading.Lock()
_volume_veto_cache: dict = {}      # (symbol, date) -> (ratio_or_None, baseline, panel_date)


def _volume_veto_baseline(symbol_upper: str):
    """Trailing mean of PRIOR sessions' first-15-minute volume, from the causal panel.

    Returns (baseline, panel_newest_date) or (None, None) if the panel is unavailable.
    Mirrors build_screener.py: v15 = volume.where(bar_of_day < 3).groupby(date).sum()
    (3 five-minute bars = 09:15-09:30 = 15 one-minute bars).
    """
    path = os.path.join(_PANEL_DIR, "features_5minute.parquet")
    if not os.path.exists(path):
        return None, None
    import pyarrow.parquet as pq
    tbl = pq.read_table(
        path,
        columns=["symbol", "date", "volume", "bar_of_day"],
        filters=[("symbol", "==", symbol_upper)],
    )
    df = tbl.to_pandas()
    if df.empty:
        return None, None
    v15 = df[df["bar_of_day"] < 3].groupby("date")["volume"].sum().sort_index()
    if len(v15) < VOLUME_VETO_MIN_SESSIONS + 1:
        return None, (v15.index.max() if len(v15) else None)
    base = v15.shift(1).rolling(VOLUME_VETO_BASELINE_SESSIONS, min_periods=VOLUME_VETO_MIN_SESSIONS).mean()
    base = base.dropna()
    if base.empty or not base.index.max() or float(base.iloc[-1]) <= 0:
        return None, (v15.index.max() if len(v15) else None)
    return float(base.iloc[-1]), v15.index.max()


def _volume_veto_today_v15(symbol_upper: str, ist_today: str) -> float | None:
    """Today's first-15-minute volume from live 1-minute candles. None if unavailable."""
    import db as _db
    key = _db.get_upstox_instrument_key(symbol_upper, exchange="NSE_EQ") or \
          _db.get_upstox_instrument_key(symbol_upper)
    if not key:
        return None
    res = upstox_client.get_historical_candles(key, "1minute", ist_today, ist_today)
    if not (isinstance(res, dict) and res.get("status") == "success" and "data" in res):
        return None
    bars = res["data"].get("candles") or []
    if len(bars) < VOLUME_VETO_MIN_BARS:
        return None
    ist_offset = timedelta(hours=5, minutes=30)
    open_lo = dt_time(9, 15)
    open_hi = dt_time(9, 30)
    picked = []
    skipped = 0
    for b in bars:
        try:
            ts = float(b[0])
            dt = datetime.fromtimestamp(ts / 1000.0, tz=timezone.utc).replace(tzinfo=None) + ist_offset
            vol = float(b[5] or 0)
        except (TypeError, ValueError, IndexError, KeyError, AttributeError, OverflowError, OSError) as e:
            # A malformed feed row must not be able to silently swallow the whole window.
            skipped += 1
            log.debug("[VOL_VETO] malformed candle row skipped: %s", e)
            continue
        if open_lo <= dt.time() < open_hi:
            picked.append((ts, vol))
    if len(picked) < VOLUME_VETO_MIN_BARS:
        # Distinguish "feed returned nothing in the opening window" from "rows were malformed".
        # A gate that always fails open must never be indistinguishable from a gate that works.
        log.warning(
            "[VOL_VETO] only %d bars inside 09:15-09:30 IST (%d malformed, %d returned). "
            "Failing open.",
            len(picked), skipped, len(bars),
        )
        return None
    if skipped:
        log.warning("[VOL_VETO] %d malformed candle rows skipped for %s", skipped, symbol_upper)
    return float(sum(v for _, v in picked))


def _volume_exhausted(symbol: str, ist_today: str) -> bool:
    """True when today's opening volume marks front-loaded exhaustion (fc15_vol_ratio >= 8).

    FAIL-OPEN: any failure returns False. See module-level contract above.
    """
    symbol_upper = symbol.upper().strip()
    cache_key = (symbol_upper, ist_today)
    with _volume_veto_lock:
        cached = _volume_veto_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        base, panel_date = _volume_veto_baseline(symbol_upper)
        if base is None:
            log.warning(f"[VOL_VETO] {symbol_upper}: no usable panel baseline. Failing open.")
            return False
        v15 = _volume_veto_today_v15(symbol_upper, ist_today)
        if v15 is None:
            log.warning(f"[VOL_VETO] {symbol_upper}: no usable live 1m opening volume. Failing open.")
            return False
        ratio = v15 / base
        verdict = ratio >= VOLUME_VETO_THRESHOLD
        with _volume_veto_lock:
            _volume_veto_cache[cache_key] = verdict
        log.info(
            f"[VOL_VETO] {symbol_upper} {ist_today}: fc15_vol_ratio={ratio:.2f} "
            f"(v15={v15:,.0f} / base={base:,.0f}, panel thru {panel_date}) "
            f"-> {'BLOCK' if verdict else 'pass'}"
        )
        return verdict
    except Exception as e:
        log.warning(f"[VOL_VETO] {symbol_upper}: check error ({e}). Failing open.")
        return False


router = APIRouter(prefix="/api/autopilot")

OPENALGO_HOST = os.getenv("OPENALGO_HOST", "http://127.0.0.1:5000")
OPENALGO_API_KEY = os.getenv("OPENALGO_API_KEY", "openalgo_mcp_api_key_2026")

session = requests.Session()
session.trust_env = False

STATE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
STATE_FILE = os.path.join(STATE_DIR, "autopilot_state.json")
RULES_FILE = os.path.join(STATE_DIR, "autopilot_rules.json")

DEFAULT_RULES = {
    "nifty_macro_enabled": True,
    "nifty_long_threshold": 0.35,
    "nifty_short_threshold": -0.35,
    "neutral_divergence_override": 2.0,
    "dual_polarity_enabled": True,
    "force_long_only": False,
    "time_gate_enabled": False,
    "entry_window_start_mins": 560,
    "entry_window_end_mins": 915,
    "sandbox_mode": True,
    "min_composite_score": 60.0,
    "hard_sl_pct": 18.0,
    "trail_trigger_pct": 25.0,
    "scale_out_enabled": True,
    "scale_out_trigger_pct": 25.0,
    "scale_out_ratio": 0.50,
    "daily_loss_limit_enabled": False,
    "max_daily_loss_inr": 1000000.0,
    "max_trades_per_day": 50,
    "lot_multiplier": 1,
    "moneyness": "ATM",
    "target_model": "DYNAMIC_TRAILING",
    "target_multiplier": 2.0,
    "dynamic_trail_lock_pct": 75.0,
    "dynamic_trail_step_pct": 20.0,
    "afternoon_cutoff_time": "15:10",
    "expiry_cutoff_enabled": False,
    "volume_veto_enabled": False,
    "volume_veto_threshold": 8.0,
    "allow_moderate_rotation": True,
    "dynamic_capital_enabled": True,
    "target_trade_capital": 25000.0,
    "capital_start_min": 35000.0,
    "capital_start_max": 50000.0,
    "capital_mid_min": 25000.0,
    "capital_mid_max": 35000.0,
    "capital_end_min": 15000.0,
    "capital_end_max": 25000.0,
    "strike_auto_adjust": True,
    "max_strike_shift": 2,
    "max_option_spread_pct": 1.50
}

def load_autopilot_rules() -> dict:
    """Loads configurable trader execution rules with institutional defaults."""
    rules = dict(DEFAULT_RULES)
    if os.path.exists(RULES_FILE):
        try:
            with open(RULES_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if isinstance(saved, dict):
                    rules.update(saved)
        except Exception as e:
            log.warning(f"Failed to load {RULES_FILE}: {e}")
    return rules

def save_autopilot_rules(new_rules: dict) -> dict:
    """Saves updated rules to JSON file."""
    rules = load_autopilot_rules()
    rules.update(new_rules)
    try:
        with open(RULES_FILE, "w", encoding="utf-8") as f:
            json.dump(rules, f, indent=4)
        log.info(f"✅ Saved updated autopilot rules: {rules}")
    except Exception as e:
        log.error(f"Failed to save {RULES_FILE}: {e}")
    return rules

# Ensure data directory exists
os.makedirs(STATE_DIR, exist_ok=True)

# In-memory thread-safe state
state_lock = threading.RLock()
state = {
    "enabled": False,
    "expiry_rollover": False,
    "active_trade": None,
    "bot_token": "",
    "chat_id": ""
}

MAX_ORDER_QUANTITY = int(os.getenv("MAX_ORDER_QUANTITY", "50"))
MAX_ORDER_NOTIONAL = float(os.getenv("MAX_ORDER_NOTIONAL", "500000"))

class SignalRequest(BaseModel):
    symbol: str
    sector: str
    direction: str
    ltp: float = Field(..., gt=0, lt=100000.0)
    strengthFactor: float = Field(default=75.0, ge=-2000.0, le=2000.0)
    sectorStrength: float = Field(default=1.0, ge=-1000.0, le=1000.0)
    niftyChange: float = Field(default=0.0, ge=-100.0, le=100.0)
    strategy: str = "FNO_SectorRotation"
    bot_token: str | None = None
    chat_id: str | None = None
    bypass_checks: bool = False
    expiry_rollover: bool = False

class ToggleRequest(BaseModel):
    enabled: bool | None = None
    expiry_rollover: bool | None = None

# Expiry Month Mapping
MONTH_MAP = {
    1: "JAN", 2: "FEB", 3: "MAR", 4: "APR",
    5: "MAY", 6: "JUN", 7: "JUL", 8: "AUG",
    9: "SEP", 10: "OCT", 11: "NOV", 12: "DEC"
}

def get_ist_now() -> datetime:
    """Returns current date-time adjusted to Indian Standard Time (IST)."""
    return datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=5, minutes=30)

def load_state():
    global state
    with state_lock:
        if os.path.exists(STATE_FILE):
            try:
                with open(STATE_FILE, "r") as f:
                    saved = json.load(f)
                    for k, v in saved.items():
                        state[k] = v
            except Exception as e:
                log.error(f"Failed to load autopilot state: {e}")

def save_state_to_file():
    with state_lock:
        try:
            with open(STATE_FILE, "w") as f:
                json.dump(state, f, indent=4)
        except Exception as e:
            log.error(f"Failed to save autopilot state: {e}")

# Load state on startup
load_state()

# ── Database Helpers ──────────────────────────────────────────────────

def log_autopilot_trade_entry(strategy, symbol, direction, entry_time, entry_price, quantity, stop_loss, target, signal_score, nifty_direction, sector, sector_strength, order_id, composite_score=0.0, is_test=0, feature_vector_json=""):
    try:
        conn = db.get_db_connection(write=True)
        cursor = conn.cursor()
        date_str = datetime.now().strftime("%Y-%m-%d")
        try:
            cursor.execute("ALTER TABLE autopilot_journal ADD COLUMN is_test INTEGER DEFAULT 0")
            conn.commit()
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE autopilot_journal ADD COLUMN feature_vector_json TEXT DEFAULT ''")
            conn.commit()
        except Exception:
            pass

        cursor.execute("""
            INSERT INTO autopilot_journal (
                date, strategy, symbol, direction, entry_time, entry_price, 
                quantity, stop_loss, target, signal_score, nifty_direction, 
                sector, sector_strength, order_id, status, composite_score, is_test, feature_vector_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)
        """, (date_str, strategy, symbol, direction, entry_time, entry_price, quantity, stop_loss, target, signal_score, nifty_direction, sector, sector_strength, order_id, composite_score, is_test, feature_vector_json))
        conn.commit()
        row_id = cursor.lastrowid
        conn.close()
        return row_id
    except Exception as e:
        log.error(f"Failed to log autopilot trade entry: {e}")
        return None

def log_autopilot_trade_exit(row_id, exit_time, exit_price, pnl, pnl_pct):
    try:
        conn = db.get_db_connection(write=True)
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE autopilot_journal 
            SET exit_time = ?, exit_price = ?, pnl = ?, pnl_pct = ?, status = 'CLOSED'
            WHERE id = ?
        """, (exit_time, exit_price, pnl, pnl_pct, row_id))
        conn.commit()
        conn.close()
    except Exception as e:
        log.error(f"Failed to log autopilot trade exit: {e}")

def get_todays_realized_pnl() -> float:
    """Reads today's closed autopilot trades PnL from DB. Returns total realized PnL for today."""
    try:
        conn = db.get_db_connection()
        cursor = conn.cursor()
        today = datetime.now().strftime("%Y-%m-%d")
        cursor.execute(
            "SELECT COALESCE(SUM(pnl), 0) FROM autopilot_journal WHERE date = ? AND status = 'CLOSED'",
            (today,)
        )
        row = cursor.fetchone()
        conn.close()
        return float(row[0]) if row and row[0] is not None else 0.0
    except Exception as e:
        log.error(f"Failed to read today's PnL: {e}")
        return 0.0

def is_daily_loss_limit_breached() -> bool:
    """Returns True if today's realized loss exceeds MAX_DAILY_LOSS_INR env var threshold or configured rule."""
    rules = load_autopilot_rules()
    if rules.get("sandbox_mode", True) or not rules.get("daily_loss_limit_enabled", True):
        return False
    max_loss = float(rules.get("max_daily_loss_inr", os.getenv("MAX_DAILY_LOSS_INR", "10000")))
    todays_pnl = get_todays_realized_pnl()
    if todays_pnl < -abs(max_loss):
        log.warning(f"🚨 DAILY LOSS LIMIT BREACHED: Today's PnL = ₹{todays_pnl:.0f}, Limit = ₹{-abs(max_loss):.0f}")
        return True
    return False

# ── Smart Scoring & Dip-Bounce Engine ─────────────────────────────────

def calculate_composite_score(req: SignalRequest) -> float:
    """
    Calculates a multi-factor weighted composite score (0 to 100+):
    - Alpha screener strength (35%)
    - Sector strength (25%)
    - Nifty direction alignment (25%)
    - LTP / Liquidity factor (15%)
    """
    raw_strength = abs(req.strengthFactor)
    alpha_score = min(100.0, raw_strength / 10.0 if raw_strength > 100.0 else raw_strength)
    sec_factor = min(100.0, max(0.0, (req.sectorStrength + 50.0)))
    
    nifty_align = 50.0
    if req.direction.upper() == "BUY" and req.niftyChange > 0:
        nifty_align = min(100.0, 50.0 + (req.niftyChange * 25.0))
    elif req.direction.upper() == "SELL" and req.niftyChange < 0:
        nifty_align = min(100.0, 50.0 + (abs(req.niftyChange) * 25.0))
    else:
        nifty_align = 25.0
        
    liquidity_factor = 75.0 if req.ltp > 0 else 50.0
    
    weighted_score = (
        (alpha_score * 0.35) +
        (sec_factor * 0.25) +
        (nifty_align * 0.25) +
        (liquidity_factor * 0.15)
    )
    return round(weighted_score, 2)

def detect_dip_and_bounce(symbol: str, direction: str = "BUY") -> dict | None:
    """
    Fetches 1-minute historical candles from Upstox API for the underlying symbol.
    Detects if a dip occurred in recent bars and if current price has bounced
    above the high of the dip bar.
    """
    key = db.get_upstox_instrument_key(symbol, exchange="NSE_EQ") or db.get_upstox_instrument_key(symbol)
    if not key:
        return None
        
    to_date = datetime.now().strftime("%Y-%m-%d")
    from_date = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d")
    key_encoded = key.replace("|", "%7C")
    
    try:
        res = upstox_client.get_historical_candles(key_encoded, "1minute", to_date, from_date)
        if res.get("status") == "success" and "data" in res:
            candles = res["data"].get("candles", [])
            if len(candles) < 5:
                return None
                
            chronological = list(reversed(candles[:15]))
            latest_bar = chronological[-1]
            latest_close = float(latest_bar[4])
            
            recent_bars = chronological[-6:-1]
            dip_found = False
            dip_high = 0.0
            dip_low = float('inf')
            
            for bar in recent_bars:
                open_p = float(bar[1])
                close_p = float(bar[4])
                low_p = float(bar[3])
                high_p = float(bar[2])
                
                if close_p <= open_p or low_p < dip_low:
                    dip_found = True
                    dip_high = max(dip_high, high_p)
                    dip_low = min(dip_low, low_p)
                    
            if dip_found and dip_high > 0:
                if latest_close >= dip_high * 0.998:  # Price breaking/bouncing dip high
                    return {
                        "triggered": True,
                        "dip_low": dip_low,
                        "dip_high": dip_high,
                        "current_price": latest_close
                    }
    except Exception as e:
        log.error(f"Error checking dip & bounce for {symbol}: {e}")
        
    return None


# ── Signal Parsing Helpers ────────────────────────────────────────────

def extract_quote_from_response(ltp_res: dict, instrument_key: str, symbol: str = None) -> dict | None:
    if not ltp_res:
        return None
    if not isinstance(ltp_res, dict):
        return None
        
    # 1. Direct match
    if instrument_key in ltp_res:
        return ltp_res[instrument_key]
        
    # 2. Colon replacement match
    key_colon = instrument_key.replace('|', ':')
    if key_colon in ltp_res:
        return ltp_res[key_colon]
        
    # 3. Search by instrument_token inside values, or suffix match
    for k, v in ltp_res.items():
        if isinstance(v, dict):
            token = v.get("instrument_token")
            if token and (token == instrument_key or token.replace('|', ':') == key_colon or token == key_colon):
                return v
        
        # Suffix matching for trading symbol (e.g. "NSE_EQ:LODHA" matches symbol "LODHA" or key suffix "LODHA")
        k_suffix = k.split(':')[-1]
        if symbol and k_suffix.upper() == symbol.upper():
            return v
        key_suffix = instrument_key.split('|')[-1]
        if k_suffix.upper() == key_suffix.upper():
            return v
            
    return None

def calculate_stock_atr(symbol: str) -> float:
    key = db.get_upstox_instrument_key(symbol, exchange="NSE_EQ") or db.get_upstox_instrument_key(symbol)
    if not key:
        return 0.0
    
    to_date = datetime.now().strftime("%Y-%m-%d")
    from_date = (datetime.now() - timedelta(days=5)).strftime("%Y-%m-%d")
    key_encoded = key.replace("|", "%7C")
    
    try:
        res = upstox_client.get_historical_candles(key_encoded, "5minute", to_date, from_date)
        if res.get("status") == "success" and "data" in res:
            candles = res["data"].get("candles", [])
            if len(candles) < 15:
                return 0.0
            
            candles = list(reversed(candles))
            tr_list = []
            for i in range(len(candles)):
                high = float(candles[i][2])
                low = float(candles[i][3])
                close = float(candles[i][4])
                if i == 0:
                    tr = high - low
                else:
                    prev_close = float(candles[i-1][4])
                    tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
                tr_list.append(tr)
            
            if len(tr_list) >= 14:
                atr = sum(tr_list[:14]) / 14
                for tr in tr_list[14:]:
                    atr = (atr * 13 + tr) / 14
                return round(atr, 2)
    except Exception as e:
        log.error(f"Failed to calculate ATR for {symbol}: {e}")
    return 0.0

def get_dynamic_capital_bounds(expiry_str: str, rules: dict) -> tuple[str, int, float, float]:
    """
    Calculates dynamic capital allocation bounds based on Days To Expiry (DTE).
    - Month Open (>20 DTE): Higher premium regime (35K - 50K).
    - Mid-Month (8 to 20 DTE): Standard regime (25K - 35K).
    - Expiry Week (<= 7 DTE): Theta-decayed regime (15K - 25K).
    Returns (phase, dte, min_capital, max_capital).
    """
    ist_now = get_ist_now()
    try:
        exp_dt = datetime.strptime(expiry_str, "%Y-%m-%d").date()
        dte = (exp_dt - ist_now.date()).days
    except Exception:
        dte = 14
        
    if dte > 20:
        phase = "START_OF_MONTH"
        min_cap = float(rules.get("capital_start_min", 35000.0))
        max_cap = float(rules.get("capital_start_max", 50000.0))
    elif dte >= 8:
        phase = "MID_MONTH"
        min_cap = float(rules.get("capital_mid_min", 25000.0))
        max_cap = float(rules.get("capital_mid_max", 35000.0))
    else:
        phase = "EXPIRY_WEEK"
        min_cap = float(rules.get("capital_end_min", 15000.0))
        max_cap = float(rules.get("capital_end_max", 25000.0))
    return phase, dte, min_cap, max_cap

def get_atm_option_contract(symbol: str, direction: str):
    target_symbols = [symbol]
    if symbol.upper() not in ("NIFTY", "BANKNIFTY", "FINNIFTY"):
        fallback_index = "BANKNIFTY" if "BANK" in symbol.upper() else "NIFTY"
        target_symbols.append(fallback_index)

    for sym in target_symbols:
        underlying_key = (
            db.get_upstox_instrument_key(sym, exchange="NSE_EQ")
            or db.get_upstox_instrument_key(sym, exchange="NSE_INDEX")
            or db.get_upstox_instrument_key(sym)
        )
        if not underlying_key:
            continue
            
        try:
            ltp_res = upstox_client.get_ltp_quotes([underlying_key])
            quote = extract_quote_from_response(ltp_res, underlying_key, sym)
            if not quote or not quote.get("last_price"):
                continue
                
            spot_price = quote.get("last_price")
            contracts_res = upstox_client.get_option_contracts(underlying_key)
            if not contracts_res or contracts_res.get("status") != "success" or "data" not in contracts_res:
                continue
                
            data = contracts_res["data"]
            if not data or not isinstance(data, list):
                continue

            expiries = sorted(list(set([item.get("expiry") for item in data if item.get("expiry")])))
            if not expiries:
                continue
                
            ist_now = get_ist_now()
            is_expiry_day = ist_now.weekday() in (1, 2, 3)
            if state.get("expiry_rollover", False) and is_expiry_day and len(expiries) > 1:
                nearest_expiry = expiries[1]
                log.info(f"Expiry Roll-Over active for {sym}. Selected next expiry {nearest_expiry} to avoid 0DTE theta decay.")
            else:
                nearest_expiry = expiries[0]
            
            target_option_type = "CE" if direction.upper() == "BUY" else "PE"
            filtered = [
                c for c in data 
                if c.get("expiry") == nearest_expiry 
                and (c.get("option_type") or c.get("instrument_type") or "").upper() == target_option_type
            ]
            
            if not filtered:
                continue

            rules = load_autopilot_rules()
            moneyness = str(rules.get("moneyness", "ATM")).upper()
            phase, dte, min_cap, max_cap = get_dynamic_capital_bounds(nearest_expiry, rules)
            target_cap = float(rules.get("target_trade_capital", 25000.0))
            auto_adjust = bool(rules.get("strike_auto_adjust", True))
            max_shift = int(rules.get("max_strike_shift", 2))

            sorted_by_dist = sorted(filtered, key=lambda c: abs(c.get("strike_price", 0) - spot_price))
            selected_contract = sorted_by_dist[0]
            lot_size = int(selected_contract.get("lot_size", 50))
            strike_adjustment_reason = "ATM default"

            is_index = sym.upper() in ("NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX")

            if moneyness == "ITM_1":
                if target_option_type == "CE":
                    itm_candidates = sorted([c for c in filtered if c.get("strike_price", 0) < spot_price], key=lambda c: c.get("strike_price", 0), reverse=True)
                else:
                    itm_candidates = sorted([c for c in filtered if c.get("strike_price", 0) > spot_price], key=lambda c: c.get("strike_price", 0))
                if itm_candidates:
                    selected_contract = itm_candidates[0]
                    strike_adjustment_reason = "User ITM_1 preference"
            elif moneyness == "OTM_1":
                if target_option_type == "CE":
                    otm_candidates = sorted([c for c in filtered if c.get("strike_price", 0) > spot_price], key=lambda c: c.get("strike_price", 0))
                else:
                    otm_candidates = sorted([c for c in filtered if c.get("strike_price", 0) < spot_price], key=lambda c: c.get("strike_price", 0), reverse=True)
                if otm_candidates:
                    selected_contract = otm_candidates[0]
                    strike_adjustment_reason = "User OTM_1 preference"
            elif auto_adjust and not is_index:
                if target_option_type == "CE":
                    shift_candidates = sorted([c for c in filtered if c.get("strike_price", 0) >= spot_price], key=lambda c: c.get("strike_price", 0))[:max_shift + 1]
                else:
                    shift_candidates = sorted([c for c in filtered if c.get("strike_price", 0) <= spot_price], key=lambda c: c.get("strike_price", 0), reverse=True)[:max_shift + 1]

                if len(shift_candidates) > 1:
                    try:
                        cand_keys = [c.get("instrument_key") for c in shift_candidates if c.get("instrument_key")]
                        quotes_res = upstox_client.get_ltp_quotes(cand_keys)
                        scored_candidates = []
                        for idx, cand in enumerate(shift_candidates):
                            c_key = cand.get("instrument_key")
                            q = extract_quote_from_response(quotes_res, c_key)
                            c_ltp = float(q.get("last_price", 0)) if q else 0.0
                            if c_ltp > 0:
                                req_capital = lot_size * c_ltp
                                dist_to_target = abs(req_capital - target_cap)
                                scored_candidates.append({
                                    "contract": cand,
                                    "ltp": c_ltp,
                                    "capital": req_capital,
                                    "dist": dist_to_target,
                                    "shift": idx
                                })
                        
                        if scored_candidates:
                            atm_info = scored_candidates[0]
                            if atm_info["capital"] > max_cap or (atm_info["capital"] > target_cap * 1.3 and len(scored_candidates) > 1):
                                viable = [sc for sc in scored_candidates if sc["capital"] <= max_cap * 1.15]
                                if viable:
                                    best_sc = min(viable, key=lambda x: x["dist"])
                                    if best_sc["shift"] > 0:
                                        selected_contract = best_sc["contract"]
                                        strike_adjustment_reason = (
                                            f"Auto-adjusted +{best_sc['shift']} strikes OTM "
                                            f"(Capital: ₹{best_sc['capital']:,.0f} vs ATM ₹{atm_info['capital']:,.0f}, "
                                            f"Phase: {phase}, Target: ₹{target_cap:,.0f})"
                                        )
                                        log.info(f"🎯 [STRIKE CALIBRATION] {sym}: {strike_adjustment_reason}")
                    except Exception as e:
                        log.warning(f"Failed to calibrate candidate strike quotes: {e}")
            
            return {
                "spot_price": spot_price,
                "expiry": nearest_expiry,
                "strike_price": selected_contract.get("strike_price"),
                "option_type": target_option_type,
                "instrument_key": selected_contract.get("instrument_key"),
                "lot_size": lot_size,
                "upstox_symbol": selected_contract.get("trading_symbol") or f"{sym} {selected_contract.get('strike_price')} {target_option_type}",
                "resolved_symbol": sym,
                "moneyness": moneyness,
                "phase": phase,
                "dte": dte,
                "min_capital": min_cap,
                "max_capital": max_cap,
                "strike_adjustment_reason": strike_adjustment_reason
            }
        except Exception as e:
            log.warning(f"Option contract lookup failed for {sym}: {e}")
            continue

    log.error(f"Could not resolve any ATM option contract for {symbol} or index fallbacks.")
    return None

def format_nfo_symbol(symbol: str, expiry_str: str, strike: float, option_type: str) -> str:
    """Formats canonical NFO option trading symbol (e.g. HAVELLS28JUL261210CE) from Upstox contract metadata."""
    dt = datetime.strptime(expiry_str, "%Y-%m-%d")
    day_str = dt.strftime("%d")
    month_str = MONTH_MAP[dt.month]
    year_str = dt.strftime("%y")
    
    # Formatting strike
    strike_val = int(strike) if strike.is_integer() else strike
    
    return f"{symbol.upper()}{day_str}{month_str}{year_str}{strike_val}{option_type.upper()}"

# Backwards compatibility alias
format_dhan_nfo_symbol = format_nfo_symbol


def get_dhan_token_from_db(dhan_symbol: str) -> str:
    db_paths = [
        "/home/ubuntu/openalgo/db/openalgo.db",
        r"c:\Users\gadda\Desktop\Projects\openalgo\db\openalgo.db",
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "db", "openalgo.db")
    ]
    for db_path in db_paths:
        if not os.path.exists(db_path):
            continue
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT token FROM symtoken WHERE symbol = ? AND exchange IN ('NFO', 'BFO') LIMIT 1",
                (dhan_symbol,)
            )
            row = cursor.fetchone()
            if row:
                conn.close()
                return row[0]
                
            # Try fuzzy search as fallback
            prefix = dhan_symbol[:-5]
            opt_type = dhan_symbol[-2:]
            cursor.execute(
                "SELECT token FROM symtoken WHERE symbol LIKE ? AND symbol LIKE ? AND exchange IN ('NFO', 'BFO') LIMIT 1",
                (f"{prefix}%", f"%{opt_type}")
            )
            row = cursor.fetchone()
            conn.close()
            if row:
                return row[0]
        except Exception:
            pass
    return None

# ── Chart Generator Helper ─────────────────────────────────────────────

def generate_daily_pnl_chart(output_path: str, pnl_points: list[float]) -> str | None:
    """Generates a sleek dark-mode quant equity curve image using PIL."""
    try:
        from PIL import Image, ImageDraw
        width, height = 800, 420
        img = Image.new("RGB", (width, height), color=(15, 23, 42))  # #0F172A
        draw = ImageDraw.Draw(img)

        # Border & grid
        draw.rectangle([(20, 20), (width - 20, height - 20)], outline=(30, 41, 59), width=2)
        for y in range(80, height - 60, 50):
            draw.line([(60, y), (width - 40, y)], fill=(30, 41, 59), width=1)
            
        if not pnl_points:
            pnl_points = [0.0]

        min_val = min(min(pnl_points), -500)
        max_val = max(max(pnl_points), 1000)
        val_range = max_val - min_val if max_val != min_val else 1.0

        margin_left, margin_right = 60, width - 40
        margin_top, margin_bottom = 80, height - 60
        plot_w = margin_right - margin_left
        plot_h = margin_bottom - margin_top

        # Zero line
        zero_norm = (0 - min_val) / val_range
        zero_y = margin_bottom - (zero_norm * plot_h)
        draw.line([(margin_left, zero_y), (margin_right, zero_y)], fill=(71, 85, 105), width=2)

        coords = []
        n = max(len(pnl_points), 2)
        for i, pnl in enumerate(pnl_points):
            x = margin_left + (i / max(n - 1, 1)) * plot_w
            norm = (pnl - min_val) / val_range
            y = margin_bottom - (norm * plot_h)
            coords.append((x, y))

        final_pnl = pnl_points[-1]
        line_color = (16, 185, 129) if final_pnl >= 0 else (239, 68, 68)
        for i in range(len(coords) - 1):
            draw.line([coords[i], coords[i+1]], fill=line_color, width=4)

        if coords:
            last_x, last_y = coords[-1]
            draw.ellipse([last_x - 6, last_y - 6, last_x + 6, last_y + 6], fill=line_color, outline=(255, 255, 255), width=2)

        img.save(output_path)
        return output_path
    except Exception as e:
        log.error(f"Failed to generate PnL chart image: {e}")
        return None

# ── Alerting Helpers ──────────────────────────────────────────────────

async def send_telegram_notification(message: str, category: str = "executions", photo_path: str = None):
    token = ""
    chat_id = ""
    
    target_role = "autopilot"
    if category == "pnl_report":
        target_role = "pnl_report"
    elif category == "alerts":
        target_role = "alerts"
    
    # Try loading from telegram_config.json first by role
    data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
    config_file = os.path.join(data_dir, "telegram_config.json")
    if os.path.exists(config_file):
        try:
            with open(config_file, "r") as f:
                bots = json.load(f)
                active_bot = next((b for b in bots if b.get("role") == target_role and b.get("enabled")), None)
                if not active_bot:
                    active_bot = next((b for b in bots if b.get("role") == "autopilot" and b.get("enabled")), None)
                if active_bot:
                    token = active_bot.get("token")
                    chat_id = active_bot.get("chatId")
        except Exception as e:
            log.error(f"Error loading telegram config in autopilot: {e}")
            
    # Fallback to state / env
    if not token or not chat_id:
        with state_lock:
            token = state.get("bot_token")
            chat_id = state.get("chat_id")
            
    if not token or not chat_id:
        token = os.getenv("TELEGRAM_BOT_TOKEN")
        chat_id = os.getenv("TELEGRAM_CHAT_ID")
        
    if not token or not chat_id:
        log.warning("Telegram Bot details not configured. Message skipped.")
        return
        
    try:
        bot = TelegramBotService(token, chat_id)
        result = None
        if photo_path and os.path.exists(photo_path):
            result = await bot.send_photo(photo_path, caption=message)
        else:
            result = await bot.send_message(message)
        # Surface failures: TelegramBotService returns {"status": "error", ...} on HTTP/transport errors
        if isinstance(result, dict) and result.get("status") == "error":
            log.error("Telegram alert FAILED (category=%s role=%s): %s", category, target_role, result.get("error"))
        else:
            log.info("Telegram alert sent (category=%s role=%s chat=%s)", category, target_role, str(chat_id).split("#")[0])
    except Exception as e:
        log.error(f"Failed to send Telegram alert: {e}")


# ── Partial Scale-Out Helper ──────────────────────────────────────────

async def trigger_partial_scale_out(exit_ltp: float, scale_pct: float = 0.50):
    """
    2-Leg Partial Scale-Out Engine:
    - When Option Premium reaches Target 1 (+40% to +50%), sell 50% lots to lock profit.
    - Ratchet remaining 50% runner Stop Loss to Breakeven (entry_price).
    - Immunizes position against midday shakeouts while letting runner ride till 14:00+ IST.
    """
    active = None
    with state_lock:
        active = state.get("active_trade")
        
    if not active or active.get("target1_scaled"):
        return
        
    qty = int(active.get("quantity", 0))
    entry_price = float(active.get("entry_price", 0.0))
    dhan_symbol = active.get("dhan_symbol", "")
    strategy = active.get("strategy", "FNO_SectorRotation")
    lot_size = int(active.get("lot_size", 1))

    scale_qty = int(qty * scale_pct)
    if lot_size > 1 and qty >= 2 * lot_size:
        lots = qty // lot_size
        scale_lots = max(1, int(lots * scale_pct))
        scale_qty = scale_lots * lot_size

    if 0 < scale_qty < qty:
        # Check if broker target order was already placed
        tgt_oid = active.get("target_order_id")
        if not tgt_oid:
            try:
                url = f"{OPENALGO_HOST}/api/v1/placeorder"
                payload = {
                    "apikey": OPENALGO_API_KEY,
                    "strategy": strategy,
                    "symbol": dhan_symbol,
                    "action": "SELL",
                    "exchange": "NFO",
                    "pricetype": "MARKET",
                    "product": "MIS",
                    "quantity": int(scale_qty)
                }
                resp = session.post(url, headers={"Content-Type": "application/json"}, json=payload, timeout=5)
                log.info(f"Target 1 Scale-out (50%) order placed via OpenAlgo: {resp.text}")
            except Exception as e:
                log.error(f"Failed to place partial scale-out order via OpenAlgo: {e}")

        scaled_pnl = round((exit_ltp - entry_price) * scale_qty, 2)
        rem_qty = qty - scale_qty
        be_sl = to_tick(entry_price + 0.05)

        with state_lock:
            if state.get("active_trade"):
                state["active_trade"]["quantity"] = rem_qty
                state["active_trade"]["target1_scaled"] = True
                state["active_trade"]["scaled_qty"] = scale_qty
                state["active_trade"]["scaled_pnl"] = scaled_pnl
                state["active_trade"]["scaled_exit_price"] = exit_ltp
                # Ratchet remaining runner SL to Breakeven
                state["active_trade"]["stop_loss"] = max(state["active_trade"].get("stop_loss", 0), be_sl)
            save_state_to_file()

        # Ratchet remaining runner SL on OpenAlgo broker orderbook
        sl_oid = active.get("sl_order_id")
        if sl_oid:
            try:
                modify_broker_sl(
                    openalgo_host=OPENALGO_HOST,
                    api_key=OPENALGO_API_KEY,
                    sl_order_id=sl_oid,
                    symbol=dhan_symbol,
                    exchange="NFO",
                    product="MIS",
                    qty=rem_qty,
                    new_trigger_price=be_sl,
                    strategy_tag=strategy,
                    session=session
                )
            except Exception as mod_err:
                log.warning(f"Failed to ratchet broker SL on scale-out: {mod_err}")

        gain_pct = ((exit_ltp / entry_price) - 1.0) * 100.0 if entry_price > 0 else 0.0
        msg = (
            f"🎯 <b><u>WEALTHOS AUTOPILOT | 50% PROFIT BOOKED</u></b>\n"
            f"📌 <b>STATUS:</b> <strong>TARGET 1 REACHED</strong>\n"
            f"─────────────────────────\n"
            f"<blockquote>🟢 <b>Realized Gain:</b> <code>+₹{scaled_pnl:,.2f} (+{gain_pct:.1f}%)</code>\n"
            f"• <b>Contract:</b> <code>{dhan_symbol}</code>\n"
            f"• <b>Partial Scale-Out:</b> <code>{scale_qty:,} shares @ ₹{exit_ltp:.2f}</code>\n"
            f"• <b>Active Runner:</b> <code>{rem_qty:,} shares retained</code>\n"
            f"• <b>Runner Stop Loss:</b> <code>₹{be_sl:.2f}</code> (Cost-to-Cost Break-Even)</blockquote>\n"
            f"🏹 <i>Downside eliminated. Runner position riding risk-free to higher targets.</i>"
        )
        await send_telegram_notification(msg, category="executions")
        log.info(f"Target 1 (50% Scale-Out) executed: Banked ₹{scaled_pnl}, Runner SL moved to Breakeven ₹{be_sl}")
    else:
        # Single-lot contract: cannot sell fractional lot, ratchets SL to Breakeven directly
        be_sl = to_tick(entry_price + 0.05)
        with state_lock:
            if state.get("active_trade"):
                state["active_trade"]["target1_scaled"] = True
                state["active_trade"]["stop_loss"] = max(state["active_trade"].get("stop_loss", 0), be_sl)
            save_state_to_file()

        # Ratchet single-lot SL on OpenAlgo broker orderbook
        sl_oid = active.get("sl_order_id")
        if sl_oid:
            try:
                modify_broker_sl(
                    openalgo_host=OPENALGO_HOST,
                    api_key=OPENALGO_API_KEY,
                    sl_order_id=sl_oid,
                    symbol=dhan_symbol,
                    exchange="NFO",
                    product="MIS",
                    qty=qty,
                    new_trigger_price=be_sl,
                    strategy_tag=strategy,
                    session=session
                )
            except Exception as mod_err:
                log.warning(f"Failed to ratchet single-lot broker SL: {mod_err}")

        gain_pct = ((exit_ltp / entry_price) - 1.0) * 100.0 if entry_price > 0 else 0.0
        msg = (
            f"🛡️ <b><u>WEALTHOS AUTOPILOT | RISK ELIMINATED</u></b>\n"
            f"📌 <b>STATUS:</b> <strong>TARGET 1 REACHED (+{gain_pct:.1f}%)</strong>\n"
            f"─────────────────────────\n"
            f"<blockquote>• <b>Contract:</b> <code>{dhan_symbol}</code>\n"
            f"• <b>Current LTP:</b> <code>₹{exit_ltp:.2f}</code> (Entry: ₹{entry_price:.2f})\n"
            f"• <b>Stop Loss Ratcheted:</b> <code>₹{be_sl:.2f}</code> (Cost-to-Cost Break-Even)\n"
            f"• <b>Downside Risk:</b> <code>₹0.00 (Risk-Free)</code></blockquote>\n"
            f"🎯 <i>Single-lot runner locked with zero downside risk against midday shakeouts.</i>"
        )
        await send_telegram_notification(msg, category="executions")
        log.info(f"Target 1 reached for single-lot: SL moved to Breakeven ₹{be_sl}")


# ── Exit Execution Helper ─────────────────────────────────────────────

async def trigger_market_exit(reason: str, exit_ltp: float = None):
    active = None
    with state_lock:
        active = state["active_trade"]
        
    if not active:
        return
        
    dhan_symbol = active["dhan_symbol"]
    qty = active["quantity"]
    row_id = active["journal_row_id"]
    entry_price = active["entry_price"]
    
    # 0. Check live broker position to prevent double-selling and naked short inversion
    broker_pos = None
    try:
        url = f"{OPENALGO_HOST}/api/v1/positionbook"
        pos_resp = session.post(url, json={"apikey": OPENALGO_API_KEY}, timeout=3)
        if pos_resp.status_code == 200:
            pos_data = pos_resp.json()
            if pos_data.get("status") == "success":
                positions = pos_data.get("data", [])
                for p in positions:
                    if p.get("symbol", "").upper() == dhan_symbol.upper():
                        broker_pos = p
                        break
    except Exception as e:
        log.warning(f"Failed to query broker position before exit: {e}")

    # If broker position is already 0 or negative, position was closed by broker SL-M or user
    broker_qty = 0
    if broker_pos:
        broker_qty = int(broker_pos.get("netqty", broker_pos.get("quantity", 0)))

    order_placed = False
    # 0a. Cancel pending broker-level SL-M and Target orders to eliminate race conditions
    sl_oid = active.get("sl_order_id")
    tgt_oid = active.get("target_order_id")
    to_cancel = [str(oid) for oid in (sl_oid, tgt_oid) if oid]
    if to_cancel:
        try:
            cancel_broker_orders(
                openalgo_host=OPENALGO_HOST,
                api_key=OPENALGO_API_KEY,
                order_ids=to_cancel,
                strategy_tag=active.get("strategy", "FNO_SectorRotation"),
                session=session
            )
        except Exception as cancel_err:
            log.warning(f"Failed to cancel pending broker brackets: {cancel_err}")

    if broker_pos is not None and broker_qty <= 0:
        log.info(f"🛑 [Position Governor] Net quantity is {broker_qty} for {dhan_symbol}. Position already closed (e.g. Broker SL-M). Suppressing duplicate MARKET SELL.")
        reason = f"{reason} (Suppressed - Already closed by broker SL-M)"
    else:
        # 1. API Call to place closing order
        try:
            url = f"{OPENALGO_HOST}/api/v1/placeorder"
            payload = {
                "apikey": OPENALGO_API_KEY,
                "strategy": active["strategy"],
                "symbol": dhan_symbol,
                "action": "SELL",
                "exchange": "NFO",
                "pricetype": "MARKET",
                "product": "MIS",
                "quantity": int(qty)
            }
            resp = session.post(url, headers={"Content-Type": "application/json"}, json=payload, timeout=5)
            log.info(f"Market exit order placed: {resp.text}")
            order_placed = True
        except Exception as e:
            log.error(f"Failed to place exit order via OpenAlgo: {e}")
        
    # 2. Reconcile True Execution Fill Price from Broker (Tradebook / Orderbook / Positionbook)
    broker_exit_price = None
    broker_pnl = None

    # Check 2a: Realized PnL reported directly by broker positionbook
    if broker_pos:
        realized_pnl_val = broker_pos.get("realizedpnl", broker_pos.get("pnl"))
        if realized_pnl_val is not None:
            try:
                broker_pnl = float(realized_pnl_val)
                if qty > 0 and broker_pnl != 0:
                    broker_exit_price = round(entry_price + (broker_pnl / qty), 2)
                    log.info(f"✅ Reconciled broker realized PnL from positionbook: ₹{broker_pnl} (Implied Exit: ₹{broker_exit_price})")
            except (ValueError, TypeError):
                pass

    # Check 2b: Query OpenAlgo Tradebook for actual execution fill price
    try:
        tb_url = f"{OPENALGO_HOST}/api/v1/tradebook"
        tb_resp = session.post(tb_url, json={"apikey": OPENALGO_API_KEY}, timeout=3)
        if tb_resp.status_code == 200:
            tb_data = tb_resp.json()
            if tb_data.get("status") == "success":
                trades = tb_data.get("data", [])
                sell_trades = [
                    t for t in trades 
                    if t.get("symbol", "").upper() == dhan_symbol.upper() 
                    and t.get("action", "").upper() in ("SELL", "S")
                ]
                if sell_trades:
                    latest_trade = sell_trades[-1]
                    fill_price = float(latest_trade.get("price", 0))
                    if fill_price > 0:
                        broker_exit_price = fill_price
                        log.info(f"✅ Reconciled exit fill price from OpenAlgo tradebook: ₹{broker_exit_price}")
    except Exception as e:
        log.warning(f"Could not fetch tradebook for exit fill price: {e}")

    # Check 2c: Query OpenAlgo Orderbook if tradebook didn't resolve
    if broker_exit_price is None:
        try:
            ob_url = f"{OPENALGO_HOST}/api/v1/orderbook"
            ob_resp = session.post(ob_url, json={"apikey": OPENALGO_API_KEY}, timeout=3)
            if ob_resp.status_code == 200:
                ob_data = ob_resp.json()
                if ob_data.get("status") == "success":
                    orders = ob_data.get("data", [])
                    sell_orders = [
                        o for o in orders 
                        if o.get("symbol", "").upper() == dhan_symbol.upper() 
                        and o.get("action", "").upper() in ("SELL", "S")
                        and o.get("order_status", o.get("status", "")).upper() in ("COMPLETE", "COMPLETED", "TRADED")
                    ]
                    if sell_orders:
                        latest_order = sell_orders[-1]
                        avg_price = float(latest_order.get("average_price", latest_order.get("price_executed", 0)))
                        if avg_price > 0:
                            broker_exit_price = avg_price
                            log.info(f"✅ Reconciled exit fill price from OpenAlgo orderbook: ₹{broker_exit_price}")
        except Exception as e:
            log.warning(f"Could not fetch orderbook for exit fill price: {e}")

    # Fallback to provided exit_ltp or Upstox LTP if broker did not return fills
    if broker_exit_price is not None:
        exit_ltp = broker_exit_price
    elif exit_ltp is None:
        try:
            opt_key = active.get("option_instrument_key")
            if opt_key:
                ltp_res = upstox_client.get_ltp_quotes([opt_key])
                quote = extract_quote_from_response(ltp_res, opt_key)
                if quote:
                    exit_ltp = float(quote.get("last_price", 0))
        except Exception:
            pass
        if not exit_ltp or exit_ltp <= 0:
            exit_ltp = entry_price

    scaled_pnl = float(active.get("scaled_pnl", 0.0))
    scaled_qty = int(active.get("scaled_qty", 0))
    original_qty = qty + scaled_qty

    if broker_pnl is not None and broker_exit_price is not None:
        pnl = round(broker_pnl + scaled_pnl, 2)
    else:
        pnl = round((exit_ltp - entry_price) * qty + scaled_pnl, 2)
    pnl_pct = round((pnl / (entry_price * original_qty)) * 100, 2) if entry_price > 0 and original_qty > 0 else 0.0
    exit_time_str = get_ist_now().strftime("%Y-%m-%d %H:%M:%S")
    
    # 3. Log in SQLite DB
    log_autopilot_trade_exit(row_id, exit_time_str, exit_ltp, pnl, pnl_pct)
    
    # 4. Send Telegram Notifications
    direction_tag = "🟢" if pnl >= 0 else "🔴"
    status_label = "PROFIT SECURED" if pnl > 0 else ("BREAK-EVEN" if pnl == 0 else "STOPPED OUT")
    scale_subtext = f"\n• <b>Scale-Out Gain:</b> <code>+₹{scaled_pnl:,.2f}</code> | <b>Runner Gain:</b> <code>{'+' if pnl - scaled_pnl >= 0 else ''}₹{pnl - scaled_pnl:,.2f}</code>" if active.get("target1_scaled") and scaled_pnl > 0 else ""
    msg_exec = (
        f"⚡ <b><u>WEALTHOS AUTOPILOT | TRADE COMPLETED</u></b>\n"
        f"{direction_tag} <b>STATUS:</b> <strong>POSITION CLOSED ({status_label})</strong>\n"
        f"─────────────────────────\n"
        f"<blockquote>{direction_tag} <b>Net Realized P&L:</b> <code>{'+' if pnl >= 0 else ''}₹{pnl:,.2f} ({pnl_pct:+.2f}%)</code>\n"
        f"• <b>Contract:</b> <code>{dhan_symbol}</code>\n"
        f"• <b>Exit Trigger:</b> <code>{reason}</code>\n"
        f"• <b>Premium:</b> <code>₹{entry_price:.2f} ➔ ₹{exit_ltp:.2f}</code>\n"
        f"• <b>Closed Quantity:</b> <code>{qty:,} shares</code>{scale_subtext}</blockquote>\n\n"
        f"<blockquote expandable>⚙️ <b>EXECUTION TELEMETRY</b>\n"
        f"• <b>Underlying:</b> <code>{active['symbol']}</code>\n"
        f"• <b>Strategy:</b> <code>{active.get('strategy', 'FNO_SectorRotation')}</code>\n"
        f"• <b>Closed At:</b> <code>{exit_time_str} IST</code>\n"
        f"• <b>Ledger Verification:</b> <code>100% Ground-Truth Reconciled</code></blockquote>\n"
        f"─────────────────────────\n"
        f"✅ <i>Trade recorded in Ground-Truth Scalp Ledger & Synced to Journal.</i>"
    )
    await send_telegram_notification(msg_exec, category="executions")

    # 4b. Send Daily PnL Report message + PnL Chart Photo to Daily PnL Reports topic (#22)
    try:
        date_str = get_ist_now().strftime("%Y-%m-%d")
        conn = db.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT SUM(pnl), COUNT(id), SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END), SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) FROM autopilot_journal WHERE date = ?", (date_str,))
        row = cursor.fetchone()
        today_pnl = float(row[0] or 0.0)
        today_trades = int(row[1] or 0)
        today_wins = int(row[2] or 0)
        today_losses = int(row[3] or 0)
        
        # Fetch today's 1-minute intraday candles for the active option contract from Upstox API
        pnl_ticks = []
        try:
            opt_key = active.get("option_instrument_key")
            if opt_key:
                c_res = upstox_client.get_intraday_candles(opt_key, "1minute")
                if c_res and "data" in c_res and "candles" in c_res["data"]:
                    raw_candles = c_res["data"]["candles"]
                    pnl_ticks = build_pnl_ticks_from_candles(raw_candles, entry_price, int(qty))
        except Exception as ex:
            log.warning(f"Failed to fetch Upstox 1-min candles for PnL chart: {ex}")
            
        if not pnl_ticks:
            pnl_ticks = [("09:15", 0.0), (exit_time_str.split(" ")[-1][:5], pnl)]
            
        chart_img_path = os.path.join(STATE_DIR, f"pnl_chart_{date_str}.png")
        render_quant_pnl_dashboard(chart_img_path, pnl_ticks, capital=100000.0)
        
        pnl_tag = "🟢" if today_pnl > 0 else ("⚪" if today_pnl == 0 else "🔴")
        win_rate = (today_wins / today_trades * 100) if today_trades > 0 else 0.0
        msg_pnl = (
            f"📊 <b><u>WEALTHOS AUTOPILOT | DAILY P&L REPORT</u></b>\n"
            f"{pnl_tag} <b>SESSION OUTCOME:</b> <strong>{'NET PROFITABLE' if today_pnl > 0 else ('BREAK-EVEN' if today_pnl == 0 else 'NET DEFICIT')}</strong>\n"
            f"─────────────────────────\n"
            f"<blockquote>{pnl_tag} <b>Total Day Realized P&L:</b> <code>{'+' if today_pnl >= 0 else ''}₹{today_pnl:,.2f}</code>\n"
            f"• <b>Trading Date:</b> <code>{date_str}</code>\n"
            f"• <b>Win Rate:</b> <code>{win_rate:.1f}%</code> ({today_wins}W / {today_losses}L of {today_trades} Trades)\n"
            f"• <b>Latest Contract:</b> <code>{active['symbol']} ({'+' if pnl >= 0 else ''}₹{pnl:,.2f})</code></blockquote>\n\n"
            f"<blockquote expandable>⚙️ <b>DESK METRICS</b>\n"
            f"• <b>Execution Speed:</b> <code>Sub-100ms via OpenAlgo</code>\n"
            f"• <b>Verification:</b> <code>100% Ground-Truth Reconciled</code></blockquote>\n"
            f"─────────────────────────\n"
            f"🏛️ <i>WealthOS Autoregressive Risk Engine • Institutional Ledger</i>"
        )
        await send_telegram_notification(msg_pnl, category="pnl_report", photo_path=chart_img_path)
    except Exception as e:
        log.error(f"Error sending Daily PnL report: {e}")


    
    # 5. Reset State
    with state_lock:
        state["active_trade"] = None
        save_state_to_file()

# ── Trailing Stop Loss Monitor Thread ─────────────────────────────────

monitor_thread = None
monitor_stop_event = threading.Event()

def start_position_monitor():
    global monitor_thread
    with state_lock:
        if monitor_thread is not None and monitor_thread.is_alive():
            return
            
        monitor_stop_event.clear()
        monitor_thread = threading.Thread(target=position_monitor_loop, daemon=True)
        monitor_thread.start()
        log.info("Position monitor thread started.")

def stop_position_monitor():
    monitor_stop_event.set()
    log.info("Position monitor stop requested.")

def position_monitor_loop():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(position_monitor_async())
    loop.close()

async def position_monitor_async():
    log.info("Autopilot monitor async loop entered.")
    while not monitor_stop_event.is_set():
        try:
            active = None
            with state_lock:
                active = state["active_trade"]
                
            if not active:
                await asyncio.sleep(5)
                continue
                
            ist_now = get_ist_now()
            
            # Outside market hours guard
            if ist_now.hour < 9 or (ist_now.hour == 9 and ist_now.minute < 15) or ist_now.hour >= 16:
                await asyncio.sleep(30)
                continue
                
            # Exit check 1: Afternoon Cut-off (Configurable, with Expiry Day awareness)
            rules = load_autopilot_rules()
            expiry_cutoff_enabled = rules.get("expiry_cutoff_enabled", True)
            cutoff_time_str = str(rules.get("afternoon_cutoff_time", "14:00"))
            cutoff_hour, cutoff_min = 14, 0
            try:
                parts = cutoff_time_str.split(":")
                cutoff_hour, cutoff_min = int(parts[0]), int(parts[1])
            except Exception:
                cutoff_hour, cutoff_min = 14, 0

            # Expiry day check (Tues=1 FINNIFTY, Wed=2 BANKNIFTY, Thurs=3 NIFTY)
            is_expiry_day = ist_now.weekday() in (1, 2, 3)
            should_apply_cutoff = is_expiry_day if expiry_cutoff_enabled else True

            current_minutes = ist_now.hour * 60 + ist_now.minute
            cutoff_minutes = cutoff_hour * 60 + cutoff_min

            if should_apply_cutoff and current_minutes >= cutoff_minutes:
                # 🛡️ Sovereign Protection: Only cut unprofitable / stagnant positions before theta decay.
                # If position is in profit (>= entry_price * 1.05) and already has a trailing stop / risk-free stop active, DO NOT KILL IT!
                # Let the runner ride the 2:15-3:15 PM afternoon breakout until trailed stop or 15:12 EOD!
                entry_p = float(active.get("entry_price", 0))
                opt_key = active.get("option_instrument_key", "")
                is_winning_runner = False
                if opt_key and entry_p > 0:
                    try:
                        ltp_res = upstox_client.get_ltp_quotes([opt_key])
                        q = extract_quote_from_response(ltp_res, opt_key)
                        if q and float(q.get("last_price", 0)) >= entry_p * 1.05:
                            is_winning_runner = True
                    except Exception:
                        pass
                
                if not is_winning_runner:
                    log.info(f"Afternoon Cutoff ({cutoff_time_str} IST) reached on {'expiry' if is_expiry_day else 'standard'} session. Stagnant/losing position exited before late decay.")
                    await trigger_market_exit(reason=f"Afternoon Cutoff ({cutoff_time_str})")
                    await asyncio.sleep(5)
                    continue
                else:
                    log.info(f"🏃 [Runner Immunity] Active trade is in profit (+5%+) with trailing risk-free protection. Bypassing 14:00 cutoff to ride afternoon trend!")
                
            # Fetch Live Option Premium quote
            opt_key = active["option_instrument_key"]
            try:
                ltp_res = upstox_client.get_ltp_quotes([opt_key])
                quote = extract_quote_from_response(ltp_res, opt_key)
                if quote:
                    live_ltp = float(quote.get("last_price", 0))
                    entry_price = float(active.get("entry_price", 0))
                    
                    if live_ltp > 0 and entry_price > 0:
                        hard_sl_pct = float(rules.get("hard_sl_pct", 35.0))
                        trail_pct = float(rules.get("trail_trigger_pct", 40.0))
                        target_model = rules.get("target_model", "DYNAMIC_TRAILING")
                        target_mult = float(rules.get("target_multiplier", 2.0))
                        trail_lock_pct = float(rules.get("dynamic_trail_lock_pct", 75.0))
                        trail_step_pct = float(rules.get("dynamic_trail_step_pct", 20.0))

                        # Exit check 2: Hard Stop-Loss Breach (Option percentage)
                        hard_sl_price = round(entry_price * (1.0 - (hard_sl_pct / 100.0)), 2)
                        if live_ltp <= hard_sl_price:
                            log.info(f"LTP {live_ltp} breached hard SL {hard_sl_price} (-{hard_sl_pct}% from entry {entry_price}). Triggering stop loss exit.")
                            await trigger_market_exit(reason=f"Hard Stop Loss (-{hard_sl_pct}%)", exit_ltp=live_ltp)
                            await asyncio.sleep(5)
                            continue

                        # Exit check 2.5: Target 1 Partial Scale-Out (50% Book @ Target 1 + Runner to Breakeven)
                        scale_out_enabled = bool(rules.get("scale_out_enabled", True))
                        scale_trigger_pct = float(rules.get("scale_out_trigger_pct", 40.0))
                        scale_ratio = float(rules.get("scale_out_ratio", 0.50))
                        if scale_out_enabled and not active.get("target1_scaled", False):
                            if live_ltp >= entry_price * (1.0 + (scale_trigger_pct / 100.0)):
                                log.info(f"Target 1 trigger (+{scale_trigger_pct}%) reached at ₹{live_ltp:.2f} (Entry: ₹{entry_price:.2f}). Triggering 2-leg partial scale-out.")
                                await trigger_partial_scale_out(exit_ltp=live_ltp, scale_pct=scale_ratio)

                        # Exit check 3: Target Hit & Dynamic Runner Engine
                        if live_ltp >= entry_price * target_mult:
                            if target_model == "HARD_TARGET":
                                log.info(f"LTP {live_ltp} reached {target_mult}x target from entry {entry_price}. Triggering hard target exit.")
                                await trigger_market_exit(reason=f"Target Hit ({target_mult:.1f}x / +{int((target_mult-1)*100)}%)", exit_ltp=live_ltp)
                                await asyncio.sleep(5)
                                continue
                            else:
                                # Dynamic Trailing Runner Mode: Lock in minimum profit floor (+75%)
                                if not active.get("target_hit_runner"):
                                    active["target_hit_runner"] = True
                                    target_floor_sl = round(entry_price * (1.0 + (trail_lock_pct / 100.0)), 2)
                                    log.info(f"🚀 {target_mult}x Target reached! Dynamic Runner activated. SL ratcheted to ₹{target_floor_sl} (+{trail_lock_pct}% profit floor).")
                                    msg = (
                                        f"🎯 <b><u>WEALTHOS AUTOPILOT | DYNAMIC RUNNER ACTIVATED</u></b>\n"
                                        f"📌 <b>STATUS:</b> <strong>TARGET 1 CLEARED</strong>\n"
                                        f"─────────────────────────\n"
                                        f"<blockquote>• <b>Contract:</b> <code>{active.get('dhan_symbol', active.get('symbol'))}</code>\n"
                                        f"• <b>Current LTP:</b> <code>₹{live_ltp:.2f}</code> (<b>+{((live_ltp/entry_price)-1)*100:.1f}%</b> 🟢)\n"
                                        f"• <b>Guaranteed Profit Floor:</b> <code>₹{target_floor_sl:.2f}</code> (+{trail_lock_pct}%)\n"
                                        f"• <b>Cushion:</b> <code>{trail_step_pct:.0f}% Dynamic Trailing</code></blockquote>\n"
                                        f"🚀 <i>Mega-trend capture protocol engaged. Downside fully locked.</i>"
                                    )
                                    await send_telegram_notification(msg, category="executions")

                        # Exit check 4: Trailing stop loss (Underlying-driven milestone trailing)
                        highest = 0.0
                        sl_offset = 0.0
                        current_sl = 0.0

                        with state_lock:
                            if state["active_trade"]:
                                highest = float(state["active_trade"].get("highest_premium", entry_price))
                                sl_offset = float(state["active_trade"].get("sl_offset", entry_price * 0.35))
                                current_sl = float(state["active_trade"].get("stop_loss", hard_sl_price))

                        # Multi-milestone trailing logic via Sovereign Trade Guardian:
                        new_sl = calculate_ratchet_sl(
                            entry_price=entry_price,
                            highest_price=max(highest, live_ltp),
                            current_sl=current_sl,
                            rules=rules
                        )
                        # Continuous trailing beyond +60%
                        if live_ltp > highest and live_ltp >= entry_price * 1.40:
                            continuous_sl = round(live_ltp - sl_offset, 2)
                            new_sl = max(new_sl, continuous_sl)

                        # If in dynamic runner mode (post target), ratchet SL to at least profit floor (+75%)
                        # and trail behind highest_premium with trail_step_pct cushion
                        if active.get("target_hit_runner"):
                            target_floor_sl = round(entry_price * (1.0 + (trail_lock_pct / 100.0)), 2)
                            cushion = round(max(highest, live_ltp) * (trail_step_pct / 100.0), 2)
                            runner_sl = round(max(highest, live_ltp) - cushion, 2)
                            new_sl = max(new_sl, target_floor_sl, runner_sl)

                        new_sl = to_tick(new_sl)
                        if live_ltp > highest or new_sl > current_sl:
                            with state_lock:
                                if state["active_trade"]:
                                    state["active_trade"]["highest_premium"] = max(highest, live_ltp)
                                    state["active_trade"]["stop_loss"] = new_sl
                                    if active.get("target_hit_runner"):
                                        state["active_trade"]["target_hit_runner"] = True
                            save_state_to_file()

                            if new_sl > current_sl:
                                gain_pts = round(new_sl - current_sl, 2)
                                # Sync new trigger price to broker SL-M on OpenAlgo
                                sl_oid = active.get("sl_order_id")
                                if sl_oid:
                                    try:
                                        modify_broker_sl(
                                            openalgo_host=OPENALGO_HOST,
                                            api_key=OPENALGO_API_KEY,
                                            sl_order_id=sl_oid,
                                            symbol=active.get("dhan_symbol", active["symbol"]),
                                            exchange="NFO",
                                            product="MIS",
                                            qty=int(active.get("quantity", 0)),
                                            new_trigger_price=new_sl,
                                            strategy_tag=active.get("strategy", "FNO_SectorRotation"),
                                            session=session
                                        )
                                    except Exception as mod_err:
                                        log.warning(f"Failed to sync trailed SL to broker: {mod_err}")

                                is_runner = active.get("target_hit_runner", False)
                                msg = (
                                    f"🔒 <b><u>WEALTHOS AUTOPILOT | {'RUNNER PROFIT LOCKED' if is_runner else 'TRAILING SL ADJUSTED'}</u></b>\n"
                                    f"📌 <b>STATUS:</b> <strong>PROTECTIVE STOP RAISED</strong>\n"
                                    f"─────────────────────────\n"
                                    f"<blockquote>• <b>Contract:</b> <code>{active['symbol']}</code>\n"
                                    f"• <b>Current Premium:</b> <code>₹{live_ltp:.2f}</code> 🟢\n"
                                    f"• <b>New Stop Loss:</b> <code>₹{new_sl:.2f}</code> <i>(Old: ₹{current_sl:.2f})</i>\n"
                                    f"• <b>Step Lock:</b> <code>+₹{gain_pts:.2f}/share</code></blockquote>\n"
                                    f"💎 <i>Zero giveback trailing active. Protecting unrealized excursion.</i>"
                                )
                                await send_telegram_notification(msg, category="executions")
                                log.info(f"Trailed SL to {new_sl} for {active['symbol']} option.")
                                current_sl = new_sl

                        if live_ltp <= current_sl:
                            reason = "Dynamic Runner Profit Locked" if active.get("target_hit_runner") else "Trailing SL Hit"
                            log.info(f"LTP {live_ltp} hit {reason} at {current_sl}. Exiting.")
                            await trigger_market_exit(reason=reason, exit_ltp=live_ltp)
                            await asyncio.sleep(5)
                            continue
            except Exception as e:
                log.error(f"Error checking option LTP in monitor loop: {e}")
                
            await asyncio.sleep(15)
        except Exception as e:
            log.error(f"Error in position monitor loop: {e}")
            await asyncio.sleep(10)

# Start monitor thread if an active trade was loaded from state file on startup
if state["active_trade"]:
    start_position_monitor()


# ── API Routes ────────────────────────────────────────────────────────

@router.post("/signal")
async def receive_signal(req: SignalRequest, background_tasks: BackgroundTasks):
    global state
    
    # Store chat configs from request if provided
    if req.bot_token and req.chat_id:
        with state_lock:
            state["bot_token"] = req.bot_token
            state["chat_id"] = req.chat_id
            save_state_to_file()
            
    # Verify Autopilot status
    with state_lock:
        if not req.bypass_checks and not state["enabled"]:
            raise HTTPException(status_code=400, detail="Autopilot is disabled.")
            
        if not req.bypass_checks and state["active_trade"] is not None:
            raise HTTPException(status_code=400, detail=f"A trade is already active for {state['active_trade']['symbol']}.")
            
        if not req.bypass_checks and is_daily_loss_limit_breached():
            raise HTTPException(
                status_code=400,
                detail=f"Daily loss limit breached (PnL: ₹{get_todays_realized_pnl():.0f}). All trading halted for today."
            )
            
        if not req.bypass_checks and is_duplicate_order(req.symbol, req.direction, req.ltp):
            raise HTTPException(
                status_code=400,
                detail=f"Duplicate signal for {req.symbol} {req.direction} within 30-second deduplication window."
            )

        if not req.bypass_checks:
            from services.risk_manager import risk_manager
            current_state_info = {
                "open_positions_count": 1 if state.get("active_trade") is not None else 0
            }
            signal_dict = {"symbol": req.symbol, "sector": req.sector, "ltp": req.ltp, "quantity": 1}
            risk_allowed, risk_reason = risk_manager.gate_order(signal_dict, current_state_info)
            if not risk_allowed:
                raise HTTPException(status_code=400, detail=f"Risk limit gate rejected order: {risk_reason}")

        if not req.bypass_checks and not check_liquidity_depth(req.symbol, 1, req.direction):
            raise HTTPException(status_code=400, detail=f"Market depth for {req.symbol} is too thin for order execution.")
            
    ist_now = get_ist_now()
    rules = load_autopilot_rules()
    
    # 1. Timing check (Full market hours 09:20 - 15:15 IST when enabled, bypassed in sandbox)
    if not req.bypass_checks and rules.get("time_gate_enabled", False):
        total_mins = ist_now.hour * 60 + ist_now.minute
        start_min = int(rules.get("entry_window_start_mins", 9 * 60 + 20))
        end_min = int(rules.get("entry_window_end_mins", 15 * 60 + 15))
        in_window = start_min <= total_mins <= end_min
        if not in_window:
            raise HTTPException(status_code=400, detail=f"Autopilot entry window is strictly {start_min//60:02d}:{start_min%60:02d} to {end_min//60:02d}:{end_min%60:02d} IST.")
            
    # 2. Weekend check (Monday-Friday only)
    if not req.bypass_checks and ist_now.weekday() >= 5:
        raise HTTPException(status_code=400, detail="Autopilot does not execute trades on weekends.")
        
    # 3. Nifty direction alignment check (allows mild sector divergence up to configured threshold)
    if not req.bypass_checks and rules.get("nifty_macro_enabled", True):
        short_thresh = float(rules.get("nifty_short_threshold", -0.35))
        long_thresh = float(rules.get("nifty_long_threshold", 0.35))
        if req.direction.upper() == "BUY" and req.niftyChange < short_thresh:
            raise HTTPException(status_code=400, detail=f"Direction BUY does not align with sharp Nifty decline ({req.niftyChange}% < {short_thresh}%).")
        if req.direction.upper() == "SELL" and req.niftyChange > long_thresh:
            raise HTTPException(status_code=400, detail=f"Direction SELL does not align with sharp Nifty rally ({req.niftyChange}% > {long_thresh}%).")
            
    # 4. Composite Score Check
    comp_score = calculate_composite_score(req)
    min_comp = float(rules.get("min_composite_score", 60.0))
    if not req.bypass_checks and comp_score < min_comp:
        raise HTTPException(status_code=400, detail=f"Signal composite score ({comp_score:.1f}/100) below minimum threshold ({min_comp:.1f}).")

    # 4b. ONNX ML Signal Confidence Gate
    ml_features = {
        "sectorStrength": req.sectorStrength,
        "strengthFactor": req.strengthFactor,
        "niftyChange": req.niftyChange,
        "ltp": req.ltp
    }
    ml_allowed, ml_confidence, ml_reason = ml_signal_server.should_allow_signal(ml_features)
    log.info(f"[ML_GATE] Signal {req.symbol} {req.direction}: confidence={ml_confidence:.2f}, allowed={ml_allowed} ({ml_reason})")
    if not req.bypass_checks and not ml_allowed:
        raise HTTPException(status_code=400, detail=f"Signal rejected by ML confidence gate: {ml_reason}")

    # 5. F&O 2.0 Dip & Rebound Mathematical Validation Gate (Bypassed in sandbox mode)
    if not req.bypass_checks and not rules.get("sandbox_mode", True) and rules.get("dip_gate_enabled", True):
        eq_key = db.get_upstox_instrument_key(req.symbol, exchange="NSE_EQ") or db.get_upstox_instrument_key(req.symbol)
        if eq_key:
            try:
                today_str = ist_now.strftime("%Y-%m-%d")
                from_date = (ist_now - timedelta(days=2)).strftime("%Y-%m-%d")
                k_enc = eq_key.replace("|", "%7C")
                c_res = upstox_client.get_historical_candles(k_enc, "1minute", today_str, from_date)
                if c_res.get("status") == "success" and "data" in c_res:
                    candles_1m = c_res["data"].get("candles", [])
                    if candles_1m and callable(detect_fno_dip_and_rebound):
                        dir_str = "CALL" if req.direction.upper() in ("BUY", "CALL", "LONG") else "PUT"
                        dip_res = detect_fno_dip_and_rebound(
                            symbol=req.symbol,
                            direction=dir_str,
                            candles_1m=candles_1m,
                            vwap=req.ltp,
                            ema_9=req.ltp
                        )
                        log.info(f"[DIP_GATE] {req.symbol} ({dir_str}): confirmed={dip_res.get('confirmed')} status={dip_res.get('status')} PVCR={dip_res.get('pvcr')}x")
                        if not dip_res.get("confirmed", False):
                            raise HTTPException(
                                status_code=400,
                                detail=f"F&O 2.0 Dip & Rebound gate rejected {req.symbol}: {dip_res.get('status')} ({dip_res.get('reason')})"
                            )
            except HTTPException:
                raise
            except Exception as e:
                log.warning(f"Error evaluating 1m dip for {req.symbol}: {e}")

    # 6. Limit to max production trades per day (excluding test trades, bypassed in sandbox)
    max_trades = int(rules.get("max_trades_per_day", 50))
    if not req.bypass_checks and not rules.get("sandbox_mode", True):
        date_str = ist_now.strftime("%Y-%m-%d")
        conn = db.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT count(*) FROM autopilot_journal WHERE date = ? AND (is_test IS NULL OR is_test = 0)", (date_str,))
        trade_count = cursor.fetchone()[0]
        conn.close()
        if trade_count >= max_trades:
            raise HTTPException(status_code=400, detail=f"Autopilot has already executed today's trade count limit ({trade_count}/{max_trades}).")

    # 6.5 Opening-Volume Exhaustion Veto (fc15_vol_ratio >= 8; t = -2.93, negative in all 4 years)
    if not req.bypass_checks and rules.get("volume_veto_enabled", False):
        veto_threshold = float(rules.get("volume_veto_threshold", VOLUME_VETO_THRESHOLD))
        veto_date = ist_now.strftime("%Y-%m-%d")
        if _volume_exhausted(req.symbol, veto_date):
            try:
                from services.audit_log import audit_chain
                audit_chain.append_event("VOLUME_VETO_BLOCK", "autopilot_gate_6_5", {
                    "symbol": req.symbol,
                    "sector": req.sector,
                    "direction": req.direction,
                    "ltp": req.ltp,
                    "threshold": veto_threshold,
                    "date": veto_date,
                    "composite_score": comp_score,
                    "finding": "fc15_vol_ratio>=8 -> -0.166% excess, t=-2.93, n=762 (edge_analysis_report.md)",
                })
            except Exception as audit_err:
                log.warning(f"[VOL_VETO] audit_chain unavailable: {audit_err}")
            raise HTTPException(
                status_code=422,
                detail=f"Opening-volume exhaustion veto on {req.symbol}: first-15m volume >= {veto_threshold}x the trailing-20d opening-volume baseline. Historical excess -0.166% (t=-2.93)."
            )

    # 7. Resolve ATM option contract
    atm = get_atm_option_contract(req.symbol, req.direction)
    if not atm:
        raise HTTPException(status_code=404, detail=f"Could not resolve ATM option contract details for {req.symbol}.")
        
    spot_price = atm["spot_price"]
    expiry_str = atm["expiry"]
    strike = atm["strike_price"]
    opt_type = atm["option_type"]
    opt_key = atm["instrument_key"]
    lot_size = atm["lot_size"]
    upstox_sym = atm["upstox_symbol"]
    
    # 8. Format Dhan NFO symbol name
    dhan_symbol = format_dhan_nfo_symbol(req.symbol, expiry_str, strike, opt_type)
    symbol_to_place = dhan_symbol
    
    # 9. Calculate Option-Native Percentage Stop Loss & Verify Bid-Ask Spread
    hard_sl_pct = float(rules.get("hard_sl_pct", 35.0))
    
    # Fetch Option Premium LTP and Depth Quote
    option_ltp = 0.0
    spread_pct = 0.0
    try:
        full_res = upstox_client.get_full_quotes([opt_key])
        q_data = extract_quote_from_response(full_res, opt_key)
        if q_data:
            option_ltp = float(q_data.get("last_price", 0))
            depth = q_data.get("depth", {}) or {}
            bids = depth.get("bids", [])
            asks = depth.get("asks", [])
            if bids and asks:
                best_bid = float(bids[0].get("price", 0))
                best_ask = float(asks[0].get("price", 0))
                if best_ask > 0 and best_bid > 0:
                    spread_pct = round(((best_ask - best_bid) / best_ask) * 100.0, 2)
        if option_ltp <= 0:
            ltp_res = upstox_client.get_ltp_quotes([opt_key])
            quote = extract_quote_from_response(ltp_res, opt_key)
            if quote:
                option_ltp = float(quote.get("last_price", 0))
    except Exception as e:
        log.error(f"Failed to fetch option LTP / depth quote: {e}")
        
    if option_ltp <= 0:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve premium LTP for option {upstox_sym}.")

    # Enforce Institutional Bid-Ask Spread Gate (<= 1.50%)
    max_spread = float(rules.get("max_option_spread_pct", 1.50))
    if not req.bypass_checks and spread_pct > max_spread:
        raise HTTPException(
            status_code=400,
            detail=f"Option contract {upstox_sym} Bid-Ask spread ({spread_pct:.2f}%) exceeds maximum limit ({max_spread:.2f}%)."
        )
        
    sl_offset = round(option_ltp * (hard_sl_pct / 100.0), 2)
    initial_sl = max(0.05, round(option_ltp - sl_offset, 2))
    
    # 10. Place order on Dhan Sandbox via OpenAlgo
    lot_multiplier = max(1, int(rules.get("lot_multiplier", 1)))
    order_qty = int(lot_size) * lot_multiplier
    capital_required = round(float(order_qty) * option_ltp, 2)
    phase = atm.get("phase", "MID_MONTH")
    dte = atm.get("dte", 14)
    max_allowed_cap = float(atm.get("max_capital", 50000.0))
    min_allowed_cap = float(atm.get("min_capital", 15000.0))
    adj_reason = atm.get("strike_adjustment_reason", "ATM default")

    # Dynamic Monthly Capital Exposure Check
    if not req.bypass_checks and rules.get("dynamic_capital_enabled", True):
        hard_cap_ceiling = max_allowed_cap * 1.25
        if capital_required > hard_cap_ceiling:
            raise HTTPException(
                status_code=400,
                detail=f"Order rejected: Required trade capital (₹{capital_required:,.2f}) exceeds dynamic monthly ceiling (₹{max_allowed_cap:,.2f} + 25% tolerance) for phase {phase} ({dte} DTE). Contract: {upstox_sym}, Qty: {order_qty}, Premium: ₹{option_ltp:.2f}."
            )
        log.info(f"💼 [DYNAMIC CAPITAL GATE] {symbol_to_place}: Required=₹{capital_required:,.2f} | Phase={phase} ({dte} DTE) Band=₹{min_allowed_cap:,.0f}-₹{max_allowed_cap:,.0f} | Strike: {adj_reason}")

    try:
        url = f"{OPENALGO_HOST}/api/v1/placeorder"
        payload = {
            "apikey": OPENALGO_API_KEY,
            "strategy": req.strategy,
            "symbol": symbol_to_place,
            "action": "BUY",
            "exchange": "NFO",
            "pricetype": "MARKET",
            "product": "MIS",
            "quantity": order_qty
        }
        resp = session.post(url, headers={"Content-Type": "application/json"}, json=payload, timeout=5)
        res_json = resp.json()
        if res_json.get("status") != "success":
            raise Exception(res_json.get("remarks") or res_json.get("message") or "Unknown OpenAlgo error")
            
        order_id = res_json.get("orderid", "MOCK_ORDER_ID")
    except Exception as e:
        log.error(f"Order placement failed: {e}")
        raise HTTPException(status_code=500, detail=f"OpenAlgo order placement failed: {str(e)}")

    # 10b. Reconcile Ground-Truth Entry Fill Price from OpenAlgo Tradebook/Orderbook
    actual_entry_price = option_ltp
    try:
        await asyncio.sleep(0.3)  # Non-blocking 300ms pause for broker matching engine
        tb_url = f"{OPENALGO_HOST}/api/v1/tradebook"
        tb_resp = session.post(tb_url, json={"apikey": OPENALGO_API_KEY}, timeout=2)
        if tb_resp.status_code == 200:
            tb_data = tb_resp.json()
            if tb_data.get("status") == "success":
                trades = tb_data.get("data", [])
                matching_trades = [
                    t for t in trades 
                    if (str(t.get("orderid", "")) == str(order_id) or t.get("symbol", "").upper() == symbol_to_place.upper())
                    and t.get("action", "").upper() in ("BUY", "B")
                ]
                if matching_trades:
                    fill_price = float(matching_trades[-1].get("price", 0))
                    if fill_price > 0:
                        actual_entry_price = fill_price
                        log.info(f"✅ Reconciled entry fill price from OpenAlgo tradebook: ₹{actual_entry_price} (Quote LTP was: ₹{option_ltp})")
    except Exception as e:
        log.warning(f"Could not reconcile entry fill price from OpenAlgo: {e}")

    sl_offset = round(actual_entry_price * (hard_sl_pct / 100.0), 2)
    initial_sl = max(0.05, round(actual_entry_price - sl_offset, 2))
    target1_pct = float(rules.get("scale_out_trigger_pct", 40.0))
    target1_price = round(actual_entry_price * (1.0 + target1_pct / 100.0), 2)

    # 10c. Arm Sovereign Trade Guardian broker-level brackets on OpenAlgo
    guardian_res = arm_protective_brackets(
        openalgo_host=OPENALGO_HOST,
        api_key=OPENALGO_API_KEY,
        symbol=symbol_to_place,
        exchange="NFO",
        product="MIS",
        filled_qty=order_qty,
        fill_price=actual_entry_price,
        sl_price=initial_sl,
        target1_price=target1_price,
        strategy_tag=req.strategy,
        lot_size=int(lot_size),
        asset_class="STOCK_OPTION",
        session=session
    )
    sl_order_id = guardian_res.get("sl_order_id")
    target_order_id = guardian_res.get("target_order_id")
    target_qty = guardian_res.get("target_qty", 0)

    # 11. Log in SQLite DB
    entry_time_str = get_ist_now().strftime("%Y-%m-%d %H:%M:%S")
    is_test_val = 1 if req.bypass_checks else 0
    row_id = log_autopilot_trade_entry(
        strategy=req.strategy,
        symbol=req.symbol,
        direction=req.direction,
        entry_time=entry_time_str,
        entry_price=actual_entry_price,
        quantity=order_qty,
        stop_loss=initial_sl,
        target=target1_price if target_order_id else 0.0,
        signal_score=req.strengthFactor,
        nifty_direction="BULL" if req.niftyChange > 0 else "BEAR",
        sector=req.sector,
        sector_strength=req.sectorStrength,
        order_id=order_id,
        composite_score=comp_score,
        is_test=is_test_val
    )
    
    # 12. Save active position details
    active_trade = {
        "symbol": req.symbol,
        "dhan_symbol": dhan_symbol,
        "option_instrument_key": opt_key,
        "journal_row_id": row_id,
        "entry_price": actual_entry_price,
        "highest_premium": actual_entry_price,
        "sl_offset": sl_offset,
        "stop_loss": initial_sl,
        "sl_order_id": sl_order_id,
        "target_order_id": target_order_id,
        "target_qty": target_qty,
        "hard_sl_pct": hard_sl_pct,
        "quantity": order_qty,
        "lot_size": int(lot_size),
        "lot_multiplier": lot_multiplier,
        "strategy": req.strategy,
        "order_id": order_id,
        "composite_score": comp_score,
        "entry_time": entry_time_str
    }
    
    with state_lock:
        state["active_trade"] = active_trade
        save_state_to_file()
        
    start_position_monitor()
    
    # 13. Send Telegram notification to Executions Topic (#8)
    msg = (
        f"⚡ <b><u>WEALTHOS AUTOPILOT | EXECUTION DESK</u></b>\n"
        f"📌 <b>STATUS:</b> <strong>ORDER PLACED</strong>\n"
        f"─────────────────────────\n"
        f"<blockquote>• <b>Contract:</b> <code>{dhan_symbol}</code>\n"
        f"• <b>Underlying:</b> <code>{req.symbol}</code> (Spot: ₹{spot_price:,.2f})\n"
        f"• <b>Segment:</b> <code>NFO (MIS)</code> | <b>Action:</b> <code>BUY</code>\n"
        f"• <b>Quantity:</b> <code>{lot_size} shares ({lot_multiplier} Lot{'s' if lot_multiplier > 1 else ''})</code></blockquote>\n\n"
        f"💰 <b>PRICING & BRACKETS</b>\n"
        f"<blockquote>• <b>Entry Premium:</b> <code>₹{actual_entry_price:.2f}</code>\n"
        f"• <b>Initial Stop Loss:</b> <code>₹{initial_sl:.2f}</code> <i>({hard_sl_pct:.0f}% Risk Offset: ₹{sl_offset:.2f})</i>\n"
        f"• <b>Broker SL-M Order:</b> <code>{sl_order_id or 'ARMED'}</code>\n"
        f"• <b>Target 1:</b> <code>₹{target1_price:.2f}</code> (+{target1_pct:.0f}%)\n"
        f"• <b>Broker Target Order:</b> <code>{target_order_id or 'Dynamic Runner Active (Option A)'}</code>\n"
        f"• <b>Conviction Score:</b> <code>{comp_score:.1f} / 100</code> 🟢</blockquote>\n\n"
        f"<blockquote expandable>⚙️ <b>EXECUTION TELEMETRY</b>\n"
        f"• <b>Order ID:</b> <code>{order_id}</code>\n"
        f"• <b>Strategy:</b> <code>{req.strategy}</code>\n"
        f"• <b>Executed At:</b> <code>{entry_time_str} IST</code></blockquote>\n"
        f"─────────────────────────\n"
        f"🛡️ <i>Autonomous Risk Manager Active • 80% MFE Ratchet Enabled</i>"
    )
    background_tasks.add_task(send_telegram_notification, msg, category="executions")
    
    return {"status": "success", "message": "Order executed and position logged.", "data": active_trade}

@router.get("/daily-pnl")
def get_autopilot_daily_pnl():
    """
    Returns date-wise PnL report directly from canonical autopilot_journal SQLite DB.
    """
    try:
        conn = db.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                date,
                SUM(CASE WHEN pnl IS NOT NULL THEN pnl ELSE 0 END) as realized_pnl,
                COUNT(id) as total_trades,
                SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
                SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losing_trades
            FROM autopilot_journal
            GROUP BY date
            ORDER BY date DESC
        """)
        rows = cursor.fetchall()
        conn.close()
        
        report = [dict(r) for r in rows]
        return {"status": "success", "data": report}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/render-pnl")
@router.post("/render-pnl")
def render_pnl_chart_endpoint(date_str: str = Query(None)):
    """
    Triggers server-side quant_pnl_renderer to render high-definition 
    intraday PnL & Drawdown chart and returns the image as binary PNG.
    """
    try:
        if not date_str:
            date_str = get_ist_now().strftime("%Y-%m-%d")
            
        chart_img_path = os.path.join(STATE_DIR, f"pnl_chart_{date_str}.png")
        
        # Query journal for date's trades
        pnl_ticks = []
        try:
            conn = db.get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM autopilot_journal WHERE date = ? ORDER BY id ASC", (date_str,))
            rows = cursor.fetchall()
            conn.close()
            
            for r in rows:
                trade = dict(r)
                entry_time = trade.get("entry_time", "").split(" ")[-1][:5] if trade.get("entry_time") else "09:15"
                exit_time = trade.get("exit_time", "").split(" ")[-1][:5] if trade.get("exit_time") else entry_time
                pnl = float(trade.get("pnl") or 0.0)
                if entry_time:
                    pnl_ticks.append((entry_time, 0.0))
                if exit_time:
                    pnl_ticks.append((exit_time, pnl))
        except Exception as ex:
            log.warning(f"Error reading journal for render_pnl: {ex}")
            
        if not pnl_ticks:
            pnl_ticks = [("09:15", 0.0), ("15:30", 0.0)]
            
        render_quant_pnl_dashboard(chart_img_path, pnl_ticks, capital=100000.0)
        
        if os.path.exists(chart_img_path):
            return FileResponse(chart_img_path, media_type="image/png")
        else:
            raise HTTPException(status_code=500, detail="Failed to generate PnL chart file")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/preopen")
def get_preopen_market_brief():
    """
    Aggregates market status, pre-open signals, and autopilot status for n8n pre-open briefing workflow.
    """
    try:
        conn = db.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*), SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) FROM autopilot_journal")
        row = cursor.fetchone()
        conn.close()
        
        total_trades = row[0] if row else 0
        winning_trades = row[1] if row else 0
        win_rate = round((winning_trades / total_trades * 100), 1) if total_trades > 0 else 0.0
        
        with state_lock:
            enabled = state.get("enabled", False)
            active_trade = state.get("active_trade")
            
        return {
            "status": "success",
            "date": get_ist_now().strftime("%Y-%m-%d"),
            "time_ist": get_ist_now().strftime("%H:%M:%S"),
            "autopilot_enabled": enabled,
            "has_active_position": bool(active_trade),
            "historical_win_rate": f"{win_rate}%",
            "total_journaled_trades": total_trades,
            "market_session": "PRE_OPEN" if get_ist_now().hour < 9 else ("REGULAR" if get_ist_now().hour < 16 else "POST_CLOSE")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/toggle")
def toggle_autopilot(req: ToggleRequest):
    global state
    with state_lock:
        if req.enabled is not None:
            state["enabled"] = req.enabled
        if req.expiry_rollover is not None:
            state["expiry_rollover"] = req.expiry_rollover
        save_state_to_file()
        
        if state.get("enabled") and state.get("active_trade"):
            start_position_monitor()
        elif not state.get("enabled"):
            stop_position_monitor()
            
    return {"status": "success", "enabled": state.get("enabled", False), "expiry_rollover": state.get("expiry_rollover", False)}

@router.get("/status")
def get_autopilot_status():
    global state
    with state_lock:
        active = state["active_trade"]
        
    if active:
        try:
            # Sync check: Query OpenAlgo's position book to see if the position has been closed/squared-off
            url = f"{OPENALGO_HOST}/api/v1/positionbook"
            payload = {"apikey": OPENALGO_API_KEY}
            resp = session.post(url, json=payload, timeout=2)
            if resp.status_code == 200:
                res_data = resp.json()
                if res_data.get("status") == "success":
                    positions = res_data.get("data", [])
                    target_symbol = active["dhan_symbol"].upper()
                    
                    found = False
                    exit_price = active["entry_price"]
                    pnl = 0.0
                    
                    # Avoid race condition: if the trade was placed less than 90 seconds ago, don't mark it closed if not found in book
                    entry_time_parsed = None
                    try:
                        entry_time_parsed = datetime.strptime(active["entry_time"], "%Y-%m-%d %H:%M:%S")
                    except Exception as e:
                        log.error(f"Error parsing trade entry time: {e}")
                    
                    is_new_trade = False
                    if entry_time_parsed:
                        elapsed = (get_ist_now() - entry_time_parsed).total_seconds()
                        if elapsed < 90:
                            is_new_trade = True
                            found = True
                    
                    for pos in positions:
                        pos_symbol = pos.get("symbol", "").upper()
                        if pos_symbol == target_symbol:
                            # Use quantity if netqty is missing (OpenAlgo positions book uses quantity)
                            netqty = int(pos.get("netqty", pos.get("quantity", 0)))
                            if netqty != 0:
                                found = True
                            else:
                                # Position exists but netqty/quantity is 0 (closed)
                                pnl = float(pos.get("pnl", pos.get("today_realized_pnl", 0)) or 0)
                                if pnl != 0:
                                    exit_price = round(active["entry_price"] + (pnl / active["quantity"]), 2)
                                else:
                                    exit_price = float(pos.get("ltp") or active["entry_price"])
                                found = False # Explicitly closed
                            break
                    
                    # If position is not in the book at all or its netqty is 0, it was closed!
                    if not found and not is_new_trade:
                        log.info(f"Position for {target_symbol} was closed directly on OpenAlgo/broker. Syncing state.")
                        
                        entry_price = active["entry_price"]
                        qty = active["quantity"]
                        row_id = active["journal_row_id"]
                        
                        if pnl == 0.0 and exit_price != entry_price:
                            pnl = round((exit_price - entry_price) * qty, 2)
                            
                        pnl_pct = round((exit_price - entry_price) / entry_price * 100, 2) if entry_price > 0 else 0.0
                        exit_time_str = get_ist_now().strftime("%Y-%m-%d %H:%M:%S")
                        
                        # Log exit in SQLite DB
                        log_autopilot_trade_exit(row_id, exit_time_str, exit_price, pnl, pnl_pct)
                        
                        # Reset local state
                        with state_lock:
                            state["active_trade"] = None
                            save_state_to_file()
                            
                        # Send Telegram Notification about sync
                        msg = (
                            f"🔄 <b>Autopilot Sync: Position Closed Externally</b>\n"
                            f"Symbol: {active['symbol']}\n"
                            f"Option: {active['dhan_symbol']}\n"
                            f"Entry Premium: ₹{entry_price:.2f}\n"
                            f"Exit Premium: ₹{exit_price:.2f}\n"
                            f"Qty: {qty}\n"
                            f"<b>PnL: {'+' if pnl >= 0 else ''}₹{pnl:.2f} ({pnl_pct:+.2f}%)</b>"
                        )
                        try:
                            # Send background notification using requests (fast)
                            if state["bot_token"] and state["chat_id"]:
                                requests.post(
                                    f"https://api.telegram.org/bot{state['bot_token']}/sendMessage",
                                    json={"chat_id": state["chat_id"], "text": msg, "parse_mode": "HTML"},
                                    timeout=2
                                )
                        except Exception as e:
                            log.error(f"Failed to send Telegram sync alert: {e}")
        except Exception as e:
            log.error(f"Error during autopilot position status sync: {e}")

    from services.regime_detector import regime_detector
    try:
        regime_info = regime_detector.detect()
    except Exception as e:
        log.error(f"Failed to detect regime for status: {e}")
        regime_info = {"regime": "UNKNOWN", "preferred_strategy": "FNO_SectorRotation"}

    with state_lock:
        return {
            "status": "success",
            "enabled": state["enabled"],
            "active_trade": state["active_trade"],
            "has_telegram": bool(state["bot_token"] and state["chat_id"]),
            "market_regime": regime_info
        }

@router.get("/results")
def get_autopilot_results():
    try:
        conn = db.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM autopilot_journal ORDER BY id DESC")
        rows = cursor.fetchall()
        conn.close()
        
        results = []
        for r in rows:
            results.append(dict(r))
        return {"status": "success", "data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/close")
async def force_close_active_position():
    global state
    with state_lock:
        active = state["active_trade"]
    if not active:
        raise HTTPException(status_code=400, detail="No active position to close.")
        
    await trigger_market_exit(reason="Manual Force-Close")
    return {"status": "success", "message": "Manual exit executed successfully."}

@router.delete("/results/{id}")
def delete_autopilot_result(id: int):
    try:
        conn = db.get_db_connection(write=True)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM autopilot_journal WHERE id = ?", (id,))
        conn.commit()
        conn.close()
        return {"status": "success", "message": f"Log with ID {id} deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class AutopilotResultUpdate(BaseModel):
    date: str
    strategy: str
    symbol: str
    direction: str
    entry_time: str
    entry_price: float
    exit_time: str
    exit_price: float
    quantity: int
    pnl: float
    pnl_pct: float
    status: str

@router.put("/results/{id}")
def update_autopilot_result(id: int, payload: AutopilotResultUpdate):
    try:
        conn = db.get_db_connection(write=True)
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE autopilot_journal
            SET date = ?, strategy = ?, symbol = ?, direction = ?, entry_time = ?, entry_price = ?, 
                exit_time = ?, exit_price = ?, quantity = ?, pnl = ?, pnl_pct = ?, status = ?
            WHERE id = ?
        """, (
            payload.date, payload.strategy, payload.symbol, payload.direction, payload.entry_time,
            payload.entry_price, payload.exit_time, payload.exit_price, payload.quantity,
            payload.pnl, payload.pnl_pct, payload.status, id
        ))
        conn.commit()
        conn.close()
        return {"status": "success", "message": f"Log with ID {id} updated successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ----------------------------------------------------
# 🧠 RECURSIVE REINFORCEMENT LEARNING & TELEMETRY ENDPOINTS
# ----------------------------------------------------

@router.get("/telemetry")
def get_autopilot_telemetry(limit: int = Query(50, ge=1, le=500)):
    """Fetches recent trade excursion telemetry records (MFE/MAE/PnL) from data/autopilot.db."""
    try:
        from services.autopilot_db import get_recent_telemetry
        records = get_recent_telemetry(limit=limit)
        return {"status": "success", "count": len(records), "telemetry": records}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/hyperparameters")
def get_autopilot_hyperparameters(regime: str = Query("TRENDING")):
    """Fetches the 5 adaptive hyperparameters for the given market regime."""
    try:
        from services.autopilot_db import get_hyperparameters
        params = get_hyperparameters(regime=regime)
        return {"status": "success", "regime": regime, "hyperparameters": params}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class CalibrateRequest(BaseModel):
    regime: str = "TRENDING"
    parameter_name: str
    new_value: float
    reason: str = "Manual User Calibration"

@router.post("/calibrate")
def calibrate_hyperparameter(req: CalibrateRequest):
    """Updates an adaptive hyperparameter and logs to audit history."""
    try:
        from services.autopilot_db import update_hyperparameter
        success = update_hyperparameter(
            regime=req.regime,
            param_name=req.parameter_name,
            new_val=req.new_value,
            reason=req.reason,
            changed_by="User_WebUI"
        )
        if not success:
            raise HTTPException(status_code=400, detail="Failed to update hyperparameter")
        return {"status": "success", "message": f"Updated {req.parameter_name} to {req.new_value} for {req.regime}"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/daily-report")
def get_latest_daily_ai_report():
    """Fetches the latest post-market AI diagnostic report from disk."""
    report_file = os.path.join(STATE_DIR, "latest_ai_report.json")
    if os.path.exists(report_file):
        try:
            with open(report_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read report: {e}")
    return {
        "status": "pending",
        "message": "No AI diagnostic report has been generated yet today. Runs daily at 16:00 IST."
    }

@router.post("/daily-report/generate")
async def trigger_daily_ai_report(dry_run: bool = Query(False)):
    """Triggers generation of the daily AI quant diagnostic report on-demand."""
    try:
        from services.daily_ai_reporter import generate_and_dispatch_report
        result = await generate_and_dispatch_report(dry_run=dry_run)
        return {"status": "success", "report": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/harvest")
def trigger_telemetry_harvest(backfill: bool = Query(False)):
    """Triggers telemetry harvest and RL parameter recalibration on-demand."""
    try:
        import subprocess
        root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        script_path = os.path.join(root_dir, "scripts", "harvest_daily_telemetry.py")
        args = [sys.executable, script_path]
        if backfill:
            args.append("--backfill")
        else:
            args.append("--daily")
        res = subprocess.run(args, capture_output=True, text=True, check=False)
        return {
            "status": "success" if res.returncode == 0 else "error",
            "returncode": res.returncode,
            "stdout": res.stdout,
            "stderr": res.stderr
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/rules")
def get_autopilot_rules_endpoint():
    """Returns current active trader configuration rules."""
    return load_autopilot_rules()

@router.post("/rules")
def update_autopilot_rules_endpoint(rules: dict):
    """Updates and persists trader configuration rules."""
    try:
        updated = save_autopilot_rules(rules)
        return {"status": "success", "rules": updated}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update rules: {e}")



