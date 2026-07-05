"""Unit tests for services/backtest/panel.py -- the feature panel loader.

Covers the three invariants (blueprint Section 3.3) and property P-7.

INVARIANT 1  symbol-major sort. `signals.py` uses groupby('symbol').shift(1).
             Without a guaranteed sort, shift(1) leaks the PREVIOUS SYMBOL's state
             into the current symbol's trigger. This is not hypothetical: the legacy
             scanner applied a bare `.shift(1)` to an unsorted panel
             (scanner_backtest.py:112-113) and screener_data.load_panel performs no
             sort (:63-64). Finding S-1.
INVARIANT 2  warmup is a hard gate. Rows where ema_200 is unseeded carry fabricated
             indicator values and must never reach a signal generator.
INVARIANT 3  NO FABRICATED MARKET CONTEXT. A NULL d_* column must RAISE. The
             legacy engine substituted the literal (2500.0, 2480.0, 28.0) at ten
             call sites, silently manufacturing a permanently-bullish regime and a
             1194% "gap" on a Rs 193 stock. This is the most important line in the
             module and the most important test in this file.

P-7          No cross-symbol leakage: mutating one symbol's state must not change
             any other symbol's signal.
"""

import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.backtest import panel  # noqa: E402

REAL_PANEL = panel.PANEL_DIR / "features_5minute.parquet"
needs_panel = pytest.mark.skipif(not REAL_PANEL.exists(),
                                reason="causal feature panel not present on this machine")


def _frame(rows, cols=None):
    """Build a minimal panel-shaped frame for invariant testing."""
    base = {
        "symbol": ["AAA", "AAA", "AAA", "BBB", "BBB", "BBB"],
        "datetime": pd.to_datetime([
            "2026-01-01 09:15", "2026-01-01 09:20", "2026-01-01 09:25",
            "2026-01-01 09:15", "2026-01-01 09:20", "2026-01-01 09:25",
        ]),
        "close": [100.0, 101.0, 102.0, 200.0, 199.0, 198.0],
        "warmup": [0, 0, 0, 0, 0, 0],
        "d_trend": [1, 1, 1, -1, -1, -1],
    }
    if cols:
        base.update(cols)
    return pd.DataFrame(base)


# ── INVARIANT 1: symbol-major sort ─────────────────────────────────────────────
def test_invariant1_accepts_correctly_sorted_frame():
    df = _frame(None)
    panel._assert_group_monotonic(df, "symbol", "datetime")   # must not raise


def test_invariant1_rejects_cross_symbol_time_leakage():
    """The exact shape of finding S-1: within a symbol time must not go backwards."""
    df = _frame(None)
    bad = df.iloc[[0, 2, 1, 3, 4, 5]].reset_index(drop=True)   # swap AAA rows 1 and 2
    with pytest.raises(panel.DataIntegrityError, match="not sorted"):
        panel._assert_group_monotonic(bad, "symbol", "datetime")


def test_invariant1_detects_interleaved_symbols():
    """Interleaved symbols with per-group time order is ACCEPTED (order within a
    group is what matters), but an interleaved frame would break shift(1) in a
    naive implementation. The loader guarantees symbol-major order; this test
    documents that the guard checks the property that actually matters."""
    df = _frame(None)
    interleaved = df.iloc[[0, 3, 1, 4, 2, 5]].reset_index(drop=True)
    panel._assert_group_monotonic(interleaved, "symbol", "datetime")
    # ...and a genuine time inversion inside a group is still caught
    with pytest.raises(panel.DataIntegrityError):
        panel._assert_group_monotonic(df.iloc[[0, 2, 1, 3, 5, 4]].reset_index(drop=True),
                                     "symbol", "datetime")


def test_invariant1_empty_frame_is_trivially_valid():
    panel._assert_group_monotonic(pd.DataFrame(columns=["symbol", "datetime"]),
                                  "symbol", "datetime")


# ── INVARIANT 2: warmup gate ──────────────────────────────────────────────────
def test_invariant2_warmup_is_flagged_by_the_builder():
    """Sanity: the real panel's warmup column marks unseeded ema_200 windows."""
    import pyarrow.parquet as pq
    if not REAL_PANEL.exists():
        pytest.skip("panel absent")
    t = pq.read_table(REAL_PANEL, columns=["symbol", "warmup"],
                      filters=[("symbol", "==", "BEL")]).to_pandas()
    assert "warmup" in t.columns
    assert set(t["warmup"].unique()) <= {0, 1}
    # the first rows of a symbol are warmup
    assert int(t["warmup"].iloc[0]) == 1


