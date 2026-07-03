"""Unit tests for mf_nav_service (CC53)."""
import time
import asyncio
import httpx
import pytest
from unittest.mock import patch, MagicMock


@pytest.fixture
def fresh_db():
    """Use a fresh in-memory SQLite + call _ensure_mf_tables to create MF schema."""
    import sqlite3
    from db_stabilized import _ensure_mf_tables
    conn = sqlite3.connect(":memory:")
    _ensure_mf_tables(conn)
    yield conn
    conn.close()


def test_fetch_and_cache_scheme_happy_path(fresh_db):
    """Single mfapi.in response should populate both mf_nav_history and mf_nav_latest."""
    from services import mf_nav_service
    mf_nav_service._set_db(fresh_db)
    mf_nav_service._breaker_state.clear()

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "meta": {"scheme_code": "119597", "scheme_name": "HDFC Flexi Cap"},
        "data": [
            {"date": "2026-06-16", "nav": "502.31"},
            {"date": "2026-06-15", "nav": "500.10"},
        ],
    }

    with patch.object(mf_nav_service, "_http_get", return_value=mock_response):
        result = mf_nav_service.fetch_and_cache_scheme("119597")

    assert result["scheme_code"] == "119597"
    assert result["nav"] == 502.31
    assert result["date"] == "2026-06-16"
    assert result["error"] is None

    # Verify both tables populated
    history_rows = fresh_db.execute("SELECT scheme_code, date, nav FROM mf_nav_history ORDER BY date DESC").fetchall()
    assert history_rows == [("119597", "2026-06-16", 502.31), ("119597", "2026-06-15", 500.10)]
    latest = fresh_db.execute("SELECT nav, date FROM mf_nav_latest WHERE scheme_code='119597'").fetchone()
    assert latest == (502.31, "2026-06-16")


def test_circuit_breaker_opens_after_3_failures(fresh_db):
    """3 consecutive timeouts → is_breaker_open() returns True."""
    from services import mf_nav_service
    mf_nav_service._set_db(fresh_db)
    mf_nav_service._breaker_state.clear()

    timeout_exc = httpx.TimeoutException("timeout")
    with patch.object(mf_nav_service, "_http_get", side_effect=timeout_exc):
        for _ in range(3):
            mf_nav_service.fetch_and_cache_scheme("119597")

    assert mf_nav_service.is_breaker_open("119597") is True
    assert mf_nav_service._breaker_state["119597"] == 3


def test_concurrency_cap_is_5(fresh_db):
    """20 schemes refreshed together → never more than 5 in flight at once."""
    from services import mf_nav_service
    mf_nav_service._set_db(fresh_db)
    mf_nav_service._breaker_state.clear()

    in_flight = 0
    peak = 0

    def slow_get(url):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        time.sleep(0.05)  # hold the slot briefly
        in_flight -= 1
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {"data": [{"date": "2026-06-16", "nav": "100"}]}
        return resp

    codes = [f"12050{i}" for i in range(20)]
    with patch.object(mf_nav_service, "_http_get", side_effect=slow_get):
        # Drive the async coroutine from a sync test via asyncio.run()
        result = asyncio.run(mf_nav_service.refresh_all_async(codes))

    assert result["refreshed"] == 20
    assert result["failed"] == []
    assert peak <= 5, f"peak concurrency was {peak}, expected <= 5"


def test_partial_success_continues_batch(fresh_db):
    """One of 5 schemes fails → the other 4 still get cached."""
    from services import mf_nav_service
    mf_nav_service._set_db(fresh_db)
    mf_nav_service._breaker_state.clear()

    def flaky_get(url):
        code = url.rsplit("/", 1)[-1]
        if code == "BAD":
            raise httpx.TimeoutException("timeout")
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {"data": [{"date": "2026-06-16", "nav": "100"}]}
        return resp

    codes = ["GOOD1", "BAD", "GOOD2", "GOOD3", "GOOD4"]
    with patch.object(mf_nav_service, "_http_get", side_effect=flaky_get):
        results = [mf_nav_service.fetch_and_cache_scheme(c) for c in codes]

    assert sum(1 for r in results if r["error"] is None) == 4
    assert sum(1 for r in results if r["error"] is not None) == 1
    failed = [r for r in results if r["error"] is not None][0]
    assert failed["scheme_code"] == "BAD"


def test_is_cache_stale_never_refreshed(fresh_db):
    """If mf_refresh_state has no last_refresh_at, cache is stale."""
    from services import mf_nav_service
    mf_nav_service._set_db(fresh_db)
    assert mf_nav_service.is_cache_stale() is True


def test_is_cache_stale_fresh(fresh_db):
    """If last_refresh_at < 24h ago, cache is fresh."""
    from services import mf_nav_service
    mf_nav_service._set_db(fresh_db)
    conn = fresh_db
    conn.execute(
        "INSERT OR REPLACE INTO mf_refresh_state (key, value) VALUES ('last_refresh_at', ?)",
        (str(int(time.time()) - 3600),),  # 1h ago
    )
    conn.commit()
    assert mf_nav_service.is_cache_stale() is False


def test_is_cache_stale_old(fresh_db):
    """If last_refresh_at > 24h ago, cache is stale."""
    from services import mf_nav_service
    mf_nav_service._set_db(fresh_db)
    conn = fresh_db
    conn.execute(
        "INSERT OR REPLACE INTO mf_refresh_state (key, value) VALUES ('last_refresh_at', ?)",
        (str(int(time.time()) - 25 * 3600),),  # 25h ago
    )
    conn.commit()
    assert mf_nav_service.is_cache_stale() is True
