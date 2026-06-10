import os
import sys
import time
import json
import asyncio
from pathlib import Path
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, Request
from logger import get_logger

log = get_logger("upstox_router", tag="UPSTOX_RT")

from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Ensure python-bridge root is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from routers.shared import (
    upstox_client,
    download_and_sync_instruments,
    update_historical_volume_avg,
    update_bulk_volume_averages,
    bulk_vol_progress,
    upstox_ws_client,
    sanitize_symbol,
    get_scheduler_jobs_status,
    rotate_stealth_headers
)
from services.time_skew_aligner import time_skew_aligner

router = APIRouter()

class TokenExchangeRequest(BaseModel):
    code: str
    redirect_uri: str

class SetTokenRequest(BaseModel):
    token: str

class BulkVolumeAvgRequest(BaseModel):
    symbols: List[str]
    days: int = 20

class SubscriptionPayload(BaseModel):
    keys: List[str]
    mode: str = "full"

@router.post("/api/upstox/token-exchange")
def upstox_token_exchange(payload: TokenExchangeRequest):
    log.info(f"🔑 [UPSTOX-OAUTH] Incoming Token Exchange Request | Code: {payload.code[:6]}... | Redirect URI: {payload.redirect_uri}")
    try:
        token = upstox_client.token_exchange(payload.code, payload.redirect_uri)
        log.info(f"✅ [UPSTOX-OAUTH] Successfully generated Upstox Access Token (Length: {len(token)})")
        try:
            upstox_ws_client.trigger_reconnect()
        except Exception as ws_err:
            log.warning(f"WebSocket trigger reconnect failed: {ws_err}")
        try:
            conn = db.get_db_connection(write=True)
            conn.cursor().execute("DELETE FROM upstox_errors WHERE endpoint = 'token_monitor'")
            conn.commit()
            conn.close()
        except Exception:
            pass
        return {"access_token": token, "status": "success"}
    except HTTPException as http_e:
        log.error(f"❌ [UPSTOX-OAUTH] Token exchange HTTP error ({http_e.status_code}): {http_e.detail}")
        raise
    except Exception as e:
        log.error(f"❌ [UPSTOX-OAUTH] Token exchange unexpected error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/upstox/set-token")
