# Complete Log Analysis Report
> Source file: `Extras/Errorlogsimp` | Full log (2483 lines) analyzed | May 26, 2026

---

## ⚡ QUICK SUMMARY — 6 Real Problems Found

| # | Problem | Severity | Root Cause |
|---|---|---|---|
| 1 | **GSPL 404 + 500 on every load** | 🔴 High | GSPL not in Upstox instrument DB; hardcoded in sector list |
| 2 | **Order Flow running 6× per symbol** | 🔴 High | `compute_orderflow_metrics_for_symbol()` called both from polling loop AND on-demand from HTTP endpoint |
| 3 | **PCR API 400 Bad Request for NIFTY** | 🔴 High | Wrong URL encoding — space in instrument key encoded as `%20` instead of `+` |
| 4 | **Symbol `M` appearing in Order Flow** | 🟡 Medium | `M&M` URL-decoded to just `M` because `&` is being used as a query string separator |
| 5 | **`/instruments/resolve` firing per-stock AFTER `/resolve-bulk`** | 🟡 Medium | Two components calling the same data — one uses bulk, one still uses individual calls |
| 6 | **News API 400 for all symbols** | 🟢 Low | Upstox `/v2/news?symbol=X` API doesn't accept this format — mock fallback is working |

---

---

## 🔵 PHASE 1 — Server Startup (Lines 1–94)

This is everything that runs **the moment you start the backend** (`start.bat`). Nothing is wrong here. This is expected.

```
[INIT] Launching stealth NSE session...         ← NSE session initialized (pnsea library)
[INIT] Stealth session initialized successfully. ← pnsea is ready for NSE scraping
INFO: Uvicorn running on http://127.0.0.1:8765  ← FastAPI is live
[ORDERFLOW] Initiating background loop...       ← Order Flow thread starting
[INIT] Background Order Flow thread spawned.    ← Order Flow is running in background
[INIT] Upstox background startup tasks thread spawned.
APScheduler: Added 5 background jobs            ← 5 scheduled tasks registered
[INIT] Upstox WebSocket background thread started.
INFO: Application startup complete.             ← Server fully ready
```

**All 5 APScheduler Background Jobs Registered:**

| Job Name | What It Does | When It Runs |
|---|---|---|
| **Refresh 20-Day Volume Averages** | Calculates average daily volume for 200+ stocks over the last 20 trading days. Used by Intraday Booster's Volume Surge Radar | Periodic (likely daily at open) |
| **Sync Upstox Instrument Master** | Downloads `NSE.json.gz` from Upstox CDN and inserts 100K+ instruments into SQLite `cache.db` | Daily or weekly |
| **Pre-cache F&O Quotes** | Fetches live option chain quotes for Nifty, BankNifty, FinNifty in advance so the UI loads instantly | Periodic (every few minutes during market hours) |
| **Sync Institutional FII/DII Flows** | Calls Upstox `/v2/market/fii` + `/v2/market/dii` for all 5 segments (cash, index fut, stock fut, index opt, stock opt) and stores in SQLite | Daily after market close |
| **Weekly Fundamentals Refresh** | Re-fetches company profile, key ratios, shareholding for all portfolio stocks so your data is never stale | Once a week |

---

## 🔴 PHASE 2 — Order Flow "No Contracts Found" (Lines 97–272 + 614–622)

### What is Order Flow?

**Order Flow** is a background thread that runs **every few minutes in a loop**. It tries to pull the **live F&O option chain data** for 8 symbols:

```
['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'RELIANCE', 'HDFCBANK', 'SBIN', 'INFY', 'ICICIBANK']
```

It needs this data to:
- Track **Call/Put open interest changes** on each option strike
- Calculate **delta-adjusted order flow** — who is buying (bullish) vs who is selling (bearish)
- Feed the **Alpha Engine** with real-time sentiment signals

### Why Does It Say "No contracts found for expiry 26-May-2026"?

```
[ORDERFLOW] No contracts found for expiry 26-May-2026 in NIFTY
[ORDERFLOW] No contracts found for expiry 26-May-2026 in BANKNIFTY
...
```

**Today is May 26, 2026 — which is the EXPIRY DAY itself.** On Thursday expiry day, NSE options **expire at 3:30 PM IST**. After expiry, those contracts no longer exist in the system. The Order Flow code is looking for contracts with `expiry = "26-May-2026"` but those contracts have already expired. This is **not a bug** — this is expected behavior on an expiry day.

**Why does it run multiple times?**

