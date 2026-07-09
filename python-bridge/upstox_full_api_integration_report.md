# 📊 Upstox API — Full Integration Report
> Wealth Dashboard v2 | Generated: 30 May 2026

This report covers **every single feature** listed in the Upstox documentation sidebar, explains what it does in plain English, tells you its **current implementation status** in your app, and outlines **exactly how to implement the missing pieces**.

---

## 🔑 Token Legend

| Token Type | What it is | Expires | Permissions |
|---|---|---|---|
| **Analytics Token** | Long-lived read-only key from Upstox Analytics | ~May 2027 | Read market data, fundamentals, option chain only. **No WebSocket stream, no orders.** |
| **Daily OAuth Token** | Full access token obtained via browser login | Every night 3:30 AM IST | Everything — WebSocket, orders, portfolio, payments |

> **Your current token = Analytics Token.** All ✅ features below work with it. Features marked 🔐 require the OAuth daily token.

---

## ⚡ Status Legend

| Icon | Meaning |
|---|---|
| ✅ **DONE** | Fully implemented and working in your app |
| 🔶 **PARTIAL** | Backend method exists, but no frontend UI built |
| ❌ **NOT BUILT** | Not implemented anywhere yet |
| 🔐 **OAuth Only** | Requires daily OAuth token — does not work with Analytics Token |

---

## 1. 🏗️ Developer API — Foundation

### Sandbox
**What it is:** A fake testing environment where you can make API calls that don't touch real money or real market data. It's like a practice mode.

| Item | Status | Notes |
|---|---|---|
| Sandbox Environment | ❌ **NOT BUILT** | Upstox provides a sandbox base URL. Useful to test order placement logic without real risk. |

**How to implement:** Add a toggle in Settings (`isSandbox: boolean`). When true, point all requests to `https://api-sandbox.upstox.com` instead of `https://api.upstox.com`. Your `upstox.py` `BASE_URL` just needs to switch.

---

### Authentication

**What it is:** How you log into Upstox and get your access token. There are two paths — the normal daily OAuth login, and the special long-lived Analytics Token.

| Item | Status | Notes |
|---|---|---|
| Authorize (OAuth Browser Login) | ✅ **DONE** | `get_authorization_url()` generates the OAuth dialog URL. App.tsx has the Authorize button. |
| Analytics Token (Long-lived) | ✅ **DONE** | User pastes token in Settings → synced to `upstox_token.txt` via `/api/upstox/token` |
| Get Token (OAuth Code Exchange) | ✅ **DONE** | `token_exchange()` in `upstox.py` handles the code → access_token exchange |
| Access Token Request | ✅ **DONE** | POST to `login/authorization/token` implemented in `token_exchange()` |
| Logout | 🔶 **PARTIAL** | Backend can clear the token. No frontend Logout button in Settings UI yet. |

**How to implement logout:** Add a "Disconnect Upstox" button in Settings that calls `DELETE /api/upstox/token` and clears localStorage + the Zustand store.

---

### API Structure

**What it is:** The standard format Upstox uses for all requests and responses — like how you send data and what format you get back.

| Item | Status | Notes |
|---|---|---|
| Request Structure | ✅ **DONE** | All requests go through `UpstoxClient.request()` with proper headers, versioned URLs, and encoding. |
| Response Structure | ✅ **DONE** | All responses follow `{ status, data }` pattern. `_cache_meta` field added by our layer. |
| Error Codes | ✅ **DONE** | 401, 429, 5xx handling with retry + stale cache fallback implemented in `request()`. |

---

### Rate Limits

**What it is:** Upstox allows 500 requests per minute. If you go over, they block you temporarily.

| Item | Status | Notes |
|---|---|---|
| Rate Limiting | ✅ **DONE** | `RateLimiter` class (sliding window, 450 req/min for safety margin) implemented in `upstox.py` |
| Rate Limit Status Endpoint | ✅ **DONE** | `/api/upstox/rate-limit/status` shows live usage |

---

### SDK

**What it is:** Upstox has an official Python library you can install (`pip install upstox-python-sdk`). It wraps all the API calls for you.

| Item | Status | Notes |
|---|---|---|
| SDK Usage | ❌ **NOT BUILT** | We built our own `UpstoxClient` from scratch (which is actually better — more control, custom caching, retry logic). |

**Recommendation:** Keep our custom client. The official SDK doesn't support our caching, rate-limiting, or SSE streaming architecture.

