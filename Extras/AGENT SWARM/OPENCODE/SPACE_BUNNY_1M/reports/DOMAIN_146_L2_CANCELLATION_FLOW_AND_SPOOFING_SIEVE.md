# Domain 146: Order Book Level-2 Cancellation Flow & Spoofing Phantom Liquidity Sieve (WP-AV)

## Executive Summary & Quantitative Thesis
In electronic limit order book (LOB) trading on Indian exchanges (NSE equity, NIFTY futures, and single-stock derivatives), algorithmic execution routers and momentum models frequently rely on visible Level-2/Level-3 market depth snapshots (Top-5 or Top-20 bid/ask queues). However, predatory high-frequency trading (HFT) participants exploit this reliance through **spoofing and phantom layering**:
- Submitting massive non-bona fide resting buy or sell limit orders to generate deceptive Order Book Imbalance (OBI).
- Baiting retail algorithms and execution algos into joining or crossing the spread.
- Sub-millisecond flash-cancelling the artificial wall as soon as opposing market orders approach within 1–2 ticks.

Relying on raw book depth $D_{\text{raw}}$ results in severe slippage, adverse selection, and buying the exact top of an engineered liquidity trap.

Domain 146 engineers the **Order Book Level-2 Cancellation Flow & Spoofing Phantom Liquidity Sieve**, delivering:
1. Microsecond **Cancellation-to-Trade Ratio (CTR)** tracking.
2. Volume-weighted quote lifetime persistence ($\bar{\tau}_{\text{life}}$ in milliseconds).
3. Asymmetric **Flash Pull Ratio ($\Xi_{\text{flash}}$)** evaluating orders pulled within 2 ticks of the mid-market price.
4. Composite **Spoofing Phantom Hazard Index ($S_{\text{phantom}} \in [0.0, 1.0]$)** that discounts visible depth to calculate **True Vetted Effective Depth** ($D_{\text{effective}}$) and triggers counter-manipulation fade directives.

---

## Mathematical Formulations

### 1. Cancellation-to-Trade Ratio (CTR)
Over an event observation window $\Delta t$, let $\mathcal{E}_{\text{side}}$ be the stream of discrete order events for a given book side (BID or ASK):
$$\text{CTR}_{\text{side}} = \frac{\sum_{k \in \mathcal{C}_{\text{side}}} V_k}{\max\left(1.0, \; \sum_{m \in \mathcal{T}_{\text{side}}} V_m\right)}$$
Where:
- $\mathcal{C}_{\text{side}}$ is the set of order cancellation events.
- $\mathcal{T}_{\text{side}}$ is the set of completed trade execution events.
- Under bona fide institutional liquidity provision, $\text{CTR} \in [5, 30]$.
- Under predatory spoofing manipulation, $\text{CTR} \ge 150:1$.

### 2. Volume-Weighted Median Quote Persistence Lifetime
For an order $k$ inserted at $t_{\text{insert}, k}$ and cancelled at $t_{\text{cancel}, k}$:
$$\tau_{\text{life}, k} = t_{\text{cancel}, k} - t_{\text{insert}, k} \quad \text{(ms)}$$
The volume-weighted mean persistence lifetime is:
$$\bar{\tau}_{\text{life}} = \frac{\sum_k V_k \cdot \tau_{\text{life}, k}}{\sum_k V_k}$$
- Fleeting quotes with $\bar{\tau}_{\text{life}} < 100\text{ ms}$ are classified as ephemeral phantom liquidity.

### 3. Asymmetric Flash Cancellation Ratio ($\Xi_{\text{flash}}$)
Predatory spoofers maintain resting quotes only while the market is distant; as soon as opposing aggressive volume approaches within distance threshold $\delta$ (default 2 ticks from mid-price), the order is instantaneously pulled:
$$\Xi_{\text{flash}} = \frac{\sum_{k \in \mathcal{C}_{\text{flash}}} V_k}{\sum_{k \in \mathcal{C}_{\text{total}}} V_k}$$
Where $\mathcal{C}_{\text{flash}} = \{ k \in \mathcal{C} \mid |P_k - \text{Mid}| \le \delta \cdot \text{TickSize} \}$.

