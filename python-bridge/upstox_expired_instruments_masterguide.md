# Upstox Expired Instruments — Master Guide
### The Complete Reference: What It Is, Why It Exists, and How to Use It

---

## 🔑 Why This Is Exclusive (Upstox Plus Only)

The **Expired Instruments API** is paywalled because the data it serves is *not publicly available* anywhere for free. Here is why it is valuable:

- NSE and BSE officially archive expired F&O contracts. Fetching that archive, cleaning it, and serving it as a structured API costs Upstox money to maintain.
- Commercial data vendors (TrueData, Global DataFeeds, Bloomberg) charge ₹2,000–₹15,000/month for the same data.
- **You get it for free** as part of your Upstox Plus subscription.

Without this API, any backtesting you do on options/futures would either require buying expensive third-party data or would be impossible altogether.

---

## 📦 The Four API Endpoints — What Each One Actually Gives You

Think of these four endpoints as a *pipeline*. Each step feeds data into the next.

```
Step 1: Get Expiries  →  Step 2: Get Contracts  →  Step 3: Get Candles  →  Step 4: Backtest
```

---

### Step 1 — `/api/upstox/expired/expiries`

**What it gives you:** A list of all past expiry dates for a symbol.

```json
// Example: NIFTY options expiry list
["2025-01-30", "2025-02-27", "2025-03-27", "2024-12-26", "2024-11-28", ...]
```

**Why you need it:** Before you can ask "what were NIFTY's call option prices on January 30th 2025?", you first need to *know* that January 30th was a valid expiry date. This list tells you that.

- Covers up to **6 months of historical expiries** (monthly + weekly).
- Works for both `options` and `futures` segments.
- Does NOT work for MCX (commodity exchange).

---

### Step 2a — `/api/upstox/expired/option-contracts`

**What it gives you:** All option strikes that existed for a specific expiry date.

```json
// Example: All NIFTY strikes on Jan 30, 2025
[
  { "instrument_key": "NSE_FO|12345", "trading_symbol": "NIFTY25JAN24000CE", "strike_price": 24000, "option_type": "CE" },
  { "instrument_key": "NSE_FO|12346", "trading_symbol": "NIFTY25JAN24000PE", "strike_price": 24000, "option_type": "PE" },
  { "instrument_key": "NSE_FO|12347", "trading_symbol": "NIFTY25JAN24100CE", "strike_price": 24100, "option_type": "CE" },
  ...
]
```

**Why you need it:** Each contract (e.g. `NIFTY25JAN24000CE`) is a completely different instrument. It has its own price, its own OI, its own candles. You need the list of all contracts before you can ask for their price history.

> A typical NIFTY monthly expiry can have 100+ strikes (CE + PE). Our current code filters to ATM ± 5 strikes (11 contracts) to avoid downloading 100s of unnecessary deep OTM contracts.

---

### Step 2b — `/api/upstox/expired/future-contracts`

**What it gives you:** The futures contract for a specific expiry date.

```json
// Example: NIFTY Jan 2025 Futures
[
  { "instrument_key": "NSE_FO|56789", "trading_symbol": "NIFTYFUT25JAN", "expiry": "2025-01-30" }
]
```

**Why you need it:** Futures have only 1 contract per expiry (unlike options which have dozens of strikes). This gives you the exact instrument key to then fetch that future's historical candle data.

---

### Step 3 — `/api/upstox/expired/historical-candles`

**What it gives you:** The actual OHLCV price data for any expired contract, candle by candle.

```json
// Example: 1-day candles for NIFTY25JAN24000CE
{
  "candles": [
    ["2025-01-02T00:00:00Z", 180.5, 215.0, 170.0, 198.5, 1250000, 45000],
    ["2025-01-03T00:00:00Z", 200.0, 230.0, 195.0, 210.0, 980000,  47500],
    ...
  ]
}
```

**Candle format: `[timestamp, open, high, low, close, volume, open_interest]`**

This is the *actual historical option price data* that lets you replay what happened to an option on any given day.

---

## 🎯 What Is This Data Used For? (Beyond Backtesting)

### Primary Use: Strategy Backtesting ✅
The most obvious use. Replay past trades on historical data to see if your strategy would have made money.

**Example:** *"If I had sold NIFTY 24000 CE every week on Monday morning and bought it back on Thursday evening for the last 2 years, what would my P&L be?"*

---

### Use 2: Options Greeks Analysis 📊
Option pricing models (Black-Scholes) require historical price data to calculate:
- **IV (Implied Volatility)** at different points in time
- **Delta, Gamma, Theta, Vega** trajectories as expiry approached
- **IV Crush patterns** before and after earnings/budget events

---

