from logger import get_logger
log = get_logger("alpha_router", tag="ALPHA")

import os
import sys
import time
import json
from datetime import datetime, timedelta, timezone
import re
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel

# Ensure python-bridge root is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
import pattern_engine
from routers.shared import upstox_client, sanitize_symbol

router = APIRouter()

# Global state to track background jobs progress
ore_progress = {
    "is_running": False,
    "total": 0,
    "current": 0,
    "current_symbol": "",
    "error_count": 0,
    "completed_at": None
}

rs_progress = {
    "is_running": False,
    "total": 0,
    "current": 0,
    "current_symbol": "",
    "error_count": 0,
    "completed_at": None
}

pattern_progress = {
    "is_running": False,
    "total": 0,
    "current": 0,
    "current_symbol": "",
    "error_count": 0,
    "completed_at": None
}

shareholding_progress = {
    "is_running": False,
    "total": 0,
    "current": 0,
    "current_symbol": "",
    "error_count": 0,
    "completed_at": None
}

class AlphaBatchRequest(BaseModel):
    symbols: List[str]

def parse_time(time_str):
    try:
        t_part = time_str.split("+")[0]
        return datetime.strptime(t_part, "%Y-%m-%dT%H:%M:%S")
    except Exception:
        return datetime.fromisoformat(time_str)

# --- OPENING RANGE EXPANSION (ORE) ---

def compute_ore_score_sync(symbol: str) -> dict:
    symbol = sanitize_symbol(symbol)
    
    # 1. Resolve Instrument Key
    key = db.get_upstox_instrument_key(symbol, exchange="NSE_EQ") or db.get_upstox_instrument_key(symbol)
    if not key:
        raise ValueError(f"Instrument key not found for symbol: {symbol}")
        
    today_str = datetime.now().strftime("%Y-%m-%d")
    
    # 2. Check if already cached
    cached = db.get_cached_ore(symbol, today_str)
    if cached:
        return {
            "symbol": cached["symbol"],
            "date": cached["date"],
            "ore_score": cached["ore_score"],
            "direction": cached["direction"],
            "bsr": round(cached["bsr"], 4),
            "vs": round(cached["vs"], 4),
            "cd": round(cached["cd"], 4),
            "compression": round(cached["compression"], 4),
            "computed_at": cached["computed_at"]
        }

    # 3. Fetch 1-minute intraday candles
    res_candles = upstox_client.get_intraday_candles(key, interval="1minute")
    if res_candles.get("status") != "success" or "data" not in res_candles or "candles" not in res_candles["data"]:
        raise ValueError(f"Failed to fetch intraday candles for {symbol}: {res_candles.get('message', 'Unknown error')}")
        
    candles = res_candles["data"]["candles"]
    if not candles:
        raise ValueError(f"Empty intraday candles returned for {symbol}")

    # 4. Fetch daily candles to compute rolling 5-day ATR and 20-day average volume
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=40)).strftime("%Y-%m-%d")
    res_daily = upstox_client.get_historical_candles(key, "day", end_date, start_date)
    if res_daily.get("status") != "success" or "data" not in res_daily or "candles" not in res_daily["data"]:
        raise ValueError(f"Failed to fetch daily historical candles for {symbol}")
        
    daily_candles = res_daily["data"]["candles"]
    if not daily_candles:
        raise ValueError(f"Empty daily candles returned for {symbol}")
        
    # Calculate rolling 5-day ATR
    prev_5day_candles = []
    for dc in daily_candles:
        dc_date = dc[0].split("T")[0]
        if dc_date < today_str:
            prev_5day_candles.append(dc)
        if len(prev_5day_candles) == 5:
            break
            
    tr_values = []
    for i in range(len(prev_5day_candles)):
        h = float(prev_5day_candles[i][2])
        l = float(prev_5day_candles[i][3])
        if i < len(prev_5day_candles) - 1:
            pc = float(prev_5day_candles[i+1][4])
            tr = max(h - l, abs(h - pc), abs(l - pc))
        else:
            tr = h - l
        tr_values.append(tr)
        
    atr_5d = sum(tr_values) / len(tr_values) if tr_values else (float(daily_candles[0][4]) * 0.03)

    # Calculate 20-day average volume
    prev_20day_candles = []
    for dc in daily_candles:
        dc_date = dc[0].split("T")[0]
        if dc_date < today_str:
            prev_20day_candles.append(dc)
        if len(prev_20day_candles) == 20:
            break
    avg_vol_20d = sum(float(dc[5]) for dc in prev_20day_candles) / len(prev_20day_candles) if prev_20day_candles else 1.0

    # 5. Isolate pre-open candles (9:00 - 9:14 AM)
    pre_open_candles = []
    for c in candles:
        dt = parse_time(c[0])
        if dt.hour == 9 and 0 <= dt.minute < 15:
            pre_open_candles.append(c)
            
    tr_sum = 0
    for c in pre_open_candles:
        tr_sum += float(c[2]) - float(c[3])
    pre_open_atr = tr_sum / len(pre_open_candles) if pre_open_candles else (atr_5d * 0.05)

    # 6. Isolate the 9:15 - 9:30 AM candles
    range_candles = []
    for c in candles:
        dt = parse_time(c[0])
        if dt.hour == 9 and 15 <= dt.minute < 30:
            range_candles.append(c)
            
    if not range_candles:
        open_val = float(candles[-1][1])
        close_val = float(candles[0][4])
        high_val = max(float(c[2]) for c in candles)
        low_val = min(float(c[3]) for c in candles)
        candle_volume = sum(float(c[5]) for c in candles)
    else:
        range_candles = sorted(range_candles, key=lambda x: x[0])
        open_val = float(range_candles[0][1])
        close_val = float(range_candles[-1][4])
        high_val = max(float(c[2]) for c in range_candles)
        low_val = min(float(c[3]) for c in range_candles)
        candle_volume = sum(float(c[5]) for c in range_candles)

    # 7. Compute ORE metrics
    bsr = abs(open_val - close_val) / atr_5d if atr_5d > 0 else 0.0
    bsr_score = min(bsr, 1.0)
    
    vs = candle_volume / (avg_vol_20d * (15.0 / 390.0)) if avg_vol_20d > 0 else 0.0
    vs_score = min(vs, 1.0)
    
    denom = high_val - low_val
    cd = abs(open_val - close_val) / denom if denom > 0 else 0.0
    cd_score = min(cd, 1.0)
    
    comp_ratio = pre_open_atr / atr_5d if atr_5d > 0 else 0.0
    compression_score = 1.0 - min(comp_ratio, 1.0)

    # ORE composite score
    ore_score = (bsr_score * 0.30) + (vs_score * 0.40) + (cd_score * 0.20) + (compression_score * 0.10)
    ore_score = round(min(max(ore_score, 0.0), 1.0), 4)

    # Direction is valid only if score > 0.70
    if ore_score > 0.70:
        direction = "BULLISH" if close_val > open_val else "BEARISH"
    else:
        direction = "NEUTRAL"

    # Save to SQLite Cache
    db.save_ore(symbol, today_str, ore_score, direction, bsr_score, vs_score, cd_score, compression_score)
    
    return {
        "symbol": symbol,
        "date": today_str,
        "ore_score": ore_score,
        "direction": direction,
        "bsr": round(bsr_score, 4),
        "vs": round(vs_score, 4),
        "cd": round(cd_score, 4),
        "compression": round(compression_score, 4),
        "computed_at": datetime.now().isoformat()
    }

