"""Cross-sectional daily scanner + scaled-exit portfolio backtester.

This is the Phase-0 shared engine for the FNO strategy optimization effort. Unlike
``run_universe_backtest.py`` (which runs each symbol independently and trades every
qualifying setup), this engine implements the real product requirement:

    Each trading day, scan the FULL universe -> score every stock's setup against the
    strategy -> rank -> trade ONLY the top-N best setups, subject to a max-concurrent
    position cap and shared leverage margin -> manage exits with a configurable scaled
    partial-exit ladder (1R / 2R / trailing runner).

Strategies are used purely as ENTRY-SIGNAL GENERATORS: we take their (direction, entry,
stop, confidence) and impose our own uniform exit ladder + portfolio risk controls, so
every strategy is compared on an apples-to-apples basis for the Phase-1 ranking.

Usage:
    python backtester/portfolio_scanner.py --strategy vwap --top-n 5 --max-concurrent 3
"""

from __future__ import annotations

import os
import sys
import logging
import argparse
import datetime
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd

# Silence the per-strategy DEBUG flood -> ~10x faster, clean output (Phase 0.3).
logging.disable(logging.CRITICAL)

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backtester.run_backtest import (
    load_data,
    get_dynamic_qty,
    calculate_transaction_costs,
)

ALGO_ENGINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_ROOT = os.path.abspath(os.path.join(ALGO_ENGINE_DIR, "..", "python-bridge", "data", "underlying"))
REPORTS_DIR = os.path.join(ALGO_ENGINE_DIR, "backtester", "reports")
os.makedirs(REPORTS_DIR, exist_ok=True)

# Pure index / non-equity symbols to exclude from equity-strategy scans.
INDEX_SYMBOLS = {
    "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "NIFTYNXT50",
    "NIFTY AUTO", "NIFTY CEMENT", "NIFTY CONSR DURBL", "NIFTY FMCG",
    "NIFTY IND DEFENCE", "NIFTY IT", "NIFTY METAL", "NIFTY OIL AND GAS",
    "NIFTY PHARMA", "NIFTY PSU BANK", "NIFTY PVT BANK", "NIFTY REALTY",
    "NIFTY SERV SECTOR",
}

# Per-strategy data timeframe (mirrors run_backtest conventions).
STRATEGY_TF = {
    "orb": "15minute", "vwap": "15minute", "snap": "15minute", "mtf": "15minute",
    "squeeze": "5minute", "gap": "5minute",
}


def discover_universe() -> list:
    """All available equity symbols (indices excluded)."""
    if not os.path.isdir(DATA_ROOT):
        return []
    syms = [d for d in os.listdir(DATA_ROOT) if os.path.isdir(os.path.join(DATA_ROOT, d))]
    return sorted(s for s in syms if s not in INDEX_SYMBOLS)


def compute_daily_indicators(prev_day_df: pd.DataFrame):
    """Return (ema20, ema50, adx14) from prior daily candles, or sensible defaults."""
    if prev_day_df is None or len(prev_day_df) < 20:
        return 2500.0, 2480.0, 20.0
    closes = prev_day_df["close"].values
    highs = prev_day_df["high"].values
    lows = prev_day_df["low"].values
    ema_20 = pd.Series(closes).ewm(span=20, adjust=False).mean().iloc[-1]
    ema_50 = pd.Series(closes).ewm(span=50, adjust=False).mean().iloc[-1]
    n = len(prev_day_df)
    tr = np.zeros(n)
    plus_dm = np.zeros(n)
    minus_dm = np.zeros(n)
    for i in range(1, n):
        tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
        up = highs[i] - highs[i - 1]
        down = lows[i - 1] - lows[i]
        plus_dm[i] = up if (up > down and up > 0) else 0.0
        minus_dm[i] = down if (down > up and down > 0) else 0.0
    alpha = 1.0 / 14.0
    atr = pd.Series(tr).ewm(alpha=alpha, adjust=False).mean().values
    atr_safe = np.where(atr == 0, 1.0, atr)
    plus_di = 100.0 * pd.Series(plus_dm).ewm(alpha=alpha, adjust=False).mean().values / atr_safe
    minus_di = 100.0 * pd.Series(minus_dm).ewm(alpha=alpha, adjust=False).mean().values / atr_safe
    denom = np.where((plus_di + minus_di) == 0, 1.0, plus_di + minus_di)
    dx = 100.0 * np.abs(plus_di - minus_di) / denom
    adx = pd.Series(dx).ewm(alpha=alpha, adjust=False).mean().iloc[-1]
    return float(ema_20), float(ema_50), float(adx)


