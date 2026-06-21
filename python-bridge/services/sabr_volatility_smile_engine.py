"""
Domain 174 (WP-BX): Real-Time Options Surface SABR Calibration & Volatility Smile Engine

Implements Hagan et al. (2002) SABR stochastic volatility analytical expansion,
cross-strike volatility smile generation, Nelder-Mead/coordinate calibration,
Breeden-Litzenberger butterfly density arbitrage verification, and institutional volatility directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class SABRParameters:
    alpha: float  # Initial volatility scale (> 0)
    beta: float  # CEV elasticity (0.0 to 1.0)
    rho: float  # Spot-vol correlation (-1.0 to 1.0)
    nu: float  # Vol-of-vol (> 0)


@dataclass
class SABRSmilePoint:
    strike: float
    market_iv: Optional[float]
    model_iv: float
    error_bps: Optional[float]


@dataclass
class SABRReport:
    symbol: str
    forward_price: float
    expiry_t: float
    params: SABRParameters
    atm_vol: float
    rmse_fit_bps: float
    density_arbitrage_free: bool
    regime: str
    trade_directive: str
    smile_points: List[SABRSmilePoint]
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class SABRVolatilitySmileEngine:
    """
    SABR Stochastic Volatility Smile Calibration & Arbitrage Sentry.
    """

    def __init__(self, db_path: str = ":memory:"):
        self.db_path = db_path
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for SABR telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS sabr_calibration_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                forward_price REAL NOT NULL,
                expiry_t REAL NOT NULL,
                alpha REAL NOT NULL,
                beta REAL NOT NULL,
                rho REAL NOT NULL,
                nu REAL NOT NULL,
                atm_vol REAL NOT NULL,
                rmse_fit_bps REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def hagan_implied_vol(
        self,
        F: float,
        K: float,
        T: float,
        params: SABRParameters,
    ) -> float:
        """
        Calculates Black-76 implied volatility via Hagan et al. (2002) asymptotic expansion.
        """
        if T <= 0 or F <= 0 or K <= 0:
            return params.alpha

        alpha, beta, rho, nu = params.alpha, params.beta, params.rho, params.nu
        one_minus_beta = 1.0 - beta

        # 1. At The Money case (F == K)
        if abs(F - K) < 1e-5:
            f_pow = F ** one_minus_beta
            bracket1 = (one_minus_beta ** 2) / 24.0 * (alpha ** 2) / (f_pow ** 2)
            bracket2 = 0.25 * rho * beta * nu * alpha / f_pow
            bracket3 = (2.0 - 3.0 * (rho ** 2)) / 24.0 * (nu ** 2)
            sigma_atm = (alpha / f_pow) * (1.0 + (bracket1 + bracket2 + bracket3) * T)
            return max(0.01, sigma_atm)

        # 2. Out of the Money case (F != K)
        ln_fk = math.log(F / K)
        fk_pow = (F * K) ** (one_minus_beta / 2.0)

        # Denominator expansion
        denom = fk_pow * (
            1.0
            + (one_minus_beta ** 2) / 24.0 * (ln_fk ** 2)
            + (one_minus_beta ** 4) / 1920.0 * (ln_fk ** 4)
        )

        z = (nu / alpha) * fk_pow * ln_fk

        # x(z) calculation
        if abs(z) < 1e-5:
            z_over_xz = 1.0
        else:
            radicand = max(1e-12, 1.0 - 2.0 * rho * z + z * z)
            num_arg = math.sqrt(radicand) + z - rho
            if num_arg <= 0 or abs(1.0 - rho) < 1e-8:
                z_over_xz = 1.0
            else:
                xz = math.log(num_arg / (1.0 - rho))
                z_over_xz = z / max(1e-8, xz)

        # High-order time expansion factor
        gamma1 = (one_minus_beta ** 2) / 24.0 * (alpha ** 2) / ((F * K) ** one_minus_beta)
        gamma2 = 0.25 * rho * beta * nu * alpha / fk_pow
        gamma3 = (2.0 - 3.0 * (rho ** 2)) / 24.0 * (nu ** 2)

        vol = (alpha / denom) * z_over_xz * (1.0 + (gamma1 + gamma2 + gamma3) * T)
        return max(0.01, round(vol, 6))

    def verify_arbitrage_free_density(
        self,
        F: float,
        strikes: List[float],
        T: float,
        params: SABRParameters,
    ) -> bool:
        """
        Verifies Breeden-Litzenberger non-negativity of risk-neutral density:
        d^2 C / dK^2 >= 0 across the strike curve.
        """
        if len(strikes) < 3:
            return True

        sorted_k = sorted(strikes)
        # Numerical second difference of Black-76 call prices
        for i in range(1, len(sorted_k) - 1):
            k_prev = sorted_k[i - 1]
            k_curr = sorted_k[i]
            k_next = sorted_k[i + 1]

            vol_prev = self.hagan_implied_vol(F, k_prev, T, params)
            vol_curr = self.hagan_implied_vol(F, k_curr, T, params)
            vol_next = self.hagan_implied_vol(F, k_next, T, params)

            # Monotonic call prices: C(K) must be convex
            c_prev = self._black76_call(F, k_prev, T, vol_prev)
            c_curr = self._black76_call(F, k_curr, T, vol_curr)
            c_next = self._black76_call(F, k_next, T, vol_next)

            # Convexity test
            d1 = (c_curr - c_prev) / (k_curr - k_prev)
            d2 = (c_next - c_curr) / (k_next - k_curr)
            if d2 < d1 - 1e-4:
                return False  # Butterfly arbitrage violated

        return True

    def _black76_call(self, F: float, K: float, T: float, sigma: float) -> float:
        if T <= 0 or sigma <= 0:
            return max(0.0, F - K)
        sqrt_t = math.sqrt(T)
        d1 = (math.log(F / K) + 0.5 * sigma * sigma * T) / (sigma * sqrt_t)
        d2 = d1 - sigma * sqrt_t
        c = F * 0.5 * (1.0 + math.erf(d1 / math.sqrt(2.0))) - K * 0.5 * (1.0 + math.erf(d2 / math.sqrt(2.0)))
        return max(0.0, c)

    def calibrate_sabr(
        self,
        symbol: str,
        forward_price: float,
        expiry_t: float,
        market_quotes: List[Tuple[float, float]],  # List of (strike, market_iv)
        fixed_beta: float = 0.70,
    ) -> SABRReport:
        """
        Calibrates (alpha, rho, nu) to minimize root-mean-square error against market quotes.
        """
        if not market_quotes:
            raise ValueError("market_quotes cannot be empty")

        F = forward_price
        T = expiry_t
        strikes = [q[0] for q in market_quotes]
        market_ivs = [q[1] for q in market_quotes]

        # Initial alpha heuristic: alpha = atm_vol * F^(1 - beta)
        # Find quote closest to ATM
        atm_quote = min(market_quotes, key=lambda q: abs(q[0] - F))
        initial_atm_vol = atm_quote[1]
        initial_alpha = initial_atm_vol * (F ** (1.0 - fixed_beta))

        best_params = SABRParameters(alpha=initial_alpha, beta=fixed_beta, rho=-0.25, nu=0.40)
        best_rmse = float("inf")

        # Grid / Coordinate descent search
        rho_grid = [-0.60, -0.40, -0.20, 0.0, 0.20]
        nu_grid = [0.20, 0.40, 0.60, 0.80]
        alpha_mults = [0.90, 1.0, 1.10]

        for am in alpha_mults:
            curr_alpha = initial_alpha * am
            for r in rho_grid:
                for n in nu_grid:
                    p = SABRParameters(alpha=curr_alpha, beta=fixed_beta, rho=r, nu=n)
                    sse = 0.0
                    for k, miv in market_quotes:
                        model_vol = self.hagan_implied_vol(F, k, T, p)
                        sse += (model_vol - miv) ** 2
                    rmse = math.sqrt(sse / len(market_quotes))
                    if rmse < best_rmse:
                        best_rmse = rmse
                        best_params = p

        # Build smile points
        smile_points = []
        for k, miv in market_quotes:
            m_vol = self.hagan_implied_vol(F, k, T, best_params)
            err_bps = round((m_vol - miv) * 10000.0, 2)
            smile_points.append(
                SABRSmilePoint(
                    strike=k,
                    market_iv=round(miv, 4),
                    model_iv=round(m_vol, 4),
                    error_bps=err_bps,
                )
            )

        atm_vol = self.hagan_implied_vol(F, F, T, best_params)
        is_arb_free = self.verify_arbitrage_free_density(F, strikes, T, best_params)

        # Regimes and directives
        rmse_bps = round(best_rmse * 10000.0, 2)
        if not is_arb_free:
            regime = "BUTTERFLY_DENSITY_ARBITRAGE_VIOLATION"
            directive = "REJECT_SURFACE_EXECUTE_BUTTERFLY_ARB"
        elif best_params.nu >= 0.70 and best_params.rho <= -0.50:
            regime = "STEEP_SKEW_PANIC_EXPANSION"
            directive = "HEDGE_DOWNSIDE_CRASH_PROTECTION"
        elif rmse_bps <= 35.0:
            regime = "SABR_SMILE_PRECISION_EQUILIBRIUM"
            directive = "DEPLOY_SABR_CROSS_STRIKE_QUOTING"
        else:
            regime = "SABR_SMILE_MODERATE_DISPERSION"
            directive = "HARVEST_OUTLIER_STRIKE_MISPRICING"

        report = SABRReport(
            symbol=symbol,
            forward_price=F,
            expiry_t=T,
            params=best_params,
            atm_vol=round(atm_vol, 4),
            rmse_fit_bps=rmse_bps,
            density_arbitrage_free=is_arb_free,
            regime=regime,
            trade_directive=directive,
            smile_points=smile_points,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: SABRReport) -> None:
        """Persists evaluation results to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO sabr_calibration_telemetry (
                timestamp, symbol, forward_price, expiry_t,
                alpha, beta, rho, nu, atm_vol, rmse_fit_bps,
                regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.forward_price,
                rep.expiry_t,
                rep.params.alpha,
                rep.params.beta,
                rep.params.rho,
                rep.params.nu,
                rep.atm_vol,
                rep.rmse_fit_bps,
                rep.regime,
                rep.trade_directive,
            ),
        )
        conn.commit()

    def get_latest_telemetry(self, limit: int = 10) -> List[Tuple]:
        """Retrieves latest persisted telemetry rows."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT symbol, forward_price, alpha, rho, nu, atm_vol, rmse_fit_bps, regime, directive
            FROM sabr_calibration_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