def run_ore_batch_sync(symbols: List[str]):
    global ore_progress
    ore_progress["is_running"] = True
    ore_progress["total"] = len(symbols)
    ore_progress["current"] = 0
    ore_progress["error_count"] = 0
    ore_progress["completed_at"] = None

    for symbol in symbols:
        if not ore_progress["is_running"]:
            break
        symbol = sanitize_symbol(symbol)
        ore_progress["current_symbol"] = symbol
        try:
            compute_ore_score_sync(symbol)
        except Exception as e:
            log.error(f"Failed to compute ORE for {symbol}: {e}")
            ore_progress["error_count"] += 1
        ore_progress["current"] += 1
        # Throttle strictly to prevent rate limiting (300ms)
        time.sleep(0.3)
        
    ore_progress["is_running"] = False
    ore_progress["current_symbol"] = ""
    ore_progress["completed_at"] = datetime.now().isoformat()

@router.post("/api/alpha/ore/batch")
def trigger_ore_batch(payload: AlphaBatchRequest, background_tasks: BackgroundTasks):
    if ore_progress["is_running"]:
        return {"status": "error", "message": "An ORE batch scan is already running."}
    background_tasks.add_task(run_ore_batch_sync, payload.symbols)
    return {"status": "success", "message": "ORE batch computation started in background"}

@router.get("/api/alpha/ore/progress")
def get_ore_progress():
    return ore_progress

@router.get("/api/alpha/ore")
def get_ore_single(symbol: str = Query(...)):
    try:
        data = compute_ore_score_sync(symbol)
        return {"status": "success", "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/alpha/ore/all")
def get_ore_all(date: str = Query(None)):
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")
    try:
        data = db.get_all_cached_ore(date)
        return {"status": "success", "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- RELATIVE STRENGTH RANK (RSR) ---

def run_rs_rank_sync(symbols: List[str]):
    global rs_progress
    rs_progress["is_running"] = True
    rs_progress["total"] = len(symbols)
    rs_progress["current"] = 0
    rs_progress["error_count"] = 0
    rs_progress["completed_at"] = None

    today_str = datetime.now().strftime("%Y-%m-%d")
    nifty_key = db.get_upstox_instrument_key("NIFTY 50") or db.get_upstox_instrument_key("NIFTY_50") or "NSE_INDEX|Nifty 50"
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=120)).strftime("%Y-%m-%d")
    
    try:
        nifty_candles_res = upstox_client.get_historical_candles(nifty_key, "day", end_date, start_date)
        if nifty_candles_res.get("status") != "success" or "candles" not in nifty_candles_res.get("data", {}):
            raise ValueError("Failed to fetch Nifty candles")
        nifty_candles = nifty_candles_res["data"]["candles"]
        if not nifty_candles:
            raise ValueError("Nifty candles empty")
            
        nifty_closes = [float(c[4]) for c in nifty_candles] # Index 0 is newest
        n_1m = min(20, len(nifty_closes) - 1)
        n_3m = min(60, len(nifty_closes) - 1)
        n_ret_1m = (nifty_closes[0] - nifty_closes[n_1m]) / nifty_closes[n_1m] if nifty_closes[n_1m] > 0 else 0.0
        n_ret_3m = (nifty_closes[0] - nifty_closes[n_3m]) / nifty_closes[n_3m] if nifty_closes[n_3m] > 0 else 0.0
    except Exception as e:
        log.error(f"Failed to fetch Nifty benchmark: {e}")
        rs_progress["is_running"] = False
        return

    scores = {}
    for symbol in symbols:
        if not rs_progress["is_running"]:
            break
        symbol = sanitize_symbol(symbol)
        rs_progress["current_symbol"] = symbol
        
        try:
            key = db.get_upstox_instrument_key(symbol, exchange="NSE_EQ") or db.get_upstox_instrument_key(symbol)
            if not key:
                raise ValueError("Instrument key not found")
                
            res = upstox_client.get_historical_candles(key, "day", end_date, start_date)
            if res.get("status") == "success" and "candles" in res.get("data", {}):
                candles = res["data"]["candles"]
                if candles:
                    closes = [float(c[4]) for c in candles] # Index 0 is newest
                    idx_1m = min(20, len(closes) - 1)
                    idx_3m = min(60, len(closes) - 1)
                    
                    ret_1m = (closes[0] - closes[idx_1m]) / closes[idx_1m] if closes[idx_1m] > 0 else 0.0
                    ret_3m = (closes[0] - closes[idx_3m]) / closes[idx_3m] if closes[idx_3m] > 0 else 0.0
                    
                    rs_1m = ret_1m - n_ret_1m
                    rs_3m = ret_3m - n_ret_3m
                    
                    rs_score = (rs_1m * 0.5) + (rs_3m * 0.5)
                    scores[symbol] = rs_score
                else:
                    raise ValueError("Empty candles")
            else:
                raise ValueError("API call failed")
        except Exception as e:
            log.error(f"Failed for {symbol}: {e}")
            rs_progress["error_count"] += 1
            
        rs_progress["current"] += 1
        time.sleep(0.3)
        
    # Percentile ranking
    if scores:
        import pandas as pd
        df_rs = pd.DataFrame(list(scores.items()), columns=["symbol", "score"])
        df_rs["rank"] = df_rs["score"].rank(pct=True) * 100.0
        
        for _, row in df_rs.iterrows():
            sym = row["symbol"]
            score = float(row["score"])
            rank = float(row["rank"])
            category = "NEUTRAL"
            if rank >= 90.0:
                category = "LEADER"
            elif rank <= 10.0:
                category = "LAGGARD"
                
            db.save_rs_rank(sym, score, rank, category, today_str)
            
    rs_progress["is_running"] = False
    rs_progress["current_symbol"] = ""
    rs_progress["completed_at"] = datetime.now().isoformat()