---

### 4. Composite Spoofing Phantom Hazard Index ($S_{\text{phantom}}$)
$$S_{\text{phantom}} = \min\left(1.0, \; 0.40 \cdot \min\left(1.0, \frac{\text{CTR}}{150.0}\right) + 0.35 \cdot \Xi_{\text{flash}} + 0.25 \cdot \max\left(0.0, 1.0 - \frac{\bar{\tau}_{\text{life}}}{200.0}\right)\right)$$

### 5. Real Vetted Effective Depth
$$D_{\text{effective}} = D_{\text{raw}} \cdot (1.0 - S_{\text{phantom}})$$

---

### 6. Microstructure Defense & Routing Ladder
| Hazard Index ($S_{\text{phantom}}$) | Regime Classification | Execution Directive | Effective Depth Haircut |
| :--- | :--- | :--- | :--- |
| **$0.00 \le S \le 0.25$** | `ORGANIC_LIQUIDITY` | Proceed with standard TWAP / VWAP / Market routing | $0\% - 25\%$ (Minimal discount) |
| **$0.25 < S \le 0.55$** | `MILD_PHANTOM_NOISE` | Require passive pegging and trade tick fills | $25\% - 55\%$ haircut |
| **$0.55 < S \le 0.80$** | `ELEVATED_SPOOFING_ALERT` | Veto aggressive orders into the spoofed side | $55\% - 80\%$ haircut |
| **$0.80 < S \le 1.00$** | `CRITICAL_PHANTOM_LIQUIDITY_TRAP` | Veto depth; fade artificial wall (counter-trade manipulation) | $> 80\%$ haircut ($D_{\text{eff}} \approx 0$) |

---

## Service Architecture & Implementation

The production service is located in `python-bridge/services/l2_cancellation_spoofing_sieve.py`:
- **`OrderBookEvent` Dataclass**: Captures event type (`NEW`, `CANCEL`, `TRADE`), side (`BID`/`ASK`), price, quantity, timestamp in ms, order ID, and tick distance to mid.
- **Event Stream Analyzer**: Evaluates order lifetimes by cross-referencing `NEW` and `CANCEL` order identifiers.
- **Side Isolation**: Strictly partitions bid and ask calculations, preventing asymmetrical spoofing on one side from contaminating the other.
- **Persistence Layer**: Thread-safe SQLite logging into `l2_spoofing_telemetry`.

---

## Verification & Test Suite Coverage

The test suite in `python-bridge/tests/test_l2_cancellation_spoofing_sieve.py` passes 100% of institutional checks:
1. `test_organic_market_making_stream`: Validates organic order stream ($\text{CTR} \le 1.0$, lifetime $> 1000\text{ ms}$, $\Xi_{\text{flash}} = 0.0$, $S_{\text{phantom}} \le 0.25$, regime `ORGANIC_LIQUIDITY`).
2. `test_predatory_spoofing_flash_cancellation`: Simulates a 50,000 share spoof pulled within 35 ms at 1 tick from mid, yielding $\text{CTR} \ge 150$, $\Xi_{\text{flash}} = 1.0$, $S_{\text{phantom}} \ge 0.85$, regime `CRITICAL_PHANTOM_LIQUIDITY_TRAP`, and effective depth $< 20\%$.
3. `test_mild_phantom_noise`: Confirms intermediate activity falls cleanly into `(0.25, 0.80]` range.
4. `test_side_filtering_bid_vs_ask`: Verifies that a massive BID spoof does not alter the clean rating of the ASK side.
5. `test_sqlite_persistence`: Validates SQLite telemetry recording and queryability.

**Execution Result on Oracle Cloud VPS:**
```
tests/test_l2_cancellation_spoofing_sieve.py ..... [100%]
5 passed in 0.04s
```
