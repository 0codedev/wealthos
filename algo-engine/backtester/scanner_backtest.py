"""Panel-driven cross-sectional backtest engine (Phase 1).

Reads the precomputed Screener Feature Panel and runs a strategy that is defined
DECLARATIVELY as operations on existing feature columns. The engine handles, uniformly
for every strategy:

  * candidate generation (boolean filter on panel columns, one entry/symbol/day)
  * cross-sectional daily selection (rank by a chosen column, keep top-N)
  * max-concurrent-position cap + shared leverage margin
  * a scaled-exit ladder (33% @1R, 33% @2R, trail the runner) with breakeven move
  * realistic transaction costs
  * walk-forward reporting (in-sample vs out-of-sample split)

A "strategy" is just an entry in the STRATEGIES registry: filters, a score column, and a
stop distance. No per-candle indicator recompute — all features come from the panel.

Usage:
    python backtester/scanner_backtest.py --strategy orb
    python backtester/scanner_backtest.py --strategy orb --train-end 2024-12-31
"""

from __future__ import annotations

import os
import sys
import argparse

import numpy as np
import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backtester.run_backtest import get_dynamic_qty, calculate_transaction_costs
from backtester.portfolio_scanner import simulate_exit
from backtester.screener_data import load_panel

CAPITAL = 100_000.0
LEVERAGE = 5.0
RISK_PCT = 0.02
TOP_N = 5
MAX_CONCURRENT = 3
TIME_STOP_BARS = 16


def compute_costs(entry: float, legs: list, sym: str) -> float:
    """Realistic intraday-equity cost for a scaled exit (1 buy order + N sell orders).

    Fixes the bug of charging a full round-trip per partial leg. Models:
      - brokerage min(Rs.20, 0.03% of order value) PER ACTUAL ORDER (1 entry + N exits)
      - STT 0.025% on the sell side only
      - NSE exchange txn 0.00335% + SEBI 0.0001% on total turnover
      - stamp duty 0.003% on the buy side only
      - GST 18% on (brokerage + exchange + sebi)
      - slippage 0.01% per fill (entry once + each exit leg)
    """
    total_qty = sum(lq for _, lq, _ in legs)
    if total_qty <= 0:
        return 0.0
    buy_val = entry * total_qty
    sell_val = sum(px * lq for px, lq, _ in legs)
    turnover = buy_val + sell_val
    brokerage = min(20.0, 0.0003 * buy_val)
    for px, lq, _ in legs:
        brokerage += min(20.0, 0.0003 * px * lq)
    stt = 0.00025 * sell_val
    exch = 0.0000335 * turnover
    sebi = 0.000001 * turnover
    stamp = 0.00003 * buy_val
    gst = 0.18 * (brokerage + exch + sebi)
    slippage = 0.0001 * (buy_val + sell_val)
    return brokerage + stt + exch + sebi + stamp + gst + slippage


# ---------------------------------------------------------------------------
# Declarative strategy registry
# ---------------------------------------------------------------------------
# Each strategy provides, per side, a boolean filter over panel columns plus a
# cross-sectional score column for daily ranking and an ATR-multiple stop.

