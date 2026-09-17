"""Definitive Screener Feature Dataset builder (canonical, build-once).

Precomputes a complete, causal (no-look-ahead) feature panel from the raw parquet candle
archive so every backtest / scanner just READS features instead of recomputing indicators.

This is the canonical, comprehensive build: it merges every feature from both prior drafts
plus the institutional extras a strategy could plausibly need (multi-horizon momentum, VWAP
bands, Bollinger %B, Stochastic, Williams %R, CCI, OBV, 52-week positional context,
same-bar-of-day RVOL, opening-range, shifted daily regime, and a full cross-sectional rank
suite for auto stock selection).

Output (one combined long-format panel per timeframe -> ideal for cross-sectional scans):
    python-bridge/data/screener/features_{tf}.parquet
    python-bridge/data/screener/features_{tf}_meta.json

Design guarantees:
  * Causal: intraday indicators use only current/prior bars; daily-derived features are
    shifted one trading day; cross-sectional ranks use only same-timestamp data.
  * Complete: every raw candle yields exactly one row; a ``warmup`` flag marks rows where
    the longest window (ema_200) is not yet seeded. Post-warmup NaNs are ~0.
  * open_interest is all-zero for cash equities and is therefore dropped.

Usage:
    python backtester/build_screener.py --tf 15minute
    python backtester/build_screener.py --tf 5minute
    python backtester/build_screener.py --tf 15minute --limit 10   # smoke test
"""

from __future__ import annotations

import os
import sys
import json
import time
import argparse
import datetime as dt

import numpy as np
import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ALGO_ENGINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_ROOT = os.path.abspath(os.path.join(ALGO_ENGINE_DIR, "..", "python-bridge", "data", "underlying"))
OUT_DIR = os.path.abspath(os.path.join(ALGO_ENGINE_DIR, "..", "python-bridge", "data", "screener"))
os.makedirs(OUT_DIR, exist_ok=True)

INDEX_SYMBOLS = {
    "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "NIFTYNXT50",
    "NIFTY AUTO", "NIFTY CEMENT", "NIFTY CONSR DURBL", "NIFTY FMCG",
    "NIFTY IND DEFENCE", "NIFTY IT", "NIFTY METAL", "NIFTY OIL AND GAS",
    "NIFTY PHARMA", "NIFTY PSU BANK", "NIFTY PVT BANK", "NIFTY REALTY",
    "NIFTY SERV SECTOR",
}

BARS_PER_DAY = {"15minute": 25, "5minute": 75, "1minute": 375}
TF_MINUTES = {"15minute": 15, "5minute": 5, "1minute": 1}


# ---------------------------------------------------------------------------
# Vectorized, causal indicator primitives
# ---------------------------------------------------------------------------

def ema(s: pd.Series, span: int) -> pd.Series:
    return s.ewm(span=span, adjust=False).mean()


def rma(s: pd.Series, period: int) -> pd.Series:
    """Wilder's smoothing (RSI/ATR/ADX)."""
    return s.ewm(alpha=1.0 / period, adjust=False).mean()


def rsi(close: pd.Series, period: int) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    rs = rma(gain, period) / rma(loss, period).replace(0.0, np.nan)
    return (100.0 - 100.0 / (1.0 + rs)).fillna(100.0)


def true_range(high, low, close) -> pd.Series:
    pc = close.shift(1)
    return pd.concat([(high - low), (high - pc).abs(), (low - pc).abs()], axis=1).max(axis=1)


def atr(high, low, close, period=14) -> pd.Series:
    return rma(true_range(high, low, close), period)


def adx_di(high, low, close, period=14):
    """Return (adx, plus_di, minus_di)."""
    up = high.diff()
    down = -low.diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=high.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=high.index)
    atr_ = rma(true_range(high, low, close), period).replace(0.0, np.nan)
    plus_di = 100.0 * rma(plus_dm, period) / atr_
    minus_di = 100.0 * rma(minus_dm, period) / atr_
    dx = 100.0 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0.0, np.nan)
    return rma(dx.fillna(0.0), period), plus_di.fillna(0.0), minus_di.fillna(0.0)


def macd(close, fast=12, slow=26, signal=9):
    line = ema(close, fast) - ema(close, slow)
    sig = ema(line, signal)
    return line, sig, line - sig


