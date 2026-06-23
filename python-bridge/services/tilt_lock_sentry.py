"""
tilt_lock_sentry.py — OS-Level Tilt-Lock Sentry & Anti-Revenge Circuit Breaker.

A tamper-resistant, host-filesystem seal (`.tilt_lock.seal`) that the Python
bridge middleware inspects before admitting ANY order. When sealed, all
buy/sell execution endpoints reject with HTTP 403 until the cool-off expiry
timestamp elapses — regardless of browser reloads, incognito tabs, client
restarts, or direct REST calls against the bridge.

Design posture:
  - Local-first, zero external services, zero heavy dependencies (stdlib only).
  - Fail-CLOSED for execution endpoints: a corrupt or unreadable seal file is
    treated as an *active* lock rather than an open gate.
  - Pre-flight check cost target: <50 microseconds via mtime-keyed stat cache.
  - No trivial UI toggle can lift the lock: only (a) cool-off expiry, or (b)
    offline challenge-response with the operator passphrase can clear it.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import secrets
import tempfile
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional

try:  # FastAPI present in the bridge runtime; guarded for standalone import
    from fastapi import HTTPException, Request
except Exception:  # noqa: BLE001
    HTTPException = Exception  # type: ignore[assignment]
    Request = Any  # type: ignore[assignment]

log = logging.getLogger("wealthos.tilt_lock_sentry")

IST = timezone(timedelta(hours=5, minutes=30), name="IST")

# ---------------------------------------------------------------------------
# Configuration (env-overridable, all optional)
# ---------------------------------------------------------------------------

DEFAULT_SEAL_PATH = os.getenv(
    "TILT_LOCK_SEAL_PATH",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".tilt_lock.seal"),
)
DEFAULT_MAX_DAILY_LOSS = float(os.getenv("TILT_LOCK_MAX_DAILY_LOSS_INR", "1000.0"))
DEFAULT_LOCKOUT_HOURS = float(os.getenv("TILT_LOCK_DURATION_HOURS", "4.0"))
DEFAULT_STREAK_LIMIT = int(os.getenv("TILT_LOCK_STREAK_LIMIT", "3"))
DEFAULT_STREAK_WINDOW_SEC = float(os.getenv("TILT_LOCK_STREAK_WINDOW_SEC", "3600"))
DEFAULT_BURST_LIMIT = int(os.getenv("TILT_LOCK_BURST_LIMIT", "5"))
DEFAULT_BURST_WINDOW_SEC = float(os.getenv("TILT_LOCK_BURST_WINDOW_SEC", "60"))
OPERATOR_PASSPHRASE = os.getenv("TILT_LOCK_OPERATOR_PASSPHRASE", "")

REASON_DAILY_LOSS = "DAILY_LOSS_LIMIT_EXCEEDED"
REASON_STREAK = "CONSECUTIVE_LOSING_STREAK"
REASON_BURST = "RAPID_FIRE_ORDER_BURST"
REASON_MANUAL = "MANUAL_CAPTAIN_ENGAGE"


class SealCorruptError(Exception):
    pass


class TiltLockSentry:
    """Filesystem seal manager + auto-engagement policy engine."""

    def __init__(
        self,
        seal_path: str = DEFAULT_SEAL_PATH,
        max_daily_loss: float = DEFAULT_MAX_DAILY_LOSS,
        lockout_hours: float = DEFAULT_LOCKOUT_HOURS,
        streak_limit: int = DEFAULT_STREAK_LIMIT,
        streak_window_sec: float = DEFAULT_STREAK_WINDOW_SEC,
        burst_limit: int = DEFAULT_BURST_LIMIT,
        burst_window_sec: float = DEFAULT_BURST_WINDOW_SEC,
    ) -> None:
        self.seal_path = Path(seal_path)
        self.max_daily_loss = float(max_daily_loss)
        self.lockout_hours = float(lockout_hours)
        self.streak_limit = int(streak_limit)
        self.streak_window_sec = float(streak_window_sec)
        self.burst_limit = int(burst_limit)
        self.burst_window_sec = float(burst_window_sec)

        self._lock = threading.RLock()
        # mtime-keyed cache: re-stat only when the inode/mtime changed
        self._cache_mtime_ns: int = -1
        self._cache_state: Dict[str, Any] = {"locked": False, "payload": None}
        # in-session accounting (single UTC trading day, reset on new IST date)
        self._realized_day: str = ""
        self._realized_loss_inr: float = 0.0
        self._losses: Deque[float] = deque(maxlen=64)
        self._loss_times: Deque[float] = deque(maxlen=64)
        self._order_attempts: Deque[float] = deque(maxlen=256)

    # ------------------------------------------------------------------
    # Time helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _now_ist() -> datetime:
        return datetime.now(IST)

    @staticmethod
    def _iso(dt: datetime) -> str:
        return dt.astimezone(IST).isoformat(timespec="seconds")

    def _default_expiry(self, now: datetime) -> datetime:
        """Lock until max(now + lockout_hours, next 09:15 IST)."""
        fixed = now + timedelta(hours=self.lockout_hours)
        tomorrow_open = (now + timedelta(days=1)).replace(hour=9, minute=15, second=0, microsecond=0)
        same_day_open = now.replace(hour=9, minute=15, second=0, microsecond=0)
        eod = tomorrow_open if now >= same_day_open else same_day_open
        return max(fixed, eod) if now.hour >= 15 and now.minute >= 30 else fixed

    # ------------------------------------------------------------------
    # Seal integrity
    # ------------------------------------------------------------------

    def _machine_key(self) -> bytes:
        seed = f"{os.uname().nodename}:{os.getpid()}:{Path.home()}" + str(Path(self.seal_path).resolve())
        return hashlib.sha256(seed.encode("utf-8")).digest()

    def _sign(self, payload: Dict[str, Any]) -> str:
        body = json.dumps(
            {k: payload[k] for k in ("locked_at", "expires_at", "reason", "max_drawdown_incurred", "salt")},
            sort_keys=True,
        ).encode("utf-8")
        return hmac.new(self._machine_key(), body, hashlib.sha256).hexdigest()

    def _verify(self, payload: Dict[str, Any]) -> bool:
        try:
            return hmac.compare_digest(str(payload.get("signature", "")), self._sign(payload))
        except Exception:  # noqa: BLE001
            return False

    # ------------------------------------------------------------------
    # Seal management
    # ------------------------------------------------------------------

    def engage(
        self,
        reason: str,
        max_drawdown_incurred: float = 0.0,
        expires_at: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """Atomically write the seal. Idempotent: re-engaging extends to max(expires)."""
        with self._lock:
            now = self._now_ist()
            expiry = expires_at or self._default_expiry(now)
            existing = self._read_payload_uncached()
            if existing and self._verify(existing):
                try:
                    prev = datetime.fromisoformat(str(existing["expires_at"]))
                    expiry = max(expiry, prev)
                except Exception:  # noqa: BLE001
                    pass
            payload: Dict[str, Any] = {
                "locked_at": self._iso(now),
                "expires_at": self._iso(expiry),
                "reason": reason,
                "max_drawdown_incurred": float(max_drawdown_incurred),
                "salt": secrets.token_hex(16),
            }
            payload["signature"] = self._sign(payload)
            self.seal_path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=str(self.seal_path.parent), prefix=".tilt_lock.", suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    json.dump(payload, fh, indent=2)
                    fh.flush()
                    os.fsync(fh.fileno())
                os.replace(tmp, self.seal_path)
                os.chmod(self.seal_path, 0o600)
            finally:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
            self._cache_mtime_ns = -1  # force re-stat
            log.warning("[TILT_LOCK] ENGAGED reason=%s expires=%s", reason, payload["expires_at"])
            return payload

    def _read_payload_uncached(self) -> Optional[Dict[str, Any]]:
        try:
            with open(self.seal_path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except FileNotFoundError:
            return None
        except Exception as exc:  # noqa: BLE001
            log.error("[TILT_LOCK] seal unreadable/corrupt: %s", exc)
            return {"_corrupt": True, "error": str(exc)}

    def is_locked(self) -> bool:
        """<50µs steady-state: one stat per call, payload parsed only on mtime change."""
        try:
            st = os.stat(self.seal_path)
        except FileNotFoundError:
            if self._cache_state["locked"]:
                self._cache_state = {"locked": False, "payload": None}
            return False
        except OSError as exc:
            log.error("[TILT_LOCK] stat failed, failing closed: %s", exc)
            return True
        if st.st_mtime_ns != self._cache_mtime_ns:
            payload = self._read_payload_uncached()
            if payload is None:
                self._cache_state = {"locked": False, "payload": None}
            elif payload.get("_corrupt") or not self._verify(payload):
                log.error("[TILT_LOCK] corrupt/forged seal, failing closed")
                self._cache_state = {"locked": True, "payload": {"reason": "SEAL_CORRUPT_FAIL_CLOSED"}}
            else:
                try:
                    expires = datetime.fromisoformat(str(payload["expires_at"]))
                    active = expires > self._now_ist()
                except Exception:  # noqa: BLE001
                    active = True  # unparsable expiry -> treat as active
                self._cache_state = {"locked": active, "payload": payload if active else None}
            self._cache_mtime_ns = st.st_mtime_ns
        return bool(self._cache_state["locked"])

    def status(self) -> Dict[str, Any]:
        with self._lock:
            locked = self.is_locked()
            payload = self._cache_state.get("payload") if locked else None
            remaining = 0
            if payload and not payload.get("_corrupt") and payload.get("expires_at"):
                try:
                    remaining = max(0, int((datetime.fromisoformat(str(payload["expires_at"])) - self._now_ist()).total_seconds()))
                except Exception:  # noqa: BLE001
                    remaining = -1
            return {
                "locked": locked,
                "reason": (payload or {}).get("reason"),
                "expires_at": (payload or {}).get("expires_at"),
                "time_remaining_sec": remaining,
                "seal_path": str(self.seal_path),
                "realized_loss_inr_today": round(self._realized_loss_inr, 2),
                "auto_engage_armed": True,
            }

    # ------------------------------------------------------------------
    # Cryptographic bypass protocol (challenge-response or cooldown)
    # ------------------------------------------------------------------

    def challenge(self) -> str:
        """Offline challenge derived from seal fields + machine key."""
        payload = self._read_payload_uncached() or {}
        nonce = secrets.token_hex(8)
        body = "|".join(str(payload.get(k, "")) for k in ("locked_at", "expires_at", "reason", "salt")) + nonce
        digest = hmac.new(self._machine_key(), body.encode(), hashlib.sha256).hexdigest()[:16]
        return f"{nonce}:{digest}"

    def unlock_with_response(self, challenge: str, response_passphrase: str) -> bool:
        expected = hashlib.sha256(f"{challenge}:{OPERATOR_PASSPHRASE}".encode()).hexdigest()[:16] if OPERATOR_PASSPHRASE else ""
        ok = bool(OPERATOR_PASSPHRASE) and hmac.compare_digest(response_passphrase, expected)
        if ok:
            self._clear_seal()
            log.warning("[TILT_LOCK] cleared via offline challenge-response")
        else:
            log.error("[TILT_LOCK] unlock attempt REJECTED (bad passphrase)")
        return ok

    def force_clear_expired(self) -> bool:
        """Manual cleanup utility: remove seal only after expiry has truly elapsed."""
        payload = self._read_payload_uncached()
        if payload and payload.get("expires_at"):
            try:
                if datetime.fromisoformat(str(payload["expires_at"])) <= self._now_ist():
                    self._clear_seal()
                    return True
            except Exception:  # noqa: BLE001
                pass
        return False

    def _clear_seal(self) -> None:
        with self._lock:
            try:
                os.unlink(self.seal_path)
            except FileNotFoundError:
                pass
            self._cache_mtime_ns = -1
            self._cache_state = {"locked": False, "payload": None}

    # ------------------------------------------------------------------
    # Auto-engagement rules (called by PnL / order routers)
    # ------------------------------------------------------------------

    def _roll_day(self) -> None:
        today = self._now_ist().strftime("%Y-%m-%d")
        if today != self._realized_day:
            self._realized_day = today
            self._realized_loss_inr = 0.0
            self._losses.clear()
            self._loss_times.clear()

    def report_realized_pnl(self, pnl_inr: float) -> Optional[Dict[str, Any]]:
        with self._lock:
            self._roll_day()
            self._losses.append(pnl_inr)
            if pnl_inr < 0:
                self._realized_loss_inr += abs(pnl_inr)
                self._loss_times.append(time.monotonic())
            now_ts = time.monotonic()
            while self._loss_times and now_ts - self._loss_times[0] > self.streak_window_sec:
                self._loss_times.popleft()
            if self._realized_loss_inr >= self.max_daily_loss:
                return self.engage(REASON_DAILY_LOSS, max_drawdown_incurred=self._realized_loss_inr)
            # streak: N consecutive losses, each negative
            recent = list(self._losses)[-self.streak_limit :]
            if len(recent) >= self.streak_limit and all(p < 0 for p in recent):
                return self.engage(REASON_STREAK, max_drawdown_incurred=sum(abs(p) for p in recent))
            return None

    def report_order_attempt(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            now = time.monotonic()
            self._order_attempts.append(now)
            while self._order_attempts and now - self._order_attempts[0] > self.burst_window_sec:
                self._order_attempts.popleft()
            if len(self._order_attempts) > self.burst_limit:
                return self.engage(REASON_BURST, max_drawdown_incurred=0.0)
            return None


# ---------------------------------------------------------------------------
# Singleton accessor (FastAPI DI-friendly)
# ---------------------------------------------------------------------------

_SENTRY: Optional[TiltLockSentry] = None
_SENTRY_LOCK = threading.Lock()


def get_sentry() -> TiltLockSentry:
    global _SENTRY
    if _SENTRY is None:
        with _SENTRY_LOCK:
            if _SENTRY is None:
                _SENTRY = TiltLockSentry()
    return _SENTRY


# ---------------------------------------------------------------------------
# FastAPI dependency gate — attach to every execution endpoint
# ---------------------------------------------------------------------------

EXECUTION_PATHS = (
    "/api/placeorder", "/api/placebracket", "/api/placemarketorder",
    "/api/modifyorder", "/api/cancelorder", "/api/openalgo/placeorder",
    "/api/openalgo/smartorder", "/api/dhan/orders", "/api/upstox/order",
    "/api/autopilot/execute", "/api/tradefinder/execute",
)


async def verify_tilt_unlocked(request: Request) -> None:
    """Dependency: abort with 403 while the host seal is active."""
    sentry = get_sentry()
    sentry.report_order_attempt()
    if sentry.is_locked():
        st = sentry.status()
        raise HTTPException(
            status_code=403,
            detail={
                "status": "TILT_LOCK_ACTIVE",
                "message": f"Host system locked to protect capital until {st.get('expires_at') or 'cool-off expiry'}",
                "time_remaining_sec": st["time_remaining_sec"],
                "reason": st.get("reason"),
            },
        )


async def tilt_lock_middleware(request: Request, call_next):
    """Optional pure-ASGI middleware for blanket enforcement on EXECUTION_PATHS."""
    path = request.url.path
    if any(path.startswith(p) for p in EXECUTION_PATHS) and request.method in ("POST", "PUT", "PATCH"):
        sentry = get_sentry()
        sentry.report_order_attempt()
        if sentry.is_locked():
            st = sentry.status()
            from fastapi.responses import JSONResponse

            return JSONResponse(
                status_code=403,
                content={
                    "status": "TILT_LOCK_ACTIVE",
                    "message": f"Host system locked to protect capital until {st.get('expires_at') or 'cool-off expiry'}",
                    "time_remaining_sec": st["time_remaining_sec"],
                    "reason": st.get("reason"),
                },
            )
    return await call_next(request)
