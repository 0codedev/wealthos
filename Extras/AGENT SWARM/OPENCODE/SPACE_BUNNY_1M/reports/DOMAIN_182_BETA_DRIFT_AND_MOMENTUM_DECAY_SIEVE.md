# DOMAIN 182: HIGH-FREQUENCY CROSS-SECTIONAL FACTOR BETA DRIFT & MOMENTUM DECAY SIEVE (WP-CF)

**Executive Swarm Intelligence Technical Report**  
**Autonomous Agent:** `Space-Bunny / OpenCode Sovereign Swarm (Variant Max, Mega-Context 1M)`  
**Domain Vertical:** WP-CF / Domain 182: High-Frequency Cross-Sectional Factor Beta Drift & Momentum Decay Sieve  
**Timestamp:** 2026-10-18T06:43:00+05:30  
**Status:** 🟢 **PRODUCTION READY / FULLY TESTED**  

---

## 1. Executive Summary & Quantitative Mandate

In systematic equity and multi-factor quantitative portfolios, position sizing and risk management models traditionally treat market factor exposure (**CAPM Beta** $\beta$) as static or slowly drifting across weeks or months. However, in intraday high-frequency environments, a stock's sensitivity to market index movements undergoes abrupt, violent shifts driven by sector rotation, institutional basket liquidation, and earnings announcements.

When a stock's beta surges from $1.0$ to $1.8$ within a 2-hour window (**Beta Expansion Drift**), a long portfolio holding that stock becomes drastically over-leveraged to market-wide sell-offs, invalidating the portfolio's delta and beta-neutral hedges. Conversely, when momentum stocks exhibit rapid residual return decay (**Half-Life Collapse**), trend continuation algorithms suffer severe whipsaws by failing to exit before idiosyncratic alpha exhausts.

Domain 182 delivers an institutional-grade **High-Frequency Cross-Sectional Factor Beta Drift & Momentum Decay Sieve**:
1. Computes rolling intraday CAPM beta ($\beta_t$), Jensen's alpha ($\alpha_t$), and idiosyncratic residual volatility ($\sigma_{\epsilon, t}$) across multi-bar historical windows.
2. Tracks **Beta Drift Velocity** ($v_\beta = \frac{d\beta}{dt}$ per hour), isolating rapid structural exposure dislocations.
3. Decomposes asset returns into systematic market factor returns and idiosyncratic residuals, modeling the persistence and **exponential half-life decay** ($\tau_{1/2}$) of residual momentum via Ornstein-Uhlenbeck processes.
4. Emits real-time factor risk directives: triggering compensatory index hedges (`BETA_EXPANSION_HEDGE_MARKET_RISK`), capitalizing on pure alpha divergence (`IDIOSYNCRATIC_ALPHA_OUTPERFORMER`), or taking profit upon momentum exhaustion (`MOMENTUM_EXHAUSTION_HALFLIFE_DECAY`).

---

## 2. Mathematical Specifications & Factor Mechanics

### 2.1 Rolling Intraday CAPM Factor Beta
For asset return series $R_i(t)$ and benchmark index return series $R_m(t)$ over a rolling window of $W$ bars:
$$\mu_i = \frac{1}{W} \sum_{k=1}^W R_i(t-k), \quad \mu_m = \frac{1}{W} \sum_{k=1}^W R_m(t-k)$$
$$\beta_i(t) = \frac{\sum_{k=1}^W (R_i(t-k) - \mu_i)(R_m(t-k) - \mu_m)}{\sum_{k=1}^W (R_m(t-k) - \mu_m)^2} = \frac{\text{Cov}_W(R_i, R_m)}{\text{Var}_W(R_m)}$$

Jensen's idiosyncratic alpha:
$$\alpha_i(t) = \mu_i - \beta_i(t) \mu_m$$

The idiosyncratic residual error and volatility are:
$$\epsilon_i(t) = R_i(t) - (\alpha_i(t) + \beta_i(t) R_m(t))$$
$$\sigma_{\epsilon, i} = \sqrt{\frac{1}{W-2} \sum_{k=1}^W \epsilon_i(t-k)^2}$$

### 2.2 Beta Drift Velocity & Structural Dislocation
Comparing the current rolling beta $\beta_{\text{curr}}$ against the prior window baseline $\beta_{\text{prior}}$ over elapsed time $\Delta t_{\text{hours}}$:
$$\Delta \beta_i(t) = \beta_{\text{curr}} - \beta_{\text{prior}}$$
$$v_\beta = \frac{\Delta \beta_i}{\max(0.1, \Delta t_{\text{hours}})} \quad (\text{Beta change per hour})$$

