# 🎬 Volume 02: The 19 Functional Hubs & Workflows Walkthrough

> **Component of:** [WealthOS v2 Documentation Index](../README.md#-master-documentation-index)

---

## 🎬 Feature Walkthrough

### Visual Hub Map -- All 19 Hubs at a Glance

```mermaid
mindmap
  root((WealthOS v2 (Wealth Aggregator Pro)))
    Dashboard
      Net Worth Hero
      Live Ticker
      VIX Orb
      Widget Grid
    Portfolio
      Holdings
      DNA Factors
      Smart Rebalance
      eCAS Import
    Alpha Engine 2.0
      Intraday Booster
      Shadow Screener
      ORB
      IV Skew
      Convergence
    Quantum Terminal
      Confluence Deck
      Strategy Optimizer
      Profitability Co-Pilot
      Wealth Quest Matrix
    Momentum Pool
      Hero Panel
      Watch Grid
      Verdict Feed
      Telegram Push
    Jarvis Workspace
      v2 Ambient
      v3 Sentinel
      v4 Voice
      Execution Conduit
    Signal Intelligence
      Telegram Ear
      OCR Pipeline
      Signal Ledger
      Daily Digest
    Mastery Hub
      Skill Trees
      Achievements
      XP Celebration
    Journal
      Mirror of Truth 2.0
      P&L Calendar
      Slump Buster
      What-If Builder
    Market Intel
      Macro Pulse
      Option Chain
      Paper Trading
    Strategy Lab
      Apex Backtester
      Walk-Forward
      Monte Carlo
    Growth Engine
      Alpha Predator
      Insider Radar
      Tax Harvester
    Analytics
      Black-Scholes
      IV Skew
      Delta Hedging
    Innovation Lab
      Boardroom
      Black Swan
      Dynasty Mode
    Life Planner
      Goal GPS
      FIRE
      Legacy Vault
    Tax Center
      LTCG/STCG
      eCAS Import
      Loss Harvesting
    Fortress
      AES-256
      Guardian Protocol
      Audit Log
    Settings
      API Keys
      Brokers
      Privacy
      Sync
    Launchpad
      Mac Dock
      Tool Cards
```

### 1. Dashboard Hub -- Your Command Center

The dashboard is the first thing you see. It gives you a complete picture of your financial health at a glance:

- **Net Worth Hero Card** -- Total portfolio value with 24h change, XIRR, and CAGR, animated `<CountUp>` and pulsing `<ValueFlash>` on every tick
- **Live Index Ticker** -- NIFTY 50, SENSEX, NIFTY BANK, INDIA VIX with color-coded momentum
- **VIX Sentiment Orb** -- Animated orb that changes color based on market fear/greed
- **Drag-and-Drop Widget Grid** -- Rearrange widgets to your preference; 4 view modes (Compact/Standard/Wide/Full)
- **Smart Watchlist** -- Live prices with your custom tracked stocks, `tactileHover` micro-interactions
- **Bloomberg Command Console** (CC19) -- `Ctrl+K` to jump anywhere; hot-key chain across 11+ hubs
- **Macro Regime Banner** -- regime-aware color band that warns you when sector rotation shifts
- **Morning Briefing** -- pre-market daily brief powered by the AI Advisor + Alpha engine

**Dashboard Layout -- Visual:**

```mermaid
graph TB
    subgraph Dashboard[Dashboard Hub]
        A[Net Worth Hero Card<br/>₹1,24,50,000 +2.3%]
        B[Live Index Ticker<br/>NIFTY 24,850 SENSEX 81,200]
        C[VIX Sentiment Orb<br/>Fear: 32% Greed: 68%]
    end

    subgraph Widgets[Widget Grid]
        D[Smart Watchlist<br/>10 stocks]
        E[Portfolio Allocation<br/>12 assets]
        F[Recent Trades<br/>Last 5]
        G[Market Movers<br/>Top 10]
        H[IPO Calendar<br/>Next 3]
    end

    subgraph Sidebar[Sidebar]
        I[Ctrl+K Command Palette]
        J[Notification Center]
        K[Privacy Mode]
    end

    A --> Dashboard
    B --> Dashboard
    C --> Dashboard
    D --> Widgets
    E --> Widgets
    F --> Widgets
    G --> Widgets
    H --> Widgets
    I --> Sidebar
    J --> Sidebar
    K --> Sidebar

    style A fill:#4f46e5,color:#fff
    style B fill:#06b6d4,color:#fff
    style C fill:#f59e0b,color:#fff
```

### 2. Portfolio Hub -- Know What You Own

- Add investments across 12 asset classes: Mutual Funds, Stocks, ETFs, Gold, FDs, Crypto, Real Estate, IPOs, etc.
- Automatic XIRR and CAGR calculation per investment and for the whole portfolio
- Asset allocation donut chart with rebalancing suggestions
- **One-click broker sync** (DhanHQ + Upstox) to pull live holdings and positions
- Compliance check: tracks over-concentration, sector exposure, and debt-equity ratio
- **Portfolio DNA + Factor Attribution** (CC30) -- value, momentum, quality, size, volatility factors
- **Smart Rebalancing Engine** with tax-aware trade suggestions

**Portfolio DNA -- Factor Attribution Visual:**

```mermaid
pie showData
    title Portfolio DNA -- Factor Attribution
    "Value Factor" : 32.5
    "Momentum Factor" : 28.3
    "Quality Factor" : 18.7
    "Size Factor" : 12.1
    "Volatility Factor" : 8.4
```

**Asset Allocation -- Example Distribution:**

```mermaid
pie showData
    title Asset Allocation Across 12 Classes
    "Mutual Funds" : 28.5
    "Stocks (Direct)" : 22.3
    "Stocks (F&O)" : 8.7
    "ETFs" : 12.4
    "Gold" : 9.2
    "Fixed Deposits" : 7.8
    "Crypto" : 4.1
    "Real Estate" : 3.5
    "PPF/EPF" : 2.8
    "Bonds" : 0.7
```

### 3. Alpha Engine 2.0 -- Find Trading Opportunities

- **Intraday Booster**: G-Factor ranked stock list updated every session -- gives you the top momentum picks
- **Shadow Screener**: Multi-filter stock screener with sector confluence scoring, fundamentals, and quality scorecard
- **Market Heatmap**: Visual sector heat map (16 sectors) with fatigue/springboard states
- **Order Flow Dashboard**: Live NSE option chain delta-weighted flow (requires Python bridge)
- **Stock Selection Engine** (CC14) -- relative-strength ranking with advanced filters
- **Opening Range Breakout (ORB)** + **Dynamic Risk Manager** (CC16)
- **Derivatives & Option Chain** (CC15) + **Advanced Greeks & IV Skew** (CC29)
- **Convergence Engine** -- fuses signals across technical, fundamental, institutional, derivatives, orderflow

**Alpha Engine 2.0 -- Signal Flow:**

```mermaid
flowchart LR
    A[Market Data<br/>7-Tier Fallback] --> B[Alpha Engine 2.0]
    B --> C[Stock Selection<br/>CC14]
    B --> D[Derivatives<br/>CC15]
    B --> E[ORB + Risk<br/>CC16]
    B --> F[Ingestion<br/>CC17]

    C --> G[Convergence Engine]
    D --> G
    E --> G
    F --> G

    G --> H[Ranked Alpha List]
    H --> I[Verdict: BUY/WATCH/AVOID]
    I --> J[Push to Momentum Pool]
    I --> K[Send to Journal]

    style A fill:#4f46e5,color:#fff
    style B fill:#7c3aed,color:#fff
    style G fill:#ec4899,color:#fff
    style I fill:#10b981,color:#fff
```

**Sector Heatmap -- 16 Tracked Sectors:**

```mermaid
graph TB
    subgraph Bullish[🟢 Bullish Sectors]
        A1[IT +2.3%]
        A2[BANK +1.8%]
        A3[PVT BANK +1.5%]
        A4[FMCG +1.2%]
    end

    subgraph Neutral[🟡 Neutral Sectors]
        B1[FIN SERVICE 0.0%]
        B2[OIL & GAS -0.2%]
        B3[CONSUMER DURABLES 0.3%]
        B4[PHARMA -0.5%]
    end

    subgraph Bearish[🔴 Bearish Sectors]
        C1[METAL -2.1%]
        C2[REALTY -1.8%]
        C3[CEMENT -1.5%]
        C4[PSU BANK -1.3%]
    end

    style Bullish fill:#d1fae5,stroke:#059669
    style Neutral fill:#fef3c7,stroke:#d97706
    style Bearish fill:#fee2e2,stroke:#dc2626
```

**How to use the Intraday Booster:**

1. Navigate to **Alpha Engine → Intraday Booster**
2. Click **Refresh Market Data** to pull fresh data
3. Stocks are ranked by G-Factor (highest = strongest intraday momentum)
4. Green tags = sector in confluence · Red = sector exhausted
5. Click any stock to see its detailed metrics, ATR, GRR, and OVR

### 4. Quantum Terminal -- Cross-Asset Confluence

A Bloomberg-style deck for serious traders. Top-level hubs:

- **Quantum Command Ribbon** -- live scroll of every signal across the system
- **Quantum Confluence Deck** -- multi-asset view (equity, derivatives, FX, commodity, crypto)
- **Profitability Co-Pilot** -- single 0–100 KPI from your journal, with 5 sub-scores and a 21-day projection
- **Strategy Optimizer Console** (CC36) -- institutional-grade strategy builder with walk-forward + Monte Carlo
- **Resilience Core Console** (CC38) -- backtester logs, telemetry, and the OCR-to-signal pathway
- **Wealth Quest Matrix** (CC37) -- gamified RPG-style progression
- **Beginner Explainer** -- collapsible 1-screen overview of every Quantum tab, in plain English
- **Floating "Ask Jarvis" button** -- bottom-right orb that opens `JarvisVoiceConsole` from any view
- **Cross-tab event bus** -- `quantum:export-to-payoff`, `quantum:sync-to-journal`, `quantum:slide-authorized`, `navigate-to-tab` for cross-widget signaling without coupling

**Profitability Score -- 5 Sub-Scores:**

```mermaid
xychart-beta
    title "Profitability Score -- 5 Sub-Scores (0-100)"
    x-axis ["Discipline", "Edge", "Risk", "Review", "Recovery"]
    y-axis "Score" 0 --> 100
    bar [85, 72, 68, 91, 78]
```

**Quantum Terminal -- User Journey:**

```mermaid
journey
    title Quantum Terminal -- First-Time User Journey
    section Discovery
      Open Quantum Hub: 5: Curious User
      See Beginner Explainer: 4: Curious User
      Hover Profitability Score: 5: Curious User
    section Engagement
      Click Confluence Deck: 4: Curious User
      Drag strategy tiles: 5: Curious User
      Run Monte Carlo: 5: Curious User
    section Mastery
      Build custom strategy: 5: Power User
      Export to backtester: 5: Power User
      Sync to journal: 5: Power User
```

### 5. Momentum Pool -- Pre-Market Watchlist with Auto-Verdict (CC39)

A dedicated top-level hub for the pre-market routine:

- **Pool Hero Panel** -- single biggest mover and the system's pre-market pick
- **Pool Watch Grid** -- drag-to-reorder cards, color-coded by verdict
- **Pool Verdict Feed** -- auto-generated BUY/WATCH/AVOID verdicts with confidence score
- **Pool Telegram Push** -- one-tap push your watchlist to a private Telegram channel
- **Pool Sources Panel** -- manage which signals (Telegram ear, screener, broker feed) feed the pool
- **Pool Toast Bridge** -- instant toast notifications when verdicts change

**Momentum Pool -- Signal Flow:**

```mermaid
flowchart TB
    subgraph Sources[Signal Sources]
        S1[Telegram Ear<br/>Multi-Channel]
        S2[Alpha Screener<br/>G-Factor Ranked]
        S3[Broker Feed<br/>Dhan + Upstox]
        S4[OCR Pipeline<br/>Screenshots]
    end

    Sources --> P[Momentum Pool Engine]
    P --> V[Verdict Engine<br/>BUY/WATCH/AVOID]
    V --> C[Confidence Score<br/>0-100]

    C --> WP[Watch Grid<br/>Drag-to-Reorder]
    C --> HP[Hero Panel<br/>Top Pick]
    C --> VF[Verdict Feed<br/>Live Stream]
    C --> TP[Telegram Push<br/>One-Tap]

    style P fill:#4f46e5,color:#fff
    style V fill:#ec4899,color:#fff
    style C fill:#f59e0b,color:#fff
```

**Momentum Pool -- Verdict Distribution Example:**

```mermaid
pie showData
    title Pool Verdicts -- Today's Distribution
    "BUY (High Conviction)" : 8
    "WATCH (Monitor)" : 14
    "AVOID (Skip)" : 6
    "PENDING (Analyzing)" : 3
```

### 6. Jarvis Voice Workspace -- Speak, the App Obeys

Three generations, one philosophy:

- **Jarvis v2 -- Ambient AI** -- always-on command orb; `Ctrl+J` from anywhere
- **Jarvis v3 -- Autonomous Sentinel** (CC32) -- background Web Worker that watches the market, runs EMA/RSI off-thread, gates voice-routed orders through a hard `RiskSafetyGate` (₹50k session cap, ₹10k daily loss cap, 5 orders/session)
- **Jarvis v4 -- Voice-First Workspace** (CC35) -- push-to-talk with full grammar trained on trade vocabulary; "Sell 200 SBIN at 622, take profit" → confirm toast
- **AI Command Hub** -- 4 personas: **Sage** (conservative), **Oracle** (analytical), **Wolf** (aggressive), **Roast** (brutal honesty)
- Real-time web search grounding via `searchWeb()` for live market context
- Voice mode: speak naturally, get spoken responses (requires Gemini API key)
- Supports 45+ AI models -- switch between them in Settings

**Jarvis Evolution -- v2 → v3 → v4:**

```mermaid
graph LR
    V2[Jarvis 2.0<br/>Ambient Orb<br/>CC30] -->|Upgrade| V3[Jarvis 3.0<br/>Sentinel Web Worker<br/>CC32]
    V3 -->|Upgrade| V4[Jarvis 4.0<br/>Voice-First Workspace<br/>CC35]

    V2 --> F1[Ctrl+J Hotkey]
    V2 --> F2[Floating AI Coach]

    V3 --> F3[Off-thread EMA/RSI]
    V3 --> F4[RiskSafetyGate<br/>₹50k session cap]
    V3 --> F5[Auto-restart on crash]

    V4 --> F6[Push-to-Talk]
    V4 --> F7[Trade Vocab Grammar]
    V4 --> F8[VoiceOrderConfirmToast]
    V4 --> F9[Broker Execution Conduit<br/>CC23]

    style V2 fill:#06b6d4,color:#fff
    style V3 fill:#7c3aed,color:#fff
    style V4 fill:#ec4899,color:#fff
```

**RiskSafetyGate -- Voice Order Safety Flow:**

```mermaid
stateDiagram-v2
    [*] --> Listening
    Listening --> Parsing: Voice Input Detected
    Parsing --> RiskCheck: Intent Extracted

    RiskCheck --> Allowed: Notional ≤ ₹50k<br/>Daily Loss ≤ ₹10k<br/>Orders ≤ 5
    RiskCheck --> Halt: Daily Loss Exceeded

    Allowed --> ConfirmToast: Show VoiceOrderConfirmToast
    ConfirmToast --> Executing: User Confirms
    ConfirmToast --> Cancelled: User Cancels

    Executing --> BrokerAPI: Send to Dhan/Upstox
    BrokerAPI --> Success: Order Filled
    BrokerAPI --> Failed: Order Rejected

    Halt --> VoiceDisabled: Disable Voice for Day
    VoiceDisabled --> [*]

    Success --> [*]
    Failed --> [*]
    Cancelled --> [*]
```

**AI Personas -- Behavioral Spectrum:**

```mermaid
graph LR
    A[Conservative] -->|→| B[Sage]
    B -->|→| C[Oracle]
    C -->|→| D[Wolf]
    D -->|→| E[Roast]
    E -->|→| F[Aggressive]

    B -.Risk Averse.-> B
    C -.Analytical.-> C
    D -.Bold.-> D
    E -.Brutal.-> E

    style B fill:#10b981,color:#fff
    style C fill:#06b6d4,color:#fff
    style D fill:#f59e0b,color:#fff
    style E fill:#ef4444,color:#fff
```

### 7. Telegram Multi-Ear + OCR Signal Ledger

- **Multi-channel watcher** -- listen to N premium channels, with per-channel keyword filters
- **OCR** -- `tesseract.js` parses screenshots (broker trades, advisory calls) into structured signals
- **Signal Ledger** -- every parsed signal gets stored with source, confidence, and time-to-resolution
- **Telegram Intel Hub** -- multi-channel digest with batched digests and "send to Momentum Pool"
- **Telethon history import** -- pull your *own* chat history to recover 6+ months of missed logs
- **Two-way voice notes** -- send a voice note to the bot → "Confirm this trade?" card with inline buttons

**Telegram OCR -- Pipeline:**

```mermaid
flowchart LR
    A[Telegram Channel<br/>Image/Screenshot] --> B[Telethon Downloader]
    B --> C[Tesseract.js OCR]
    C --> D[Signal Parser<br/>Regex + NLP]
    D --> E{Valid Signal?}

    E -->|Yes| F[Signal Ledger<br/>Dexie Table]
    E -->|No| G[Discard + Log]

    F --> H[Push to Momentum Pool]
    F --> I[Push to Journal]
    F --> J[Push to Telegram Channel]

    style A fill:#0088cc,color:#fff
    style C fill:#4f46e5,color:#fff
    style F fill:#10b981,color:#fff
    style G fill:#ef4444,color:#fff
```

**Signal Ledger -- Example Entries:**

```mermaid
erDiagram
    SIGNAL ||--o{ SOURCE : "from"
    SIGNAL ||--o{ RESOLUTION : "resolves to"
    SOURCE ||--|| CHANNEL : "belongs to"

    SIGNAL {
        string id PK
        string ticker
        string direction "BUY/SELL"
        float entryPrice
        float targetPrice
        float stopLoss
        int confidence "0-100"
        timestamp parsedAt
    }

    SOURCE {
        string id PK
        string channelId FK
        string messageId
        string rawText
        string imageUrl
        timestamp receivedAt
    }

    RESOLUTION {
        string id PK
        string signalId FK
        float exitPrice
        float pnl
        int daysToResolution
        string status "TARGET_HIT/STOP_HIT/EXPIRED"
    }

    CHANNEL {
        string id PK
        string name
        int subscriberCount
        boolean isPremium
    }
```

### 8. Trading Journal 2.0 -- Track Your Psychology

- Log every trade with: emotion before/after, setup grade (A+ to F), mistakes made, screenshots, notes
- The **Mirror of Truth** tracks your costliest mistakes and converts them into active trading rules
- **Quant Duel**: daily challenge where you pit your pick against the algorithm's pick
- Run the **Speed Review** to assess a week of trades in 60-second flash cards
- **Trade Diary Calendar** -- see every trade on a P&L heatmap calendar
- **Cosmic Circuit Breaker** -- automatic cool-down triggers when emotion + loss streak align
- **AI Verdict** per-trade: BUY/SELL/HOLD/WAIT with conviction score, and AI-graded grade (CC18)
- **Slump Buster** -- guided flow that helps you break out of losing streaks
- **What-If Scenario Builder** -- replay history with different exits

**Trade Journal -- Emotion Flow:**

```mermaid
graph TD
    A[Pre-Trade Emotion] --> B{Emotional State}
    B -->|Focused| C[Green Flag<br/>Proceed]
    B -->|Anxious| D[Yellow Flag<br/>Reduce Size]
    B -->|Revenge| E[Red Flag<br/>HARD BLOCK]
    B -->|Bored| F[Yellow Flag<br/>Wait for Setup]

    C --> G[Execute Trade]
    D --> H[Reduce Position 50%]
    E --> I[Guardian Protocol Halt]
    F --> J[Snooze 15min]

    G --> K[Post-Trade Emotion]
    H --> K
    J --> K
    I --> L[Cooling Period]

    K --> M{Outcome}
    M -->|Win| N[Log Success]
    M -->|Loss| O[Log Mistake]
    M -->|Scratch| P[Log Scratch]

    N --> Q[Mirror of Truth]
    O --> R[Mistake Taxonomy]
    P --> Q

    style E fill:#ef4444,color:#fff
    style I fill:#dc2626,color:#fff
    style C fill:#10b981,color:#fff
```

**Trade Grade Distribution -- Example:**

```mermaid
pie showData
    title Trade Grades -- Last 30 Days
    "A+ (Perfect Setup)" : 4
    "A (Strong Setup)" : 12
    "B (Decent Setup)" : 18
    "C (Marginal)" : 9
    "D (Poor)" : 4
    "F (Terrible)" : 2
```

**Mirror of Truth -- Mistake → Rule Pipeline:**

```mermaid
flowchart LR
    A[Trade Logged] --> B{Mistake Made?}
    B -->|No| C[Success Pattern]
    B -->|Yes| D[Mistake Taxonomy<br/>FOMO/Chasing/etc]

    D --> E[Cost Analysis<br/>₹ Lost]
    E --> F[Generate MirrorRule]
    F --> G[Active Trading Rule]
    G --> H[Enforce on Next Trade]

    C --> I[Reinforce Pattern]
    I --> J[Add to Playbook]

    H --> K{Compliant?}
    K -->|Yes| L[Continue]
    K -->|No| M[Guardian Protocol]

    style D fill:#ef4444,color:#fff
    style F fill:#f59e0b,color:#fff
    style G fill:#10b981,color:#fff
    style M fill:#dc2626,color:#fff
```

### 9. AI Advisor -- Your SEBI-Compliant AI

- 4 personas: **Sage** (conservative), **Oracle** (analytical), **Wolf** (aggressive), **Roast** (brutal honesty)
- Ask anything about your portfolio: "Should I add more to HDFC Bank?", "What's my biggest risk?"
- Real-time web search grounding via `searchWeb()` for live market context
- **Agentic Lab** -- chain multiple AI calls into multi-step analyses
- **Tab AI Strip** -- contextual AI hints on every tab
- **Quota Monitor** -- track per-provider usage and budget

**AI Provider Fallback Chain:**

```mermaid
graph TD
    A[User Query] --> B[Primary: Gemini 3.1 Pro]
    B -->|Quota OK| C[Response]
    B -->|Quota Hit| D[Secondary: Groq Llama 3.3 70B]

    D -->|Quota OK| C
    D -->|Quota Hit| E[Tertiary: OpenRouter Hermes 405B]

    E -->|Quota OK| C
    E -->|Quota Hit| F[Quaternary: Mistral Large]

    F -->|Quota OK| C
    F -->|Quota Hit| G[Quinary: Cerebras GPT-OSS 120B]

    G -->|Quota OK| C
    G -->|Quota Hit| H[Senary: GitHub Models GPT-5]

    H -->|Quota OK| C
    H -->|Quota Hit| I[Septenary: Cloudflare Workers AI]

    I -->|Quota OK| C
    I -->|All Down| J[Kill Switch Triggered<br/>Show Graceful Error]

    C --> K[Cache for 30min<br/>LRU 50 entries]
    K --> L[Return to User]

    style B fill:#4f46e5,color:#fff
    style C fill:#10b981,color:#fff
    style J fill:#ef4444,color:#fff
    style K fill:#06b6d4,color:#fff
```

**AI Provider Usage -- Example Distribution:**

```mermaid
pie showData
    title AI Provider Usage -- Last 30 Days
    "Gemini 3.1 Pro" : 42.3
    "Groq Llama 3.3 70B" : 28.7
    "OpenRouter Hermes 405B" : 15.2
    "Mistral Large" : 8.1
    "Cerebras GPT-OSS 120B" : 3.4
    "GitHub Models" : 1.8
    "Cloudflare Workers AI" : 0.5
```

### 10. IPO War Room -- Never Miss an IPO

- Track IPOs from announcement → application → allotment → listing → exit
- GMP (Grey Market Premium) tracker with historical trend
- Syndicate management: track which friends applied and how much
- Allotment probability calculator based on subscription data
- Automatic cutoff price suggestions for RII category

**IPO Lifecycle -- State Machine:**

```mermaid
stateDiagram-v2
    [*] --> Announcement
    Announcement --> Application: Open for Subscription
    Application --> Allotment: Subscription Closed
    Allotment --> Listed: Allotment Confirmed
    Allotment --> NotAllotted: Oversubscribed

    Listed --> Exited: Book Profit/Loss
    Listed --> Holding: Long-term Hold

    Exited --> [*]
    Holding --> [*]
    NotAllotted --> [*]
```

**IPO Subscription Categories -- Example:**

```mermaid
pie showData
    title IPO Subscription -- QIB/NII/RII
    "QIB (Qualified Institutional)" : 45.2
    "NII (Non-Institutional)" : 28.7
    "RII (Retail Individual)" : 18.3
    "Others (Employees)" : 7.8
```

### 11. Tax Center -- Calculate Your Tax Bill

- LTCG and STCG auto-calculation based on your trade history
- F&O turnover computation for ITR-3
- **Tax-loss harvesting** suggestions: which stocks to book losses in before March 31
- Generates a summary ready for your CA
- **eCAS / CAMS / KFin import** (CC40 + `casparser>=1.1.0`) -- drag-and-drop your eCAS PDF, all MF holdings appear in your portfolio

**Tax Calculation -- Flow:**

```mermaid
flowchart TD
    A[All Trades<br/>FY 2025-26] --> B{Classification}
    B -->|Equity < 1yr| C[STCG<br/>15% Tax]
    B -->|Equity > 1yr| D[LTCG<br/>10% over ₹1L]
    B -->|F&O| E[Speculative<br/>30% Tax]
    B -->|Crypto| F[VDAS<br/>30% Tax]

    C --> G[Tax Calculation Engine]
    D --> G
    E --> G
    F --> G

    G --> H[Tax Liability]
    H --> I{Tax Saving Opportunity?}
    I -->|Yes| J[Tax-Loss Harvesting<br/>Suggestions]
    I -->|No| K[ITR Summary]

    J --> L[Book Losses Before Mar 31]
    L --> K

    K --> M[Export PDF for CA]

    style C fill:#f59e0b,color:#fff
    style D fill:#10b981,color:#fff
    style E fill:#ef4444,color:#fff
    style F fill:#dc2626,color:#fff
```

**Tax Liability Breakdown -- Example:**

```mermaid
pie showData
    title Tax Liability -- FY 2025-26
    "STCG (15%)" : 18.5
    "LTCG (10%)" : 32.3
    "F&O Speculative (30%)" : 28.7
    "Crypto VDAS (30%)" : 12.4
    "Dividend Tax" : 8.1
```

### 12. The Fortress -- Security and Guardrails

- AES-256 encrypted security vault for sensitive documents
- **Guardian Protocol**: set daily loss limits, max position size, emotion-based lockouts
- **Audit event log**: every action in the app is logged with timestamp
- **Data backup**: export all your data as encrypted JSON
- **Data restore**: import from a previous backup
- **GCP backup utility** -- encrypted Google Cloud Storage snapshots on demand

**Guardian Protocol -- State Machine:**

```mermaid
stateDiagram-v2
    [*] --> Normal
    Normal --> Halt: Daily Loss > ₹10k
    Normal --> SoftBlock: 3 Consecutive Losses
    Normal --> HardBlock: Position Size > 10% Portfolio

    Halt --> Cooldown: Mandatory 60min Wait
    Cooldown --> Resume: Timer Expired + Emotion Log

    SoftBlock --> Confirm: User Override
    Confirm --> Normal: User Confirms
    SoftBlock --> Halt: User Cancels

    HardBlock --> [*]: Order Rejected

    Resume --> Normal
    Normal --> [*]
```

**Encryption Architecture:**

```mermaid
flowchart LR
    A[User PIN<br/>1234] --> B[PBKDF2<br/>100k iterations]
    B --> C[Derived Key<br/>256-bit]
    C --> D[AES-256-CBC<br/>Encryption]
    D --> E[Encrypted Data<br/>localStorage]

    F[Biometric<br/>Touch ID] --> G[Keychain<br/>iOS/Android]
    G --> C

    H[Recovery Phrase<br/>12 words] --> I[Seed Phrase → Key]
    I --> C

    style A fill:#4f46e5,color:#fff
    style C fill:#10b981,color:#fff
    style E fill:#06b6d4,color:#fff
```

### 13. Settings Hub -- Configure Everything

- **API Keys**: Add/manage all your AI provider keys (shown masked, stored encrypted)
- **Broker Setup**: Connect DhanHQ or Upstox
- **Appearance**: Dark/Light mode, accent color, compact mode, font size
- **Privacy**: Control exactly what your AI advisor can see · **Privacy Mode** blur screen guard
- **Sync**: Enable/disable Firebase cloud sync
- **Guardrails**: Configure your trading risk guardrails
- **Onboarding Flow** -- guided first-launch experience
- **Data Freshness** -- see which widgets are live, cached, or stale

### 14. Calculator Hub -- Math Lab

- SIP/Lumpsum/Compound/CAGR/FIRE/Debt/EMI/Goal-Attainment/Position-Sizing calculators
- **Advanced Compound**, **Daily Compound**, **Averaging**, **ROICalculator**
- **Hindsight Simulator** -- what would have happened if you had entered earlier?
- **Options payoff calculator** with strategy visualizer (CC9)
- **Black-Scholes math lab** with live greeks

### 15. Growth Engine -- Long-Term Wealth Building

- **Alpha Predator Screener** -- fundamental + technical convergence
- **Insider Radar** -- promoter/FII/DII activity scanner
- **Bulk Deal Scanner** -- NSE bulk/block deal feeds
- **Tax Harvester** -- automated tax-loss harvesting
- **Academy** with XP, badges, streaks, mastery skill-trees (CC31)
- **Mastery Hub** -- gamified progression with celebration animations

### 16. Innovation Lab -- Moonshots

- **Boardroom** -- board-meeting style strategic review of your portfolio
- **Black Swan** -- what-if tail-risk scenarios
- **Opportunity Cost** -- what did skipping that trade actually cost you?
- **Dynasty Mode** -- multi-generational wealth transfer planning
- **Impulse Check** -- pause-and-reflect flow before any major decision
- **Liability Vault** -- track loans, EMIs, and net-of-debt wealth

### 17. Life Planner

- **Goal GPS** -- goal tracking with SIP status, countdown timers, FIRE progress bar
- **Retirement Planner** -- multi-stage retirement projection
- **Legacy Vault** -- beneficiaries, will tracking, estate document storage
- **Financial Independence Score** -- animated gauge showing % to FI

### 18. Analytics Center

- **Quant Dashboard** -- cross-asset correlation matrix, return distribution
- **Risk Engine** -- VaR, CVaR, max drawdown, beta to NIFTY
- **Monte Carlo Simulator** -- 10,000-path retirement projection
- **Black-Scholes Calculator** -- full Greeks (Δ, Γ, Θ, ν, ρ)
- **Hindsight Simulator** -- backtest your intuition

### 19. Strategy Lab

- **Apex Backtester** -- multi-strategy backtesting with walk-forward optimization and Monte Carlo simulation
- **Paper Trading** -- full paper-trading engine with virtual margin
- **Pre-Trade Checklist** -- required checklist before any live order
- **Strategy Manager** -- codified rulebook with checklist enforcement

### 20. Launchpad

- **Mac Dock** -- macOS-style app launcher for power users
- **Tool Cards** -- discover and pin tools to your sidebar

### 21. The Telegram Bridge (sidecar)

- Listens to N premium channels in parallel
- WebSocket feed at `ws://localhost:8081`, REST at `http://localhost:3001`
- Bidirectional -- `/positions`, `/pnl`, `/risk`, `/brief`, `/log`, `/mute`, `/screener` slash commands
- **Daily 9 AM digest** -- auto-push to your private channel

---

## 5. Module Map (19 Hubs)

The app is organized into **19 primary navigation hubs**:

```mermaid
graph TD
    A[App Root] --> B[Dashboard Hub]
    A --> C[Portfolio Hub]
    A --> D[Market Intel]
    A --> E[IPO War Room]
    A --> F[Psych Dashboard]
    A --> G[Growth Engine]
    A --> H[Life Planner]
    A --> I[Moonshot Lab]
    A --> J[Analytics Center]
    A --> K[The Fortress]
    A --> L[Alpha Engine 2.0]
    A --> M[Strategy Lab]
    A --> N[Launchpad]
    A --> O[Settings]
    A --> P[Quantum Terminal]
    A --> Q[Momentum Pool]
    A --> R[Jarvis Voice Workspace]
    A --> S[Signal Intelligence]
    A --> T[Mastery Hub]

    P --> P1[Quantum Confluence Deck]
    P --> P2[Strategy Optimizer]
    P --> P3[Profitability Co-Pilot]
    P --> P4[Resilience Core Console]
    P --> P5[Wealth Quest Matrix]

    Q --> Q1[Pool Hero Panel]
    Q --> Q2[Pool Watch Grid]
    Q --> Q3[Pool Verdict Feed]
    Q --> Q4[Pool Telegram Push]

    R --> R1[Jarvis 2.0 Ambient]
    R --> R2[Jarvis 3.0 Sentinel]
    R --> R3[Jarvis 4.0 Voice]

    S --> S1[Telegram Ear]
    S --> S2[OCR Pipeline]
    S --> S3[Signal Ledger]

    T --> T1[Mastery Skill Tree]
    T --> T2[Achievement Engine]
    T --> T3[XP Celebration]

    C --> C1[Portfolio Overview]
    C --> C2[Goal GPS]
    C --> C3[Compliance]

    D --> D1[Macro Pulse]
    D --> D2[Option Chain Intel]
    D --> D3[Paper Sandbox]

    F --> F1[Journal Dashboard]
    F --> F2[Speed-Run Review]

    G --> G1[Predator Engine]
    G --> G2[AI Advisor]
    G --> G3[Academy]

    L --> L1[Intraday Booster]
    L --> L2[Shadow Screener]
    L --> L3[Market Heatmap]
    L --> L4[ORB / IV Skew]
    L --> L5[Stock Selection]
    L --> L6[Convergence Engine]

    M --> M1[Apex Backtester]
    M --> M2[Legacy Simulator]
    M --> M3[Walk-Forward Optimizer]
```

### Hub Capability Reference

| Hub                        | Core Capabilities                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| **Dashboard**        | Net worth hero card with `<CountUp>` + `<ValueFlash>`, live index ticker, VIX sentiment orb, drag-and-drop widget grid, 4 view modes, Macro Regime banner, Morning Briefing |
| **Portfolio Hub**    | Holdings table, XIRR/CAGR computation, asset allocation donut, rebalance modal, compliance score, **Portfolio DNA + factor attribution (CC30)**, smart rebalance, eCAS/CAMS import |
| **Goal GPS**         | Goal tracking with SIP status, countdown timers, FIRE progress bar, animated FI Score gauge |
| **Market Intel**     | Macro panel (VIX/Gold/Crude/USDINR), FII/DII flows, live option chain, earnings calendar, IV skew chart |
| **IPO War Room**     | Application tracker (apply to list lifecycle), GMP radar, grey market feed, syndicate friends pool |
| **Psych Dashboard**  | Emotion-tagged journal, Mirror of Truth 2.0, AI psych scoring, **P&L calendar**, **Slump Buster**, **What-If Scenario Builder**, streak/badge tracker, **Cosmic Circuit Breaker** |
| **Growth Engine**    | Alpha Predator, Bulk Deal Scanner, Insider Radar, Tax Harvester, 4-persona AI advisor, Academy with mastery skill-trees |
| **Life Planner**     | FIRE simulator, Monte Carlo retirement model, legacy vault with beneficiary pie, Dynasty Mode |
| **Moonshot Lab**     | Boardroom, Black Swan, Opportunity Cost, Impulse Check, Liability Vault, multi-generational wealth transfer |
| **Analytics Center** | Black-Scholes calculator, Monte Carlo simulation, deep quant correlation matrix, IV skew & delta hedging, scenario comparison, destiny gauge |
| **The Fortress**     | AES-256 security vault, audit event log, data backup/restore, GCP encrypted backups, guardrail system |
| **Alpha Engine 2.0** | Intraday Booster (G-Factor + R-Factor), Shadow Screener, Market Heatmap, **ORB**, **IV Skew**, **Stock Selection (CC14)**, **Derivatives & Order-Flow Confluence (CC15)**, **Dynamic Risk Manager (CC16)**, Ingestion Failover (CC17) |
| **Strategy Lab**     | Apex Backtester, walk-forward optimization, paper trading simulator, **Strategy Optimizer (CC36)**, **Resilience Core logs (CC38)**, Quant Duel |
| **Launchpad**        | Mac Dock launcher, Tool Cards, App discovery surface |
| **Settings**         | All integrations config, API key manager, broker setup, appearance, privacy, sync, onboarding, data freshness |
| **Quantum Terminal** | Quantum Confluence Deck, Strategy Optimizer Console, **Profitability Co-Pilot** (single 0–100 KPI), **Wealth Quest Matrix**, **Resilience Core**, Beginner Explainer, Floating "Ask Jarvis" button, cross-tab event bus |
| **Momentum Pool**    | Pool Hero Panel, Pool Watch Grid (drag-to-reorder), **Pool Verdict Feed** (auto BUY/WATCH/AVOID), **Pool Telegram Push** (CC39) |
| **Jarvis Workspace** | Jarvis 2.0 ambient orb, **Jarvis 3.0 sentinel Web Worker (CC32)** with hard RiskSafetyGate, **Jarvis 4.0 voice workspace (CC35)** with grammar trained on trade vocab, AI Command Hub, Floating Coach |
| **Signal Intelligence** | Telegram multi-ear, **OCR pipeline (tesseract.js)**, **Signal Ledger**, Telethon history import, two-way voice notes, daily 9 AM digest, slash commands (`/pnl`, `/risk`, `/brief`) |
| **Mastery Hub**      | Gamified skill trees, achievement engine, XP celebration, mastery overview widget (CC31) |

---