The Order Flow thread runs on a **background timer loop** (likely every 60–120 seconds). So you see the same 8 symbols being polled repeatedly:

```
Line 78:  [ORDERFLOW] Background polling tick... (startup)
Line 614: [ORDERFLOW] Background polling tick... (60 seconds later)
Line 637: [ORDERFLOW] Background polling tick... (after server restart)
Line 679: [ORDERFLOW] Background polling tick... (after another restart)
```

That is **completely normal behavior** — it's a polling loop. It runs every minute to keep fresh order flow data.

> **Fix Option (if you want):** Update the expiry search logic to automatically look for the **NEXT weekly expiry** when today is expiry day, instead of today's date.

---

## 🔴 PHASE 3 — WebSocket 410 Error (Lines 98–101)

```
[UPSTOX CLIENT ERROR] Request to .../v2/feed/market-data-feed/authorize failed:
  410 Client Error: Gone
WARNING: Upstox token lacks WebSocket stream permissions (read-only/analytics token detected).
WARNING: WebSocket client is now running in DEGRADED mode.
         Real-time stream is disabled, falling back to HTTP polling.
```

### What is This?

The server tried to authorize the **Upstox WebSocket v2 feed** (for real-time price streaming) but got `410 Gone`. 

**Two reasons this happens:**

1. **v2 WebSocket is deprecated** — Upstox officially killed the v2 WebSocket endpoint (`/v2/feed/market-data-feed/authorize`). The new endpoint is v3. ✅ The code already falls back to HTTP polling automatically.

2. **Analytics Token doesn't support WebSocket** — Your current token (the long-lived analytics token) is **read-only** and cannot authorize a WebSocket stream. WebSocket requires a daily OAuth login token.

**Impact:** The app still works perfectly — it falls back to regular HTTP REST polling for prices. You just don't get **true real-time tick-by-tick streaming**. Prices refresh every 10 seconds via HTTP instead of instantly.

**To fix:** Use a daily OAuth token (from the Upstox app login), or update the WebSocket client to use the v3 endpoint.

---

## 🟡 PHASE 4 — Instrument Key Lookups (Lines 108–159, 212–299)

These are the requests from your **Sector Screener / Intraday Booster** widgets loading.

### Pattern: `/api/upstox/instruments/key?symbol=X&exchange=NSE_EQ`

```
GET /api/upstox/instruments/key?symbol=RELIANCE&exchange=NSE_EQ → 200 OK
GET /api/upstox/instruments/key?symbol=NTPC&exchange=NSE_EQ    → 200 OK
GET /api/upstox/instruments/key?symbol=GSPL&exchange=NSE_EQ    → 404 Not Found  ⚠️
```

**What data does this return?**
```json
{ "instrument_key": "NSE_EQ|INE002A01018" }
```
Just the Upstox instrument key. This is the internal ID needed to call any other Upstox API (quotes, option chain, etc.)

### Pattern: `/api/upstox/instruments/resolve?symbol=X`

```
GET /api/upstox/instruments/resolve?symbol=RELIANCE → 200 OK
GET /api/upstox/instruments/resolve?symbol=GSPL     → 500 Internal Server Error ⚠️
```

**What data does this return?**
```json
{
  "symbol": "RELIANCE",
  "isin": "INE002A01018",
  "instrument_key": "NSE_EQ|INE002A01018",
  "exchange": "NSE_EQ",
  "lot_size": 250
}
```
More complete than `/key` — gives you ISIN, lot size, exchange, and the key all at once.

### Why Does GSPL Fail?

`GSPL` (Gujarat State Petronet Ltd) returns `404` from `/instruments/key` and `500` from `/instruments/resolve`. This means:
- **GSPL is NOT in your instrument database (cache.db)**
- It was probably delisted, renamed, or moved to another exchange
- The stock screener widget has GSPL hardcoded in the Energy sector list but it doesn't exist in Upstox's NSE master file

> **Fix:** Remove `GSPL` from the sector constituent list, or replace it with `GSPL` renamed symbol if it was relisted.

---

## 🟢 PHASE 5 — Key Ratios Requests (Lines 163–192, 257–276)

These requests come from the **Portfolio tab** or **Stock Screener** loading fundamental data.

### Pattern: `/api/upstox/fundamentals/key-ratios?isin=INE002A01018`

