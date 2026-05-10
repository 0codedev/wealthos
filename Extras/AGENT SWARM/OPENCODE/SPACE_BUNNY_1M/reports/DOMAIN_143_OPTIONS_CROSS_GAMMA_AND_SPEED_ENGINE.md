# Domain 143: Sub-Millisecond Options Greeks Cross-Gamma & Speed Sieve (WP-AS)

## Executive Summary & Quantitative Thesis
In modern Indian options markets (NSE NIFTY and BANKNIFTY), the prevalence of weekly expiries and intraday 0DTE volume concentration has rendered standard linear Delta hedging insufficient. Delta hedging assumes that Gamma ($\partial \Delta / \partial S$) is locally constant. However, as expiration approaches ($T \to 0$), Gamma diverges sharply near at-the-money (ATM) strikes as $\mathcal{O}(1/\sqrt{T})$, and its directional derivative—**Speed** ($\partial^3 V / \partial S^3 = \partial \Gamma / \partial S$)—diverges even more aggressively as $\mathcal{O}(1/T)$.

A sudden 50 bps intraday move in NIFTY induces rapid non-linear shifts in portfolio Delta, leading to severe hedging slippage, whipsaw losses, and "pin risk" catastrophes for short option sellers. Furthermore, institutional market makers and dispersion arbitrageurs trading index options against single-stock constituent baskets face **Cross-Gamma** ($\partial^2 V / \partial S_i \partial S_j$) exposures, where intra-basket correlation breakdowns deform portfolio curvature.

