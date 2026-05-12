# DOMAIN 184: OPTIONS IMPLIED VOLATILITY SURFACE SKEW ARBITRAGE & RISK REVERSAL SIEVE (WP-CH)

**Executive Swarm Intelligence Technical Report**  
**Autonomous Agent:** `Space-Bunny / OpenCode Sovereign Swarm (Variant Max, Mega-Context 1M)`  
**Domain Vertical:** WP-CH / Domain 184: Options Implied Volatility Surface Skew Arbitrage & Risk Reversal Sieve  
**Timestamp:** 2026-10-18T06:45:00+05:30  
**Status:** 🟢 **PRODUCTION READY / FULLY TESTED**  

---

## 1. Executive Summary & Quantitative Mandate

The Black-Scholes-Merton model assumes constant volatility across all option strikes. In actual equity, index, and currency markets, options display pronounced **volatility smiles and skews**. In index derivatives (e.g., NIFTY 50 options), downside puts trade at a structural volatility premium over upside calls due to institutional demand for crash insurance, downside leverage aversion, and jump risk.

However, during market extremes, this skew becomes severely distorted:
1. **Panic Put Overpricing**: Heavy retail hedging causes OTM put implied volatility to trade at extreme anomalies ($Z_{RR} \le -2.5\sigma$), rendering downside puts vastly overpriced relative to delta-equivalent calls.
2. **Retail Call Euphoria**: Speculative call buying during rallies flattens or inverts the skew ($Z_{RR} \ge +2.5\sigma$).
3. **Smile Convexity Violations**: In illiquid strikes, option smiles occasionally invert into "frowns" ($BF_{25} \le 0$), directly violating the **Breeden-Litzenberger non-negativity constraint** for risk-neutral probability density functions and creating risk-free static butterfly arbitrage.

Domain 184 delivers an institutional-grade **Options Implied Volatility Surface Skew Arbitrage & Risk Reversal Sieve**:
- Deconstructs options surfaces into 3 standard pillars: ATM, 25-Delta Put ($K_{25P}$), and 25-Delta Call ($K_{25C}$).
- Quantifies skew and curvature via **25-Delta Risk Reversal** ($RR_{25}$) and **25-Delta Butterfly** ($BF_{25}$).
- Tracks statistical Z-scores of skew steepness relative to calibrated historical distributions.
- Emits delta-neutral structural directives: exploiting relative mispricing (`LONG_RISK_REVERSAL_CHEAP_CALLS` / `SHORT_RISK_REVERSAL_CHEAP_PUTS`) or capturing pure static smile arbitrage (`BUTTERFLY_CONVEXITY_ARBITRAGE`).

---

## 2. Mathematical Specifications & Surface Smile Mechanics

### 2.1 3-Pillar Volatility Smile Decomposition
For a given expiry horizon $T$, we monitor three benchmark market pillars:
- $\sigma_{\text{ATM}}$: At-the-money implied volatility ($K = S$).
- $\sigma_{25P}$: Implied volatility of the 25-delta OTM put option ($\Delta = -0.25$).
- $\sigma_{25C}$: Implied volatility of the 25-delta OTM call option ($\Delta = +0.25$).

### 2.2 25-Delta Risk Reversal (RR)
Risk reversal measures skew asymmetry (tilt) across the smile:
$$RR_{25} = \sigma_{25C} - \sigma_{25P}$$

In equity index markets, $RR_{25}$ is structurally negative (typically $-3.0\%$ to $-6.0\%$), reflecting downside put premium. A shift towards more negative values indicates steepening put skew.

### 2.3 25-Delta Butterfly (BF) & Smile Convexity
The butterfly spread measures smile curvature and tail kurtosis:
$$BF_{25} = \frac{\sigma_{25C} + \sigma_{25P}}{2} - \sigma_{\text{ATM}}$$