### Use 3: Strategy Discovery (Screener Mode) 🔍
Run your strategy logic across ALL symbols simultaneously. Instead of you choosing which stocks to watch, the system *automatically* filters:

**Example logic:**
```
For every F&O stock on every Monday for the last 2 years:
  IF stock price is above 20-EMA AND volume is 1.5x average AND ATM IV < 20%:
    → Simulate a Bull Call Spread
    → Record outcome
```
The engine automatically finds which stocks triggered the condition and tests the trade.

---

### Use 4: Max Pain and OI Concentration Analysis 🧲
Historical OI data from expired contracts lets you analyse:
- Where OI was concentrated (Max Pain levels) on each expiry
- Whether stock price consistently gravitated toward Max Pain by expiry
- Historical OI buildup patterns across weekly vs monthly expiries

---

### Use 5: Calendar Spread Analysis 📅
Compare near-month vs far-month contracts that have both already expired. Useful for:
- Understanding seasonality effects
- Calendar spread P&L across different market conditions

---

### Use 6: Volatility Event Studies 🌊
Map option premiums before and after major events:
- Budget day IV spikes
- RBI policy announcement premium behavior
- Earnings IV crush patterns per stock

---

## 🏗️ Architecture: How Data Flows in Our System

```
Upstox API (Expired Instruments Plus)
         │
         │  REST calls via python-bridge/upstox.py
         ▼
python-bridge/app.py (FastAPI Routes)
  /api/upstox/expired/expiries
  /api/upstox/expired/option-contracts
  /api/upstox/expired/future-contracts
  /api/upstox/expired/historical-candles
         │
         │  SQLite Cache (86400s TTL = 24 hours)
         ▼
cache.db → upstox_cache table
         │
         │  Browser fetch via UpstoxMarketDataService.ts
         ▼
UpstoxBacktestDataService.ts (4-Step Pipeline)
  Step 1: getExpiries()
  Step 2: getExpiredOptionContracts() / getExpiredFutureContracts()
  Step 3: getExpiredHistoricalCandles()
  Step 4: importToVault()
         │
         ▼
IndexedDB (Dexie) → historical_data table
         │
         ▼
HistoricalDataAdapter.ts → Apex Strategy Engine
```

---

## 💾 Storage Reality Check

### Why 30GB is an Overestimate

The 30GB figure assumes storing raw JSON (which is terribly inefficient). With proper compression:

| Data Type | Raw JSON Size | Compressed (Parquet) | Improvement |
|---|---|---|---|
| Daily candles (all stocks, 10yr) | ~500 MB | ~46 MB | 90% smaller |
| 5-min candles (all stocks, 180d) | ~4 GB | ~400 MB | 90% smaller |
| 1-min candles (all stocks, 90d) | ~10 GB | ~950 MB | 90% smaller |
| Options (Indices, ATM±5, 3yr) | ~15 GB | ~1.5 GB | 90% smaller |
| Futures (all stocks, 3yr) | ~6 GB | ~600 MB | 90% smaller |
| **TOTAL** | **~35 GB** | **~3.5 GB** | **90% smaller** |

> **The entire market's history fits in 3.5 GB** when stored as Parquet (columnar compressed format). That is less than a single Netflix episode download.

---

## 🌐 Options Evaluated: The Verdict

### Option A: Local Storage (Parquet + DuckDB) — ✅ RECOMMENDED
**How it works:** Download once on a weekend. Store as compressed Parquet files locally. Query with DuckDB in milliseconds.

| | Detail |
|---|---|
| **Cost** | ₹0/month |
| **Storage** | ~3.5 GB on SSD |
| **Speed** | Sub-second query |
| **Flexibility** | Unlimited custom logic |
| **Setup** | One-time 50-60 min download |

---

### Option B: Cloud Storage (GCP / AWS S3)
**How it works:** Download and upload to a GCP bucket. Query remotely from your Python bridge.

| | Detail |
|---|---|
| **Cost** | ~₹50/month (30GB × $0.02) |
| **Storage** | 0 GB locally, 30GB on cloud |
| **Speed** | Slightly slower (network reads) |
| **Flexibility** | Unlimited custom logic |
| **Setup** | Requires GCP account setup |

**Best for:** If your machine has less than 10 GB free disk space.

---

### Option C: Indian Online Platforms (StockMock, AlgoTest, Tradetron)
**How they work:** They store the data on their servers. You use their UI.

| | Detail |
|---|---|
| **Cost** | ₹1,000 – ₹3,000/month |
| **Storage** | 0 GB locally |
| **Speed** | Fast (pre-computed) |
| **Flexibility** | ❌ SEVERELY LIMITED — no custom code |
| **Setup** | Immediate (just sign up) |

