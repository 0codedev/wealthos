# Domain 126: Microsecond Hardware Timestamp Drift & PTP/NTP Clock Synchronization Sentry (WP-AB)

**Executive Status**: 🟢 PRODUCTION DELIVERED & MATHEMATICALLY VERIFIED  
**Engine Service**: `python-bridge/services/clock_synchronization_sentry.py`  
**Unit Tests**: `python-bridge/tests/test_clock_synchronization_sentry.py` (7/7 Tests Passing in 0.04s)  
**Target Architecture**: WealthOS v2 Precision Execution Timing & Latency Sentinel  
**Benchmark Model**: `opencode/nemotron-3.5-lightning-free` / `space-bunny-free` (`--variant max --thinking --auto`)

---

## 1. Executive Summary & Clock Synchronization Edge

In low-latency and statistical arbitrage systems, order execution decisions rely on cross-venue microsecond timestamp ordering. However, across geographically distributed nodes (e.g. Oracle Cloud VPS, local trading desk in India, NSE/BSE exchange co-location gateways, and broker WebSocket endpoints like Dhan and Upstox):
1. **Hardware Crystal Oscillator Drift**: Commodity server clocks drift by $10\mu\text{s}$ to $100\mu\text{s}$ per second due to thermal fluctuations and CPU load (frequency skew $\omega \approx 10-80\text{ ppm}$).
2. **Asymmetric Network Queuing Jitter**: Public and private WAN routes experience variable queue bufferbloat, creating asymmetric one-way delay spikes.
3. **The Stale Quote Hazard**: A trading algorithm executing cross-exchange arbitrage based on uncalibrated timestamps will frequently misinterpret a stale, delayed quote as a real-time arbitrage opportunity, filling into adverse market-maker inventory.

The **Microsecond Hardware Timestamp Drift & PTP/NTP Clock Synchronization Sentry** continuously decomposes observed delays into true clock offset ($\theta$) and network jitter using an asymmetric **minimum-filter line-of-sight estimator**, tracks frequency skew rate ($\omega$), enforces safety regimes, and issues an automated **Stale Feed Veto** when quote transit age exceeds $150\text{ms}$.

---

## 2. Mathematical Formulations & Latency Decomposition

### 2.1 One-Way Delay Decomposition

For every incoming market packet $k$ carrying exchange matching engine timestamp $T_{\text{exchange}, k}$ received locally at hardware clock timestamp $T_{\text{local}, k}$:
$$D_k = T_{\text{local}, k} - T_{\text{exchange}, k} = \theta_k + d_{\text{network}, k}$$
where:
- $\theta_k$ is the deterministic clock offset between local server and exchange clock.
- $d_{\text{network}, k} \ge d_{\text{flight\_min}} > 0$ is the stochastic one-way network transit latency.

Network queuing jitter is strictly non-negative:
$$d_{\text{network}, k} = d_{\text{flight\_min}} + \eta_k, \quad \eta_k \ge 0, \quad \eta_k \sim \text{Exponential}(\lambda_{\text{jitter}})$$

### 2.2 Minimum-Filter Line-of-Sight Clock Offset Estimator

Because $\eta_k \ge 0$, any packet that encounters zero queuing delay traverses the line-of-sight optical fiber path at the speed of light in glass:
$$\min_{j \in [k-M, k]} D_j = \theta_k + d_{\text{flight\_min}} + \min(\eta_j) \approx \theta_k + d_{\text{flight\_min}}$$

Therefore, the unbiased clock offset estimator over rolling window $M$ is:
$$\hat{\theta}_k = \min_{j \in [k-M, k]} D_j - d_{\text{flight\_min}}$$

### 2.3 Frequency Skew ($\omega$ in Parts-Per-Million)

Local oscillator frequency drift rate (skew) is evaluated dynamically:
$$\omega_k = \frac{d\hat{\theta}}{dt} \approx \frac{\hat{\theta}_k - \hat{\theta}_{k-L}}{T_{\text{local}, k} - T_{\text{local}, k-L}} \times 10^6 \quad \text{(ppm)}$$
A frequency skew $|\omega_k| \le 50\text{ ppm}$ indicates healthy quartz oscillator stabilization.