def make_strategy(name: str, symbol: str, capital: float, quantity: int):
    """Instantiate a strategy as a signal generator with run_backtest-equivalent config."""
    cfg = {
        "instrument": symbol,
        "quantity": quantity,
        "capital": capital,
        "risk_pct": 0.02,
        "leverage": 5.0,
        "target_multiplier": 1.5,
        "stop_multiplier": 1.0,
        "std_dev_multiplier": 1.5,
    }
    name = name.lower()
    if name == "vwap":
        from strategies.vwap_mean_reversion import VWAPMeanReversion
        return VWAPMeanReversion(config=cfg)
    if name == "orb":
        cfg.update({"require_retest": True, "require_volume_confirmation": True,
                    "opening_range_minutes": 15, "volume_multiple": 1.5})
        from strategies.orb_enhanced import ORBEnhanced
        return ORBEnhanced(config=cfg)
    if name == "snap":
        from strategies.ema_snap import EMASnap
        return EMASnap(cfg)
    if name == "mtf":
        cfg.update({"pullback_band": 2.0, "max_trades_per_day": 3,
                    "force_intraday_exit": True, "daily_adx_threshold": 15.0})
        from strategies.mtf_momentum import MTFMomentum
        return MTFMomentum(cfg)
    if name == "squeeze":
        cfg.update({"lookback": 20, "bb_std": 2.0, "kc_multiplier": 1.5, "min_squeeze_duration": 6})
        from strategies.volatility_squeezev2 import VolatilitySqueezeV2
        return VolatilitySqueezeV2(cfg)
    if name == "gap":
        cfg.update({"max_trades_per_day": 1, "volume_threshold_mult": 0.5})
        from strategies.gap_fade import GapFade
        return GapFade(cfg)
    raise ValueError(f"unknown strategy {name}")


def is_entry_signal(sig) -> bool:
    """A real entry (not a square-off / flat). Square-offs use price=stop=target=0."""
    if sig is None:
        return False
    if isinstance(sig, list):
        return False
    return (getattr(sig, "direction", None) in ("BUY", "SELL")) and (getattr(sig, "stop_loss", 0) or 0) > 0


# ---------------------------------------------------------------------------
# Entry harvesting: run each strategy as a signal generator over its candles
# ---------------------------------------------------------------------------

