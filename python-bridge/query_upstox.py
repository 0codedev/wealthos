import os
import sys
import json
from datetime import datetime, timedelta
import db
from routers.shared import upstox_client, sanitize_symbol

coforge_key = db.get_upstox_instrument_key("COFORGE", exchange="NSE_EQ")
mankind_key = db.get_upstox_instrument_key("MANKIND", exchange="NSE_EQ")
print("COFORGE KEY:", coforge_key)
print("MANKIND KEY:", mankind_key)

today_str = datetime.now().strftime("%Y-%m-%d")
from_str = (datetime.now() - timedelta(days=5)).strftime("%Y-%m-%d")

if coforge_key:
    k_enc = coforge_key.replace("|", "%7C")
    res = upstox_client.get_historical_candles(k_enc, "5minute", today_str, from_str)
    if res.get("status") == "success" and "data" in res:
        candles = res["data"].get("candles", [])
        print(f"Fetched {len(candles)} 5m candles for COFORGE")
        print("Latest 10 candles (most recent first):")
        for c in candles[:10]:
            print(c)