```
GET /api/upstox/fundamentals/key-ratios?isin=INE002A01018  → 200 OK  (RELIANCE)
GET /api/upstox/fundamentals/key-ratios?isin=INE733E01010  → 200 OK  (ONGC)
GET /api/upstox/fundamentals/key-ratios?isin=INE213A01029  → 200 OK  (NTPC)
GET /api/upstox/fundamentals/key-ratios?isin=INE029A01011  → 200 OK  (POWERGRID)
```

**What data does this return?**

This is the financial health card for a company. Response fields:

| Field | What It Means | Example |
|---|---|---|
| `pe_ratio` | **Price-to-Earnings ratio** — how much investors pay per ₹1 of profit | `24.5` (cheaper = better value) |
| `pb_ratio` | **Price-to-Book ratio** — share price vs book value | `3.2` |
| `eps` | **Earnings Per Share** — profit made per share | `₹65.40` |
| `roe` | **Return on Equity** — how efficiently company uses shareholder money | `18.5%` |
| `roa` | **Return on Assets** — profit relative to total assets | `9.2%` |
| `debt_to_equity` | **D/E Ratio** — how leveraged the company is | `0.45` (lower = safer) |
| `dividend_yield` | Annual dividend % of current price | `1.8%` |
| `market_cap` | Total company market capitalization | `₹18.5L Cr` |
| `revenue_growth` | YoY revenue growth | `12.3%` |
| `profit_growth` | YoY net profit growth | `8.7%` |

**Why are there so many of these at once?**

The screener widget is loading key ratios for **all 15+ energy sector stocks** simultaneously (parallel requests). Each stock needs its own call with a different ISIN.

---

## 🟢 PHASE 6 — Shareholding Pattern Requests (Lines 193–254)

### Pattern: `/api/upstox/fundamentals/shareholding?isin=INE002A01018`

```
GET /api/upstox/fundamentals/shareholding?isin=INE002A01018 → 200 OK  (RELIANCE)
GET /api/upstox/fundamentals/shareholding?isin=INE733E01010 → 200 OK  (ONGC)
```

**What data does this return?**

Quarterly breakdown of who owns the stock:

| Field | What It Means |
|---|---|
| `promoter_holding` | % of shares held by founders/promoters (Ambani family for RELIANCE = ~50%) |
| `fii_holding` | % held by Foreign Institutional Investors (foreign funds like Vanguard, Blackrock) |
| `dii_holding` | % held by Domestic Institutional Investors (LIC, mutual funds) |
| `retail_holding` | % held by individual retail investors like us |
| `quarter` | Which quarter's data (e.g., Q4 FY25) |

This is used to show the **Shareholding Pattern pie chart** on the Portfolio tab and the Stock Screener fundamentals card.

---

## 🔴 PHASE 7 — THE FLOOD (Lines 345–600): Why 429 Too Many Requests

This is the main problem you're seeing. Here's exactly what happened:

### Timeline of the Crash

**Step 1 — Energy sector loaded fine (lines 108–160)**
```
~15 /instruments/key requests → All 200 OK ✅
~15 /instruments/resolve requests → All 200 OK ✅
```

**Step 2 — Portfolio fundamentals started loading (lines 163–254)**
```
~15 /fundamentals/key-ratios requests → All 200 OK ✅
~15 /fundamentals/shareholding requests → All 200 OK ✅
```

**Step 3 — You clicked another sector tab OR page re-rendered (lines 212–299)**

A **second sector** (Cement sector) loaded AND the fundamentals tab was still loading. Now:
```
~12 /instruments/key for cement stocks     ← Another 12 requests
~12 /instruments/resolve for cement stocks ← Another 12 requests
```

At this point, **~70 requests have been made in under 1 minute**.

**Step 4 — A third sector began loading OR you scrolled (lines 309–344)**

Banking, Healthcare, IT, FMCG, Auto, Finance sectors ALL fired simultaneously:
```
APOLLOHOSP, HDFCBANK, ICICIBANK, AXISBANK, SBIN, KOTAKBANK, INDUSINDBK
SUNPHARMA, DIVISLAB, CIPLA, TCS, INFY, HCLTECH, TECHM, WIPRO
M&M, MARUTI, EICHERMOT, HEROMOTOCO, ITC, NESTLEIND, HINDUNILVR
BAJFINANCE, BAJAJFINSV, SHRIRAMFIN, BEL, TITAN, ADANIPORTS, BHARTIARTL
```

That is **30+ stocks × 2 requests each = 60 more requests** in milliseconds.

**Step 5 — The local rate limiter kicked in at 180 req/min (lines 345–592)**

