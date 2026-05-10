# Domain 138: Intraday Volume Profile Point of Acceptance & Low Volume Node Rejector (WP-AN)

**Executive Status**: 🟢 PRODUCTION DELIVERED & MATHEMATICALLY VERIFIED  
**Engine Service**: `python-bridge/services/volume_profile_acceptance_rejector.py`  
**Unit Tests**: `python-bridge/tests/test_volume_profile_acceptance_rejector.py` (5/5 Tests Passing in 0.04s)  
**Target Architecture**: WealthOS v2 Market Profile & Volume Auction Microstructure Engine  
**Benchmark Model**: `opencode/space-bunny-free` / `nemotron-3.5-lightning-free` (`--variant max --thinking --auto`)

---

## 1. Executive Summary & Volume Auction Microstructure

In modern electronic derivatives auctions (NIFTY and BANKNIFTY index futures), the distribution of traded volume across price increments reveals the structural balance of power between buyers and sellers:
1. **High Volume Nodes (HVNs)** represent price regions where the market reached strong transactional consensus (fair value). Institutional market makers and execution algorithms linger in these zones, creating high market depth and two-way liquidity. Prices tend to chop and rotate within HVNs, acting as powerful gravitational attractors.
2. **Low Volume Nodes (LVNs)** represent price intervals where the market transacted minimal volume due to rapid price discovery or institutional imbalance. These zones represent **unfair auction prices** and **liquidity vacuums**. When price re-enters an LVN, there are few resting limit orders to absorb flow, leading to violent, rapid pass-through price sweeps. If price approaches an LVN from fair value but lacks aggressive order flow to cross, it experiences sharp boundary rejection.

The **Intraday Volume Profile Point of Acceptance & Low Volume Node Rejector Engine** discretizes real-time order flow into price bins, extracts local volume extrema (HVN peaks and LVN troughs), measures instantaneous node traversal velocities, and generates directional momentum sweeps versus boundary mean-reversion trades.

---

## 2. Mathematical Formulations & Auction Profile Analytics

### 2.1 Discrete Volume Profile Histogram & Gaussian Normalization

Let price space be partitioned into $K$ contiguous discrete bins $P_1 < P_2 < \dots < P_K$ with tick resolution $\Delta P$.  
For each bin, we aggregate cumulative traded volume $V(P_k)$ and dwell time $T(P_k)$:
$$\bar{V} = \frac{1}{K} \sum_{k=1}^K V(P_k)$$
$$\sigma_V = \sqrt{\frac{1}{K} \sum_{k=1}^K \left(V(P_k) - \bar{V}\right)^2}$$

The standardized volume intensity $Z_V(P_k)$ is:
$$Z_V(P_k) = \frac{V(P_k) - \bar{V}}{\sigma_V}$$

### 2.2 High Volume Nodes (HVN) — Fair Value Acceptance Attractors

An **HVN** is identified as a local volume maximum exceeding institutional significance:
$$\mathcal{H} = \left\{ P_k \;\middle|\; V(P_k) \ge V(P_{k-1}) \;\land\; V(P_k) \ge V(P_{k+1}) \;\land\; Z_V(P_k) \ge +0.80 \right\}$$

Within an HVN:
- The **Acceptance Ratio** $AR(P_k) = \frac{V(P_k)}{\max(T(P_k), 1.0)}$ is maximized.
- Price acts elastically: excursions away from an HVN tend to mean-revert back toward the node until an external catalyst forces auction departure.

### 2.3 Low Volume Nodes (LVN) — Liquidity Vacuum Rejectors

An **LVN** is identified as a local volume minimum below historical significance:
$$\mathcal{L} = \left\{ P_k \;\middle|\; V(P_k) \le V(P_{k-1}) \;\land\; V(P_k) \le V(P_{k+1}) \;\land\; Z_V(P_k) \le -0.50 \right\}$$

Within an LVN:
- Order book depth is structurally depressed.
- When aggressive flow hits an LVN, slippage is high and price travels quickly:
  $$v_{\text{traverse}} = \frac{|S_t - S_{t-\Delta t}|}{\Delta t} \quad (\text{points per second})$$

### 2.4 Traversal Speed & Rejection Decision Mechanics

Let $S_t$ denote current price, $P_{\text{LVN}}^*$ denote the nearest LVN, and $P_{\text{HVN}}^*$ denote the nearest HVN:

1. **Fast Pass-Through Expansion**:
   If $|S_t - P_{\text{LVN}}^*| \le 5.0\text{ pts}$ and $v_{\text{traverse}} \ge 2.0\text{ pts/sec}$:
   Price has breached the LVN boundary with aggressive institutional momentum. Because the vacuum cannot absorb flow, price will rapidly traverse the entire node toward the next adjacent HVN:
   $$\text{Target} = P_{\text{HVN, next}}, \quad \text{Stop} = P_{\text{LVN}}^* \mp 6.0\text{ pts}$$

