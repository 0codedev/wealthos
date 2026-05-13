# Sovereign Swarm Architecture Blueprint: Domain 212 (WP-DJ)
# Multi-Exchange Continuous Double Auction Clearing & Latency Arb Sieve

**Fabric Layer**: `python-bridge/services/continuous_double_auction_clearing_sieve.py`  
**Test Suite**: `python-bridge/tests/test_continuous_double_auction_clearing_sieve.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: Walrasian Uniform Price Auction Optimization, Kuhn-Tucker Surplus Minimization, Multi-Venue Crossed Book Profitability Sieve, Exponential Latency Race Survival Kernel.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

Modern equity and derivative markets run on two primary market clearing mechanisms:
1. **Discrete Call Auctions**: Used during market open (09:00–09:15 IST), market close (15:30 IST), and post-volatility circuit halts, where all buy and sell orders are accumulated into a single virtual book and executed simultaneously at a single uniform clearing price $P^*$ that maximizes tradable matched volume.
2. **Continuous Double Auctions (CDA)**: Operating during regular market hours, continuously matching incoming aggressive flow against the resting limit book.

When fungible equities (e.g. Reliance, TCS, HDFC Bank) or crypto perpetuals trade across multiple competing venues (NSE vs BSE, Binance vs OKX vs Bybit), momentary discrepancies in matching engine processing speed, incoming order flow bursts, or network latency produce **Crossed Books** where the best bid on Venue $B$ exceeds the best ask on Venue $A$ ($P_{\text{bid}}^B > P_{\text{ask}}^A$).

Capturing this crossing arbitrage requires a quantitative latency sieve to prevent "leg-out" risk and orphan fills.

### 1.1 Discrete Call Auction Clearing Price Formulation

The equilibrium clearing price $P^*$ satisfies:
$$P^* = \arg\max_{P} \min\left( \sum_{p_b \ge P} Q_b(p_b), \sum_{p_a \le P} Q_a(p_a) \right)$$
Subject to minimizing the surplus imbalance:
$$\min_P \left| \sum_{p_b \ge P} Q_b(p_b) - \sum_{p_a \le P} Q_a(p_a) \right|$$

### 1.2 Cross-Venue Arbitrage & Net Margin Calculus

Gross Arbitrage Spread in Basis Points:
$$\text{GrossEdge}_{\text{bps}} = \frac{P_{\text{bid}}^{\text{sell}} - P_{\text{ask}}^{\text{buy}}}{P_{\text{mid}}} \times 10000$$

Net Arbitrage Edge after Statutory Exchange Taker Fees and Slippage:
$$\text{NetEdge}_{\text{bps}} = \text{GrossEdge}_{\text{bps}} - \left( \text{Fee}_{\text{buy}}^{\text{taker}} + \text{Fee}_{\text{sell}}^{\text{taker}} + \text{Slippage}_{\text{model}} \right)$$

### 1.3 Latency Race Survival Probability

Cross-market arbitrage opportunities have an empirical half-life of $\tau_{\text{decay}} \approx 1.50\text{ ms}$.
Given network round-trip time $\tau_{\text{RTT}} = 2 \cdot \max(\tau_{\text{one-way}}^A, \tau_{\text{one-way}}^B)$:
$$P_{\text{race}}(\tau_{\text{RTT}}) = \exp\left(-\frac{\tau_{\text{RTT}}}{\tau_{\text{decay}}}\right)$$

An opportunity is only actionable if:
$$\text{NetEdge}_{\text{bps}} \ge 1.0\text{ bps} \quad \text{AND} \quad P_{\text{race}} \ge 0.40$$

---

## 2. Market Regimes & Tactical Directives

1. **`NO_CROSS_EQUILIBRIUM`**:
   - Order books are strictly uncrossed ($P_{\text{bid}} < P_{\text{ask}}$ across all venue pairs).
   - Directive: `STANDBY_MONITOR`.
2. **`ARBITRAGE_CROSS_DETECTED`**:
   - Executable cross with positive net margin ($\ge 1.0$ bps) and high race survival ($P_{\text{race}} \ge 40\%$).
   - Directive: `EXECUTE_SYNCHRONOUS_CROSS`. Dispatch dual child orders simultaneously with hardware isochronous timing to lock in locked profit.
3. **`LATENCY_TRAP_DISQUALIFIED`**:
   - A superficial gross cross exists, but after exchange fees and latency decay, expected net edge is negative or race survival is low.
   - Directive: `REJECT_EXECUTION_STALE_CROSS`. Reject execution to prevent adverse leg-out selection.

---

## 3. Verification & Validation Metrics

- Unit tests (`tests/test_continuous_double_auction_clearing_sieve.py`):
  - Call auction clearing accurately finds the volume-maximizing equilibrium price ($P^* = 101.0, Q^* = 300$).
  - Uncrossed books are correctly classified as `NO_CROSS_EQUILIBRIUM` with zero actionable volume.
  - Robust cross (BSE Bid 2502.00 vs NSE Ask 2500.00) triggers `ARBITRAGE_CROSS_DETECTED` with net edge $> 5.0$ bps and $P_{\text{race}} > 50\%$.
  - Microscopic crosses (0.2 bps) with high fees trigger `LATENCY_TRAP_DISQUALIFIED` and rejection.
