# Sovereign Quantitative Architecture Report: Domain 277 (WP-FW)
# High-Frequency Limit Order Book Order Flow Imbalance (OFI) Multi-Level Ridge Predictor

**Agent Role**: High-Frequency Market Microstructure & Order Book Flow Architect (Opencode Sovereign Swarm)  
**Execution Target**: Multi-Level OFI Vector & Regularized Ridge Price Impact Predictor  
**Status**: 🟢 Production Ready & Validated  
**Test Suite**: 5/5 Passing Unit Tests  

---

## 1. Executive Summary & Microstructure Mechanics

In electronic continuous double auction markets, instantaneous price changes are driven by net transitions in limit order book queues rather than transaction volumes alone. 

While classical Level-1 Order Flow Imbalance (OFI) introduced by Cont, Kukanov & Stoikov (2014) captures only top-of-book replenishment and cancellation, modern institutional participants deploy multi-level algorithmic execution across levels 1 through $K$ (Xu et al. 2021). 

Relying solely on top-of-book metrics leaves market-making desks blind to deeper queue build-ups and cancellations. The **Multi-Level OFI Ridge Predictor**:
1. Formulates depth-aware OFI vectors $OFI_k(t)$ for each book level $k \in \{1, \dots, K\}$.
2. Trains regularized Ridge regression $\hat{\boldsymbol{\beta}} = (\mathbf{X}^T \mathbf{X} + \lambda \mathbf{I})^{-1} \mathbf{X}^T \mathbf{y}$ to isolate the marginal price impact of each level without collinearity instability.
3. Quantifies normalized flow toxicity $Z_{\text{OFI}}$ to trigger preemptive maker quote cancellations and momentum sweeps before adverse selection occurs.

---

## 2. Mathematical Formulation & Architecture

### 2.1 Multi-Level OFI Vector Decomposition
For each level $k$, let $(P_{b,k}(t), q_{b,k}(t))$ and $(P_{a,k}(t), q_{a,k}(t))$ denote bid and ask prices and sizes. The net level flow is:
$$OFI_k(t) = e_{b,k}(t) - e_{a,k}(t)$$
where:
$$e_{b,k}(t) = \begin{cases} q_{b,k}(t) & \text{if } P_{b,k}(t) > P_{b,k}(t-1) \\ q_{b,k}(t) - q_{b,k}(t-1) & \text{if } P_{b,k}(t) = P_{b,k}(t-1) \\ -q_{b,k}(t-1) & \text{if } P_{b,k}(t) < P_{b,k}(t-1) \end{cases}$$
$$e_{a,k}(t) = \begin{cases} -q_{a,k}(t) & \text{if } P_{a,k}(t) < P_{a,k}(t-1) \\ q_{a,k}(t) - q_{a,k}(t-1) & \text{if } P_{a,k}(t) = P_{a,k}(t-1) \\ q_{a,k}(t-1) & \text{if } P_{a,k}(t) > P_{a,k}(t-1) \end{cases}$$

### 2.2 Regularized Ridge Price Impact Model
The short-horizon mid-price delta $\Delta P_{t+\tau}$ is modeled via regularized normal equations:
$$\widehat{\Delta P}_t = \sum_{k=1}^K \hat{\beta}_k OFI_k(t)$$
$$\hat{\boldsymbol{\beta}} = (\mathbf{X}^T \mathbf{X} + \lambda N \mathbf{I})^{-1} \mathbf{X}^T \mathbf{y}$$
where $\lambda$ penalizes overfitting and accommodates high correlation across adjacent queue levels.

### 2.3 Execution Directives & Toxic Flow Protection

| Regime | Condition | Directive | Action |
| :--- | :--- | :--- | :--- |
| **TOXIC_BUY_ASSAULT** | $Z_{\text{OFI}} \ge +2.5$ | `PULL_ASKS_SNIPE_BUY` | Evacuate maker ask quotes to avert adverse selection pickoff; ride momentum long |
| **TOXIC_SELL_CASCADE** | $Z_{\text{OFI}} \le -2.5$ | `PULL_BIDS_SNIPE_SELL` | Evacuate maker bid quotes to avert dump fill; ride downward cascade |
| **MODERATE_DIRECTIONAL_SKEW** | $1.0 \le \|Z_{\text{OFI}}\| < 2.5$ | `SKEW_SPREAD_ASYMMETRIC` | Lean spread asymmetrically by $\pm 1.5$ bps against incoming flow |
| **BALANCED_EQUILIBRIUM** | $\|Z_{\text{OFI}}\| < 1.0$ | `SYMMETRIC_MARKET_MAKING` | Normal tight two-sided maker quotes maintained |

---

## 3. Production Deployment & Verification

- **Service Location**: `python-bridge/services/lob_ofi_ridge_predictor.py`
- **Unit Tests**: `python-bridge/tests/test_lob_ofi_ridge_predictor.py`
- **Verification Result**: 5/5 Passing Tests in 0.04s.
- **PM2 Production Status**: Fully operational alongside `alpha-backend` and `wealthos-alpha-daemon`.