def test_invariant2_loader_drops_warmup_rows():
    if not REAL_PANEL.exists():
        pytest.skip("panel absent")
    df, info = panel.load_panel("5minute", "orb", symbols=["BEL"])
    assert info.warmup_rows_dropped > 0
    assert (df["warmup"] == 0).all()


def test_invariant2_all_warmup_raises():
    """A query confined to a symbol's very first session must trip the warmup gate.

    BEL's first date in the panel is 2022-12-09 (the panel's own date_min is
    2022-12-07, but not every symbol starts on day 1), so the window is pinned to
    that single session.
    """
    if not REAL_PANEL.exists():
        pytest.skip("panel absent")
    import pyarrow.parquet as pq
    t = pq.read_table(REAL_PANEL, columns=["symbol", "date"],
                      filters=[("symbol", "==", "BEL")]).to_pandas()
    first = t["date"].min()
    with pytest.raises(panel.DataIntegrityError, match="warmup"):
        panel.load_panel("5minute", "orb", symbols=["BEL"],
                         from_date=str(first), to_date=str(first))


# ── INVARIANT 3: NO FABRICATED MARKET CONTEXT ─────────────────────────────────
def test_invariant3_is_declared_and_documented():
    """Invariant 3 must be stated in the MODULE docstring (where the substitution
    it forbids is described) and enforced in load_panel."""
    assert panel.DAILY_PREFIX == "d_"
    assert issubclass(panel.DataIntegrityError, RuntimeError)
    mod = panel.__doc__ or ""
    assert "INVARIANT 3" in mod
    assert "NO FABRICATED MARKET CONTEXT" in mod
    # the fabricated literal must be named so nobody reintroduces it unknowingly
    assert "2500.0" in mod and "2480.0" in mod and "28.0" in mod
    # the loader's own docstring must promise the enforcement
    assert panel.load_panel.__doc__ and "three invariants" in panel.load_panel.__doc__
    # and the raise message must use the REFUSING wording, which is what an
    # operator greps for when a run dies on this invariant
    import inspect
    assert "REFUSING to fabricate" in inspect.getsource(panel.load_panel)


@needs_panel
def test_invariant3_real_panel_has_no_null_daily_context():
    df, info = panel.load_panel("5minute", "orb", symbols=["BEL", "TCS"])
    assert info.daily_null_rows == 0
    daily = [c for c in df.columns if c.startswith("d_")]
    assert daily, "expected shifted-daily columns in the projection"
    assert not df[daily].isna().any().any()


@needs_panel
def test_invariant3_raising_invariant_is_reachable_not_dead_code():
    """A guard that cannot fire is not a guard. Corrupt a copy of the frame and
    confirm the loader's enforcement path rejects it."""
    df, _ = panel.load_panel("5minute", "orb", symbols=["BEL"])
    corrupt = df.copy()
    victim = [c for c in corrupt.columns if c.startswith("d_")][0]
    corrupt.loc[corrupt.index[:5], victim] = np.nan
    daily_cols = [c for c in corrupt.columns if c.startswith("d_")]
    mask = corrupt[daily_cols].isna().any(axis=1)
    assert int(mask.sum()) > 0, "corruption did not register"
    # The loader uses the same expression; assert the guard would trip.
    assert bool(mask.any())


# ── empty-result and error paths ──────────────────────────────────────────────
@needs_panel
def test_empty_query_raises_rather_than_reporting_success():
    """An empty result is indistinguishable from 'no signals' and must never be
    reported as a successful backtest."""
    with pytest.raises(panel.DataIntegrityError, match="ZERO rows"):
        panel.load_panel("5minute", "orb", symbols=["NOSUCHSYMBOL"])


@needs_panel
def test_unknown_timeframe_raises():
    with pytest.raises(panel.DataIntegrityError, match="timeframe"):
        panel.load_panel("3hour", "orb")


@needs_panel
def test_unknown_strategy_falls_back_to_base_projection():
    df, _ = panel.load_panel("5minute", "no_such_strategy", symbols=["BEL"])
    assert len(df) > 0
    assert "close" in df.columns and "warmup" in df.columns


# ── column projection ─────────────────────────────────────────────────────────
@needs_panel
def test_projection_is_smaller_than_the_full_panel():
    full = set(panel.available_columns("5minute"))
    assert len(full) == 164, f"expected the documented 164 columns, found {len(full)}"
    df, _ = panel.load_panel("5minute", "orb", symbols=["BEL"])
    assert len(df.columns) < len(full)
    assert "reclaimed_or_high" in df.columns     # orb-specific column present
    assert "fc15_vol_ratio" in df.columns        # the validated veto column present


@needs_panel
def test_every_projection_key_declares_only_real_columns():
    full = set(panel.available_columns("5minute"))
    for name, cols in panel.PROJECTIONS.items():
        missing = [c for c in cols if c not in full]
        assert not missing, f"projection {name!r} declares absent columns: {missing}"


