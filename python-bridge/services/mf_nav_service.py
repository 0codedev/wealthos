"""
MF NAV refresh service (CC53).

Wraps mfapi.in (free, keyless, community-run Indian AMC NAV source) and
caches the full time series + latest pointer in SQLite.

Constraints from project rules:
- No new dependencies (uses existing httpx)
- Bounded concurrency (5) + 5s timeout + 3-strike circuit breaker per scheme
- Partial success: one bad scheme never fails the batch
- All upstream calls record telemetry
"""
import os
import sys
import time
import asyncio
import json
import logging
import random
import sqlite3
import httpx
from typing import Optional, List, Dict, Any

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logger = logging.getLogger("mf_nav_service")

MFAPI_BASE = "https://api.mfapi.in/mf"
UPSTREAM_TIMEOUT_S = 5.0
CONCURRENCY = 5
BREAKER_THRESHOLD = 3
CACHE_FRESH_SECONDS = 24 * 60 * 60  # 24h

# --- module-level state (overridden in tests via _set_db) ---
_db_conn = None

# In-memory circuit-breaker counters (per-process, reset on bridge restart).
# Not persisted: a bridge restart gives every scheme a clean slate, which is
# desirable — the upstream may have been transient.
_breaker_state: Dict[str, int] = {}  # scheme_code → consecutive failures


def _set_db(conn):
    """Test hook: inject a custom DB connection (e.g. :memory:)."""
    global _db_conn
    _db_conn = conn


from contextlib import contextmanager

@contextmanager
def _get_db(write: bool = False):
    global _db_conn
    if _db_conn is not None:
        yield _db_conn
    else:
        from db_stabilized import get_connection
        with get_connection(write=write) as conn:
            yield conn


def _http_get(url: str) -> httpx.Response:
    """Test hook: real impl uses httpx.Client. Wrapped so tests can patch."""
    with httpx.Client(timeout=UPSTREAM_TIMEOUT_S) as c:
        return c.get(url)


# --- public API ---

def fetch_and_cache_scheme(scheme_code: str) -> Dict[str, Any]:
    """
    Fetch one scheme from mfapi.in, upsert mf_nav_history + mf_nav_latest.
    Returns {scheme_code, nav, date, error}.
    Never raises; failures populate `error` so a batch keeps going.
    """
    try:
        resp = _http_get(f"{MFAPI_BASE}/{scheme_code}")
        if resp.status_code != 200:
            _record_failure(scheme_code)
            return {"scheme_code": scheme_code, "nav": None, "date": None,
                    "error": f"mfapi.in returned {resp.status_code}"}
        body = resp.json()
        rows = body.get("data") or []
        if not rows:
            _record_failure(scheme_code)
            return {"scheme_code": scheme_code, "nav": None, "date": None,
                    "error": "empty data array"}

        now = int(time.time())
        latest_date = rows[0]["date"]
        latest_nav = float(rows[0]["nav"])

        with _get_db(write=True) as conn:
            # Upsert history (full time series)
            conn.executemany(
                "INSERT OR REPLACE INTO mf_nav_history (scheme_code, date, nav, fetched_at) "
                "VALUES (?, ?, ?, ?)",
                [(scheme_code, r["date"], float(r["nav"]), now) for r in rows],
            )
            # Upsert latest pointer
            conn.execute(
                "INSERT OR REPLACE INTO mf_nav_latest (scheme_code, nav, date, last_fetched_at) "
                "VALUES (?, ?, ?, ?)",
                (scheme_code, latest_nav, latest_date, now),
            )
            conn.commit()
        _record_success(scheme_code)
        return {"scheme_code": scheme_code, "nav": latest_nav, "date": latest_date, "error": None}
    except (httpx.TimeoutException, httpx.HTTPError) as e:
        _record_failure(scheme_code)
        return {"scheme_code": scheme_code, "nav": None, "date": None,
                "error": f"timeout after {UPSTREAM_TIMEOUT_S}s" if isinstance(e, httpx.TimeoutException) else str(e)}
    except Exception as e:
        _record_failure(scheme_code)
        return {"scheme_code": scheme_code, "nav": None, "date": None,
                "error": f"{type(e).__name__}: {e}"}