STRATEGIES = {
    # Opening-Range Breakout: confirmed breaks aligned with the daily trend, on a volume
    # surge, selecting the TIGHTEST opening ranges (coiled = best, like the original ORB).
    "orb": {
        "tf": "15minute",
        "score": "or_range_pct", "score_ascending": True,   # tightest range first
        "stop_atr_mult": 1.5,
        "target_atr_mult": 3.0,
        "partial_exit": False,  # Range-based full exit target (Phase B)
        "entry_after_bar": 2, "no_new_entry_min": 300,
        "long":  lambda d: (d.reclaimed_or_high == 1) & (d.adx_14 > 20) & (d.d_trend >= 0) & (d.vol_ratio > 1.3),
        "short": lambda d: (d.reclaimed_or_low == 1) & (d.adx_14 > 20) & (d.d_trend <= 0) & (d.vol_ratio > 1.3),
    },
    # EMA Snap: pullback entry in the direction of the strong daily trend
    "snap": {
        "tf": "15minute",
        "score": "cs_rank_mom_20d", "score_ascending": False,
        "stop_atr_mult": 0.75,
        "target_atr_mult": 2.0,
        "partial_exit": False,
        "entry_after_bar": 2, "no_new_entry_min": 300,
        "long":  lambda d: (d.close > d.ema_21) & (d.adx_14 > 25) & (d.d_trend >= 0) & (d.low <= d.ema_9 * 1.001) & (d.close > d.ema_9) & (d.cs_rank_mom_20d > 0.8),
        "short": lambda d: (d.close < d.ema_21) & (d.adx_14 > 25) & (d.d_trend <= 0) & (d.high >= d.ema_9 * 0.999) & (d.close < d.ema_9) & (d.cs_rank_mom_20d < 0.2),
    },
    # Volatility Squeeze: BB inside KC compression release
    "squeeze": {
        "tf": "5minute",
        "score": "bb_width_pct", "score_ascending": True,
        "stop_atr_mult": 1.5,
        "target_atr_mult": 3.0,
        "partial_exit": False,
        "entry_after_bar": 2, "no_new_entry_min": 240,
        "long":  lambda d: (d.squeeze_on == 0) & (d.squeeze_on.shift(1) == 1) & (d.squeeze_count.shift(1) >= 6) & (d.macd_hist > 0),
        "short": lambda d: (d.squeeze_on == 0) & (d.squeeze_on.shift(1) == 1) & (d.squeeze_count.shift(1) >= 6) & (d.macd_hist < 0),
    },
    # Gap Fade: fade exhaustive opening gaps
    "gap": {
        "tf": "5minute",
        "score": "gap_pct", "score_ascending": False,
        "stop_atr_mult": 1.5,
        "target_atr_mult": 2.0,
        "partial_exit": False,
        "entry_after_bar": 1, "no_new_entry_min": 60,
        "long":  lambda d: (d.gap_pct < -1.0) & (d.close > d.open) & (d.vol_ratio < 1.0),
        "short": lambda d: (d.gap_pct > 1.0) & (d.close < d.open) & (d.vol_ratio < 1.0),
    },
    # VWAP Reversion: mean reversion on extreme VWAP standard deviation stretches
    "vwap": {
        "tf": "15minute",
        "score": "vwap_z", "score_ascending": False,
        "stop_atr_mult": 1.5,
        "target_atr_mult": 2.0,
        "partial_exit": False,
        "entry_after_bar": 2, "no_new_entry_min": 300,
        "long":  lambda d: (d.vwap_z < -2.0) & (d.d_adx14 < 18),
        "short": lambda d: (d.vwap_z > 2.0) & (d.d_adx14 < 18),
    },
    # MTF Momentum: multi-timeframe trend alignment
    "mtf": {
        "tf": "15minute",
        "score": "cs_rank_mom_20d", "score_ascending": False,
        "stop_atr_mult": 1.5,
        "target_atr_mult": 3.0,
        "partial_exit": False,
        "entry_after_bar": 2, "no_new_entry_min": 300,
        "long":  lambda d: (d.close > d.ema_50) & (d.d_trend >= 0) & (d.rsi_14 > 60) & (d.cs_rank_mom_20d > 0.8),
        "short": lambda d: (d.close < d.ema_50) & (d.d_trend <= 0) & (d.rsi_14 < 40) & (d.cs_rank_mom_20d < 0.2),
    }
}


# ---------------------------------------------------------------------------
# Custom Exit Simulation (Phase B)
# ---------------------------------------------------------------------------

def simulate_exit_custom(cand: dict, qty: int, sdef: dict):
    if sdef.get("partial_exit", True):
        # Fall back to standard portfolio exit (the 1R/2R/trail ladder)
        return simulate_exit(cand, qty, TIME_STOP_BARS)
        
    direction = cand["direction"]
    entry = cand["entry"]
    stop = cand["stop"]
    sym = cand["sym"]
    R = abs(entry - stop)
    target_mult = sdef.get("target_atr_mult", 2.0)
    target = entry + target_mult * R/sdef["stop_atr_mult"] if direction == "BUY" \
        else entry - target_mult * R/sdef["stop_atr_mult"]
        
    highs, lows, closes, times = cand["highs"], cand["lows"], cand["closes"], cand["times"]
    nbars = len(closes)
    long = direction == "BUY"
    
    legs = []
    exit_dt = cand["entry_dt"]
    reason = "EOD"
    
    for i in range(nbars):
        h, l, c = highs[i], lows[i], closes[i]
        exit_dt = times[i]
        
        # Check stop loss
        if (l <= stop if long else h >= stop):
            legs.append((stop, qty, "STOP"))
            reason = "STOP"
            break
        # Check target
        if (h >= target if long else l <= target):
            legs.append((target, qty, "TARGET"))
            reason = "TARGET"
            break
            
    if not legs:
        last_close = closes[-1] if nbars > 0 else entry
        legs.append((last_close, qty, "EOD"))
        reason = "EOD"
        
    gross = 0.0
    costs = 0.0
    for px, lq, _ in legs:
        leg_pnl = (px - entry) * lq if long else (entry - px) * lq
        gross += leg_pnl
        costs += calculate_transaction_costs(entry, px, lq, sym, True)
        
    return gross, costs, exit_dt, reason, legs


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

