import os
import sys
from datetime import datetime, timedelta
import db
from logger import get_logger

log = get_logger("capability_registry", tag="CAPISTRY")

# Ensure parent directory is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

REPROBE_INTERVAL_SECONDS = 3600  # 1 hour

def record_capability(provider: str, capability: str, auth_mode: str, state: str, diagnostic: str = ""):
    """Saves the capability state to the SQLite DB."""
    db.save_provider_capability(provider, capability, auth_mode, state, diagnostic)

def get_capability(provider: str, capability: str) -> dict:
    """Returns the last known state of a capability, with staleness checks."""
    cap = db.get_provider_capability(provider, capability)
    if not cap:
        return {
            "provider": provider,
            "capability": capability,
            "auth_mode": "public",
            "state": "available",
            "checked_at": None,
            "diagnostic": "No record found. Defaulting to available.",
            "needs_reauth": False
        }
    
    cap = dict(cap)
    cap["needs_reauth"] = False
    
    # Check if the state is old/expired (e.g. > 24 hours) and needs login
    checked_at_str = cap.get("checked_at")
    if checked_at_str:
        try:
            checked_at = datetime.fromisoformat(checked_at_str)
            if (datetime.now() - checked_at).total_seconds() > 86400:  # 24 hours
                cap["needs_reauth"] = True
                cap["diagnostic"] = (cap.get("diagnostic") or "") + " | Session is old. Re-login is recommended."
        except Exception:
            pass

    return cap

def should_retry(provider: str, capability: str) -> bool:
    """
    Returns False if capability is unavailable or entitlement_required or oauth_required,
    unless the reprobe timer (1 hour) has expired.
    """
    cap = db.get_provider_capability(provider, capability)
    if not cap:
        return True
    
    state = cap.get("state", "available")
    if state in ("available", "degraded", "demo_only"):
        return True
        
    # For entitlement_required, unavailable, oauth_required
    checked_at_str = cap.get("checked_at")
    if not checked_at_str:
        return True
        
    try:
        checked_at = datetime.fromisoformat(checked_at_str)
        elapsed = (datetime.now() - checked_at).total_seconds()
        if elapsed > REPROBE_INTERVAL_SECONDS:
            log.info(f"Reprobe interval expired for {provider}/{capability}. Allowing retry.")
            return True
    except Exception:
        return True
        
    return False

def get_all_capabilities() -> list:
    """Returns all registered capabilities, enriching them with staleness/re-auth tags."""
    caps = db.get_all_provider_capabilities()
    enriched_caps = []
    
    # Default list of expected capabilities to ensure all are represented
    default_set = [
        ("upstox", "quotes", "analytics"),
        ("upstox", "historical_candles", "analytics"),
        ("upstox", "option_chain", "analytics"),
        ("upstox", "smartlists", "interactive"),
        ("upstox", "websocket_market_feed", "analytics"),
        ("upstox", "fundamentals", "analytics"),
        ("upstox", "news", "analytics"),
        ("upstox", "ipo", "public"),
        ("upstox", "upstox_plus", "analytics"),
        ("dhan", "execution", "interactive"),
        ("dhan", "portfolio_sync", "interactive"),
        ("yahoo", "global_macro", "public"),
        ("nse", "delivery_enrichment", "public")
    ]
    
    cap_map = {(c["provider"].lower(), c["capability"].lower()): c for c in caps}
    
    for provider, capability, auth_mode in default_set:
        key = (provider.lower(), capability.lower())
        if key in cap_map:
            cap = cap_map[key]
            enriched = dict(cap)
        else:
            enriched = {
                "provider": provider,
                "capability": capability,
                "auth_mode": auth_mode,
                "state": "available",
                "checked_at": None,
                "diagnostic": "Initial pending probe"
            }
            
        enriched["needs_reauth"] = False
        if enriched.get("checked_at"):
            try:
                checked_at = datetime.fromisoformat(enriched["checked_at"])
                if (datetime.now() - checked_at).total_seconds() > 86400:  # 24 hours
                    enriched["needs_reauth"] = True
                    msg = "Session is old. Re-login is recommended."
                    if enriched["diagnostic"]:
                        if msg not in enriched["diagnostic"]:
                            enriched["diagnostic"] = f"{enriched['diagnostic']} | {msg}"
                    else:
                        enriched["diagnostic"] = msg
            except Exception:
                pass
                
        if enriched["auth_mode"] == "interactive" and enriched["state"] == "oauth_required":
            enriched["needs_reauth"] = True
            
        enriched_caps.append(enriched)
        
    return enriched_caps

def is_upstox_plus_active() -> bool:
    """
    Checks if Upstox Plus is active.
    Always returns True in local dev to enable local Parquet caching and nightly pre-fetching.
    """
    return True

