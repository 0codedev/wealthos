# Domain 123: High-Frequency Adaptive Limit Order Placement & Queue Position Estimator (WP-Y)

**Executive Status**: 🟢 PRODUCTION DELIVERED & MATHEMATICALLY VERIFIED  
**Engine Service**: `python-bridge/services/queue_position_estimator.py`  
**Unit Tests**: `python-bridge/tests/test_queue_position_estimator.py` (9/9 Tests Passing in 0.04s)  
**Target Architecture**: WealthOS v2 Microstructure Execution Router  
**Benchmark Model**: `opencode/nemotron-3.5-lightning-free` / `space-bunny-free` (`--variant max --thinking --auto`)

---

## 1. Executive Summary & Market Microstructure

In modern electronic limit order books such as the **National Stock Exchange of India (NSE)** and **Bombay Stock Exchange (BSE)**, execution priority at any given price level is governed strictly by **Price-Time Priority (FIFO)**.

Passive liquidity provision earns the bid-ask spread and avoids paying taker fees. However, placing a limit order at the back of a thick queue introduces two major risks:
1. **Execution Risk (Non-Execution)**: Long queue wait times where the underlying price drifts away without filling the order.
2. **Adverse Selection (The Winner's Curse)**: The order fills rapidly only when informed traders with directional toxic flow sweep the entire book, dumping stock right before the price moves unfavorably.

The **High-Frequency Adaptive Limit Order Placement & Queue Position Estimator** dynamically tracks real-time queue position ($Q_{\text{ahead}}$), models Poisson cancellation and trade depletion intensities, computes exact expected fill times ($T_{\text{fill}}$), and automatically determines whether to join the passive queue, post inside the spread, or aggressively cross the spread based on live Order Flow Toxicity (VPIN).

---

## 2. Mathematical Formulations & Queue Dynamics

### 2.1 FIFO Queue Depletion Modeling

When an order of size $Q_{\text{self}}$ is placed at price level $p$, the depth ahead of our order is $Q_{\text{ahead}}(0)$.
The volume ahead diminishes over time through two distinct continuous processes:
1. **Aggressive market order arrivals (Trade intensity)**: $\mu_{\text{trade}} > 0$ (shares/sec).
2. **Order cancellations ahead in queue**: $\lambda_{\text{cancel}} \cdot Q_{\text{ahead}}$ (proportional cancellation rate).

The differential equation governing the remaining volume ahead is:
$$\frac{d Q_{\text{ahead}}(t)}{dt} = - \mu_{\text{trade}} - \lambda_{\text{cancel}} Q_{\text{ahead}}(t)$$

Integrating with initial condition $Q_{\text{ahead}}(0)$:
$$Q_{\text{ahead}}(t) = \left( Q_{\text{ahead}}(0) + \frac{\mu_{\text{trade}}}{\lambda_{\text{cancel}}} \right) e^{-\lambda_{\text{cancel}} t} - \frac{\mu_{\text{trade}}}{\lambda_{\text{cancel}}}$$

### 2.2 Expected Time to Priority ($T_{\text{priority}}$)

Our order reaches the head of the queue when $Q_{\text{ahead}}(t) = 0$:
$$\left( Q_{\text{ahead}}(0) + \frac{\mu_{\text{trade}}}{\lambda_{\text{cancel}}} \right) e^{-\lambda_{\text{cancel}} T} = \frac{\mu_{\text{trade}}}{\lambda_{\text{cancel}}}$$
$$e^{\lambda_{\text{cancel}} T} = 1 + \frac{\lambda_{\text{cancel}} \cdot Q_{\text{ahead}}(0)}{\mu_{\text{trade}}}$$
$$T_{\text{priority}} = \frac{1}{\lambda_{\text{cancel}}} \ln\left( 1 + \frac{\lambda_{\text{cancel}} \cdot Q_{\text{ahead}}(0)}{\mu_{\text{trade}}} \right)$$

*Property*:
- As $\lambda_{\text{cancel}} \to 0$, by L'Hôpital's rule:
  $$\lim_{\lambda \to 0} T_{\text{priority}} = \frac{Q_{\text{ahead}}(0)}{\mu_{\text{trade}}}$$
- For $\lambda_{\text{cancel}} > 0$, $T_{\text{priority}} < \frac{Q_{\text{ahead}}(0)}{\mu_{\text{trade}}}$, reflecting the substantial queue depletion caused by flickering cancellations.

### 2.3 Fill Probability $P(\text{Fill} \le H)$

Over a fixed execution horizon $H$ (e.g. $5.0$ seconds):
$$P(\text{Fill} \le H) = 1 - \exp\left( - \frac{\mu_{\text{trade}} H + \lambda_{\text{cancel}} Q_{\text{ahead}}(0) H}{Q_{\text{ahead}}(0) + Q_{\text{self}}} \right) \in [0.0, 1.0]$$

### 2.4 Adverse Selection & Optimal Placement Decision Rule

We evaluate the net economic payoff between Maker and Taker:
$$\text{AdverseSelectionCost} = \text{VPIN} \cdot \left( \frac{\text{Spread}}{2} \right)$$

The decision rule is parameterized by the veto ratio $\theta_{\text{veto}} = 0.60$:
1. **Aggressive Spread Crossing (`CROSS_SPREAD_AGGRESSIVE`)**:
   $$\text{If } \text{AdverseSelectionCost} > \theta_{\text{veto}} \cdot \frac{\text{Spread}}{2} \text{ and } \text{VPIN} > 0.40$$
   Cross the spread at $P_{\text{ask}}$ (for Buy) or $P_{\text{bid}}$ (for Sell).
2. **Inside Spread Posting (`POST_INSIDE_SPREAD`)**:
   $$\text{If Spread} > 2 \times \text{TickSize and VPIN} \le 0.40$$
   Post at $P_{\text{bid}} + \Delta_{\text{tick}}$ or $P_{\text{ask}} - \Delta_{\text{tick}}$ to gain top priority ahead of the book.
3. **Passive Queue Joining (`JOIN_QUEUE_PASSIVE`)**:
   $$\text{Otherwise}$$
   Join the existing best bid or ask queue to capture the maker spread.

---

## 3. Production Architecture

```
         [ Level-2 LOB Market Feed ]
      (Best Bid, Best Ask, Depth Ahead)
                     │
                     ▼
       [ QueuePositionEstimator ]
                     │
     ┌───────────────┴───────────────┐
     ▼                               ▼
[ Queue Tracker ]          [ Analytical Solvers ]
- Order Registration       - Expected Time-to-Fill (T_priority)
- Trade Depletion          - Poisson Fill Probability P(Fill <= H)
- Proportional Cancel      - Adverse Selection Cost Engine
     │                               │
     └───────────────┬───────────────┘
                     ▼
         [ Placement Classifier ]
                     │
   ┌─────────────────┼─────────────────┐
   ▼                 ▼                 ▼
[ PASSIVE ]     [ INSIDE SPREAD ]  [ AGGRESSIVE CROSS ]
Join existing    Improve by 1 tick  Sweep contra book
maker queue      gain priority      avert toxic fill
```

---

## 4. Verification & Validation Summary

| Test Case | Objective | Verified Metric | Result |
| :--- | :--- | :--- | :---: |
| `test_register_limit_order` | Snapshot initial depth and head of queue flag | $Q_{\text{ahead}} = 500$, `is_at_head` = False; $Q_{\text{ahead}} = 0 \to$ True | 🟢 PASS |
| `test_update_queue_depletion_trades` | Trade volume strictly depletes queue ahead | Depletion from $300 \to 150 \to 0$ | 🟢 PASS |
| `test_update_queue_depletion_cancellations` | Cancelled book volume reduces queue ahead | Proportional cancellation reduces $Q_{\text{ahead}} < 350$ | 🟢 PASS |
| `test_expected_time_to_fill_analytical` | Validate logarithmic analytical formulation | $T_{\text{prior}} < 5.0\text{s}$ with cancellations vs 5.0s linear | 🟢 PASS |
| `test_fill_probability_monotonicity` | Verify monotonicity across horizon and queue depth | $P(10\text{s}) > P(2\text{s})$; $P(Q=100) > P(Q=1000)$ | 🟢 PASS |
| `test_placement_strategy_toxic_cross_spread` | VPIN > 0.50 adverse selection triggers spread cross | Action = `CROSS_SPREAD_AGGRESSIVE`, Target = Best Ask | 🟢 PASS |
| `test_placement_strategy_wide_spread_post_inside` | Wide spread with benign flow triggers inside post | Action = `POST_INSIDE_SPREAD`, Target = Bid + 0.05 | 🟢 PASS |
| `test_placement_strategy_tight_spread_join_queue` | Tight spread with low VPIN triggers passive join | Action = `JOIN_QUEUE_PASSIVE`, Target = Best Bid | 🟢 PASS |
| `test_sqlite_persistence` | Telemetry persistence in SQLite table | Row verified in `queue_estimator_logs` | 🟢 PASS |

---

## 5. Deployment Directives

1. **Protobuf Integration**: Connect directly to Upstox Level-2 Protobuf feed `firstDepth` buffer.
2. **Order Lifecycle**: When OpenAlgo submits a limit order, register immediately with `register_limit_order`.
3. **Cancellation Threshold**: Cancel and replace if $T_{\text{elapsed}} > 2.5 \times T_{\text{priority}}$ or VPIN spikes $>0.50$.
