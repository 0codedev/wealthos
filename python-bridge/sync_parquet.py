import os
import sys
import json
import time
import argparse
import pandas as pd
from datetime import datetime, timedelta
from tqdm import tqdm

# Ensure we can import from local directory
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from logger import get_logger
log = get_logger("sync_parquet", tag="SYNC")

from upstox import upstox_client
import db
from db import get_upstox_instrument_key

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
STATUS_FILE = os.path.join(DATA_DIR, "sync_status.json")
MAPPINGS_FILE = os.path.join(DATA_DIR, "contract_mappings.json")

# Global contract mappings cache
contract_mappings = {}
# Global spot price DataFrame cache
_spot_df_cache = {}

def load_contract_mappings():
    global contract_mappings
    if os.path.exists(MAPPINGS_FILE):
        try:
            with open(MAPPINGS_FILE, "r") as f:
                contract_mappings = json.load(f)
        except Exception as e:
            log.error("Error loading contract mappings: %s", e)
            contract_mappings = {}

def save_contract_mappings():
    global contract_mappings
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        with open(MAPPINGS_FILE, "w") as f:
            json.dump(contract_mappings, f, indent=2)
    except Exception as e:
        log.error("Error saving contract mappings: %s", e)

# Default Indices mapping
INDICES = {
    "NIFTY": "NSE_INDEX|Nifty 50",
    "BANKNIFTY": "NSE_INDEX|Nifty Bank",
    "FINNIFTY": "NSE_INDEX|Nifty Fin Service",
    "MIDCPNIFTY": "NSE_INDEX|Nifty Midcap 50",
    "SENSEX": "BSE_INDEX|SENSEX"
}

