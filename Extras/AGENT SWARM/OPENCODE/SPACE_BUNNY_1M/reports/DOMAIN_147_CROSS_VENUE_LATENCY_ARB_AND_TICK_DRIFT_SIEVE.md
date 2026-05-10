# Domain 147: Multi-Exchange Cross-Venue Latency Arbitrage & Tick Drift Sieve (WP-AW)

## Executive Summary & Quantitative Thesis
In the Indian financial markets, major equity large-caps (such as RELIANCE, HDFCBANK, INFOSYS, and TCS) as well as index futures are actively traded across two primary matching engines: the National Stock Exchange (NSE) and the Bombay Stock Exchange (BSE). 

While the fundamental underlying cash flows are identical, physical geographical separation of server racks, co-location network path differences, and dramatic disparities in order flow arrival intensities (NSE typically handling $> 90\%$ of index options and single-stock cash turnover) create persistent microsecond-level tick dislocations:
1. **Static Spatial Arbitrage**: Instances where the bid on one exchange exceeds the ask on the other exchange by more than the statutory transaction friction (STT, exchange turnover fees, SEBI charges, stamp duty, and half-spread slippage).
2. **Predictive Lead-Lag Drift**: Fast price discovery events on the dominant venue (NSE) propagate to the secondary venue (BSE) with a characteristic empirical transmission lag ($\tau \in [2, 15]\text{ ms}$). An ultra-low-latency algorithm can snatch resting passive quotes on BSE before local market makers update their quotes to match the NSE print.

Domain 147 engineers the **Multi-Exchange Cross-Venue Latency Arbitrage & Tick Drift Sieve**, providing:
- Closed-form evaluation of instantaneous net-of-friction spatial arbitrage.
- Real-time tracking of inter-exchange microsecond timestamp drift ($\Delta t_{\mu\text{s}}$).
- Predictive lead-lag basis gating to capture lagging quotes while vetoing stale quote feeds during network degradation.

---

## Mathematical Formulations

### 1. Dual-Venue Mid-Prices & Basis Spread
Let $P_{\text{NSE}}^{\text{bid}}, P_{\text{NSE}}^{\text{ask}}$ and $P_{\text{BSE}}^{\text{bid}}, P_{\text{BSE}}^{\text{ask}}$ denote the top-of-book quotes with nanosecond exchange timestamps $t_{\text{NSE}}$ and $t_{\text{BSE}}$:
$$\text{Mid}_{\text{NSE}} = \frac{P_{\text{NSE}}^{\text{bid}} + P_{\text{NSE}}^{\text{ask}}}{2}, \quad \text{Mid}_{\text{BSE}} = \frac{P_{\text{BSE}}^{\text{bid}} + P_{\text{BSE}}^{\text{ask}}}{2}$$
$$\bar{P} = \frac{\text{Mid}_{\text{NSE}} + \text{Mid}_{\text{BSE}}}{2}$$

The normalized cross-venue basis in basis points is:
$$\delta_{\text{bps}} = \frac{\text{Mid}_{\text{NSE}} - \text{Mid}_{\text{BSE}}}{\bar{P}} \times 10^4$$

---

### 2. Static Spatial Arbitrage Condition (Net of Statutory Friction)
An instantaneous riskless spatial arbitrage exists between the two order books if:
$$\text{Spread}_{\text{BuyBSE\_SellNSE}} = P_{\text{NSE}}^{\text{bid}} - P_{\text{BSE}}^{\text{ask}}$$
$$\text{Spread}_{\text{BuyNSE\_SellBSE}} = P_{\text{BSE}}^{\text{bid}} - P_{\text{NSE}}^{\text{ask}}$$

The maximum gross arbitrage spread is:
$$\mathcal{S}_{\text{gross}} = \max\left(\text{Spread}_{\text{BuyBSE\_SellNSE}}, \; \text{Spread}_{\text{BuyNSE\_SellBSE}}\right)$$

Net arbitrage profitability after exchange and statutory turnover costs:
$$\Pi_{\text{net, bps}} = \left( \frac{\mathcal{S}_{\text{gross}}}{\bar{P}} \times 10^4 \right) - \mathcal{F}_{\text{statutory, bps}}$$
Where $\mathcal{F}_{\text{statutory, bps}} \approx 3.5\text{ bps}$ for futures or $10.0\text{ bps}$ for cash equities.
- **Rule**: If $\Pi_{\text{net, bps}} > 0.0$, trigger immediate atomic two-legged simultaneous execution.

---

