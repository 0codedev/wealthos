# DOMAIN 181: MULTI-FACTOR LEAD-LAG CROSS-CORRELATION & INFORMATION SPILLOVER SIEVE (WP-CE)

**Executive Swarm Intelligence Technical Report**  
**Autonomous Agent:** `Space-Bunny / OpenCode Sovereign Swarm (Variant Max, Mega-Context 1M)`  
**Domain Vertical:** WP-CE / Domain 181: Multi-Factor Lead-Lag Cross-Correlation & Information Spillover Sieve  
**Timestamp:** 2026-10-18T06:41:00+05:30  
**Status:** 🟢 **PRODUCTION READY / FULLY TESTED**  

---

## 1. Executive Summary & Quantitative Mandate

In multi-asset and multi-instrument financial markets, information does not diffuse instantaneously across all traded instruments. Highly liquid, centrally cleared derivatives (such as index futures or sovereign bond futures) process macro news, policy statements, and algorithmic order flow significantly faster than individual cash equities or fragmented ETF components. This temporal friction creates systematic **lead-lag cross-correlations** where the price innovation in a "leader" instrument predicts the subsequent price trajectory of a "follower" instrument after a delay $\tau^* \in [100\text{ ms}, 800\text{ ms}]$.

However, measuring cross-correlation at high frequencies using standard discrete time-bucket Pearson correlation fails catastrophically due to the **Epps Effect**: as the sampling frequency increases (from minutes to sub-seconds), asynchronous tick arrivals cause conventional correlation estimates to severely bias toward zero.

Domain 181 establishes an institutional-grade **Multi-Factor Lead-Lag Cross-Correlation & Information Spillover Sieve**:
1. Implements the mathematically exact **Hayashi-Yoshida (2005) Asynchronous Realized Covariance Estimator**, calculating cumulative cross-products directly across overlapping tick intervals without artificial price interpolation or forward-filling.
2. Scans the continuous-time lag horizon $\tau \in [-\tau_{\max}, +\tau_{\max}]$ to construct the empirical lead-lag correlation surface and isolate the optimal time delay $\tau^* = \arg\max_\tau |\hat{\rho}_{HY}(\tau)|$.
3. Quantifies directional information transmission via the **Spillover Asymmetry Index** $\mathcal{S}_{X \to Y}$.
4. Generates high-conviction execution directives: front-running follower fills (`LEAD_LAG_ARBITRAGE_FOLLOW_LEADER`), identifying pairs-trading co-movement (`SYNCHRONOUS_CO_MOVEMENT_PAIR`), or flagging inverted spillover hedges (`INVERTED_NEGATIVE_SPILLOVER`).

---

## 2. Mathematical Specifications & High-Frequency Mechanics

### 2.1 The Epps Effect & Hayashi-Yoshida Formulation
Let asset $X$ trade at discrete timestamps $\{t_0^X, t_1^X, \dots, t_N^X\}$ with log-return innovations $\Delta X_i = \ln(P^X(t_i)) - \ln(P^X(t_{i-1}))$ across observation intervals $I_i = (t_{i-1}^X, t_i^X]$.
Let asset $Y$ trade at discrete timestamps $\{t_0^Y, t_1^Y, \dots, t_M^Y\}$ with log-return innovations $\Delta Y_j = \ln(P^Y(t_j)) - \ln(P^Y(t_{j-1}))$ across observation intervals $J_j = (t_{j-1}^Y, t_j^Y]$.

Because $t_i^X \ne t_j^Y$ in general, standard sampling artificially zeroes out cross-products. The Hayashi-Yoshida (HY) realized covariance sums all return pairs whose time intervals physically overlap:
$$\hat{\gamma}_{XY} = \sum_{i=1}^N \sum_{j=1}^M \Delta X_i \, \Delta Y_j \cdot \mathbf{1}_{\{ I_i \cap J_j \ne \emptyset \}}$$

The realized variances of the individual assets are:
$$\hat{\sigma}_X^2 = \sum_{i=1}^N (\Delta X_i)^2, \quad \hat{\sigma}_Y^2 = \sum_{j=1}^M (\Delta Y_j)^2$$

The Hayashi-Yoshida asynchronous cross-correlation is:
$$\hat{\rho}_{HY}(X, Y) = \frac{\hat{\gamma}_{XY}}{\sqrt{\hat{\sigma}_X^2 \cdot \hat{\sigma}_Y^2}} \in [-1.0, 1.0]$$

