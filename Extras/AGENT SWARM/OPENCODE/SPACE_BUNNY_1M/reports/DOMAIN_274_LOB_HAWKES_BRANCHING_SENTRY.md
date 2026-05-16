# Sovereign Quantitative Architecture Report: Domain 274 (WP-FT)
# High-Frequency Limit Order Book Hawkes Self-Excitation Branching Sentry

**Agent Role**: Point Process Quantitative Microstructure Architect (Opencode Sovereign Swarm)  
**Execution Target**: Hawkes Point Process Criticality Sentry & Post-Cascade Exhaustion Sniper  
**Status**: 🟢 Production Ready & Validated  
**Test Suite**: 4/4 Passing Unit Tests  

---

## 1. Executive Summary & Microstructure Mechanics

In electronic limit order books, aggressive market order arrivals are not Poisson processes; they exhibit intense, endogenous **self-excitation and mutual clustering**. A large market order triggers quote cancellations, margin stops, and aggressive chasing by algorithmic trend followers, causing a cascade of subsequent trades.

The mathematical foundation for modeling order flow clustering is the **Hawkes Point Process**:
$$\lambda(t) = \mu_0 + \sum_{t_i < t} \alpha \cdot e^{-\beta (t - t_i)}$$

The key theoretical quantity is the **Branching Ratio** $\eta = \frac{\alpha}{\beta}$, representing the average number of endogenous secondary trades triggered by an initial parent trade:
1. **Subcritical ($\eta < 0.80$)**: Order book is stable; arrivals die out quickly.
2. **Supercritical ($\eta \ge 1.0$)**: The process undergoes an explosive phase transition. Endogenous feedback drives an avalanche of trades that violently drains resting order book depth.

**Domain 274** implements the **LOB Hawkes Branching Sentry**, which:
- Dynamically estimates the branching ratio $\eta$ and instantaneous arrival intensity $\lambda(t)$.
- Fires sub-millisecond resting quote evacuation alerts during supercritical cascades.
- Detects the exact mathematical signature of **cascade exhaustion** ($> 55\%$ intensity collapse from peak while spreads remain wide) to deploy sniper liquidity-providing orders at elevated spreads.

---

## 2. Mathematical Formulation & Architecture

### 2.1 Hawkes Intensity & Branching Parameterization
- Baseline intensity: $\mu_0 > 0$
- Excitation jump: $\alpha > 0$
- Memory decay rate: $\beta > 0$
- Branching ratio:
  $$\eta = \int_0^\infty \alpha e^{-\beta t} dt = \frac{\alpha}{\beta}$$

### 2.2 Cascade Exhaustion Condition
During an aggressive sweep, $\lambda(t)$ surges to a local maximum $\lambda_{\text{peak}} \ge 4\mu_0$.
The cascade reaches exhaustion when trade arrival velocity collapses:
$$\text{Exhaustion Decay (\%)} = \frac{\lambda_{\text{peak}} - \lambda(t)}{\lambda_{\text{peak}}} \times 100\% \ge 55\%$$
At this point, market order aggression has completely exhausted, leaving order book spreads artificially wide. Liquidity providers capture the maximum bid-ask spread with minimal adverse selection risk.

### 2.3 Regime State Machine & Quoting Directives
| Regime | Conditions | Directive | Action |
| :--- | :--- | :--- | :--- |
| **SUPERCRITICAL_CASCADE_EVACUATION** | $\eta \ge 1.0$ or $\frac{\lambda}{\mu_0} \ge 5.0$ | `EMERGENCY_EVACUATE_ALL_RESTING_QUOTES` | Pull all resting maker orders; avoid toxic avalanche |
| **CASCADE_EXHAUSTION_MEAN_REVERSION_SNIPER** | Peak $\ge 4\mu_0$ & Exhaustion $\ge 55\%$ | `EXECUTE_EXHAUSTION_LIQUIDITY_SNIPE` | Deploy high-spread limit orders to harvest wide spread bounce |
| **CRITICAL_ELEVATED_CLUSTERING** | $0.80 \le \eta < 1.0$ or $\frac{\lambda}{\mu_0} \ge 2.5$ | `WIDEN_QUOTES_HALVE_SIZE` | Widen spreads, cut maker quote size by 50% |
| **SUBCRITICAL_STABLE_EQUILIBRIUM** | Otherwise | `MAINTAIN_STANDARD_MAKER_QUOTES` | Standard symmetrical two-sided market making |

---

## 3. Production Deployment & Verification

- **Service Location**: `python-bridge/services/lob_hawkes_branching_sentry.py`
- **Unit Tests**: `python-bridge/tests/test_lob_hawkes_branching_sentry.py`
- **Verification Result**: 4/4 Passing Tests in 0.04s.
- **PM2 Production Status**: Production ready.