def _record_failure(scheme_code: str) -> None:
    """Increment the in-memory breaker counter for this scheme (one-process state)."""
    _breaker_state[scheme_code] = _breaker_state.get(scheme_code, 0) + 1


def _record_success(scheme_code: str) -> None:
    """Reset the breaker counter on success."""
    _breaker_state.pop(scheme_code, None)


# --- A6 KV helpers + scheduler state ---
# mf_refresh_state is a (key TEXT PRIMARY KEY, value TEXT) KV table from CC53.
# We add four new keys (no schema change): user_codes, next_refresh_after,
# consecutive_failures, last_scheduler_error.

def _read_kv(key: str) -> Optional[str]:
    """Read a string value from mf_refresh_state. Returns None if absent."""
    with _get_db(write=False) as conn:
        row = conn.execute("SELECT value FROM mf_refresh_state WHERE key=?", (key,)).fetchone()
        return row[0] if row else None


def _write_kv(key: str, value: Optional[str]) -> None:
    """Write a string value to mf_refresh_state. None deletes the row."""
    with _get_db(write=True) as conn:
        if value is None:
            conn.execute("DELETE FROM mf_refresh_state WHERE key=?", (key,))
        else:
            conn.execute("INSERT OR REPLACE INTO mf_refresh_state (key, value) VALUES (?, ?)", (key, value))
        conn.commit()


def set_amfi_codes(codes: List[str]) -> None:
    """Persist the user's current amfi code list. JSON-encoded array.

    Coerces to strings, strips empties, de-dupes while preserving order.
    Called by the POST /api/mf/codes router (Task 5).
    """
    seen: set = set()
    cleaned: List[str] = []
    for c in codes:
        if c is None:
            continue
        s = str(c).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        cleaned.append(s)
    _write_kv("user_codes", json.dumps(cleaned))


def get_amfi_codes() -> List[str]:
    """Read the persisted user amfi code list. Empty list if absent or invalid JSON."""
    raw = _read_kv("user_codes")
    if not raw:
        return []
    try:
        v = json.loads(raw)
        if isinstance(v, list):
            return [str(x) for x in v if x is not None]
    except (ValueError, TypeError):
        logger.warning("MF scheduler: user_codes row is not valid JSON, treating as empty")
    return []


def _read_next_refresh_after() -> Optional[int]:
    raw = _read_kv("next_refresh_after")
    if not raw:
        return None
    try:
        return int(raw)
    except (ValueError, TypeError):
        return None


def _write_next_refresh_after(epoch_seconds: Optional[int]) -> None:
    _write_kv("next_refresh_after", str(epoch_seconds) if epoch_seconds is not None else None)


def _read_consecutive_failures() -> int:
    raw = _read_kv("consecutive_failures")
    if not raw:
        return 0
    try:
        return int(raw)
    except (ValueError, TypeError):
        return 0


def _write_consecutive_failures(n: int) -> None:
    _write_kv("consecutive_failures", str(max(0, int(n))))


def _read_last_scheduler_error() -> Optional[str]:
    return _read_kv("last_scheduler_error")


def _write_last_scheduler_error(err: Optional[str]) -> None:
    if err is not None and len(err) > 512:
        err = err[:512]
    _write_kv("last_scheduler_error", err)


def is_breaker_open(scheme_code: str) -> bool:
    return _breaker_state.get(scheme_code, 0) >= BREAKER_THRESHOLD


