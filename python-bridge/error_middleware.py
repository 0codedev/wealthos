"""
CC24: FastAPI error-handler middleware that:
- Catches OperationalError (SQLite locks) and retries with backoff
- Returns a structured JSON envelope (status, error_code, message, trace_id)
- Adds a request-id header for cross-system correlation
- Never lets an unhandled exception crash the bridge process
"""

from __future__ import annotations

import json
import logging
import time
import asyncio
import traceback
import uuid
import re
from typing import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("error_middleware")

RETRYABLE_SQLITE_ERRORS = (
    "database is locked",
    "database table is locked",
    "database disk image is malformed",
    "attempt to write a readonly database",
)


class BridgeErrorMiddleware(BaseHTTPMiddleware):
    """
    Wraps every request, attaching a trace id, capturing exceptions, and
    re-issuing a retry attempt for known transient SQLite issues.
    """

    def __init__(self, app, max_retries: int = 3, retry_backoff: float = 0.25):
        super().__init__(app)
        self._max_retries = max_retries
        self._retry_backoff = retry_backoff

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        trace_id = request.headers.get("x-trace-id") or uuid.uuid4().hex[:12]
        request.state.trace_id = trace_id

        # Skip docs/openapi to avoid noise
        path = request.url.path
        if path in ("/", "/docs", "/redoc", "/openapi.json", "/api/ready"):
            return await call_next(request)

        attempt = 0
        while True:
            try:
                response = await call_next(request)
                response.headers["X-Trace-Id"] = trace_id
                return response
            except Exception as exc:
                attempt += 1
                err_text = str(exc).lower()
                is_retryable = any(tok in err_text for tok in RETRYABLE_SQLITE_ERRORS)

                if is_retryable and attempt <= self._max_retries:
                    sleep_for = self._retry_backoff * (2 ** (attempt - 1))
                    logger.warning(
                        "[BRIDGE] Transient error on %s (attempt %d/%d): %s. Sleeping %.2fs",
                        path, attempt, self._max_retries, exc, sleep_for,
                    )
                    await asyncio.sleep(sleep_for)
                    continue

                # Non-retryable or retries exhausted: structured error
                logger.error(
                    "[BRIDGE] Unhandled exception on %s (trace=%s): %s\n%s",
                    path, trace_id, exc, traceback.format_exc(),
                )
                error_code = "db_locked" if is_retryable else "internal_error"
                status_code = 503 if is_retryable else 500
                return JSONResponse(
                    status_code=status_code,
                    content={
                        "status": "error",
                        "error_code": error_code,
                        "message": _safe_message(exc),
                        "trace_id": trace_id,
                        "path": path,
                    },
                    headers={"X-Trace-Id": trace_id},
                )


def _safe_message(exc: Exception) -> str:
    """Scrub token-like blobs and internal paths from exception messages before responding."""
    text = str(exc)
    if "eyJ" in text:
        # Looks like a JWT - replace conservatively
        return "Upstream authentication error. Please re-authenticate."
    # Scrub potential tokens or secrets
    text = re.sub(r'(bearer\s+)[A-Za-z0-9_\-\.]{20,}', r'\1[REDACTED]', text, flags=re.IGNORECASE)
    # Scrub local filesystem paths
    text = re.sub(r'([A-Za-z]:\\[^:\s]+|/home/[^/\s]+/[^:\s]+)', '[PATH_REDACTED]', text)
    return text[:500]


def install(app) -> None:
    """Register the middleware on a FastAPI app instance."""
    app.add_middleware(BridgeErrorMiddleware)