---

### MCP Integration

**What it is:** Upstox has an official "MCP Server" that lets AI agents (like Claude, Gemini) directly query your Upstox account via natural language.

| Item | Status | Notes |
|---|---|---|
| MCP Integration | ❌ **NOT BUILT** | This is a separate server you'd run alongside the app. Not needed for the dashboard, but interesting for AI-assisted trading. |

**How to implement:** Run the official Upstox MCP server as a sidecar. Not relevant for dashboard — skip unless you want AI to analyze your portfolio.

---

## 2. 📋 Instruments

**What it is:** The complete master list of every stock, index, futures contract, and options contract on NSE/BSE. Each has a unique `instrument_key` (e.g., `NSE_EQ|RELIANCE`).

| Item | Status | Notes |
|---|---|---|
| Instrument Files (GZ download) | ✅ **DONE** | `download_and_sync_instruments()` downloads NSE master GZ and saves to SQLite |
| Instrument Search | ✅ **DONE** | `db.get_upstox_instrument_key(symbol)` resolves symbol → instrument key |
| Auto-sync on startup | ✅ **DONE** | Background scheduler triggers the sync on server start |

---

## 3. 🕰️ Expired Instruments

**What it is:** Expired options and futures contracts that no longer trade — useful for historical backtesting of old strikes.

| Item | Status | Notes |
|---|---|---|
| Get Expiries | ❌ **NOT BUILT** | `GET /v2/instruments/expiry` — lists all past expiry dates |
| Get Expired Option Contracts | ❌ **NOT BUILT** | `GET /v2/instruments/options/contract` with past date |
| Get Expired Future Contracts | ❌ **NOT BUILT** | `GET /v2/instruments/future/contract` with past date |
| Get Expired Historical Candle Data | ❌ **NOT BUILT** | Historical candles for delisted/expired instruments |

**How to implement:** Add 4 methods to `upstox.py`:
```python
def get_expired_contracts(instrument_key, expiry, type="options"):
    return self.request("GET", f"instruments/{type}/contract", params={"instrument_key": instrument_key, "expiry_date": expiry})
```
**Use case:** Backtesting — "what was the option chain for Nifty on the Jan 2024 expiry?"

---

## 4. 🔐 Login (Full OAuth Flow)

| Item | Status | Notes |
|---|---|---|
| Authorize (Dialog URL) | ✅ **DONE** | Full OAuth URL generated with client_id + redirect_uri |
| Analytics Token (Paste) | ✅ **DONE** | Settings UI → synced to bridge |
| Get Token (Code Exchange) | ✅ **DONE** | POST to `login/authorization/token` |
| Access Token Request | ✅ **DONE** | Response saves `access_token` to `upstox_token.txt` |
| Logout | 🔶 **PARTIAL** | Backend ready, no frontend button |
| TOTP Headless Login | ❌ **NOT BUILT** 🔐 | Automated daily login without browser — requires PIN + TOTP secret |

**TOTP Headless Login** — How it works:
1. Send your mobile PIN + TOTP code (generated from a secret via `pyotp`) to `POST /v2/login/authorization/token`  
2. Upstox returns a new access token without a browser popup  
3. Can be scheduled at 3:31 AM IST daily to auto-renew

```python
import pyotp
totp = pyotp.TOTP("YOUR_TOTP_SECRET").now()
# POST to Upstox with phone, pin, totp fields
```

---

## 5. 👤 User

**What it is:** Your account information — name, email, which exchanges you have access to, and your funds (how much money is available to trade).

| Item | Status | Notes |
|---|---|---|
| Get Profile | ❌ **NOT BUILT** | `GET /v2/user/profile` — name, email, exchange access list |
| Get Fund And Margin (V2) | ❌ **NOT BUILT** | Available cash + margin used |
| Get Fund And Margin V3 | ❌ **NOT BUILT** | Same but with richer breakdown (pledge, collateral, etc.) |
| Kill Switch | ❌ **NOT BUILT** 🔐 | Emergency button to close ALL open positions instantly |
| Kill Switch Status | ❌ **NOT BUILT** 🔐 | Check if kill switch is armed/active |
| Get Static IPs | ❌ **NOT BUILT** | Whitelisted IPs for algo trading |
| Update Static IPs | ❌ **NOT BUILT** | Add/remove algo trading whitelisted IPs |

