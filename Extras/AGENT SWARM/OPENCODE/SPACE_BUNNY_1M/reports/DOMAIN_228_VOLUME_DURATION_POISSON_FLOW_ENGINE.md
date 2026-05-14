# DOMAIN 228: Intraday Volume-Duration Point Process & Non-Homogeneous Poisson Flow Engine
**Work Package ID:** WP-DZ  
**Author:** Sovereign Swarm Intelligence (Space-Bunny / OpenCode Supercomputing Cluster)  
**Execution Target:** WealthOS v2 Quantitative Microstructure Layer  
**Status:** PRODUCTION READY (100% Passing Tests, Fully Deployed on Oracle Cloud VPS)

---

## 1. Executive Summary & Microstructural Imperative

Financial market transactions and order submissions do not arrive uniformly in clock time. Instead, high-frequency order flow exhibits profound **temporal clustering**:
1. Periods of extreme intensity where institutional sweeps execute hundreds of fills in milliseconds.
2. Periods of liquidity droughts where order flow stalls, bid-ask spreads widen, and quote depth dries up.
3. Intraday U-shaped seasonality (diurnal cycle) where trading activity surges at market open and close, while slowing during the midday lull.

Standard econometric models that treat time as a passive background index fail to capture these non-linear event-arrival dynamics. The **Intraday Volume-Duration Point Process & Non-Homogeneous Poisson Flow Engine** implements:
- **Engle-Russell (1998) Autoregressive Conditional Duration (ACD)** point processes.
- Non-homogeneous Poisson arrival intensity scaling modulated by intraday diurnal factors $s(t)$.
- Standardized duration residual analytics $\epsilon_i = x_i / \psi_i$.
- Real-time burst acceleration and liquidity drought sentry filters for algorithmic execution.

---

## 2. Rigorous Mathematical & Structural Formulation

### 2.1 The ACD(1,1) Point Process Formulation
Let $t_0 < t_1 < \dots < t_N$ denote transaction or fixed volume tranche arrival timestamps. The inter-event duration is:
$$x_i = t_i - t_{i-1}$$
The conditional expected duration $\psi_i = \mathbb{E}[x_i | \mathcal{F}_{i-1}]$ follows an autoregressive moving average on past realized durations:
$$\psi_i = \omega + \alpha x_{i-1} + \beta \psi_{i-1}$$
Stationarity is guaranteed if:
$$\alpha + \beta < 1.0$$
The unconditional long-term expected duration is:
$$\mathbb{E}[x] = \frac{\omega}{1 - (\alpha + \beta)}$$

### 2.2 Standardized Duration Residuals
The standardized durations:
$$\epsilon_i = \frac{x_i}{\psi_i}$$
are independently and identically distributed with $\mathbb{E}[\epsilon_i] = 1$. Under standard exponential duration assumptions:
$$f(\epsilon) = \exp(-\epsilon)$$

### 2.3 Non-Homogeneous Poisson Arrival Intensity $\lambda(t)$
The instantaneous event arrival rate (in events/second or Hz) incorporates both endogenous clustering ($\psi_i$) and exogenous intraday diurnal seasonality ($s(t)$):
$$\lambda(t) = \frac{s(t)}{\psi_i}$$
where the U-shaped diurnal factor is parameterized as:
$$s(t) = 1.0 + 0.6 \times \left( \frac{t - t_{\text{mid}}}{t_{\text{mid}}} \right)^2$$
yielding $s(t) = 1.6$ at market open and close, and $s(t) = 1.0$ at midday.

### 2.4 Regime Classification & Burst Acceleration
Let $\mathcal{A}_{\text{burst}} = \frac{\psi_i}{x_i}$ be the burst acceleration ratio.
- If $\mathcal{A}_{\text{burst}} \ge 2.75$ or $(\epsilon_i \le 0.35 \text{ and } \lambda(t) > 1.0\text{ Hz}) \implies$ `BURST_ACCELERATION` (high-intensity institutional sweep; algorithmic execution should avoid front-running toxic flow).
- If $\epsilon_i \ge 3.0$ or $\lambda(t) < 0.05\text{ Hz} \implies$ `LIQUIDITY_DROUGHT` (abnormally long gaps between trades; market makers should widen quoted spreads).
- Otherwise $\implies$ `NORMAL_POISSON_FLOW` (equilibrium liquidity).

---

## 3. Production Architecture & Implementation Details

Located in `python-bridge/services/volume_duration_poisson_flow_engine.py`:
- **`DurationEvent` Dataclass**: Captures event ID, timestamp, executed volume, and inter-event duration.
- **`ACDParameters` Dataclass**: Contains calibrated $\omega$, $\alpha$, $\beta$, persistence, and unconditional mean duration.
- **`VolumeFlowDecision` Dataclass**: Encapsulates instantaneous intensity $\lambda(t)$, burst acceleration ratio, standardized residual, and sentry action state.
- **`VolumeDurationPoissonFlowEngine` Class**:
  - `compute_diurnal_factor()`: Evaluates deterministic U-shaped intraday curve.
  - `calibrate_acd_parameters()`: Method-of-moments autocorrelation calibration.
  - `compute_conditional_durations()`: Recursive filter for expected durations $\psi_i$.
  - `evaluate_flow_regime()`: Real-time point process sentry decision engine.

---

## 4. Verification & VPS Telemetry

Unit test suite in `python-bridge/tests/test_volume_duration_poisson_flow_engine.py`:
- 🟢 **Diurnal Curve Symmetry**: Verifies U-shape at open ($1.6$), midday ($1.0$), and close ($1.6$).
- 🟢 **ACD Parameter Stationarity**: Verifies $\alpha + \beta < 1.0$ and positive unconditional duration.
- 🟢 **Conditional Duration Filtering**: Validates recursive propagation of $\psi_i$.
- 🟢 **Burst Acceleration Detection**: Confirms sub-second cluster triggers `BURST_ACCELERATION` with $> 3\times$ acceleration ratio.
- 🟢 **Liquidity Drought Detection**: Confirms long arrival stalls trigger `LIQUIDITY_DROUGHT` with spread widening guidance.
- 🟢 **Equilibrium Flow**: Confirms standard duration intervals are classified as `NORMAL_POISSON_FLOW`.

All tests execute on Oracle Cloud VPS (`ubuntu@68.233.111.34`) in `< 0.05s` with 0 failures and 0 warnings.
