# Domain 144: Liquidity-Adjusted Value at Risk (LVaR) & Optimal Liquidation Horizon Sieve (WP-AT)

## Executive Summary & Quantitative Thesis
Standard institutional risk systems (such as classical Parametric, Historical, or Monte Carlo Value at Risk) are predicated on a lethal, unstated assumption: that a trading desk can liquidate its entire portfolio instantaneously at prevailing mid-market quotes with zero friction.

In real-world institutional operations—particularly in high-notional equity and F&O trading across Indian exchanges (NSE)—liquidation incurs two unavoidable friction costs:
1. **Exogenous Liquidity Risk**: The immediate bid-ask spread hurdle, which itself expands stochastically during high-stress liquidity drawdowns (Bangia et al., 1999).
2. **Endogenous Market Impact Risk**: The adverse price concession caused by the trader's own execution flow eating through the limit order book (Almgren-Chriss, 2000; Kyle-Obizhaeva, 2016).

If a risk system forces a rapid liquidation of an oversized position, market impact explodes inversely with the execution duration ($1/\sqrt{T}$). Conversely, if the trader stretches execution over too long a horizon, the position remains exposed to ongoing market volatility ($\sqrt{T}$).

Domain 144 establishes the **Liquidity-Adjusted Value at Risk (LVaR) & Optimal Liquidation Horizon Sieve**, resolving this tension:
- Formulates a unified, analytical LVaR model capturing stochastic spread and square-root price impact.
- Derives the closed-form **Optimal Liquidation Horizon $T^*$** that minimizes the total risk frontier.
- Enforces an institutional 1-day overnight holding risk floor and calculates the **Liquidity Haircut Multiplier ($\Lambda$)**, gating execution routing and dynamic margin buffer escalations.

---

## Mathematical Formulations

### 1. Pure Market Risk (Classical VaR)
For a position value $V_{\text{pos}} = Q \cdot P$ with daily return volatility $\sigma_{\text{daily}}$ and confidence level $\alpha$ (e.g. 99% with Gaussian quantile $z_{0.99} = 2.3263$), pure market risk over holding horizon $T_{\text{risk}}$ (in trading days) is:
$$\text{VaR}_\alpha(T_{\text{risk}}) = z_\alpha \cdot \sigma_{\text{daily}} \cdot \sqrt{T_{\text{risk}}} \cdot V_{\text{pos}}$$
For standard daily risk capital, $T_{\text{risk}} \ge 1.0$ day to account for overnight gap risk:
$$T_{\text{risk}} = \max(1.0, T^*)$$

### 2. Exogenous Stochastic Spread Cost (Bangia et al., 1999)
Let $S = (\text{Ask} - \text{Bid}) / \text{Mid}$ be the relative bid-ask spread with mean $\bar{S}$ and volatility $\sigma_S$. Under an adverse $\alpha$-percentile spread widening event:
$$\text{Cost}_{\text{spread}} = \frac{1}{2} V_{\text{pos}} \cdot (\bar{S} + z_\alpha \cdot \sigma_S)$$

### 3. Endogenous Price Impact Cost (Universal Square-Root Law)
Under the Kyle-Obizhaeva (2016) and Bouchaud market impact framework, liquidating quantity $Q$ over horizon $T$ (days) against average daily volume $V_{\text{adv}}$ generates expected price concession:
$$\text{Impact}_{\text{bps}} = Y \cdot \sigma_{\text{daily}} \sqrt{\frac{Q}{T \cdot V_{\text{adv}}}}$$
Where $Y \approx 0.60$ is the universal dimensionless scaling constant. The total monetary impact cost is:
$$\text{Cost}_{\text{impact}}(T) = \frac{1}{2} V_{\text{pos}} \cdot Y \cdot \sigma_{\text{daily}} \sqrt{\frac{Q}{T \cdot V_{\text{adv}}}}$$

---

### 4. Combined Liquidity-Adjusted VaR (LVaR)
$$\text{LVaR}_\alpha(T) = \text{VaR}_\alpha(T) + \text{Cost}_{\text{spread}} + \text{Cost}_{\text{impact}}(T)$$
$$\text{LVaR}_\alpha(T) = z_\alpha \sigma \sqrt{T} V_{\text{pos}} + \frac{1}{2} V_{\text{pos}}(\bar{S} + z_\alpha \sigma_S) + \frac{1}{2} V_{\text{pos}} Y \sigma \sqrt{\frac{Q}{V_{\text{adv}}}} T^{-1/2}$$

