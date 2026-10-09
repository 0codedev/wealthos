"""Screener feature-store builder.

Precomputes a complete, causal (no-lookahead) feature dataset for every symbol and
timeframe so backtests / scanners just READ features instead of recomputing indicators
on every run. Source data is the local parquet archive (cash/spot OHLCV; open_interest
is all-zero and therefore excluded).

Output layout:
    python-bridge/data/screener/<SYMBOL>/<tf>/features.parquet
    python-bridge/data/screener/manifest.json

Design guarantees:
  * Every intraday feature is causal (uses only the current and prior candles).
  * VWAP and the opening range reset each trading day.
  * Daily-derived features (d_ema*, d_adx14, prev_close, gap, 52w extremes, ...) are
    computed on the daily series and SHIFTED BY ONE DAY, then merged onto intraday rows
    by calendar date -> on day D intraday sees daily values through D-1 only.

Usage:
    python screener/build_screener.py                      # full universe, 15m + 5m
    python screener/build_screener.py --timeframes 15minute --limit 5   # smoke test
"""

from __future__ import annotations

import os
import sys
import json
import time
import argparse
import datetime
from typing import Optional

import numpy as np
import pandas as pd

ALGO_ENGINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_ROOT = os.path.abspath(os.path.join(ALGO_ENGINE_DIR, "..", "python-bridge", "data", "underlying"))
SCREENER_ROOT = os.path.abspath(os.path.join(ALGO_ENGINE_DIR, "..", "python-bridge", "data", "screener"))

INDEX_SYMBOLS = {
    "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "NIFTYNXT50",
    "NIFTY AUTO", "NIFTY CEMENT", "NIFTY CONSR DURBL", "NIFTY FMCG",
    "NIFTY IND DEFENCE", "NIFTY IT", "NIFTY METAL", "NIFTY OIL AND GAS",
    "NIFTY PHARMA", "NIFTY PSU BANK", "NIFTY PVT BANK", "NIFTY REALTY",
    "NIFTY SERV SECTOR",
}

# Candles per session by timeframe (NSE 09:15-15:30 = 375 min).
BARS_PER_DAY = {"15minute": 25, "5minute": 75, "1minute": 375}


# ---------------------------------------------------------------------------
# Vectorized, causal indicator primitives
# ---------------------------------------------------------------------------

def ema(s: pd.Series, span: int) -> pd.Series:
    return s.ewm(span=span, adjust=False).mean()


def rma(s: pd.Series, period: int) -> pd.Series:
    """Wilder's smoothing (used by RSI/ATR/ADX)."""
    return s.ewm(alpha=1.0 / period, adjust=False).mean()


def rsi(close: pd.Series, period: int) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = rma(gain, period)
    avg_loss = rma(loss, period)
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100.0 - (100.0 / (1.0 + rs))
    return out.fillna(100.0)


def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat([(high - low),
                    (high - prev_close).abs(),
                    (low - prev_close).abs()], axis=1).max(axis=1)
    return tr


def atr(high, low, close, period: int = 14) -> pd.Series:
    return rma(true_range(high, low, close), period)


def adx(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    up = high.diff()
    down = -low.diff()
    plus_dm = np.where((up > down) & (up > 0), up, 0.0)
    minus_dm = np.where((down > up) & (down > 0), down, 0.0)
    tr = true_range(high, low, close)
    atr_ = rma(tr, period).replace(0.0, np.nan)
    plus_di = 100.0 * rma(pd.Series(plus_dm, index=high.index), period) / atr_
    minus_di = 100.0 * rma(pd.Series(minus_dm, index=high.index), period) / atr_
    dx = 100.0 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0.0, np.nan)
    return rma(dx.fillna(0.0), period)


