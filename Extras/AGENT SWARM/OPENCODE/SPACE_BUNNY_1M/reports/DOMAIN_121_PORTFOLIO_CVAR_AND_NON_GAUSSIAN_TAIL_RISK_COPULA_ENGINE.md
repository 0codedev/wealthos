# Domain 121: Portfolio CVaR & Non-Gaussian Tail-Risk Copula Engine (WP-W)

**Executive Status**: 🟢 PRODUCTION DELIVERED & MATHEMATICALLY VERIFIED  
**Engine Service**: `python-bridge/services/tail_risk_copula_engine.py`  
**Unit Tests**: `python-bridge/tests/test_tail_risk_copula_engine.py` (8/8 Tests Passing in 0.03s)  
**Target Architecture**: WealthOS v2 Sovereign Risk Management System (RMS)  
**Benchmark Model**: `opencode/nemotron-3.5-lightning-free` / `space-bunny-free` (`--variant max --thinking --auto`)

---

## 1. Executive Summary & The Gaussian VaR Fallacy

Traditional financial risk models rely on Gaussian (Normal) assumptions:
$$\text{VaR}_\alpha^{\text{Gauss}} = \mu + z_\alpha \cdot \sigma$$

In real financial markets—especially the high-volatility Indian Equity & Derivatives (F&O) sector—returns exhibit extreme leptokurtosis (fat tails $\kappa \gg 3$) and negative skewness ($\gamma < 0$). Under Gaussian models:
- A $4\sigma$ single-day crash has a theoretical probability of once every $125$ years ($31,574$ trading days).
- In reality, Indian indices (NIFTY 50, BANKNIFTY) and individual F&O high-beta stocks experience $4\sigma$ to $7\sigma$ shocks multiple times per decade (e.g., March 2020 COVID meltdown, May 2004 election circuit down, June 2024 election vote-counting swings).

Furthermore, standard Pearson linear correlation breaks down completely during market crashes. Assets that appear uncorrelated during normal conditions experience simultaneous collapses due to systemic margin unwinds.

The **Portfolio CVaR & Non-Gaussian Tail-Risk Copula Engine** overcomes these vulnerabilities by integrating:
1. **Extreme Value Theory (EVT)** Peaks-Over-Threshold (POT) using the Generalized Pareto Distribution (GPD).
2. **Student-t Copula lower tail dependence** ($\lambda_L > 0$), capturing joint tail contagion.
3. **Conditional Value-at-Risk (CVaR / Expected Shortfall)** at $95\%$ and $99\%$ confidence, providing a sub-additive coherent risk measure.
4. **Autonomous Capital Headroom & Deleveraging Governor** to avert catastrophic broker liquidations and exchange penal margin calls.

---

## 2. Mathematical Formulations & Copula Theory

### 2.1 Peaks-Over-Threshold (POT) & Generalized Pareto Distribution (GPD)

According to the **Pickands-Balkema-de Haan Theorem**, for a sufficiently high threshold $u$, the distribution of excess losses $Y = X - u$ conditional on $X > u$ converges asymptotically to the Generalized Pareto Distribution (GPD):
$$G_{\xi, \beta}(y) = P(X - u \le y \mid X > u) \approx \begin{cases} 1 - \left( 1 + \frac{\xi y}{\beta} \right)^{-1/\xi}, & \xi \neq 0 \\ 1 - e^{-y/\beta}, & \xi = 0 \end{cases}$$
where:
- $\xi$ is the tail shape parameter (tail fatness / heavy-tailedness; for Indian markets, $\xi \in [0.10, 0.40]$).
- $\beta > 0$ is the scale parameter.

Using the Method of Moments, $\xi$ and $\beta$ are estimated from sample excess loss mean $\bar{y}$ and sample variance $s_y^2$:
$$\frac{s_y^2}{\bar{y}^2} = \frac{1}{1 - 2\xi} \implies \xi = \frac{1}{2}\left(1 - \frac{\bar{y}^2}{s_y^2}\right), \quad \beta = \bar{y}(1 - \xi)$$

### 2.2 Closed-Form EVT VaR and CVaR (Expected Shortfall)

Given sample size $n$ and number of exceedances $n_u = |\{x_i \mid x_i > u\}|$:
$$\text{VaR}_\alpha = u + \frac{\beta}{\xi} \left[ \left( \frac{n}{n_u} (1 - \alpha) \right)^{-\xi} - 1 \right]$$
$$\text{CVaR}_\alpha = \mathbb{E}[X \mid X \ge \text{VaR}_\alpha] = \frac{\text{VaR}_\alpha + \beta - \xi u}{1 - \xi}$$

Properties guaranteed:
$$\text{CVaR}_{99\%} \ge \text{VaR}_{99\%} \ge \text{VaR}_{95\%}, \quad \text{CVaR}_{99\%} \ge \text{CVaR}_{95\%} \ge \text{VaR}_{95\%}$$

