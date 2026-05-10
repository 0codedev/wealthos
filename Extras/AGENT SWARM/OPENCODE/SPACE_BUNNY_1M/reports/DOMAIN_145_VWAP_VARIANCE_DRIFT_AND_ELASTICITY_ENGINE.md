# Domain 145: Intraday VWAP Band Variance Drift & Mean-Reversion Elasticity Engine (WP-AU)

## Executive Summary & Quantitative Thesis
In algorithmic order execution and intraday index prop trading (NIFTY 50 and BANKNIFTY), the Volume-Weighted Average Price (VWAP) serves as the primary benchmark for institutional execution quality and fair value consensus. However, standard retail charting platforms compute static standard deviations or retrospective rolling bands that fail to account for:
1. **Intraday Volume-Weighted Variance Expansion**: Variance is non-stationary and expands with intraday volume spikes (such as during the 09:15–10:00 opening auction and 14:30–15:30 closing roll).
2. **The Trend Breakout vs. Elastic Mean-Reversion Dichotomy**: At the $\pm 2.0\sigma$ envelope, retail traders frequently fade blindly into powerful institutional trend days, or buy breakouts into exhausted liquidity vacuums.

Domain 145 engineers the **Intraday VWAP Band Variance Drift & Mean-Reversion Elasticity Engine**, delivering:
- A mathematically rigorous, sub-millisecond **$O(1)$ streaming accumulator** tracking cumulative volume, price-volume, and squared price-volume moments.
- Closed-form volume-weighted variance $\sigma_{\text{VWAP}, t}^2$ and multi-sigma dynamic envelopes ($\pm 1.0\sigma, \pm 2.0\sigma, \pm 3.0\sigma$).
- An **Ornstein-Uhlenbeck Elasticity Restoring Sieve** that cross-examines price deviation against Cumulative Volume Delta (CVD) to arbitrate between trend continuation runners and statistical mean-reversion fades.

---

## Mathematical Formulations

### 1. Streaming $O(1)$ Volume-Weighted Moments
Let $P_\tau$ be the execution price (or bar typical price $(H + L + C)/3$) and $V_\tau$ be the traded volume at bar $\tau \in \{1, \dots, t\}$ since session open (09:15 IST).

Define three streaming accumulators:
$$C_{V, t} = \sum_{\tau=1}^t V_\tau, \quad C_{PV, t} = \sum_{\tau=1}^t P_\tau V_\tau, \quad C_{PV^2, t} = \sum_{\tau=1}^t P_\tau^2 V_\tau$$

The instantaneous session VWAP is:
$$\text{VWAP}_t = \frac{C_{PV, t}}{C_{V, t}}$$

### 2. Volume-Weighted Variance & Standard Deviation
The second central moment weighted by traded volume is:
$$\sigma_{\text{VWAP}, t}^2 = \frac{\sum_{\tau=1}^t V_\tau (P_\tau - \text{VWAP}_t)^2}{C_{V, t}} = \frac{C_{PV^2, t}}{C_{V, t}} - (\text{VWAP}_t)^2$$
$$\sigma_{\text{VWAP}, t} = \sqrt{\max\left(0, \; \frac{C_{PV^2, t}}{C_{V, t}} - (\text{VWAP}_t)^2\right)}$$
- **Algorithmic Efficiency**: This formulation computes exact volume-weighted dispersion in $O(1)$ time and $O(1)$ space without retaining historical price arrays.

### 3. Standardized VWAP $Z$-Score
$$Z_{\text{VWAP}, t} = \frac{P_t - \text{VWAP}_t}{\sigma_{\text{VWAP}, t}}$$

### 4. Dynamic Multi-Sigma Envelopes
$$\text{UpperBand}_k = \text{VWAP}_t + k \cdot \sigma_{\text{VWAP}, t}, \quad \text{LowerBand}_k = \text{VWAP}_t - k \cdot \sigma_{\text{VWAP}, t}$$
for $k \in \{1.0, 2.0, 3.0\}$.

