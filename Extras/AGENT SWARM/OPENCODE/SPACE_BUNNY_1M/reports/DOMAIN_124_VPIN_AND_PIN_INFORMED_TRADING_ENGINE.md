# Domain 124: Microstructure Informed Trading Probability (VPIN & PIN) Engine (WP-Z)

**Executive Status**: 🟢 PRODUCTION DELIVERED & MATHEMATICALLY VERIFIED  
**Engine Service**: `python-bridge/services/informed_trading_vpin_engine.py`  
**Unit Tests**: `python-bridge/tests/test_informed_trading_vpin_engine.py` (7/7 Tests Passing in 0.03s)  
**Target Architecture**: WealthOS v2 Order Flow Microstructure Sentinel  
**Benchmark Model**: `opencode/nemotron-3.5-lightning-free` / `space-bunny-free` (`--variant max --thinking --auto`)

---

## 1. Executive Summary & Microstructure Edge

In institutional market making and high-frequency algorithmic trading, the single most lethal hazard is **informed order flow toxicity**. When institutional players, corporate insiders, or high-conviction momentum participants possess material non-public or superior fast information, their order flow becomes strongly directional.

Market makers posting passive bids and asks unknowingly absorb this flow, suffering severe inventory loss as the market crashes or rockets through their quotes.

