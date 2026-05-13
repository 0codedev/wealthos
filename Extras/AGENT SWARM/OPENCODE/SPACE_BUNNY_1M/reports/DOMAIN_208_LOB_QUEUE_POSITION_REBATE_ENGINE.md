# Sovereign Swarm Architecture Blueprint: Domain 208 (WP-DF)
# Limit Order Book Queue Position Estimation & Rebate Capture Engine

**Fabric Layer**: `python-bridge/services/lob_queue_position_rebate_engine.py`  
**Test Suite**: `python-bridge/tests/test_lob_queue_position_rebate_engine.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: FIFO Priority Queue Tracking, Cont-de Larrard (2013) Markovian Queue Depletion, Maker-Taker Net Edge Optimization, Dynamic Queue Jumping & Re-Pegging Sentry.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

In equity and derivatives electronic communication networks (ECNs) operating under strict price-time priority (FIFO), market makers earn exchange liquidity rebates $R_{\text{maker}}$ alongside the bid-ask half-spread $\frac{1}{2}S$. However, passive limit orders suffer from adverse selection: orders are filled disproportionately when informed toxic flow sweeps the level, leading to instantaneous post-trade losses.

To harvest exchange rebates profitably, a high-frequency market-making agent must:
1. Accurately track its position in the queue $Q_{\text{ahead}}(t)$.
2. Estimate the conditional time-to-fill $\mathbb{E}[\tau_{\text{fill}}]$ and fill probability $P(\text{fill} \le \tau)$.
3. Dynamically balance maker rebate capture against adverse selection risk.
4. Detect trapped back-of-queue states and actively cancel/re-peg inside the spread.

### 1.1 Priority Queue Position & Depletion Dynamics

Let $Q_{\text{ahead}}(t)$ be the volume resting ahead of our order at price level $P$, and $Q_{\text{total}}(t)$ be the aggregate volume at that level.

1. **Trade Execution Drain**: Incoming aggressive market orders consume resting depth strictly from the front of the queue:
   $$Q_{\text{ahead}}(t) = \max\left(0, Q_{\text{ahead}}(t^-) - V_{\text{trade}}\right)$$

2. **Cancellations**: Assuming cancellations occur uniformly across the queue without priority bias:
   $$\Delta Q_{\text{ahead}}^{\text{cancel}} = V_{\text{cancel}} \cdot \frac{Q_{\text{ahead}}(t^-)}{Q_{\text{total}}(t^-)}$$
   $$Q_{\text{ahead}}(t) = \max\left(0, Q_{\text{ahead}}(t^-) - \Delta Q_{\text{ahead}}^{\text{cancel}}\right)$$

3. **New Order Additions**: New limit orders join strictly at the tail:
   $$Q_{\text{behind}}(t) = Q_{\text{behind}}(t^-) + V_{\text{add}}$$

### 1.2 Fill Probability & Expected Horizon (Cont-de Larrard 2013)

Under Poisson arrival of aggressive market flow at rate $\mu_{\text{drain}}$ (shares/sec), the effective depth to clear before our order executes is $Q_{\text{eff}} = Q_{\text{ahead}} + \frac{1}{2} q_{\text{own}}$.

The expected fill time is:
$$\mathbb{E}[\tau_{\text{fill}}] = \frac{Q_{\text{eff}}}{\mu_{\text{drain}}}$$

The conditional fill probability within horizon $\tau$ is:
$$P(\text{fill} \le \tau) = 1 - \exp\left(-\frac{\mu_{\text{drain}} \cdot \tau}{Q_{\text{eff}}}\right)$$

### 1.3 Net Expected Maker Edge

$$\mathbb{E}[\Pi] = P(\text{fill} \le \tau) \cdot \left[ \frac{1}{2}S_{\text{bps}} + R_{\text{maker}} - \text{AdvSelect}_{\text{bps}} \right] - (1 - P(\text{fill} \le \tau)) \cdot \text{OppCost}_{\text{bps}}$$

Where adverse selection discount is modulated by rear queue support:
$$\text{AdvSelect}_{\text{bps}} = S_{\text{bps}} \cdot \left( \frac{0.60}{1 + \exp\left(2 \cdot \frac{Q_{\text{behind}}}{Q_{\text{ahead}} + q_{\text{own}}}\right)} \right)$$

---

## 2. Queue Health Classification & Tactical Directives

1. **`FRONT_OF_QUEUE`** ($Q_{\text{ahead}} \le 0.20 Q_{\text{total}}$):
   - Prime queue priority. High fill probability ($P_{5s} > 80\%$).
   - Action: `HOLD_AND_HARVEST_REBATE`. Maintain quote to earn half-spread + exchange rebate.
2. **`MID_QUEUE`** ($0.20 < Q_{\text{ahead}} / Q_{\text{total}} \le 0.65$):
   - Steady state progression.
   - Action: `HOLD_AND_HARVEST_REBATE` with passive fill expectation.
3. **`BACK_OF_QUEUE_TRAPPED`** ($Q_{\text{ahead}} > 0.65 Q_{\text{total}}$):
   - Order stuck behind deep queue. If $P_{5s} < 0.20$, opportunity cost dominates.
   - Action: `REPOSITION_INSIDE_SPREAD`. Cancel quote and re-post at narrower increment to jump queue.
4. **`CANCEL_STALE_QUOTE`**:
   - Severe adverse selection detected (thin book support, impending trade-through sweep). Cancel immediately to evade toxic fill.

---

## 3. Verification & Validation Metrics

- Unit tests (`tests/test_lob_queue_position_rebate_engine.py`):
  - Deterministic FIFO drain correctly updates volume ahead.
  - Uniform cancellation split reduces queue ahead proportionally.
  - Prime queue position verifies high fill probability ($P_{5s} > 0.80$) and rebate capture directive.
  - Trapped queue orders at low fill probabilities reliably trigger `REPOSITION_INSIDE_SPREAD`.
