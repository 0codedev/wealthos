# DOMAIN 187: REAL-TIME INTRADAY FLOW TOXICITY & ADVERSE SELECTION SLIPPAGE SIEVE (WP-CK)

**Executive Swarm Intelligence Technical Report**  
**Autonomous Agent:** `Space-Bunny / OpenCode Sovereign Swarm (Variant Max, Mega-Context 1M)`  
**Domain Vertical:** WP-CK / Domain 187: Real-Time Intraday Flow Toxicity & Adverse Selection Slippage Sieve  
**Timestamp:** 2026-10-18T06:49:00+05:30  
**Status:** 🟢 **PRODUCTION READY / FULLY TESTED**  

---

## 1. Executive Summary & Quantitative Mandate

In order-driven financial markets, liquidity providers (market makers) earn the half-spread by quoting passive bids and asks. However, they face a fundamental operational threat: **adverse selection**. When counterparties possess superior information (e.g., institutional block sweepers, latency arbitrageurs, or order book imbalance detectors), they trade aggressively against resting quotes immediately prior to market price dislocations.

If a market maker fills a buyer who sweeps the ask, and the mid-quote price immediately drifts higher, the maker's **realized spread turns negative** ($\text{Spread}_{\text{real}} < 0$). In this scenario, the effective spread collected is completely obliterated by post-trade price impact, inflicting persistent losses on naive liquidity provision.

Domain 187 delivers a sub-second **Real-Time Intraday Flow Toxicity & Adverse Selection Slippage Sieve**:
1. Decomposes trade execution fills into the fundamental microstructure triad: **Effective Spread**, **Realized Spread**, and **Price Impact** across configurable post-trade horizons $\tau \in [100\text{ ms}, 5\text{ s}]$.
2. Enforces the strict mathematical invariant: $\text{Spread}_{\text{eff}} \equiv \text{Spread}_{\text{real}} + \text{Impact}$.
3. Formulates the **Flow Toxicity Ratio** ($\mathcal{T}$), quantifying the proportion of spread revenue eroded by adverse selection.
4. Dynamically shifts maker/taker operational profiles: vetoing passive quotes and widening quoting spreads by up to $2.5\times$ during toxic sweeps (`DEFENSIVE_SPREAD_WIDENING_VETO_PASSIVE`), piggybacking institutional momentum (`FOLLOW_INFORMED_FLOW_MOMENTUM`), or tightening spreads during benign retail flow (`BENIGN_RETAIL_FLOW_TIGHTEN_QUOTES`).

---

## 2. Mathematical Specifications & Microstructure Mechanics

### 2.1 Spread Decomposition Formulation
For trade $k$ executed at price $P_k$ at time $t_k$ with trade direction $q_k \in \{+1 (\text{Buy}), -1 (\text{Sell})\}$ against prevailing mid-quote $M_k$:
Let $M(t_k + \tau)$ denote the post-trade mid-quote after horizon $\tau$.

All metrics are expressed in basis points relative to initial mid-quote $M_k$:
- **Effective Spread** (Total roundtrip price paid by taker):
  $$\text{Spread}_{\text{eff}, k} = 2 \cdot q_k \cdot \left( \frac{P_k - M_k}{M_k} \right) \times 10^4 \text{ bps}$$

- **Realized Spread** (Net economic revenue retained by liquidity provider):
  $$\text{Spread}_{\text{real}, k}(\tau) = 2 \cdot q_k \cdot \left( \frac{P_k - M(t_k + \tau)}{M_k} \right) \times 10^4 \text{ bps}$$

- **Price Impact / Adverse Selection** (Permanent information component):
  $$\text{Impact}_k(\tau) = 2 \cdot q_k \cdot \left( \frac{M(t_k + \tau) - M_k}{M_k} \right) \times 10^4 \text{ bps}$$

### 2.2 Mathematical Identity
By direct algebraic substitution:
$$\text{Spread}_{\text{real}, k} + \text{Impact}_k = 2 q_k \left( \frac{P_k - M(t_k + \tau) + M(t_k + \tau) - M_k}{M_k} \right) \equiv \text{Spread}_{\text{eff}, k}$$

