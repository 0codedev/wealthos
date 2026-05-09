# Domain 131: Institutional FII/DII Net Flow & Derivative Squeeze Predictor (WP-AG)

**Executive Status**: 🟢 PRODUCTION DELIVERED & MATHEMATICALLY VERIFIED  
**Engine Service**: `python-bridge/services/fii_dii_flow_predictor.py`  
**Unit Tests**: `python-bridge/tests/test_fii_dii_flow_predictor.py` (5/5 Tests Passing in 0.04s)  
**Target Architecture**: WealthOS v2 Institutional Participant Flow & Derivative Squeeze Predictor  
**Benchmark Model**: `opencode/space-bunny-free` / `nemotron-3.5-lightning-free` (`--variant max --thinking --auto`)

---

## 1. Executive Summary & Market Positioning Dynamics

In the Indian financial ecosystem, Foreign Institutional Investors (FIIs) and Domestic Institutional Investors (DIIs) represent the dominant liquidity providers and price-setters across both the cash equity segment and index derivatives (NIFTY 50 and BANKNIFTY). Due to mandatory daily participant-wise open interest reporting mandated by SEBI, systematic trading desks possess a unique structural transparency into institutional inventory.

However, retail and naive algorithmic participants frequently misinterpret these disclosures:
1. They treat extreme FII short positioning as an unconditional sell signal, entering late short positions directly into severe liquidity vacuums.
2. When FII net index futures exposure reaches historical oversold extremes (e.g. FII Long-Short Ratio $\text{LSR} \le 0.20$ or Percent Long $\le 20\%$), the market transforms into a **coiled spring**. Any minor positive catalyst or morning VWAP breakout forces institutional short covering, triggering explosive 200–500 point intraday rallies.
3. Conversely, when FII positioning becomes excessively crowded long ($\text{LSR} \ge 3.5$, Percent Long $\ge 80\%$), marginal buying power is exhausted, leaving the market highly vulnerable to **long liquidation waterfalls**.

The **Institutional FII/DII Net Flow & Derivative Squeeze Predictor Engine** ingests daily participant open interest and cash turnover telemetry, calculates rolling positioning crowding $Z$-scores, and synthesizes macro inventory asymmetry with intraday microstructure (VWAP displacement and Cumulative Volume Delta) to predict afternoon (14:00–15:00 IST) short squeeze probabilities and issue dynamic risk governors.

---

## 2. Mathematical Formulations & The Microstructure Squeeze Sieve

### 2.1 Participant Cash Flow Decomposition

Let $\text{FII}_{\text{buy}}, \text{FII}_{\text{sell}}, \text{DII}_{\text{buy}}, \text{DII}_{\text{sell}}$ represent cash segment gross turnover in ₹ Crores:
$$\text{FII}_{\text{net}} = \text{FII}_{\text{buy}} - \text{FII}_{\text{sell}}$$
$$\text{DII}_{\text{net}} = \text{DII}_{\text{buy}} - \text{DII}_{\text{sell}}$$
$$\text{TotalInst}_{\text{net}} = \text{FII}_{\text{net}} + \text{DII}_{\text{net}}$$

- When $\text{FII}_{\text{net}} < 0$ and $\text{DII}_{\text{net}} > 0$ with $\text{TotalInst}_{\text{net}} \approx 0$, domestic mutual funds absorb foreign selling, creating strong base support.
- When $\text{TotalInst}_{\text{net}} \ll 0$, systemic institutional liquidity drainage is underway.

### 2.2 FII Derivative Ratios & Net Open Interest

Participant-wise open interest in index futures is partitioned across Long and Short contracts:
$$\text{LSR}_{\text{FII}} = \frac{\text{Long Contracts}_{\text{FII}}}{\max(\text{Short Contracts}_{\text{FII}}, 1)}$$
$$\% \text{Long}_{\text{FII}} = \frac{\text{Long Contracts}_{\text{FII}}}{\text{Long Contracts}_{\text{FII}} + \text{Short Contracts}_{\text{FII}}} \times 100\%$$
$$\text{NetOI}_{\text{FII}} = \text{Long Contracts}_{\text{FII}} - \text{Short Contracts}_{\text{FII}}$$

### 2.3 Rolling Crowding Z-Score

To normalize raw contract counts across changing market open interest cycles, the engine computes a rolling $N$-day ($N=20$) Gaussian baseline:
$$\mu_N(\text{NetOI}) = \frac{1}{N} \sum_{i=1}^N \text{NetOI}_{\text{FII}, t-i}$$
$$\sigma_N(\text{NetOI}) = \sqrt{\frac{1}{N} \sum_{i=1}^N \left(\text{NetOI}_{\text{FII}, t-i} - \mu_N\right)^2}$$
$$Z_{\text{crowd}} = \frac{\text{NetOI}_{\text{FII}, t} - \mu_N(\text{NetOI})}{\sigma_N(\text{NetOI})}$$

