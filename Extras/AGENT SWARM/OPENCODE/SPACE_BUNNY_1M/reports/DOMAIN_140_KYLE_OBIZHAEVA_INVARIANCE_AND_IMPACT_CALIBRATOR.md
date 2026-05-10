# Domain 140: Multi-Asset Kyle-Obizhaeva Invariance & Market Impact Calibrator (WP-AP)

**Executive Status**: 🟢 PRODUCTION DELIVERED & MATHEMATICALLY VERIFIED  
**Engine Service**: `python-bridge/services/kyle_obizhaeva_impact_calibrator.py`  
**Unit Tests**: `python-bridge/tests/test_kyle_obizhaeva_impact_calibrator.py` (5/5 Tests Passing in 0.04s)  
**Target Architecture**: WealthOS v2 Institutional Execution Scheduling & Transaction Cost Engine  
**Benchmark Model**: `opencode/space-bunny-free` / `nemotron-3.5-lightning-free` (`--variant max --thinking --auto`)

---

## 1. Executive Summary & Market Microstructure Invariance

A fundamental challenge for systematic portfolio managers operating across the Indian equity universe (NIFTY 50 large caps down to NIFTY Midcap 150 constituents) is that execution schedules cannot be applied uniformly. A ₹10 Crore order in Reliance Industries (ADV ~ ₹1,500 Cr) represents routine algorithmic noise, whereas the same order in a mid-cap constituent can severely distort prices, sweep multiple levels of the book, and destroy alpha.

Traditional execution algorithms use ad-hoc heuristics or linear impact assumptions ($\Delta P \propto X$). However, empirical econophysics and microstructure research prove that market impact is universally non-linear and sub-additive:
1. **The Square-Root Impact Law**: Across all liquid electronic asset classes globally, the price impact of a metaorder scales with the **square root** of order size: $\frac{\Delta P}{P} \propto \sigma \sqrt{\frac{X}{V}}$.
2. **Kyle & Obizhaeva (2016) Invariance**: Trading activity, order flow velocity, and bid-ask spreads scale invariantly when measured in business time units defined by the rate of information arrival $I = \sigma \cdot V_{\text{cash}}$.

The **Multi-Asset Kyle-Obizhaeva Invariance & Market Impact Calibrator Engine** computes continuous asset-specific information arrival rates, estimates non-linear price degradation in basis points and rupee terms, calibrates optimal Percentage-of-Volume (POV) participation rates, and determines the appropriate algorithmic execution style (Aggressive TWAP vs. Passive POV vs. Institutional Block Window Crossing).

---

## 2. Mathematical Formulations & Market Impact Physics

### 2.1 Information Arrival Rate (Business Time Speed)

In the Kyle-Obizhaeva framework, calendar time is irrelevant; trading activity occurs in "business time" driven by the flow of fundamental information.  
Let $P$ denote current share price, $V_{\text{daily}}$ denote daily trading volume in shares, and $\sigma_{\text{daily}}$ denote daily return volatility.  
The total daily rupee cash volume is:
$$V_{\text{cash}} = P \cdot V_{\text{daily}}$$

The continuous rate of information arrival $I$ (in ₹/day) is:
$$I = \sigma_{\text{daily}} \cdot V_{\text{cash}} = \sigma_{\text{daily}} \cdot (P \cdot V_{\text{daily}})$$

Assets with higher $I$ experience faster information incorporation, thicker limit order books, and greater resilience to large trades.

### 2.2 Invariant Bet Size Scaling

Kyle and Obizhaeva proved that individual institutional bets $Q^*$ (metaorders) scale with the $1/3$ power of dollar volume to volatility:
$$Q_{\text{cash}}^* = c_0 \cdot \left( \frac{V_{\text{cash}}}{\sigma_{\text{daily}}} \right)^{1/3}$$
$$\text{Shares}^* = \frac{Q_{\text{cash}}^*}{P} = \frac{c_0}{P} \left( \frac{V_{\text{cash}}}{\sigma_{\text{daily}}} \right)^{1/3}$$
where $c_0 \approx 100.0$ calibrates the invariant transaction unit to institutional algorithmic parent order slicing sizes.

### 2.3 Universal Square-Root Price Impact Law

For an institutional parent order of $X$ shares executed over an execution horizon with total volume fraction $\phi = \frac{X}{V_{\text{daily}}}$:
$$\mathbb{E}\left[\frac{\Delta P}{P}\right] = Y \cdot \sigma_{\text{daily}} \cdot \sqrt{\frac{X}{V_{\text{daily}}}}$$
where $Y \approx 0.60$ is the universal dimensionless Kyle-Obizhaeva invariance constant.

Expressed in basis points ($1\text{ bps} = 10^{-4}$):
$$\text{Impact}_{\text{bps}} = Y \cdot \sigma_{\text{daily}} \cdot \sqrt{\frac{X}{V_{\text{daily}}}} \times 10,000$$