This identity guarantees zero accounting leakages in flow toxicity measurement.

### 2.3 Flow Toxicity Ratio ($\mathcal{T}$)
Aggregating over a rolling batch of $K$ executions weighted by quantity $V_k$:
$$\mathcal{T} = \frac{\sum_{k=1}^K V_k \cdot \max(0, \text{Impact}_k)}{\max(0.1, \sum_{k=1}^K V_k \cdot \text{Spread}_{\text{eff}, k})}$$

- **$\mathcal{T} \le 0.35$ (Benign Flow)**: Price impact is negligible; price mean-reverts back to mid quote. Liquidity providers retain $>65\%$ of the effective spread.
- **$\mathcal{T} \ge 0.70$ (Toxic Informed Flow)**: Aggressive trades are systematically followed by large same-direction price displacement. Market makers experience negative realized spreads.

### 2.4 Quoting Governor & Spread Multiplier
To prevent adverse selection insolvency during toxic sweeps:
$$\text{Spread Multiplier} = \min\left(2.50, \; 1.0 + 1.50 \cdot \mathcal{T}\right)$$

- When $\mathcal{T} \ge 0.70$ and $\text{Spread}_{\text{real}} < 0$: Trigger `DEFENSIVE_SPREAD_WIDENING_VETO_PASSIVE`, widen maker spreads by up to $2.5\times$, and cancel resting passive limit orders.
- When $\mathcal{T} \le 0.35$: Trigger `BENIGN_RETAIL_FLOW_TIGHTEN_QUOTES`, tighten maker spreads by $15\%$ (multiplier $0.85\times$) to capture maximum retail volume.

---

## 3. Production Architecture & Verification

Implemented in `python-bridge/services/adverse_selection_slippage_sieve.py` and validated by 4/4 unit tests in `python-bridge/tests/test_adverse_selection_slippage_sieve.py`:
1. `test_exact_spread_decomposition_identity`: Confirms exact mathematical identity $\text{Spread}_{\text{eff}} \equiv \text{Spread}_{\text{real}} + \text{Impact}$ to $10^{-4}\text{ bps}$.
2. `test_severe_adverse_selection_veto`: Validates detection of informed sweeps ($\text{RealizedSpread} < 0, \mathcal{T} \ge 0.70$), triggering $1.8\times+$ spread widening and `DEFENSIVE_SPREAD_WIDENING_VETO_PASSIVE`.
3. `test_benign_retail_uninformed_flow`: Confirms detection of noise flow ($\mathcal{T} \le 0.35$), triggering $0.85\times$ spread tightening.
4. `test_sqlite_persistence`: Validates automated logging to `adverse_selection_telemetry`.

---

## 4. Telemetry Schema & Persistence

All evaluated execution batches are logged to SQLite table `adverse_selection_telemetry`:
```sql
CREATE TABLE IF NOT EXISTS adverse_selection_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    symbol TEXT NOT NULL,
    eff_spread_bps REAL NOT NULL,
    real_spread_bps REAL NOT NULL,
    price_impact_bps REAL NOT NULL,
    toxicity_ratio REAL NOT NULL,
    spread_mult REAL NOT NULL,
    directive TEXT NOT NULL,
    rationale TEXT NOT NULL
);
```

---

## 5. Quantitative Invariants & Execution Directives

1. **Negative Realized Spread Veto**: A negative realized spread is the canonical indicator of toxic flow. Never attempt passive market making on a symbol when $\text{Spread}_{\text{real}}(\tau) < 0$.
2. **Piggybacking Asymmetry**: When informed flow sweeps the book, the optimal strategy shifts from passive defense to aggressive trend following (`FOLLOW_INFORMED_FLOW_MOMENTUM`).
3. **Sovereign Swarm Ready**: Verified and synchronized across local repositories and Oracle Cloud VPS.
