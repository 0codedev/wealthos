# Domain 160: Intraday Anchored VWAP (AVWAP) & Institutional Liquidity Sweep Sieve (WP-BJ)

## Executive Summary & Quantitative Thesis
Standard intraday Volume-Weighted Average Price (VWAP) resets arbitrarily at the market open (09:15 IST) each morning. However, institutional order flow does not respect arbitrary calendar day boundaries; institutional investment committees, sovereign wealth funds, and high-frequency algorithms benchmark execution against **exogenous event shocks**:
- The precise minute an earnings release crosses the exchange wire.
- The 10:00 AM IST Reserve Bank of India (RBI) Monetary Policy Decision statement.
- Significant pre-market structural gap opens and swing highs/lows.

Brian Shannon (2019, *Technical Analysis Using Multiple Timeframes*) established the power of **Anchored VWAP (AVWAP)**. By anchoring the volume-weighted price accumulation to the exact bar of the event shock, AVWAP reveals the true collective break-even price of market participants who entered since that event.

Furthermore, retail stop orders cluster predictably just outside volatility bands:
- Retail stop-losses rest just below recent swing lows or the $-2.0\sigma$ AVWAP band.
- Institutional desks intentionally drive liquidity sweeps ("Wyckoff Springs") through these levels to harvest resting liquidity blocks before reversing prices violently back inside the fair value envelope.

Domain 160 establishes the **Intraday Anchored VWAP (AVWAP) & Institutional Liquidity Sweep Sieve**, delivering:
- Event-anchored VWAP and volume-weighted standard deviation dispersion bands ($\pm 1.0\sigma, \pm 2.0\sigma$).
- Real-time detection of institutional stop-hunting liquidity sweeps (Spring / Upthrust).
- Verification via candle wick absorption geometry ($\ge 50\%$ wick ratio) and institutional volume surge ($V \ge 1.75\bar{V}$).
- Automated liquidity absorption reversal execution directives.

---

## Mathematical Formulations

### 1. Anchored VWAP (AVWAP) Formulation
Let $t_0$ denote the integer bar index of the anchoring event (e.g. RBI rate decision or earnings release). For all bars $t \ge t_0$, the typical price is $\bar{P}_\tau = \frac{P_{\text{high}, \tau} + P_{\text{low}, \tau} + P_{\text{close}, \tau}}{3}$.
The Anchored VWAP is:
$$\text{AVWAP}(t) = \frac{\sum_{\tau=t_0}^t \bar{P}_\tau \cdot V_\tau}{\sum_{\tau=t_0}^t V_\tau}$$

---

### 2. Volume-Weighted Dispersion Bands
The second central moment of price distribution weighted by traded volume:
$$\sigma_{\text{AVWAP}}^2(t) = \frac{\sum_{\tau=t_0}^t \bar{P}_\tau^2 \cdot V_\tau}{\sum_{\tau=t_0}^t V_\tau} - (\text{AVWAP}(t))^2$$
$$\sigma_{\text{AVWAP}}(t) = \sqrt{\max\left(10^{-6}, \sigma_{\text{AVWAP}}^2(t)\right)}$$

Multi-sigma dynamic volatility bands:
$$\text{Upper Band}_k(t) = \text{AVWAP}(t) + k \cdot \sigma_{\text{AVWAP}}(t), \quad k \in \{1.0, 2.0\}$$
$$\text{Lower Band}_k(t) = \text{AVWAP}(t) - k \cdot \sigma_{\text{AVWAP}}(t), \quad k \in \{1.0, 2.0\}$$

Standardized deviation score:
$$Z(t) = \frac{P_{\text{close}}(t) - \text{AVWAP}(t)}{\sigma_{\text{AVWAP}}(t)}$$

---

### 3. Institutional Liquidity Sweep (Wyckoff Spring & Upthrust)
A liquidity sweep occurs when price breaches extreme statistical bands but fails to sustain acceptance, printing an aggressive wick rejection on heavy institutional volume:
- **Bullish Sweep (Wyckoff Spring)**:
  $$P_{\text{low}} < \text{Lower Band}_2(t)$$
  $$\text{Wick}_{\text{lower}} = \frac{\min(P_{\text{open}}, P_{\text{close}}) - P_{\text{low}}}{P_{\text{high}} - P_{\text{low}}} \ge 0.50$$
  $$\mathcal{V}_{\text{surge}} = \frac{V_t}{\text{SMA}_V(20)} \ge 1.75$$
  *Significance*: Retail sell stops under the $-2\sigma$ band were hunted and absorbed by institutional limit buy orders; price immediately snaps back upward.

- **Bearish Sweep (Wyckoff Upthrust)**:
  $$P_{\text{high}} > \text{Upper Band}_2(t)$$
  $$\text{Wick}_{\text{upper}} = \frac{P_{\text{high}} - \max(P_{\text{open}}, P_{\text{close}})}{P_{\text{high}} - P_{\text{low}}} \ge 0.50$$
  $$\mathcal{V}_{\text{surge}} \ge 1.75$$
  *Significance*: Retail breakout buy stops above the $+2\sigma$ band were harvested into institutional distribution; price immediately snaps downward.

---

### 4. Regime & Execution Directive Matrix
| Condition | Wick Ratio | Volume Surge | Regime Classification | Execution Directive |
| :--- | :--- | :--- | :--- | :--- |
| $P_{\text{low}} < \text{Lower}_2$ | $\ge 0.50$ | $\ge 1.75$ | `BULLISH_LIQUIDITY_SWEEP_SPRING` | `BUY_LIQUIDITY_ABSORPTION_REVERSAL` |
| $P_{\text{high}} > \text{Upper}_2$ | $\ge 0.50$ | $\ge 1.75$ | `BEARISH_LIQUIDITY_SWEEP_UPTHRUST` | `SELL_LIQUIDITY_ABSORPTION_REVERSAL` |
| $P_{\text{close}} > \text{Upper}_2$ | $< 0.50$ | Any | `OVEREXTENDED_BULLISH_EXPANSION` | `AVOID_LONG_CHASING_WAIT_PULLBACK` |
| $P_{\text{close}} < \text{Lower}_2$ | $< 0.50$ | Any | `OVEREXTENDED_BEARISH_CAPITULATION` | `AVOID_SHORT_CHASING_WAIT_BOUNCE` |
| $P_{\text{close}} \ge \text{AVWAP}$ | Any | Any | `BULLISH_ANCHOR_TREND_HOLD` | `HOLD_LONG_ABOVE_AVWAP` |
| $P_{\text{close}} < \text{AVWAP}$ | Any | Any | `BEARISH_ANCHOR_TREND_HOLD` | `HOLD_SHORT_BELOW_AVWAP` |

---

## Production Verification & Test Suite
- **Engine Service**: `python-bridge/services/anchored_vwap_sweep_sieve.py` (7.6 KB)
- **Unit Test Suite**: `python-bridge/tests/test_anchored_vwap_sweep_sieve.py` (3.8 KB)
- **Validation**: 5/5 test assertions passing on Oracle Cloud VPS (`tests/test_anchored_vwap_sweep_sieve.py ..... 100% in 0.03s`).
- **Telemetry**: Full SQLite audit trail persisted in `anchored_vwap_telemetry`.
