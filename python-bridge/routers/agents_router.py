"""
agents_router.py — Proxy router for TradingAgents multi-agent LLM microservice
Prefix: /api/agents
Microservice URL: http://127.0.0.1:8090
"""
import os
import sys
import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
import httpx

logger = logging.getLogger("agents_router")

router = APIRouter(prefix="/api/agents", tags=["TradingAgents — AI Multi-Agent Analyst"])

AGENTS_URL = os.getenv("TRADING_AGENTS_URL", "http://127.0.0.1:8090")

class AnalysisReq(BaseModel):
    symbol: str
    date: str = "2024-01-01"
    llm_provider: str = "openai"

@router.get("/health")
async def health():
    """Check status of TradingAgents microservice"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{AGENTS_URL}/health")
            if r.status_code == 200:
                return r.json()
            return {"status": "error", "code": r.status_code}
    except Exception as e:
        return {"status": "offline", "note": "TradingAgents microservice offline (Port 8090)"}

@router.post("/analyze/{symbol:path}")
async def analyze_stock(
    symbol: str,
    date: str = Query("2024-01-01", description="Analysis date horizon YYYY-MM-DD"),
    provider: str = Query("openai", description="LLM provider: openai|anthropic|google")
):
    """
    Trigger multi-agent LLM debate analysis (Fundamentals, News, Bull/Bear Debate, Risk Manager)
    Timeout is 120s to allow LLM debate rounds.
    """
    sym = symbol.replace("-", "/").upper()
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(f"{AGENTS_URL}/analyze", json={
                "symbol": sym,
                "date": date,
                "llm_provider": provider
            })
            if r.status_code == 200:
                return r.json()
            raise HTTPException(status_code=r.status_code, detail=r.text)
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="TradingAgents microservice is offline on Port 8090")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Multi-agent LLM analysis timed out after 120s")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
