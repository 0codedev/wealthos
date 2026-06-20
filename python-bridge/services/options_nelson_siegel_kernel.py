"""
Cross-Asset Options Volatility Surface Term-Structure Level, Slope, Curvature Nelson-Siegel Kernel
Domain 278 / Work Package WP-FX

Decomposes the term structure of implied volatility across multi-tenor options surfaces
using the Nelson-Siegel (1987) parametric 3-factor formulation:
Level (beta_1), Slope (beta_2), and Curvature (beta_3).
Identifies calendar roll mispricings, term-structure inversion panics, and intermediate belly
curvature dislocations to direct institutional calendar arbitrage and volatility carry.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class VolTermStructureRegime(str, Enum):
    NORMAL_EQUILIBRIUM = "NORMAL_EQUILIBRIUM"              # Modest upward contango slope, mild curvature
    SEVERE_INVERSION_PANIC = "SEVERE_INVERSION_PANIC"      # beta_2 <= -0.05, front-month vol exploded
    STEEP_CONTANGO_EXPANSION = "STEEP_CONTANGO_EXPANSION"  # beta_2 >= +0.06, front-month vol depressed
    BELLY_CURVATURE_ARBITRAGE = "BELLY_CURVATURE_ARBITRAGE"# |beta_3| >= 0.07, extreme intermediate hump or dip


class CalendarArbitrageDirective(str, Enum):
    MAINTAIN_STANDARD_HEDGE = "MAINTAIN_STANDARD_HEDGE"    # Baseline delta/vega neutrality
    HARVEST_CALENDAR_ROLL_SHORT_FRONT = "HARVEST_CALENDAR_ROLL_SHORT_FRONT" # Short expensive front, long back-end
    BUY_CHEAP_FRONT_GAMMA = "BUY_CHEAP_FRONT_GAMMA"        # Long front gamma scalping, hedge back vega
    DEPLOY_CALENDAR_BUTTERFLY_ARB = "DEPLOY_CALENDAR_BUTTERFLY_ARB" # 1:-2:1 tenor calendar butterfly


@dataclass
class TenorQuote:
    tenor_years: float    # Time to expiry \tau in years (e.g. 7/365, 30/365, 90/365)
    implied_vol: float    # Market ATM implied volatility (e.g. 0.35 for 35%)


@dataclass
class NelsonSiegelConfig:
    decay_lambda: float = 8.0        # Decay parameter lambda (peaks curvature around tau ~ 60-90 days)
    ridge_regularizer: float = 1e-3  # Ridge penalty for stable 3-factor inversion
    inversion_threshold: float = 0.08 # Slope beta_2 boundary for severe inversion (front vol premium)
    contango_threshold: float = -0.08 # Slope beta_2 boundary for steep contango (front vol discount)
    curvature_threshold: float = 0.20 # Curvature |beta_3| boundary for butterfly arb


@dataclass
class TenorFittedPoint:
    tenor_years: float
    market_vol: float
    fitted_vol: float
    residual_vol: float


@dataclass
class NelsonSiegelAssessment:
    asset_id: str
    beta_level: float        # beta_1: Long-term asymptotic level
    beta_slope: float        # beta_2: Short-term vs long-term slope
    beta_curvature: float    # beta_3: Medium-term hump / belly curvature
    rmse: float              # Root mean squared error of fit
    regime: VolTermStructureRegime
    directive: CalendarArbitrageDirective
    recommended_calendar_spread: str
    fitted_curve: List[TenorFittedPoint]
    rationales: List[str] = field(default_factory=list)


class OptionsNelsonSiegelKernel:
    """
    Fits 3-factor Nelson-Siegel model to options implied volatility term structure
    and evaluates calendar arbitrage opportunities.
    """

    def __init__(self, config: Optional[NelsonSiegelConfig] = None):
        self.config = config or NelsonSiegelConfig()

    def compute_factor_loadings(self, tau: float) -> Tuple[float, float, float]:
        """
        Computes Nelson-Siegel basis loadings for maturity tau:
        f1 = 1.0 (Level)
        f2 = (1 - exp(-lambda * tau)) / (lambda * tau) (Slope)
        f3 = (1 - exp(-lambda * tau)) / (lambda * tau) - exp(-lambda * tau) (Curvature)
        """
        lam = self.config.decay_lambda
        lam_tau = max(1e-6, lam * max(1e-4, tau))

        f1 = 1.0
        exp_neg = math.exp(-lam_tau)
        f2 = (1.0 - exp_neg) / lam_tau
        f3 = f2 - exp_neg

        return f1, f2, f3

    def fit_nelson_siegel(
        self,
        quotes: List[TenorQuote],
    ) -> Tuple[float, float, float, float, List[TenorFittedPoint]]:
        """
        Fits (beta_1, beta_2, beta_3) via regularized OLS on quotes.
        Returns: (beta_1, beta_2, beta_3, rmse, fitted_points)
        """
        M = len(quotes)
        if M < 3:
            # Fallback if fewer than 3 tenors: average vol as level
            avg_vol = sum(q.implied_vol for q in quotes) / max(1, M)
            pts = [
                TenorFittedPoint(q.tenor_years, q.implied_vol, avg_vol, q.implied_vol - avg_vol)
                for q in quotes
            ]
            return avg_vol, 0.0, 0.0, 0.0, pts

        # Build H matrix (M x 3) and y vector (M x 1)
        H: List[Tuple[float, float, float]] = []
        y: List[float] = []

        for q in quotes:
            f1, f2, f3 = self.compute_factor_loadings(q.tenor_years)
            H.append((f1, f2, f3))
            y.append(q.implied_vol)

        # Compute H^T H (3x3) and H^T y (3x1)
        HtH = [[0.0] * 3 for _ in range(3)]
        Hty = [0.0] * 3

        for i in range(M):
            h_row = H[i]
            target = y[i]
            for r in range(3):
                Hty[r] += h_row[r] * target
                for c in range(3):
                    HtH[r][c] += h_row[r] * h_row[c]

        # Add Ridge regularization
        for r in range(3):
            HtH[r][r] += self.config.ridge_regularizer

        # Solve 3x3 linear system via Cramer's rule / direct inversion
        det = (
            HtH[0][0] * (HtH[1][1] * HtH[2][2] - HtH[1][2] * HtH[2][1])
            - HtH[0][1] * (HtH[1][0] * HtH[2][2] - HtH[1][2] * HtH[2][0])
            + HtH[0][2] * (HtH[1][0] * HtH[2][1] - HtH[1][1] * HtH[2][0])
        )

        if abs(det) < 1e-12:
            avg_vol = sum(y) / M
            pts = [
                TenorFittedPoint(quotes[i].tenor_years, quotes[i].implied_vol, avg_vol, quotes[i].implied_vol - avg_vol)
                for i in range(M)
            ]
            return avg_vol, 0.0, 0.0, 0.0, pts

        # Invert 3x3 matrix
        inv = [[0.0] * 3 for _ in range(3)]
        inv[0][0] = (HtH[1][1] * HtH[2][2] - HtH[1][2] * HtH[2][1]) / det
        inv[0][1] = (HtH[0][2] * HtH[2][1] - HtH[0][1] * HtH[2][2]) / det
        inv[0][2] = (HtH[0][1] * HtH[1][2] - HtH[0][2] * HtH[1][1]) / det

        inv[1][0] = (HtH[1][2] * HtH[2][0] - HtH[1][0] * HtH[2][2]) / det
        inv[1][1] = (HtH[0][0] * HtH[2][2] - HtH[0][2] * HtH[2][0]) / det
        inv[1][2] = (HtH[0][2] * HtH[1][0] - HtH[0][0] * HtH[1][2]) / det

        inv[2][0] = (HtH[1][0] * HtH[2][1] - HtH[1][1] * HtH[2][0]) / det
        inv[2][1] = (HtH[0][1] * HtH[2][0] - HtH[0][0] * HtH[2][1]) / det
        inv[2][2] = (HtH[0][0] * HtH[1][1] - HtH[0][1] * HtH[1][0]) / det

        b1 = inv[0][0] * Hty[0] + inv[0][1] * Hty[1] + inv[0][2] * Hty[2]
        b2 = inv[1][0] * Hty[0] + inv[1][1] * Hty[1] + inv[1][2] * Hty[2]
        b3 = inv[2][0] * Hty[0] + inv[2][1] * Hty[1] + inv[2][2] * Hty[2]

        # Calculate fitted points and RMSE
        fitted_pts: List[TenorFittedPoint] = []
        sq_err_sum = 0.0

        for i in range(M):
            f1, f2, f3 = H[i]
            fitted_val = b1 * f1 + b2 * f2 + b3 * f3
            res_val = y[i] - fitted_val
            sq_err_sum += res_val ** 2
            fitted_pts.append(
                TenorFittedPoint(
                    tenor_years=quotes[i].tenor_years,
                    market_vol=quotes[i].implied_vol,
                    fitted_vol=fitted_val,
                    residual_vol=res_val,
                )
            )

        rmse = math.sqrt(sq_err_sum / M)
        return b1, b2, b3, rmse, fitted_pts

    def evaluate_surface_term_structure(
        self,
        asset_id: str,
        quotes: List[TenorQuote],
    ) -> NelsonSiegelAssessment:
        """
        Evaluates full implied volatility term structure and returns classification and directives.
        - beta_2 >= inversion_threshold: Front vol elevated (panic inversion)
        - beta_2 <= contango_threshold: Front vol depressed (steep contango)
        - |beta_3| >= curvature_threshold and |beta_3| > |beta_2|: Intermediate belly dislocation
        - Otherwise: Normal equilibrium
        """
        sorted_quotes = sorted(quotes, key=lambda q: q.tenor_years)
        b1, b2, b3, rmse, fitted_pts = self.fit_nelson_siegel(sorted_quotes)

        rationales: List[str] = []

        if abs(b3) >= self.config.curvature_threshold and abs(b3) > abs(b2):
            regime = VolTermStructureRegime.BELLY_CURVATURE_ARBITRAGE
            directive = CalendarArbitrageDirective.DEPLOY_CALENDAR_BUTTERFLY_ARB
            spread_rec = "1x_T1_-2x_T2_+1x_T3_CALENDAR_BUTTERFLY"
            direction = "positive hump" if b3 > 0 else "negative belly depression"
            rationales.append(
                f"Pronounced term-structure curvature dislocation detected (Curvature beta_3 = {b3:+.3f}, {direction}). "
                f"Intermediate expiry dislocated from smooth curve; execute 1:-2:1 calendar butterfly."
            )
        elif b2 >= self.config.inversion_threshold:
            regime = VolTermStructureRegime.SEVERE_INVERSION_PANIC
            directive = CalendarArbitrageDirective.HARVEST_CALENDAR_ROLL_SHORT_FRONT
            spread_rec = "SHORT_T1_LONG_T3_CALENDAR"
            rationales.append(
                f"Severe volatility term-structure backwardation detected (Slope beta_2 = {b2:+.3f} >= {self.config.inversion_threshold:.3f}). "
                f"Front-month implied volatility carries acute panic premium. Deploy short front / long back-month calendar carry."
            )
        elif b2 <= self.config.contango_threshold:
            regime = VolTermStructureRegime.STEEP_CONTANGO_EXPANSION
            directive = CalendarArbitrageDirective.BUY_CHEAP_FRONT_GAMMA
            spread_rec = "LONG_T1_SHORT_T3_CALENDAR"
            rationales.append(
                f"Steep volatility contango detected (Slope beta_2 = {b2:+.3f} <= {self.config.contango_threshold:.3f}). "
                f"Front-month implied vol is deeply underpriced relative to back-end. Acquire cheap front gamma scalping."
            )
        else:
            regime = VolTermStructureRegime.NORMAL_EQUILIBRIUM
            directive = CalendarArbitrageDirective.MAINTAIN_STANDARD_HEDGE
            spread_rec = "NO_CALENDAR_SKEW_REQUIRED"
            rationales.append(
                f"Implied volatility term structure within normal equilibrium bounds "
                f"(Level beta_1={b1:.3f}, Slope beta_2={b2:+.3f}, Curvature beta_3={b3:+.3f}, RMSE={rmse:.4f})."
            )

        return NelsonSiegelAssessment(
            asset_id=asset_id,
            beta_level=b1,
            beta_slope=b2,
            beta_curvature=b3,
            rmse=rmse,
            regime=regime,
            directive=directive,
            recommended_calendar_spread=spread_rec,
            fitted_curve=fitted_pts,
            rationales=rationales,
        )
