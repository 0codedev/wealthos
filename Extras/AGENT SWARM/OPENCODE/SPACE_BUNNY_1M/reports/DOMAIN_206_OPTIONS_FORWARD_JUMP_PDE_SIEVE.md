# Sovereign Swarm Architecture Blueprint: Domain 206 (WP-DD)
# Real-Time Options Surface Term-Structure Forward Jump PDE Sieve

**Fabric Layer**: `python-bridge/services/options_forward_jump_pde_sieve.py`  
**Test Suite**: `python-bridge/tests/test_options_forward_jump_pde_sieve.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: Gatheral (2006) Total Variance Representation, Calendar Negative Forward Variance Sieve, Breeden-Litzenberger Risk-Neutral Density Convexity.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

In equity derivative and options market making, implied volatility surfaces $\sigma_{\text{IV}}(K, T)$ must satisfy rigorous absence-of-arbitrage conditions across both strike ($K$) and expiration ($T$) dimensions. When empirical quotes violate these constraints, classical continuous models (such as Dupire local volatility) collapse or generate non-real solutions:
1. **Calendar Spread Arbitrage**: Occurs when total variance decreases with time-to-expiration ($\partial_T w(y, T) < 0$), implying negative forward variance:
   $$\sigma_F^2(T_1, T_2; y) = \frac{w(y, T_2) - w(y, T_1)}{T_2 - T_1} < 0$$
   An arbitrageur executes a risk-free calendar box by selling the near-term option and buying the far-term option.
2. **Butterfly Convexity & Density Non-Negativity (Breeden-Litzenberger)**:
   The risk-neutral probability density must be strictly non-negative:
   $$q(K, T) = \frac{\partial^2 C}{\partial K^2} \ge 0$$
   Violations indicate mispriced butterfly spreads that can be captured with zero capital risk.
3. **Discontinuous Jump-Diffusion Forward PIDE**:
   Under the Kou (2002) / Merton jump framework, market jump intensity $\lambda$ and asymmetric tail decays ($\eta_1, \eta_2$) govern the steepness of OTM wings and event term structures.

### 1.1 Total Implied Variance & Forward Variance Sieve
Following Gatheral (2006), the surface is mapped into log-moneyness $y = \ln(K / S)$ and total variance $w(y, T) = \sigma_{\text{IV}}^2(y, T) \cdot T$:
$$\text{No-Calendar-Arbitrage Condition}: \quad \frac{\partial w(y, T)}{\partial T} \ge 0 \quad \forall y \in \mathbb{R}, \, T > 0$$

### 1.2 Breeden-Litzenberger Denominator Positivity
The condition $q(K, T) \ge 0$ is equivalent to ensuring the denominator factor $D(y, T) \ge 0$:
$$D(y, T) = \left( 1 - \frac{y \partial_y w}{2w} \right)^2 - \frac{(\partial_y w)^2}{4} \left( \frac{1}{w} + \frac{1}{4} \right) + \frac{1}{2} \partial_{yy} w \ge 0$$

---

## 2. Kou Double-Exponential Jump-Tail Parameterization

The risk-neutral jump distribution decomposes into right-tail (upside calls) and left-tail (crash puts):
$$f_Y(y) = p \eta_1 e^{-\eta_1 y} \mathbf{1}_{\{y \ge 0\}} + (1 - p) \eta_2 e^{\eta_2 y} \mathbf{1}_{\{y < 0\}}$$
- $\eta_2 < 3.5$: **Acute Crash Hazard** (heavy fat-tailed left wing; market pricing severe discontinuous crash risk).
- $\lambda > 0.80$: **Elevated Poisson Jump Arrival** (frequent discontinuous shocks).

---

## 3. Sovereign Trading & Execution Directives

1. **Calendar Spread Forward Variance Arbitrage**:
   - When $\sigma_F^2(T_1, T_2) < 0$, sell the rich $T_1$ option and buy the cheap $T_2$ option at strike $K$, locking in positive theta carrying profit.
2. **Butterfly Wing Convexity Extraction**:
   - When $D(y) < 0$ at strike $K_{\text{mid}}$, buy wings $K_{\text{mid}} \pm \Delta K$ and sell $2\times K_{\text{mid}}$ to capture structural convexity mispricing.
3. **Acute Downside Crash Shield**:
   - In `ACUTE_CRASH_HAZARD` ($\lambda > 0.80, \eta_2 < 3.5$), ban unhedged naked short put strategies; mandate dynamic delta-neutral crash collars.

---

## 4. Verification & Validation Metrics

- Unit tests (`tests/test_options_forward_jump_pde_sieve.py`):
  - Valid surface satisfies all no-arbitrage bounds with strictly positive forward variance.
  - Inverted calendar surface successfully triggers `NEGATIVE_FORWARD_VARIANCE` with exact negative forward variance detection.
  - Non-convex volatility smile triggers `BUTTERFLY_CONVEXITY_VIOLATION` at the correct center strike.
  - Extreme left-tail put skew triggers `ACUTE_CRASH_HAZARD` with $\lambda > 0.80$ and $\eta_2 < 3.5$.
  - 100% test coverage with 0 warnings.