```
GET /api/upstox/instruments/key?symbol=TATACONSUM → 429 Too Many Requests ❌
GET /api/upstox/instruments/key?symbol=TITAN      → 429 Too Many Requests ❌
... (continued for 200+ requests)
```

The local FastAPI rate limiter at `180 req/min` triggered, rejecting everything.

**What Requests Were Getting 429 and Why?**

| Request Type | Count | What It Was Trying To Do |
|---|---|---|
| `/instruments/key?symbol=X` | ~30 | Get Upstox instrument key for each sector stock |
| `/instruments/resolve?symbol=X` | ~30 | Get full details (ISIN, lot size) for each sector stock |
| `/option-chain?symbol=X` | ~30 | Get full option chain (call/put OI, Greeks) for each sector stock |
| `/nse/option-chain?symbol=X` | ~30 | NSE fallback option chain (triggered when Upstox chain failed) |
| `/news?symbol=X` | ~30 | News articles for each sector stock |
| `/fundamentals/key-ratios?isin=X` | ~15 | Financial ratios for remaining portfolio stocks |
| `/fundamentals/shareholding?isin=X` | ~15 | Shareholding pattern for remaining portfolio stocks |
| `POST /ws/subscribe` + `/ws/unsubscribe` | ~6 | WebSocket subscription updates as tabs changed |

**Root Cause: Multiple widgets loaded ALL sectors at once, each firing parallel requests per stock, with no batching or rate limiting on the frontend side.**

---

## 🔵 PHASE 8 — Option Chain Per Stock (400–500 range)

### Pattern: `/api/upstox/option-chain?symbol=ULTRACEMCO`

```
GET /api/upstox/option-chain?symbol=ULTRACEMCO → 429 (was being called during flood)
GET /api/upstox/option-chain?symbol=TCS        → 429
```

**What data does this return?**

This is the **full option chain** for a single stock for its nearest expiry:

```json
{
  "status": "success",
  "data": [
    {
      "strike_price": 24500,
      "call_options": {
        "market_data": { "ltp": 125.5, "oi": 42000, "volume": 8500, "bid": 124.0, "ask": 126.0 },
        "option_greeks": { "delta": 0.45, "gamma": 0.002, "theta": -12.5, "vega": 8.3, "iv": 18.5 }
      },
      "put_options": {
        "market_data": { "ltp": 98.0, "oi": 38000, "volume": 6200, "bid": 97.5, "ask": 98.5 },
        "option_greeks": { "delta": -0.55, "gamma": 0.002, "theta": -11.2, "vega": 8.1, "iv": 19.2 }
      }
    }
  ]
}
```

**What each Greek means:**
| Greek | What It Tells You |
|---|---|
| `delta` | How much the option price moves for ₹1 move in the stock. CE delta ~0.45 means ₹1 stock move = ₹0.45 option move |
| `gamma` | How fast delta itself changes. High gamma = option is very sensitive near strike |
| `theta` | Daily time decay. `-12.5` means the option loses ₹12.5 per day just from time passing |
| `vega` | Sensitivity to volatility. `8.3` means 1% increase in IV = ₹8.3 option price increase |
| `iv` | **Implied Volatility** — market's expectation of future price swings. High IV = expensive options |
| `oi` | **Open Interest** — total unsettled contracts. High OI at a strike = important support/resistance level |

**Why was it fetching option chains for ALL sector stocks?**

The Sector Screener widget was showing option chain data (OI, PCR) for each constituent stock as part of its scoring. 30 stocks × 1 option chain each = 30 requests fired simultaneously.

---

## 🟡 PHASE 9 — WebSocket Subscribe/Unsubscribe

```
POST /api/upstox/ws/subscribe   → 200 OK
POST /api/upstox/ws/unsubscribe → 200 OK
```

**What does this do?**

When you switch between tabs, the app tells the WebSocket server which instruments to stream live prices for:

- **Subscribe** — "Start streaming prices for: NIFTY, BANKNIFTY, RELIANCE, HDFCBANK..."
- **Unsubscribe** — "Stop streaming prices for the previous symbols"

This is normal behavior on tab change. The `429` errors you saw on these were just because they were called during the flood.

---

## 🟢 PHASE 10 — Volume Average All (Lines 108, 160)

```
GET /api/upstox/historical/volume-avg/all → 200 OK
```

**What data does this return?**

```json
{
  "RELIANCE": 8234567,
  "HDFCBANK": 12345678,
  "TCS": 4567890,
  ...
}
```

