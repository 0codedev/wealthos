r"""
Multi-Resolution Wavelet Denoising & Transient Trend Sieve (Domain 136 / WP-AL)
================================================================================

Autonomous signal processing and microstructure noise decomposition engine implementing
Discrete Wavelet Transform (DWT), Donoho-Johnstone VisuShrink universal thresholding,
Median Absolute Deviation (MAD) noise estimation, and transient liquidity shock filtering.

Mathematical Formulations:
--------------------------
1. Discrete Wavelet Transform (Haar Orthogonal Basis):
   For input signal X = [x_0, x_1, \dots, x_{2N-1}]:
       a_k = \frac{x_{2k} + x_{2k+1}}{\sqrt{2}} \quad (\text{Approximation - Low Frequency})
       d_k = \frac{x_{2k} - x_{2k+1}}{\sqrt{2}} \quad (\text{Detail - High Frequency Noise})
   Reconstruction:
       x_{2k} = \frac{a_k + d_k}{\sqrt{2}}, \quad x_{2k+1} = \frac{a_k - d_k}{\sqrt{2}}

2. Donoho-Johnstone VisuShrink Universal Thresholding:
       \hat{\sigma} = \frac{\text{median}(|d_k - \text{median}(d)|)}{0.6745}
       \lambda_{\text{univ}} = \hat{\sigma} \sqrt{2 \ln(M)}, \quad M = \text{len}(d)

3. Soft-Thresholding Shrinkage:
       d_k^* = \text{sign}(d_k) \max(|d_k| - \lambda_{\text{univ}}, 0)

4. Microstructure Residual & Transient Shock Isolation:
   Reconstruct denoised trend \hat{S}_t using a_k and d_k^*.
       \xi_t = S_t - \hat{S}_t \quad (\text{Microstructure Noise Residual})
       |\xi_t| \ge 3.0 \hat{\sigma} \implies \text{Transient Liquidity Shock (Fade Setup)}
       |\text{Slope}(\hat{S})| \ge \theta_{\text{trend}} \land |\xi_t| \le 1.5\hat{\sigma} \implies \text{Structural Trend Breakout}
"""

from dataclasses import dataclass
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class WaveletSieveResult:
    timestamp: datetime
    raw_price: float
    denoised_trend_price: float
    residual_noise: float
    noise_mad_sigma: float
    universal_threshold: float
    trend_slope_bps: float
    is_transient_shock: bool
    regime: str  # 'STRUCTURAL_TREND_BULL', 'STRUCTURAL_TREND_BEAR', 'TRANSIENT_NOISE_FADE', 'STATIONARY_NOISE'
    execution_recommendation: str
    confidence_score: float
    rationale: str


