# DOMAIN 183: ORDER BOOK ICEBERG DETECTION & HIDDEN RESERVE RECONSTRUCTION SIEVE (WP-CG)

**Executive Swarm Intelligence Technical Report**  
**Autonomous Agent:** `Space-Bunny / OpenCode Sovereign Swarm (Variant Max, Mega-Context 1M)`  
**Domain Vertical:** WP-CG / Domain 183: Order Book Iceberg Detection & Hidden Reserve Reconstruction Sieve  
**Timestamp:** 2026-10-18T06:44:00+05:30  
**Status:** 🟢 **PRODUCTION READY / FULLY TESTED**  

---

## 1. Executive Summary & Quantitative Mandate

Institutional execution algorithms (e.g., TWAP, VWAP, POV) and proprietary market-making desks rarely submit full order size into the visible limit order book (LOB). Submitting large orders reveals institutional intent, triggering immediate adverse front-running from competing HFT algorithms. Instead, institutional desks submit **iceberg orders**—orders where only a minor display tranche ($Q_{\text{display}}$, typically $5\text{--}10\%$ of parent size) is publicly broadcast on Level-2 depth, while the massive residual ($Q_{\text{hidden}}$) rests secretly in the matching engine's memory.

When incoming market sweeps exhaust the visible tranche, the matching engine instantly and automatically injects a replenishment slice at the identical price level, repeatedly absorbing aggressive order flow. Trading algorithms that examine only static Level-2 depth misinterpret this as shallow liquidity, attempting breakouts directly into an immovable institutional iceberg wall.

Domain 183 delivers an institutional-grade **Order Book Iceberg Detection & Hidden Reserve Reconstruction Sieve**:
1. Monitors sub-millisecond Level-2 quote state transitions and incoming trade executions to detect **unannounced queue replenishments** ($R(t) > 0$).
2. Reconstructs cumulative executed hidden volume ($V_{\text{hidden}} = \sum R_k$) and forecasts total parent order capacity.
3. Analyzes tranche size distributions via the **Coefficient of Variation** ($CV_R$), distinguishing deterministic native exchange icebergs ($CV_R \le 0.20$) from randomized algorithmic synthetic slices.
4. Generates high-conviction order flow directives: exploiting passive institutional defense (`BULLISH_ICEBERG_SUPPORT_ACCUMULATION` / `BEARISH_ICEBERG_RESISTANCE_DISTRIBUTION`) or timing explosive momentum upon reserve exhaustion (`ICEBERG_DEPLETION_BREAKOUT_DRIVE`).

---

## 2. Mathematical Specifications & Microstructure Mechanics

### 2.1 Unannounced Replenishment Identification
Let $Q_{\text{vis}}(t^-)$ denote the visible resting quantity at price $P$ immediately prior to trade execution.
Let $V_{\text{trade}}$ denote the matched trade volume at price $P$.
The expected remaining visible depth after the trade under standard transparent queue mechanics is:
$$\hat{Q}_{\text{rem}} = \max(0.0, \, Q_{\text{vis}}(t^-) - V_{\text{trade}})$$

Immediately post-trade at $t^+ = t^- + \Delta \tau$ (where $\Delta \tau \le 15\text{ ms}$), the actual visible depth is $Q_{\text{vis}}(t^+)$.
The unannounced replenishment quantity $R(t)$ is:
$$R(t) = Q_{\text{vis}}(t^+) - \hat{Q}_{\text{rem}}$$

If $R(t) > 0$, an unannounced replenishment has occurred.

### 2.2 Hidden Reserve Reconstruction
For price level $P$ experiencing a sequence of $K$ successive replenishments $\{R_1, R_2, \dots, R_K\}$:
$$V_{\text{hidden}}(P) = \sum_{k=1}^K R_k$$

The estimated total parent order volume is:
$$\hat{Q}_{\text{parent}}(P) = V_{\text{hidden}}(P) + Q_{\text{vis}}(t^+) + \hat{q}_{\text{display}} \cdot \hat{N}_{\text{rem}}$$