---

### 5. Ornstein-Uhlenbeck Elasticity Restoring Dynamics
Under a continuous mean-reverting price process anchored to institutional fair value:
$$dP_t = \kappa (\text{VWAP}_t - P_t) dt + \sigma dW_t$$
Where $\kappa$ represents the market elasticity parameter. The restoring force $F_{\text{restore}}$ pulling price back toward the volume anchor is:
$$F_{\text{restore}} = -\kappa \cdot (P_t - \text{VWAP}_t) = -\kappa \cdot Z_{\text{VWAP}, t} \cdot \sigma_{\text{VWAP}, t}$$

The characteristic mean-reversion half-life (in bar units) is:
$$\tau_{1/2} = \frac{\ln(2)}{\kappa}$$

### 6. Flow-Confirmed Regime Sieve Ladder
| Condition | Regime Classification | Execution Directive |
| :--- | :--- | :--- |
| **$|Z_{\text{VWAP}}| \le 1.0\sigma$** | `FAIR_VALUE_EQUILIBRIUM` | Passive two-sided market making; inventory rebalancing |
| **$1.0\sigma < |Z_{\text{VWAP}}| \le 2.0\sigma$** | `ELASTIC_EXPANSION` | Elastic tension building; monitor aggressive order flow |
| **$2.0\sigma < |Z| \le 3.0\sigma$** + Flow Acceleration ($\text{CVD} \cdot Z > 500$) | `TREND_EXPANSION_BREAKOUT` | Institutional momentum squeeze; trail trend runners |
| **$2.0\sigma < |Z| \le 3.0\sigma$** + Flow Exhaustion ($\text{CVD} \cdot Z \le 500$) | `MEAN_REVERSION_FADE_ZONE` | High-probability fade back to VWAP core with tight stop |
| **$|Z_{\text{VWAP}}| > 3.0\sigma$** | `EXTREME_STATISTICAL_STRETCH` | 99.7% statistical tail outlier; maximum-conviction counter-trend fade |

---

## Service Architecture & Implementation

The production service is located in `python-bridge/services/vwap_elasticity_sieve.py`:
- **`VWAPState` Dataclass**: Maintains streaming state variables ($C_V, C_{PV}, C_{PV^2}$).
- **Intraday Session Reset**: `reset_session()` clears state at 09:15 IST opening bell.
- **Order Flow Confirmation**: Cross-examines $Z$-score with bar Cumulative Volume Delta (CVD) to prevent hazardous counter-trend fades during aggressive institutional runs.
- **Persistence Layer**: Thread-safe SQLite logging into `vwap_elasticity_telemetry`.

---

## Verification & Test Suite Coverage

The test suite in `python-bridge/tests/test_vwap_elasticity_sieve.py` passes 100% of mathematical checks:
1. `test_vwap_and_sigma_accumulation`: Hand-calculated 3-bar analytical verification proving exact $O(1)$ VWAP and variance matching ($\text{VWAP} = 102.0$, $\sigma = \sqrt{2} \approx 1.4142$).
2. `test_fair_value_equilibrium_regime`: Confirms $|Z| \le 1.0$ triggers `FAIR_VALUE_EQUILIBRIUM` and passive maker directives.
3. `test_trend_breakout_vs_mean_reversion_fade`: Verifies that a $+2.5\sigma$ extension with positive CVD (+1200) triggers `TREND_EXPANSION_BREAKOUT`, while the same extension with neutral CVD (+50) triggers `MEAN_REVERSION_FADE_ZONE`.
4. `test_extreme_statistical_stretch`: Proves $Z > 3.0\sigma$ triggers `EXTREME_STATISTICAL_STRETCH` and downward restoring force $F_{\text{restore}} < 0$.
5. `test_sqlite_persistence`: Verifies data storage and schema compliance.

**Execution Result on Oracle Cloud VPS:**
```
tests/test_vwap_elasticity_sieve.py ..... [100%]
5 passed in 0.04s
```
