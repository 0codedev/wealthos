from logger import get_logger
log = get_logger("nse_router", tag="NSE_RT")

import os
import sys
import time
import random
import json
from datetime import datetime, timedelta, timezone
from typing import List
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, Request, Response
from pydantic import BaseModel

# Ensure python-bridge root is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from routers.shared import (
    nse,
    is_market_hours,
    sanitize_symbol,
    get_cached_nse_data,
    set_cached_nse_data,
    format_date_for_nse,
    run_with_retry,
    fetch_endpoint_with_retry,
    serialize,
    scan_progress,
    bulk_fetch_delivery_history,
    orderflow_watchlist,
    compute_orderflow_metrics_for_symbol,
    is_indian_market_open
)

router = APIRouter()

class WatchlistUpdate(BaseModel):
    symbols: List[str]

@router.get("/api/nse/fno-universe")
def get_fno_universe():
    try:
        fno_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fno_stocks_generated.json")
        sector_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sector_constituents_generated.json")
        
        if not os.path.exists(fno_path) or not os.path.exists(sector_path):
            log.info("Generated files not found. Triggering sync inline...")
            from update_fno_universe import run_sync
            run_sync()
            
        if not os.path.exists(fno_path) or not os.path.exists(sector_path):
            raise Exception("Failed to generate F&O universe configuration files.")
            
        with open(fno_path, "r", encoding="utf-8") as f:
            fno_stocks = json.load(f)
            
        with open(sector_path, "r", encoding="utf-8") as f:
            sector_constituents = json.load(f)
            
        return {
            "status": "success",
            "fno_stocks": fno_stocks,
            "sector_constituents": sector_constituents
        }
    except Exception as e:
        log.error(f"F&O Universe fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/nse/fno-universe/sync")
