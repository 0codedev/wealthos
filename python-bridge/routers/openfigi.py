"""router/openfigi.py — ISIN / CUSIP / ticker → symbol resolver via OpenFIGI.

GET  /api/openfigi/search?q=INE002A01018        → resolve one identifier
POST /api/openfigi/search   body: {"queries": [...]} → batch lookup

OpenFIGI is free, no auth required (slow throttle), MIT-style license terms.
Docs: https://www.openfigi.com/api
"""
import os
import sys
import time
import json
from typing import List, Optional, Dict, Any
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

router = APIRouter(prefix="/api/openfigi", tags=["openfigi"])

_OPENFIGI_URL = "https://api.openfigi.com/v3/mapping"

# In-memory cache: (id_type|value) → {result, ts}. 24h TTL.
_CACHE: Dict[str, Dict[str, Any]] = {}
_CACHE_TTL_SEC = 24 * 60 * 60

# Map our internal id types → OpenFIGI idType strings
_ID_TYPE_MAP = {
    "ISIN": "ID_ISIN",
    "CUSIP": "ID_CUSIP",
    "SEDOL": "ID_SEDOL",
    "TICKER": "TICKER",
    "EXCHANGE_TICKER": "TICKER",
}


def _cache_get(key: str):
    entry = _CACHE.get(key)
    if not entry:
        return None
    if time.time() - entry["ts"] > _CACHE_TTL_SEC:
        _CACHE.pop(key, None)
        return None
    return entry["result"]


def _cache_put(key: str, result):
    _CACHE[key] = {"result": result, "ts": time.time()}


def _post_openfigi(payload: List[Dict[str, Any]]) -> List[Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urlrequest.Request(
        _OPENFIGI_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            # polite UA; helps when someone eventually adds an API key
            "User-Agent": "WealthDashboardv2/2.0 (openfigi-bridge)",
        },
        method="POST",
    )
    try:
        with urlrequest.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except HTTPError as e:
        # OpenFIGI returns 400/429 with structured error payloads — bubble them up
        try:
            detail = e.read().decode("utf-8")
        except Exception:
            detail = str(e)
        raise HTTPException(status_code=e.code, detail=f"OpenFIGI: {detail}")
    except URLError as e:
        raise HTTPException(status_code=502, detail=f"OpenFIGI unreachable: {e}")


class SearchQuery(BaseModel):
    value: str = Field(..., min_length=1, max_length=32)
    id_type: str = Field(default="ISIN", description="ISIN|CUSIP|SEDOL|TICKER")
    exchange_code: Optional[str] = Field(default=None, description="e.g. NS (NSE), US")


class BatchRequest(BaseModel):
    queries: List[SearchQuery]


@router.get("/search")
def get_search(
    q: str = Query(..., min_length=1, max_length=32),
    id_type: str = Query(default="ISIN", description="ISIN|CUSIP|SEDOL|TICKER"),
    exchange_code: Optional[str] = Query(default=None, description="e.g. NS"),
):
    """Resolve a single identifier. Cached 24h."""
    id_type_norm = id_type.upper()
    if id_type_norm not in _ID_TYPE_MAP:
        raise HTTPException(status_code=400, detail=f"Unsupported id_type: {id_type_norm}")
    figi_type = _ID_TYPE_MAP[id_type_norm]
    cache_key = f"{figi_type}|{q.upper()}|{(exchange_code or '').upper()}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return {"hits": cached, "cached": True}

    payload: Dict[str, Any] = {"idType": figi_type, "idValue": q}
    if exchange_code:
        payload["exchCode"] = exchange_code.upper()

    raw = _post_openfigi([payload])
    hits = raw[0].get("data", []) if raw and isinstance(raw, list) else []
    _cache_put(cache_key, hits)
    return {"hits": hits, "cached": False}


@router.post("/search")
def post_search(req: BatchRequest):
    """Batch resolve up to 25 identifiers (OpenFIGI per-call cap)."""
    if not req.queries:
        return {"results": []}
    if len(req.queries) > 25:
        raise HTTPException(status_code=400, detail="OpenFIGI allows max 25 per call")

    payload_list = []
    for q in req.queries:
        figi_type = _ID_TYPE_MAP.get(q.id_type.upper())
        if not figi_type:
            continue
        item: Dict[str, Any] = {"idType": figi_type, "idValue": q.value}
        if q.exchange_code:
            item["exchCode"] = q.exchange_code.upper()
        payload_list.append(item)

    raw = _post_openfigi(payload_list)
    out_results = []
    for idx, raw_item in enumerate(raw or []):
        out_results.append({
            "query_index": idx,
            "hits": raw_item.get("data", []) if isinstance(raw_item, dict) else [],
            "error": raw_item.get("error") if isinstance(raw_item, dict) else "bad_response",
        })
    return {"results": out_results}
