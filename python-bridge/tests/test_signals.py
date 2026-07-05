"""Unit tests for services/backtest/{exits,patterns,signals}.py.

Covers blueprint Section 7.2 properties P-6, P-7, and the E2 exit contract, plus the
calibration properties that keep a signal layer from silently becoming a coin flip.

P-6  No future leakage in a signal generator. Verified by TRUNCATION: recompute every
     generator on a prefix of the data and assert the overlapping rows are bitwise
     identical. If any generator peeked at a future bar, truncation would change its
     output. This is a direct causality proof, stronger and cheaper than a
     correlation test against forward returns, which would conflate leakage with
     genuine predictive edge.
P-7  No cross-symbol leakage. Mutating one symbol's state must not change any other
     symbol's signals (finding S-1).
E2   Stop-before-target, and stops fill AT OR THROUGH the level (finding R-13).
"""

import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.backtest import exits, panel, patterns, signals  # noqa: E402

SYMS = ["BEL", "TCS", "INFY", "RELIANCE", "SBIN", "AXISBANK"]
ALL = list(signals.STRATEGY_REGISTRY)
REAL = panel.PANEL_DIR / "features_5minute.parquet"
needs_panel = pytest.mark.skipif(not REAL.exists(), reason="causal panel not present")

_CACHE: dict = {}


def _panel(strategy_list=None, symbols=None):
    key = (tuple(strategy_list or ALL), tuple(symbols or SYMS))
    if key not in _CACHE:
        _CACHE[key] = panel.load_for_strategies(
            strategy_list or ALL, symbols=symbols or SYMS)[0]
    return _CACHE[key]


# ═══ EXIT BRACKET ═════════════════════════════════════════════════════════════
def test_r_multiple_is_the_single_source_of_truth():
    """The R you request is the R you get -- fixing blueprint Section 1.3.2, where
    every legacy strategy's realised R:R differed from its parameter labels."""
    for rm in (0.5, 1.0, 1.5, 2.0, 2.5, 2.667, 3.0, 5.0):
        for direction in (1, -1):
            b = exits.bracket(2000.0, 20.0, direction, r_mult=rm)
            assert b.realised_r_multiple == pytest.approx(rm, rel=1e-9)


def test_snap_realised_r_is_2_667_not_the_labelled_2_0():
    """The concrete legacy discrepancy, pinned. stop_atr_mult 0.75 and
    target_atr_mult 2.0 actually traded at 2.667:1."""
    assert signals.DEFAULT_R_MULT["snap"] == pytest.approx(2.667, abs=1e-3)
    b = exits.bracket(2000.0, 20.0, 1, r_mult=signals.DEFAULT_R_MULT["snap"])
    assert abs(b.target - b.entry) / b.risk == pytest.approx(2.667, rel=1e-9)


def test_atr_floor_always_governs_a_tight_stop():
    for atr in (0.0, 0.5, 1.0, 5.0, 9.999):
        b = exits.bracket(2000.0, atr, 1, atr_floor_pct=0.005)
        assert b.risk >= 10.0 - 1e-9, f"atr={atr} produced risk {b.risk} < floor 10"
        assert b.floored is True


def test_atr_floor_never_fights_a_wider_atr():
    b = exits.bracket(2000.0, 40.0, 1, atr_floor_pct=0.005)
    assert b.risk == pytest.approx(40.0)
    assert b.floored is False


def test_missing_or_degenerate_atr_falls_to_the_floor():
    for bad in (None, 0.0, -1.0, float("nan"), float("inf"), "x"):
        assert exits.bracket(2000.0, bad, 1).risk == pytest.approx(10.0)


# ── E2: pessimistic intra-bar resolution (finding R-13) ────────────────────────
def test_e2_stop_is_checked_before_target():
    b = exits.bracket(100.0, 5.0, 1, r_mult=2.0)          # stop 95, target 110
    price, reason = exits.first_touch_exit(112.0, 94.0, 100.0, b)
    assert reason == "STOP", "a bar touching both levels must book the STOP"


def test_e2_stop_fills_at_or_through_the_level_not_at_it():
    b = exits.bracket(100.0, 5.0, 1, r_mult=2.0)
    price, reason = exits.first_touch_exit(95.0, 90.0, 90.0, b)   # gapped to 90
    assert reason == "STOP"
    assert price == 90.0, "a stop-market fills at the OPEN when it gaps through"
    assert price < b.stop, "must be worse than the stop level, never better"