**How to implement (Profile + Funds):**
```python
def get_profile(self):
    return self.request("GET", "v2/user/profile")

def get_fund_margin(self):
    return self.request("GET", "v3/user/get-funds-and-margin")
```
**Use case:** Show available margin on the dashboard. Show profile in Settings header ("Welcome back, [Name]").

---

## 6. 💰 Payments

**What it is:** Your payment history with Upstox — money you deposited (Payins) and money you withdrew (Payouts).

| Item | Status | Notes |
|---|---|---|
| Get Payins | ❌ **NOT BUILT** 🔐 | List of deposits made to your trading account |
| Get Payouts | ❌ **NOT BUILT** 🔐 | List of withdrawals from your trading account |

**How to implement:** Add to `upstox.py`:
```python
def get_payins(self):
    return self.request("GET", "v2/payments/payins")
def get_payouts(self):
    return self.request("GET", "v2/payments/payouts")
```
**Use case:** Cashflow tracker — "How much money did I put in vs take out this year?"

---

## 7. 🧾 Charges

**What it is:** Before placing a trade, you can ask Upstox: "If I buy/sell this many shares at this price, what will my brokerage and taxes be?" — The charges breakdown.

| Item | Status | Notes |
|---|---|---|
| Brokerage Details | ❌ **NOT BUILT** 🔐 | Calculate exact brokerage + STT + GST before a trade |

**How to implement:**
```python
def get_brokerage(self, instrument_key, qty, price, transaction_type, product):
    return self.request("GET", "v2/charges/brokerage", params={...})
```
**Use case:** Show "Estimated charges: ₹42.30" in the PnL calculator before you confirm a trade.

---

## 8. 📊 Margins

**What it is:** Upstox can tell you exactly how much margin (collateral money) you need to place a specific trade before you place it.

| Item | Status | Notes |
|---|---|---|
| Margin Details | ❌ **NOT BUILT** 🔐 | `POST /v2/margins` — calculates margin required for a basket of orders |

**Use case:** "I want to sell 1 lot of NIFTY options — how much margin do I need?" Show this in the Order Desk before placing.

---

## 9. 📋 Orders

**What it is:** Everything related to placing, modifying, and cancelling trades. This is the core "trading" functionality — and requires the daily OAuth token.

| Item | Status | Notes |
|---|---|---|
| Place Order V3 | ❌ **NOT BUILT** 🔐 | Place a new buy/sell order (V3 = newer, more fields) |
| Place Multi Order | ❌ **NOT BUILT** 🔐 | Place multiple orders in one API call (basket trading) |
| Modify Order V3 | ❌ **NOT BUILT** 🔐 | Change price/qty of an existing open order |
| Cancel Order V3 | ❌ **NOT BUILT** 🔐 | Cancel a specific open order |
| Cancel Multi Order | ❌ **NOT BUILT** 🔐 | Cancel multiple orders at once |
| Exit All Positions | ❌ **NOT BUILT** 🔐 | One-click close all open positions |
| Get Order Details | ❌ **NOT BUILT** 🔐 | Status of a specific order by order_id |
| Get Order History | ❌ **NOT BUILT** 🔐 | Full audit trail of a specific order (all status changes) |
| Get Order Book | ❌ **NOT BUILT** 🔐 | All today's orders (pending, executed, cancelled) |
| Get Trades | ❌ **NOT BUILT** 🔐 | All filled trades today |
| Get Order Trades | ❌ **NOT BUILT** 🔐 | All fills for a specific order |
| Get Trade History | ❌ **NOT BUILT** 🔐 | Historical trades (past days) |
| Place Order (V2 legacy) | ❌ **NOT BUILT** 🔐 | Older order placement API |
| Modify Order (V2 legacy) | ❌ **NOT BUILT** 🔐 | Older modify API |
| Cancel Order (V2 legacy) | ❌ **NOT BUILT** 🔐 | Older cancel API |

> ⚠️ **You told us you use Dhan for trading.** So orders via Upstox are out of scope. But the Order Book + Trade History can still be useful to pull executed trades into your journal automatically.

**Key endpoints for read-only use:**
```python
def get_order_book(self):
    return self.request("GET", "v2/order/retrieve-all")

def get_trades(self):
    return self.request("GET", "v2/order/trades/get-trades-for-day")
```

---

## 10. ⏰ GTT Orders (Good Till Triggered)

**What it is:** GTT = "Good Till Triggered". You set a target price, and Upstox automatically places the order when the price hits that level — even when your app is closed.

