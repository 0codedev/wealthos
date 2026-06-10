# python-bridge/scripts/rate_limiter.py
# Conservative Dhan API rate limiter: 1 req/sec baseline, exponential backoff on 429.
# Honors the `Retry-After` header verbatim if present (per Dhan convention: integer seconds).

import time
import random
import logging
from dataclasses import dataclass, field

log = logging.getLogger("rate_limiter")


@dataclass
class RateLimiter:
    """Thread-safe (single-async-loop) request rate limiter with 429 backoff.

    Usage:
        rl = RateLimiter(reqs_per_sec=1.0)
        async with rl.guard():
            res = await http.get(url)
    """

    reqs_per_sec: float = 1.0
    max_backoff_sec: float = 300.0            # 5 min hard cap
    backoff_base_sec: float = 1.0
    backoff_factor: float = 2.0
    _consecutive_429: int = field(default=0, init=False)
    _last_call_ts: float = field(default=0.0, init=False)

    def _sleep_until_next_slot(self) -> None:
        """Wait long enough to maintain the per-second cadence."""
        if self._last_call_ts <= 0:
            return
        elapsed = time.monotonic() - self._last_call_ts
        min_interval = 1.0 / max(self.reqs_per_sec, 0.01)
        remaining = min_interval - elapsed
        if remaining > 0:
            # tiny jitter (≤ 50ms) to avoid thundering-herd on shared infra
            time.sleep(remaining + random.uniform(0.0, 0.05))

    def record_2xx(self) -> None:
        """A successful call resets the backoff counter."""
        self._consecutive_429 = 0

    def record_429(self, retry_after_header: str | None) -> float:
        """A 429 arrived. Compute wait time. Caller MUST sleep this many seconds."""
        self._consecutive_429 += 1
        if retry_after_header:
            try:
                wait = float(retry_after_header.strip())
                wait = min(wait, self.max_backoff_sec)
                log.warning(
                    f"[rate_limiter] 429; honoring Retry-After={wait}s "
                    f"(consecutive={self._consecutive_429})"
                )
                return wait
            except (TypeError, ValueError):
                pass  # fall through to exponential backoff
        # exponential backoff with cap
        wait = min(
            self.backoff_base_sec * (self.backoff_factor ** (self._consecutive_429 - 1)),
            self.max_backoff_sec,
        )
        log.warning(
            f"[rate_limiter] 429 without Retry-After; backing off {wait:.1f}s "
            f"(consecutive={self._consecutive_429})"
        )
        return wait

    def acquire(self) -> None:
        """Block until we're allowed to make a request."""
        self._sleep_until_next_slot()
        self._last_call_ts = time.monotonic()
