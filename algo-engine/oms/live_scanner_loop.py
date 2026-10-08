"""Production daily scanner and OpenAlgo signal dispatcher loop.

This script scans candidate pools daily at the entry cutoffs (9:30 AM IST)
and dispatches ranked signals directly to the OpenAlgo OMS bridge.
"""

import os
import sys
import argparse
import datetime
import pandas as pd
import numpy as np

# Adjust path to import from parent folders
PARENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PARENT_DIR not in sys.path:
    sys.path.insert(0, PARENT_DIR)

from strategies.base_strategy import Signal
from oms.openalgo_executor import execute_signal

# Whitelist registry from backtester
WHITELISTS = {
    "orb": ["BEL", "DLF", "RECLTD", "INDIGO", "COCHINSHIP", "ABB", "BRITANNIA"],
    "snap": ["HDFCBANK", "ICICIBANK", "RELIANCE", "TCS", "INFY"],
    "squeeze": ["GODREJPROP", "DLF", "OBEROIRLTY"],
    "gap": ["TVSMOTOR", "M&M", "MARUTI"],
    "vwap": ["INDIGO", "HINDALCO"],
    "mtf": ["BEL", "DLF", "RECLTD", "INDIGO", "COCHINSHIP", "ABB", "BRITANNIA"]
}

# Declarative strategies registry (must match scanner_backtest.py exactly)
STRATEGIES = {
    "orb": {
        "tf": "15minute",
        "score": "or_range_pct", "score_ascending": True,
        "stop_atr_mult": 1.5,
        "target_atr_mult": 3.0,
        "long":  lambda d: (d.reclaimed_or_high == 1) & (d.adx_14 > 20) & (d.d_trend >= 0) & (d.vol_ratio > 1.3),
        "short": lambda d: (d.reclaimed_or_low == 1) & (d.adx_14 > 20) & (d.d_trend <= 0) & (d.vol_ratio > 1.3),
    },
    "snap": {
        "tf": "15minute",
        "score": "cs_rank_mom_20d", "score_ascending": False,
        "stop_atr_mult": 0.75,
        "target_atr_mult": 2.0,
        "long":  lambda d: (d.close > d.ema_21) & (d.adx_14 > 25) & (d.d_trend >= 0) & (d.low <= d.ema_9 * 1.001) & (d.close > d.ema_9) & (d.cs_rank_mom_20d > 0.8),
        "short": lambda d: (d.close < d.ema_21) & (d.adx_14 > 25) & (d.d_trend <= 0) & (d.high >= d.ema_9 * 0.999) & (d.close < d.ema_9) & (d.cs_rank_mom_20d < 0.2),
    },
    "squeeze": {
        "tf": "5minute",
        "score": "bb_width_pct", "score_ascending": True,
        "stop_atr_mult": 1.5,
        "target_atr_mult": 3.0,
        "long":  lambda d: (d.squeeze_on == 0) & (d.squeeze_on.shift(1) == 1) & (d.squeeze_count.shift(1) >= 6) & (d.macd_hist > 0),
        "short": lambda d: (d.squeeze_on == 0) & (d.squeeze_on.shift(1) == 1) & (d.squeeze_count.shift(1) >= 6) & (d.macd_hist < 0),
    },
    "gap": {
        "tf": "5minute",
        "score": "gap_pct", "score_ascending": False,
        "stop_atr_mult": 1.5,
        "target_atr_mult": 2.0,
        "long":  lambda d: (d.gap_pct < -1.0) & (d.close > d.open) & (d.vol_ratio < 1.0),
        "short": lambda d: (d.gap_pct > 1.0) & (d.close < d.open) & (d.vol_ratio < 1.0),
    },
    "vwap": {
        "tf": "15minute",
        "score": "vwap_z", "score_ascending": False,
        "stop_atr_mult": 1.5,
        "target_atr_mult": 2.0,
        "long":  lambda d: (d.vwap_z < -2.0) & (d.d_adx14 < 18),
        "short": lambda d: (d.vwap_z > 2.0) & (d.d_adx14 < 18),
    },
    "mtf": {
        "tf": "15minute",
        "score": "cs_rank_mom_20d", "score_ascending": False,
        "stop_atr_mult": 1.5,
        "target_atr_mult": 3.0,
        "long":  lambda d: (d.close > d.ema_50) & (d.d_trend >= 0) & (d.rsi_14 > 60) & (d.cs_rank_mom_20d > 0.8),
        "short": lambda d: (d.close < d.ema_50) & (d.d_trend <= 0) & (d.rsi_14 < 40) & (d.cs_rank_mom_20d < 0.2),
    }
}

def load_latest_features(tf: str) -> pd.DataFrame:
    """Load latest calculate feature panel from python-bridge."""
    path = os.path.join(PARENT_DIR, "..", "python-bridge", "data", "screener", f"features_{tf}.parquet")
    if not os.path.exists(path):
        raise FileNotFoundError(f"Feature panel not found at: {path}")
    return pd.read_parquet(path)

