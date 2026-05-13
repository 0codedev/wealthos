# Sovereign Swarm Architecture Blueprint: Domain 219 (WP-DQ)
# Multi-Asset Synthetic Arbitrage & Bellman-Ford Negative Cycle Sieve

**Fabric Layer**: `python-bridge/services/bellman_ford_synthetic_cycle_sieve.py`  
**Test Suite**: `python-bridge/tests/test_bellman_ford_synthetic_cycle_sieve.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: Directed Currency/Asset Log-Transformation Graph, $\mathcal{O}(|V| \cdot |E|)$ Bellman-Ford Negative Cycle Detection, Cross-Asset Bottleneck Capacity Extraction $Q_{\text{cycle}}^* = \min_i(D_i)$, Sub-Economic Taker Friction Governor.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

In global foreign exchange, crypto order books, and multi-venue commodity pairs, triangular and polygonal cross-rate relationships $(A \to B \to C \to A)$ must strictly satisfy circular parity to prevent cost-free money pumps. However, dispersed liquidity pools, localized flow imbalances, and sub-millisecond price updates frequently decouple synthetic cross-rates from direct pairs.

Discovering these cycles across an arbitrary network of $N$ assets in sub-millisecond time requires logarithmic graph transformation:
$$\prod_{i=0}^{k-1} R(v_i \to v_{i+1}) \cdot (1 - \text{Fee}_i) > 1.0$$
Taking the negative natural logarithm converts product maximization into finding a cycle with strictly negative total weight:
$$\sum_{i=0}^{k-1} -\ln\left( R(v_i \to v_{i+1}) \cdot (1 - \text{Fee}_i) \right) < 0$$

### 1.1 Logarithmic Edge Weight Construction

For each directed trade edge $(u \to v)$ with exchange rate $R(u \to v)$ and statutory taker fee $\text{Fee}_{\text{bps}}$:
$$w(u, v) = -\ln\left( R(u \to v) \cdot \left(1 - \frac{\text{Fee}_{\text{bps}}}{10000}\right) \right)$$

### 1.2 Bellman-Ford Dynamic Programming Kernel

1. Initialize distance array $d(v) = 0$ for all $v \in V$.
2. Relax all edges $(u, v) \in E$ for $|V| - 1$ iterations:
   $$\text{If } d(u) + w(u, v) < d(v) \implies d(v) = d(u) + w(u, v), \quad \text{pred}(v) = u$$
3. Perform the $|V|$-th iteration: if any edge can still be relaxed ($d(u) + w(u, v) < d(v)$), a negative weight cycle exists.
4. Trace predecessors to extract the exact cyclical vertex path $\mathcal{C} = (v_0, v_1, \dots, v_k = v_0)$.

### 1.3 Bottleneck Liquidity Capacity & Net Margin

The executable size of the loop is strictly bounded by the thinnest order book depth along the cycle:
$$Q_{\text{cycle}}^* = \min_{e \in \mathcal{C}} \text{Depth}(e)$$

Net arbitrage edge in basis points:
$$\text{NetEdge}_{\text{bps}} = \left( \prod_{e \in \mathcal{C}} R_e (1 - \text{Fee}_e) - 1.0 \right) \times 10000$$

---

## 2. Arbitrage Regimes & Tactical Directives

1. **`ARBITRAGE_FREE_EQUILIBRIUM`**:
   - All cycle products after fees are $\le 1.0$.
   - Action: `STANDBY_MONITOR`. Market is in statistical parity.
2. **`EXECUTABLE_NEGATIVE_CYCLE`** ($\text{NetEdge} \ge 2.50\text{ bps}$):
   - Legitimate circular mispricing exists after all taker exchange fees.
   - Action: `EXECUTE_ATOMIC_LOOP`. Dispatch simultaneous IOC (Immediate-Or-Cancel) child orders across all cycle legs sized to the bottleneck capacity $Q^*$.
3. **`SUB_ECONOMIC_FRICTION_CYCLE`** ($\text{NetEdge} < 2.50\text{ bps}$):
   - A gross cycle exists, but exchange fees and slippage render expected net margin insufficient.
   - Action: `REJECT_INSUFFICIENT_MARGIN`. Reject execution to prevent negative realized returns.

---

## 3. Verification & Validation Metrics

- Unit tests (`tests/test_bellman_ford_synthetic_cycle_sieve.py`):
  - Equilibrium triangular graph correctly verifies `ARBITRAGE_FREE_EQUILIBRIUM`.
  - Dislocated GBP/USD cross (+36 bps gross) generates +34.5 bps net edge, correctly triggers `EXECUTABLE_NEGATIVE_CYCLE`, and identifies bottleneck depth ($2,500$ units).
  - High-fee cycle with microscopic gross edge is safely rejected under `SUB_ECONOMIC_FRICTION_CYCLE`.