- **Severe Beta Expansion** ($\Delta \beta \ge 0.35$ or $\beta_{\text{curr}} \ge 1.65$): The asset's market gearing has exploded, threatening beta neutrality.
- **Beta Compression / Decoupling** ($\beta_{\text{curr}} \le 0.35$): The asset has decoupled from broad index movements; idiosyncratic factors dominate.

### 2.3 Residual Momentum & Exponential Half-Life Decay
Cumulative idiosyncratic residual momentum over window $W$:
$$M_{\text{resid}}(t) = \sum_{k=1}^W \epsilon_i(t-k)$$

We model cumulative residual dynamics as an Ornstein-Uhlenbeck mean-reverting process:
$$dM_t = \kappa (\bar{M} - M_t) dt + \sigma dW_t$$

Discretized as an AR(1) specification:
$$M_t - \bar{M} = \phi (M_{t-1} - \bar{M}) + u_t, \quad \phi = e^{-\kappa \Delta t}$$

The empirical half-life of residual momentum is:
$$\kappa = -\ln(\phi), \quad \tau_{1/2} = \frac{\ln(2)}{\kappa} \quad (\text{in bars})$$

- When $\tau_{1/2} \ge 8.0\text{ bars}$ with $M_{\text{resid}} > +1.5\%$: Alpha momentum is persistent (`IDIOSYNCRATIC_ALPHA_OUTPERFORMER`).
- When $\tau_{1/2} < 8.0\text{ bars}$: Residual momentum is dissipating rapidly into noise (`MOMENTUM_EXHAUSTION_HALFLIFE_DECAY`).

---

## 3. Production Architecture & Verification

Implemented in `python-bridge/services/beta_drift_momentum_decay_sieve.py` and validated by 6/6 unit tests in `python-bridge/tests/test_beta_drift_momentum_decay_sieve.py`:
1. `test_exact_capm_beta_calculation`: Confirms exact recovery of synthetic $\beta = 1.50$ and $\sigma_\epsilon \approx 0.0$.
2. `test_beta_expansion_directive`: Validates detection of $\beta$ jump from $1.0 \to 1.8$, confirming positive velocity and `BETA_EXPANSION_HEDGE_MARKET_RISK`.
3. `test_beta_compression_decoupling`: Verifies decoupled asset identification ($\beta \le 0.35$) with `BETA_COMPRESSION_DECOUPLING`.
4. `test_idiosyncratic_alpha_outperformer`: Confirms outperformer detection ($>1.5\%$ alpha, $\tau_{1/2} \ge 8.0$ bars) with `IDIOSYNCRATIC_ALPHA_OUTPERFORMER`.
5. `test_momentum_exhaustion_half_life_decay`: Confirms rapid mean-reversion detection and profit-harvesting alert.
6. `test_sqlite_persistence`: Validates automated logging to `beta_drift_telemetry`.

---

## 4. Telemetry Schema & Persistence

All evaluated beta drift evaluations are logged to SQLite table `beta_drift_telemetry`:
```sql
CREATE TABLE IF NOT EXISTS beta_drift_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    symbol TEXT NOT NULL,
    benchmark TEXT NOT NULL,
    current_beta REAL NOT NULL,
    baseline_beta REAL NOT NULL,
    beta_drift REAL NOT NULL,
    beta_velocity REAL NOT NULL,
    residual_momentum REAL NOT NULL,
    half_life_bars REAL NOT NULL,
    directive TEXT NOT NULL,
    rationale TEXT NOT NULL
);
```

---

## 5. Quantitative Invariants & Execution Directives

1. **Dynamic Hedge Ratio Adjustment**: When $\beta$ expands by $\Delta \beta > 0.35$, the required market index short hedge increases in lockstep: $\Delta Q_{\text{hedge}} = \Delta \beta \times \frac{\text{Portfolio Value}}{P_{\text{index}}}$, preventing catastrophic directional drift.
2. **Residual Decoupling Advantage**: By isolating idiosyncratic return $R_i - \beta R_m$, the algorithm extracts pure stock selection alpha unpolluted by macro factor headwinds.
3. **Sovereign Swarm Ready**: Verified and synchronized across local repositories and Oracle Cloud VPS.