### 2.4 True Quote Transit Age & Stale Feed Veto

Once clock offset bias $\hat{\theta}_k$ is isolated, the true physical transit age of quote $k$ is:
$$\text{TransitAge}_k = T_{\text{local}, k} - T_{\text{exchange}, k} - \hat{\theta}_k$$

The Stale Feed Veto rule enforces:
$$\text{IsStaleVeto} = \begin{cases} \mathbf{True}, & \text{if } \text{TransitAge}_k > 150.0\text{ms} \\ \mathbf{False}, & \text{otherwise} \end{cases}$$
When $\text{IsStaleVeto}$ is active, all latency arbitrage and IOC cross-venue sniping instructions for that instrument are blocked.

---

## 3. Production Architecture

```
       [ Packet Ingestion Feed ]
 (Exchange Match TS, Local Receive TS)
                   │
                   ▼
     [ ClockSynchronizationSentry ]
                   │
   ┌───────────────┴───────────────┐
   ▼                               ▼
[ Delay Decomposer ]     [ Rolling Window M (50) ]
- Raw Delay D_k          - Minimum Filter Line-of-Sight
- Positive Jitter \eta_k - Jitter Std Dev \sigma_{jitter}
   │                               │
   └───────────────┬───────────────┘
                   ▼
       [ Clock Offset & Skew Solvers ]
       - Estimated Offset \hat{\theta} (\mu s)
       - Frequency Skew \omega (ppm)
                   │
                   ▼
       [ Regime & Staleness Sieve ]
                   │
  ┌────────────────┼────────────────┐
  ▼                ▼                ▼
[ SYNCHRONIZED ] [ DRIFT WARNING ] [ CRITICAL DESYNC ]
- Offset < 10ms  - 10ms <= \theta < 50ms - \theta >= 50ms
- Safe = True    - Safe = True      - VETO ALL LATENCY ARB
- Normal routing - Telemetry log    - Emergency Resync
```

---

## 4. Verification & Validation Summary

| Test Case | Objective | Verified Metric | Result |
| :--- | :--- | :--- | :---: |
| `test_minimum_filter_offset_estimation` | Accurately extract true clock offset under random jitter | $|\hat{\theta} - \theta_{\text{true}}| < 100\mu\text{s}$ | 🟢 PASS |
| `test_frequency_skew_calculation` | Quantify frequency drift rate in parts per million (ppm) | $|\omega - 40.0\text{ ppm}| < 10\text{ ppm}$ | 🟢 PASS |
| `test_regime_classification_drift_warning` | Classify $25\text{ms}$ offset as warning while maintaining safety | $\text{Regime} = \text{DRIFT\_WARNING}, \text{Safe} = \mathbf{True}$ | 🟢 PASS |
| `test_regime_classification_critical_desync` | Classify $80\text{ms}$ offset as critical and disable latency arb | $\text{Regime} = \text{CRITICAL\_DESYNC}, \text{Safe} = \mathbf{False}$ | 🟢 PASS |
| `test_audit_quote_fresh` | Fresh quote ($15\text{ms}$ transit) passes without veto | $\text{Veto} = \mathbf{False}, \text{Age} < 50\text{ms}$ | 🟢 PASS |
| `test_audit_quote_stale_veto` | Stale quote ($295\text{ms}$ transit) triggers veto guard | $\text{Veto} = \mathbf{True}, \text{Age} > 150\text{ms}$ | 🟢 PASS |
| `test_sqlite_persistence` | Telemetry logged to SQLite table | Row verified in `clock_sync_telemetry` | 🟢 PASS |

---

## 5. Deployment Directives

1. **Precision Timing Source**: Run `chrony` or `linuxptp` daemon on Oracle Cloud VPS synchronized against National Physical Laboratory of India (NPLI) / Stratum-1 NTP pools.
2. **WebSocket Ingestion**: Extract `exchange_ts` from Upstox Protobuf `FeedResponse.currentTs` and record `local_receive_ts` with `time.time_ns()`.
3. **Execution Guard**: Gate all cross-exchange orders in `cross_exchange_latency_engine.py` through `audit_quote_staleness`.
