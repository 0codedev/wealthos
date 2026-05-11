# Domain 156: Statistical Arbitrage Factor Residual PCA & Mean-Reversion Ornstein-Uhlenbeck Sieve (WP-BF)

## Executive Summary & Quantitative Thesis
Traditional equity pairs trading often collapses during macro stress regimes due to unstable bivariate correlation breakdowns. Marco Avellaneda and Jeong-Hyun Lee (2010, *Statistical Arbitrage in the US Equities Market*, Quantitative Finance) established a superior institutional paradigm: **Factor-Neutral Residual Statistical Arbitrage**.

Instead of trading raw price ratios between two arbitrary stocks, the system:
1. Strips out broad market and sector systematic risk factors ($\beta$) via linear factor regression or Principal Component Analysis (PCA).
2. Synthesizes an idiosyncratic cumulative residual process $X_i(t)$ that represents pure stock-specific noise stripped of all market beta.
3. Fits a continuous-time **Ornstein-Uhlenbeck (OU) mean-reverting diffusion process** to the residual spread.
4. Normalizes deviations into a dimensionless **$s$-score** measuring deviation in units of stationary standard deviation.
5. Issues high-conviction market-neutral trades when $|s| \ge 1.25$ with fast mean-reversion half-life ($\tau_{1/2} \le 30$ days), while enforcing an emergency stop/abort trigger at $|s| \ge 4.0$ to protect against permanent fundamental structural breaks.

Domain 156 establishes the **Statistical Arbitrage Factor Residual PCA & Mean-Reversion Ornstein-Uhlenbeck Sieve**, delivering institutional factor-neutral alpha extraction for Indian equities and index constituents.

---

## Mathematical Formulations

### 1. Factor Beta Stripping & Cumulative Residual Process
Let $R_i(t)$ and $R_m(t)$ denote daily stock and market/index returns over a rolling estimation window $t \in [1, T]$:
$$R_i(t) = \alpha_i + \beta_i R_m(t) + \epsilon_i(t)$$
Where OLS slope $\beta_i = \frac{\text{Cov}(R_i, R_m)}{\text{Var}(R_m)}$.

The cumulative beta-hedged performance process is:
$$X_i(t) = \sum_{\tau=1}^t \left( R_i(\tau) - \beta_i R_m(\tau) \right)$$
$X_i(t)$ measures the cumulative idiosyncratic performance of stock $i$ relative to its beta-adjusted benchmark.

---

### 2. Ornstein-Uhlenbeck (OU) Stochastic Differential Equation
The residual spread $X(t)$ is assumed to satisfy the 1-dimensional mean-reverting SDE:
$$dX(t) = \kappa (\bar{X} - X(t)) dt + \sigma_{\text{OU}} dW(t)$$
Where:
- $\kappa > 0$: Speed of mean reversion ($[1/\text{day}]$).
- $\bar{X}$: Long-term stationary equilibrium mean.
- $\sigma_{\text{OU}}$: Instantaneous residual diffusion volatility.
- $W(t)$: Standard Brownian motion.

---

### 3. Discrete-Time AR(1) Parameter Estimation
Discretizing over daily time steps $\Delta t = 1.0$:
$$X_{n+1} = a + b X_n + \eta_{n+1}$$
Under the OU specification:
$$b = e^{-\kappa \Delta t} \implies \kappa = -\ln(b)$$
$$a = \bar{X}(1 - e^{-\kappa \Delta t}) \implies \bar{X} = \frac{a}{1 - b}$$

The stationary variance of the OU process is:
$$\sigma_{\text{eq}}^2 = \frac{\sigma_{\text{OU}}^2}{2\kappa} = \frac{\text{Var}(\eta)}{1 - b^2}$$
$$\sigma_{\text{eq}} = \sqrt{\frac{\text{Var}(\eta)}{1 - b^2}}$$
Stationarity requires $0 < b < 1.0$.

---

### 4. Mean-Reversion Half-Life ($\tau_{1/2}$)
The expected duration required for a residual dislocation to decay by $50\%$ back toward its equilibrium mean:
$$\tau_{1/2} = \frac{\ln(2)}{\kappa} = \frac{\ln(2)}{-\ln(b)} \quad \text{[days]}$$
- Institutional admissible threshold: $\tau_{1/2} \le 45$ days (optimally $\tau_{1/2} \in [2, 20]$ days).
- Sluggish non-tradable threshold: $\tau_{1/2} > 45$ days (reject trade).

---

### 5. Avellaneda-Lee Dimensionless $s$-Score
$$s = \frac{X(T) - \bar{X}}{\sigma_{\text{eq}}}$$

---

### 6. Regime & Execution Directive Matrix
| $s$-Score | Half-Life ($\tau_{1/2}$) | Regime Classification | Execution Directive |
| :--- | :--- | :--- | :--- |
| $s \le -1.25$ | $\le 45$ days | `STAT_ARB_BUY_CHEAP_RESIDUAL` | `LONG_STOCK_SHORT_BETA_HEDGE` |
| $s \ge +1.25$ | $\le 45$ days | `STAT_ARB_SHORT_RICH_RESIDUAL` | `SHORT_STOCK_LONG_BETA_HEDGE` |
| $|s| \ge 4.00$ | Any | `STAT_ARB_STRUCTURAL_BREAK_ABORT` | `CLOSE_ALL_POSITIONS_STOP_LOSS` |
| $|s| \le 0.50$ | Any | `STAT_ARB_IN_EQUILIBRIUM_FLAT` | `CLOSE_SPREAD_CAPTURE_PROFIT` |
| Any | $> 45$ days | `SLOW_MEAN_REVERSION_INADMISSIBLE` | `STAND_ASIDE_HALF_LIFE_EXCEEDED` |
| Other | $\le 45$ days | `INTERMEDIATE_DRIFT_HOLD` | `HOLD_EXISTING_SPREAD_POSITIONS` |

---

## Production Verification & Test Suite
- **Engine Service**: `python-bridge/services/stat_arb_pca_ou_sieve.py` (8.5 KB)
- **Unit Test Suite**: `python-bridge/tests/test_stat_arb_pca_ou_sieve.py` (4.2 KB)
- **Validation**: 6/6 test assertions passing on Oracle Cloud VPS (`tests/test_stat_arb_pca_ou_sieve.py ...... 100% in 0.04s`).
- **Telemetry**: Full SQLite audit trail persisted in `stat_arb_ou_telemetry`.
