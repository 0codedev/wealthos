import os
import sys
import json
from datetime import datetime
from fastapi import APIRouter, HTTPException, Query

# Ensure root python-bridge is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from services.instrument_registry import resolve_symbol
from services.market_context import build_market_context
from services.reconciliation import reconcile_ledger_with_broker

router = APIRouter(prefix="/api/journal")

@router.post("/capture-pre-trade")
def capture_pre_trade(canonical_id: str = Query(...), order_id: str = Query(...)):
    """
    Captures pre-trade MarketContextEnvelope snapshot before order execution and saves it.
    """
    try:
        envelope = build_market_context(canonical_id)
        if "error" in envelope:
            raise HTTPException(status_code=404, detail=envelope["error"])
        
        db.save_feature_snapshot(canonical_id, f"pre_trade_context:{order_id}", envelope)
        return {"status": "success", "envelope": envelope}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/pending")
def get_pending_journal_entries():
    """
    Retrieves automated journal entries from execution events, attaching pre/post trade contexts and slippage metrics.
    """
    try:
        events = db.get_execution_events()
        # Find all trade/fill events
        fill_events = [e for e in events if e["event_type"] in ("TRADED", "FILLED")]
        
        entries = []
        for event in fill_events:
            payload = event["raw_payload"]
            order_id = event["order_id"]
            trading_symbol = payload.get("tradingSymbol") or payload.get("TradingSymbol") or payload.get("Symbol")
            if not trading_symbol:
                continue
                
            inst = resolve_symbol(trading_symbol)
            canonical_id = inst.get("canonical_id") if inst else trading_symbol
            
            # Fetch pre-trade context and post-trade context if available
            pre_snap = db.get_feature_snapshot(canonical_id, f"pre_trade_context:{order_id}")
            post_snap = db.get_feature_snapshot(canonical_id, f"post_trade_context:{order_id}")
            
            pre_context = pre_snap["value"] if pre_snap else None
            post_context = post_snap["value"] if post_snap else None
            
            # Retrieve prices
            tx_type = payload.get("transactionType") or payload.get("TransactionType") or payload.get("side", "BUY")
            qty = int(payload.get("tradedQty") or payload.get("TradedQty") or payload.get("quantity", 0))
            fill_price = float(payload.get("avgTradedPrice") or payload.get("AvgTradedPrice") or payload.get("price", 0.0))
            
            pre_price = 0.0
            if pre_context and "quote" in pre_context and pre_context["quote"].get("data"):
                pre_price = float(pre_context["quote"]["data"].get("last_price", 0.0))
                
            # Slippage calculation
            slippage = 0.0
            slippage_pct = 0.0
            if pre_price > 0:
                if tx_type == "BUY":
                    slippage = fill_price - pre_price
                else:
                    slippage = pre_price - fill_price
                slippage_pct = (slippage / pre_price) * 100
                
            # Default notes
            notes = f"Auto-generated from Dhan fill event for {trading_symbol}.\n"
            if pre_price > 0:
                notes += f"Pre-trade price: ₹{pre_price:.2f}. Executed price: ₹{fill_price:.2f}.\n"
                notes += f"Slippage: ₹{slippage:.2f} ({slippage_pct:.2f}%).\n"
            else:
                notes += f"Executed price: ₹{fill_price:.2f}. Pre-trade price context was not captured.\n"
                
            # Format entry
            entry_time = event["timestamp"].split("T")[-1][:5] if "T" in event["timestamp"] else "09:15"
            trade_date = event["timestamp"].split("T")[0]
            
            # Formulate mock charges/fees if not available
            brokerage = 20.0 if qty * fill_price > 1000 else 0.0
            stt = (qty * fill_price) * 0.001 if tx_type == "SELL" else 0.0
            fees = brokerage + stt
            
            entry = {
                "ticker": trading_symbol,
                "entryPrice": fill_price,
                "exitPrice": fill_price,
                "quantity": qty,
                "direction": "Long" if tx_type == "BUY" else "Short",
                "date": trade_date,
                "entryTime": entry_time,
                "notes": notes,
                "fees": fees,
                "feeBreakdown": {
                    "brokerage": brokerage,
                    "stt": stt,
                    "exchangeTransactionCharges": 0.0,
                    "sebiTax": 0.0,
                    "stampDuty": 0.0,
                    "serviceTax": 0.0
                },
                "orderType": payload.get("orderType", "LIMIT"),
                "productType": payload.get("productType", "CNC"),
                "isin": payload.get("isin", ""),
                "isImported": True,
                "broker": "dhan",
                "brokerOrderId": order_id,
                "brokerTradeId": payload.get("tradeId") or payload.get("TradeNo") or f"dhan_tr_{order_id}",
                "brokerSecurityId": payload.get("securityId", ""),
                "source": "dhan",
                "sourceId": order_id,
                "syncStatus": "SYNCED",
                "reviewStatus": "READY_FOR_LESSON",
                "preTradeContext": pre_context,
                "postTradeContext": post_context,
                "slippage": slippage,
                "slippagePct": slippage_pct
            }
            entries.append(entry)
            
        return entries
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/reconcile")
def run_reconciliation():
    """
    Manually runs reconciliation against broker positions and holdings.
    """
    return reconcile_ledger_with_broker()


# ── Journedge SQLite Journal endpoints ───────────────────────────────

from pydantic import BaseModel
from typing import Optional

class JournedgeTrade(BaseModel):
    id: str
    ticker: str
    direction: str
    quantity: int
    entryPrice: float
    exitPrice: Optional[float] = None
    pnl: Optional[float] = None
    date: str
    notes: Optional[str] = None
    tags: Optional[str] = None
    source: Optional[str] = "journedge"

@router.post("/journedge/sync")
def sync_journedge_trade(trade: JournedgeTrade):
    """Save or update trade record in local SQLite (Journedge)."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
    from journedge_provider import save_journedge_trade
    success = save_journedge_trade(trade.model_dump())
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save trade record in SQLite")
    return {"status": "success", "message": f"Trade {trade.id} saved in Journedge DB"}

@router.get("/journedge/trades")
def fetch_journedge_trades():
    """Retrieve all trades stored locally in SQLite (Journedge)."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
    from journedge_provider import get_journedge_trades
    return get_journedge_trades()

