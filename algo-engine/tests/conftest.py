"""Shared pytest + hypothesis configuration for the Intraday Strategy Suite.

This module is auto-discovered by pytest for everything under ``algo-engine/tests``.
It does three jobs required by the suite's testing strategy:

1. Registers and loads a shared ``hypothesis`` profile so that *every* property
   test in the suite inherits a minimum of 100 examples per run
   (design "Testing Strategy": ``@settings(max_examples=100)`` or higher).
2. Exposes a ``default_config`` fixture: a complete, documented Config dict with
   the common cross-cutting keys every strategy reads (instrument, quantity,
   capital, market-hours timings, warmup, max trades per day).
3. Exposes a ``logger_capture`` fixture: a helper that attaches to a strategy's
   logger and records emitted log messages for assertions, plus a companion
   ``raising_logger`` helper for verifying that logging never blocks emission.

Third-party imports introduced here are limited to ``pytest`` and ``hypothesis``
(the test-only dependencies); the suite under test depends only on the Python
standard library, numpy, and pandas.
"""

from __future__ import annotations

import logging
from typing import Iterator, List

import pytest
from hypothesis import HealthCheck, settings

# ---------------------------------------------------------------------------
# Shared hypothesis profile
# ---------------------------------------------------------------------------
# Registered and loaded at import time so the profile applies across the entire
# test session without any per-test configuration. Property tests therefore run
# at least 100 examples each by default. ``deadline=None`` avoids spurious
# timeout flakiness on indicator math, and the data-generation health check is
# relaxed so candle-sequence strategies (which build longer inputs) are allowed.
SHARED_HYPOTHESIS_PROFILE = "intraday-suite"

settings.register_profile(
    SHARED_HYPOTHESIS_PROFILE,
    settings(
        max_examples=100,
        deadline=None,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
    ),
)
settings.load_profile(SHARED_HYPOTHESIS_PROFILE)


# ---------------------------------------------------------------------------
# Default Config fixture
# ---------------------------------------------------------------------------
# These mirror the documented defaults in design.md ("Config (read-only)").
# Timing values are strings in "%H:%M:%S" form (strategies normalize them).
DEFAULT_CONFIG = {
    "instrument": "1333",          # Dhan security_id string
    "quantity": 50,                # exact Signal quantity (no risk-based resizing)
    "capital": 1_000_000.0,        # used for the 2% Risk_Per_Trade cap
    "market_open": "09:15:00",
    "no_new_entry": "15:00:00",
    "square_off": "15:15:00",
    "session_close": "15:20:00",
    "warmup_period": 20,
    "max_trades_per_day": 5,
}


@pytest.fixture
def default_config() -> dict:
    """Return a fresh copy of the default Config dict for a single test.

    A copy is returned so a test can mutate its config without leaking changes
    into other tests.
    """
    return dict(DEFAULT_CONFIG)


# ---------------------------------------------------------------------------
# Logger capture helper
# ---------------------------------------------------------------------------
class LogCapture:
    """Captures log records emitted to a named logger (or its descendants).

    Usage::

        def test_x(logger_capture):
            cap = logger_capture("VWAP_MeanReversion")
            ...                      # exercise the strategy
            assert cap.contains("degraded")
    """

    def __init__(self) -> None:
        self.records: List[logging.LogRecord] = []
        self._handler = _ListHandler(self.records)
        self._handler.setLevel(logging.DEBUG)
        self._attached: List[logging.Logger] = []

    def attach(self, logger_name: str | None = None) -> "LogCapture":
        """Attach the capture handler to ``logger_name`` (root logger if None)."""
        logger = logging.getLogger(logger_name) if logger_name else logging.getLogger()
        logger.addHandler(self._handler)
        # Ensure DEBUG records are not filtered out before reaching the handler.
        if logger.level == logging.NOTSET or logger.level > logging.DEBUG:
            logger.setLevel(logging.DEBUG)
        self._attached.append(logger)
        return self

    @property
    def messages(self) -> List[str]:
        """Rendered messages of every captured record, in emission order."""
        return [r.getMessage() for r in self.records]

    @property
    def text(self) -> str:
        """All captured messages joined by newlines (handy for substring checks)."""
        return "\n".join(self.messages)

    def contains(self, substring: str) -> bool:
        """True if any captured message contains ``substring``."""
        return any(substring in m for m in self.messages)

    def clear(self) -> None:
        self.records.clear()

    def detach(self) -> None:
        for logger in self._attached:
            logger.removeHandler(self._handler)
        self._attached.clear()


class _ListHandler(logging.Handler):
    """Minimal logging handler that appends records to a shared list."""

    def __init__(self, sink: List[logging.LogRecord]) -> None:
        super().__init__()
        self._sink = sink

    def emit(self, record: logging.LogRecord) -> None:
        self._sink.append(record)


@pytest.fixture
def logger_capture() -> Iterator:
    """Yield a factory that attaches a :class:`LogCapture` to a named logger.

    The factory may be called multiple times within one test; every attached
    handler is detached automatically at teardown.
    """
    captures: List[LogCapture] = []

    def _factory(logger_name: str | None = None) -> LogCapture:
        cap = LogCapture().attach(logger_name)
        captures.append(cap)
        return cap

    yield _factory

    for cap in captures:
        cap.detach()


class RaisingLogger(logging.Handler):
    """A logging handler that raises on every emit.

    Used to verify the suite-wide invariant that a misconfigured or failing
    logger never suppresses a trade Signal (design Property 10 / Requirement 6.2).
    """

    def emit(self, record: logging.LogRecord) -> None:  # pragma: no cover - trivial
        raise RuntimeError("logger failure injected by RaisingLogger")


@pytest.fixture
def raising_logger() -> Iterator:
    """Yield a factory that attaches a :class:`RaisingLogger` to a named logger.

    Handlers are removed automatically at teardown.
    """
    attached: List[tuple[logging.Logger, RaisingLogger]] = []

    def _factory(logger_name: str | None = None) -> RaisingLogger:
        logger = logging.getLogger(logger_name) if logger_name else logging.getLogger()
        handler = RaisingLogger()
        handler.setLevel(logging.DEBUG)
        logger.addHandler(handler)
        if logger.level == logging.NOTSET or logger.level > logging.DEBUG:
            logger.setLevel(logging.DEBUG)
        attached.append((logger, handler))
        return handler

    yield _factory

    for logger, handler in attached:
        logger.removeHandler(handler)
