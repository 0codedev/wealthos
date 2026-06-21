import sys
import os
from datetime import datetime

# Ensure root python-bridge is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from logger import get_logger

log = get_logger("reconciliation", tag="RECON")
from services.dhan_client import dhan_client

def project_positions(events: list) -> dict:
    """
    Project current portfolio positions from a list of execution events.
    """
    # Group events by order_id to find the latest state of each order
    latest_orders = {}
    for event in events:
        order_id = event["order_id"]
        # Since events are ordered by timestamp DESC, the first one we encounter is the latest
        if order_id not in latest_orders:
            latest_orders[order_id] = event
            
    projected = {}
    for order_id, event in latest_orders.items():
        payload = event["raw_payload"]
        status = payload.get("orderStatus") or payload.get("OrderStatus") or payload.get("Status", "")
        # Only count if it's filled or partially filled
        if status in ("TRADED", "FILLED", "PARTIALLY_TRADED"):
            symbol = payload.get("tradingSymbol") or payload.get("TradingSymbol") or payload.get("Symbol")
            if not symbol:
                continue
            tx_type = payload.get("transactionType") or payload.get("TransactionType") or payload.get("side", "")
            qty = payload.get("tradedQty") or payload.get("TradedQty") or payload.get("quantity", 0)
            try:
                qty = int(qty)
            except ValueError:
                qty = 0
                
            if symbol not in projected:
                projected[symbol] = 0
            
            if tx_type == "BUY":
                projected[symbol] += qty
            elif tx_type == "SELL":
                projected[symbol] -= qty
                
    return projected

def reconcile_ledger_with_broker() -> dict:
    """
    Reconciles execution ledger projected positions with actual positions and holdings from Dhan REST API.
    """
    try:
        # 1. Fetch execution events
        events = db.get_execution_events()
        # 2. Project positions
        projected = project_positions(events)
        
        # 3. Fetch positions from REST
        positions = dhan_client.get_positions()
        # 4. Fetch holdings from REST
        holdings = dhan_client.get_holdings()
        
        mismatches = []
        # Build broker net position map (combining holdings and intraday positions)
        broker_positions = {}
        
        # Add positions (intraday and overnight trades)
        for pos in positions:
            sym = pos.get("tradingSymbol")
            net_qty = int(pos.get("netQty", 0))
            if sym:
                broker_positions[sym] = broker_positions.get(sym, 0) + net_qty
                
        # Add holdings (long term portfolio)
        for hold in holdings:
            sym = hold.get("tradingSymbol")
            qty = int(hold.get("quantity", 0)) + int(hold.get("t1Quantity", 0))
            if sym:
                broker_positions[sym] = broker_positions.get(sym, 0) + qty
                
        # Compare projected vs broker
        for sym, proj_qty in projected.items():
            brok_qty = broker_positions.get(sym, 0)
            if proj_qty != brok_qty:
                mismatches.append({
                    "symbol": sym,
                    "projected_qty": proj_qty,
                    "broker_qty": brok_qty,
                    "diff": proj_qty - brok_qty
                })
                
        # Also check if broker has positions that we didn't project
        for sym, brok_qty in broker_positions.items():
            if sym not in projected and brok_qty != 0:
                mismatches.append({
                    "symbol": sym,
                    "projected_qty": 0,
                    "broker_qty": brok_qty,
                    "diff": -brok_qty
                })
                
        # Update reconciliation state in DB for the reconciled events
        # If we reconciled successfully, we can mark all execution events as "reconciled"
        reconciled = len(mismatches) == 0
        if reconciled and events:
            conn = db.get_db_connection(write=True)
            cursor = conn.cursor()
            try:
                cursor.execute("UPDATE execution_events SET reconciliation_state = 'reconciled'")
                conn.commit()
            except Exception as e:
                log.info(f"Failed to update execution events status: {e}")
            finally:
                conn.close()
                
        return {
            "reconciled": reconciled,
            "mismatches": mismatches,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        log.error(f"Reconcile ledger failed: {e}")
        return {
            "reconciled": False,
            "error": str(e),
            "mismatches": [],
            "timestamp": datetime.now().isoformat()
        }
