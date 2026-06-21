"""
Intraday Realized Volatility Rough Heston Fractional Hurst Exponent Estimator
Domain 259 / Work Package WP-FE

Estimates the fractional Hurst parameter H of high-frequency realized volatility series
via multi-scale variogram log-log regressions, validates Gatheral-Jaisson-Rosenbaum
sub-diffusive roughness (H < 0.20), and calibrates power-law short-dated implied volatility skew scaling.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class RoughnessRegime(str, Enum):
    ULTRA_ROUGH_FRACTAL_SURFACE = "ULTRA_ROUGH_FRACTAL_SURFACE"          # H <= 0.15, extreme short-tenor skew blow-up
    MODERATELY_ROUGH_HESTON = "MODERATELY_ROUGH_HESTON"                  # 0.15 < H <= 0.35, canonical equity roughness
    CLASSICAL_MARKOVIAN_DIFFUSION = "CLASSICAL_MARKOVIAN_DIFFUSION"      # 0.35 < H <= 0.60, standard Brownian motion (H ~ 0.5)
    PERSISTENT_LONG_MEMORY_DRIFT = "PERSISTENT_LONG_MEMORY_DRIFT"        # H > 0.60, trending long-memory volatility


class VolSurfaceCalibrationDirective(str, Enum):
    APPLY_POWER_LAW_SKEW_BOOST = "APPLY_POWER_LAW_SKEW_BOOST"            # Boost ultra-short wing pricing; tau^(H-0.5) explosion
    STANDARD_ROUGH_HESTON_CALIBRATION = "STANDARD_ROUGH_HESTON_CALIBRATION" # Use fractional Riemann-Liouville vol kernel
    USE_CLASSICAL_HESTON_DIFFUSION = "USE_CLASSICAL_HESTON_DIFFUSION"    # Classical Heston CIR process valid
    LONG_MEMORY_TREND_FILTER = "LONG_MEMORY_TREND_FILTER"                # Apply persistent trend-following volatility hedge


@dataclass
class RealizedVolSeriesInput:
    asset_id: str
    log_realized_vols: List[float]       # ln(RV_t) or ln(sigma_t)
    sampling_interval_sec: float = 60.0  # 1-minute sampling
    max_lag: int = 15                    # Compute lags up to 15 intervals


@dataclass
class RoughHestonAssessment:
    asset_id: str
    estimated_hurst_h: float
    variogram_r_squared: float
    short_dated_skew_scaling_exponent: float  # H - 0.5
    regime: RoughnessRegime
    directive: VolSurfaceCalibrationDirective
    rationales: List[str] = field(default_factory=list)


class RoughHestonHurstEstimator:
    """
    Multi-scale structure function variogram estimator for fractional Brownian volatility.
    """

    def __init__(self, min_data_points: int = 20):
        self.min_data_points = min_data_points

    def calculate_variogram(
        self, vols: List[float], max_lag: int, q: float = 1.0
    ) -> List[Tuple[float, float]]:
        """
        Calculates m(q, Delta) = (1 / (N - Delta)) * sum |v_{t+Delta} - v_t|^q
        Returns list of (Delta, m(q, Delta))
        """
        n = len(vols)
        results: List[Tuple[float, float]] = []

        for delta in range(1, min(max_lag + 1, n // 2)):
            diffs = [
                abs(vols[t + delta] - vols[t]) ** q
                for t in range(n - delta)
            ]
            if diffs:
                mean_diff = sum(diffs) / len(diffs)
                if mean_diff > 1e-9:
                    results.append((float(delta), mean_diff))

        return results

    def estimate_hurst_regression(
        self, variogram: List[Tuple[float, float]], q: float = 1.0
    ) -> Tuple[float, float]:
        """
        Regresses ln(m(q, Delta)) = ln(c_q) + q * H * ln(Delta)
        Returns: (H, R_squared)
        """
        if len(variogram) < 3:
            return 0.5, 0.0

        x_vals = [math.log(delta) for delta, _ in variogram]
        y_vals = [math.log(m) for _, m in variogram]

        n = len(x_vals)
        mean_x = sum(x_vals) / n
        mean_y = sum(y_vals) / n

        ss_xx = sum((x - mean_x) ** 2 for x in x_vals)
        ss_yy = sum((y - mean_y) ** 2 for y in y_vals)
        ss_xy = sum((x - mean_x) * (y - mean_y) for x, y in zip(x_vals, y_vals))

        if ss_xx < 1e-9:
            return 0.5, 0.0

        slope = ss_xy / ss_xx
        r_sq = ((ss_xy ** 2) / (ss_xx * ss_yy)) if ss_yy > 1e-9 else 1.0

        h = slope / q
        h = max(0.01, min(0.99, h))
        return h, max(0.0, min(1.0, r_sq))

    def evaluate(self, series: RealizedVolSeriesInput) -> RoughHestonAssessment:
        rationales: List[str] = []

        if len(series.log_realized_vols) < self.min_data_points:
            rationales.append(
                f"Insufficient data points ({len(series.log_realized_vols)} < {self.min_data_points}). "
                f"Defaulting to classical Markovian H=0.50."
            )
            return RoughHestonAssessment(
                asset_id=series.asset_id,
                estimated_hurst_h=0.50,
                variogram_r_squared=0.0,
                short_dated_skew_scaling_exponent=0.0,
                regime=RoughnessRegime.CLASSICAL_MARKOVIAN_DIFFUSION,
                directive=VolSurfaceCalibrationDirective.USE_CLASSICAL_HESTON_DIFFUSION,
                rationales=rationales,
            )

        variogram = self.calculate_variogram(
            series.log_realized_vols, series.max_lag, q=1.0
        )
        h, r_sq = self.estimate_hurst_regression(variogram, q=1.0)
        skew_exp = h - 0.5

        # Regime Classification
        if h <= 0.15:
            regime = RoughnessRegime.ULTRA_ROUGH_FRACTAL_SURFACE
            directive = VolSurfaceCalibrationDirective.APPLY_POWER_LAW_SKEW_BOOST
            rationales.append(
                f"Ultra-rough volatility surface detected on {series.asset_id}: Hurst H={h:.3f} <= 0.15 (R^2={r_sq:.2f}). "
                f"Short-dated ATM skew exhibits power-law blow-up tau^({skew_exp:.2f}). "
                f"Boost short-dated OTM option wings and widen maker spreads."
            )

        elif h <= 0.35:
            regime = RoughnessRegime.MODERATELY_ROUGH_HESTON
            directive = VolSurfaceCalibrationDirective.STANDARD_ROUGH_HESTON_CALIBRATION
            rationales.append(
                f"Moderately rough volatility on {series.asset_id}: Hurst H={h:.3f} in (0.15, 0.35] (R^2={r_sq:.2f}). "
                f"Matches Gatheral-Jaisson-Rosenbaum stylized empirical roughness. Calibrate fractional Riemann-Liouville kernel."
            )

        elif h <= 0.60:
            regime = RoughnessRegime.CLASSICAL_MARKOVIAN_DIFFUSION
            directive = VolSurfaceCalibrationDirective.USE_CLASSICAL_HESTON_DIFFUSION
            rationales.append(
                f"Classical Markovian volatility on {series.asset_id}: Hurst H={h:.3f} ~ 0.50 (R^2={r_sq:.2f}). "
                f"Standard Brownian motion Heston CIR volatility dynamics valid."
            )

        else:
            regime = RoughnessRegime.PERSISTENT_LONG_MEMORY_DRIFT
            directive = VolSurfaceCalibrationDirective.LONG_MEMORY_TREND_FILTER
            rationales.append(
                f"Persistent trending volatility on {series.asset_id}: Hurst H={h:.3f} > 0.60 (R^2={r_sq:.2f}). "
                f"Long-memory Hurst persistence; deploy directional volatility trend-following hedges."
            )

        return RoughHestonAssessment(
            asset_id=series.asset_id,
            estimated_hurst_h=round(h, 4),
            variogram_r_squared=round(r_sq, 4),
            short_dated_skew_scaling_exponent=round(skew_exp, 4),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