def harvest_entries(strategy_name: str, symbol: str, data_df: pd.DataFrame,
                    daily_df: pd.DataFrame, capital: float, quantity: int) -> list:
    """Return one candidate entry per day (the first signal the strategy emits)."""
    name = strategy_name.lower()
    candidates = []
    daily_df = daily_df.copy() if daily_df is not None else None
    if daily_df is not None and "date" not in daily_df.columns:
        daily_df["date"] = daily_df["datetime"].dt.date

    for date, day_df in data_df.groupby("date"):
        day_df = day_df.sort_values("datetime").reset_index(drop=True)
        strat = make_strategy(name, symbol, capital, quantity)

        # Pre-market daily state (avoids intraday look-ahead).
        prev = daily_df[daily_df["date"] < date] if daily_df is not None else None
        if name in ("vwap", "snap", "mtf"):
            ema20, ema50, adx = compute_daily_indicators(prev)
            try:
                strat.update_daily_state(ema20, ema50, adx)
            except Exception:
                pass
        elif name == "gap":
            try:
                strat.update_prev_close(float(prev["close"].values[-1]) if prev is not None and len(prev) else 2500.0)
            except Exception:
                pass

        # Per-day reference volume (used by ORB / squeeze volume filters); harmless otherwise.
        if prev is not None and len(prev) >= 20 and "volume" in prev.columns:
            avg_daily_vol = prev["volume"].tail(20).mean()
            expected_candles = 75 if len(day_df) > 40 else 25
            try:
                strat.config["reference_volume"] = float(avg_daily_vol) / expected_candles
            except Exception:
                pass

        highs = day_df["high"].values
        lows = day_df["low"].values
        closes = day_df["close"].values
        times = day_df["datetime"].values
        n = len(day_df)
        entered = False
        for i in range(n):
            row = day_df.iloc[i]
            candle = {
                "open": row.get("open", row["close"]),
                "high": row["high"], "low": row["low"], "close": row["close"],
                "volume": row.get("volume", 1.0), "time": row["time"], "date": date,
            }
            sig = None
            try:
                sig = strat.on_candle(candle)
            except Exception:
                sig = None
            if not entered and is_entry_signal(sig):
                candidates.append({
                    "date": date, "sym": symbol, "entry_dt": times[i], "entry_idx": i,
                    "direction": sig.direction, "entry": float(row["close"]),
                    "stop": float(sig.stop_loss), "score": float(sig.confidence),
                    # post-entry path for exit simulation
                    "highs": highs[i + 1:], "lows": lows[i + 1:],
                    "closes": closes[i + 1:], "times": times[i + 1:],
                })
                entered = True  # one candidate per symbol per day (morning-scan abstraction)
    return candidates


# ---------------------------------------------------------------------------
# Scaled-exit ladder: 33% @1R, 33% @2R, trail last 33% (aggressive runner)
# ---------------------------------------------------------------------------

def simulate_exit(cand: dict, qty: int, time_stop_bars: int = 16):
    """Simulate the scaled-exit ladder. Returns (gross, costs, exit_dt, reason, legs)."""
    direction = cand["direction"]
    entry = cand["entry"]
    stop = cand["stop"]
    sym = cand["sym"]
    R = abs(entry - stop)
    if R <= 0 or qty <= 0:
        return 0.0, 0.0, cand["entry_dt"], "INVALID", []

    q1 = qty // 3
    q2 = qty // 3
    q3 = qty - q1 - q2
    long = direction == "BUY"
    t1 = entry + R if long else entry - R
    t2 = entry + 2 * R if long else entry - 2 * R
    cur_stop = stop
    stage = 1
    trail = None
    legs = []  # (exit_price, qty, reason)
    remaining = qty
    highs, lows, closes, times = cand["highs"], cand["lows"], cand["closes"], cand["times"]
    nbars = len(closes)
    exit_dt = cand["entry_dt"]

    def hit_stop(l, h, lvl):
        return (l <= lvl) if long else (h >= lvl)

    def hit_target(l, h, lvl):
        return (h >= lvl) if long else (l <= lvl)

    for i in range(nbars):
        h, l, c = highs[i], lows[i], closes[i]
        exit_dt = times[i]
        if stage == 1:
            if hit_stop(l, h, cur_stop):
                legs.append((cur_stop, remaining, "STOP")); remaining = 0; break
            if hit_target(l, h, t1):
                legs.append((t1, q1, "T1")); remaining -= q1; cur_stop = entry; stage = 2
            elif (i + 1) >= time_stop_bars:
                legs.append((c, remaining, "TIME")); remaining = 0; break
        elif stage == 2:
            if hit_stop(l, h, cur_stop):
                legs.append((cur_stop, remaining, "BE_STOP")); remaining = 0; break
            if hit_target(l, h, t2):
                legs.append((t2, q2, "T2")); remaining -= q2; stage = 3
                trail = (c - R) if long else (c + R)
        else:  # stage 3 trailing runner
            trail = max(trail, c - R) if long else min(trail, c + R)
            if hit_stop(l, h, trail):
                legs.append((trail, remaining, "TRAIL")); remaining = 0; break
    if remaining > 0:
        # EOD square-off at last available close (or entry if no bars).
        last_close = closes[-1] if nbars > 0 else entry
        legs.append((last_close, remaining, "EOD")); remaining = 0

    gross = 0.0
    costs = 0.0
    for px, lq, _ in legs:
        leg_pnl = (px - entry) * lq if long else (entry - px) * lq
        gross += leg_pnl
        costs += calculate_transaction_costs(entry, px, lq, sym, True)
    reason = legs[-1][2] if legs else "NONE"
    return gross, costs, exit_dt, reason, legs