| Item | Status | Notes |
|---|---|---|
| Place GTT Order | ❌ **NOT BUILT** 🔐 | Set a conditional order with a trigger price |
| Modify GTT Order | ❌ **NOT BUILT** 🔐 | Change the trigger price of an existing GTT |
| Cancel GTT Order | ❌ **NOT BUILT** 🔐 | Remove a pending GTT |
| Get GTT Order Details | ❌ **NOT BUILT** 🔐 | View all your active GTT orders |

**How to implement:** GTT orders are powerful for alerts without active monitoring. Backend:
```python
def place_gtt(self, instrument_key, trigger_price, qty, order_type, transaction_type):
    return self.request("POST", "v2/gtt/orders", data={...})
```

---

## 11. 💼 Portfolio

**What it is:** Your holdings (stocks you own long-term) and your positions (intraday or short-term trades currently open).

| Item | Status | Notes |
|---|---|---|
| Get Positions | ❌ **NOT BUILT** 🔐 | All open intraday/short-term positions with live P&L |
| Get MTF Positions | ❌ **NOT BUILT** 🔐 | Margin Trading Facility positions |
| Convert Positions | ❌ **NOT BUILT** 🔐 | Convert intraday trade to delivery (hold overnight) |
| Get Holdings | ❌ **NOT BUILT** 🔐 | Long-term holdings in your demat account |

> **You said you use Dhan for trades**, so holdings/positions from Upstox may not be populated. But if you ever route a trade through Upstox, these will show data.

---

## 12. 📈 Mutual Funds

**What it is:** If you have any SIP or lump-sum Mutual Fund investments made via Upstox, these endpoints show their status and holdings.

| Item | Status | Notes |
|---|---|---|
| MF Order Book | ❌ **NOT BUILT** | All MF orders |
| MF Order Details | ❌ **NOT BUILT** | Status of a specific MF order |
| MF Order SIPs | ❌ **NOT BUILT** | Your active SIP mandates |
| MF Holdings | ❌ **NOT BUILT** | Your current MF portfolio NAV and units |

**How to implement:** REST calls to `/v2/mf/orders` and `/v2/mf/sips`. Very useful if you invest in MFs via Upstox.

---

## 13. 📉 Trade Profit & Loss (P&L Report)

**What it is:** A detailed P&L report for all your past trades — filterable by date range, stock, segment. Includes tax computation.

| Item | Status | Notes |
|---|---|---|
| Get Report Meta Data | ❌ **NOT BUILT** 🔐 | Available financial years for P&L reports |
| Get Profit Loss Report | ❌ **NOT BUILT** 🔐 | Detailed P&L per trade with realized gains |
| Get Trades Charges | ❌ **NOT BUILT** 🔐 | Brokerage + taxes paid for all historical trades |

**How to implement:**
```python
def get_pnl_report(self, from_date, to_date, segment, page_no=1, page_size=50):
    return self.request("GET", "v2/trade/profit-loss/data", params={...})
```
**Use case:** Auto-populate your Trading Journal's PnL section with real historical trade data.

---

## 14. 📊 Historical Data

**What it is:** Past price data (OHLC candles) for stocks and indices — used to draw charts, backtest strategies, and compute indicators.

| Item | Status | Notes |
|---|---|---|
| Historical Candle Data V3 | 🔶 **PARTIAL** | Backend `get_historical_candles()` + `/api/upstox/historical-candles` route. No frontend chart yet |
| Intraday Candle Data V3 | ❌ **NOT BUILT** | Minute/hour candles for today's trading session |
| Historical Candle Data (V2) | 🔶 **PARTIAL** | Same as above, uses V2 endpoint |
| Intraday Candle Data (V2) | ❌ **NOT BUILT** | V2 intraday candles |

**How to implement intraday:**
```python
def get_intraday_candles(self, instrument_key, interval):
    key = instrument_key.replace("|", "%7C")
    return self.request("GET", f"v3/historical-candle/intraday/{key}/{interval}")
```
**Intervals available:** `1minute`, `5minute`, `15minute`, `30minute`, `1hour`

**Use case:** Add a live chart component to the Stock Detail drawer that shows today's intraday candles + historical OHLC.

---

## 15. 💹 Market Quote

**What it is:** Real-time price snapshots for any stock or index — LTP (Last Traded Price), OHLC, volume, etc.

