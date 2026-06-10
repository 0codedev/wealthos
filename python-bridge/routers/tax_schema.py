"""Pydantic v2 schemas for /api/tax/* (CC54)."""
from typing import List, Optional
from pydantic import BaseModel, Field


class TaxTx(BaseModel):
    """One closed MF position. Mirrors mf_realized_txns."""
    id: str
    scheme_code: str
    folio: Optional[str] = None
    asset_class: str = "EQUITY"  # EQUITY | DEBT | HYBRID
    units: float
    buy_date: str  # YYYY-MM-DD
    buy_nav: Optional[float] = None  # if None, looked up from mf_nav_history
    sell_date: str  # YYYY-MM-DD
    sell_nav: float
    owner: Optional[str] = None


class TaxComputeRequest(BaseModel):
    fy_label: str = Field(..., description="e.g. 'FY2025-26'")
    txns: List[TaxTx] = Field(default_factory=list)


class PerSchemeTaxEntry(BaseModel):
    scheme_code: str
    asset_class: str
    category: str  # STCG | LTCG
    gain: float
    holding_months: int
    buy_date: str
    sell_date: str
    units: float
    buy_nav: float
    sell_nav: float
    exemption_applied: float = 0.0
    taxable_gain: float = 0.0
    txn_id: Optional[str] = None


class TaxComputeResponse(BaseModel):
    fy_label: str
    stcg_total: float
    ltcg_total: float
    stcg_taxable: float
    ltcg_taxable: float
    ltcg_exemption_applied: float
    stcg_tax_estimated: float
    ltcg_tax_estimated: float
    per_scheme: List[PerSchemeTaxEntry] = Field(default_factory=list)


class TaxTxUpsertRequest(BaseModel):
    """One txn to insert/update in mf_realized_txns."""
    id: str
    scheme_code: str
    folio: Optional[str] = None
    asset_class: str = "EQUITY"
    units: float
    buy_date: str
    buy_nav: Optional[float] = None
    sell_date: str
    sell_nav: float
    owner: Optional[str] = None


class TaxTxListResponse(BaseModel):
    txns: List[TaxTx] = Field(default_factory=list)