# ---------------------------------------------------------------------------
# Portfolio simulation: top-N daily selection + max-concurrent + shared margin
# ---------------------------------------------------------------------------

def run_portfolio(strategy_name: str, top_n: int, max_concurrent: int,
                  capital: float, quantity: int, from_date: str, to_date: str,
                  symbols: list, time_stop_bars: int = 16, verbose: bool = True):
    tf = STRATEGY_TF.get(strategy_name.lower(), "15minute")
    leverage = 5.0
    buying_power = capital * leverage

    # 1. Harvest candidate entries across the whole universe.
    all_candidates = []
    start = datetime.datetime.strptime(from_date, "%Y-%m-%d").date()
    end = datetime.datetime.strptime(to_date, "%Y-%m-%d").date()
    loaded = 0
    for sym in symbols:
        pq = os.path.join(DATA_ROOT, sym, tf, "data.parquet")
        if not os.path.exists(pq):
            continue
        try:
            ddf = load_data(sym, DATA_ROOT, timeframe=tf)
            daily = load_data(sym, DATA_ROOT, timeframe="day")
        except Exception:
            continue
        ddf = ddf[(ddf["date"] >= start) & (ddf["date"] <= end)]
        if ddf.empty:
            continue
        all_candidates.extend(harvest_entries(strategy_name, sym, ddf, daily, capital, quantity))
        loaded += 1
        if verbose and loaded % 25 == 0:
            print(f"  ...scanned {loaded} symbols, {len(all_candidates)} raw candidates")
    if verbose:
        print(f"[SCAN] {loaded} symbols scanned, {len(all_candidates)} raw candidate setups")

    # 2. Group by day -> rank by score -> admit top-N under concurrency + margin.
    trades = []
    by_day = {}
    for c in all_candidates:
        by_day.setdefault(c["date"], []).append(c)

    for date in sorted(by_day.keys()):
        day_cands = sorted(by_day[date], key=lambda x: x["score"], reverse=True)
        eligible = day_cands[:top_n]
        eligible.sort(key=lambda x: x["entry_dt"])  # admit in time order
        active = []  # list of {exit_dt, nominal}
        admitted = 0
        for cand in eligible:
            # free up positions that closed before this entry
            active = [a for a in active if a["exit_dt"] > cand["entry_dt"]]
            if len(active) >= max_concurrent:
                continue
            qty = get_dynamic_qty(cand["entry"], cand["stop"], cand["sym"], capital, 0.02, leverage)
            nominal = cand["entry"] * qty
            used = sum(a["nominal"] for a in active)
            if used + nominal > buying_power:
                continue
            gross, costs, exit_dt, reason, legs = simulate_exit(cand, qty, time_stop_bars)
            net = gross - costs
            trades.append({
                "date": date, "symbol": cand["sym"], "entry_time": cand["entry_dt"],
                "exit_time": exit_dt, "direction": cand["direction"], "entry_price": cand["entry"],
                "stop_loss": cand["stop"], "quantity": qty, "score": cand["score"],
                "gross_pnl": gross, "transaction_costs": costs, "pnl": net, "exit_reason": reason,
            })
            active.append({"exit_dt": exit_dt, "nominal": nominal})
            admitted += 1
    return report(strategy_name, trades, top_n, max_concurrent, verbose)