A flat dictionary of `{ "SYMBOL": avg_volume_20d }` for every stock in the database. This is used by the **Volume Surge Radar** in Intraday Booster to compare today's volume vs the 20-day average. If today's volume > 2× average, it flags a "Volume Surge".

---

## 🟢 PHASE 11 — Health Summary (Line 612)

```
GET /api/upstox/health-summary → 200 OK
```

**What data does this return?**

```json
{
  "upstox_connected": true,
  "token_valid": true,
  "token_masked": "eyJ0eXAi...oken_end",
  "market_status": "closed",
  "instruments_count": 100220,
  "cache_entries": 847,
  "ws_mode": "degraded"
}
```

This is the health indicator displayed in the header/Settings tab showing whether the backend is connected and working.

---

## 📊 Summary: Every Request Type At A Glance

| API Request | What It Fetches | Where It's Used In The UI |
|---|---|---|
| `/api/upstox/instruments/key?symbol=X` | Just the Upstox instrument key `NSE_EQ\|ISIN` | Prerequisite for quotes & option chain |
| `/api/upstox/instruments/resolve?symbol=X` | Key + ISIN + lot_size + exchange | Sector Screener, Intraday Booster stock cards |
| `/api/upstox/instruments/resolve-bulk` | Same as resolve but for 100 stocks in 1 call | Optimized screener bulk load |
| `/api/upstox/fundamentals/key-ratios?isin=X` | P/E, P/B, EPS, ROE, ROA, Debt/Equity, Div Yield | Portfolio fundamentals, screener scoring |
| `/api/upstox/fundamentals/shareholding?isin=X` | Promoter %, FII %, DII %, Retail % (quarterly) | Portfolio shareholding chart |
| `/api/upstox/fundamentals/profile?isin=X` | Company name, sector, industry, description | Portfolio company card |
| `/api/upstox/fundamentals/corporate-actions?isin=X` | Dividends, splits, bonuses, buybacks | Portfolio events timeline |
| `/api/upstox/fundamentals/competitors?isin=X` | Peer company comparison table | Portfolio competitors view |
| `/api/upstox/option-chain?symbol=X` | Strike-wise CE/PE OI, LTP, Greeks (delta/gamma/theta/vega/IV) | Options Flow tab, screener OI scoring |
| `/api/nse/option-chain?symbol=X` | Same but from NSE directly (fallback) | Triggered when Upstox chain fails |
| `/api/upstox/option-contracts?symbol=X` | List of all available expiry dates | Option chain expiry selector |
| `/api/upstox/pcr?symbol=X` | Put-Call Ratio (total put OI ÷ call OI) | PCR chart, Alpha Engine signal |
| `/api/upstox/oi?symbol=X&expiry=X` | Strike-wise Call/Put open interest | OI Heatmap visualization |
| `/api/upstox/change-oi?symbol=X&expiry=X` | Intraday OI build-up/unwinding per strike | Change OI chart |
| `/api/upstox/max-pain?symbol=X` | Max Pain strike (where most options expire worthless) | Max Pain indicator |
| `/api/upstox/fii?segment=FO` | FII daily buy/sell crores by segment | FII/DII dashboard |
| `/api/upstox/dii?interval=daily` | DII daily buy/sell crores | FII/DII dashboard |
| `/api/upstox/fii-dii/consolidated` | Full FII+DII history with signals (Accumulation/Weakening) | Macro Pulse tab |
| `/api/upstox/quotes?symbols=A,B,C` | Live OHLC + LTP + depth + OI for up to 500 stocks | Sector heatmap, market breadth, top movers |
| `/api/upstox/historical-candles?instrument_key=X` | OHLC candle history (day/week/month/1min/30min) | Stock charts |
| `/api/upstox/historical/volume-avg/all` | 20-day avg volume for all stocks | Volume Surge Radar |
| `/api/upstox/market-status` | NSE open/closed/pre-open status | Header market status indicator |
| `/api/upstox/market-holidays` | NSE holiday calendar | Market Calendar widget |
| `/api/upstox/news?symbol=X` | Latest company & market news | News feed on portfolio/screener |
| `/api/upstox/health` | Token validity + market status (lightweight check) | Settings health check button |
| `/api/upstox/health-summary` | Full system status (token, WS, cache, instruments count) | Header status badge |
| `POST /api/upstox/ws/subscribe` | Tell WS server which symbols to stream | On tab switch |
| `POST /api/upstox/ws/unsubscribe` | Tell WS server to stop streaming old symbols | On tab switch |

