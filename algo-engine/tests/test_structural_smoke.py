"""Structural / smoke tests for the Intraday Strategy Suite.

Validates packaging and dependency facts without relying on extensive strategy
logic execution:

  - Exactly five strategy files exist in ``algo-engine/strategies/``, each
    defining a ``BaseStrategy`` subclass that implements ``on_candle`` and
    ``on_tick``.
  - ``base_strategy.py`` is unmodified: ``BaseStrategy`` is an abstract class
    and ``Signal`` is a dataclass with exactly eight fields in the correct order.
  - Only stdlib, numpy, and pandas are imported across the five strategy modules
    (no other third-party packages).
  - Each strategy module has a docstring that mentions edge / entry / exit / risk
    and documents recommended Config values, KPIs, and failure modes.

Requirements: 1.1, 1.2, 1.3, 1.8, 5.7, 6.3, 6.4
"""

from __future__ import annotations

import ast
import dataclasses
import importlib
import inspect
import sys
from pathlib import Path
from typing import List

import pytest

# ---------------------------------------------------------------------------
# Path constants
# ---------------------------------------------------------------------------
# ``tests/`` is directly inside ``algo-engine/``, so go up one level.
_TESTS_DIR = Path(__file__).resolve().parent
_ALGO_ENGINE_DIR = _TESTS_DIR.parent
_STRATEGIES_DIR = _ALGO_ENGINE_DIR / "strategies"

# Ensure algo-engine/ is on sys.path so ``from strategies.xxx import ...`` works
# (mirrors how pytest discovers tests when run from algo-engine/).
if str(_ALGO_ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(_ALGO_ENGINE_DIR))

# ---------------------------------------------------------------------------
# Suite constants
# ---------------------------------------------------------------------------

# The five canonical strategy files (filename only).
EXPECTED_STRATEGY_FILES: List[str] = [
    "vwap_mean_reversion.py",
    "ema_trend_pullback.py",
    "orb_enhanced.py",
    "zscore_reversion.py",
    "volatility_squeeze.py",
]

# Matching importable module names (under the ``strategies`` package).
EXPECTED_MODULE_NAMES: List[str] = [
    "strategies.vwap_mean_reversion",
    "strategies.ema_trend_pullback",
    "strategies.orb_enhanced",
    "strategies.zscore_reversion",
    "strategies.volatility_squeeze",
]

# Third-party packages that ARE allowed in strategy modules.
ALLOWED_THIRD_PARTY: frozenset[str] = frozenset({"numpy", "pandas"})

# ``strategies`` is the local package used by ``from strategies.base_strategy
# import ...``; it is not a third-party dependency.
_LOCAL_PACKAGE_ROOTS: frozenset[str] = frozenset({"strategies"})


def _stdlib_module_names() -> frozenset[str]:
    """Return the set of stdlib top-level module names."""
    if hasattr(sys, "stdlib_module_names"):
        return sys.stdlib_module_names  # type: ignore[attr-defined]
    # Fallback for Python < 3.10
    return frozenset({
        "__future__", "abc", "ast", "builtins", "collections", "contextlib",
        "copy", "dataclasses", "datetime", "decimal", "enum", "functools",
        "importlib", "inspect", "io", "itertools", "logging", "math",
        "operator", "os", "pathlib", "re", "statistics", "string", "sys",
        "time", "traceback", "types", "typing", "warnings", "collections",
    })


_STDLIB_NAMES = _stdlib_module_names()


# ---------------------------------------------------------------------------
# Import helpers
# ---------------------------------------------------------------------------

def _import_module(module_name: str):
    """Import (or retrieve from cache) a module by dotted name."""
    if module_name in sys.modules:
        return sys.modules[module_name]
    return importlib.import_module(module_name)


