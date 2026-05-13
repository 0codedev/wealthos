# Sovereign Swarm Architecture Blueprint: Domain 201 (WP-CY)
# Real-Time Options Expiry Pin Risk & Multi-Asset Delta Hedging Sentry

**Fabric Layer**: `python-bridge/services/options_expiry_pin_risk_sentry.py`  
**Test Suite**: `python-bridge/tests/test_options_expiry_pin_risk_sentry.py`  
**Execution Node**: Oracle VPS Production Engine (`ubuntu@68.233.111.34`)  
**Mathematical Archetype**: Avellaneda-Lipkin (2003) Dealer Gamma Gravity, Strike Pinning Transition Density, Discontinuous 15:00 IST Delta Rebalancing Surge.

---

## 1. Quantitative Formulation & Market Microstructure Foundations

On options expiration days (e.g., weekly and monthly index expiry in Indian and global equity derivatives), options delta exhibits extreme non-linear behavior. As remaining time to maturity $\tau = T - t \to 0$:
1. **Gamma Singularity**:
   $$\Gamma(S, K, \tau) = \frac{\phi(d_1)}{S \sigma \sqrt{\tau}} \xrightarrow{\tau \to 0} \infty \quad \text{for } S \approx K$$
2. **Delta Heaviside Collapse**:
   $$\lim_{\tau \to 0} \Delta_{\text{call}}(S) = \mathbf{1}_{\{S > K\}}, \quad \lim_{\tau \to 0} \Delta_{\text{put}}(S) = -\mathbf{1}_{\{S < K\}}$$
A microscopic move of $\pm 1$ tick across strike $K$ in the final 30 minutes (15:00 to 15:30 IST) causes market makers' portfolio delta to jump instantaneously between 0 and 100%, triggering massive forced rebalancing flow in the underlying cash and futures markets.

### 1.1 Avellaneda-Lipkin (2003) Dealer Gamma Gravity Mechanics
Option market makers maintain dynamic delta neutrality by buying or selling the underlying index:
$$d\Delta_{\text{dealer}} = \Gamma_{\text{net}}(S) \, dS$$
- **Long Dealer Gamma Regime ($\Gamma_{\text{net}} > 0$)**:
  As spot rises ($dS > 0$), dealers become longer delta and must **sell** the underlying.
  As spot drops ($dS < 0$), dealers become shorter delta and must **buy** the underlying.
  This negative feedback produces an attractive gravitational drift pulling spot price directly toward the strike with maximum open interest (Max Pain / Gamma Pin):
  $$F_{\text{pin}}(S, K) = -\kappa_{\text{gravity}} \cdot \text{GEX}(K) \cdot (S - K) \cdot \exp\left( -\frac{(S - K)^2}{2 (\sigma S \sqrt{\tau})^2} \right)$$
- **Short Dealer Gamma Regime ($\Gamma_{\text{net}} < 0$)**:
  Dealers must buy into rallies and sell into declines, acting as a positive feedback accelerator. Any break beyond strike $K$ results in an explosive **Gamma Squeeze**.

---

## 2. Dynamic Strike Pinning Probability

The probability that the underlying index closes within the terminal strike interval $[K - \frac{1}{2}\Delta K, K + \frac{1}{2}\Delta K]$ is modeled by integrating the transition density with gamma-induced mean reversion:
$$\mathcal{P}_{\text{pin}}(S, K, \tau) = \Phi\left( \frac{K + \frac{1}{2}\Delta K - S_{\tau}}{\sigma S \sqrt{\tau}} \right) - \Phi\left( \frac{K - \frac{1}{2}\Delta K - S_{\tau}}{\sigma S \sqrt{\tau}} \right)$$
where $S_{\tau} = S + \kappa_{\text{drift}} (K - S)$ incorporates the gravitational pull of dealer long gamma.
- $\mathcal{P}_{\text{pin}} \ge 70\%$: **Locked Pin** (pinning basin traps spot price).
- $45\% \le \mathcal{P}_{\text{pin}} < 70\%$: **Convergent Gravity** (spot oscillates toward strike).
- $\mathcal{P}_{\text{pin}} < 45\%$: **Unpinned Diffusion** (free Brownian motion).

---

## 3. Sovereign Trading & Execution Directives

1. **Iron Butterfly / Straddle Pin Harvest**:
   - When $\mathcal{P}_{\text{pin}} \ge 70\%$ and $\text{GEX} > 1.0$ Cr, sell the $K$-strike straddle or narrow iron butterfly at 14:00 IST to capture accelerated theta decay as time premium collapses to zero.
   - Enforce hard stop collars at $K \pm \Delta K$.
2. **Gamma Squeeze Breakout Rider**:
   - When $\text{GEX} < -1.0$ Cr (dealers short gamma) and spot breaches $K \pm 0.3\%$, initiate aggressive breakout trades in the direction of the breach, anticipating market maker forced delta hedging surges.
3. **Underlying Rebalance Flow Sentry**:
   - Quantifies the anticipated rebalancing surge: $\Delta Q_{\text{shares}} = \sum \Gamma_i \cdot \Delta S \cdot \text{LotSize}$.
   - If expected rebalancing exceeds $25\%$ of top-of-book depth, cancel passive limit orders to avoid being swept.

---

## 4. Verification & Validation Metrics

- Unit tests (`tests/test_options_expiry_pin_risk_sentry.py`):
  - Black-Scholes gamma verified to explode $> 10\times$ between 30 days and 1 hour to expiry.
  - Pinning probability converges $> 50\%$ ATM with 45 minutes remaining vs $< 1\%$ for 300-pt OTM strikes.
  - Full options chain GEX aggregation correctly categorizes `STRONG_LONG_GAMMA` and dispatches `PIN_HARVEST_STRADDLE`.
  - Negative GEX correctly identifies `STRONG_SHORT_GAMMA` and triggers `GAMMA_SQUEEZE_BREAKOUT`.
  - 100% test coverage with 0 warnings.
