# 🗄️ Volume 03: Dexie IndexedDB v30 Database Schema (37 Tables)

> **Component of:** [WealthOS v2 Documentation Index](../README.md#-master-documentation-index)

---

## 6. Data Layer and Database Schema

### Dual Storage Architecture

```
CLIENT SIDE (Browser)
+-----------------------------------------------------------------------+
|  Dexie IndexedDB (WealthAggregatorDB v31)                            |
|  37 tables -- structured, fully queryable, offline-capable             |
|  All financial / personal data lives here                             |
+-----------------------------------------------------------------------+
|  Zustand (5 stores)          |  localStorage                         |
|  In-memory + persist plugin  |  API keys, appearance settings        |
+------------------------------+---------------------------------------+

SERVER SIDE (Python Bridge - optional sidecar)
+-----------------------------------------------------------------------+
|  SQLite (cache.db) -- 10+ tables                                      |
|  NSE market data cache (delivery, insider, orderflow, FII/DII)       |
|  TTL-aware with market-hours awareness                                |
+-----------------------------------------------------------------------+
```

### Dexie IndexedDB Schema (Version 30)

All 37 tables are defined in `database.ts` across 30 versioned migrations:

**Database Schema -- Entity Relationship:**

```mermaid
erDiagram
    INVESTMENT ||--o{ TRADE : "generates"
    INVESTMENT ||--o{ REALIZED_TRANSACTION : "books"
    INVESTMENT ||--o{ DIVIDEND : "pays"
    INVESTMENT ||--o{ ALERT : "triggers"
    TRADE ||--o{ MISTAKE : "leads to"
    MISTAKE ||--|| MIRROR_RULE : "becomes"
    TRADE ||--o{ SCREENSHOT : "attached to"
    CONVERSATION ||--o{ CHAT_MESSAGE : "contains"
    IPO_APPLICATION ||--o{ FRIEND : "syndicate"
    PAPER_TRADE ||--|| FORWARD_DUEL : "competes"
    INSTRUMENT ||--o{ BROKER_HOLDINGS_CACHE : "cached as"
    INSTRUMENT ||--o{ BROKER_POSITIONS_CACHE : "cached as"
    GOAL ||--o{ TRANSACTION : "funded by"
    STRATEGY ||--o{ TRADE : "used in"
    DAILY_REVIEW ||--o{ TRADE : "reviews"
    BENEFICIARY ||--o{ LEGACY_VAULT : "inherits"
    LIFE_EVENT ||--o{ HISTORY : "impacts"
    TAX_RECORD ||--o{ TRADE : "taxable"
    MISSED_TRADE ||--o{ STRATEGY : "would have used"
    QUIZ_PROGRESS ||--o{ ACHIEVEMENT : "earns"
    CACHE ||--o{ TELEGRAM_SIGNAL : "stores"

    INVESTMENT {
        string id PK
        string type
        string platform
        array tags
        string sector
        string owner
        float quantity
        float avgPrice
    }
    TRADE {
        string id PK
        string ticker
        date date
        string direction
        string aiVerdict
        int convictionScore
        float pnl
    }
    MISTAKE {
        string id PK
        date date
        string category
        float cost
        string lesson
    }
    MIRROR_RULE {
        string id PK
        date date
        boolean isActive
        string rule
    }
    CONVERSATION {
        string id PK
        string persona
        timestamp createdAt
    }
    GOAL {
        string id PK
        string name
        int priority
        date targetDate
        float targetAmount
    }
    INSTRUMENT {
        string securityId PK
        string symbol
        string exchangeSegment
    }
```

**Table Categories -- Visual Distribution:**

```mermaid
pie showData
    title Dexie Tables by Category -- 37 Total
    "Portfolio (investments, holdings)" : 6
    "Trading (trades, paper, duels)" : 5
    "Journal (mistakes, rules, reviews)" : 4
    "AI (conversations, messages)" : 2
    "IPO + Friends" : 2
    "Alerts + Instruments" : 3
    "Goals + Transactions" : 4
    "Tax + History + Events" : 4
    "Sync + Cache" : 3
```

**Storage Architecture -- Visual:**

```mermaid
graph TB
    subgraph Browser[Browser Storage]
        A[Dexie IndexedDB<br/>37 tables<br/>~50MB typical]
        B[Zustand Stores<br/>5+ stores<br/>~2MB in-memory]
        C[localStorage<br/>Encrypted API keys<br/>~1MB]
    end

    subgraph Python[Python Bridge Storage]
        D[SQLite cache.db<br/>WAL mode<br/>~100MB typical]
    end

    subgraph Cloud[Optional Cloud]
        E[Firebase Firestore<br/>Encrypted sync]
        F[GCP Cloud Storage<br/>Encrypted backups]
    end

    A --> B
    B --> C
    A -.->|Backup| F
    B -.->|Sync| E
    A -.->|Cache| D
    D -.->|Mirror| A

    style Browser fill:#dbeafe,stroke:#2563eb
    style Python fill:#d1fae5,stroke:#059669
    style Cloud fill:#fef3c7,stroke:#d97706
```

| Table                      | Primary Key / Indexes                        | Purpose                                   |
| -------------------------- | -------------------------------------------- | ----------------------------------------- |
| `investments`            | `id, type, platform, *tags, sector, owner` | Core investment holdings (12 asset types) |
| `trades`                 | `id, ticker, date, direction, aiVerdict`   | Full trade journal (146-field schema)     |
| `history`                | `date`                                     | Daily net worth snapshots                 |
| `goals`                  | `id, name, priority, category, targetDate` | Financial goal tracking                   |
| `transactions`           | `id, date, category, type, bankName`       | Bank/UPI transaction log                  |
| `mistakes`               | `id, date, category`                       | Mirror of Truth mistake ledger            |
| `mirror_rules`           | `id, date, isActive`                       | Rules derived from mistakes               |
| `strategies`             | `id, name`                                 | Strategy rulebook with rule checklists    |
| `daily_reviews`          | `date`                                     | Daily trading report cards                |
| `conversations`          | `id, persona, createdAt, updatedAt`        | AI chat threads                           |
| `chat_messages`          | `id, conversationId, timestamp`            | Per-message AI history                    |
| `ipo_applications`       | `id, ipoName, status, upiHandle`           | IPO application lifecycle                 |
| `paper_trades`           | `id, ticker, status`                       | Paper trading positions                   |
| `forward_duels`          | `id, date, systemTicker`                   | Human vs System daily challenge           |
| `dividends`              | `id, ticker, date`                         | Dividend income records                   |
| `friends`                | `id, name, balance`                        | IPO syndicate friends pool                |
| `alerts`                 | `id, type, assetId, isActive`              | Smart price/SIP alert system              |
| `instruments`            | `securityId, symbol, exchangeSegment`      | DhanHQ instrument master                  |
| `broker_holdings_cache`  | `broker, brokerSecurityId, fetchedAt`      | Live holdings snapshot                    |
| `broker_positions_cache` | `broker, brokerSecurityId, fetchedAt`      | Live intraday positions                   |
| `sync_records`           | `id, entityType, syncStatus, lastSyncedAt` | Cloud sync audit trail                    |
| `historical_data`        | `id, date, symbol, assetClass`             | OHLCV data vault for backtesting          |
| `cache`                  | `id, key, timestamp, ttl`                  | General-purpose TTL cache                 |
| `beneficiaries`          | `id, name, allocation`                     | Estate planning beneficiary registry      |
| `realized_transactions`  | `id, investmentId, saleDate`               | Profit booking history                    |
| `missed_trades`          | `id, date, ticker, reason`                 | Missed trade analysis                     |
| `quiz_progress`          | `id, userId, totalXP`                      | Academy gamification state                |
| `tax_records`            | `id, fy`                                   | Tax year computation records              |
| `life_events`            | `id, date`                                 | Major life events for wealth simulation   |

### SQLite Cache Tables (Python Bridge)

| Table                 | Key Columns                      | Data Freshness Strategy                |
| --------------------- | -------------------------------- | -------------------------------------- |
| `delivery_history`  | `symbol, date`                 | 30-day rolling, skips non-market hours |
| `insider_trading`   | `symbol, created_at`           | 12-hour TTL refresh                    |
| `pledged_shares`    | `symbol, updated_at`           | 1-day TTL                              |
| `mf_insider`        | `symbol, isin`                 | 7-day TTL                              |
| `orderflow_ticks`   | `symbol, timestamp, time_slot` | 5-minute interval polling              |
| `volume_averages`   | `symbol, exchange`             | 20-day rolling average                 |
| `instrument_master` | `security_id, symbol`          | Daily sync from Upstox gzip master     |
| `ohlcv_cache`       | `symbol, date`                 | Historical candle data vault           |
| `fii_dii_history`   | `date`                         | FII/DII daily flow data                |
| `intraday_history`  | `symbol, time_slot`            | R-Factor intraday baseline             |

---

> **Interactive Graph:** `graphify-out/graph.html`
> **Graph Analysis:** `graphify-out/GRAPH_REPORT.md`

# WealthOS v2 (Wealth Aggregator Pro) v2.0 -- README (Part 2)

> This is a continuation of [README.md](file:///C:/Users/gadda/.gemini/antigravity-ide/brain/09c45d80-3b56-4434-b12f-cb1bd33bbd3c/README.md)

---

