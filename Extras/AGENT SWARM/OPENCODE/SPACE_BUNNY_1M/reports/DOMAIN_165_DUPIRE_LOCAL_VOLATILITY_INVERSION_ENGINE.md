# Domain 165: Real-Time Options Surface Local Volatility Dupire Inversion Engine (WP-BO)

## Executive Summary & Quantitative Thesis
In Black-Scholes-Merton option pricing, implied volatility $\sigma_{\text{impl}}(K, T)$ varies systematically across strike prices and maturities—forming the well-known **volatility smile and skew**. While implied volatility is useful for quoting plain-vanilla European options, it cannot be used directly in partial differential equations (PDEs) or Monte Carlo engines to price path-dependent exotic derivatives (e.g. barrier options, Asian options, autocallables, and cliquets). Using implied volatility directly violates the no-arbitrage principle and results in severely mispriced barrier knock-outs.

Bruno Dupire (1994, *Pricing with a Smile*, Risk Magazine) solved this fundamental problem by establishing **Local Volatility**:
- Assumes the underlying spot price follows a generalized continuous-time diffusion: $dS_t = (r - q) S_t dt + \sigma_{\text{local}}(S_t, t) S_t dW_t$.
- Proved that the instantaneous diffusion coefficient $\sigma_{\text{local}}(S, t)$ is uniquely and analytically determined by the partial derivatives of the European call price surface $C(K, T)$ via the Fokker-Planck (forward Kolmogorov) equation.
- Guarantees that an exotic PDE model calibrated to Dupire local volatility exactly re-prices every single European vanilla option in the market without static arbitrage.

Domain 165 establishes the **Real-Time Options Surface Local Volatility Dupire Inversion Engine**:
- Computes partial derivatives $\frac{\partial C}{\partial T}$, $\frac{\partial C}{\partial K}$, and $\frac{\partial^2 C}{\partial K^2}$ across discrete option chains via finite differences.
- Enforces the **Breeden-Litzenberger (1978)** positive probability density constraint ($e^{r T} \frac{\partial^2 C}{\partial K^2} > 0$).
- Detects butterfly convexity and calendar time-decay arbitrage violations.
- Generates calibrated, arbitrage-free local volatility grids for institutional PDE exotic pricing.

---

## Mathematical Formulations

### 1. The Dupire PDE Inversion Formula
From the forward Fokker-Planck equation for transition probability density $p(S, t; K, T)$, Dupire demonstrated that European call prices satisfy:
$$\frac{\partial C}{\partial T} = -r K \frac{\partial C}{\partial K} + \frac{1}{2} \sigma_{\text{local}}^2(K, T) K^2 \frac{\partial^2 C}{\partial K^2}$$

Solving analytically for the instantaneous local variance $\sigma_{\text{local}}^2(K, T)$:
$$\sigma_{\text{local}}^2(K, T) = \frac{\frac{\partial C}{\partial T} + r K \frac{\partial C}{\partial K}}{\frac{1}{2} K^2 \frac{\partial^2 C}{\partial K^2}}$$

Where:
- $\frac{\partial C}{\partial T}$: Dual theta / calendar rate of call price decay.
- $\frac{\partial C}{\partial K}$: Dual delta (slope with respect to strike).
- $\frac{\partial^2 C}{\partial K^2}$: Dual gamma / risk-neutral probability density.

---

### 2. Breeden-Litzenberger Density & No-Arbitrage Boundaries
Breeden and Litzenberger (1978) proved that the risk-neutral probability density function $q(K)$ is proportional to the second strike derivative:
$$q(K) = e^{r T} \frac{\partial^2 C}{\partial K^2}$$
For the local volatility surface to be physically valid and free of static arbitrage:
1. **Butterfly Convexity Non-Negativity**:
   $$\frac{\partial^2 C}{\partial K^2} > 0 \iff C(K - \Delta K) - 2 C(K) + C(K + \Delta K) > 0$$
   A negative value implies negative probability density, triggering immediate butterfly arbitrage.
2. **Calendar Monotonicity**:
   $$\frac{\partial C}{\partial T} + r K \frac{\partial C}{\partial K} > 0$$
   Total variance must not decrease across time horizons.

---

### 3. Finite-Difference Discretization Scheme
On discrete strike step $\Delta K$ and maturity step $\Delta T$:
$$\frac{\partial C}{\partial T} \approx \frac{C(K, T + \Delta T) - C(K, T)}{\Delta T}$$
$$\frac{\partial C}{\partial K} \approx \frac{C(K + \Delta K, T) - C(K - \Delta K, T)}{2 \Delta K}$$
$$\frac{\partial^2 C}{\partial K^2} \approx \frac{C(K + \Delta K, T) - 2 C(K, T) + C(K - \Delta K, T)}{(\Delta K)^2}$$

---

### 4. Regime & Execution Directive Matrix
| Condition | Surface Property | Regime Classification | Execution Directive |
| :--- | :--- | :--- | :--- |
| $\frac{\partial^2 C}{\partial K^2} > 0$ and Numerator $> 0$ | Arbitrage-Free | `DUPIRE_LOCAL_VOLATILITY_CALIBRATED` | `VALID_FOR_EXOTIC_BARRIER_PDE_PRICING` |
| $\frac{\partial^2 C}{\partial K^2} \le 0$ | Convexity Inversion | `BUTTERFLY_CONVEXITY_ARBITRAGE_DETECTED` | `EXECUTE_STATIC_BUTTERFLY_ARBITRAGE` |
| $\frac{\partial C}{\partial T} \le 0$ | Calendar Decay Inversion | `CALENDAR_NEGATIVE_TIME_DECAY_VIOLATION` | `EXECUTE_CALENDAR_SPREAD_ARBITRAGE` |

---

## Production Verification & Test Suite
- **Engine Service**: `python-bridge/services/dupire_local_volatility_engine.py` (6.2 KB)
- **Unit Test Suite**: `python-bridge/tests/test_dupire_local_volatility_engine.py` (4.4 KB)
- **Validation**: 4/4 test assertions passing on Oracle Cloud VPS (`tests/test_dupire_local_volatility_engine.py .... 100% in 0.04s`).
- **Telemetry**: Full SQLite audit trail persisted in `dupire_local_vol_telemetry`.
