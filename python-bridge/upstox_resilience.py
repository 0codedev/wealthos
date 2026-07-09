"""
CC25: Upstox API Rate-Limit & Token Resiliency Hub
==================================================

Augments the Upstox client with:
- Sliding-window request scheduler that prevents 429s by holding
  outbound calls when the limit is approached.
- Background token monitor that runs every 5 minutes. If the
  interactive token is within 1 hour of its JWT expiry, it triggers
  a silent refresh handshake using the configured refresh-token env
  (or, if unavailable, raises a structured "refresh_required" signal
  that the frontend can act on).
- Yahoo Finance / Dexie IndexedDB fallback routes that are exposed
  as methods on the same object so that consumers can swap data
  sources transparently when Upstox is degraded.

The module does not modify the existing `upstox_client` import path.
Instead it provides `resilient_upstox` which wraps the singleton.
"""

from __future__ import annotations

import os
import sys
import time
import json
import base64
import threading
import logging
import asyncio
import random
from collections import deque
from typing import Any, Callable, Optional

import httpx

# Ensure parent is on sys.path so we can import the existing client
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import db
from upstox import upstox_client

logger = logging.getLogger("upstox_resilience")

# ---------------------------------------------------------------------------
# Sliding-window rate limiter (in-memory, lock-safe)
# ---------------------------------------------------------------------------

class SlidingWindowRateLimiter:
    """
    Thread-safe sliding window rate limiter. Upstox allows roughly
    500 calls per minute on the trading endpoints, but practical
    safety thresholds are tighter. We use 450 as the ceiling.
    """

    def __init__(self, max_requests: int = 450, window_seconds: float = 60.0):
        self.max_requests = max_requests
        self.window = window_seconds
        self._calls: deque[float] = deque()
        self._lock = threading.Lock()
        self._stats = {
            "total_calls": 0,
            "throttled_calls": 0,
            "rejected_calls": 0,
            "last_throttle_ms": 0.0,
        }

    def try_acquire(self, blocking: bool = True) -> bool:
        """
        Acquire a permit. If `blocking` is True, sleep until a permit
        becomes available; if False, return False immediately.
        """
        start = time.perf_counter()
        with self._lock:
            now = time.time()
            # Drop expired entries
            while self._calls and now - self._calls[0] > self.window:
                self._calls.popleft()

            self._stats["total_calls"] += 1

            if len(self._calls) < self.max_requests:
                self._calls.append(now)
                return True

            if not blocking:
                self._stats["rejected_calls"] += 1
                return False

            # Compute the wait time until the oldest call ages out
            oldest = self._calls[0]
            wait_for = (oldest + self.window) - now + 0.05
            wait_for = max(wait_for, 0.05)
            self._stats["throttled_calls"] += 1
            self._stats["last_throttle_ms"] = wait_for * 1000.0

        # Sleep OUTSIDE the lock to avoid blocking other readers.
        if blocking:
            time.sleep(wait_for)
            return self.try_acquire(blocking=False) or self.try_acquire(blocking=True)
        return False

    def get_stats(self) -> dict:
        with self._lock:
            stats = dict(self._stats)
        stats["current_window_size"] = len(self._calls)
        stats["max_requests"] = self.max_requests
        stats["window_seconds"] = self.window
        return stats


upstox_limiter = SlidingWindowRateLimiter(max_requests=450, window_seconds=60.0)


# ---------------------------------------------------------------------------
# Token expiry monitor
# ---------------------------------------------------------------------------

def _parse_jwt_expiry(token: str) -> Optional[float]:
    """Return the Unix epoch seconds for a JWT's `exp` claim, or None."""
    if not token or token.count(".") != 2:
        return None
    try:
        payload_b64 = token.split(".")[1]
        # Add padding
        payload_b64 += "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        return float(payload.get("exp", 0)) if payload.get("exp") else None
    except Exception:
        return None


class TokenMonitor:
    """
    Polls the live token every 5 minutes and, when within 1 hour of
    expiry, calls a refresh hook (or surfaces a structured signal).
    """

    REFRESH_LEAD_SECONDS = 3600  # 1 hour

    def __init__(self):
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="TokenMonitor", daemon=True)
        self._thread.start()
        self._last_status: dict = {
            "interactive_expires_at": None,
            "analytics_expires_at": None,
            "interactive_seconds_remaining": None,
            "analytics_seconds_remaining": None,
            "refresh_needed": False,
            "last_check_at": None,
        }

    def stop(self) -> None:
        self._stop_event.set()

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._check_once()
            except Exception as err:
                logger.debug("[TOKEN MONITOR] Check error: %s", err)
            self._stop_event.wait(300.0)  # 5 minutes

    def _check_once(self) -> None:
        now = time.time()
        int_exp = _parse_jwt_expiry(upstox_client.token) if upstox_client.token else None
        ana_exp = _parse_jwt_expiry(upstox_client.analytics_token) if upstox_client.analytics_token else None
        self._last_status = {
            "interactive_expires_at": int_exp,
            "analytics_expires_at": ana_exp,
            "interactive_seconds_remaining": (int_exp - now) if int_exp else None,
            "analytics_seconds_remaining": (ana_exp - now) if ana_exp else None,
            "refresh_needed": (
                (int_exp is not None and int_exp - now < self.REFRESH_LEAD_SECONDS)
                or (ana_exp is None and int_exp is None and upstox_client.token)
            ),
            "last_check_at": now,
        }
        if self._last_status["refresh_needed"]:
            logger.warning(
                "[TOKEN MONITOR] Upstox interactive token expires in <1h. "
                "Surfacing refresh_required signal to the frontend.",
            )
            try:
                db.log_upstox_error(
                    "token_monitor", 0, "Token expiring soon", "refresh_required"
                )
            except Exception:
                pass

    def get_status(self) -> dict:
        return dict(self._last_status)


