# Sovereign Swarm Architecture Blueprint: Domain 202 (WP-CZ)
# High-Frequency Limit Order Book Liquidity Imbalance & Microstructure Drift Engine

**Fabric Layer**: `python-bridge/services/lob_liquidity_imbalance_drift_engine.py`  
**Test Suite**: `python-bridge/tests/test_lob_liquidity_imbalance_drift_engine.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: Stoikov (2018) Micro-Price Martingale, Multi-Depth Exponential Decay Imbalance, Quote Elasticity Slope Asymmetry.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

In high-frequency limit order book (LOB) dynamics, the mid-price $P_{\text{mid}} = \frac{P_{\text{bid}} + P_{\text{ask}}}{2}$ is fundamentally non-martingale. Heavy asymmetric queues at the inside quotes create immediate deterministic price pressure. An algorithmic trader quoting symmetrically around $P_{\text{mid}}$ faces severe **adverse selection**:
1. When buy queues far exceed sell queues, the probability of an upward price step approaches 1.0; resting sell limit orders are guaranteed to be sniped at a loss.
2. Relying solely on top-of-book (Level 1) depth creates vulnerability to phantom quotes, spoofing, and shallow liquidity traps.
3. Microstructural drift decays exponentially across book tiers, requiring multi-depth weighting.

### 1.1 Multi-Level Depth Decay Weighted Imbalance
Given $K=5$ levels of bids and asks, each level $k$ is weighted by an exponential distance kernel $w_k = \exp(-\lambda_{\text{decay}} (k - 1))$:
$$I_{\text{multi}} = \frac{\sum_{k=1}^K w_k (Q_{\text{bid}}^k - Q_{\text{ask}}^k)}{\sum_{k=1}^K w_k (Q_{\text{bid}}^k + Q_{\text{ask}}^k)} \in [-1.0, +1.0]$$
This multi-tier formulation filters out single-tier spoofing and reflects true institutional resting depth.

### 1.2 Stoikov (2018) Micro-Price Martingale
The true unobserved martingale price $P^*(t) = \lim_{\tau \to \infty} \mathbb{E}[P_{\text{mid}}(t+\tau) \mid \mathcal{F}_t]$ is modeled by augmenting the mid-price with non-linear drift adjustment $g(I, S)$:
$$P^*(t) = P_{\text{mid}}(t) + \frac{S}{2} \cdot \tanh(\alpha_I \cdot I_{\text{multi}})$$
where $S = P_{\text{ask}} - P_{\text{bid}}$ is the inside spread, and $\alpha_I \approx 1.80$ calibrates the saturation rate of imbalance pressure.

---

## 2. Instantaneous Quote Slopes & Elasticity Asymmetry

The rate of price concession per unit of liquidity across depth tiers reveals book elasticity:
$$\text{Slope}_{\text{bid}} = \frac{\sum_{k=1}^K (P_{\text{bid}}^1 - P_{\text{bid}}^k)}{\sum_{k=1}^K Q_{\text{bid}}^k}, \quad \text{Slope}_{\text{ask}} = \frac{\sum_{k=1}^K (P_{\text{ask}}^k - P_{\text{ask}}^1)}{\sum_{k=1}^K Q_{\text{ask}}^k}$$
$$\mathcal{S}_{\text{asym}} = \frac{\text{Slope}_{\text{ask}} - \text{Slope}_{\text{bid}}}{\text{Slope}_{\text{ask}} + \text{Slope}_{\text{bid}} + \epsilon} \in [-1.0, +1.0]$$
- $\mathcal{S}_{\text{asym}} > +0.30$: Ask curve is steep (thin liquidity higher up), bid curve is flat (thick support) $\to$ **Upward Drift Bias**.
- $\mathcal{S}_{\text{asym}} < -0.30$: Bid curve is steep (fragile support), ask curve is flat (thick walls) $\to$ **Downward Drift Bias**.

---

## 3. Sovereign Trading & Execution Directives

1. **Skewed Market Making Quote Placement**:
   - In an upward drift regime ($g(I, S) > +0.10 S$), quote at BBO on bid side (offset = 0 ticks) and widen ask side (offset = +2 ticks) to capture directional drift before the ask queue is swept.
2. **Emergency Adverse Selection Sentry**:
   - If $I_{\text{multi}} < -0.70$ and $\mathcal{S}_{\text{asym}} < -0.40$, trigger `EMERGENCY_BID_CANCEL`. Cancel resting bid quotes immediately to avoid toxic execution ahead of an impending downward price breakdown.
3. **Smart Execution Taker Entry**:
   - Cross the spread with aggressive IOC orders when $P^* - P_{\text{mid}} > 0.40 S$, front-running queue depletion.

---

## 4. Verification & Validation Metrics

- Unit tests (`tests/test_lob_liquidity_imbalance_drift_engine.py`):
  - Symmetric book verifies $I_1 = 0.0$, $I_{\text{multi}} = 0.0$, $P^* = P_{\text{mid}}$, and symmetrical quoting.
  - Bullish imbalance verifies $I_{\text{multi}} > 0.70$, $P^* > P_{\text{mid}}$, and aggressive bid leaning.
  - Toxic sell cascade verifies $I_{\text{multi}} < -0.80$ and triggers `EMERGENCY_BID_CANCEL`.
  - Quote slope elasticity verifies finite non-negative values and proper bounded asymmetry $[-1.0, 1.0]$.
  - 100% test coverage with 0 warnings.
