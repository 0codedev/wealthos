# DOMAIN 180: SUB-SECOND L2 CANCEL-TO-TRADE RATIO & SPOOFING DETECTION SIEVE (WP-CD)

**Executive Swarm Intelligence Technical Report**  
**Autonomous Agent:** `Space-Bunny / OpenCode Sovereign Swarm (Variant Max, Mega-Context 1M)`  
**Domain Vertical:** WP-CD / Domain 180: Sub-Second L2 Cancel-to-Trade Ratio & Spoofing Detection Sieve  
**Timestamp:** 2026-10-18T06:40:00+05:30  
**Status:** 🟢 **PRODUCTION READY / FULLY TESTED**  

---

## 1. Executive Summary & Quantitative Mandate

In high-frequency electronic markets, predatory market participants (including spoofers, layerers, and non-bona fide market makers) frequently place massive non-executable limit orders deep in the order book to create a false impression of market depth and induce retail and passive algorithms to execute at disadvantageous prices. As soon as the market price approaches these artificial bids or offers, the spoofing desk flashes cancellations in sub-millisecond intervals ($\tau_{\text{life}} < 50\text{ ms}$), pulling the phantom liquidity before any actual fill occurs.

Relying on raw Level-2 or Level-3 order book depth without accounting for order persistence results in catastrophic slippage and adverse selection: trading algorithms route aggressive market or taker orders expecting deep liquidity, only to sweep an empty book.

Domain 180 delivers an institutional-grade **Sub-Second L2 Cancel-to-Trade Ratio & Spoofing Detection Sieve**:
1. Ingests streaming Level-2 order book events (`NEW`, `CANCEL`, `TRADE`) and computes the directional **Cancellation-to-Trade Ratio** ($\text{CTR}$).
2. Tracks volume-weighted median quote lifetime $\bar{\tau}_{\text{life}}$, separating sticky institutional liquidity from fleeting phantom quotes.
3. Formulates the **Asymmetric Flash Pull Ratio** ($\Xi_{\text{flash}}$) when market price approaches within $\delta \le 2$ ticks of resting orders.
4. Synthesizes a bounded **Composite Phantom Hazard Index** ($S_{\text{phantom}} \in [0.0, 1.0]$) to mathematically discount raw order book depth to **True Vetted Effective Depth** ($D_{\text{effective}}$), vetoing aggressive fills into spoofed walls.

---

## 2. Mathematical Specifications & Microstructure Mechanics

### 2.1 Order Cancellation-to-Trade Ratio (CTR)
For each order book side (Bid or Ask) over a rolling observation window:
$$\text{CTR}_{\text{side}} = \frac{\sum V_{\text{cancelled, side}}}{\max(1.0, \, \sum V_{\text{traded, side}})}$$

Under normal market conditions, $\text{CTR} \in [0.5, 10.0]$. Under high-frequency algorithmic layering or spoofing, $\text{CTR}$ routinely explodes to $>150.0$, indicating that hundreds of shares are cancelled for every single share legitimately traded.

### 2.2 Volume-Weighted Quote Lifetime
For each resting order $k$ inserted at $t_{\text{insert}, k}$ and cancelled at $t_{\text{cancel}, k}$ with quantity $Q_k$:
$$\bar{\tau}_{\text{life}} = \frac{\sum_k Q_k (t_{\text{cancel}, k} - t_{\text{insert}, k})}{\sum_k Q_k} \quad (\text{in milliseconds})$$

Benign market makers maintain resting orders for $\bar{\tau}_{\text{life}} \ge 500\text{ ms}$ to capture maker rebates. Spoofing orders exhibit fleeting microsecond lifetimes ($\bar{\tau}_{\text{life}} \le 40\text{ ms}$).

### 2.3 Asymmetric Flash Pull Ratio
Measures the proportion of cancelled resting volume pulled precisely as market price approaches within $\delta$ ticks (default $\delta = 2.0$ ticks):
$$\Xi_{\text{flash}} = \frac{\sum V_{\text{cancelled when } |P - \text{Mid}| \le \delta}}{\sum V_{\text{cancelled, total}}}$$

