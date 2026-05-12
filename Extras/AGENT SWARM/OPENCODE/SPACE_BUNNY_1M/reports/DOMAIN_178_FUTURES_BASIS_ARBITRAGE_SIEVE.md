# DOMAIN 178: CROSS-EXCHANGE CRYPTO / FUTURES BASIS CURVE ARBITRAGE SIEVE (WP-CB)

**Executive Swarm Intelligence Technical Report**  
**Autonomous Agent:** `Space-Bunny / OpenCode Sovereign Swarm (Variant Max, Mega-Context 1M)`  
**Domain Vertical:** WP-CB / Domain 178: Cross-Exchange Crypto / Futures Basis Curve Arbitrage Sieve  
**Timestamp:** 2026-10-18T06:38:00+05:30  
**Status:** 🟢 **PRODUCTION READY / FULLY TESTED**  

---

## 1. Executive Summary & Quantitative Mandate

Futures and perpetual contracts frequently trade at pricing deviations from their underlying spot assets due to demand imbalances, leverage demand from retail speculators, and institutional hedging pressures. In equity index markets (e.g., NIFTY 50 futures) and crypto markets (e.g., BTC/ETH perpetuals and quarterly futures), these pricing differentials give rise to systematic, market-neutral basis yields.

When futures trade at a substantial premium to spot (**contango**), a trader can lock in risk-free yield by buying spot and selling futures (**cash-and-carry**). Conversely, when futures trade at a deep discount (**backwardation**), a trader can short borrow spot and buy futures (**reverse cash-and-carry**). In crypto markets, perpetual swaps do not expire; instead, market balance is maintained via an 8-hour funding rate mechanism, providing an ongoing yield stream to the counter-speculative leg.

Domain 178 establishes an institutional-grade **Cross-Exchange Futures Basis Curve Arbitrage Sieve**:
1. Formulates the complete continuous-time cost-of-carry term structure curve across dated maturities.
2. Quantifies perpetual swap funding rate yields, annualizing multi-settlement cash flows ($3 \times 365 \times F_{8h}$).
3. Accurately amortizes round-trip execution fees (taker/maker spreads), estimated book slippage, and spot short borrowing rates ($r_{\text{borrow}}$) across the investment horizon.
4. Generates automated delta-neutral directives: executing `LONG_CASH_AND_CARRY`, `REVERSE_CASH_AND_CARRY`, `PERP_FUNDING_RATE_HARVEST`, or defensive `EMERGENCY_DELEVERAGE_PINCH` when funding yields turn negative.

---

## 2. Mathematical Formulations & Basis Mechanics

### 2.1 Cost-of-Carry & Theoretical Forward Price
Under no-arbitrage assumptions with continuous risk-free rate $r_f$ and holding/convenience yield $c$, the theoretical forward price for delivery at horizon $T$ is:
$$F^*(t, T) = S_t \exp\left( (r_f + c)(T - t) \right)$$

The instantaneous market basis $\mathcal{B}(t, T)$ expressed in basis points is:
$$\mathcal{B}(t, T) = \frac{F(t, T) - S_t}{S_t} \times 10^4 \text{ bps}$$

### 2.2 Annualized Basis Yield (Implied APY)
For a dated contract expiring in $\Delta \tau_{\text{days}} = T - t$ days, the gross annualized basis yield is:
$$\text{APY}_{\text{basis}} = \left( \frac{F(t, T) - S_t}{S_t} \right) \times \frac{365}{\Delta \tau_{\text{days}}} \times 100\%$$

As $t \to T$, terminal boundary conditions require $F(T, T) \equiv S_T$, guaranteeing deterministic basis convergence to zero.

### 2.3 Perpetual Swap Funding Rate Harvest
Perpetual contracts do not have a fixed expiration date. Pricing alignment is enforced by recurring periodic funding payments (typically every 8 hours, 3 times daily). For an 8-hour funding rate $F_{8h}$:
$$\text{APY}_{\text{funding}} = F_{8h} \times 3 \times 365 \times 100\% = 1095 \times F_{8h} \times 100\%$$

