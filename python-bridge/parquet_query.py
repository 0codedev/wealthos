import os
import json
import time
import duckdb
from logger import get_logger

log = get_logger("parquet_query", tag="PARQUET")
import pandas as pd
from datetime import datetime, timedelta

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
STATUS_FILE = os.path.join(DATA_DIR, "sync_status.json")
MAPPINGS_FILE = os.path.join(DATA_DIR, "contract_mappings.json")

def resolve_expired_key(instrument_key: str):
    """Resolves an expired instrument key to contract metadata from contract_mappings.json"""
    if os.path.exists(MAPPINGS_FILE):
        try:
            with open(MAPPINGS_FILE, "r") as f:
                mappings = json.load(f)
                return mappings.get(instrument_key)
        except Exception as e:
            log.info(f"Error reading contract mappings: {e}")
    return None

def get_sync_status():
    """Reads sync_status.json and returns sync progress metadata"""
    if os.path.exists(STATUS_FILE):
        try:
            with open(STATUS_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            return {"error": f"Failed to read sync status: {str(e)}"}
    return {
        "last_sync": None,
        "mode": None,
        "completed_symbols": {},
        "errors": [],
        "message": "No sync has been performed yet."
    }

def query_candles(symbol: str, interval: str, from_date: str, to_date: str):
    """
    Queries archived underlying index or stock candles using DuckDB.
    Returns: List of candle dictionaries or None if archive doesn't exist.
    """
    symbol_upper = symbol.upper().strip()
    parquet_path = os.path.join(DATA_DIR, "underlying", symbol_upper, interval, "data.parquet")
    
    if not os.path.exists(parquet_path):
        log.info(f"Archive not found at {parquet_path}")
        return None
        
    try:
        # Connect to an in-memory DuckDB instance
        conn = duckdb.connect()
        
        # Check if the parquet data covers the requested to_date
        max_ts_query = f"SELECT MAX(timestamp) FROM '{parquet_path}'"
        max_ts_df = conn.execute(max_ts_query).df()
        if not max_ts_df.empty and max_ts_df.iloc[0, 0] is not None:
            max_ts = max_ts_df.iloc[0, 0]
            from datetime import datetime
            try:
                req_date = datetime.strptime(to_date, "%Y-%m-%d").date()
                if isinstance(max_ts, str):
                    max_date_str = max_ts[:10]
                else:
                    max_date_str = str(max_ts)[:10]
                max_date = datetime.strptime(max_date_str, "%Y-%m-%d").date()
                days_diff = (req_date - max_date).days
                if days_diff > 3:
                    log.warning(f"Parquet data for {symbol_upper} is stale (max date: {max_date_str}, requested: {to_date}, diff: {days_diff} days). Falling back to live API.")
                    conn.close()
                    return None
            except Exception as ex:
                log.error(f"{ex}")
        
        # Select columns, matching the format returned by Upstox historical candles
        # Convert timestamp to standard string format if it is not
        query = f"""
            SELECT timestamp, open, high, low, close, volume, open_interest 
            FROM '{parquet_path}'
            WHERE CAST(timestamp AS DATE) >= ? AND CAST(timestamp AS DATE) <= ?
            ORDER BY timestamp ASC
        """
        
        df = conn.execute(query, [from_date, to_date]).df()
        conn.close()
        
        if df.empty:
            return []
            
        # Standard Upstox response format is: [timestamp, open, high, low, close, volume, open_interest]
        # Let's map it into lists of values to perfectly match the Upstox API format
        candles_list = df.values.tolist()
        return candles_list
    except Exception as e:
        log.error(f"Failed querying candles for {symbol_upper} ({interval}): {e}")
        return None

def query_option_candles(symbol: str, expiry: str, strike: float, option_type: str, from_date: str = None, to_date: str = None):
    """
    Queries archived option candles for a specific expiry and strike.
    Returns: List of candle dictionaries or None if archive doesn't exist.
    """
    symbol_upper = symbol.upper().strip()
    parquet_path = os.path.join(DATA_DIR, "options", symbol_upper, expiry, "data.parquet")
    
    if not os.path.exists(parquet_path):
        log.info(f"Options archive not found at {parquet_path}")
        return None
        
    try:
        conn = duckdb.connect()
        
        query = f"""
            SELECT timestamp, open, high, low, close, volume, open_interest
            FROM '{parquet_path}'
            WHERE strike_price = ? AND upper(option_type) = ?
        """
        params = [float(strike), option_type.upper().strip()]
        
        if from_date:
            query += " AND CAST(timestamp AS DATE) >= ?"
            params.append(from_date)
            
        if to_date:
            query += " AND CAST(timestamp AS DATE) <= ?"
            params.append(to_date)
            
        query += " ORDER BY timestamp ASC"
        
        df = conn.execute(query, params).df()
        conn.close()
        
        if df.empty:
            return []
            
        # Map back to [timestamp, open, high, low, close, volume, open_interest]
        return df.values.tolist()
    except Exception as e:
        log.error(f"Failed querying options candles for {symbol_upper} on expiry {expiry} strike {strike}: {e}")
        return None

def get_archive_stats():
    """Calculates storage size and file counts for the parquet data folder"""
    total_bytes = 0
    file_count = 0
    symbols_found = set()
    
    underlying_dir = os.path.join(DATA_DIR, "underlying")
    options_dir = os.path.join(DATA_DIR, "options")
    futures_dir = os.path.join(DATA_DIR, "futures")
    
    for folder in [underlying_dir, options_dir, futures_dir]:
        if os.path.exists(folder):
            for root, dirs, files in os.walk(folder):
                for file in files:
                    if file.endswith(".parquet"):
                        file_count += 1
                        file_path = os.path.join(root, file)
                        try:
                            total_bytes += os.path.getsize(file_path)
                        except Exception:
                            pass
                        # Extract symbol from path
                        rel = os.path.relpath(root, folder)
                        parts = rel.split(os.sep)
                        if parts and parts[0]:
                            symbols_found.add(parts[0].upper())
                            
    total_mb = round(total_bytes / (1024 * 1024), 2)
    return {
        "total_mb": total_mb,
        "file_count": file_count,
        "symbols_count": len(symbols_found)
    }

def resolve_key_to_symbol(instrument_key: str) -> str:
    """Resolves instrument key to symbol, mapping indices and querying SQLite for equities."""
    indices = {
        "NSE_INDEX|Nifty 50": "NIFTY",
        "NSE_INDEX|Nifty Bank": "BANKNIFTY",
        "NSE_INDEX|Nifty Fin Service": "FINNIFTY",
        "NSE_INDEX|Nifty Midcap 50": "MIDCPNIFTY",
        "NSE_INDEX|NIFTY MID SELECT": "MIDCPNIFTY",
        "BSE_INDEX|SENSEX": "SENSEX"
    }
    clean_key = instrument_key.replace("%7C", "|")
    if clean_key in indices:
        return indices[clean_key]
        
    try:
        import db
        return db.get_symbol_from_instrument_key(clean_key)
    except Exception as e:
        log.warning(f"Failed to resolve key {clean_key}: {e}")
    return None

def save_candles_to_parquet(symbol: str, interval: str, candles: list):
    """
    Dynamically saves and merges newly fetched historical candles list
    into the symbol's parquet archive file.
    """
    if not candles:
        return
        
    symbol_upper = symbol.upper().strip()
    dir_path = os.path.join(DATA_DIR, "underlying", symbol_upper, interval)
    file_path = os.path.join(dir_path, "data.parquet")
    
    # 1. Convert new candles to DataFrame
    # Upstox candles: [timestamp, open, high, low, close, volume, open_interest]
    new_df = pd.DataFrame(candles, columns=["timestamp", "open", "high", "low", "close", "volume", "open_interest"])
    new_df['open'] = new_df['open'].astype(float)
    new_df['high'] = new_df['high'].astype(float)
    new_df['low'] = new_df['low'].astype(float)
    new_df['close'] = new_df['close'].astype(float)
    new_df['volume'] = new_df['volume'].astype(int)
    new_df['open_interest'] = new_df['open_interest'].astype(int)
    
    existing_df = None
    if os.path.exists(file_path):
        try:
            existing_df = pd.read_parquet(file_path)
        except Exception as e:
            log.info(f"Failed to read existing Parquet at {file_path}: {e}")
            
    if existing_df is not None:
        # Combine existing and new dataframes, drop duplicates, and sort
        combined_df = pd.concat([existing_df, new_df]).drop_duplicates(subset=["timestamp"]).sort_values("timestamp")
    else:
        combined_df = new_df.sort_values("timestamp")
        
    # 2. Keep only the last 1500 days of data for intraday intervals to keep queries fast and clean
    is_intraday = any(unit in interval.lower() for unit in ["minute", "min", "hour"])
    if is_intraday and combined_df is not None and not combined_df.empty:
        try:
            cutoff_date = (datetime.now() - timedelta(days=1500)).strftime("%Y-%m-%d")
            combined_df = combined_df[combined_df['timestamp'] >= cutoff_date]
        except Exception as filter_err:
            log.warning(f"Failed to apply rolling limit filter: {filter_err}")
        
    os.makedirs(dir_path, exist_ok=True)
    combined_df.to_parquet(file_path, index=False, compression="snappy")
    log.info(f"Merged and saved {len(combined_df)} candles for {symbol_upper} ({interval})")

def save_candles_to_parquet_by_key(instrument_key: str, interval: str, candles: list):
    """
    Dynamically saves and merges newly fetched historical candles list
    using the instrument_key. Resolves instrument_key to symbol first.
    """
    symbol = resolve_key_to_symbol(instrument_key)
    if symbol:
        save_candles_to_parquet(symbol, interval, candles)
    else:
        log.warning(f"Could not resolve key {instrument_key} to symbol. Skipped saving.")

def get_parquet_max_date(parquet_path: str) -> str:
    """Queries the maximum timestamp present in the given Parquet file."""
    if not os.path.exists(parquet_path):
        return None
    try:
        conn = duckdb.connect()
        max_ts_df = conn.execute(f"SELECT MAX(timestamp) FROM '{parquet_path}'").df()
        conn.close()
        if not max_ts_df.empty and max_ts_df.iloc[0, 0] is not None:
            max_ts = max_ts_df.iloc[0, 0]
            if isinstance(max_ts, str):
                return max_ts[:10]
            else:
                return str(max_ts)[:10]
    except Exception as e:
        log.error(f"Failed to query max date: {e}")
    return None

def query_candles_raw(parquet_path: str, from_date: str, to_date: str) -> list:
    """Queries candle data for a date range from a specific Parquet file using DuckDB."""
    if not os.path.exists(parquet_path):
        return None
    try:
        conn = duckdb.connect()
        query = f"""
            SELECT timestamp, open, high, low, close, volume, open_interest 
            FROM '{parquet_path}'
            WHERE CAST(timestamp AS DATE) >= ? AND CAST(timestamp AS DATE) <= ?
            ORDER BY timestamp ASC
        """
        df = conn.execute(query, [from_date, to_date]).df()
        conn.close()
        if df.empty:
            return []
        return df.values.tolist()
    except Exception as e:
        log.error(f"Failed: {e}")
    return None

PARQUET_DIR = os.path.join(DATA_DIR, "parquet")
CONSOLIDATED_PARQUET = os.path.join(PARQUET_DIR, "nse_500.parquet")
_vol_avg_cache = {"timestamp": 0.0, "data": {}}

def ensure_consolidated_parquet() -> str:
    """
    Ensures that the consolidated nse_500.parquet analytical file exists.
    If missing or older than 24 hours, aggregates all individual daily
    underlying parquet files into a single vectorized parquet archive.
    """
    os.makedirs(PARQUET_DIR, exist_ok=True)
    needs_build = False
    if not os.path.exists(CONSOLIDATED_PARQUET):
        needs_build = True
    else:
        try:
            mtime = os.path.getmtime(CONSOLIDATED_PARQUET)
            if (time.time() - mtime) > 86400:
                needs_build = True
        except Exception:
            needs_build = True

    if needs_build:
        underlying_pattern = os.path.join(DATA_DIR, "underlying", "*", "day", "data.parquet").replace("\\", "/")
        consolidated_path = CONSOLIDATED_PARQUET.replace("\\", "/")
        try:
            conn = duckdb.connect()
            copy_sql = f"""
                COPY (
                    SELECT 
                        regexp_extract(filename, 'underlying[/\\\\]([^/\\\\]+)[/\\\\]day', 1) AS symbol,
                        timestamp, open, high, low, close, volume, open_interest
                    FROM read_parquet('{underlying_pattern}', filename=true)
                ) TO '{consolidated_path}' (FORMAT PARQUET, COMPRESSION SNAPPY);
            """
            conn.execute(copy_sql)
            conn.close()
            log.info(f"Consolidated DuckDB Parquet archive built successfully at {CONSOLIDATED_PARQUET}")
        except Exception as e:
            log.error(f"Failed building consolidated Parquet archive: {e}")
            if os.path.exists(CONSOLIDATED_PARQUET):
                return CONSOLIDATED_PARQUET
            return None
            
    return CONSOLIDATED_PARQUET

def batch_query_parquet_volume_averages(symbols: list[str] = None, days: int = 20) -> dict[str, dict]:
    """
    Executes a high-speed vectorized DuckDB window query to calculate the
    rolling 20-day Average Daily Volume (ADV), 20-day ATR, and 20-day High/Low
    across all symbols in sub-50ms.
    Caches the results in-memory with a 5-minute TTL.
    """
    global _vol_avg_cache
    now = time.time()
    
    # Return cache if fresh (< 300 seconds) and no specific symbol filtering requested
    if not symbols and _vol_avg_cache["data"] and (now - _vol_avg_cache["timestamp"]) < 300:
        return _vol_avg_cache["data"]

    parquet_file = ensure_consolidated_parquet()
    conn = duckdb.connect()
    results = {}

    try:
        if parquet_file and os.path.exists(parquet_file):
            clean_parquet = parquet_file.replace("\\", "/")
            query = f"""
                SELECT 
                    symbol,
                    ROUND(AVG(volume), 2) AS avg_volume_20d,
                    ROUND(AVG(high - low), 2) AS avg_atr_20d,
                    ROUND(AVG(ABS(close - open)), 2) AS avg_abs_change_20d,
                    MAX(high) AS high_20d,
                    MIN(low) AS low_20d
                FROM (
                    SELECT 
                        symbol,
                        volume,
                        high,
                        low,
                        close,
                        open,
                        ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY timestamp DESC) as rn
                    FROM '{clean_parquet}'
                )
                WHERE rn <= ?
                GROUP BY symbol
            """
            rows = conn.execute(query, [days]).fetchall()
            for r in rows:
                sym = str(r[0]).upper()
                results[sym] = {
                    "avg_volume_20d": float(r[1] or 0.0),
                    "avg_atr_20d": float(r[2] or 0.0),
                    "avg_abs_change_20d": float(r[3] or 1.0),
                    "high_20d": float(r[4] or 0.0),
                    "low_20d": float(r[5] or 0.0)
                }
        else:
            underlying_pattern = os.path.join(DATA_DIR, "underlying", "*", "day", "data.parquet").replace("\\", "/")
            query = f"""
                SELECT 
                    regexp_extract(filename, 'underlying[/\\\\]([^/\\\\]+)[/\\\\]day', 1) AS symbol,
                    ROUND(AVG(volume), 2) AS avg_volume_20d,
                    ROUND(AVG(high - low), 2) AS avg_atr_20d,
                    ROUND(AVG(ABS(close - open)), 2) AS avg_abs_change_20d,
                    MAX(high) AS high_20d,
                    MIN(low) AS low_20d
                FROM (
                    SELECT 
                        filename,
                        volume,
                        high,
                        low,
                        close,
                        open,
                        ROW_NUMBER() OVER (PARTITION BY filename ORDER BY timestamp DESC) as rn
                    FROM read_parquet('{underlying_pattern}', filename=true)
                )
                WHERE rn <= ?
                GROUP BY symbol
            """
            rows = conn.execute(query, [days]).fetchall()
            for r in rows:
                sym = str(r[0]).upper()
                results[sym] = {
                    "avg_volume_20d": float(r[1] or 0.0),
                    "avg_atr_20d": float(r[2] or 0.0),
                    "avg_abs_change_20d": float(r[3] or 1.0),
                    "high_20d": float(r[4] or 0.0),
                    "low_20d": float(r[5] or 0.0)
                }
    except Exception as e:
        log.error(f"DuckDB batch volume query failed: {e}")
    finally:
        conn.close()

    if not symbols:
        _vol_avg_cache = {"timestamp": now, "data": results}
        return results
    else:
        upper_syms = set(s.upper() for s in symbols)
        return {k: v for k, v in results.items() if k in upper_syms}

def query_stock_technicals(symbol: str, days: int = 20) -> dict:
    """Queries technical baseline metrics (ADV, ATR, 20d Range) for a single symbol using DuckDB."""
    symbol_upper = symbol.upper().strip()
    all_metrics = batch_query_parquet_volume_averages(symbols=[symbol_upper], days=days)
    if symbol_upper in all_metrics:
        return all_metrics[symbol_upper]
    
    parquet_path = os.path.join(DATA_DIR, "underlying", symbol_upper, "day", "data.parquet")
    if not os.path.exists(parquet_path):
        return None
    try:
        conn = duckdb.connect()
        clean_parquet = parquet_path.replace("\\", "/")
        query = f"""
            SELECT 
                ROUND(AVG(volume), 2) AS avg_volume_20d,
                ROUND(AVG(high - low), 2) AS avg_atr_20d,
                ROUND(AVG(ABS(close - open)), 2) AS avg_abs_change_20d,
                MAX(high) AS high_20d,
                MIN(low) AS low_20d
            FROM (
                SELECT volume, high, low, close, open
                FROM '{clean_parquet}'
                ORDER BY timestamp DESC
                LIMIT ?
            )
        """
        row = conn.execute(query, [days]).fetchone()
        conn.close()
        if row:
            return {
                "avg_volume_20d": float(row[0] or 0.0),
                "avg_atr_20d": float(row[1] or 0.0),
                "avg_abs_change_20d": float(row[2] or 1.0),
                "high_20d": float(row[3] or 0.0),
                "low_20d": float(row[4] or 0.0)
            }
    except Exception as e:
        log.error(f"Failed single stock technical query for {symbol_upper}: {e}")
    return None

def load_parquet_fallback_quotes() -> dict:
    """
    Extracts latest daily candle quotes for all symbols from nse_500.parquet
    using DuckDB. Provides seamless offline and weekend fallback quotes when live
    broker API tokens are expired or disconnected.
    """
    parquet_file = ensure_consolidated_parquet()
    if not parquet_file or not os.path.exists(parquet_file):
        return {}
    conn = duckdb.connect()
    clean_parquet = parquet_file.replace("\\", "/")
    try:
        q = f"""
            SELECT symbol, timestamp, open, high, low, close, volume
            FROM (
                SELECT symbol, timestamp, open, high, low, close, volume,
                       ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY timestamp DESC) as rn
                FROM '{clean_parquet}'
            )
            WHERE rn <= 2
            ORDER BY symbol, timestamp DESC
        """
        rows = conn.execute(q).fetchall()
        sym_rows = {}
        for r in rows:
            s = str(r[0]).upper()
            if s not in sym_rows:
                sym_rows[s] = []
            sym_rows[s].append(r)

        quotes = {}
        for s, c_list in sym_rows.items():
            latest = c_list[0]
            prev = c_list[1] if len(c_list) > 1 else latest
            prev_close = float(prev[5])
            ltp = float(latest[5])
            net_chg = round(ltp - prev_close, 2)
            quotes[f"NSE_EQ:{s}"] = {
                "last_price": ltp,
                "net_change": net_chg,
                "volume": int(latest[6]),
                "ohlc": {
                    "open": float(latest[2]),
                    "high": float(latest[3]),
                    "low": float(latest[4]),
                    "close": prev_close
                }
            }
        return quotes
    except Exception as e:
        log.error(f"Failed generating DuckDB Parquet fallback quotes: {e}")
        return {}
    finally:
        conn.close()