def macd(close: pd.Series, fast=12, slow=26, signal=9):
    macd_line = ema(close, fast) - ema(close, slow)
    signal_line = ema(macd_line, signal)
    return macd_line, signal_line, macd_line - signal_line


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_raw(symbol: str, timeframe: str) -> Optional[pd.DataFrame]:
    p = os.path.join(DATA_ROOT, symbol, timeframe, "data.parquet")
    if not os.path.exists(p):
        return None
    df = pd.read_parquet(p)
    if df.empty:
        return None
    df["datetime"] = pd.to_datetime(df["timestamp"].str.slice(0, 19))
    df["date"] = df["datetime"].dt.date
    df["time"] = df["datetime"].dt.time
    df = df.sort_values("datetime").reset_index(drop=True)
    for c in ("open", "high", "low", "close", "volume"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def daily_features(daily: pd.DataFrame) -> pd.DataFrame:
    """Compute prior-day daily features keyed by date (already shifted to lag by 1)."""
    d = daily.sort_values("datetime").reset_index(drop=True).copy()
    c, h, l = d["close"], d["high"], d["low"]
    feats = pd.DataFrame({"date": d["date"]})
    feats["d_ema20"] = ema(c, 20)
    feats["d_ema50"] = ema(c, 50)
    feats["d_ema200"] = ema(c, 200)
    feats["d_adx14"] = adx(h, l, c, 14)
    feats["d_atr14"] = atr(h, l, c, 14)
    feats["d_rsi14"] = rsi(c, 14)
    feats["prev_close"] = c
    feats["prev_high"] = h
    feats["prev_low"] = l
    feats["d_52w_high"] = h.rolling(252, min_periods=20).max()
    feats["d_52w_low"] = l.rolling(252, min_periods=20).min()
    feats["d_trend"] = np.sign(feats["d_ema20"] - feats["d_ema50"])
    feats["d_avg_vol20"] = d["volume"].rolling(20, min_periods=5).mean()
    # SHIFT by 1 -> on day D intraday rows only see values computed through D-1.
    shifted = feats.copy()
    for col in feats.columns:
        if col != "date":
            shifted[col] = feats[col].shift(1)
    # Map each daily date to its (already-lagged) feature row.
    shifted = shifted.dropna(subset=["prev_close"]).reset_index(drop=True)
    return shifted


# ---------------------------------------------------------------------------
# Intraday feature computation
# ---------------------------------------------------------------------------

def build_features(symbol: str, timeframe: str, intraday: pd.DataFrame,
                   daily: pd.DataFrame) -> pd.DataFrame:
    df = intraday.copy()
    o, h, l, c, v = df["open"], df["high"], df["low"], df["close"], df["volume"]
    bars = BARS_PER_DAY.get(timeframe, 25)
    tf_min = {"15minute": 15, "5minute": 5, "1minute": 1}.get(timeframe, 15)

    # --- returns ---
    df["ret_1"] = c.pct_change(1)
    df["ret_5"] = c.pct_change(5)
    df["ret_15"] = c.pct_change(15)

    # --- trend ---
    df["ema_9"] = ema(c, 9)
    df["ema_21"] = ema(c, 21)
    df["ema_50"] = ema(c, 50)
    df["ema_200"] = ema(c, 200)
    df["ema_stack"] = np.where((df["ema_9"] > df["ema_21"]) & (df["ema_21"] > df["ema_50"]), 1,
                       np.where((df["ema_9"] < df["ema_21"]) & (df["ema_21"] < df["ema_50"]), -1, 0))
    df["dist_ema21_pct"] = (c - df["ema_21"]) / df["ema_21"] * 100.0
    macd_line, macd_sig, macd_hist = macd(c)
    df["macd"], df["macd_signal"], df["macd_hist"] = macd_line, macd_sig, macd_hist
    df["roc_10"] = c.pct_change(10) * 100.0

    # --- volatility ---
    df["atr_14"] = atr(h, l, c, 14)
    df["atr_pct"] = df["atr_14"] / c * 100.0
    df["std_20"] = c.rolling(20, min_periods=5).std()
    mid = c.rolling(20, min_periods=5).mean()
    df["bb_mid"] = mid
    df["bb_upper"] = mid + 2.0 * df["std_20"]
    df["bb_lower"] = mid - 2.0 * df["std_20"]
    df["bb_width"] = (df["bb_upper"] - df["bb_lower"]) / mid * 100.0
    kc_mid = ema(c, 20)
    df["kc_mid"] = kc_mid
    df["kc_upper"] = kc_mid + 1.5 * df["atr_14"]
    df["kc_lower"] = kc_mid - 1.5 * df["atr_14"]
    df["squeeze_on"] = ((df["bb_upper"] < df["kc_upper"]) & (df["bb_lower"] > df["kc_lower"])).astype(int)

    # --- mean reversion ---
    df["zscore_20"] = (c - mid) / df["std_20"].replace(0.0, np.nan)
    df["rsi_2"] = rsi(c, 2)
    df["rsi_14"] = rsi(c, 14)

    # --- volume ---
    df["vol_sma_20"] = v.rolling(20, min_periods=5).mean()
    df["vol_ratio"] = v / df["vol_sma_20"].replace(0.0, np.nan)
    df["obv"] = (np.sign(c.diff().fillna(0.0)) * v).cumsum()

    # --- per-day features (reset each session): vwap, opening range, bar index ---
    df["bar_idx"] = df.groupby("date").cumcount()
    df["bars_to_close"] = (bars - 1) - df["bar_idx"]
    typical = (h + l + c) / 3.0
    grp = df.groupby("date")
    cum_pv = (typical * v).groupby(df["date"]).cumsum()
    cum_v = v.groupby(df["date"]).cumsum().replace(0.0, np.nan)
    df["vwap"] = cum_pv / cum_v
    df["dist_vwap_pct"] = (c - df["vwap"]) / df["vwap"] * 100.0
    df["vwap_sigma"] = (c - df["vwap"]) / df["std_20"].replace(0.0, np.nan)

    # opening range over first `or_minutes` (default 15) of the session
    or_bars = max(1, 15 // tf_min)
    in_or = df["bar_idx"] < or_bars
    df["or_high"] = h.where(in_or).groupby(df["date"]).cummax().groupby(df["date"]).ffill()
    df["or_low"] = l.where(in_or).groupby(df["date"]).cummin().groupby(df["date"]).ffill()
    df["or_high"] = df.groupby("date")["or_high"].ffill()
    df["or_low"] = df.groupby("date")["or_low"].ffill()
    df["or_range_pct"] = (df["or_high"] - df["or_low"]) / df["or_low"] * 100.0
    df["broke_or_high"] = ((c > df["or_high"]) & (df["bar_idx"] >= or_bars)).astype(int)
    df["broke_or_low"] = ((c < df["or_low"]) & (df["bar_idx"] >= or_bars)).astype(int)

    # relative volume vs same-bar-of-day average over PRIOR days (causal)
    df["rvol"] = df.groupby("bar_idx")["volume"].transform(
        lambda s: s / s.shift(1).expanding(min_periods=3).mean())

    # session timing
    secs = df["datetime"].dt.hour * 60 + df["datetime"].dt.minute
    df["minutes_since_open"] = secs - (9 * 60 + 15)
    df["is_first_bar"] = (df["bar_idx"] == 0).astype(int)
    df["time_slot"] = np.select(
        [secs < 600, secs < 690, secs < 810, secs < 870],
        [0, 1, 2, 3], default=4)

    # --- daily (prior-day) features merged by calendar date ---
    if daily is not None and not daily.empty:
        dfeat = daily_features(daily)
        df = df.merge(dfeat, on="date", how="left")
        day_open = df.groupby("date")["open"].transform("first")
        df["gap_pct"] = (day_open - df["prev_close"]) / df["prev_close"] * 100.0
        df["dist_52w_high_pct"] = (c - df["d_52w_high"]) / df["d_52w_high"] * 100.0
        df["dist_52w_low_pct"] = (c - df["d_52w_low"]) / df["d_52w_low"] * 100.0

    df["symbol"] = symbol
    df["timeframe"] = timeframe
    return df


def build_symbol(symbol: str, timeframe: str) -> Optional[dict]:
    intraday = load_raw(symbol, timeframe)
    if intraday is None:
        return None
    daily = load_raw(symbol, "day")
    feats = build_features(symbol, timeframe, intraday, daily)
    out_dir = os.path.join(SCREENER_ROOT, symbol, timeframe)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "features.parquet")
    feats.to_parquet(out_path, index=False)
    return {
        "symbol": symbol, "timeframe": timeframe, "rows": len(feats),
        "from": str(feats["date"].min()), "to": str(feats["date"].max()),
        "n_features": feats.shape[1],
    }


def load_features(symbol: str, timeframe: str = "15minute",
                  from_date: Optional[str] = None, to_date: Optional[str] = None) -> Optional[pd.DataFrame]:
    """Fast read of a precomputed feature parquet, optionally date-sliced."""
    p = os.path.join(SCREENER_ROOT, symbol, timeframe, "features.parquet")
    if not os.path.exists(p):
        return None
    df = pd.read_parquet(p)
    if from_date:
        df = df[df["date"] >= datetime.datetime.strptime(from_date, "%Y-%m-%d").date()]
    if to_date:
        df = df[df["date"] <= datetime.datetime.strptime(to_date, "%Y-%m-%d").date()]
    return df.reset_index(drop=True)


def available_symbols(timeframe: str = "15minute") -> list:
    """Symbols that have a built feature file for the given timeframe."""
    if not os.path.isdir(SCREENER_ROOT):
        return []
    out = []
    for sym in sorted(os.listdir(SCREENER_ROOT)):
        if os.path.exists(os.path.join(SCREENER_ROOT, sym, timeframe, "features.parquet")):
            out.append(sym)
    return out


def discover_universe(include_index: bool = False) -> list:
    if not os.path.isdir(DATA_ROOT):
        return []
    if not include_index:
        syms = [s for s in syms if s not in INDEX_SYMBOLS]
    return sorted(syms)


def main():
    ap = argparse.ArgumentParser(description="Build the screener feature store")
    ap.add_argument("--timeframes", nargs="+", default=["15minute", "5minute"])
    ap.add_argument("--limit", type=int, default=0, help="0 = full universe; else first N symbols")
    ap.add_argument("--include-index", action="store_true", default=False)
    ap.add_argument("--symbols", nargs="*", default=None, help="explicit symbol list (overrides discovery)")
    args = ap.parse_args()

    universe = args.symbols if args.symbols else discover_universe(args.include_index)
    if args.limit > 0:
        universe = universe[:args.limit]

    os.makedirs(SCREENER_ROOT, exist_ok=True)
    manifest = {"built_at": datetime.datetime.now().isoformat(timespec="seconds"),
                "timeframes": args.timeframes, "symbols": [], "entries": [], "errors": []}
    t0 = time.time()
    total = len(universe) * len(args.timeframes)
    done = 0
    for sym in universe:
        for tf in args.timeframes:
            try:
                info = build_symbol(sym, tf)
                if info:
                    manifest["entries"].append(info)
            except Exception as e:
                manifest["errors"].append({"symbol": sym, "timeframe": tf, "error": str(e)})
            done += 1
        manifest["symbols"].append(sym)
        if len(manifest["symbols"]) % 20 == 0:
            print(f"  {len(manifest['symbols'])}/{len(universe)} symbols, {done}/{total} files, {time.time()-t0:.0f}s")

    with open(os.path.join(SCREENER_ROOT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"[DONE] {len(manifest['entries'])} feature files, {len(manifest['errors'])} errors, "
          f"{time.time()-t0:.0f}s -> {SCREENER_ROOT}")
    if manifest["errors"]:
        print("First errors:", manifest["errors"][:3])


if __name__ == "__main__":
    main()
