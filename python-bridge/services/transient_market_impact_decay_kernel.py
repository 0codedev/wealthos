r"""Cross-Market Order Slicing & Transient Market Impact Decay Kernel (Domain 216 / WP-DN)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Bouchaud-Mézard-Potters (2004) / Gatheral (2010) transient market impact propagator kernel G(\tau).
2. Square-root law instantaneous impact f(v) = \eta \cdot \text{sign}(v) \sqrt{|v|}.
3. Cumulative transient price displacement \mathcal{P}_{impact}(t) across discrete execution slices.
4. Convex cost optimization, microstructure overheating detector, and adaptive cool-down scheduler.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class SlicingPaceRegime(Enum):
    """Regime classification for execution slice pacing."""
    OPTIMAL_EQUILIBRIUM_PACE = "OPTIMAL_EQUILIBRIUM_PACE" # Book recovering normally; execute schedule
    OVERHEATED_IMPACT_SPIKE = "OVERHEATED_IMPACT_SPIKE"   # Slices fired too fast; transient impact accumulating
    HIGH_URGENCY_FRONT_LOAD = "HIGH_URGENCY_FRONT_LOAD"   # Volatility risk elevated; accept transient slippage


class SlicingTacticalAction(Enum):
    """Recommended tactical dispatch action."""
    DISPATCH_SCHEDULED_SLICE = "DISPATCH_SCHEDULED_SLICE"
    PAUSE_AND_COOL_DOWN = "PAUSE_AND_COOL_DOWN"           # Delay next slice to allow order book recovery
    SPLIT_INTO_MICRO_SLICES = "SPLIT_INTO_MICRO_SLICES"   # Subdivide slice into smaller child limit orders


@dataclass
class ExecutedSlice:
    """Historical record of an executed child order slice."""
    slice_id: int
    timestamp_sec: float
    shares: float
    side: str                          # "BUY" (+1) or "SELL" (-1)


@dataclass
class SlicingDiagnosticsResult:
    """Diagnostic outcome of transient impact accumulation and pacing recommendations."""
    symbol: str
    total_order_size: float
    shares_executed_so_far: float
    shares_remaining: float
    accumulated_transient_impact_bps: float
    next_planned_slice_size: float
    recommended_inter_slice_delay_sec: float
    pace_regime: SlicingPaceRegime
    recommended_action: SlicingTacticalAction
    tactical_directive: str


class TransientMarketImpactDecayKernel:
    r"""Bouchaud-Gatheral Transient Market Impact Propagator Kernel.
    
    Mathematical Formulation:
    1. Propagator Decay Kernel:
       G(\tau) = \frac{G_0}{(1 + \tau / \tau_0)^\alpha}, \quad \alpha \approx 0.50
       
    2. Instantaneous Square-Root Impact:
       f(q) = \eta \cdot \sqrt{\frac{q}{ADV_{\text{interval}}}} \times 10000 \quad (\text{bps})
       
    3. Accumulated Transient Price Displacement:
       \mathcal{P}_{\text{impact}}(t) = \sum_{j=1}^{k} s_j \cdot f(q_j) \cdot G(t - t_j)
       
    4. Overheating Condition:
       \mathcal{P}_{\text{impact}}(t) \ge \text{ImpactCeiling}_{\text{bps}} \implies \text{PAUSE\_AND\_COOL\_DOWN}
    """

    def __init__(
        self,
        g_0: float = 1.0,                    # Peak impact at tau = 0
        tau_0_recovery_sec: float = 2.50,    # Characteristic book relaxation half-life
        power_law_alpha: float = 0.50,       # Empirical propagator decay exponent
        impact_coefficient_eta: float = 0.40,# Square-root impact multiplier
        adv_shares_per_sec: float = 500.0,   # Baseline volume velocity
        max_tolerable_impact_bps: float = 25.0,# Microstructure overheating ceiling in bps
    ) -> None:
        self.g_0 = g_0
        self.tau_0 = tau_0_recovery_sec
        self.alpha = power_law_alpha
        self.eta = impact_coefficient_eta
        self.adv_shares_sec = adv_shares_per_sec
        self.max_impact_bps = max_tolerable_impact_bps

    def propagator_kernel_g(self, elapsed_tau_sec: float) -> float:
        """Compute the power-law transient impact decay factor G(tau)."""
        if elapsed_tau_sec < 0.0:
            return 0.0
        return self.g_0 / math.pow(1.0 + elapsed_tau_sec / self.tau_0, self.alpha)

    def instantaneous_slice_impact_bps(self, slice_shares: float) -> float:
        """Compute square-root instantaneous price displacement in basis points."""
        if slice_shares <= 0:
            return 0.0
        # Volume normalized by ADV
        vol_ratio = slice_shares / max(self.adv_shares_sec, 1.0)
        return self.eta * math.sqrt(vol_ratio) * 100.0

    def compute_accumulated_transient_impact(
        self,
        current_time_sec: float,
        executed_slices: List[ExecutedSlice],
    ) -> float:
        """Calculate total residual transient market impact at current_time_sec."""
        total_impact_bps = 0.0

        for sl in executed_slices:
            tau = current_time_sec - sl.timestamp_sec
            if tau >= 0.0:
                decay_factor = self.propagator_kernel_g(tau)
                raw_impact = self.instantaneous_slice_impact_bps(sl.shares)
                sign = 1.0 if sl.side.upper() == "BUY" else -1.0
                total_impact_bps += sign * raw_impact * decay_factor

        return round(total_impact_bps, 3)

    def evaluate_slicing_schedule(
        self,
        symbol: str,
        total_order_size: float,
        executed_slices: List[ExecutedSlice],
        current_time_sec: float,
        target_total_duration_sec: float = 60.0,
        num_target_slices: int = 10,
        urgency_factor: float = 0.50, # In [0.0, 1.0]
    ) -> SlicingDiagnosticsResult:
        """Evaluate transient impact accumulation, diagnose overheating, and schedule next child slice."""
        executed_shares = sum(s.shares for s in executed_slices)
        remaining_shares = max(0.0, total_order_size - executed_shares)

        accum_impact = self.compute_accumulated_transient_impact(current_time_sec, executed_slices)
        abs_impact = abs(accum_impact)

        # Baseline slice pacing
        remaining_slices = max(1, num_target_slices - len(executed_slices))
        base_slice_size = remaining_shares / remaining_slices
        base_interval = target_total_duration_sec / max(num_target_slices, 1)

        # Regimes & Decisions
        if abs_impact >= self.max_impact_bps:
            regime = SlicingPaceRegime.OVERHEATED_IMPACT_SPIKE
            action = SlicingTacticalAction.PAUSE_AND_COOL_DOWN
            recommended_delay = base_interval * 2.2 # Cool down interval
            recommended_slice = base_slice_size * 0.65
            directive = (
                f"OVERHEATED: Accumulated transient impact is {abs_impact:.2f} bps >= {self.max_impact_bps:.2f} bps. "
                f"Pause execution for {recommended_delay:.1f}s to allow LOB replenishment; reduce next slice to {recommended_slice:.0f} shares."
            )
        elif urgency_factor >= 0.80:
            regime = SlicingPaceRegime.HIGH_URGENCY_FRONT_LOAD
            action = SlicingTacticalAction.DISPATCH_SCHEDULED_SLICE
            recommended_delay = max(0.5, base_interval * 0.6)
            recommended_slice = base_slice_size * 1.40
            directive = (
                f"HIGH URGENCY: Front-loading execution trajectory (Urgency={urgency_factor:.1%}). "
                f"Dispatch accelerated slice of {recommended_slice:.0f} shares with tighter {recommended_delay:.1f}s cadence."
            )
        elif base_slice_size > self.adv_shares_sec * 0.80:
            regime = SlicingPaceRegime.OPTIMAL_EQUILIBRIUM_PACE
            action = SlicingTacticalAction.SPLIT_INTO_MICRO_SLICES
            recommended_delay = base_interval
            recommended_slice = base_slice_size / 2.0
            directive = (
                f"LARGE SLICE: Planned slice ({base_slice_size:.0f}) exceeds 80% ADV rate. "
                f"Subdivide into micro-slices of {recommended_slice:.0f} shares to minimize footprint."
            )
        else:
            regime = SlicingPaceRegime.OPTIMAL_EQUILIBRIUM_PACE
            action = SlicingTacticalAction.DISPATCH_SCHEDULED_SLICE
            recommended_delay = base_interval
            recommended_slice = base_slice_size
            directive = (
                f"OPTIMAL PACE: Residual impact is mild ({abs_impact:.2f} bps). "
                f"Dispatch planned slice of {recommended_slice:.0f} shares in {recommended_delay:.1f}s."
            )

        return SlicingDiagnosticsResult(
            symbol=symbol,
            total_order_size=total_order_size,
            shares_executed_so_far=round(executed_shares, 1),
            shares_remaining=round(remaining_shares, 1),
            accumulated_transient_impact_bps=accum_impact,
            next_planned_slice_size=round(recommended_slice, 1),
            recommended_inter_slice_delay_sec=round(recommended_delay, 2),
            pace_regime=regime,
            recommended_action=action,
            tactical_directive=directive,
        )
