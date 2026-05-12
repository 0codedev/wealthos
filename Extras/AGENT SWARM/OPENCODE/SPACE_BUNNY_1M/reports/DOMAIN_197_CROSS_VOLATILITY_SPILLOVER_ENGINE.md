# Sovereign Swarm Architecture Blueprint: Domain 197 (WP-CU)
# Multi-Horizon Cross-Correlation & Volatility Spillover Lead-Lag Engine

**Fabric Layer**: `python-bridge/services/cross_volatility_spillover_engine.py`  
**Test Suite**: `python-bridge/tests/test_cross_volatility_spillover_engine.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: Diebold-Yilmaz (2012) Generalized VAR Spillover Decomposition, Pesaran-Shin (1998) GFEVD, Asymmetric Cross-Correlation Lead-Lag Filter.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

In multi-asset volatility surfaces, cross-market information transmission is fundamentally asymmetric. Shock propagation between lead indices (e.g., US equity tech, macro rates, global energy) and secondary markets (e.g., NIFTY, BANKNIFTY, FINNIFTY) follows directional lag dynamics. Classical symmetric correlation matrices fail to capture:
1. **Directionality**: Distinguishing whether Asset $A$ is transmitting volatility to Asset $B$ or vice versa.
2. **Horizon Sensitivity**: Shocks in liquidity dissipate over micro-windows ($H=2..5$), while macro variance cascades sustain over macro horizons ($H=10..30$).
3. **Contagion Thresholds**: When market-wide Total Spillover Index (TSI) crosses critical tipping points, diversification collapses and cross-market liquidation spirals emerge.

### 1.1 Generalized VAR & GFEVD Formulation
Let $y_t = [\log \sigma_{1,t}^2, \log \sigma_{2,t}^2, \dots, \log \sigma_{N,t}^2]^T$ be the $N \times 1$ vector of log-realized variances. We fit a regularized vector autoregression:
$$y_t = \mathbf{\Phi} y_{t-1} + \epsilon_t, \quad \epsilon_t \sim \mathcal{N}(\mathbf{0}, \mathbf{\Sigma})$$
Via the Wold decomposition, the moving average representation is:
$$y_t = \sum_{h=0}^\infty \mathbf{A}_h \epsilon_{t-h}, \quad \mathbf{A}_h = \mathbf{\Phi}^h$$

Following Pesaran & Shin (1998) and Diebold & Yilmaz (2012), the Generalized Forecast Error Variance Decomposition (GFEVD) at horizon $H$ is invariant to Cholesky variable ordering:
$$\theta_{ij}^g(H) = \frac{\sigma_{jj}^{-1} \sum_{h=0}^{H-1} (\mathbf{e}_i^T \mathbf{A}_h \mathbf{\Sigma} \mathbf{e}_j)^2}{\sum_{h=0}^{H-1} (\mathbf{e}_i^T \mathbf{A}_h \mathbf{\Sigma} \mathbf{A}_h^T \mathbf{e}_i)}$$
Normalizing row sums to unity yields the directional spillover shares:
$$\tilde{\theta}_{ij}(H) = \frac{\theta_{ij}^g(H)}{\sum_{k=1}^N \theta_{ik}^g(H)}, \quad \sum_{j=1}^N \tilde{\theta}_{ij}(H) = 1.0$$

### 1.2 Directional & Total Spillover Metrics
- **Spillover Transmitted TO Others**:
  $$S_{i \to \bullet}(H) = \sum_{j \ne i} \tilde{\theta}_{ji}(H) \times \frac{100}{N}$$
- **Spillover Imported FROM Others**:
  $$S_{\bullet \to i}(H) = \sum_{j \ne i} \tilde{\theta}_{ij}(H) \times \frac{100}{N}$$
- **Net Volatility Spillover Metric**:
  $$\text{NetSpillover}_i(H) = S_{i \to \bullet}(H) - S_{\bullet \to i}(H)$$
  - $\text{NetSpillover}_i > 0$: **Net Transmitter** (Market Maker / Volatility Exporter).
  - $\text{NetSpillover}_i < 0$: **Net Receiver** (Volatility Absorber).
- **Total Spillover Index (TSI)**:
  $$S(H) = \frac{\sum_{i=1}^N \sum_{j \ne i} \tilde{\theta}_{ij}(H)}{N} \times 100\%$$

---

## 2. High-Frequency Lead-Lag Cross-Correlation Kernel

To resolve discrete tick-time execution delays between interconnected assets, the engine calculates the asymmetric cross-correlation spectrum:
$$\rho_{ij}(\tau) = \frac{\sum_t (r_{i,t} - \bar{r}_i)(r_{j,t+\tau} - \bar{r}_j)}{\sqrt{\sum_t (r_{i,t} - \bar{r}_i)^2 \sum_t (r_{j,t+\tau} - \bar{r}_j)^2}}, \quad \tau \in [-L, +L]$$

$$\tau^* = \arg\max_\tau |\rho_{ij}(\tau)|, \quad \mathcal{A}_{ij} = \frac{\sum_{\tau > 0} |\rho_{ij}(\tau)|}{\sum_{\tau < 0} |\rho_{ij}(\tau)|}$$
When $\tau^* > 0$ and $\mathcal{A}_{ij} > 1.2$, Asset $i$ is verified to systematically lead Asset $j$ by $\tau^*$ periods.

---

## 3. Sovereign Trading & Execution Directives

1. **Anticipatory Delta / Gamma Pre-Hedging**:
   - When a primary transmitter (e.g. US Tech or Bank Index) exhibits a $Z > 2.5$ volatility surge, the engine dispatches preemptive protective hedges to receiver assets before the lag window ($\tau^*$ ticks) expires.
2. **Systemic Contagion Sentry**:
   - If $\text{TSI} \ge 60\%$, activate `ELEVATED` caution; widen market maker quotes by $1.8\times$.
   - If $\text{TSI} \ge 75\%$, trigger `CRISIS_CASCADE`; contract inventory holding periods by $50\%$ and engage crash collars.
3. **Cross-Asset Volatility Arbitrage**:
   - Sell overpriced implied volatility on lagged receivers when transmission decay has saturated.

---

## 4. Verification & Validation Metrics

- Unit tests (`tests/test_cross_volatility_spillover_engine.py`):
  - Row normalization strictly invariant: $\sum_j \tilde{\theta}_{ij} = 1.00000 \pm 10^{-5}$.
  - Synthetic lead-lag detection verifies $\tau^* = 2$ with $\rho > 0.70$ and $\mathcal{A} > 1.20$.
  - Zero-exception numerical inversion with ridge-regularized cross-moment matrix.