def build_candidates(panel: pd.DataFrame, sdef: dict) -> pd.DataFrame:
    """One candidate per symbol per day (first qualifying bar), with side + score + stop."""
    base = (panel.warmup == 0) & (panel.bar_of_day >= sdef["entry_after_bar"]) \
        & (panel.minutes_since_open <= sdef["no_new_entry_min"]) & panel.atr_14.notna()

    parts = []
    for side in ("long", "short"):
        f = sdef.get(side)
        if f is None:
            continue
        mask = base & f(panel)
        sub = panel.loc[mask, ["symbol", "datetime", "date", "close", "atr_14", sdef["score"]]].copy()
        if sub.empty:
            continue
        sub["side"] = side
        parts.append(sub)
    if not parts:
        return pd.DataFrame()

    cand = pd.concat(parts, ignore_index=True)
    cand = cand.rename(columns={sdef["score"]: "score"})
    cand = cand.dropna(subset=["score"])
    # first qualifying bar per symbol-day (and if both sides fire, keep the earlier one)
    cand = cand.sort_values(["symbol", "date", "datetime"])
    cand = cand.groupby(["symbol", "date"], as_index=False).first()
    return cand


def build_day_paths(panel: pd.DataFrame, keys: set) -> dict:
    """For the selected (symbol,date) keys, return intraday arrays for exit simulation."""
    panel = panel.copy()
    panel["key"] = panel["symbol"].astype(str) + "|" + panel["date"].astype(str)
    sub = panel[panel["key"].isin(keys)].sort_values(["key", "datetime"])
    out = {}
    for key, g in sub.groupby("key"):
        out[key] = {
            "high": g["high"].to_numpy(), "low": g["low"].to_numpy(),
            "close": g["close"].to_numpy(), "time": g["datetime"].to_numpy(),
            "bar_of_day": g["bar_of_day"].to_numpy(),
        }
    return out


def run(strategy: str, train_end: str = None, from_date: str = None, to_date: str = None,
        top_n: int = TOP_N, max_concurrent: int = MAX_CONCURRENT, verbose: bool = True):
    sdef = STRATEGIES[strategy]
    tf = sdef["tf"]
    if verbose:
        print(f"[LOAD] panel {tf} ...")
    panel = load_panel(tf, from_date=from_date, to_date=to_date)
    
    # Whitelist filters to focus on stocks matching the strategy's edge (Phase A)
    whitelists = {
        "orb": ["BEL", "DLF", "RECLTD", "INDIGO", "COCHINSHIP", "ABB", "BRITANNIA"],
        "snap": ["HDFCBANK", "ICICIBANK", "RELIANCE", "TCS", "INFY"],
        "squeeze": ["GODREJPROP", "DLF", "OBEROIRLTY"],
        "gap": ["TVSMOTOR", "M&M", "MARUTI"],
        "vwap": ["INDIGO", "HINDALCO"],
        "mtf": ["BEL", "DLF", "RECLTD", "INDIGO", "COCHINSHIP", "ABB", "BRITANNIA"]
    }
    
    if strategy in whitelists:
        approved_symbols = whitelists[strategy]
        panel = panel[panel["symbol"].isin(approved_symbols)].copy()
        if verbose:
            print(f"[WHITELIST] Restricted scanner to {len(approved_symbols)} symbols: {approved_symbols}")
            
    if verbose:
        print(f"[LOAD] {len(panel):,} rows. Building candidates for '{strategy}'...")

    cand = build_candidates(panel, sdef)
    if cand.empty:
        print("[RESULT] no candidates produced.")
        return
    if verbose:
        print(f"[CAND] {len(cand):,} symbol-day candidates "
              f"({round(cand.groupby('date').size().mean(),1)}/day avg)")

    # --- daily top-N selection (eligible set) ---
    asc = sdef.get("score_ascending", False)
    cand = cand.sort_values(["date", "score"], ascending=[True, asc])
    eligible = cand.groupby("date", group_keys=False).head(top_n).reset_index(drop=True)

    keys = set(eligible["symbol"].astype(str) + "|" + eligible["date"].astype(str))
    paths = build_day_paths(panel, keys)

    # --- concurrency-capped admission + scaled-exit simulation ---
    buying_power = CAPITAL * LEVERAGE
    trades = []
    for date, day in eligible.groupby("date"):
        day = day.sort_values("datetime")
        active = []  # {exit_dt, nominal}
        for _, row in day.iterrows():
            active = [a for a in active if a["exit_dt"] > row["datetime"]]
            if len(active) >= max_concurrent:
                continue
            key = f"{row['symbol']}|{row['date']}"
            p = paths.get(key)
            if p is None:
                continue
            # locate entry bar within the day, take the forward path
            idxs = np.where(p["time"] == np.datetime64(row["datetime"]))[0]
            if len(idxs) == 0:
                continue
            ei = int(idxs[0])
            entry = float(row["close"])
            atr = float(row["atr_14"])
            if not np.isfinite(atr) or atr <= 0:
                continue
            direction = "BUY" if row["side"] == "long" else "SELL"
            stop = entry - sdef["stop_atr_mult"] * atr if direction == "BUY" \
                else entry + sdef["stop_atr_mult"] * atr
            qty = get_dynamic_qty(entry, stop, row["symbol"], CAPITAL, RISK_PCT, LEVERAGE)
            # right-size to the concurrency budget: each of N concurrent slots gets an equal
            # share of buying power (avoids 1 trade hogging full 5x leverage -> huge cost drag)
            per_slot = buying_power / max_concurrent
            if entry * qty > per_slot:
                qty = int(per_slot / entry)
            if qty <= 0:
                continue
            nominal = entry * qty
            if sum(a["nominal"] for a in active) + nominal > buying_power:
                continue
            cand_obj = {
                "direction": direction, "entry": entry, "stop": stop, "sym": row["symbol"],
                "entry_dt": row["datetime"],
                "highs": p["high"][ei + 1:], "lows": p["low"][ei + 1:],
                "closes": p["close"][ei + 1:], "times": p["time"][ei + 1:],
            }
            gross, _c, exit_dt, reason, legs = simulate_exit_custom(cand_obj, qty, sdef)
            costs = compute_costs(entry, legs, row["symbol"])  # corrected per-order cost model
            trades.append({
                "date": date, "symbol": row["symbol"], "side": row["side"],
                "entry_time": row["datetime"], "exit_time": exit_dt, "direction": direction,
                "entry": entry, "stop": stop, "qty": qty, "score": row["score"],
                "gross_pnl": gross, "costs": costs, "pnl": gross - costs, "exit_reason": reason,
            })
            active.append({"exit_dt": exit_dt, "nominal": nominal})

    tdf = pd.DataFrame(trades)
    ledger = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports", f"scanner_{strategy}.csv")
    os.makedirs(os.path.dirname(ledger), exist_ok=True)
    tdf.to_csv(ledger, index=False)

    report(strategy, tdf, "FULL", verbose)
    if train_end:
        te = pd.to_datetime(train_end).date()
        report(strategy, tdf[pd.to_datetime(tdf["date"]).dt.date <= te], "IN-SAMPLE (train)", verbose)
        report(strategy, tdf[pd.to_datetime(tdf["date"]).dt.date > te], "OUT-OF-SAMPLE (test)", verbose)
    return tdf