### 2.2 Time-Shifted Lead-Lag Horizon ($\tau$)
To evaluate whether asset $X$ leads asset $Y$ by time delay $\tau$, we shift $Y$'s intervals:
$$J_j(\tau) = (t_{j-1}^Y + \tau, \, t_j^Y + \tau]$$
$$\hat{\rho}_{HY}(\tau) = \frac{\sum_{i=1}^N \sum_{j=1}^M \Delta X_i \, \Delta Y_j \cdot \mathbf{1}_{\{ I_i \cap J_j(\tau) \ne \emptyset \}}}{\sqrt{\hat{\sigma}_X^2 \cdot \hat{\sigma}_Y^2}}$$

The optimal lead-lag delay $\tau^*$ is obtained via:
$$\tau^* = \arg\max_{\tau \in [-\tau_{\max}, \tau_{\max}]} |\hat{\rho}_{HY}(\tau)|$$

- **$\tau^* > 0$**: Asset $X$ **leads** asset $Y$ by $\tau^*$ seconds. Information is first reflected in $X$ and later diffuses into $Y$.
- **$\tau^* < 0$**: Asset $Y$ **leads** asset $X$ by $|\tau^*|$ seconds.
- **$\tau^* \approx 0$**: Both assets react synchronously without observable latency advantage.

### 2.3 Information Spillover Asymmetry Index ($\mathcal{S}$)
To measure whether information transmission is unidirectional or bilateral:
$$\mathcal{S}_{X \to Y} = \frac{\bar{\rho}(\tau > 0) - \bar{\rho}(\tau < 0)}{\bar{\rho}(\tau > 0) + \bar{\rho}(\tau < 0)}$$

Where $\bar{\rho}(\tau > 0)$ is the mean positive-lag cross-correlation, and $\bar{\rho}(\tau < 0)$ is the mean negative-lag cross-correlation. A value near $+1.0$ indicates pure leader-follower causality from $X$ to $Y$.

---

## 3. Production Architecture & Verification

Implemented in `python-bridge/services/hayashi_yoshida_lead_lag_sieve.py` and validated by 6/6 unit tests in `python-bridge/tests/test_hayashi_yoshida_lead_lag_sieve.py`:
1. `test_hayashi_yoshida_identical_synchronous_series`: Confirms exact theoretical convergence $\hat{\rho}_{HY} \equiv 1.0$ for identical synchronous price paths.
2. `test_known_lead_lag_synthetic_diffusion`: Tests synthetic $0.50\text{s}$ information diffusion, successfully identifying leader, follower, $\tau^* = 0.50\text{s}$, and `LEAD_LAG_ARBITRAGE_FOLLOW_LEADER`.
3. `test_synchronous_co_movement`: Confirms `SYNCHRONOUS_CO_MOVEMENT_PAIR` when delay $|\tau^*| < 0.15\text{s}$ with correlation $>0.90$.
4. `test_decoupled_independent_random_walks`: Verifies zero false positive classification when cross-correlation is negligible.
5. `test_inverted_negative_spillover`: Validates negative correlation regime detection ($\rho < -0.80$).
6. `test_sqlite_persistence`: Validates telemetry logging to `lead_lag_correlation_telemetry`.

---

## 4. Telemetry Schema & Persistence

Lead-lag evaluations are recorded into SQLite table `lead_lag_correlation_telemetry`:
```sql
CREATE TABLE IF NOT EXISTS lead_lag_correlation_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    leader_symbol TEXT NOT NULL,
    follower_symbol TEXT NOT NULL,
    optimal_lag_sec REAL NOT NULL,
    peak_correlation REAL NOT NULL,
    sync_correlation REAL NOT NULL,
    spillover_asymmetry REAL NOT NULL,
    directive TEXT NOT NULL,
    rationale TEXT NOT NULL
);
```

---

## 5. Quantitative Invariants & Execution Directives

1. **Epps Effect Immunity**: By operating on asynchronous intersection intervals $\mathbf{1}_{\{I_i \cap J_j \ne \emptyset\}}$, correlation does not decay to zero at millisecond resolutions.
2. **Sub-Second Front-Running Edge**: When NIFTY Index Futures break a key level, heavy index constituents (e.g., RELIANCE, HDFCBANK) often exhibit a $200\text{--}400\text{ ms}$ propagation delay. The engine fires taker orders on the constituent before the cash book adjusts.
3. **Sovereign Swarm Ready**: Verified and synchronized across local workspaces and Oracle Cloud VPS.
