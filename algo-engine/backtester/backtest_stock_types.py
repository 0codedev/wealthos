"""Backtest the stock-type detectors (docs/algo/strategy_brief.md) over the
causal feature panel produced by backtester/build_screener.py.

For every (symbol, trading-day) group:
  * Cash segment: classify at decision rows inside the morning window
    (minutes-since-open 45..120, sampled every 15 min). First non-NONE type wins.
  * F&O segment: classify every row from 10:30 (min 75) to 14:45 (min 285).
  * Measure forward return to the 15:15 bar, plus a stop/target trade simulation
    using fractions of prior-day ATR (config: risk.*_datr_frac).
  * Blocked types (TYPE2/TYPE4) are validated: their LONG forward returns should
    be poor — that is what justifies removing them from momentum lists.

Usage:
    python backtester/backtest_stock_types.py --tf 5minute --start 2023-01-01
    python backtester/backtest_stock_types.py --tf 5minute --segment fno
"""

from __future__ import annotations

import os
import sys
import json
import argparse
import datetime as dt
from collections import defaultdict

import numpy as np
import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from screener.stock_types import CONFIG, classify_cash, classify_fno, row_features  # noqa: E402

ALGO_ENGINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PANEL_PATH = os.path.join(ALGO_ENGINE_DIR, "..", "python-bridge", "data", "screener", "features_{tf}.parquet")
REPORT_PATH = os.path.join(ALGO_ENGINE_DIR, "..", "docs", "algo", "stock_type_backtest_report_{segment}.md")
TRADES_PATH = os.path.join(ALGO_ENGINE_DIR, "..", "docs", "algo", "stock_type_backtest_trades_{segment}.csv.gz")

FEATURE_COLS = ["minutes_since_open", "gap_pct", "low_vs_open", "day_range_pos",
                "chg_from_open_pct", "fc_range_pct", "fc15_vol_ratio", "vol_pace_45",
                "vol_stab_45", "body_open30", "d_atr14", "candle_body_fade", "em_coverage",
                "freeze_streak", "push_from_open_pct", "low6_vs_open_pct", "pb_vol_ratio",
                "dist_vwap_pct", "vwap_z", "atr_14"]

CASH_DECISION_MINUTES = [45, 60, 75, 90, 105, 120]  # 10:00 .. 11:15 sampled


def load_panel(tf: str, start: str, segment: str) -> pd.DataFrame:
    cols = ["symbol", "date", "time", "open", "high", "low", "close", "volume",
            "bar_of_day", "warmup"] + FEATURE_COLS
    df = pd.read_parquet(PANEL_PATH.format(tf=tf), columns=cols)
    if start:
        df = df[df["date"] >= dt.date.fromisoformat(start)]
    if segment == "fno":
        # restrict to the F&O universe (config file generated from data/fno_stocks.ts)
        uni_path = os.path.join(ALGO_ENGINE_DIR, "config", "universe_fno.json")
        if os.path.exists(uni_path):
            with open(uni_path) as fh:
                uni = set(json.load(fh))
            df = df[df["symbol"].isin(uni)]
    df = df[df["warmup"] == 0].drop(columns=["warmup"])
    df = df.sort_values(["symbol", "date", "bar_of_day"])
    return df


def simulate_trade(h, l, c, entry_i, entry, stop, target, is_short=False):
    """Walk bars after entry. Conservative: bar touching both stop and target = stop."""
    for j in range(entry_i + 1, len(c)):
        if is_short:
            hit_stop = h[j] >= stop      # stop is ABOVE entry for a short
            hit_tgt = l[j] <= target     # target is BELOW entry for a short
        else:
            hit_stop = l[j] <= stop      # stop is BELOW entry for a long
            hit_tgt = h[j] >= target     # target is ABOVE entry for a long
        if hit_stop:
            return "stop", (entry - stop) if is_short else (stop - entry)
        if hit_tgt:
            return "target", (entry - target) if is_short else (target - entry)
    exit_p = c[-1]
    return "eod", ((entry - exit_p) if is_short else (exit_p - entry))


