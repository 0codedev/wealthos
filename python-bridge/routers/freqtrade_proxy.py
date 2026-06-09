"""
freqtrade_proxy.py — Proxy router for standalone Freqtrade bot microservice
Prefix: /api/freqtrade
Microservice URL: http://127.0.0.1:8080/api/v1
"""
import os
import sys
import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Query
import httpx

logger = logging.getLogger("freqtrade_proxy")

router = APIRouter(prefix="/api/freqtrade", tags=["Freqtrade — Crypto Trading Bot"])

FREQTRADE_BASE = os.getenv("FREQTRADE_URL", "http://127.0.0.1:8080/api/v1")
AUTH = ("wealthos", "wealthos123")
TIMEOUT = 5.0

def _ft_get(path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            r = client.get(f"{FREQTRADE_BASE}{path}", auth=AUTH, params=params)
            if r.status_code == 200:
                return r.json()
            return {"status": "error", "code": r.status_code, "detail": r.text}
    except httpx.ConnectError:
        return {"running": False, "status": "offline", "note": "Freqtrade bot microservice offline (Port 8080)"}
    except Exception as e:
        return {"running": False, "status": "error", "error": str(e)}

def _ft_post(path: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            r = client.post(f"{FREQTRADE_BASE}{path}", auth=AUTH, json=data)
            if r.status_code == 200:
                return r.json()
            return {"status": "error", "code": r.status_code, "detail": r.text}
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Freqtrade bot microservice offline (Port 8080)")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/ping")
def ping():
    return _ft_get("/ping")

@router.get("/status")
def bot_status():
    """Get active Freqtrade bot status and open trades"""
    data = _ft_get("/status")
    if isinstance(data, list):
        return {"running": True, "open_trades_count": len(data), "trades": data, "dry_run": True}
    if isinstance(data, dict) and data.get("running") is False:
        return data
    return {"running": True, "details": data, "dry_run": True}

@router.get("/profit")
def bot_profit():
    """Get profit summary statistics"""
    return _ft_get("/profit")

@router.get("/trades")
def bot_trades(limit: int = Query(50, ge=1, le=200)):
    """Get trade execution history"""
    return _ft_get(f"/trades?limit={limit}")

@router.get("/performance")
def bot_performance():
    """Get per-pair trading performance"""
    return _ft_get("/performance")

@router.get("/stats")
def bot_stats():
    """Get bot runtime statistics"""
    return _ft_get("/stats")

@router.post("/start")
def start_bot():
    """Start Freqtrade trading loop"""
    return _ft_post("/start")

@router.post("/stop")
def stop_bot():
    """Stop Freqtrade trading loop"""
    return _ft_post("/stop")
