import os, sys, time
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from screener.build_screener import load_features, available_symbols, SCREENER_ROOT

syms = available_symbols("15minute")
print("symbols(15m):", len(syms))
t = time.time(); rows = 0
for s in syms[:50]:
    df = load_features(s, "15minute")
    rows += len(df)
print(f"loaded 50 symbols ({rows} rows) in {time.time()-t:.2f}s")

t = time.time()
df = load_features("RELIANCE", "15minute", from_date="2024-01-01", to_date="2026-06-28")
print(f"date-sliced single load: {len(df)} rows in {time.time()-t:.3f}s")

tot = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(SCREENER_ROOT) for f in fs)
print(f"feature store size: {tot/1e6:.0f} MB")