| Item | Status | Notes |
|---|---|---|
| Full Market Quotes | ✅ **DONE** | `get_full_quotes()` + `/api/upstox/quotes` route with batching (500 per call) |
| OHLC Quotes V3 | ❌ **NOT BUILT** | Lightweight OHLC snapshot only (faster, less data) |
| LTP Quotes V3 | ❌ **NOT BUILT** | Ultra-lightweight — just last traded price for many symbols |
| Option Greeks | ✅ **DONE** | Greeks fetched via the full WebSocket feed (delta, gamma, theta, vega, IV) |
| OHLC Quotes (V2) | ❌ **NOT BUILT** | V2 variant |
| LTP Quotes (V2) | ❌ **NOT BUILT** | V2 variant |

**How to implement LTP Quotes V3:**
```python
def get_ltp_quotes(self, instrument_keys: list):
    keys_str = ",".join(instrument_keys)
    return self.request("GET", "v3/market-quote/ltp", params={"instrument_key": keys_str})
```
**Use case:** Replace the current full-quote polling with LTP-only calls for watchlist tickers — 10x cheaper on rate limits.

---

## 16. 🔗 Option Chain

**What it is:** The full options table for a stock or index at a specific expiry date — all strikes, CE (Call) and PE (Put) prices, OI, IV, and Greeks.

| Item | Status | Notes |
|---|---|---|
| Option Contracts (Get Expiries) | ✅ **DONE** | `get_option_contracts()` + `/api/upstox/option-contracts` |
| Put/Call Option Chain | ✅ **DONE** | `get_option_chain()` + `/api/upstox/option-chain` with auto-expiry selection |

---

## 17. 📡 Market Information

**What it is:** A rich set of market-wide data points — Open Interest, FII/DII flows, Max Pain, PCR, smart money lists, and exchange status.

| Item | Status | Notes |
|---|---|---|
| Get Options Smartlist | ❌ **NOT BUILT** | Upstox's curated list of most actively traded options |
| Get Futures Smartlist | ❌ **NOT BUILT** | Most active futures contracts |
| Get MTF Smartlist | ❌ **NOT BUILT** | Stocks eligible for Margin Trading Facility |
| Get FII Data | ✅ **DONE** | `get_fii_data()` + `/api/upstox/fii` + `/api/upstox/fii-dii/consolidated` |
| Get DII Data | ✅ **DONE** | `get_dii_data()` + `/api/upstox/dii` |
| Get OI | ✅ **DONE** | `get_oi()` + `/api/upstox/oi` |
| Get Change in OI | ✅ **DONE** | `get_oi_change()` + `/api/upstox/change-oi` |
| Get Max Pain | ✅ **DONE** | `get_max_pain()` + `/api/upstox/max-pain` |
| Get PCR | ✅ **DONE** | `get_pcr()` + `/api/upstox/pcr` |
| Market Holidays | ✅ **DONE** | `get_market_holidays()` + `/api/upstox/market-holidays` |
| Market Timings | 🔶 **PARTIAL** | Market status endpoint covers timings, but no dedicated timings UI |
| Exchange Status | ✅ **DONE** | `get_market_status()` + `/api/upstox/market-status` |

**How to implement Smartlists:**
```python
def get_options_smartlist(self):
    return self.request("GET", "v2/market/options/smartlist")
```
**Use case:** "Show me the most traded options contracts right now" — a powerful scanner widget.

---

## 18. 📚 Fundamentals

**What it is:** Deep financial data about a company — balance sheet, profit & loss statement, cash flow, share ownership, key financial ratios, and more.

| Item | Status | Notes |
|---|---|---|
| Get Company Profile | ✅ **DONE** | `get_company_profile(isin)` + `/api/upstox/fundamentals/profile` |
| Get Balance Sheet | ❌ **NOT BUILT** | Quarterly balance sheet (assets, liabilities) |
| Get Cash Flow | ❌ **NOT BUILT** | Quarterly cash flow statement |
| Get Income Statement | ❌ **NOT BUILT** | Revenue, EBITDA, Net Profit per quarter |
| Get Share Holdings | ✅ **DONE** | `get_shareholdings(isin)` + `/api/upstox/fundamentals/shareholding` |
| Get Key Ratios | ✅ **DONE** | `get_key_ratios(isin)` + `/api/upstox/fundamentals/key-ratios` |
| Get Corporate Actions | ✅ **DONE** | `get_corporate_actions(isin)` + `/api/upstox/fundamentals/corporate-actions` |
| Get Competitors | ✅ **DONE** | `get_competitors(isin)` + `/api/upstox/fundamentals/competitors` |