### 2.4 Intraday Afternoon Squeeze Probability Estimator

The transition from a potential squeeze setup to an actual violent short-covering unwind occurs when intraday price action challenges short sellers' profit cushions. The conditional probability $P(\text{Squeeze})$ is estimated as:
$$P(\text{Squeeze}) = \text{clip}\left(P_{\text{base}} + \Delta_{\text{VWAP}} + \Delta_{\text{CVD}}, 0.0, 0.98\right)$$
where:
$$P_{\text{base}} = 0.55 + 0.15 \cdot \frac{\min(|Z_{\text{crowd}}|, 3.0)}{3.0} \quad \text{for } Z_{\text{crowd}} \le -1.8$$
$$\Delta_{\text{VWAP}} = 0.18 \cdot \mathbf{1}_{\{S_t > \text{VWAP}_t\}}$$
$$\Delta_{\text{CVD}} = 0.12 \cdot \mathbf{1}_{\{\text{CVD}_t > 0\}}$$

When both intraday filters trigger ($S_t > \text{VWAP}$ and $\text{CVD} > 0$), $P(\text{Squeeze})$ surges above $85\%$, signaling a high-conviction institutional short squeeze into the 14:00–15:15 IST window.

---

## 3. Positioning Regimes & Quantitative Directives

| Regime | Condition | Microstructure Interpretation | WealthOS Execution Action | Stop Adjustment |
|---|---|---|---|---|
| **COILED_SHORT_SQUEEZE_SETUP** | $Z_{\text{crowd}} \le -1.8\sigma$ OR $\% \text{Long} \le 22\%$ | Extreme one-sided short concentration. Shorts vulnerable to stop runs. | `CALL_SQUEEZE_UPSIDE_ASYMMETRY` (Deploy OTM call ratio spreads; halt short trend-following) | $0.50\times$ (Compress short stops by 50%) |
| **BALANCED_POSITIONING** | $-1.8\sigma < Z_{\text{crowd}} < +1.8\sigma$ | Two-way liquidity; FIIs and DIIs operating within historical equilibrium. | `NEUTRAL` (Standard execution parameters active) | $1.00\times$ (Unmodified stops) |
| **LONG_LIQUIDATION_VULNERABILITY** | $Z_{\text{crowd}} \ge +1.8\sigma$ OR $\% \text{Long} \ge 78\%$ | Marginal buyers saturated. High risk of waterfall liquidation on negative shocks. | `PUT_HEDGE_RECOMMENDED` (Initiate index downside put spreads; tighten long stops) | $0.70\times$ (Compress long stops by 30%) |

---

## 4. Production Service Architecture & Code Integration

The complete production implementation is delivered in `python-bridge/services/fii_dii_flow_predictor.py`:
- Ingests daily `DailyParticipantPositioning` data structures (Cash FII/DII buy/sell, Index Futures Long/Short across FII, Pro, and Client segments).
- Evaluates rolling Gaussian statistics with zero-division guards.
- Computes real-time afternoon squeeze probabilities combining positioning asymmetry with intraday microstructure variables.
- Persists all observations to SQLite table `fii_dii_positioning_telemetry` for auditability and automated backtesting.

---

## 5. Verification & Test Suite

The engine was fully validated against unit tests in `python-bridge/tests/test_fii_dii_flow_predictor.py`:
1. `test_calculate_cash_flows`: Validates net arithmetic across FII (-₹2,500 Cr), DII (+₹2,800 Cr), and combined (+₹300 Cr).
2. `test_calculate_fii_derivative_ratios`: Validates LSR ($0.25$), Percent Long ($20.0\%$), and Net OI ($-75,000$ contracts).
3. `test_coiled_short_squeeze_regime`: Confirms transition to `COILED_SHORT_SQUEEZE_SETUP`, `CALL_SQUEEZE_UPSIDE_ASYMMETRY` recommendation, $0.50\times$ stop adjustment, and squeeze probability scaling from $0.65$ baseline to $\ge 0.85$ upon VWAP/CVD confirmation.
4. `test_long_liquidation_vulnerability_regime`: Validates transition to `LONG_LIQUIDATION_VULNERABILITY`, $Z_{\text{crowd}} \ge 1.8$, and `PUT_HEDGE_RECOMMENDED`.
5. `test_sqlite_persistence`: Validates relational persistence and data extraction.

**Execution Result**:
```
tests/test_fii_dii_flow_predictor.py::test_calculate_cash_flows PASSED   [ 20%]
tests/test_fii_dii_flow_predictor.py::test_calculate_fii_derivative_ratios PASSED [ 40%]
tests/test_fii_dii_flow_predictor.py::test_coiled_short_squeeze_regime PASSED [ 60%]
tests/test_fii_dii_flow_predictor.py::test_long_liquidation_vulnerability_regime PASSED [ 80%]
tests/test_fii_dii_flow_predictor.py::test_sqlite_persistence PASSED     [100%]
5 passed in 0.04s
```