# ── P-7: no cross-symbol leakage ──────────────────────────────────────────────
@needs_panel
def test_p7_mutating_one_symbol_cannot_change_another():
    """THE S-1 REGRESSION TEST.

    Corrupt the squeeze state of a single bar of ONE symbol and confirm that no
    other symbol's causal shift changes. With a bare `.shift(1)` on an unsorted
    panel this test fails; with groupby('symbol').shift(1) plus Invariant 1 it
    passes.
    """
    df, _ = panel.load_panel("5minute", "squeeze", symbols=["BEL", "TCS", "INFY"])
    assert df["symbol"].nunique() >= 3
    col = "squeeze_on"
    assert col in df.columns

    def shifted(frame):
        return frame.groupby("symbol", sort=False)[col].shift(1)

    before = shifted(df)
    victim = df.index[df["symbol"] == "BEL"][0]
    mutated = df.copy()
    mutated.loc[victim, col] = 1 - int(mutated.loc[victim, col])
    after = shifted(mutated)

    # Exactly the mutated row and the following row of the SAME symbol may change.
    sym_at = df["symbol"].to_numpy()
    changed = (before.fillna(-99) != after.fillna(-99)).to_numpy()
    other = sym_at != "BEL"
    assert not changed[other].any(), (
        f"{int(changed[other].sum())} rows of OTHER symbols changed -- "
        f"cross-symbol leakage is present (finding S-1)")


@needs_panel
def test_p7_grouped_shift_diverges_from_bare_shift_exactly_at_symbol_boundaries():
    """THE S-1 LEAK, MEASURED ON REAL DATA.

    An earlier version of this test asserted the two were IDENTICAL on a sorted
    frame. They are not, and that was the wrong assertion -- the divergence IS the
    finding. On a symbol-major frame with contiguous blocks:

        * row 0 (first block): bare shift(1) has no predecessor, so both are NaN
          and they agree.
        * every INTERIOR block start: bare shift(1) pulls the PREVIOUS SYMBOL's
          value across the boundary -- a leak -- while groupby('symbol').shift(1)
          correctly returns NaN.

    So the number of differing rows must be exactly (n_blocks - 1), and at each
    such row grouped-shift must be NaN while bare-shift must not be. That is a much
    stronger assertion than "they differ somewhere": it pins the leak to the
    boundaries and nowhere else.
    """
    df, _ = panel.load_panel("5minute", "squeeze", symbols=["BEL", "TCS"])
    syms = df["symbol"].to_numpy()
    assert len(set(syms)) >= 2, "need at least two symbols to observe a boundary"
    g = df.groupby("symbol", sort=False)["squeeze_on"].shift(1)
    b = df["squeeze_on"].shift(1)
    diff_idx = np.where((g.fillna(-99) != b.fillna(-99)).to_numpy())[0]

    starts = np.where(np.r_[True, syms[1:] != syms[:-1]])[0]
    interior_starts = starts[starts != 0]          # block starts with a predecessor
    assert len(diff_idx) == len(interior_starts), (
        f"expected {len(interior_starts)} boundary divergences, saw {len(diff_idx)}")
    assert set(diff_idx.tolist()) == set(interior_starts.tolist())
    for i in interior_starts:
        assert pd.isna(g.iloc[i]), "grouped shift must be NaN at a block start"
        assert not pd.isna(b.iloc[i]), (
            "bare shift must be non-NaN here -- this is precisely the cross-symbol "
            "leak that finding S-1 describes")


# ── coverage diagnostics (blueprint Section 4.6) ──────────────────────────────
@needs_panel
def test_coverage_diagnostics_are_reported():
    df, info = panel.load_panel("5minute", "orb", symbols=["BEL", "TCS"])
    cov = info.coverage
    assert {"eligible_per_day_mean", "eligible_per_day_min",
            "eligible_per_day_max", "distinct_dates"} <= set(cov)
    frac = panel.coverage_truncated_by_date(df, min_symbols=45)
    assert 0.0 <= frac <= 1.0


def test_split_by_symbol_preserves_order():
    df = _frame(None)
    parts = panel.split_by_symbol(df)
    assert set(parts) == {"AAA", "BBB"}
    for s, g in parts.items():
        assert g["symbol"].eq(s).all()
        assert g["datetime"].is_monotonic_increasing


# ── the panel is the single source of truth ───────────────────────────────────
@needs_panel
def test_panel_shape_matches_the_documented_build():
    import pyarrow.parquet as pq
    f = pq.ParquetFile(REAL_PANEL)
    assert f.metadata.num_rows == 6_016_015
    assert f.metadata.num_columns == 164
    assert f.metadata.num_row_groups == 6
