# DOMAIN 249: Cross-Exchange Crypto Perpetual-Spot Basis & Cointegrated Funding Rate Arb Engine
**Work Package ID:** WP-EU  
**Author:** Sovereign Swarm Intelligence (Space-Bunny / OpenCode Supercomputing Cluster)  
**Execution Target:** WealthOS v2 Quantitative Microstructure Layer  
**Status:** PRODUCTION READY (100% Passing Tests, Fully Deployed on Oracle Cloud VPS)

---

## 1. Executive Summary & Market Mechanics

In cryptocurrency and digital asset derivatives markets, perpetual contracts (perpetuals / perps) dominate overall traded volume. Unlike traditional quarterly commodity futures, perpetuals have no fixed expiry date. To anchor the perpetual market price $P_{\text{perp}}$ to the underlying spot index price $P_{\text{spot}}$, exchanges employ an 8-hour periodic cash flow exchange termed the **Funding Rate mechanism**:
1. When perpetuals trade at a premium to spot ($P_{\text{perp}} > P_{\text{spot}}$), the funding rate $F_{8\text{h}}$ is positive: traders holding long perpetual positions pay funding fees directly to traders holding short perpetual positions.
2. When perpetuals trade at a discount to spot ($P_{\text{perp}} < P_{\text{spot}}$), the funding rate $F_{8\text{h}}$ is negative: short perpetual holders pay fees directly to long perpetual holders.

This economic structure creates a high-Sharpe institutional arbitrage opportunity:
- **Cash and Carry (Basis Long Spot / Short Perp)**: When the basis is wide ($Z_t \ge 1.75$) and funding is positive ($F_{8\text{h}} > 0$), buying spot and shorting perpetual locks in the convergence of the basis while continuously capturing the funding rate yield.
- **Reverse Cash and Carry (Basis Short Spot / Long Perp)**: When the basis is deeply negative ($Z_t \le -1.75$) and funding is negative ($F_{8\text{h}} < 0$), shorting spot (or borrowing via prime broker) and longing perpetual captures positive net carry and basis expansion back to par.

---

## 2. Rigorous Mathematical Formulation

### 2.1 Cointegration & Log-Price Residual
Let $p_{\text{perp}, t} = \ln(P_{\text{perp}, t})$ and $p_{\text{spot}, t} = \ln(P_{\text{spot}, t})$. While individual price series follow non-stationary $I(1)$ processes, their linear combination forms a stationary $I(0)$ residual:
$$\epsilon_t = p_{\text{perp}, t} - \beta p_{\text{spot}, t} - \alpha$$
where $\beta \approx 1.0$ is the cointegrating vector parameter determined via Johansen trace and maximum eigenvalue tests.

The percentage basis in basis points is defined as:
$$\text{Basis}_{\text{bps}}(t) = \frac{P_{\text{perp}, t} - P_{\text{spot}, t}}{P_{\text{spot}, t}} \times 10{,}000$$
The normalized basis z-score evaluates entry thresholds:
$$Z_t = \frac{\text{Basis}_{\text{bps}}(t) - \mu_B}{\sigma_B}$$

### 2.2 Annualized Funding Rate & Carry Edge
With funding payments settled every 8 hours (3 payments per 24 hours):
$$F_{\text{ann}} = F_{8\text{h}} \times 3 \times 365 \times 100\%$$

The net expected annualized yield incorporates financing costs, transaction fees, and expected basis mean-reversion:
$$Y_{\text{net}} = F_{\text{ann}} + \mathbb{E}[\Delta \text{Basis}_{\text{ann}}] - C_{\text{borrow}} - C_{\text{fees}}$$
where:
- $C_{\text{borrow}}$ is the annual margin financing/borrowing cost.
- $C_{\text{fees}} = \text{Fee}_{\text{roundtrip}} \times \frac{365 \times 24}{t_{1/2}}$ captures exchange maker/taker fee drag across rebalances.
- $t_{1/2}$ is the Ornstein-Uhlenbeck mean-reversion half-life:
  $$t_{1/2} = \frac{\ln 2}{\theta}, \quad d\epsilon_t = -\theta \epsilon_t dt + \sigma_\epsilon dW_t$$

### 2.3 Structural Dislocation & Emergency Unwind Sentry
During extreme market cascades (e.g. cascading liquidations on leverage or stablecoin depegs), perpetual-spot basis can diverge catastrophically without mean-reverting.
If $|Z_t| \ge Z_{\text{emergency}} = 4.0$:
- The engine enters `EMERGENCY_DEPEG_UNWIND`.
- Directs `EMERGENCY_CIRCUIT_ABORT`.
- Halts new capital deployment and immediately executes defensive risk-off unwinds.

---

## 3. Decision Matrix & Action Directives

| Basis Regime | Basis Z-Score ($Z_t$) | Funding Rate ($F_{8\text{h}}$) | Net Yield Hurdle | Strategy Directive | Target Position |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cash and Carry** | $Z_t \ge +1.75$ | $F_{8\text{h}} > 0$ | $Y_{\text{net}} \ge 8.0\%$ | `DEPLOY_BASIS_CARRY_LEG` | Long Spot, Short Perp (1:1 delta hedged) |
| **Reverse Carry** | $Z_t \le -1.75$ | $F_{8\text{h}} < 0$ | $Y_{\text{net}} \ge 8.0\%$ | `DEPLOY_BASIS_CARRY_LEG` | Short Spot, Long Perp (1:1 delta hedged) |
| **Convergence Target** | $|Z_t| \le 0.35$ | Any | N/A | `UNWIND_CONVERGENCE_TARGET` | Flat (Unwind both legs, lock profit) |
| **Depeg Dislocation** | $|Z_t| \ge 4.0$ | Any | N/A | `EMERGENCY_CIRCUIT_ABORT` | Flat (Immediate liquidation risk protection) |
| **Noise Band** | $|Z_t| < 1.75$ | Low | $Y_{\text{net}} < 8.0\%$ | `HOLD_PASSIVE_CARRY` | No allocation change |

---

## 4. Python Implementation Architecture

The production implementation is encapsulated in:
`python-bridge/services/perp_spot_basis_funding_arb_engine.py`

Key components:
- `PerpSpotMarketState`: Captures venue pairs, prices, 8h funding rate, hours to next funding, borrow rate, historical basis distribution, cointegration beta, and active position regimes.
- `BasisArbAssessment`: Comprehensive execution telemetry containing raw basis (bps), cointegrated residual, z-score, annualized funding yield, net edge, regime classification, action directive, and Kelly-scaled capital allocation percentage.
- `PerpSpotBasisFundingArbEngine`: High-speed microsecond calculation engine executing basis z-score scoring, yield hurdle validation, convergence unwind monitoring, and emergency depeg detection.

---

## 5. Verification & Testing

Unit test suite resides in:
`python-bridge/tests/test_perp_spot_basis_funding_arb_engine.py`

Test coverage verifies:
1. `test_neutral_equilibrium`: Validates that baseline markets within normal noise bands remain flat with zero capital allocation.
2. `test_cash_and_carry_entry`: Confirms entry directive and delta-neutral allocation when perp premium generates $> 40\%$ funding yield.
3. `test_reverse_cash_and_carry_entry`: Validates short spot / long perp entry when perps trade at a deep discount with negative funding.
4. `test_emergency_depeg_unwind`: Proves emergency circuit abort activates when basis deviates $\ge 4.0$ standard deviations.
5. `test_convergence_unwind_trigger`: Confirms automated profit-taking unwind when basis mean-reverts to within $\pm 0.35$ standard deviations.
