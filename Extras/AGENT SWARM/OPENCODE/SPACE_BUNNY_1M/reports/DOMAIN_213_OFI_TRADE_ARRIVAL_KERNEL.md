# Sovereign Swarm Architecture Blueprint: Domain 213 (WP-DK)
# Real-Time High-Frequency Order Flow Imbalance (OFI) & Trade Arrival Kernel

**Fabric Layer**: `python-bridge/services/ofi_trade_arrival_kernel.py`  
**Test Suite**: `python-bridge/tests/test_ofi_trade_arrival_kernel.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: Multi-Tier Cont-Kukanov-Stoikov (2014) Order Flow Imbalance, Linear Micro-Price Impact Drift Kernel, OFI-Modulated Non-Homogeneous Poisson Arrival Intensity.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

Traditional Level-2 Order Book Imbalance (OBI) measures only static resting size ($I = \frac{Q_b - Q_a}{Q_b + Q_a}$). In contrast, Cont, Kukanov, and Stoikov (2014) demonstrated that price changes are driven dynamically by the net flow of order submissions, cancellations, and aggressive fills across price levels—defined as **Order Flow Imbalance (OFI)**.

By tracking the exact changes in bid/ask prices and sizes across consecutive Level-3 book updates $t_{n-1} \to t_n$, OFI exhibits near-instantaneous linear predictive power over future price drift $\Delta P_{n+1}$.

### 1.1 Single-Level Order Flow Imbalance Formulation

At the best bid $P_n^{(b)}$ and best ask $P_n^{(a)}$:
$$\Delta Q_n^{(b)} = \begin{cases}
   Q_n^{(b)} & \text{if } P_n^{(b)} > P_{n-1}^{(b)} \quad (\text{Bid stepped higher}) \\
   Q_n^{(b)} - Q_{n-1}^{(b)} & \text{if } P_n^{(b)} = P_{n-1}^{(b)} \quad (\text{Size change at touch}) \\
   -Q_{n-1}^{(b)} & \text{if } P_n^{(b)} < P_{n-1}^{(b)} \quad (\text{Bid stepped lower})
\end{cases}$$

$$\Delta Q_n^{(a)} = \begin{cases}
   -Q_n^{(a)} & \text{if } P_n^{(a)} > P_{n-1}^{(a)} \quad (\text{Ask stepped higher}) \\
   Q_n^{(a)} - Q_{n-1}^{(a)} & \text{if } P_n^{(a)} = P_{n-1}^{(a)} \quad (\text{Size change at touch}) \\
   Q_{n-1}^{(a)} & \text{if } P_n^{(a)} < P_{n-1}^{(a)} \quad (\text{Ask stepped lower})
\end{cases}$$

Level-1 OFI:
$$OFI_n^{(1)} = \Delta Q_n^{(b)} - \Delta Q_n^{(a)}$$

### 1.2 Multi-Tier Distance-Decayed OFI Tensor

Aggregating across the top $M$ price tiers with exponential distance decay factor $\gamma$:
$$OFI_n^{\text{multi}} = \sum_{m=1}^M \exp(-\gamma (m - 1)) \cdot OFI_n^{(m)}$$

Normalized OFI Ratio:
$$\mathcal{I}_{\text{OFI}} = \frac{OFI_n^{\text{multi}}}{\sum_{m=1}^M \exp(-\gamma(m-1)) \left( Q_n^{(m, b)} + Q_n^{(m, a)} \right)} \in [-1.0, +1.0]$$

### 1.3 Micro-Price Drift & Non-Homogeneous Poisson Arrival

1. **Predicted Drift**:
   $$\Delta P_{\text{bps}} = \beta_{\text{OFI}} \cdot \left(\frac{OFI_n^{\text{multi}}}{100}\right)$$
2. **Modulated Arrival Intensity**:
   $$\lambda_{\text{buy}}(t) = \lambda_0 \exp(\kappa \cdot \mathcal{I}_{\text{OFI}})$$
   $$\lambda_{\text{sell}}(t) = \lambda_0 \exp(-\kappa \cdot \mathcal{I}_{\text{OFI}})$$

---

## 2. Alpha Regimes & Tactical Directives

1. **`NEUTRAL_EQUILIBRIUM`** ($|\mathcal{I}_{\text{OFI}}| \le 0.15$):
   - Order flow updates are balanced between buying and selling.
   - Action: `MAINTAIN_PASSIVE_SPREAD`. Maintain two-sided symmetric quotes.
2. **`BULLISH_FLOW_ACCUMULATION`** ($0.15 < \mathcal{I}_{\text{OFI}} < 0.60$):
   - Strong net bid addition or ask cancellation; positive micro-price drift expected.
   - Action: `POST_AGGRESSIVE_BID_JOIN`. Join touch aggressively to capture upside drift.
3. **`BEARISH_FLOW_DISTRIBUTION`** ($-0.60 < \mathcal{I}_{\text{OFI}} < -0.15$):
   - Strong net ask addition or bid cancellation; negative micro-price drift expected.
   - Action: `POST_AGGRESSIVE_ASK_JOIN`. Join ask touch to sell ahead of downward slide.
4. **`TSUNAMI_IMBALANCE_SPIKE`** ($|\mathcal{I}_{\text{OFI}}| \ge 0.60$):
   - Catastrophic one-sided order flow surge; price step imminent.
   - Action: `MARKET_ORDER_SURGE_FOLLOW`. Fire aggressive market order to sweep depth before boundary transition.

---

## 3. Verification & Validation Metrics

- Unit tests (`tests/test_ofi_trade_arrival_kernel.py`):
  - Neutral book updates produce zero OFI and baseline Poisson arrival rates.
  - Bid size increases and ask cancellations yield positive OFI ($+700$ shares) and positive drift ($> 0.50$ bps).
  - Bid cancellations and ask additions yield negative OFI ($-800$ shares) and `BEARISH_FLOW_DISTRIBUTION`.
  - Aggressive quote price steps trigger `TSUNAMI_IMBALANCE_SPIKE` and `MARKET_ORDER_SURGE_FOLLOW`.
