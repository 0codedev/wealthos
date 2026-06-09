"""Pydantic v2 schemas for /api/mf/* (CC53)."""
from typing import List, Optional
from pydantic import BaseModel, Field


class MfHolding(BaseModel):
    scheme_code: str
    nav: float
    nav_date: str
    last_fetched_at: int


class MfStatusResponse(BaseModel):
    last_refresh_at: Optional[int] = None
    next_refresh_after: Optional[int] = None
    is_refreshing: bool = False
    holdings: List[MfHolding] = Field(default_factory=list)


class MfRefreshFailedItem(BaseModel):
    scheme_code: str
    reason: str


class MfRefreshResponse(BaseModel):
    refreshed: int
    failed: List[MfRefreshFailedItem] = Field(default_factory=list)
    skipped: int = 0
    started_at: int
    duration_ms: int


class RefreshRequest(BaseModel):
    """POST body for /api/mf/refresh."""
    codes: List[str] = Field(default_factory=list)


class CodesPayload(BaseModel):
    """POST body for /api/mf/codes — frontend posts the user's amfi code list
    so the scheduler knows what to refresh. Empty array clears the list."""
    codes: List[str] = Field(default_factory=list)
