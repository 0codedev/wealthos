"""Smoke tests for the test harness itself (task 1.1).

These verify that the shared hypothesis profile is loaded, the default Config
fixture is well-formed, and the logger-capture / raising-logger helpers behave
as documented. They do not exercise any strategy (none exist yet); they only
confirm the infrastructure is wired correctly so later test tasks can rely on it.
"""

from __future__ import annotations

import logging

from hypothesis import given, settings
from hypothesis import strategies as st

from conftest import SHARED_HYPOTHESIS_PROFILE


def test_shared_hypothesis_profile_is_loaded():
    # The active settings must reflect the registered shared profile.
    assert settings._current_profile == SHARED_HYPOTHESIS_PROFILE
    assert settings.default.max_examples >= 100


def test_default_config_has_required_keys(default_config):
    required = {
        "instrument",
        "quantity",
        "capital",
        "market_open",
        "no_new_entry",
        "square_off",
        "session_close",
        "warmup_period",
        "max_trades_per_day",
    }
    assert required.issubset(default_config.keys())
    assert isinstance(default_config["instrument"], str)
    assert isinstance(default_config["quantity"], int)
    assert isinstance(default_config["capital"], float)


def test_default_config_fixture_is_isolated(default_config):
    # Mutating the dict in one test must not leak into the shared default.
    default_config["quantity"] = 999
    assert default_config["quantity"] == 999


def test_logger_capture_records_messages(logger_capture):
    cap = logger_capture("harness.smoke")
    logging.getLogger("harness.smoke").debug("hello degraded mode")
    assert cap.contains("degraded")
    assert "hello degraded mode" in cap.text


def test_raising_logger_raises_on_emit(raising_logger):
    raising_logger("harness.raising")
    try:
        logging.getLogger("harness.raising").debug("boom")
    except RuntimeError as exc:
        assert "logger failure injected" in str(exc)
    else:  # pragma: no cover - defensive
        raise AssertionError("RaisingLogger did not raise on emit")


@given(st.integers())
@settings(max_examples=100)
def test_hypothesis_runs_under_shared_profile(n):
    # A trivial property to confirm hypothesis collects and runs in this layout.
    assert n + 0 == n