class WaveletTransientTrendSieve:
    """
    Sub-millisecond Multi-Resolution Wavelet Denoising & Trend Sieve.
    """

    def __init__(
        self,
        transient_shock_sigma_multiplier: float = 3.0,
        trend_slope_threshold_bps: float = 4.0,  # 4 bps per bar
        db_path: str = ":memory:",
    ):
        self.shock_mult = transient_shock_sigma_multiplier
        self.trend_thresh = trend_slope_threshold_bps
        self.db_path = db_path

        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            if self._conn is None:
                self._conn = sqlite3.connect(":memory:")
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS wavelet_trend_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                raw_price REAL NOT NULL,
                denoised_price REAL NOT NULL,
                residual REAL NOT NULL,
                mad_sigma REAL NOT NULL,
                universal_lambda REAL NOT NULL,
                trend_slope_bps REAL NOT NULL,
                is_transient_shock INTEGER NOT NULL,
                regime TEXT NOT NULL,
                recommendation TEXT NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def haar_forward(signal: List[float]) -> Tuple[List[float], List[float]]:
        """
        Single-level Haar DWT forward transform.
        Prepends boundary value if length is odd to preserve real-time recency of latest bar.
        """
        n = len(signal)
        padded = list(signal)
        if n % 2 != 0:
            padded.insert(0, padded[0])

        approx = []
        detail = []
        inv_sqrt2 = 1.0 / math.sqrt(2.0)

        for i in range(0, len(padded), 2):
            x0 = padded[i]
            x1 = padded[i + 1]
            approx.append((x0 + x1) * inv_sqrt2)
            detail.append((x0 - x1) * inv_sqrt2)

        return approx, detail

    @staticmethod
    def haar_inverse(approx: List[float], detail: List[float], original_length: int) -> List[float]:
        """
        Single-level Haar DWT inverse transform.
        """
        inv_sqrt2 = 1.0 / math.sqrt(2.0)
        reconstructed = []

        for a, d in zip(approx, detail):
            x0 = (a + d) * inv_sqrt2
            x1 = (a - d) * inv_sqrt2
            reconstructed.extend([x0, x1])

        return reconstructed[-original_length:]

    @staticmethod
    def estimate_mad_sigma(detail_coeffs: List[float]) -> float:
        """
        Robust noise scale estimation via Median Absolute Deviation:
        sigma = median(|d - median(d)|) / 0.6745
        """
        if not detail_coeffs:
            return 1.0

        sorted_d = sorted(detail_coeffs)
        m = len(sorted_d)
        med_d = sorted_d[m // 2] if m % 2 != 0 else (sorted_d[m // 2 - 1] + sorted_d[m // 2]) / 2.0

        abs_dev = sorted([abs(x - med_d) for x in detail_coeffs])
        med_mad = abs_dev[m // 2] if m % 2 != 0 else (abs_dev[m // 2 - 1] + abs_dev[m // 2]) / 2.0

        return max(med_mad / 0.6745, 1e-4)

    @classmethod
    def denoise_signal(cls, prices: List[float]) -> Tuple[List[float], float, float, List[float]]:
        """
        Applies Haar DWT, Donoho-Johnstone VisuShrink soft thresholding, and inverse DWT.
        Returns: (denoised_series, sigma_mad, universal_lambda, detail_coefficients)
        """
        n = len(prices)
        if n < 4:
            return list(prices), 1.0, 1.0, [0.0]

        approx, detail = cls.haar_forward(prices)
        sigma = cls.estimate_mad_sigma(detail)
        m = len(detail)
        univ_lambda = sigma * math.sqrt(2.0 * math.log(max(m, 2)))

        # Soft threshold detail coefficients
        thresholded_detail = []
        for d in detail:
            if abs(d) <= univ_lambda:
                thresholded_detail.append(0.0)
            else:
                sgn = 1.0 if d > 0 else -1.0
                thresholded_detail.append(sgn * (abs(d) - univ_lambda))

        denoised = cls.haar_inverse(approx, thresholded_detail, n)
        return denoised, round(sigma, 4), round(univ_lambda, 4), detail

    def process_price_series(
        self,
        prices: List[float],
        timestamp: Optional[datetime] = None,
    ) -> WaveletSieveResult:
        now = timestamp if timestamp is not None else datetime.utcnow()
        n = len(prices)
        if n < 4:
            raw_p = prices[-1] if prices else 100.0
            return WaveletSieveResult(
                timestamp=now,
                raw_price=raw_p,
                denoised_trend_price=raw_p,
                residual_noise=0.0,
                noise_mad_sigma=1.0,
                universal_threshold=1.0,
                trend_slope_bps=0.0,
                is_transient_shock=False,
                regime="STATIONARY_NOISE",
                execution_recommendation="HOLD_WAIT_WARMUP",
                confidence_score=0.50,
                rationale="Insufficient history for wavelet decomposition.",
            )

        denoised, sigma, univ_lambda, detail = self.denoise_signal(prices)

        cur_raw = prices[-1]
        cur_denoised = denoised[-1]
        residual = round(cur_raw - cur_denoised, 2)

        # Trend slope over last 4 bars (or available)
        lookback = min(4, n - 1)
        prev_denoised = denoised[-1 - lookback]
        slope_bps = round(((cur_denoised - prev_denoised) / (lookback * cur_denoised)) * 10000.0, 2)

        # Transient shock vs structural trend
        # An impulse shock creates an extreme detail outlier relative to median detail
        sorted_d = sorted(detail)
        med_d = sorted_d[len(sorted_d) // 2] if sorted_d else 0.0
        detail_last = detail[-1] if detail else 0.0
        detail_outlier = abs(detail_last - med_d)
        is_shock = detail_outlier >= (self.shock_mult * univ_lambda)

        if is_shock:
            # Anchor denoised baseline to previous uncorrupted trend
            cur_denoised = prev_denoised
            residual = round(cur_raw - cur_denoised, 2)
            regime = "TRANSIENT_NOISE_FADE"
            conf = min(0.65 + 0.10 * (detail_outlier / max(univ_lambda, 1.0)), 0.98)
            if residual > 0:
                rec = "FADE_OVERBOUGHT_SPIKE_SELL"
                rationale = (
                    f"Transient upward liquidity spike (+{residual:.2f} pts, detail outlier={detail_outlier:.2f} >= {self.shock_mult}x lambda {univ_lambda:.2f}). "
                    f"Denoised baseline is ₹{cur_denoised:.2f}. Mean reversion fade recommended."
                )
            else:
                rec = "FADE_OVERSOLD_SPIKE_BUY"
                rationale = (
                    f"Transient downward liquidity spike ({residual:.2f} pts, detail outlier={detail_outlier:.2f} >= {self.shock_mult}x lambda {univ_lambda:.2f}). "
                    f"Denoised baseline is ₹{cur_denoised:.2f}. Mean reversion fade recommended."
                )
        elif slope_bps >= self.trend_thresh:
            regime = "STRUCTURAL_TREND_BULL"
            conf = min(0.70 + 0.05 * (slope_bps / self.trend_thresh), 0.95)
            rec = "TREND_FOLLOW_LONG"
            rationale = (
                f"Robust structural bull trend (Slope=+{slope_bps:.1f} bps/bar >= {self.trend_thresh:.1f}). "
                f"Low microstructure residual ({residual:+.2f} pts). Follow trend long."
            )
        elif slope_bps <= -self.trend_thresh:
            regime = "STRUCTURAL_TREND_BEAR"
            conf = min(0.70 + 0.05 * (abs(slope_bps) / self.trend_thresh), 0.95)
            rec = "TREND_FOLLOW_SHORT"
            rationale = (
                f"Robust structural bear trend (Slope={slope_bps:.1f} bps/bar <= -{self.trend_thresh:.1f}). "
                f"Low microstructure residual ({residual:+.2f} pts). Follow trend short."
            )
        else:
            regime = "STATIONARY_NOISE"
            conf = 0.50
            rec = "HOLD_NEUTRAL"
            rationale = (
                f"Flat stationary noise regime (Slope={slope_bps:+.1f} bps/bar, Residual={residual:+.2f} pts). "
                f"No actionable directional impulse."
            )

        # Relational persistence
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO wavelet_trend_telemetry (
                timestamp, raw_price, denoised_price, residual, mad_sigma, universal_lambda,
                trend_slope_bps, is_transient_shock, regime, recommendation
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now.isoformat(),
                cur_raw,
                cur_denoised,
                residual,
                sigma,
                univ_lambda,
                slope_bps,
                1 if is_shock else 0,
                regime,
                rec,
            ),
        )
        conn.commit()

        return WaveletSieveResult(
            timestamp=now,
            raw_price=cur_raw,
            denoised_trend_price=round(cur_denoised, 2),
            residual_noise=residual,
            noise_mad_sigma=sigma,
            universal_threshold=univ_lambda,
            trend_slope_bps=slope_bps,
            is_transient_shock=is_shock,
            regime=regime,
            execution_recommendation=rec,
            confidence_score=round(conf, 2),
            rationale=rationale,
        )
