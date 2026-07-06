"""Unit tests for tax_service (CC54)."""
import time
import sqlite3
from datetime import date, timedelta

import pytest

from db_stabilized import _ensure_mf_tables


@pytest.fixture
def fresh_db():
    """In-memory SQLite with MF tables bootstrapped (for NAV history lookups)."""
    conn = sqlite3.connect(":memory:")
    _ensure_mf_tables(conn)
    yield conn
    conn.close()


# --- helpers ---

def _seed_nav_history(db, scheme_code: str, history: dict):
    """history: { 'YYYY-MM-DD': nav, ... } — populates mf_nav_history."""
    rows = [(scheme_code, d, float(n), int(time.time())) for d, n in history.items()]
    db.executemany(
        "INSERT INTO mf_nav_history (scheme_code, date, nav, fetched_at) VALUES (?, ?, ?, ?)",
        rows,
    )
    db.commit()


def _seed_latest(db, scheme_code: str, nav: float, nav_date: str = "2026-03-31"):
    db.execute(
        "INSERT OR REPLACE INTO mf_nav_latest (scheme_code, nav, date, last_fetched_at) "
        "VALUES (?, ?, ?, ?)",
        (scheme_code, nav, nav_date, int(time.time())),
    )
    db.commit()


def _realized(
    scheme_code: str,
    units_sold: float,
    sell_nav: float,
    sell_date: str,
    buy_date: str,
    buy_nav: float,
    asset_class: str = "EQUITY",
    folio_id: str = "F1",
    txn_id: str = "T1",
) -> dict:
    """Build a realized-transaction dict. Used for cost basis + holding period."""
    return {
        "id": txn_id,
        "schemeCode": scheme_code,
        "amfiCode": scheme_code,
        "folio": folio_id,
        "assetClass": asset_class,
        "units": units_sold,
        "sellNav": sell_nav,
        "sellDate": sell_date,
        "buyDate": buy_date,
        "buyNav": buy_nav,
    }


# --- tests ---


def test_cost_basis_from_nav_history(fresh_db):
    """For a buy on 2025-01-15, cost-basis NAV should come from mf_nav_history for that date."""
    from services import tax_service
    tax_service._set_db(fresh_db)
    # Make the test DB use the context-manager-style get_connection
    import db_stabilized
    original_get_connection = db_stabilized.get_connection
    db_stabilized.get_connection = lambda: _use(fresh_db)
    try:
        _seed_nav_history(fresh_db, "119597", {
            "2025-01-15": 100.0,
            "2025-06-15": 110.0,
        })
        cb = tax_service.get_buy_nav("119597", "2025-01-15")
        assert cb == 100.0
    finally:
        db_stabilized.get_connection = original_get_connection


def _use(conn):
    """Context-manager-compatible wrapper for an existing connection."""
    from contextlib import contextmanager
    @contextmanager
    def cm():
        yield conn
    return cm()


def test_cost_basis_falls_back_to_nearest_prior_date(fresh_db):
    """If buy date has no NAV (holiday/weekend), use the most recent prior date."""
    from services import tax_service
    tax_service._set_db(fresh_db)
    import db_stabilized
    original_get_connection = db_stabilized.get_connection
    db_stabilized.get_connection = lambda: _use(fresh_db)
    try:
        _seed_nav_history(fresh_db, "119597", {
            "2025-01-15": 100.0,
        })
        # 2025-01-16 is a buy date; no NAV that day → use 2025-01-15
        cb = tax_service.get_buy_nav("119597", "2025-01-16")
        assert cb == 100.0
    finally:
        db_stabilized.get_connection = original_get_connection


def test_equity_short_term_capital_gains(fresh_db):
    """Equity MF held ≤12 months → STCG at 15%."""
    from services import tax_service
    tax_service._set_db(fresh_db)

    _seed_nav_history(fresh_db, "119597", {
        "2025-01-15": 100.0,
    })
    # sell 100 units, 6 months later, NAV went from 100 → 150
    txns = [_realized("119597", 100, 150, "2025-07-15", "2025-01-15", 100.0)]
    result = tax_service.compute_capital_gains(txns, fy_label="FY2025-26")
    assert result["stcg_total"] == 5000.0  # 100 * (150-100)
    assert result["stcg_taxable"] == 5000.0
    assert result["stcg_tax_estimated"] == pytest.approx(5000.0 * 0.15)  # 15%
    assert result["ltcg_total"] == 0.0
    assert len(result["per_scheme"]) == 1
    assert result["per_scheme"][0]["scheme_code"] == "119597"
    assert result["per_scheme"][0]["category"] == "STCG"


