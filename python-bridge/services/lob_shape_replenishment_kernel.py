"""
High-Frequency Limit Order Book Shape Function & Deep Liquidity Replenishment Kernel
Domain 235 / Work Package WP-EG

Implements Biais-Hillion-Spatt (1995) / Bouchaud order book shape functions,
post-sweep liquidity cavity relaxation half-life kernels, and unreplenished
air-pocket flash jump sentries.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class BookResiliencyRegimeState(str, Enum):
    FLASH_HOLE_UNREPLENISHED = "FLASH_HOLE_UNREPLENISHED" # Cavity un-replenished, air-pocket danger
    REPLENISHMENT_ACCELERATED = "REPLENISHMENT_ACCELERATED" # Fast sub-50ms recovery, deep resiliency
    EQUILIBRIUM_SHAPE = "EQUILIBRIUM_SHAPE"               # Steady-state gamma shape profile


@dataclass
class BookDepthTier:
    price: float
    volume: float
    distance_bps: float


@dataclass
class ShapeFunctionFit:
    alpha_shape: float
    beta_decay: float
    peak_distance_bps: float
    r_squared: float
    is_hollow_inside: bool


@dataclass
class CavityRecoveryMetric:
    initial_hole_volume: float
    current_hole_volume: float
    elapsed_time_ms: float
    replenishment_ratio_pct: float
    estimated_half_life_ms: float
    resilience_rate_hz: float


@dataclass
class ShapeSentryDecision:
    shape: ShapeFunctionFit
    cavity: CavityRecoveryMetric
    regime: BookResiliencyRegimeState
    recommended_action: str
    details: Dict[str, float] = field(default_factory=dict)


class LOBShapeReplenishmentKernel:
    """
    Fits continuous order book shape functions across distance from mid,
    and estimates the exponential relaxation kernel of liquidity replenishment.
    """

    def __init__(
        self,
        critical_hole_threshold_pct: float = 60.0, # Alert if >60% cavity remains un-replenished
        fast_recovery_half_life_ms: float = 45.0,  # Fast institutional market maker recovery
        slow_recovery_barrier_ms: float = 250.0,   # Sluggish maker recovery barrier
    ):
        self.critical_hole_pct = critical_hole_threshold_pct
        self.fast_half_life = fast_recovery_half_life_ms
        self.slow_barrier = slow_recovery_barrier_ms

    @staticmethod
    def fit_book_shape_function(
        tiers: List[BookDepthTier],
    ) -> ShapeFunctionFit:
        """
        Fits Biais-Bouchaud Gamma density shape function:
        rho(Delta) = rho_0 * Delta^alpha * exp(-beta * Delta)
        ln(rho) = ln(rho_0) + alpha * ln(Delta) - beta * Delta
        Peak density occurs at Delta* = alpha / beta.
        """
        if len(tiers) < 3:
            return ShapeFunctionFit(
                alpha_shape=1.0, beta_decay=0.2, peak_distance_bps=5.0,
                r_squared=0.5, is_hollow_inside=False
            )

        # Filter tiers with positive distance and volume
        valid_tiers = [t for t in tiers if t.distance_bps > 0.05 and t.volume > 0.0]
        if len(valid_tiers) < 3:
            return ShapeFunctionFit(
                alpha_shape=1.0, beta_decay=0.2, peak_distance_bps=5.0,
                r_squared=0.5, is_hollow_inside=False
            )

        # Log variables
        y = [math.log(max(1e-4, t.volume)) for t in valid_tiers]
        x1 = [math.log(t.distance_bps) for t in valid_tiers]
        x2 = [t.distance_bps for t in valid_tiers]

        # 2-variable OLS regression: y = c + alpha * x1 - beta * x2
        # Center variables
        n = len(y)
        my, mx1, mx2 = sum(y) / n, sum(x1) / n, sum(x2) / n

        # Cross sums
        s11 = sum((x1[i] - mx1) ** 2 for i in range(n))
        s22 = sum((x2[i] - mx2) ** 2 for i in range(n))
        s12 = sum((x1[i] - mx1) * (x2[i] - mx2) for i in range(n))

        sy1 = sum((y[i] - my) * (x1[i] - mx1) for i in range(n))
        sy2 = sum((y[i] - my) * (x2[i] - mx2) for i in range(n))

        det = s11 * s22 - (s12 ** 2)
        if abs(det) < 1e-10:
            alpha = 1.0
            beta = 0.1
            r_sq = 0.5
        else:
            alpha = (sy1 * s22 - sy2 * s12) / det
            # x2 has negative sign in shape function: y = c + alpha*x1 - beta*x2
            # so beta_param = -((sy2 * s11 - sy1 * s12) / det)
            beta_slope = (sy2 * s11 - sy1 * s12) / det
            beta = max(0.01, -beta_slope)
            alpha = max(0.05, alpha)

            # R-squared
            pred_y = [my + alpha * (x1[i] - mx1) - beta * (x2[i] - mx2) for i in range(n)]
            rss = sum((y[i] - pred_y[i]) ** 2 for i in range(n))
            tss = sum((y[i] - my) ** 2 for i in range(n))
            r_sq = max(0.0, 1.0 - (rss / tss)) if tss > 1e-10 else 0.5

        peak_dist = alpha / max(1e-4, beta)
        # Book is hollow inside if peak density occurs deep (> 3.0 bps away)
        is_hollow = peak_dist > 3.0

        return ShapeFunctionFit(
            alpha_shape=alpha,
            beta_decay=beta,
            peak_distance_bps=peak_dist,
            r_squared=r_sq,
            is_hollow_inside=is_hollow,
        )

    def track_replenishment_kernel(
        self,
        initial_cavity_volume: float,
        current_cavity_volume: float,
        elapsed_time_ms: float,
    ) -> CavityRecoveryMetric:
        """
        Estimates exponential recovery:
        H(t) = H_0 * exp(-t / tau)
        tau = elapsed_time / ln(H_0 / H(t))
        half_life = tau * ln(2)
        """
        h0 = max(1.0, initial_cavity_volume)
        ht = max(0.0, min(h0, current_cavity_volume))
        dt = max(1.0, elapsed_time_ms)

        recovered_vol = h0 - ht
        replenishment_pct = (recovered_vol / h0) * 100.0

        if ht <= 1e-3 or recovered_vol >= h0 * 0.99:
            # Virtually 100% replenished
            half_life_ms = dt / 5.0
            resilience_hz = 1000.0 / max(1.0, half_life_ms)
        elif recovered_vol <= 1e-3:
            # Zero replenishment
            half_life_ms = 1000.0
            resilience_hz = 1.0
        else:
            # Analytical half-life
            ratio = h0 / max(1e-4, ht)
            ln_ratio = math.log(max(1.0001, ratio))
            tau = dt / ln_ratio
            half_life_ms = tau * math.log(2.0)
            resilience_hz = 1000.0 / max(1.0, tau)

        return CavityRecoveryMetric(
            initial_hole_volume=h0,
            current_hole_volume=ht,
            elapsed_time_ms=dt,
            replenishment_ratio_pct=replenishment_pct,
            estimated_half_life_ms=half_life_ms,
            resilience_rate_hz=resilience_hz,
        )

    def evaluate_book_resiliency(
        self,
        tiers: List[BookDepthTier],
        initial_sweep_volume: float,
        current_missing_volume: float,
        elapsed_since_sweep_ms: float,
    ) -> ShapeSentryDecision:
        """
        Synthesizes spatial book shape with dynamic cavity replenishment telemetry.
        """
        shape = self.fit_book_shape_function(tiers)
        cavity = self.track_replenishment_kernel(
            initial_sweep_volume, current_missing_volume, elapsed_since_sweep_ms
        )

        unreplenished_pct = 100.0 - cavity.replenishment_ratio_pct

        # Sentry Decision Rule Cascade
        if unreplenished_pct >= self.critical_hole_pct and elapsed_since_sweep_ms <= self.slow_barrier:
            regime = BookResiliencyRegimeState.FLASH_HOLE_UNREPLENISHED
            action = (
                f"AIR_POCKET_ALERT: Liquidity hole is {unreplenished_pct:.1f}% un-replenished "
                f"after {elapsed_since_sweep_ms:.0f}ms (half-life={cavity.estimated_half_life_ms:.0f}ms). "
                f"Secondary sweep will trigger flash jump; pull quotes."
            )
        elif cavity.estimated_half_life_ms <= self.fast_half_life and cavity.replenishment_ratio_pct >= 50.0:
            regime = BookResiliencyRegimeState.REPLENISHMENT_ACCELERATED
            action = (
                f"HIGH_RESILIENCY_RECOVERY: Book recovering fast (half-life {cavity.estimated_half_life_ms:.1f}ms). "
                f"Tight maker quoting safe."
            )
        else:
            regime = BookResiliencyRegimeState.EQUILIBRIUM_SHAPE
            action = (
                f"EQUILIBRIUM_BOOK: Shape peak at {shape.peak_distance_bps:.1f} bps "
                f"(alpha={shape.alpha_shape:.2f}, beta={shape.beta_decay:.2f})."
            )

        return ShapeSentryDecision(
            shape=shape,
            cavity=cavity,
            regime=regime,
            recommended_action=action,
            details={
                "peak_distance_bps": shape.peak_distance_bps,
                "half_life_ms": cavity.estimated_half_life_ms,
                "unreplenished_pct": unreplenished_pct,
                "resilience_hz": cavity.resilience_rate_hz,
            },
        )
