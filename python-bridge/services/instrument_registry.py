import os
from logger import get_logger

log = get_logger("instrument_registry", tag="REGISTRY")
import sys
import threading
from datetime import datetime
import db

# Ensure parent directory is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

sync_lock = threading.Lock()
sync_status = {
    "status": "idle",
    "last_synced": None,
    "count": 0,
    "error": None
}

def get_canonical_index_mapping(symbol: str) -> dict:
    """Predefined map for main indices to resolve inconsistencies across providers."""
    mappings = {
        "NIFTY": {
            "canonical_id": "NSE:NIFTY_50",
            "asset_class": "INDEX",
            "symbol": "Nifty 50",
            "exchange": "NSE",
            "isin": "",
            "upstox_key": "NSE_INDEX|Nifty 50",
            "dhan_security_id": "",
            "dhan_segment": "INDEX",
            "yahoo_ticker": "^NSEI",
            "nse_symbol": "NIFTY",
            "supported_providers": "upstox,yahoo,nse"
        },
        "NIFTY 50": {
            "canonical_id": "NSE:NIFTY_50",
            "asset_class": "INDEX",
            "symbol": "Nifty 50",
            "exchange": "NSE",
            "isin": "",
            "upstox_key": "NSE_INDEX|Nifty 50",
            "dhan_security_id": "",
            "dhan_segment": "INDEX",
            "yahoo_ticker": "^NSEI",
            "nse_symbol": "NIFTY",
            "supported_providers": "upstox,yahoo,nse"
        },
        "BANKNIFTY": {
            "canonical_id": "NSE:NIFTY_BANK",
            "asset_class": "INDEX",
            "symbol": "Nifty Bank",
            "exchange": "NSE",
            "isin": "",
            "upstox_key": "NSE_INDEX|Nifty Bank",
            "dhan_security_id": "",
            "dhan_segment": "INDEX",
            "yahoo_ticker": "^NSEBANK",
            "nse_symbol": "BANKNIFTY",
            "supported_providers": "upstox,yahoo,nse"
        },
        "NIFTY BANK": {
            "canonical_id": "NSE:NIFTY_BANK",
            "asset_class": "INDEX",
            "symbol": "Nifty Bank",
            "exchange": "NSE",
            "isin": "",
            "upstox_key": "NSE_INDEX|Nifty Bank",
            "dhan_security_id": "",
            "dhan_segment": "INDEX",
            "yahoo_ticker": "^NSEBANK",
            "nse_symbol": "BANKNIFTY",
            "supported_providers": "upstox,yahoo,nse"
        },
        "FINNIFTY": {
            "canonical_id": "NSE:NIFTY_FIN_SERVICE",
            "asset_class": "INDEX",
            "symbol": "Nifty Fin Service",
            "exchange": "NSE",
            "isin": "",
            "upstox_key": "NSE_INDEX|Nifty Fin Service",
            "dhan_security_id": "",
            "dhan_segment": "INDEX",
            "yahoo_ticker": "^CNXFIN",
            "nse_symbol": "FINNIFTY",
            "supported_providers": "upstox,yahoo,nse"
        },
        "NIFTY FIN SERVICE": {
            "canonical_id": "NSE:NIFTY_FIN_SERVICE",
            "asset_class": "INDEX",
            "symbol": "Nifty Fin Service",
            "exchange": "NSE",
            "isin": "",
            "upstox_key": "NSE_INDEX|Nifty Fin Service",
            "dhan_security_id": "",
            "dhan_segment": "INDEX",
            "yahoo_ticker": "^CNXFIN",
            "nse_symbol": "FINNIFTY",
            "supported_providers": "upstox,yahoo,nse"
        }
    }
    symbol_upper = symbol.upper().strip()
    return mappings.get(symbol_upper)