By the **Breeden-Litzenberger (1978)** theorem, the risk-neutral probability density function $q(K)$ is proportional to the second derivative of call prices:
$$q(K) = e^{rT} \frac{\partial^2 C(K, T)}{\partial K^2} \ge 0$$

A non-negative probability density requires strict convexity in call prices, which guarantees that $BF_{25} > 0$. If $BF_{25} \le 0$, a pure static butterfly arbitrage exists (buy wings, sell ATM).

### 2.4 Statistical Skew Z-Score & Sieve Directives
Using rolling historical mean $\mu_{RR}$ and standard deviation $\sigma_{RR}$:
$$Z_{RR} = \frac{RR_{25} - \mu_{RR}}{\sigma_{RR}}$$

- **`LONG_RISK_REVERSAL_CHEAP_CALLS`** ($Z_{RR} \le -2.0\sigma$):
  - Downside puts are excessively rich while calls are cheap. Sell 25d Put, buy 25d Call with delta-hedged underlying futures.
- **`SHORT_RISK_REVERSAL_CHEAP_PUTS`** ($Z_{RR} \ge +2.0\sigma$):
  - Skew has flattened or inverted abnormally. Sell 25d Call, buy cheap 25d Put.
- **`BUTTERFLY_CONVEXITY_ARBITRAGE`** ($BF_{25} \le 0.001$):
  - Smile curvature is broken. Execute long butterfly (Long 25P + Long 25C, Short 2x ATM).
- **`NORMAL_EQUILIBRIUM_SKEW`**:
  - Volatility smile is orderly within historical boundaries.

---

## 3. Production Architecture & Verification

Implemented in `python-bridge/services/iv_skew_risk_reversal_sieve.py` and validated by 5/5 unit tests in `python-bridge/tests/test_iv_skew_risk_reversal_sieve.py`:
1. `test_normal_equilibrium_skew`: Validates standard NIFTY baseline ($RR = -4.5\%, BF = +1.75\%, Z = 0.0$) resulting in `NORMAL_EQUILIBRIUM_SKEW`.
2. `test_extreme_downside_put_skew`: Validates crash panic detection ($RR = -11.0\%, Z \le -2.0$) triggering `LONG_RISK_REVERSAL_CHEAP_CALLS`.
3. `test_flat_inverted_skew`: Validates speculative call frenzy ($RR = +5.0\%, Z \ge +2.0$) triggering `SHORT_RISK_REVERSAL_CHEAP_PUTS`.
4. `test_negative_butterfly_curvature_arbitrage`: Confirms detection of negative smile curvature ($BF = -3.5\%$) and `BUTTERFLY_CONVEXITY_ARBITRAGE`.
5. `test_sqlite_persistence`: Validates automated logging to `iv_skew_telemetry`.

---

## 4. Telemetry Schema & Persistence

All evaluated options surfaces are logged to SQLite table `iv_skew_telemetry`:
```sql
CREATE TABLE IF NOT EXISTS iv_skew_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    symbol TEXT NOT NULL,
    dte REAL NOT NULL,
    atm_vol REAL NOT NULL,
    rr_25d REAL NOT NULL,
    bf_25d REAL NOT NULL,
    skew_slope REAL NOT NULL,
    z_score REAL NOT NULL,
    directive TEXT NOT NULL,
    rationale TEXT NOT NULL
);
```

---

## 5. Quantitative Invariants & Execution Directives

1. **Breeden-Litzenberger Convexity Invariant**: $BF_{25} > 0$ is a strict mathematical boundary condition. Any print with $BF_{25} \le 0$ represents an immediate execution priority for risk-free box/butterfly convergence.
2. **Delta-Neutrality Maintenance**: All skew arbitrage trades must be accompanied by underlying delta rebalancing ($\Delta_{\text{net}} = 0$) to isolate pure surface mispricing from market direction.
3. **Sovereign Swarm Ready**: Verified and synchronized across local repositories and Oracle Cloud VPS.
