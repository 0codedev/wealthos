"""The feature panel loader. ONE access path to the 6.0M-row causal Parquet store.

This is the single most valuable asset in the repository and, before this module,
it was unreachable from the entire `python-bridge/` backtesting surface. Measured
state of `python-bridge/data/screener/features_5minute.parquet` (pyarrow-verified):

    6,016,015 rows | 164 physical columns | 6 row groups | 2.23 GB
    1,453 symbols | 2022-12-07 .. 2026-09-03 | build_seconds 447.6 | errors []

SINGLE-SYMBOL FILTERED READ: 0.15 s (row-group pruning works on `symbol`).

THREE INVARIANTS. These are the deliverable, not the plumbing.

  INVARIANT 1 -- symbol-major sort.
      `signals.py` uses groupby('symbol').shift(1). Without a guaranteed sort,
      shift(1) leaks the PREVIOUS SYMBOL's state into the current symbol's
      trigger. This is not hypothetical: the legacy scanner applied a bare
      `.shift(1)` to an unsorted panel (scanner_backtest.py:112-113) and
      `screener_data.load_panel` performs no sort (`:63-64`).

  INVARIANT 2 -- warmup is a HARD gate.
      The panel's `warmup` column is 1 while `ema_200` is unseeded (the first 200
      rows per symbol). Those rows carry fabricated indicator values. They must
      never reach a signal generator.

  INVARIANT 3 -- NO FABRICATED MARKET CONTEXT. THE MOST IMPORTANT LINE HERE.
      If any `d_*` (shifted daily context) column is NULL, this raises. It does
      NOT substitute a default. The legacy engine substituted the literal
      `(2500.0, 2480.0, 28.0)` at TEN call sites, which silently manufactured a
      permanently-bullish, permanently-trending regime and, for `update_prev_close
      (2500.0)` on a Rs 193 stock, a 1194% "gap" that flipped gap-fade into a no-op
      long. A research engine that invents its own market context will always
      report a positive result, because the invented context is permissive.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger("backtest.panel")

PANEL_DIR = Path(__file__).resolve().parents[2] / "data" / "screener"
TIMEFRAMES = ("5minute", "15minute", "day")

# Columns present on every panel, whatever the strategy.
BASE_COLUMNS: tuple[str, ...] = (
    "symbol", "datetime", "date", "open", "high", "low", "close", "volume",
    "atr_14", "atr_pct", "bar_of_day", "bars_to_close", "minutes_since_open",
    "time_slot", "warmup", "fc15_vol_ratio", "cs_rank_liquidity", "vol_ratio",
)

# Per-strategy column projections. Reading 18 columns instead of 164 is the
# difference between a 0.15 s load and a multi-second full-panel materialisation.
PROJECTIONS: dict[str, tuple[str, ...]] = {
    "orb": ("adx_14", "plus_di", "minus_di", "d_trend", "d_ema20", "d_ema50",
            "rvol_tod", "or_high", "or_low", "or_range_pct", "or_mid", "day_open",
            "broke_or_high_today", "broke_or_low_today", "retested_or_high",
            "retested_or_low", "reclaimed_or_high", "reclaimed_or_low",
            "cs_rank_or_range", "cs_rank_mom_20d"),
    # Phase 1B, corrected: rsi_2, rsi_14, bb_width_pct and d_ema200 were ALREADY
    # in the 2.2 GB panel. An earlier audit concluded they were "unimplementable"
    # because it probed a *projection* -- the subset of columns this strategy
    # requests -- rather than the panel schema. `rsi_2`/`rsi_14` are requested by
    # `vwap` and `mtf`; `bb_width_pct` by `squeeze`; `d_ema200` by no strategy at
    # all, which is why it looked absent. No rebuild is required to use any of
    # them, and the committed artifact must not be regenerated to "add" columns
    # it already contains.
    "snap": ("ema_9", "ema_21", "ema_50", "ema_stack", "ema9_slope", "ema21_slope",
             "adx_14", "d_ema20", "d_ema50", "d_ema200", "d_trend", "cs_rank_mom_20d",
             "rsi_2", "rsi_14", "vol_ratio", "cs_rank_liquidity", "low", "high",
             "close", "open"),
    "squeeze": ("bb_mid", "bb_upper", "bb_lower", "bb_width_pct", "bb_pctb",
                "kc_mid", "kc_upper", "kc_lower", "squeeze_on", "squeeze_count",
                "macd", "macd_signal", "macd_hist", "cs_rank_squeeze", "cs_rank_or_range"),
    "vwap": ("vwap", "dist_vwap_pct", "vwap_sigma", "vwap_z",
             "vwap_upper_1sd", "vwap_lower_1sd", "vwap_upper_2sd", "vwap_lower_2sd",
             "rsi_2", "rsi_14", "d_adx14", "cs_rank_abs_dist_vwap"),
    "gap": ("prev_close", "prev_high", "prev_low", "prev_open", "gap_pct",
            "d_ema20", "d_ema50", "rvol_tod", "cs_rank_abs_gap"),
    "mtf": ("ema_9", "ema_21", "ema_50", "ema_stack", "adx_14", "d_trend",
            "d_ema20", "d_ema50", "rsi_14", "roc_20", "cs_rank_mom_20d"),
    "zscore": ("std_20", "zscore_20", "zscore_50", "d_adx14", "cs_rank_abs_zscore"),
    "pairs": (),
    "router": ("d_adx14", "d_ema20", "d_ema50", "d_trend", "cs_rank_ret_1",
               "cs_rank_mom_20d", "adx_14"),
    "stock_types": ("gap_pct", "low_vs_open", "day_range_pos", "chg_from_open_pct",
                    "fc_range_pct", "vol_pace_45", "vol_stab_45", "body_open30",
                    "d_atr14", "candle_body_fade", "em_coverage", "freeze_streak",
                    "push_from_open_pct", "low6_vs_open_pct", "pb_vol_ratio",
                    "dist_vwap_pct", "vwap_z", "rsi_14"),
}

# Every `d_` column, for Invariant 3.
DAILY_PREFIX = "d_"


class DataIntegrityError(RuntimeError):
    """Raised when the panel is missing, incomplete, or would require fabricated
    context to produce a result. This is the counterpart to the legacy engine's
    silent `(2500, 2480, 28)` substitution."""


@dataclass(frozen=True)
class PanelInfo:
    path: str
    timeframe: str
    rows: int
    symbols: int
    date_min: object
    date_max: object
    warmup_rows_dropped: int
    daily_null_rows: int
    coverage: dict

    def as_dict(self) -> dict:
        return {
            "path": self.path,
            "timeframe": self.timeframe,
            "rows": self.rows,
            "symbols": self.symbols,
            "date_min": str(self.date_min),
            "date_max": str(self.date_max),
            "warmup_rows_dropped": self.warmup_rows_dropped,
            "daily_null_rows": self.daily_null_rows,
            "coverage": self.coverage,
        }


def panel_path(timeframe: str = "5minute") -> Path:
    if timeframe not in TIMEFRAMES:
        raise DataIntegrityError(f"timeframe must be one of {TIMEFRAMES}, got {timeframe!r}")
    p = PANEL_DIR / f"features_{timeframe}.parquet"
    if not p.exists():
        raise DataIntegrityError(
            f"Feature panel not found at {p}. Rebuild with: "
            f"python algo-engine/backtester/build_screener.py --tf {timeframe}"
        )
    return p


def union_projection(strategies: list[str] | tuple[str, ...] | None = None,
                     timeframe: str = "5minute") -> list[str]:
    """The BASE columns plus every strategy-specific column for `strategies`.

    Without this, a caller running several strategies in one pass has to know which
    projection each one needs, and a mismatch shows up as a KeyError deep inside a
    signal generator rather than at the call site. Pass None to get the full 164.
    """
    if strategies is None:
        return available_columns(timeframe)
    cols: list[str] = list(BASE_COLUMNS)
    for s in strategies:
        if s == "pairs":
            continue                      # pairs derives its own spread from `close`
        for c in PROJECTIONS.get(s, ()):
            if c not in cols:
                cols.append(c)
    have = set(available_columns(timeframe))
    return [c for c in cols if c in have]


def load_for_strategies(strategies: list[str] | tuple[str, ...],
                        timeframe: str = "5minute",
                        symbols: list[str] | None = None,
                        from_date: str | None = None,
                        to_date: str | None = None,
                        drop_warmup: bool = True,
                        enforce_daily_integrity: bool = True,
                        ) -> tuple[pd.DataFrame, PanelInfo]:
    """Load one panel carrying the union of projections for `strategies`."""
    import pyarrow.parquet as pq

    path = panel_path(timeframe)
    cols = union_projection(strategies, timeframe)

    filters = []
    if symbols:
        filters.append(("symbol", "in", [s.upper() for s in symbols]))
    if from_date:
        filters.append(("date", ">=", pd.Timestamp(from_date).date()))
    if to_date:
        filters.append(("date", "<=", pd.Timestamp(to_date).date()))
    try:
        tbl = pq.read_table(path, columns=cols, filters=filters or None)
    except Exception as e:
        raise DataIntegrityError(f"Failed reading panel {path}: {e}") from e

    df = tbl.to_pandas()
    if df.empty:
        raise DataIntegrityError("Panel query returned ZERO rows; refusing to continue.")
    df = df.sort_values(["symbol", "datetime"], kind="mergesort").reset_index(drop=True)
    _assert_group_monotonic(df, "symbol", "datetime")

    n_warmup = int((df["warmup"] == 1).sum()) if "warmup" in df.columns else 0
    if drop_warmup and n_warmup:
        df = df[df["warmup"] == 0].copy().reset_index(drop=True)

    daily_cols = [c for c in df.columns if c.startswith(DAILY_PREFIX)]
    daily_null = 0
    if enforce_daily_integrity and daily_cols:
        mask = df[daily_cols].isna().any(axis=1)
        daily_null = int(mask.sum())
        if daily_null:
            raise DataIntegrityError(
                f"{daily_null} rows have NULL shifted-daily context in {daily_cols}. "
                f"REFUSING to fabricate daily state."
            )
    info = PanelInfo(path=str(path), timeframe=timeframe, rows=len(df),
                     symbols=int(df["symbol"].nunique()),
                     date_min=df["date"].min(), date_max=df["date"].max(),
                     warmup_rows_dropped=n_warmup, daily_null_rows=daily_null,
                     coverage=_coverage(df))
    log.info("panel loaded for %s: %s rows | %d symbols | %s..%s",
             list(strategies), f"{len(df):,}", info.symbols, info.date_min, info.date_max)
    return df, info


def available_columns(timeframe: str = "5minute") -> list[str]:
    import pyarrow.parquet as pq
    return list(pq.ParquetFile(panel_path(timeframe)).schema.names)


def _resolve_columns(requested: tuple[str, ...], timeframe: str) -> list[str]:
    """Intersect the requested projection with what the panel actually has.

    The panel is 164 columns today; an older or a newer build may differ. Silently
    dropping a missing column would let a signal generator fail on a NameError far
    from the cause, so the drop is logged loudly.
    """
    have = set(available_columns(timeframe))
    want = list(dict.fromkeys(BASE_COLUMNS + tuple(requested)))
    keep = [c for c in want if c in have]
    missing = [c for c in want if c not in have]
    if missing:
        log.warning("panel %s: %d requested columns absent, dropping: %s",
                    timeframe, len(missing), missing)
    return keep


def load_panel(timeframe: str = "5minute",
               strategy: str = "_base",
               symbols: list[str] | None = None,
               from_date: str | None = None,
               to_date: str | None = None,
               drop_warmup: bool = True,
               enforce_daily_integrity: bool = True) -> tuple[pd.DataFrame, PanelInfo]:
    """Load the causal feature panel with all three invariants enforced.

    Returns (dataframe, PanelInfo). PanelInfo carries the coverage diagnostics the
    blueprint requires in every report (Section 4.6) so that the 45-symbols-in-2023
    vs 207-symbols-in-2026 coverage confound is visible rather than silent.

    Parameters
    ----------
    strategy      : key into PROJECTIONS; "_base" for the common column set.
    symbols       : None = whole panel. A list enables row-group filter pushdown.
    from_date     : inclusive ISO date string, or None.
    to_date       : inclusive ISO date string, or None.
    """
    import pyarrow.parquet as pq

    path = panel_path(timeframe)
    cols = _resolve_columns(PROJECTIONS.get(strategy, ()), timeframe)

    filters = []
    if symbols:
        filters.append(("symbol", "in", [s.upper() for s in symbols]))
    if from_date:
        filters.append(("date", ">=", pd.Timestamp(from_date).date()))
    if to_date:
        filters.append(("date", "<=", pd.Timestamp(to_date).date()))

    try:
        tbl = pq.read_table(path, columns=cols, filters=filters or None)
    except Exception as e:
        raise DataIntegrityError(f"Failed reading panel {path}: {e}") from e

    df = tbl.to_pandas()
    if df.empty:
        scope = f"symbols={symbols}" if symbols else "whole panel"
        if from_date or to_date:
            scope += f" {from_date or '..'}..{to_date or '..'}"
        raise DataIntegrityError(
            f"Panel query returned ZERO rows ({scope}). Refusing to return an empty "
            f"panel -- an empty result is indistinguishable from 'no signals' and "
            f"must never be reported as a successful backtest."
        )

    # ── INVARIANT 1: symbol-major sort ────────────────────────────────────────
    df = df.sort_values(["symbol", "datetime"], kind="mergesort").reset_index(drop=True)
    _assert_group_monotonic(df, "symbol", "datetime")

    # ── INVARIANT 2: warmup is a hard gate ────────────────────────────────────
    n_warmup = int((df["warmup"] == 1).sum()) if "warmup" in df.columns else 0
    if drop_warmup and n_warmup:
        df = df[df["warmup"] == 0].copy().reset_index(drop=True)
        if df.empty:
            raise DataIntegrityError(
                f"All {n_warmup} rows were warmup rows (ema_200 unseeded). "
                f"The panel range is too short for this strategy."
            )

    # ── INVARIANT 3: NO FABRICATED MARKET CONTEXT ─────────────────────────────
    daily_cols = [c for c in df.columns if c.startswith(DAILY_PREFIX)]
    daily_null = 0
    if enforce_daily_integrity and daily_cols:
        mask = df[daily_cols].isna().any(axis=1)
        daily_null = int(mask.sum())
        if daily_null:
            offenders = sorted({s for s in df.loc[mask, "symbol"].unique()})[:8]
            raise DataIntegrityError(
                f"{daily_null} rows ({daily_null / len(df):.2%}) have NULL shifted-daily "
                f"context in {daily_cols}. Affected symbols include {offenders}. "
                f"REFUSING to fabricate daily state (the legacy engine substituted the "
                f"literal (2500.0, 2480.0, 28.0) at 10 call sites, which silently "
                f"manufactured a permanently-bullish regime). Re-run build_screener.py "
                f"for the affected symbols, or pass enforce_daily_integrity=False "
                f"ONLY if you understand that the result will be invalid."
            )

    coverage = _coverage(df)
    info = PanelInfo(
        path=str(path), timeframe=timeframe, rows=len(df),
        symbols=int(df["symbol"].nunique()),
        date_min=df["date"].min(), date_max=df["date"].max(),
        warmup_rows_dropped=n_warmup, daily_null_rows=daily_null, coverage=coverage,
    )
    log.info("panel loaded: %s rows | %d symbols | %s..%s | warmup dropped %d | daily nulls %d",
             f"{len(df):,}", info.symbols, info.date_min, info.date_max, n_warmup, daily_null)
    return df, info


def _assert_group_monotonic(df: pd.DataFrame, group: str, order: str) -> None:
    """Fail loudly if the panel is not grouped/sorted as Invariant 1 requires."""
    if df.empty:
        return
    prev_sym = df[group].to_numpy()[:-1]
    prev_ord = df[order].to_numpy()[:-1]
    cur_sym = df[group].to_numpy()[1:]
    cur_ord = df[order].to_numpy()[1:]
    same = prev_sym == cur_sym
    if np.any(same & (cur_ord < prev_ord)):
        raise DataIntegrityError(
            f"Panel is not sorted by ({group}, {order}) within groups. "
            f"groupby('{group}').shift(1) would leak across symbols. "
            f"This is blueprint finding S-1 and must never be tolerated."
        )


def _assert_no_duplicate_keys(df: pd.DataFrame) -> int:
    """Count duplicate (symbol, datetime) keys. A duplicate is a data defect, not noise."""
    n = int(df.duplicated(["symbol", "datetime"]).sum())
    if n:
        log.warning("panel has %d duplicate (symbol, datetime) keys", n)
    return n


def _coverage(df: pd.DataFrame) -> dict:
    """Per-date cross-sectional depth.

    The 75,815-bar scan and the FNO portfolio report both span a period in which
    the tradable universe grew ~4.6x (45 symbols/day in 2023 vs 207 in 2026,
    per docs/algo/DOMAIN_HANDOFF.md:179-181). Any cross-sectional result over that
    window is coverage-confounded unless this is reported alongside it.
    """
    if df.empty or "date" not in df.columns:
        return {}
    per_date = df.groupby("date")["symbol"].nunique()
    return {
        "eligible_per_day_mean": float(per_date.mean()),
        "eligible_per_day_min": int(per_date.min()),
        "eligible_per_day_max": int(per_date.max()),
        "distinct_dates": int(per_date.shape[0]),
    }


def coverage_truncated_by_date(df: pd.DataFrame, min_symbols: int = 45) -> float:
    """Fraction of trading dates whose eligible universe is at or above `min_symbols`.

    Used by the pre-promotion checklist: a run whose universe is below the 45-symbol
    floor on more than 5% of dates is coverage-confounded and must not be promoted.
    """
    if df.empty or "date" not in df.columns:
        return 0.0
    per_date = df.groupby("date")["symbol"].nunique()
    return float((per_date >= min_symbols).mean())


def split_by_symbol(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Split a sorted panel into per-symbol frames.

    VectorBT's `Portfolio.from_signals` is a numba-compiled SEQUENTIAL O(n) pass per
    column, so a full-universe run must be per-symbol 1-D columns, batched. A 2-D
    6,016,015 x 1,453 matrix is 8.74 billion cells = 70 GB per float64 column and
    cannot be built (blueprint Section 3.6.3).
    """
    return {str(s): g.reset_index(drop=True) for s, g in df.groupby("symbol", sort=True)}


