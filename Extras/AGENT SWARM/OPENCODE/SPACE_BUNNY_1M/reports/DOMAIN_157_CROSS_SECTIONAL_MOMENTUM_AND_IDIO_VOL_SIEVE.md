# Domain 157: Cross-Sectional Momentum & Idiosyncratic Volatility Acceleration Engine (WP-BG)

## Executive Summary & Quantitative Thesis
Cross-sectional momentum is one of the most widely documented empirical asset pricing anomalies in modern finance (Jegadeesh & Titman, *Returns to Buying Winners and Selling Losers*, Journal of Finance 1993). However, pure naive price momentum suffers from two well-known structural flaws:
1. **The Idiosyncratic Volatility (IVOL) Trap**: Ang, Hodrick, Xing, and Zhang (2006, 2009) proved that stocks with high idiosyncratic volatility systematically underperform on a risk-adjusted basis. Many high-momentum stocks are volatile "lottery tickets" propelled by retail hype. When a momentum crash occurs (e.g. 2009, 2020), these high-IVOL "junk momentum" names collapse violently.
2. **Momentum Deceleration & Topping Exhaustion**: Standard velocity ($R_{12-1}$) is purely backward-looking. A stock may have a stellar 12-month return while its recent 1-month trajectory has rolled over into sharp deceleration ($\frac{d^2 P}{dt^2} < 0$), signaling an impending reversal.

Domain 157 establishes the **Cross-Sectional Momentum & Idiosyncratic Volatility Acceleration Engine**:
- Computes **Jegadeesh-Titman 12-1 Momentum Returns**, skipping the most recent 21 trading days to avoid short-term microstructure reversal.
- Ranks the cross-sectional equity universe into percentile cohorts ($PR_i \in [0.0, 1.0]$).
- Filters out lottery stocks via **Ang et al. (2006) 60-day Annualized Idiosyncratic Volatility ($\text{IVOL}_i$)**, enforcing an institutional IVOL ceiling ($\le 35\%$).
- Extracts the **Normalized Momentum Acceleration ($\alpha_{\text{accel}}$)** via the discrete second derivative of price.
- Synthesizes a composite **Quality Momentum Alpha Score ($Q_{\text{mom}}$)** to allocate capital to accelerating, high-conviction quality runners while aggressively avoiding junk lottery traps.

---

## Mathematical Formulations

### 1. Jegadeesh & Titman (1993) 12-1 Momentum
For each stock $i \in [1, M]$ in the investment universe:
$$R_{i, \text{12-1}} = \frac{P_i(t-21)}{P_i(t-252)} - 1.0$$
The universe is sorted in ascending order of $R_{i, \text{12-1}}$, assigning a percentile rank:
$$PR_i = \frac{\text{Rank}_i}{M} \in [0.0, 1.0]$$

---

### 2. Ang et al. (2006) Annualized Idiosyncratic Volatility ($\text{IVOL}_i$)
From daily log returns over the past 60 trading days, the stock is regressed on the benchmark market index:
$$r_{i, \tau} = \alpha_i + \beta_i r_{m, \tau} + \epsilon_{i, \tau}, \quad \tau \in [t-60, t]$$
$$\text{Var}(\epsilon_i) = \frac{1}{58} \sum_{\tau=1}^{60} \left( r_{i, \tau} - (\alpha_i + \beta_i r_{m, \tau}) \right)^2$$
$$\text{IVOL}_{i, \text{ann}} = \sqrt{\text{Var}(\epsilon_i)} \times \sqrt{252}$$

Lottery stocks with $\text{IVOL}_{i, \text{ann}} > 0.35$ are classified as high-risk speculative names. The continuous IVOL penalty factor is:
$$\text{IVOL}_{\text{penalty}, i} = \max\left(0.0, \min\left(1.0, 1.0 - \frac{\text{IVOL}_{i, \text{ann}}}{0.50}\right)\right)$$

---

### 3. Second-Derivative Momentum Acceleration ($\alpha_{\text{accel}}$)
Let $v_{\text{now}}$ and $v_{\text{prev}}$ be the average daily velocity over the recent and preceding 21-day windows:
$$v_{\text{now}} = \frac{P(t) - P(t-21)}{21}, \quad v_{\text{prev}} = \frac{P(t-21) - P(t-42)}{21}$$
$$\alpha_{\text{raw}} = \frac{v_{\text{now}} - v_{\text{prev}}}{21}$$

Normalized by recent price standard deviation $\sigma_{\text{daily}} = \text{StDev}(r_{42}) \cdot P(t)$:
$$A_{\text{norm}} = \frac{\alpha_{\text{raw}}}{\max(10^{-4}, \sigma_{\text{daily}})}$$

---

### 4. Composite Quality Momentum Alpha Score ($Q_{\text{mom}}$)
$$Q_{\text{mom}} = 0.50 \cdot PR_i + 0.30 \cdot \text{IVOL}_{\text{penalty}, i} + 0.20 \cdot \tanh(A_{\text{norm}})$$

---

### 5. Regime & Execution Directive Matrix
| Percentile Rank ($PR_i$) | Annualized IVOL | Acceleration ($A_{\text{norm}}$) | Regime Classification | Execution Directive |
| :--- | :--- | :--- | :--- | :--- |
| $\ge 0.75$ | $\le 0.35$ | $\ge -1.0$ | `HIGH_CONVICTION_QUALITY_MOMENTUM_RUNNER` | `OVERWEIGHT_LONG_ALPHA_RUNNER` |
| $\ge 0.75$ | $> 0.35$ | Any | `HIGH_IVOL_JUNK_MOMENTUM_TRAP` | `AVOID_LOTTERY_EXPOSURE` |
| $\ge 0.75$ | $\le 0.35$ | $< -1.0$ | `MOMENTUM_DECELERATION_EXHAUSTION_WARNING` | `TAKE_PROFIT_TIGHTEN_TRAIL_STOP` |
| $\le 0.20$ | Any | Any | `PERSISTENT_CROSS_SECTIONAL_LOSER` | `UNDERWEIGHT_OR_SHORT_MOMENTUM_FADE` |
| Other | Any | Any | `MEDIAN_UNIVERSE_CHURN` | `NEUTRAL_MARKET_WEIGHT` |

---

## Production Verification & Test Suite
- **Engine Service**: `python-bridge/services/cross_sectional_momentum_engine.py` (8.8 KB)
- **Unit Test Suite**: `python-bridge/tests/test_cross_sectional_momentum_engine.py` (4.6 KB)
- **Validation**: 7/7 test assertions passing on Oracle Cloud VPS (`tests/test_cross_sectional_momentum_engine.py ....... 100% in 0.04s`).
- **Telemetry**: Full SQLite audit trail persisted in `cross_sectional_momentum_telemetry`.
