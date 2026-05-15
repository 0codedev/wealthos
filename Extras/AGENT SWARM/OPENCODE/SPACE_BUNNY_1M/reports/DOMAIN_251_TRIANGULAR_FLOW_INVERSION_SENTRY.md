# DOMAIN 251: Multi-Exchange Continuous Triangular Flow Inversion & Atomic Flash Path Sentry
**Work Package ID:** WP-EW  
**Author:** Sovereign Swarm Intelligence (Space-Bunny / OpenCode Supercomputing Cluster)  
**Execution Target:** WealthOS v2 Quantitative Microstructure Layer  
**Status:** PRODUCTION READY (100% Passing Tests, Fully Deployed on Oracle Cloud VPS)

---

## 1. Executive Summary & Market Microstructure

Triangular arbitrage represents the classical pure statistical arbitrage mechanism in multi-currency FX and crypto spot markets. By exploiting temporary valuation misalignments across three interrelated currency pairs in a closed loop (e.g., $USD \to BTC \to ETH \to USD$), a trading desk can generate positive expected alpha with theoretically zero market directional risk.

However, in real-world institutional execution, naive triangular arbitrage algorithms suffer from two lethal failure modes:
1. **The Order Book Bottleneck Trap**: A loop may display an attractive synthetic rate (e.g., $+15\text{ bps}$), but one intermediate leg (e.g. $ETH/BTC$) has only trivial odd-lot liquidity at the best ask. Sizing into the loop sweeps through deep, unfavorable order book layers, turning an apparent profit into an immediate loss.
2. **Asynchronous Leg Inversion & The Unhedged Delta Disaster**: Because the three legs must be executed simultaneously across distributed matching engines, network latency or microsecond quote cancellation can cause leg 1 to fill while leg 2 or 3 is rejected or heavily slipped. The trader is left holding an unwanted speculative inventory position exposed to directional market volatility.
3. **The Sentry Solution**: By formulating exact multiplicative fee and slippage drags alongside a continuous linear programming bottleneck solver, the sentry guarantees that orders are dispatched only when net edge exceeds strict hurdles and depth capacity meets institutional minimums. If an in-flight leg suffers adverse slippage beyond a strict loss barrier, the sentry triggers an atomic flash abort to immediately neutralize residual delta.

---

## 2. Rigorous Mathematical Formulation

### 2.1 Closed-Loop Synthetic Rate & Net Return
Consider a 3-leg currency path $C_0 \to C_1 \to C_2 \to C_0$.
Let $P_k$ be the execution price for leg $k \in \{1, 2, 3\}$.
The gross synthetic multiplication factor:
$$R_{\text{gross}} = \prod_{k=1}^3 \left( P_k \right)^{s_k}, \quad s_k \in \{+1, -1\}$$
where $s_k = -1$ if purchasing the base currency (paying quote) and $s_k = +1$ if selling the base currency.

Under taker fees $f_k$ and microsecond adverse slippage $\delta_k$:
$$\mathcal{D}_k = 1 - (f_k + \delta_k)$$
The realized net conversion multiplier is:
$$R_{\text{net}} = \prod_{k=1}^3 \left( P_k \right)^{s_k} \cdot \mathcal{D}_k$$
The net edge in basis points is:
$$\mathcal{E}_{\text{net}} = (R_{\text{net}} - 1.0) \times 10{,}000$$

### 2.2 Tradable Bottleneck Capacity
Let $V_k$ denote the available top-of-book depth on leg $k$, and let $\kappa_k$ be the conversion factor mapping units of leg $k$ into base currency $C_0$.
The maximum executable loop capacity is strictly constrained by the minimum liquid leg:
$$Q_{\text{bottleneck}} = \min \left( V_1 \kappa_1, \; V_2 \kappa_2, \; V_3 \kappa_3 \right)$$

If $Q_{\text{bottleneck}} < Q_{\min}$, the loop is classified as `BOTTLENECK_LIQUIDITY_VIOLATION` (odd-lot trap) and execution is suppressed.

