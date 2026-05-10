# Domain 154: Dynamic Delta-Neutral Gamma Scalping Execution Scheduler (WP-BD)

## Executive Summary & Quantitative Thesis
In institutional option market making and volatility arbitrage, maintaining a delta-neutral book while holding net positive or negative Gamma ($\Gamma$) is central to profitability. According to the Black-Scholes-Merton partial differential equation and Ito's Lemma, an options portfolio hedged discretely in the underlying stock or index future generates an instantaneous PnL governed by the difference between **Realized Volatility ($\sigma_{\text{realized}}$)** and **Implied Volatility ($\sigma_{\text{implied}}$)**:
$$\Delta \Pi \approx \frac{1}{2} S^2 \Gamma_{\text{net}} \left( \sigma_{\text{realized}}^2 - \sigma_{\text{implied}}^2 \right) \Delta t - c_{\text{trans}} |\Delta H|$$

- **Long Gamma ($\Gamma > 0$)**: The desk profits by dynamically scalping the gamma—selling underlying shares as spot rallies, and buying underlying shares as spot dips. This generates positive cash flow provided realized volatility exceeds the implied volatility priced into the theta bleed ($\sigma_{\text{realized}} > \sigma_{\text{implied}}$).
- **Short Gamma ($\Gamma < 0$)**: The desk harvests steady theta decay, but is forced to "buy high and sell low" to defend against runaway delta drift.

The central operational challenge is the **Leland (1985) / Zakamouline (2006) Rebalancing Trade-off**:
1. Rebalancing continuously at every tick causes transaction costs to rapidly erode alpha.
2. Rebalancing too infrequently exposes the desk to catastrophic quadratic gamma slippage and unhedged directional market risk.

Domain 154 implements the **Dynamic Delta-Neutral Gamma Scalping Execution Scheduler**, featuring:
- Closed-form cubic-root **Leland-Zakamouline Optimal Rebalancing Bands** bounded by an institutional risk ceiling.
- Real-time PnL attribution decomposing daily gamma scalping capture versus theta decay.
- Automated hedge execution orders (`SCALP_HARVEST_UPMOVE_SELL_HEDGE`, `SCALP_HARVEST_DIP_BUY_HEDGE`, `DEFENSIVE_SHORT_GAMMA_STOP_HEDGE`).

---

## Mathematical Formulations

### 1. Portfolio Delta-Neutral Equilibrium
For a book comprising $M$ option contracts and an underlying hedge $H$:
$$\Delta_{\text{net}} = \sum_{i=1}^M N_i \Delta_i, \quad \Gamma_{\text{net}} = \sum_{i=1}^M N_i \Gamma_i, \quad \Theta_{\text{net}} = \sum_{i=1}^M N_i \Theta_i$$
$$\Delta_{\text{total}} = \Delta_{\text{net}} + H_{\text{underlying}}$$
The portfolio is in delta-neutral equilibrium when $|\Delta_{\text{total}}| \le \delta_{\Delta}^*$.

---

### 2. Realized vs Implied Volatility PnL Attribution
Over a daily discrete step $\Delta t = \frac{1}{252}$:
$$\mathbb{E}[\Delta \Pi_{\text{gamma}}] = \frac{1}{2} S^2 \Gamma_{\text{net}} \left( \sigma_{\text{realized, 30D}}^2 \cdot \Delta t \right)$$
$$\text{Cost}_{\text{theta}} = \Theta_{\text{net}}$$
Net Daily Drift = $\mathbb{E}[\Delta \Pi_{\text{gamma}}] + \Theta_{\text{net}} - \text{Friction}$.

When $\sigma_{\text{realized}} > \sigma_{\text{implied}}$, Long Gamma positions generate positive net alpha above theta carry costs.

---

### 3. Leland-Zakamouline Optimal Rebalancing Band
Balancing transaction friction $c$ against convex delta tracking variance under risk aversion $\gamma_{\text{risk}}$:
$$\delta_{\text{price}}^* = S \cdot \left( \frac{3 c}{|\Gamma_{\text{net}}| \cdot S \cdot \gamma_{\text{risk}}} \right)^{1/3}$$
Constrained to the admissible price band $\delta_{\text{price}}^* \in [0.001 S, 0.03 S]$.

In delta space, the unhedged position threshold is governed by the desk's maximum risk limit $\delta_{\text{tolerance}}$:
$$\delta_{\Delta}^* = \min\left(\delta_{\text{tolerance}}, \max\left(0.01, |\Gamma_{\text{net}}| \cdot \delta_{\text{price}}^*\right)\right)$$

---

### 4. Dynamic Execution & Regime Matrix
| Net Delta Drift | Gamma Sign | Volatility Spread ($\sigma_R - \sigma_I$) | Regime Classification | Execution Directive |
| :--- | :--- | :--- | :--- | :--- |
| $\Delta_{\text{total}} \ge \delta_{\Delta}^*$ | $\Gamma > 0$ | $\ge 0$ | `POSITIVE_VOL_HARVEST_ACTIVE_SCALPING` | `SCALP_HARVEST_UPMOVE_SELL_HEDGE` |
| $\Delta_{\text{total}} \le -\delta_{\Delta}^*$ | $\Gamma > 0$ | $\ge 0$ | `POSITIVE_VOL_HARVEST_ACTIVE_SCALPING` | `SCALP_HARVEST_DIP_BUY_HEDGE` |
| $|\Delta_{\text{total}}| \ge \delta_{\Delta}^*$ | $\Gamma < 0$ | Any | `SHORT_GAMMA_DELTA_DEVIATION_CORRECTION` | `DEFENSIVE_SHORT_GAMMA_STOP_HEDGE` |
| $|\Delta_{\text{total}}| < \delta_{\Delta}^*$ | $\Gamma > 0$ | $< -0.05$ | `LONG_GAMMA_THETA_BLEED_WARNING` | `MAINTAIN_BAND_CONSIDER_TRIMMING_LONGS` |
| $|\Delta_{\text{total}}| < \delta_{\Delta}^*$ | Neutral | Any | `DELTA_NEUTRAL_IDLE_MONITORING` | `MAINTAIN_CURRENT_HEDGE` |

---

## Production Verification & Test Suite
- **Engine Service**: `python-bridge/services/gamma_scalping_scheduler.py` (8.7 KB)
- **Unit Test Suite**: `python-bridge/tests/test_gamma_scalping_scheduler.py` (4.4 KB)
- **Validation**: 6/6 test assertions passing on Oracle Cloud VPS (`tests/test_gamma_scalping_scheduler.py ...... 100% in 0.04s`).
- **Telemetry**: Full SQLite audit trail persisted in `gamma_scalping_telemetry`.