def sync_instrument_registry():
    """Loads and mirrors the NSE instrument master from upstox_instruments into the registry."""
    global sync_status
    if not sync_lock.acquire(blocking=False):
        log.info("Sync already in progress, skipping.")
        return
        
    try:
        sync_status["status"] = "running"
        log.info("Starting sync from cached Upstox instruments...")
        
        conn = db.get_db_connection()
        cursor = conn.cursor()
        
        # Read from upstox_instruments
        cursor.execute("SELECT symbol, isin, instrument_key, exchange, lot_size FROM upstox_instruments")
        rows = cursor.fetchall()
        
        batch = []
        count = 0
        for row in rows:
            symbol = row["symbol"]
            isin = row["isin"]
            key = row["instrument_key"]
            exch = row["exchange"]
            
            # Map index mappings separately
            index_map = get_canonical_index_mapping(symbol)
            if index_map:
                batch.append(index_map)
                count += 1
                if len(batch) >= 2000:
                    db.save_instruments_to_registry_bulk(batch)
                    batch = []
                continue
                
            # Infer values
            # Exchange
            clean_exch = "NSE" if exch.startswith("NSE") else exch
            
            # Asset Class
            if "FO" in exch or "FO" in key:
                asset_class = "DERIVATIVES"
            elif "INDEX" in exch or "INDEX" in key:
                asset_class = "INDEX"
            else:
                asset_class = "EQUITY"
                
            # Canonical ID
            canonical_id = f"{clean_exch}:{symbol}"
            
            # Yahoo Ticker
            yahoo_ticker = ""
            if asset_class == "EQUITY":
                yahoo_ticker = f"{symbol}.NS"
                
            batch.append({
                "canonical_id": canonical_id,
                "asset_class": asset_class,
                "symbol": symbol,
                "exchange": clean_exch,
                "isin": isin,
                "upstox_key": key,
                "dhan_security_id": "",
                "dhan_segment": exch,
                "yahoo_ticker": yahoo_ticker,
                "nse_symbol": symbol,
                "supported_providers": "upstox,yahoo,nse"
            })
            count += 1
            
            if len(batch) >= 2000:
                db.save_instruments_to_registry_bulk(batch)
                batch = []
                
        conn.close()
        
        # Seed predefined index mappings just to be sure
        for index_name, mappings in {
            "NIFTY 50": get_canonical_index_mapping("NIFTY 50"),
            "NIFTY BANK": get_canonical_index_mapping("NIFTY BANK"),
            "NIFTY FIN SERVICE": get_canonical_index_mapping("NIFTY FIN SERVICE")
        }.items():
            batch.append(mappings)
            count += 1
            
        if batch:
            db.save_instruments_to_registry_bulk(batch)
            
        sync_status["status"] = "success"
        sync_status["last_synced"] = datetime.now().isoformat()
        sync_status["count"] = count
        log.info(f"Successfully completed instrument sync: {count} symbols registered.")
    except Exception as e:
        sync_status["status"] = "failed"
        sync_status["error"] = str(e)
        log.error(f"Failed to sync registry: {e}")
    finally:
        sync_lock.release()

def resolve_symbol(symbol: str) -> dict:
    """
    Resolves a symbol to its canonical identity.
    If not found in the instrument_registry table, falls back to upstox_instruments,
    saves it dynamically to the registry, and returns it.
    """
    # 1. Predefined index mapping check
    idx_map = get_canonical_index_mapping(symbol)
    if idx_map:
        return idx_map
        
    # 2. Lookup registry
    res = db.resolve_instrument_by_symbol(symbol)
    if res:
        return res
        
    # 3. Dynamic lookup and lazy registration from upstox_instruments
    conn = db.get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM upstox_instruments WHERE symbol = ? LIMIT 1",
        (symbol.upper().strip(),)
    )
    row = cursor.fetchone()
    conn.close()
    
    if row:
        exch = row["exchange"]
        clean_exch = "NSE" if exch.startswith("NSE") else exch
        asset_class = "DERIVATIVES" if ("FO" in exch or "FO" in row["instrument_key"]) else "EQUITY"
        canonical_id = f"{clean_exch}:{symbol}"
        yahoo_ticker = f"{symbol}.NS" if asset_class == "EQUITY" else ""
        
        db.save_instrument_to_registry(
            canonical_id=canonical_id,
            asset_class=asset_class,
            symbol=symbol,
            exchange=clean_exch,
            isin=row["isin"],
            upstox_key=row["instrument_key"],
            dhan_security_id="",
            dhan_segment=exch,
            yahoo_ticker=yahoo_ticker,
            nse_symbol=symbol,
            supported_providers="upstox,yahoo,nse"
        )
        return db.resolve_instrument_by_symbol(symbol)
        
    # 4. Final fallback format
    return {
        "canonical_id": f"NSE:{symbol.upper()}",
        "asset_class": "EQUITY",
        "symbol": symbol.upper(),
        "exchange": "NSE",
        "isin": "",
        "upstox_key": "",
        "dhan_security_id": "",
        "dhan_segment": "",
        "yahoo_ticker": f"{symbol.upper()}.NS",
        "nse_symbol": symbol.upper(),
        "supported_providers": "yahoo"
    }

def get_sync_status() -> dict:
    """Returns the current registry synchronization status."""
    return sync_status
