import requests
import os
import json

TOKEN_FILE = os.path.join(os.path.dirname(__file__), "upstox_token.txt")
with open(TOKEN_FILE, "r") as f:
    token = f.read().strip()

headers = {
    "Accept": "application/json",
    "Authorization": f"Bearer {token}"
}

# Test expiries for Nifty
url = "https://api.upstox.com/v2/instruments/expiry"
params = {
    "instrument_key": "NSE_INDEX|Nifty 50",
    "segment": "options"
}

resp = requests.get(url, headers=headers, params=params)
print("NIFTY expiries response code:", resp.status_code)
try:
    print("NIFTY expiries response JSON:", json.dumps(resp.json(), indent=2))
except Exception as e:
    print("NIFTY response raw content:", resp.content)

# Test expiries for a stock like SBIN
# First get SBIN key
import sqlite3
DB_FILE = os.path.join(os.path.dirname(__file__), "cache.db")
conn = sqlite3.connect(DB_FILE)
cursor = conn.cursor()
cursor.execute("SELECT instrument_key FROM upstox_instruments WHERE symbol = 'SBIN' AND exchange = 'NSE_EQ'")
row = cursor.fetchone()
conn.close()

if row:
    sbin_key = row[0]
    print("\nSBIN key resolved:", sbin_key)
    params_sbin = {
        "instrument_key": sbin_key,
        "segment": "options"
    }
    resp_sbin = requests.get(url, headers=headers, params=params_sbin)
    print("SBIN expiries response code:", resp_sbin.status_code)
    try:
        print("SBIN expiries response JSON:", json.dumps(resp_sbin.json(), indent=2))
    except Exception as e:
        print("SBIN response raw content:", resp_sbin.content)
else:
    print("\nSBIN key not found in cache.db")