def test_e2_short_side_is_also_pessimistic():
    b = exits.bracket(100.0, 5.0, -1, r_mult=2.0)         # stop 105, target 90
    assert exits.first_touch_exit(106.0, 89.0, 100.0, b)[1] == "STOP"
    price, reason = exits.first_touch_exit(110.0, 95.0, 110.0, b)
    assert reason == "STOP" and price == 110.0


def test_e2_clean_levels():
    b = exits.bracket(100.0, 5.0, 1, r_mult=2.0)
    assert exits.first_touch_exit(101.0, 94.0, 100.0, b) == (95.0, "STOP")
    assert exits.first_touch_exit(111.0, 99.0, 100.0, b) == (110.0, "TARGET")
    assert exits.first_touch_exit(101.0, 99.0, 100.0, b) is None


def test_bracket_rejects_impossible_inputs():
    cases = [
        ("entry=0", dict(entry=0.0, direction=1)),
        ("entry=-5", dict(entry=-5.0, direction=1)),
        ("direction=0", dict(entry=100.0, direction=0)),
        ("direction=2", dict(entry=100.0, direction=2)),
        ("r_mult=0", dict(entry=100.0, direction=1, r_mult=0.0)),
        ("r_mult=-1", dict(entry=100.0, direction=1, r_mult=-1.0)),
        ("atr_floor_pct=1.5", dict(entry=100.0, direction=1, atr_floor_pct=1.5)),
        ("atr_floor_pct=-0.1", dict(entry=100.0, direction=1, atr_floor_pct=-0.1)),
    ]
    for label, kwargs in cases:
        with pytest.raises(exits.ExitError):
            exits.bracket(atr=5.0, **kwargs)


# ═══ P-6: NO FUTURE LEAKAGE, PROVEN BY TRUNCATION ════════════════════════════
@needs_panel
def test_p6_signals_are_identical_when_the_future_is_removed():
    """THE causality proof.

    Truncate the panel to its first N bars and recompute every generator. The
    overlapping rows must be bitwise identical. Any generator that read a future
    bar -- a bare `.shift(-1)`, a centred rolling window, a `bfill()` on a
    cross-sectional rank computed over the full universe -- would change its output
    under truncation.
    """
    df = _panel()
    cut = int(len(df) * 0.6)
    trunc = df.iloc[:cut].copy()
    # Only keep whole symbol-days in the truncation so the comparison is like-for-like.
    last_day = trunc["date"].max()
    trunc = trunc[trunc["date"] <= last_day].copy()
    assert len(trunc) > 10_000

    for name in ALL:
        full = signals.generate(df, name)
        part = signals.generate(trunc, name)
        a = full.loc[trunc.index]
        b = part.loc[trunc.index]
        assert a.equals(b), (
            f"{name}: signals changed when the future was removed. "
            f"{int((a != b).sum())} rows differ -- a generator is reading ahead.")


@needs_panel
def test_p6_directional_resolution_takes_the_earliest_signal_of_the_day():
    """Two bugs pinned at once.

    BUG 1: `transform("first")` returns the first ROW's value, not the first
    non-zero, so a symbol-day whose opening bars were flat was discarded --
    `orb` emitted ZERO signals from 3,491 qualifying rows.
    BUG 2: `transform()` BROADCASTS the day's decision onto all 75 bars, so one
    signal-day was reported as 75 "signals" (orb claimed 279,950 instead of 3,732).

    The contract is: exactly ONE non-zero row per symbol-day, and it must be the
    EARLIEST qualifying bar.
    """
    df = _panel(["orb"])
    sig = signals.generate(df, "orb")
    nz = sig[sig != 0]
    assert len(nz) > 0, "orb produced no signals at all"

    keyed = df.loc[nz.index].assign(_s=nz)
    counts = keyed.groupby(["symbol", "date"])["_s"].size()
    assert counts.max() == 1, (
        f"a symbol-day produced {counts.max()} signals; the contract is exactly 1 "
        f"(the transform broadcast bug, finding in _resolve_directional)")
    assert set(counts.unique()) == {1}
    assert len(counts) == len(nz), "every signal must belong to a distinct symbol-day"

    # And it must be the EARLIEST qualifying bar of that day.
    keyed["datetime"] = pd.to_datetime(keyed["datetime"])
    first_of_day = keyed.groupby(["symbol", "date"])["datetime"].transform("min")
    assert (keyed["datetime"] == first_of_day).all(), (
        "a signal was emitted after an earlier qualifying bar on the same day")


@needs_panel
def test_p6_signals_are_only_plus_one_minus_one_or_zero():
    df = _panel()
    for name in ALL:
        s = signals.generate(df, name)
        assert set(s.unique()) <= {-1, 0, 1}, f"{name} produced values outside -1/0/1"