**Best for:** Testing a simple 2-3 condition strategy to quickly validate the *idea*, not the complete rules.

**Why this won't work for you:** Your strategies involve complex multi-signal logic (OI buildup + volume confirmation + price action + sector confluence). None of these platforms can encode that complexity.

---

## 🗺️ What We Have Already Built

### Backend (Python Bridge)
- ✅ `upstox.py` — `get_expiries()`, `get_expired_option_contracts()`, `get_expired_future_contracts()`, `get_expired_historical_candles()`
- ✅ `app.py` — All 4 expired instrument FastAPI routes working
- ✅ `db.py` — SQLite cache with 24-hour TTL for all expired data

### Frontend (TypeScript)
- ✅ `UpstoxMarketDataService.ts` — `getExpiries()`, `getExpiredOptionContracts()`, `getExpiredFutureContracts()`, `getExpiredHistoricalCandles()`
- ✅ `UpstoxBacktestDataService.ts` — Full 4-step pipeline (expiries → contracts → candles → vault import)
- ✅ `DataVaultTab.tsx` — UI to trigger fetch, show progress, clear vault
- ✅ `HistoricalDataAdapter.ts` — Connects vault data to the Apex strategy engine

### Data Intelligence
- ✅ `fno_stocks_generated.json` — 180+ F&O stocks with sector classification
- ✅ ATM ± 5 strike filtering (prevents downloading 100s of useless deep OTM contracts)
- ✅ Rate limiter (450 req/min max, safe at 250 req/min)

---

## 🚀 What We Still Need to Build

### Phase 1: Parquet-Based Local Archive Script
Create `python-bridge/sync_parquet.py` which:
1. Loads all F&O symbols from `fno_stocks_generated.json`
2. Fetches daily + intraday candles for each symbol
3. Fetches expired options/futures for indices (NIFTY, BANKNIFTY, FINNIFTY)
4. Saves everything as compressed Parquet files in `python-bridge/data/`
5. Uses DuckDB to expose a fast query endpoint

**Estimated download time:** 50-60 minutes on a weekend  
**Estimated storage:** 3.5 GB total

### Phase 2: Multi-Symbol Screener Mode
Create a backtesting mode where:
1. You define strategy rules (entry conditions, exit conditions)
2. The engine scans ALL F&O stocks across the selected date range
3. It automatically identifies which stocks/expiries triggered your conditions
4. Reports aggregate P&L, win rate, and best/worst performing symbols

**Example flow:**
```
Strategy: "ORB Breakout + High Volume + Strong Sector"
→ Engine scans 180 stocks × 500 trading days
→ Finds 347 trades that matched conditions
→ Shows aggregate: Win Rate 62%, Avg R = 1.8, Max DD = 8%
→ Top 5 performing symbols: SBIN, HDFCBANK, RELIANCE, INFY, TCS
```

### Phase 3: Options-Specific Analytics
- IV surface reconstruction from historical option prices
- Theta decay analysis (how much premium decays per day in different market conditions)
- Max Pain historical analysis (does price gravitate to max pain at expiry?)
- Straddle/Iron Condor P&L replay across all weekly expiries

---

## ❓ FAQ — Common Questions Answered

**Q: Can I backtest option buying strategies?**
A: Yes. The candle data includes both the underlying and the specific option contract prices. You can simulate entering a CE/PE buy at any specific time and track its P&L until exit.

**Q: Can I backtest across multiple symbols at once?**
A: Currently the system does one symbol at a time. Phase 2 (Multi-Symbol Screener Mode) will enable this.

**Q: How far back can I go?**
A: Upstox's expired instruments API covers approximately the last **6 months of expiry dates**. For daily candle data of equities (not options), you can go back 10+ years. For intraday candles, up to 2 years.

**Q: What happens when the API returns no data for a contract?**
A: The system skips that contract silently and logs a warning. It does not crash. This is common for very deep ITM/OTM contracts with no trading volume.

**Q: Is this data real or simulated?**
A: 100% real market data from NSE F&O historical records, served through Upstox's licensed data access.

**Q: Can I use this for live trading signals, not just backtesting?**
A: Yes! The same data pipeline can be repurposed to:
- Calculate IV percentile (is current IV high or low vs history?)
- Build statistical support/resistance from historical OI concentration
- Generate pre-market bias from previous expiry's options behavior

---

## 📌 Summary — One Sentence

> **Upstox's Expired Instruments API gives you the complete historical price, volume, and open interest data for every expired options and futures contract in NSE history — exclusively available because you have a Plus subscription — and it is the core data engine that powers your Apex backtesting system, enabling you to replay any F&O strategy across any symbol, time period, and market condition with real institutional-grade data.**

