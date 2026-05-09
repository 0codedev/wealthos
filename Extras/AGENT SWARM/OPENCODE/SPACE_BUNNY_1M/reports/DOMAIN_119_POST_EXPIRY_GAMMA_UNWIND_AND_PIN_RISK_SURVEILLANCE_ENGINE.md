# Domain 119: Post-Expiry Gamma Unwind & Pin-Risk Surveillance Engine (WP-U)

**Executive Status**: 🟢 PRODUCTION DELIVERED & MATHEMATICALLY VERIFIED  
**Engine Service**: `python-bridge/services/post_expiry_gamma_unwinder.py`  
**Unit Tests**: `python-bridge/tests/test_post_expiry_gamma_unwinder.py` (8/8 Tests Passing in 0.03s)  
**Target Architecture**: WealthOS v2 High-Frequency Options Risk Daemon  
**Benchmark Model**: `opencode/nemotron-3.5-lightning-free` / `space-bunny-free` (`--variant max --thinking --auto`)

---

## 1. Executive Summary & Market Context

The Indian Derivatives Market exhibits intense structural anomalies during the final 45 minutes (14:45 – 15:30 IST) of weekly and monthly expiry days (e.g., NIFTY Thursdays, BANKNIFTY Wednesdays, SENSEX Fridays, and EOM Stock F&O). 

As time-to-expiry $T \to 0$, two existential market hazards emerge:
1. **Black-Scholes Gamma Singularity**: At-the-money (ATM) gamma explodes ($\Gamma \sim \frac{1}{\sqrt{T}} \to \infty$). Delta transitions discontinuously between 0.0 and 1.0 on microscopic underlying spot vibrations, creating violent intraday dealer hedging cascades.
2. **SEBI Physical Delivery Margin Traps**: Under Indian equity derivatives rules, stock options ending in-the-money (ITM) or near-the-money (within $\pm 1.0\%$) trigger compulsory physical delivery of underlying shares. A trader shorting an in-the-money call on `RELIANCE` or `TCS` without 100% stock backing or equivalent cash (typically ₹8L–₹25L per lot) is hit with severe margin deficits, broker penal interest, and mandatory auction debits.

The **Post-Expiry Gamma Unwind & Pin-Risk Surveillance Engine** provides institutional-grade risk governance, mathematical pin-risk indexing, dynamic dealer gamma cliff ($d\text{GEX}/dt$) alerting, and an automated 15:15 IST atomic position unwinder.

---

## 2. Mathematical Formulations & Risk Dynamics

### 2.1 Terminal Gamma Explosion & Delta Discontinuity

For standard European/Black-Scholes options, Gamma is defined as:
$$\Gamma = \frac{\partial^2 V}{\partial S^2} = \frac{\phi(d_1)}{S \sigma \sqrt{T}}$$
where $d_1 = \frac{\ln(S/K) + (r + \frac{1}{2}\sigma^2)T}{\sigma \sqrt{T}}$ and $\phi(x) = \frac{1}{\sqrt{2\pi}} e^{-\frac{x^2}{2}}$.

As $T \to 0$:
- If $S = K$ (At-The-Money), $d_1 \to 0$, so $\phi(d_1) \to \frac{1}{\sqrt{2\pi}} \approx 0.3989$. Therefore:
$$\lim_{T \to 0} \Gamma_{\text{ATM}} = \lim_{T \to 0} \frac{0.3989}{S \sigma \sqrt{T}} = +\infty$$
- If $|S - K| > \epsilon$ (Out-of-The-Money or In-The-Money), $d_1 \to \pm \infty$, meaning $\phi(d_1) \to 0$ exponentially faster than $\sqrt{T} \to 0$:
$$\lim_{T \to 0} \Gamma_{\text{OTM/ITM}} = 0$$

In code, numerical singularities are safeguarded with floor clamps:
$$T_{\text{effective}} = \max(T, 10^{-6})$$

### 2.2 Pinning Risk Index Formulation

Dealers and market makers who are net short Gamma are forced to dynamic hedge:
- When spot rises, they buy underlying futures/shares.
- When spot falls, they sell underlying futures/shares.

Conversely, when dealers are net long Gamma, they sell rallies and buy dips, dampening volatility and pinning the underlying spot to high open interest strikes ($K_{\text{pin}}$). The Pinning Risk Index $PR_i \in [0.0, 1.0]$ is formulated as:
$$PR_i(S, K_i, \sigma, T) = \min\left(1.0, \; \exp\left( - \frac{(S - K_i)^2}{2 (S \cdot \sigma \sqrt{T})^2} \right) \cdot \frac{OI_i}{\sum_j OI_j} \cdot 10.0 \right)$$