### 5. Analytical Optimal Liquidation Horizon $T^*$
To find the optimal duration that balances market volatility exposure against execution market impact, evaluate the first-order condition $\frac{\partial \text{LVaR}}{\partial T} = 0$:
$$\frac{\partial}{\partial T} \left[ z_\alpha \sigma V_{\text{pos}} T^{1/2} + \frac{1}{2} V_{\text{pos}} Y \sigma \sqrt{\frac{Q}{V_{\text{adv}}}} T^{-1/2} \right] = 0$$
$$\frac{1}{2} z_\alpha \sigma V_{\text{pos}} T^{-1/2} - \frac{1}{4} V_{\text{pos}} Y \sigma \sqrt{\frac{Q}{V_{\text{adv}}}} T^{-3/2} = 0$$
Multiplying by $T^{3/2}$:
$$\frac{1}{2} z_\alpha T = \frac{1}{4} Y \sqrt{\frac{Q}{V_{\text{adv}}}}$$
$$T^* = \left( \frac{Y}{2 z_\alpha} \right) \sqrt{\frac{Q}{V_{\text{adv}}}} \quad \text{(in trading days)}$$

#### Scaling Invariant:
The optimal horizon $T^*$ scales strictly with the square root of the participation ratio $\sqrt{Q / V_{\text{adv}}}$. A 4-fold increase in position size exactly doubles the optimal liquidation duration.

---

### 6. Liquidity Haircut Multiplier ($\Lambda$) & Risk Ladder
The Liquidity Multiplier quantifies the additional capital required due to market microstructure illiquidity:
$$\Lambda = \frac{\text{LVaR}_\alpha(T^*)}{\text{VaR}_\alpha(1\text{D})}$$

#### Governance Ladder:
| Liquidity Multiplier ($\Lambda$) | Regime Classification | Execution Directive | Margin Buffer Surcharge |
| :--- | :--- | :--- | :--- |
| **$\Lambda \le 1.25$** | `LIQUID_OPTIMAL_EXECUTION` | Standard TWAP / VWAP execution over $T^*$ | $+15.0\%$ baseline buffer |
| **$1.25 < \Lambda \le 2.00$** | `MODERATE_IMPACT_THROTTLE` | Extend schedule, use passive peg orders | $+30.0\%$ additional margin |
| **$2.00 < \Lambda \le 3.50$** | `ACUTE_LIQUIDITY_STRESS` | Route blocks to dark crossing / pre-market auctions | $+60.0\%$ additional margin |
| **$\Lambda > 3.50$** | `PROHIBITIVE_LIQUIDATION_HAZARD` | Halt position growth; emergency passive iceberg unwind | $+100.0\%$ margin (full collateral) |

---

## Service Architecture & Implementation

The production service is located in `python-bridge/services/liquidity_adjusted_var_engine.py`:
- **`PositionRiskParameters` Dataclass**: Captures symbol, quantity, mid-price, daily volatility, ADV, spread mean/vol, and Kyle's $Y$.
- **Analytical $T^*$ Solver**: Computes exact intraday and multi-day optimal horizons with minimum 1-minute bound.
- **Risk Floor Enforcement**: Anchors pure market risk to at least 1-day overnight holding period ($\max(1.0, T^*)$).
- **Persistence Layer**: Thread-safe SQLite logging into `lvar_telemetry` for risk auditability.

---

## Verification & Test Suite Coverage

The test suite in `python-bridge/tests/test_liquidity_adjusted_var_engine.py` passes 100% of institutional checks:
1. `test_liquid_large_cap_lvar`: Validates low-impact profile for RELIANCE (3 Cr INR block, $\Lambda \approx 1.08$, regime `LIQUID_OPTIMAL_EXECUTION`, $T^* < 1$ hour).
2. `test_illiquid_position_impact_escalation`: Validates impact escalation on 25 Cr illiquid mid-cap (250% of ADV), resulting in $\Lambda \approx 1.51$, regime `MODERATE_IMPACT_THROTTLE`, and $+30\%$ margin buffer.
3. `test_spread_shock_exogenous_cost`: Demonstrates that a spread blowout from 2 bps to 50 bps increases exogenous spread risk by $> 10\times$.
4. `test_optimal_horizon_monotonicity`: Verifies that a $4\times$ position increase scales $T^*$ by exactly $2.0\times$ ($\pm 5\%$).
5. `test_sqlite_persistence`: Confirms schema creation and record insertion into `lvar_telemetry`.

**Execution Result on Oracle Cloud VPS:**
```
tests/test_liquidity_adjusted_var_engine.py ..... [100%]
5 passed in 0.03s
```
