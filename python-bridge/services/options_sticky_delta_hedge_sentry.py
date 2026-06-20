"""
Domain 270 / WP-FP: Real-Time Options Surface Wing Sticky-Strike vs Sticky-Delta Hedging Sentry
=============================================================================================
Institutional quantitative options sentry detecting sticky-strike vs sticky-delta smile dynamics,
calculating the skew slope modified delta correction, and preventing wing delta hedging leakage.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional
import math


class SmileDynamicsRegime(str, Enum):
    STICKY_STRIKE_EQUILIBRIUM = "STICKY_STRIKE_EQUILIBRIUM"
    STICKY_DELTA_WING_UNDERHEDGE_HAZARD = "STICKY_DELTA_WING_UNDERHEDGE_HAZARD"
    MIXED_LOCAL_VOL_DYNAMICS = "MIXED_LOCAL_VOL_DYNAMICS"


class SmileHedgeDirective(str, Enum):
    MAINTAIN_BS_DELTA = "MAINTAIN_BS_DELTA"
    APPLY_SKEW_MODIFIED_DELTA_CORRECTION = "APPLY_SKEW_MODIFIED_DELTA_CORRECTION"
    APPLY_INTERPOLATED_HYBRID_DELTA = "APPLY_INTERPOLATED_HYBRID_DELTA"


@dataclass
class OptionWingParameters:
    strike: float
    spot: float
    implied_vol: float       # e.g., 0.25 for 25%
    skew_slope_dvol_dstrike: float # dSigma / dK (typically negative for equities/crypto index puts)
    bs_delta: float          # Standard Black-Scholes delta
    bs_vega: float           # dPrice / dSigma (unscaled)
    contract_size: float = 100.0


@dataclass
class StickyDeltaAssessment:
    symbol: str
    strike: float
    spot: float
    sticky_regime_ratio: float
    bs_delta: float
    skew_correction_term: float
    effective_skew_adjusted_delta: float
    delta_leakage_shares: float
    regime: SmileDynamicsRegime
    directive: SmileHedgeDirective
    rationales: List[str] = field(default_factory=list)


class OptionsStickyDeltaHedgeSentry:
    """
    Evaluates options smile dynamics to determine whether the surface exhibits sticky-strike
    or sticky-delta behavior, and calculates the exact modified delta correction needed to
    prevent wing delta leakage during market drops.
    """

    def __init__(
        self,
        sticky_delta_ratio_hurdle: float = 0.70,   # R >= 0.70 is predominantly sticky-delta
        sticky_strike_ratio_hurdle: float = 0.30,  # R <= 0.30 is predominantly sticky-strike
        min_leakage_shares_hurdle: float = 5.0,    # 5 shares of leakage triggers alert
    ):
        self.sticky_delta_hurdle = sticky_delta_ratio_hurdle
        self.sticky_strike_hurdle = sticky_strike_ratio_hurdle
        self.min_leakage_shares = min_leakage_shares_hurdle

    def calculate_skew_slope_wrt_spot(
        self,
        strike: float,
        spot: float,
        dvol_dstrike: float,
    ) -> float:
        """
        Under sticky-moneyness (K/S), dSigma / dS = -(K / S^2) * (dSigma / dm) = -(K / S) * dvol_dstrike
        """
        return -(strike / max(1e-4, spot)) * dvol_dstrike

    def evaluate_wing_hedging(
        self,
        symbol: str,
        wing: OptionWingParameters,
        empirical_regime_ratio: float = 1.0,  # 1.0 = Pure Sticky Delta, 0.0 = Pure Sticky Strike
    ) -> StickyDeltaAssessment:
        rationales = []
        r_sticky = max(0.0, min(1.0, empirical_regime_ratio))

        # Under sticky moneyness: dSigma/dS
        dvol_ds = self.calculate_skew_slope_wrt_spot(
            strike=wing.strike,
            spot=wing.spot,
            dvol_dstrike=wing.skew_slope_dvol_dstrike,
        )

        # Skew correction: Vega * (dSigma / dS)
        # Note: bs_vega is dC / dSigma
        skew_correction = wing.bs_vega * dvol_ds

        # Effective modified delta
        effective_delta = wing.bs_delta + (r_sticky * skew_correction)
        delta_leakage_shares = abs(effective_delta - wing.bs_delta) * wing.contract_size

        # Decision State Machine
        if r_sticky >= self.sticky_delta_hurdle and delta_leakage_shares >= self.min_leakage_shares:
            regime = SmileDynamicsRegime.STICKY_DELTA_WING_UNDERHEDGE_HAZARD
            directive = SmileHedgeDirective.APPLY_SKEW_MODIFIED_DELTA_CORRECTION
            rationales.append(
                f"Sticky-delta smile regime confirmed on {symbol} (K={wing.strike:.1f}, S={wing.spot:.1f}): "
                f"Regime ratio={r_sticky:.2f}, Skew slope dSigma/dK={wing.skew_slope_dvol_dstrike:.4f}. "
                f"Standard BS delta ({wing.bs_delta:+.3f}) severely underhedges wing risk; "
                f"Effective Delta={effective_delta:+.3f} (Leakage={delta_leakage_shares:.1f} shares). "
                f"Adjust hedge ratio immediately to account for skew slope correction ({skew_correction:+.3f})."
            )
        elif r_sticky <= self.sticky_strike_hurdle:
            regime = SmileDynamicsRegime.STICKY_STRIKE_EQUILIBRIUM
            directive = SmileHedgeDirective.MAINTAIN_BS_DELTA
            rationales.append(
                f"Sticky-strike equilibrium on {symbol}: Surface remains anchored to absolute strikes "
                f"(Ratio={r_sticky:.2f}). Standard Black-Scholes delta ({wing.bs_delta:+.3f}) is optimal."
            )
        else:
            regime = SmileDynamicsRegime.MIXED_LOCAL_VOL_DYNAMICS
            directive = SmileHedgeDirective.APPLY_INTERPOLATED_HYBRID_DELTA
            rationales.append(
                f"Mixed smile dynamics on {symbol}: Ratio={r_sticky:.2f}. "
                f"Apply linear hybrid delta ({effective_delta:+.3f}) between sticky-strike and sticky-delta."
            )

        return StickyDeltaAssessment(
            symbol=symbol,
            strike=round(wing.strike, 2),
            spot=round(wing.spot, 2),
            sticky_regime_ratio=round(r_sticky, 3),
            bs_delta=round(wing.bs_delta, 4),
            skew_correction_term=round(skew_correction, 4),
            effective_skew_adjusted_delta=round(effective_delta, 4),
            delta_leakage_shares=round(delta_leakage_shares, 2),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
