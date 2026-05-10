# Domain 151: Post-Earnings Announcement Drift (PEAD) & Standardized Unexpected Earnings Sieve (WP-BA)

## Executive Summary & Quantitative Thesis
Post-Earnings Announcement Drift (PEAD), first documented by Ball and Brown (1968) and Bernard and Thomas (1989, 1990), is one of the most robust, resilient anomalies in empirical asset pricing. When a firm reports earnings that significantly beat consensus expectations, its stock price does not jump instantaneously to full rational fundamental value on Day 0 or Day 1. Instead, institutional frictions, slow analyst consensus revisions, disposition bias, and gradual capital reallocation cause prices to drift predictably in the direction of the earnings surprise over a 30 to 60 trading-day horizon.

Domain 151 implements the **Post-Earnings Announcement Drift (PEAD) & Standardized Unexpected Earnings Sieve**:
- Applies the **Foster (1977) Seasonal Random Walk with Drift** model to extract seasonal expected quarterly EPS from multi-year historical reports.
- Computes **Standardized Unexpected Earnings (SUE)** normalized by historical forecast error variance $\sigma_{\text{UE}}$, equipped with an institutional minimum noise floor to prevent variance collapse.
- Quantifies the **Post-Announcement Underreaction Factor** by comparing SUE magnitude against the immediate 2-day Cumulative Abnormal Return ($\text{CAR}_{0, 1}$).
- Evaluates a composite **PEAD Momentum Score ($M_{\text{PEAD}} \in [-1.0, 1.0]$)** incorporating EPS surprise, revenue surprise, and underreaction magnitude.
- Enforces an automated regime classifier arbitrating between long accumulation drift runners, priced-in day-1 exhaustion fades, and bearish short drift distributions.

---

## Mathematical Formulations

### 1. Foster Seasonal Random Walk Model with Drift
Quarterly corporate earnings exhibit pronounced 4-quarter seasonality (Q4 fiscal year-end vs Q1 dip). The expected earnings for quarter $t$ are modeled as:
$$E[\text{EPS}_t] = \text{EPS}_{t-4} + \bar{d}$$
Where $\bar{d}$ is the average historical seasonal difference across available historical quarters:
$$\bar{d} = \frac{1}{N} \sum_{k=4}^{T-1} (\text{EPS}_k - \text{EPS}_{k-4})$$

---

### 2. Unexpected Earnings ($\text{UE}_t$) & Standardized Unexpected Earnings ($\text{SUE}_t$)
The raw earnings surprise is:
$$\text{UE}_t = \text{EPS}_{\text{reported}, t} - E[\text{EPS}_t]$$

The historical estimation error sample variance is:
$$\sigma^2_{\text{UE}} = \frac{1}{N-1} \sum_{k=4}^{T-1} (d_k - \bar{d})^2$$

To prevent singularity when historical quarterly growth has been synthetic or perfectly linear, an institutional minimum noise floor is enforced:
$$\sigma_{\text{min}} = \max\left(0.10, 0.03 \cdot |E[\text{EPS}_t]|\right)$$
$$\sigma_{\text{UE}} = \max\left(\sigma_{\text{min}}, \sqrt{\sigma^2_{\text{UE}}}\right)$$

The Standardized Unexpected Earnings score is:
$$\text{SUE}_t = \frac{\text{UE}_t}{\sigma_{\text{UE}}}$$
Where $|\text{SUE}_t| \ge 1.80$ signifies a statistically significant earnings surprise at the $\sim 93\%$ confidence level.

---

### 3. Immediate Market Reaction & Underreaction Factor
Let $\text{CAR}_{0, 1}$ denote the Cumulative Abnormal Return on the announcement day ($t=0$) and following trading day ($t=1$):
$$\text{CAR}_{0, 1} = \sum_{\tau=0}^1 (R_{i, \tau} - R_{m, \tau})$$

When an equity generates a massive beat ($\text{SUE} \ge +2.0\sigma$) but the immediate price reaction is subdued ($\text{CAR}_{0, 1} \le +1.5\%$), the market has structurally underreacted, creating maximal expected drift:
$$\text{Underreact} = \begin{cases} 
\max\left(0, \text{SUE}_t - \frac{\text{CAR}_{0, 1}}{0.015}\right), & \text{if } \text{SUE}_t > 0 \\
\min\left(0, \text{SUE}_t - \frac{\text{CAR}_{0, 1}}{0.015}\right), & \text{if } \text{SUE}_t < 0 \\
0, & \text{otherwise}
\end{cases}$$

---

### 4. Composite PEAD Momentum Score ($M_{\text{PEAD}}$)
Synthesizing earnings surprise, top-line revenue confirmation, and underreaction:
$$\text{Score}_{\text{raw}} = 0.45 \cdot \text{SUE}_t + 0.35 \cdot \left(\frac{\Delta \text{Revenue}_{\%}}{10.0}\right) + 0.20 \cdot \text{Underreact}$$
$$M_{\text{PEAD}} = \tanh(\text{Score}_{\text{raw}}) \in [-1.0, 1.0]$$

---

### 5. Institutional PEAD Regime Matrix
| SUE Magnitude | 2-Day Return ($\text{CAR}_{0, 1}$) | Regime Classification | Execution Directive | Target Drift Horizon |
| :--- | :--- | :--- | :--- | :--- |
| $\text{SUE} \ge 1.80$ | $\le +5.0\%$ | `PEAD_BULLISH_UNDERREACTION` | `ACCUMULATE_LONG_PEAD_MOMENTUM_RUNNER` | 45 Trading Days |
| $\text{SUE} \ge 1.80$ | $> +8.0\%$ | `PEAD_PRICED_IN_OR_EXHAUSTED` | `HOLD_OR_TAKE_PROFIT_DAY_1` | 5 Trading Days |
| $\text{SUE} \le -1.80$ | $\ge -5.0\%$ | `PEAD_BEARISH_UNDERREACTION` | `SHORT_OR_DISTRIBUTE_EQUITY_RISK` | 45 Trading Days |
| $|\text{SUE}| < 0.80$ | Any | `NEUTRAL_EARNINGS_CONSENSUS` | `NO_PEAD_EDGE_MAINTAIN_PORTFOLIO` | 0 Days |
| Moderate | Any | `MODERATE_EARNINGS_SURPRISE` | `MONITOR_ANALYST_REVISION_FLOW` | 20 Trading Days |

---

## Production Verification & Test Suite
- **Engine Service**: `python-bridge/services/pead_earnings_sieve.py` (8.4 KB)
- **Unit Test Suite**: `python-bridge/tests/test_pead_earnings_sieve.py` (3.6 KB)
- **Validation**: 5/5 test assertions passing on Oracle Cloud VPS (`tests/test_pead_earnings_sieve.py ..... 100% in 0.03s`).
- **Telemetry**: Full SQLite audit trail persisted in `pead_sue_telemetry`.
