"""
Multi-Asset Intraday Liquidity Surface Curvature & Optimal TWAP/VWAP Scheduler
Domain 230 / Work Package WP-EB

Implements Almgren-Chriss (2000) optimal execution trajectories,
intraday U-shaped volume curve fitting, dynamic liquidity surface curvature
adjustments, and participation rate limiters.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class SchedulerRegimeState(str, Enum):
    OPTIMAL_VWAP_TRACKING = "OPTIMAL_VWAP_TRACKING"   # Equilibrium volume tracking
    URGENCY_ACCELERATION = "URGENCY_ACCELERATION"     # Adverse drift -> accelerate execution
    SURFACE_COMPRESSION = "SURFACE_COMPRESSION"       # Hollow book / steep curvature -> throttle slices


@dataclass
class ExecutionSlice:
    slice_index: int
    scheduled_shares: float
    expected_volume: float
    participation_rate: float
    expected_impact_bps: float
    slice_timestamp_min: float


@dataclass
class ExecutionSchedule:
    strategy_name: str
    total_shares: float
    num_slices: int
    interval_minutes: float
    slices: List[ExecutionSlice]
    total_expected_impact_usd: float
    peak_participation_rate: float
    regime: SchedulerRegimeState
    recommended_action: str
    details: Dict[str, float] = field(default_factory=dict)


class LiquiditySurfaceTWAPVWAPScheduler:
    """
    Constructs optimal order execution trajectories by fitting intraday volume curves
    and adjusting slice sizes for order book depth curvature and adverse drift risk.
    """

    def __init__(
        self,
        max_participation_rate: float = 0.12, # Cap at 12% of market interval volume
        default_risk_aversion: float = 1e-6,
        permanent_impact_gamma: float = 2.5e-7,
        temporary_impact_eta: float = 5.0e-6,
    ):
        self.max_participation = max_participation_rate
        self.risk_aversion = default_risk_aversion
        self.gamma = permanent_impact_gamma
        self.eta = temporary_impact_eta

    @staticmethod
    def generate_u_shaped_volume_profile(num_bins: int = 13) -> List[float]:
        """
        Generates standard U-shaped intraday volume profile across trading day:
        w_k proportional to 1.0 + 0.8 * ((k - mid) / mid)^2
        """
        if num_bins < 1:
            return [1.0]

        mid = (num_bins - 1) / 2.0
        raw_weights = []
        for k in range(num_bins):
            dist = (k - mid) / max(1.0, mid)
            w = 1.0 + 0.8 * (dist ** 2)
            raw_weights.append(w)

        total_w = sum(raw_weights)
        return [w / total_w for w in raw_weights]

    @staticmethod
    def compute_surface_curvature(
        depth_usd_levels: List[float],
        price_displacement_bps: List[float],
    ) -> float:
        """
        Estimates liquidity surface curvature: second derivative of price impact
        with respect to executed volume. High curvature indicates book hollowing.
        Curvature = d^2(Impact) / d(Depth)^2
        """
        if len(depth_usd_levels) < 3 or len(depth_usd_levels) != len(price_displacement_bps):
            return 1.0

        # Finite difference approximation of second derivative
        d1 = depth_usd_levels[0]
        d2 = depth_usd_levels[1]
        d3 = depth_usd_levels[2]
        i1 = price_displacement_bps[0]
        i2 = price_displacement_bps[1]
        i3 = price_displacement_bps[2]

        slope1 = (i2 - i1) / max(1.0, d2 - d1)
        slope2 = (i3 - i2) / max(1.0, d3 - d2)

        d_mid = 0.5 * ((d3 + d2) - (d2 + d1))
        second_deriv = (slope2 - slope1) / max(1.0, d_mid)

        # Scale to standard index (normal range 0.5 - 3.0)
        curvature_index = max(0.1, second_deriv * 1e8)
        return curvature_index

    def generate_vwap_schedule(
        self,
        total_shares: float,
        interval_volumes: List[float],
        current_price: float,
        interval_minutes: float = 30.0,
        curvature_index: float = 1.0,
    ) -> ExecutionSchedule:
        """
        Constructs curvature-adjusted VWAP schedule.
        Slices are proportional to expected interval volume, moderated by book curvature
        and clamped by the max participation rate barrier.
        """
        num_slices = len(interval_volumes)
        if num_slices == 0 or total_shares <= 0.0:
            return ExecutionSchedule(
                strategy_name="VWAP",
                total_shares=total_shares,
                num_slices=0,
                interval_minutes=interval_minutes,
                slices=[],
                total_expected_impact_usd=0.0,
                peak_participation_rate=0.0,
                regime=SchedulerRegimeState.OPTIMAL_VWAP_TRACKING,
                recommended_action="ZERO_SHARES: No schedule generated.",
            )

        tot_vol = sum(interval_volumes)
        volume_weights = [v / tot_vol for v in interval_volumes] if tot_vol > 0 else [1.0 / num_slices] * num_slices

        # Curvature moderation: when curvature is high (>1.5), dampen large slices
        curv_dampening = max(0.6, min(1.4, 1.0 / math.sqrt(max(0.2, curvature_index))))

        raw_shares = [total_shares * (w ** curv_dampening) for w in volume_weights]
        sum_raw = sum(raw_shares)
        normalized_shares = [s * (total_shares / sum_raw) for s in raw_shares]

        # Apply participation rate capping and reallocation
        slices: List[ExecutionSlice] = []
        excess_shares = 0.0
        allocated_shares: List[float] = []

        for k in range(num_slices):
            target_s = normalized_shares[k]
            market_v = max(1.0, interval_volumes[k])
            max_allowed = market_v * self.max_participation

            if target_s > max_allowed:
                excess_shares += (target_s - max_allowed)
                allocated_shares.append(max_allowed)
            else:
                allocated_shares.append(target_s)

        # Redistribute excess shares across unsaturated slices
        if excess_shares > 0.0:
            unsaturated_indices = [
                i for i in range(num_slices)
                if allocated_shares[i] < interval_volumes[i] * self.max_participation
            ]
            if unsaturated_indices:
                add_per_slice = excess_shares / len(unsaturated_indices)
                for i in unsaturated_indices:
                    allocated_shares[i] += add_per_slice

        # Compute impact and construct slices
        total_impact_usd = 0.0
        peak_participation = 0.0

        for k in range(num_slices):
            s_shares = allocated_shares[k]
            market_v = max(1.0, interval_volumes[k])
            part_rate = s_shares / market_v
            peak_participation = max(peak_participation, part_rate)

            # Square-root temporary impact in bps: Impact = eta_scaled * sqrt(part_rate) * 10000
            impact_bps = math.sqrt(part_rate) * 15.0 * math.sqrt(max(0.5, curvature_index))
            slice_impact_usd = (impact_bps / 10000.0) * s_shares * current_price
            total_impact_usd += slice_impact_usd

            slices.append(ExecutionSlice(
                slice_index=k,
                scheduled_shares=s_shares,
                expected_volume=market_v,
                participation_rate=part_rate,
                expected_impact_bps=impact_bps,
                slice_timestamp_min=k * interval_minutes,
            ))

        # Regime determination
        if curvature_index >= 2.0:
            regime = SchedulerRegimeState.SURFACE_COMPRESSION
            action = f"THROTTLE_SLICES: Liquidity surface curvature high ({curvature_index:.2f}). Slices flattened to prevent book walking."
        else:
            regime = SchedulerRegimeState.OPTIMAL_VWAP_TRACKING
            action = f"EXECUTE_VWAP: Peak participation {peak_participation:.1%}, estimated impact ${total_impact_usd:.2f}."

        return ExecutionSchedule(
            strategy_name="VWAP_CURVATURE_ADJUSTED",
            total_shares=total_shares,
            num_slices=num_slices,
            interval_minutes=interval_minutes,
            slices=slices,
            total_expected_impact_usd=total_impact_usd,
            peak_participation_rate=peak_participation,
            regime=regime,
            recommended_action=action,
            details={
                "curvature_index": curvature_index,
                "curv_dampening": curv_dampening,
                "total_market_volume": tot_vol,
            },
        )

    def generate_almgren_chriss_trajectory(
        self,
        total_shares: float,
        num_slices: int,
        daily_volatility: float,
        current_price: float,
        total_duration_hours: float = 6.5,
        risk_aversion: Optional[float] = None,
    ) -> ExecutionSchedule:
        """
        Analytic Almgren-Chriss optimal execution schedule:
        x_k = X * sinh(kappa * (T - t_k)) / sinh(kappa * T)
        where kappa = sqrt(lambda * sigma^2 / eta)
        """
        if num_slices < 2 or total_shares <= 0.0:
            return self.generate_vwap_schedule(total_shares, [10000.0] * max(1, num_slices), current_price)

        lam = risk_aversion if risk_aversion is not None else self.risk_aversion
        tau = total_duration_hours / num_slices
        sigma = daily_volatility / math.sqrt(6.5) # vol per hour

        # Characteristic urgency parameter: kappa = sqrt(lambda * sigma^2 / eta)
        kappa_sq = (lam * (sigma ** 2)) / max(1e-12, self.eta)
        kappa = math.sqrt(max(1e-6, kappa_sq))

        t_total = total_duration_hours

        # Holding trajectory x_k
        sinh_total = math.sinh(min(20.0, kappa * t_total))
        holdings = []
        for k in range(num_slices + 1):
            t_k = k * tau
            rem_t = max(0.0, t_total - t_k)
            x_k = total_shares * (math.sinh(min(20.0, kappa * rem_t)) / max(1e-6, sinh_total))
            holdings.append(x_k)

        # Slice trade sizes n_k = x_{k-1} - x_k
        slices: List[ExecutionSlice] = []
        total_impact_usd = 0.0

        for k in range(num_slices):
            s_shares = max(0.0, holdings[k] - holdings[k + 1])
            trade_rate = s_shares / tau

            # Temporary impact: eta * trade_rate
            temp_impact_pct = self.eta * trade_rate
            impact_bps = temp_impact_pct * 10000.0
            slice_impact_usd = temp_impact_pct * s_shares * current_price
            total_impact_usd += slice_impact_usd

            slices.append(ExecutionSlice(
                slice_index=k,
                scheduled_shares=s_shares,
                expected_volume=50000.0, # reference volume
                participation_rate=s_shares / 50000.0,
                expected_impact_bps=impact_bps,
                slice_timestamp_min=k * tau * 60.0,
            ))

        return ExecutionSchedule(
            strategy_name="ALMGREN_CHRISS_OPTIMAL",
            total_shares=total_shares,
            num_slices=num_slices,
            interval_minutes=tau * 60.0,
            slices=slices,
            total_expected_impact_usd=total_impact_usd,
            peak_participation_rate=max(s.participation_rate for s in slices) if slices else 0.0,
            regime=SchedulerRegimeState.OPTIMAL_VWAP_TRACKING,
            recommended_action=f"EXECUTE_ALMGREN_CHRISS: Urgency kappa={kappa:.3f}, total impact ${total_impact_usd:.2f}.",
            details={"kappa": kappa, "lambda": lam, "sigma": sigma},
        )
