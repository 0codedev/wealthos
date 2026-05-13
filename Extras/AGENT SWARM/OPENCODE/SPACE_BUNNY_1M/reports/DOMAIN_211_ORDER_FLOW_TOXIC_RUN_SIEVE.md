# Sovereign Swarm Architecture Blueprint: Domain 211 (WP-DI)
# Cross-Asset Order Flow Toxic Run & Flash Liquidity Drain Sieve

**Fabric Layer**: `python-bridge/services/order_flow_toxic_run_sieve.py`  
**Test Suite**: `python-bridge/tests/test_order_flow_toxic_run_sieve.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: Sequential Trade Run Statistics, Kyle's Lambda Dynamic Price Impact, LOB Replenishment Ratio $\mathcal{R}_{\text{replenish}}$, Flash Liquidity Vacuum Air-Pocket Sentry.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

In high-frequency market making, passive quoting generates positive expected edge from the half-spread provided trade flow consists of random retail or uninformed noise. However, when an institutional algorithm unloads a massive meta-order or an informed trader acts on breaking news, executions manifest as consecutive unidirectional trade runs that rapidly sweep the order book.

Passive market makers who leave resting limit orders unchanged during toxic runs suffer immediate adverse selection:
1. **Geometric Run Length Probability**: Uninformed flow follows independent Bernoulli trials ($p = 0.5$). A run of length $k \ge 6$ has a $p$-value $< 0.03125$, rejecting the null hypothesis of balanced flow.
2. **Kyle's Lambda ($\lambda_{\text{Kyle}}$) Expansion**: When informed flow dominates, price impact per unit volume surges, causing severe slippage and rapid price drift.
3. **Replenishment Breakdown**: A healthy limit order book replenishes rapidly after trades ($\mathcal{R}_{\text{replenish}} \approx 1.0$). When replenishment drops below $0.30$, depth evaporates, creating an "air pocket" where subsequent trades cause flash crashes.

### 1.1 Sequential Trade Run Test

For an observed sequence of trade signs $s_i \in \{+1, -1\}$:
The current unbroken run length is $k$. Under $H_0$ (i.i.d. symmetric noise):
$$P(L \ge k) = \left(\frac{1}{2}\right)^{k - 1}$$
When $P(L \ge k) \le 0.03125$ ($k \ge 6$), the engine flags a **Directional Toxic Run**.

### 1.2 Instantaneous Kyle's Lambda Price Impact

$$\lambda_{\text{Kyle}}(t) = \frac{\sum_{i=1}^n |\Delta P_i|}{\sum_{i=1}^n \sqrt{V_i}} \times 10000 \quad (\text{bps impact per 1,000 shares})$$
The expansion ratio:
$$\mathcal{E}_{\lambda} = \frac{\lambda_{\text{Kyle}}(t)}{\lambda_{\text{baseline}}}$$
When $\mathcal{E}_{\lambda} > 2.2\times$, price elasticity is severely elevated.

### 1.3 Replenishment Ratio & Drain Velocity

$$\mathcal{R}_{\text{replenish}} = \frac{V_{\text{new quotes added}}}{V_{\text{aggressive sweeps}}}$$
$$\mathcal{V}_{\text{drain}} = \frac{V_{\text{consumed}}}{\Delta t} \quad (\text{shares/second})$$

---

## 2. Order Flow Regimes & Quoting Postures

1. **`BENIGN_BALANCED_FLOW`**:
   - Short runs ($k < 4$), normal Kyle's lambda ($\mathcal{E}_{\lambda} \le 1.8\times$), healthy replenishment ($\mathcal{R}_{\text{replenish}} \ge 0.30$).
   - Posture: `QUOTE_BID_AND_ASK`. Normal symmetric two-sided market making (multipliers $1.0\times / 1.0\times$).
2. **`DIRECTIONAL_TOXIC_RUN`**:
   - Statistically significant run ($k \ge 6$) or elevated impact ($\mathcal{E}_{\lambda} > 1.8\times$).
   - Posture: `SKEW_QUOTES_AWAY`. Widen the quote spread by $3.0\times$ on the adverse side (e.g. widen Ask during Buy run) to evade toxic fill.
3. **`FLASH_LIQUIDITY_VACUUM`**:
   - Severe depth drain with replenishment failure ($\mathcal{R}_{\text{replenish}} < 0.30$) and extreme price sensitivity ($\mathcal{E}_{\lambda} > 2.2\times$).
   - Posture: `PULL_ALL_RESTING_QUOTES`. Circuit trigger pulls all resting quotes immediately from both sides to avoid catastrophic air-pocket fills.

---

## 3. Verification & Validation Metrics

- Unit tests (`tests/test_order_flow_toxic_run_sieve.py`):
  - Balanced alternating trades yield run length 1, normal Kyle's lambda, and normal two-sided quoting.
  - 7 consecutive buys trigger $p < 0.02$, `DIRECTIONAL_TOXIC_RUN`, and 3.0x ask spread widening.
  - 7 consecutive sells trigger `DIRECTIONAL_TOXIC_RUN` and 3.0x bid spread widening.
  - Violent price jumps + replenishment failure ($\mathcal{R}_{\text{replenish}} < 0.10$) trigger `FLASH_LIQUIDITY_VACUUM` and emergency cancellation of all resting quotes.
