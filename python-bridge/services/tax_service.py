"""
MF capital gains tax service (CC54).

Indian tax rules (FY2025-26 / Union Budget 2024 changes):
- Equity MF STCG (held ≤12 months): 15%
- Equity MF LTCG (held >12 months): 12.5% on amount above ₹1,25,000 exemption
- Debt MF: gains computed but tax not auto-estimated (depends on user's slab)

Inputs: a list of "realized" transactions (closed positions). Each txn has a
buy date + buy NAV and a sell date + sell NAV. We source NAVs from the
existing `mf_nav_history` cache (CC53) — no new tables, no new dependencies.

Outputs: a summary dict with totals, taxable amounts, and per-scheme
breakdown ready to render in the UI.
"""
import os
import sys
import time
import sqlite3
from datetime import date
from typing import List, Dict, Any, Optional

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Indian tax constants (FY2025-26, post-Budget 2024)
EQUITY_STCG_RATE = 0.15
EQUITY_LTCG_RATE = 0.125
EQUITY_LTCG_EXEMPTION = 125_000.0
EQUITY_HOLDING_MONTHS = 12
DEBT_HOLDING_MONTHS = 36

# --- module-level state (overridden in tests via _set_db) ---
_db_conn = None


def _set_db(conn):
    """Test hook: inject a custom DB connection (e.g. :memory:)."""
    global _db_conn
    _db_conn = conn


def _get_db():
    if _db_conn is not None:
        return _db_conn
    from db_stabilized import get_connection
    return get_connection()


# --- NAV lookup ---

def get_buy_nav(scheme_code: str, buy_date: str) -> Optional[float]:
    """
    Return the NAV for `scheme_code` on `buy_date` (YYYY-MM-DD).
    If no NAV for the exact date, fall back to the most recent prior date.
    Returns None if mf_nav_history has no entries for this scheme.
    """
    from db_stabilized import get_connection
    with get_connection() as conn:
        row = conn.execute(
            "SELECT nav FROM mf_nav_history "
            "WHERE scheme_code = ? AND date <= ? "
            "ORDER BY date DESC LIMIT 1",
            (scheme_code, buy_date),
        ).fetchone()
    return float(row[0]) if row else None


# --- holding period ---

def _months_between(start_iso: str, end_iso: str) -> int:
    """Whole calendar months between two YYYY-MM-DD dates."""
    s = date.fromisoformat(start_iso)
    e = date.fromisoformat(end_iso)
    return (e.year - s.year) * 12 + (e.month - s.month)


# --- main entry point ---