# ═══ P-7: NO CROSS-SYMBOL LEAKAGE ═════════════════════════════════════════════
@needs_panel
def test_p7_mutating_one_symbol_changes_no_other():
    """Finding S-1. Every shift in signals.py is groupby('symbol').shift(1); this
    proves it, per generator, on real data."""
    df = _panel()
    for name in ALL:
        base = signals.generate(df, name)
        mutated = df.copy()
        for col in ("reclaimed_or_high", "squeeze_on", "ema_stack", "d_trend", "vwap_z"):
            if col in mutated.columns:
                r = mutated.index[mutated["symbol"] == "BEL"]
                if len(r):
                    v = int(mutated.loc[r[0], col])
                    mutated.loc[r[0], col] = 1 - v if v in (0, 1) else v
        after = signals.generate(mutated, name)
        changed_other = (base != after)[mutated["symbol"] != "BEL"].any()
        assert not changed_other, (
            f"{name}: signals for OTHER symbols changed when BEL was mutated "
            f"-- cross-symbol leakage (finding S-1)")


@needs_panel
def test_p7_signals_never_depend_on_the_symbol_universe():
    """Restricting the symbol universe must not change existing signals.

    The `cs_rank_*` columns are PRECOMPUTED over all 1,453 symbols by
    build_screener.py:433-462 and frozen into the panel, so they are invariant to
    the subset a caller loads. If a generator's output moves when the universe is
    narrowed, it is recomputing a cross-sectional statistic from a partial slice --
    which is precisely how a "dynamic universe" silently becomes a
    "universe-dependent" one.

    NOTE ON ALIGNMENT: frames must be joined on (symbol, datetime), NEVER on the
    RangeIndex label. Both frames come from a reset_index(drop=True) loader, so
    label 137,301 refers to a completely different row in each. An earlier version
    of this test aligned by label and reported a spurious failure.
    """
    full = panel.load_for_strategies(ALL, symbols=SYMS)[0]
    sub = panel.load_for_strategies(ALL, symbols=["BEL", "TCS"])[0]
    key = ["symbol", "datetime"]
    f = full.set_index(key).sort_index()
    s = sub.set_index(key).sort_index()
    common = s.index.intersection(f.index)
    assert len(common) > 10_000

    def by_key(sig, frame):
        """Re-index a signal Series onto (symbol, datetime). Series has no
        set_index, so the index is built from the frame it was computed on."""
        out = sig.copy()
        out.index = pd.MultiIndex.from_arrays(
            [frame["symbol"].to_numpy(), frame["datetime"].to_numpy()],
            names=key)
        return out.sort_index()

    for name in ALL:
        a = by_key(signals.generate(full, name), full).loc[common]
        b = by_key(signals.generate(sub, name), sub).loc[common]
        assert a.equals(b), (
            f"{name}: narrowing the universe from {len(SYMS)} to 2 symbols changed "
            f"{int((a != b).sum())} existing signals -- a cross-sectional statistic "
            f"is being recomputed from a partial slice")


# ═══ THE VOLUME VETO — the only validated signal in the repository ═════════════
def test_volume_veto_fails_open_when_the_column_is_absent():
    """A data outage must never silently halt every strategy."""
    d = pd.DataFrame({"symbol": ["A"] * 3, "close": [1.0, 2.0, 3.0]})
    assert signals.volume_veto(d).all(), "a missing veto column must permit trading"


def test_volume_veto_treats_nan_as_permitted():
    d = pd.DataFrame({"symbol": ["A"] * 3, "fc15_vol_ratio": [1.0, np.nan, 20.0]})
    v = signals.volume_veto(d)
    assert bool(v.iloc[0]) and bool(v.iloc[1]) and not bool(v.iloc[2])


def test_volume_veto_threshold_is_inclusive_at_eight():
    d = pd.DataFrame({"fc15_vol_ratio": [7.99, 8.0, 8.01]})
    v = signals.volume_veto(d)
    assert list(v) == [True, False, False], ">= 8.0 must block"


@needs_panel
def test_veto_is_measured_against_the_actual_panel_distribution():
    """The veto should be selective but not inert. If fc15_vol_ratio >= 8 never
    occurs, the gate is decorative; if it blocks most rows, something is wrong with
    the column rather than with the strategy."""
    df = _panel()
    v = df["fc15_vol_ratio"]
    blocked = float((v >= signals.VOLUME_VETO_THRESHOLD).mean())
    assert 0.0 < blocked < 0.10, (
        f"veto blocks {blocked:.2%} of rows; expected a small but non-zero fraction")


