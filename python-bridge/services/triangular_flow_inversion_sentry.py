"""
Multi-Exchange Continuous Triangular Flow Inversion & Atomic Flash Path Sentry
Domain 251 / Work Package WP-EW

Monitors multi-venue closed-loop triangular exchange rate discrepancies,
solves order book queue depth bottleneck capacity, and dispatches atomic 3-legged
IOC routing while enforcing sub-millisecond unhedged leg aborts.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class TriangularPathRegime(str, Enum):
    PROFITABLE_TRIANGULAR_PATH = "PROFITABLE_TRIANGULAR_PATH"              # Net edge > hurdle and volume >= bottleneck min
    SUB_ECONOMIC_SPREAD = "SUB_ECONOMIC_SPREAD"                            # Positive gross rate, but eaten by fees/slippage
    NEGATIVE_YIELD_EQUILIBRIUM = "NEGATIVE_YIELD_EQUILIBRIUM"              # Gross rate <= 1.0 (no-arbitrage bound holds)
    BOTTLENECK_LIQUIDITY_VIOLATION = "BOTTLENECK_LIQUIDITY_VIOLATION"      # Price edge exists, but bottleneck depth < min capacity (odd-lot trap)
    INVERSION_FLASH_ABORT = "INVERSION_FLASH_ABORT"                        # Intermediate leg cancellation/slip forces immediate abort


class AtomicExecutionDirective(str, Enum):
    DISPATCH_ATOMIC_TRIANGLE_IOC = "DISPATCH_ATOMIC_TRIANGLE_IOC"          # Fire 3-legged synchronized atomic IOC orders
    HOLD_OBSERVATION = "HOLD_OBSERVATION"                                  # Passive monitoring, no actionable edge
    ABORT_ATOMIC_UNWIND_REMAINDER = "ABORT_ATOMIC_UNWIND_REMAINDER"        # Abort remaining unfilled legs and hedge residual delta


@dataclass
class LegQuote:
    pair: str
    side: str                          # "BUY" (quote to base) or "SELL" (base to quote)
    price: float
    available_volume: float            # In native pair base currency
    taker_fee_bps: float = 4.0         # Exchange taker fee in bps
    expected_slip_bps: float = 1.0     # Expected microsecond fill slip in bps


@dataclass
class TriangularPathInput:
    path_id: str                       # e.g. "USDT->BTC->ETH->USDT"
    base_currency: str                 # "USDT"
    leg1: LegQuote                     # Buy BTC with USDT (price = P_BTC/USDT)
    leg2: LegQuote                     # Buy ETH with BTC (price = P_ETH/BTC) or Sell BTC for ETH
    leg3: LegQuote                     # Sell ETH for USDT (price = P_ETH/USDT)
    min_capacity_base: float = 500.0   # Minimum required volume in USDT
    min_net_profit_bps: float = 2.5    # Minimum net hurdle after fees & slippage
    is_in_flight: bool = False         # Whether path is actively executing
    intermediate_fill_slip_bps: float = 0.0  # Realized slip during mid-flight


@dataclass
class TriangularOpportunityAssessment:
    path_id: str
    gross_synthetic_rate: float
    total_fee_bps: float
    total_slippage_bps: float
    net_edge_bps: float
    bottleneck_capacity_base: float
    expected_profit_base: float
    regime: TriangularPathRegime
    directive: AtomicExecutionDirective
    rationales: List[str] = field(default_factory=list)


class TriangularFlowInversionSentry:
    """
    Sub-millisecond triangular cross-rate calculator and liquidity bottleneck solver.
    """

    def __init__(
        self,
        default_hurdle_bps: float = 2.5,
        emergency_abort_loss_bps: float = -5.0,
    ):
        self.default_hurdle_bps = default_hurdle_bps
        self.emergency_abort_loss_bps = emergency_abort_loss_bps

    def compute_path_conversion(
        self, base_amount: float, l1: LegQuote, l2: LegQuote, l3: LegQuote
    ) -> Tuple[float, float]:
        """
        Traces a hypothetical unit through the 3 legs:
        Returns: (final_amount_gross, final_amount_net_of_fees_and_slip)
        """
        # Leg 1: e.g. Buy BTC with USDT -> amount = base_amount / P1 (if BUY) or * P1 (if SELL)
        amt1_gross = (base_amount / l1.price) if l1.side.upper() == "BUY" else (base_amount * l1.price)
        drag1 = 1.0 - ((l1.taker_fee_bps + l1.expected_slip_bps) / 10000.0)
        amt1_net = amt1_gross * drag1

        # Leg 2: e.g. Buy ETH with BTC (amt1 is BTC) -> amt2 = amt1 / P2 (if BUY) or * P2 (if SELL)
        amt2_gross = (amt1_net / l2.price) if l2.side.upper() == "BUY" else (amt1_net * l2.price)
        drag2 = 1.0 - ((l2.taker_fee_bps + l2.expected_slip_bps) / 10000.0)
        amt2_net = amt2_gross * drag2

        # Leg 3: e.g. Sell ETH for USDT (amt2 is ETH) -> amt3 = amt2 * P3 (if SELL) or / P3 (if BUY)
        amt3_gross = (amt2_net * l3.price) if l3.side.upper() == "SELL" else (amt2_net / l3.price)
        drag3 = 1.0 - ((l3.taker_fee_bps + l3.expected_slip_bps) / 10000.0)
        amt3_net = amt3_gross * drag3

        # Gross rate without fees/slip
        g1 = (1.0 / l1.price) if l1.side.upper() == "BUY" else l1.price
        g2 = (1.0 / l2.price) if l2.side.upper() == "BUY" else l2.price
        g3 = l3.price if l3.side.upper() == "SELL" else (1.0 / l3.price)
        gross_rate = g1 * g2 * g3

        return gross_rate, amt3_net / base_amount

    def evaluate_path(self, path: TriangularPathInput) -> TriangularOpportunityAssessment:
        rationales: List[str] = []

        # 1. Total fee and slip drag
        total_fees = path.leg1.taker_fee_bps + path.leg2.taker_fee_bps + path.leg3.taker_fee_bps
        total_slip = path.leg1.expected_slip_bps + path.leg2.expected_slip_bps + path.leg3.expected_slip_bps + path.intermediate_fill_slip_bps

        # 2. Path conversion simulation
        gross_rate, net_rate = self.compute_path_conversion(
            10000.0, path.leg1, path.leg2, path.leg3
        )
        gross_bps = (gross_rate - 1.0) * 10000.0
        net_edge_bps = (net_rate - 1.0) * 10000.0

        # 3. Liquidity bottleneck capacity calculation in base units
        # Leg 1 capacity in base currency
        cap1 = (path.leg1.available_volume * path.leg1.price) if path.leg1.side.upper() == "BUY" else path.leg1.available_volume
        # Leg 2 capacity in base currency (approximate through leg 1 conversion)
        cap2_native = path.leg2.available_volume
        cap2_base = cap2_native * path.leg1.price if path.leg1.side.upper() == "BUY" else cap2_native
        # Leg 3 capacity in base currency
        cap3 = (path.leg3.available_volume * path.leg3.price) if path.leg3.side.upper() == "SELL" else path.leg3.available_volume

        bottleneck_capacity = max(0.0, min(cap1, cap2_base, cap3))

        # 4. In-Flight Emergency Abort Check
        if path.is_in_flight and net_edge_bps <= self.emergency_abort_loss_bps:
            rationales.append(
                f"Emergency unhedged flash abort triggered: realized net rate={net_edge_bps:.1f} bps "
                f"breached loss barrier {self.emergency_abort_loss_bps} bps. Aborting remaining legs."
            )
            return TriangularOpportunityAssessment(
                path_id=path.path_id,
                gross_synthetic_rate=round(gross_rate, 6),
                total_fee_bps=round(total_fees, 2),
                total_slippage_bps=round(total_slip, 2),
                net_edge_bps=round(net_edge_bps, 2),
                bottleneck_capacity_base=round(bottleneck_capacity, 2),
                expected_profit_base=0.0,
                regime=TriangularPathRegime.INVERSION_FLASH_ABORT,
                directive=AtomicExecutionDirective.ABORT_ATOMIC_UNWIND_REMAINDER,
                rationales=rationales,
            )

        # 5. Regime Classification State Machine
        hurdle = max(self.default_hurdle_bps, path.min_net_profit_bps)

        if gross_rate <= 1.0:
            regime = TriangularPathRegime.NEGATIVE_YIELD_EQUILIBRIUM
            directive = AtomicExecutionDirective.HOLD_OBSERVATION
            expected_profit = 0.0
            rationales.append(
                f"No arbitrage: Gross rate={gross_rate:.6f} <= 1.000000. Efficient pricing equilibrium holds."
            )

        elif net_edge_bps < hurdle:
            regime = TriangularPathRegime.SUB_ECONOMIC_SPREAD
            directive = AtomicExecutionDirective.HOLD_OBSERVATION
            expected_profit = 0.0
            rationales.append(
                f"Sub-economic spread: Gross edge={gross_bps:.1f} bps consumed by fees ({total_fees:.1f} bps) "
                f"and slippage ({total_slip:.1f} bps). Net edge={net_edge_bps:.1f} bps < hurdle={hurdle:.1f} bps."
            )

        elif bottleneck_capacity < path.min_capacity_base:
            regime = TriangularPathRegime.BOTTLENECK_LIQUIDITY_VIOLATION
            directive = AtomicExecutionDirective.HOLD_OBSERVATION
            expected_profit = 0.0
            rationales.append(
                f"Liquidity bottleneck violation: Net edge={net_edge_bps:.1f} bps >= hurdle, but bottleneck "
                f"capacity ({bottleneck_capacity:.1f} {path.base_currency}) < minimum required ({path.min_capacity_base:.1f})."
            )

        else:
            regime = TriangularPathRegime.PROFITABLE_TRIANGULAR_PATH
            directive = AtomicExecutionDirective.DISPATCH_ATOMIC_TRIANGLE_IOC
            expected_profit = bottleneck_capacity * (net_edge_bps / 10000.0)
            rationales.append(
                f"Actionable triangular loop detected: Gross={gross_bps:.1f} bps, Net edge={net_edge_bps:.1f} bps "
                f"exceeds {hurdle:.1f} bps hurdle. Tradable bottleneck capacity={bottleneck_capacity:.1f} {path.base_currency}. "
                f"Expected clean capture={expected_profit:.2f} {path.base_currency}."
            )

        return TriangularOpportunityAssessment(
            path_id=path.path_id,
            gross_synthetic_rate=round(gross_rate, 6),
            total_fee_bps=round(total_fees, 2),
            total_slippage_bps=round(total_slip, 2),
            net_edge_bps=round(net_edge_bps, 2),
            bottleneck_capacity_base=round(bottleneck_capacity, 2),
            expected_profit_base=round(expected_profit, 2),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
