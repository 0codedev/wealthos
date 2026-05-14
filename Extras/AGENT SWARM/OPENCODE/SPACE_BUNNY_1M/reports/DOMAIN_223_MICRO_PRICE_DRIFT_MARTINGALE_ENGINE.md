# Sovereign Swarm Architecture Blueprint: Domain 223 (WP-DU)
# Multi-Venue Limit Order Book Depth Imbalance & Micro-Price Drift Martingale Engine

**Fabric Layer**: `python-bridge/services/micro_price_drift_martingale_engine.py`  
**Test Suite**: `python-bridge/tests/test_micro_price_drift_martingale_engine.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: Sasha Stoikov (2018) Micro-Price Martingale Kernel $P^* = P_{\text{mid}} + \frac{S}{2} \tanh(\alpha I_{\text{multi}})$, Multi-Tier Exponentially Decayed Depth Imbalance Tensor, Order Book Slope Elasticity Asymmetry $\mathcal{S}_{\text{asym}}$, Dynamic Quote Shading Governor.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

In continuous electronic markets, the classical mid-price $P_{\text{mid}} = \frac{P_a + P_b}{2}$ fails the martingale test: future price movements are highly predictable based on the relative size resting on the bid versus the ask. However, naive volume-weighted mid-price ($P_w = \frac{Q_b P_a + Q_a P_b}{Q_b + Q_a}$) overstates price sensitivity and ignores the buffering effect of deeper price levels.

Sasha Stoikov (2018) proved that the true fair price (the expected future mid-price conditional on all resting order book information) is a **Micro-Price Martingale**:
$$P^*(t) = \lim_{\tau \to \infty} \mathbb{E}[P_{\text{mid}}(t + \tau) \mid \mathcal{F}_t] = P_{\text{mid}}(t) + \frac{S(t)}{2} \cdot \tanh\left(\alpha \cdot I_{\text{multi}}(t)\right)$$

### 1.1 Multi-Tier Exponential Depth Imbalance

Decomposing depth over the top $M$ levels with spatial decay parameter $\lambda$:
$$Q_b^{\text{multi}} = \sum_{m=1}^M Q_b^{(m)} e^{-\lambda (m - 1)}, \quad Q_a^{\text{multi}} = \sum_{m=1}^M Q_a^{(m)} e^{-\lambda (m - 1)}$$

Normalized multi-level imbalance:
$$I_{\text{multi}} = \frac{Q_b^{\text{multi}} - Q_a^{\text{multi}}}{Q_b^{\text{multi}} + Q_a^{\text{multi}}} \in [-1.0, +1.0]$$

### 1.2 Book Elasticity Slope Asymmetry

The rate at which depth accumulates away from the touch measures book resilience:
$$\mathcal{S}_b = \frac{Q_b^{(M)} - Q_b^{(1)}}{M - 1}, \quad \mathcal{S}_a = \frac{Q_a^{(M)} - Q_a^{(1)}}{M - 1}$$
$$\mathcal{S}_{\text{asym}} = \frac{\mathcal{S}_b - \mathcal{S}_a}{|\mathcal{S}_b| + |\mathcal{S}_a| + 1e-5}$$

### 1.3 Martingale Quote Shading

Rather than posting symmetrically around the raw mid-price, an institutional market maker centers quotes around the micro-price $P^*$:
$$\text{Bid}^* = P^* - \frac{S}{2}, \quad \text{Ask}^* = P^* + \frac{S}{2}$$
This systematically shades quotes upward ahead of upward drift and downward ahead of downward drift, drastically cutting adverse selection.

---

## 2. Market Regimes & Tactical Directives

1. **`BALANCED_MARTINGALE`** ($|P^* - P_{\text{mid}}| \le 0.15 \times \text{Spread}$):
   - Multi-tier order book is symmetric. Micro-price equals mid-price.
   - Action: `MAINTAIN_SYMMETRIC_QUOTES`. Post symmetric quotes around mid.
2. **`BULLISH_UPWARD_DRIFT`** ($P^* - P_{\text{mid}} > 0.15 \times \text{Spread}$):
   - Significant bid accumulation across multiple levels; upward price step anticipated.
   - Action: `SKEW_AGGRESSIVE_BID`. Post bid aggressively at or inside mid to capture priority.
3. **`BEARISH_DOWNWARD_DRIFT`** ($P^* - P_{\text{mid}} < -0.15 \times \text{Spread}$):
   - Heavy ask accumulation; downward price drift anticipated.
   - Action: `SKEW_AGGRESSIVE_ASK`. Post ask aggressively downward.
4. **`ACUTE_LEVEL_COLLAPSE`** ($|I_{\text{multi}}| \ge 0.75$):
   - Catastrophic order book imbalance. Opposite side depth has evaporated.
   - Action: `SWEEP_OR_EVACUATE`. Evacuate resting quotes on the vulnerable side; join market sweep.

---

## 3. Verification & Validation Metrics

- Unit tests (`tests/test_micro_price_drift_martingale_engine.py`):
  - Balanced 5-tier book confirms micro-price exact equality with mid-price and $0$ bps drift.
  - Heavy bid depth ($1,500$ vs $300$) drives micro-price upward and triggers `BULLISH_UPWARD_DRIFT`.
  - Heavy ask depth drives micro-price downward and triggers `BEARISH_DOWNWARD_DRIFT`.
  - Extreme $95\%$ imbalance triggers `ACUTE_LEVEL_COLLAPSE` and `SWEEP_OR_EVACUATE` directive.