def get_dynamic_quantity(close: float, atr: float, stop_mult: float, capital: float, risk_pct: float) -> int:
    """Compute dynamic position size using risk budget formula."""
    stop_dist = max(atr * stop_mult, 0.005 * close)
    risk_rupees = capital * risk_pct
    qty = int(risk_rupees / stop_dist)
    
    # Enforce capital allocation cap (max 20% of capital per position)
    max_value = 0.20 * capital
    qty_cap = int(max_value / close)
    
    final_qty = max(1, min(qty, qty_cap))
    return final_qty

def execute_daily_scan(strategy_name: str, test_run: bool = False, capital: float = 100000.0, risk_pct: float = 0.02, top_n: int = 3):
    print(f"\n[LIVE SCANNER] Starting scan for '{strategy_name}' (test_run={test_run})...")
    
    if strategy_name not in STRATEGIES:
        print(f"[ERROR] Strategy '{strategy_name}' not registered.")
        return
        
    sdef = STRATEGIES[strategy_name]
    tf = sdef["tf"]
    
    # 1. Load Parquet
    try:
        panel = load_latest_features(tf)
    except Exception as e:
        print(f"[ERROR] Failed to load features: {e}")
        return
        
    # 2. Filter Whitelist
    whitelist = WHITELISTS.get(strategy_name, [])
    panel = panel[panel["symbol"].isin(whitelist)].copy()
    
    if panel.empty:
        print(f"[WARNING] No whitelisted symbol rows found in panel.")
        return
        
    # 3. Determine run date
    # In production, we filter for today's date. In test_run or backtest validation, we filter for the latest date.
    if test_run:
        target_date = str(panel["date"].max())
        print(f"[TEST RUN] Simulating scan on latest available date: {target_date}")
    else:
        target_date = datetime.date.today().strftime("%Y-%m-%d")
        print(f"[PRODUCTION] Scanning for date: {target_date}")
        
    day_df = panel[panel["date"].astype(str) == target_date].copy()
    if day_df.empty:
        print(f"[WARNING] No data rows found for date: {target_date}")
        if not test_run:
            print("[INFO] Exiting daily scan because there is no live data yet today.")
            return
            
    # 4. Evaluate Declarative Gates
    candidates = []
    for side in ("long", "short"):
        f = sdef[side]
        mask = f(day_df)
        sub = day_df[mask].copy()
        if not sub.empty:
            sub["direction"] = "BUY" if side == "long" else "SELL"
            candidates.append(sub)
            
    if not candidates:
        print(f"[INFO] No entry signals matched the strategy gates on {target_date}.")
        return
        
    cand_df = pd.concat(candidates)
    
    # 5. Sort by score column and select top_n
    ascending = sdef["score_ascending"]
    score_col = sdef["score"]
    cand_df = cand_df.sort_values(by=score_col, ascending=ascending)
    selections = cand_df.groupby("symbol").first().reset_index().head(top_n)
    
    print(f"\n[RANKED SELECTIONS] Top {top_n}:")
    print(selections[["symbol", "direction", score_col, "close", "atr_14"]])
    
    # 6. Execute Signals
    for _, row in selections.iterrows():
        symbol = row["symbol"]
        direction = row["direction"]
        close = float(row["close"])
        atr = float(row["atr_14"])
        
        # Calculate brackets
        stop_mult = sdef["stop_atr_mult"]
        target_mult = sdef["target_atr_mult"]
        
        stop_dist = max(atr * stop_mult, 0.005 * close)
        target_dist = stop_dist * (target_mult / stop_mult)
        
        stop_loss = (close - stop_dist) if direction == "BUY" else (close + stop_dist)
        target = (close + target_dist) if direction == "BUY" else (close - target_dist)
        
        # Calculate dynamic size
        qty = get_dynamic_quantity(close, atr, stop_mult, capital, risk_pct)
        
        # Make Signal object
        signal = Signal(
            direction=direction,
            instrument=symbol,
            quantity=qty,
            price=close,
            stop_loss=stop_loss,
            target=target,
            strategy_name=f"Scanner_{strategy_name.upper()}",
            confidence=0.85
        )
        
        print(f"\n[DISPATCH] Symbol: {symbol} | Direction: {direction} | Qty: {qty} | Entry: {close:.2f} | SL: {stop_loss:.2f} | Target: {target:.2f}")
        
        if not test_run:
            try:
                resp = execute_signal(signal)
                print(f"[OMS RESPONSE] {resp}")
            except Exception as e:
                print(f"[OMS ERROR] Failed to dispatch signal: {e}")
        else:
            print("[TEST RUN] Signal execution skipped.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Live Scanner Loop and OpenAlgo Signal Dispatcher")
    parser.add_argument("--strategy", type=str, required=True, choices=list(STRATEGIES.keys()), help="Strategy name to run scan for")
    parser.add_argument("--test-run", action="store_true", help="Perform a dry-run/simulation on the latest data date")
    parser.add_argument("--capital", type=float, default=100000.0, help="Initial capital for sizing")
    parser.add_argument("--risk-pct", type=float, default=0.02, help="Risk percentage per trade")
    parser.add_argument("--top-n", type=int, default=3, help="Max signals to execute")
    
    args = parser.parse_args()
    execute_daily_scan(
        strategy_name=args.strategy,
        test_run=args.test_run,
        capital=args.capital,
        risk_pct=args.risk_pct,
        top_n=args.top_n
    )
