"""
Multi-Exchange Continuous Basis Roll Calendar Arbitrage & Funding Curve Interpolator
Domain 264 / Work Package WP-FJ

Interpolates continuous annualized basis yield curves across perpetual and quarterly futures tenors,
identifies roll calendar spread dislocations and butterfly term-structure curvatures,
and dispatches multi-legged delta-neutral basis convergence arbitrage.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class BasisTermStructureRegime(str, Enum):
    SMOOTH_TERM_STRUCTURE_EQUILIBRIUM = "SMOOTH_TERM_STRUCTURE_EQUILIBRIUM"  # Smooth contango/backwardation, spread < 6%
    ACTIONABLE_CALENDAR_ROLL_SPREAD = "ACTIONABLE_CALENDAR_ROLL_SPREAD"      # Roll spread >= 6%, execute 2-legged calendar arb
    BUTTERFLY_CURVATURE_ARBITRAGE = "BUTTERFLY_CURVATURE_ARBITRAGE"          # Curvature dislocation >= 4%, execute 3-legged butterfly
    INVERSION_PANIC_BACKWARDATION = "INVERSION_PANIC_BACKWARDATION"          # Acute backwardation (front yield < -15%), spot squeeze


class CalendarArbDirective(str, Enum):
    MONITOR_TERM_CURVE = "MONITOR_TERM_CURVE"                                # Passive tracking, no trade
    EXECUTE_CALENDAR_SPREAD_ROLL = "EXECUTE_CALENDAR_SPREAD_ROLL"            # Long cheap tenor / Short rich tenor
    EXECUTE_BUTTERFLY_CURVE_ARB = "EXECUTE_BUTTERFLY_CURVE_ARB"              # 1:-2:1 butterfly across wings and belly
    UNWIND_BACKWARDATION_SQUEEZE = "UNWIND_BACKWARDATION_SQUEEZE"            # Squeeze in progress, exit basis legs


@dataclass
class ContractTenorBasis:
    symbol: str
    tenor_days: float                  # Days to expiry (0.33 for 8h perp, 30 for 1M, 90 for 3M)
    price: float                       # Contract market price
    spot_price: float                  # Underlying spot price


@dataclass
class BasisCurveAssessment:
    underlying: str
    front_tenor_yield_pct: float
    back_tenor_yield_pct: float
    roll_spread_pct: float
    curvature_dislocation_pct: float
    net_annualized_edge_pct: float
    regime: BasisTermStructureRegime
    directive: CalendarArbDirective
    rationales: List[str] = field(default_factory=list)


class BasisRollCalendarEngine:
    """
    Sub-millisecond futures basis term-structure solver and calendar roll arbitrator.
    """

    def __init__(
        self,
        min_spread_hurdle_pct: float = 6.0,
        butterfly_hurdle_pct: float = 4.0,
        friction_pct: float = 1.5,
    ):
        self.min_spread_hurdle_pct = min_spread_hurdle_pct
        self.butterfly_hurdle_pct = butterfly_hurdle_pct
        self.friction_pct = friction_pct

    def calculate_annualized_yield(
        self, price: float, spot: float, days: float
    ) -> float:
        """
        y = ((Futures - Spot) / Spot) * (365 / days) * 100%
        """
        if spot <= 0.0 or days <= 0.001:
            return 0.0
        basis_frac = (price - spot) / spot
        annualized = basis_frac * (365.0 / days) * 100.0
        return annualized

    def evaluate_curve(
        self, underlying: str, contracts: List[ContractTenorBasis]
    ) -> BasisCurveAssessment:
        rationales: List[str] = []

        if len(contracts) < 2:
            return BasisCurveAssessment(
                underlying=underlying,
                front_tenor_yield_pct=0.0,
                back_tenor_yield_pct=0.0,
                roll_spread_pct=0.0,
                curvature_dislocation_pct=0.0,
                net_annualized_edge_pct=0.0,
                regime=BasisTermStructureRegime.SMOOTH_TERM_STRUCTURE_EQUILIBRIUM,
                directive=CalendarArbDirective.MONITOR_TERM_CURVE,
                rationales=["Need at least 2 contracts to construct basis curve."],
            )

        # Sort contracts by tenor ascending
        sorted_contracts = sorted(contracts, key=lambda c: c.tenor_days)

        # Compute annualized yields
        yields = [
            self.calculate_annualized_yield(c.price, c.spot_price, c.tenor_days)
            for c in sorted_contracts
        ]

        front_yield = yields[0]
        back_yield = yields[1]
        roll_spread = back_yield - front_yield

        # Curvature calculation if 3 or more contracts exist
        if len(sorted_contracts) >= 3:
            t1 = sorted_contracts[0].tenor_days
            t2 = sorted_contracts[1].tenor_days
            t3 = sorted_contracts[2].tenor_days
            y1 = yields[0]
            y2 = yields[1]
            y3 = yields[2]

            # Linear interpolation benchmark at t2
            weight = (t2 - t1) / max(1e-4, t3 - t1)
            y2_bench = y1 + weight * (y3 - y1)
            curvature = y2 - y2_bench
        else:
            curvature = 0.0

        # Net edge calculation
        gross_spread = max(abs(roll_spread), abs(curvature))
        net_edge = max(0.0, gross_spread - self.friction_pct)

        # Decision State Machine
        if front_yield <= -15.0:
            regime = BasisTermStructureRegime.INVERSION_PANIC_BACKWARDATION
            directive = CalendarArbDirective.UNWIND_BACKWARDATION_SQUEEZE
            rationales.append(
                f"Severe panic backwardation on {underlying}: Front yield={front_yield:.1f}% APR. "
                f"Spot inventory shortage / squeeze in progress. Unwind long basis positions."
            )

        elif len(sorted_contracts) >= 3 and abs(curvature) >= self.butterfly_hurdle_pct:
            regime = BasisTermStructureRegime.BUTTERFLY_CURVATURE_ARBITRAGE
            directive = CalendarArbDirective.EXECUTE_BUTTERFLY_CURVE_ARB
            pos_str = "Short Belly / Long Wings" if curvature > 0 else "Long Belly / Short Wings"
            rationales.append(
                f"Basis butterfly curvature dislocation on {underlying} ({pos_str}): "
                f"Belly dislocation={curvature:+.1f}% APR >= {self.butterfly_hurdle_pct:.1f}% hurdle. "
                f"Net edge={net_edge:.1f}%. Execute 1:-2:1 butterfly."
            )

        elif abs(roll_spread) >= self.min_spread_hurdle_pct and net_edge > 0.0:
            regime = BasisTermStructureRegime.ACTIONABLE_CALENDAR_ROLL_SPREAD
            directive = CalendarArbDirective.EXECUTE_CALENDAR_SPREAD_ROLL
            leg_str = "Long Front / Short Back" if roll_spread > 0 else "Short Front / Long Back"
            rationales.append(
                f"Actionable calendar roll spread on {underlying} ({leg_str}): "
                f"Spread={abs(roll_spread):.1f}% APR (Front={front_yield:.1f}%, Back={back_yield:.1f}%). "
                f"Net edge={net_edge:.1f}% exceeds friction hurdle ({self.friction_pct:.1f}%)."
            )

        else:
            regime = BasisTermStructureRegime.SMOOTH_TERM_STRUCTURE_EQUILIBRIUM
            directive = CalendarArbDirective.MONITOR_TERM_CURVE
            rationales.append(
                f"Smooth term structure equilibrium on {underlying}: Roll spread={roll_spread:+.1f}%, "
                f"Curvature={curvature:+.1f}%. Net edge insufficient to overcome friction."
            )

        return BasisCurveAssessment(
            underlying=underlying,
            front_tenor_yield_pct=round(front_yield, 2),
            back_tenor_yield_pct=round(back_yield, 2),
            roll_spread_pct=round(roll_spread, 2),
            curvature_dislocation_pct=round(curvature, 2),
            net_annualized_edge_pct=round(net_edge, 2),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
