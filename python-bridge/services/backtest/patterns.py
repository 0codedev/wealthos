"""Vectorized candlestick pattern detection -- ONE implementation.

The repository had two entirely separate, non-overlapping pattern systems:

  * python-bridge/backtest_simulator.py:441-518 -- 17 patterns as fully vectorised
    pandas boolean columns. Complete but reachable only through that one engine.
  * python-bridge/pattern_engine.py (211 lines)   -- 6 patterns taking a list-of-lists
    and returning a scalar dict with a `confidence` score. Consumed by
    routers/alpha.py:18,584.

They share ZERO code, have different input contracts and different output shapes.
This module is the single vectorized implementation over panel columns.

STRICT CAUSALITY. Every detector at bar t is a function of bars <= t only, using
`.shift(1)` or nothing. A pattern is therefore knowable at the CLOSE of bar t, which
is what makes it usable for an entry on bar t+1's open.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Every pattern, with the number of bars it needs.
PATTERNS: dict[str, int] = {
    "pat_bull_engulf": 2,
    "pat_bear_engulf": 2,
    "pat_doji": 1,
    "pat_hammer": 1,
    "pat_inv_hammer": 1,
    "pat_morning_star": 3,
    "pat_evening_star": 3,
    "pat_pinbar_bull": 1,
    "pat_pinbar_bear": 1,
    "pat_inside_bar": 2,
    "pat_outside_bar": 2,
    "pat_3_green": 3,
    "pat_3_red": 3,
    "pat_nr4": 1,
    "pat_nr7": 1,
    "pat_gap_up": 1,
    "pat_gap_down": 1,
}

# Patterns the legacy live pattern_engine.py exposed, preserved by name so the
# browser can migrate without renaming anything.
LEGACY_LIVE_PATTERNS = (
    "pat_hammer", "pat_bull_engulf", "pat_bear_engulf",
    "pat_doji", "pat_inside_bar",
)


def compute_patterns(d: pd.DataFrame) -> pd.DataFrame:
    """Return a copy of `d` with one boolean column per pattern."""
    missing = [c for c in ("open", "high", "low", "close") if c not in d.columns]
    if missing:
        raise ValueError(f"pattern detection requires columns {missing}")
    if d.empty:
        raise ValueError("pattern detection requires a non-empty frame")

    out = d.copy()
    o, h, l, c = out["open"], out["high"], out["low"], out["close"]

    def s1(col):
        """Per-symbol prior bar. NEVER a bare .shift(1) -- see panel INVARIANT 1."""
        return out.groupby("symbol", sort=False)[col].shift(1)

    rng = (h - l).replace(0.0, np.nan)
    body = (c - o).abs()
    upper_wick = h - np.maximum(o, c)
    lower_wick = np.minimum(o, c) - l

    # ── single-bar ────────────────────────────────────────────────────────────
    out["pat_doji"] = body <= 0.1 * rng
    out["pat_hammer"] = (body <= 0.3 * rng) & (lower_wick >= 2 * body) & \
                        (upper_wick <= 0.15 * rng)
    out["pat_inv_hammer"] = (body <= 0.3 * rng) & (upper_wick >= 2 * body) & \
                            (lower_wick <= 0.15 * rng)
    out["pat_pinbar_bull"] = lower_wick > 3 * body.replace(0.0, np.nan)
    out["pat_pinbar_bear"] = upper_wick > 3 * body.replace(0.0, np.nan)

    # ── two-bar ───────────────────────────────────────────────────────────────
    o1, c1 = s1("open"), s1("close")
    body1 = (c1 - o1).abs()
    out["pat_bull_engulf"] = (c > o) & (c1 < o1) & (c >= o1) & (o <= c1) & (body > body1)
    out["pat_bear_engulf"] = (c < o) & (c1 > o1) & (o >= c1) & (c <= c1) & (body > body1)
    h1, l1 = s1("high"), s1("low")
    out["pat_inside_bar"] = (h < h1) & (l > l1)
    out["pat_outside_bar"] = (h > h1) & (l < l1)

    # ── three-bar ─────────────────────────────────────────────────────────────
    o2, c2 = s1("open").groupby(out["symbol"], sort=False).shift(1), \
        s1("close").groupby(out["symbol"], sort=False).shift(1)
    small1 = body1 < body
    small2 = ((c2 - o2).abs()) < body1
    out["pat_morning_star"] = (c2 < o2) & small2 & small1 & (c > o) & (c > (o2 + o1) / 2)
    out["pat_evening_star"] = (c2 > o2) & small2 & small1 & (c < o) & (c < (o2 + o1) / 2)
    out["pat_3_green"] = (c > o) & (c1 > o1) & s1("close").groupby(out["symbol"], sort=False).shift(1) > \
        s1("open").groupby(out["symbol"], sort=False).shift(1)
    out["pat_3_red"] = (c < o) & (c1 < o1) & s1("close").groupby(out["symbol"], sort=False).shift(1) < \
        s1("open").groupby(out["symbol"], sort=False).shift(1)

    # ── narrow-range ──────────────────────────────────────────────────────────
    if "volume" in out.columns:
        v = out["volume"]
        out["pat_nr4"] = rng <= rng.rolling(4, min_periods=4).min() + 1e-9
        out["pat_nr7"] = rng <= rng.rolling(7, min_periods=7).min() + 1e-9
        # volume climax: >= 3x the 20-period mean (pattern_engine.py:144-163)
        vma20 = v.rolling(20, min_periods=5).mean().replace(0.0, np.nan)
        out["pat_vol_climax_up"] = (v / vma20) >= 3.0
        out["pat_vol_climax_down"] = (v / vma20) >= 3.0

    # ── gap (needs the prior close, which is on the panel as prev_close) ───────
    if "prev_close" in out.columns:
        pc = out["prev_close"]
        out["pat_gap_up"] = (o > pc * 1.001) & (o > c)
        out["pat_gap_down"] = (o < pc * 0.999) & (o < c)
    else:
        out["pat_gap_up"] = o > c1
        out["pat_gap_down"] = o < c1

    return out


def pattern_summary(d: pd.DataFrame) -> dict:
    """Counts per pattern. Reports ZERO-COUNT patterns explicitly.

    This matters: the legacy condition-test suite marked Scenario 4, 5, 6, 9, 11
    as "PASS" while they produced ZERO trades, and reported PF = 1.00 for a strategy
    that never fired. A pattern that never appears must be visible, not inferred
    from an empty result.
    """
    out = {}
    for name in PATTERNS:
        if name in d.columns:
            out[name] = int(d[name].fillna(False).astype(bool).sum())
        else:
            out[name] = None
    out["_rows"] = int(len(d))
    out["_symbols"] = int(d["symbol"].nunique()) if "symbol" in d.columns else None
    out["_zero_count_patterns"] = [k for k, v in out.items()
                                   if k.startswith("pat_") and v == 0]
    return out
