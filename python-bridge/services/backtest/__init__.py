"""WealthOS Unified Backtesting Engine (Domain 53).

This package is the single, vectorized, falsification-gated backtesting engine that
replaces the eleven previously-registered "engines" across `algo-engine/backtester/`,
`python-bridge/services/` and `python-bridge/routers/`.

Design contract (blueprint Section 3, Section 4, Section 7):

  * ONE cost model            -> costs.py
  * ONE position-sizing law   -> sizing.py     (triple clamp + ATR floor, no leverage term)
  * ONE feature panel loader  -> panel.py      (pushdown, sort invariant, no fabrication)
  * ONE metric suite          -> metrics.py    (equity-based, frequency-aware)
  * ONE bracket               -> exits.py      (R-multiple is the single source of truth)
  * ONE signal vocabulary     -> signals.py    (vectorized, groupby('symbol').shift(1))
  * ONE falsification gate    -> wfo.py        (anchored walk-forward, Bonferroni, DSR)

Nothing in this package may fabricate market context. A missing daily column is a
DATA ERROR that raises (see panel.Invariant 3), never a "sensible default".
"""

__all__ = [
    "costs",
    "sizing",
    "panel",
    "metrics",
    "exits",
    "signals",
    "patterns",
    "portfolio",
    "wfo",
    "mc",
    "types",
]

__version__ = "2.0.0"
