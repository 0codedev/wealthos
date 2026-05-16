# DOMAIN 260: Cross-Exchange Crypto Collateralized Debt Position Liquidation Waterfall & MEV Sentry
**Work Package ID:** WP-FF  
**Author:** Sovereign Swarm Intelligence (Space-Bunny / OpenCode Supercomputing Cluster)  
**Execution Target:** WealthOS v2 Quantitative Microstructure Layer  
**Status:** PRODUCTION READY (100% Passing Tests, Fully Deployed on Oracle Cloud VPS)

---

## 1. Executive Summary & Market Microstructure

In decentralized finance (DeFi money markets such as Aave, Compound, MakerDAO, and Morpho) and CeFi institutional prime brokerages, leverage is extended via **Collateralized Debt Positions (CDPs)**. A vault's solvency is governed in real time by its **Health Factor ($HF$)**:
$$HF = \frac{\sum_i C_i \cdot P_i \cdot LT_i}{\sum_j D_j \cdot P_j}$$
where $C_i$ is deposited collateral, $P_i$ is the decentralized oracle price (e.g. Chainlink / Pyth), $LT_i$ is the liquidation threshold (e.g. $82\%$), and $D_j$ is borrowed stablecoin debt.

When market sell-offs depress collateral prices, $HF$ decays toward $1.00$. When $HF < 1.00$, the vault enters liquidation, initiating two critical market dynamics:
1. **The Liquidation Waterfall & DEX Air-Pocket Drop**: Liquidators repay up to $50\%$ of the borrowed debt (Close Factor) and seize collateral at a liquidation bonus discount (typically $5\% - 10\%$). To lock in riskless profit, liquidators immediately swap the seized collateral on automated market makers (Uniswap v3, Curve), inflicting severe price impact and cascade slippage across on-chain pools and centralized order books.
2. **Maximal Extractable Value (MEV) Priority Gas Auctions (PGA)**: Competing liquidator searchers broadcast atomic Flashbots / builder bundles, bidding up to $85\%$ of the liquidation bonus as priority fees to validators to ensure their liquidation transaction executes at the top of the block.
3. **The Sentry Solution**: By tracking on-chain vault health factors and calculating exact liquidation prices $P_{\text{liq}}$, the sentry warns market makers to pull resting bids ahead of the liquidation air-pocket drop, while simultaneously evaluating MEV liquidation bundle profitability to capture risk-free liquidation arbitrage.

---

## 2. Rigorous Mathematical Formulation

### 2.1 Exact Analytical Liquidation Price Boundary
For a single collateral vault with deposited units $C$, borrowed debt $D$ in USD, and liquidation threshold $LT$:
$$P_{\text{liq}} = \frac{D}{C \cdot LT}$$
The percentage distance to liquidation from current oracle price $P_{\text{current}}$ is:
$$\Delta_{\text{liq}} = \frac{P_{\text{current}} - P_{\text{liq}}}{P_{\text{current}}} \times 100\%$$

### 2.2 Secondary Market Cascade Slippage
When multiple underwater vaults breach $HF < 1.05$, the cumulative collateral volume liquidated:
$$V_{\text{cascade}} = \sum_{k: HF_k < 1.05} C_k \cdot \text{CloseFactor}_k$$
Under constant-product or concentrated liquidity depth $L_{\text{DEX}}$:
$$\text{Slip}_{\text{cascade}} = \gamma \cdot \frac{V_{\text{cascade}} \cdot P_{\text{current}}}{L_{\text{DEX}}} \times 10{,}000\text{ bps}$$

Resting market maker quotes within $\text{Slip}_{\text{cascade}}$ of $P_{\text{liq}}$ face instantaneous adverse selection and must be evacuated.

### 2.3 MEV Liquidation Searcher Economics
For debt repayable $D_{\text{repay}} = D \cdot \text{CloseFactor}$ and liquidation bonus $\beta_{\text{bonus}}$:
$$\Pi_{\text{gross}} = D_{\text{repay}} \cdot \beta_{\text{bonus}}$$

The optimal MEV bribe paid to block builders via coinbase transfer:
$$B_{\text{builder}} = \Pi_{\text{gross}} \cdot \min(\phi_{\max}, \phi_{\text{bribe}})$$
The net risk-free MEV capture:
$$\Pi_{\text{net}} = \Pi_{\text{gross}} - B_{\text{builder}} - \text{GasCost}$$

---

## 3. Decision Matrix & Action Directives

| Health Factor ($HF$) | Distance ($\Delta_{\text{liq}}$) | Liquidation Directive | Strategy State |
| :--- | :--- | :--- | :--- |
| $HF \le 1.00$ | $\le 0\%$ | `DISPATCH_MEV_LIQUIDATION_BUNDLE` | `ACTIVE_LIQUIDATION_AUCTION` |
| $1.00 < HF \le 1.05$ | $\le 5\%$ | `EVACUATE_BIDS_ANTICIPATE_DUMP` | `SUPERCRITICAL_WATERFALL_IMMINENT` |
| $1.05 < HF \le 1.30$ | $5\% - 20\%$ | `PREPARE_CASCADE_DEFENSE` | `ELEVATED_CASCADE_VULNERABILITY` |
| $HF > 1.30$ | $> 20\%$ | `MONITOR_PASSIVE_DEBT` | `NOMINAL_COLLATERAL_HEALTH` |

---

## 4. Python Implementation Details

The production implementation is encapsulated in:
`python-bridge/services/cdp_liquidation_waterfall_sentry.py`

Key components:
- `CDPVaultSnapshot`: Struct tracking vault ID, collateral and debt assets, collateral quantity, debt in USD, current price, liquidation threshold, bonus %, and pool depth.
- `CDPLiquidationAssessment`: Comprehensive assessment reporting health factor, exact liquidation price, percentage distance to liquidation, secondary market cascade slippage (bps), gross liquidation bonus, net MEV profit, regime classification, and action directive.
- `CDPLiquidationWaterfallSentry`: Microsecond on-chain risk calculator simulating cascade dynamics and MEV bundle economics.

---

## 5. Verification & Testing

Unit test suite resides in:
`python-bridge/tests/test_cdp_liquidation_waterfall_sentry.py`

Test coverage verifies:
1. `test_nominal_collateral_health`: Validates well-collateralized vault ($HF = 2.00$) maintaining passive monitoring.
2. `test_elevated_cascade_vulnerability`: Confirms transition to cascade defense when health factor nears warning zone ($HF = 1.066$).
3. `test_supercritical_waterfall_imminent`: Verifies bid evacuation directive when collateral price is within $< 5\%$ of liquidation threshold.
4. `test_active_liquidation_auction`: Validates MEV liquidation bundle dispatch with net profit calculation when vault breaches $HF \le 1.00$.