def load_duckdb_panel(symbol: str,
                      timeframe: str = "1minute",
                      start_date: str | None = None,
                      end_date: str | None = None,
                      columns: list[str] | None = None) -> pd.DataFrame:
    """Sub-250ms zero-copy DuckDB streaming connector for underlying & feature panels.

    Queries directly against:
      1. `data/underlying/<symbol>/<timeframe>/data.parquet` (pure OHLCV bars)
      2. `data/screener/features_<timeframe>.parquet` (precomputed feature panel)
    """
    import duckdb

    tf_clean = "1minute" if timeframe in ("1m", "1minute", "1min") else (
        "5minute" if timeframe in ("5m", "5minute", "5min") else (
            "15minute" if timeframe in ("15m", "15minute", "15min") else (
                "day" if timeframe in ("day", "daily", "1d") else timeframe
            )
        )
    )

    sym_clean = symbol.upper().strip()
    underlying_path = Path(__file__).resolve().parents[2] / "data" / "underlying" / sym_clean / tf_clean / "data.parquet"
    screener_path = Path(__file__).resolve().parents[2] / "data" / "screener" / f"features_{tf_clean}.parquet"

    conn = duckdb.connect(database=":memory:")

    if underlying_path.exists():
        cols_clause = ", ".join(columns) if columns else "*"
        query = f"SELECT {cols_clause} FROM read_parquet(?)"
        params = [str(underlying_path).replace("\\", "/")]
        conditions = []
        if start_date:
            conditions.append("timestamp >= ?")
            params.append(start_date)
        if end_date:
            conditions.append("timestamp <= ?")
            params.append(end_date)
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY timestamp ASC"
        df = conn.execute(query, params).df()
        if "timestamp" in df.columns and "datetime" not in df.columns:
            df["datetime"] = pd.to_datetime(df["timestamp"])
            df["date"] = df["datetime"].dt.date
        if "symbol" not in df.columns:
            df["symbol"] = sym_clean
        return df

    elif screener_path.exists():
        cols_clause = ", ".join(columns) if columns else "*"
        query = f"SELECT {cols_clause} FROM read_parquet(?) WHERE symbol = ?"
        params = [str(screener_path).replace("\\", "/"), sym_clean]
        if start_date:
            query += " AND date >= ?"
            params.append(pd.Timestamp(start_date).date())
        if end_date:
            query += " AND date <= ?"
            params.append(pd.Timestamp(end_date).date())
        query += " ORDER BY datetime ASC"
        df = conn.execute(query, params).df()
        return df

    else:
        raise DataIntegrityError(f"No Parquet data found for symbol {sym_clean} at timeframe {tf_clean}")