async def refresh_all_async(scheme_codes: List[str]) -> Dict[str, Any]:
    """
    Bounded-concurrency batch refresh. Returns {refreshed, failed, skipped, duration_ms}.

    Uses asyncio.Semaphore for coordination, but the inner work is sync. The
    semaphore blocks inside the event loop until a slot is free — this is the
    idiomatic pattern for bounded concurrency over sync I/O in asyncio, and
    avoids the SQLite cross-thread guard entirely (no asyncio.to_thread).
    """
    started = time.time()
    sem = asyncio.Semaphore(CONCURRENCY)

    async def _one(code: str) -> Dict[str, Any]:
        async with sem:
            if is_breaker_open(code):
                return {"scheme_code": code, "skipped": True}
            return fetch_and_cache_scheme(code)

    results = await asyncio.gather(*[_one(c) for c in scheme_codes])
    refreshed = sum(1 for r in results if not r.get("skipped") and r.get("error") is None)
    failed = [r for r in results if not r.get("skipped") and r.get("error") is not None]
    skipped = sum(1 for r in results if r.get("skipped"))
    duration_ms = int((time.time() - started) * 1000)

    # Persist scheduler state (CC53: last_refresh_at, last_refresh_summary)
    # A6: also write a jittered next_refresh_after so the scheduler loop
    # can pick up the cadence even if the bridge is restarted between ticks.
    with _get_db(write=True) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO mf_refresh_state (key, value) VALUES ('last_refresh_at', ?)",
            (str(int(started)),),
        )
        conn.execute(
            "INSERT OR REPLACE INTO mf_refresh_state (key, value) VALUES ('last_refresh_summary', ?)",
            (f'{{"refreshed":{refreshed},"failed":{len(failed)},"skipped":{skipped},"duration_ms":{duration_ms}}}',),
        )
        conn.commit()
    # Jittered next fire: 24h + 0..0.2*24h (matches CC21 precedent).
    jitter = random.uniform(0, 0.2 * 24 * 3600)
    _write_next_refresh_after(int(started) + 24 * 3600 + int(jitter))

    return {
        "refreshed": refreshed,
        "failed": [{"scheme_code": r["scheme_code"], "reason": r["error"]} for r in failed],
        "skipped": skipped,
        "duration_ms": duration_ms,
    }


def get_status(codes: List[str]) -> Dict[str, Any]:
    """
    Read latest NAV for the given codes. Returns the status payload for the
    GET /api/mf/status endpoint.
    """
    with _get_db(write=False) as conn:
        state = {r[0]: r[1] for r in conn.execute("SELECT key, value FROM mf_refresh_state").fetchall()}
        last_refresh_at = int(state["last_refresh_at"]) if "last_refresh_at" in state else None
        # A6: next_refresh_after is now persisted (was derived from last_refresh_at
        # in CC53). Read the persisted value; fall back to last_refresh_at + 24h
        # if absent (bridge just upgraded, no jittered value yet).
        next_refresh_after = _read_next_refresh_after()
        if next_refresh_after is None and last_refresh_at is not None:
            next_refresh_after = last_refresh_at + CACHE_FRESH_SECONDS

        holdings: List[Dict[str, Any]] = []
        if codes:
            placeholders = ",".join("?" * len(codes))
            rows = conn.execute(
                f"SELECT scheme_code, nav, date, last_fetched_at FROM mf_nav_latest "
                f"WHERE scheme_code IN ({placeholders})",
                codes,
            ).fetchall()
            for r in rows:
                holdings.append({
                    "scheme_code": r[0],
                    "nav": r[1],
                    "nav_date": r[2],
                    "last_fetched_at": r[3],
                })

    return {
        "last_refresh_at": last_refresh_at,
        "next_refresh_after": next_refresh_after,
        "is_refreshing": False,  # updated by router from in-memory flag
        "holdings": holdings,
    }


def is_cache_stale() -> bool:
    """True if last refresh is older than CACHE_FRESH_SECONDS or never happened."""
    with _get_db(write=False) as conn:
        row = conn.execute("SELECT value FROM mf_refresh_state WHERE key='last_refresh_at'").fetchone()
        if not row:
            return True
        return (int(time.time()) - int(row[0])) > CACHE_FRESH_SECONDS


# --- A6 — 24h scheduler loop ---
# A single asyncio task, lives until process death. Reads
# next_refresh_after from mf_refresh_state, sleeps until that time, then
# calls refresh_all_async(get_amfi_codes()). On wake, persists the next
# jittered fire time. Silent retry on failure: skip-next backoff (2x the
# normal interval) when consecutive_failures >= 3, reset to 1x on first
# success. Per-scheme circuit breaker lives in fetch_and_cache_scheme
# (CC53); this layer only owns the loop and the cross-batch failure
# counter.

BACKOFF_MULTIPLIER = 2
MAX_LOG_BURST_FAILURES = (1, 3, 5)


