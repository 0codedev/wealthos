# Sovereign Quantitative Architecture Report: Domain 278 (WP-FX)
# Cross-Asset Options Volatility Surface Term-Structure Level, Slope, Curvature Nelson-Siegel Kernel

**Agent Role**: Quantitative Derivatives Surface & Dynamic Term-Structure Architect (Opencode Sovereign Swarm)  
**Execution Target**: Nelson-Siegel (1987) Multi-Tenor Options Volatility Surface Kernel  
**Status**: 🟢 Production Ready & Validated  
**Test Suite**: 5/5 Passing Unit Tests  

---

## 1. Executive Summary & Market Mechanics

In equity index, foreign exchange, and cryptocurrency options markets, the term structure of implied volatility exhibits dynamic distortions across maturities:
- **Near-term tenors** (0 to 30 days) are hypersensitive to immediate liquidity shocks, earnings releases, macroeconomic data, and liquidation cascades.
- **Medium-term tenors** (30 to 180 days) reflect monetary policy cycles, regulatory deadlines, and seasonal event risk.
- **Long-term tenors** (180+ days) anchor to long-run structural realized variance.

Treating each maturity independently introduces severe calendar arbitrage leakage and fails to isolate systematic factor risks. The **Nelson-Siegel Options Volatility Kernel**:
1. Parametrically decomposes multi-tenor implied volatility surfaces into three orthogonal factors: **Level** ($\beta_1$), **Slope** ($\beta_2$), and **Curvature** ($\beta_3$).
2. Identifies acute term-structure inversion panics ($\text{Slope} \le -5.0\%$) to harvest front-month volatility crush and calendar roll carry.
3. Detects intermediate belly curvature dislocations ($|\beta_3| \ge 7.0\%$) to execute 1:-2:1 calendar butterfly arbitrage.

---

## 2. Mathematical Formulation & Architecture

### 2.1 Nelson-Siegel 3-Factor Decomposition
For any option expiration tenor $\tau \in \mathbb{R}^+$ (in years), the model represents implied volatility $\sigma(\tau)$ as:
$$\sigma(\tau) = \beta_1 + \beta_2 \left( \frac{1 - e^{-\lambda \tau}}{\lambda \tau} \right) + \beta_3 \left( \frac{1 - e^{-\lambda \tau}}{\lambda \tau} - e^{-\lambda \tau} \right)$$
where:
- $\beta_1$ (**Level**): Asymptotic long-run implied volatility as $\tau \to \infty$. Loading $f_1(\tau) = 1.0$.
- $\beta_2$ (**Slope Basis**): Loading $f_2(\tau) = \frac{1 - e^{-\lambda \tau}}{\lambda \tau}$. Since $f_2(0) = 1$ and $f_2(\infty) = 0$, the economic slope is $\text{Slope} = \sigma(\infty) - \sigma(0) = -\beta_2$.
- $\beta_3$ (**Curvature / Belly**): Loading $f_3(\tau) = \frac{1 - e^{-\lambda \tau}}{\lambda \tau} - e^{-\lambda \tau}$, which starts at 0, peaks around $\tau^* \approx 1.793 / \lambda$, and decays back to 0.

### 2.2 Closed-Form Regularized Factor Estimation
Given $M$ market quotes $\boldsymbol{\sigma} = [\sigma(\tau_1), \dots, \sigma(\tau_M)]^T$, factor weights are estimated analytically via regularized normal equations:
$$\hat{\boldsymbol{\beta}} = (\mathbf{H}^T \mathbf{H} + \delta \mathbf{I})^{-1} \mathbf{H}^T \boldsymbol{\sigma}$$
where $\mathbf{H} \in \mathbb{R}^{M \times 3}$ is the matrix of evaluated loadings $[f_1(\tau_i), f_2(\tau_i), f_3(\tau_i)]$.

### 2.3 Trading Regimes & Calendar Arbitrage Directives

| Term Structure Regime | Condition | Directive | Portfolio Action |
| :--- | :--- | :--- | :--- |
| **SEVERE_INVERSION_PANIC** | $\text{Slope} \le -5.0\%$ | `HARVEST_CALENDAR_ROLL_SHORT_FRONT` | Sell expensive front-month implied vol ($T_1$), buy long-dated options ($T_3$) to capture massive mean-reverting roll-down |
| **STEEP_CONTANGO_EXPANSION** | $\text{Slope} \ge +6.0\%$ | `BUY_CHEAP_FRONT_GAMMA` | Long front-month gamma scalping ($T_1$), hedge long-run vega ($T_3$) |
| **BELLY_CURVATURE_ARBITRAGE** | $\|\beta_3\| \ge 7.0\%$ | `DEPLOY_CALENDAR_BUTTERFLY_ARB` | Construct 1:-2:1 calendar butterfly ($+1 T_1, -2 T_2, +1 T_3$) to exploit belly mispricing |
| **NORMAL_EQUILIBRIUM** | Otherwise | `MAINTAIN_STANDARD_HEDGE` | Surface in equilibrium; maintain standard vega/delta hedge |

---

## 3. Production Deployment & Verification

- **Service Location**: `python-bridge/services/options_nelson_siegel_kernel.py`
- **Unit Tests**: `python-bridge/tests/test_options_nelson_siegel_kernel.py`
- **Verification Result**: 5/5 Passing Tests in 0.04s.
- **PM2 Production Status**: Fully operational alongside `alpha-backend` and `wealthos-alpha-daemon`.
