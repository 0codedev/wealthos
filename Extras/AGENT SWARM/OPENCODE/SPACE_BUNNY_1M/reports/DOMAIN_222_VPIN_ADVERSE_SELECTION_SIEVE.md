# Sovereign Swarm Architecture Blueprint: Domain 222 (WP-DT)
# Cross-Market Order Flow Microstructure Adverse Selection & VPIN Drift Sieve

**Fabric Layer**: `python-bridge/services/vpin_adverse_selection_sieve.py`  
**Test Suite**: `python-bridge/tests/test_vpin_adverse_selection_sieve.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: Easley-Lopez de Prado-O'Hara (2012) Volume-Synchronized Probability of Toxicity (VPIN), Bulk Volume Classification (BVC), Rolling Empirical CDF Toxicity Percentile, Microsecond Market Maker Adverse Selection Evacuation Sentry.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

In equity and derivatives trading, liquidity providers face adverse selection when trading against informed market participants who possess superior information regarding fundamental value or impending institutional order flow. When informed traders enter the market, their aggressive order flow creates volume imbalances in chronological time that traditional clock-time microstructure models fail to register.

Easley, Lopez de Prado, and O'Hara (2012) resolved this by introducing **Volume Clock Synchronization**, dividing trading activity into equal-volume buckets $V$ and computing the **Volume-Synchronized Probability of Toxicity (VPIN)**.

### 1.1 Bulk Volume Classification (BVC)

For volume bucket $\tau$ of size $V$ spanning price change $\Delta P_\tau$:
$$V_\tau^B = V \cdot \Phi\left(\frac{\Delta P_\tau}{\sigma_{\Delta P}}\right)$$
$$V_\tau^S = V - V_\tau^B$$

Where $\Phi(\cdot)$ is the standard normal cumulative distribution function and $\sigma_{\Delta P}$ is the standard deviation of bucket price returns.

### 1.2 VPIN Formulation & Rolling Window

Over a rolling window of $N$ volume buckets (standard $N = 50$):
$$VPIN = \frac{\sum_{\tau=1}^N |V_\tau^B - V_\tau^S|}{N \cdot V} \in [0.0, 1.0]$$

### 1.3 Rolling Empirical CDF Toxicity Percentile

Because baseline toxicity varies significantly across assets and market regimes, the absolute VPIN metric is normalized against its rolling historical cumulative distribution function:
$$\text{CDF}(VPIN_t) = \frac{1}{M} \sum_{k=1}^M \mathbf{1}_{\{VPIN_k \le VPIN_t\}}$$

### 1.4 Adverse Selection Spread Penalty

The expected adverse selection loss for a passive limit order is modeled via a sigmoid discount factor on the half-spread $S_{\text{half}}$:
$$\text{Penalty}_{\text{bps}} = S_{\text{half}} \cdot \left( \frac{1}{1 + \exp(-4.0 (\text{CDF}(VPIN) - 0.50))} \right)$$

When toxicity reaches the 90th percentile, adverse selection exceeds the half-spread, making passive liquidity provision an expected loss.

---

## 2. Toxicity Regimes & Tactical Directives

1. **`BENIGN_UNINFORMED_FLOW`** ($\text{CDF}(VPIN) < 0.60$):
   - Order flow is dominated by retail, noise, or balanced algorithmic rebalancing.
   - Action: `MAINTAIN_PASSIVE_MAKING`. Normal two-sided quoting ($1.0\times$ spread).
2. **`ELEVATED_TOXICITY_WARNING`** ($0.60 \le \text{CDF}(VPIN) < 0.90$):
   - Informed institutional presence detected; directional imbalance building.
   - Action: `SHADE_INVENTORY_SPREAD`. Expand quoting spread to $1.60\times$ and shade quotes away from the toxic side.
3. **`ACUTE_TOXIC_TSUNAMI`** ($\text{CDF}(VPIN) \ge 0.90$ or $VPIN \ge 0.65$):
   - Severe institutional market sweep in progress; probability of adverse selection fill exceeds $90\%$.
   - Action: `EVACUATE_MAKER_QUOTES`. Immediately pull all resting limit orders from both sides of the book.

---

## 3. Verification & Validation Metrics

- Unit tests (`tests/test_vpin_adverse_selection_sieve.py`):
  - BVC volume bucket correctly splits trades: zero price change yields exact 50/50 buy/sell; positive delta yields $>80\%$ buy.
  - Balanced order flow confirms low VPIN ($< 0.10$), sub-60th percentile CDF, and `BENIGN_UNINFORMED_FLOW`.
  - Unidirectional order runs (65% buy) produce elevated VPIN ($0.30$) and trigger `ELEVATED_TOXICITY_WARNING` with $1.6\times$ spread expansion.
  - Aggressive sweeps ($95\%$ buy) push VPIN to $0.90$ ($> 90$th percentile), triggering `ACUTE_TOXIC_TSUNAMI` and immediate quote evacuation.
