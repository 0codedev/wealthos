"""
Cross-Asset Options Volatility Surface Skew Arbitrage & Local Volatility Mixture Calibration Engine
Domain 254 / Work Package WP-EZ

Evaluates real-time options volatility surfaces for calendar variance monotonicity
and Durrleman-Breeden-Litzenberger butterfly risk-neutral density non-negativity,
calibrates Dupire local volatility mixtures, and extracts structural options arbitrage alpha.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class SurfaceArbitrageRegime(str, Enum):
    SURFACE_NO_ARBITRAGE_VALIDATED = "SURFACE_NO_ARBITRAGE_VALIDATED"    # Clean surface, g(y) >= 0 and dw/dt >= 0
    CALENDAR_VARIANCE_INVERSION = "CALENDAR_VARIANCE_INVERSION"          # dw/dt < 0 (free calendar variance arbitrage)
    BUTTERFLY_DENSITY_NEGATIVE = "BUTTERFLY_DENSITY_NEGATIVE"            # g(y) < 0 (negative risk-neutral density, butterfly arb)
    EXTREME_SURFACE_DISTORTION = "EXTREME_SURFACE_DISTORTION"            # Both calendar and butterfly bounds violated


class OptionsArbDirective(str, Enum):
    MONITOR_CLEAN_SURFACE = "MONITOR_CLEAN_SURFACE"                      # Clean surface, quote maker spreads safely
    EXECUTE_FREE_CALENDAR_ARBITRAGE = "EXECUTE_FREE_CALENDAR_ARBITRAGE"  # Buy T2, Sell T1 calendar spread
    EXECUTE_BUTTERFLY_SPREAD_ARBITRAGE = "EXECUTE_BUTTERFLY_SPREAD_ARBITRAGE" # Buy wings, Sell belly 1:2:1 butterfly
    PULL_VOL_SURFACE_QUOTES = "PULL_VOL_SURFACE_QUOTES"                  # Pull all quoting, severe surface breakdown


@dataclass
class StrikeMaturityPoint:
    strike: float
    maturity_years: float
    implied_vol: float
    forward_price: float


@dataclass
class SurfaceArbitrageAssessment:
    underlying: str
    calendar_min_forward_variance: float
    butterfly_min_density_curvature: float
    calibrated_local_vol: float
    arbitrage_edge_bps: float
    regime: SurfaceArbitrageRegime
    directive: OptionsArbDirective
    rationales: List[str] = field(default_factory=list)


class OptionsSkewLocalVolEngine:
    """
    Sub-millisecond options surface arbitrage detector and Dupire local volatility calibrator.
    """

    def __init__(self, min_arb_edge_bps: float = 5.0):
        self.min_arb_edge_bps = min_arb_edge_bps

    def total_variance(self, iv: float, t: float) -> float:
        """w(K, T) = sigma^2 * T"""
        return (iv ** 2) * max(1e-6, t)

    def calculate_durrleman_density_curvature(
        self, w: float, dw_dy: float, d2w_dy2: float, y: float
    ) -> float:
        """
        Durrleman (2002) / Gatheral formula for non-negative risk neutral density:
        g(y) = (1 - (y * w')/(2w))^2 - (w'^2 / 4)*(1/w + 1/4) + (w'' / 2)
        If g(y) < 0, density is negative -> butterfly arbitrage exists!
        """
        if w <= 1e-6:
            return 1.0

        term1 = (1.0 - (y * dw_dy) / (2.0 * w)) ** 2
        term2 = ((dw_dy ** 2) / 4.0) * ((1.0 / w) + 0.25)
        term3 = d2w_dy2 / 2.0

        g_y = term1 - term2 + term3
        return g_y

    def calibrate_dupire_local_vol(
        self, w: float, dw_dt: float, dw_dy: float, d2w_dy2: float, y: float
    ) -> Optional[float]:
        """
        Computes Dupire local volatility sigma_loc(K, T):
        sigma_loc^2 = (dw/dt) / g(y)
        """
        g_y = self.calculate_durrleman_density_curvature(w, dw_dy, d2w_dy2, y)
        if g_y <= 1e-6 or dw_dt < 0.0:
            return None  # Arbitrage breach or undefined local variance
        loc_var = dw_dt / g_y
        return math.sqrt(max(0.0, loc_var))

    def evaluate_surface(
        self,
        underlying: str,
        t1_point: StrikeMaturityPoint,
        t2_point: StrikeMaturityPoint,
        dw_dy: float = 0.0,
        d2w_dy2: float = 0.0,
    ) -> SurfaceArbitrageAssessment:
        rationales: List[str] = []

        # 1. Calendar Variance Monotonicity
        w1 = self.total_variance(t1_point.implied_vol, t1_point.maturity_years)
        w2 = self.total_variance(t2_point.implied_vol, t2_point.maturity_years)
        dt = t2_point.maturity_years - t1_point.maturity_years
        dw_dt = (w2 - w1) / max(1e-4, dt) if dt > 0 else 0.0

        calendar_violation = (w2 < w1) and (dt > 0.0)

        # 2. Butterfly Risk-Neutral Density Curvature at T1
        # Log moneyness y = ln(K / F)
        fwd = max(1e-4, t1_point.forward_price)
        y = math.log(t1_point.strike / fwd)

        g_y = self.calculate_durrleman_density_curvature(w1, dw_dy, d2w_dy2, y)
        butterfly_violation = g_y < 0.0

        # 3. Local Volatility Calibration
        loc_vol = self.calibrate_dupire_local_vol(w1, dw_dt, dw_dy, d2w_dy2, y)
        calibrated_loc_vol = loc_vol if loc_vol is not None else 0.0

        # 4. Regime Classification & Execution Directives
        if calendar_violation and butterfly_violation:
            regime = SurfaceArbitrageRegime.EXTREME_SURFACE_DISTORTION
            directive = OptionsArbDirective.PULL_VOL_SURFACE_QUOTES
            arb_edge_bps = abs(w2 - w1) * 10000.0
            rationales.append(
                f"Severe surface breakdown: Both calendar inversion (dw={w2-w1:.5f}) and "
                f"butterfly density breach (g(y)={g_y:.4f} < 0) detected. Pulling surface quotes."
            )

        elif calendar_violation:
            regime = SurfaceArbitrageRegime.CALENDAR_VARIANCE_INVERSION
            directive = OptionsArbDirective.EXECUTE_FREE_CALENDAR_ARBITRAGE
            arb_edge_bps = abs(w2 - w1) * 10000.0
            rationales.append(
                f"Calendar variance inversion detected: w(T2)={w2:.5f} < w(T1)={w1:.5f} "
                f"(Forward variance={dw_dt:.4f} < 0). Execute calendar arbitrage to capture {arb_edge_bps:.1f} bps."
            )

        elif butterfly_violation:
            regime = SurfaceArbitrageRegime.BUTTERFLY_DENSITY_NEGATIVE
            directive = OptionsArbDirective.EXECUTE_BUTTERFLY_SPREAD_ARBITRAGE
            arb_edge_bps = abs(g_y) * 100.0
            rationales.append(
                f"Negative risk-neutral density detected: Durrleman curvature g(y)={g_y:.4f} < 0. "
                f"Execute 1:2:1 butterfly arbitrage to capture synthetic free density."
            )

        else:
            regime = SurfaceArbitrageRegime.SURFACE_NO_ARBITRAGE_VALIDATED
            directive = OptionsArbDirective.MONITOR_CLEAN_SURFACE
            arb_edge_bps = 0.0
            rationales.append(
                f"Clean no-arbitrage volatility surface: dw/dt={dw_dt:.4f} >= 0, g(y)={g_y:.4f} >= 0. "
                f"Dupire local volatility calibrated to {calibrated_loc_vol*100:.2f}%."
            )

        return SurfaceArbitrageAssessment(
            underlying=underlying,
            calendar_min_forward_variance=round(dw_dt, 5),
            butterfly_min_density_curvature=round(g_y, 5),
            calibrated_local_vol=round(calibrated_loc_vol, 4),
            arbitrage_edge_bps=round(arb_edge_bps, 2),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
