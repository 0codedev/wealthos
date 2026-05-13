# Sovereign Swarm Architecture Blueprint: Domain 209 (WP-DG)
# Machine-Learned Dynamic Margin & Liquidation Cascade Predictor

**Fabric Layer**: `python-bridge/services/dynamic_margin_liquidation_cascade_predictor.py`  
**Test Suite**: `python-bridge/tests/test_dynamic_margin_liquidation_cascade_predictor.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: Dynamic Multi-Tier Volatility-Scaled Maintenance Margin, Distance-to-Liquidation Analytic Break-Even, Microstructural Fire-Sale Cascade Logistic Hazard Kernel, Pre-Emptive Auto-Deleveraging (ADL) Governor.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

In leveraged perpetual futures, margin-traded equities, and options writing accounts, margin defaults trigger mandatory programmatic liquidation by exchange matching engines. These forced market liquidations create severe negative externalities:
1. **Feedback Price Depletion (Fire-Sale Cascades)**: A forced market liquidation sweeps the top-of-book depth. If resting bids are shallow, the price drops further, immediately breaching the liquidation thresholds of adjacent levered positions, precipitating a cascading flash crash.
2. **Predatory Liquidation Fees**: Centralized exchanges penalize forced liquidations by levying a $1.0\%\text{--}1.5\%$ liquidation penalty into an insurance fund, turning a manageable loss into an account wipeout.
3. **Volatility-Scaled Margin Shocks**: Fixed maintenance margins fail during high-volatility expansions; dynamic margin schedules scale required capital as realized volatility surges.

### 1.1 Volatility-Adjusted Dynamic Maintenance Margin Schedule

The effective maintenance margin rate scales above baseline $MM_{\text{base}}$ in proportion to excess realized volatility:
$$MM_{\text{rate}} = MM_{\text{base}} \cdot \left[ 1.0 + \alpha_{\text{vol}} \cdot \max\left(0, \frac{\sigma_{\text{realized}} - \sigma_{\text{ref}}}{\sigma_{\text{ref}}}\right) \right]$$

Where:
- $MM_{\text{base}}$ is the baseline maintenance margin (e.g., $5.0\%$ for 20x max leverage).
- $\sigma_{\text{ref}}$ is reference asset volatility (e.g., $20\%$ annualized).
- $\alpha_{\text{vol}} = 0.50$ controls sensitivity to volatility shocks.

Total maintenance margin required:
$$MM_{\text{req}} = Q \cdot P_{\text{mark}} \cdot MM_{\text{rate}}$$

Margin Ratio:
$$\mathcal{M}_{\text{ratio}} = \frac{\text{AccountEquity}}{MM_{\text{req}}}$$

### 1.2 Exact Liquidation Price Derivation

Liquidation occurs when Account Equity equals Maintenance Margin Requirement:
$$\text{Equity}(P_{\text{liq}}) = MM_{\text{req}}(P_{\text{liq}})$$

For **Long** positions ($Q > 0$):
$$\text{Equity} - Q \cdot (P_{\text{mark}} - P_{\text{liq}}) = Q \cdot P_{\text{liq}} \cdot MM_{\text{rate}}$$
$$P_{\text{liq}}^{\text{long}} = \frac{P_{\text{mark}} \cdot Q - \text{Equity}}{Q \cdot (1 - MM_{\text{rate}})}$$

For **Short** positions ($Q > 0$):
$$\text{Equity} + Q \cdot (P_{\text{mark}} - P_{\text{liq}}) = Q \cdot P_{\text{liq}} \cdot MM_{\text{rate}}$$
$$P_{\text{liq}}^{\text{short}} = \frac{\text{Equity} + P_{\text{mark}} \cdot Q}{Q \cdot (1 + MM_{\text{rate}})}$$

### 1.3 Microstructural Cascade Hazard Logit Kernel

To predict whether nearby resting liquidations will ignite a systemic fire-sale cascade, the engine computes a logistic hazard:
$$Z = \theta_0 + \theta_1 \cdot \left(\frac{V_{\text{liq, near}}}{D_{\text{lob}}}\right) + \theta_2 \cdot \left(\frac{\sigma}{\sigma_{\text{ref}}}\right) - \theta_3 \cdot \Delta P_{\text{buffer}}$$
$$P_{\text{cascade}} = \frac{1}{1 + \exp(-Z)}$$

Where:
- $V_{\text{liq, near}}$ is the aggregated open interest facing liquidation within $3.0\%$ of current mark price.
- $D_{\text{lob}}$ is the absorptive order book depth across top price levels.
- $\Delta P_{\text{buffer}} = \frac{|P_{\text{mark}} - P_{\text{liq}}|}{P_{\text{mark}}}$ is the percentage buffer to liquidation.

---

## 2. Cascade Risk Regimes & Tactical Directives

1. **`BENIGN`** ($P_{\text{cascade}} < 0.20$, $\mathcal{M}_{\text{ratio}} > 2.0\times$):
   - Healthy margin buffer and resilient market depth.
   - Action: `MAINTAIN_NORMAL`. No de-risking required.
2. **`ELEVATED_WATCH`** ($0.20 \le P_{\text{cascade}} < 0.60$ or $1.25\times < \mathcal{M}_{\text{ratio}} \le 2.0\times$):
   - Thinning book depth or emerging margin stress.
   - Action: `SCALE_DOWN_LEVERAGE`. Proactively reduce position size by $35\%$ to restore margin buffer.
3. **`ACUTE_CASCADE_WARNING`** ($P_{\text{cascade}} \ge 0.60$ or $\mathcal{M}_{\text{ratio}} \le 1.25\times$):
   - Imminent liquidation cascade cluster or severe margin breach.
   - Action: `EMERGENCY_PROACTIVE_EXIT`. Proactively execute an orderly limit/market exit for $75\%\text{--}100\%$ of position, evading predatory exchange liquidation penalties.

---

## 3. Verification & Validation Metrics

- Unit tests (`tests/test_dynamic_margin_liquidation_cascade_predictor.py`):
  - Dynamic maintenance margin scales smoothly under volatility shocks ($5\% \to 7.5\%$).
  - Exact analytic liquidation prices for both long and short positions match break-even equations.
  - Benign market conditions preserve normal trading with zero size reduction.
  - Dense liquidation walls in thin books trigger `ACUTE_CASCADE_WARNING` and immediate proactive reduction.
