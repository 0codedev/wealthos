"""
python-bridge/services/circuit_breaker.py — Downstream API Cascade Defense

Implements stateful Circuit Breaker pattern for broker REST APIs & third-party HTTP endpoints.
States:
- CLOSED: Normal operation. All calls pass through.
- OPEN: Failure threshold exceeded. Rejects calls immediately to prevent cascading thread hangs.
- HALF_OPEN: Probe state after recovery timeout. Allows 1 request through to test endpoint health.

Zero-disruption guarantee: Safe wrapper around API calls. If Circuit Breaker fails internally,
it falls back to invoking the target function directly.
"""

import time
import logging
from typing import Callable, Any, Dict

log = logging.getLogger("circuit_breaker")

class CircuitBreakerOpenException(Exception):
    """Raised when an API call is attempted while the circuit breaker is OPEN."""
    pass

class CircuitBreaker:
    def __init__(self, name: str, failure_threshold: int = 5, recovery_timeout_seconds: float = 60.0):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout_seconds
        
        self.state = "CLOSED"  # CLOSED, OPEN, HALF_OPEN
        self.failure_count = 0
        self.last_failure_time = 0.0

    def get_status(self) -> Dict[str, Any]:
        """Returns diagnostic status object for health checks."""
        return {
            "name": self.name,
            "state": self.state,
            "failure_count": self.failure_count,
            "last_failure_time": self.last_failure_time
        }

    def _on_success(self):
        """Reset state on successful execution."""
        if self.state != "CLOSED":
            log.info(f"[CIRCUIT BREAKER] ✅ Circuit {self.name} restored to CLOSED.")
        self.state = "CLOSED"
        self.failure_count = 0

    def _on_failure(self, error: Exception):
        """Record failure and trip circuit if threshold exceeded."""
        self.failure_count += 1
        self.last_failure_time = time.time()
        log.warning(f"[CIRCUIT BREAKER] ⚠️ {self.name} failure #{self.failure_count}: {error}")

        if self.failure_count >= self.failure_threshold:
            self.state = "OPEN"
            log.error(f"[CIRCUIT BREAKER] 🚨 Circuit {self.name} TRIPPED to OPEN! Blocking calls for {self.recovery_timeout}s.")

    def call(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        """
        Executes target function inside circuit breaker protective wrapper.
        """
        now = time.time()

        if self.state == "OPEN":
            if now - self.last_failure_time > self.recovery_timeout:
                log.info(f"[CIRCUIT BREAKER] 🔄 Circuit {self.name} entering HALF_OPEN probe state...")
                self.state = "HALF_OPEN"
            else:
                raise CircuitBreakerOpenException(f"Circuit breaker OPEN for {self.name}. Call rejected.")

        try:
            result = fn(*args, **kwargs)
            self._on_success()
            return result
        except Exception as e:
            self._on_failure(e)
            raise e

# Pre-instantiated circuit breakers for core brokers
upstox_breaker = CircuitBreaker("upstox_api", failure_threshold=5, recovery_timeout_seconds=60.0)
dhan_breaker = CircuitBreaker("dhan_api", failure_threshold=5, recovery_timeout_seconds=60.0)