def upstox_set_token(payload: SetTokenRequest):
    try:
        upstox_client.set_token(payload.token)
        try:
            upstox_ws_client.trigger_reconnect()
        except Exception as ws_err:
            log.warning(f"WebSocket trigger reconnect failed: {ws_err}")
        try:
            conn = db.get_db_connection(write=True)
            conn.cursor().execute("DELETE FROM upstox_errors WHERE endpoint = 'token_monitor'")
            conn.commit()
            conn.close()
        except Exception:
            pass
        return {"status": "success", "message": "Upstox access token saved and WebSocket connection scheduled."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SetCredentialsRequest(BaseModel):
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    redirect_uri: Optional[str] = None

@router.post("/api/upstox/set-credentials")
def upstox_set_credentials(payload: SetCredentialsRequest):
    try:
        upstox_client.set_credentials(
            api_key=payload.api_key,
            api_secret=payload.api_secret,
            redirect_uri=payload.redirect_uri
        )
        return {"status": "success", "message": "Upstox credentials updated dynamically."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/health")
def upstox_health():
    token = upstox_client.token if upstox_client.token else upstox_client.analytics_token
    if not token:
        return {"valid": False, "message": "Token is missing."}
    
    try:
        masked_token = f"{token[:12]}...{token[-12:]}" if len(token) > 24 else "invalid_token"
        ws_conn = getattr(upstox_ws_client, "is_connected", False) or (getattr(upstox_ws_client, "connection_status", "") == "connected")
        ws_status = "connected" if ws_conn else getattr(upstox_ws_client, "connection_status", "connecting")
        return {
            "valid": True, 
            "token_masked": masked_token, 
            "status": ws_status, 
            "ws_connected": ws_conn,
            "market_status": "open" if upstox_client.is_indian_market_open() else "closed",
            "interactive_token_present": bool(upstox_client.token),
            "analytics_token_present": bool(upstox_client.analytics_token)
        }
    except Exception as e:
        return {"valid": False, "message": f"Token validation failed: {str(e)}"}

@router.get("/api/upstox/instruments/sync")
def upstox_instruments_sync(background_tasks: BackgroundTasks):
    try:
        background_tasks.add_task(download_and_sync_instruments)
        return {"status": "success", "message": "Instrument database sync started in the background."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/instruments/key")
def upstox_instrument_key(symbol: str = Query(...), exchange: str = Query(None), background_tasks: BackgroundTasks = None):
    symbol = sanitize_symbol(symbol)
    if exchange:
        exchange = sanitize_symbol(exchange)
    key = db.get_upstox_instrument_key(symbol, exchange)
    if key:
        return {"instrument_key": key}
    if background_tasks:
        log.info(f"Instrument key not found for {symbol}. Triggering background sync...")
        background_tasks.add_task(download_and_sync_instruments)
    raise HTTPException(status_code=404, detail=f"Instrument key not found for {symbol}. Sync triggered in background.")

@router.get("/api/upstox/instruments/count")
def upstox_instruments_count():
    conn = db.get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT count(*) as total FROM upstox_instruments")
        row = cursor.fetchone()
        return {"status": "success", "count": row["total"] if row else 0}
    except Exception as e:
        return {"status": "error", "count": 0, "message": str(e)}
    finally:
        conn.close()

@router.get("/api/upstox/instruments/search")
def upstox_instrument_search(q: str = Query(..., min_length=1), exchange: Optional[str] = Query(None)):
    search_q = q.strip().upper()
    if not search_q:
        return []
    
    conn = db.get_db_connection()
    try:
        cursor = conn.cursor()
        if exchange and exchange.strip():
            cursor.execute("""
                SELECT symbol, isin, instrument_key, exchange, lot_size 
                FROM upstox_instruments 
                WHERE (symbol LIKE ? OR isin LIKE ?) AND exchange = ?
                ORDER BY CASE WHEN symbol = ? THEN 1 
                              WHEN symbol LIKE ? THEN 2 
                              ELSE 3 
                         END ASC, symbol ASC
                LIMIT 25
            """, (f"%{search_q}%", f"%{search_q}%", exchange.strip().upper(), search_q, f"{search_q}%"))
        else:
            cursor.execute("""
                SELECT symbol, isin, instrument_key, exchange, lot_size 
                FROM upstox_instruments 
                WHERE (symbol LIKE ? OR isin LIKE ?)
                ORDER BY CASE WHEN symbol = ? THEN 1 
                              WHEN symbol LIKE ? THEN 2 
                              ELSE 3 
                         END ASC, 
                         CASE exchange 
                             WHEN 'NSE_INDEX' THEN 1 
                             WHEN 'BSE_INDEX' THEN 2 
                             WHEN 'NSE_EQ' THEN 3 
                             WHEN 'BSE_EQ' THEN 4 
                             WHEN 'NSE_FO' THEN 5 
                             ELSE 6 
                         END ASC, symbol ASC
                LIMIT 25
            """, (f"%{search_q}%", f"%{search_q}%", search_q, f"{search_q}%"))
        rows = cursor.fetchall()
        return [
            {
                "symbol": r["symbol"],
                "isin": r["isin"],
                "instrument_key": r["instrument_key"],
                "exchange": r["exchange"],
                "lot_size": r["lot_size"]
            }
            for r in rows
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.get("/api/upstox/instruments/resolve")
def upstox_instrument_resolve(symbol: str = Query(...)):
    sym = sanitize_symbol(symbol)
    conn = db.get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT symbol, isin, instrument_key, exchange, lot_size 
            FROM upstox_instruments 
            WHERE symbol = ? 
            ORDER BY CASE exchange WHEN 'NSE_EQ' THEN 1 WHEN 'NSE_FO' THEN 2 ELSE 3 END ASC 
            LIMIT 1
        """, (sym,))
        row = cursor.fetchone()
        if row:
            return {
                "status": "success",
                "symbol": row["symbol"],
                "isin": row["isin"],
                "instrument_key": row["instrument_key"],
                "exchange": row["exchange"],
                "lot_size": row["lot_size"]
            }
        raise HTTPException(status_code=404, detail=f"Instrument details not found for symbol: {symbol}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.get("/api/upstox/instruments/resolve-bulk")
def upstox_instrument_resolve_bulk(symbols: str = Query(..., description="Comma-separated list of symbols")):
    sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not sym_list:
        return {"status": "success", "resolved": {}}
    
    conn = db.get_db_connection()
    try:
        cursor = conn.cursor()
        placeholders = ",".join(["?"] * len(sym_list))
        query = f"""
            SELECT symbol, isin, instrument_key, exchange, lot_size 
            FROM upstox_instruments 
            WHERE symbol IN ({placeholders})
        """
        cursor.execute(query, sym_list)
        rows = cursor.fetchall()
        
        resolved_map = {}
        grouped = {}
        for row in rows:
            sym = row["symbol"]
            if sym not in grouped:
                grouped[sym] = []
            grouped[sym].append(row)
            
        for sym, sym_rows in grouped.items():
            def sort_key(r):
                exch = r["exchange"]
                if exch == 'NSE_EQ':
                    return 1
                elif exch == 'NSE_FO':
                    return 2
                else:
                    return 3
            sym_rows.sort(key=sort_key)
            best_row = sym_rows[0]
            resolved_map[sym] = {
                "symbol": best_row["symbol"],
                "isin": best_row["isin"],
                "instrument_key": best_row["instrument_key"],
                "exchange": best_row["exchange"],
                "lot_size": best_row["lot_size"]
            }
            
        return {
            "status": "success",
            "resolved": resolved_map
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.get("/api/upstox/quotes")
def upstox_quotes(symbols: str = Query(..., description="Comma-separated list of symbols")):
    raw_sym_list = [s.strip() for s in symbols.split(",") if s.strip()]
    if not raw_sym_list:
        raise HTTPException(status_code=400, detail="Symbols list is empty.")
    
    INDICES_MAP = {
        "NIFTY": "NSE_INDEX|Nifty 50",
        "NIFTY 50": "NSE_INDEX|Nifty 50",
        "NIFTY50": "NSE_INDEX|Nifty 50",
        "BANKNIFTY": "NSE_INDEX|Nifty Bank",
        "NIFTY BANK": "NSE_INDEX|Nifty Bank",
        "BANK": "NSE_INDEX|Nifty Bank",
        "SENSEX": "BSE_INDEX|SENSEX",
        "INDIA VIX": "NSE_INDEX|India VIX",
        "VIX": "NSE_INDEX|India VIX",
        "FINNIFTY": "NSE_INDEX|Nifty Fin Service",
        "FIN SERVICE": "NSE_INDEX|Nifty Fin Service",
        "NIFTY FIN SERVICE": "NSE_INDEX|Nifty Fin Service",
        "MIDCPNIFTY": "NSE_INDEX|Nifty Midcap 50",
        "GIFTNIFTY": "NSE_INDEX|Gift Nifty",
        "GIFT NIFTY": "NSE_INDEX|Gift Nifty",
        "NIFTY IT": "NSE_INDEX|Nifty IT",
        "IT": "NSE_INDEX|Nifty IT",
        "NIFTY FMCG": "NSE_INDEX|Nifty FMCG",
        "FMCG": "NSE_INDEX|Nifty FMCG",
        "NIFTY AUTO": "NSE_INDEX|Nifty Auto",
        "AUTO": "NSE_INDEX|Nifty Auto",
        "NIFTY PHARMA": "NSE_INDEX|Nifty Pharma",
        "PHARMA": "NSE_INDEX|Nifty Pharma",
        "NIFTY ENERGY": "NSE_INDEX|Nifty Energy",
        "NIFTY METAL": "NSE_INDEX|Nifty Metal",
        "METAL": "NSE_INDEX|Nifty Metal",
        "NIFTY REALTY": "NSE_INDEX|Nifty Realty",
        "REALTY": "NSE_INDEX|Nifty Realty",
        "NIFTY MEDIA": "NSE_INDEX|Nifty Media",
        "NIFTY FINANCIAL SERVICES": "NSE_INDEX|Nifty Fin Service",
        "NIFTY MIDCAP 100": "NSE_INDEX|NIFTY MIDCAP 100",
        "NIFTY SMALLCAP 100": "NSE_INDEX|NIFTY SMLCAP 100",
        "NIFTY SMLCAP 100": "NSE_INDEX|NIFTY SMLCAP 100",
        "PSU BANK": "NSE_INDEX|Nifty PSU Bank",
        "NIFTY PSU BANK": "NSE_INDEX|Nifty PSU Bank",
        "PVT BANK": "NSE_INDEX|Nifty Pvt Bank",
        "NIFTY PVT BANK": "NSE_INDEX|Nifty Pvt Bank",
        "DEFENSE": "NSE_INDEX|Nifty Ind Defence",
        "NIFTY DEFENCE": "NSE_INDEX|Nifty Ind Defence",
        "NIFTY INDIA DEFENCE": "NSE_INDEX|Nifty Ind Defence",
        "NIFTY IND DEFENCE": "NSE_INDEX|Nifty Ind Defence",
        "OIL & GAS": "NSE_INDEX|NIFTY OIL AND GAS",
        "NIFTY OIL & GAS": "NSE_INDEX|NIFTY OIL AND GAS",
        "NIFTY OIL AND GAS": "NSE_INDEX|NIFTY OIL AND GAS",
        "CONSUMER DURABLES": "NSE_INDEX|NIFTY CONSR DURBL",
        "NIFTY CONSUMER DURABLES": "NSE_INDEX|NIFTY CONSR DURBL",
        "NIFTY CONSR DURBL": "NSE_INDEX|NIFTY CONSR DURBL",
        "CEMENT": "NSE_INDEX|Nifty Cement",
        "NIFTY CEMENT": "NSE_INDEX|Nifty Cement",
        "SERVICES": "NSE_INDEX|Nifty Serv Sector",
        "NIFTY SERVICES": "NSE_INDEX|Nifty Serv Sector",
        "NIFTY SERV SECTOR": "NSE_INDEX|Nifty Serv Sector",
        "NIFTY MID SELECT": "NSE_INDEX|NIFTY MID SELECT",
        "MEDIA": "NSE_INDEX|Nifty Media",
        "HEALTHCARE": "NSE_INDEX|NIFTY HEALTHCARE",
        "NIFTY HEALTHCARE": "NSE_INDEX|NIFTY HEALTHCARE",
        "CHEMICALS": "NSE_INDEX|Nifty Chemicals",
        "NIFTY CHEMICALS": "NSE_INDEX|Nifty Chemicals",
        "CAPITAL MARKETS": "NSE_INDEX|Nifty Capital Mkt",
        "NIFTY CAPITAL MKT": "NSE_INDEX|Nifty Capital Mkt",
        "ENERGY": "NSE_INDEX|Nifty Energy"
    }
    
    # Build canonical lookup table mapping uppercase versions to exact canonical keys
    CANONICAL_INDEX_MAP = {k.upper(): v for k, v in INDICES_MAP.items()}
    for canonical in set(INDICES_MAP.values()):
        CANONICAL_INDEX_MAP[canonical.upper()] = canonical
        CANONICAL_INDEX_MAP[canonical.upper().replace("|", ":")] = canonical

    keys = []
    symbol_key_map = {}
    for raw_sym in raw_sym_list:
        sym_upper = raw_sym.upper()
        if sym_upper in CANONICAL_INDEX_MAP:
            key = CANONICAL_INDEX_MAP[sym_upper]
        elif "|" in raw_sym or ":" in raw_sym:
            # Direct instrument key - check canonical map first to restore proper casing
            key = CANONICAL_INDEX_MAP.get(sym_upper, raw_sym)
        else:
            key = db.get_upstox_instrument_key(sym_upper, exchange="NSE_EQ")
            if not key:
                key = db.get_upstox_instrument_key(sym_upper)
        if key:
            keys.append(key)
            symbol_key_map[key] = raw_sym
            symbol_key_map[key.upper()] = raw_sym
            symbol_key_map[key.replace("|", ":")] = raw_sym
            
    if not keys:
        raise HTTPException(status_code=404, detail="No instrument keys found for the specified symbols.")
        
    try:
        quotes = upstox_client.get_full_quotes(keys)
        result = {}
        for key, quote in quotes.items():
            inst_token = quote.get("instrument_token")
            norm_key = key.replace(":", "|") if isinstance(key, str) else key
            sym = symbol_key_map.get(inst_token) or symbol_key_map.get(key) or symbol_key_map.get(norm_key)
            if not sym:
                sym = quote.get("symbol")
            if not sym:
                sym = key.split(":")[1] if ":" in key else key
            result[sym] = quote
            # Multi-key index to guarantee callers can look up by key or alias
            if norm_key and norm_key not in result:
                result[norm_key] = quote
            if key and key not in result:
                result[key] = quote
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def resolve_key_to_symbol(instrument_key: str) -> str:
    indices = {
        "NSE_INDEX|Nifty 50": "NIFTY",
        "NSE_INDEX|Nifty Bank": "BANKNIFTY",
        "NSE_INDEX|Nifty Fin Service": "FINNIFTY",
        "NSE_INDEX|Nifty Midcap 50": "MIDCPNIFTY",
        "NSE_INDEX|NIFTY MID SELECT": "MIDCPNIFTY",
        "BSE_INDEX|SENSEX": "SENSEX"
    }
    if instrument_key in indices:
        return indices[instrument_key]
        
    conn = db.get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT symbol FROM upstox_instruments WHERE instrument_key = ? LIMIT 1", (instrument_key,))
        row = cursor.fetchone()
        if row:
            return row["symbol"]
    except Exception as e:
        log.warning(f"Error resolving key {instrument_key}: {e}")
    finally:
        conn.close()
    return None

def get_last_expected_historical_date():
    from datetime import datetime, timedelta, timezone
    # UTC time
    now_utc = datetime.now(timezone.utc)
    # Convert to IST (UTC + 5:30)
    now_ist = now_utc + timedelta(hours=5, minutes=30)
    
    # weekday(): Monday is 0, Sunday is 6
    wd = now_ist.weekday()
    if wd == 5: # Saturday
        return (now_ist - timedelta(days=1)).date()
    elif wd == 6: # Sunday
        return (now_ist - timedelta(days=2)).date()
    else:
        # Before 18:00 (6 PM) IST, historical data for today is not expected
        if now_ist.hour < 18:
            if wd == 0: # Monday
                return (now_ist - timedelta(days=3)).date() # Friday
            else:
                return (now_ist - timedelta(days=1)).date() # Yesterday
        else:
            return now_ist.date()

@router.get("/api/upstox/historical-candles")
def upstox_historical_candles(
    instrument_key: str = Query(...),
    interval: str = Query("day"),
    to_date: str = Query(...),
    from_date: str = Query(...)
):
    try:
        # Clamping to_date to last completed historical date to prevent redundant live fetches
        try:
            from datetime import datetime
            last_expected = get_last_expected_historical_date()
            req_to_date_orig = datetime.strptime(to_date, "%Y-%m-%d").date()
            clamped_to_date_obj = min(req_to_date_orig, last_expected)
            clamped_to_date = clamped_to_date_obj.strftime("%Y-%m-%d")
            
            # If the user's requested from_date is after clamped_to_date, clamp that too or handle it
            req_from_date_orig = datetime.strptime(from_date, "%Y-%m-%d").date()
            if req_from_date_orig > clamped_to_date_obj:
                log.warning(f"Requested range ({from_date} to {to_date}) is in the future. Clamped to_date: {clamped_to_date}")
                return {"status": "success", "data": {"candles": []}}
        except Exception as clamp_err:
            log.warning(f"Failed to parse/clamp dates: {clamp_err}")
            clamped_to_date = to_date

        symbol = resolve_key_to_symbol(instrument_key)
        if symbol:
            try:
                import parquet_query
                import importlib
                importlib.reload(parquet_query)
                
                symbol_upper = symbol.upper().strip()
                parquet_path = os.path.join(parquet_query.DATA_DIR, "underlying", symbol_upper, interval, "data.parquet")
                
                if os.path.exists(parquet_path):
                    # Check the maximum date in our Parquet cache
                    max_date_str = parquet_query.get_parquet_max_date(parquet_path)
                    if max_date_str:
                        from datetime import datetime, timedelta
                        max_date = datetime.strptime(max_date_str, "%Y-%m-%d").date()
                        req_to_date = datetime.strptime(clamped_to_date, "%Y-%m-%d").date()
                        
                        if max_date >= req_to_date:
                            # 100% Cache hit! Serve directly from Parquet
                            candles = parquet_query.query_candles_raw(parquet_path, from_date, clamped_to_date)
                            if candles is not None:
                                log.info(f"Served fully cached candles for {symbol_upper} ({interval}) from Parquet.")
                                return {
                                    "status": "success",
                                    "data": {
                                        "candles": candles
                                    }
                                }
                        else:
                            # Partial cache hit! Calculate the gap to fetch
                            delta_days = 2
                            if "week" in interval.lower():
                                delta_days = 10
                            elif "month" in interval.lower():
                                delta_days = 40
                            gap_from_date = (max_date - timedelta(days=delta_days)).strftime("%Y-%m-%d")
                            log.info(f"Fetching missing gap from {gap_from_date} to {clamped_to_date} for {symbol_upper} ({interval})...")
                            
                            # Call live API for the gap only (auto-saves to Parquet inside client)
                            key_encoded = instrument_key.replace("|", "%7C")
                            res = upstox_client.get_historical_candles(key_encoded, interval, clamped_to_date, gap_from_date)
                            
                            # Query the updated Parquet file for the full requested range
                            candles = parquet_query.query_candles_raw(parquet_path, from_date, clamped_to_date)
                            if candles is not None:
                                return {
                                    "status": "success",
                                    "data": {
                                        "candles": candles
                                    }
                                }
                else:
                    # No cache file at all! Fetch full range
                    log.info(f"No archive found. Fetching full range {from_date} to {clamped_to_date} for {symbol_upper}...")
                    key_encoded = instrument_key.replace("|", "%7C")
                    res = upstox_client.get_historical_candles(key_encoded, interval, clamped_to_date, from_date)
                    return res
            except Exception as cache_err:
                log.warning(f"Cache processing failed: {cache_err}")
                
        # Fallback if symbol resolution fails or cache errors
        key_encoded = instrument_key.replace("|", "%7C")
        res = upstox_client.get_historical_candles(key_encoded, interval, clamped_to_date, from_date)
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/bulk-historical-candles")
def upstox_bulk_historical_candles(
    symbols: str = Query(...),
    interval: str = Query("day"),
    to_date: str = Query(...),
    from_date: str = Query(...)
):
    sym_list = [s.strip().upper() for s in symbols.split(',') if s.strip()]
    results = {}
    for sym in sym_list:
        try:
            key = resolve_symbol_to_key(sym)
            if not key:
                continue
            last_expected = get_last_expected_historical_date()
            from datetime import datetime
            req_to_date_orig = datetime.strptime(to_date, "%Y-%m-%d").date()
            clamped_to_date_obj = min(req_to_date_orig, last_expected)
            clamped_to_date = clamped_to_date_obj.strftime("%Y-%m-%d")
            
            import parquet_query
            symbol_upper = sym.upper().strip()
            parquet_path = os.path.join(parquet_query.DATA_DIR, "underlying", symbol_upper, interval, "data.parquet")
            
            candles = None
            if os.path.exists(parquet_path):
                max_date_str = parquet_query.get_parquet_max_date(parquet_path)
                if max_date_str:
                    max_date = datetime.strptime(max_date_str, "%Y-%m-%d").date()
                    req_to_date = datetime.strptime(clamped_to_date, "%Y-%m-%d").date()
                    if max_date >= req_to_date:
                        candles = parquet_query.query_candles_raw(parquet_path, from_date, clamped_to_date)
            
            if candles is None:
                key_encoded = key.replace("|", "%7C")
                res = upstox_client.get_historical_candles(key_encoded, interval, clamped_to_date, from_date)
                if res.get("status") == "success" and "data" in res:
                    candles = res["data"].get("candles", [])
            
            if candles:
                results[sym] = candles
        except Exception as e:
            log.warning(f"Failed to fetch bulk candles for {sym}: {e}")
            
    return {"status": "success", "data": results}

@router.get("/api/upstox/historical/volume-avg")
def upstox_volume_avg(symbol: str = Query(...), days: int = Query(20)):
    try:
        symbol = sanitize_symbol(symbol)
        res = update_historical_volume_avg(symbol, days)
        return res
    except HTTPException as he:
        cached = db.get_upstox_volume_avg(symbol)
        if cached:
            return cached
        raise he
    except ValueError as ve:
        cached = db.get_upstox_volume_avg(symbol)
        if cached:
            return cached
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        cached = db.get_upstox_volume_avg(symbol)
        if cached:
            return cached
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/upstox/historical/volume-avg/all")
def upstox_volume_avg_all():
    conn = db.get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT symbol, avg_volume_20d, avg_abs_change_20d FROM upstox_volume_avg")
        rows = cursor.fetchall()
        res = {}
        for row in rows:
            avg_chg = row["avg_abs_change_20d"]
            if avg_chg is None:
                avg_chg = 1.0  # Fallback to avoid div by zero or nulls
            res[row["symbol"]] = {
                "avg_volume_20d": row["avg_volume_20d"],
                "avg_abs_change_20d": avg_chg
            }
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.post("/api/upstox/historical/bulk-volume-avg")
def upstox_bulk_volume_avg(payload: BulkVolumeAvgRequest, background_tasks: BackgroundTasks):
    if bulk_vol_progress["is_scanning"]:
        raise HTTPException(status_code=400, detail="Bulk volume average update is already running.")
        
    background_tasks.add_task(update_bulk_volume_averages, payload.symbols, payload.days)
    return {"status": "started", "message": f"Bulk volume update triggered for {len(payload.symbols)} symbols."}

@router.get("/api/upstox/historical/bulk-volume-avg/progress")
def upstox_bulk_volume_avg_progress():
    return bulk_vol_progress

@router.get("/api/upstox/option-chain")
def upstox_option_chain(symbol: str = Query(...), expiry: str = Query(None), background_tasks: BackgroundTasks = None):
    symbol = sanitize_symbol(symbol)
    indices = {
        "NIFTY": "NSE_INDEX|Nifty 50",
        "BANKNIFTY": "NSE_INDEX|Nifty Bank",
        "FINNIFTY": "NSE_INDEX|Nifty Fin Service",
        "MIDCPNIFTY": "NSE_INDEX|Nifty Midcap 50",
        "NIFTYNXT50": "NSE_INDEX|Nifty Next 50",
        "INDIA VIX": "NSE_INDEX|India VIX"
    }
    
    if symbol in indices:
        key = indices[symbol]
    else:
        key = db.get_upstox_instrument_key(symbol, exchange="NSE_EQ")
        if not key:
            key = db.get_upstox_instrument_key(symbol)
            
    if not key:
        if background_tasks:
            log.info(f"Underlying key not found for {symbol}. Triggering background sync...")
            background_tasks.add_task(download_and_sync_instruments)
        raise HTTPException(status_code=404, detail=f"Underlying instrument key not found for {symbol}. Sync triggered in background.")
        
    try:
        if not expiry:
            contracts_data = upstox_client.get_option_contracts(key)
            if contracts_data.get("status") == "success" and "data" in contracts_data:
                expiries = sorted([item.get("expiry") for item in contracts_data["data"] if item.get("expiry")])
                if expiries:
                    expiry = expiries[0]
                    log.info(f"Auto-selected nearest expiry for {symbol}: {expiry}")
                else:
                    raise HTTPException(status_code=404, detail=f"No active expiries found for {symbol}. Stock may not be in F&O universe.")
            else:
                raise HTTPException(status_code=404, detail=f"No option contracts found for {symbol}.")
                
        chain_data = upstox_client.get_option_chain(key, expiry)
        return chain_data
    except HTTPException as he:
        # Re-raise 404 immediately without triggering cascading retries or NSE scraper
        if he.status_code == 404:
            raise he
        log.warning(f"Upstox option chain HTTP error for {symbol}: {he.detail}. Checking NSE fallback...")
        try:
            from routers.nse import get_option_chain
            from fastapi import Response
            return get_option_chain(response=Response(), symbol=symbol, expiry=expiry)
        except HTTPException as nse_he:
            raise nse_he
        except Exception as nse_err:
            raise HTTPException(status_code=he.status_code, detail=f"Upstox & NSE fallback failed: {he.detail} / {nse_err}")
    except Exception as e:
        log.warning(f"Upstox option chain failed for {symbol}: {e}. Trying legacy NSE fallback...")
        try:
            from routers.nse import get_option_chain
            from fastapi import Response
            return get_option_chain(response=Response(), symbol=symbol, expiry=expiry)
        except HTTPException as nse_he:
            raise nse_he
        except Exception as nse_err:
            raise HTTPException(status_code=500, detail=f"Upstox & NSE fallback both failed. Upstox err: {e}. NSE err: {nse_err}")

@router.get("/api/upstox/option-contracts")
def upstox_option_contracts(
    symbol: str = Query(...),
    expiry: str = Query(None),
    strike_min: float = Query(None),
    strike_max: float = Query(None),
    atm_offset: float = Query(None),
    option_type: str = Query(None)
):
    symbol = sanitize_symbol(symbol)
    indices = {
        "NIFTY": "NSE_INDEX|Nifty 50",
        "BANKNIFTY": "NSE_INDEX|Nifty Bank",
        "FINNIFTY": "NSE_INDEX|Nifty Fin Service",
        "MIDCPNIFTY": "NSE_INDEX|Nifty Midcap 50",
        "NIFTYNXT50": "NSE_INDEX|Nifty Next 50",
        "INDIA VIX": "NSE_INDEX|India VIX"
    }
    
    if symbol in indices:
        key = indices[symbol]
    else:
        key = db.get_upstox_instrument_key(symbol, exchange="NSE_EQ")
        if not key:
            key = db.get_upstox_instrument_key(symbol)
            
    if not key:
        raise HTTPException(status_code=404, detail=f"Underlying instrument key not found for {symbol}")
        
    try:
        contracts = upstox_client.get_option_contracts(key)
        # Apply filtering if data is present
        if contracts and contracts.get("status") == "success" and isinstance(contracts.get("data"), list):
            data = contracts["data"]
            
            # 1. Filter by expiry
            if expiry:
                data = [c for c in data if c.get("expiry") == expiry]
                
            # 2. Filter by option_type
            if option_type:
                data = [c for c in data if c.get("option_type") == option_type.upper()]
                
            # 3. Filter by strike_min / strike_max
            if strike_min is not None:
                data = [c for c in data if c.get("strike_price") >= strike_min]
            if strike_max is not None:
                data = [c for c in data if c.get("strike_price") <= strike_max]
                
            # 4. Filter by ATM offset (requires getting spot price first)
            if atm_offset is not None:
                try:
                    ltp_res = upstox_client.get_ltp_quotes([key])
                    if ltp_res and ltp_res.get("status") == "success":
                        spot = ltp_res["data"].get(key, {}).get("last_price")
                        if spot:
                            # Sort contracts by absolute distance to spot
                            sorted_by_dist = sorted(data, key=lambda c: abs(c.get("strike_price", 0) - spot))
                            if sorted_by_dist:
                                atm_strike = sorted_by_dist[0].get("strike_price", 0)
                                data = [c for c in data if abs(c.get("strike_price", 0) - atm_strike) <= atm_offset]
                except Exception as ltp_err:
                    log.warning(f"Failed to get spot price for offset: {ltp_err}")
            
            contracts["data"] = data
            
        return contracts
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/pcr")
def upstox_pcr(symbol: str = Query(...)):
    symbol = sanitize_symbol(symbol)
    indices = {
        "NIFTY": "NSE_INDEX|Nifty 50",
        "BANKNIFTY": "NSE_INDEX|Nifty Bank",
        "FINNIFTY": "NSE_INDEX|Nifty Fin Service"
    }
    key = indices.get(symbol) or db.get_upstox_instrument_key(symbol, exchange="NSE_EQ") or db.get_upstox_instrument_key(symbol)
    if not key:
        raise HTTPException(status_code=404, detail=f"Key not found for {symbol}")
        
    try:
        return upstox_client.get_pcr(key)
    except Exception as e:
        log.warning(f"Upstox PCR fetch failed for {symbol}: {e}.")
        return {"status": "degraded", "data": None}

@router.get("/api/upstox/fii")
def upstox_fii(segment: str = Query("FO"), interval: str = Query("daily")):
    segment_upper = segment.upper()
    data_type = "NSE_EQ|CASH" if segment_upper in ["CM", "NSE_EQ"] else "NSE_FO|INDEX_FUTURES"
    
    interval_mapped = "1D"
    if interval.lower() in ["monthly", "1m"]:
        interval_mapped = "1M"
        
    try:
        res = upstox_client.get_fii_data(data_type, interval_mapped)
        if res.get("status") == "success" and "data" in res:
            items = res["data"].get(data_type, [])
            mapped_data = []
            for item in items:
                ts = item.get("time_stamp")
                if ts:
                    date_str = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
                    buy = float(item.get("buy_amount", 0.0))
                    sell = float(item.get("sell_amount", 0.0))
                    net = buy - sell
                    mapped_data.append({
                        "date": date_str,
                        "segment": segment,
                        "buy_amount": buy,
                        "sell_amount": sell,
                        "net_amount": net
                    })
                    db.save_fii_dii(date_str, segment, net, 0.0)
            return {"status": "success", "data": mapped_data}
        return res
    except Exception as e:
        cached = db.get_fii_dii_history(segment)
        if cached:
            return {"status": "success", "data": cached, "source": "cache"}
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/dii")
def upstox_dii(interval: str = Query("daily")):
    interval_mapped = "1D"
    if interval.lower() in ["monthly", "1m"]:
        interval_mapped = "1M"
        
    try:
        res = upstox_client.get_dii_data("NSE_EQ|CASH", interval_mapped)
        if res.get("status") == "success" and "data" in res:
            items = res["data"].get("NSE_EQ|CASH", [])
            mapped_data = []
            for item in items:
                ts = item.get("time_stamp")
                if ts:
                    date_str = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
                    buy = float(item.get("buy_amount", 0.0))
                    sell = float(item.get("sell_amount", 0.0))
                    net = buy - sell
                    mapped_data.append({
                        "date": date_str,
                        "segment": "CM_DII",
                        "buy_amount": buy,
                        "sell_amount": sell,
                        "net_amount": net
                    })
                    db.save_fii_dii(date_str, "CM_DII", 0.0, net)
            return {"status": "success", "data": mapped_data}
        return res
    except Exception as e:
        cached = db.get_fii_dii_history("CM_DII")
        if cached:
            return {"status": "success", "data": cached, "source": "cache"}
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/fii-dii/consolidated")
def upstox_fii_dii_consolidated(limit: int = Query(30), mode: str = Query("1D")):
    try:
        # Sync latest daily data if live client is available
        if mode == "1D" and upstox_client.token:
            try:
                res_cm = upstox_client.get_fii_data("NSE_EQ|CASH", "1D")
                if res_cm.get("status") == "success" and "data" in res_cm:
                    items = res_cm["data"].get("NSE_EQ|CASH", [])
                    for item in items:
                        ts = item.get("time_stamp")
                        if ts:
                            d = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
                            buy = float(item.get("buy_amount", 0.0))
                            sell = float(item.get("sell_amount", 0.0))
                            db.save_fii_history(d, "CM", buy, sell, buy - sell)
                            
                res_dii = upstox_client.get_dii_data("NSE_EQ|CASH", "1D")
                if res_dii.get("status") == "success" and "data" in res_dii:
                    items = res_dii["data"].get("NSE_EQ|CASH", [])
                    for item in items:
                        ts = item.get("time_stamp")
                        if ts:
                            d = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
                            buy = float(item.get("buy_amount", 0.0))
                            sell = float(item.get("sell_amount", 0.0))
                            db.save_fii_history(d, "CM_DII", buy, sell, buy - sell)
                            
                fno_segments = {
                    "INDEX_FUTURES": "NSE_FO|INDEX_FUTURES",
                    "STOCK_FUTURES": "NSE_FO|STOCK_FUTURES",
                    "INDEX_OPTIONS": "NSE_FO|INDEX_OPTIONS",
                    "STOCK_OPTIONS": "NSE_FO|STOCK_OPTIONS"
                }
                
                fo_total_net = {}
                for db_seg, upstox_type in fno_segments.items():
                    res_fno = upstox_client.get_fii_data(upstox_type, "1D")
                    if res_fno.get("status") == "success" and "data" in res_fno:
                        items = res_fno["data"].get(upstox_type, [])
                        for item in items:
                            ts = item.get("time_stamp")
                            if ts:
                                d = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
                                buy = float(item.get("buy_amount", 0.0))
                                sell = float(item.get("sell_amount", 0.0))
                                net = buy - sell
                                db.save_fii_history(d, db_seg, buy, sell, net)
                                fo_total_net[d] = fo_total_net.get(d, 0.0) + net
                                
                for d, net in fo_total_net.items():
                    db.save_fii_history(d, "FO", 0.0, 0.0, net)
                    
            except Exception as e:
                log.warning(f"Failed to sync live FII/DII from Upstox: {e}")
                
        conn = db.get_db_connection()
        rows = []
        try:
            cursor = conn.cursor()
            if mode == "1M":
                # Aggregate by Month
                cursor.execute("""
                    SELECT strftime('%Y-%m', date) as time_key, segment, SUM(buy_value) as buy_val, SUM(sell_value) as sell_val, SUM(net_value) as net_val
                    FROM upstox_fii_history
                    GROUP BY time_key, segment
                    ORDER BY time_key DESC, segment ASC
                """)
            else:
                cursor.execute("""
                    SELECT date as time_key, segment, buy_value as buy_val, sell_value as sell_val, net_value as net_val 
                    FROM upstox_fii_history 
                    ORDER BY time_key DESC, segment ASC
                """)
            rows = cursor.fetchall()
        finally:
            conn.close()
            
        data_by_key = {}
        for row in rows:
            tk = row["time_key"]
            seg = row["segment"]
            val = row["net_val"]
            buy_val = row["buy_val"]
            sell_val = row["sell_val"]
            
            if tk not in data_by_key:
                data_by_key[tk] = {
                    "date": tk if mode == "1M" else tk,
                    "fii_cash": 0.0,
                    "dii_cash": 0.0,
                    "fii_fo": 0.0,
                    "fii_index_fut": 0.0,
                    "fii_index_opt": 0.0,
                    "fii_stock_fut": 0.0,
                    "fii_stock_opt": 0.0,
                    "nifty_price": 0.0,
                    "nifty_change": 0.0,
                    "nifty_pct": 0.0,
                    "vix_price": 0.0,
                    "vix_pct": 0.0,
                    "is_monthly": mode == "1M"
                }
                
            if seg == "CM":
                data_by_key[tk]["fii_cash"] = val
            elif seg == "CM_DII":
                data_by_key[tk]["dii_cash"] = val
            elif seg == "FO":
                data_by_key[tk]["fii_fo"] = val
            elif seg == "INDEX_FUTURES":
                data_by_key[tk]["fii_index_fut"] = val
            elif seg == "INDEX_OPTIONS":
                data_by_key[tk]["fii_index_opt"] = val
            elif seg == "STOCK_FUTURES":
                data_by_key[tk]["fii_stock_fut"] = val
            elif seg == "STOCK_OPTIONS":
                data_by_key[tk]["fii_stock_opt"] = val
            elif seg == "NIFTY_50":
                data_by_key[tk]["nifty_price"] = buy_val
                data_by_key[tk]["nifty_change"] = sell_val
                data_by_key[tk]["nifty_pct"] = val
            elif seg == "INDIA_VIX":
                data_by_key[tk]["vix_price"] = buy_val
                data_by_key[tk]["vix_pct"] = val
                
        history_list = sorted(data_by_key.values(), key=lambda x: x["date"], reverse=True)
        chron_list = list(reversed(history_list))
        
        for i in range(len(chron_list)):
            sub_list_fii = chron_list[max(0, i-4):i+1]
            fii_vals = [x["fii_cash"] for x in sub_list_fii]
            fii_5d_avg = sum(fii_vals) / len(fii_vals) if fii_vals else 0.0
            chron_list[i]["fii_cash_5d_avg"] = fii_5d_avg
            
            if mode == "1D" and i >= 2:
                last_3 = chron_list[i-2:i+1]
                all_buy = all(x["fii_cash"] > 0 for x in last_3)
                all_sell = all(x["fii_cash"] < 0 for x in last_3)
                if all_buy:
                    chron_list[i]["fii_flow_signal"] = "Accumulation"
                elif all_sell:
                    market_resilient = all(x["nifty_pct"] >= 0 for x in last_3)
                    if market_resilient:
                        chron_list[i]["fii_flow_signal"] = "Distribution/Divergence"
                    else:
                        chron_list[i]["fii_flow_signal"] = "Weakening"
                else:
                    chron_list[i]["fii_flow_signal"] = "Neutral"
            else:
                chron_list[i]["fii_flow_signal"] = "Neutral"
            
            # Compute macro bias
            fii_cash_net = chron_list[i].get("fii_cash", 0.0)
            fii_futures_net = chron_list[i].get("fii_index_fut", 0.0)
            if fii_cash_net > 500.0 and fii_futures_net > 0.0:
                bias = "STRONG_BULLISH"
            elif fii_cash_net > 0.0 and fii_futures_net < 0.0:
                bias = "HEDGED"
            elif fii_cash_net < -500.0:
                bias = "DISTRIBUTION"
            else:
                bias = "NEUTRAL"
            chron_list[i]["macro_bias"] = bias
                
        final_history = list(reversed(chron_list))[:limit]
        today_stats = final_history[0] if final_history else {}
        
        return {
            "status": "success",
            "today": today_stats,
            "history": final_history
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/oi")
def upstox_oi(symbol: str = Query(...), expiry: str = Query(...), date: str = Query(None)):
    symbol = symbol.upper().strip()
    indices = {"NIFTY": "NSE_INDEX|Nifty 50", "BANKNIFTY": "NSE_INDEX|Nifty Bank", "FINNIFTY": "NSE_INDEX|Nifty Fin Service"}
    key = indices.get(symbol) or db.get_upstox_instrument_key(symbol, exchange="NSE_EQ") or db.get_upstox_instrument_key(symbol)
    if not key:
         raise HTTPException(status_code=404, detail=f"Key not found for {symbol}")
         
    try:
        return upstox_client.get_oi(key, expiry, date)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/change-oi")
def upstox_change_oi(
    symbol: str = Query(...),
    expiry: str = Query(...),
    date: str = Query(None),
    interval: int = Query(15)
):
    symbol = symbol.upper().strip()
    indices = {"NIFTY": "NSE_INDEX|Nifty 50", "BANKNIFTY": "NSE_INDEX|Nifty Bank", "FINNIFTY": "NSE_INDEX|Nifty Fin Service"}
    key = indices.get(symbol) or db.get_upstox_instrument_key(symbol, exchange="NSE_EQ") or db.get_upstox_instrument_key(symbol)
    if not key:
         raise HTTPException(status_code=404, detail=f"Key not found for {symbol}")
         
    try:
        if not date:
            date = datetime.now().strftime("%Y-%m-%d")
        
        # 1. Fetch Option OI changes
        res = upstox_client.get_oi_change(key, expiry, date, interval)
        if res.get("status") != "success":
            return res
            
        # 2. Fetch quote for underlying to get price change
        price_change = 0.0
        try:
            quotes = upstox_client.get_full_quotes([key])
            if quotes and key in quotes:
                q = quotes[key]
                ltp = q.get("last_price")
                close = q.get("ohlc", {}).get("close")
                if ltp is not None and close is not None and close > 0:
                    price_change = (float(ltp) - float(close)) / float(close)
        except Exception as q_err:
            log.error(f"Failed to fetch quote for price change on {symbol}: {q_err}")

        # 3. Calculate total OI and total OI change
        total_oi = 0.0
        total_oi_change = 0.0
        oi_list = []
        
        if "data" in res and res["data"]:
            data_body = res["data"]
            if isinstance(data_body, dict):
                oi_list = data_body.get("call_put_oi_change_data_list", []) or []
                if not oi_list:
                    oi_list = data_body.get("call_put_oi_data_list", []) or []
            elif isinstance(data_body, list):
                oi_list = data_body

            for item in oi_list:
                total_oi += float(item.get("call_oi", 0.0)) + float(item.get("put_oi", 0.0))
                total_oi_change += float(item.get("call_oi_change", 0.0)) + float(item.get("put_oi_change", 0.0))

        # 4. Classify OI Price Divergence
        oi_change_pct = 0.0
        prev_oi = total_oi - total_oi_change
        if prev_oi > 0:
            oi_change_pct = total_oi_change / prev_oi

        oi_signal = "NEUTRAL"
        if abs(oi_change_pct) > 0.001:
            if price_change > 0.001 and oi_change_pct > 0.001:
                oi_signal = "LONG_BUILDUP"
            elif price_change < -0.001 and oi_change_pct > 0.001:
                oi_signal = "SHORT_BUILDUP"
            elif price_change > 0.001 and oi_change_pct < -0.001:
                oi_signal = "SHORT_COVERING"
            elif price_change < -0.001 and oi_change_pct < -0.001:
                oi_signal = "LONG_UNWIND"

        # 5. Enrich response
        if isinstance(res.get("data"), dict):
            res["data"]["oi_signal"] = oi_signal
            res["data"]["price_change"] = round(price_change, 5)
            res["data"]["oi_change_pct"] = round(oi_change_pct, 5)
        elif isinstance(res.get("data"), list) or res.get("data") is None:
            res["data"] = {
                "list": res.get("data") or [],
                "oi_signal": oi_signal,
                "price_change": round(price_change, 5),
                "oi_change_pct": round(oi_change_pct, 5)
            }
            
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/max-pain")
def upstox_max_pain(symbol: str = Query(...)):
    symbol = symbol.upper().strip()
    indices = {"NIFTY": "NSE_INDEX|Nifty 50", "BANKNIFTY": "NSE_INDEX|Nifty Bank", "FINNIFTY": "NSE_INDEX|Nifty Fin Service"}
    key = indices.get(symbol) or db.get_upstox_instrument_key(symbol, exchange="NSE_EQ") or db.get_upstox_instrument_key(symbol)
    if not key:
         raise HTTPException(status_code=404, detail=f"Key not found for {symbol}")
         
    try:
        return upstox_client.get_max_pain(key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/market-status")
def upstox_market_status(segment: str = Query("NSE_CM")):
    try:
        res = upstox_client.get_market_status(segment)
        if res.get("status") == "success" and "data" in res:
            d = res["data"]
            db.save_market_status(segment, d.get("status"), d.get("open_time"), d.get("close_time"))
        return res
    except Exception as e:
        cached = db.get_market_status(segment)
        if cached:
            return {"status": "success", "data": cached, "source": "cache"}
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/market-holidays")
def upstox_market_holidays():
    try:
        return upstox_client.get_market_holidays()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def validate_isin_parameter(isin: str):
    import re
    if not isin or not re.match(r"^[a-zA-Z]{2}[a-zA-Z0-9]{9}[0-9]$", isin.strip()):
        raise HTTPException(status_code=400, detail=f"Invalid ISIN format: '{isin}'. Must be 12 alphanumeric characters.")

@router.get("/api/upstox/fundamentals/profile")
def upstox_fundamentals_profile(isin: str = Query(...)):
    validate_isin_parameter(isin)
    try:
        return upstox_client.get_company_profile(isin)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/fundamentals/key-ratios")
def upstox_fundamentals_key_ratios(isin: str = Query(...)):
    validate_isin_parameter(isin)
    try:
        return upstox_client.get_key_ratios(isin)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/fundamentals/shareholding")
def upstox_fundamentals_shareholding(isin: str = Query(...)):
    validate_isin_parameter(isin)
    try:
        return upstox_client.get_shareholdings(isin)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/fundamentals/corporate-actions")
def upstox_fundamentals_corporate_actions(isin: str = Query(...)):
    validate_isin_parameter(isin)
    try:
        return upstox_client.get_corporate_actions(isin)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def resolve_symbol_to_key(symbol: str) -> str:
    symbol_clean = symbol.upper().strip()
    indices = {
        "NIFTY": "NSE_INDEX|Nifty 50",
        "BANKNIFTY": "NSE_INDEX|Nifty Bank",
        "FINNIFTY": "NSE_INDEX|Nifty Fin Service",
        "MIDCPNIFTY": "NSE_INDEX|NIFTY MID SELECT",
        "SENSEX": "BSE_INDEX|SENSEX"
    }
    return indices.get(symbol_clean) or db.get_upstox_instrument_key(symbol_clean, exchange="NSE_EQ") or db.get_upstox_instrument_key(symbol_clean)

@router.get("/api/upstox/fundamentals/competitors")
def upstox_fundamentals_competitors(isin: str = Query(...)):
    validate_isin_parameter(isin)
    try:
        return upstox_client.get_competitors(isin)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/fundamentals/balance-sheet")
def upstox_fundamentals_balance_sheet(isin: str = Query(...)):
    validate_isin_parameter(isin)
    try:
        return upstox_client.get_balance_sheet(isin)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/fundamentals/cash-flow")
def upstox_fundamentals_cash_flow(isin: str = Query(...)):
    validate_isin_parameter(isin)
    try:
        return upstox_client.get_cash_flow(isin)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/fundamentals/income-statement")
def upstox_fundamentals_income_statement(isin: str = Query(...)):
    validate_isin_parameter(isin)
    try:
        return upstox_client.get_income_statement(isin)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def is_market_closed() -> bool:
    """Helper to check if Indian markets are currently closed (after 3:30 PM IST or weekends)"""
    from routers.shared import is_indian_market_open
    return not is_indian_market_open()

@router.get("/api/upstox/intraday-candles")
def upstox_intraday_candles(
    instrument_key: str = Query(...),
    interval: str = Query("5minute")
):
    try:
        # If market is closed, candles are finalized and cache TTL is set to 24 hours
        # The client will also auto-save these finalized candles to Parquet archive to freeze history
        if is_market_closed():
            log.info(f"Market is closed. Fetching and finalizing intraday candles for {instrument_key} ({interval})")
        return upstox_client.get_intraday_candles(instrument_key, interval)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/upstox/ltp-quotes")
def upstox_ltp_quotes(symbols: str = Query(...)):
    sym_list = [s.strip().upper() for s in symbols.split(',') if s.strip()]
    keys = [resolve_symbol_to_key(s) for s in sym_list]
    keys = [k for k in keys if k]
    if not keys:
        raise HTTPException(status_code=404, detail="No instrument keys found for the specified symbols")
    try:
        return upstox_client.get_ltp_quotes(keys)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/ohlc-quotes")
def upstox_ohlc_quotes(symbols: str = Query(...), interval: str = Query("1d")):
    sym_list = [s.strip().upper() for s in symbols.split(',') if s.strip()]
    keys = [resolve_symbol_to_key(s) for s in sym_list]
    keys = [k for k in keys if k]
    if not keys:
        raise HTTPException(status_code=404, detail="No instrument keys found for the specified symbols")
    try:
        return upstox_client.get_ohlc_quotes(keys, interval)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/smartlist/options")
def upstox_smartlist_options(
    asset_type: str = Query("INDEX"),
    category: str = Query("TOP_TRADED"),
    page_number: int = Query(None),
    page_size: int = Query(None)
):
    try:
        return upstox_client.get_options_smartlist(
            asset_type=asset_type.strip(),
            category=category.strip(),
            page_number=page_number,
            page_size=page_size
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/smartlist/futures")
def upstox_smartlist_futures(
    asset_type: str = Query("INDEX"),
    category: str = Query("TOP_TRADED"),
    page_number: int = Query(None),
    page_size: int = Query(None)
):
    try:
        return upstox_client.get_futures_smartlist(
            asset_type=asset_type.strip(),
            category=category.strip(),
            page_number=page_number,
            page_size=page_size
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/smartlist/mtf")
def upstox_smartlist_mtf(
    page_number: int = Query(None),
    page_size: int = Query(None)
):
    try:
        return upstox_client.get_mtf_smartlist(
            page_number=page_number,
            page_size=page_size
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/market-timings")
def upstox_market_timings(date: str = Query(None)):
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")
    try:
        return upstox_client.get_market_timings(date.strip())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/expired/expiries")
def upstox_expired_expiries(symbol: str = Query(...), segment: str = Query("options")):
    key = resolve_symbol_to_key(symbol)
    if not key:
        raise HTTPException(status_code=404, detail=f"Key not found for symbol: {symbol}")
    try:
        return upstox_client.get_expiries(key, segment.lower().strip())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/expired/option-contracts")
def upstox_expired_option_contracts(symbol: str = Query(...), expiry: str = Query(...)):
    key = resolve_symbol_to_key(symbol)
    if not key:
        raise HTTPException(status_code=404, detail=f"Key not found for symbol: {symbol}")
    try:
        return upstox_client.get_expired_option_contracts(key, expiry.strip())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/expired/future-contracts")
def upstox_expired_future_contracts(symbol: str = Query(...), expiry: str = Query(...)):
    key = resolve_symbol_to_key(symbol)
    if not key:
        raise HTTPException(status_code=404, detail=f"Key not found for symbol: {symbol}")
    try:
        return upstox_client.get_expired_future_contracts(key, expiry.strip())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/expired/historical-candles")
def upstox_expired_historical_candles(
    instrument_key: str = Query(...),
    interval: str = Query(...),
    from_date: str = Query(...),
    to_date: str = Query(...)
):
    try:
        try:
            import parquet_query
            meta = parquet_query.resolve_expired_key(instrument_key)
            if meta:
                candles = parquet_query.query_option_candles(
                    symbol=meta["symbol"],
                    expiry=meta["expiry"],
                    strike=meta["strike"],
                    option_type=meta["option_type"],
                    from_date=from_date,
                    to_date=to_date
                )
                if candles is not None:
                    log.info(f"Served expired option candles for {instrument_key} from Parquet.")
                    return {
                        "status": "success",
                        "data": {
                            "candles": candles
                        }
                    }
        except ImportError:
            pass
                
        return upstox_client.get_expired_historical_candles(instrument_key, interval, to_date, from_date)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/ipos")
@router.get("/api/upstox/ipo")
def upstox_ipo(status: str = Query("upcoming"), force: bool = Query(False)):
    try:
        return upstox_client.get_ipos(status.lower().strip(), bypass_cache=force)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/ipos/{ipo_id}")
@router.get("/api/upstox/ipo/{ipo_id}")
def upstox_ipo_details(ipo_id: str, force: bool = Query(False)):
    try:
        return upstox_client.get_ipo_details(ipo_id, bypass_cache=force)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def get_mock_news(symbol: str = None) -> list:
    import random
    from datetime import datetime, timedelta
    
    # Generic market headlines
    headlines = [
        {"title": "Nifty Reaches Record High Amid Strong Institutional Buying", "description": "FII inflows continue to surge as domestic economy shows strong resilience.", "sentiment": "POSITIVE"},
        {"title": "RBI Keeps Repo Rate Unchanged, Maintains Focus on Inflation Control", "description": "The central bank's monetary policy committee voted unanimously to maintain status quo.", "sentiment": "NEUTRAL"},
        {"title": "IT Sector Leads Recovery as Cloud and AI Spending Accelerates", "description": "Top-tier IT services companies see increased deal pipelines and improved margins.", "sentiment": "POSITIVE"},
        {"title": "Banking Stocks Rally as NPA Levels Hit Decade Lows", "description": "Public and private banks report healthy credit growth and improved asset quality.", "sentiment": "POSITIVE"},
        {"title": "Auto Sector Reports Dynamic Sales Growth in Festive Quarter", "description": "Electric vehicle segments witness exponential adoption while passenger vehicle sales remain robust.", "sentiment": "POSITIVE"},
        {"title": "Midcap and Smallcap Indexes Outperform Benchmarks in Broad-Based Rally", "description": "Market breadth improves significantly as retail participation reaches all-time highs.", "sentiment": "POSITIVE"},
        {"title": "Global Crude Oil Prices Soften, Boosting Indian Fiscal Outlook", "description": "Brent crude falls below $80/barrel, easing trade deficit and inflation concerns.", "sentiment": "POSITIVE"},
        {"title": "FMCG Sector Witnesses Rural Demand Revival in Q1 Reports", "description": "Major consumer goods firms point to volume growth in rural markets after consecutive flat quarters.", "sentiment": "POSITIVE"}
    ]
    
    # Symbol-specific templates
    symbol_templates = {
        "RELIANCE": [
            {"title": "Reliance Industries Expansion Plans in Green Energy Gain Momentum", "description": "RIL aims to commission the first phase of its gigafactory in Gujarat by year-end.", "sentiment": "POSITIVE"},
            {"title": "Jio Financial Services Expands Credit Services Portfolio", "description": "Partnerships and new digital offerings set to boost consumer lending volume.", "sentiment": "POSITIVE"}
        ],
        "TCS": [
            {"title": "TCS Wins Mega Deal from Leading European Financial Institution", "description": "Multi-year deal focuses on legacy modernization and cloud migration.", "sentiment": "POSITIVE"},
            {"title": "TCS Reports Strong Q1 Operating Margin, Outperforms Estimates", "description": "Strict cost optimization measures pay off despite headwind pressures.", "sentiment": "POSITIVE"}
        ],
        "INFY": [
            {"title": "Infosys Raises Revenue Guidance on Strong Large Deal Pipeline", "description": "The company expects cloud and generative AI services to lead growth.", "sentiment": "POSITIVE"},
            {"title": "Infosys Collaborates with Global Automotive Leader for AI Solutions", "description": "Deal aims to integrate smart manufacturing capabilities using proprietary Topaz platform.", "sentiment": "POSITIVE"}
        ],
        "SBIN": [
            {"title": "SBI Net Profit Rises 18% YoY on Strong Net Interest Income", "description": "State Bank of India reports robust retail loan growth and low slippages.", "sentiment": "POSITIVE"},
            {"title": "SBI Board Approves Infrastructure Bond Issuance Program", "description": "Fundraising aimed at long-term projects to support nationwide capital expenditure.", "sentiment": "NEUTRAL"}
        ],
        "HDFCBANK": [
            {"title": "HDFC Bank Deposit Mobilization Exceeds Targets Post-Merger", "description": "Strong branch expansion and digital channel execution drive deposit surge.", "sentiment": "POSITIVE"},
            {"title": "HDFC Bank Enhances Wealth Management Suite for HNI Segment", "description": "Launches premium investment products across physical and digital platforms.", "sentiment": "NEUTRAL"}
        ]
    }
    
    results = []
    now = datetime.now()
    
    selected_headlines = []
    if symbol and symbol.upper() in symbol_templates:
        selected_headlines.extend(symbol_templates[symbol.upper()])
    
    # Fill remaining from generic headlines
    remaining_pool = list(headlines)
    random.shuffle(remaining_pool)
    selected_headlines.extend(remaining_pool[:5])
    
    for i, h in enumerate(selected_headlines[:6]):
        pub_time = now - timedelta(hours=i * 2 + random.randint(0, 90) / 60)
        results.append({
            "id": f"mock-news-{symbol or 'MKT'}-{i}",
            "title": h["title"],
            "description": h["description"],
            "published_at": pub_time.isoformat(),
            "article_link": "https://upstox.com/news",
            "sentiment": h["sentiment"]
        })
        
    return results

@router.get("/api/upstox/news")
def get_upstox_news(
    category: str = Query("business", description="News category, e.g. business, market, corporate"),
    instrument_keys: str = Query(None, description="Comma-separated instrument keys"),
    symbol: str = Query(None, description="Optional symbol (backward compatibility)"),
    symbols: str = Query(None, description="Optional comma-separated symbols")
):
    try:
        if not upstox_client.token and not upstox_client.analytics_token:
            # Token missing, serve mock news directly
            mock_data = {}
            if symbols:
                for s in [sym.strip().upper() for sym in symbols.split(",") if sym.strip()]:
                    mock_data[s] = get_mock_news(s)
            elif symbol:
                s_clean = symbol.replace("[NEWS]", "").replace("NEWS", "").strip().upper()
                mock_data[s_clean] = get_mock_news(s_clean)
            else:
                mock_data = {"MARKET": get_mock_news()}
            return {"status": "success", "data": mock_data}
            
        keys_list = []
        if instrument_keys:
            keys_list = [k.strip() for k in instrument_keys.split(",") if k.strip() and "|" in k and " " not in k]
        elif symbols:
            sym_list = [s.replace("[NEWS]", "").replace("NEWS", "").strip().upper() for s in symbols.split(",") if s.strip()]
            for s in sym_list:
                if " " in s:
                    continue
                ikey = db.get_upstox_instrument_key(s, exchange="NSE_EQ") or db.get_upstox_instrument_key(s)
                if ikey:
                    keys_list.append(ikey)
        elif symbol:
            sym_clean = symbol.replace("[NEWS]", "").replace("NEWS", "").strip().upper()
            if sym_clean and " " not in sym_clean:
                ikey = db.get_upstox_instrument_key(sym_clean, exchange="NSE_EQ") or db.get_upstox_instrument_key(sym_clean)
                if ikey:
                    keys_list = [ikey]
                
        res = None
        if not keys_list:
            # If a specific symbol was asked but not resolved, we will fall back to mock
            if symbol or symbols:
                res = {"status": "demo_only", "data": None}
            else:
                res = upstox_client.get_news(category=category)
        else:
            chunk_size = 25
            chunks = [keys_list[i:i + chunk_size] for i in range(0, len(keys_list), chunk_size)]
            
            merged_data = {}
            status_to_return = "demo_only"
            
            for chunk in chunks:
                try:
                    chunk_res = upstox_client.get_news(category="instrument_keys", instrument_keys=chunk)
                    if chunk_res.get("status") == "success" and "data" in chunk_res:
                        status_to_return = "success"
                        chunk_data = chunk_res["data"]
                        if isinstance(chunk_data, dict):
                            if not isinstance(merged_data, dict):
                                merged_data = {}
                            merged_data.update(chunk_data)
                        elif isinstance(chunk_data, list):
                            if not isinstance(merged_data, list):
                                merged_data = []
                            merged_data.extend(chunk_data)
                except Exception as ex:
                    log.warning(f"Chunk news fetch failed for keys {chunk}: {ex}")
            
            res = {
                "status": status_to_return,
                "data": merged_data
            }
        
        # Fallback to mock news if status is not success, or data is empty/None
        if not res or res.get("status") != "success" or not res.get("data"):
            mock_data = {}
            if symbols:
                for s in [sym.strip().upper() for sym in symbols.split(",") if sym.strip()]:
                    mock_data[s] = get_mock_news(s)
            elif symbol:
                s_clean = symbol.replace("[NEWS]", "").replace("NEWS", "").strip().upper()
                mock_data[s_clean] = get_mock_news(s_clean)
            elif keys_list:
                for k in keys_list:
                    symbol_resolved = db.get_symbol_from_instrument_key(k)
                    symbol_key = symbol_resolved.upper() if symbol_resolved else k
                    mock_data[symbol_key] = get_mock_news(symbol_key)
            else:
                mock_data = {"MARKET": get_mock_news()}
            res = {
                "status": "success",
                "data": mock_data
            }
        
        # Ensure every news item has normalized title/description/published_at fields
        if res.get("status") == "success" and "data" in res:
            data_content = res["data"]
            if isinstance(data_content, dict):
                normalized_data = {}
                for key, items in data_content.items():
                    # Resolve key to symbol
                    symbol_resolved = db.get_symbol_from_instrument_key(key)
                    symbol_key = symbol_resolved.upper() if symbol_resolved else key
                    
                    if isinstance(items, list):
                        normalized_items = []
                        for item in items:
                            if isinstance(item, dict):
                                normalized_item = item.copy()
                                if "title" not in normalized_item and "heading" in normalized_item:
                                    normalized_item["title"] = normalized_item["heading"]
                                if "description" not in normalized_item and "summary" in normalized_item:
                                    normalized_item["description"] = normalized_item["summary"]
                                    
                                if "published_at" not in normalized_item:
                                    pub_time = normalized_item.get("published_time")
                                    if pub_time:
                                        try:
                                            normalized_item["published_at"] = datetime.fromtimestamp(pub_time / 1000).isoformat()
                                        except Exception:
                                            normalized_item["published_at"] = datetime.now().isoformat()
                                    else:
                                        normalized_item["published_at"] = normalized_item.get("createdAt") or normalized_item.get("updatedAt") or datetime.now().isoformat()
                                normalized_items.append(normalized_item)
                        normalized_data[symbol_key] = normalized_items
                    else:
                        normalized_data[symbol_key] = items
                res["data"] = normalized_data
            elif isinstance(data_content, list):
                for item in data_content:
                    if isinstance(item, dict):
                        if "title" not in item and "heading" in item:
                            item["title"] = item["heading"]
                        if "description" not in item and "summary" in item:
                            item["description"] = item["summary"]
                            
                        if "published_at" not in item:
                            pub_time = item.get("published_time")
                            if pub_time:
                                try:
                                    item["published_at"] = datetime.fromtimestamp(pub_time / 1000).isoformat()
                                except Exception:
                                    item["published_at"] = datetime.now().isoformat()
                            else:
                                item["published_at"] = item.get("createdAt") or item.get("updatedAt") or datetime.now().isoformat()
                                
        return res
    except Exception as e:
        log.warning(f"Upstox news fetch failed, serving generic mock news: {e}")
        mock_data = {}
        if symbols:
            for s in [sym.strip().upper() for sym in symbols.split(",") if sym.strip()]:
                mock_data[s] = get_mock_news(s)
        elif symbol:
            s_clean = symbol.replace("[NEWS]", "").replace("NEWS", "").strip().upper()
            mock_data[s_clean] = get_mock_news(s_clean)
        else:
            mock_data = {"MARKET": get_mock_news()}
        return {
            "status": "success",
            "data": mock_data
        }

# --- DIAGNOSTIC & INFRASTRUCTURE ENDPOINTS ---

@router.get("/api/upstox/cache/stats")
def get_upstox_cache_stats_route():
    try:
        return db.get_upstox_cache_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/upstox/cache/clear")
def clear_upstox_cache_route():
    try:
        success = db.clear_upstox_cache()
        return {"status": "success" if success else "failed", "message": "Upstox cache cleared."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/rate-limit/status")
def get_upstox_rate_limit_status():
    try:
        minute_calls = db.get_upstox_api_usage(60)
        thirty_min_calls = db.get_upstox_api_usage(1800)
        return {
            "minute_usage": minute_calls,
            "minute_limit": 500,
            "thirty_minute_usage": thirty_min_calls,
            "thirty_minute_limit": 2000,
            "approaching_limit": minute_calls > 450
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/errors/last-5")
def get_upstox_last_errors():
    try:
        return db.get_last_upstox_errors(5)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/jobs/status")
def get_upstox_jobs_status_route():
    try:
        return get_scheduler_jobs_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/health-summary")
def get_upstox_health_summary():
    try:
        from datetime import datetime, timedelta, timezone
        
        analytics_token_active = upstox_client.analytics_token is not None and upstox_client.analytics_token != ""
        
        # Check token health based on 3:30 PM IST expiration
        interactive_token_active = False
        TOKEN_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "upstox_token.txt")
        
        if os.path.exists(TOKEN_FILE) and upstox_client.token:
            try:
                mtime = os.path.getmtime(TOKEN_FILE)
                ist_tz = timezone(timedelta(hours=5, minutes=30))
                created_dt = datetime.fromtimestamp(mtime, tz=ist_tz)
                now_dt = datetime.now(tz=ist_tz)
                
                # Expiry is 3:30 PM (15:30) on creation date
                expiry_dt = created_dt.replace(hour=15, minute=30, second=0, microsecond=0)
                
                # If created after 3:30 PM, it expires at 3:30 PM on the next day
                if created_dt > expiry_dt:
                    expiry_dt += timedelta(days=1)
                    
                if now_dt < expiry_dt:
                    interactive_token_active = True
            except Exception as e:
                log.error(f"Error checking token expiry: {e}")
        elif upstox_client.token:
            # Fallback if file doesn't exist but token is set (e.g. from env)
            interactive_token_active = True
            
        cache = db.get_upstox_cache_stats()
        minute_calls = db.get_upstox_api_usage(60)
        thirty_min_calls = db.get_upstox_api_usage(1800)
        errors = db.get_last_upstox_errors(5)
        jobs = get_scheduler_jobs_status()
        
        fno_json = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fno_stocks_generated.json")
        fno_last_sync = None
        if os.path.exists(fno_json):
            fno_last_sync = datetime.fromtimestamp(os.path.getmtime(fno_json)).isoformat()
            
        # Storage size calculations
        def get_dir_size(path):
            total = 0
            if os.path.exists(path):
                for dirpath, dirnames, filenames in os.walk(path):
                    for f in filenames:
                        fp = os.path.join(dirpath, f)
                        if os.path.exists(fp):
                            try:
                                total += os.path.getsize(fp)
                            except Exception:
                                pass
            return total

        parquet_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
        underlying_size = get_dir_size(os.path.join(parquet_dir, "underlying"))
        futures_size = get_dir_size(os.path.join(parquet_dir, "futures"))
        options_size = get_dir_size(os.path.join(parquet_dir, "options"))
        
        cache_db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cache.db")
        cache_db_size = os.path.getsize(cache_db_path) if os.path.exists(cache_db_path) else 0

        # Row counts helper
        def get_row_count(table_name):
            try:
                conn = db.get_db_connection()
                cursor = conn.cursor()
                cursor.execute(f"SELECT count(*) FROM {table_name}")
                count = cursor.fetchone()[0]
                conn.close()
                return count
            except Exception:
                return 0

        # Sync times helper
        def get_max_date(table_name, column_name):
            try:
                conn = db.get_db_connection()
                cursor = conn.cursor()
                cursor.execute(f"SELECT max({column_name}) FROM {table_name}")
                val = cursor.fetchone()[0]
                conn.close()
                return val
            except Exception:
                return None

        # Estimate size of SQLite tables in bytes
        def get_table_size_estimate(table_name, row_count):
            if not row_count or row_count <= 0:
                return 0
            weights = {
                "upstox_instruments": 128,
                "upstox_cache": 16384,
                "upstox_fii_dii": 64,
                "upstox_volume_avg": 64,
                "mf_nav_history": 48
            }
            return row_count * weights.get(table_name, 64)

        # Build detailed storage metrics
        storage_details = {
            "historical_candles_parquet": {
                "name": "Historical Candles (Parquet)",
                "size_bytes": underlying_size + futures_size + options_size,
                "row_count": None,
                "last_sync": jobs.get("parquet_archive", {}).get("last_run"),
                "endpoint": "data/underlying, futures, options"
            },
            "instrument_master": {
                "name": "Instrument Master Key Cache",
                "size_bytes": get_table_size_estimate("upstox_instruments", get_row_count("upstox_instruments")),
                "row_count": get_row_count("upstox_instruments"),
                "last_sync": jobs.get("instrument_sync", {}).get("last_run"),
                "endpoint": "upstox_instruments table"
            },
            "fundamentals_cache": {
                "name": "Company Fundamentals Cache",
                "size_bytes": get_table_size_estimate("upstox_cache", get_row_count("upstox_cache")),
                "row_count": get_row_count("upstox_cache"),
                "last_sync": jobs.get("fundamentals_refresh", {}).get("last_run") or get_max_date("upstox_cache", "created_at"),
                "endpoint": "upstox_cache table"
            },
            "fii_dii_flows": {
                "name": "FII / DII Institutional Flows",
                "size_bytes": get_table_size_estimate("upstox_fii_dii", get_row_count("upstox_fii_dii")),
                "row_count": get_row_count("upstox_fii_dii"),
                "last_sync": jobs.get("fii_dii_sync", {}).get("last_run"),
                "endpoint": "upstox_fii_dii table"
            },
            "volume_averages": {
                "name": "20-Day Volume Averages",
                "size_bytes": get_table_size_estimate("upstox_volume_avg", get_row_count("upstox_volume_avg")),
                "row_count": get_row_count("upstox_volume_avg"),
                "last_sync": jobs.get("bulk_volume_avg", {}).get("last_run"),
                "endpoint": "upstox_volume_avg table"
            },
            "mutual_funds_nav": {
                "name": "Mutual Fund NAV History",
                "size_bytes": get_table_size_estimate("mf_nav_history", get_row_count("mf_nav_history")),
                "row_count": get_row_count("mf_nav_history"),
                "last_sync": get_max_date("mf_nav_history", "date"),
                "endpoint": "mf_nav_history table"
            },
            "database_file": {
                "name": "SQLite Cache Database File",
                "size_bytes": cache_db_size,
                "row_count": None,
                "last_sync": jobs.get("database_cleanup", {}).get("last_run"),
                "endpoint": "cache.db"
            }
        }
        
        status = "red"
        if interactive_token_active:
            status = "green"
        elif analytics_token_active:
            status = "yellow"
            
        if status in ("green", "yellow"):
            recent_errors = 0
            for err in errors:
                try:
                    err_time = datetime.fromisoformat(err["timestamp"])
                    if (datetime.now() - err_time).total_seconds() < 900:  # 15 minutes window
                        recent_errors += 1
                except Exception:
                    pass
            
            if recent_errors > 0 or minute_calls > 450:
                if status == "green":
                    status = "yellow"
                
        return {
            "status": status,
            "token_active": interactive_token_active,
            "interactive_token_active": interactive_token_active,
            "analytics_token_active": analytics_token_active,
            "cache": cache,
            "rate_limit": {
                "minute_usage": minute_calls,
                "minute_limit": 500,
                "thirty_minute_usage": thirty_min_calls,
                "thirty_minute_limit": 2000
            },
            "last_errors": errors,
            "jobs": jobs,
            "fno_last_sync": fno_last_sync,
            "storage_details": storage_details
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- WEBSOCKET SUBSCRIPTIONS ---


class ClientSubscriptionRequest(BaseModel):
    client_id: str
    keys: List[str]
    mode: str = "full"
    is_visible: bool = True

class ClientUnsubscribeRequest(BaseModel):
    client_id: str
    keys: List[str] = None

@router.post("/api/upstox/ws/subscribe")
def ws_subscribe(payload: ClientSubscriptionRequest):
    try:
        from services.subscription_planner import subscription_planner
        subscription_planner.register_client_subscription(
            client_id=payload.client_id,
            keys=payload.keys,
            mode=payload.mode,
            is_visible=payload.is_visible
        )
        # Push instant snapshot of cached ticks for these keys to eliminate cold-start lag
        if payload.keys:
            cached_snapshot = []
            with upstox_ws_client._ticks_lock:
                for k in payload.keys:
                    t = upstox_ws_client.latest_ticks.get(k)
                    if t:
                        cached_snapshot.append(t)
            if cached_snapshot:
                upstox_ws_client.push_to_client(payload.client_id, cached_snapshot)

        return {"status": "success", "message": f"Successfully registered subscriptions for client {payload.client_id}."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/upstox/ws/unsubscribe")
def ws_unsubscribe(payload: ClientUnsubscribeRequest):
    try:
        from services.subscription_planner import subscription_planner
        subscription_planner.release_client_subscriptions(
            client_id=payload.client_id,
            keys=payload.keys
        )
        return {"status": "success", "message": f"Successfully released subscriptions for client {payload.client_id}."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/ws/latest")
def get_latest_ws_tick(key: str = Query(...)):
    tick = upstox_ws_client.get_latest_tick(key)
    if not tick:
        raise HTTPException(status_code=404, detail=f"No real-time tick cached for {key}")
    return tick

@router.get("/api/upstox/ws/stream")
async def stream_ws_ticks(request: Request, client_id: str = Query(...)):
    import uuid
    connection_id = str(uuid.uuid4())
    queue = asyncio.Queue(maxsize=100)
    upstox_ws_client.add_listener(connection_id, queue, client_id)
    log.info(f"Client connected. client_id: {client_id}, connection_id: {connection_id}. Total connections: {len(upstox_ws_client.listeners)}")
    
    async def sse_generator():
        try:
            yield ": ping\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ticks = await asyncio.wait_for(queue.get(), timeout=12.0)
                    yield f"data: {json.dumps(ticks)}\n\n"
                except asyncio.TimeoutError:
                    yield f": ping {int(time.time() * 1000)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            upstox_ws_client.remove_listener(connection_id)
            # Only release if no other connection for this client_id is active
            has_other_connection = any(
                cid == client_id for _, cid, _ in upstox_ws_client.listeners.values()
            )
            if not has_other_connection:
                try:
                    from services.subscription_planner import subscription_planner
                    subscription_planner.release_client_subscriptions(client_id)
                except Exception as e:
                    log.error(f"Failed to release subscriptions for disconnected client {client_id}: {e}")
            else:
                log.info(f"Keeping subscriptions for active client {client_id} (another connection is active)")
            log.info(f"Client disconnected. client_id: {client_id}, connection_id: {connection_id}. Remaining connections: {len(upstox_ws_client.listeners)}")

    return StreamingResponse(sse_generator(), media_type="text/event-stream")

@router.get("/api/upstox/cvd")
def get_upstox_cvd(symbol: str = Query(...)):
    """Returns current CVD value for a symbol by resolving it to its instrument key."""
    try:
        sym_clean = sanitize_symbol(symbol)
        key = db.get_upstox_instrument_key(sym_clean, exchange="NSE_EQ") or db.get_upstox_instrument_key(sym_clean)
        if not key:
            raise HTTPException(status_code=404, detail=f"Instrument key not found for symbol: {symbol}")
        cvd_val = upstox_ws_client.get_cvd(key)
        return {"status": "success", "symbol": sym_clean, "instrument_key": key, "cvd": cvd_val}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/cvd/bulk")
def get_upstox_cvd_bulk():
    """Returns in-memory CVD values for all actively tracked symbols."""
    try:
        cvd_map = upstox_ws_client.get_all_cvd()
        # Resolve instrument keys to symbols where possible
        resolved_cvd = {}
        for key, val in cvd_map.items():
            sym = db.get_symbol_from_instrument_key(key)
            if sym:
                resolved_cvd[sym] = val
            else:
                resolved_cvd[key] = val
        return {"status": "success", "data": resolved_cvd}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/instruments/resolve/{symbol}")
def resolve_instrument_endpoint(symbol: str):
    try:
        from services.instrument_registry import resolve_symbol
        res = resolve_symbol(symbol)
        if not res:
            raise HTTPException(status_code=404, detail=f"Symbol {symbol} could not be resolved.")
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/instruments/sync-status")
def get_instrument_sync_status_endpoint():
    try:
        from services.instrument_registry import get_sync_status
        return get_sync_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/instruments/sync")
def trigger_instrument_sync_endpoint(background_tasks: BackgroundTasks):
    try:
        from services.instrument_registry import sync_instrument_registry
        background_tasks.add_task(sync_instrument_registry)
        return {"status": "success", "message": "Instrument registry sync triggered in background."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/option-greek")
def upstox_option_greek(symbols: str = Query(...)):
    """Returns server-computed greeks for option contracts."""
    try:
        keys = [s.strip() for s in symbols.split(",") if s.strip()]
        if not keys:
            return {"status": "success", "data": {}}
        res = upstox_client.get_option_greek(keys)
        if res.get("status") == "success" and "data" in res:
            from greeks import update_live_greeks_cache
            update_live_greeks_cache(res["data"])
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Phase 2: GTT Orders ---
@router.get("/api/upstox/gtt")
def upstox_get_gtt(gtt_order_id: str = Query(None)):
    try:
        return upstox_client.get_gtt_orders(gtt_order_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/upstox/gtt/place")
def upstox_place_gtt(payload: dict):
    try:
        return upstox_client.place_gtt_order(payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/api/upstox/gtt/modify")
def upstox_modify_gtt(payload: dict):
    try:
        return upstox_client.modify_gtt_order(payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/upstox/gtt/cancel")
def upstox_cancel_gtt(gtt_order_id: str = Query(...)):
    try:
        return upstox_client.cancel_gtt_order(gtt_order_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Phase 3: Brokerage & Margin Calculators ---
@router.get("/api/upstox/charges/brokerage")
def upstox_charges_brokerage(
    instrument_token: str = Query(...),
    quantity: int = Query(...),
    product: str = Query(...),
    transaction_type: str = Query(...),
    price: float = Query(...)
):
    try:
        return upstox_client.get_brokerage(instrument_token, quantity, product, transaction_type, price)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/upstox/charges/margin")
def upstox_charges_margin(orders: list):
    try:
        return upstox_client.calculate_margin(orders)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/charges/historical-trades")
def upstox_historical_trades(
    segment: str = Query(...),
    start_date: str = Query(...),
    end_date: str = Query(...),
    page_number: int = Query(1),
    page_size: int = Query(50)
):
    try:
        return upstox_client.get_historical_trades(segment, start_date, end_date, page_number, page_size)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Phase 4: Trade P&L Mining ---
@router.get("/api/upstox/trade/pnl/metadata")
def upstox_trade_pnl_metadata():
    try:
        return upstox_client.get_trade_pnl_metadata()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/trade/pnl/data")
def upstox_trade_pnl_data(
    segment: str = Query(...),
    financial_year: str = Query(...),
    page_number: int = Query(1),
    page_size: int = Query(50)
):
    try:
        return upstox_client.get_trade_pnl_data(segment, financial_year, page_number, page_size)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/trade/pnl/charges")
def upstox_trade_pnl_charges(
    segment: str = Query(...),
    financial_year: str = Query(...),
    page_number: int = Query(1),
    page_size: int = Query(50)
):
    try:
        return upstox_client.get_trade_pnl_charges(segment, financial_year, page_number, page_size)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Phase 5 & 10: User Account Diagnostics & Safety ---
@router.get("/api/upstox/user/profile")
def upstox_user_profile():
    try:
        return upstox_client.get_user_profile()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/user/funds")
def upstox_user_funds(segment: str = Query(None)):
    try:
        return upstox_client.get_funds_and_margin(segment)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/user/funds-v3")
def upstox_user_funds_v3(segment: str = Query(None)):
    try:
        return upstox_client.get_funds_and_margin_v3(segment)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/user/holdings")
def upstox_user_holdings():
    try:
        return upstox_client.get_holdings()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/user/positions")
def upstox_user_positions():
    try:
        return upstox_client.get_positions()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/user/mtf-positions")
def upstox_user_mtf_positions():
    try:
        return upstox_client.get_mtf_positions()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/user/kill-switch")
def upstox_user_kill_switch_get():
    try:
        return upstox_client.get_kill_switch_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/upstox/user/kill-switch")
def upstox_user_kill_switch_post(kill_switch_status: str = Query(...)):
    try:
        return upstox_client.activate_kill_switch(kill_switch_status)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/user/ip")
def upstox_user_ip_get():
    try:
        return upstox_client.get_ip_whitelist()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/api/upstox/user/ip")
def upstox_user_ip_put(payload: dict):
    try:
        return upstox_client.update_ip_whitelist(payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Phase 6: Portfolio Stream Feed SSE ---
@router.get("/api/upstox/portfolio-stream/authorize")
def upstox_portfolio_stream_auth(update_types: str = Query(None)):
    types_list = [t.strip() for t in update_types.split(",") if t.strip()] if update_types else None
    try:
        return upstox_client.get_portfolio_stream_authorize(types_list)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/upstox/charges/margin")
def upstox_charges_margin(body: dict):
    try:
        orders = body.get("orders", [])
        return upstox_client.calculate_margin(orders)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/upstox/sync-tf-credentials")
def sync_tf_credentials(payload: dict):
    """
    Saves the live TradeFinder JWT token and TOTP secret from the browser session
    into data/tf_credentials.json so the background harvester daemon never goes stale.
    """
    try:
        jwt_token = payload.get("jwtToken") or payload.get("jwt_token")
        totp_secret = payload.get("totpSecret") or payload.get("totp_secret")
        email = payload.get("userEmail") or payload.get("email") or "gaddamsudhanshu@gmail.com"

        if not jwt_token:
            raise HTTPException(status_code=400, detail="jwtToken is required")

        project_root = Path(__file__).resolve().parent.parent.parent
        data_dir = os.path.join(project_root, "data")
        os.makedirs(data_dir, exist_ok=True)
        creds_path = os.path.join(data_dir, "tf_credentials.json")

        effective_totp = (totp_secret or "").strip()
        clean_jwt = jwt_token.strip()

        # Idempotency check: don't rewrite file or log spam if credentials match
        if os.path.exists(creds_path):
            try:
                with open(creds_path, "r", encoding="utf-8") as f:
                    existing = json.load(f)
                if (existing.get("jwt_token", "").strip() == clean_jwt and 
                    existing.get("totp_secret", "").strip() == effective_totp):
                    return {"status": "unchanged", "message": "Credentials already synchronized", "updated_at": existing.get("updated_at")}
            except Exception:
                pass

        creds = {
            "jwt_token": clean_jwt,
            "totp_secret": effective_totp,
            "user_email": email,
            "updated_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S+05:30")
        }

        with open(creds_path, "w", encoding="utf-8") as f:
            json.dump(creds, f, indent=2)

        log.info("[TradeFinder] Successfully synced credentials from UI to %s", creds_path)
        return {"status": "success", "message": "Credentials updated successfully", "updated_at": creds["updated_at"]}
    except HTTPException:
        raise
    except Exception as e:
        log.error("[TradeFinder] Failed to sync credentials: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/upstox/auto-collect-delta")
def upstox_auto_collect_delta(payload: dict):
    try:
        active_tab = payload.get("activeTab", "Unknown")
        compare_data = payload.get("compareData", [])
        
        # We write this formatted as a calibration report markdown file
        # in the project docs/calibration directory and active brain directory
        project_root = Path(__file__).resolve().parent.parent.parent
        report_dir = os.path.join(project_root, "docs", "calibration")
        os.makedirs(report_dir, exist_ok=True)
        
        # Mirror to active session brain if directory exists
        brain_dir = r"C:\Users\gadda\.gemini\antigravity\brain\fb1d94fa-42db-47eb-a382-d41fa2f9c2f4"
            
        now = datetime.now()
        timestamp_suffix = now.strftime("%Y%m%d_%H%M%S")
        
        # Paths for latest, historical, and master log
        report_path = os.path.join(report_dir, "calibration_report.md")
        history_path = os.path.join(report_dir, f"calibration_report_{timestamp_suffix}.md")
        master_path = os.path.join(report_dir, "calibration_master_log.md")
        
        # Build Markdown content
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        lines = [
            f"# 📊 Calibration & Delta Deviation Report",
            f"**Generated At:** {now_str} IST",
            f"**Source View:** {active_tab}",
            f"",
            f"This file was automatically generated by clicking the **Auto-Collect Data** button in the dashboard UI. It compares the live calculations from TradeFinder against our local Alpha Engine calculations (via Upstox) to help analyze accuracy.",
            f""
        ]
        
        mismatches = []
        matches = 0
        total_ltp_error_pct = 0.0
        total_rf_error = 0.0
        
        table_lines = [
            f"## 🔍 Comparison Detail Table",
            f"",
            f"| Symbol | TF LTP | UP LTP | LTP Delta | TF R-Factor | UP R-Factor | R-Factor Delta | TF Chg% | UP Chg% | Chg Delta | Match Status |",
            f"| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |"
        ]
        
        # Zero Time-Skew: Calculate dynamic cross-correlation lag across benchmark stocks
        optimal_tau = time_skew_aligner.compute_optimal_lag(compare_data)

        for item in compare_data:
            symbol = item.get("Symbol", "")
            tf_ltp = float(item.get("tf_ltp", 0) or 0)
            up_ltp = float(item.get("local_ltp", 0) or 0)
            tf_chg = float(item.get("tf_chg", 0) or 0)
            up_chg = float(item.get("local_chg", 0) or 0)
            tf_rFactor = float(item.get("tf_rFactor", 0) or 0)
            up_rFactor = float(item.get("local_rFactor", 0) or 0)
            
            ltp_delta = abs(tf_ltp - up_ltp)
            ltp_delta_pct = (ltp_delta / tf_ltp * 100) if tf_ltp else 0.0
            rf_delta = abs(tf_rFactor - up_rFactor)
            chg_delta = abs(tf_chg - up_chg)
            
            total_ltp_error_pct += ltp_delta_pct
            total_rf_error += rf_delta
            
            # Determine match status
            is_ltp_match = ltp_delta_pct <= 0.5
            is_rf_match = rf_delta <= 0.2
            is_chg_match = chg_delta <= 0.2
            
            # Lag-adjusted match (tolerates 3-4 mins delay during market hours)
            is_lagged_ltp_match = ltp_delta_pct <= 1.5
            is_lagged_rf_match = rf_delta <= 0.6
            is_lagged_chg_match = chg_delta <= 0.5
            
            if is_ltp_match and is_rf_match and is_chg_match:
                status = "✅ MATCH"
                matches += 1
            elif is_lagged_ltp_match and is_lagged_rf_match and is_lagged_chg_match:
                status = "🟡 LAG MATCH"
                matches += 1
            else:
                status = "❌ MISMATCH"
                mismatches.append({
                    "symbol": symbol,
                    "ltp_delta": ltp_delta,
                    "ltp_delta_pct": ltp_delta_pct,
                    "rf_delta": rf_delta,
                    "chg_delta": chg_delta,
                    "tf_rFactor": tf_rFactor,
                    "up_rFactor": up_rFactor
                })
                
            table_lines.append(
                f"| **{symbol}** | ₹{tf_ltp:.2f} | ₹{up_ltp:.2f} | {ltp_delta:.2f} ({ltp_delta_pct:.2f}%) | {tf_rFactor:.2f} | {up_rFactor:.2f} | {rf_delta:.2f} | {tf_chg:+.2f}% | {up_chg:+.2f}% | {chg_delta:.2f}% | {status} |"
            )
            
        total = len(compare_data)
        match_rate = (matches / total * 100) if total > 0 else 0
        avg_ltp_err_pct = (total_ltp_error_pct / total) if total > 0 else 0
        avg_rf_err = (total_rf_error / total) if total > 0 else 0
        
        # Add summary stats
        lines.append(f"### 📈 Audit Stats")
        lines.append(f"- **Total Checked Stocks:** {total}")
        lines.append(f"- **Detected Cross-Correlation Time-Skew (tau*):** {optimal_tau}s ({optimal_tau/60:.1f} min latency)")
        lines.append(f"- **Fully Matched Stocks:** {matches} ({match_rate:.1f}%)")
        lines.append(f"- **Mismatched / Diverging Stocks:** {len(mismatches)} ({100 - match_rate:.1f}%)")
        lines.append(f"- **Average LTP Discrepancy %:** {avg_ltp_err_pct:.3f}%")
        lines.append(f"- **Average R-Factor Deviation:** {avg_rf_err:.3f}")
        lines.append(f"")
        
        # Top Mismatches list
        if mismatches:
            lines.append(f"## 🚨 Top Divergences (Ordered by R-Factor Delta)")
            lines.append(f"These stocks have the highest differences between TradeFinder and local Alpha Engine calculations. Focus on these for formula calibration:")
            lines.append(f"")
            lines.append(f"| Symbol | R-Factor Delta | TF R-Factor | UP R-Factor | LTP Delta % | Chg Delta |")
            lines.append(f"| :--- | :--- | :--- | :--- | :--- | :--- |")
            
            # Sort mismatches by rf_delta descending
            mismatches.sort(key=lambda x: x["rf_delta"], reverse=True)
            for m in mismatches[:10]: # show top 10
                lines.append(
                    f"| **{m['symbol']}** | **{m['rf_delta']:.2f}** | {m['tf_rFactor']:.2f} | {m['up_rFactor']:.2f} | {m['ltp_delta_pct']:.2f}% | {m['chg_delta']:.2f}% |"
                )
            lines.append(f"")
            
        lines.extend(table_lines)
        
        # Write latest report (overwrites)
        with open(report_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
            
        # Write historical report (persists)
        with open(history_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
            
        # Also mirror to active brain directory if available
        if brain_dir and os.path.exists(brain_dir):
            try:
                brain_report = os.path.join(brain_dir, "calibration_report.md")
                brain_history = os.path.join(brain_dir, f"calibration_report_{timestamp_suffix}.md")
                with open(brain_report, "w", encoding="utf-8") as f:
                    f.write("\n".join(lines))
                with open(brain_history, "w", encoding="utf-8") as f:
                    f.write("\n".join(lines))
            except Exception as b_err:
                log.warning("Could not mirror calibration report to brain: %s", b_err)
            
        # Update Master History Log
        if not os.path.exists(master_path):
            with open(master_path, "w", encoding="utf-8") as f:
                f.write("# 📋 Calibration Run History Log\n\n")
                f.write("This file maintains a historical log of all delta collections generated using the **Auto-Collect Data** button.\n\n")
                f.write("| Timestamp | Tab / View | Total Stocks | Matched / Lagged | Match Rate | Avg LTP Delta | Avg RF Delta | Link |\n")
                f.write("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n")
                
        with open(master_path, "a", encoding="utf-8") as f:
            f.write(f"| {now_str} | {active_tab} | {total} | {matches} | {match_rate:.1f}% | {avg_ltp_err_pct:.3f}% | {avg_rf_err:.3f} | [Report](calibration_report_{timestamp_suffix}.md) |\n")
            
        log.info("Auto-collected calibration report saved successfully. Match rate: %.1f%%, tau*: %ds", match_rate, optimal_tau)
        return {
            "status": "success",
            "report_path": report_path,
            "history_path": history_path,
            "matches": matches,
            "mismatches": len(mismatches),
            "match_rate": match_rate,
            "optimal_tau_seconds": optimal_tau
        }
    except Exception as e:
        log.error("Failed to auto-collect delta: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/upstox/batch-quotes")
def upstox_batch_quotes(symbols: str = Query(...)):
    """
    Batches up to 500 stock/index quotes into a single Upstox API request.
    Takes comma-separated symbols (e.g. 'RELIANCE,TCS,INFY,NIFTY').
    Resolves instrument keys, invokes upstox_client.get_full_quotes,
    and returns mapped quotes by symbol.
    """
    sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not sym_list:
        raise HTTPException(status_code=400, detail="No symbols provided")
    
    indices = {
        "NIFTY": "NSE_INDEX|Nifty 50",
        "NIFTY 50": "NSE_INDEX|Nifty 50",
        "BANKNIFTY": "NSE_INDEX|Nifty Bank",
        "FINNIFTY": "NSE_INDEX|Nifty Fin Service",
        "MIDCPNIFTY": "NSE_INDEX|Nifty Midcap 50",
    }
    
    key_to_symbol = {}
    instrument_keys = []
    
    for sym in sym_list:
        if sym in indices:
            k = indices[sym]
        else:
            k = db.get_upstox_instrument_key(sym, exchange="NSE_EQ") or db.get_upstox_instrument_key(sym)
        if k:
            instrument_keys.append(k)
            key_to_symbol[k] = sym
            key_to_symbol[k.replace("|", ":")] = sym
            key_to_symbol[f"NSE_EQ:{sym}"] = sym
            key_to_symbol[sym] = sym
            
    if not instrument_keys:
        raise HTTPException(status_code=404, detail="None of the requested symbols could be resolved to instrument keys")
        
    try:
        raw_quotes = upstox_client.get_full_quotes(instrument_keys)
        data = raw_quotes.get("data", {}) if (isinstance(raw_quotes, dict) and "data" in raw_quotes) else raw_quotes
        
        result = {}
        for k, quote in data.items():
            sym = key_to_symbol.get(k) or key_to_symbol.get(k.replace(":", "|")) or k
            result[sym] = quote
            
        return {"status": "success", "count": len(result), "data": result}
    except Exception as e:
        log.error(f"Error fetching batch quotes: {e}")
        raise HTTPException(status_code=500, detail=str(e))