@router.post("/api/alpha/rs-rank/sync")
def trigger_rs_rank_sync(payload: AlphaBatchRequest, background_tasks: BackgroundTasks):
    if rs_progress["is_running"]:
        return {"status": "error", "message": "An RSR sync job is already running."}
    background_tasks.add_task(run_rs_rank_sync, payload.symbols)
    return {"status": "success", "message": "RSR sync job started in background"}

@router.get("/api/alpha/rs-rank/progress")
def get_rs_progress_status():
    return rs_progress

@router.get("/api/alpha/rs-rank")
def get_rs_rank_single(symbol: str = Query(...), date: str = Query(None)):
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")
    try:
        data = db.get_cached_rs_rank(symbol, date)
        if not data:
            raise HTTPException(status_code=404, detail=f"No RS Rank cached for {symbol} on {date}")
        return {"status": "success", "data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/alpha/rs-rank/all")
def get_rs_rank_all(date: str = Query(None)):
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")
    try:
        data = db.get_all_cached_rs_ranks(date)
        return {"status": "success", "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- CANDLE PATTERN RECOGNITION ---

def run_pattern_scan_sync(symbols: List[str]):
    global pattern_progress
    pattern_progress["is_running"] = True
    pattern_progress["total"] = len(symbols)
    pattern_progress["current"] = 0
    pattern_progress["error_count"] = 0
    pattern_progress["completed_at"] = None

    today_str = datetime.now().strftime("%Y-%m-%d")
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=40)).strftime("%Y-%m-%d")
    
    # Resolve StockeZee proxy folders and file paths
    bridge_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    perday_path = os.path.join(bridge_dir, "Extras", "Stockezee structure", "perday.json")
    perweek_path = os.path.join(bridge_dir, "Extras", "Stockezee structure", "perweek.json")
    
    proxy_daily = {}
    proxy_weekly = {}
    proxy_tracked_symbols = set()
    
    # Reliability mapping for assigning a score to proxy patterns
    reliability_scores = {
        "bullish engulfing": 0.85,
        "bearish engulfing": 0.85,
        "morning star": 0.90,
        "evening star": 0.90,
        "three white soldiers": 0.90,
        "three black crows": 0.90,
        "hammer": 0.80,
        "inverted hammer": 0.80,
        "piercing line": 0.80,
        "dark cloud cover": 0.80,
        "dragonfly doji": 0.80,
        "gravestone doji": 0.80,
        "doji": 0.70,
        "spinning top": 0.60,
        "bearish marubozu": 0.80,
        "bullish marubozu": 0.80,
        "bearish harami": 0.75,
        "bullish harami": 0.75,
        "long-legged doji": 0.70,
        "bullish tasuki gap": 0.80,
    }
    
    # 1. Read all proxy files in the folder to compile the set of symbols tracked by the proxy
    stockezee_folder = os.path.join(bridge_dir, "Extras", "Stockezee structure")
    if os.path.exists(stockezee_folder):
        files_to_check = ["perday.json", "perweek.json", "topgainers=day.json", "toploosers=day.json", "fno.json", "tg.json"]
        for filename in files_to_check:
            filepath = os.path.join(stockezee_folder, filename)
            if os.path.exists(filepath):
                try:
                    with open(filepath, 'r') as f:
                        content = json.load(f)
                    
                    data = content.get("data", {})
                    if isinstance(data, dict):
                        for val in data.values():
                            if isinstance(val, list):
                                for item in val:
                                    if isinstance(item, dict) and "symbol_name" in item:
                                        proxy_tracked_symbols.add(item["symbol_name"].upper().strip())
                                        
                    result_data = content.get("resultData", []) if isinstance(content, dict) else content
                    if isinstance(result_data, list):
                        for item in result_data:
                            if isinstance(item, dict):
                                sym = item.get("symbol_name") or item.get("symbol") or item.get("Symbol")
                                if sym:
                                    proxy_tracked_symbols.add(str(sym).upper().strip())
                    elif isinstance(result_data, dict):
                        for val in result_data.values():
                            if isinstance(val, list):
                                for item in val:
                                    if isinstance(item, dict):
                                        sym = item.get("symbol_name") or item.get("symbol") or item.get("Symbol")
                                        if sym:
                                            proxy_tracked_symbols.add(str(sym).upper().strip())
                except Exception as e:
                    log.info(f"Error indexing {filename} for tracking: {e}")

    # 2. Parse daily patterns from perday.json
    if os.path.exists(perday_path):
        try:
            with open(perday_path, 'r') as f:
                daily_content = json.load(f)
            daily_data = daily_content.get("data", {})
            for key, items in daily_data.items():
                if key == "available_pattens" or not isinstance(items, list):
                    continue
                score = reliability_scores.get(key.lower(), 0.75)
                for item in items:
                    sym = item.get("symbol_name", "").upper().strip()
                    pattern_type = item.get("pattern_type", "")
                    if sym and pattern_type:
                        if sym not in proxy_daily:
                            proxy_daily[sym] = {"patterns": [], "max_score": 0.0}
                        proxy_daily[sym]["patterns"].append(pattern_type)
                        proxy_daily[sym]["max_score"] = max(proxy_daily[sym]["max_score"], score)
                        proxy_tracked_symbols.add(sym)
        except Exception as e:
            log.info(f"Error loading daily patterns: {e}")

    # 3. Parse weekly patterns from perweek.json for confirmation
    if os.path.exists(perweek_path):
        try:
            with open(perweek_path, 'r') as f:
                weekly_content = json.load(f)
            weekly_data = weekly_content.get("data", {})
            for key, items in weekly_data.items():
                if key == "available_pattens" or not isinstance(items, list):
                    continue
                score = reliability_scores.get(key.lower(), 0.75)
                for item in items:
                    sym = item.get("symbol_name", "").upper().strip()
                    pattern_type = item.get("pattern_type", "")
                    if sym and pattern_type:
                        if sym not in proxy_weekly:
                            proxy_weekly[sym] = {"patterns": [], "max_score": 0.0}
                        proxy_weekly[sym]["patterns"].append(pattern_type)
                        proxy_weekly[sym]["max_score"] = max(proxy_weekly[sym]["max_score"], score)
                        proxy_tracked_symbols.add(sym)
        except Exception as e:
            log.info(f"Error loading weekly patterns: {e}")

    for symbol in symbols:
        if not pattern_progress["is_running"]:
            break
        symbol = sanitize_symbol(symbol)
        pattern_progress["current_symbol"] = symbol
        
        is_manual_scanned = False
        try:
            # Check if stock is in proxy daily patterns
            if symbol in proxy_daily:
                patterns = proxy_daily[symbol]["patterns"]
                max_score = proxy_daily[symbol]["max_score"]
                
                # Check for weekly confirmation (if same pattern is present in weekly too)
                weekly_patterns = proxy_weekly.get(symbol, {}).get("patterns", [])
                confirmed_patterns = []
                for p in patterns:
                    if p in weekly_patterns:
                        confirmed_patterns.append(f"{p} (Confirmed)")
                        max_score = min(1.0, max_score + 0.15)  # Boost score reflecting higher conviction
                    else:
                        confirmed_patterns.append(p)
                        
                patterns_str = ",".join(confirmed_patterns)
                pattern_score = round(max_score, 2)
                db.save_pattern(symbol, patterns_str, pattern_score, today_str)
                
            elif symbol in proxy_tracked_symbols:
                # Tracked by proxy but has no patterns today
                db.save_pattern(symbol, "", 0.0, today_str)
                
            else:
                # Backup manual calculation for untracked stocks
                key = db.get_upstox_instrument_key(symbol, exchange="NSE_EQ") or db.get_upstox_instrument_key(symbol)
                if not key:
                    raise ValueError("Key not found")
                    
                # Get 20-day average volume
                vol_avg_data = db.get_upstox_volume_avg(symbol)
                vol_avg_20d = vol_avg_data.get("avg_volume_20d", 1.0) if vol_avg_data else 1.0
                
                res = upstox_client.get_historical_candles(key, "day", end_date, start_date)
                if res.get("status") == "success" and "candles" in res.get("data", {}):
                    candles = res["data"]["candles"]
                    if candles:
                        candles_chrono = list(reversed(candles))
                        lows = [float(c[3]) for c in candles]
                        support_level = min(lows) if lows else None
                        
                        scan_res = pattern_engine.scan_all_patterns(candles_chrono, vol_avg_20d, support_level)
                        patterns_str = ",".join(scan_res["patterns"])
                        pattern_score = scan_res["pattern_score"]
                        
                        db.save_pattern(symbol, patterns_str, pattern_score, today_str)
                        is_manual_scanned = True
                    else:
                        raise ValueError("Empty candles")
                else:
                    raise ValueError("API call failed")
        except Exception as e:
            log.error(f"Failed for {symbol}: {e}")
            pattern_progress["error_count"] += 1
            
        pattern_progress["current"] += 1
        if is_manual_scanned:
            time.sleep(0.3)  # Sleep only when hitting Upstox API
        
    pattern_progress["is_running"] = False
    pattern_progress["current_symbol"] = ""
    pattern_progress["completed_at"] = datetime.now().isoformat()