def compute_capital_gains(realized_txns: List[Dict[str, Any]], fy_label: str) -> Dict[str, Any]:
    """
    Compute STCG + LTCG from a list of realized transactions.

    Each txn dict has: amfiCode/schemeCode, assetClass, units, buyDate, buyNav,
    sellDate, sellNav. We prefer the txn's own buyNav if present; otherwise we
    fall back to mf_nav_history.

    Returns: {
      fy_label, stcg_total, ltcg_total,
      stcg_taxable, ltcg_taxable, ltcg_exemption_applied,
      stcg_tax_estimated, ltcg_tax_estimated,
      per_scheme: [{ scheme_code, scheme_name?, asset_class, category, gain, holding_months, txn_id }]
    }
    """
    per_scheme: List[Dict[str, Any]] = []
    stcg_total = 0.0
    ltcg_total = 0.0

    for txn in realized_txns:
        amfi = txn.get("amfiCode") or txn.get("schemeCode")
        if not amfi:
            continue
        asset_class = (txn.get("assetClass") or "EQUITY").upper()
        units = float(txn.get("units") or 0)
        if units <= 0:
            continue
        buy_date = txn.get("buyDate")
        sell_date = txn.get("sellDate")
        if not buy_date or not sell_date:
            continue
        buy_nav = txn.get("buyNav")
        if buy_nav is None:
            buy_nav = get_buy_nav(amfi, buy_date)
        if buy_nav is None or buy_nav <= 0:
            continue
        sell_nav = float(txn.get("sellNav") or 0)
        if sell_nav <= 0:
            continue

        gain = units * (sell_nav - float(buy_nav))
        holding_months = _months_between(buy_date, sell_date)

        if asset_class == "EQUITY":
            category = "STCG" if holding_months <= EQUITY_HOLDING_MONTHS else "LTCG"
        else:  # DEBT or HYBRID
            category = "STCG" if holding_months <= DEBT_HOLDING_MONTHS else "LTCG"

        per_scheme.append({
            "scheme_code": amfi,
            "asset_class": asset_class,
            "category": category,
            "gain": round(gain, 2),
            "holding_months": holding_months,
            "buy_date": buy_date,
            "sell_date": sell_date,
            "units": units,
            "buy_nav": float(buy_nav),
            "sell_nav": sell_nav,
            "txn_id": txn.get("id"),
        })

        if category == "STCG":
            stcg_total += gain
        else:
            ltcg_total += gain

    # Apply equity LTCG exemption: first ₹1,25,000 of LTCG is tax-free.
    # Losses reduce the taxable amount (we don't carry-forward for v1, just floor at 0).
    ltcg_exemption_applied = 0.0
    ltcg_taxable = ltcg_total
    if ltcg_total > 0:
        ltcg_exemption_applied = min(EQUITY_LTCG_EXEMPTION, ltcg_total)
        ltcg_taxable = max(0.0, ltcg_total - EQUITY_LTCG_EXEMPTION)
    elif ltcg_total < 0:
        # Loss: tax-free, no exemption applied
        ltcg_taxable = ltcg_total

    stcg_taxable = stcg_total

    # Tax estimates: only for equity. Debt is labeled but not auto-taxed.
    equity_stcg = sum(s["gain"] for s in per_scheme if s["category"] == "STCG" and s["asset_class"] == "EQUITY")
    equity_ltcg_taxable = sum(
        s["gain"] for s in per_scheme
        if s["category"] == "LTCG" and s["asset_class"] == "EQUITY"
    )
    # For multi-scheme equity LTCG, scale the per-scheme gains so the taxable total
    # is proportional to each scheme's contribution.
    equity_ltcg_gross = sum(
        s["gain"] for s in per_scheme
        if s["category"] == "LTCG" and s["asset_class"] == "EQUITY" and s["gain"] > 0
    )
    if equity_ltcg_gross > 0:
        # Distribute the ₹1.25L exemption pro-rata across positive equity LTCG
        remaining_exemption = EQUITY_LTCG_EXEMPTION
        for s in per_scheme:
            if s["category"] == "LTCG" and s["asset_class"] == "EQUITY" and s["gain"] > 0:
                share = (s["gain"] / equity_ltcg_gross) * EQUITY_LTCG_EXEMPTION
                applied = min(share, s["gain"])
                s["exemption_applied"] = round(applied, 2)
                s["taxable_gain"] = round(s["gain"] - applied, 2)
                remaining_exemption -= applied
            elif s["category"] == "LTCG" and s["asset_class"] == "EQUITY" and s["gain"] <= 0:
                s["exemption_applied"] = 0.0
                s["taxable_gain"] = s["gain"]
            else:
                s["exemption_applied"] = 0.0
                s["taxable_gain"] = s["gain"]
    else:
        for s in per_scheme:
            s["exemption_applied"] = 0.0
            s["taxable_gain"] = s["gain"]

    stcg_tax_estimated = max(0.0, equity_stcg) * EQUITY_STCG_RATE
    ltcg_tax_estimated = max(0.0, ltcg_taxable if equity_ltcg_gross > 0 else 0.0) * EQUITY_LTCG_RATE

    return {
        "fy_label": fy_label,
        "stcg_total": round(stcg_total, 2),
        "ltcg_total": round(ltcg_total, 2),
        "stcg_taxable": round(stcg_taxable, 2),
        "ltcg_taxable": round(ltcg_taxable, 2),
        "ltcg_exemption_applied": round(ltcg_exemption_applied, 2),
        "stcg_tax_estimated": round(stcg_tax_estimated, 2),
        "ltcg_tax_estimated": round(ltcg_tax_estimated, 2),
        "per_scheme": per_scheme,
    }
