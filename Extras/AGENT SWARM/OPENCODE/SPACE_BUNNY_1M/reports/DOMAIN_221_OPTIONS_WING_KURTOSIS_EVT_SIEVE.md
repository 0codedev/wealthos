# Sovereign Swarm Architecture Blueprint: Domain 221 (WP-DS)
# Real-Time Options Surface Wing Kurtosis Extreme Value Theory (EVT) Sieve

**Fabric Layer**: `python-bridge/services/options_wing_kurtosis_evt_sieve.py`  
**Test Suite**: `python-bridge/tests/test_options_wing_kurtosis_evt_sieve.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: Pickands-Balkema-de Haan Peaks-Over-Threshold (POT) Theorem, Generalized Pareto Distribution (GPD) Heavy Tails, Hill Tail Exponent $\hat{\xi}$, Options Wing Kurtosis Ratio $\mathcal{K}_{\text{wing}}$, Convex Black Swan Protective Overlay.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

Standard Black-Scholes-Merton and Gaussian risk models assume light, exponentially decaying tails, underestimating tail risk by orders of magnitude. In derivatives markets, deep out-of-the-money puts ($10\Delta$ puts) trade at significant implied volatility premia over ATM ($50\Delta$) options, reflecting the market's pricing of extreme non-linear crash risk.

Extreme Value Theory (EVT), via the **Pickands-Balkema-de Haan Theorem**, states that conditional excess losses over a sufficiently high threshold $u$ asymptotically follow the **Generalized Pareto Distribution (GPD)**:
$$F_u(y) = P(X - u \le y \mid X > u) \approx G_{\xi, \beta}(y) = 1 - \left( 1 + \xi \frac{y}{\beta} \right)^{-1/\xi}$$

Where:
- $\xi$ is the shape parameter (tail heaviness). When $\xi > 0$, the tail follows a heavy Fréchet power-law.
- $\beta > 0$ is the scale parameter.

### 1.1 Options Wing Kurtosis Formulation

The implied tail kurtosis of the options surface is measured by the ratio of wing out-of-the-money put volatility to at-the-money volatility:
$$\mathcal{K}_{\text{wing}} = \frac{\sigma_{\text{implied}}(K_{10\Delta}^{\text{put}})}{\sigma_{\text{implied}}(K_{50\Delta}^{\text{atm}})}$$

When $\mathcal{K}_{\text{wing}} > 1.55\times$, options traders are pricing in extreme tail crash probabilities.

### 1.2 Closed-Form EVT Value-at-Risk & Expected Shortfall

Given total sample size $N$, threshold $u$, and number of tail exceedances $N_u$:
$$VaR_\alpha = u + \frac{\beta}{\xi} \left[ \left( \frac{N}{N_u} (1 - \alpha) \right)^{-\xi} - 1 \right]$$

Expected Shortfall (CVaR) representing conditional average loss beyond $VaR_\alpha$:
$$ES_\alpha = \frac{VaR_\alpha + \beta - \xi u}{1 - \xi}$$

---

## 2. Risk Regimes & Tactical Directives

1. **`GAUSSIAN_THIN_TAILS`** ($\xi \le 0.15$ and $\mathcal{K}_{\text{wing}} \le 1.25\times$):
   - Mild, symmetric volatility smile.
   - Action: `MAINTAIN_NORMAL_RISK`. Full $1.0\times$ portfolio leverage permitted.
2. **`FAT_TAIL_KURTOSIS_ELEVATION`** ($0.15 < \xi \le 0.35$ or $1.25 < \mathcal{K}_{\text{wing}} \le 1.55$):
   - Elevated wing put skew; options wings are rich relative to empirical realized tails.
   - Action: `SELL_OVERPRICED_WINGS`. Harvest wing premium via ratio spreads (e.g. 1x2 put ratio), throttle portfolio leverage to $0.85\times$.
3. **`CRASH_REGIME_EXTREME_EVT`** ($\xi > 0.35$ or $\mathcal{K}_{\text{wing}} > 1.55$):
   - Extreme tail crash risk. Expected shortfall exceeds risk tolerance.
   - Action: `BUY_DEEP_OTM_CONVEX_HEDGE`. Mandate purchase of deep OTM protective put wings; immediately cut gross portfolio leverage by $50\%$ ($0.50\times$).

---

## 3. Verification & Validation Metrics

- Unit tests (`tests/test_options_wing_kurtosis_evt_sieve.py`):
  - Monotonicity test verifies $ES_{99} > VaR_{99} > u$ under positive GPD parameterization.
  - Gaussian returns with mild wing vol confirm `GAUSSIAN_THIN_TAILS` and $1.0\times$ capacity.
  - Moderate wing vol elevation ($1.375\times$) confirms `FAT_TAIL_KURTOSIS_ELEVATION` and $0.85\times$ leverage limit.
  - Extreme wing kurtosis ($1.75\times$) triggers `CRASH_REGIME_EXTREME_EVT`, $0.50\times$ leverage reduction, and deep OTM hedge requirement.
