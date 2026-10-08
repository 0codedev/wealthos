"""Fast reader for the precomputed Screener Feature Dataset.

The heavy indicator math lives in ``build_screener.py`` and is run once. Strategy backtests
import THIS module to load the panel (optionally filtered by date / symbol / columns) in a
couple of seconds, then express their logic as boolean/score operations on existing columns.

Typical usage in a strategy backtest:

    from backtester.screener_data import load_panel, scan_top_n

    panel = load_panel("15minute", from_date="2024-01-01")
    # e.g. ORB-style long candidates: broke above opening range, trending, liquid
    cand = panel[(panel.dist_or_high_pct > 0) & (panel.adx_14 > 20) & (panel.warmup == 0)]
    # each day keep only the 5 highest-quality names by a chosen rank column
    chosen = scan_top_n(cand, score_col="cs_rank_rvol", top_n=5)
"""

from __future__ import annotations

import os
import pyarrow.parquet as pq
import pyarrow.compute as pc
import pandas as pd

ALGO_ENGINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCREENER_DIR = os.path.abspath(os.path.join(ALGO_ENGINE_DIR, "..", "python-bridge", "data", "screener"))


def panel_path(tf: str = "15minute") -> str:
    return os.path.join(SCREENER_DIR, f"features_{tf}.parquet")


def load_panel(tf: str = "15minute", from_date: str = None, to_date: str = None,
               symbols=None, columns=None) -> pd.DataFrame:
    """Load the feature panel, optionally filtered (push-down filters = fast).

    from_date/to_date: 'YYYY-MM-DD' strings (inclusive).
    symbols: iterable of symbols to keep.
    columns: subset of columns to read (always includes the keys symbol/datetime/date/time).
    """
    path = panel_path(tf)
    if not os.path.exists(path):
        raise FileNotFoundError(f"panel not found: {path} -- run build_screener.py --tf {tf}")

    filt = None
    if from_date:
        fd = pd.to_datetime(from_date)
        filt = (pc.field("datetime") >= pc.scalar(fd)) if filt is None else \
            filt & (pc.field("datetime") >= pc.scalar(fd))
    if to_date:
        td = pd.to_datetime(to_date) + pd.Timedelta(days=1)
        f2 = pc.field("datetime") < pc.scalar(td)
        filt = f2 if filt is None else filt & f2
    if symbols is not None:
        f3 = pc.is_in(pc.field("symbol"), pa_set(symbols))
        filt = f3 if filt is None else filt & f3

    cols = None
    if columns is not None:
        keys = ["symbol", "datetime", "date", "time"]
        cols = keys + [c for c in columns if c not in keys]

    table = pq.read_table(path, columns=cols, filters=filt)
    return table.to_pandas()


def pa_set(symbols):
    import pyarrow as pa
    return pa.array(list(symbols))


def scan_top_n(candidates: pd.DataFrame, score_col: str, top_n: int = 5,
               ascending: bool = False) -> pd.DataFrame:
    """From a pre-filtered candidate frame, keep the top-N per trading day by score_col."""
    if candidates.empty:
        return candidates
    ranked = candidates.sort_values(["date", score_col], ascending=[True, ascending])
    return ranked.groupby("date", group_keys=False).head(top_n).reset_index(drop=True)
