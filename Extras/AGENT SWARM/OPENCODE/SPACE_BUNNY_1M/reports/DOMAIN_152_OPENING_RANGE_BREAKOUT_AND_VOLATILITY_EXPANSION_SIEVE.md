# Domain 152: Intraday Opening Range Breakout (ORB) & Volatility Expansion Sieve (WP-BB)

## Executive Summary & Quantitative Thesis
The market opening period (09:15 to 09:30 IST on the National Stock Exchange of India) concentrates an exceptional proportion of daily turnover, institutional order unbundling, and overnight information processing. The price boundaries established during this 15-minute window define the **Opening Range (Initial Balance)**:
- Breakouts beyond this range frequently establish the directional trend for the remainder of the session.
- However, naive breakout systems experience catastrophic decay due to **False Breakouts ("Wick Rejections" or "Traps")**, where retail stops are hunted before mean-reverting back into the value area.

Domain 152 implements the **Intraday Opening Range Breakout (ORB) & Volatility Expansion Sieve**:
- Ingests opening session candle bars and extracts the dynamic Initial Balance span: $\text{OR}_{\text{span}} = \text{OR}_{\text{high}} - \text{OR}_{\text{low}}$.
- Calibrates **Toby Crabel's Dynamic Stretch Factor** across historical daily sessions to set adaptive volatility breakout buffers.
- Mandates institutional **Volume Expansion Verification ($\mathcal{V}_{\text{ratio}} \ge 1.80 \times \text{SMA}_V(20)$)** to distinguish genuine institutional expansion from low-liquidity drift.
- Analyzes candlestick upper/lower wick rejection geometry to identify **Bull/Bear Traps ($\text{Wick}_{\text{ratio}} \ge 0.50$)** and issue instant mean-reversion fade directives.
- Provides dynamic risk-reward targets ($T_1 = 1.0\times\text{OR}_{\text{span}}, T_2 = 2.0\times\text{OR}_{\text{span}}$) and structured stop boundaries.

---

## Mathematical Formulations

### 1. Opening Range Geometry
Given the sequence of $M$ intraday bars comprising the opening session $t \in [0, T_{\text{orb}}]$ (e.g., 3 $\times$ 5-minute bars for 09:15-09:30 IST):
$$\text{OR}_{\text{high}} = \max_{t \in [0, T_{\text{orb}}]} P_{\text{high}, t}$$
$$\text{OR}_{\text{low}} = \min_{t \in [0, T_{\text{orb}}]} P_{\text{low}, t}$$
$$\text{OR}_{\text{span}} = \max\left(10^{-4}, \text{OR}_{\text{high}} - \text{OR}_{\text{low}}\right)$$

---

### 2. Toby Crabel Dynamic Stretch Factor
Following Toby Crabel (1990), market expansion potential is governed by the historical intraday directional stretch from the open:
$$\text{Stretch} = \frac{1}{N} \sum_{k=1}^N \frac{(P_{\text{high}, k} - P_{\text{open}, k}) + (P_{\text{open}, k} - P_{\text{low}, k})}{2}$$

Dynamic expansion trigger thresholds are calibrated with a fraction $k_{\text{stretch}} = 0.20$:
$$B_{\text{bull}} = \text{OR}_{\text{high}} + k_{\text{stretch}} \cdot \text{Stretch}$$
$$B_{\text{bear}} = \text{OR}_{\text{low}} - k_{\text{stretch}} \cdot \text{Stretch}$$

---

### 3. Volume Expansion Multiplier
A legitimate breakout requires aggressive institutional participation:
$$\mathcal{V}_{\text{ratio}} = \frac{V_{\text{current}}}{\max(1.0, \text{SMA}_V(20))}$$
- Confirmed Breakout: $\mathcal{V}_{\text{ratio}} \ge 1.80$.
- Unconfirmed Breakout: $\mathcal{V}_{\text{ratio}} < 1.80$.

---

### 4. Candle Wick Rejection & Trap Geometry
To detect liquidity sweeps and institutional absorption:
- **Upper Wick Rejection (Bull Trap)**:
  When $P_{\text{high}} > \text{OR}_{\text{high}}$ but $P_{\text{close}} < \text{OR}_{\text{high}}$:
  $$\text{Wick}_{\text{ratio}} = \frac{P_{\text{high}} - \max(P_{\text{open}}, P_{\text{close}})}{P_{\text{high}} - P_{\text{low}}}$$
- **Lower Wick Rejection (Bear Trap)**:
  When $P_{\text{low}} < \text{OR}_{\text{low}}$ but $P_{\text{close}} > \text{OR}_{\text{low}}$:
  $$\text{Wick}_{\text{ratio}} = \frac{\min(P_{\text{open}}, P_{\text{close}}) - P_{\text{low}}}{P_{\text{high}} - P_{\text{low}}}$$

If $\text{Wick}_{\text{ratio}} \ge 0.50$, the breakout has structurally failed, converting into a high-conviction fade.

---

### 5. Regime & Directive Matrix
| Condition | Volume Multiplier | Wick Rejection | Regime Classification | Execution Directive |
| :--- | :--- | :--- | :--- | :--- |
| $P_{\text{high}} > B_{\text{bull}}$ and $P_{\text{close}} \ge B_{\text{bull}}$ | $\ge 1.80$ | $< 0.50$ | `BULLISH_ORB_EXPANSION_CONFIRMED` | `BUY_ORB_BREAKOUT_EXPANSION` |
| $P_{\text{high}} > B_{\text{bull}}$ | Any | $\ge 0.50$ | `FALSE_BREAKOUT_BULL_TRAP` | `FADE_FALSE_BREAKOUT_SHORT` |
| $P_{\text{low}} < B_{\text{bear}}$ and $P_{\text{close}} \le B_{\text{bear}}$ | $\ge 1.80$ | $< 0.50$ | `BEARISH_ORB_BREAKDOWN_CONFIRMED` | `SELL_ORB_BREAKDOWN_EXPANSION` |
| $P_{\text{low}} < B_{\text{bear}}$ | Any | $\ge 0.50$ | `FALSE_BREAKOUT_BEAR_TRAP` | `FADE_FALSE_BREAKDOWN_LONG` |
| $P \in [\text{OR}_{\text{low}}, \text{OR}_{\text{high}}]$ | Any | Any | `IN_RANGE_CONSOLIDATION` | `STAND_ASIDE_INITIAL_BALANCE` |

---

## Production Verification & Test Suite
- **Engine Service**: `python-bridge/services/opening_range_breakout_sieve.py` (8.3 KB)
- **Unit Test Suite**: `python-bridge/tests/test_opening_range_breakout_sieve.py` (4.4 KB)
- **Validation**: 6/6 test assertions passing on Oracle Cloud VPS (`tests/test_opening_range_breakout_sieve.py ...... 100% in 0.04s`).
- **Telemetry**: Full SQLite audit trail persisted in `orb_telemetry`.