def run_segment(panel: pd.DataFrame, segment: str) -> tuple:
    risk = CONFIG["risk"]
    if segment == "cash":
        stop_frac, tgt_frac = risk["cash_stop_datr_frac"], risk["cash_target_datr_frac"]
    else:
        stop_frac, tgt_frac = risk["fno_stop_datr_frac"], risk["fno_target_datr_frac"]

    trades = []
    blocked_fwd = []
    groups = panel.groupby(["symbol", "date"], sort=True)
    n_groups = groups.ngroups

    for gi, ((sym, day), g) in enumerate(groups):
        if gi % 10000 == 0:
            print(f"  ...{gi}/{n_groups} day-groups", flush=True)
        g = g.sort_values("bar_of_day")
        mins = g["minutes_since_open"].to_numpy()
        o = g["open"].to_numpy(); h = g["high"].to_numpy()
        l = g["low"].to_numpy(); c = g["close"].to_numpy()
        datr = g["d_atr14"].to_numpy()
        if len(g) < 10 or not np.isfinite(datr[0]) or datr[0] <= 0:
            continue

        # decide which rows to classify
        if segment == "cash":
            rows = [i for i, m in enumerate(mins)
                    if any(abs(m - dm) < 7 for dm in CASH_DECISION_MINUTES)]
            classify = classify_cash
        else:
            rows = [i for i, m in enumerate(mins) if 75 <= m <= 285]
            classify = classify_fno

        fired = False
        blocked_today = None
        for i in rows:
            feats = {k: g[k].iloc[i] for k in FEATURE_COLS}
            feats["close"] = c[i]
            r = classify(feats)
            tid = r["type_id"]
            if tid.startswith(("TYPE2", "TYPE4")) and blocked_today is None:
                blocked_today = (i, tid)
                continue
            if tid == "NONE" or fired or r.get("priority", 9) == 0:
                continue
            if i >= len(c) - 1:  # decision on the last bar: nothing to simulate
                continue
            # fire trade
            entry = c[i]
            datr_i = datr[i]
            if not np.isfinite(datr_i) or datr_i <= 0:
                continue
            stop_d = stop_frac * datr_i
            tgt_d = tgt_frac * datr_i
            short = r["direction"] == "SHORT"
            stop = entry + stop_d if short else entry - stop_d
            target = entry - tgt_d if short else entry + tgt_d
            outcome, pnl = simulate_trade(h, l, c, i, entry, stop, target, is_short=short)
            exit_close = c[-1]
            fwd = (exit_close - entry) / entry * 100.0
            if short:
                fwd = -fwd
            mfe = ((h[i + 1:].max() - entry) if not short else (entry - l[i + 1:].min())) / entry * 100.0
            mae = ((entry - l[i + 1:].min()) if not short else (h[i + 1:].max() - entry)) / entry * 100.0

            # horizon sensitivity: directional edge at +30/60/120 min (direction-adjusted)
            def _fwd(bars: int):
                j = min(i + bars, len(c) - 1)
                if j <= i:
                    return None
                r = (c[j] - entry) / entry * 100.0
                return -r if short else r

            trades.append({
                "symbol": sym, "date": str(day), "type_id": tid, "direction": r["direction"],
                "priority": r["priority"], "decision_minute": round(float(mins[i])),
                "entry": round(float(entry), 2), "outcome": outcome, "pnl_per_share": round(float(pnl), 2),
                "pnl_pct_of_entry": round(float(pnl / entry * 100.0), 3),
                "fwd_ret_to_close_pct": round(float(fwd), 3),
                "fwd_30m_pct": _fwd(6), "fwd_60m_pct": _fwd(12), "fwd_120m_pct": _fwd(24),
                "mfe_pct": round(float(max(mfe, 0.0)), 3), "mae_pct": round(float(max(mae, 0.0)), 3),
                "stop": round(float(stop), 2), "target": round(float(target), 2),
                "gap_pct": r.get("gap_pct"), "session_minutes": r.get("session_minutes"),
            })
            fired = True
            break

        # blocked-stock validation: forward LONG return after a block signal
        if blocked_today is not None and not fired:
            i, tid = blocked_today
            fwd = (c[-1] - c[i]) / c[i] * 100.0
            blocked_fwd.append({"symbol": sym, "date": str(day), "type_id": tid,
                                "fwd_ret_pct": round(float(fwd), 3)})

    return pd.DataFrame(trades), pd.DataFrame(blocked_fwd)