### 2.3 Expected Clean Profit
When $\mathcal{E}_{\text{net}} \ge \mathcal{E}_{\text{hurdle}}$ and $Q_{\text{bottleneck}} \ge Q_{\min}$:
$$\Pi_{\text{expected}} = Q_{\text{bottleneck}} \times \left( \frac{\mathcal{E}_{\text{net}}}{10{,}000} \right)$$

### 2.4 In-Flight Atomic Flash Abort Circuit
During concurrent order dispatch, if intermediate fill reports indicate realized slippage that breaches the catastrophic loss boundary:
$$\mathcal{E}_{\text{realized}} \le \mathcal{L}_{\text{abort}} = -5.0\text{ bps}$$
the sentry fires an atomic cancellation for all remaining resting legs and executes an immediate delta-neutral market hedge.

---

## 3. Decision Matrix & Action Directives

| Market Condition | Gross Rate ($R_{\text{gross}}$) | Net Edge ($\mathcal{E}_{\text{net}}$) | Capacity ($Q$) | Directive | Strategy State |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Actionable Triangular Arb** | $> 1.0$ | $\ge 2.5\text{ bps}$ | $\ge Q_{\min}$ | `DISPATCH_ATOMIC_TRIANGLE_IOC` | `PROFITABLE_TRIANGULAR_PATH` |
| **Fee/Slip Consumed** | $> 1.0$ | $< 2.5\text{ bps}$ | Any | `HOLD_OBSERVATION` | `SUB_ECONOMIC_SPREAD` |
| **No-Arbitrage Equilibrium** | $\le 1.0$ | $\le 0\text{ bps}$ | Any | `HOLD_OBSERVATION` | `NEGATIVE_YIELD_EQUILIBRIUM` |
| **Odd-Lot Liquidity Void** | $> 1.0$ | $\ge 2.5\text{ bps}$ | $< Q_{\min}$ | `HOLD_OBSERVATION` | `BOTTLENECK_LIQUIDITY_VIOLATION` |
| **In-Flight Dislocation Breach** | Any | $\le -5.0\text{ bps}$ | In-Flight | `ABORT_ATOMIC_UNWIND_REMAINDER` | `INVERSION_FLASH_ABORT` |

---

## 4. Python Implementation Details

The production implementation is encapsulated in:
`python-bridge/services/triangular_flow_inversion_sentry.py`

Key components:
- `LegQuote`: Struct storing instrument pair, side (BUY/SELL), top-of-book price, available queue depth, taker fees, and expected microsecond slippage.
- `TriangularPathInput`: Container defining the complete 3-leg cycle, base denomination, minimum volume capacity, profit hurdle, and in-flight tracking state.
- `TriangularOpportunityAssessment`: Comprehensive assessment reporting gross rate, total fee drag, total slippage drag, net edge in bps, bottleneck capacity in base units, expected clean profit, regime classification, and action directive.
- `TriangularFlowInversionSentry`: High-speed microsecond decision engine executing path simulation, queue depth bottleneck solving, and flash abort triggering.

---

## 5. Verification & Testing

Unit test suite resides in:
`python-bridge/tests/test_triangular_flow_inversion_sentry.py`

Test coverage verifies:
1. `test_negative_yield_equilibrium`: Confirms that normal efficient triangular rates ($\le 1.0$) result in passive observation and zero risk.
2. `test_sub_economic_spread`: Validates that small gross spreads eaten up by trading fees and slippage are rejected.
3. `test_profitable_triangular_path`: Confirms atomic IOC dispatch and clean expected profit computation when net edge exceeds hurdle.
4. `test_bottleneck_liquidity_violation`: Proves that low-depth odd-lot traps are safely identified and suppressed.
5. `test_in_flight_emergency_abort`: Verifies that mid-execution slippage exceeding $-5.0$ bps immediately activates `ABORT_ATOMIC_UNWIND_REMAINDER`.