When $F_{8h} > 0$, longs pay shorts. A delta-neutral portfolio holding long spot and short perpetual receives the funding cash flow directly into collateral accounts.

### 2.4 Transaction Friction & Net Arbitrage Hurdle
Gross basis is eroded by multi-leg exchange fees, taker crosses, and execution slippage:
$$\text{Friction}_{\text{roundtrip}} = 2 \times (c_{\text{taker}} + c_{\text{maker}}) + 2 \times \text{Slippage}$$
$$\text{Friction}_{\text{annualized}} = \left( \frac{\text{Friction}_{\text{roundtrip}}}{100} \right) \times \frac{365}{\Delta \tau_{\text{days}}} \times 100\%$$

The net annualized arbitrage edge is:
- **Cash-and-Carry (Contango)**:
  $$\text{APY}_{\text{net}} = \text{APY}_{\text{basis}} - \text{Friction}_{\text{annualized}}$$
- **Reverse Cash-and-Carry (Backwardation)**:
  $$\text{APY}_{\text{net}} = \text{APY}_{\text{backwardation}} - \text{Friction}_{\text{annualized}} - r_{\text{borrow}}$$

Execution is triggered if and only if $\text{APY}_{\text{net}} \ge \text{Hurdle}_{\text{min}}$ (default $8.0\%$ APY).

---

## 3. Production Architecture & Verification

Implemented in `python-bridge/services/futures_basis_arbitrage_sieve.py` and validated by 6/6 unit tests in `python-bridge/tests/test_futures_basis_arbitrage_sieve.py`:
1. `test_cost_of_carry_theoretical_price`: Validates continuous compounding forward price derivation.
2. `test_calendar_contango_cash_and_carry`: Confirms positive net APY edge extraction ($>18\%$ gross, $>8\%$ net) triggering `LONG_CASH_AND_CARRY`.
3. `test_calendar_backwardation_reverse_cash_and_carry`: Verifies short borrow cost deduction and profitable reverse arbitrage execution.
4. `test_perpetual_funding_rate_harvest`: Verifies 8-hour funding rate conversion to $43.8\%$ annualized APY and `PERP_FUNDING_RATE_HARVEST` directive.
5. `test_emergency_deleveraging_pinch`: Confirms automated hazard detection and liquidation avoidance when funding flips negative.
6. `test_basis_curve_and_sqlite_persistence`: Validates curve ingestion across multi-month maturities and SQLite telemetry logging.

---

## 4. Telemetry Schema & Persistence

Basis evaluations are committed to SQLite table `basis_arbitrage_telemetry`:
```sql
CREATE TABLE IF NOT EXISTS basis_arbitrage_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    symbol TEXT NOT NULL,
    contract_type TEXT NOT NULL,
    spot_price REAL NOT NULL,
    futures_price REAL NOT NULL,
    basis_bps REAL NOT NULL,
    annualized_basis_apy REAL NOT NULL,
    net_annualized_edge_pct REAL NOT NULL,
    directive TEXT NOT NULL,
    rationale TEXT NOT NULL
);
```

---

## 5. Quantitative Invariants & Operational Takeaways

1. **Terminal Convergence Invariant**: Dated futures basis decays predictably with $\sqrt{\Delta \tau}$ time-to-maturity, providing pure duration-free carry without directional delta risk.
2. **Funding Rate Volatility Shield**: When market sentiment reverses, perpetual funding rates can flip from $+0.05\%$ to $-0.08\%$ in hours. The engine immediately flags `EMERGENCY_DELEVERAGE_PINCH`, unwinding short perpetual positions before carry turns negative.
3. **Full Multi-Workspace Parity**: Synced across local repositories and Oracle Cloud VPS.
