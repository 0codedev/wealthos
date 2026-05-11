# Domain 158: Intraday Volume-Weighted MACD & Dual-Momentum Divergence Sieve (WP-BH)

## Executive Summary & Quantitative Thesis
Gerald Appel's traditional Moving Average Convergence Divergence (MACD) relies strictly on time-decay exponential moving averages of closing prices: $\text{EMA}_t = \alpha P_t + (1 - \alpha) \text{EMA}_{t-1}$. In electronic intraday trading on the National Stock Exchange of India (NSE), this formulation exhibits substantial vulnerabilities:
- Low-volume lunchtime chop (11:30 to 14:00 IST) is weighted identically to high-volume opening breakout auctions (09:15 to 09:45 IST) or closing institutional rebalancing blocks (15:00 to 15:30 IST).
- A 3-point price tick on 50 shares generates the identical indicator deflection as a 3-point breakout driven by an institutional 100,000-share iceberg order.
- This leads to severe false crossovers and "whipsaw decay" in choppy markets.

Buff Dormeier (2002, *Investing with Volume Analysis*) solved this by establishing **Volume-Weighted Moving Average Convergence Divergence (VW-MACD)**:
- Replaces standard EMAs with Volume-Weighted Exponential Moving Averages (VWEMA-12 and VWEMA-26).
- Implements an $O(1)$ recursive dual-accumulator state machine tracking cumulative volume-price flux $\sum (1 - \alpha)^k (P_{t-k} V_{t-k})$ and cumulative volume weight $\sum (1 - \alpha)^k V_{t-k}$.
- Enforces an institutional **Volume Confirmation Hurdle ($\mathcal{V}_{\text{conf}} \ge 1.50$)** on crossover triggers, rejecting false low-volume crossovers as non-actionable noise.

Domain 158 establishes the **Intraday Volume-Weighted MACD & Dual-Momentum Divergence Sieve**, providing pure volume-confirmed momentum alpha extraction.

---

## Mathematical Formulations

### 1. Recursive Volume-Weighted Exponential Moving Average (VWEMA)
For any smoothing period $N$, the smoothing constant is $\alpha = \frac{2}{N + 1}$.
Let $P_t$ be the bar close and $V_t$ be the bar volume. The VWEMA maintains two streaming accumulators:
$$\text{Num}_N(t) = \alpha \cdot (P_t \cdot V_t) + (1 - \alpha) \cdot \text{Num}_N(t-1)$$
$$\text{Den}_N(t) = \alpha \cdot V_t + (1 - \alpha) \cdot \text{Den}_N(t-1)$$
$$\text{VWEMA}_N(t) = \frac{\text{Num}_N(t)}{\text{Den}_N(t)}$$

---

### 2. VW-MACD Line, Signal Line, & Histogram
Using institutional standard fast ($N_f = 12$) and slow ($N_s = 26$) periods:
$$\text{VW-MACD}(t) = \text{VWEMA}_{12}(t) - \text{VWEMA}_{26}(t)$$

The Signal line is the 9-period exponential moving average of the VW-MACD line:
$$\alpha_{\text{sig}} = \frac{2}{9 + 1} = 0.20$$
$$\text{Signal}(t) = \alpha_{\text{sig}} \cdot \text{VW-MACD}(t) + (1 - \alpha_{\text{sig}}) \cdot \text{Signal}(t-1)$$

The volume-weighted MACD histogram:
$$\text{Hist}(t) = \text{VW-MACD}(t) - \text{Signal}(t)$$

---

### 3. Volume Confirmation Multiplier ($\mathcal{V}_{\text{conf}}$)
A crossover signal is only valid if validated by institutional liquidity expansion:
$$\mathcal{V}_{\text{conf}} = \frac{V_t}{\frac{1}{20} \sum_{k=1}^{20} V_{t-k}}$$
- Validated Crossover: $\mathcal{V}_{\text{conf}} \ge 1.50$ (volume is at least $50\%$ higher than recent 20-bar baseline).
- False Crossover: $\mathcal{V}_{\text{conf}} < 1.00$ (low volume; high probability of mean-reverting trap).

---

### 4. Regime & Execution Directive Matrix
| Indicator Event | Volume Confirmation ($\mathcal{V}_{\text{conf}}$) | Regime Classification | Execution Directive |
| :--- | :--- | :--- | :--- |
| $\text{VW-MACD}$ crosses above $\text{Signal}$ | $\ge 1.50$ | `BULLISH_VW_MACD_CROSSOVER_CONFIRMED` | `BUY_MOMENTUM_EXPANSION` |
| $\text{VW-MACD}$ crosses above $\text{Signal}$ | $< 1.00$ | `LOW_VOLUME_FALSE_CROSSOVER_REJECTED` | `STAND_ASIDE_FILTER_NOISE` |
| $\text{VW-MACD}$ crosses below $\text{Signal}$ | $\ge 1.50$ | `BEARISH_VW_MACD_CROSSDOWN_CONFIRMED` | `SELL_MOMENTUM_BREAKDOWN` |
| $\text{VW-MACD}$ crosses below $\text{Signal}$ | $< 1.00$ | `LOW_VOLUME_FALSE_CROSSDOWN_REJECTED` | `STAND_ASIDE_FILTER_NOISE` |
| $\text{Hist} > 0$ and $\text{Hist}_t > \text{Hist}_{t-1}$ | Any | `BULLISH_HISTOGRAM_ACCELERATING` | `RIDE_LONG_MOMENTUM` |
| $\text{Hist} > 0$ and $\text{Hist}_t \le \text{Hist}_{t-1}$ | Any | `BULLISH_HISTOGRAM_DECELERATING` | `TRAIL_PROFIT_STOP` |
| $\text{Hist} < 0$ and $\text{Hist}_t < \text{Hist}_{t-1}$ | Any | `BEARISH_HISTOGRAM_ACCELERATING` | `RIDE_SHORT_MOMENTUM` |
| $\text{Hist} < 0$ and $\text{Hist}_t \ge \text{Hist}_{t-1}$ | Any | `BEARISH_HISTOGRAM_DECELERATING` | `COVER_SHORT_EXHAUSTION` |

---

## Production Verification & Test Suite
- **Engine Service**: `python-bridge/services/volume_weighted_macd_sieve.py` (6.2 KB)
- **Unit Test Suite**: `python-bridge/tests/test_volume_weighted_macd_sieve.py` (3.6 KB)
- **Validation**: 6/6 test assertions passing on Oracle Cloud VPS (`tests/test_volume_weighted_macd_sieve.py ...... 100% in 0.04s`).
- **Telemetry**: Full SQLite audit trail persisted in `vw_macd_telemetry`.
