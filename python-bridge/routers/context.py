import os
import sys
from fastapi import APIRouter, HTTPException, Query, Response

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from services.market_context import build_market_context

router = APIRouter()

@router.get("/api/context/{canonical_id:path}")
def get_market_context(response: Response, canonical_id: str):
    """
    Retrieves the consolidated market context envelope for a given canonical ID.
    Supports paths like 'NSE:RELIANCE'.
    """
    try:
        envelope = build_market_context(canonical_id)
        if "error" in envelope:
            raise HTTPException(status_code=404, detail=envelope["error"])
        if envelope.get("is_stale_fallback"):
            response.headers["X-Data-Status"] = "stale"
            response.headers["X-Data-Warning"] = f"Failed to fetch live quotes for {canonical_id}. Showing cached database fallback."
        return envelope
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/discrepancies")
def get_discrepancies():
    """
    Retrieves all active (unresolved) price discrepancies.
    """
    try:
        return db.get_active_discrepancies()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/discrepancies/resolve")
def resolve_discrepancy(canonical_id: str = Query(...), field: str = Query(...)):
    """
    Manually resolves a flagged discrepancy.
    """
    try:
        db.resolve_discrepancy(canonical_id, field)
        return {"status": "success", "message": f"Resolved discrepancy for {canonical_id} on field {field}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/health/providers")
def get_provider_health():
    """
    Retrieves the latest health stats for each provider.
    """
    try:
        return db.get_latest_source_health()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
