"""
Cross-Venue Foreign Exchange Tri-Currency Convexity & Covered Interest Parity Basis Sentry
Domain 258 / Work Package WP-FD

Computes Covered Interest Rate Parity (CIP) cross-currency basis deviations,
evaluates triangular spot-forward cross-rate convexity discrepancies across electronic FX venues,
and identifies institutional synthetic dollar lending and forward roll arbitrage opportunities.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class FXArbitrageRegime(str, Enum):
    NOMINAL_CIP_EQUILIBRIUM = "NOMINAL_CIP_EQUILIBRIUM"                  # Basis within normal regulatory buffer (|x| < 8 bps)
    CIP_BASIS_ARBITRAGE_ACTIVE = "CIP_BASIS_ARBITRAGE_ACTIVE"            # Clean CIP basis dislocation (|x| >= 12 bps), net edge positive
    TRIANGULAR_CROSS_DISLOCATION = "TRIANGULAR_CROSS_DISLOCATION"        # Cross discrepancy >= 4 bps, execute pure synthetic cross
    EXTREME_DOLLAR_LIQUIDITY_SQUEEZE = "EXTREME_DOLLAR_LIQUIDITY_SQUEEZE"# Basis <= -80 bps (severe systemic USD funding crunch)


class FXTradingDirective(str, Enum):
    MONITOR_EQUILIBRIUM = "MONITOR_EQUILIBRIUM"                          # Passive monitoring, no trade
    EXECUTE_COVERED_SYNTHETIC_CARRY = "EXECUTE_COVERED_SYNTHETIC_CARRY"  # Lend USD via FX swap / borrow in cash to lock locked basis
    EXECUTE_TRIANGULAR_CROSS_ARB = "EXECUTE_TRIANGULAR_CROSS_ARB"        # Route 3-way synthetic triangular FX fill
    TRIGGER_COLLATERAL_DEFENSE = "TRIGGER_COLLATERAL_DEFENSE"            # Squeeze in progress, defend margin collateral


@dataclass
class CIPTelemetrySnapshot:
    currency_pair: str                 # e.g. "EUR/USD"
    spot_rate: float                   # S (EUR per USD or USD per EUR)
    forward_rate: float                # F
    domestic_rate: float               # r_d (e.g. USD SOFR)
    foreign_rate: float                # r_f (e.g. EUR ESTR)
    tenor_years: float = 0.25          # tau (e.g. 3M = 0.25)
    cross_triangular_discrepancy_bps: float = 0.0 # Delta_cross in bps
    execution_friction_bps: float = 2.5 # Combined bid/ask swap points and clearing fees


@dataclass
class FXArbAssessment:
    currency_pair: str
    implied_cip_basis_bps: float
    triangular_discrepancy_bps: float
    net_annualized_edge_bps: float
    regime: FXArbitrageRegime
    directive: FXTradingDirective
    rationales: List[str] = field(default_factory=list)


class FXCIPBasisSentry:
    """
    Sub-millisecond FX swap basis calculator and triangular cross-currency arbitrator.
    """

    def __init__(
        self,
        min_arb_edge_bps: float = 8.0,
        dollar_squeeze_threshold_bps: float = -80.0,
    ):
        self.min_arb_edge_bps = min_arb_edge_bps
        self.dollar_squeeze_threshold_bps = dollar_squeeze_threshold_bps

    def calculate_cip_basis(
        self, spot: float, forward: float, r_d: float, r_f: float, tau: float
    ) -> float:
        """
        Solves for cross-currency basis x_CIP:
        F = S * (1 + r_d * tau) / (1 + (r_f + x) * tau)
        => 1 + (r_f + x) * tau = (S / F) * (1 + r_d * tau)
        => x_CIP = (1 / tau) * [ (S / F) * (1 + r_d * tau) - 1 ] - r_f
        Returns x_CIP in basis points (1 bp = 0.0001).
        """
        if forward <= 0.0 or spot <= 0.0 or tau <= 0.001:
            return 0.0

        ratio = (spot / forward) * (1.0 + r_d * tau)
        x_annual = ((ratio - 1.0) / tau) - r_f
        return x_annual * 10000.0

    def evaluate(self, snapshot: CIPTelemetrySnapshot) -> FXArbAssessment:
        rationales: List[str] = []

        basis_bps = self.calculate_cip_basis(
            snapshot.spot_rate,
            snapshot.forward_rate,
            snapshot.domestic_rate,
            snapshot.foreign_rate,
            snapshot.tenor_years,
        )

        cross_bps = snapshot.cross_triangular_discrepancy_bps
        friction = snapshot.execution_friction_bps

        # Net edge calculation
        gross_edge = max(abs(basis_bps), abs(cross_bps))
        net_edge = max(0.0, gross_edge - friction)

        # 1. Extreme Dollar Squeeze Circuit Check
        if basis_bps <= self.dollar_squeeze_threshold_bps:
            regime = FXArbitrageRegime.EXTREME_DOLLAR_LIQUIDITY_SQUEEZE
            directive = FXTradingDirective.TRIGGER_COLLATERAL_DEFENSE
            rationales.append(
                f"Severe systemic dollar funding crunch on {snapshot.currency_pair}: "
                f"CIP basis={basis_bps:.1f} bps <= {self.dollar_squeeze_threshold_bps:.1f} bps. "
                f"Defend USD cash buffers and collateral margins."
            )

        # 2. Pure Triangular Cross Dislocation
        elif abs(cross_bps) >= 4.0 and abs(cross_bps) > abs(basis_bps):
            regime = FXArbitrageRegime.TRIANGULAR_CROSS_DISLOCATION
            directive = FXTradingDirective.EXECUTE_TRIANGULAR_CROSS_ARB
            rationales.append(
                f"Triangular cross-rate discrepancy on {snapshot.currency_pair}: "
                f"Discrepancy={cross_bps:.1f} bps > 4.0 bps hurdle. Net edge={net_edge:.1f} bps."
            )

        # 3. Actionable CIP Basis Arbitrage
        elif abs(basis_bps) >= 12.0 and net_edge >= self.min_arb_edge_bps:
            regime = FXArbitrageRegime.CIP_BASIS_ARBITRAGE_ACTIVE
            directive = FXTradingDirective.EXECUTE_COVERED_SYNTHETIC_CARRY
            direction_str = "Negative basis (USD borrower premium)" if basis_bps < 0 else "Positive basis"
            rationales.append(
                f"Actionable CIP basis dislocation on {snapshot.currency_pair} ({direction_str}): "
                f"Basis={basis_bps:.1f} bps. Net annualized edge={net_edge:.1f} bps exceeds {self.min_arb_edge_bps:.1f} bps hurdle."
            )

        # 4. Nominal Equilibrium
        else:
            regime = FXArbitrageRegime.NOMINAL_CIP_EQUILIBRIUM
            directive = FXTradingDirective.MONITOR_EQUILIBRIUM
            rationales.append(
                f"CIP equilibrium maintained on {snapshot.currency_pair}: "
                f"Basis={basis_bps:.1f} bps within normal regulatory band. Net edge={net_edge:.1f} bps insufficient."
            )

        return FXArbAssessment(
            currency_pair=snapshot.currency_pair,
            implied_cip_basis_bps=round(basis_bps, 2),
            triangular_discrepancy_bps=round(cross_bps, 2),
            net_annualized_edge_bps=round(net_edge, 2),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
