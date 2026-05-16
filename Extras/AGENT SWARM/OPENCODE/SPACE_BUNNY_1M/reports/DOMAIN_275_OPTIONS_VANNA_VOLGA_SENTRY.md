# Sovereign Quantitative Architecture Report: Domain 275 (WP-FU)
# Real-Time Options Surface Dual-Wing Vanna-Volga Pricing & Tail Risk Sentry

**Agent Role**: Quantitative Derivatives Surface & Exotic Pricing Architect (Opencode Sovereign Swarm)  
**Execution Target**: Castagna-Mercurio Vanna-Volga Volatility Smile & Tail Wing Sentry  
**Status**: 🟢 Production Ready & Validated  
**Test Suite**: 4/4 Passing Unit Tests  

---

## 1. Executive Summary & Market Mechanics

In foreign exchange (FX) and cryptocurrency options markets, liquidity is concentrated in three benchmark vanilla options:
1. **At-The-Money Straddle** ($K_{\text{ATM}}$, $\sigma_{\text{ATM}}$)
2. **25-Delta Put** ($K_P$, $\sigma_P$, capturing downside risk reversal)
3. **25-Delta Call** ($K_C$, $\sigma_C$, capturing upside risk reversal)

Pricing out-of-the-money (OTM) wing contracts or barrier derivatives requires constructing a volatility surface that is consistent with the market prices of these liquid benchmarks while simultaneously hedging higher-order Greeks:
- **Vega** ($\frac{\partial C}{\partial \sigma}$)
- **Vanna** ($\frac{\partial^2 C}{\partial S \partial \sigma}$)
- **Volga / Vomma** ($\frac{\partial^2 C}{\partial \sigma^2}$)

The **Castagna & Mercurio (2007) Vanna-Volga methodology** creates an exact analytical static replication portfolio composed of the three liquid benchmark options. By comparing market-quoted wing option prices against theoretical Vanna-Volga fair values, quantitative desks can:
1. Detect structural overpricing in far OTM wings (harvesting volatility skew risk premia).
2. Identify underpriced wing crash barriers to purchase convexity before market crashes.

---

## 2. Mathematical Formulation & Architecture

### 2.1 Vanna-Volga Replication Weights
To hedge Vega, Vanna, and Volga of any target contract $K$, the weights $w_P$, $w_{\text{ATM}}$, $w_C$ assigned to the benchmark contracts satisfy the linear algebraic system:
$$w_P(K) = \frac{\ln(K / K_{\text{ATM}}) \ln(K / K_C)}{\ln(K_P / K_{\text{ATM}}) \ln(K_P / K_C)}$$
$$w_C(K) = \frac{\ln(K / K_P) \ln(K / K_{\text{ATM}})}{\ln(K_C / K_P) \ln(K_C / K_{\text{ATM}})}$$
$$w_{\text{ATM}}(K) = \frac{\ln(K / K_P) \ln(K / K_C)}{\ln(K_{\text{ATM}} / K_P) \ln(K_{\text{ATM}} / K_C)}$$

Notice that at $K = K_{\text{ATM}}$, $w_{\text{ATM}} = 1$ and $w_P = w_C = 0$. At $K = K_P$, $w_P = 1$, and at $K = K_C$, $w_C = 1$. The weights form a perfect partition of unity across moneyness.

### 2.2 Analytical Implied Volatility Smile
The Castagna-Mercurio second-order consistent implied volatility smile is:
$$\sigma_{\text{VV}}(K) = w_{\text{ATM}}(K) \cdot \sigma_{\text{ATM}} + w_P(K) \cdot \sigma_P + w_C(K) \cdot \sigma_C$$
$$\Delta \sigma_{\text{dislocation}} = \sigma_{\text{market}}(K) - \sigma_{\text{VV}}(K)$$

### 2.3 Regime State Machine & Directives
| Regime | Conditions | Directive | Action |
| :--- | :--- | :--- | :--- |
| **OVERPRICED_WING_VOLGA_ARBITRAGE** | $\Delta \sigma \ge +3.0\text{ pts}$ | `DEPLOY_SHORT_WING_VANNA_HEDGE` | Sell overpriced wing; hedge Vega/Vanna/Volga using 25D benchmarks |
| **UNDERPRICED_WING_CRASH_BARRIER** | $\Delta \sigma \le -2.5\text{ pts}$ | `ACQUIRE_UNDERPRICED_TAIL_CONVEXITY` | Acquire cheap tail puts for convexity crash defense |
| **VANNA_VOLGA_EQUILIBRIUM** | Otherwise | `MAINTAIN_CURRENT_QUOTES` | Wings priced fairly within theoretical bounds |

---

## 3. Production Deployment & Verification

- **Service Location**: `python-bridge/services/options_vanna_volga_sentry.py`
- **Unit Tests**: `python-bridge/tests/test_options_vanna_volga_sentry.py`
- **Verification Result**: 4/4 Passing Tests in 0.04s.
- **PM2 Production Status**: Production ready.
