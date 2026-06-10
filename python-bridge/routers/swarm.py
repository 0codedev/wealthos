"""
swarm.py
FastAPI router for AI agent swarm debates.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import sys
import os

router = APIRouter(prefix="/api/swarm", tags=["swarm"])

class DebateRequest(BaseModel):
    symbol: str
    strategy: str = "general"

@router.post("/debate")
def run_debate(req: DebateRequest):
    """
    Triggers Bull vs Bear debate for a symbol/strategy.
    """
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
        from finrobot_debater import run_swarm_debate
        result = run_swarm_debate(req.symbol, req.strategy)
        return {"status": "success", **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── AutoHedge Swarm endpoints ───────────────────────────────

class HedgeRequest(BaseModel):
    symbol: str
    spot_price: float
    position_type: str = "LONG"

@router.post("/hedge")
def run_hedging_swarm(req: HedgeRequest):
    """
    Triggers option protective hedging strategy recommendations via AutoHedge swarm.
    """
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
        from autohedge_swarm import calculate_hedging_verdict
        result = calculate_hedging_verdict(req.symbol, req.spot_price, req.position_type)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

