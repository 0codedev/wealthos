r"""
Cross-Asset Sovereign Treasury Curve Inversion & Equity Tail Risk Predictor (Domain 149 / WP-AY)
================================================================================================

Autonomous macro-financial risk engine fitting Indian Sovereign G-Sec yield curves
(Nelson-Siegel 1987), tracking 10Y-2Y and 10Y-91D yield curve inversions, and calculating
systemic equity tail drawdown hazard scores with macro leverage multipliers.

Mathematical Formulations:
--------------------------
1. Nelson-Siegel (1987) Zero-Coupon Term Structure:
       y(m) = \beta_0 + \beta_1 \left( \frac{1 - e^{-m/\lambda}}{m/\lambda} \right) + \beta_2 \left( \frac{1 - e^{-m/\lambda}}{m/\lambda} - e^{-m/\lambda} \right)
   where:
       \beta_0: Asymptotic long-term yield level
       \beta_1: Short-term slope component (y(0) - \beta_0)
       \beta_2: Medium-term curvature / butterfly twist
       \lambda: Decay parameter (default \lambda = 2.0 years)

2. Key Curve Slopes & Butterfly Curvature:
       \Delta_{\text{slope}} = (y_{10} - y_2) \times 10^4 \quad \text{(bps)}
       \Delta_{\text{short}} = (y_{10} - y_{0.25}) \times 10^4 \quad \text{(bps)}
       \mathcal{C}_{\text{butterfly}} = (2 \cdot y_5 - [y_2 + y_{10}]) \times 10^4 \quad \text{(bps)}

3. Systemic Equity Tail Risk Hazard Score (H_{\text{tail}} \in [0.0, 1.0]):
   Inversion signals economic contraction and equity market left-tail risk:
       H_{\text{tail}} = \min\left(1.0, \; \max\left(0.0, \frac{50.0 - \Delta_{\text{slope}}}{100.0}\right) \cdot 0.60 + \mathbb{I}(\Delta_{\text{short}} < 0) \cdot 0.25 + \min\left(0.15, \frac{|\mathcal{C}|}{200.0}\right)\right)

4. Macro Portfolio Leverage Multiplier (\mathcal{M}_{\text{macro}}):
       \mathcal{M}_{\text{macro}} = \max\left(0.40, \; 1.0 - 0.60 \cdot H_{\text{tail}}\right)
"""

from dataclasses import dataclass
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class SovereignMaturityYields:
    y_91d: float  # 3-month T-Bill annualized yield (e.g. 0.065 for 6.50%)
    y_2y: float  # 2-year G-Sec yield (e.g. 0.068)
    y_5y: float  # 5-year G-Sec yield (e.g. 0.070)
    y_10y: float  # 10-year Benchmark G-Sec yield (e.g. 0.0715)
    lambda_decay: float = 2.0  # Nelson-Siegel scale parameter


@dataclass
class YieldCurveAnalysisReport:
    y_91d_pct: float
    y_2y_pct: float
    y_5y_pct: float
    y_10y_pct: float
    slope_10_2_bps: float
    slope_10_3m_bps: float
    butterfly_curvature_bps: float
    ns_beta0: float  # Level
    ns_beta1: float  # Slope
    ns_beta2: float  # Curvature
    tail_risk_hazard: float
    macro_leverage_multiplier: float
    regime: str
    risk_directive: str


