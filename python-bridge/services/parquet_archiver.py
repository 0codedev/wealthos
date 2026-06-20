import os
import sys
import json
import pandas as pd
from datetime import datetime, timedelta
from logger import get_logger

log = get_logger("parquet_archiver", tag="ARCHIVER")

# Ensure root python-bridge is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from services.capability_registry import is_upstox_plus_active
import sync_parquet

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

def generate_archive_manifest(symbol: str):
    """
    Generates and saves the archive_manifest.json for a given symbol.
    """
    manifest_path = os.path.join(DATA_DIR, "underlying", symbol, "archive_manifest.json")
    daily_parquet = os.path.join(DATA_DIR, "underlying", symbol, "day", "data.parquet")
    
    if not os.path.exists(daily_parquet):
        return
        
    try:
        df = pd.read_parquet(daily_parquet)
        if df.empty:
            return
            
        timestamps = pd.to_datetime(df["timestamp"])
        min_date = timestamps.min().strftime("%Y-%m-%d")
        max_date = timestamps.max().strftime("%Y-%m-%d")
        
        # Calculate completeness score
        expected_days = (timestamps.max() - timestamps.min()).days
        # Clean business days estimate (5/7 of total days)
        expected_business_days = max(1, int(expected_days * 5 / 7))
        actual_days = len(df)
        completeness = min(1.0, actual_days / expected_business_days)
        
        manifest = {
            "symbol": symbol,
            "date_range": {
                "start": min_date,
                "end": max_date
            },
            "completeness_score": round(completeness, 4),
            "total_records": actual_days,
            "lineage": {
                "source": "Upstox Historical API",
                "compression": "Snappy",
                "format": "Parquet",
                "last_archived_at": datetime.now().isoformat()
            }
        }
        
        os.makedirs(os.path.dirname(manifest_path), exist_ok=True)
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=4)
            
        log.info("Manifest generated for %s: %s to %s (%d records)", symbol, min_date, max_date, actual_days)
    except Exception as e:
        log.error("Failed to generate manifest for %s: %s", symbol, e)

def run_daily_archive(symbols=None):
    """
    Runs the daily post-market candle roll-up and manifest updates.
    Gated by Upstox Plus active capability check.
    """
    # 1. Plus Tier check
    if not is_upstox_plus_active():
        log.warning("Upstox Plus plan is not active. Daily candle archiving is disabled/restricted.")
        return False
        
    if not symbols:
        # Default to Nifty 50 and Nifty Bank
        symbols = ["NIFTY", "BANKNIFTY"]
        
    log.info("Starting daily post-market candle archiving for %d symbols...", len(symbols))
    
    for symbol in symbols:
        try:
            # Sync daily candles (10 years lookback)
            sync_parquet.sync_underlying_candles(symbol, "day", 3650, "delta", "static")
            # Sync 5-min candles (180 days lookback)
            sync_parquet.sync_underlying_candles(symbol, "5minute", 180, "delta", "static")
            # Sync 1-min candles (30 days lookback)
            sync_parquet.sync_underlying_candles(symbol, "1minute", 30, "delta", "static")
            # Generate manifest
            generate_archive_manifest(symbol)
        except Exception as e:
            log.error("Error archiving %s: %s", symbol, e)
            
    log.info("Daily candle archiving completed.")
    return True