**How to implement the 3 missing statements:**
```python
def get_balance_sheet(self, isin):
    return self.request("GET", f"fundamentals/{isin}/balance-sheet")

def get_cash_flow(self, isin):
    return self.request("GET", f"fundamentals/{isin}/cash-flow")

def get_income_statement(self, isin):
    return self.request("GET", f"fundamentals/{isin}/income-statement")
```
**Use case:** Build a "Stock Deep Dive" modal that shows OHLC chart + key ratios + balance sheet in one drawer — like a mini Bloomberg terminal.

---

## 19. 📰 News

**What it is:** Market news articles filtered by stock or general market. Sentiment-tagged (positive/negative/neutral).

| Item | Status | Notes |
|---|---|---|
| Get News | ✅ **DONE** | `/api/upstox/news` route with symbol filtering. Has mock fallback when token fails. |

---

## 20. 📋 IPO

**What it is:** Upcoming and recent IPO listings — price, lot size, subscription status, GMP (Grey Market Premium), allotment dates.

| Item | Status | Notes |
|---|---|---|
| Get IPOs | ❌ **NOT BUILT** | List of all current/upcoming IPOs |
| Get IPO Details | ❌ **NOT BUILT** | Full details of a specific IPO |

**How to implement:**
```python
def get_ipos(self, status="upcoming"):
    return self.request("GET", "v2/ipo", params={"status": status})
```
**Use case:** Add an IPO tracker widget on the dashboard — "Upcoming IPOs this week". Very popular feature for retail investors.

---

## 21. 🌊 WebSocket (Live Streaming)

**What it is:** Instead of repeatedly asking "what's the price now?", WebSocket is like a phone call — Upstox streams prices to you in real-time the moment they change.

| Item | Status | Notes |
|---|---|---|
| Market Data Feed V3 | ✅ **DONE** | Full V3 Protobuf stream in `upstox_ws.py` — connected via SSE to frontend |
| Get Market Data Feed Auth URL V3 | ✅ **DONE** | `v3/feed/market-data-feed/authorize` authorization call |
| Portfolio Stream Feed | ❌ **NOT BUILT** 🔐 | Real-time updates on your orders and positions |
| Get Portfolio Stream Auth URL | ❌ **NOT BUILT** 🔐 | Authorization URL for portfolio feed |
| Market Data Feed (V2 legacy) | 🔶 **PARTIAL** | Code supports both, V3 is preferred |
| Get Market Data Feed Auth URL V2 | 🔶 **PARTIAL** | Still referenced in some fallback paths |

**Portfolio Stream** — How to implement:
```python
# In upstox_ws.py — add a second WebSocket client for portfolio stream
auth_res = upstox_client.request("GET", "v2/feed/portfolio-stream-feed/authorize")
portfolio_ws_uri = auth_res["data"]["authorizedRedirectUri"]
# Connect + decode order/position update events
```
**Use case:** Real-time notifications "Your NIFTY 24000 CE order was filled at ₹142"

---

## 22. 🔔 Webhook

**What it is:** Instead of you asking Upstox for updates, Upstox pushes a notification to your server whenever an order fills, a position changes, or a GTT triggers.

| Item | Status | Notes |
|---|---|---|
| Notifier Webhook Endpoint | ❌ **NOT BUILT** 🔐 | Requires a public HTTPS URL that Upstox can POST to |

**How to implement:**
1. Register a webhook URL in your Upstox developer console
2. Add a `POST /webhook/upstox` endpoint in `app.py`
3. Parse the webhook payload (order fills, position alerts)
4. Push to SSE so the frontend gets real-time notifications

**Note:** Requires exposing your server to the internet (e.g., via ngrok or a cloud deployment).

---

## 23. 🔧 WebSocket Implementation (Streamer Functions)

**What it is:** Utility functions for the WebSocket client — how to subscribe, unsubscribe, and what data modes are available.

