"""
pytest config (CC53).

Sets asyncio_mode = auto so any test defined with `async def` is treated as
an asyncio test without needing @pytest.mark.asyncio on each one.

Scope: tests/ directory only. Other test files in the project are unaffected
because they live in different test runners.
"""
import pytest

pytest_plugins = []


def pytest_collection_modifyitems(config, items):
    """Auto-mark async tests so they run under pytest-asyncio without explicit decorators."""
    for item in items:
        if "asyncio" in item.keywords:
            continue
        if hasattr(item, "obj") and getattr(item.obj, "__code__", None) is not None:
            if item.obj.__code__.co_flags & 0x100:  # CO_COROUTINE
                item.add_marker(pytest.mark.asyncio)