---

## 🚨 The 3 Real Problems in These Logs

### Problem 1: GSPL Not in Database
```
[UPSTOX KEY] Instrument key not found for GSPL → 404
/api/upstox/instruments/resolve?symbol=GSPL    → 500
```
**GSPL is hardcoded in the Energy sector list but doesn't exist in Upstox's instrument database.** Every time the energy sector loads, it fires 3–4 failed requests for GSPL and triggers background instrument syncs.

### Problem 2: Sector Load is Still Firing N Individual Requests
Even though `resolve-bulk` was added, the logs show **individual `/instruments/key` and `/instruments/resolve` calls per stock** still firing (lines 109–160, 212–299). This means some component is still using the OLD individual request pattern instead of the new bulk endpoint.

### Problem 3: Option Chains Being Fetched For ALL Sector Stocks
Lines 409–509 show option chains being fetched for **every cement, energy, IT, auto, banking stock** in the screener:
```
/api/upstox/option-chain?symbol=ULTRACEMCO → 429
/api/upstox/option-chain?symbol=GRASIM     → 429
/api/upstox/option-chain?symbol=ACC        → 429
```
**30 option chain calls for individual stocks from the screener is extremely heavy.** Most of these stocks are small/midcap and don't even have active F&O contracts. This is what causes the flood.

---

## ✅ Recommended Fixes

| Fix | What To Do | Impact |
|---|---|---|
| **Remove GSPL** | Delete `GSPL` from the Energy sector constituent list in the screener config | Stops 3–4 failed requests + background sync triggers per page load |
| **Migrate remaining individual resolves to bulk** | Find which component still calls `/instruments/key` and `/instruments/resolve` individually and switch to `resolve-bulk` | Cuts 30 requests down to 1 |
| **Stop fetching option chains in the screener** | The sector screener should NOT fetch option chains per stock. Option chain data should only load in the Options Flow tab | Cuts 30+ requests per sector load |
| **Add frontend debounce on tab switch** | Add a 300ms debounce before firing API calls on tab/sector change | Prevents multi-sector loads firing simultaneously |
| **Fix Order Flow expiry logic** | On expiry day, look for next weekly expiry instead of today | Stops `No contracts found` spam on Thursdays |
| **Update WebSocket to v3** | Change WS auth URL from `/v2/feed/market-data-feed/authorize` to the v3 endpoint | Enables true real-time streaming instead of HTTP polling fallback |

---

## 🔍 PHASE 12 — The `resolve-bulk` Success + Individual Calls Still Firing (Lines 727–772)

After the 429 flood clears, the next server boot shows:

```
Line 727: GET /api/upstox/instruments/resolve-bulk?symbols=ULTRACEMCO,GRASIM,...  → 200 OK ✅
Line 729: GET /api/upstox/instruments/resolve-bulk?symbols=GRASIM,AMBUJACEM,...    → 200 OK ✅
Line 733: GET /api/upstox/instruments/resolve-bulk?symbols=LT,NTPC,COALINDIA,...   → 200 OK ✅
```

This is **the bulk endpoint working correctly** — 44 stocks resolved in one call. 

But then immediately after on lines 734–772:
```
Line 734: GET /api/upstox/instruments/resolve?symbol=HDFCBANK   → 200 OK ❌ Duplicate
Line 735: GET /api/upstox/instruments/resolve?symbol=ICICIBANK  → 200 OK ❌ Duplicate
Line 736: GET /api/upstox/instruments/resolve?symbol=SBIN       → 200 OK ❌ Duplicate
...  (30+ individual calls)
```

**Root Cause:** Two different React components are loading the same data:
1. `UpstoxInstrumentService.ts` → Uses `/resolve-bulk` ✅ (migrated)
2. Another component (probably the live quote panel or sector heatmap) → Still calls individual `/resolve?symbol=X` per stock ❌

This double-calls ALL 30+ sector stocks = 31 extra redundant requests every single load.

> **Fix:** Grep the frontend for all `.fetch('/api/upstox/instruments/resolve?symbol=')` calls and replace with a single `resolve-bulk` call.

---

## 🔴 PHASE 13 — PCR 400 Error for NIFTY (Line 987–988)

```
[UPSTOX CLIENT ERROR] Request to:
  https://api.upstox.com/v2/market/pcr?instrument_key=NSE_INDEX%7CNifty%2050
failed: 400 Client Error: Bad Request

GET /api/upstox/pcr?symbol=NIFTY → 500 Internal Server Error
```

