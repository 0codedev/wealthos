"""Edge analysis: is there ANY region of feature space that predicts intraday movement?

The stock-type backtest showed ~46-47% hit rates at the thresholds I guessed from
docs/algo/strategy_brief.md. Before tuning thresholds, this answers the prior
question: does the feature space contain predictive signal at all?

Method (deliberately simple and honest):
  1. Build a compact "observations" table: for every symbol-day, take the row at a
     fixed decision minute, and attach direction-agnostic forward returns
     (+30/+60/+120 min, to close) plus max-favourable/adverse excursion.
  2. Establish the UNCONDITIONAL BASELINE: mean forward return over ALL symbol-days
     at that decision minute. A long setup in a drifting-up market looks positive
     unless we measure EXCESS over this baseline.
  3. Bucket every classifier feature into deciles and report excess forward return
     per bucket. A bucket with materially positive excess = real edge worth tuning
     into a detector; all-flat = the feature has no predictive power.

Usage:
    python backtester/edge_analysis.py --build          # build observations (one pass)
    python backtester/edge_analysis.py --analyze        # baseline + decile scan
"""

from __future__ import annotations

import os
import sys
import argparse

import numpy as np
import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ALGO_ENGINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PANEL = os.path.join(ALGO_ENGINE_DIR, "..", "python-bridge", "data", "screener", "features_{tf}.parquet")
OBS_PATH = os.path.join(ALGO_ENGINE_DIR, "analysis", "edge_observations_{tf}_m{minute}.parquet")

# Feature vector the classifier uses (post-warmup, causal)
FEATURES = ["gap_pct", "low_vs_open", "day_range_pos", "chg_from_open_pct",
            "fc_range_pct", "fc15_vol_ratio", "vol_pace_45", "vol_stab_45",
            "body_open30", "d_atr14", "candle_body_fade", "em_coverage",
            "freeze_streak", "push_from_open_pct", "low6_vs_open_pct",
            "pb_vol_ratio", "dist_vwap_pct", "vwap_z", "rsi_14", "adx_14",
            "vol_ratio", "rvol_tod", "or_range_pct", "d_rvol", "d_adx14", "d_atr_pct"]

BAR = 5  # minutes per bar
HORIZONS = {"fwd_30m": 6, "fwd_60m": 12, "fwd_120m": 24}


def _chunk(tf: str, minute: int, year: int) -> pd.DataFrame:
    """One year's observations. Reads only needed columns via parquet filters."""
    import datetime as dt
    path = PANEL.format(tf=tf)
    feat_cols = ["symbol", "date", "bar_of_day", "warmup", "minutes_since_open", "close"] + FEATURES
    lo, hi = dt.date(year, 1, 1), dt.date(year, 12, 31)
    flt = [("date", ">=", lo), ("date", "<=", hi)]

    # --- features at the decision bar ---
    df = pd.read_parquet(path, columns=feat_cols, filters=flt)
    df = df[(df["warmup"] == 0) & (df["minutes_since_open"] == minute)].copy()
    if df.empty:
        return df

    # --- forward path for the same year (vectorized, no per-group python) ---
    p = pd.read_parquet(path, columns=["symbol", "date", "bar_of_day", "open", "high", "low", "close"],
                        filters=flt)
    p = p.sort_values(["symbol", "date", "bar_of_day"])
    dec_bar = minute // BAR
    gk = ["symbol", "date"]
    g = p.groupby(gk, sort=False)
    entry_close = g["close"].shift(-dec_bar)
    last_close = g["close"].transform("last")

    # MFE/MAE strictly AFTER the decision bar: reverse-sort, cummax/cummin, then shift
    desc = p.sort_values(gk + ["bar_of_day"], ascending=[True, True, False])
    dg = desc.groupby(gk, sort=False)
    desc["fut_high"] = dg["high"].cummax().groupby([desc["symbol"], desc["date"]], sort=False).shift(1)
    desc["fut_low"] = dg["low"].cummin().groupby([desc["symbol"], desc["date"]], sort=False).shift(1)
    exc = desc[desc["bar_of_day"] == dec_bar][["symbol", "date", "fut_high", "fut_low"]]

    fwd = pd.DataFrame({
        "symbol": p["symbol"], "date": p["date"], "bar_of_day": p["bar_of_day"],
        "entry_close": entry_close,
        "fwd_30m": (p.groupby(gk, sort=False)["close"].shift(-(dec_bar + 6)) - entry_close) / entry_close * 100.0,
        "fwd_60m": (p.groupby(gk, sort=False)["close"].shift(-(dec_bar + 12)) - entry_close) / entry_close * 100.0,
        "fwd_120m": (p.groupby(gk, sort=False)["close"].shift(-(dec_bar + 24)) - entry_close) / entry_close * 100.0,
        "fwd_close": (last_close - entry_close) / entry_close * 100.0,
    })
    fwd = fwd[fwd["bar_of_day"] == dec_bar].drop(columns=["bar_of_day"])
    fwd = fwd.merge(exc, on=gk, how="left")
    fwd["mfe_pct"] = (fwd["fut_high"] - fwd["entry_close"]) / fwd["entry_close"] * 100.0
    fwd["mae_pct"] = (fwd["entry_close"] - fwd["fut_low"]) / fwd["entry_close"] * 100.0
    fwd = fwd.drop(columns=["fut_high", "fut_low"])

    obs = df.merge(fwd, on=gk, how="inner").dropna(subset=["fwd_close"])
    del df, p, fwd, desc, exc
    return obs