@router.post("/api/alpha/pattern-scan")
def trigger_pattern_scan(payload: AlphaBatchRequest, background_tasks: BackgroundTasks):
    if pattern_progress["is_running"]:
        return {"status": "error", "message": "A pattern scan job is already running."}
    background_tasks.add_task(run_pattern_scan_sync, payload.symbols)
    return {"status": "success", "message": "Pattern scan job started in background"}

@router.get("/api/alpha/pattern-scan/progress")
def get_pattern_progress_status():
    return pattern_progress

@router.get("/api/alpha/pattern-scan")
def get_pattern_single(symbol: str = Query(...), date: str = Query(None)):
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")
    try:
        data = db.get_cached_pattern(symbol, date)
        if not data:
            raise HTTPException(status_code=404, detail=f"No patterns cached for {symbol} on {date}")
        return {"status": "success", "data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def check_proxy_date_warning() -> str:
    """
    Checks the date inside perday.json and compares it to today's date in IST.
    If the date is different or if the file cannot be loaded, returns a warning string.
    Otherwise, returns empty string.
    """
    try:
        bridge_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        perday_path = os.path.join(bridge_dir, "Extras", "Stockezee structure", "perday.json")
        if not os.path.exists(perday_path):
            return "Candlestick pattern data is missing. Please run Warm Caches."
        
        with open(perday_path, 'r') as f:
            content = json.load(f)
        
        message = content.get("message", "")
        # Extract date from message (e.g. "2026-05-08 patterns fetched successfully")
        match = re.search(r"\d{4}-\d{2}-\d{2}", message)
        if not match:
            return "Candlestick pattern date could not be parsed. Please update the data."
        
        file_date_str = match.group(0)
        file_date = datetime.strptime(file_date_str, "%Y-%m-%d").date()
        
        # IST is UTC + 5:30
        ist_tz = timezone(timedelta(hours=5, minutes=30))
        today_ist = datetime.now(ist_tz).date()
        
        if file_date != today_ist:
            return f"Candlestick pattern data is old (Data Date: {file_date_str}, Today: {today_ist.strftime('%Y-%m-%d')}). Please update the data."
    except Exception as e:
        return f"Failed to validate candlestick pattern date: {str(e)}"
    return ""

@router.get("/api/alpha/pattern-scan/all")
def get_pattern_all(date: str = Query(None)):
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")
    try:
        data = db.get_all_cached_patterns(date)
        warning = check_proxy_date_warning()
        return {"status": "success", "data": data, "warning": warning}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- SHAREHOLDING VELOCITY ---

def parse_shareholding_velocity_data(data: list) -> dict:
    fii_hist = []
    other_dii_hist = []
    mf_hist = []
    
    for item in data:
        cat = item.get("category", "")
        hist = item.get("history", [])
        if cat == "fii":
            fii_hist = hist
        elif cat == "other_dii":
            other_dii_hist = hist
        elif cat == "mutual_funds":
            mf_hist = hist
            
    fii_vel = 0.0
    if len(fii_hist) >= 2:
        fii_vel = float(fii_hist[0].get("value", 0.0)) - float(fii_hist[1].get("value", 0.0))
        
    dii_vel = 0.0
    if len(other_dii_hist) >= 2 and len(mf_hist) >= 2:
        curr_dii = float(other_dii_hist[0].get("value", 0.0)) + float(mf_hist[0].get("value", 0.0))
        prev_dii = float(other_dii_hist[1].get("value", 0.0)) + float(mf_hist[1].get("value", 0.0))
        dii_vel = curr_dii - prev_dii
    elif len(other_dii_hist) >= 2:
        dii_vel = float(other_dii_hist[0].get("value", 0.0)) - float(other_dii_hist[1].get("value", 0.0))
    elif len(mf_hist) >= 2:
        dii_vel = float(mf_hist[0].get("value", 0.0)) - float(mf_hist[1].get("value", 0.0))
        
    flag = "NEUTRAL"
    if fii_vel > 0.1:
        flag = "ACCUMULATING"
    elif fii_vel < -0.1:
        flag = "EXITING"
        
    return {
        "fii_velocity": round(fii_vel, 4),
        "dii_velocity": round(dii_vel, 4),
        "accumulation_flag": flag
    }

def run_shareholding_velocity_sync(symbols: List[str]):
    global shareholding_progress
    shareholding_progress["is_running"] = True
    shareholding_progress["total"] = len(symbols)
    shareholding_progress["current"] = 0
    shareholding_progress["error_count"] = 0
    shareholding_progress["completed_at"] = None

    for symbol in symbols:
        if not shareholding_progress["is_running"]:
            break
        symbol = sanitize_symbol(symbol)
        shareholding_progress["current_symbol"] = symbol
        
        try:
            # Check 7-day cache
            cached = db.get_cached_shareholding_velocity(symbol)
            if cached:
                try:
                    fetched_at = datetime.fromisoformat(cached["fetched_at"])
                    if (datetime.now() - fetched_at).days < 7:
                        shareholding_progress["current"] += 1
                        continue
                except Exception:
                    pass

            # Resolve ISIN
            conn = db.get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT isin FROM upstox_instruments WHERE symbol = ? AND isin IS NOT NULL AND isin != '' LIMIT 1", (symbol.upper().strip(),))
            row = cursor.fetchone()
            isin = row["isin"] if row else None
            conn.close()
            
            if not isin:
                raise ValueError(f"ISIN not found for {symbol}")
                
            res = upstox_client.get_shareholdings(isin)
            if res.get("status") == "success" and "data" in res and isinstance(res["data"], list):
                metrics = parse_shareholding_velocity_data(res["data"])
                db.save_shareholding_velocity(
                    symbol, 
                    isin, 
                    metrics["fii_velocity"], 
                    metrics["dii_velocity"], 
                    metrics["accumulation_flag"]
                )
            else:
                raise ValueError(f"API call failed: {res.get('message', 'Unknown error')}")
        except Exception as e:
            log.error(f"Failed for {symbol}: {e}")
            shareholding_progress["error_count"] += 1
            
        shareholding_progress["current"] += 1
        time.sleep(1.0) # Throttled to 1s to respect limits
        
    shareholding_progress["is_running"] = False
    shareholding_progress["current_symbol"] = ""
    shareholding_progress["completed_at"] = datetime.now().isoformat()

@router.post("/api/alpha/shareholding-velocity/sync")
def trigger_shareholding_sync(payload: AlphaBatchRequest, background_tasks: BackgroundTasks):
    if shareholding_progress["is_running"]:
        return {"status": "error", "message": "A shareholding velocity sync job is already running."}
    background_tasks.add_task(run_shareholding_velocity_sync, payload.symbols)
    return {"status": "success", "message": "Shareholding velocity sync job started in background"}

@router.get("/api/alpha/shareholding-velocity/progress")
def get_shareholding_progress_status():
    return shareholding_progress

@router.get("/api/alpha/shareholding-velocity")
def get_shareholding_single(symbol: str = Query(...)):
    try:
        data = db.get_cached_shareholding_velocity(symbol)
        if not data:
            raise HTTPException(status_code=404, detail=f"No shareholding velocity cached for {symbol}")
        return {"status": "success", "data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/alpha/shareholding-velocity/all")
def get_shareholding_all():
    try:
        data = db.get_all_cached_shareholding_velocities()
        return {"status": "success", "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- HEADLESS ALPHA DAEMON & PRE-COMPUTED SNAPSHOT ENDPOINTS ---

class DaemonToggleRequest(BaseModel):
    enabled: bool

@router.get("/api/alpha/snapshot")
def get_alpha_snapshot():
    """
    Returns the pre-computed institutional Alpha Engine snapshot
    generated by the Headless Alpha Daemon. Enables zero-freeze,
    sub-30ms hydration on tab mount with dual-fallback to cache.db.
    """
    snapshot_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "alpha_snapshot.json")
    if os.path.exists(snapshot_path):
        try:
            with open(snapshot_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {"status": "success", "data": data, "cached": True}
        except Exception as e:
            log.warning(f"Failed to read alpha_snapshot.json, falling back to cache.db: {e}")

    # Fallback to SQLite cache.db market_snapshots
    try:
        snap_rec = db.get_market_snapshot("alpha_engine", "upstox", "screener_snapshot")
        if snap_rec and snap_rec.get("payload"):
            return {"status": "success", "data": snap_rec["payload"], "cached": True, "source": "cache.db"}
    except Exception as db_err:
        log.error(f"Failed to read fallback snapshot from cache.db: {db_err}")

    return {"status": "pending", "data": None, "message": "Headless daemon snapshot initializing"}

@router.get("/api/alpha/cash-snapshot")
def get_cash_snapshot():
    """
    Returns the pre-computed Cash Engine 2.0 snapshot for ~660 liquid NSE Cash equities.
    Generated by services/cash_daemon.py with Upstox 500-symbol batching.
    Enables zero-freeze, sub-25ms hydration on tab mount.
    """
    snapshot_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "cash_snapshot.json")
    if os.path.exists(snapshot_path):
        try:
            with open(snapshot_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if data and data.get("stocks"):
                return {"status": "success", "data": data, "cached": True}
        except Exception as e:
            log.warning(f"Failed to read cash_snapshot.json: {e}")

    # Fallback on demand if snapshot file does not exist yet
    try:
        from services.cash_daemon import get_cash_daemon
        daemon = get_cash_daemon()
        data = daemon.generate_snapshot()
        return {"status": "success", "data": data, "cached": False}
    except Exception as e:
        log.error(f"Failed to generate cash snapshot on-demand: {e}")
        return {"status": "error", "data": None, "message": str(e)}

@router.get("/api/alpha/upstox-5m-candles")
def get_upstox_5m_candles(symbol: str = Query(..., description="NSE Cash Equity Symbol")):
    """
    Fetches today's intraday 5-minute candles and evaluates live Upstox reality checks:
    - Distance to High of Day (HOD)
    - Anti-dump HOD retention (ltp >= high * 0.985)
    - VWAP defense alignment (ltp >= vwap)
    - Multi-candle dump detection
    - Veto reasons for instant rejection
    """
    clean_sym = sanitize_symbol(symbol).upper()
    key = db.get_upstox_instrument_key(clean_sym, exchange="NSE_EQ") or db.get_upstox_instrument_key(clean_sym)
    if not key:
        raise HTTPException(status_code=404, detail=f"Instrument key not found for {clean_sym}")

    today_str = datetime.now().strftime("%Y-%m-%d")
    candles = []
    try:
        res = upstox_client.get_intraday_candles(key, interval="5minute")
        if res.get("status") == "success" and "data" in res and "candles" in res["data"]:
            candles = res["data"]["candles"]
    except Exception as e:
        log.warning(f"Failed to fetch intraday 5m candles for {clean_sym}: {e}")

    # Fallback to historical 5m if intraday is empty (e.g. after hours or pre-open)
    if not candles:
        try:
            res_hist = upstox_client.get_historical_candles(key, "5minute", today_str, today_str)
            if res_hist.get("status") == "success" and "data" in res_hist and "candles" in res_hist["data"]:
                candles = res_hist["data"]["candles"]
        except Exception:
            pass

    if not candles:
        return {
            "status": "warning",
            "symbol": clean_sym,
            "instrument_key": key,
            "candles": [],
            "hod_distance_pct": 0.0,
            "hod_retained": True,
            "vwap_aligned": True,
            "is_dumping": False,
            "veto_reasons": [],
            "passed_checks": True,
            "message": "No 5m candles available yet for today"
        }

    # Candles from Upstox are sorted newest first: [timestamp, open, high, low, close, volume, oi]
    # Reverse to chronological order (oldest to newest)
    chrono_candles = list(reversed(candles))
    latest = chrono_candles[-1]
    ltp = float(latest[4])
    day_high = max(float(c[2]) for c in chrono_candles)
    day_low = min(float(c[3]) for c in chrono_candles)
    total_vol = sum(float(c[5]) for c in chrono_candles)
    total_val = sum(((float(c[1]) + float(c[2]) + float(c[3]) + float(c[4])) / 4.0) * float(c[5]) for c in chrono_candles)
    vwap = round(total_val / total_vol, 2) if total_vol > 0 else ltp

    hod_dist_pct = round(((day_high - ltp) / day_high) * 100, 2) if day_high > 0 else 0.0
    hod_retained = ltp >= (day_high * 0.985)
    vwap_aligned = ltp >= (vwap * 0.998)

    # 9-EMA calculation across 5m closes
    ema_9 = ltp
    if len(chrono_candles) >= 1:
        multiplier = 2.0 / (9 + 1)
        ema = float(chrono_candles[0][4])
        for c in chrono_candles[1:]:
            c_close = float(c[4])
            ema = (c_close - ema) * multiplier + ema
        ema_9 = round(ema, 2)

    ema_9_dist_pct = round(((ltp - ema_9) / ema_9) * 100, 2) if ema_9 > 0 else 0.0
    is_near_ema_9 = abs(ema_9_dist_pct) <= 0.8

    # Pullback Volume Contraction Ratio (PVCR)
    # Find candle index of day high (HOD)
    hod_idx = 0
    max_h = -1.0
    for idx, c in enumerate(chrono_candles):
        if float(c[2]) > max_h:
            max_h = float(c[2])
            hod_idx = idx

    push_vols = [float(c[5]) for idx, c in enumerate(chrono_candles[:hod_idx + 1]) if float(c[4]) >= float(c[1])]
    dip_vols = [float(c[5]) for idx, c in enumerate(chrono_candles[hod_idx:]) if float(c[4]) < float(c[1])]
    avg_push_vol = sum(push_vols) / len(push_vols) if push_vols else 1.0
    avg_dip_vol = sum(dip_vols) / len(dip_vols) if dip_vols else 0.0
    pvcr = round(avg_dip_vol / avg_push_vol, 2) if avg_push_vol > 0 else 1.0
    is_low_vol_dip = pvcr <= 0.70

    # Upper wick rejection at HOD candle
    hod_candle = chrono_candles[hod_idx]
    hod_c_open = float(hod_candle[1])
    hod_c_high = float(hod_candle[2])
    hod_c_low = float(hod_candle[3])
    hod_c_close = float(hod_candle[4])
    hod_range = hod_c_high - hod_c_low
    upper_wick = hod_c_high - max(hod_c_open, hod_c_close)
    upper_wick_ratio = round((upper_wick / hod_range) * 100, 1) if hod_range > 0 else 0.0
    is_upper_wick_rejection = upper_wick_ratio >= 35.0

    day_extreme = round((ltp - day_low) / (day_high - day_low), 2) if (day_high - day_low) > 0 else 0.5
    retest_runway_pct = round(((day_high - ltp) / ltp) * 100, 2) if (ltp > 0 and day_high > ltp) else 0.0
    mean_reversion_vwap_pct = round(((ltp - vwap) / ltp) * 100, 2) if ltp > 0 else 0.0

    # Multi-candle dump check on last 3 completed 5m candles
    is_dumping = False
    if len(chrono_candles) >= 3:
        last_3 = chrono_candles[-3:]
        c1, c2, c3 = float(last_3[0][4]), float(last_3[1][4]), float(last_3[2][4])
        if c3 < c2 < c1 and (c1 - c3) / c1 > 0.01:
            is_dumping = True

    veto_reasons = []
    if not hod_retained:
        veto_reasons.append(f"DUMPED_FROM_HOD: -{hod_dist_pct}% off high (limit: <= 1.5%)")
    if not vwap_aligned:
        vwap_dist = round(((vwap - ltp) / vwap) * 100, 2)
        veto_reasons.append(f"BELOW_VWAP: -{vwap_dist}% below intraday VWAP")
    if is_dumping:
        veto_reasons.append("CASCADE_SELLING: 3 consecutive declining 5m candles")

    passed_checks = len(veto_reasons) == 0

    return {
        "status": "success",
        "symbol": clean_sym,
        "instrument_key": key,
        "ltp": ltp,
        "day_high": day_high,
        "day_low": day_low,
        "vwap": vwap,
        "ema_9": ema_9,
        "ema_9_distance_pct": ema_9_dist_pct,
        "is_near_ema_9": is_near_ema_9,
        "pvcr": pvcr,
        "is_low_vol_dip": is_low_vol_dip,
        "upper_wick_ratio": upper_wick_ratio,
        "is_upper_wick_rejection": is_upper_wick_rejection,
        "day_extreme": day_extreme,
        "retest_runway_pct": retest_runway_pct,
        "mean_reversion_vwap_pct": mean_reversion_vwap_pct,
        "hod_distance_pct": hod_dist_pct,
        "hod_retained": hod_retained,
        "vwap_aligned": vwap_aligned,
        "is_dumping": is_dumping,
        "veto_reasons": veto_reasons,
        "passed_checks": passed_checks,
        "last_candles": [
            {
                "time": c[0],
                "open": float(c[1]),
                "high": float(c[2]),
                "low": float(c[3]),
                "close": float(c[4]),
                "volume": int(c[5])
            }
            for c in chrono_candles[-6:]
        ]
    }


@router.get("/api/alpha/parquet/adv")
def get_parquet_adv():
    """
    Returns rolling 20-day Average Daily Volume (ADV), ATR, and 20-day High/Low
    computed via DuckDB directly from Parquet files in sub-50ms.
    """
    try:
        from parquet_query import batch_query_parquet_volume_averages
        data = batch_query_parquet_volume_averages()
        return {"status": "success", "count": len(data), "data": data}
    except Exception as e:
        log.error(f"Failed to fetch DuckDB volume averages: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/alpha/parquet/technicals/{symbol}")
def get_parquet_technicals(symbol: str):
    """
    Returns 20-day technicals (ADV, ATR, 20d Range) for a specific symbol via DuckDB.
    """
    try:
        from parquet_query import query_stock_technicals
        tech = query_stock_technicals(symbol)
        if not tech:
            raise HTTPException(status_code=404, detail=f"No Parquet data found for symbol {symbol}")
        return {"status": "success", "symbol": symbol.upper(), "data": tech}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Failed to query Parquet technicals for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/alpha/daemon/status")
def get_alpha_daemon_status():
    """Returns the live heartbeat, loop count, and status of the Headless Alpha Daemon."""
    status_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "alpha_daemon_status.json")
    if os.path.exists(status_path):
        try:
            with open(status_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {"status": "success", "data": data}
        except Exception as e:
            log.error(f"Failed to read daemon status: {e}")
    return {"status": "idle", "data": {"running": False, "message": "Daemon status file not yet generated"}}

@router.post("/api/alpha/daemon/toggle")
def toggle_alpha_daemon(payload: DaemonToggleRequest):
    """Toggles automated trade execution on the Headless Alpha Daemon."""
    state_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "autopilot_state.json")
    state = {}
    if os.path.exists(state_file):
        try:
            with open(state_file, "r", encoding="utf-8") as f:
                state = json.load(f)
        except Exception:
            pass
    state["enabled"] = payload.enabled
    try:
        tmp_file = state_file + ".tmp"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
        os.replace(tmp_file, state_file)
        return {"status": "success", "enabled": payload.enabled}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class TFCredentialsPayload(BaseModel):
    jwt_token: str
    totp_secret: str = ""

@router.get("/api/alpha/tradefinder/credentials")
def get_tradefinder_credentials():
    creds_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "tf_credentials.json")
    if os.path.exists(creds_path):
        try:
            with open(creds_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    return {"jwt_token": "", "totp_secret": ""}

@router.post("/api/alpha/tradefinder/credentials")
def save_tradefinder_credentials(payload: TFCredentialsPayload):
    data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
    os.makedirs(data_dir, exist_ok=True)
    creds_path = os.path.join(data_dir, "tf_credentials.json")
    creds = {
        "jwt_token": payload.jwt_token.strip(),
        "totp_secret": payload.totp_secret.strip(),
        "user_email": "gaddamsudhanshu@gmail.com",
        "updated_at": datetime.now(timezone(timedelta(hours=5, minutes=30))).isoformat()
    }
    with open(creds_path, "w", encoding="utf-8") as f:
        json.dump(creds, f, indent=2)
    return {"status": "success", "message": "Credentials updated"}

@router.get("/api/alpha/tradefinder/verify")
def verify_tradefinder_connection(token: Optional[str] = Query(None)):
    """Live probe to tradefinder.in to verify whether credentials are valid or rejected."""
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    script_dir = os.path.join(os.path.dirname(root_dir), "scripts")
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)
    try:
        from tf_ground_truth_harvester import TradeFinderHarvester
        harvester = TradeFinderHarvester(jwt_token=token.strip() if token else None, force_run=True)
        headers = harvester.get_auth_headers()
        code, body = harvester.fetch_endpoint("/api_be/data/market_pulse", headers)
        if code == 200:
            return {"status": "connected", "code": 200, "message": "Valid live token"}
        return {"status": "disconnected", "code": code, "error": body}
    except Exception as e:
        return {"status": "error", "code": 500, "error": str(e)}


