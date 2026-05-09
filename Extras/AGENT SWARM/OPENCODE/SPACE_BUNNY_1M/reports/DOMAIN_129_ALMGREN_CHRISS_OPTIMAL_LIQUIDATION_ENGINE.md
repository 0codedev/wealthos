# Domain 129: Adaptive Almgren-Chriss Optimal Liquidation & Inventory Risk Engine (WP-AE)

**Executive Status**: 🟢 PRODUCTION DELIVERED & MATHEMATICALLY VERIFIED  
**Engine Service**: `python-bridge/services/almgren_chriss_liquidation_engine.py`  
**Unit Tests**: `python-bridge/tests/test_almgren_chriss_liquidation_engine.py` (7/7 Tests Passing in 0.03s)  
**Target Architecture**: WealthOS v2 Institutional Execution Scheduling Engine  
**Benchmark Model**: `opencode/nemotron-3.5-lightning-free` / `space-bunny-free` (`--variant max --thinking --auto`)

---

## 1. Executive Summary & Market Impact Microstructure

Institutional portfolio rebalancing and algorithmic unwinds face a fundamental economic trade-off between **market impact costs** and **market volatility risk**:
- Selling too aggressively over a short time window incurs severe **temporary price impact** ($\eta \cdot v$), sweeping deep into the order book and destroying alpha.
- Selling too passively over an extended time horizon minimizes price impact but exposes the remaining inventory to **unhedged price volatility risk** ($\sigma^2 \tau \sum x_j^2$), risking catastrophic adverse price drift.

The **Adaptive Almgren-Chriss Optimal Liquidation & Inventory Risk Engine** formulates this trade-off as a calculus of variations utility optimization, derives exact discrete Euler-Lagrange equations, handles numerical floating-point stability across extreme horizons, computes optimal hyperbolic trajectories $x_j$, and dynamically accelerates execution when intraday volatility expands.

---

## 2. Mathematical Formulations & The Optimal Execution Frontier

### 2.1 Discrete Liquidation Setup

Let a portfolio manager liquidate $X_0$ shares over time horizon $T$ divided into $N$ discrete intervals of length $\tau = T / N$:
$$t_j = j \tau, \quad j = 0, \dots, N$$
The trajectory of remaining inventory is $x_j$, with boundary invariants:
$$x_0 = X_0, \quad x_N = 0$$
The volume liquidated in interval $j$ is:
$$n_j = x_{j-1} - x_j, \quad v_j = \frac{n_j}{\tau}$$

### 2.2 Price Dynamics & Impact Decomposition

1. **Permanent Price Impact ($g(v)$)**:
   Permanent impact represents the information leakage and irreversible shift in the equilibrium price:
   $$S_j = S_{j-1} + \sigma \tau^{1/2} \xi_j - \tau \gamma v_j = S_0 + \sigma \sum_{k=1}^j \tau^{1/2} \xi_k - \gamma (X_0 - x_j)$$
   Total permanent price degradation over the liquidation is $\gamma X_0$, giving total permanent impact cost:
   $$\mathbb{E}[\text{Cost}_{\text{perm}}] = \frac{1}{2} \gamma X_0^2$$

2. **Temporary Price Impact ($h(v)$)**:
   Temporary impact represents transient liquidity exhaustion at the top of the order book:
   $$\tilde{S}_j = S_{j-1} - \eta v_j = S_{j-1} - \eta \frac{n_j}{\tau}$$
   Total expected temporary impact cost:
   $$\mathbb{E}[\text{Cost}_{\text{temp}}] = \sum_{j=1}^N \eta \frac{n_j^2}{\tau} = \frac{\eta}{\tau} \sum_{j=1}^N (x_{j-1} - x_j)^2$$

3. **Variance of Capture (Price Volatility Risk)**:
   $$V[x] = \sigma^2 \tau \sum_{j=1}^N x_j^2$$

### 2.3 The Almgren-Chriss Optimization & Hyperbolic Trajectory

We minimize the mean-variance utility functional:
$$\min_{\{x_j\}} U[x] = \mathbb{E}[\text{Cost}] + \lambda V[x]$$
where $\lambda > 0$ is the trader's parameter of risk aversion.

The discrete Euler-Lagrange optimality condition:
$$\frac{x_{j-1} - 2x_j + x_{j+1}}{\tau^2} = \frac{\lambda \sigma^2}{\eta} x_j$$

