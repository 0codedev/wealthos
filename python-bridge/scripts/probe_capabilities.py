import os
import sys
import json
import time
from datetime import datetime

# Add parent directory to path to import upstox/db
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from upstox import upstox_client
import db

REPORT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "capability_report.json")

def probe_all_capabilities():
    print("[PROBE] Starting Upstox capability probe...")
    report = {
        "checked_at": datetime.now().isoformat(),
        "tokens": {
            "interactive_token_present": bool(upstox_client.token),
            "analytics_token_present": bool(upstox_client.analytics_token)
        },
        "capabilities": {}
    }

    # Helper function to save report
    def save_report():
        os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
        with open(REPORT_PATH, "w") as f:
            json.dump(report, f, indent=2)
        print(f"[PROBE] Capability report saved to {REPORT_PATH}")

    # Determine availability of basic read-only endpoints
    # Let's perform a lightweight probe call for market status (which uses cheapest route)
    has_market_status = False
    try:
        res = upstox_client.get_market_status("NSE_CM")
        if res.get("status") == "success":
            has_market_status = True
    except Exception as e:
        print(f"[PROBE] Market status test failed: {e}")

    # Define capability items
    read_only_caps = [
        "market_status", "market_holidays", "quotes_v2", "ltp_ohlc_v3",
        "historical_candles", "option_chain", "option_contracts",
        "pcr_oi_maxpain", "fundamentals_profile_ratios", "news"
    ]

    for cap in read_only_caps:
        if has_market_status:
            state = "available"
        else:
            state = "oauth_required" if not upstox_client.analytics_token else "unavailable"
        
        report["capabilities"][cap] = {
            "provider": "upstox",
            "capability": cap,
            "auth_mode": "analytics",
            "state": state,
            "diagnostic": "Probe verified via market-status check" if has_market_status else "Access token missing or invalid"
        }
        
        # Save to SQLite DB for local persistence
        db.save_provider_capability("upstox", cap, "analytics", state, report["capabilities"][cap]["diagnostic"])

    # Decode token payload to detect plus plan
    is_plus_jwt = False
    for t in (upstox_client.token, upstox_client.analytics_token):
        if t:
            try:
                import base64
                parts = t.split('.')
                if len(parts) >= 2:
                    payload_b64 = parts[1]
                    padding = len(payload_b64) % 4
                    if padding != 0:
                        payload_b64 += '=' * (4 - padding)
                    payload_str = base64.b64decode(payload_b64).decode('utf-8')
                    payload = json.loads(payload_str)
                    if payload.get("isPlusPlan") or payload.get("isPlusUser") or payload.get("plus") or payload.get("plan") == "plus":
                        is_plus_jwt = True
            except Exception:
                pass

    # Probe Smartlists (Plus entitlement check)
    smartlist_state = "entitlement_required"
    smartlist_diagnostic = "Requires Plus Entitlement"
    if is_plus_jwt:
        smartlist_state = "available"
        smartlist_diagnostic = "Plus Entitlement verified via token payload"
    elif has_market_status:
        try:
            # Let's hit the endpoint to see if it succeeds
            res_smart = upstox_client.get_options_smartlist("INDEX", "TOP_TRADED")
            if res_smart.get("status") == "success":
                smartlist_state = "available"
                smartlist_diagnostic = "Plus Entitlement active and verified"
            else:
                errors = res_smart.get("errors", [])
                if errors and errors[0].get("errorCode") == "UDAPI100067":
                    smartlist_state = "entitlement_required"
                    smartlist_diagnostic = errors[0].get("message")
        except Exception as e:
            err_msg = str(e)
            if "forbidden" in err_msg.lower() or "403" in err_msg or "UDAPI100067" in err_msg:
                smartlist_state = "entitlement_required"
                smartlist_diagnostic = "Upstox Plus entitlement required"
            else:
                smartlist_state = "unavailable"
                smartlist_diagnostic = f"Smartlist check failed: {err_msg}"

    smartlist_caps = ["options_smartlist", "futures_smartlist", "mtf_smartlist"]
    for cap in smartlist_caps:
        report["capabilities"][cap] = {
            "provider": "upstox",
            "capability": cap,
            "auth_mode": "plus_entitlement",
            "state": smartlist_state,
            "diagnostic": smartlist_diagnostic
        }
        db.save_provider_capability("upstox", cap, "plus_entitlement", smartlist_state, smartlist_diagnostic)

    # Record upstox_plus capability explicitly
    plus_state = "available" if smartlist_state == "available" else "unavailable"
    plus_diagnostic = "Upstox Plus plan active" if plus_state == "available" else "Standard account (No Plus)"
    report["capabilities"]["upstox_plus"] = {
        "provider": "upstox",
        "capability": "upstox_plus",
        "auth_mode": "analytics",
        "state": plus_state,
        "diagnostic": plus_diagnostic
    }
    db.save_provider_capability("upstox", "upstox_plus", "analytics", plus_state, plus_diagnostic)


    # Probe WebSocket authorization (v3/feed/market-data-feed/authorize)
    ws_state = "oauth_required"
    ws_auth_mode = "interactive"
    ws_diagnostic = "No active tokens available to authorize WebSocket"
    
    # Try analytics token first
    if upstox_client.analytics_token:
        try:
            res_ws = upstox_client.request("GET", "v3/feed/market-data-feed/authorize", token_mode="analytics")
            if res_ws.get("status") == "success":
                ws_state = "available"
                ws_auth_mode = "analytics"
                ws_diagnostic = "WebSocket authorized using Analytics Token"
        except Exception as e:
            print(f"[PROBE] WebSocket check failed with Analytics Token: {e}")
            
    # Try interactive token next if analytics token is not verified/available
    if ws_state != "available" and upstox_client.token:
        try:
            res_ws = upstox_client.request("GET", "v3/feed/market-data-feed/authorize", token_mode="interactive")
            if res_ws.get("status") == "success":
                ws_state = "available"
                ws_auth_mode = "interactive"
                ws_diagnostic = "WebSocket authorized using Interactive Token"
        except Exception as e:
            print(f"[PROBE] WebSocket check failed with Interactive Token: {e}")
            ws_state = "unavailable"
            ws_diagnostic = f"WebSocket authorize failed: {e}"

    report["capabilities"]["websocket_market_feed"] = {
        "provider": "upstox",
        "capability": "websocket_market_feed",
        "auth_mode": ws_auth_mode,
        "state": ws_state,
        "diagnostic": ws_diagnostic
    }
    db.save_provider_capability("upstox", "websocket_market_feed", ws_auth_mode, ws_state, ws_diagnostic)

    # Probe Expired Derivatives (Interactive OAuth required check)
    expired_state = "oauth_required"
    expired_diagnostic = "Interactive OAuth token missing"
    if upstox_client.token:
        # We have an interactive token, verify it works
        try:
            # Hit expiries with a dummy symbol
            res_exp = upstox_client.get_expiries("NSE_EQ|INE002A01018")
            if res_exp.get("status") == "success":
                expired_state = "available"
                expired_diagnostic = "Interactive OAuth token verified"
            else:
                expired_state = "unavailable"
                expired_diagnostic = "Interactive OAuth token invalid or expired"
        except Exception as e:
            expired_state = "unavailable"
            expired_diagnostic = f"Interactive OAuth check failed: {str(e)}"

    expired_caps = ["expired_expiries", "expired_option_contracts", "expired_future_contracts", "expired_historical_candles"]
    for cap in expired_caps:
        report["capabilities"][cap] = {
            "provider": "upstox",
            "capability": cap,
            "auth_mode": "interactive",
            "state": expired_state,
            "diagnostic": expired_diagnostic
        }
        db.save_provider_capability("upstox", cap, "interactive", expired_state, expired_diagnostic)

    # Save finalized report
    save_report()
    return report

if __name__ == "__main__":
    probe_all_capabilities()
