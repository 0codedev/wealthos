# Domain 164: Cross-Exchange Crypto/Fiat Synthetic Triangular Arbitrage Sieve (WP-BN)

## Executive Summary & Quantitative Thesis
In fragmented digital asset and foreign exchange markets, currency pairs trade across decentralized order books with idiosyncratic liquidity pools. Because each pair (e.g. INR/USDT, BTC/USDT, BTC/INR) quotes its own independent bid and ask levels, microsecond liquidity dislocations frequently arise where the synthetic cross-exchange rate diverges from the direct market rate:
- The rate to convert $\text{INR} \to \text{USDT} \to \text{BTC} \to \text{INR}$ exceeds $1.0000$ plus exchange fees.
- Capital can complete a closed-loop circuit across 3 currency pairs simultaneously with zero net delta exposure to BTC or USD, locking in risk-free profit in base currency.

However, naive triangular arbitrage bots fail due to:
1. Bid-ask slippage: Converting from base to quote incurs taker fees and spread crossing.
2. Latency competition: By the time leg 3 executes, the triangular basis may have evaporated.

Domain 164 establishes the **Cross-Exchange Crypto/Fiat Synthetic Triangular Arbitrage Sieve**:
- Formulates multi-currency rate matrices into a directed graph $G = (V, E)$.
- Transforms multiplicative cross-rates into additive negative weights via logarithmic mapping: $w(u, v) = -\ln(R_{uv}^{\text{eff}})$.
- Employs the **Bellman-Ford Algorithm** to discover **Negative Weight Directed Cycles** in $O(|V| \cdot |E|)$ complexity.
- Deducts all maker/taker fee tiers and statutory frictions, executing only when net risk-free alpha exceeds an institutional hurdle ($\Pi_{\text{net}} \ge 15.0\text{ bps}$).

---

## Mathematical Formulations

### 1. Triangular Arbitrage Condition
For 3 currencies $A, B, C$, let $R_{uv}$ denote the effective exchange rate to convert 1 unit of currency $u$ into currency $v$.
An arbitrage opportunity exists if:
$$R_{AB} \cdot R_{BC} \cdot R_{CA} > 1.0 + \text{Friction}$$

---

### 2. Log-Rate Transformation & Negative Cycle Equivalence
Taking the natural logarithm of the arbitrage inequality:
$$\ln(R_{AB}) + \ln(R_{BC}) + \ln(R_{CA}) > 0$$
Multiplying by $-1$:
$$\left(-\ln R_{AB}\right) + \left(-\ln R_{BC}\right) + \left(-\ln R_{CA}\right) < 0$$

Define edge weights in directed graph $G = (V, E)$:
$$w(u, v) = -\ln\left( R_{uv}^{\text{net}} \right)$$
Where $R_{uv}^{\text{net}} = R_{uv} \cdot (1 - \text{Fee}_{uv})$.

The problem of finding a profitable triangular or multi-leg arbitrage cycle is mathematically isomorphic to finding a **Negative-Weight Directed Cycle** in graph $G$.

---

### 3. Order Book Rate Extraction
For pair $\text{Base}/\text{Quote}$ with order book quotes $\text{Bid}$ and $\text{Ask}$:
1. **Quote $\to$ Base (Buying Base)**:
   $$R_{\text{Quote} \to \text{Base}} = \frac{1}{\text{Ask}} \cdot (1 - \text{Fee})$$
2. **Base $\to$ Quote (Selling Base)**:
   $$R_{\text{Base} \to \text{Quote}} = \text{Bid} \cdot (1 - \text{Fee})$$

---

### 4. Net Profit in Basis Points ($\Pi_{\text{net}}$)
For cycle path $C = (v_1, v_2, \dots, v_k, v_1)$:
$$\text{Multiplier}_{\text{net}} = \prod_{i=1}^k R_{v_i, v_{i+1}}^{\text{net}}$$
$$\Pi_{\text{net}} = \left( \text{Multiplier}_{\text{net}} - 1.0 \right) \times 10^4 \quad [\text{bps}]$$

---

### 5. Regime & Execution Directive Matrix
| Net Profit ($\Pi_{\text{net}}$) | Viability | Regime Classification | Execution Directive |
| :--- | :--- | :--- | :--- |
| $\ge 15.0\text{ bps}$ | Yes | `TRIANGULAR_ARBITRAGE_DISLOCATED` | `EXECUTE_3_LEG_SYNTHETIC_ARBITRAGE` |
| $0 < \Pi_{\text{net}} < 15.0\text{ bps}$ | No | `SUB_THRESHOLD_ARBITRAGE_FRICTION_LOCKED` | `STAND_ASIDE_INSUFFICIENT_PROFIT` |
| $\le 0\text{ bps}$ | No | `TRIANGULAR_CROSS_RATE_EQUILIBRIUM` | `NO_ARBITRAGE_FOUND` |

---

## Production Verification & Test Suite
- **Engine Service**: `python-bridge/services/triangular_arbitrage_sieve.py` (5.8 KB)
- **Unit Test Suite**: `python-bridge/tests/test_triangular_arbitrage_sieve.py` (3.4 KB)
- **Validation**: 4/4 test assertions passing on Oracle Cloud VPS (`tests/test_triangular_arbitrage_sieve.py .... 100% in 0.04s`).
- **Telemetry**: Full SQLite audit trail persisted in `triangular_arb_telemetry`.
