"""router/leg_data.py — serves Dhan per-leg backfill JSON to the browser.

GET /api/leg-data/_index   → list of available day filenames
GET /api/leg-data/{date}   → one day's legs (date as YYYY-MM-DD)

The browser no longer needs a copy step into Vite's public/ folder; the
Python bridge serves them directly from data/trade_legs/.
"""

import json
import os
from datetime import date as date_cls
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/leg-data", tags=["leg-data"])

# Resolve once at import: python-bridge/data/trade_legs/
_DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "trade_legs"


@router.get("/_index")
async def list_days() -> JSONResponse:
    if not _DATA_DIR.exists():
        return JSONResponse({"days": [], "generated_at": None, "count": 0})
    days = sorted(
        p.stem for p in _DATA_DIR.glob("????-??-??.json")
        if len(p.stem) == 10
    )
    return JSONResponse({
        "days": days,
        "count": len(days),
        "data_dir": str(_DATA_DIR),
    })


@router.get("/{trade_date}")
async def get_day(trade_date: str) -> JSONResponse:
    # Validate date shape
    try:
        date_cls.fromisoformat(trade_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    fp = _DATA_DIR / f"{trade_date}.json"
    if not fp.exists():
        # Empty day is valid — return an empty legs list, not 404
        return JSONResponse({
            "date": trade_date,
            "leg_count": 0,
            "legs": [],
            "missing": True,
        })
    try:
        return JSONResponse(json.loads(fp.read_text(encoding="utf-8")))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"failed to read {trade_date}: {e}")


@router.get("")
async def list_all(request: Request) -> JSONResponse:
    """Bulk fetch — used by the bulk ingest CLI."""
    days_resp = await list_days()
    days = json.loads(days_resp.body.decode("utf-8"))["days"]
    out: list[dict] = []
    for d in days:
        fp = _DATA_DIR / f"{d}.json"
        try:
            payload = json.loads(fp.read_text(encoding="utf-8"))
            out.append({"date": d, "leg_count": payload.get("leg_count", 0), "legs": payload.get("legs", [])})
        except Exception as e:
            out.append({"date": d, "error": str(e)})
    return JSONResponse({"days": out, "count": len(out)})