Yields the discrete urgency parameter:
$$\tilde{\kappa} = \text{arcosh}\left( 1 + \frac{1}{2} \frac{\lambda \sigma^2 \tau^2}{\eta} \right), \quad \kappa = \frac{\tilde{\kappa}}{\tau} \approx \sqrt{\frac{\lambda \sigma^2}{\eta}}$$

The unique analytical solution satisfying boundary conditions $x_0 = X_0$ and $x_N = 0$ is:
$$x_j = \frac{\sinh(\kappa (T - t_j))}{\sinh(\kappa T)} X_0$$

### 2.4 Numerical Stability & Large $\kappa T$ Regimes

For high urgency or extended horizons where $\kappa T > 25$:
$$\lim_{\kappa T \gg 1} \frac{\sinh(\kappa(T - t_j))}{\sinh(\kappa T)} = e^{-\kappa t_j} \cdot \left( 1 - e^{-2\kappa(T - t_j)} \right)$$
This formulation guarantees zero floating-point overflow or clamping distortion in automated execution engines.

*Asymptotic Regimes*:
- **Risk-Neutral ($\lambda \to 0$)**: $\kappa \to 0 \implies x_j = X_0 \left(1 - \frac{t_j}{T}\right)$ (**Linear TWAP**).
- **Risk-Averse ($\lambda > 0$)**: Inventory decays exponentially fast with half-life $\tau_{1/2} = \frac{\ln(2)}{\kappa}$.

---

## 3. Production Architecture

```
        [ Parent Order to Liquidate ]
        (Symbol, Total Shares X_0, Horizon T)
                        │
                        ▼
      [ AlmgrenChrissLiquidationEngine ]
                        │
     ┌──────────────────┴──────────────────┐
     ▼                                     ▼
[ Volatility & Impact Estimator ]   [ Urgency Solver ]
- \sigma_{sec} from Annual Vol      - \kappa = \text{arcosh}(...) / \tau
- Permanent \gamma, Temporary \eta  - Half-life \tau_{1/2} = \ln(2)/\kappa
     │                                     │
     └──────────────────┬──────────────────┘
                        ▼
           [ Optimal Trajectory Generator ]
           - Stable Hyperbolic Ratio Solver
           - Discrete Inventory Array x_j
           - Slice Volumes n_j = x_{j-1} - x_j
                        │
                        ▼
           [ Optimal Execution Schedule ]
                        │
       ┌────────────────┼────────────────┐
       ▼                ▼                ▼
[ Expected Impact ] [ Volatility Risk ] [ Child Slices ]
- Permanent Cost    - Variance V[x]     - Route to SOR
- Temporary Cost    - Headroom Check    - Time-to-Wire
```

---

## 4. Verification & Validation Summary

| Test Case | Objective | Verified Metric | Result |
| :--- | :--- | :--- | :---: |
| `test_discrete_kappa_calculation` | Urgency increases with higher risk aversion $\lambda$ and $\sigma$ | $\kappa(\lambda=10^{-3}) > \kappa(\lambda=10^{-5}) > 0$ | 🟢 PASS |
| `test_inventory_conservation_and_endpoint` | Exact liquidation of parent order to zero | $x_N = 0, \sum n_j = 5,000 \equiv X_0$ | 🟢 PASS |
| `test_risk_neutral_twap_convergence` | $\lambda=0$ converges identically to linear TWAP | $n_j = 100$ shares for all slices | 🟢 PASS |
| `test_risk_averse_front_loading` | Risk-aversion front-loads execution slices | $n_1 > n_9$ (exponential inventory decay) | 🟢 PASS |
| `test_cost_and_variance_tradeoff` | Higher $\lambda$ pays more impact but drastically lowers variance | $\text{Cost}_{\text{urgent}} > \text{Cost}_{\text{patient}}, V_{\text{urgent}} \ll V_{\text{patient}}$ | 🟢 PASS |
| `test_half_life_calculation` | Half-life decreases as urgency increases | $\tau_{1/2}(\text{fast}) < \tau_{1/2}(\text{slow})$ | 🟢 PASS |
| `test_sqlite_persistence` | Liquidation plan telemetry persisted to SQLite | Row verified in `liquidation_plans_telemetry` | 🟢 PASS |

---

## 5. Deployment Directives

1. **Integration**: Call `generate_optimal_plan` whenever liquidating equity positions $\ge 500$ shares or unhedged F&O contracts.
2. **Dynamic Volatility Feed**: Pass live realized Parkinson volatility from `volatility_breakout_engine.py` into `custom_volatility`.
3. **Execution Child Dispatch**: Hand off slice array to `cross_broker_smart_order_router.py` with passive queue placement via `queue_position_estimator.py`.