### 2.3 Student-t Copula Lower Tail Dependence ($\lambda_L$)

For bivariate returns $(X_1, X_2)$ with linear correlation $\rho$ and $\nu$ degrees of freedom, the Student-$t$ Copula exhibits non-zero lower tail dependence:
$$\lambda_L = \lim_{q \to 0^+} P(U_1 \le q \mid U_2 \le q) = 2 \cdot t_{\nu + 1}\left( - \sqrt{\frac{(\nu + 1)(1 - \rho)}{1 + \rho}} \right) > 0$$

Contrast with Gaussian Copula:
$$\lambda_L^{\text{Gaussian}} = \lim_{q \to 0^+} 2 \Phi\left( - \frac{\sqrt{1 - \rho}}{\sqrt{1 + \rho}} \Phi^{-1}(q) \right) \equiv 0 \quad (\text{for all } \rho < 1)$$

Under the Gaussian copula, tail contagion is assumed to be nonexistent! The Student-$t$ copula correctly models that when one Indian equity derivative crashes, others are dragged down concurrently through cross-portfolio margin liquidations.

### 2.4 Autonomous Deleveraging & Capital Governor

The engine tracks the **CVaR-to-Margin Ratio**:
$$\mathcal{R}_{\text{CVaR}} = \frac{\text{CVaR}_{99\%}}{\text{AvailableMargin}}$$

- $\mathcal{R}_{\text{CVaR}} < 0.35$: **NORMAL REGIME** (Positioning within safe bounds).
- $0.35 \le \mathcal{R}_{\text{CVaR}} < 0.50$: **ELEVATED REGIME** (Warning alert; freeze new position initiation).
- $\mathcal{R}_{\text{CVaR}} \ge 0.50$: **CRITICAL DELEVERAGE REGIME** (Automated reduction of high-beta F&O weights to restore capital headroom).

$$\text{HedgingNotionalRequired} = \text{CVaR}_{99\%} - (0.35 \times \text{AvailableMargin})$$

---

## 3. Production Architecture

```
[ Multi-Asset Portfolio State ]
(Equities, Futures, Options)
             │
             ▼
[ TailRiskCopulaEngine ]
   ├─► Sample Excess Kurtosis Evaluator (\kappa > 3 check)
   ├─► Peaks-Over-Threshold (POT) 90th-percentile GPD Sieve
   ├─► Student-t Copula Lower Tail Dependence (\lambda_L > 0)
   ├─► Coherent CVaR 95% & 99% Analytical Solvers
   └─► Systemic Margin Depletion Governor
             │
             ├─► Regime == CRITICAL_DELEVERAGE -> Hedging Order to OpenAlgo Gateway
             └─► SQLite Surveillance Audit Log (`tail_risk_surveillance_logs`)
```

---

## 4. Verification & Validation Summary

| Test Case | Objective | Verified Metric | Result |
| :--- | :--- | :--- | :---: |
| `test_excess_kurtosis_calculation` | Distinguish Gaussian from fat-tailed distributions | $\kappa_{\text{Gauss}} \approx 0, \kappa_{\text{Fat}} > 3.0$ | 🟢 PASS |
| `test_lower_tail_dependence_student_t` | Verify non-zero tail dependence for positive $\rho$ | $\lambda_L(\rho=0.85) > 0.30, \lambda_L(\rho=0.40) > 0.05$ | 🟢 PASS |
| `test_gpd_moments_fit` | Fit $\xi$ and $\beta$ within stable parameter bounds | $-0.45 \le \xi \le 0.45, \beta > 0$ | 🟢 PASS |
| `test_evt_var_cvar_ordering` | Coherent risk measure mathematical ordering | $\text{CVaR}_{99\%} \ge \text{VaR}_{99\%} \ge \text{VaR}_{95\%}$ | 🟢 PASS |
| `test_portfolio_tail_risk_normal_regime` | Adequate margin headroom results in NORMAL regime | $\mathcal{R}_{\text{CVaR}} < 0.35 \to \text{NORMAL}$ | 🟢 PASS |
| `test_portfolio_tail_risk_critical_deleveraging` | Heavy tail loss breaching margin triggers deleveraging | $\mathcal{R}_{\text{CVaR}} \ge 0.50 \to \text{CRITICAL\_DELEVERAGE}$ | 🟢 PASS |
| `test_empty_positions_handling` | Zero positions handled gracefully | Risk regime = `NORMAL`, no exception | 🟢 PASS |
| `test_sqlite_persistence` | Surveillance logs correctly stored in database | Row verified in `tail_risk_surveillance_logs` | 🟢 PASS |

---

## 5. Deployment Directives

1. **RMS Integration**: Hook `assess_portfolio_tail_risk` into WealthOS v2 pre-order risk validation pipeline.
2. **Frequency**: Execute continuously every 60 seconds during live market hours (09:15 – 15:30 IST).
3. **Broker Synchronization**: Cross-reference `total_available_margin_inr` with Dhan / Upstox live funds API.
