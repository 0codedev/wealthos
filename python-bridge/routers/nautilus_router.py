"""
nautilus_router.py — Proxy router for NautilusTrader precision engine microservice
Prefix: /api/nautilus
Microservice URL: http://127.0.0.1:8091
"""
import os
import sys
import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
import httpx

logger = logging.getLogger("nautilus_router")

router = APIRouter(prefix="/api/nautilus", tags=["NautilusTrader — Precision Engine"])

NAUTILUS_URL = os.getenv("NAUTILUS_SERVICE_URL", "http://127.0.0.1:8091")

class NTBacktestReq(BaseModel):
    symbol: str = "BTCUSDT"
    venue: str = "BINANCE"
    start: str = "2023-01-01"
    end: str = "2024-01-01"
    initial_balance: float = 10000.0
    currency: str = "USDT"

@router.get("/health")
async def health():
    """Check status and precision mode (64-bit vs 128-bit) of NautilusTrader service"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{NAUTILUS_URL}/health")
            if r.status_code == 200:
                return r.json()
            return {"status": "error", "code": r.status_code}
    except Exception:
        return {"status": "offline", "note": "NautilusTrader microservice offline (Port 8091)"}

@router.post("/backtest")
async def run_backtest(req: NTBacktestReq):
    """
    Run deterministic NautilusTrader backtest via microservice proxy
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(f"{NAUTILUS_URL}/backtest/run", json=req.model_dump())
            if r.status_code == 200:
                return r.json()
            raise HTTPException(status_code=r.status_code, detail=r.text)
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="NautilusTrader microservice offline on Port 8091")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