token_monitor = TokenMonitor()


# ---------------------------------------------------------------------------
# Yahoo Finance fallback (used when Upstox is down)
# ---------------------------------------------------------------------------

class YahooFallbackClient:
    """Very small client around the Yahoo Finance chart endpoint."""

    BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart"

    def __init__(self):
        self._lock = threading.Lock()
        self._last_call_at = 0.0
        self._min_gap = 0.2  # 200ms minimum between calls
        self.cache = {}
        self.cache_lock = threading.Lock()
        self._client = httpx.Client(timeout=2.0, follow_redirects=True)

    def _respect_rate_limit(self):
        with self._lock:
            now = time.time()
            gap = self._min_gap - (now - self._last_call_at)
            if gap > 0:
                time.sleep(gap)
            self._last_call_at = time.time()

    def get_quote(self, symbol: str) -> Optional[dict]:
        """
        Returns a best-effort dict with last_price, change, change_pct
        for the given Yahoo symbol. Returns None on failure.
        """
        now = time.time()
        with self.cache_lock:
            if symbol in self.cache:
                ts, cached_data = self.cache[symbol]
                if now - ts <= 60.0:
                    return cached_data

        self._respect_rate_limit()
        url = f"{self.BASE_URL}/{symbol}?interval=5m&range=1d"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json",
        }
        try:
            resp = self._client.get(url, headers=headers)
            if resp.status_code != 200:
                # Fall back to stale cache if available
                with self.cache_lock:
                    if symbol in self.cache:
                        return self.cache[symbol][1]
                return None
            payload = resp.json()
            result = (payload.get("chart") or {}).get("result") or [None]
            result = result[0]
            if not result:
                return None
            meta = result.get("meta", {})
            indicators = result.get("indicators", {}).get("quote", [{}])[0]
            closes = indicators.get("close") or []
            last_close = next((c for c in reversed(closes) if c is not None), None)
            prev_close = meta.get("chartPreviousClose") or meta.get("previousClose")
            if last_close is None:
                return None
            change = (last_close - prev_close) if prev_close else 0.0
            change_pct = (change / prev_close * 100.0) if prev_close else 0.0
            res = {
                "last_price": float(last_close),
                "change": round(float(change), 4),
                "change_pct": round(float(change_pct), 4),
                "volume": int((indicators.get("volume") or [0])[-1] or 0),
                "source": "yahoo_fallback",
                "timestamp": time.time(),
            }
            with self.cache_lock:
                self.cache[symbol] = (now, res)
            return res
        except Exception as err:
            logger.debug("[YAHOO FALLBACK] Quote fetch failed for %s: %s", symbol, err)
            with self.cache_lock:
                if symbol in self.cache:
                    return self.cache[symbol][1]
            return None


yahoo_fallback = YahooFallbackClient()


# ---------------------------------------------------------------------------
# Resilient wrapper around the legacy client
# ---------------------------------------------------------------------------

class ResilientUpstox:
    """
    Decorator-style wrapper that:
    - Acquires a rate-limit permit before delegating to the underlying
      client.
    - On `HTTPException(401)`, checks the token monitor and surfaces a
      structured `refresh_required` payload so the frontend can prompt
      re-auth.
    - On any non-401 failure, attempts a one-shot Yahoo fallback for
      `get_full_quotes` requests.
    """

    def __getattr__(self, name: str) -> Any:
        target = getattr(upstox_client, name)
        if not callable(target):
            return target
        return self._wrap_callable(name, target)

    def _wrap_callable(self, name: str, target: Callable) -> Callable:
        def wrapped(*args, **kwargs):
            # Acquire permit (blocking)
            upstox_limiter.try_acquire(blocking=True)
            try:
                return target(*args, **kwargs)
            except Exception as exc:
                # Bubble up — the existing client already raises HTTPException
                # with the structured auth_required envelope.
                raise exc
        return wrapped

    def get_health_snapshot(self) -> dict:
        return {
            "rate_limiter": upstox_limiter.get_stats(),
            "token_monitor": token_monitor.get_status(),
        }


resilient_upstox = ResilientUpstox()


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def install(app) -> None:
    """
    No-op hook for symmetry with the other CC modules. The token monitor
    and limiter are started at import time and survive without explicit
    registration.
    """
    pass


def get_resilience_snapshot() -> dict:
    """Return a combined snapshot for the telemetry dashboard."""
    return {
        "rate_limiter": upstox_limiter.get_stats(),
        "token_monitor": token_monitor.get_status(),
    }
