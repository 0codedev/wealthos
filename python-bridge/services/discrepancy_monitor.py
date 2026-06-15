import os
import sys
import time
from logger import get_logger

log = get_logger("discrepancy_monitor", tag="DISCREP")
import threading

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.dhan_client import dhan_client
from services.market_context import build_market_context, is_market_hours

def check_positions_discrepancies():
    """
    Fetches active positions from Dhan, resolves them to canonical IDs,
    and runs the market context builder to evaluate discrepancies.
    """
    if not is_market_hours():
        log.info("Outside market hours. Suppressing checks.")
        return
        
    log.info("Running periodic position discrepancy checks...")
    try:
        positions = dhan_client.get_positions()
        if not positions:
            log.info("No active positions found.")
            return

        for pos in positions:
            symbol = pos.get("tradingSymbol")
            if not symbol:
                continue
                
            # Construct canonical ID (e.g. NSE:RELIANCE)
            exchange = pos.get("exchangeSegment", "NSE")
            clean_exch = "NSE" if exchange.startswith("NSE") else exchange
            canonical_id = f"{clean_exch}:{symbol}"
            
            log.info(f"Checking position: {canonical_id}")
            # build_market_context automatically fetches, compares, logs discrepancies, and saves health
            build_market_context(canonical_id)
            
        log.info("Position discrepancy checks completed.")
    except Exception as e:
        log.info(f"Error running discrepancy checks: {e}")

def discrepancy_monitor_worker():
    """
    Background worker loop checking every 5 minutes.
    """
    # Sleep initial delay to allow systems to settle
    time.sleep(10)
    while True:
        try:
            check_positions_discrepancies()
        except Exception as e:
            log.info(f"Worker error: {e}")
        time.sleep(300)  # Check every 5 minutes

def start_discrepancy_monitor():
    """
    Starts the discrepancy monitor worker in a background thread.
    """
    t = threading.Thread(target=discrepancy_monitor_worker, daemon=True)
    t.start()
    log.info("Background thread started.")
