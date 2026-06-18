r"""
Domain 191 (WP-CO): Real-Time Options Surface Term Structure & Local Volatility Forward PDE Sieve

Implements Bruno Dupire (1994) & Jim Gatheral (2006) continuous local volatility forward PDE calibration:
- Dual finite-difference differentiation on Total Implied Variance surface w(y, T) = \sigma_{IV}^2(y, T) \cdot T
- Exact Dupire local variance recovery:
    \sigma_{local}^2(y, T) = \frac{\frac{\partial w}{\partial T}}{1 - \frac{y}{w}\frac{\partial w}{\partial y} + \frac{1}{4}\left(-\frac{1}{4} - \frac{1}{w} + \frac{y^2}{w^2}\right)\left(\frac{\partial w}{\partial y}\right)^2 + \frac{1}{2}\frac{\partial^2 w}{\partial y^2}}
- Calendar spread arbitrage sieve: \frac{\partial w}{\partial T} \ge 0 (negative forward variance detection)
- Butterfly convexity arbitrage sieve: Denominator g(K) > 0 (negative risk-neutral density detection)
- Forward implied volatility term structure and exotic barrier pricing suitability sentry.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
import sqlite3
from typing import Callable, Dict, List, Optional, Tuple


class LocalVolDirective(str, Enum):
    CALENDAR_SPREAD_ARBITRAGE_BUY_NEAR_SELL_FAR = "CALENDAR_SPREAD_ARBITRAGE_BUY_NEAR_SELL_FAR"
    BUTTERFLY_CONVEXITY_ARBITRAGE = "BUTTERFLY_CONVEXITY_ARBITRAGE"
    FORWARD_VOLATILITY_INVERSION_HEDGE = "FORWARD_VOLATILITY_INVERSION_HEDGE"
    ARBITRAGE_FREE_LOCAL_VOLATILITY_CALIBRATED = "ARBITRAGE_FREE_LOCAL_VOLATILITY_CALIBRATED"
    EQUILIBRIUM_CALM = "EQUILIBRIUM_CALM"


@dataclass
class OptionsSurfacePoint:
    strike: float
    expiry_days: float  # Expiry in days (e.g. 7.0, 30.0, 60.0)
    implied_vol: float  # Fraction (e.g. 0.16 for 16%)


@dataclass
class LocalVolGridPoint:
    strike: float
    expiry_years: float
    log_moneyness: float  # y = \ln(K / F)
    implied_vol: float
    total_variance: float  # w = \sigma^2 * T
    local_vol: float
    forward_variance_rate: float  # \partial w / \partial T
    density_denominator: float  # Denominator in Dupire's formula
    is_calendar_arbitrage: bool
    is_butterfly_arbitrage: bool


@dataclass
class LocalVolReport:
    symbol: str
    underlying_price: float
    risk_free_rate: float
    grid_points: List[LocalVolGridPoint]
    calendar_arbitrage_count: int
    butterfly_arbitrage_count: int
    min_local_vol: float
    max_local_vol: float
    directive: LocalVolDirective
    rationale: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class LocalVolatilityForwardPDESieve:
    r"""
    Dupire Local Volatility Forward PDE Sieve and Surface Term Structure Calibrator.
    Evaluates continuous no-arbitrage conditions on option volatility surfaces.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        min_valid_vol: float = 0.04,  # 4% vol floor
        max_valid_vol: float = 2.00,  # 200% vol cap
    ):
        self.db_path = db_path
        self.min_vol = min_valid_vol
        self.max_vol = max_valid_vol

        self._conn: Optional[sqlite3.Connection] = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for local volatility surface telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS local_volatility_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                spot REAL NOT NULL,
                calendar_arbs INTEGER NOT NULL,
                butterfly_arbs INTEGER NOT NULL,
                min_local_vol REAL NOT NULL,
                max_local_vol REAL NOT NULL,
                directive TEXT NOT NULL,
                rationale TEXT NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def _interpolate_surface_vol(
        k: float,
        t_years: float,
        surface_points: List[OptionsSurfacePoint],
    ) -> float:
        r"""
        Bilinear / Inverse Distance Weighting interpolation for implied volatility \sigma(K, T).
        """
        if not surface_points:
            return 0.20  # Default 20% vol

        # Exact match check
        for pt in surface_points:
            if math.isclose(pt.strike, k, rel_tol=1e-4) and math.isclose(
                pt.expiry_days / 365.0, t_years, rel_tol=1e-4
            ):
                return pt.implied_vol

        # Inverse distance weighting across nearest points
        weights = []
        vols = []
        for pt in surface_points:
            pt_t = max(1e-4, pt.expiry_days / 365.0)
            dist_sq = ((pt.strike - k) / max(1.0, k)) ** 2 + ((pt_t - t_years) / max(0.01, t_years)) ** 2
            if dist_sq < 1e-8:
                return pt.implied_vol
            w = 1.0 / dist_sq
            weights.append(w)
            vols.append(pt.implied_vol)

        total_w = sum(weights)
        if total_w <= 0:
            return 0.20
        return sum(w * v for w, v in zip(weights, vols)) / total_w

    def evaluate_dupire_point(
        self,
        spot: float,
        strike: float,
        t_years: float,
        r: float,
        surface_points: List[OptionsSurfacePoint],
        dt: float = 0.005,  # ~1.8 days
        dy: float = 0.01,   # 1% log-moneyness step
    ) -> LocalVolGridPoint:
        r"""
        Computes Dupire local volatility \sigma_{local}(K, T) at a single grid point (K, T)
        using Gatheral's total variance representation:
        y = \ln(K / F_T) = \ln(K / (S_0 e^{r T}))
        w(y, T) = \sigma_{IV}^2(y, T) \cdot T
        """
        t_years = max(0.01, t_years)
        fwd = spot * math.exp(r * t_years)
        y = math.log(max(1e-4, strike / max(1e-4, fwd)))

        def get_w(y_val: float, t_val: float) -> float:
            k_val = spot * math.exp(r * t_val) * math.exp(y_val)
            vol = self._interpolate_surface_vol(k_val, t_val, surface_points)
            return max(1e-6, vol * vol * t_val)

        # Baseline total variance
        w0 = get_w(y, t_years)
        iv0 = math.sqrt(w0 / t_years)

        # Central / Forward differences for derivatives
        # \partial w / \partial T
        t_plus = t_years + dt
        t_minus = max(0.002, t_years - dt)
        w_t_plus = get_w(y, t_plus)
        w_t_minus = get_w(y, t_minus)
        dw_dt = (w_t_plus - w_t_minus) / (t_plus - t_minus)

        # \partial w / \partial y
        y_plus = y + dy
        y_minus = y - dy
        w_y_plus = get_w(y_plus, t_years)
        w_y_minus = get_w(y_minus, t_years)
        dw_dy = (w_y_plus - w_y_minus) / (2.0 * dy)

        # \partial^2 w / \partial y^2
        d2w_dy2 = (w_y_plus - 2.0 * w0 + w_y_minus) / (dy * dy)

        # Check calendar spread condition: dw/dt >= 0
        is_calendar_arb = dw_dt < -1e-5

        # Dupire denominator:
        # D = 1 - (y/w)*w_y + (1/4)*(-1/4 - 1/w + y^2/w^2)*(w_y)^2 + (1/2)*w_yy
        term1 = 1.0
        term2 = -(y / w0) * dw_dy
        term3 = 0.25 * (-0.25 - (1.0 / w0) + ((y * y) / (w0 * w0))) * (dw_dy * dw_dy)
        term4 = 0.50 * d2w_dy2
        denominator = term1 + term2 + term3 + term4

        # Check butterfly / convexity condition: denominator > 0
        is_butterfly_arb = denominator <= 1e-4

        # Compute local variance: \sigma_{local}^2 = dw_dt / denominator
        if is_calendar_arb or is_butterfly_arb or denominator <= 0:
            local_vol = iv0  # Fallback to implied vol under arbitrage distortion
        else:
            local_var = max(self.min_vol**2, min(self.max_vol**2, dw_dt / denominator))
            local_vol = math.sqrt(local_var)

        return LocalVolGridPoint(
            strike=strike,
            expiry_years=round(t_years, 4),
            log_moneyness=round(y, 4),
            implied_vol=round(iv0, 4),
            total_variance=round(w0, 6),
            local_vol=round(local_vol, 4),
            forward_variance_rate=round(dw_dt, 6),
            density_denominator=round(denominator, 6),
            is_calendar_arbitrage=is_calendar_arb,
            is_butterfly_arbitrage=is_butterfly_arb,
        )

    def calibrate_surface(
        self,
        symbol: str,
        spot: float,
        risk_free_rate: float,
        surface_points: List[OptionsSurfacePoint],
        grid_strikes: Optional[List[float]] = None,
        grid_expiries_days: Optional[List[float]] = None,
    ) -> LocalVolReport:
        r"""
        Calibrates the full 2D local volatility surface across strike and term structure grid,
        detecting calendar spread and butterfly convexity arbitrage anomalies.
        """
        now_ts = datetime.now(timezone.utc).isoformat()
        if not surface_points:
            return LocalVolReport(
                symbol=symbol,
                underlying_price=spot,
                risk_free_rate=risk_free_rate,
                grid_points=[],
                calendar_arbitrage_count=0,
                butterfly_arbitrage_count=0,
                min_local_vol=0.0,
                max_local_vol=0.0,
                directive=LocalVolDirective.EQUILIBRIUM_CALM,
                rationale="Empty surface points.",
                timestamp=now_ts,
            )

        if grid_strikes is None:
            # Default +/- 5%, +/- 2.5%, ATM strikes
            grid_strikes = [
                round(spot * 0.95, 2),
                round(spot * 0.975, 2),
                round(spot * 1.00, 2),
                round(spot * 1.025, 2),
                round(spot * 1.05, 2),
            ]

        if grid_expiries_days is None:
            # Default Weekly (7d), Monthly (30d), Bi-monthly (60d)
            grid_expiries_days = [7.0, 30.0, 60.0]

        grid_points: List[LocalVolGridPoint] = []
        calendar_arbs = 0
        butterfly_arbs = 0
        min_lv = 999.0
        max_lv = -999.0

        for t_days in grid_expiries_days:
            t_yrs = t_days / 365.0
            for k in grid_strikes:
                pt = self.evaluate_dupire_point(
                    spot, k, t_yrs, risk_free_rate, surface_points
                )
                grid_points.append(pt)

                if pt.is_calendar_arbitrage:
                    calendar_arbs += 1
                if pt.is_butterfly_arbitrage:
                    butterfly_arbs += 1

                min_lv = min(min_lv, pt.local_vol)
                max_lv = max(max_lv, pt.local_vol)

        min_lv = round(min_lv if min_lv < 900.0 else 0.0, 4)
        max_lv = round(max_lv if max_lv > -900.0 else 0.0, 4)

        # Alpha & Arbitrage Directives
        if calendar_arbs > 0:
            directive = LocalVolDirective.CALENDAR_SPREAD_ARBITRAGE_BUY_NEAR_SELL_FAR
            rationale = (
                f"Negative forward variance detected at {calendar_arbs} grid points "
                f"(\\partial w / \\partial T < 0). Exploit calendar spread mispricing."
            )
        elif butterfly_arbs > 0:
            directive = LocalVolDirective.BUTTERFLY_CONVEXITY_ARBITRAGE
            rationale = (
                f"Convexity arbitrage detected at {butterfly_arbs} grid points "
                f"(Dupire density denominator <= 0). Exploit butterfly spread mispricing."
            )
        elif min_lv > 0 and max_lv > 0 and (max_lv / min_lv) > 2.5:
            directive = LocalVolDirective.FORWARD_VOLATILITY_INVERSION_HEDGE
            rationale = (
                f"Extreme local volatility curvature ratio {max_lv/min_lv:.2f}x. "
                f"Local vol spread [{min_lv*100:.1f}%, {max_lv*100:.1f}%]. Hedge forward skew."
            )
        else:
            directive = LocalVolDirective.ARBITRAGE_FREE_LOCAL_VOLATILITY_CALIBRATED
            rationale = (
                f"Arbitrage-free local volatility surface calibrated. Local vol bounds: "
                f"[{min_lv*100:.1f}%, {max_lv*100:.1f}%]."
            )

        report = LocalVolReport(
            symbol=symbol,
            underlying_price=spot,
            risk_free_rate=risk_free_rate,
            grid_points=grid_points,
            calendar_arbitrage_count=calendar_arbs,
            butterfly_arbitrage_count=butterfly_arbs,
            min_local_vol=min_lv,
            max_local_vol=max_lv,
            directive=directive,
            rationale=rationale,
            timestamp=now_ts,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: LocalVolReport) -> None:
        """Persists calibration summary to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO local_volatility_telemetry (
                timestamp, symbol, spot, calendar_arbs, butterfly_arbs,
                min_local_vol, max_local_vol, directive, rationale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.underlying_price,
                rep.calendar_arbitrage_count,
                rep.butterfly_arbitrage_count,
                rep.min_local_vol,
                rep.max_local_vol,
                rep.directive.value,
                rep.rationale,
            ),
        )
        conn.commit()

    def get_recent_calibrations(
        self, symbol: Optional[str] = None, limit: int = 10
    ) -> List[Dict]:
        """Retrieves recent surface calibrations from SQLite telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        if symbol:
            cursor.execute(
                """
                SELECT timestamp, symbol, spot, calendar_arbs, butterfly_arbs,
                       min_local_vol, max_local_vol, directive, rationale
                FROM local_volatility_telemetry
                WHERE symbol = ?
                ORDER BY id DESC LIMIT ?
                """,
                (symbol, limit),
            )
        else:
            cursor.execute(
                """
                SELECT timestamp, symbol, spot, calendar_arbs, butterfly_arbs,
                       min_local_vol, max_local_vol, directive, rationale
                FROM local_volatility_telemetry
                ORDER BY id DESC LIMIT ?
                """,
                (limit,),
            )
        rows = cursor.fetchall()
        results = []
        for r in rows:
            results.append(
                {
                    "timestamp": r[0],
                    "symbol": r[1],
                    "spot": r[2],
                    "calendar_arbs": r[3],
                    "butterfly_arbs": r[4],
                    "min_local_vol": r[5],
                    "max_local_vol": r[6],
                    "directive": r[7],
                    "rationale": r[8],
                }
            )
        return results