### 3. Predictive Lead-Lag Propagation Sieve
Due to massive liquidity concentration, price innovations occur first on NSE and diffuse to BSE over an Ornstein-Uhlenbeck decay kernel:
$$\hat{P}_{\text{BSE}}(t + \tau) = P_{\text{BSE}}(t) + \beta \cdot [ P_{\text{NSE}}(t) - P_{\text{BSE}}(t) ]$$

If static arbitrage is sub-friction ($\Pi_{\text{net, bps}} \le 0$), but the mid-price dislocation $|\delta_{\text{bps}}| \ge \delta_{\text{hurdle}}$ (default $5.0\text{ bps}$) and the inter-venue timestamp drift is within the latency propagation window ($\Delta t \le \tau_{\text{decay}} = 25\text{ ms}$):
- If $\delta_{\text{bps}} > 0$ and NSE is leading: NSE rallied ahead $\implies$ **Snatch Lagging BSE Ask** before BSE ask reprices upwards.
- If $\delta_{\text{bps}} < 0$ and NSE is leading: NSE dumped ahead $\implies$ **Dump into Lagging BSE Bid** before BSE bid drops.

---

### 4. Clock Synchronization & Stale Feed Sentry
Inter-exchange latency drift:
$$\Delta t_{\mu\text{s}} = \frac{|t_{\text{NSE}} - t_{\text{BSE}}|}{1000} \quad (\mu\text{s})$$
If the age of either venue's quote exceeds $500\text{ ms}$ ($\max(t_{\text{now}} - t_{\text{NSE}}, t_{\text{now}} - t_{\text{BSE}}) > 500\text{ ms}$), the feed is classified as `STALE_FEED_DROPOUT`, immediately vetoing all arbitrage and lead-lag execution directives to prevent execution into phantom quotes.

---

### 5. Execution Directive Matrix
| Condition | Regime Classification | Execution Directive |
| :--- | :--- | :--- |
| **$\Pi_{\text{net, bps}} > 0.0$** | `STATIC_SPATIAL_ARBITRAGE` | Atomic simultaneous two-legged market order crossing |
| **$|\delta_{\text{bps}}| \ge 5.0\text{ bps}$ & $\Delta t \le 25\text{ ms}$** | `PREDICTIVE_LEAD_LAG_DRIFT` | Aggressive IOC snatch of lagging venue passive queue |
| **$|\delta_{\text{bps}}| < 2.0\text{ bps}$** | `SYNCHRONIZED_EQUILIBRIUM` | Passive two-sided market making; maintain quotes |
| **Quote Age $> 500\text{ ms}$** | `STALE_FEED_DROPOUT` | Veto all execution directives; flag feed link failure |

---

## Service Architecture & Implementation

The production service is located in `python-bridge/services/cross_venue_latency_sieve.py`:
- **`VenueQuote` Dataclass**: Standardized container for venue, symbol, top-of-book bid/ask, sizes, and nanosecond timestamp.
- **Microsecond Timestamp Differencing**: Computes clock drift and quote age against monotonic or hardware PTP time.
- **Two-Tier Arb Sieve**: Prioritizes guaranteed locked-in static spatial arbitrage; seamlessly cascades to predictive lead-lag drift when spreads are not crossed.
- **Persistence Layer**: Thread-safe SQLite logging into `cross_venue_latency_telemetry`.

---

## Verification & Test Suite Coverage

The test suite in `python-bridge/tests/test_cross_venue_latency_sieve.py` passes 100% of institutional checks:
1. `test_static_spatial_arbitrage_profitable`: Validates 5 pt spread on 3000 price (~16.6 bps gross), net profit $> 10$ bps after 3.5 bps friction $\implies$ `STATIC_SPATIAL_ARBITRAGE` and `EXECUTE_ATOMIC_BUY_BSE_SELL_NSE`.
2. `test_predictive_lead_lag_drift`: Proves that a non-crossed book with $+10$ bps mid-price delta and $5\text{ ms}$ drift triggers `PREDICTIVE_LEAD_LAG_DRIFT` and `SNATCH_LAGGING_BSE_ASK`.
3. `test_synchronized_equilibrium`: Confirms zero basis delta triggers `SYNCHRONIZED_EQUILIBRIUM` and passive maker holding.
4. `test_stale_feed_dropout_veto`: Validates that a 1.5-second stale BSE quote vetoes execution with `STALE_FEED_DROPOUT`.
5. `test_sqlite_persistence`: Validates SQLite telemetry schema and logging.

**Execution Result on Oracle Cloud VPS:**
```
tests/test_cross_venue_latency_sieve.py ..... [100%]
5 passed in 0.04s
```