### What is PCR?
**Put-Call Ratio** = Total Put OI ÷ Total Call OI. 

- PCR > 1.2 = More puts being bought = bearish sentiment (big money hedging)
- PCR < 0.8 = More calls being bought = bullish sentiment
- PCR ≈ 1.0 = Neutral

It's shown on the Options Flow tab and used by the Alpha Engine signal system.

### Why the 400 Error?

The instrument key for NIFTY 50 is `NSE_INDEX|Nifty 50`. After encoding:
- **Wrong** (what you're sending): `NSE_INDEX%7CNifty%2050` → Upstox decodes this as `NSE_INDEX|Nifty 50` ✅ but the **space** `%20` is causing the 400

The Upstox v2 PCR API requires the **pipe `|` AND space** to be encoded in a specific way:
```
Correct: instrument_key=NSE_INDEX%7CNifty+50   (space as + sign)
Wrong:   instrument_key=NSE_INDEX%7CNifty%2050  (space as %20)
```

> **Fix in `upstox.py`**: In the PCR request, replace `urllib.parse.quote` with `urllib.parse.quote_plus` for the instrument key parameter, OR manually replace `%20` with `+` after encoding.

---

## 🔴 PHASE 14 — Order Flow Running 6× Per Symbol (Lines 2307–2483)

This is the **most important finding** in the entire log. At the very end:

```
[ORDERFLOW] No contracts found for expiry 26-May-2026 in ZYDUSLIFE   (×6)
[ORDERFLOW] No contracts found for expiry 26-May-2026 in LAURUSLABS  (×6)
[ORDERFLOW] No contracts found for expiry 26-May-2026 in GLENMARK    (×6)
[ORDERFLOW] No contracts found for expiry 26-May-2026 in BIOCON      (×6)
[ORDERFLOW] No expiry dates found for SYNGENE                         (×6)
[ORDERFLOW] No expiry dates found for GRANULES                        (×6)
[ORDERFLOW] No contracts found for expiry 26-May-2026 in TCS         (×6)
[ORDERFLOW] No contracts found for expiry 26-May-2026 in COFORGE     (×6)
...
```

**Each symbol appears exactly 6 times.** Here's why:

### Root Cause: Dual Invocation Pattern

Looking at the source code in [app.py](file:///c:/Users/gadda/Desktop/Projects/1.%20Wealth%20Dashboard%20v2/python-bridge/app.py#L1065-L1089):

**Path 1 — Background polling loop** ([line 802–815](file:///c:/Users/gadda/Desktop/Projects/1.%20Wealth%20Dashboard%20v2/python-bridge/app.py#L802-L815)):
```python
def orderflow_polling_loop():
    while True:
        symbols = ["NIFTY", "BANKNIFTY", "FINNIFTY"] + list(orderflow_watchlist)
        for symbol in symbols:
            compute_orderflow_metrics_for_symbol(symbol)  # ← Called here
        time.sleep(300)  # Wait 5 minutes
```

**Path 2 — On-demand HTTP endpoint** ([line 1088–1089](file:///c:/Users/gadda/Desktop/Projects/1.%20Wealth%20Dashboard%20v2/python-bridge/app.py#L1088-L1089)):
```python
@app.get("/api/nse/orderflow/live")
def get_live_orderflow(symbol):
    # If no fresh tick in DB:
    compute_orderflow_metrics_for_symbol(symbol)  # ← Also called here
```

When the Sector Screener or Intraday Booster widget loads a sector (e.g., Healthcare) with 20 stocks and calls `/api/nse/orderflow/live?symbol=X` for EACH stock simultaneously, and none of those stocks have a cached tick in the DB (because they're not in the `orderflow_watchlist`), this causes:

```
20 stocks × 1 HTTP call each → 20 on-demand computations run SIMULTANEOUSLY
Each computation: 1 NSE expiry call + 1 option chain call + 1 Yahoo Finance call = 3 external requests
20 × 3 = 60 external requests fired at once
```

AND because `orderflow_watchlist` is only `{"RELIANCE", "SBIN", "HDFCBANK", "ICICIBANK", "INFY"}` but the screener is requesting **Healthcare sector stocks** (ZYDUSLIFE, LAURUSLABS, GLENMARK, BIOCON, SYNGENE, etc.) which are NOT in the watchlist, every single one triggers the on-demand path.

**Why 6× specifically?** The frontend is probably **polling** the `/orderflow/live` endpoint every N seconds per stock, and there are 6 refresh cycles happening before the log was saved.

> **Fix:** The `/api/nse/orderflow/live` endpoint should NOT call `compute_orderflow_metrics_for_symbol()` on-demand for arbitrary symbols. Instead, return an empty/neutral response if the symbol isn't in the watchlist. The background loop already handles the tracked symbols.

---

## 🟡 PHASE 15 — Symbol `M` in Order Flow (Line 2476–2482)

```
[ORDERFLOW] No expiry dates found for M
[ORDERFLOW] No expiry dates found for M
[ORDERFLOW] No expiry dates found for M    (×6)
```

**Root Cause:** `M&M` (Mahindra & Mahindra) is being passed as a URL query parameter:

```
/api/nse/orderflow/live?symbol=M&M
```

The browser sees `&M` as a **second URL parameter** (empty key named `M`), so only `M` arrives at the server. The `&` character in `M&M` is breaking the URL parsing. 

The symbol should be encoded as `M%26M` in the URL:
```
/api/nse/orderflow/live?symbol=M%26M  ✅ Correct
/api/nse/orderflow/live?symbol=M&M    ❌ Wrong — sends symbol=M and a blank param &M
```

> **Fix in frontend:** Wherever the Sector Screener builds the API URL for `M&M`, use `encodeURIComponent('M&M')` → `M%26M`.

---

## 🟢 PHASE 16 — News API 400 Fallback (Lines 2300–2305)

```
[UPSTOX CLIENT ERROR] Request to https://api.upstox.com/v2/news?symbol=WELCORP
  failed: 400 Client Error: Bad Request
[API WARNING] Upstox news fetch failed. Serving mock news.
GET /api/upstox/news?symbol=WELCORP → 200 OK  (mock data served)
```

### What is happening?

The Upstox `/v2/news` API does **not accept a `symbol` query parameter**. The correct endpoint requires either:
- An instrument key: `/v2/news?instrument_key=NSE_EQ|ISIN`  
- Or fetching market-level news without a symbol filter

The backend gets a 400 from Upstox, catches it, and **automatically serves mock news data** — so the UI shows something instead of breaking. This is working correctly as a graceful fallback.

**Impact:** News feeds show placeholder/mock articles instead of real news. Not critical.

> **Fix:** Update the news endpoint to send `instrument_key=NSE_EQ|{isin}` instead of `symbol={symbol}`.

---

## 🟢 PHASE 17 — SSE (Server-Sent Events) Stream (Lines 904–905)

```
[SSE] Client connected. Total listeners: 1
GET /api/upstox/ws/stream → 200 OK
```

**What is this?** This is the **Server-Sent Events (SSE) stream** — your frontend's mechanism for receiving real-time price ticks pushed from the backend without needing a full WebSocket from the browser.

How it works:
1. Frontend opens a persistent HTTP connection to `/api/upstox/ws/stream`
2. Backend holds the connection open and pushes JSON messages whenever price updates arrive
3. Frontend receives updates in real-time (simulating WebSocket behavior)

This is working correctly and is the right fallback when the Upstox WebSocket (v2 disabled, v3 not yet implemented) is unavailable.

---

## 🎯 FINAL PRIORITIZED FIX LIST

| Priority | Fix | File | Effort |
|---|---|---|---|
| 🔴 P0 | **Stop on-demand `compute_orderflow_metrics` for non-watchlist symbols** | `app.py` line 1088 | 2 min |
| 🔴 P0 | **Fix `M&M` URL encoding in frontend** | Sector screener component | 2 min |
| 🔴 P0 | **Fix PCR instrument key encoding** (`%20` → `+`) | `upstox.py` PCR method | 5 min |
| 🔴 P0 | **Remove GSPL from Energy sector list** | Frontend sector config | 2 min |
| 🟡 P1 | **Migrate remaining individual `/resolve` calls to `/resolve-bulk`** | Frontend component calling resolve per-stock | 15 min |
| 🟡 P1 | **Stop fetching option chains per sector stock** | Sector screener widget | 10 min |
| 🟡 P1 | **Fix Order Flow expiry: use NEXT expiry on expiry day** | `app.py` compute function line 586 | 5 min |
| 🟢 P2 | **Fix News API to use instrument_key instead of symbol** | `upstox.py` news method | 5 min |
| 🟢 P2 | **Update WebSocket client to v3 endpoint** | `upstox_ws.py` | 10 min |