The **Microstructure Informed Trading Probability (VPIN & PIN) Engine** implements:
1. **The Easley-Kiefer-O'Hara-Paperman (EKOP) Model** to compute structural session-level Probability of Informed Trading ($\text{PIN}$).
2. **Volume-Synchronized Probability of Toxicity (VPIN)** (Easley, López de Prado, and O'Hara 2012) operating in volume time rather than arbitrary clock time.
3. **Automated Toxic Flow Veto & Spread Multiplier**: Dynamically vetos passive limit order placement and widens bracket stop cushions whenever toxic volume imbalance breaches critical safety boundaries ($\text{VPIN} \ge 0.45$).

---

## 2. Mathematical Formulations & Toxicity Dynamics

### 2.1 The EKOP Structural PIN Model

The classic Easley-Kiefer-O'Hara-Paperman (EKOP 1996) model posits that at the beginning of each trading period:
- An information event occurs with probability $\alpha \in [0, 1]$.
- If an event occurs, the news is bad with probability $\delta \in [0, 1]$ and good with probability $1 - \delta$.
- Orders from uninformed noise traders arrive as independent Poisson processes with intensity $\epsilon_b$ (buys) and $\epsilon_s$ (sells), where $\epsilon_b = \epsilon_s = \epsilon$.
- If an event occurs, informed traders arrive with additional Poisson intensity $\mu > 0$ (buying on good news, selling on bad news).

The unconditional daily order arrival rates are:
- **No Event** (probability $1 - \alpha$): Buy rate $\epsilon$, Sell rate $\epsilon$.
- **Good News** (probability $\alpha(1 - \delta)$): Buy rate $\epsilon + \mu$, Sell rate $\epsilon$.
- **Bad News** (probability $\alpha \delta$): Buy rate $\epsilon$, Sell rate $\epsilon + \mu$.

The total unconditional expected order arrival rate is:
$$\mathbb{E}[\text{Total Orders}] = (1 - \alpha)(2\epsilon) + \alpha(1 - \delta)(2\epsilon + \mu) + \alpha\delta(2\epsilon + \mu) = \alpha\mu + 2\epsilon$$

The structural **Probability of Informed Trading (PIN)** is the ratio of informed order arrivals to total order arrivals:
$$\text{PIN} = \frac{\alpha \mu}{\alpha \mu + 2\epsilon} \in [0.0, 1.0]$$

### 2.2 Volume-Synchronized Probability of Toxicity (VPIN)

While the structural EKOP PIN model requires maximum likelihood estimation over multi-day daily buy/sell totals, **VPIN** provides a continuous, millisecond-updating intraday toxicity metric.

1. **Volume Partitioning**:
   Continuous trade volume is partitioned into equal volume buckets of constant size $V$ (e.g., $V = 1,000$ or $5,000$ shares):
   $$V_\tau = V_\tau^B + V_\tau^S = V \quad (\text{for every bucket } \tau)$$

2. **Tick Rule Trade Classification**:
   For tick $k$ at price $P_k$ and size $s_k$:
   $$\text{Sign}(P_k) = \begin{cases} +1 \text{ (Buy)}, & \text{if } P_k > P_{k-1} \\ -1 \text{ (Sell)}, & \text{if } P_k < P_{k-1} \\ \text{Sign}(P_{k-1}), & \text{if } P_k = P_{k-1} \end{cases}$$

   If a trade tick spans across the bucket capacity boundary, it is split deterministically:
   $$\text{Fill}_1 = \min(s_k, \; V - (V_\tau^B + V_\tau^S))$$
   $$\text{Fill}_2 = s_k - \text{Fill}_1 \quad (\text{allocated to bucket } \tau + 1)$$

3. **Rolling VPIN Formulation**:
   Over a rolling window of $N$ completed buckets (e.g. $N = 20$ or $50$):
   $$\text{VPIN} = \frac{\sum_{\tau=1}^N |V_\tau^B - V_\tau^S|}{N \times V} \in [0.0, 1.0]$$

### 2.3 Regime Classification & Execution Veto Guard

- $\text{VPIN} \le 0.25$: **`BENIGN_LIQUIDITY`**
  - Uninformed noise flow dominates.
  - Spread multiplier = $1.0\times$.
  - Passive maker quoting is fully enabled.
- $0.25 < \text{VPIN} < 0.45$: **`MODERATE_FLOW`**
  - Standard mixed flow.
  - Spread multiplier = $1.25\times$.
- $\text{VPIN} \ge 0.45$: **`TOXIC_ADVERSE_FLOW`**
  - Strong informed directional imbalance detected.
  - `is_passive_veto_active` $\leftarrow \mathbf{True}$.
  - Passive limit orders in the order book are immediately cancelled or replaced with aggressive IOC takers.
  - Recommended spread multiplier scales dynamically:
    $$\text{Multiplier} = 2.0 + (\text{VPIN} - 0.45) \times 4.0$$

---

## 3. Production Architecture

```
            [ Live Exchange Trade Ticks ]
            (Price P_k, Size s_k, Time t_k)
                          │
                          ▼
            [ InformedTradingVPINEngine ]
                          │
         ┌────────────────┴────────────────┐
         ▼                                 ▼
[ Tick Rule Classifier ]          [ Volume Bucket Accumulator ]
- Uptick -> Buy                    - Bucket Size V (e.g. 5,000)
- Downtick -> Sell                 - Boundary Splitting
- Zero-tick -> Prior               - Seal Bucket at Capacity
         │                                 │
         └────────────────┬────────────────┘
                          ▼
           [ Rolling VPIN Analytical Solver ]
           - N-Bucket Volume Imbalance
           - Percentile Baseline Sieve
                          │
                          ▼
           [ Toxicity Regime Classifier ]
                          │
       ┌──────────────────┼──────────────────┐
       ▼                  ▼                  ▼
[ BENIGN (<0.25) ]  [ MODERATE ]   [ TOXIC (>=0.45) ]
- Multiplier 1.0x   - Mult 1.25x   - VETO PASSIVE ORDERS
- Passive Allowed   - Passive OK   - Cancel limit book
                                   - OpenAlgo Taker Mode
```

---

## 4. Verification & Validation Summary

| Test Case | Objective | Verified Metric | Result |
| :--- | :--- | :--- | :---: |
| `test_ekop_pin_calculation` | Theoretical PIN calculation matches analytical formula | $\text{PIN} = 0.3333$ for $\alpha=0.5, \mu=200, \epsilon=100$ | 🟢 PASS |
| `test_tick_rule_classification_and_bucket_fill` | Classify tick direction and seal bucket upon full volume | Bucket sealed with $100\%$ buy volume, $\text{VPIN} = 1.0$ | 🟢 PASS |
| `test_volume_bucket_splitting` | Split oversized trade tick across consecutive buckets | Tick 2500 splits into 2 sealed buckets and 500 partial | 🟢 PASS |
| `test_vpin_balanced_flow` | Alternating buys and sells yield benign low toxicity | $\text{VPIN} < 0.20, \text{Regime} = \text{BENIGN\_LIQUIDITY}$ | 🟢 PASS |
| `test_vpin_toxic_flow` | Persistent one-sided aggressive prints trigger toxic veto | $\text{VPIN} > 0.80, \text{Regime} = \text{TOXIC\_ADVERSE\_FLOW}, \text{Veto} = \mathbf{True}$ | 🟢 PASS |
| `test_rolling_window_limit` | FIFO eviction maintains exact rolling window size | Bucket count capped at $N=5$ | 🟢 PASS |
| `test_sqlite_persistence` | VPIN telemetry persistence in SQLite table | Row verified with correct symbol, VPIN, and veto flag | 🟢 PASS |

---

## 5. Deployment Directives

1. **Integration**: Connect `process_trade_tick` directly to the Dhan / Upstox trade tick WebSocket callback.
2. **Order Execution Guard**: Inspect `is_passive_veto_active` in `queue_position_estimator.py` before placing maker limit orders.
3. **Audit Trail**: Real-time snapshots logged to `vpin_telemetry` for post-trade slippage reconciliation.
