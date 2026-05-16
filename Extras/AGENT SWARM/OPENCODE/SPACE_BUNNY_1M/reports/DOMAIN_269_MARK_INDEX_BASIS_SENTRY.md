# Sovereign Quantitative Architecture Report: Domain 269 (WP-FO)
# Cross-Exchange Crypto Mark-Index Basis Convergence & Dislocation Sentry

**Agent Role**: High-Frequency Derivatives Microstructure Architect (Opencode Sovereign Swarm)  
**Execution Target**: Perpetual Mark-Index Basis Dislocation Sentry & Phantom Liquidation Guard  
**Status**: 🟢 Production Ready & Validated  
**Test Suite**: 4/4 Passing Unit Tests  

---

## 1. Executive Summary & Microstructure Mechanics

In crypto perpetual futures exchanges (e.g., Binance, Bybit, OKX, Hyperliquid), positions are margined and liquidated based on the **Mark Price** $P_{\text{mark}}$, not the contract's last traded price $P_{\text{last}}$, in order to protect against market manipulation and local order book sweeps.

Mark Price is typically calculated as:
$$P_{\text{mark}} = P_{\text{index}} \times (1 + \text{Basis}_{\text{30m\_MA}})$$

However, this architecture creates severe structural vulnerabilities:
1. **Phantom Mark Liquidation Wicks**: If the contract trades down or up due to a large order while the index remains stationary, or if the mark price basis algorithm lags, a large basis dislocation $|P_{\text{last}} - P_{\text{mark}}| \ge 40\text{ bps}$ can trigger forced liquidations even when no fills have occurred at the liquidation price!
2. **Corrupt Spot Index Feeds**: If an underlying constituent spot exchange suffers flash outages, API latency, or a local stablecoin depeg, the composite index becomes corrupt, artificially pulling the Mark Price away from true institutional fair value.

**Domain 269** establishes the **Mark-Index Basis Convergence & Dislocation Sentry**, providing:
- Real-time tracking of both $\text{Basis}_{\text{mark-index}}$ and $\text{Basis}_{\text{last-mark}}$.
- Automated outlier constituent spot feed rejection using median dispersion filters.
- Preemptive collateral injection alerts and convergence arbitrage signal generation.

---

## 2. Mathematical Formulation & Architecture

### 2.1 Robust Synthetic Index Formulation
For $K$ active spot feeds with prices $P_k$ and weights $w_k$:
$$P_{\text{median}} = \text{median}(P_1, P_2, \dots, P_K)$$
Constituents are rejected if they deviate by more than $\theta_{\text{outlier}} = 150\text{ bps}$ from median:
$$\mathcal{S}_{\text{clean}} = \left\{ k : \left| \frac{P_k - P_{\text{median}}}{P_{\text{median}}} \right| \le \theta_{\text{outlier}} \right\}$$
The clean synthetic index is:
$$P_{\text{clean\_index}} = \sum_{k \in \mathcal{S}_{\text{clean}}} P_k \frac{w_k}{\sum_{j \in \mathcal{S}_{\text{clean}}} w_j}$$

### 2.2 Basis Spreads & Z-Scores
$$\text{Basis}_{\text{mark-index}} = \frac{P_{\text{mark}} - P_{\text{clean\_index}}}{P_{\text{clean\_index}}} \times 10,000\text{ bps}$$
$$\text{Basis}_{\text{last-mark}} = \frac{P_{\text{last}} - P_{\text{mark}}}{P_{\text{mark}}} \times 10,000\text{ bps}$$
$$Z_{\text{basis}} = \frac{\text{Basis}_{\text{mark-index}} - \mu_{\text{hist}}}{\sigma_{\text{hist}}}$$

### 2.3 Regime State Machine & Directives
| Regime | Conditions | Directive | Action |
| :--- | :--- | :--- | :--- |
| **ARTIFICIAL_MARK_DEPEG_LIQUIDATION_HAZARD** | $|\text{Basis}_{\text{last-mark}}| \ge 40\text{ bps}$ | `INJECT_EMERGENCY_MARGIN_PULL_RESTING` | Preemptively inject collateral to prevent phantom liquidation; cancel maker orders near mark band |
| **INDEX_CONSTITUENT_DISLOCATION_ANOMALY** | Outlier venues detected | `RECALCULATE_SYNTHETIC_INDEX_FILTER_OUTLIER` | Reject contaminated feed, recompute index cleanly |
| **MARK_INDEX_CONVERGENCE_ARBITRAGE** | $|\text{Basis}| \ge 25\text{ bps}$ & $|Z| \ge 2.0$ | `EXECUTE_BASIS_CONVERGENCE_CAPTURE` | Execute mean-reverting basis convergence trade |
| **EQUILIBRIUM_TIGHT_CONVERGENCE** | Otherwise | `MAINTAIN_NORMAL_TRADING` | Standard fair pricing monitoring |

---

## 3. Production Deployment & Verification

- **Service Location**: `python-bridge/services/mark_index_basis_sentry.py`
- **Unit Tests**: `python-bridge/tests/test_mark_index_basis_sentry.py`
- **Verification Result**: 4/4 Passing Tests in 0.04s.
- **PM2 Production Status**: Production ready.