# ═══ CALIBRATION SANITY ═══════════════════════════════════════════════════════
@needs_panel
def test_every_generator_produces_signals_on_real_data():
    """A generator that emits nothing is indistinguishable from a broken one, and
    the legacy condition-test suite marked five zero-trade scenarios as PASS."""
    df = _panel()
    for name in ALL:
        r = signals.signal_report(df, name)
        assert r["longs"] + r["shorts"] > 0, f"{name} produced ZERO signals on real data"
        assert r["signal_rate_pct"] < 95.0, (
            f"{name} signals on {r['signal_rate_pct']:.1f}% of rows -- that is not a filter")


@needs_panel
def test_signal_report_attributes_the_veto():
    df = _panel()
    for name in ALL:
        on = signals.signal_report(df, name)
        off = signals.signal_report(df, name, veto=False)
        assert off["longs"] + off["shorts"] >= on["longs"] + on["shorts"], (
            f"{name}: disabling the veto REDUCED the signal count, which is impossible")
        assert on["vetoed_pct"] >= 0.0


def test_unknown_strategy_raises():
    with pytest.raises(KeyError):
        signals.generate(pd.DataFrame({"symbol": ["A"]}), "no_such_strategy")


def test_generator_raises_on_missing_required_columns():
    with pytest.raises(KeyError, match="requires panel columns"):
        signals.signals_orb(pd.DataFrame({"symbol": ["A"], "close": [1.0]}))


# ═══ PAIRS ═══════════════════════════════════════════════════════════════════
@needs_panel
def test_pairs_produces_one_series_per_available_pair():
    df = _panel()
    p = signals.signals_pairs(df)
    assert p.shape[1] >= 1
    for col in p.columns:
        assert set(p[col].unique()) <= {-1, 0, 1}


def test_pairs_zero_std_is_guarded():
    """Two identical series give a zero-variance spread; the legacy
    pairs_arbitrage.py divided by an unchecked rolling std."""
    n = 60
    d = pd.DataFrame({
        "symbol": ["TCS"] * n + ["INFY"] * n,
        "datetime": list(pd.date_range("2026-01-01", periods=n, freq="5min")) * 2,
        "close": [100.0] * n * 2,                      # perfectly constant spread
    })
    p = signals.signals_pairs(d)
    assert not p.isna().any().any(), "zero-std spread produced NaN instead of a guard"
    assert (p == 0).all().all(), "a constant spread must produce no signals"


def test_pairs_rejects_degenerate_lookback():
    with pytest.raises(ValueError):
        signals.signals_pairs(pd.DataFrame({"symbol": [], "datetime": [], "close": []}),
                              lookback=1)


# ═══ PATTERNS ═════════════════════════════════════════════════════════════════
@needs_panel
def test_patterns_fire_on_real_data_and_report_zero_counts():
    df = _panel(["stock_types"])
    p = patterns.compute_patterns(df)
    s = patterns.pattern_summary(p)
    fired = [k for k, v in s.items() if k.startswith("pat_") and v]
    assert len(fired) >= 8, f"only {len(fired)} patterns fired on 3 symbols of real data"
    assert "_zero_count_patterns" in s, "zero-count patterns must be reported, not implied"


@needs_panel
def test_patterns_are_causal_by_truncation():
    df = _panel(["stock_types"])
    p_full = patterns.compute_patterns(df)
    cut = int(len(df) * 0.5)
    trunc = df.iloc[:cut].copy()
    trunc = trunc[trunc["date"] <= trunc["date"].max()].copy()
    p_part = patterns.compute_patterns(trunc)
    for col in [c for c in p_full.columns if c.startswith("pat_")]:
        if col in p_part.columns:
            a = p_full[col].loc[trunc.index].fillna(False)
            b = p_part[col].loc[trunc.index].fillna(False)
            assert (a == b).all(), f"{col} changed when the future was removed"


def test_patterns_rejects_bad_input():
    with pytest.raises(ValueError):
        patterns.compute_patterns(pd.DataFrame({"symbol": ["A"]}))
    with pytest.raises(ValueError):
        patterns.compute_patterns(pd.DataFrame(columns=["symbol", "open", "high", "low", "close"]))


# ═══ PROJECTION PLUMBING ══════════════════════════════════════════════════════
@needs_panel
def test_union_projection_covers_every_generator_requirement():
    """A caller must not have to know which projection each strategy needs."""
    cols = set(panel.union_projection(ALL))
    df, _ = panel.load_for_strategies(ALL, symbols=["BEL"])
    for name in ALL:
        signals.generate(df, name)          # raises KeyError if a column is missing
    assert len(cols) > len(panel.BASE_COLUMNS)
