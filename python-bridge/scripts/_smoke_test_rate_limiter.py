# python-bridge/scripts/_smoke_test_rate_limiter.py
# Smoke test for rate_limiter.RateLimiter.
# Run: python _smoke_test_rate_limiter.py
# Pass criteria: 4 assertions all True; < 5s total.

import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.rate_limiter import RateLimiter


def test_baseline_cadence():
    """At 2 rps, 4 acquires should take ~1.5s (not 0)."""
    rl = RateLimiter(reqs_per_sec=2.0)
    t0 = time.monotonic()
    for _ in range(4):
        rl.acquire()
    elapsed = time.monotonic() - t0
    assert 1.2 < elapsed < 2.5, f"Expected ~1.5s, got {elapsed:.3f}s"
    print(f"OK baseline cadence: 4 acquires @ 2 rps in {elapsed:.3f}s")


def test_429_with_retry_after():
    rl = RateLimiter(reqs_per_sec=10.0)
    wait = rl.record_429("2")
    assert wait == 2.0, f"Expected 2.0, got {wait}"
    print(f"OK 429 Retry-After=2 -> wait={wait}s")


def test_429_without_retry_after_uses_exponential_backoff():
    rl = RateLimiter(reqs_per_sec=10.0, backoff_base_sec=1.0, backoff_factor=2.0)
    w1 = rl.record_429(None)   # 1st: 1s
    w2 = rl.record_429(None)   # 2nd: 2s
    w3 = rl.record_429(None)   # 3rd: 4s
    assert (w1, w2, w3) == (1.0, 2.0, 4.0), (w1, w2, w3)
    print(f"OK 429 exp backoff: {w1}, {w2}, {w3}")


def test_2xx_resets_backoff():
    rl = RateLimiter(reqs_per_sec=10.0)
    rl.record_429(None)
    rl.record_429(None)
    rl.record_2xx()
    w_after_reset = rl.record_429(None)   # should restart at base
    assert w_after_reset == 1.0, f"Expected 1.0 after reset, got {w_after_reset}"
    print(f"OK 2xx resets backoff -> next 429 wait={w_after_reset}s")


def test_retry_after_capped_at_max():
    rl = RateLimiter(reqs_per_sec=10.0, max_backoff_sec=60.0)
    wait = rl.record_429("9999")
    assert wait == 60.0, f"Expected cap=60.0, got {wait}"
    print(f"OK Retry-After capped at max_backoff: {wait}s")


if __name__ == "__main__":
    test_baseline_cadence()
    test_429_with_retry_after()
    test_429_without_retry_after_uses_exponential_backoff()
    test_2xx_resets_backoff()
    test_retry_after_capped_at_max()
    print("ALL PASS")