| Item | Status | Notes |
|---|---|---|
| Subscribe (sub) | ✅ **DONE** | `upstox_ws_client.subscribe(keys)` + `/api/upstox/ws/subscribe` |
| Unsubscribe (unsub) | ✅ **DONE** | `upstox_ws_client.unsubscribe(keys)` + `/api/upstox/ws/unsubscribe` |
| Stream Mode: `full` | ✅ **DONE** | Full data including OHLC, OI, greeks, depth |
| Stream Mode: `ltpc` | ❌ **NOT BUILT** | Lightweight — only Last price + Change% (cheaper on bandwidth) |
| Latest Tick Snapshot | ✅ **DONE** | `/api/upstox/ws/latest?key=...` returns most recent tick |
| SSE Live Stream | ✅ **DONE** | `/api/upstox/ws/stream` Server-Sent Events stream to frontend |

**How to implement `ltpc` mode:**
In `upstox_ws.py` subscription payload, change `"mode": "ltpc"` instead of `"mode": "full"`. Add an optional parameter:
```python
await self._send_subscription(keys, "sub", mode="ltpc")  # or "full"
```

---

## 📊 Summary Table — Implementation Coverage

| Category | Total Endpoints | Done | Partial | Not Built |
|---|---|---|---|---|
| Developer API (Auth/Rate) | 8 | 7 | 0 | 1 |
| Instruments | 3 | 3 | 0 | 0 |
| Expired Instruments | 4 | 0 | 0 | 4 |
| Login | 5 | 4 | 0 | 1 |
| User | 7 | 0 | 0 | 7 |
| Payments | 2 | 0 | 0 | 2 |
| Charges | 1 | 0 | 0 | 1 |
| Margins | 1 | 0 | 0 | 1 |
| Orders | 14 | 0 | 0 | 14 |
| GTT Orders | 4 | 0 | 0 | 4 |
| Portfolio | 4 | 0 | 0 | 4 |
| Mutual Funds | 4 | 0 | 0 | 4 |
| Trade P&L | 3 | 0 | 0 | 3 |
| Historical Data | 4 | 2 | 0 | 2 |
| Market Quote | 6 | 2 | 0 | 4 |
| Option Chain | 2 | 2 | 0 | 0 |
| Market Information | 11 | 8 | 1 | 2 |
| Fundamentals | 8 | 5 | 0 | 3 |
| News | 1 | 1 | 0 | 0 |
| IPO | 2 | 0 | 0 | 2 |
| WebSocket | 6 | 4 | 1 | 1 |
| Webhook | 1 | 0 | 0 | 1 |
| Streamer Functions | 6 | 5 | 0 | 1 |
| **TOTAL** | **117** | **43** | **2** | **72** |

---

## 🎯 Priority Implementation Roadmap

### 🔴 High Priority (Big Impact, Analytics Token Sufficient)
1. **Balance Sheet + Income Statement + Cash Flow** — Complete the Fundamentals section. Adds massive value to stock research. *(3 endpoints, ~1 hour)*
2. **Intraday Candle Data V3** — Show today's 5min/15min chart for any stock. *(1 endpoint, ~30 min)*
3. **LTP Quotes V3** — Replace heavy full-quote polling for watchlist. 10x fewer bytes. *(1 endpoint, ~20 min)*
4. **IPO Tracker** — Very popular feature. Two endpoints, one widget. *(2 endpoints, ~1 hour)*
5. **Options Smartlist** — Pre-built scanner for active option chains. *(1 endpoint, ~20 min)*

### 🟡 Medium Priority (Requires OAuth Daily Token)
6. **User Profile + Funds & Margin** — Show account details in Settings. *(2 endpoints)*
7. **Trade History (Read-only P&L)** — Auto-populate your journal with past trades. *(3 endpoints)*
8. **Portfolio Stream WebSocket** — Real-time order fill notifications. *(1 endpoint)*
9. **GTT Orders** — Set price alerts that auto-execute. *(4 endpoints)*

### 🟢 Low Priority / Skip
- **Orders V2/V3** — You use Dhan for trading. Skip.
- **Holdings/Positions** — Dhan-only. Skip.
- **Webhook** — Requires cloud deployment. Defer.
- **Sandbox** — Only needed for testing orders. Skip until orders are built.
- **MCP Integration** — Nice-to-have AI feature, not dashboard critical.

---

## 🔑 Key Takeaway

> Your app already implements **43 out of 117 endpoints** — that's 37% coverage, and it covers the most important market data features. The next biggest wins are the **3 missing Fundamentals endpoints** (Balance Sheet, Cash Flow, Income Statement), **Intraday Candle charts**, **LTP quotes optimization**, and the **IPO tracker** — all of which work with your current Analytics token.
