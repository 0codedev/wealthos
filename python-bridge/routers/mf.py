"""
MF NAV endpoints (CC53).

GET  /api/mf/status?codes=...   → cached NAVs + scheduler state
POST /api/mf/refresh            → fire a bounded-concurrency refresh; returns 202

The router never writes to disk. The service module owns the SQLite cache.
"""
import os
import sys
import time
import asyncio

from fastapi import APIRouter, Query

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import mf_nav_service
from routers.mf_schema import (
    MfStatusResponse,
    MfRefreshResponse,
    MfRefreshFailedItem,
    RefreshRequest,
    CodesPayload,
)

router = APIRouter(prefix="/api/mf", tags=["mf"])

# In-memory in-flight flag. Survives within a single process; reset on bridge restart.
_in_flight: bool = False
_in_flight_lock = asyncio.Lock()


@router.get("/status", response_model=MfStatusResponse)
def get_status(codes: str = Query(default="", description="comma-separated amfi codes")):
    """
    Return cached NAVs for the given codes. If the cache is stale (>24h), fire a
    background refresh but return immediately (don't block the user).
    """
    code_list = [c.strip() for c in codes.split(",") if c.strip()]
    payload = mf_nav_service.get_status(code_list)
    payload["is_refreshing"] = _in_flight

    if mf_nav_service.is_cache_stale() and code_list:
        # Fire-and-forget stale refresh
        asyncio.create_task(_safe_refresh(code_list))

    return payload


@router.post("/refresh", response_model=MfRefreshResponse, status_code=202)
async def post_refresh(req: RefreshRequest):
    """
    Trigger a manual refresh of the given amfi codes.
    Idempotent: a second concurrent call returns 202 with a no-op summary.
    """
    global _in_flight
    async with _in_flight_lock:
        if _in_flight:
            return MfRefreshResponse(
                refreshed=0, failed=[], skipped=0,
                started_at=int(time.time()), duration_ms=0,
            )
        _in_flight = True

    started = int(time.time())
    try:
        if not req.codes:
            return MfRefreshResponse(
                refreshed=0, failed=[], skipped=0,
                started_at=started, duration_ms=0,
            )
        result = await mf_nav_service.refresh_all_async(req.codes)
        return MfRefreshResponse(
            refreshed=result.get("refreshed", 0),
            failed=[MfRefreshFailedItem(**f) for f in result.get("failed", [])],
            skipped=result.get("skipped", 0),
            started_at=started,
            duration_ms=result.get("duration_ms", 0),
        )
    finally:
        _in_flight = False


async def _safe_refresh(codes):
    """Background task: refresh + reset the in-flight flag no matter what."""
    global _in_flight
    # Mark the in-flight flag for the duration of the background refresh so
    # the status endpoint reports `is_refreshing: true`.
    _in_flight = True
    try:
        await mf_nav_service.refresh_all_async(codes)
    finally:
        _in_flight = False


@router.post("/codes", status_code=204)
def post_codes(req: CodesPayload):
    """
    Persist the user's current amfi code list into mf_refresh_state. Called
    by the frontend on every Portfolio Hub mount + codes change (gated on
    enableMutualFunds). The scheduler reads this on each tick.

    204 No Content: the frontend posts but consumes no body.
    """
    mf_nav_service.set_amfi_codes(req.codes)
    return None
