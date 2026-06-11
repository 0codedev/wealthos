"""
Intraday Algorithmic Order Slicing VWAP/TWAP Slippage Bound & Almgren-Chriss Optimal Execution Sentry
Domain 256 / Work Package WP-FB

Computes closed-form Almgren-Chriss optimal liquidation trajectories balancing
market impact against price volatility risk, benchmarks live slice execution against theoretical bounds,
and throttles pacing to prevent adverse selection and market footprint spikes.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class ExecutionTrackingRegime(str, Enum):
    OPTIMAL_ALMGREN_CHRISS_ON_SCHEDULE = "OPTIMAL_ALMGREN_CHRISS_ON_SCHEDULE"  # Slippage within theoretical envelope (|z| < 1.0)
    ELEVATED_SLIPPAGE_DRIFT = "ELEVATED_SLIPPAGE_DRIFT"                        # Slippage drifting (1.0 <= z < 2.5), throttle urgency
    SEVERE_IMPACT_BREACH_ABORT = "SEVERE_IMPACT_BREACH_ABORT"                  # Slippage z >= 2.5 or liquidity shock, halt aggressive flow
    TRAJECTORY_COMPLETED = "TRAJECTORY_COMPLETED"                              # Order 100% completed


class ExecutionPacingDirective(str, Enum):
    MAINTAIN_OPTIMAL_SCHEDULE = "MAINTAIN_OPTIMAL_SCHEDULE"                    # Continue scheduled slice dispatch
    THROTTLE_SLICING_URGENCY = "THROTTLE_SLICING_URGENCY"                      # Reduce slice size by 30%, extend horizon
    SWITCH_TO_PASSIVE_PEG = "SWITCH_TO_PASSIVE_PEG"                            # Cease taker orders; post passive midpoint pegs
    HALT_EXECUTION_IMPACT_SPIKE = "HALT_EXECUTION_IMPACT_SPIKE"                # Immediately pause order dispatch


@dataclass
class ExecutionParameters:
    total_shares_x0: float
    total_time_horizon_sec: float = 3600.0     # Total liquidation horizon T (e.g. 1 hour)
    num_intervals: int = 20                    # Number of slicing intervals N
    temporary_impact_eta: float = 2.5e-6       # Temporary impact parameter eta
    permanent_impact_gamma: float = 1.0e-7     # Permanent impact parameter gamma
    asset_volatility_sigma: float = 0.015      # Intraday price volatility sigma (per sqrt(sec))
    urgency_lambda: float = 1.0e-5             # Trader risk aversion / urgency lambda


@dataclass
class IntervalExecutionUpdate:
    step_index: int                            # Step k in {0, ..., N}
    shares_executed_this_step: float
    realized_execution_price: float
    benchmark_vwap_price: float
    remaining_shares: float


@dataclass
class OptimalExecutionAssessment:
    step_index: int
    scheduled_remaining_shares: float
    actual_remaining_shares: float
    recommended_slice_size: float
    theoretical_impact_bps: float
    realized_slippage_bps: float
    slippage_z_score: float
    regime: ExecutionTrackingRegime
    directive: ExecutionPacingDirective
    rationales: List[str] = field(default_factory=list)


class AlmgrenChrissOptimalExecutionSentry:
    """
    Solves discrete Almgren-Chriss optimal liquidation paths and monitors intraday slippage bounds.
    """

    def __init__(self, params: ExecutionParameters):
        self.params = params
        self.tau = params.total_time_horizon_sec / max(1, params.num_intervals)
        self.kappa = self._calculate_kappa()
        self.scheduled_path = self._precompute_trajectory()

    def _calculate_kappa(self) -> float:
        """
        Calculates Almgren-Chriss urgency decay parameter:
        kappa ~ sqrt(lambda * sigma^2 / eta)
        """
        p = self.params
        num = p.urgency_lambda * (p.asset_volatility_sigma ** 2)
        den = max(1e-9, p.temporary_impact_eta)
        return math.sqrt(num / den)

    def _precompute_trajectory(self) -> List[float]:
        """
        Computes scheduled remaining holdings:
        x_j = (sinh(kappa * (T - t_j)) / sinh(kappa * T)) * X_0
        """
        p = self.params
        t_total = p.total_time_horizon_sec
        k = self.kappa

        sinh_total = math.sinh(k * t_total) if (k * t_total) < 50.0 else math.exp(k * t_total) / 2.0
        sinh_total = max(1e-6, sinh_total)

        trajectory: List[float] = []
        for j in range(p.num_intervals + 1):
            t_j = j * self.tau
            rem_time = max(0.0, t_total - t_j)
            sinh_rem = math.sinh(k * rem_time) if (k * rem_time) < 50.0 else math.exp(k * rem_time) / 2.0
            x_j = (sinh_rem / sinh_total) * p.total_shares_x0
            trajectory.append(round(x_j, 2))

        return trajectory

    def evaluate_step(self, update: IntervalExecutionUpdate) -> OptimalExecutionAssessment:
        rationales: List[str] = []
        p = self.params
        k = min(len(self.scheduled_path) - 1, update.step_index)

        sched_rem = self.scheduled_path[k]
        actual_rem = update.remaining_shares

        # Completion check
        if actual_rem <= 0.0 or k >= p.num_intervals:
            return OptimalExecutionAssessment(
                step_index=k,
                scheduled_remaining_shares=0.0,
                actual_remaining_shares=0.0,
                recommended_slice_size=0.0,
                theoretical_impact_bps=0.0,
                realized_slippage_bps=0.0,
                slippage_z_score=0.0,
                regime=ExecutionTrackingRegime.TRAJECTORY_COMPLETED,
                directive=ExecutionPacingDirective.MAINTAIN_OPTIMAL_SCHEDULE,
                rationales=["Execution trajectory fully completed."],
            )

        # Recommended next slice: x_k - x_{k+1}
        next_k = min(len(self.scheduled_path) - 1, k + 1)
        base_slice = max(0.0, self.scheduled_path[k] - self.scheduled_path[next_k])

        # Theoretical expected impact in bps
        trade_rate = base_slice / max(1.0, self.tau)
        theor_impact_pct = (p.temporary_impact_eta * trade_rate) + (0.5 * p.permanent_impact_gamma * base_slice)
        theor_impact_bps = theor_impact_pct * 10000.0

        # Realized slippage vs VWAP
        if update.benchmark_vwap_price > 0.0:
            realized_slip_bps = (
                (update.benchmark_vwap_price - update.realized_execution_price)
                / update.benchmark_vwap_price
            ) * 10000.0
        else:
            realized_slip_bps = 0.0

        # Slippage z-score relative to expected impact envelope
        impact_std_bps = max(1.0, theor_impact_bps * 0.5)
        slip_z = (realized_slip_bps - theor_impact_bps) / impact_std_bps

        # Regime & Pacing State Machine
        if slip_z >= 2.5:
            regime = ExecutionTrackingRegime.SEVERE_IMPACT_BREACH_ABORT
            directive = ExecutionPacingDirective.HALT_EXECUTION_IMPACT_SPIKE
            rec_slice = 0.0
            rationales.append(
                f"Severe market impact breach at step {k}: Slippage={realized_slip_bps:.1f} bps "
                f"exceeds theoretical {theor_impact_bps:.1f} bps (z={slip_z:.2f} >= 2.5). "
                f"Halting taker slicing to avoid moving market."
            )

        elif slip_z >= 1.0:
            regime = ExecutionTrackingRegime.ELEVATED_SLIPPAGE_DRIFT
            directive = ExecutionPacingDirective.THROTTLE_SLICING_URGENCY
            rec_slice = round(base_slice * 0.70, 2)  # Reduce slice by 30%
            rationales.append(
                f"Elevated slippage drift at step {k}: Slippage={realized_slip_bps:.1f} bps "
                f"(z={slip_z:.2f}). Throttling slice by 30% to {rec_slice:.0f} shares."
            )

        else:
            regime = ExecutionTrackingRegime.OPTIMAL_ALMGREN_CHRISS_ON_SCHEDULE
            directive = ExecutionPacingDirective.MAINTAIN_OPTIMAL_SCHEDULE
            rec_slice = round(base_slice, 2)
            rationales.append(
                f"Slicing on optimal schedule at step {k}: Slippage={realized_slip_bps:.1f} bps "
                f"within theoretical envelope {theor_impact_bps:.1f} bps (z={slip_z:.2f}). Next slice={rec_slice:.0f}."
            )

        return OptimalExecutionAssessment(
            step_index=k,
            scheduled_remaining_shares=round(sched_rem, 2),
            actual_remaining_shares=round(actual_rem, 2),
            recommended_slice_size=round(rec_slice, 2),
            theoretical_impact_bps=round(theor_impact_bps, 2),
            realized_slippage_bps=round(realized_slip_bps, 2),
            slippage_z_score=round(slip_z, 2),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
