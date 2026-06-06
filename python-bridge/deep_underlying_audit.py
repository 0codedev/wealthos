import os
import sys
import pandas as pd
import numpy as np

sys.path.append("python-bridge")
import db
from routers.shared import upstox_client

coforge_key = db.get_upstox_instrument_key("COFORGE", exchange="NSE_EQ")
mankind_key = db.get_upstox_instrument_key("MANKIND", exchange="NSE_EQ")

def fetch_and_analyze(key, symbol, target_date):
    k_enc = key.replace("|", "%7C")
    res = upstox_client.get_historical_candles(k_enc, "5minute", target_date, target_date)
    candles = []
    if res.get("status") == "success" and "data" in res:
        candles = res["data"].get("candles", [])
    if not candles:
        # try intraday
        res = upstox_client.get_intraday_candles(k_enc, "5minute")
        if res.get("status") == "success" and "data" in res:
            candles = res["data"].get("candles", [])
            
    print(f"\n=================== {symbol} on {target_date} ===================")
    if not candles:
        print(f"No candles returned for {symbol}")
        return
        
    df = pd.DataFrame(candles, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume', 'oi'])
    df = df[df['timestamp'].str.startswith(target_date)].copy()
    df = df.iloc[::-1].reset_index(drop=True) # chronological
    
    # Calculate Cumulative VWAP
    df['tp'] = (df['high'] + df['low'] + df['close']) / 3.0
    df['cum_vol'] = df['volume'].cumsum()
    df['cum_tp_vol'] = (df['tp'] * df['volume']).cumsum()
    df['vwap'] = df['cum_tp_vol'] / df['cum_vol']
    df['dist_vwap_pct'] = ((df['close'] - df['vwap']) / df['vwap']) * 100.0
    
    print(f"Total 5m candles: {len(df)}")
    print(f"Day Range: Low={df['low'].min():.2f}, High={df['high'].max():.2f}")
    
    print("\nMorning Candles (09:15 to 11:30):")
    subset = df[df['timestamp'].str.slice(11, 16) <= "11:30"]
    for idx, row in subset.iterrows():
        t = row['timestamp'][11:16]
        c_type = "GREEN" if row['close'] >= row['open'] else "RED  "
        print(f"{t} | {c_type} | O:{row['open']:7.1f} H:{row['high']:7.1f} L:{row['low']:7.1f} C:{row['close']:7.1f} | Vol:{row['volume']:7.0f} | VWAP:{row['vwap']:7.1f} (Dist:{row['dist_vwap_pct']:+5.2f}%)")

if coforge_key:
    fetch_and_analyze(coforge_key, "COFORGE", "2026-09-30")

if mankind_key:
    fetch_and_analyze(mankind_key, "MANKIND", "2026-09-29")