def report(strategy: str, df: pd.DataFrame, label: str, verbose: bool):
    if df is None or df.empty:
        print(f"[{strategy.upper()} | {label}] no trades.")
        return
    n = len(df)
    gross, costs, net = df["gross_pnl"].sum(), df["costs"].sum(), df["pnl"].sum()
    wins = df[df["pnl"] > 0]
    wr = len(wins) / n * 100
    gp, gl = wins["pnl"].sum(), abs(df[df["pnl"] <= 0]["pnl"].sum())
    pf = gp / gl if gl > 0 else float("inf")
    cum = df.sort_values("entry_time")["pnl"].cumsum()
    maxdd = (cum.cummax() - cum).max()
    if verbose:
        print("\n" + "=" * 58)
        print(f" {strategy.upper()}  |  {label}")
        print("=" * 58)
        print(f"  Trades        : {n}")
        print(f"  Win rate      : {wr:.1f}%")
        print(f"  Gross P&L     : Rs. {gross:,.0f}")
        print(f"  Txn costs     : Rs. {costs:,.0f}")
        print(f"  Net P&L       : Rs. {net:,.0f}")
        print(f"  Profit factor : {pf:.2f}")
        print(f"  Max drawdown  : Rs. {maxdd:,.0f}")
        print(f"  Net / trade   : Rs. {net / n:,.1f}")
        print(f"  Exit reasons  : {df['exit_reason'].value_counts().to_dict()}")
        print("=" * 58)


def main():
    ap = argparse.ArgumentParser(description="Panel-driven cross-sectional backtester")
    ap.add_argument("--strategy", required=True, choices=list(STRATEGIES.keys()))
    ap.add_argument("--train-end", default="2024-12-31", help="walk-forward split date (YYYY-MM-DD)")
    ap.add_argument("--from-date", default=None)
    ap.add_argument("--to-date", default=None)
    ap.add_argument("--top-n", type=int, default=TOP_N)
    ap.add_argument("--max-concurrent", type=int, default=MAX_CONCURRENT)
    args = ap.parse_args()
    run(args.strategy, train_end=args.train_end, from_date=args.from_date, to_date=args.to_date,
        top_n=args.top_n, max_concurrent=args.max_concurrent)


if __name__ == "__main__":
    main()
