# Domain 159: Sub-Second Market Microstructure Kyle's Lambda & Invariance Flow Sieve (WP-BI)

## Executive Summary & Quantitative Thesis
In algorithmic order execution and high-frequency market making, the primary risk borne by liquidity providers is **Adverse Selection**—the probability of trading against informed counterparties with private directional information. Albert S. Kyle (1985, *Continuous Auctions and Informed Trader*, Econometrica) formalized this microstructure interaction, establishing the foundational price impact metric: **Kyle's Lambda ($\lambda$)**:
$$\Delta P_t = \lambda \cdot Q_t + \eta_t$$

Where $Q_t$ is the signed order flow and $\lambda$ represents the marginal price impact per unit of executed volume.
- When $\lambda$ is high, the limit order book is illiquid and thin; market orders inflict severe permanent price displacement. Any passive quote posted inside the spread is susceptible to being picked off by toxic flow.
- When $\lambda$ is low, trading is dominated by uninformed noise traders and retail retail liquidity providers; price impact is minimal, allowing algorithms to safely tighten quoting spreads and participate aggressively.

Domain 159 establishes the **Sub-Second Market Microstructure Kyle's Lambda & Invariance Flow Sieve**:
- Ingests high-frequency tick data and classifies buyer- vs seller-initiated trade flow via the **Lee-Ready (1991)** algorithm.
- Dynamically estimates real-time $\lambda$ via rolling covariance regressions over tick intervals.
- Normalizes lambda into an institutional cross-asset metric: **Basis Point Impact per 1,000 Shares ($\lambda_{\text{norm}}$)**.
- Dispatches dynamic Percentage-of-Volume (POV) participation governors to prevent algorithmic market impact footprint and protect market-making quotes.

---

## Mathematical Formulations

### 1. Lee-Ready (1991) Trade Sign Classification
For tick trade $t$ at price $P_t$, given prevailing best bid $P_{\text{bid}}$ and best ask $P_{\text{ask}}$:
1. **Quote Rule**:
   $$\text{Sign}_t = \begin{cases} +1 & \text{if } P_t > \frac{P_{\text{bid}} + P_{\text{ask}}}{2} \quad \text{(Buyer-initiated)} \\ -1 & \text{if } P_t < \frac{P_{\text{bid}} + P_{\text{ask}}}{2} \quad \text{(Seller-initiated)} \end{cases}$$
2. **Tick Rule (Midpoint Fallback)**:
   If $P_t = \frac{P_{\text{bid}} + P_{\text{ask}}}{2}$:
   $$\text{Sign}_t = \begin{cases} +1 & \text{if } P_t > P_{t-1} \\ -1 & \text{if } P_t < P_{t-1} \\ \text{Sign}_{t-1} & \text{otherwise} \end{cases}$$

Signed interval order flow across $K$ trades is:
$$Q = \sum_{j=1}^K \text{Sign}_j \cdot V_j$$

---

### 2. OLS Estimation of Kyle's Lambda ($\lambda$)
Over a rolling sequence of $N$ non-overlapping trade intervals:
$$\lambda = \max\left(0, \frac{\text{Cov}(\Delta P, Q)}{\text{Var}(Q)}\right) = \max\left(0, \frac{\sum_{i=1}^N (Q_i - \bar{Q})(\Delta P_i - \overline{\Delta P})}{\sum_{i=1}^N (Q_i - \bar{Q})^2}\right)$$
The explanatory coefficient of determination:
$$R^2 = \frac{\left[\text{Cov}(\Delta P, Q)\right]^2}{\text{Var}(Q) \cdot \text{Var}(\Delta P)}$$

---

### 3. Normalized Impact Metric ($\lambda_{\text{norm}}$)
To enable standardized cross-sectional comparisons between ₹150 stocks and ₹25,000 stocks:
$$\lambda_{\text{norm}} = \left( \frac{\lambda \times 1000}{P_{\text{current}}} \right) \times 10^4 \quad [\text{bps per 1,000 shares}]$$

---

### 4. Toxicity Regimes & Optimal POV Participation Governor
| Normalized Lambda ($\lambda_{\text{norm}}$) | Microstructure Flow Regime | Market Making Directive | Max Recommended POV ($\phi^*$) |
| :--- | :--- | :--- | :--- |
| $\ge 12.0\text{ bps}$ | `TOXIC_INFORMED_FLOW_HAZARD` | `WIDEN_MAKER_SPREADS_RESTRICT_POV` | $\le 5\%$ |
| $\le 4.0\text{ bps}$ | `BENIGN_NOISE_FLOW_DEEP_LIQUIDITY` | `TIGHTEN_MAKER_SPREADS_AGGRESSIVE_TWAP` | $\le 25\%$ |
| $(4.0, 12.0)\text{ bps}$ | `NORMAL_LIQUIDITY_EQUILIBRIUM` | `STANDARD_ALGO_EXECUTION` | $\le 15\%$ |

---

## Production Verification & Test Suite
- **Engine Service**: `python-bridge/services/kyles_lambda_sieve.py` (6.2 KB)
- **Unit Test Suite**: `python-bridge/tests/test_kyles_lambda_sieve.py` (3.7 KB)
- **Validation**: 5/5 test assertions passing on Oracle Cloud VPS (`tests/test_kyles_lambda_sieve.py ..... 100% in 0.04s`).
- **Telemetry**: Full SQLite audit trail persisted in `kyles_lambda_telemetry`.
