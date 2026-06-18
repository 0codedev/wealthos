import os
from logger import get_logger

log = get_logger("market_context", tag="MKT_CTX")
import sys
import time
from datetime import datetime, timedelta

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from services.dhan_client import dhan_client
from services.instrument_registry import resolve_symbol
from routers.shared import upstox_client

def is_market_hours() -> bool:
    """
    Checks if current time is within Indian Stock Market hours:
    Monday - Friday, 9:15 AM - 3:30 PM IST (UTC+5:30).
    """
    # Current UTC time
    now_utc = datetime.utcnow()
    # Convert to IST (UTC + 5:30)
    now_ist = now_utc + timedelta(hours=5, minutes=30)
    
    day = now_ist.weekday()  # 0 = Monday, 6 = Sunday
    if day >= 5:  # Weekend
        return False
        
    time_num = now_ist.hour * 100 + now_ist.minute
    return 915 <= time_num <= 1530

def build_market_context(canonical_id: str) -> dict:
    """
    Builds a consolidated MarketContextEnvelope for the given canonical_id.
    """
    now_str = datetime.now().isoformat()
    
    # 1. Resolve Instrument
    # If the canonical_id is like "NSE:RELIANCE", symbol is "RELIANCE"
    symbol = canonical_id.split(":")[-1] if ":" in canonical_id else canonical_id
    inst = resolve_symbol(symbol)
    if not inst:
        return {
            "canonicalId": canonical_id,
            "asOf": now_str,
            "discrepancies": [],
            "trustScore": 0,
            "error": "Symbol could not be resolved in registry"
        }
        
    canonical_id = inst.get("canonical_id", canonical_id)
    asset_class = inst.get("asset_class", "EQUITY")
    
    upstox_key = inst.get("upstox_key")
    dhan_security_id = inst.get("dhan_security_id")
    dhan_segment = inst.get("dhan_segment")
    
    upstox_data = None
    dhan_data = None
    upstox_status = "unavailable"
    dhan_status = "unavailable"
    
    # 2. Fetch Upstox Quote (Primary)
    if upstox_key:
        try:
            quotes = upstox_client.get_full_quotes([upstox_key])
            if quotes and upstox_key in quotes:
                upstox_data = quotes[upstox_key]
                upstox_status = "ok"
                db.save_market_snapshot(canonical_id, "upstox", "quote", upstox_data)
        except Exception as e:
            log.info(f"Upstox fetch error for {upstox_key}: {e}")
            upstox_status = "degraded"

    # 3. Fetch Dhan Quote (Overlay)
    if dhan_security_id and dhan_segment:
        try:
            # Dhan segment format check (integer IDs required)
            segment_id_map = {dhan_segment: [int(dhan_security_id)]}
            ltp_map = dhan_client.get_ltp(segment_id_map)
            if ltp_map and str(dhan_security_id) in ltp_map:
                dhan_data = ltp_map[str(dhan_security_id)]
                dhan_status = "ok"
                # Save snapshot
                db.save_market_snapshot(canonical_id, "dhan", "quote", {"last_price": dhan_data})
        except Exception as e:
            log.info(f"Dhan fetch error for {dhan_security_id}: {e}")
            dhan_status = "degraded"

    # Fallback to cached feature snapshot if both primary and overlay failed
    if upstox_status != "ok" and (not dhan_security_id or dhan_status != "ok"):
        cached_envelope = db.get_feature_snapshot(canonical_id, "market_context")
        if cached_envelope and cached_envelope.get("value"):
            envelope = cached_envelope["value"]
            if "quote" in envelope:
                envelope["quote"]["status"] = "stale-fallback"
                envelope["quote"]["freshness"] = "stale"
            if "ohlc" in envelope:
                envelope["ohlc"]["status"] = "stale-fallback"
                envelope["ohlc"]["freshness"] = "stale"
            envelope["asOf"] = cached_envelope["computed_at"]
            envelope["is_stale_fallback"] = True
            log.info(f"Served cached database market context for {canonical_id} computed_at {cached_envelope['computed_at']}")
            return envelope

    # 4. Check Discrepancies (LTP Divergence)
    discrepancies = []
    upstox_ltp = 0
    dhan_ltp = 0
    
    if upstox_data and "last_price" in upstox_data:
        upstox_ltp = float(upstox_data["last_price"])
    if dhan_data:
        dhan_ltp = float(dhan_data)
        
    if upstox_ltp > 0 and dhan_ltp > 0:
        delta = abs(upstox_ltp - dhan_ltp) / upstox_ltp
        threshold = 0.02 if asset_class in ["DERIVATIVES", "option", "future"] else 0.005
        
        # Suppress alerts outside market hours
        if delta > threshold and is_market_hours():
            discrepancy = {
                "field": "ltp",
                "upstoxValue": upstox_ltp,
                "dhanValue": dhan_ltp,
                "delta": round(delta, 5),
                "flaggedAt": now_str,
                "resolved": False
            }
            discrepancies.append(discrepancy)
            db.log_discrepancy(canonical_id, "ltp", upstox_ltp, dhan_ltp, delta)

    # 5. Compute Trust Score (0 to 100)
    trust_score = 100
    if upstox_status != "ok":
        trust_score -= 40
    if dhan_status != "ok" and dhan_security_id:
        trust_score -= 20
    if len(discrepancies) > 0:
        trust_score -= 30
        
    trust_score = max(0, min(100, trust_score))
    
    # 6. Format Envelope
    envelope = {
        "canonicalId": canonical_id,
        "asOf": now_str,
        "quote": {
            "data": upstox_data,
            "source": "upstox",
            "asOf": now_str,
            "fetchedAt": now_str,
            "freshness": "live" if upstox_status == "ok" else "expired",
            "status": upstox_status,
            "confidence": 90 if upstox_status == "ok" else 0,
            "fallbackChain": ["dhan", "yahoo"]
        },
        "ohlc": {
            "data": upstox_data.get("ohlc") if upstox_data else None,
            "source": "upstox",
            "asOf": now_str,
            "fetchedAt": now_str,
            "freshness": "live" if upstox_status == "ok" else "expired",
            "status": upstox_status,
            "confidence": 90 if upstox_status == "ok" else 0,
            "fallbackChain": ["dhan", "yahoo"]
        },
        "depth": {
            "data": upstox_data.get("depth") if upstox_data else None,
            "source": "upstox",
            "asOf": now_str,
            "fetchedAt": now_str,
            "freshness": "live" if upstox_status == "ok" else "expired",
            "status": upstox_status,
            "confidence": 90 if upstox_status == "ok" else 0,
            "fallbackChain": []
        },
        "discrepancies": discrepancies,
        "trustScore": trust_score
    }
    
    # Cache feature snapshot
    db.save_feature_snapshot(canonical_id, "market_context", envelope)
    
    # Track provider health
    db.log_source_health("upstox", 120.0 if upstox_status == "ok" else 0.0, 0.0 if upstox_status == "ok" else 1.0, 0.8, 0.1, "CLOSED")
    if dhan_security_id:
        db.log_source_health("dhan", 150.0 if dhan_status == "ok" else 0.0, 0.0 if dhan_status == "ok" else 1.0, 0.9, 0.0, "CLOSED")
        
    return envelope