### 2.3 Dealer Gamma Cliff ($d\text{GEX}/dt$)

Net Dealer Gamma Exposure across all strikes $i$ in Crores (₹ 1 Cr = $10^7$ INR) is:
$$\text{GEX}_{\text{net}} = \sum_i (OI_{\text{call}, i} - OI_{\text{put}, i}) \cdot \Gamma_i \cdot S^2 \cdot 0.01 \cdot 10^{-7}$$

The dynamic Gamma Cliff Rate is measured per minute:
$$\text{CliffRate} = \frac{\text{GEX}_t - \text{GEX}_{t - \Delta t}}{\Delta t}$$

When $\text{CliffRate} \le -30.0\text{ Cr/min}$, the engine flags `CLIFF_COLLAPSE`, warning of an impending gamma squeeze or sudden liquidation cascade.

### 2.4 Physical Delivery Margin Escalation Guard

For Indian stock F&O contracts:
$$\text{RequiredDeliveryMargin} = S \cdot Q \quad \text{if } (|S - K| / K \le 0.015 \text{ or ITM})$$
$$\text{MarginDeficit} = \max(0, \; \text{RequiredDeliveryMargin} - \text{AvailableMargin})$$

If $\text{MarginDeficit} > 0$ and $t \ge 14:45\text{ IST}$:
$$\text{Status} \leftarrow \text{SEVERELY\_TRAPPED}$$
$$\text{Urgency} \leftarrow \text{EMERGENCY\_ATOMIC}$$

---

## 3. Production Architecture

```
[ NSE / BSE WebSocket Stream ]
             │
             ▼
[ PostExpiryGammaUnwinder Daemon ]
   ├─► Black-Scholes Terminal Gamma Calculator (T -> 0 singularity guard)
   ├─► Pinning Risk Index Engine (S, K_i, OI_i, T)
   ├─► Dealer GEX Cliff Tracker (dGEX/dt <= -30 Cr/min alert)
   ├─► SEBI Physical Delivery Margin Sieve (14:45 IST cutoff)
   └─► Auto-Flattening Governor (15:15:00 IST atomic square-off)
             │
             ├─► Emergency Atomic Liquidation Order -> OpenAlgo Gateway
             └─► SQLite Surveillance Audit Log (`expiry_surveillance_logs`)
```

---

## 4. Verification & Validation Summary

| Test Case | Objective | Verified Metric | Result |
| :--- | :--- | :--- | :---: |
| `test_gamma_singularity_and_decay` | Verify BS Gamma explosion for ATM and decay for OTM | $\Gamma_{5m} > \Gamma_{1h} > 0$, $\Gamma_{OTM} < 10^{-4}$ | 🟢 PASS |
| `test_pinning_risk_index` | Verify pinning probability bounds and distance sensitivity | $PR_{\text{ATM}} > 0.5$, $PR_{\text{OTM}} < 0.01$ | 🟢 PASS |
| `test_gamma_cliff_detection` | Detect rapid GEX drop and breach threshold | $\text{CliffRate} < -30\text{ Cr/min} \to \text{CLIFF\_COLLAPSE}$ | 🟢 PASS |
| `test_delivery_margin_assessment_index_safe` | Cash-settled index contracts bypass delivery traps | $\text{RequiredDeliveryMargin} = 0, \text{Status} = \text{SAFE}$ | 🟢 PASS |
| `test_delivery_margin_assessment_stock_itm_trapped` | Stock F&O ITM with margin deficit flags SEVERELY_TRAPPED | Margin Deficit ₹6.55L, Status = `SEVERELY_TRAPPED` | 🟢 PASS |
| `test_auto_flattening_schedule_pre_and_post_1515` | Pre-15:15 holds; post-15:15 initiates 100% square-off | 0 orders at 14:00; 1 High urgency order at 15:15:05 | 🟢 PASS |
| `test_emergency_atomic_flattening_margin_deficit` | Trapped position triggers immediate emergency atomic order | Urgency = `EMERGENCY_ATOMIC` | 🟢 PASS |
| `test_sqlite_surveillance_logging` | SQLite persistence of GEX, spot, and status | Row correctly written and verified | 🟢 PASS |

---

## 5. Deployment & Integration Directives

1. **Service Registration**: Import `PostExpiryGammaUnwinder` in `python-bridge/services/unified_quant_engine.py` or run as dedicated 14:00–15:30 IST cron daemon via PM2.
2. **OpenAlgo Wiring**: Hook `FlatteningInstruction` output directly to `OpenAlgoExecutionClient.place_order(order_type='MARKET', product='MIS')`.
3. **Audit Trail**: Real-time snapshots logged to `expiry_surveillance_logs` table for post-trade compliance.