def _next_fire_after_consecutive_failures(consecutive_failures: int) -> int:
    """Compute the seconds-from-now for the next fire time.

    Normal cadence: 24h + jitter. Backoff cadence: 2 * 24h + jitter.
    Backoff triggers when consecutive_failures >= 3 and resets on first
    full success (consecutive_failures == 0).
    """
    base = 24 * 3600
    if consecutive_failures >= BACKOFF_MULTIPLIER + 1:  # i.e. >= 3
        base *= BACKOFF_MULTIPLIER
    jitter = random.uniform(0, 0.2 * 24 * 3600)
    return int(time.time()) + base + int(jitter)


def _handle_tick_result(summary: Dict[str, Any]) -> None:
    """Update state after a refresh tick. Never raises."""
    refreshed = summary.get("refreshed", 0)
    failed = summary.get("failed", []) or []

    if refreshed > 0 and not failed:
        # Full success → reset the counter.
        _write_consecutive_failures(0)
    elif refreshed == 0 and failed:
        # Total failure (bridge down, mfapi.in 5xx, etc.)
        n = _read_consecutive_failures() + 1
        _write_consecutive_failures(n)
        if n in MAX_LOG_BURST_FAILURES:
            logger.warning("MF scheduler: %d consecutive total failures", n)
    # else: partial success → counter unchanged.

    n = _read_consecutive_failures()
    _write_next_refresh_after(_next_fire_after_consecutive_failures(n))


def _record_scheduler_crash(err: str) -> None:
    """Update state after the loop's outer try/except catches a crash."""
    n = _read_consecutive_failures() + 1
    _write_consecutive_failures(n)
    _write_last_scheduler_error(err)
    if n in MAX_LOG_BURST_FAILURES:
        logger.warning("MF scheduler crash: %s (count=%d)", err, n)
    _write_next_refresh_after(_next_fire_after_consecutive_failures(n))


async def run_scheduler_loop() -> None:
    """One task; lives until process death.

    Tick algorithm:
        1. Read next_refresh_after (None on first run).
        2. Sleep until then (0 if None).
        3. On wake, call refresh_all_async(get_amfi_codes()) if non-empty.
        4. Persist next fire time + failure counter.
        5. Loop.
    """
    logger.info("MF scheduler loop starting")
    # First-fire bootstrap. If we have a last_refresh_at but no
    # next_refresh_after (e.g. upgraded from CC53), set the next fire to
    # last_refresh_at + 24h + jitter so we don't immediately re-refresh.
    if _read_next_refresh_after() is None:
        last = _read_kv("last_refresh_at")
        if last is not None:
            try:
                last_ts = int(last)
                jitter = random.uniform(0, 0.2 * 24 * 3600)
                _write_next_refresh_after(last_ts + 24 * 3600 + int(jitter))
            except (ValueError, TypeError):
                pass
        else:
            # No prior history: fire immediately on the first tick.
            _write_next_refresh_after(0)

    while True:
        try:
            nra = _read_next_refresh_after()
            now = int(time.time())
            if nra is None or nra <= now:
                sleep_s = 0
            else:
                sleep_s = nra - now
            if sleep_s > 0:
                await asyncio.sleep(sleep_s)

            codes = get_amfi_codes()
            if not codes:
                # Nothing to do this cycle (no MF holdings, or toggle OFF).
                # Bump next fire and loop. Don't touch consecutive_failures.
                n = _read_consecutive_failures()
                _write_next_refresh_after(_next_fire_after_consecutive_failures(n))
                continue

            try:
                summary = await refresh_all_async(codes)
                _handle_tick_result(summary)
            except Exception as e:  # pragma: no cover - defensive
                # refresh_all_async itself is designed to never raise (each
                # scheme is wrapped in try/except). This catch is the last
                # line of defense for the loop.
                _record_scheduler_crash(f"{type(e).__name__}: {e}")
        except asyncio.CancelledError:
            logger.info("MF scheduler loop cancelled; exiting")
            raise
        except Exception as e:  # pragma: no cover - defensive
            # Anything else (DB lock, OOM, etc.) — log + bump + sleep.
            _record_scheduler_crash(f"{type(e).__name__}: {e}")
            # Short backoff if we crashed hard; the next loop iteration
            # will re-read next_refresh_after.
            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                raise
