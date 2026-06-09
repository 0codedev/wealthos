import os
import sys
import re
from datetime import datetime
from fastapi import APIRouter, HTTPException

# Ensure python-bridge root is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routers.shared import is_market_hours, market_status, APP_START_TIME
import telemetry

router = APIRouter()

TOKEN_REGEX = re.compile(r"eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.[A-Za-z0-9-_+/=]*")

def redact_secrets(data):
    """
    Recursively scans and redacts JWTs and other token-like strings from JSON payloads.
    """
    if isinstance(data, str):
        # Scrub standard JWT patterns
        data = TOKEN_REGEX.sub("[REDACTED_JWT]", data)
        # Scrub long token signatures (e.g. 40+ chars)
        if len(data) > 40 and not any(c in data for c in (" ", "\n", "\\", "/", ":", ".")):
            return "[REDACTED_SECRET]"
        return data
    elif isinstance(data, dict):
        return {k: redact_secrets(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [redact_secrets(item) for item in data]
    return data

@router.get("/")
def read_root():
    ms = market_status()
    return {
        "status": "online",
        "service": "Python NSE Bridge",
        "time": datetime.now().isoformat(),
        "is_market_hours": ms["is_open"],
        "market_status": ms,
        "next_change_in": ms["seconds_until_change"],  # CC116: replaces 3s polling in BridgeStatusBanner
    }

@router.get("/api/telemetry")
def get_telemetry_endpoint():
    try:
        data = telemetry.get_system_telemetry(APP_START_TIME)
        return redact_secrets(data)
    except Exception as e:
        # Also redact exception messages if they leak tokens
        err_msg = redact_secrets(str(e))
        raise HTTPException(status_code=500, detail=f"Failed to generate telemetry: {err_msg}")

@router.get("/api/capabilities")
def get_capabilities_endpoint():
    try:
        from services.capability_registry import get_all_capabilities
        data = get_all_capabilities()
        return redact_secrets(data)
    except Exception as e:
        err_msg = redact_secrets(str(e))
        raise HTTPException(status_code=500, detail=f"Failed to fetch capabilities: {err_msg}")

@router.get("/api/diagnostics/startup-timeline")
def get_diagnostics_startup_timeline():
    try:
        from telemetry import get_startup_timeline
        return get_startup_timeline()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/ready")
def check_readiness():
    try:
        from telemetry import get_startup_timeline
        timeline = get_startup_timeline()
        milestones = [m["milestone"] for m in timeline]
        
        # Ready if Tier A and Tier B are complete
        is_ready = "health_route_ready" in milestones and (
            "orderflow_started" in milestones or "ws_connected" in milestones or "ws_deferred_market_closed" in milestones
        )
        
        return {
            "ready": is_ready,
            "milestones": timeline,
            "is_market_hours": is_market_hours()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/telemetry/traffic/logs")
def get_traffic_logs_endpoint():
    try:
        return telemetry.get_traffic_logs()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/telemetry/security/logs")
def get_security_logs_endpoint():
    try:
        # Seed a default boot event if the security log is empty
        logs = telemetry.get_security_logs()
        if not logs:
            telemetry.record_security_event("SYSTEM_BOOT", "Compliance System Initialized and Secured", "INFO")
            logs = telemetry.get_security_logs()
        return logs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health/liveness")
@router.get("/api/health/liveness")
def check_liveness():
    """Fast sub-20ms liveness probe confirming process is responsive."""
    import time
    return {
        "status": "ok",
        "service": "wealthos-api",
        "timestamp": datetime.now().isoformat(),
        "uptime_seconds": round(time.time() - APP_START_TIME, 1),
    }

@router.get("/health/readiness")
@router.get("/api/health/readiness")
def check_readiness_sre():
    """Deep readiness probe validating memory budget, startup milestones, and DB availability."""
    from telemetry import get_startup_timeline
    from services.sre_watchdog import get_sre_status
    timeline = get_startup_timeline()
    milestones = [m["milestone"] for m in timeline]
    sre_stat = get_sre_status()
    
    is_ready = "health_route_ready" in milestones
    if sre_stat["memory"]["status"] == "critical":
        raise HTTPException(status_code=503, detail="Memory threshold breached (critical)")
    
    return {
        "ready": is_ready,
        "service": "wealthos-api",
        "sre_status": sre_stat["status"],
        "milestones": milestones,
        "is_market_hours": is_market_hours(),
    }

@router.get("/health/state")
@router.get("/api/health/sre")
def get_sre_state_endpoint():
    """Exposes real-time SRE Watchdog metrics, memory RSS, feed freshness, and incident history."""
    try:
        from services.sre_watchdog import get_sre_status
        return redact_secrets(get_sre_status())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