Domain 143 engineers the **Sub-Millisecond Options Greeks Cross-Gamma & Speed Sieve**, establishing:
1. Analytical closed-form third-order Greeks: **Speed** ($\Gamma'$), **Zomma** ($\partial \Gamma / \partial \sigma$), and **Color** ($\partial \Gamma / \partial T$).
2. Multi-asset constituent cross-gamma tensor decomposition for NIFTY basket dispersion hedges.
3. A real-time **0DTE Terminal Gamma Jump Hazard Score** ($H_\gamma \in [0.0, 1.0]$) that dynamically throttles delta rebalancing bands from $\pm 10\%$ down to $\pm 2\%$, enforcing emergency flattening before 15:30 IST settlement pins.

---

## Mathematical Formulations

### 1. Analytical Black-Scholes Greeks & Higher Derivatives
Let $S$ denote the underlying spot price, $K$ the strike price, $T$ the annualized time to maturity, $\sigma$ the implied volatility, $r$ the risk-free rate, and $q$ the continuous dividend yield.

The standard Black-Scholes normalized coordinates are:
$$d_1 = \frac{\ln(S/K) + (r - q + \frac{1}{2}\sigma^2)T}{\sigma \sqrt{T}}, \quad d_2 = d_1 - \sigma \sqrt{T}$$

With standard normal density $\phi(x) = \frac{1}{\sqrt{2\pi}} e^{-x^2 / 2}$ and cumulative distribution $\Phi(x) = \frac{1}{2}[1 + \text{erf}(x / \sqrt{2})]$:
$$\Delta_{\text{call}} = e^{-qT} \Phi(d_1), \quad \Delta_{\text{put}} = -e^{-qT} \Phi(-d_1)$$
$$\Gamma = \frac{e^{-qT}\phi(d_1)}{S \sigma \sqrt{T}}, \quad \mathcal{V} = S e^{-qT} \phi(d_1) \sqrt{T}$$

### 2. Third-Order Greeks (Curvature Dynamics)

#### A. Speed ($\partial^3 V / \partial S^3 = \partial \Gamma / \partial S$)
Speed measures the acceleration of Delta per unit change in underlying spot price:
$$\text{Speed} = \frac{\partial \Gamma}{\partial S} = -\frac{\Gamma}{S} \left( \frac{d_1}{\sigma \sqrt{T}} + 1 \right)$$
- **Moneyness Invariant**: For Out-of-the-Money options ($S < K$ for calls, $d_1 < 0$), $\text{Speed} > 0$, indicating that as the underlying rallies towards the strike, Gamma expands. For In-the-Money options ($S > K$ for calls, $d_1 > 0$), $\text{Speed} < 0$, indicating that Gamma collapses as the contract moves deep ITM.

#### B. Zomma ($\partial^3 V / \partial S^2 \partial \sigma = \partial \Gamma / \partial \sigma$)
Zomma measures the sensitivity of Gamma to changes in implied volatility:
$$\text{Zomma} = \frac{\partial \Gamma}{\partial \sigma} = \Gamma \left( \frac{d_1 d_2 - 1}{\sigma} \right)$$
- When $|d_1 d_2| > 1$, Gamma increases with volatility; near ATM ($d_1 d_2 \approx 0$), Zomma is negative, meaning volatility expansion flattens the Gamma peak.

#### C. Color ($\partial^3 V / \partial S^2 \partial T = \partial \Gamma / \partial T$)
Color (or Gamma bleed) quantifies the decay of Gamma over time:
$$\text{Color} = -\Gamma \left( q + \frac{1 - d_1 d_2}{2T} + \frac{r - q}{\sigma \sqrt{T}} d_1 \right)$$

---

### 3. Multi-Asset Index Cross-Gamma Tensor Formulation
Consider an index $I$ formed by $M$ constituent equities with weights $w_i \in [0, 1]$ such that $\sum_{i=1}^M w_i = 1$:
$$I = \sum_{i=1}^M w_i S_i$$

For an option contract on the index $V(I, K, T)$, the portfolio second-order Taylor expansion under constituent shocks $\mathbf{\Delta S} = (\Delta S_1, \dots, \Delta S_M)^T$ is:
$$\Delta \Pi_{2\text{nd}} = \frac{1}{2} \mathbf{\Delta S}^T \mathbf{\Gamma}_{\text{cross}} \mathbf{\Delta S} = \frac{1}{2} \sum_{i=1}^M \sum_{j=1}^M \Gamma_{ij} \Delta S_i \Delta S_j$$

Where the cross-gamma tensor elements are:
$$\Gamma_{ij} = \frac{\partial^2 V}{\partial S_i \partial S_j} = \frac{\partial^2 V}{\partial I^2} \frac{\partial I}{\partial S_i} \frac{\partial I}{\partial S_j} = \Gamma_{\text{index}} \cdot w_i w_j$$
And the direct constituent Gamma is:
$$\Gamma_{ii} = \Gamma_{\text{index}} \cdot w_i^2$$

#### Curvature Conservation Law:
$$\sum_{i=1}^M \sum_{j=1}^M \Gamma_{ij} = \Gamma_{\text{index}} \left( \sum_{i=1}^M w_i \right) \left( \sum_{j=1}^M w_j \right) = \Gamma_{\text{index}}$$
This guarantees that an index option hedged by weighted constituents captures the exact second-order portfolio curvature.

---

### 4. 0DTE Terminal Gamma Jump Hazard Model
As time to expiration approaches zero ($T \le 0.002$ years, or within 4 hours of expiry), ATM Gamma diverges at $\mathcal{O}(T^{-1/2})$ and Speed diverges at $\mathcal{O}(T^{-1})$.

The engine computes the composite **Gamma Jump Hazard Score** $H_\gamma \in [0.0, 1.0]$:
$$H_\gamma = \min\left(1.0, \; \frac{|\text{Speed}| \cdot (\Delta S_{\text{step}})^2}{0.08 \cdot S} + \frac{\Gamma}{\Gamma_{\text{crit}}} \cdot e^{-T / T_{\text{day}}}\right)$$
Where:
- $\Delta S_{\text{step}} = 0.005 \times S$ (a 50 bps adverse intraday price dislocation).
- $\Gamma_{\text{crit}} = 0.0020$ (critical systemic gamma threshold for NIFTY 25000).
- $T_{\text{day}} = 1 / 365$ years.

#### Dynamic Rebalancing Tolerance Ladder:
| Hazard Score ($H_\gamma$) | Regime Classification | Action Directive | Delta Rebalance Band |
| :--- | :--- | :--- | :--- |
| **$0.00 \le H_\gamma < 0.30$** | `STABLE_GAMMA` | Standard institutional hedging | $\pm 10.0\%$ |
| **$0.30 \le H_\gamma < 0.60$** | `ELEVATED_SPEED_MONITOR` | Accelerate hedge check frequency | $\pm 6.0\%$ |
| **$0.60 \le H_\gamma < 0.85$** | `HIGH_PIN_RISK_TIGHTEN` | Halt short options writing, tighten stops | $\pm 4.0\%$ |
| **$0.85 \le H_\gamma \le 1.00$** | `TERMINAL_PIN_HAZARD_CLOSE` | Force roll or atomic close before pin whipsaw | $\pm 2.0\%$ |

---

## Service Architecture & Implementation

The production service is encapsulated in `python-bridge/services/cross_gamma_speed_engine.py`:
- **Speed & Higher-Order Greek Calculator**: Vectorized, closed-form evaluation of Speed, Zomma, and Color using exact error function expansions.
- **Cross-Gamma Matrix Engine**: Constructs $M \times M$ symmetric cross-gamma tensors and calculates constituent-level direct gammas.
- **Persistence Layer**: Thread-safe SQLite engine recording Greek dynamics, hazard scores, and rebalance tolerances into `cross_gamma_speed_telemetry`.

---

## Verification & Test Suite Coverage

The test suite in `python-bridge/tests/test_cross_gamma_speed_engine.py` validates all mathematical invariants:
1. `test_higher_order_greeks_atm_call`: Verifies finite, bounded third-order Greeks for baseline monthly options ($0.45 < \Delta < 0.60$, $\Gamma > 0$, $\mathcal{V} > 0$, $\Theta < 0$).
2. `test_speed_moneyness_asymmetry`: Confirms that $\text{Speed}_{\text{OTM}} > 0$ and $\text{Speed}_{\text{ITM}} < 0$, verifying the fundamental moneyness curvature property.
3. `test_0dte_terminal_pin_risk_hazard`: Simulates a 15-minute 0DTE ATM contract, proving that $H_\gamma \ge 0.80$ and triggers `TERMINAL_PIN_HAZARD_CLOSE` with $\le 4.0\%$ tolerance.
4. `test_cross_gamma_basket_matrix`: Validates matrix symmetry ($\Gamma_{ij} = \Gamma_{ji}$), direct gammas ($\Gamma_{ii} = \Gamma_{\text{index}} w_i^2$), and aggregate curvature conservation.
5. `test_sqlite_persistence`: Verifies telemetry recording and schema consistency.

**Execution Result on Oracle Cloud VPS:**
```
tests/test_cross_gamma_speed_engine.py ..... [100%]
5 passed in 0.03s
```