def _collect_imports(source: str) -> list[tuple[str, str | None]]:
    """Return (module_root, alias_or_None) for every import in *source*.

    Both ``import X`` and ``from X import ...`` forms at any nesting level are
    collected so that conditional/guard imports inside functions are caught too.
    """
    tree = ast.parse(source)
    imports: list[tuple[str, str | None]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                imports.append((root, alias.asname))
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                root = node.module.split(".")[0]
                imports.append((root, None))
    return imports


def _is_disallowed(module_root: str) -> bool:
    """True if *module_root* is not stdlib, not the local package, and not
    in the allowed third-party set (numpy / pandas)."""
    if module_root in _STDLIB_NAMES:
        return False
    if module_root in _LOCAL_PACKAGE_ROOTS:
        return False
    if module_root in ALLOWED_THIRD_PARTY:
        return False
    return True


# ---------------------------------------------------------------------------
# Test 1: Exactly five strategy files exist
# ---------------------------------------------------------------------------

@pytest.mark.unit
def test_exactly_five_strategy_files_exist() -> None:
    """The five canonical strategy files defined by the Intraday Strategy Suite
    spec (Requirements 1.1) must all be present in ``algo-engine/strategies/``.

    The assertion checks:
      1. All five required files are present (hard fail if missing).
      2. No *new* files beyond the five canonical ones have been added to the
         directory since the suite was designed (warns via assertion message).
         Pre-existing legacy files that were already present before the spec was
         written are exempted by name.

    Requirements: 1.1
    """
    # Files that pre-date the intraday-strategy-suite spec and are not part of
    # it; they are allowed to co-exist without failing this structural test.
    PRE_EXISTING_LEGACY_FILES: frozenset[str] = frozenset({
        "ema_snap.py",
        "gap_fade.py",
        "mtf_momentum.py",
        "orb_breakout.py",
        "pairs_arbitrage.py",
        "regime_router.py",
        "volatility_squeezev2.py",
        "vwap_reversion.py",
    })

    actual_files = {
        p.name
        for p in _STRATEGIES_DIR.iterdir()
        if p.is_file()
        and p.suffix == ".py"
        and p.name not in ("__init__.py", "base_strategy.py")
    }
    expected = set(EXPECTED_STRATEGY_FILES)

    # 1. All five canonical suite files MUST be present.
    missing = expected - actual_files
    assert not missing, (
        f"The following required strategy files are MISSING: {sorted(missing)}"
    )

    # 2. Any file beyond the five canonical ones that is NOT a known legacy file
    #    signals an unintended addition to the suite and should be flagged.
    unexpected_new = actual_files - expected - PRE_EXISTING_LEGACY_FILES
    assert not unexpected_new, (
        f"New strategy files were added to strategies/ that are not part of the "
        f"Intraday Strategy Suite spec: {sorted(unexpected_new)}. "
        f"Either add them to the suite spec or to PRE_EXISTING_LEGACY_FILES."
    )


# ---------------------------------------------------------------------------
# Test 2: Each strategy file defines a BaseStrategy subclass with on_candle / on_tick
# ---------------------------------------------------------------------------

@pytest.mark.unit
@pytest.mark.parametrize("module_name", EXPECTED_MODULE_NAMES)
def test_strategy_defines_basestrategy_subclass(module_name: str) -> None:
    """Each strategy module exports at least one ``BaseStrategy`` subclass that
    provides concrete ``on_candle`` and ``on_tick`` implementations.

    Requirements: 1.2, 1.3
    """
    from strategies.base_strategy import BaseStrategy  # type: ignore[import]

    module = _import_module(module_name)

    subclasses = [
        cls
        for _name, cls in inspect.getmembers(module, inspect.isclass)
        if issubclass(cls, BaseStrategy) and cls is not BaseStrategy
        and cls.__module__ == module.__name__
    ]

    filename = module_name.split(".")[-1] + ".py"
    assert len(subclasses) >= 1, (
        f"{filename} must define at least one BaseStrategy subclass; found none."
    )

    strategy_cls = subclasses[0]

    for method_name in ("on_candle", "on_tick"):
        method = getattr(strategy_cls, method_name, None)
        assert method is not None, (
            f"{strategy_cls.__name__} in {filename} is missing '{method_name}'."
        )
        assert callable(method), (
            f"{strategy_cls.__name__}.{method_name} must be callable."
        )
        assert not getattr(method, "__isabstractmethod__", False), (
            f"{strategy_cls.__name__}.{method_name} must be concrete, not abstract."
        )


# ---------------------------------------------------------------------------
# Test 3: base_strategy.py is unmodified
# ---------------------------------------------------------------------------

@pytest.mark.unit
def test_base_strategy_unchanged() -> None:
    """``base_strategy.py`` must export an abstract ``BaseStrategy`` class and a
    ``Signal`` dataclass with exactly the eight canonical fields in order.

    Requirements: 1.2
    """
    from strategies.base_strategy import BaseStrategy, Signal  # type: ignore[import]

    # --- BaseStrategy is abstract ---
    assert inspect.isabstract(BaseStrategy), (
        "BaseStrategy must be an abstract class (ABC with unimplemented methods)."
    )

    for method_name in ("on_candle", "on_tick"):
        method = getattr(BaseStrategy, method_name, None)
        assert method is not None, (
            f"BaseStrategy must declare abstract method '{method_name}'."
        )
        assert getattr(method, "__isabstractmethod__", False), (
            f"BaseStrategy.{method_name} must be abstract."
        )

    # --- Signal dataclass with exactly 8 fields ---
    assert dataclasses.is_dataclass(Signal), "Signal must be a dataclass."

    fields = [f.name for f in dataclasses.fields(Signal)]
    expected_fields = [
        "direction",
        "instrument",
        "quantity",
        "price",
        "stop_loss",
        "target",
        "strategy_name",
        "confidence",
    ]
    assert fields == expected_fields, (
        f"Signal field names or order mismatch.\n"
        f"  Expected: {expected_fields}\n"
        f"  Got:      {fields}"
    )


# ---------------------------------------------------------------------------
# Test 4: Import scan – only stdlib, local package, numpy, and pandas
# ---------------------------------------------------------------------------

@pytest.mark.unit
@pytest.mark.parametrize("filename", EXPECTED_STRATEGY_FILES)
def test_no_disallowed_third_party_imports(filename: str) -> None:
    """Each strategy file must import only Python stdlib modules, the local
    ``strategies`` package, numpy, or pandas.  Any other third-party package
    is disallowed (no scipy, ta, pandas_ta, etc.).

    Requirements: 1.8
    """
    path = _STRATEGIES_DIR / filename
    source = path.read_text(encoding="utf-8")
    imports = _collect_imports(source)

    disallowed = sorted({root for root, _ in imports if _is_disallowed(root)})

    assert not disallowed, (
        f"{filename} contains disallowed third-party import(s): {disallowed}. "
        f"Only stdlib, the 'strategies' package, numpy, and pandas are permitted."
    )


# ---------------------------------------------------------------------------
# Test 5: Module docstring completeness
# ---------------------------------------------------------------------------

# Each tuple is (topic_label, list_of_acceptable_keywords).
# Case-insensitive substring match; any one keyword suffices per topic.
_DOCSTRING_REQUIRED_KEYWORDS: list[tuple[str, list[str]]] = [
    ("statistical edge",   ["edge", "statistical edge"]),
    ("entry logic",        ["entry"]),
    ("exit logic",         ["exit"]),
    ("risk management",    ["risk"]),
    ("Config values",      ["config"]),
    ("KPIs",               ["kpi", "kpis", "profit factor", "win rate", "sharpe",
                             "r:r", "reward"]),
    ("failure modes",      ["failure"]),
]


@pytest.mark.unit
@pytest.mark.parametrize("module_name", EXPECTED_MODULE_NAMES)
def test_module_docstring_completeness(module_name: str) -> None:
    """Each strategy module docstring must describe statistical edge,
    entry/exit logic, risk management, recommended Config values, KPIs, and
    failure modes.

    Requirements: 5.7, 6.3, 6.4
    """
    module = _import_module(module_name)
    filename = module_name.split(".")[-1] + ".py"

    doc = module.__doc__
    assert doc, f"{filename} must have a non-empty module docstring."

    doc_lower = doc.lower()
    missing_topics: list[str] = []

    for topic_label, keywords in _DOCSTRING_REQUIRED_KEYWORDS:
        if not any(kw in doc_lower for kw in keywords):
            missing_topics.append(
                f"'{topic_label}' (expected one of: {keywords})"
            )

    assert not missing_topics, (
        f"{filename} module docstring is missing documentation for:\n"
        + "\n".join(f"  - {t}" for t in missing_topics)
    )