def load_fno_symbols():
    fno_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fno_stocks_generated.json")
    if not os.path.exists(fno_path):
        log.info("fno_stocks_generated.json not found, fetching/generating it...")
        try:
            from update_fno_universe import run_sync
            run_sync()
        except Exception as e:
            log.error("Failed to generate F&O stocks list: %s", e)
            return []
            
    with open(fno_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        return [item["symbol"] for item in data]

def get_underlying_key(symbol: str) -> str:
    if symbol in INDICES:
        return INDICES[symbol]
    
    # Try FNO segment first
    key = db.get_upstox_instrument_key(symbol, exchange="NSE_EQ")
    if not key:
        key = db.get_upstox_instrument_key(symbol)
    return key

def save_sync_status(status_data):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(STATUS_FILE, "w") as f:
        json.dump(status_data, f, indent=4)

def load_sync_status():
    if os.path.exists(STATUS_FILE):
        try:
            with open(STATUS_FILE, "r") as f:
                return json.load(f)
        except:
            pass
    return {
        "last_sync": None,
        "mode": None,
        "completed_symbols": {},
        "errors": []
    }

# Global rate limiting tracking for Upstox API
_last_api_call_time = 0.0

def rate_limited_api_call(func, *args, **kwargs):
    """Executes an API function, sleeping dynamically only for the remainder of a 0.55s pacing interval to maintain ~109 requests/minute maximum."""
    global _last_api_call_time
    target_interval = 0.55
    now = time.time()
    elapsed = now - _last_api_call_time
    if elapsed < target_interval:
        time.sleep(target_interval - elapsed)
    try:
        res = func(*args, **kwargs)
    finally:
        _last_api_call_time = time.time()
    return res

def fetch_candles_for_contract(instrument_key: str, interval: str, from_date_str: str, to_date_str: str, is_expired: bool = False):
    """Fetches candles for active or expired instrument key, automatically chunking into 29-day windows for intraday intervals"""
    try:
        from_date = datetime.strptime(from_date_str, "%Y-%m-%d")
        to_date = datetime.strptime(to_date_str, "%Y-%m-%d")
    except Exception as parse_err:
        log.error("Failed to parse date range '%s' to '%s': %s", from_date_str, to_date_str, parse_err)
        return []

    is_intraday = any(unit in interval.lower() for unit in ["minute", "min"])

    if not is_intraday:
        try:
            if is_expired:
                res = rate_limited_api_call(upstox_client.get_expired_historical_candles, instrument_key, interval, to_date_str, from_date_str)
            else:
                res = rate_limited_api_call(upstox_client.get_historical_candles, instrument_key, interval, to_date_str, from_date_str)
                
            if res.get("status") == "success" and "data" in res and "candles" in res["data"]:
                return res["data"]["candles"]
        except Exception as e:
            log.warning("Failed to fetch candles for %s: %s", instrument_key, e)
        return []

    # Chunked intraday candle retrieval (27 days max per API call)
    all_candles = []
    chunk_end = to_date
    while chunk_end >= from_date:
        chunk_start = max(from_date, chunk_end - timedelta(days=27))
        c_start_str = chunk_start.strftime("%Y-%m-%d")
        c_end_str = chunk_end.strftime("%Y-%m-%d")
        
        # Skip query if chunk start is in the future
        if chunk_start > datetime.now():
            chunk_end = chunk_start - timedelta(days=1)
            continue
            
        try:
            if is_expired:
                res = rate_limited_api_call(upstox_client.get_expired_historical_candles, instrument_key, interval, c_end_str, c_start_str)
            else:
                res = rate_limited_api_call(upstox_client.get_historical_candles, instrument_key, interval, c_end_str, c_start_str)
                
            if res.get("status") == "success" and "data" in res and "candles" in res["data"]:
                candles = res["data"]["candles"]
                if candles:
                    all_candles.extend(candles)
        except Exception as e:
            log.warning("Failed to fetch chunk %s to %s for %s: %s", c_start_str, c_end_str, instrument_key, e)
            
        chunk_end = chunk_start - timedelta(days=1)
        
    return all_candles



def get_spot_price_for_date(symbol: str, target_date_str: str) -> float:
    """Finds underlying index/stock close price on target date by reading its daily parquet file"""
    global _spot_df_cache
    parquet_path = os.path.join(DATA_DIR, "underlying", symbol, "day", "data.parquet")
    if not os.path.exists(parquet_path):
        return None
    try:
        if symbol in _spot_df_cache:
            df = _spot_df_cache[symbol]
        else:
            df = pd.read_parquet(parquet_path)
            # Parse timestamp column to YYYY-MM-DD
            df['date_only'] = df['timestamp'].apply(lambda x: str(x)[:10])
            _spot_df_cache[symbol] = df
            
        # Find exact date match
        match = df[df['date_only'] == target_date_str]
        if not match.empty:
            return float(match.iloc[0]['close'])
        
        # If no exact match, find the closest preceding date
        df_sorted = df[df['date_only'] <= target_date_str].sort_values('date_only', ascending=False)
        if not df_sorted.empty:
            return float(df_sorted.iloc[0]['close'])
    except Exception as e:
        log.warning("Error resolving spot price for %s on %s: %s", symbol, target_date_str, e)
    return None

def sync_underlying_candles(symbol: str, interval: str, lookback_days: int, mode: str, delta_strategy: str = "static", buffer_days: int = 7):
    """Downloads daily or intraday candles for the underlying asset and saves as Parquet"""
    key = get_underlying_key(symbol)
    if not key:
        log.warning("No instrument key found for underlying symbol %s. Skipping.", symbol)
        return False
        
    dir_path = os.path.join(DATA_DIR, "underlying", symbol, interval)
    file_path = os.path.join(dir_path, "data.parquet")
    
    # Define date range
    to_date = datetime.now()
    from_date = to_date - timedelta(days=lookback_days)
    
    to_date_str = to_date.strftime("%Y-%m-%d")
    from_date_str = from_date.strftime("%Y-%m-%d")
    
    existing_df = None
    if mode == "delta" and os.path.exists(file_path):
        try:
            existing_df = pd.read_parquet(file_path)
            if not existing_df.empty:
                if delta_strategy == "buffer":
                    # Discard recent data within buffer_days (relative to current date)
                    buffer_cutoff = datetime.now() - timedelta(days=buffer_days)
                    # Convert column to datetime for filtering
                    existing_df['date_dt'] = pd.to_datetime(existing_df['timestamp'])
                    existing_df = existing_df[existing_df['date_dt'] < buffer_cutoff].drop(columns=['date_dt'])
                    from_date = buffer_cutoff
                    from_date_str = from_date.strftime("%Y-%m-%d")
                    log.info("Syncing underlying %s (%s) from %s (re-fetching recent %d days)...", symbol, interval, from_date_str, buffer_days)
                else:
                    # Find maximum date in existing data
                    max_ts = existing_df['timestamp'].max()
                    # Support both string timestamps and datetime objects
                    if isinstance(max_ts, str):
                        max_date = datetime.strptime(max_ts[:10], "%Y-%m-%d")
                    else:
                        max_date = pd.to_datetime(max_ts).to_pydatetime()
                        
                    # We start delta from 2 days prior to ensure we don't miss overlap or partial last day
                    from_date = max_date - timedelta(days=2)
                    from_date_str = from_date.strftime("%Y-%m-%d")
                    log.info("Syncing underlying %s (%s) from %s onwards...", symbol, interval, from_date_str)
        except Exception as e:
            log.warning("Failed to read existing Parquet for %s %s. Performing full sync. Error: %s", symbol, interval, e)
            
    # Fetch candles from Upstox
    fetch_interval = interval
    if interval in ["5minute", "15minute"]:
        fetch_interval = "1minute"
        
    log.info("Fetching underlying candles for %s (%s) from %s to %s...", symbol, fetch_interval, from_date_str, to_date_str)
    candles = fetch_candles_for_contract(key, fetch_interval, from_date_str, to_date_str, is_expired=False)
    
    if not candles:
        log.info("No candles returned for %s (%s).", symbol, fetch_interval)
        return False
        
    # Convert to DataFrame
    new_df = pd.DataFrame(candles, columns=["timestamp", "open", "high", "low", "close", "volume", "open_interest"])
    new_df['open'] = new_df['open'].astype(float)
    new_df['high'] = new_df['high'].astype(float)
    new_df['low'] = new_df['low'].astype(float)
    new_df['close'] = new_df['close'].astype(float)
    new_df['volume'] = new_df['volume'].astype(int)
    new_df['open_interest'] = new_df['open_interest'].astype(int)

    # Resample 1minute candles to 5minute or 15minute if requested
    if interval in ["5minute", "15minute"]:
        log.info("Resampling 1minute candles to %s...", interval)
        try:
            new_df['timestamp_dt'] = pd.to_datetime(new_df['timestamp'])
            new_df.set_index('timestamp_dt', inplace=True)
            
            resample_rule = '5min' if interval == "5minute" else '15min'
            resampled = new_df.resample(resample_rule).agg({
                'open': 'first',
                'high': 'max',
                'low': 'min',
                'close': 'last',
                'volume': 'sum',
                'open_interest': 'last'
            }).dropna()
            
            resampled = resampled.reset_index()
            resampled['timestamp'] = resampled['timestamp_dt'].apply(lambda x: x.isoformat())
            resampled = resampled.drop(columns=['timestamp_dt'])
            
            new_df = resampled[["timestamp", "open", "high", "low", "close", "volume", "open_interest"]]
        except Exception as resample_err:
            log.error("Failed to resample candles for %s %s: %s", symbol, interval, resample_err)
            return False
    
    if existing_df is not None:
        # Combine, drop duplicates by timestamp, and sort
        combined_df = pd.concat([existing_df, new_df]).drop_duplicates(subset=["timestamp"]).sort_values("timestamp")
    else:
        combined_df = new_df.sort_values("timestamp")
        
    os.makedirs(dir_path, exist_ok=True)
    combined_df.to_parquet(file_path, index=False, compression="snappy")
    # Invalidate spot price cache if daily candles were updated
    if interval == "day" and symbol in _spot_df_cache:
        del _spot_df_cache[symbol]
    log.info("Saved %d rows of underlying candles to %s", len(combined_df), file_path)
    return True

def sync_options_for_expiry(symbol: str, expiry: str, spot_price: float, interval: str, lookback_days: int):
    """Syncs option candles for a specific expiry date"""
    key = get_underlying_key(symbol)
    if not key:
        return 0
        
    dir_path = os.path.join(DATA_DIR, "options", symbol, expiry)
    file_path = os.path.join(dir_path, "data.parquet")
    
    # 1. Fetch Option Contracts for the Expiry
    try:
        contracts_res = upstox_client.get_expired_option_contracts(key, expiry)
        contracts = contracts_res.get("data", [])
        if not contracts:
            return 0
    except Exception as e:
        log.error("Failed to fetch option contracts for %s on expiry %s: %s", symbol, expiry, e)
        return 0
        
    # 2. Filter strikes based on Spot Price
    strikes = sorted(list(set([float(c["strike_price"]) for c in contracts if "strike_price" in c])))
    if not strikes:
        return 0
        
    # Determine strike range
    is_index = symbol in INDICES
    strike_span = 15 if is_index else 10
    
    # Find ATM strike
    if spot_price is not None:
        atm_strike = min(strikes, key=lambda x: abs(x - spot_price))
        atm_idx = strikes.index(atm_strike)
        min_idx = max(0, atm_idx - strike_span)
        max_idx = min(len(strikes) - 1, atm_idx + strike_span)
        target_strikes = strikes[min_idx : max_idx + 1]
    else:
        # Fallback to median strike if no spot price available
        median_idx = len(strikes) // 2
        min_idx = max(0, median_idx - strike_span)
        max_idx = min(len(strikes) - 1, median_idx + strike_span)
        target_strikes = strikes[min_idx : max_idx + 1]
        
    target_contracts = [
        c for c in contracts 
        if float(c.get("strike_price", 0)) in target_strikes
    ]
    
    log.info("Syncing option strikes ATM +/- %d (%d contracts) for %s expiry %s...", strike_span, len(target_contracts), symbol, expiry)
    
    to_date = datetime.strptime(expiry, "%Y-%m-%d")
    # For expired contracts, we look back from the expiry date itself
    from_date = to_date - timedelta(days=lookback_days)
    
    to_date_str = to_date.strftime("%Y-%m-%d")
    from_date_str = from_date.strftime("%Y-%m-%d")
    
    all_candles = []
    
    # Fetch candles for each option contract
    for c in tqdm(target_contracts, desc=f"    Strikes for {expiry}", leave=False):
        c_key = c["instrument_key"]
        c_symbol = c["trading_symbol"]
        strike = float(c["strike_price"])
        op_type = c.get("instrument_type") or c.get("option_type")
        
        # Save mappings globally
        contract_mappings[c_key] = {
            "symbol": symbol,
            "expiry": expiry,
            "strike": strike,
            "option_type": op_type
        }
        
        candles = fetch_candles_for_contract(c_key, interval, from_date_str, to_date_str, is_expired=True)
        if not candles:
            continue
            
        for candle in candles:
            all_candles.append({
                "timestamp": candle[0],
                "open": float(candle[1]),
                "high": float(candle[2]),
                "low": float(candle[3]),
                "close": float(candle[4]),
                "volume": int(candle[5] or 0),
                "open_interest": int(candle[6] or 0),
                "strike_price": strike,
                "option_type": op_type,
                "expiry": expiry,
                "instrument_key": c_key
            })
            
    if not all_candles:
        log.info("No candle data found for options contracts of %s on expiry %s", symbol, expiry)
        return 0
        
    df = pd.DataFrame(all_candles)
    os.makedirs(dir_path, exist_ok=True)
    df.to_parquet(file_path, index=False, compression="snappy")
    log.info("Saved options Parquet file with %d records to %s", len(df), file_path)
    
    return len(df)

def sync_futures_for_expiry(symbol: str, expiry: str, interval: str, lookback_days: int):
    """Syncs futures candles for a specific expiry date"""
    key = get_underlying_key(symbol)
    if not key:
        return 0
        
    dir_path = os.path.join(DATA_DIR, "futures", symbol, expiry)
    file_path = os.path.join(dir_path, "data.parquet")
    
    # 1. Fetch Future Contracts for the Expiry
    try:
        contracts_res = upstox_client.get_expired_future_contracts(key, expiry)
        contracts = contracts_res.get("data", [])
        if not contracts:
            return 0
    except Exception as e:
        log.error("Failed to fetch future contracts for %s on expiry %s: %s", symbol, expiry, e)
        return 0
        
    log.info("Syncing futures contract (%d contracts) for %s expiry %s...", len(contracts), symbol, expiry)
    
    to_date = datetime.strptime(expiry, "%Y-%m-%d")
    from_date = to_date - timedelta(days=lookback_days)
    
    to_date_str = to_date.strftime("%Y-%m-%d")
    from_date_str = from_date.strftime("%Y-%m-%d")
    
    all_candles = []
    
    # Fetch candles for each future contract
    for c in tqdm(contracts, desc=f"    Futures for {expiry}", leave=False):
        c_key = c["instrument_key"]
        c_symbol = c["trading_symbol"]
        
        # Save mappings globally
        contract_mappings[c_key] = {
            "symbol": symbol,
            "expiry": expiry,
            "instrument_type": "FUT"
        }
        
        candles = fetch_candles_for_contract(c_key, interval, from_date_str, to_date_str, is_expired=True)
        if not candles:
            continue
            
        for candle in candles:
            all_candles.append({
                "timestamp": candle[0],
                "open": float(candle[1]),
                "high": float(candle[2]),
                "low": float(candle[3]),
                "close": float(candle[4]),
                "volume": int(candle[5] or 0),
                "open_interest": int(candle[6] or 0),
                "expiry": expiry,
                "instrument_key": c_key
            })
            
    if not all_candles:
        log.info("No candle data found for futures contracts of %s on expiry %s", symbol, expiry)
        return 0
        
    df = pd.DataFrame(all_candles)
    os.makedirs(dir_path, exist_ok=True)
    df.to_parquet(file_path, index=False, compression="snappy")
    log.info("Saved futures Parquet file with %d records to %s", len(df), file_path)
    
    return len(df)

def sync_symbol_data(symbol: str, mode: str, is_test: bool, delta_strategy: str = "static", buffer_days: int = 7, only_underlying: bool = False):
    """Synchronizes all candles & options for a single symbol"""
    log.info("--- Syncing %s (Mode: %s, Delta Strategy: %s, Buffer: %dd, Only Underlying: %s) ---", symbol, mode, delta_strategy, buffer_days, only_underlying)
    
    # 1. Sync Underlying Daily Candles (Always first, goes back 10 years)
    underlying_lookback = 3650  # 10 years lookback depth
    success = sync_underlying_candles(symbol, "day", underlying_lookback, mode, delta_strategy, buffer_days)
    if not success:
        log.warning("Failed to download daily underlying candles for %s. Proceeding with partial data.", symbol)
        
    # 2. Sync Intraday Underlying Candles (1-min, 5-min, and 15-min)
    # Note: Upstox active intraday goes back to Jan 2022 (approx 1500 days lookback max)
    sync_underlying_candles(symbol, "1minute", 1300, mode, delta_strategy, buffer_days)
    sync_underlying_candles(symbol, "5minute", 1300, mode, delta_strategy, buffer_days)
    sync_underlying_candles(symbol, "15minute", 1300, mode, delta_strategy, buffer_days)
    
    if only_underlying:
        log.info("Only underlying requested. Skipping options and futures sync for %s.", symbol)
        return True
    
    # 3. Option contracts sync (F&O stocks or Indices)
    # If the user only wants indices options, or if it is F&O stocks too
    key = get_underlying_key(symbol)
    if not key:
        log.warning("No instrument key found for %s options syncing. Proceeding with partial data.", symbol)
        return True
        
    log.info("Retrieving expired expiries for %s...", symbol)
    try:
        exp_res = upstox_client.get_expiries(key, "options")
        if isinstance(exp_res, dict) and exp_res.get("status") == "error":
            errors = exp_res.get("errors", [])
            error_msg = errors[0].get("message", "") if errors else ""
            error_code = errors[0].get("errorCode", "") if errors else ""
            if error_code == "UDAPI100067":
                log.info("Your current Upstox token (read-only/Analytics) does not permit access to Expired Instruments. Options sync skipped.")
            else:
                log.warning("Failed to fetch expiries for %s: %s", symbol, error_msg)
            expiries = []
        else:
            expiries = exp_res.get("data", [])
    except Exception as e:
        err_str = str(e)
        if "forbidden_read_only" in err_str or "UDAPI100067" in err_str or "read only token" in err_str:
            log.info("Your current Upstox token (read-only/Analytics) does not permit access to Expired Instruments. Options sync skipped.")
        else:
            log.warning("Failed to fetch expiries for %s: %s. Proceeding with partial/empty options data.", symbol, e)
        expiries = []
        
    if not expiries:
        log.info("No expired expiries found for %s.", symbol)
        return True
        
    # Sort expiries newest first
    expiries = sorted(expiries, reverse=True)
    
    # Settle target expiries
    if is_test:
        target_expiries = expiries[:1]
        log.info("Test Mode: restricting expiries to: %s", target_expiries)
    else:
        # Upstox Expired Instruments API gives up to 6 months of expiries.
        # We process all of them.
        is_index = symbol in INDICES
        if is_index:
            # Indices: Weekly + Monthly (sync up to 3 years if available, but limit to 6 months due to API)
            target_expiries = expiries
        else:
            # F&O Stocks: Monthly expiries only
            # The API get_expiries() returns all expiries. We can filter to monthly expiries.
            # Monthly expiries in India are on the last Thursday of each month.
            monthly_expiries = []
            for exp_str in expiries:
                try:
                    exp_dt = datetime.strptime(exp_str, "%Y-%m-%d")
                    # Check if it is a Thursday
                    if exp_dt.weekday() == 3:
                        # Check if it is the last Thursday. Let's check if exp_dt + 7 days is in a different month
                        next_week = exp_dt + timedelta(days=7)
                        if next_week.month != exp_dt.month:
                            monthly_expiries.append(exp_str)
                except Exception as parse_err:
                    log.warning("Invalid expiry date string: %s", exp_str)
                    
            target_expiries = monthly_expiries
            
    log.info("Total target expiries to sync: %d", len(target_expiries))
    
    # Track mappings
    load_contract_mappings()
    
    total_records = 0
    for expiry in target_expiries:
        opt_path = os.path.join(DATA_DIR, "options", symbol, expiry, "data.parquet")
        fut_path = os.path.join(DATA_DIR, "futures", symbol, expiry, "data.parquet")
        
        # 1. Download Option Contracts
        options_saved = 0
        sync_options = True
        if mode == "delta" and os.path.exists(opt_path):
            if delta_strategy != "buffer":
                sync_options = False
            else:
                try:
                    expiry_dt = datetime.strptime(expiry, "%Y-%m-%d")
                    buffer_cutoff = datetime.now() - timedelta(days=buffer_days)
                    if expiry_dt < buffer_cutoff:
                        sync_options = False
                except:
                    pass
                    
        if sync_options:
            # Get spot price on expiry
            spot_price = get_spot_price_for_date(symbol, expiry)
            if not spot_price:
                log.warning("No underlying spot price resolved for %s on expiry %s. Will fallback to median strike.", symbol, expiry)
            options_saved = sync_options_for_expiry(symbol, expiry, spot_price, "5minute", 25)
            
        # 2. Download Future Contracts
        futures_saved = 0
        sync_futures = True
        if mode == "delta" and os.path.exists(fut_path):
            if delta_strategy != "buffer":
                sync_futures = False
            else:
                try:
                    expiry_dt = datetime.strptime(expiry, "%Y-%m-%d")
                    buffer_cutoff = datetime.now() - timedelta(days=buffer_days)
                    if expiry_dt < buffer_cutoff:
                        sync_futures = False
                except:
                    pass
                    
        if sync_futures:
            futures_saved = sync_futures_for_expiry(symbol, expiry, "5minute", 90)
            
        total_records += (options_saved + futures_saved)
        
    log.info("Completed %s. Synced %d option/future records.", symbol, total_records)
    return True

def main():
    parser = argparse.ArgumentParser(description="Upstox F&O Parquet Sync Archive Engine")
    parser.add_argument("--mode", type=str, choices=["full", "delta"], default="delta", help="Delta (incremental) or Full sync")
    parser.add_argument("--symbols", type=str, default="indices", help="Indices only, all F&O stocks, or comma-separated symbols")
    parser.add_argument("--delta-strategy", type=str, choices=["static", "buffer"], default="static", help="Delta strategy: static (skip existing files) or buffer (override recent files)")
    parser.add_argument("--buffer-days", type=int, default=7, help="Number of days for recent buffer override")
    parser.add_argument("--test", action="store_true", help="Run a quick test sync for a single symbol and single expiry")
    parser.add_argument("--resume", action="store_true", help="Resume from the last uncompleted symbol by skipping already successful ones in sync_status.json")
    parser.add_argument("--only-underlying", action="store_true", help="Sync only underlying spot index/stock candles, skip options and futures")
    
    args = parser.parse_args()
    
    log.info("=" * 60)
    log.info("      UPSTOX F&O PARQUET SYNC ENGINE (UPSTOX PLUS ONLY)")
    log.info("      Time: %s", datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    log.info("      Mode: %s", args.mode.upper())
    log.info("      Symbols: %s", args.symbols)
    log.info("      Delta Strategy: %s", args.delta_strategy.upper())
    log.info("      Buffer Days: %d", args.buffer_days)
    log.info("      Test: %s", args.test)
    log.info("      Resume: %s", args.resume)
    log.info("=" * 60)
    
    # Verify token
    if not upstox_client.token:
        log.critical("Upstox Access Token is missing. Run the app and authenticate at /api/upstox/health first!")
        sys.exit(1)
        
    # Resolve symbols
    target_symbols = []
    if args.test:
        target_symbols = ["NIFTY"]
    elif args.symbols == "indices":
        target_symbols = list(INDICES.keys())
    elif args.symbols == "all":
        # Load indices + all F&O stocks
        fno_stocks = load_fno_symbols()
        target_symbols = list(INDICES.keys()) + fno_stocks
    else:
        # Comma-separated list
        target_symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
        
    # Remove duplicates but maintain order
    seen = set()
    target_symbols = [x for x in target_symbols if not (x in seen or seen.add(x))]
    
    log.info("Loaded %d unique target symbols.", len(target_symbols))
    
    # Load status
    status = load_sync_status()
    status["mode"] = args.mode
    status["last_sync"] = datetime.now().isoformat()
    
    success_count = 0
    error_symbols = []
    
    for symbol in tqdm(target_symbols, desc="Syncing Symbols"):
        if args.resume and symbol in status.get("completed_symbols", {}):
            if status["completed_symbols"][symbol].get("status") == "success":
                success_count += 1
                continue
        try:
            success = sync_symbol_data(symbol, args.mode, args.test, args.delta_strategy, args.buffer_days, only_underlying=args.only_underlying)
            if success:
                success_count += 1
                status["completed_symbols"][symbol] = {
                    "last_synced_at": datetime.now().isoformat(),
                    "status": "success"
                }
            else:
                error_symbols.append(symbol)
                status["completed_symbols"][symbol] = {
                    "last_synced_at": datetime.now().isoformat(),
                    "status": "failed"
                }
        except Exception as e:
            log.error("Failed to sync symbol %s: %s", symbol, e, exc_info=True)
            error_symbols.append(symbol)
            status["completed_symbols"][symbol] = {
                "last_synced_at": datetime.now().isoformat(),
                "status": "error",
                "message": str(e)
            }
            status["errors"].append({
                "symbol": symbol,
                "timestamp": datetime.now().isoformat(),
                "error": str(e)
            })
            
        save_sync_status(status)
        
    save_contract_mappings()
    log.info("=" * 60)
    log.info("      SYNC SUMMARY")
    log.info("      Successfully Synced: %d / %d", success_count, len(target_symbols))
    if error_symbols:
        log.info("      Failed Symbols: %s", ', '.join(error_symbols))
    log.info("=" * 60)
 
if __name__ == "__main__":
    main()
