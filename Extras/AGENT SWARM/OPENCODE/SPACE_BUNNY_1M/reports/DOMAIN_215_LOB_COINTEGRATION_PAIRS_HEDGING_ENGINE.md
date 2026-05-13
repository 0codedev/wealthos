# Sovereign Swarm Architecture Blueprint: Domain 215 (WP-DM)
# High-Frequency Limit Order Book Co-Integration & Dynamic Pairs Hedging Engine

**Fabric Layer**: `python-bridge/services/lob_cointegration_pairs_hedging_engine.py`  
**Test Suite**: `python-bridge/tests/test_lob_cointegration_pairs_hedging_engine.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: Engle-Granger / Johansen Multi-Asset Cointegration, Continuous-Time Ornstein-Uhlenbeck (OU) Mean-Reversion Half-Life, Microstructure Half-Spread Crossing Barrier, Structural Breakdown Stop-Loss Sentry.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

In equity pairs trading and cross-asset stat-arb (e.g. HDFC Bank vs ICICI Bank, Nifty vs Bank Nifty, or Dual-Class Shares), raw asset prices follow geometric Brownian motion and are integrated of order 1 ($I(1)$). However, economic substitution ensures that a linear combination of log prices forms a stationary $I(0)$ mean-reverting spread:
$$S(t) = \ln P_1(t) - \beta \ln P_2(t) - \alpha$$

In ultra-high-frequency microstructure trading, naive pairs models fail because crossing the bid-ask spread on two separate legs incurs heavy transaction friction. The statistical deviation $|Z(t)|$ must clear both legs' half-spreads and exchange taker fees to generate positive net edge.

### 1.1 Ornstein-Uhlenbeck Mean-Reverting Spread Kernel

The spread follows a mean-reverting stochastic differential equation:
$$dS(t) = \theta (\mu - S(t)) dt + \sigma dW(t)$$

Calibrated in discrete time $\Delta t$ via AR(1) linear regression:
$$S_t = a + b S_{t-1} + \epsilon_t$$
Where:
- Mean-reversion speed: $\theta = -\frac{\ln b}{\Delta t}$
- Long-term equilibrium: $\mu = \frac{a}{1 - b}$
- Equilibrium spread variance: $\sigma_{\text{eq}} = \frac{\sigma_\epsilon}{\sqrt{1 - b^2}}$
- Mean-reversion half-life: $\tau_{1/2} = \frac{\ln 2}{\theta}$

### 1.2 Microstructure Half-Spread Crossing Barrier

Entry is permitted only when expected gross edge exceeds aggregate crossing friction:
$$\text{Friction}_{\text{bps}} = \left( \frac{\frac{1}{2}S_1^{\text{spread}}}{P_1} + \frac{\frac{1}{2}S_2^{\text{spread}}}{P_2} \right) \times 10000 + 2 \times \text{Fee}_{\text{taker}}$$
$$\text{GrossEdge}_{\text{bps}} = |Z(t)| \cdot \sigma_{\text{eq}} \times 10000$$
$$\text{NetEdge}_{\text{bps}} = \text{GrossEdge}_{\text{bps}} - \text{Friction}_{\text{bps}} > 0$$

Where the normalized $Z$-Score is:
$$Z(t) = \frac{S(t) - \mu}{\sigma_{\text{eq}}}$$

---

## 2. Market Regimes & Tactical Directives

1. **`SPREAD_EQUILIBRIUM`** ($|Z(t)| < 1.0$):
   - Spread is resting within its normal statistical equilibrium band.
   - Action: `STANDBY_PASSIVE` or `CLOSE_PAIR_TAKE_PROFIT` (if already holding inventory).
2. **`LONG_SPREAD_OPPORTUNITY`** ($Z(t) \le -2.0$, $\tau_{1/2} \le 120\text{s}$, $\text{NetEdge} > 0$):
   - Leg 1 is statistically underpriced relative to Leg 2.
   - Action: `ENTER_LONG_SPREAD`. Buy Leg 1, short $\beta$ Leg 2.
3. **`SHORT_SPREAD_OPPORTUNITY`** ($Z(t) \ge +2.0$, $\tau_{1/2} \le 120\text{s}$, $\text{NetEdge} > 0$):
   - Leg 1 is statistically overpriced relative to Leg 2.
   - Action: `ENTER_SHORT_SPREAD`. Short Leg 1, buy $\beta$ Leg 2.
4. **`COINTEGRATION_BREAKDOWN`** ($|Z(t)| \ge 4.5$ or $\tau_{1/2} > 300\text{s}$):
   - Relationship has structurally decoupled due to earnings, regulatory actions, or corporate default.
   - Action: `EMERGENCY_UNWIND_STOP`. Immediately sever both legs to prevent catastrophic trending divergence.

---

## 3. Verification & Validation Metrics

- Unit tests (`tests/test_lob_cointegration_pairs_hedging_engine.py`):
  - Ornstein-Uhlenbeck calibration verifies mean-reverting speed ($\theta > 0.05$) and short half-life ($< 20$s).
  - Centered spread quotes trigger `SPREAD_EQUILIBRIUM` and passive holding posture.
  - Undervalued Leg 1 dip triggers $Z \le -2.0$, `LONG_SPREAD_OPPORTUNITY`, and dollar-neutral allocation.
  - Overvalued Leg 1 spike triggers $Z \ge +2.0$, `SHORT_SPREAD_OPPORTUNITY`, and short leg entry.
  - Extreme 5-sigma breakout triggers `COINTEGRATION_BREAKDOWN` and emergency stop.