def rolling_z(series, window):
    m = series.rolling(window, min_periods=window // 2).mean()
    s = series.rolling(window, min_periods=window // 2).std(ddof=0)
    return (series - m) / s.replace(0.0, np.nan)


def stochastic(high, low, close, k=14, d=3):
    ll = low.rolling(k, min_periods=k // 2).min()
    hh = high.rolling(k, min_periods=k // 2).max()
    pk = 100.0 * (close - ll) / (hh - ll).replace(0.0, np.nan)
    return pk, pk.rolling(d, min_periods=1).mean()


def williams_r(high, low, close, period=14):
    hh = high.rolling(period, min_periods=period // 2).max()
    ll = low.rolling(period, min_periods=period // 2).min()
    return -100.0 * (hh - close) / (hh - ll).replace(0.0, np.nan)


def cci(high, low, close, period=20):
    tp = (high + low + close) / 3.0
    sma_tp = tp.rolling(period, min_periods=period // 2).mean()
    mad = (tp - sma_tp).abs().rolling(period, min_periods=period // 2).mean()
    return (tp - sma_tp) / (0.015 * mad.replace(0.0, np.nan))


# ---------------------------------------------------------------------------
# Loading + daily (prior-day) context
# ---------------------------------------------------------------------------

def load_raw(symbol: str, tf: str):
    p = os.path.join(DATA_ROOT, symbol, tf, "data.parquet")
    if not os.path.exists(p):
        return None
    df = pd.read_parquet(p)
    if df.empty:
        return None
    df["datetime"] = pd.to_datetime(df["timestamp"].str.slice(0, 19))
    df["date"] = df["datetime"].dt.date
    df["time"] = df["datetime"].dt.time
    df = df.sort_values("datetime").drop_duplicates("datetime").reset_index(drop=True)
    for c in ("open", "high", "low", "close", "volume"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def compute_daily_context(symbol: str) -> pd.DataFrame:
    """Daily features keyed by date, SHIFTED one day (date D carries info through D-1)."""
    d = load_raw(symbol, "day")
    if d is None or len(d) < 30:
        return None
    c, h, l, v = d["close"], d["high"], d["low"], d["volume"]
    f = pd.DataFrame({"date": d["date"]})
    f["d_ema20"] = ema(c, 20)
    f["d_ema50"] = ema(c, 50)
    f["d_ema200"] = ema(c, 200)
    a, _, _ = adx_di(h, l, c, 14)
    f["d_adx14"] = a
    f["d_atr14"] = atr(h, l, c, 14)
    f["d_atr_pct"] = f["d_atr14"] / c * 100.0
    f["d_rsi14"] = rsi(c, 14)
    f["d_trend"] = np.where((f["d_ema20"] > f["d_ema50"]) & (c > f["d_ema20"]), 1,
                            np.where((f["d_ema20"] < f["d_ema50"]) & (c < f["d_ema20"]), -1, 0))
    f["d_ret_1"] = c.pct_change(1) * 100.0
    f["d_ret_5"] = c.pct_change(5) * 100.0
    f["d_ret_20"] = c.pct_change(20) * 100.0
    f["d_avg_vol20"] = v.rolling(20, min_periods=5).mean()
    f["d_rvol"] = v / f["d_avg_vol20"].replace(0.0, np.nan)
    f["d_range_pct"] = (h - l) / c * 100.0
    f["d_52w_high"] = h.rolling(252, min_periods=20).max()
    f["d_52w_low"] = l.rolling(252, min_periods=20).min()
    f["prev_close"] = c
    f["prev_high"] = h
    f["prev_low"] = l
    f["prev_open"] = d["open"]
    # Shift everything by one trading day -> no look-ahead.
    cols = [col for col in f.columns if col != "date"]
    f[cols] = f[cols].shift(1)
    return f


# ---------------------------------------------------------------------------
# Per-symbol intraday feature panel
# ---------------------------------------------------------------------------

def build_symbol(symbol: str, tf: str) -> pd.DataFrame:
    df = load_raw(symbol, tf)
    if df is None or len(df) < 60:
        return None
    o, h, l, c, v = df["open"], df["high"], df["low"], df["close"], df["volume"]
    bars = BARS_PER_DAY.get(tf, 25)
    tf_min = TF_MINUTES.get(tf, 15)
    date = df["date"]

    out = pd.DataFrame({
        "symbol": symbol, "timeframe": tf, "datetime": df["datetime"],
        "date": date, "time": df["time"],
        "open": o, "high": h, "low": l, "close": c, "volume": v,
    })

    # ---------- session / timing ----------
    out["bar_of_day"] = df.groupby("date").cumcount()
    out["bars_to_close"] = (bars - 1) - out["bar_of_day"]
    secs = df["datetime"].dt.hour * 60 + df["datetime"].dt.minute
    out["minutes_since_open"] = secs - (9 * 60 + 15)
    out["is_first_bar"] = (out["bar_of_day"] == 0).astype(int)
    out["session_progress"] = out["bar_of_day"] / max(1, bars - 1)
    out["time_slot"] = np.select([secs < 600, secs < 690, secs < 810, secs < 870],
                                  [0, 1, 2, 3], default=4)  # open/morning/lunch/afternoon/power

    # ---------- price / candle anatomy / returns ----------
    out["ret_1"] = c.pct_change(1) * 100.0
    out["ret_5"] = c.pct_change(5) * 100.0
    out["ret_15"] = c.pct_change(15) * 100.0
    out["log_ret"] = np.log(c / c.shift(1))
    rng = (h - l).replace(0.0, np.nan)
    out["hl_range_pct"] = (h - l) / c * 100.0
    out["body_pct"] = (c - o).abs() / c * 100.0
    out["upper_wick_pct"] = (h - np.maximum(o, c)) / rng
    out["lower_wick_pct"] = (np.minimum(o, c) - l) / rng
    out["close_position"] = (c - l) / rng  # where close sits in the bar [0,1]

    # ---------- trend / moving averages ----------
    for span in (9, 21, 50, 200):
        out[f"ema_{span}"] = ema(c, span)
        out[f"dist_ema{span}_pct"] = (c - out[f"ema_{span}"]) / out[f"ema_{span}"] * 100.0
    out["sma_20"] = c.rolling(20, min_periods=10).mean()
    out["sma_50"] = c.rolling(50, min_periods=25).mean()
    out["sma_200"] = c.rolling(200, min_periods=100).mean()
    out["ema_stack"] = np.where((out["ema_9"] > out["ema_21"]) & (out["ema_21"] > out["ema_50"]), 1,
                                np.where((out["ema_9"] < out["ema_21"]) & (out["ema_21"] < out["ema_50"]), -1, 0))
    out["ema9_slope"] = out["ema_9"].pct_change(3) * 100.0
    out["ema21_slope"] = out["ema_21"].pct_change(3) * 100.0
    out["ema50_slope"] = out["ema_50"].pct_change(5) * 100.0
    m, sg, hst = macd(c)
    out["macd"], out["macd_signal"], out["macd_hist"] = m, sg, hst
    out["roc_10"] = c.pct_change(10) * 100.0
    out["roc_20"] = c.pct_change(20) * 100.0
    adx_, pdi, mdi = adx_di(h, l, c, 14)
    out["adx_14"], out["plus_di"], out["minus_di"] = adx_, pdi, mdi

    # ---------- intraday VWAP (daily reset) + bands ----------
    typ = (h + l + c) / 3.0
    cum_pv = (typ * v).groupby(date).cumsum()
    cum_v = v.groupby(date).cumsum().replace(0.0, np.nan)
    out["vwap"] = cum_pv / cum_v
    out["dist_vwap_pct"] = (c - out["vwap"]) / out["vwap"] * 100.0
    # intraday rolling std of price for vwap sigma bands
    std20 = c.rolling(20, min_periods=10).std(ddof=0)
    out["vwap_sigma"] = (c - out["vwap"]) / std20.replace(0.0, np.nan)
    # expanding within-day deviation z-score (pure intraday, no cross-day bleed)
    dev = c - out["vwap"]
    out["vwap_z"] = dev.groupby(date).transform(
        lambda s: (s - s.expanding().mean()) / s.expanding().std(ddof=0).replace(0.0, np.nan))
    out["vwap_upper_1sd"] = out["vwap"] + std20
    out["vwap_lower_1sd"] = out["vwap"] - std20
    out["vwap_upper_2sd"] = out["vwap"] + 2.0 * std20
    out["vwap_lower_2sd"] = out["vwap"] - 2.0 * std20

    # ---------- volatility ----------
    out["atr_14"] = atr(h, l, c, 14)
    out["atr_pct"] = out["atr_14"] / c * 100.0
    out["std_20"] = std20
    out["realized_vol_20"] = out["ret_1"].rolling(20, min_periods=10).std(ddof=0)
    mid = c.rolling(20, min_periods=10).mean()
    out["bb_mid"] = mid
    out["bb_upper"] = mid + 2.0 * std20
    out["bb_lower"] = mid - 2.0 * std20
    out["bb_width_pct"] = (out["bb_upper"] - out["bb_lower"]) / mid * 100.0
    out["bb_pctb"] = (c - out["bb_lower"]) / (out["bb_upper"] - out["bb_lower"]).replace(0.0, np.nan)
    kc_mid = ema(c, 20)
    out["kc_mid"] = kc_mid
    out["kc_upper"] = kc_mid + 1.5 * out["atr_14"]
    out["kc_lower"] = kc_mid - 1.5 * out["atr_14"]
    out["squeeze_on"] = ((out["bb_upper"] < out["kc_upper"]) & (out["bb_lower"] > out["kc_lower"])).astype(int)
    grp = (out["squeeze_on"] != out["squeeze_on"].shift()).cumsum()
    out["squeeze_count"] = out.groupby(grp)["squeeze_on"].cumsum()

    # ---------- mean reversion / oscillators ----------
    out["rsi_2"] = rsi(c, 2)
    out["rsi_14"] = rsi(c, 14)
    out["zscore_20"] = rolling_z(c, 20)
    out["zscore_50"] = rolling_z(c, 50)
    out["stoch_k"], out["stoch_d"] = stochastic(h, l, c, 14, 3)
    out["williams_r"] = williams_r(h, l, c, 14)
    out["cci_20"] = cci(h, l, c, 20)

    # ---------- volume / liquidity ----------
    out["vol_sma_20"] = v.rolling(20, min_periods=10).mean()
    out["vol_ratio"] = v / out["vol_sma_20"].replace(0.0, np.nan)
    out["vol_z"] = rolling_z(v, 20)
    # same-bar-of-day causal RVOL (compares this 09:45 bar to prior days' 09:45 bars)
    out["rvol_tod"] = df.groupby(out["bar_of_day"])["volume"].transform(
        lambda s: s / s.shift(1).expanding(min_periods=3).mean())
    out["cum_vol_day"] = v.groupby(date).cumsum()
    out["dollar_vol"] = c * v
    out["dollar_vol_sma_20"] = out["dollar_vol"].rolling(20, min_periods=10).mean()
    out["obv"] = (np.sign(c.diff().fillna(0.0)) * v).cumsum()

    # ---------- opening range ----------
    or_bars = max(1, 15 // tf_min)
    in_or = out["bar_of_day"] < or_bars
    or_h = h.where(in_or).groupby(date).transform("max")
    or_l = l.where(in_or).groupby(date).transform("min")
    out["or_high"] = or_h
    out["or_low"] = or_l
    out["or_mid"] = (or_h + or_l) / 2.0
    out["day_open"] = o.groupby(date).transform("first")
    out["or_range_pct"] = (or_h - or_l) / out["day_open"] * 100.0
    out["dist_or_high_pct"] = (c - or_h) / or_h * 100.0
    out["dist_or_low_pct"] = (c - or_l) / or_l * 100.0
    out["broke_or_high"] = ((c > or_h) & (out["bar_of_day"] >= or_bars)).astype(int)
    out["broke_or_low"] = ((c < or_l) & (out["bar_of_day"] >= or_bars)).astype(int)

    # opening-range intraday STATE (causal) -> enables retest/breakout strategies
    out["broke_or_high_today"] = out.groupby(date)["broke_or_high"].cummax()
    out["broke_or_low_today"] = out.groupby(date)["broke_or_low"].cummax()
    bsh = out.groupby(date)["broke_or_high_today"].cumsum() - 1
    out["bars_since_or_high_break"] = bsh.where(out["broke_or_high_today"] == 1, -1).astype(int)
    bsl = out.groupby(date)["broke_or_low_today"].cumsum() - 1
    out["bars_since_or_low_break"] = bsl.where(out["broke_or_low_today"] == 1, -1).astype(int)
    # retest = at least one bar after the break, price returns to touch the broken boundary
    retest_hi = ((out["bars_since_or_high_break"] >= 1) & (l <= or_h)).astype(int)
    retest_lo = ((out["bars_since_or_low_break"] >= 1) & (h >= or_l)).astype(int)
    out["retested_or_high"] = retest_hi.groupby(date).cummax()
    out["retested_or_low"] = retest_lo.groupby(date).cummax()
    # reclaim = retested earlier and now resuming THROUGH the boundary (the entry trigger)
    out["reclaimed_or_high"] = ((out["retested_or_high"] == 1) & (c > or_h)
                                & (out["bar_of_day"] >= or_bars)).astype(int)
    out["reclaimed_or_low"] = ((out["retested_or_low"] == 1) & (c < or_l)
                               & (out["bar_of_day"] >= or_bars)).astype(int)

    # ---------- daily (prior-day) context ----------
    dctx = compute_daily_context(symbol)
    daily_cols = ["d_ema20", "d_ema50", "d_ema200", "d_adx14", "d_atr14", "d_atr_pct",
                  "d_rsi14", "d_trend", "d_ret_1", "d_ret_5", "d_ret_20", "d_avg_vol20",
                  "d_rvol", "d_range_pct", "d_52w_high", "d_52w_low",
                  "prev_close", "prev_high", "prev_low", "prev_open"]
    if dctx is not None:
        out = out.merge(dctx, on="date", how="left")
    else:
        for col in daily_cols:
            out[col] = np.nan
    out["gap_pct"] = (out["day_open"] - out["prev_close"]) / out["prev_close"] * 100.0
    out["dist_52w_high_pct"] = (c - out["d_52w_high"]) / out["d_52w_high"] * 100.0
    out["dist_52w_low_pct"] = (c - out["d_52w_low"]) / out["d_52w_low"] * 100.0
    out["dist_d_ema50_pct"] = (c - out["d_ema50"]) / out["d_ema50"] * 100.0

    # ---------- stock-type day-shape features (docs/algo/strategy_brief.md) ----------
    # Every feature here is causal: running day extremes + within-day state + prior-day
    # ATR/close only. These feed the Type 1-5 cash classifier and the 4 F&O setups.
    day_low = l.groupby(date).cummin()
    day_high = h.groupby(date).cummax()
    day_rng = (day_high - day_low).replace(0.0, np.nan)
    out["day_low_run"] = day_low
    out["day_high_run"] = day_high
    # "A stock sitting at 90%+ of its day's range is exhausted; 40-60% still has room."
    out["day_range_pos"] = ((c - day_low) / day_rng).clip(0.0, 1.0)
    out["low_vs_open"] = day_low / out["day_open"]
    out["chg_from_open_pct"] = (c - out["day_open"]) / out["day_open"] * 100.0
    # running pullback depth from the session peak
    out["pb_depth_pct"] = (day_high - c) / day_high.replace(0.0, np.nan) * 100.0
    # "The big move comes later" -> how far above the open has the session peaked so far
    out["push_from_open_pct"] = (day_high - out["day_open"]) / out["day_open"].replace(0.0, np.nan) * 100.0

    # bars since the running day high was last touched (0 = this bar IS at HOD)
    new_high = (h >= day_high - 1e-9).astype(int)
    out["new_high_today"] = new_high
    hi_run = out.groupby(date)["new_high_today"].cumsum()
    last_high_bar = out.groupby([date, hi_run])["bar_of_day"].transform("min")
    out["bars_since_day_high"] = out["bar_of_day"] - last_high_bar

    # first-candle anatomy: "A very big first candle almost always means front-loaded."
    prev_c = c.shift(1)  # row before bar 0 of a day is the prior day's last bar
    fc = ((h - l) / prev_c.replace(0.0, np.nan) * 100.0).where(out["bar_of_day"] == 0)
    out["fc_range_pct"] = out["date"].map(fc.groupby(date).first())
    # "20x-50x normal volume in the first minutes" -> first 15-min volume vs trailing 20d mean
    v15 = v.where(out["bar_of_day"] < max(1, 15 // tf_min)).groupby(date).sum()
    v15_base = v15.shift(1).rolling(20, min_periods=5).mean()
    out["fc15_vol_ratio"] = out["date"].map(v15 / v15_base.replace(0.0, np.nan))

    # volume character: "steadily ticking up" vs "all volume in the first 10 minutes"
    vol9_mean = v.groupby(date).transform(lambda s: s.rolling(9, min_periods=1).mean())
    pace_so_far = v.groupby(date).transform(lambda s: s.expanding().mean())
    out["vol_pace_45"] = vol9_mean / pace_so_far.replace(0.0, np.nan)  # >1 = accelerating tail
    vol9_std = v.groupby(date).transform(lambda s: s.rolling(9, min_periods=2).std(ddof=0))
    out["vol_stab_45"] = vol9_std / vol9_mean.replace(0.0, np.nan)     # low = steady, no bursts
    # "move looks tired": recent bodies vs opening-30m bodies
    body = (c - o).abs()
    body_recent = body.groupby(date).transform(lambda s: s.rolling(3, min_periods=1).mean())
    body_open30 = body.where(out["bar_of_day"] < 6).groupby(date).mean()
    out["body_open30"] = out["date"].map(body_open30)
    out["candle_body_fade"] = body_recent / out["body_open30"].replace(0.0, np.nan)
    # "80-90% of its expected daily range" covered already
    out["em_coverage"] = day_rng / out["d_atr14"].replace(0.0, np.nan)
    # freeze: tiny range AND no net drift, consecutive within the day
    frozen = (((h - l) < 0.25 * out["atr_14"])
              & ((c - c.shift(1)).abs() / c.replace(0.0, np.nan) < 0.001)
              & (out["bar_of_day"] > 0)).astype(int)
    frun = (frozen != frozen.shift()).cumsum()
    out["freeze_streak"] = frozen.groupby([date, frun]).cumsum()
    # pullback character (Type 3): recent 3-bar volume vs average per-bar volume on
    # bars that were making new session highs; recent 30-min low vs the open
    push_mask = (new_high == 1) & (out["bar_of_day"] >= 3)
    push_vol_mean = v.where(push_mask).groupby(date).transform(
        lambda s: s.expanding(min_periods=2).mean())
    recent_vol = v.groupby(date).transform(lambda s: s.rolling(3, min_periods=1).mean())
    out["pb_vol_ratio"] = recent_vol / push_vol_mean.replace(0.0, np.nan)
    low6 = l.groupby(date).transform(lambda s: s.rolling(6, min_periods=1).min())
    out["low6_vs_open_pct"] = (low6 - out["day_open"]) / out["day_open"].replace(0.0, np.nan) * 100.0
    # fraction of session-so-far spent pinned to the day low ("building a base at the low")
    near_low = (c <= day_low * 1.005).astype(int)
    out["time_near_low_pct"] = near_low.groupby(date).cumsum() / (out["bar_of_day"] + 1)

    # warmup: ema_200 needs ~200 bars
    out["warmup"] = (np.arange(len(out)) < 200).astype(int)
    return out.copy()  # de-fragment before returning


# ---------------------------------------------------------------------------
# Cross-sectional ranks (per timestamp, across the universe) -> stock selection
# ---------------------------------------------------------------------------

# direct percentile ranks (higher value -> rank near 1.0)
CS_DIRECT = {
    "ret_1": "cs_rank_ret_1",
    "ret_5": "cs_rank_ret_5",
    "d_ret_20": "cs_rank_mom_20d",
    "vol_ratio": "cs_rank_rvol",
    "rvol_tod": "cs_rank_rvol_tod",
    "atr_pct": "cs_rank_atr",
    "dollar_vol": "cs_rank_liquidity",
    "adx_14": "cs_rank_adx",
    "dist_vwap_pct": "cs_rank_dist_vwap",
    "rsi_14": "cs_rank_rsi14",
    "gap_pct": "cs_rank_gap",
    "or_range_pct": "cs_rank_or_range",   # LOW rank = tightest opening range (best for ORB)
    "squeeze_count": "cs_rank_squeeze",
}
# absolute-magnitude ranks (extremeness either side)
CS_ABS = {
    "dist_vwap_pct": "cs_rank_abs_dist_vwap",
    "gap_pct": "cs_rank_abs_gap",
    "zscore_20": "cs_rank_abs_zscore",
}


def add_cross_sectional_ranks(panel: pd.DataFrame) -> pd.DataFrame:
    g = panel.groupby("datetime")
    new_cols = {}
    for src, dst in CS_DIRECT.items():
        new_cols[dst] = g[src].rank(pct=True)
    for src, dst in CS_ABS.items():
        new_cols[dst] = panel[src].abs().groupby(panel["datetime"]).rank(pct=True)
    # concat all rank columns at once to avoid DataFrame fragmentation
    panel = pd.concat([panel, pd.DataFrame(new_cols, index=panel.index)], axis=1)
    return panel


# ---------------------------------------------------------------------------
# Orchestration + validation
# ---------------------------------------------------------------------------

def discover_symbols() -> list:
    syms = [d for d in os.listdir(DATA_ROOT) if os.path.isdir(os.path.join(DATA_ROOT, d))]
    return sorted(s for s in syms if s not in INDEX_SYMBOLS)


def build_dataset(tf: str, limit: int = 0, verbose: bool = True) -> str:
    symbols = discover_symbols()
    if limit > 0:
        symbols = symbols[:limit]
    t0 = time.time()
    if verbose:
        print(f"[BUILD] tf={tf} | {len(symbols)} symbols -> {OUT_DIR}")

    frames, ok, errors = [], 0, []
    for i, sym in enumerate(symbols, 1):
        try:
            f = build_symbol(sym, tf)
        except Exception as e:
            errors.append({"symbol": sym, "error": str(e)})
            f = None
        if f is not None and len(f):
            frames.append(f)
            ok += 1
        if verbose and i % 25 == 0:
            print(f"  ...{i}/{len(symbols)} processed, {ok} ok, "
                  f"{sum(len(x) for x in frames):,} rows, {time.time()-t0:.0f}s")
    if not frames:
        raise RuntimeError("no symbols produced features")

    panel = pd.concat(frames, ignore_index=True)
    if verbose:
        print(f"[BUILD] {len(panel):,} rows; computing cross-sectional ranks...")
    panel = add_cross_sectional_ranks(panel)
    panel = panel.sort_values(["datetime", "symbol"]).reset_index(drop=True)

    float_cols = panel.select_dtypes(include=["float64"]).columns
    panel[float_cols] = panel[float_cols].astype("float32")

    out_path = os.path.join(OUT_DIR, f"features_{tf}.parquet")
    panel.to_parquet(out_path, index=False, engine="pyarrow", compression="snappy")

    meta = {
        "timeframe": tf,
        "built_at": dt.datetime.now().isoformat(timespec="seconds"),
        "symbols": ok, "rows": int(len(panel)),
        "date_min": str(panel["date"].min()), "date_max": str(panel["date"].max()),
        "n_columns": int(panel.shape[1]),
        "columns": list(panel.columns),
        "cross_sectional_ranks": list(CS_DIRECT.values()) + list(CS_ABS.values()),
        "errors": errors,
        "build_seconds": round(time.time() - t0, 1),
    }
    with open(os.path.join(OUT_DIR, f"features_{tf}_meta.json"), "w") as fh:
        json.dump(meta, fh, indent=2)

    if verbose:
        validate(panel)
        print(f"[DONE] {out_path}  ({os.path.getsize(out_path)/1e6:.1f} MB, {len(panel):,} rows, "
              f"{ok} symbols, {panel.shape[1]} cols, {time.time()-t0:.0f}s)")
        if errors:
            print(f"  errors ({len(errors)}):", errors[:3])
    return out_path


def validate(panel: pd.DataFrame):
    print("\n--- VALIDATION ---")
    print(f"rows={len(panel):,} symbols={panel['symbol'].nunique()} "
          f"dates {panel['date'].min()}..{panel['date'].max()} cols={panel.shape[1]}")
    post = panel[panel["warmup"] == 0]
    key = ["vwap", "atr_14", "rsi_14", "adx_14", "ema_50", "ema_200", "vol_ratio",
           "rvol_tod", "dist_vwap_pct", "bb_pctb", "stoch_k", "cci_20", "squeeze_on",
           "gap_pct", "d_ema50", "dist_52w_high_pct", "cs_rank_rvol", "cs_rank_mom_20d",
           "day_range_pos", "em_coverage", "fc_range_pct", "fc15_vol_ratio",
           "vol_pace_45", "candle_body_fade", "freeze_streak", "pb_vol_ratio",
           "time_near_low_pct", "bars_since_day_high"]
    nan = {k: round(float(post[k].isna().mean()) * 100, 3) for k in key if k in post.columns}
    print("post-warmup NaN% (key cols):", nan)
    print("duplicate (symbol,datetime):", int(panel.duplicated(["symbol", "datetime"]).sum()))
    print("------------------\n")


def main():
    ap = argparse.ArgumentParser(description="Build the canonical screener feature dataset")
    ap.add_argument("--tf", type=str, default="15minute", choices=["15minute", "5minute", "1minute"])
    ap.add_argument("--limit", type=int, default=0, help="0 = full universe; else first N (smoke)")
    args = ap.parse_args()
    build_dataset(args.tf, args.limit)


if __name__ == "__main__":
    main()