@router.get("/api/alpha/fno-quant-audit")
def get_fno_quant_audit(
    symbol: str = Query(..., description="F&O Stock Symbol"),
    direction: str = Query("CALL", description="CALL or PUT")
):
    """
    Returns complete F&O 2.0 quantitative audit telemetry:
    - 1m Candlestick Dip & Rebound validation (Impulse range, PVCR, Support Kiss, Rebound status)
    - Upstox Option Chain metrics (PCR, OI Buildup, ATM Strike Delta, Bid-Ask Spread %)
    - Sector Dispersion context (Z-score, Sector rank, Dispersion spread)
    - FIQS (F&O Institutional Quant Score)
    """
    clean_sym = sanitize_symbol(symbol).upper()
    dir_str = direction if isinstance(direction, str) else "CALL"
    dir_norm = "CALL" if dir_str.upper() in ("CALL", "BUY", "LONG", "CE") else "PUT"
    
    from services.fno_quant_engine import (
        detect_fno_dip_and_rebound,
        evaluate_option_chain_quant,
        calculate_cross_sector_dispersion,
        compute_fiqs_score
    )

    key = db.get_upstox_instrument_key(clean_sym, exchange="NSE_EQ") or db.get_upstox_instrument_key(clean_sym)
    if not key:
        raise HTTPException(status_code=404, detail=f"Instrument key not found for {clean_sym}")

    today_str = datetime.now().strftime("%Y-%m-%d")
    from_date = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d")
    k_enc = key.replace("|", "%7C")

    # 1. Fetch 1m candles & evaluate Dip & Rebound
    candles_1m = []
    ltp = 0.0
    try:
        res = upstox_client.get_historical_candles(k_enc, "1minute", today_str, from_date)
        if res.get("status") == "success" and "data" in res and "candles" in res["data"]:
            candles_1m = res["data"]["candles"]
            if candles_1m:
                ltp = float(candles_1m[0][4])
    except Exception as e:
        log.warning(f"Error fetching 1m candles for audit on {clean_sym}: {e}")

    if ltp <= 0:
        try:
            ltp_res = upstox_client.get_ltp_quotes([key])
            if key in ltp_res and "last_price" in ltp_res[key]:
                ltp = float(ltp_res[key]["last_price"])
        except Exception:
            pass

    dip_rebound_state = detect_fno_dip_and_rebound(
        symbol=clean_sym,
        direction=dir_norm,
        candles_1m=candles_1m,
        vwap=ltp,
        ema_9=ltp
    )

    # 2. Evaluate Option Chain Quant
    option_quant_state = evaluate_option_chain_quant(
        symbol=clean_sym,
        direction=dir_norm,
        spot_price=ltp,
        upstox_client_instance=upstox_client
    )

    # 3. Read Sector Dispersion from snapshot / cache
    sector_dispersion = None
    stock_z_score = 0.0
    try:
        snap_raw = db.get_market_snapshot("alpha_engine", "upstox", "screener_snapshot")
        if snap_raw and "sector_dispersion" in snap_raw:
            sector_dispersion = snap_raw["sector_dispersion"]
            sec_ranked = sector_dispersion.get("sectors_ranked", [])
            for sec in sec_ranked:
                # Assign sector Z-factor if available
                if sec.get("dominant_stock") == clean_sym:
                    stock_z_score = float(sec.get("z_score", 0.0))
                    break
    except Exception:
        pass

    # 4. Compute FIQS Score
    stock_pct_chg = 1.5 if dir_norm == "CALL" else -1.5
    if candles_1m and len(candles_1m) > 0:
        try:
            day_open = float(candles_1m[-1][1])
            if day_open > 0 and ltp > 0:
                stock_pct_chg = round(((ltp - day_open) / day_open) * 100, 2)
        except Exception:
            pass

    gex_info = option_quant_state.get("gex", {}) or {}
    skew_info = option_quant_state.get("skew", {}) or {}
    basis_info = option_quant_state.get("synthetic_basis", {}) or {}
    pain_info = option_quant_state.get("max_pain", {}) or {}

    fiqs = compute_fiqs_score(
        stock_pct_chg=stock_pct_chg,
        sector_z_score=stock_z_score,
        rvol=1.5,
        pcr=float(option_quant_state.get("pcr", 1.0)),
        clean_trend="CLEAN" if dip_rebound_state.get("confirmed") else "WATCH",
        pvcr=float(dip_rebound_state.get("pvcr", 1.0)),
        direction=dir_norm,
        gex_regime=gex_info.get("regime", "NEUTRAL"),
        skew_verdict=skew_info.get("skew_verdict", "BALANCED_NORMAL"),
        basis_pct=float(basis_info.get("basis_pct", 0.0)),
        pain_gravity=pain_info.get("pain_gravity_verdict", "NEUTRAL")
    )

    return {
        "status": "success",
        "symbol": clean_sym,
        "direction": dir_norm,
        "ltp": ltp,
        "fiqs": fiqs,
        "dip_rebound": dip_rebound_state,
        "option_quant": option_quant_state,
        "sector_dispersion": sector_dispersion,
        "execution_window": {
            "observation": "10:00 - 10:30 AM IST",
            "armed_execution": "10:30 - 10:45 AM IST",
            "cutoff": "11:00 AM IST"
        }
    }



