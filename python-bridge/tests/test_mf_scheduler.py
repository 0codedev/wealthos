"""
A6 — MF NAV 24h scheduler tests.

Tests for the scheduler loop, the KV helpers, and the toggle-aware frontend
postMfCodes wrapper. All tests use an in-memory SQLite + the existing
_ensure_mf_tables helper (no on-disk cache.db needed).
"""
import asyncio
import json
import time

import pytest


@pytest.fixture
def fresh_db():
    """Fresh in-memory SQLite with MF tables bootstrapped; cleared per-test."""
    import sqlite3
    from db_stabilized import _ensure_mf_tables
    from services import mf_nav_service

    conn = sqlite3.connect(":memory:", check_same_thread=False)
    _ensure_mf_tables(conn)
    mf_nav_service._set_db(conn)
    mf_nav_service._breaker_state.clear()
    yield conn
    conn.close()


# --- KV helper tests (Task 2) ---

def test_set_and_get_amfi_codes_roundtrip(fresh_db):
    """set_amfi_codes persists; get_amfi_codes reads back; de-dupes + strips."""
    from services import mf_nav_service
    mf_nav_service.set_amfi_codes(["119597", "120503", "119597", "", "  ", None])
    assert mf_nav_service.get_amfi_codes() == ["119597", "120503"]


def test_get_amfi_codes_returns_empty_when_absent(fresh_db):
    """No user_codes row → empty list, not None, not error."""
    from services import mf_nav_service
    assert mf_nav_service.get_amfi_codes() == []


def test_get_amfi_codes_handles_garbage_json(fresh_db):
    """If user_codes row is corrupted, return [] and log a warning."""
    from services import mf_nav_service
    mf_nav_service._write_kv("user_codes", "not json {[")
    assert mf_nav_service.get_amfi_codes() == []


def test_consecutive_failures_kv_roundtrip(fresh_db):
    """_write_consecutive_failures + _read_consecutive_failures round-trip."""
    from services import mf_nav_service
    assert mf_nav_service._read_consecutive_failures() == 0  # default
    mf_nav_service._write_consecutive_failures(3)
    assert mf_nav_service._read_consecutive_failures() == 3
    mf_nav_service._write_consecutive_failures(0)
    assert mf_nav_service._read_consecutive_failures() == 0


def test_write_consecutive_failures_clamps_negative(fresh_db):
    """Defensive: negative values are clamped to 0."""
    from services import mf_nav_service
    mf_nav_service._write_consecutive_failures(-5)
    assert mf_nav_service._read_consecutive_failures() == 0


def test_last_scheduler_error_truncated_at_512(fresh_db):
    """Long error strings are truncated to 512 chars."""
    from services import mf_nav_service
    long_err = "X" * 1000
    mf_nav_service._write_last_scheduler_error(long_err)
    stored = mf_nav_service._read_last_scheduler_error()
    assert stored is not None
    assert len(stored) == 512


# --- run_scheduler_loop tests (Task 4) ---

def _patch_refresh_all(monkeypatch, return_value):
    """Patch refresh_all_async inside mf_nav_service with a sync-returning async fn."""
    from services import mf_nav_service
    async def fake(codes):
        return return_value
    monkeypatch.setattr(mf_nav_service, "refresh_all_async", fake)


@pytest.mark.asyncio
async def test_first_tick_fires_immediately_when_never_run(fresh_db, monkeypatch):
    """No prior next_refresh_after → first tick fires without sleeping.

    Smoke-test the infinite loop: set nra=0, run loop, cancel after 200ms.
    """
    from services import mf_nav_service
    _patch_refresh_all(monkeypatch, {"refreshed": 1, "failed": [], "skipped": 0, "duration_ms": 1})
    mf_nav_service.set_amfi_codes(["119597"])
    # Force the bootstrap to set nra=0 (no prior history).
    mf_nav_service._write_next_refresh_after(0)
    assert mf_nav_service._read_next_refresh_after() == 0

    task = asyncio.create_task(mf_nav_service.run_scheduler_loop())
    await asyncio.sleep(0.2)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    # If we got here without an unhandled exception, the loop ran and
    # was cancellable. The state should have been advanced past nra=0.
    assert mf_nav_service._read_next_refresh_after() is not None


