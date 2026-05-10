# Domain 153: Multi-Timeframe Volume Accumulation-Distribution (A/D) Chaikin Money Flow Sieve (WP-BC)

## Executive Summary & Quantitative Thesis
Price action alone is an incomplete descriptor of supply and demand dynamics. Institutional participants (Domestic Institutional Investors, Mutual Funds, and Foreign Portfolio Investors) regularly execute large block orders via iceberg slicing, TWAP/VWAP execution algorithms, and passive bid resting. In doing so, they absorb significant supply without allowing spot prices to run away prematurely:
- **Price is Flat/Suppressed**, but the close of nearly every intraday candle prints near the candle high due to sustained institutional bid absorption.
- Conversely, in **Stealth Distribution**, institutional smart money unloads substantial inventory into retail breakout buying, causing candles to close persistently near the lower extreme of their ranges.

Domain 153 establishes the **Multi-Timeframe Volume Accumulation-Distribution (A/D) Chaikin Money Flow Sieve**:
- Implements Marc Chaikin's foundational **Money Flow Multiplier ($\text{MFM} \in [-1.0, 1.0]$)** to pinpoint where intraday closes settle relative to the bar range.
- Tracks the continuous cumulative **Accumulation/Distribution Line (ADL)** and its directional slope.
- Computes the rolling **20-Period Chaikin Money Flow ($\text{CMF}_{20}$)** volume-weighted pressure oscillator.
- Detects high-alpha **Institutional Stealth Accumulation Divergences** ($\text{CMF} \ge +0.12$ while price change $\le +0.50\%$) and **Stealth Distribution Divergences** ($\text{CMF} \le -0.12$ while price change $\ge -0.50\%$).
- Directly synthesizes trade directives with calibrated confidence scores.

---

## Mathematical Formulations

### 1. Money Flow Multiplier ($\text{MFM}$)
For each candlestick or bar $i \in [1, T]$:
$$\text{MFM}_i = \frac{(P_{\text{close}, i} - P_{\text{low}, i}) - (P_{\text{high}, i} - P_{\text{close}, i})}{P_{\text{high}, i} - P_{\text{low}, i}} = \frac{2 P_{\text{close}, i} - P_{\text{high}, i} - P_{\text{low}, i}}{P_{\text{high}, i} - P_{\text{low}, i}}$$
- If $P_{\text{close}} = P_{\text{high}}$, $\text{MFM} = +1.0$ (Maximum buying accumulation).
- If $P_{\text{close}} = P_{\text{low}}$, $\text{MFM} = -1.0$ (Maximum selling distribution).
- If $P_{\text{close}} = \frac{P_{\text{high}} + P_{\text{low}}}{2}$, $\text{MFM} = 0.0$ (Neutral equilibrium).
- When $P_{\text{high}} = P_{\text{low}}$ (zero range bar), $\text{MFM}_i = 0.0$.

---

### 2. Money Flow Volume ($\text{MFV}$) & Cumulative ADL
$$\text{MFV}_i = \text{MFM}_i \times V_i$$
$$\text{ADL}_t = \text{ADL}_{t-1} + \text{MFV}_t$$
The cumulative slope of the ADL across the lookback horizon $N$ is:
$$\Delta \text{ADL}_N = \text{ADL}_t - \text{ADL}_{t-N}$$

---

### 3. Chaikin Money Flow ($\text{CMF}$)
Normalized over rolling lookback window of length $N = 20$:
$$\text{CMF}_{N, t} = \frac{\sum_{i=t-N+1}^t \text{MFV}_i}{\sum_{i=t-N+1}^t V_i} = \frac{\sum_{i=t-N+1}^t \left( \frac{2 P_{\text{close}, i} - P_{\text{high}, i} - P_{\text{low}, i}}{P_{\text{high}, i} - P_{\text{low}, i}} \right) \cdot V_i}{\sum_{i=t-N+1}^t V_i}$$
Constrained strictly to the domain $\text{CMF}_{N, t} \in [-1.0, 1.0]$.

---

### 4. Stealth Divergence & Regime Classification Matrix
Let $\Delta P_{\%} = \frac{P_t - P_{t-N}}{P_{t-N}} \times 100\%$ be the percent price change across the lookback period.

| CMF Value | 20-Bar Price Drift ($\Delta P_{\%}$) | ADL Slope | Regime Classification | Execution Directive | Target Confidence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| $\text{CMF} \ge +0.12$ | $\le +0.50\%$ (Flat / Down) | $> 0$ | `BULLISH_STEALTH_ACCUMULATION` | `ACCUMULATE_LONG_STEALTH_FLOW` | $\ge 0.85$ |
| $\text{CMF} \ge +0.12$ | $> +0.50\%$ (Rallying) | $> 0$ | `BULLISH_EXPANSION_CONFIRMED` | `FOLLOW_MOMENTUM_LONG` | Normalized |
| $\text{CMF} \le -0.12$ | $\ge -0.50\%$ (Flat / Up) | $< 0$ | `BEARISH_STEALTH_DISTRIBUTION` | `DISTRIBUTE_OR_SHORT_FLOW` | $\ge 0.85$ |
| $\text{CMF} \le -0.12$ | $< -0.50\%$ (Falling) | $< 0$ | `BEARISH_BREAKDOWN_CONFIRMED` | `FOLLOW_MOMENTUM_SHORT` | Normalized |
| $|\text{CMF}| < 0.12$ | Any | Neutral | `NEUTRAL_VOLUME_EQUILIBRIUM` | `MAINTAIN_NEUTRAL_POSITION` | 0.30 |

---

## Production Verification & Test Suite
- **Engine Service**: `python-bridge/services/chaikin_money_flow_sieve.py` (6.2 KB)
- **Unit Test Suite**: `python-bridge/tests/test_chaikin_money_flow_sieve.py` (3.9 KB)
- **Validation**: 6/6 test assertions passing on Oracle Cloud VPS (`tests/test_chaikin_money_flow_sieve.py ...... 100% in 0.04s`).
- **Telemetry**: Full SQLite audit trail persisted in `chaikin_cmf_telemetry`.