def build(tf: str, minute: int):
    frames = []
    for year in (2022, 2023, 2024, 2025, 2026):
        try:
            part = _chunk(tf, minute, year)
        except Exception as e:
            print(f"  [{year}] skipped: {e}", flush=True)
            continue
        if len(part):
            print(f"  [{year}] {len(part):,} rows", flush=True)
            frames.append(part)
    if not frames:
        raise SystemExit(f"no rows at minute {minute}")
    obs = pd.concat(frames, ignore_index=True)
    del frames
    float_cols = obs.select_dtypes(include=["float64"]).columns
    obs[float_cols] = obs[float_cols].astype("float32")
    out = OBS_PATH.format(tf=tf, minute=minute)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    obs.to_parquet(out, index=False, compression="snappy")
    print(f"[SAVED] {out}  ({len(obs):,} rows, {obs['symbol'].nunique()} symbols)", flush=True)
    return out


def analyze(tf: str, minute: int):
    obs = pd.read_parquet(OBS_PATH.format(tf=tf, minute=minute))
    print(f"[ANALYZE] {len(obs):,} observations at minute {minute} "
          f"({obs['symbol'].nunique()} symbols, {obs['date'].nunique()} days)\n")

    base = {k: float(obs[k].mean()) for k in
            ["fwd_30m", "fwd_60m", "fwd_120m", "fwd_close"]}
    print("=== UNCONDITIONAL BASELINE (all symbol-days, same decision minute) ===")
    for k, v in base.items():
        print(f"  {k:12s} mean = {v:+.4f}%   median = {obs[k].median():+.4f}%   "
              f"pct_positive = {(obs[k] > 0).mean() * 100:.1f}%")
    print(f"  avg MFE = {obs['mfe_pct'].mean():.3f}%   avg MAE = {obs['mae_pct'].mean():.3f}%\n")

    print("=== DECILE SCAN: excess forward return vs baseline (fwd_close) ===")
    print("(excess > 0 means this feature bucket beat the average stock)\n")
    results = []
    for f in FEATURES:
        if f not in obs.columns:
            continue
        s = obs[f]
        try:
            dec = pd.qcut(s, 10, labels=False, duplicates="drop")
        except ValueError:
            continue
        if dec.nunique() < 4:
            continue
        grp = obs.groupby(dec)
        agg = grp.agg(
            lo=(f, "min"), hi=(f, "max"),
            n=("fwd_close", "size"),
            excess_30m=("fwd_30m", lambda x: x.mean() - base["fwd_30m"]),
            excess_60m=("fwd_60m", lambda x: x.mean() - base["fwd_60m"]),
            excess_close=("fwd_close", lambda x: x.mean() - base["fwd_close"]),
            pct_pos=("fwd_close", lambda x: (x > 0).mean() * 100),
            mfe=("mfe_pct", "mean"),
        ).reset_index()
        best = agg.loc[agg["excess_close"].idxmax()]
        worst = agg.loc[agg["excess_close"].idxmin()]
        spread = best["excess_close"] - worst["excess_close"]
        results.append({
            "feature": f, "decile_spread": round(spread, 3),
            "best_bucket": f"[{best['lo']:.3g},{best['hi']:.3g}]",
            "best_n": int(best["n"]), "best_excess_close": round(best["excess_close"], 3),
            "best_excess_60m": round(best["excess_60m"], 3),
            "best_pct_pos": round(best["pct_pos"], 1), "best_mfe": round(best["mfe"], 3),
            "worst_bucket": f"[{worst['lo']:.3g},{worst['hi']:.3g}]",
            "worst_excess_close": round(worst["excess_close"], 3),
        })
    res = pd.DataFrame(results).sort_values("decile_spread", ascending=False)
    print(res.to_string(index=False))

    print("\n=== TOP PREDICTIVE FEATURES (by decile spread) ===")
    top = res.head(6)
    for _, row in top.iterrows():
        f = row["feature"]
        s = obs[f]
        dec = pd.qcut(s, 10, labels=False, duplicates="drop")
        agg = obs.groupby(dec).agg(
            lo=(f, "min"), hi=(f, "max"), n=("fwd_close", "size"),
            exc_close=("fwd_close", lambda x: x.mean() - base["fwd_close"]),
            exc_60m=("fwd_60m", lambda x: x.mean() - base["fwd_60m"]),
            pct_pos=("fwd_close", lambda x: (x > 0).mean() * 100)).round(3)
        print(f"\n--- {f} ---")
        print(agg.to_string())

    out = OBS_PATH.format(tf=tf, minute=minute).replace(
        "edge_observations", "edge_scan").replace(".parquet", ".md")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(f"# Edge Scan — {tf}, decision minute {minute}\n\n")
        fh.write("## Unconditional baseline\n\n")
        for k, v in base.items():
            fh.write(f"- {k}: mean {v:+.4f}%, median {obs[k].median():+.4f}%, "
                     f"positive {(obs[k] > 0).mean() * 100:.1f}%\n")
        fh.write(f"- avg MFE {obs['mfe_pct'].mean():.3f}%, avg MAE {obs['mae_pct'].mean():.3f}%\n\n")
        fh.write("## Decile spread per feature (excess vs baseline, to close)\n\n")
        fh.write(res.to_markdown(index=False))
    print(f"\n[REPORT] {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tf", default="5minute")
    ap.add_argument("--minute", type=int, default=75, help="decision minute (75=10:30 IST)")
    ap.add_argument("--build", action="store_true")
    ap.add_argument("--analyze", action="store_true")
    args = ap.parse_args()
    if args.build or not args.analyze:
        build(args.tf, args.minute)
    if args.analyze or not args.build:
        analyze(args.tf, args.minute)


if __name__ == "__main__":
    main()