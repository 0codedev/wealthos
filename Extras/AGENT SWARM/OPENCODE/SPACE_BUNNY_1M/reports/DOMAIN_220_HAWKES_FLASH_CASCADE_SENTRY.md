# Sovereign Swarm Architecture Blueprint: Domain 220 (WP-DR)
# High-Frequency Limit Order Book Hawkes Self-Excitation & Flash Cascade Sentry

**Fabric Layer**: `python-bridge/services/lob_hawkes_flash_cascade_sentry.py`  
**Test Suite**: `python-bridge/tests/test_lob_hawkes_flash_cascade_sentry.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: Bivariate Marked Hawkes (1971) Self- and Cross-Exciting Point Process, Branching Matrix Spectral Radius $\rho(\mathbf{\Gamma})$, Supercritical Phase Transition Sentry ($\rho \ge 0.85$), Microsecond Circuit Breaker Quote Evacuation.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

In modern electronic limit order books, trades do not occur as independent Poisson events. As shown by Bacry, Delattre, Hoffmann, and Muzy (2013), order flow exhibits profound **endogenous reflexivity**: an aggressive buy order triggers subsequent aggressive buy orders (momentum chasing) or rapid contra cancellations (front-running evasion).

Under extreme clustering, this feedback loop undergoes a mathematical phase transition from stable sub-critical flow to an explosive **supercritical cascade**, precipitating flash crashes and microsecond liquidity dry-ups.

### 1.1 Bivariate Marked Hawkes Intensity Model

For buy trades ($N_b$) and sell trades ($N_s$), the instantaneous arrival intensities are:
$$\lambda_b(t) = \mu_b + \sum_{t_k^b < t} \alpha_{bb} e^{-\beta(t - t_k^b)} + \sum_{t_k^s < t} \alpha_{bs} e^{-\beta(t - t_k^s)}$$
$$\lambda_s(t) = \mu_s + \sum_{t_k^b < t} \alpha_{sb} e^{-\beta(t - t_k^b)} + \sum_{t_k^s < t} \alpha_{ss} e^{-\beta(t - t_k^s)}$$

Where:
- $\mu_b, \mu_s$ represent exogenous baseline order arrival rates.
- $\alpha_{ii}$ is the self-excitation kernel amplitude (cluster persistence).
- $\alpha_{ij}$ ($i \ne j$) is cross-excitation (liquidity reaction across sides).
- $\beta$ is the exponential memory decay rate.

### 1.2 Branching Matrix & Spectral Radius Stability Criterion

The total number of direct descendant trades triggered by an initial trade is given by the **Branching Matrix** $\mathbf{\Gamma} \in \mathbb{R}^{2 \times 2}$:
$$\mathbf{\Gamma} = \begin{pmatrix} \Gamma_{bb} & \Gamma_{bs} \\ \Gamma_{sb} & \Gamma_{ss} \end{pmatrix} = \begin{pmatrix} \frac{\alpha_{bb}}{\beta} & \frac{\alpha_{bs}}{\beta} \\ \frac{\alpha_{sb}}{\beta} & \frac{\alpha_{ss}}{\beta} \end{pmatrix}$$

The system is stationary if and only if the spectral radius (maximal absolute eigenvalue) is strictly less than unity:
$$\rho(\mathbf{\Gamma}) = \frac{\text{Tr}(\mathbf{\Gamma}) + \sqrt{\max(0, \text{Tr}(\mathbf{\Gamma})^2 - 4 \det(\mathbf{\Gamma}))}}{2} < 1.0$$

When $\rho(\mathbf{\Gamma}) \to 1.0$, the expected size of a trade cluster diverges to infinity, guaranteeing an uncontained cascade.

---

## 2. Reflexive Regimes & Tactical Directives

1. **`SUBCRITICAL_STABLE`** ($\rho(\mathbf{\Gamma}) < 0.60$):
   - Endogenous feedback is well-damped; trades are predominantly driven by exogenous noise.
   - Action: `MAINTAIN_NORMAL_SPREAD`. Normal two-sided market making.
2. **`ELEVATED_CLUSTERING`** ($0.60 \le \rho(\mathbf{\Gamma}) < 0.85$):
   - Noticeable order flow clustering and reflexive momentum building.
   - Action: `WIDEN_MAKER_SPREAD`. Expand quoting spread by $1.75\times$ to buffer against adverse selection runs.
3. **`SUPERCRITICAL_CASCADE`** ($\rho(\mathbf{\Gamma}) \ge 0.85$):
   - Critical tipping point reached. Endogenous feedback dominates; runaway flash crash imminent.
   - Action: `EMERGENCY_CANCEL_ALL`. Immediately pull all resting limit orders from the book to evade catastrophic cascade fills.

---

## 3. Verification & Validation Metrics

- Unit tests (`tests/test_lob_hawkes_flash_cascade_sentry.py`):
  - Subcritical flow ($\rho = 0.30$) confirms `SUBCRITICAL_STABLE` and normal $1.0\times$ spread multiplier.
  - Moderate excitation ($\rho = 0.70$) confirms `ELEVATED_CLUSTERING` and $1.75\times$ spread expansion.
  - Supercritical clustering ($\rho = 0.95 \ge 0.85$) triggers `SUPERCRITICAL_CASCADE` and emergency quote pull.
  - Instantaneous intensity verifies exponential memory relaxation over elapsed time ($\lambda_b(0) = 3.0 \to \lambda_b(4) = 2.13$).