def test_equity_long_term_capital_gains(fresh_db):
    """Equity MF held >12 months → LTCG at 12.5% (after ₹1.25L exemption)."""
    from services import tax_service
    tax_service._set_db(fresh_db)

    _seed_nav_history(fresh_db, "119597", {
        "2024-01-15": 100.0,
    })
    # sell 1000 units, 14 months later, NAV went 100 → 200 = ₹1L gain
    txns = [_realized("119597", 1000, 200, "2025-03-20", "2024-01-15", 100.0)]
    result = tax_service.compute_capital_gains(txns, fy_label="FY2025-26")
    # 1000 * (200-100) = ₹1,00,000 → below ₹1.25L exemption → no tax
    assert result["ltcg_total"] == 100000.0
    assert result["ltcg_exemption_applied"] == 100000.0
    assert result["ltcg_taxable"] == 0.0
    assert result["ltcg_tax_estimated"] == 0.0


def test_equity_ltcg_above_exemption(fresh_db):
    """LTCG above ₹1.25L exemption → only the excess is taxed at 12.5%."""
    from services import tax_service
    tax_service._set_db(fresh_db)

    _seed_nav_history(fresh_db, "119597", {"2024-01-15": 100.0})
    # 2000 units, NAV 100 → 200 = ₹2L gain (₹75K over exemption)
    txns = [_realized("119597", 2000, 200, "2025-03-20", "2024-01-15", 100.0)]
    result = tax_service.compute_capital_gains(txns, fy_label="FY2025-26")
    assert result["ltcg_total"] == 200000.0
    assert result["ltcg_exemption_applied"] == 125000.0
    assert result["ltcg_taxable"] == 75000.0
    assert result["ltcg_tax_estimated"] == pytest.approx(75000.0 * 0.125)


def test_debt_labeled_not_slabbed(fresh_db):
    """Debt MF: computed but tax NOT auto-estimated (slab depends on user income)."""
    from services import tax_service
    tax_service._set_db(fresh_db)

    _seed_nav_history(fresh_db, "DEBT1", {"2024-01-15": 100.0})
    # Debt held 18 months (STCG for debt is ≤36 months)
    txns = [_realized("DEBT1", 100, 110, "2025-07-15", "2024-01-15", 100.0, asset_class="DEBT")]
    result = tax_service.compute_capital_gains(txns, fy_label="FY2025-26")
    assert result["stcg_total"] == 1000.0
    # Debt is labeled but not slabbed
    assert result["stcg_tax_estimated"] == 0.0
    assert any(s["category"] == "STCG" and s["asset_class"] == "DEBT" for s in result["per_scheme"])


def test_no_transactions_returns_zero_payload(fresh_db):
    """Empty txn list → all-zero summary, not an error."""
    from services import tax_service
    tax_service._set_db(fresh_db)
    result = tax_service.compute_capital_gains([], fy_label="FY2025-26")
    assert result["stcg_total"] == 0.0
    assert result["ltcg_total"] == 0.0
    assert result["per_scheme"] == []
    assert result["fy_label"] == "FY2025-26"


def test_mixed_scheme_aggregation(fresh_db):
    """Multiple schemes + categories → per-scheme breakdown + correct totals."""
    from services import tax_service
    tax_service._set_db(fresh_db)

    _seed_nav_history(fresh_db, "EQ1", {"2025-01-15": 100.0})
    _seed_nav_history(fresh_db, "EQ2", {"2024-01-15": 100.0})
    _seed_nav_history(fresh_db, "DEBT1", {"2024-01-15": 100.0})

    txns = [
        _realized("EQ1", 100, 120, "2025-07-15", "2025-01-15", 100.0, txn_id="t1"),
        _realized("EQ2", 200, 250, "2025-03-20", "2024-01-15", 100.0, txn_id="t2"),
        _realized("DEBT1", 50, 60, "2025-07-15", "2024-01-15", 100.0, asset_class="DEBT", txn_id="t3"),
    ]
    result = tax_service.compute_capital_gains(txns, fy_label="FY2025-26")

    # EQ1: 100 * (120-100) = 2000 STCG
    # EQ2: 200 * (250-100) = 30000 LTCG
    # DEBT1: 50 * (60-100) = -2000 STCG (loss)
    assert result["stcg_total"] == pytest.approx(2000.0 + (-2000.0))  # = 0
    assert result["ltcg_total"] == 30000.0
    assert len(result["per_scheme"]) == 3
    eq1 = next(s for s in result["per_scheme"] if s["scheme_code"] == "EQ1")
    assert eq1["category"] == "STCG" and eq1["gain"] == 2000.0
    eq2 = next(s for s in result["per_scheme"] if s["scheme_code"] == "EQ2")
    assert eq2["category"] == "LTCG" and eq2["gain"] == 30000.0
