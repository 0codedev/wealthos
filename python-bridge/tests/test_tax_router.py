"""Integration tests for /api/tax/* (CC54)."""
import time
import sqlite3
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client_with_fresh_db():
    """TestClient with a fresh in-memory DB and MF tables bootstrapped.

    The DB file is a real on-disk file (not :memory:) because db_stabilized
    uses its own connection pool which opens fresh connections per request —
    :memory: connections are not shared across connections, so writes from
    the test fixture wouldn't be visible inside the request handler.
    """
    import os
    import tempfile
    from db_stabilized import _ensure_mf_tables, DB_FILE

    # Point the pool at a fresh file for this test
    tmpdir = tempfile.mkdtemp()
    test_db = os.path.join(tmpdir, "test_cache.db")
    import db_stabilized
    original_db_file = db_stabilized.DB_FILE
    db_stabilized.DB_FILE = test_db
    db_stabilized._POOL = type(db_stabilized._POOL)(maxsize=20)

    try:
        with db_stabilized.get_connection(write=True) as conn:
            _ensure_mf_tables(conn)
            # Seed one realized txn
            conn.execute(
                "INSERT INTO mf_realized_txns (id, scheme_code, asset_class, units, buy_date, sell_date, sell_nav, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ("T1", "119597", "EQUITY", 100, "2025-01-15", "2025-07-15", 150.0, int(time.time())),
            )
            # Seed the buy NAV so cost-basis fallback works
            conn.execute(
                "INSERT INTO mf_nav_history (scheme_code, date, nav, fetched_at) VALUES (?, ?, ?, ?)",
                ("119597", "2025-01-15", 100.0, int(time.time())),
            )
            conn.commit()

        from app import app
        yield TestClient(app)
    finally:
        # Restore original DB file path and clean up the temp DB
        db_stabilized.DB_FILE = original_db_file
        db_stabilized._POOL = type(db_stabilized._POOL)(maxsize=20)
        try:
            os.remove(test_db)
        except OSError:
            pass
        try:
            os.rmdir(tmpdir)
        except OSError:
            pass


def test_list_txns_returns_seeded_row(client_with_fresh_db):
    """GET /api/tax/txns returns the seeded txn."""
    r = client_with_fresh_db.get("/api/tax/txns")
    assert r.status_code == 200
    body = r.json()
    assert len(body["txns"]) == 1
    assert body["txns"][0]["scheme_code"] == "119597"
    assert body["txns"][0]["units"] == 100


def test_post_capital_gains_equity_stcg(client_with_fresh_db):
    """POST /api/tax/capital-gains with one equity txn → STCG ₹5000, 15% tax."""
    body = {
        "fy_label": "FY2025-26",
        "txns": [
            {
                "id": "T_compute",
                "scheme_code": "119597",
                "asset_class": "EQUITY",
                "units": 100,
                "buy_date": "2025-01-15",
                "buy_nav": 100.0,
                "sell_date": "2025-07-15",
                "sell_nav": 150.0,
            }
        ],
    }
    r = client_with_fresh_db.post("/api/tax/capital-gains", json=body)
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["stcg_total"] == 5000.0, f"got {result}"
    assert result["stcg_tax_estimated"] == 750.0  # 15% of 5000
    assert result["ltcg_total"] == 0.0


def test_get_capital_gains_for_stored(client_with_fresh_db):
    """GET /api/tax/capital-gains?fy_label=... uses stored txns."""
    # Seed NAV so cost-basis fallback works (already seeded for 2025-01-15)
    r = client_with_fresh_db.get("/api/tax/capital-gains?fy_label=FY2025-26")
    assert r.status_code == 200
    result = r.json()
    # Our seed txn has no buy_nav, so the service falls back to mf_nav_history (100.0)
    assert result["stcg_total"] == 5000.0
    assert result["fy_label"] == "FY2025-26"


def test_upsert_txn_then_list(client_with_fresh_db):
    """POST /api/tax/txns inserts a new txn, GET /api/tax/txns returns it."""
    body = {
        "id": "T2",
        "scheme_code": "120503",
        "asset_class": "EQUITY",
        "units": 50,
        "buy_date": "2024-01-15",
        "buy_nav": 200.0,
        "sell_date": "2026-01-15",
        "sell_nav": 300.0,
    }
    r = client_with_fresh_db.post("/api/tax/txns", json=body)
    assert r.status_code == 200
    assert r.json()["scheme_code"] == "120503"

    r2 = client_with_fresh_db.get("/api/tax/txns")
    assert r2.status_code == 200
    codes = {t["scheme_code"] for t in r2.json()["txns"]}
    assert codes == {"119597", "120503"}
