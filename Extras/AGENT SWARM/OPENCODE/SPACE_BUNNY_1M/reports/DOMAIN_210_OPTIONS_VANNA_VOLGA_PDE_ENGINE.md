# Sovereign Swarm Architecture Blueprint: Domain 210 (WP-DH)
# Real-Time Options Surface Smile Asymmetry & Vanna-Volga PDE Engine

**Fabric Layer**: `python-bridge/services/options_vanna_volga_pde_engine.py`  
**Test Suite**: `python-bridge/tests/test_options_vanna_volga_pde_engine.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: Castagna-Mercurio (2007) Vanna-Volga Calibrated Pricing, Exact 3-Pillar Hedging Portfolio, Second-Order Cross-Greeks ($\text{Vanna}, \text{Volga}$), Smile Asymmetry & Convexity Arbitrage Sentry.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

In FX and liquid equity index options markets (Nifty 50, Bank Nifty, SPX), vanilla options are quoted via three liquid benchmark pillars:
1. **At-The-Money (ATM)** volatility $\sigma_{\text{atm}}$ ($50$-delta $\Delta_{50}$).
2. **25-Delta Risk Reversal ($RR_{25}$)**: $\sigma_{25\text{C}} - \sigma_{25\text{P}}$, capturing skew asymmetry.
3. **25-Delta Butterfly ($BF_{25}$)**: $\frac{1}{2}(\sigma_{25\text{C}} + \sigma_{25\text{P}}) - \sigma_{\text{atm}}$, capturing smile curvature/convexity.

Black-Scholes assumes constant volatility $\sigma$, entirely failing to capture the cross-exposure to spot moves ($\text{Vanna} = \frac{\partial^2 C}{\partial S \partial \sigma}$) and volatility moves ($\text{Volga} = \frac{\partial^2 C}{\partial \sigma^2}$). The Castagna-Mercurio (2007) Vanna-Volga method creates an over-hedging portfolio using three liquid benchmark options ($K_{\text{atm}}, K_{25\text{C}}, K_{25\text{P}}$) that precisely neutralizes Vega, Vanna, and Volga risk, yielding closed-form, arbitrage-free smiles.

### 1.1 Analytical Greeks & Linear Neutralization System

Given Black-Scholes Greeks:
$$d_1 = \frac{\ln(S/K) + (r + \frac{1}{2}\sigma^2)\tau}{\sigma \sqrt{\tau}}, \quad d_2 = d_1 - \sigma \sqrt{\tau}$$
$$\text{Vega} = \nu = S \sqrt{\tau} \phi(d_1)$$
$$\text{Vanna} = \frac{\partial \nu}{\partial S} = \frac{\nu}{S}\left(1 - \frac{d_1}{\sigma \sqrt{\tau}}\right)$$
$$\text{Volga} = \frac{\partial \nu}{\partial \sigma} = \nu \frac{d_1 d_2}{\sigma}$$

We form a hedging portfolio of weights $(w_1, w_2, w_3)$ on options $C_1(K_{\text{atm}}), C_2(K_{25\text{C}}), C_3(K_{25\text{P}})$ satisfying:
$$\begin{pmatrix} \nu_1 & \nu_2 & \nu_3 \\ \text{Vanna}_1 & \text{Vanna}_2 & \text{Vanna}_3 \\ \text{Volga}_1 & \text{Volga}_2 & \text{Volga}_3 \end{pmatrix} \begin{pmatrix} w_1 \\ w_2 \\ w_3 \end{pmatrix} = \begin{pmatrix} \nu(K) \\ \text{Vanna}(K) \\ \text{Volga}(K) \end{pmatrix}$$

### 1.2 Castagna-Mercurio Closed-Form Weights

$$w_2(K) = \frac{\ln(K / K_1) \ln(K / K_3)}{\ln(K_2 / K_1) \ln(K_2 / K_3)} \cdot \frac{\nu(K)}{\nu(K_2)}$$
$$w_3(K) = \frac{\ln(K / K_1) \ln(K / K_2)}{\ln(K_3 / K_1) \ln(K_3 / K_2)} \cdot \frac{\nu(K)}{\nu(K_3)}$$
$$w_1(K) = \frac{\nu(K) - w_2 \nu(K_2) - w_3 \nu(K_3)}{\nu(K_1)}$$

### 1.3 Vanna-Volga Calibrated Option Price

$$C_{\text{VV}}(K) = C_{\text{BS}}(K, \sigma_{\text{atm}}) + w_2(K) \left[ C_{\text{BS}}(K_2, \sigma_2) - C_{\text{BS}}(K_2, \sigma_{\text{atm}}) \right] + w_3(K) \left[ C_{\text{BS}}(K_3, \sigma_3) - C_{\text{BS}}(K_3, \sigma_{\text{atm}}) \right]$$

The implied volatility $\sigma_{\text{VV}}(K)$ is obtained by inverting the Black-Scholes formula using Newton-Raphson.

---

## 2. Smile Regimes & Tactical Directives

1. **`NORMAL_EQUILIBRIUM`**:
   - Skew asymmetry $\mathcal{A}_{\text{skew}} \in [-0.15, 0.40]$ and curvature $\mathcal{C}_{\text{smile}} \le 0.15$.
   - Action: `HOLD_DELTA_VEGA_NEUTRAL`. Balanced volatility profile.
2. **`PANIC_DOWNSIDE_SKEW`**:
   - Downside put skew exceeds $\mathcal{A}_{\text{skew}} > 0.40$ (excess crash premium).
   - Action: `EXPLOIT_SKEW_REVERSAL`. Sell expensive out-of-the-money puts, buy calls/underlying to capture mean-reverting skew.
3. **`UPSIDE_CALL_SQUEEZE`**:
   - Inverted call skew $\mathcal{A}_{\text{skew}} < -0.15$ caused by aggressive gamma squeezing.
   - Action: `EXPLOIT_SKEW_REVERSAL`. Short rich upside call premium; hedge with downside puts.
4. **`EXCESS_WING_CONVEXITY`**:
   - Butterfly curvature index $\mathcal{C}_{\text{smile}} > 0.15$.
   - Action: `SELL_OVERPRICED_WINGS`. Sell 25-delta strangle, buy ATM straddle to capture high wing volatility premium.

---

## 3. Verification & Validation Metrics

- Unit tests (`tests/test_options_vanna_volga_pde_engine.py`):
  - Analytic Black-Scholes greeks (Delta, Vega, Vanna, Volga) verify put-call parity and non-linear properties.
  - ATM benchmark exact recovery: $w_{\text{atm}} = 1.0, w_{25\text{C}} = 0.0, w_{25\text{P}} = 0.0$, matching ATM BS price.
  - Downside put skew shock correctly triggers `PANIC_DOWNSIDE_SKEW` and risk-reversal recommendation.
  - Symmetrical wing volatility elevation triggers `EXCESS_WING_CONVEXITY` and short strangle directive.