def type_stats(trades: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for tid, t in trades.groupby("type_id"):
        wins = t[t["pnl_per_share"] > 0]
        losses = t[t["pnl_per_share"] <= 0]
        gross_w = wins["pnl_per_share"].sum()
        gross_l = -losses["pnl_per_share"].sum()
        rows.append({
            "type_id": tid, "trades": len(t),
            "hit_rate_pct": round(100.0 * len(wins) / max(1, len(t)), 1),
            "avg_win": round(wins["pnl_per_share"].mean(), 2) if len(wins) else 0.0,
            "avg_loss": round(losses["pnl_per_share"].mean(), 2) if len(losses) else 0.0,
            "expectancy": round(t["pnl_per_share"].mean(), 3),
            "profit_factor": round(gross_w / gross_l, 2) if gross_l > 0 else float("inf"),
            "fwd30m_pct": round(t["fwd_30m_pct"].mean(), 3) if "fwd_30m_pct" in t else None,
            "fwd60m_pct": round(t["fwd_60m_pct"].mean(), 3) if "fwd_60m_pct" in t else None,
            "fwd120m_pct": round(t["fwd_120m_pct"].mean(), 3) if "fwd_120m_pct" in t else None,
            "avg_fwd_ret_pct": round(t["fwd_ret_to_close_pct"].mean(), 3),
            "med_fwd_ret_pct": round(t["fwd_ret_to_close_pct"].median(), 3),
            "target_hit_pct": round(100.0 * (t["outcome"] == "target").mean(), 1),
            "stop_hit_pct": round(100.0 * (t["outcome"] == "stop").mean(), 1),
            "avg_mfe_pct": round(t["mfe_pct"].mean(), 2),
            "avg_mae_pct": round(t["mae_pct"].mean(), 2),
            "active_days": t["date"].nunique(),
        })
    return pd.DataFrame(rows).sort_values("expectancy", ascending=False)


def yearly_stats(trades: pd.DataFrame) -> pd.DataFrame:
    t = trades.copy()
    t["year"] = t["date"].str.slice(0, 4)
    out = t.groupby(["type_id", "year"]).agg(
        trades=("pnl_per_share", "size"),
        hit_rate_pct=("pnl_per_share", lambda s: round(100.0 * (s > 0).mean(), 1)),
        expectancy=("pnl_per_share", "mean"),
    ).reset_index()
    out["expectancy"] = out["expectancy"].round(3)
    return out


def write_report(trades: pd.DataFrame, blocked: pd.DataFrame, args) -> None:
    ts = type_stats(trades)
    lines = [
        "# Stock-Type Backtest Report",
        "",
        f"- Generated: {dt.datetime.now().isoformat(timespec='seconds')}",
        f"- Timeframe: {args.tf} | Segment: {args.segment} | Start: {args.start or 'earliest'}",
        f"- Trade sim: stop = {CONFIG['risk']['cash_stop_datr_frac'] if args.segment == 'cash' else CONFIG['risk']['fno_stop_datr_frac']}x d_atr14,"
        f" target = {CONFIG['risk']['cash_target_datr_frac'] if args.segment == 'cash' else CONFIG['risk']['fno_target_datr_frac']}x d_atr14,"
        " same-bar touch = stop (conservative), exit at close otherwise.",
        "",
        "## Per-type performance",
        "",
        ts.to_markdown(index=False) if len(ts) else "_No trades fired._",
        "",
        "## Yearly stability",
        "",
        yearly_stats(trades).to_markdown(index=False) if len(trades) else "",
        "",
    ]
    if len(blocked):
        bl = blocked.groupby("type_id")["fwd_ret_pct"].agg(
            n="size", mean_fwd_ret_pct="mean", med_fwd_ret_pct="median",
            pct_negative=lambda s: round(100.0 * (s < 0).mean(), 1)).reset_index().round(3)
        lines += [
            "## Blocked types (TYPE2/TYPE4) — forward LONG return after the block fired",
            "",
            "Validation of the brief: these stocks should show poor forward LONG returns.",
            "",
            bl.to_markdown(index=False),
            "",
        ]
    if len(trades):
        lines += ["## Top symbols by expectancy (min 5 trades)", ""]
        sym = trades.groupby(["type_id", "symbol"]).agg(
            n=("pnl_per_share", "size"), expectancy=("pnl_per_share", "mean")).reset_index()
        sym = sym[sym["n"] >= 5].sort_values("expectancy", ascending=False).head(30).round(3)
        lines += [sym.to_markdown(index=False), ""]
    report_path = REPORT_PATH.format(segment=args.segment)
    with open(report_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    print(f"[REPORT] {report_path}")


def main():
    ap = argparse.ArgumentParser(description="Backtest stock-type detectors")
    ap.add_argument("--tf", default="5minute", choices=["5minute", "15minute"])
    ap.add_argument("--segment", default="cash", choices=["cash", "fno"])
    ap.add_argument("--start", default="2023-01-01")
    args = ap.parse_args()

    print(f"[LOAD] {args.tf} panel, segment={args.segment}, start={args.start}")
    panel = load_panel(args.tf, args.start, args.segment)
    print(f"[PANEL] {len(panel):,} rows, {panel['symbol'].nunique()} symbols, "
          f"{panel['date'].nunique()} days")

    trades, blocked = run_segment(panel, args.segment)
    print(f"[DONE] {len(trades)} trades fired, {len(blocked)} blocked-day observations")

    out = trades if len(trades) else pd.DataFrame()
    trades_path = TRADES_PATH.format(segment=args.segment)
    if len(out):
        out.to_csv(trades_path, index=False, compression="gzip")
    print(f"[TRADES] {trades_path}")
    write_report(trades, blocked, args)

    if len(trades):
        print("\n" + type_stats(trades).to_string(index=False))


if __name__ == "__main__":
    main()