Where $\hat{q}_{\text{display}} = \frac{1}{K}\sum R_k$ is the empirical mean tranche size.

### 2.3 Tranche Uniformity & Algorithmic Classification
To classify the order origin:
$$\mu_R = \frac{1}{K} \sum_{k=1}^K R_k, \quad \sigma_R = \sqrt{\frac{1}{K-1} \sum_{k=1}^K (R_k - \mu_R)^2}$$
$$CV_R = \frac{\sigma_R}{\mu_R}$$

- **$CV_R \le 0.20$**: **Native Exchange Iceberg**. The exchange matching engine automatically replenishes identical fixed tranches (e.g. exactly 1,000 shares).
- **$0.20 < CV_R \le 0.40$**: **Algorithmic Synthetic Iceberg**. A broker smart execution algorithm injects randomized child slices (e.g. Gaussian or uniform jitter $\pm 20\%$) to evade simple detection.
- **$CV_R > 0.60$**: Discretionary retail replenishment / transient flow.

### 2.4 Execution Directives
- **`BULLISH_ICEBERG_SUPPORT_ACCUMULATION`**:
  - $K \ge 3$ replenishments on **BID** side. An institutional buyer is aggressively absorbing market sells. Join the bid queue or buy on first uptick.
- **`BEARISH_ICEBERG_RESISTANCE_DISTRIBUTION`**:
  - $K \ge 3$ replenishments on **ASK** side. An institutional seller is capping rallies. Do not buy into the ceiling; short with stop 1 tick above iceberg price.
- **`ICEBERG_DEPLETION_BREAKOUT_DRIVE`**:
  - Iceberg replenishment count reaches statistical exhaustion and quote fails to replenish after a trade. Enter breakout drive in the direction of the trade sweep.
- **`NORMAL_TRANSPARENT_BOOK`**:
  - Normal transparent book dynamics ($K < 3$).

---

## 3. Production Architecture & Verification

Implemented in `python-bridge/services/iceberg_detection_reconstruction_sieve.py` and validated by 5/5 unit tests in `python-bridge/tests/test_iceberg_detection_reconstruction_sieve.py`:
1. `test_detect_replenishments_clean_sweep`: Confirms exact replenishment detection ($500\text{ visible} - 500\text{ traded} \to 500\text{ replenished} = 500$).
2. `test_native_deterministic_buy_iceberg`: Confirms detection of 4 identical 1,000-share tranches ($CV = 0.0$), validating `BULLISH_ICEBERG_SUPPORT_ACCUMULATION` and $4,000$ shares hidden volume.
3. `test_randomized_synthetic_sell_iceberg`: Confirms detection of randomized sell tranches on Ask, triggering `BEARISH_ICEBERG_RESISTANCE_DISTRIBUTION`.
4. `test_normal_book_sub_threshold`: Confirms sub-threshold ($K=2 < 3$) transparency classification without false alarms.
5. `test_sqlite_persistence`: Validates automated logging to `iceberg_detection_telemetry`.

---

## 4. Telemetry Schema & Persistence

All evaluated icebergs are committed to SQLite table `iceberg_detection_telemetry`:
```sql
CREATE TABLE IF NOT EXISTS iceberg_detection_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    price_level REAL NOT NULL,
    replenish_count INTEGER NOT NULL,
    mean_tranche REAL NOT NULL,
    tranche_cv REAL NOT NULL,
    hidden_vol REAL NOT NULL,
    estimated_parent REAL NOT NULL,
    directive TEXT NOT NULL,
    rationale TEXT NOT NULL
);
```

---

## 5. Quantitative Invariants & Operational Takeaways

1. **Queue Priority Demotion Invariant**: On major electronic exchanges (NSE/CME), each newly replenished tranche loses queue time priority, dropping to the end of the line at price $P$. Algorithms leverage this by placing limit orders ahead of the newly replenished slice.
2. **Hidden Wall Defense**: Never short into an active buy iceberg nor buy into an active sell iceberg until complete exhaustion is confirmed.
3. **Sovereign Swarm Ready**: Verified and synchronized across local repositories and Oracle Cloud VPS.
