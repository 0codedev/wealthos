# Sovereign Swarm Architecture Blueprint: Domain 198 (WP-CV)
# High-Frequency Limit Order Book Hidden Liquidity Dark Pool Sieve

**Fabric Layer**: `python-bridge/services/hidden_liquidity_dark_pool_sieve.py`  
**Test Suite**: `python-bridge/tests/test_hidden_liquidity_dark_pool_sieve.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: Native Iceberg Replenishment Reconstruction, Kratz-Schöneborn (2014) Optimal Dark-Lit Routing Split, Logistic Crossing Probability Hazard.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

In equity and index derivative microstructure, institutional market participants rarely expose their true execution size on transparent lit order books. Non-display orders (icebergs, native discretionary reserves, broker-dealer crossing networks, and dark pool midpoint pegs) conceal the bulk of resting liquidity. Algorithmic traders who treat the visible Level 2 book as complete suffer from:
1. **False Breakout Traps**: Pushing price into a massive hidden iceberg order that absorbs entire aggressive sweeps without price concession.
2. **Suboptimal Routing Slippage**: Dumping orders into lit venues when dark midpoint matching would have captured half-spread rebates with zero market impact.
3. **Adverse Selection in Dark Pings**: Pinging dark venues with excessive latency, leaking trade intention before falling back to lit venues at dislocated prices.

### 1.1 Hidden Volume Reconstruction Kernel
Let $Q_{\text{vis}}(t)$ represent the visible quoted quantity at quote price $p$. When aggressive trade prints $\{v_k\}_{k=1}^m$ hit price $p$ without exhausting the queue or creating a price tick through:
- Total executed volume: $V_{\text{exec}} = \sum_{k=1}^m v_k$
- Visible queue depletion expected: $\Delta Q_{\text{vis}} = \max(0, Q_{\text{vis}}(t_0) - Q_{\text{vis}}(t_m))$
- Inferred hidden liquidity replenished or absorbed:
$$\hat{Q}_{\text{hidden}} = \max(0, V_{\text{exec}} - \Delta Q_{\text{vis}})$$
The **Hidden-to-Visible Ratio** determines the institutional structural cushion:
$$\mathcal{R}_{\text{hidden}} = \frac{\hat{Q}_{\text{hidden}}}{\max(Q_{\text{vis}}(t_0), 1.0)}$$
- $\mathcal{R}_{\text{hidden}} < 0.25$: Pure transparent retail depth.
- $0.25 \le \mathcal{R}_{\text{hidden}} < 1.50$: Moderate hidden replenishment.
- $1.50 \le \mathcal{R}_{\text{hidden}} < 4.00$: Heavy iceberg accumulation.
- $\mathcal{R}_{\text{hidden}} \ge 4.00$: **Institutional Wall** (massive non-display block cushion).

---

## 2. Dark Pool Execution Fill Hazard & Optimal Split

### 2.1 Logistic Fill Probability Model
Orders submitted to dark pools or crossing networks execute passively against contra flow. The fill probability $\mathcal{P}_{\text{fill}}^{\text{dark}}$ decays non-linearly with order size $q$ relative to market average depth $D$, and accelerates with favorable order flow imbalance ($\text{OFI}$):
$$\mathcal{P}_{\text{fill}}^{\text{dark}}(q, \text{OFI}) = \frac{1}{1 + \exp\left( \alpha_0 + \alpha_1 \frac{q}{D} - \alpha_2 \text{OFI} \right)}$$

### 2.2 Kratz-Schöneborn (2014) Optimal Dark-Lit Routing Schedule
Given total tranche $Q$, the execution scheduler partitions the order into dark allocation $q_{\text{dark}}$ and lit allocation $q_{\text{lit}} = Q - q_{\text{dark}}$.
The objective function minimizes total expected basis-point shortfall:
$$\min_{q_{\text{dark}} \in [0, Q]} \left\{ \frac{q_{\text{lit}}}{Q} \left[ S_{\text{lit}} + I_{\text{lit}}(q_{\text{lit}}) \right] + \mathcal{P}_{\text{fill}}^{\text{dark}} \frac{q_{\text{dark}}}{Q} C_{\text{dark}} + (1 - \mathcal{P}_{\text{fill}}^{\text{dark}}) \frac{q_{\text{dark}}}{Q} \left[ I_{\text{lit}}(Q) + \Delta_{\text{delay}} + S_{\text{lit}} \right] \right\}$$
where:
- $I_{\text{lit}}(q) = 10000 \times 0.5 \sigma \sqrt{q / \text{ADV}}$ is the square-root market impact on the lit book.
- $C_{\text{dark}}$ is the dark crossing fee/rebate (typically $< 0.5$ bps).
- $\Delta_{\text{delay}}$ is the adverse selection penalty suffered when unfilled dark orders are routed to lit after latency delay.

---

## 3. Institutional Execution & Cushion Aggregation Directives

1. **Institutional Accumulation / Distribution Cushion Sentry**:
   - Multi-level L2 aggregation compares $\sum \hat{Q}_{\text{hidden}}^{\text{bid}}$ vs $\sum \hat{Q}_{\text{hidden}}^{\text{ask}}$.
   - When bid cushion exceeds ask cushion by $> 1.5\times$, algorithmic buy orders are prioritized and short breakout attempts are aborted.
2. **Venue Sequence Routing Directives**:
   - For orders where $q_{\text{dark}}^* > 0.10 Q$, enforce 3-stage sequence:
     1. `PING_DARK_MIDPOINT`: Immediate-or-cancel ping at midpoint.
     2. `FALLBACK_LIT_IOC`: Immediate fill on top lit level.
     3. `RESTING_PASSIVE_LIT`: Post remainder inside spread.
3. **Pre-Trade Leakage Prevention**:
   - Ping sizes randomized around optimal $q_{\text{dark}}^*$ to defeat reverse-engineering by predatory high-frequency snipers.

---

## 4. Verification & Validation Metrics

- Unit tests (`tests/test_hidden_liquidity_dark_pool_sieve.py`):
  - Verification of exact hidden volume inference on bid/ask sweeps.
  - Verification of monotonic decay of dark fill probability with order size.
  - Optimal routing split verification: $q_{\text{dark}}^* + q_{\text{lit}}^* \equiv Q$.
  - 100% test coverage with 0 warnings.