def report(strategy_name: str, trades: list, top_n: int, max_concurrent: int, verbose: bool):
    if not trades:
        if verbose:
            print(f"[{strategy_name.upper()}] No trades generated.")
        return {"strategy": strategy_name, "trades": 0, "net": 0.0}
    df = pd.DataFrame(trades)
    n = len(df)
    gross = df["gross_pnl"].sum()
    costs = df["transaction_costs"].sum()
    net = df["pnl"].sum()
    wins = df[df["pnl"] > 0]
    losses = df[df["pnl"] <= 0]
    wr = len(wins) / n * 100
    gp = wins["pnl"].sum()
    gl = abs(losses["pnl"].sum())
    pf = gp / gl if gl > 0 else float("inf")
    df["cum"] = df["pnl"].cumsum()
    maxdd = (df["cum"].cummax() - df["cum"]).max()
    ledger = os.path.join(REPORTS_DIR, f"scanner_{strategy_name.lower()}.csv")
    df.to_csv(ledger, index=False)
    res = {
        "strategy": strategy_name, "trades": n, "win_rate": wr, "gross": gross,
        "costs": costs, "net": net, "profit_factor": pf, "max_dd": maxdd,
        "cost_per_trade": costs / n, "net_per_trade": net / n,
    }
    if verbose:
        print("\n" + "=" * 56)
        print(f" SCANNER REPORT: {strategy_name.upper()}  (top {top_n}/day, max {max_concurrent} concurrent)")
        print("=" * 56)
        print(f" Trades         : {n}")
        print(f" Win rate       : {wr:.1f}%")
        print(f" Gross P&L      : Rs. {gross:,.0f}")
        print(f" Txn costs      : Rs. {costs:,.0f}")
        print(f" Net P&L        : Rs. {net:,.0f}")
        print(f" Profit factor  : {pf:.2f}")
        print(f" Max drawdown   : Rs. {maxdd:,.0f}")
        print(f" Net per trade  : Rs. {net / n:,.1f}")
        print(f" Exit reasons   : {df['exit_reason'].value_counts().to_dict()}")
        print("=" * 56)
    return res


def main():
    ap = argparse.ArgumentParser(description="Cross-sectional scanner portfolio backtester")
    ap.add_argument("--strategy", type=str, required=True,
                    choices=["orb", "vwap", "squeeze", "snap", "mtf", "gap"])
    ap.add_argument("--top-n", type=int, default=5)
    ap.add_argument("--max-concurrent", type=int, default=3)
    ap.add_argument("--capital", type=float, default=100000.0)
    ap.add_argument("--quantity", type=int, default=100)
    ap.add_argument("--from-date", type=str, default="2023-01-01")
    ap.add_argument("--to-date", type=str, default="2026-06-28")
    ap.add_argument("--time-stop-bars", type=int, default=16)
    ap.add_argument("--limit-symbols", type=int, default=0, help="0 = full universe; else first N (smoke test)")
    args = ap.parse_args()

    universe = discover_universe()
    if args.limit_symbols > 0:
        universe = universe[:args.limit_symbols]
    print(f"[UNIVERSE] {len(universe)} symbols | strategy={args.strategy} tf={STRATEGY_TF.get(args.strategy)}")
    run_portfolio(
        args.strategy, args.top_n, args.max_concurrent, args.capital, args.quantity,
        args.from_date, args.to_date, universe, args.time_stop_bars, verbose=True,
    )


if __name__ == "__main__":
    main()