When $\Xi_{\text{flash}} \to 1.0$, cancellations are triggered conditionally on imminent fill probability—the hallmark of non-bona fide liquidity.

### 2.4 Composite Phantom Hazard Index & Effective Depth
We define the bounded composite hazard index $S_{\text{phantom}} \in [0.0, 1.0]$:
$$S_{\text{phantom}} = \min\left(1.0, \; 0.40 \cdot \min\left(1.0, \frac{\text{CTR}}{150.0}\right) + 0.35 \cdot \Xi_{\text{flash}} + 0.25 \cdot \max\left(0.0, 1.0 - \frac{\bar{\tau}_{\text{life}}}{200.0}\right)\right)$$

The true vetted market depth available for smart order routing is:
$$D_{\text{effective}} = D_{\text{raw}} \cdot (1.0 - S_{\text{phantom}})$$

### 2.5 Execution Directive Ladder
- **$S_{\text{phantom}} \le 0.25$ (`ORGANIC_LIQUIDITY`)**:
  - Genuine deep liquidity; proceed with standard execution routing.
- **$0.25 < S_{\text{phantom}} \le 0.55$ (`MILD_PHANTOM_NOISE`)**:
  - Moderate algorithmic churn; discount depth and require strict limit fills.
- **$0.55 < S_{\text{phantom}} \le 0.80$ (`ELEVATED_SPOOFING_ALERT`)**:
  - Suspected layering; veto aggressive market orders into the suspect book side.
- **$S_{\text{phantom}} > 0.80$ (`CRITICAL_PHANTOM_LIQUIDITY_TRAP`)**:
  - Severe spoofing attack in progress; discount depth by $>80\%$ and deploy counter-spoofing fade strategies (`VETO_DEPTH_FADE_ARTIFICIAL_WALL`).

---

## 3. Production Architecture & Verification

Implemented in `python-bridge/services/l2_cancellation_spoofing_sieve.py` and validated by 5/5 unit tests in `python-bridge/tests/test_l2_cancellation_spoofing_sieve.py`:
1. `test_organic_market_making_stream`: Verifies benign flow ($\text{CTR} \le 1.0, \bar{\tau}_{\text{life}} > 1000\text{ ms}, S \le 0.25$) resulting in `PROCEED_STANDARD_ROUTING`.
2. `test_predatory_spoofing_flash_cancellation`: Confirms detection of $50,000$ share phantom wall cancelled in $35\text{ ms}$ at $1\text{ tick}$ from mid, triggering $S \ge 0.85$ and `CRITICAL_PHANTOM_LIQUIDITY_TRAP`.
3. `test_mild_phantom_noise`: Verifies intermediate regime classification ($0.25 < S \le 0.80$).
4. `test_side_filtering_bid_vs_ask`: Verifies strict isolation between Bid and Ask streams, preventing spoofing on one side from contaminating the other.
5. `test_sqlite_persistence`: Validates automated logging to `l2_spoofing_telemetry`.

---

## 4. Telemetry Schema & Persistence

All evaluated windows are committed to SQLite table `l2_spoofing_telemetry`:
```sql
CREATE TABLE IF NOT EXISTS l2_spoofing_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    raw_depth REAL NOT NULL,
    effective_depth REAL NOT NULL,
    ctr REAL NOT NULL,
    avg_lifetime_ms REAL NOT NULL,
    flash_ratio REAL NOT NULL,
    phantom_hazard REAL NOT NULL,
    regime TEXT NOT NULL,
    directive TEXT NOT NULL
);
```

---

## 5. Quantitative Invariants & Regulatory Safeguards

1. **SEBI Order-to-Trade Ratio (OTR) Compliance**: Regulatory frameworks penalize accounts with excessive OTR ($>50$). The engine monitors exchange-wide CTR to anticipate regulatory quote throttle events.
2. **Deterministic Effective Depth Floor**: Effective depth can never drop below zero nor exceed raw depth: $0 \le D_{\text{effective}} \le D_{\text{raw}}$.
3. **Sovereign Swarm Ready**: Verified and synchronized across local workspaces and Oracle Cloud VPS.
