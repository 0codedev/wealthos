"""
Domain 265 / WP-FK: Intraday Volume Profile Fractal Rescaling & VWAP Execution Anchor Sentry
=============================================================================================
Institutional quantitative execution sentry for algorithmic order slicing (VWAP/TWAP).
Implements Mandelbrot multifractal volume scaling, dynamic diurnal volume curve rescaling,
real-time VWAP slippage attribution, and adaptive participation rate governance.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional
import math


class PacingRegime(str, Enum):
    OPTIMAL_ALIGNED_PACING = "OPTIMAL_ALIGNED_PACING"
    VOLUME_SURGE_ACCELERATE = "VOLUME_SURGE_ACCELERATE"
    VOLUME_DROUGHT_DECELERATE = "VOLUME_DROUGHT_DECELERATE"
    ADVERSE_VWAP_SLIPPAGE_BREACH = "ADVERSE_VWAP_SLIPPAGE_BREACH"


class ExecutionDirective(str, Enum):
    MAINTAIN_TARGET_PARTICIPATION = "MAINTAIN_TARGET_PARTICIPATION"
    EXPAND_PARTICIPATION_ALLOWANCE = "EXPAND_PARTICIPATION_ALLOWANCE"
    CURTAIL_EXECUTION_PACING = "CURTAIL_EXECUTION_PACING"
    HALT_AND_REPROFILE_ORDER = "HALT_AND_REPROFILE_ORDER"


@dataclass
class VolumeSliceObservation:
    timestamp_sec: float
    market_price: float
    market_volume: float
    our_filled_volume: float
    our_fill_cost: float  # our_filled_volume * our_fill_price


@dataclass
class VWAPPacingAssessment:
    symbol: str
    elapsed_day_fraction: float
    expected_cumulative_volume_fraction: float
    realized_cumulative_market_volume: float
    pacing_ratio: float
    market_vwap: float
    our_vwap: float
    slippage_bps: float
    recommended_participation_rate: float
    regime: PacingRegime
    directive: ExecutionDirective
    rationales: List[str] = field(default_factory=list)


class VolumeFractalVWAPAnchorSentry:
    """
    Intraday Volume Profile Fractal Rescaling and VWAP Execution Anchor Sentry.
    Anchors execution slices to nonlinear diurnal volume distributions and controls
    market footprint slippage.
    """

    def __init__(
        self,
        base_participation_rate: float = 0.05,  # 5% target participation
        max_participation_cap: float = 0.15,    # 15% hard ceiling
        min_participation_floor: float = 0.01,  # 1% floor during low liquidity
        max_slippage_hurdle_bps: float = 8.0,   # 8 bps adverse slippage tolerance
        fractal_alpha: float = 0.85,            # Mandelbrot volume scaling exponent
    ):
        self.base_pr = base_participation_rate
        self.max_pr = max_participation_cap
        self.min_pr = min_participation_floor
        self.max_slippage_bps = max_slippage_hurdle_bps
        self.fractal_alpha = fractal_alpha

    def expected_volume_fraction(self, t: float) -> float:
        """
        Calculates expected cumulative volume fraction at normalized time t in [0, 1].
        Uses a generalized diurnal polynomial approximation exhibiting morning/close U-curve:
        V(t) = 0.40 * t^alpha + 0.60 * t^(1/alpha) adjusted to guarantee V(0)=0 and V(1)=1.
        """
        t = max(0.0, min(1.0, t))
        if t <= 0.0:
            return 0.0
        if t >= 1.0:
            return 1.0

        # Nonlinear diurnal profile with fractal scaling
        # Front-loaded open + end-of-day surge
        term_open = math.pow(t, self.fractal_alpha)
        term_close = math.pow(t, 1.0 / max(0.1, self.fractal_alpha))
        expected = 0.45 * term_open + 0.55 * term_close
        return max(0.0, min(1.0, expected))

    def evaluate_execution(
        self,
        symbol: str,
        elapsed_fraction: float,
        slices: List[VolumeSliceObservation],
        expected_full_day_volume: float,
        side: str = "BUY",  # "BUY" or "SELL"
    ) -> VWAPPacingAssessment:
        rationales = []
        t = max(0.001, min(1.0, elapsed_fraction))
        expected_frac = self.expected_volume_fraction(t)
        expected_vol_to_now = expected_frac * max(1.0, expected_full_day_volume)

        # Cumulative volume and cost tracking
        total_market_vol = sum(s.market_volume for s in slices)
        total_market_turnover = sum(s.market_price * s.market_volume for s in slices)
        total_our_vol = sum(s.our_filled_volume for s in slices)
        total_our_cost = sum(s.our_fill_cost for s in slices)

        # Market VWAP
        if total_market_vol > 0:
            market_vwap = total_market_turnover / total_market_vol
        else:
            market_vwap = slices[-1].market_price if slices else 100.0

        # Our VWAP
        if total_our_vol > 0:
            our_vwap = total_our_cost / total_our_vol
        else:
            our_vwap = market_vwap

        # Pacing ratio (realized vs diurnal model)
        pacing_ratio = total_market_vol / max(1.0, expected_vol_to_now)

        # Slippage calculation
        # For BUY: our_vwap > market_vwap is positive slippage (underperformed)
        # For SELL: our_vwap < market_vwap is positive slippage (underperformed)
        if side.upper() == "BUY":
            slippage_bps = ((our_vwap - market_vwap) / max(1e-6, market_vwap)) * 10000.0
        else:
            slippage_bps = ((market_vwap - our_vwap) / max(1e-6, market_vwap)) * 10000.0

        # Adaptive participation rate calculation
        # Scale with pacing ratio and penalize if slippage is positive
        slippage_penalty = max(0.0, 1.0 - (max(0.0, slippage_bps) / 20.0))
        raw_recommended_pr = self.base_pr * pacing_ratio * slippage_penalty
        recommended_pr = max(self.min_pr, min(self.max_pr, raw_recommended_pr))

        # Regime & Directive Decision Logic
        if slippage_bps >= self.max_slippage_bps:
            regime = PacingRegime.ADVERSE_VWAP_SLIPPAGE_BREACH
            directive = ExecutionDirective.HALT_AND_REPROFILE_ORDER
            recommended_pr = self.min_pr
            rationales.append(
                f"Adverse VWAP slippage breach on {symbol} ({side}): Slippage={slippage_bps:.1f} bps "
                f"exceeds hurdle of {self.max_slippage_bps:.1f} bps. Execution footprint too toxic. "
                f"Halting active aggressions and curtailing participation to floor {self.min_pr*100:.1f}%."
            )
        elif pacing_ratio >= 1.25:
            regime = PacingRegime.VOLUME_SURGE_ACCELERATE
            directive = ExecutionDirective.EXPAND_PARTICIPATION_ALLOWANCE
            rationales.append(
                f"Intraday volume surge on {symbol}: Pacing ratio={pacing_ratio:.2f}x historical baseline. "
                f"Deep market liquidity allows expanding execution participation to {recommended_pr*100:.1f}%."
            )
        elif pacing_ratio <= 0.75:
            regime = PacingRegime.VOLUME_DROUGHT_DECELERATE
            directive = ExecutionDirective.CURTAIL_EXECUTION_PACING
            rationales.append(
                f"Volume drought on {symbol}: Pacing ratio={pacing_ratio:.2f}x below normal curve. "
                f"Slowing slice release to prevent adverse price impact; target PR={recommended_pr*100:.1f}%."
            )
        else:
            regime = PacingRegime.OPTIMAL_ALIGNED_PACING
            directive = ExecutionDirective.MAINTAIN_TARGET_PARTICIPATION
            rationales.append(
                f"Optimal diurnal volume tracking on {symbol}: Pacing ratio={pacing_ratio:.2f}x, "
                f"Slippage={slippage_bps:+.1f} bps. Participation stable at {recommended_pr*100:.1f}%."
            )

        return VWAPPacingAssessment(
            symbol=symbol,
            elapsed_day_fraction=round(t, 4),
            expected_cumulative_volume_fraction=round(expected_frac, 4),
            realized_cumulative_market_volume=round(total_market_vol, 2),
            pacing_ratio=round(pacing_ratio, 3),
            market_vwap=round(market_vwap, 4),
            our_vwap=round(our_vwap, 4),
            slippage_bps=round(slippage_bps, 2),
            recommended_participation_rate=round(recommended_pr, 4),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