class SovereignYieldCurveEngine:
    """
    Sub-millisecond sovereign yield curve inversion and equity tail risk engine.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        inversion_hurdle_bps: float = 0.0,  # 0 bps boundary for inversion
    ):
        self.db_path = db_path
        self.inv_hurdle = inversion_hurdle_bps
        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            if self._conn is None:
                self._conn = sqlite3.connect(":memory:")
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for yield curve telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS sovereign_yield_curve_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                y_91d REAL NOT NULL,
                y_2y REAL NOT NULL,
                y_5y REAL NOT NULL,
                y_10y REAL NOT NULL,
                slope_10_2 REAL NOT NULL,
                slope_10_3m REAL NOT NULL,
                curvature REAL NOT NULL,
                tail_risk_hazard REAL NOT NULL,
                macro_multiplier REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def _ns_factor1(m: float, lam: float) -> float:
        """Nelson-Siegel slope factor (1 - e^{-m/lam}) / (m/lam)."""
        if m <= 1e-4:
            return 1.0
        x = m / lam
        return (1.0 - math.exp(-x)) / x

    @staticmethod
    def _ns_factor2(m: float, lam: float) -> float:
        """Nelson-Siegel curvature factor (1 - e^{-m/lam}) / (m/lam) - e^{-m/lam}."""
        if m <= 1e-4:
            return 0.0
        x = m / lam
        return ((1.0 - math.exp(-x)) / x) - math.exp(-x)

    def fit_nelson_siegel(self, yields: SovereignMaturityYields) -> Tuple[float, float, float]:
        """
        Fits Nelson-Siegel parameters (beta0, beta1, beta2) using exact linear OLS.
        """
        maturities = [0.25, 2.0, 5.0, 10.0]
        y_vals = [yields.y_91d, yields.y_2y, yields.y_5y, yields.y_10y]
        lam = yields.lambda_decay

        # Design matrix X: [1.0, f1(m), f2(m)]
        X = [
            [1.0, self._ns_factor1(m, lam), self._ns_factor2(m, lam)]
            for m in maturities
        ]

        # Normal equations X^T X beta = X^T y
        XTX = [[0.0] * 3 for _ in range(3)]
        XTy = [0.0] * 3

        for i in range(4):
            for r in range(3):
                XTy[r] += X[i][r] * y_vals[i]
                for c in range(3):
                    XTX[r][c] += X[i][r] * X[i][c]

        # Invert 3x3 matrix via Cramer's rule
        det = (
            XTX[0][0] * (XTX[1][1] * XTX[2][2] - XTX[1][2] * XTX[2][1])
            - XTX[0][1] * (XTX[1][0] * XTX[2][2] - XTX[1][2] * XTX[2][0])
            + XTX[0][2] * (XTX[1][0] * XTX[2][1] - XTX[1][1] * XTX[2][0])
        )

        if abs(det) < 1e-9:
            # Fallback heuristic
            b0 = yields.y_10y
            b1 = yields.y_91d - yields.y_10y
            b2 = 2.0 * yields.y_5y - (yields.y_2y + yields.y_10y)
            return (b0, b1, b2)

        inv = [[0.0] * 3 for _ in range(3)]
        inv[0][0] = (XTX[1][1] * XTX[2][2] - XTX[1][2] * XTX[2][1]) / det
        inv[0][1] = (XTX[0][2] * XTX[2][1] - XTX[0][1] * XTX[2][2]) / det
        inv[0][2] = (XTX[0][1] * XTX[1][2] - XTX[0][2] * XTX[1][1]) / det

        inv[1][0] = (XTX[1][2] * XTX[2][0] - XTX[1][0] * XTX[2][2]) / det
        inv[1][1] = (XTX[0][0] * XTX[2][2] - XTX[0][2] * XTX[2][0]) / det
        inv[1][2] = (XTX[0][2] * XTX[1][0] - XTX[0][0] * XTX[1][2]) / det

        inv[2][0] = (XTX[1][0] * XTX[2][1] - XTX[1][1] * XTX[2][0]) / det
        inv[2][1] = (XTX[0][1] * XTX[2][0] - XTX[0][0] * XTX[2][1]) / det
        inv[2][2] = (XTX[0][0] * XTX[1][1] - XTX[0][1] * XTX[1][0]) / det

        b0 = sum(inv[0][c] * XTy[c] for c in range(3))
        b1 = sum(inv[1][c] * XTy[c] for c in range(3))
        b2 = sum(inv[2][c] * XTy[c] for c in range(3))

        return (b0, b1, b2)

    def analyze_yield_curve(self, yields: SovereignMaturityYields) -> YieldCurveAnalysisReport:
        """
        Analyzes yield curve structure, slope inversion, Nelson-Siegel fit,
        tail risk hazard score, and macro leverage multiplier.
        """
        # Spreads in bps
        slope_10_2 = (yields.y_10y - yields.y_2y) * 10000.0
        slope_10_3m = (yields.y_10y - yields.y_91d) * 10000.0
        curvature = (2.0 * yields.y_5y - (yields.y_2y + yields.y_10y)) * 10000.0

        # Fit Nelson-Siegel parameters
        b0, b1, b2 = self.fit_nelson_siegel(yields)

        # Composite Tail Risk Hazard Score H_tail in [0.0, 1.0]
        # Normal slope ~ +50 to +100 bps -> hazard ~ 0.0
        # Flat slope ~ 0 bps -> hazard ~ 0.50
        # Inverted slope <= -25 bps -> hazard >= 0.75
        slope_component = max(0.0, min(1.0, (50.0 - slope_10_2) / 100.0)) * 0.60
        short_inv_component = 0.25 if slope_10_3m < 0.0 else 0.0
        curv_component = min(0.15, abs(curvature) / 200.0)

        raw_hazard = slope_component + short_inv_component + curv_component
        hazard = max(0.0, min(1.0, raw_hazard))

        # Macro Leverage Multiplier in [0.40, 1.00]
        macro_mult = max(0.40, round(1.0 - 0.60 * hazard, 2))

        # Regime & Directives Ladder
        if hazard <= 0.25:
            regime = "NORMAL_EXPANSION_CURVE"
            directive = "FULL_EQUITY_LONG_BETA_UNCONSTRAINED"
        elif hazard <= 0.55:
            regime = "FLATTENING_CURVE_MONITOR"
            directive = "TRIM_HIGH_BETA_TIGHTEN_STOPS"
        elif hazard <= 0.80:
            regime = "INVERTED_CURVE_ALERT"
            directive = "HEDGE_EQUITIES_WITH_NIFTY_PUTS"
        else:
            regime = "ACUTE_MACRO_TAIL_HAZARD"
            directive = "DELEVERAGE_MAX_ACCUMULATE_CASH_LIQUID"

        report = YieldCurveAnalysisReport(
            y_91d_pct=round(yields.y_91d * 100.0, 3),
            y_2y_pct=round(yields.y_2y * 100.0, 3),
            y_5y_pct=round(yields.y_5y * 100.0, 3),
            y_10y_pct=round(yields.y_10y * 100.0, 3),
            slope_10_2_bps=round(slope_10_2, 1),
            slope_10_3m_bps=round(slope_10_3m, 1),
            butterfly_curvature_bps=round(curvature, 1),
            ns_beta0=round(b0, 4),
            ns_beta1=round(b1, 4),
            ns_beta2=round(b2, 4),
            tail_risk_hazard=round(hazard, 4),
            macro_leverage_multiplier=macro_mult,
            regime=regime,
            risk_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: YieldCurveAnalysisReport) -> None:
        """Persists yield curve telemetry into SQLite."""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO sovereign_yield_curve_telemetry (
                    timestamp, y_91d, y_2y, y_5y, y_10y,
                    slope_10_2, slope_10_3m, curvature, tail_risk_hazard,
                    macro_multiplier, regime, directive
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.utcnow().isoformat(),
                    rep.y_91d_pct,
                    rep.y_2y_pct,
                    rep.y_5y_pct,
                    rep.y_10y_pct,
                    rep.slope_10_2_bps,
                    rep.slope_10_3m_bps,
                    rep.butterfly_curvature_bps,
                    rep.tail_risk_hazard,
                    rep.macro_leverage_multiplier,
                    rep.regime,
                    rep.risk_directive,
                ),
            )
            conn.commit()
        except Exception:
            pass
