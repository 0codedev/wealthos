"""The nine vectorized signal generators, plus the global volume veto.

TRANSLATION, NOT REWRITE. `algo-engine/strategies/*.py` are imperative per-candle
state machines and are therefore unvectorisable. The 164-column panel already
contains every quantity they compute, as a column. Re-expressing them as array
predicates is a translation: the maths is identical, the execution model is not.

THREE DISCIPLINES, APPLIED UNIFORMLY. Every one of them exists because of a
specific legacy defect:

  1. Every shift goes through `_prev`, which is `groupby('symbol').shift(1)`.
     A bare `.shift(1)` on a panel leaks the previous symbol's state. That is
     finding S-1 and it was LIVE in scanner_backtest.py:112-113.

  2. Every daily-context read is a `d_*` column -- the prior trading day, already
     shifted by build_screener.py:184-186. Nothing is recomputed and nothing is
     invented. The legacy engine substituted the literal (2500.0, 2480.0, 28.0) at
     ten call sites, which manufactured a permanently-bullish regime (finding R-5).

  3. `volume_veto()` is a HARD gate on every strategy. It is the only validated
     quantitative signal in the repository: fc15_vol_ratio >= 8 gives an excess
     forward return of -0.166%, t = -2.93, only 40.6% positive, negative in all four
     years, n = 762 (docs/algo/edge_analysis_report.md:92-94).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# ── the global veto ───────────────────────────────────────────────────────────
VOLUME_VETO_THRESHOLD = 8.0


def volume_veto(d: pd.DataFrame, threshold: float = VOLUME_VETO_THRESHOLD) -> pd.Series:
    """True where the entry is PERMITTED (i.e. NOT a volume-exhaustion spike).

    Named as a veto rather than a signal because that is what the evidence supports:
    it predicts what to AVOID, not what to buy. Never invert it into a short signal
    without independent evidence.

    A missing fc15_vol_ratio column is treated as PERMITTED, because a data outage
    must never silently halt every strategy. Panel Invariant 2 has already removed
    warmup rows, so a NaN here means the column genuinely does not exist.
    """
    if "fc15_vol_ratio" not in d.columns:
        return pd.Series(True, index=d.index)
    v = pd.to_numeric(d["fc15_vol_ratio"], errors="coerce")
    return (v.isna()) | (v < threshold)


# ── causal helpers ────────────────────────────────────────────────────────────
def _prev(d: pd.DataFrame, col: str) -> pd.Series:
    """Causal per-symbol shift. NEVER use a bare d[col].shift(1)."""
    return d.groupby("symbol", sort=False)[col].shift(1)


def _prev2(d: pd.DataFrame, col: str) -> pd.Series:
    """Two bars back, per symbol."""
    return _prev(d, col).groupby(d["symbol"], sort=False).shift(1)


def _resolve_directional(d: pd.DataFrame, up: pd.Series, dn: pd.Series) -> pd.Series:
    """Reduce intraday candidates to ONE SPARSE signal per symbol-day: the earliest
    qualifying bar decides, and it is marked on that bar ONLY.

    TWO BUGS caught here by a zero-signal smoke test and a bar-count audit.

    BUG 1 -- `groupby().transform("first")` returns the first ROW's value, not the
    first non-zero, so any symbol-day whose opening bars were flat was discarded.
    `orb` emitted ZERO signals from 3,491 qualifying rows. Fix: mask the zeros to
    NaN so "first" skips them.

    BUG 2 -- `transform()` then BROADCASTS that one decision onto every row of the
    group, so a single signal-day became 75 non-zero rows (75 five-minute bars).
    `orb` reported 144,725 "signals" that were really ~1,930 signal-days. A count
    that is inflated by the bar count is not a count, and an entry layer fed by it
    would open 75 positions per idea. Fix: keep only the FIRST row of each group.

    RE-ENTRY POLICY IS NOT A SIGNAL-LAYER CONCERN. The strategy bible allows VWAP
    up to two trades a day; that is a portfolio-layer cap (see portfolio.py), not a
    reason for the signal layer to mark every bar.
    """
    sig = pd.Series(np.where(up, 1, np.where(dn, -1, 0)), index=d.index)
    masked = sig.where(sig != 0)
    keyed = d.assign(_s=masked)
    grp = keyed.groupby(["symbol", "date"], sort=False)["_s"]
    decision = grp.transform("first")
    is_first = keyed.index.isin(grp.head(1).index)
    out = decision.where(is_first).fillna(0).astype("int8")
    return out


def _require(d: pd.DataFrame, *cols: str) -> None:
    missing = [c for c in cols if c not in d.columns]
    if missing:
        raise KeyError(
            f"signal generator requires panel columns {missing}. "
            f"Load the panel with a projection that includes them (see panel.PROJECTIONS)."
        )


# ── 1. ORB -- Opening Range Breakout with dead-gap retest ──────────────────────
def signals_orb(d: pd.DataFrame) -> pd.Series:
    """Returns +1 long / -1 short / 0 flat, indexed like `d`.

    `reclaimed_or_high` is the retest-then-resume-through trigger that
    build_screener.py already materialises, i.e. the 3-phase dead-gap logic the
    handoff doc calls "explicitly deferred" (DOMAIN_HANDOFF.md:118-119). It is not
    deferred; it is a column.
    """
    _require(d, "reclaimed_or_high", "reclaimed_or_low", "adx_14", "d_trend",
             "vol_ratio", "cs_rank_liquidity", "bar_of_day", "time_slot")
    elig = (d["cs_rank_liquidity"] > 0.30) & volume_veto(d)
    common = elig & (d["adx_14"] > 20.0) & (d["vol_ratio"] > 1.3) & \
             (d["bar_of_day"] >= 6) & (d["time_slot"] != 2)
    up = common & (d["reclaimed_or_high"] == 1) & (d["plus_di"] > d["minus_di"]) & (d["d_trend"] >= 0)
    dn = common & (d["reclaimed_or_low"] == 1) & (d["minus_di"] > d["plus_di"]) & (d["d_trend"] <= 0)
    return _resolve_directional(d, up, dn)


def score_orb(d: pd.DataFrame) -> pd.Series:
    """Tightest opening range first. cs_rank_or_range is LOW for the tightest OR,
    hence the complement."""
    _require(d, "cs_rank_or_range", "cs_rank_mom_20d", "cs_rank_liquidity")
    return ((1.0 - d["cs_rank_or_range"]) * 0.50
            + d["cs_rank_mom_20d"] * 0.30
            + d["cs_rank_liquidity"] * 0.20)


# ── 2. SNAP -- EMA pullback ────────────────────────────────────────────────────
def signals_snap(d: pd.DataFrame) -> pd.Series:
    _require(d, "ema_9", "ema_stack", "adx_14", "d_ema20", "d_ema50",
             "low", "close", "cs_rank_mom_20d", "time_slot", "vol_ratio")
    elig = (d["cs_rank_liquidity"] > 0.30) & volume_veto(d)
    trend_up, trend_dn = d["ema_stack"] == 1, d["ema_stack"] == -1
    touch_up = (d["low"] <= d["ema_9"] * 1.001) & (d["close"] > d["ema_9"])
    touch_dn = (d["high"] >= d["ema_9"] * 0.999) & (d["close"] < d["ema_9"])
    window = d["time_slot"].isin([1, 3, 4])          # 10:00-11:30, 13:30-15:00
    up = (elig & trend_up & touch_up & (d["adx_14"] > 20.0)
          & (d["d_ema20"] > d["d_ema50"]) & (d["cs_rank_mom_20d"] > 0.80)
          & window & (d["vol_ratio"] > 1.0))
    dn = (elig & trend_dn & touch_dn & (d["adx_14"] > 20.0)
          & (d["d_ema20"] < d["d_ema50"]) & (d["cs_rank_mom_20d"] < 0.20)
          & window & (d["vol_ratio"] > 1.0))
    return _resolve_directional(d, up, dn)


# ── 3. SQUEEZE -- Bollinger-inside-Keltner release ────────────────────────────
def signals_squeeze(d: pd.DataFrame) -> pd.Series:
    """THE FIX for finding S-1: `squeeze_on.shift(1)` is per-symbol via `_prev`."""
    _require(d, "squeeze_on", "squeeze_count", "macd_hist", "bb_upper", "bb_lower", "time_slot")
    prev_on = _prev(d, "squeeze_on")
    prev_count = _prev(d, "squeeze_count")
    release = (d["squeeze_on"] == 0) & (prev_on == 1)
    min_duration = prev_count >= 6                     # 6 x 5m = 30 min of coil
    elig = (d["cs_rank_liquidity"] > 0.30) & volume_veto(d)
    common = elig & release & min_duration & ~d["time_slot"].eq(2)
    up = common & (d["macd_hist"] > 0) & (d["close"] > d["bb_upper"])
    dn = common & (d["macd_hist"] < 0) & (d["close"] < d["bb_lower"])
    return _resolve_directional(d, up, dn)


# ── 4. VWAP -- mean reversion ─────────────────────────────────────────────────
def signals_vwap(d: pd.DataFrame) -> pd.Series:
    """The veto becomes a REQUIREMENT here, not a filter: exhaustion spikes are
    exactly the VWAP dislocations a reversion strategy fades, and t = -2.93
    confirms the fade loses 0.166% MORE than baseline in that bucket."""
    _require(d, "vwap_z", "rsi_2", "d_adx14", "open", "close", "cs_rank_abs_dist_vwap")
    elig = (d["d_adx14"] < 18.0) & volume_veto(d) & (d["cs_rank_abs_dist_vwap"] > 0.90)
    up = elig & (d["vwap_z"] < -2.0) & (d["rsi_2"] <= 15) & (d["close"] > d["open"])
    dn = elig & (d["vwap_z"] > 2.0) & (d["rsi_2"] >= 85) & (d["close"] < d["open"])
    return _resolve_directional(d, up, dn)


# ── 5. GAP -- bimodal fade / continuation ─────────────────────────────────────
def signals_gap(d: pd.DataFrame) -> pd.Series:
    """Column-based first bar, NOT gap_fade.py:261,294's exact `t == 09:25` test.
    A single missing bar used to produce ZERO signals with no warning (finding R-19)."""
    _require(d, "bar_of_day", "gap_pct", "vol_ratio", "open", "close", "d_ema20", "d_ema50")
    first = d["bar_of_day"] == 1
    abs_gap = d["gap_pct"].abs()
    elig = volume_veto(d)
    fade = first & abs_gap.between(0.006, 0.020) & (d["vol_ratio"] < 1.0) & \
        (d["close"] < d["open"]) & (d["d_ema20"] <= d["d_ema50"])
    cont = first & (abs_gap > 0.020) & (d["vol_ratio"] > 2.0) & (d["d_ema20"] > d["d_ema50"])
    up = elig & cont & (d["gap_pct"] > 0)
    dn = elig & ((fade & (d["gap_pct"] < 0)) | (cont & (d["gap_pct"] < 0)))
    return _resolve_directional(d, up, dn)


# ── 6. MTF -- momentum cascade ─────────────────────────────────────────────────
def signals_mtf(d: pd.DataFrame) -> pd.Series:
    """The signal survives from mtf_momentum.py; its Rs 1.00 flat stop does not and
    is replaced by the ATR/floor bracket in exits.py (finding R-17)."""
    _require(d, "ema_stack", "d_trend", "rsi_14", "cs_rank_mom_20d", "adx_14")
    elig = volume_veto(d)
    up = (elig & (d["ema_stack"] == 1) & (d["d_trend"] >= 0) & (d["rsi_14"] > 60)
          & (d["cs_rank_mom_20d"] > 0.80) & (d["adx_14"] > 20))
    dn = (elig & (d["ema_stack"] == -1) & (d["d_trend"] <= 0) & (d["rsi_14"] < 40)
          & (d["cs_rank_mom_20d"] < 0.20) & (d["adx_14"] > 20))
    return _resolve_directional(d, up, dn)


# ── 7. ZSCORE -- reversion ────────────────────────────────────────────────────
def signals_zscore(d: pd.DataFrame) -> pd.Series:
    _require(d, "zscore_20", "d_adx14", "cs_rank_abs_zscore")
    elig = (d["d_adx14"] < 20.0) & volume_veto(d) & (d["cs_rank_abs_zscore"] > 0.90)
    up = elig & (d["zscore_20"] <= -2.0)
    dn = elig & (d["zscore_20"] >= 2.0)
    return _resolve_directional(d, up, dn)


# ── 8. PAIRS -- the one strategy the 1-D panel cannot express ──────────────────
PAIRS: tuple[tuple[str, str], ...] = (
    ("TCS", "INFY"), ("HDFCBANK", "ICICIBANK"), ("AXISBANK", "KOTAKBANK"),
    ("HINDALCO", "TATASTEEL"), ("BPCL", "HPCL"),
)


def signals_pairs(d: pd.DataFrame, lookback: int = 20, z_entry: float = 2.0
                  ) -> pd.DataFrame:
    """Returns a frame with one +1/-1/0 column PER PAIR.

    Pairs need a SECOND-ORDER cross-sectional computation -- a 2-symbol log-price
    spread -- and the panel is 1-D per symbol, so the spread is built here from
    `close`. The zero-standard-deviation guard is explicit; the legacy
    pairs_arbitrage.py divided by an unchecked rolling std.
    """
    if lookback < 2:
        raise ValueError(f"lookback must be >= 2, got {lookback}")
    if "close" not in d.columns or "symbol" not in d.columns:
        raise KeyError("pairs requires 'symbol' and 'close'")
    px = d.pivot_table(index="datetime", columns="symbol", values="close", aggfunc="last").sort_index()
    out = {}
    for a, b in PAIRS:
        if a not in px.columns or b not in px.columns:
            continue
        spread = np.log(px[a] / px[b])
        mu = spread.rolling(lookback, min_periods=lookback).mean()
        sd = spread.rolling(lookback, min_periods=lookback).std()
        z = ((spread - mu) / sd.where(sd > 1e-9)).fillna(0.0)
        col = f"pair_{a}_{b}"
        out[col] = np.where(z < -z_entry, 1, np.where(z > z_entry, -1, 0))
    res = pd.DataFrame(out, index=px.index)
    res.index.name = "datetime"
    return res


# ── the registry ───────────────────────────────────────────────────────────────
STRATEGY_REGISTRY = {
    "orb": signals_orb,
    "snap": signals_snap,
    "squeeze": signals_squeeze,
    "vwap": signals_vwap,
    "gap": signals_gap,
    "mtf": signals_mtf,
    "zscore": signals_zscore,
}

# Calibrated r_multiples. The R is the single source of truth (exits.bracket), and
# `snap` is 2.667 rather than the "2.0" its legacy parameter names implied.
DEFAULT_R_MULT = {
    "orb": 3.0,
    "snap": 2.667,
    "squeeze": 2.0,
    "vwap": 1.6,
    "gap": 3.0,
    "mtf": 3.0,
    "zscore": 1.5,
}


def generate(d: pd.DataFrame, strategy: str, veto: bool = True,
             veto_threshold: float = VOLUME_VETO_THRESHOLD) -> pd.Series:
    """Run one generator. `veto=False` exists only so ablation tests (F-5) can
    measure what the veto is worth; production runs must leave it on."""
    if strategy not in STRATEGY_REGISTRY:
        raise KeyError(f"unknown strategy {strategy!r}; have {sorted(STRATEGY_REGISTRY)}")
    if not veto:
        d = d.copy()
        d["fc15_vol_ratio"] = 0.0            # neutralise the veto for ablation only
    return STRATEGY_REGISTRY[strategy](d)


def signal_report(d: pd.DataFrame, strategy: str, **kw) -> dict:
    """Counts, coverage and veto attribution for one strategy.

    Reports the veto's contribution explicitly, because a strategy whose signal
    count is entirely explained by the veto is not a strategy -- it is the veto
    wearing a strategy's name.
    """
    sig = generate(d, strategy, **kw)
    n = len(sig)
    longs = int((sig == 1).sum())
    shorts = int((sig == -1).sum())
    vetoed = int((~volume_veto(d, kw.get("veto_threshold", VOLUME_VETO_THRESHOLD))).sum())
    days = d["date"].nunique() if "date" in d.columns else 0
    return {
        "strategy": strategy,
        "rows": n,
        "longs": longs,
        "shorts": shorts,
        "flats": n - longs - shorts,
        "signal_rate_pct": (longs + shorts) / n * 100.0 if n else 0.0,
        "distinct_dates": days,
        "signals_per_day": (longs + shorts) / days if days else 0.0,
        "vetoed_rows": vetoed,
        "vetoed_pct": vetoed / n * 100.0 if n else 0.0,
    }
