"""
Cross-Exchange Crypto Perpetual-Spot Basis & Cointegrated Funding Rate Arb Engine
Domain 249 / Work Package WP-EU

Computes perpetual-spot basis cointegration residuals, 8-hour funding rate yields,
Ornstein-Uhlenbeck mean-reversion expectations, and dispatches capital-efficient
cash-and-carry vs reverse carry arbitrage allocations under strict borrowing hurdles.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class ArbExecutionRegime(str, Enum):
    CASH_AND_CARRY_LONG_SPOT_SHORT_PERP = "CASH_AND_CARRY_LONG_SPOT_SHORT_PERP"  # Perp > Spot + positive funding (long spot, short perp)
    REVERSE_CASH_AND_CARRY_SHORT_SPOT_LONG_PERP = "REVERSE_CASH_AND_CARRY_SHORT_SPOT_LONG_PERP"  # Spot > Perp + negative funding
    NEUTRAL_EQUILIBRIUM = "NEUTRAL_EQUILIBRIUM"                                  # Spread within noise band, no profitable edge
    EMERGENCY_DEPEG_UNWIND = "EMERGENCY_DEPEG_UNWIND"                            # Structural dislocation breach (|z| >= 4.0), stop and unwind


class FundingActionDirective(str, Enum):
    DEPLOY_BASIS_CARRY_LEG = "DEPLOY_BASIS_CARRY_LEG"            # Enter basis carry position
    UNWIND_CONVERGENCE_TARGET = "UNWIND_CONVERGENCE_TARGET"      # Target reached, unwind legs
    HOLD_PASSIVE_CARRY = "HOLD_PASSIVE_CARRY"                    # Carry running, accrue yield
    EMERGENCY_CIRCUIT_ABORT = "EMERGENCY_CIRCUIT_ABORT"          # Depeg / liquidation cascade, abort immediately


@dataclass
class PerpSpotMarketState:
    symbol: str
    perp_venue: str
    spot_venue: str
    perp_price: float
    spot_price: float
    funding_rate_8h: float                # 8-hour rate (e.g. 0.0003 = +3 bps per 8h)
    hours_to_funding: float               # Remaining hours to settlement
    annualized_borrow_rate: float         # Financing cost APR (e.g. 0.05 = 5%)
    historical_basis_mean_bps: float      # Rolling mean basis in bps
    historical_basis_std_bps: float       # Rolling basis volatility in bps
    cointegration_beta: float = 1.0       # Cointegrating vector (1, -beta)
    mean_reversion_half_life_hours: float = 12.0
    active_position_regime: Optional[ArbExecutionRegime] = None


@dataclass
class BasisArbAssessment:
    symbol: str
    basis_bps: float
    cointegrated_residual_bps: float
    basis_z_score: float
    annualized_funding_yield_pct: float
    net_annualized_edge_pct: float
    regime: ArbExecutionRegime
    directive: FundingActionDirective
    target_hedge_ratio: float
    capital_allocation_pct: float
    rationales: List[str] = field(default_factory=list)


class PerpSpotBasisFundingArbEngine:
    """
    Quantitative cross-venue perpetual-spot basis arbitrage and funding rate yield harvester.
    """

    def __init__(
        self,
        z_entry_threshold: float = 1.75,          # Require 1.75 standard deviations basis dislocation
        z_exit_threshold: float = 0.35,           # Unwind when basis reverts to 0.35 std
        z_emergency_threshold: float = 4.0,       # Emergency break at 4.0 std (structural break)
        min_net_yield_hurdle_pct: float = 8.0,    # Minimum 8% annualized net edge required
        round_trip_fee_bps: float = 10.0,         # Combined maker/taker spot + perp fee
    ):
        self.z_entry_threshold = z_entry_threshold
        self.z_exit_threshold = z_exit_threshold
        self.z_emergency_threshold = z_emergency_threshold
        self.min_net_yield_hurdle_pct = min_net_yield_hurdle_pct
        self.round_trip_fee_bps = round_trip_fee_bps

    def calculate_basis_bps(self, perp_price: float, spot_price: float) -> float:
        """Computes raw percentage basis in basis points: ((Perp - Spot) / Spot) * 10,000"""
        if spot_price <= 0.0:
            return 0.0
        return ((perp_price - spot_price) / spot_price) * 10000.0

    def calculate_cointegration_residual_bps(
        self, perp_price: float, spot_price: float, beta: float
    ) -> float:
        """
        Computes cointegrating regression residual:
        epsilon_t = ln(P_perp) - beta * ln(P_spot) in basis points.
        """
        if perp_price <= 0.0 or spot_price <= 0.0:
            return 0.0
        log_perp = math.log(perp_price)
        log_spot = math.log(spot_price)
        residual = log_perp - (beta * log_spot)
        return residual * 10000.0

    def annualize_funding_rate(self, funding_8h: float) -> float:
        """
        Annualizes 8-hour funding rate (3 payments per day * 365 days):
        F_ann = F_8h * 1095 * 100%
        """
        return funding_8h * 3.0 * 365.0 * 100.0

    def evaluate(self, state: PerpSpotMarketState) -> BasisArbAssessment:
        rationales: List[str] = []

        # 1. Microstructure metric calculation
        basis_bps = self.calculate_basis_bps(state.perp_price, state.spot_price)
        residual_bps = self.calculate_cointegration_residual_bps(
            state.perp_price, state.spot_price, state.cointegration_beta
        )

        std_bps = max(1.0, state.historical_basis_std_bps)
        basis_z = (basis_bps - state.historical_basis_mean_bps) / std_bps

        # Annualized funding yield from perpetual holder's perspective
        # If long perp pays short perp (positive funding), short perp receives +F_ann
        f_ann = self.annualize_funding_rate(state.funding_rate_8h)

        # 2. Emergency Structural Dislocation Check
        if abs(basis_z) >= self.z_emergency_threshold:
            rationales.append(
                f"Emergency basis dislocation detected: z-score={basis_z:.2f} >= {self.z_emergency_threshold}. "
                f"Likely liquidation cascade or venue depeg. Triggering immediate defensive unwind."
            )
            return BasisArbAssessment(
                symbol=state.symbol,
                basis_bps=round(basis_bps, 2),
                cointegrated_residual_bps=round(residual_bps, 2),
                basis_z_score=round(basis_z, 2),
                annualized_funding_yield_pct=round(f_ann, 2),
                net_annualized_edge_pct=0.0,
                regime=ArbExecutionRegime.EMERGENCY_DEPEG_UNWIND,
                directive=FundingActionDirective.EMERGENCY_CIRCUIT_ABORT,
                target_hedge_ratio=0.0,
                capital_allocation_pct=0.0,
                rationales=rationales,
            )

        # 3. Position Unwind Check (if active position exists)
        if state.active_position_regime is not None:
            if abs(basis_z) <= self.z_exit_threshold:
                rationales.append(
                    f"Basis convergence achieved: |z|={abs(basis_z):.2f} <= {self.z_exit_threshold}. "
                    f"Unwinding arbitrage legs to lock in basis mean-reversion profit."
                )
                return BasisArbAssessment(
                    symbol=state.symbol,
                    basis_bps=round(basis_bps, 2),
                    cointegrated_residual_bps=round(residual_bps, 2),
                    basis_z_score=round(basis_z, 2),
                    annualized_funding_yield_pct=round(f_ann, 2),
                    net_annualized_edge_pct=0.0,
                    regime=ArbExecutionRegime.NEUTRAL_EQUILIBRIUM,
                    directive=FundingActionDirective.UNWIND_CONVERGENCE_TARGET,
                    target_hedge_ratio=0.0,
                    capital_allocation_pct=0.0,
                    rationales=rationales,
                )
            else:
                rationales.append(
                    f"Holding active carry regime {state.active_position_regime.value}. "
                    f"Current basis z={basis_z:.2f}, funding yield={f_ann:.1f}% APR."
                )
                return BasisArbAssessment(
                    symbol=state.symbol,
                    basis_bps=round(basis_bps, 2),
                    cointegrated_residual_bps=round(residual_bps, 2),
                    basis_z_score=round(basis_z, 2),
                    annualized_funding_yield_pct=round(f_ann, 2),
                    net_annualized_edge_pct=round(abs(f_ann) - (state.annualized_borrow_rate * 100.0), 2),
                    regime=state.active_position_regime,
                    directive=FundingActionDirective.HOLD_PASSIVE_CARRY,
                    target_hedge_ratio=round(state.cointegration_beta, 4),
                    capital_allocation_pct=100.0,
                    rationales=rationales,
                )

        # 4. Entry Opportunity Evaluation
        # Case A: Positive Basis Carry (Long Spot, Short Perp)
        # We short perp (earning +F_ann when funding is positive) and buy spot (paying borrow rate if on margin)
        # Expected annualized basis convergence yield over half-life:
        # half_life_periods_per_year = (365 * 24) / half_life_hours
        annual_reversion_cycles = (365.0 * 24.0) / max(1.0, state.mean_reversion_half_life_hours)
        expected_basis_annual_pct = (basis_bps / 100.0) * (annual_reversion_cycles / 2.0)

        # Long Spot / Short Perp net edge:
        # Earning funding (+f_ann) + expected basis narrowing - borrow cost - amortized transaction fees
        fee_drag_pct = (self.round_trip_fee_bps / 100.0) * annual_reversion_cycles
        net_carry_long_spot_edge = (
            f_ann
            + expected_basis_annual_pct
            - (state.annualized_borrow_rate * 100.0)
            - fee_drag_pct
        )

        # Case B: Negative Basis Carry (Reverse Cash & Carry: Short Spot, Long Perp)
        # We long perp (earning -f_ann when funding is negative, i.e. shorts pay longs)
        # Earning basis expansion / reversion + negative funding capture - short borrow cost - fees
        net_carry_short_spot_edge = (
            -f_ann
            - expected_basis_annual_pct
            - (state.annualized_borrow_rate * 100.0)
            - fee_drag_pct
        )

        # Decision Logic:
        if (
            basis_z >= self.z_entry_threshold
            and f_ann > 0.0
            and net_carry_long_spot_edge >= self.min_net_yield_hurdle_pct
        ):
            regime = ArbExecutionRegime.CASH_AND_CARRY_LONG_SPOT_SHORT_PERP
            directive = FundingActionDirective.DEPLOY_BASIS_CARRY_LEG
            edge = net_carry_long_spot_edge
            alloc = min(100.0, max(25.0, 50.0 + (basis_z - self.z_entry_threshold) * 20.0))
            rationales.append(
                f"Long Spot / Short Perp signal: Basis z={basis_z:.2f} >= {self.z_entry_threshold}, "
                f"Funding={f_ann:.1f}% APR. Net annual edge={edge:.1f}% exceeds {self.min_net_yield_hurdle_pct}% hurdle."
            )

        elif (
            basis_z <= -self.z_entry_threshold
            and f_ann < 0.0
            and net_carry_short_spot_edge >= self.min_net_yield_hurdle_pct
        ):
            regime = ArbExecutionRegime.REVERSE_CASH_AND_CARRY_SHORT_SPOT_LONG_PERP
            directive = FundingActionDirective.DEPLOY_BASIS_CARRY_LEG
            edge = net_carry_short_spot_edge
            alloc = min(100.0, max(25.0, 50.0 + (abs(basis_z) - self.z_entry_threshold) * 20.0))
            rationales.append(
                f"Reverse Cash & Carry signal: Basis z={basis_z:.2f} <= -{self.z_entry_threshold}, "
                f"Negative funding={f_ann:.1f}% APR. Net annual edge={edge:.1f}% exceeds {self.min_net_yield_hurdle_pct}% hurdle."
            )

        else:
            regime = ArbExecutionRegime.NEUTRAL_EQUILIBRIUM
            directive = FundingActionDirective.HOLD_PASSIVE_CARRY
            edge = max(0.0, max(net_carry_long_spot_edge, net_carry_short_spot_edge))
            alloc = 0.0
            rationales.append(
                f"Equilibrium state: Basis z={basis_z:.2f}, Funding={f_ann:.1f}%. "
                f"Net edge does not satisfy entry hurdle ({self.min_net_yield_hurdle_pct}% APR)."
            )

        return BasisArbAssessment(
            symbol=state.symbol,
            basis_bps=round(basis_bps, 2),
            cointegrated_residual_bps=round(residual_bps, 2),
            basis_z_score=round(basis_z, 2),
            annualized_funding_yield_pct=round(f_ann, 2),
            net_annualized_edge_pct=round(edge, 2),
            regime=regime,
            directive=directive,
            target_hedge_ratio=round(state.cointegration_beta, 4),
            capital_allocation_pct=round(alloc, 2),
            rationales=rationales,
        )