2. **LVN Boundary Rejection**:
   If $|S_t - P_{\text{LVN}}^*| \le 6.0\text{ pts}$ and $v_{\text{traverse}} < 2.0\text{ pts/sec}$:
   Price lacks the aggressive momentum needed to slice through the liquidity barrier. Passive limit orders turn price around, rejecting the unfair level and pushing price back to the previous HVN fair value attractor:
   $$\text{Target} = P_{\text{HVN, nearest}}, \quad \text{Stop} = P_{\text{LVN}}^* \pm 4.0\text{ pts}$$

3. **HVN Fair Value Chop**:
   If $|S_t - P_{\text{HVN}}^*| \le 5.0\text{ pts}$:
   Market is operating inside rotational fair value. Directional trend models are paused, and mean-reversion grid execution is activated.

---

## 3. Operational Regimes & Execution Directives

| Market State | Microstructure Criteria | Auction Physics | Quantitative Trading Directive |
|---|---|---|---|
| **FAST_PASS_THROUGH_EXPANSION** | In LVN vacuum zone $\land v_{\text{traverse}} \ge 2.0\text{ pts/sec}$ | Liquidity vacuum. Minimal resting volume allows aggressive flow to sweep entire node. | `MOMENTUM_LONG_SWEEP` / `MOMENTUM_SHORT_SWEEP`: Trade with the breakout toward next HVN. |
| **LVN_BOUNDARY_REJECTION** | Near LVN boundary $\land v_{\text{traverse}} < 2.0\text{ pts/sec}$ | Unfair price rejection. Volume dries up; market refuses to transact in the valley. | `FADE_REJECTION_BUY` / `FADE_REJECTION_SHORT`: Fade the boundary back to fair value HVN. |
| **HVN_FAIR_VALUE_CHOP** | Near HVN center ($|S - P_{\text{HVN}}| \le 5.0\text{ pts}$) | Transactional consensus. High volume, thick order book, tight rotation. | `MEAN_REVERSION_GRID`: Fade range boundaries; harvest spread and short gamma. |

---

## 4. Production Service Architecture & Code Integration

The complete production implementation is delivered in `python-bridge/services/volume_profile_acceptance_rejector.py`:
- Ingests `ProfileBin` data structures across custom tick grids.
- Computes sample mean, variance, and standardized $Z$-scores to extract local maxima (HVNs) and minima (LVNs).
- Evaluates real-time tick-to-tick traversal velocities ($v_{\text{traverse}}$).
- Dynamically calculates exact price targets (next HVN) and stop-loss boundaries (behind LVN shelves).
- Persists all observations to SQLite table `volume_profile_acceptance_telemetry` for auditability and post-trade performance analytics.

---

## 5. Verification & Test Suite

The engine was fully validated against unit tests in `python-bridge/tests/test_volume_profile_acceptance_rejector.py`:
1. `test_identify_hvn_and_lvn`: Validates exact detection of bimodal HVN peaks (25000 and 25100) and valley LVN (25050).
2. `test_fast_pass_through_expansion_regime`: Confirms detection of fast pass-through ($10.0\text{ pts/sec}$ into 25050 LVN), classification into `FAST_PASS_THROUGH_EXPANSION`, and emission of `MOMENTUM_LONG_SWEEP` targeting next HVN 25100.
3. `test_lvn_boundary_rejection_regime`: Validates boundary rejection ($0.2\text{ pts/sec}$ stalling near 25050), classification into `LVN_BOUNDARY_REJECTION`, and emission of `FADE_REJECTION_SHORT` targeting 25000.
4. `test_hvn_fair_value_chop_regime`: Validates fair value classification (`HVN_FAIR_VALUE_CHOP`) and `MEAN_REVERSION_GRID` at HVN node 25000.
5. `test_sqlite_persistence`: Validates relational database persistence and telemetry querying.

**Execution Result**:
```
tests/test_volume_profile_acceptance_rejector.py::test_identify_hvn_and_lvn PASSED [ 20%]
tests/test_volume_profile_acceptance_rejector.py::test_fast_pass_through_expansion_regime PASSED [ 40%]
tests/test_volume_profile_acceptance_rejector.py::test_lvn_boundary_rejection_regime PASSED [ 60%]
tests/test_volume_profile_acceptance_rejector.py::test_hvn_fair_value_chop_regime PASSED [ 80%]
tests/test_volume_profile_acceptance_rejector.py::test_sqlite_persistence PASSED [100%]
5 passed in 0.04s
```
