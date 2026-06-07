"""
CC24: NSE Stealth Scraper Resiliency Module
==========================================

Wraps the `pnsea.NSE` client with:
- Random User-Agent rotation on every request
- Cookie session resets on HTTP 403/503/429 responses
- Automatic fallback to local SQLite cache when the upstream is blocked
- Hook for telemetry counters (request counts, success/fail rates)
"""

from __future__ import annotations

import os
import sys
import json
import time
import random
import logging
import threading
from collections import deque
from typing import Any, Optional

# Ensure python-bridge root is on sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import db
from logger import get_logger

logger = get_logger("nse_stealth", tag="NSE")

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edge/120.0.0.0",
]

# Lightweight telemetry state (consumed by telemetry.py)
_STATS = {
    "requests": 0,
    "successes": 0,
    "failures": 0,
    "ua_rotations": 0,
    "session_resets": 0,
    "fallback_cache_hits": 0,
    "last_blocked_at": None,
    "last_success_at": None,
    "blocked_streak": 0,
}
_STATS_LOCK = threading.Lock()

# Last 50 latencies (ms) for the sparkline panel
_LATENCY_HISTORY: deque[float] = deque(maxlen=50)
_LATENCY_LOCK = threading.Lock()


def _rotate_user_agent(client) -> None:
    """Swap the User-Agent header on the underlying requests session."""
    try:
        ua = random.choice(USER_AGENTS)
        session = getattr(client, "session", None)
        if session is not None and hasattr(session, "headers"):
            session.headers.update({"User-Agent": ua})
        else:
            # Fallback to a direct attribute if pnsea uses .headers
            client.headers.update({"User-Agent": ua})
        with _STATS_LOCK:
            _STATS["ua_rotations"] += 1
    except Exception as err:
        logger.debug("[NSE STEALTH] UA rotation failed: %s", err)


def _record_request(success: bool, latency_ms: float, status: int) -> None:
    with _STATS_LOCK:
        _STATS["requests"] += 1
        if success:
            _STATS["successes"] += 1
            _STATS["last_success_at"] = time.time()
            _STATS["blocked_streak"] = 0
        else:
            _STATS["failures"] += 1
            if status in (403, 429, 503):
                _STATS["last_blocked_at"] = time.time()
                _STATS["blocked_streak"] += 1
    with _LATENCY_LOCK:
        _LATENCY_HISTORY.append(latency_ms)


def _reset_session(client) -> None:
    """
    Force the underlying pnsea client to drop cookies and rebuild its
    session. NSE tracks session cookies, so a forced reset often
    immediately unblocks 403 responses.
    """
    try:
        session = getattr(client, "session", None)
        if session is not None:
            try:
                session.cookies.clear()
            except Exception:
                pass
            try:
                # Force a session rebuild via the standard requests Session
                from requests import Session
                fresh = Session()
                fresh.headers.update({
                    "User-Agent": random.choice(USER_AGENTS),
                    "Accept": "application/json, text/plain, */*",
                    "Accept-Language": "en-US,en;q=0.9",
                })
                client.session = fresh
            except Exception as err:
                logger.debug("[NSE STEALTH] Failed to rebuild session: %s", err)
        with _STATS_LOCK:
            _STATS["session_resets"] += 1
    except Exception as err:
        logger.debug("[NSE STEALTH] Session reset failed: %s", err)


def is_blocked_response(response) -> bool:
    """Detect when NSE has returned a block page or rate-limit response."""
    if response is None:
        return True
    if response.status_code in (403, 429, 503):
        return True
    # Some blocks return 200 with HTML body
    try:
        ctype = response.headers.get("content-type", "")
        if "json" not in ctype.lower() and response.status_code == 200:
            return True
    except Exception:
        pass
    return False


def execute_with_resilience(
    client,
    fn: callable,
    *args,
    cache_key: Optional[str] = None,
    cache_ttl_seconds: int = 60,
    max_attempts: int = 3,
    backoff_base: float = 1.0,
    **kwargs,
) -> Any:
    """
    Execute an NSE client method with rotating UA, automatic retries on
    block responses, and an SQLite cache fallback.

    Returns the parsed JSON dict/list on success, or the cached payload
    (last-known good) on persistent upstream failure.
    """
    last_err: Optional[Exception] = None
    for attempt in range(1, max_attempts + 1):
        _rotate_user_agent(client)
        start = time.perf_counter()
        try:
            response = fn(*args, **kwargs)
        except Exception as exc:
            latency = (time.perf_counter() - start) * 1000.0
            _record_request(False, latency, 0)
            last_err = exc
            logger.warning("Attempt %d raised: %s", attempt, exc)
            time.sleep(backoff_base * (2 ** (attempt - 1)) + random.uniform(0.1, 0.5))
            continue

        latency = (time.perf_counter() - start) * 1000.0
        if is_blocked_response(response):
            _record_request(False, latency, response.status_code)
            logger.warning(
                "Block detected (status=%s) on attempt %d for %s. Resetting session...",
                response.status_code, attempt, cache_key or fn.__name__,
            )
            _reset_session(client)
            last_err = RuntimeError(f"NSE blocked: status={response.status_code}")
            time.sleep(backoff_base * (2 ** (attempt - 1)) + random.uniform(0.5, 1.0))
            continue

        # Success path
        _record_request(True, latency, response.status_code)
        try:
            data = response.json()
        except Exception:
            data = {"raw": getattr(response, "text", "")}

        if cache_key:
            try:
                db.set_nse_db_cache(cache_key, data, cache_ttl_seconds)
            except Exception as err:
                logger.debug("[NSE STEALTH] Cache write failed: %s", err)
        return data

    # All attempts failed — serve last-known cache if available
    if cache_key:
        try:
            cached = db.get_nse_db_cache(cache_key)
            if cached is not None:
                with _STATS_LOCK:
                    _STATS["fallback_cache_hits"] += 1
                logger.info("Serving fallback cache for %s", cache_key)
                return cached
        except Exception as err:
            logger.debug("[NSE STEALTH] Cache read failed: %s", err)

    if last_err:
        raise last_err
    raise RuntimeError("NSE upstream unreachable and no cache available.")


def get_stats() -> dict:
    """Return a snapshot of the stealth scraper stats for the telemetry panel."""
    with _STATS_LOCK:
        snap = dict(_STATS)
    snap["success_rate"] = (
        round(snap["successes"] / snap["requests"] * 100.0, 1) if snap["requests"] else 0.0
    )
    with _LATENCY_LOCK:
        snap["latency_history"] = list(_LATENCY_HISTORY)
    return snap