Because price impact builds up concave-upward over the execution trajectory, the volume-weighted average execution price (VWAP) pays approximately half of the terminal price degradation:
$$\text{Total Market Impact Cost (INR)} = X \cdot P \cdot \left( \frac{1}{2} \cdot \frac{\Delta P}{P} \right)$$

### 2.4 Optimal Dynamic Percentage-of-Volume (POV) Governor

To ensure that market impact does not exceed the alpha budget $\Delta P_{\text{max\_bps}}$:
$$Y \cdot \sigma_{\text{daily}} \sqrt{\text{POV}} \le \frac{\Delta P_{\text{max\_bps}}}{10,000}$$
Solving for the optimal participation rate $\text{POV}^*$:
$$\text{POV}^* = \text{clip}\left( \left( \frac{\Delta P_{\text{max\_bps}} / 10,000}{Y \cdot \sigma_{\text{daily}}} \right)^2, 0.01, 0.30 \right)$$
where $\text{POV}^*$ is bounded between $1\%$ and $30\%$ to prevent adverse market dominance.

---

## 3. Operational Regimes & Execution Directives

| Impact Regime | Expected Impact | Volume Fraction ($\phi$) | Recommended Execution Style | Quantitative Action |
|---|---|---|---|---|
| **NEGLIGIBLE_IMPACT** | $\le 10.0\text{ bps}$ | Typically $\le 0.5\%$ ADV | `AGGRESSIVE_TWAP` | Execute fast TWAP across 15–30 minutes. Low slippage risk; minimize unhedged market exposure. |
| **MODERATE_IMPACT** | $10.0\text{ bps} < \text{Impact} < 35.0\text{ bps}$ | Typically $0.5\% - 5.0\%$ ADV | `PASSIVE_POV_ALGO` | Dynamically slice order at calibrated $\text{POV}^*$ (e.g. 5–15% of market volume); participate passively with liquidity. |
| **PUNITIVE_IMPACT** | $\ge 35.0\text{ bps}$ | Typically $> 5.0\%$ ADV | `BLOCK_CROSSING_REQUIRED` | Lit order book cannot absorb order without massive slippage. Route to SEBI Block Deal Window (08:45–09:00 or 14:05–14:20 IST) or institutional dark crossing. |

---

## 4. Production Service Architecture & Code Integration

The complete production implementation is delivered in `python-bridge/services/kyle_obizhaeva_impact_calibrator.py`:
- Ingests `AssetMicrostructureData` (price, volume, volatility) and `OrderExecutionSpec` (shares, side, max impact budget).
- Computes information arrival rate ($I$) and invariant bet scaling ($Q^*$).
- Evaluates non-linear square-root price impact and rupee degradation costs.
- Calculates optimal POV participation rates.
- Persists all observations to SQLite table `kyle_obizhaeva_impact_telemetry` for compliance and execution TCA reporting.

---

## 5. Verification & Test Suite

The engine was fully validated against unit tests in `python-bridge/tests/test_kyle_obizhaeva_impact_calibrator.py`:
1. `test_small_order_aggressive_twap`: Confirms that a $5,000$ share order in RELIANCE incurs $< 10.0\text{ bps}$ impact ($2.85\text{ bps}$) and triggers `AGGRESSIVE_TWAP`.
2. `test_moderate_order_passive_pov`: Confirms that a $100,000$ share order ($2.0\%$ ADV) incurs $12.7\text{ bps}$ impact and triggers `PASSIVE_POV_ALGO` with optimal $\text{POV}^* \approx 7.7\%$.
3. `test_large_order_block_crossing_required`: Confirms that a $1,000,000$ share order ($20\%$ ADV) incurs $> 35.0\text{ bps}$ impact ($40.2\text{ bps}$) and triggers `BLOCK_CROSSING_REQUIRED`.
4. `test_invariant_bet_size_and_information_rate`: Validates computation of information arrival rate ($22.5$ Crores/day) and invariant bet scaling ($333.3$ shares).
5. `test_sqlite_persistence`: Validates relational database persistence and telemetry querying.

**Execution Result**:
```
tests/test_kyle_obizhaeva_impact_calibrator.py::test_small_order_aggressive_twap PASSED [ 20%]
tests/test_kyle_obizhaeva_impact_calibrator.py::test_moderate_order_passive_pov PASSED [ 40%]
tests/test_kyle_obizhaeva_impact_calibrator.py::test_large_order_block_crossing_required PASSED [ 60%]
tests/test_kyle_obizhaeva_impact_calibrator.py::test_invariant_bet_size_and_information_rate PASSED [ 80%]
tests/test_kyle_obizhaeva_impact_calibrator.py::test_sqlite_persistence PASSED [100%]
5 passed in 0.04s
```
