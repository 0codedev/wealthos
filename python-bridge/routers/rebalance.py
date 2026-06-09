"""
rebalance.py
FastAPI router for portfolio rebalancing and weight optimization.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
import sys
import os

router = APIRouter(prefix="/api/portfolio", tags=["rebalance"])

class RebalanceRequest(BaseModel):
    assets: List[str]
    weights: List[float]
    risk_tolerance: str = "medium"

@router.post("/rebalance")
def perform_rebalance(req: RebalanceRequest):
    """
    Computes optimal portfolio allocation weights.
    """
    if len(req.assets) != len(req.weights):
        raise HTTPException(status_code=400, detail="Assets and weights lists must be of equal length")
        
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
        from finrl_allocator import rebalance_portfolio
        result = rebalance_portfolio(req.assets, req.weights, req.risk_tolerance)
        return {"status": "success", **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
