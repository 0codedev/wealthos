r"""Multi-Exchange Cross-Asset Basis Arbitrage & Triangular Hedging Engine (Domain 207 / WP-DE)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Continuous cost-of-carry calendar basis valuation and cash-and-carry mispricing sieve.
2. Perpetual swap funding rate carry harvest model and APR yield projection.
3. Multi-venue triangular synthetic parity loop discovery with complete transaction friction.
4. Cross-venue collateral margin call buffer governor and dynamic rebalancing alerts.
5. Tactical execution directives: Cash-and-carry lock, funding carry, and triangular cycle capture.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class BasisArbitrageType(Enum):
    """Type of cross-market basis / triangular opportunity."""
    CASH_AND_CARRY = "CASH_AND_CARRY"                   # Buy Spot, Sell Overpriced Futures
    REVERSE_CASH_AND_CARRY = "REVERSE_CASH_AND_CARRY"   # Sell Spot, Buy Underpriced Futures
    PERP_FUNDING_HARVEST = "PERP_FUNDING_HARVEST"       # Delta-neutral funding yield collection
    TRIANGULAR_SYNTHETIC_LOOP = "TRIANGULAR_SYNTHETIC_LOOP" # Three-legged cross-rate dislocation
    NO_ARBITRAGE_EQUILIBRIUM = "NO_ARBITRAGE_EQUILIBRIUM" # Basis within fair cost-of-carry band


class MarginRiskState(Enum):
    """Collateral buffer health on leveraged short leg."""
    SAFE_BUFFER = "SAFE_BUFFER"               # Buffer > 2.0x maintenance margin
    ELEVATED_MARGIN_WATCH = "ELEVATED_MARGIN_WATCH" # 1.3x <= Buffer <= 2.0x
    CRITICAL_MARGIN_CALL = "CRITICAL_MARGIN_CALL"   # Buffer < 1.3x (deleveraging required)


@dataclass
class CashAndCarryBasisResult:
    """Cash-and-carry forward basis diagnostics."""
    underlying: str
    spot_price: float
    futures_price: float
    days_to_expiry: float
    annualized_basis_pct: float
    fair_basis_pct: float
    net_spread_bps: float
    annualized_net_apr_pct: float
    is_actionable: bool


@dataclass
class TriangularLoopResult:
    """Three-legged currency/asset arbitrage cycle."""
    pair_ab: str
    pair_bc: str
    pair_ac: str
    rate_ab: float
    rate_bc: float
    rate_ac: float
    implied_synthetic_rate: float
    gross_dislocation_bps: float
    net_profit_bps: float
    total_fee_cost_bps: float
    is_actionable: bool


@dataclass
class MultiAssetBasisAnalysisReport:
    """Consolidated basis arbitrage and collateral safety report."""
    primary_arbitrage_type: BasisArbitrageType
    cash_and_carry_opportunity: Optional[CashAndCarryBasisResult]
    triangular_opportunity: Optional[TriangularLoopResult]
    perp_funding_annualized_apr: float
    collateral_margin_buffer_ratio: float
    margin_risk_state: MarginRiskState
    tactical_directive: str


class BasisArbitrageTriangularHedgingEngine:
    r"""Multi-Exchange Cross-Asset Basis Arbitrage & Triangular Hedging Engine.
    
    Mathematical Foundations:
    1. Theoretical Futures Basis:
       F^*(t, T) = S_t \cdot \exp((r - q)(T - t))
       \text{Basis}_{ann} = \frac{F - S}{S} \cdot \frac{365}{\text{days}}
    2. Triangular Synthetic Parity:
       \text{Synthetic Rate}_{AC} = P_{AB} \cdot P_{BC}
       \text{NetEdge}_{bps} = \left(\frac{P_{AB} \cdot P_{BC}}{P_{AC}} - 1\right) \cdot 10000 - \sum \text{fees}_{bps}
    3. Collateral Margin Buffer Ratio:
       \mathcal{R}_{margin} = \frac{\text{Equity}_{margin}}{\text{MaintenanceMarginRequirement}}
    """

    def __init__(
        self,
        borrowing_rate_pct: float = 6.50,
        lending_rate_pct: float = 5.00,
        min_basis_edge_bps: float = 30.0,
        min_triangular_edge_bps: float = 2.0,
        default_taker_fee_bps: float = 1.5,
    ) -> None:
        self.borrowing_rate_pct = borrowing_rate_pct
        self.lending_rate_pct = lending_rate_pct
        self.min_basis_edge_bps = min_basis_edge_bps
        self.min_triangular_edge_bps = min_triangular_edge_bps
        self.default_taker_fee_bps = default_taker_fee_bps

    def evaluate_cash_and_carry_basis(
        self,
        symbol: str,
        spot_price: float,
        futures_price: float,
        days_to_expiry: float,
        dividend_yield_pct: float = 1.20,
        roundtrip_friction_bps: float = 5.0,
    ) -> CashAndCarryBasisResult:
        r"""Compute annualized basis, fair cost-of-carry, and net carry APR."""
        if days_to_expiry <= 0:
            raise ValueError("days_to_expiry must be positive")

        tau_years = days_to_expiry / 365.0
        # Annualized observed basis
        ann_basis_pct = ((futures_price - spot_price) / spot_price) * (1.0 / tau_years) * 100.0

        # Fair basis: r - q
        fair_basis_pct = self.borrowing_rate_pct - dividend_yield_pct

        # Net spread in basis points
        spread_pct = ann_basis_pct - fair_basis_pct
        net_spread_bps = (spread_pct * 100.0) - (roundtrip_friction_bps / tau_years)

        # Annualized net return
        net_apr = ann_basis_pct - self.borrowing_rate_pct - (roundtrip_friction_bps / 100.0 / tau_years)

        is_actionable = net_spread_bps >= self.min_basis_edge_bps

        return CashAndCarryBasisResult(
            underlying=symbol,
            spot_price=spot_price,
            futures_price=futures_price,
            days_to_expiry=round(days_to_expiry, 2),
            annualized_basis_pct=round(ann_basis_pct, 3),
            fair_basis_pct=round(fair_basis_pct, 3),
            net_spread_bps=round(net_spread_bps, 2),
            annualized_net_apr_pct=round(net_apr, 3),
            is_actionable=is_actionable,
        )

    def evaluate_triangular_synthetic_loop(
        self,
        pair_ab: str,
        pair_bc: str,
        pair_ac: str,
        rate_ab: float,
        rate_bc: float,
        rate_ac: float,
        fee_ab_bps: Optional[float] = None,
        fee_bc_bps: Optional[float] = None,
        fee_ac_bps: Optional[float] = None,
    ) -> TriangularLoopResult:
        r"""Analyze synthetic cross-rate loop: AB * BC vs direct AC."""
        fee_1 = fee_ab_bps if fee_ab_bps is not None else self.default_taker_fee_bps
        fee_2 = fee_bc_bps if fee_bc_bps is not None else self.default_taker_fee_bps
        fee_3 = fee_ac_bps if fee_ac_bps is not None else self.default_taker_fee_bps
        tot_fee_bps = fee_1 + fee_2 + fee_3

        synthetic_ac = rate_ab * rate_bc
        # Dislocation bps
        gross_bps = ((synthetic_ac - rate_ac) / rate_ac) * 10000.0
        net_bps = abs(gross_bps) - tot_fee_bps
        is_actionable = net_bps >= self.min_triangular_edge_bps

        return TriangularLoopResult(
            pair_ab=pair_ab,
            pair_bc=pair_bc,
            pair_ac=pair_ac,
            rate_ab=rate_ab,
            rate_bc=rate_bc,
            rate_ac=rate_ac,
            implied_synthetic_rate=round(synthetic_ac, 5),
            gross_dislocation_bps=round(gross_bps, 3),
            net_profit_bps=round(net_bps, 3),
            total_fee_cost_bps=round(tot_fee_bps, 2),
            is_actionable=is_actionable,
        )

    def analyze_multi_asset_basis(
        self,
        cnc_candidate: Optional[Tuple[str, float, float, float]] = None, # (symbol, spot, futures, days)
        triangular_candidate: Optional[Tuple[str, str, str, float, float, float]] = None,
        perp_funding_8h_rate: float = 0.0003, # 0.03% per 8 hours = ~32.8% APR
        margin_equity: float = 250_000.0,
        maint_margin_req: float = 100_000.0,
    ) -> MultiAssetBasisAnalysisReport:
        """Run comprehensive basis, carry, and triangular arbitrage diagnostic."""
        # 1. Cash and Carry
        cnc_res: Optional[CashAndCarryBasisResult] = None
        if cnc_candidate:
            sym, sp, fp, d = cnc_candidate
            cnc_res = self.evaluate_cash_and_carry_basis(sym, sp, fp, d)

        # 2. Triangular Loop
        tri_res: Optional[TriangularLoopResult] = None
        if triangular_candidate:
            p_ab, p_bc, p_ac, r_ab, r_bc, r_ac = triangular_candidate
            tri_res = self.evaluate_triangular_synthetic_loop(p_ab, p_bc, p_ac, r_ab, r_bc, r_ac)

        # 3. Perp Funding APR
        funding_apr = perp_funding_8h_rate * 3.0 * 365.0 * 100.0

        # 4. Collateral Margin Buffer
        safe_maint = max(maint_margin_req, 1.0)
        buffer_ratio = margin_equity / safe_maint

        if buffer_ratio < 1.30:
            margin_state = MarginRiskState.CRITICAL_MARGIN_CALL
        elif buffer_ratio <= 2.00:
            margin_state = MarginRiskState.ELEVATED_MARGIN_WATCH
        else:
            margin_state = MarginRiskState.SAFE_BUFFER

        # 5. Primary Arbitrage Classification & Directives
        if margin_state == MarginRiskState.CRITICAL_MARGIN_CALL:
            arb_type = BasisArbitrageType.NO_ARBITRAGE_EQUILIBRIUM
            directive = (
                f"EMERGENCY MARGIN DEFENSE: Collateral buffer critical ({buffer_ratio:.2f}x < 1.30x). "
                "Halt new arbitrage positions; execute auto-deleveraging rebalance to protect short leg."
            )
        elif cnc_res and cnc_res.is_actionable and cnc_res.net_spread_bps > 0:
            arb_type = BasisArbitrageType.CASH_AND_CARRY
            directive = (
                f"ACTIONABLE CASH-AND-CARRY: {cnc_res.underlying} annualized basis={cnc_res.annualized_basis_pct:.2f}% "
                f"(Net Edge={cnc_res.net_spread_bps:.0f} bps, APR={cnc_res.annualized_net_apr_pct:.2f}%). "
                "Buy Spot, Sell Futures; lock risk-free convergence carry."
            )
        elif tri_res and tri_res.is_actionable:
            arb_type = BasisArbitrageType.TRIANGULAR_SYNTHETIC_LOOP
            directive = (
                f"ACTIONABLE TRIANGULAR ARBITRAGE: Loop {tri_res.pair_ab} * {tri_res.pair_bc} vs {tri_res.pair_ac} "
                f"(Net Profit={tri_res.net_profit_bps:.1f} bps). Execute 3-leg simultaneous synthetic cycle."
            )
        elif funding_apr > 12.0:
            arb_type = BasisArbitrageType.PERP_FUNDING_HARVEST
            directive = (
                f"PERPETUAL FUNDING RATE CARRY: Elevated funding yield ({funding_apr:.1f}% APR). "
                "Establish delta-neutral Long Spot / Short Perp position to harvest 8-hour payments."
            )
        else:
            arb_type = BasisArbitrageType.NO_ARBITRAGE_EQUILIBRIUM
            directive = "Basis within normal cost-of-carry band. Monitor cross-venue funding rates."

        return MultiAssetBasisAnalysisReport(
            primary_arbitrage_type=arb_type,
            cash_and_carry_opportunity=cnc_res,
            triangular_opportunity=tri_res,
            perp_funding_annualized_apr=round(funding_apr, 2),
            collateral_margin_buffer_ratio=round(buffer_ratio, 3),
            margin_risk_state=margin_state,
            tactical_directive=directive,
        )