def trigger_fno_universe_sync():
    try:
        from update_fno_universe import run_sync
        success = run_sync()
        if not success:
            raise Exception("Sync script returned failure status.")
        
        fno_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fno_stocks_generated.json")
        last_sync = None
        if os.path.exists(fno_path):
            last_sync = datetime.fromtimestamp(os.path.getmtime(fno_path)).isoformat()
            
        return {
            "status": "success", 
            "message": "F&O Universe successfully synchronized with official NSE lists.",
            "last_sync": last_sync
        }
    except Exception as e:
        log.error(f"F&O Universe manual sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- OPTION CHAINS ---

@router.get("/api/nse/option-chain")
def get_option_chain(
    response: Response,
    symbol: str = Query(..., description="Target symbol (e.g. NIFTY, SBIN)"),
    expiry: str = Query(None, description="Target expiry date (e.g. 26-May-2026)"),
    force: bool = Query(False, description="Force refresh from source")
):
    symbol = sanitize_symbol(symbol)
    
    cache_key = f"option_chain_{symbol}_{expiry or 'latest'}"
    if not force:
        ttl = 15 if is_market_hours() else 1800
        cached_data = get_cached_nse_data(cache_key, ttl_seconds=ttl)
        if cached_data is not None:
            log.info(f"Serving option chain for {symbol} from cache")
            return cached_data
            
    indices = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"]
    try:
        time.sleep(random.uniform(0.5, 1.2))
        
        target_expiry = expiry
        if not target_expiry:
            expiry_url = f"https://www.nseindia.com/api/option-chain-contract-info?symbol={symbol}"
            try:
                res_expiry = fetch_endpoint_with_retry(expiry_url)
                expiry_dates = res_expiry.json().get("expiryDates", [])
            except Exception:
                expiry_dates = []

            if not expiry_dates:
                raise HTTPException(status_code=404, detail=f"No F&O expiry dates found for {symbol}. Stock may not be in the F&O segment.")
            target_expiry = expiry_dates[0]
            
        option_type = "Indices" if symbol in indices else "Equity"
        url = f"https://www.nseindia.com/api/option-chain-v3?type={option_type}&symbol={symbol}&expiry={target_expiry}"
        
        res = fetch_endpoint_with_retry(url)
        data = res.json()
        
        set_cached_nse_data(cache_key, data, ttl_seconds=15 if is_market_hours() else 1800)
        return data
    except HTTPException:
        raise
    except Exception as e:
        log.warning(f"Option chain failed for {symbol}: {e}")
        cached_data = get_cached_nse_data(cache_key, ttl_seconds=86400)
        if cached_data is not None:
            log.info(f"Serving expired cached option chain for {symbol} on error")
            response.headers["X-Data-Status"] = "stale"
            response.headers["X-Data-Warning"] = f"Failed to fetch live option chain for {symbol}. Showing cached database fallback."
            return cached_data
        raise HTTPException(status_code=500, detail=str(e))

# --- EQUITY DELIVERY HISTORY ---

@router.get("/api/nse/delivery-history")
def get_delivery_history(
    response: Response,
    symbol: str = Query(...),
    from_date: str = Query(None, description="YYYY-MM-DD format"),
    to_date: str = Query(None, description="YYYY-MM-DD format"),
    force: bool = Query(False, description="Force refresh and bypass market hours check")
):
    symbol = sanitize_symbol(symbol)
    
    if not to_date:
        to_date = datetime.now().strftime("%Y-%m-%d")
    if not from_date:
        from_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
        
    cached_df = db.get_cached_delivery(symbol, from_date, to_date)
    
    if is_market_hours() and not force:
        if cached_df is not None and not cached_df.empty:
            log.info(f"Serving delivery history for {symbol} ({from_date} to {to_date}) (Market Hours)")
            return cached_df.to_dict(orient="records")
        else:
            raise HTTPException(
                status_code=400,
                detail="Market is currently open. Direct NSE API calls are restricted during market hours to prevent rate limits. Use force=true to bypass."
            )
            
    if not force and cached_df is not None and not cached_df.empty:
        log.info(f"Serving delivery history for {symbol} ({from_date} to {to_date})")
        return cached_df.to_dict(orient="records")
        
    log.info(f"Fetching delivery history from NSE for {symbol} ({from_date} to {to_date})")
    
    from_nse = format_date_for_nse(from_date)
    to_nse = format_date_for_nse(to_date)
    
    try:
        time.sleep(random.uniform(1.2, 2.5))
        df = run_with_retry(nse.equity.delivery_history, symbol, from_nse, to_nse)
        
        db.save_delivery(symbol, df)
        
        refetched = db.get_cached_delivery(symbol, from_date, to_date)
        if refetched is not None:
            return refetched.to_dict(orient="records")
            
        return serialize(df)
    except Exception as e:
        log.error(f"Delivery history fetch failed for {symbol}: {e}")
        fallback = db.get_cached_delivery(symbol, from_date, to_date)
        if fallback is not None:
            response.headers["X-Data-Status"] = "stale"
            response.headers["X-Data-Warning"] = f"Failed to fetch delivery history for {symbol}. Showing cached database fallback."
            return fallback.to_dict(orient="records")
        raise HTTPException(status_code=500, detail=str(e))

# --- INSIDER TRADING ---

@router.get("/api/nse/insider-trading")
def get_insider_trading(
    response: Response,
    symbol: str = Query(None, description="Optional symbol to filter"),
    from_date: str = Query(None, description="YYYY-MM-DD format"),
    to_date: str = Query(None, description="YYYY-MM-DD format"),
    force: bool = Query(False, description="Force refresh and bypass market hours check")
):
    if symbol:
        symbol = sanitize_symbol(symbol)
    cache_results = db.get_cached_insider(symbol, from_date, to_date)
    
    if is_market_hours() and not force:
        if cache_results:
            log.info("Serving insider trading data from SQLite (Market Hours)")
            return cache_results
        else:
            raise HTTPException(
                status_code=400,
                detail="Market is currently open. Direct NSE API calls are restricted during market hours to prevent rate limits. Use force=true to bypass."
            )
            
    should_fetch = True
    if not force and cache_results:
        newest_item = cache_results[0]
        created_at_str = newest_item.get('created_at', datetime.now().isoformat())
        try:
            created_at = datetime.fromisoformat(created_at_str.replace('Z', ''))
            if datetime.now() - created_at < timedelta(hours=12):
                should_fetch = False
        except Exception:
            pass
            
    if not should_fetch:
        log.info(f"Serving insider trading data from SQLite")
        return cache_results
        
    log.info(f"Fetching insider trading data from NSE")
    try:
        time.sleep(random.uniform(1.5, 3.0))
        if symbol:
            raw_data = run_with_retry(
                nse.insider.insider_data,
                symbol.upper().strip(), 
                from_date=format_date_for_nse(from_date), 
                to_date=format_date_for_nse(to_date)
            )
        else:
            raw_data = run_with_retry(nse.insider.insider_data)
            
        db.save_insider(raw_data)
        return db.get_cached_insider(symbol, from_date, to_date)
    except Exception as e:
        log.error(f"Insider trading fetch failed: {e}")
        if cache_results:
            response.headers["X-Data-Status"] = "stale"
            response.headers["X-Data-Warning"] = "Failed to fetch fresh insider trading data. Showing cached database fallback."
        return cache_results

# --- PROMOTER PLEDGED SHARES ---

@router.get("/api/nse/pledged-shares")
def get_pledged_shares(
    response: Response,
    symbol: str = Query(...),
    force: bool = Query(False, description="Force refresh and bypass market hours check")
):
    symbol = sanitize_symbol(symbol)
    cached = db.get_cached_pledged(symbol)
    
    if is_market_hours() and not force:
        if cached:
            log.info(f"Serving pledged shares for {symbol} (Market Hours)")
            return cached
        else:
            raise HTTPException(
                status_code=400,
                detail="Market is currently open. Direct NSE API calls are restricted during market hours to prevent rate limits. Use force=true to bypass."
            )
            
    should_fetch = True
    if not force and cached:
        updated_at = datetime.strptime(cached['updated_at'], "%Y-%m-%d")
        if datetime.now() - updated_at < timedelta(days=1):
            should_fetch = False
            
    if not should_fetch:
        log.info(f"Serving pledged shares for {symbol}")
        return cached
            
    log.info(f"Fetching pledged shares from NSE for {symbol}")
    try:
        time.sleep(random.uniform(1.0, 2.0))
        data = run_with_retry(nse.insider.getPledgedData, symbol)
        
        db.save_pledged(symbol, data)
        return db.get_cached_pledged(symbol)
    except Exception as e:
        log.error(f"Pledged shares fetch failed for {symbol}: {e}")
        if cached:
            response.headers["X-Data-Status"] = "stale"
            response.headers["X-Data-Warning"] = f"Failed to fetch pledged shares for {symbol}. Showing cached database fallback."
            return cached
        raise HTTPException(status_code=500, detail=str(e))

# --- MUTUAL FUND INSIDER ---

@router.get("/api/nse/mf-insider")
def get_mf_insider(
    response: Response,
    symbol: str = Query(None),
    isin: str = Query(None),
    force: bool = Query(False, description="Force refresh and bypass market hours check")
):
    if symbol:
        symbol = sanitize_symbol(symbol)
    if isin:
        isin = sanitize_symbol(isin)
    cached = db.get_cached_mf_insider(symbol, isin)
    
    if is_market_hours() and not force:
        if cached:
            log.info("Serving MF insider data (Market Hours)")
            return cached
        else:
            raise HTTPException(
                status_code=400,
                detail="Market is currently open. Direct NSE API calls are restricted during market hours to prevent rate limits. Use force=true to bypass."
            )
            
    if force or not cached:
        log.info("Fetching Mutual Fund insider data from NSE")
        try:
            time.sleep(random.uniform(1.5, 3.0))
            from_date = (datetime.now() - timedelta(days=7)).strftime("%d-%m-%Y")
            to_date = datetime.now().strftime("%d-%m-%Y")
            
            raw_data = run_with_retry(nse.mf.mf_insider_data, from_date=from_date, to_date=to_date)
            db.save_mf_insider(raw_data)
            cached = db.get_cached_mf_insider(symbol, isin)
        except Exception as e:
            log.error(f"MF insider fetch failed: {e}")
            if not cached:
                raise HTTPException(status_code=500, detail=str(e))
            response.headers["X-Data-Status"] = "stale"
            response.headers["X-Data-Warning"] = "Failed to fetch Mutual Fund insider data. Showing cached database fallback."
            
    return cached

# --- DELIVERY RADAR ---

@router.get("/api/nse/delivery-radar")
def get_delivery_radar():
    try:
        return db.get_all_cached_delivery_radar()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/nse/delivery-radar/scan-progress")
def get_scan_progress():
    return scan_progress

@router.post("/api/nse/delivery-radar/scan")
def start_delivery_radar_scan(
    background_tasks: BackgroundTasks,
    symbols: List[str] = Query(None, description="Optional list of symbols. If not provided, parses fno_stocks.ts")
):
    global scan_progress
    if scan_progress["is_scanning"]:
        raise HTTPException(status_code=400, detail="Scan is already in progress.")
        
    target_symbols = []
    if symbols:
        target_symbols = [s.strip().upper() for s in symbols if s.strip()]
    else:
        try:
            fno_path = os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data/fno_stocks.ts"))
            if os.path.exists(fno_path):
                with open(fno_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                import re
                found_symbols = re.findall(r"symbol:\s*['\"]([A-Z0-9&-]+)['\"]", content)
                if found_symbols:
                    target_symbols = list(set(found_symbols))
                    log.info(f"Parsed {len(target_symbols)} symbols from fno_stocks.ts")
        except Exception as e:
            log.info(f"Failed to parse fno_stocks.ts: {e}")
            
        if not target_symbols:
            target_symbols = ["SBIN", "RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "AXISBANK", "LT", "ITC"]
            log.info(f"Using fallback symbols list of size {len(target_symbols)}")
            
    background_tasks.add_task(bulk_fetch_delivery_history, target_symbols)
    return {"message": f"Scan started for {len(target_symbols)} symbols.", "status": "started"}

@router.post("/api/nse/delivery-radar/cancel")
def cancel_delivery_radar_scan():
    global scan_progress
    if not scan_progress["is_scanning"]:
        return {"message": "No scan is currently running."}
    scan_progress["is_scanning"] = False
    return {"message": "Cancellation request sent."}

# --- INTRADAY ORDER FLOW ---

@router.get("/api/nse/orderflow/live")
def get_live_orderflow(symbol: str = Query(..., description="Target symbol (e.g. NIFTY, SBIN)")):
    symbol = sanitize_symbol(symbol)
    
    core_symbols = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"}
    allowed_symbols = core_symbols | orderflow_watchlist
    
    conn = db.get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM intraday_orderflow 
            WHERE symbol = ? 
            ORDER BY timestamp DESC 
            LIMIT 1
        """, (symbol,))
        row = cursor.fetchone()
        if row:
            return dict(row)
    except Exception as e:
        log.error(f"Failed to fetch live orderflow from DB: {e}")
    finally:
        conn.close()

    if symbol not in allowed_symbols:
        return {
            "symbol": symbol,
            "timestamp": datetime.now().isoformat(),
            "time_slot": datetime.now().strftime("%H:%M"),
            "option_synergy": 0.0,
            "price_aggression": 0.0,
            "composite_val": 0.0,
            "p_inst": 0.0,
            "spot_price": 0.0,
            "r_factor": 1.0,
            "apex_signal": "NEUTRAL",
            "_source": "not_tracked"
        }
        
    log.info(f"No live tick in DB for {symbol}, computing on-the-fly...")
    compute_orderflow_metrics_for_symbol(symbol)
    
    conn = db.get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM intraday_orderflow 
            WHERE symbol = ? 
            ORDER BY timestamp DESC 
            LIMIT 1
        """, (symbol,))
        row = cursor.fetchone()
        if row:
            return dict(row)
    except Exception as e:
        log.error(f"Failed to fetch live orderflow on second try: {e}")
    finally:
        conn.close()
        
    raise HTTPException(status_code=404, detail=f"No order flow metrics found or calculated for {symbol}")

@router.get("/api/nse/orderflow/history")
def get_orderflow_history(
    symbol: str = Query(...),
    date: str = Query(None, description="YYYY-MM-DD format, defaults to today")
):
    symbol = sanitize_symbol(symbol)
    if not date:
        utc_now = datetime.now(timezone.utc)
        ist_now = utc_now + timedelta(hours=5, minutes=30)
        date = ist_now.strftime("%Y-%m-%d")
        
    history = db.get_intraday_history(symbol, date)
    return history

@router.get("/api/nse/orderflow/latest-bulk")
def get_latest_orderflow_bulk(
    symbols: str = Query(None, description="Comma-separated symbols"),
    background_tasks: BackgroundTasks = None
):
    conn = db.get_db_connection()
    try:
        cursor = conn.cursor()
        sym_list = []
        if symbols:
            sym_list = [s.upper().strip() for s in symbols.split(",") if s.strip()]
            placeholders = ",".join(["?"] * len(sym_list))
            query = f"""
                SELECT o1.* FROM intraday_orderflow o1
                INNER JOIN (
                    SELECT symbol, MAX(timestamp) as max_ts 
                    FROM intraday_orderflow 
                    WHERE symbol IN ({placeholders})
                    GROUP BY symbol
                ) o2 ON o1.symbol = o2.symbol AND o1.timestamp = o2.max_ts
            """
            cursor.execute(query, sym_list)
        else:
            query = """
                SELECT o1.* FROM intraday_orderflow o1
                INNER JOIN (
                    SELECT symbol, MAX(timestamp) as max_ts 
                    FROM intraday_orderflow 
                    GROUP BY symbol
                ) o2 ON o1.symbol = o2.symbol AND o1.timestamp = o2.max_ts
            """
            cursor.execute(query)
            
        rows = cursor.fetchall()
        result = {}
        for r in rows:
            row_dict = dict(r)
            result[row_dict["symbol"]] = row_dict
            
        if symbols and background_tasks and is_indian_market_open():
            utc_now = datetime.now(timezone.utc)
            ist_now = utc_now + timedelta(hours=5, minutes=30)
            
            for sym in sym_list:
                needs_update = False
                if sym not in result:
                    needs_update = True
                else:
                    try:
                        ts_val = datetime.strptime(result[sym]["timestamp"], "%Y-%m-%d %H:%M:%S")
                        if (ist_now - ts_val).total_seconds() > 1800:
                            needs_update = True
                    except Exception:
                        needs_update = True
                        
                if needs_update:
                    from routers.shared import currently_processing_orderflow, orderflow_processing_lock
                    with orderflow_processing_lock:
                        if sym not in currently_processing_orderflow:
                            background_tasks.add_task(compute_orderflow_metrics_for_symbol, sym)
                    
        return result
    except Exception as e:
        log.error(f"Failed to fetch latest bulk orderflow: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.post("/api/nse/orderflow/watchlist")
def update_orderflow_watchlist(payload: WatchlistUpdate):
    global orderflow_watchlist
    new_list = {s.upper().strip() for s in payload.symbols if s.strip()}
    # Update the watchlist in shared space
    import routers.shared
    routers.shared.orderflow_watchlist = new_list
    log.info(f"Updated active watchlist: {new_list}")
    return {"message": "Watchlist updated successfully", "watchlist": list(new_list)}

# --- UTILITIES ---

@router.get("/api/nse/market-status")
def get_market_status():
    cached = get_cached_nse_data("market-status", ttl_seconds=30)
    if cached is not None:
        return cached
    try:
        data = nse.equity.market_status()
        set_cached_nse_data("market-status", data)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/nse/all-indices")
def get_all_indices():
    cached = get_cached_nse_data("all-indices", ttl_seconds=15)
    if cached is not None:
        return cached
    try:
        data = serialize(nse.equity.all_indices())
        set_cached_nse_data("all-indices", data)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/nse/vix")
def get_vix_data():
    cached = get_cached_nse_data("vix", ttl_seconds=15)
    if cached is not None:
        return cached
    try:
        data = nse.equity.find_index("INDIA VIX")
        set_cached_nse_data("vix", data)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/nse/fno-stocks")
def get_nse_fno_stocks():
    cached = get_cached_nse_data("fno-stocks", ttl_seconds=30)
    if cached is not None:
        return cached
    try:
        stocks = nse.equity.all_stock_data()
        data = {"status": "success", "data": serialize(stocks)}
        set_cached_nse_data("fno-stocks", data)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── nsepython-backed Tier-3 fallback endpoints ───────────────────────────────

@router.get("/api/nse/quote-v2/{symbol}")
def get_quote_v2(symbol: str):
    """Tier-3 fallback using nsepython. Used by RealDataService.ts."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
    from nse_provider import get_quote
    result = get_quote(symbol.upper())
    if not result:
        raise HTTPException(status_code=503, detail=f"nsepython could not fetch {symbol}")
    return result


@router.get("/api/nse/option-chain-v2/{symbol}")
def get_option_chain_v2(symbol: str):
    """Full option chain via nsepython (all strikes, all expiries)."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
    from nse_provider import get_option_chain
    result = get_option_chain(symbol.upper())
    if not result:
        raise HTTPException(status_code=503, detail="Option chain unavailable")
    return result


@router.get("/api/nse/fii-dii")
def get_fii_dii_today():
    """FII/DII buy-sell data for today."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
    from nse_provider import get_fii_dii
    result = get_fii_dii()
    conn = db.get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM intraday_orderflow 
            WHERE symbol = ? 
            ORDER BY timestamp DESC 
            LIMIT 1
        """, (symbol,))
        row = cursor.fetchone()
        if row:
            return dict(row)
    except Exception as e:
        log.error(f"Failed to fetch live orderflow on second try: {e}")
    finally:
        conn.close()
        
    raise HTTPException(status_code=404, detail=f"No order flow metrics found or calculated for {symbol}")

@router.get("/api/nse/orderflow/history")
def get_orderflow_history(
    symbol: str = Query(...),
    date: str = Query(None, description="YYYY-MM-DD format, defaults to today")
):
    symbol = sanitize_symbol(symbol)
    if not date:
        utc_now = datetime.now(timezone.utc)
        ist_now = utc_now + timedelta(hours=5, minutes=30)
        date = ist_now.strftime("%Y-%m-%d")
        
    history = db.get_intraday_history(symbol, date)
    return history

@router.get("/api/nse/orderflow/latest-bulk")
def get_latest_orderflow_bulk(
    symbols: str = Query(None, description="Comma-separated symbols"),
    background_tasks: BackgroundTasks = None
):
    conn = db.get_db_connection()
    try:
        cursor = conn.cursor()
        sym_list = []
        if symbols:
            sym_list = [s.upper().strip() for s in symbols.split(",") if s.strip()]
            placeholders = ",".join(["?"] * len(sym_list))
            query = f"""
                SELECT o1.* FROM intraday_orderflow o1
                INNER JOIN (
                    SELECT symbol, MAX(timestamp) as max_ts 
                    FROM intraday_orderflow 
                    WHERE symbol IN ({placeholders})
                    GROUP BY symbol
                ) o2 ON o1.symbol = o2.symbol AND o1.timestamp = o2.max_ts
            """
            cursor.execute(query, sym_list)
        else:
            query = """
                SELECT o1.* FROM intraday_orderflow o1
                INNER JOIN (
                    SELECT symbol, MAX(timestamp) as max_ts 
                    FROM intraday_orderflow 
                    GROUP BY symbol
                ) o2 ON o1.symbol = o2.symbol AND o1.timestamp = o2.max_ts
            """
            cursor.execute(query)
            
        rows = cursor.fetchall()
        result = {}
        for r in rows:
            row_dict = dict(r)
            result[row_dict["symbol"]] = row_dict
            
        if symbols and background_tasks and is_indian_market_open():
            utc_now = datetime.now(timezone.utc)
            ist_now = utc_now + timedelta(hours=5, minutes=30)
            
            for sym in sym_list:
                needs_update = False
                if sym not in result:
                    needs_update = True
                else:
                    try:
                        ts_val = datetime.strptime(result[sym]["timestamp"], "%Y-%m-%d %H:%M:%S")
                        if (ist_now - ts_val).total_seconds() > 1800:
                            needs_update = True
                    except Exception:
                        needs_update = True
                        
                if needs_update:
                    from routers.shared import currently_processing_orderflow, orderflow_processing_lock
                    with orderflow_processing_lock:
                        if sym not in currently_processing_orderflow:
                            background_tasks.add_task(compute_orderflow_metrics_for_symbol, sym)
                    
        return result
    except Exception as e:
        log.error(f"Failed to fetch latest bulk orderflow: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.post("/api/nse/orderflow/watchlist")
def update_orderflow_watchlist(payload: WatchlistUpdate):
    global orderflow_watchlist
    new_list = {s.upper().strip() for s in payload.symbols if s.strip()}
    # Update the watchlist in shared space
    import routers.shared
    routers.shared.orderflow_watchlist = new_list
    log.info(f"Updated active watchlist: {new_list}")
    return {"message": "Watchlist updated successfully", "watchlist": list(new_list)}

# --- UTILITIES ---

@router.get("/api/nse/market-status")
def get_market_status():
    cached = get_cached_nse_data("market-status", ttl_seconds=30)
    if cached is not None:
        return cached
    try:
        data = nse.equity.market_status()
        set_cached_nse_data("market-status", data)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/nse/all-indices")
def get_all_indices():
    cached = get_cached_nse_data("all-indices", ttl_seconds=15)
    if cached is not None:
        return cached
    try:
        data = serialize(nse.equity.all_indices())
        set_cached_nse_data("all-indices", data)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/nse/vix")
def get_vix_data():
    cached = get_cached_nse_data("vix", ttl_seconds=15)
    if cached is not None:
        return cached
    try:
        data = nse.equity.find_index("INDIA VIX")
        set_cached_nse_data("vix", data)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/nse/fno-stocks")
def get_nse_fno_stocks():
    cached = get_cached_nse_data("fno-stocks", ttl_seconds=30)
    if cached is not None:
        return cached
    try:
        stocks = nse.equity.all_stock_data()
        data = {"status": "success", "data": serialize(stocks)}
        set_cached_nse_data("fno-stocks", data)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── nsepython-backed Tier-3 fallback endpoints ───────────────────────────────

@router.get("/api/nse/quote-v2/{symbol}")
def get_quote_v2(symbol: str):
    """Tier-3 fallback using nsepython. Used by RealDataService.ts."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
    from nse_provider import get_quote
    result = get_quote(symbol.upper())
    if not result:
        raise HTTPException(status_code=503, detail=f"nsepython could not fetch {symbol}")
    return result


@router.get("/api/nse/option-chain-v2/{symbol}")
def get_option_chain_v2(symbol: str):
    """Full option chain via nsepython (all strikes, all expiries)."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
    from nse_provider import get_option_chain
    result = get_option_chain(symbol.upper())
    if not result:
        raise HTTPException(status_code=503, detail="Option chain unavailable")
    return result


@router.get("/api/nse/fii-dii")
def get_fii_dii_today():
    """FII/DII buy-sell data for today."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
    from nse_provider import get_fii_dii
    result = get_fii_dii()
    if not result:
        raise HTTPException(status_code=503, detail="FII/DII data unavailable")
    return result


@router.get("/api/nse/vix-v2")
def get_vix_v2():
    """India VIX current value via nsepython."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
    from nse_provider import get_india_vix
    vix = get_india_vix()
    if vix is None:
        raise HTTPException(status_code=503, detail="VIX unavailable")
    return {"vix": vix, "source": "nsepython"}


@router.get("/api/stock-logo/{symbol}")
def get_stock_logo(symbol: str):
    """
    Proxies and caches stock logos from Dhan / Upstox using server-side headers,
    completely bypassing browser CORS and anti-hotlinking restrictions.
    """
    import urllib.request
    clean_sym = symbol.strip().upper()
    cache_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cache", "logos")
    os.makedirs(cache_dir, exist_ok=True)
    local_path = os.path.join(cache_dir, f"{clean_sym}.png")

    if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
        with open(local_path, "rb") as f:
            return Response(content=f.read(), media_type="image/png")

    # Candidate URLs to fetch server-side
    candidate_urls = [
        f"https://images.dhan.co/symbols/{clean_sym}.png",
        f"https://assets.upstox.com/content/assets/images/logos/lk/NSE_EQ%7C{clean_sym}.png",
    ]

    for url in candidate_urls:
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                    "Referer": "https://dhan.co/" if "dhan.co" in url else "https://upstox.com/",
                }
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.status == 200:
                    img_data = resp.read()
                    if len(img_data) > 0:
                        with open(local_path, "wb") as f:
                            f.write(img_data)
                        return Response(content=img_data, media_type="image/png")
        except Exception:
            continue

    # Clean SVG Monogram fallback with HTTP 200 so browser console has ZERO 404 red errors
    first_char = clean_sym[0] if clean_sym else "?"
    svg_fallback = f"""<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="23" fill="#1E293B" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
      <text x="50%" y="54%" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="20" fill="#94A3B8" text-anchor="middle" dominant-baseline="middle">{first_char}</text>
    </svg>"""
    return Response(content=svg_fallback, media_type="image/svg+xml")
