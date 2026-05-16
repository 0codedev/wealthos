# Sovereign Quantitative Architecture Report: Domain 271 (WP-FQ)
# Multi-Exchange Continuous Statistical Arbitrage Pairs Kalman Filter Hedge Ratio Kernel

**Agent Role**: Statistical Arbitrage & State-Space Filtering Architect (Opencode Sovereign Swarm)  
**Execution Target**: Recursive Online Dynamic Hedge Ratio Estimation & Pairs Trading Sentry  
**Status**: 🟢 Production Ready & Validated  
**Test Suite**: 4/4 Passing Unit Tests  

---

## 1. Executive Summary & Microstructure Mechanics

In quantitative statistical arbitrage (pairs trading and basket trading), the fundamental hypothesis is that two economically linked assets share a long-term equilibrium relationship:
$$y_t = \alpha + \beta x_t + \epsilon_t$$
where the residual spread $\epsilon_t$ is mean-reverting.

Traditional static ordinary least squares (OLS) or rolling-window regressions suffer from severe structural shortcomings:
1. **Regime Lag & Window Distortion**: Rolling OLS windows introduces arbitrary window parameterization; old observations abruptly fall out of the window, causing phantom volatility in the estimated hedge ratio $\hat{\beta}$.
2. **Dynamic Cross-Venue Drift**: Borrow fee changes, diverging liquidity depths, and varying funding costs cause the true equilibrium cointegration slope $\beta$ to drift continuously.

**Domain 271** operationalizes the **Pairs Kalman Filter Hedge Ratio Kernel**, formulating cointegration as an adaptive linear state-space dynamical system. The Kalman Filter recursively estimates the time-varying state vector $\theta_t = [\alpha_t, \beta_t]^T$ tick-by-tick, updating the hedge ratio without lag and providing exact normalized innovation variances for sniper entries.

---

## 2. Mathematical Formulation & Architecture

### 2.1 State-Space Formulation
- **State Transition Equation**:
  $$\theta_t = \theta_{t-1} + w_t, \quad w_t \sim \mathcal{N}(0, Q)$$
  where $\theta_t = \begin{bmatrix} \alpha_t \\ \beta_t \end{bmatrix}$, and $Q = \delta_{\text{trans}} \cdot I_2$ represents the process noise covariance governing the rate of parameter drift.

- **Measurement Observation Equation**:
  $$y_t = H_t \theta_t + v_t, \quad v_t \sim \mathcal{N}(0, R)$$
  where observation matrix $H_t = [1.0, x_t]$, and $R$ is the measurement noise variance.

### 2.2 Recursive Kalman Filtering Equations
At each observation tick $(x_t, y_t)$:
1. **Time Update (Predict)**:
   $$\hat{\theta}_{t|t-1} = \hat{\theta}_{t-1|t-1}, \quad P_{t|t-1} = P_{t-1|t-1} + Q$$
2. **Measurement Residual (Spread Innovation)**:
   $$e_t = y_t - H_t \hat{\theta}_{t|t-1} = y_t - (\hat{\alpha}_{t|t-1} + \hat{\beta}_{t|t-1} x_t)$$
   $$S_t = H_t P_{t|t-1} H_t^T + R$$
3. **Kalman Gain**:
   $$K_t = P_{t|t-1} H_t^T S_t^{-1}$$
4. **State Measurement Update**:
   $$\hat{\theta}_{t|t} = \hat{\theta}_{t|t-1} + K_t e_t$$
   $$P_{t|t} = (I - K_t H_t) P_{t|t-1}$$

### 2.3 Normalized Dislocation Z-Score & State Machine
The normalized innovation spread z-score is:
$$Z_t = \frac{e_t}{\sqrt{S_t}}$$

| Regime | Condition | Directive | Action |
| :--- | :--- | :--- | :--- |
| **SPREAD_LONG_DISLOCATION_ENTRY** | $Z_t \le -2.0$ | `LONG_ASSET_Y_SHORT_BETA_X` | Buy $Y$, Short $\hat{\beta}_t$ units of $X$ |
| **SPREAD_SHORT_DISLOCATION_ENTRY** | $Z_t \ge +2.0$ | `SHORT_ASSET_Y_LONG_BETA_X` | Short $Y$, Buy $\hat{\beta}_t$ units of $X$ |
| **STRUCTURAL_BREAKDOWN_ABORT** | $|Z_t| \ge 4.5$ | `EMERGENCY_UNWIND_DECOUPLED_PAIR` | Cointegration relationship broken; abort pair exposure |
| **EQUILIBRIUM_HOLD_OR_UNWIND** | Otherwise | `MAINTAIN_NEUTRAL_POSITION` | Hold position or unwind if $|Z_t| \le 0.5$ |

---

## 3. Production Deployment & Verification

- **Service Location**: `python-bridge/services/pairs_kalman_filter_kernel.py`
- **Unit Tests**: `python-bridge/tests/test_pairs_kalman_filter_kernel.py`
- **Verification Result**: 4/4 Passing Tests in 0.05s.
- **PM2 Production Status**: Production ready.
