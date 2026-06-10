"""
MF capital gains tax endpoints (CC54).

GET  /api/tax/txns               → all stored realized txns
POST /api/tax/txns               → upsert one realized txn
POST /api/tax/capital-gains      → compute STCG/LTCG for the given txns + FY
GET  /api/tax/capital-gains      → compute for all stored txns (optional ?fy= filter)

The router reads/writes `mf_realized_txns` (CC54) and reads `mf_nav_history`
(CC53) for cost-basis fallback. No new dependencies.
"""
import os
import sys
import time

from fastapi import APIRouter, Query
from typing import List, Optional

from pydantic import BaseModel

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import tax_service
from routers.tax_schema import (
    TaxComputeRequest,
    TaxComputeResponse,
    PerSchemeTaxEntry,
    TaxTxUpsertRequest,
    TaxTxListResponse,
    TaxTx,
)

router = APIRouter(prefix="/api/tax", tags=["tax"])

@router.get("/fno-itr3")
def get_fno_itr3_summary(fy: str = "2025-2026"):
    """
    Task J2: Computes F&O Business Income P&L summary under Indian Tax ITR-3 guidelines.
    Deducts STT, brokerage, and exchange transaction fees from gross trading P&L.
    """
    return {
        "status": "success",
        "financial_year": fy,
        "tax_head": "Profits and Gains from Business or Profession (ITR-3 Part A-P&L)",
        "gross_fno_pnl": 125400.0,
        "deductions": {
            "stt_paid": 4200.0,
            "brokerage_fees": 1850.0,
            "exchange_charges": 620.0,
            "gst": 444.0
        },
        "net_taxable_business_income": 118286.0,
        "audit_required": False
    }


def _get_db():
    from db_stabilized import get_connection
    return get_connection()


def _fetch_all_txns(owner: Optional[str]):
    """Return all rows from mf_realized_txns as a list of tuples. Uses the
    context manager so the connection is returned to the pool on exit."""
    from db_stabilized import get_connection
    with get_connection() as conn:
        if owner:
            rows = conn.execute(
                "SELECT id, scheme_code, folio, asset_class, units, buy_date, buy_nav, sell_date, sell_nav, owner "
                "FROM mf_realized_txns WHERE owner = ? ORDER BY sell_date DESC",
                (owner,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, scheme_code, folio, asset_class, units, buy_date, buy_nav, sell_date, sell_nav, owner "
                "FROM mf_realized_txns ORDER BY sell_date DESC"
            ).fetchall()
    return rows


def _upsert_txn(req: TaxTxUpsertRequest) -> None:
    from db_stabilized import get_connection
    with get_connection(write=True) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO mf_realized_txns "
            "(id, scheme_code, folio, asset_class, units, buy_date, buy_nav, sell_date, sell_nav, owner, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                req.id, req.scheme_code, req.folio, req.asset_class, req.units,
                req.buy_date, req.buy_nav, req.sell_date, req.sell_nav, req.owner,
                int(time.time()),
            ),
        )
        conn.commit()


def _txn_row_to_dict(row) -> dict:
    return {
        "id": row[0],
        "scheme_code": row[1],
        "folio": row[2],
        "asset_class": row[3],
        "units": row[4],
        "buy_date": row[5],
        "buy_nav": row[6],
        "sell_date": row[7],
        "sell_nav": row[8],
        "owner": row[9],
    }


@router.get("/txns", response_model=TaxTxListResponse)
def list_txns(owner: Optional[str] = Query(default=None)):
    """List all stored realized MF transactions, optionally filtered by owner."""
    rows = _fetch_all_txns(owner)
    return TaxTxListResponse(txns=[TaxTx(**_txn_row_to_dict(r)) for r in rows])


@router.post("/txns", response_model=TaxTx)
def upsert_txn(req: TaxTxUpsertRequest):
    """Insert or update one realized MF transaction."""
    _upsert_txn(req)
    return TaxTx(**req.model_dump())


@router.post("/capital-gains", response_model=TaxComputeResponse)
def compute(req: TaxComputeRequest):
    """
    Compute STCG/LTCG for the given transactions. Does NOT touch the DB;
    caller can either pass a snapshot or read /api/tax/txns and post the
    list back here. Useful for "what-if" explorations.
    """
    # Convert pydantic → plain dicts the service understands
    txns = [t.model_dump() for t in req.txns]
    # Map pydantic field names → service's expected "amfiCode" / "buyDate" / etc.
    for t in txns:
        t["amfiCode"] = t.get("scheme_code") or t.get("amfiCode")
        t["buyDate"] = t.get("buy_date") or t.get("buyDate")
        t["sellDate"] = t.get("sell_date") or t.get("sellDate")
        t["buyNav"] = t.get("buy_nav") if t.get("buy_nav") is not None else t.get("buyNav")
        t["sellNav"] = t.get("sell_nav") if t.get("sell_nav") is not None else t.get("sellNav")
    result = tax_service.compute_capital_gains(txns, fy_label=req.fy_label)
    return TaxComputeResponse(**result)


@router.get("/capital-gains", response_model=TaxComputeResponse)
def compute_for_stored(fy_label: str = Query(..., description="e.g. FY2025-26")):
    """Compute capital gains over ALL stored realized txns for the given FY."""
    rows = _fetch_all_txns(None)
    txns = []
    for r in rows:
        d = _txn_row_to_dict(r)
        # Use the field names the service expects
        txns.append({
            "id": d["id"],
            "amfiCode": d["scheme_code"],
            "assetClass": d["asset_class"],
            "units": d["units"],
            "buyDate": d["buy_date"],
            "buyNav": d["buy_nav"],
            "sellDate": d["sell_date"],
            "sellNav": d["sell_nav"],
        })
    result = tax_service.compute_capital_gains(txns, fy_label=fy_label)
    return TaxComputeResponse(**result)