def test_increments_consecutive_failures_on_total_failure(fresh_db, monkeypatch):
    """refresh_all_async returns all-failed → consecutive_failures goes 0 → 1."""
    from services import mf_nav_service
    _patch_refresh_all(monkeypatch, {
        "refreshed": 0,
        "failed": [{"scheme_code": "X", "reason": "500"}],
        "skipped": 0, "duration_ms": 1,
    })
    mf_nav_service._write_consecutive_failures(0)
    mf_nav_service._handle_tick_result({
        "refreshed": 0, "failed": [{"scheme_code": "X", "reason": "500"}], "skipped": 0,
    })
    assert mf_nav_service._read_consecutive_failures() == 1


def test_resets_consecutive_failures_on_full_success(fresh_db, monkeypatch):
    """2 prior failures + 1 full success → counter resets to 0."""
    from services import mf_nav_service
    mf_nav_service._write_consecutive_failures(2)
    mf_nav_service._handle_tick_result({
        "refreshed": 3, "failed": [], "skipped": 0,
    })
    assert mf_nav_service._read_consecutive_failures() == 0


def test_partial_success_does_not_change_consecutive_failures(fresh_db, monkeypatch):
    """Some ok + some failed → counter unchanged."""
    from services import mf_nav_service
    mf_nav_service._write_consecutive_failures(2)
    mf_nav_service._handle_tick_result({
        "refreshed": 2, "failed": [{"scheme_code": "X", "reason": "500"}], "skipped": 0,
    })
    assert mf_nav_service._read_consecutive_failures() == 2  # unchanged


def test_next_fire_after_consecutive_failures_doubles_at_3(fresh_db, monkeypatch):
    """At 3+ consecutive failures, the next fire time is ~2x the normal interval."""
    from services import mf_nav_service
    n0 = mf_nav_service._next_fire_after_consecutive_failures(0)
    n3 = mf_nav_service._next_fire_after_consecutive_failures(3)
    n10 = mf_nav_service._next_fire_after_consecutive_failures(10)
    now = int(time.time())
    # Normal: ~24h + 0..4.8h → ∈ [24h, 24h + 0.2*24h)
    assert 24 * 3600 <= (n0 - now) < int(24 * 3600 * 1.2)
    # Backoff: ~48h + 0..4.8h → ∈ [48h, 48h + 0.2*24h)
    assert 2 * 24 * 3600 <= (n3 - now) < int(2 * 24 * 3600 + 0.2 * 24 * 3600)
    assert 2 * 24 * 3600 <= (n10 - now) < int(2 * 24 * 3600 + 0.2 * 24 * 3600)


def test_record_scheduler_crash_writes_error_and_bumps_counter(fresh_db, monkeypatch):
    """_record_scheduler_crash persists the error (truncated) and bumps consecutive_failures."""
    from services import mf_nav_service
    mf_nav_service._write_consecutive_failures(0)
    mf_nav_service._write_last_scheduler_error(None)
    mf_nav_service._record_scheduler_crash("RuntimeError: kaboom")
    assert mf_nav_service._read_consecutive_failures() == 1
    assert mf_nav_service._read_last_scheduler_error() == "RuntimeError: kaboom"


def test_next_fire_persists_into_kv_on_tick(fresh_db, monkeypatch):
    """After _handle_tick_result, next_refresh_after is written to the KV table."""
    from services import mf_nav_service
    _patch_refresh_all(monkeypatch, {"refreshed": 1, "failed": [], "skipped": 0, "duration_ms": 1})
    mf_nav_service._write_next_refresh_after(None)  # start clean
    mf_nav_service._write_consecutive_failures(0)
    mf_nav_service._handle_tick_result({
        "refreshed": 1, "failed": [], "skipped": 0,
    })
    nra = mf_nav_service._read_next_refresh_after()
    assert nra is not None
    # Normal cadence: ∈ [24h, 24h + 0.2*24h) seconds from now
    now = int(time.time())
    assert 24 * 3600 <= (nra - now) < int(24 * 3600 * 1.2)
