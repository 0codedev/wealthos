"""Integration tests for /api/mf/* (CC53)."""
import time
import asyncio
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


@pytest.fixture
def client_with_fresh_db():
    """TestClient with a fresh in-memory DB and MF tables bootstrapped."""
    import sqlite3
    from db_stabilized import _ensure_mf_tables
    from services import mf_nav_service

    # check_same_thread=False so the FastAPI worker thread can reuse the
    # same in-memory connection that the test fixture set up in the main
    # thread. Safe in tests; production code uses db_stabilized.get_connection()
    # which has its own connection pool.
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    _ensure_mf_tables(conn)
    mf_nav_service._set_db(conn)
    mf_nav_service._breaker_state.clear()

    # Seed: one cached scheme, last refresh 1h ago
    conn.execute(
        "INSERT OR REPLACE INTO mf_nav_latest (scheme_code, nav, date, last_fetched_at) "
        "VALUES (?, ?, ?, ?)",
        ("119597", 502.31, "2026-06-16", int(time.time()) - 3600),
    )
    conn.execute(
        "INSERT OR REPLACE INTO mf_refresh_state (key, value) VALUES ('last_refresh_at', ?)",
        (str(int(time.time()) - 3600),),
    )
    conn.commit()

    from app import app
    return TestClient(app)


def test_status_returns_cached_holding(client_with_fresh_db):
    """GET /api/mf/status?codes=119597 returns the cached NAV + state."""
    r = client_with_fresh_db.get("/api/mf/status?codes=119597")
    assert r.status_code == 200
    body = r.json()
    assert body["is_refreshing"] is False
    assert body["last_refresh_at"] is not None
    assert len(body["holdings"]) == 1
    assert body["holdings"][0]["scheme_code"] == "119597"
    assert body["holdings"][0]["nav"] == 502.31
    assert body["holdings"][0]["nav_date"] == "2026-06-16"


def test_status_with_no_codes_returns_empty(client_with_fresh_db):
    """GET /api/mf/status with no codes returns empty holdings, not an error."""
    r = client_with_fresh_db.get("/api/mf/status")
    assert r.status_code == 200
    body = r.json()
    assert body["holdings"] == []
    assert body["last_refresh_at"] is not None  # we seeded one
    assert body["is_refreshing"] is False


def test_refresh_returns_202_with_summary(client_with_fresh_db):
    """POST /api/mf/refresh with codes in body returns 202 + summary."""
    fake_summary = {
        "refreshed": 2, "failed": [], "skipped": 0, "duration_ms": 50,
    }

    async def fake_refresh(codes):
        return fake_summary

    with patch("routers.mf.mf_nav_service.refresh_all_async", side_effect=fake_refresh):
        r = client_with_fresh_db.post("/api/mf/refresh", json={"codes": ["119597", "120503"]})

    assert r.status_code == 202
    body = r.json()
    assert body["refreshed"] == 2
    assert body["failed"] == []
    assert body["skipped"] == 0


def test_refresh_idempotent_while_in_flight(client_with_fresh_db):
    """Two concurrent POSTs → second is a no-op (returns 0 refreshed)."""
    import routers.mf as mf_router_mod
    mf_router_mod._in_flight = True
    try:
        r = client_with_fresh_db.post("/api/mf/refresh", json={"codes": ["119597"]})
        assert r.status_code == 202
        body = r.json()
        assert body["refreshed"] == 0
        assert body["skipped"] == 0
    finally:
        mf_router_mod._in_flight = False


def test_post_codes_persists_user_codes(client_with_fresh_db):
    """POST /api/mf/codes → 204 + mf_refresh_state.user_codes is JSON-encoded list."""
    r = client_with_fresh_db.post("/api/mf/codes", json={"codes": ["119597", "120503"]})
    assert r.status_code == 204
    assert r.text == ""  # 204 has no body

    # Verify the service-level readback.
    from services import mf_nav_service
    assert mf_nav_service.get_amfi_codes() == ["119597", "120503"]


def test_post_codes_with_empty_list_clears(client_with_fresh_db):
    """POST /api/mf/codes with codes=[] → user_codes persists as []. Used when user removes all MF holdings."""
    # First seed
    client_with_fresh_db.post("/api/mf/codes", json={"codes": ["119597"]})
    # Then clear
    r = client_with_fresh_db.post("/api/mf/codes", json={"codes": []})
    assert r.status_code == 204
    from services import mf_nav_service
    assert mf_nav_service.get_amfi_codes() == []
