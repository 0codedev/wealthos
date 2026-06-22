"""
Domain 156 (WP-BF): Statistical Arbitrage Factor Residual PCA & Mean-Reversion Ornstein-Uhlenbeck Sieve

Implements Marco Avellaneda & Jeong-Hyun Lee (2010) statistical arbitrage framework:
systematic factor stripping, cumulative idiosyncratic residual tracking, discrete-time AR(1)
Ornstein-Uhlenbeck (OU) calibration, half-life estimation, dimensionless s-score calculation,
and automated regime-governed trade execution.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import List, Tuple


@dataclass
class StatArbReport:
    symbol: str
    current_residual: float
    equilibrium_mean: float
    kappa: float
    half_life_days: float
    sigma_ou: float
    sigma_eq: float
    s_score: float
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class StatArbPCAOUSieve:
    """
    Avellaneda-Lee Ornstein-Uhlenbeck Statistical Arbitrage Sieve.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        entry_s_score: float = 1.25,
        exit_s_score: float = 0.50,
        stop_s_score: float = 4.00,
        max_half_life_days: float = 45.0,
    ):
        self.db_path = db_path
        self.entry_s_score = entry_s_score
        self.exit_s_score = exit_s_score
        self.stop_s_score = stop_s_score
        self.max_half_life_days = max_half_life_days
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for statistical arbitrage telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS stat_arb_ou_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                current_residual REAL NOT NULL,
                equilibrium_mean REAL NOT NULL,
                kappa REAL NOT NULL,
                half_life_days REAL NOT NULL,
                sigma_eq REAL NOT NULL,
                s_score REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def strip_market_factor(stock_returns: List[float], market_returns: List[float]) -> Tuple[float, float, List[float]]:
        """
        Regresses stock returns on market factor R_i = alpha + beta * R_m + epsilon
        Returns (alpha, beta, residuals_list).
        """
        n = min(len(stock_returns), len(market_returns))
        if n < 10:
            raise ValueError(f"Need at least 10 observations for OLS regression, got {n}")

        x = market_returns[:n]
        y = stock_returns[:n]

        mean_x = sum(x) / n
        mean_y = sum(y) / n

        var_x = sum((xi - mean_x) ** 2 for xi in x) / (n - 1)
        if var_x < 1e-8:
            return 0.0, 1.0, [yi - mean_y for yi in y]

        cov_xy = sum((xi - mean_x) * (yi - mean_y) for xi, yi in zip(x, y)) / (n - 1)
        beta = cov_xy / var_x
        alpha = mean_y - (beta * mean_x)

        residuals = [yi - (alpha + beta * xi) for xi, yi in zip(x, y)]
        return alpha, beta, residuals

    def calibrate_ou_process(self, cumulative_residuals: List[float]) -> Tuple[float, float, float, float, float]:
        """
        Fits AR(1) model X_{n+1} = a + b * X_n + eta
        Extracts kappa, equilibrium mean, half_life, sigma_ou, sigma_eq.
        """
        n = len(cumulative_residuals)
        if n < 15:
            raise ValueError(f"Need at least 15 points to fit OU process, got {n}")

        x_prev = cumulative_residuals[:-1]
        x_curr = cumulative_residuals[1:]
        m = len(x_prev)

        mean_prev = sum(x_prev) / m
        mean_curr = sum(x_curr) / m

        var_prev = sum((val - mean_prev) ** 2 for val in x_prev) / (m - 1)
        if var_prev < 1e-8:
            # Degenerate case
            return 0.1, mean_prev, 6.93, 0.01, 0.01

        cov = sum((xp - mean_prev) * (xc - mean_curr) for xp, xc in zip(x_prev, x_curr)) / (m - 1)
        b = cov / var_prev

        # Stationarity check: b must be strictly inside (0, 1) for mean-reversion
        b_clamped = max(0.001, min(0.999, b))
        a = mean_curr - (b_clamped * mean_prev)

        # OU continuous parameters (delta_t = 1.0 day)
        kappa = -math.log(b_clamped)
        eq_mean = a / (1.0 - b_clamped)
        half_life = math.log(2.0) / max(1e-5, kappa)

        # Residual variance Var(eta)
        eta_sq_sum = sum((xc - (a + b_clamped * xp)) ** 2 for xp, xc in zip(x_prev, x_curr))
        var_eta = max(1e-8, eta_sq_sum / (m - 2))

        sigma_eq = math.sqrt(max(1e-6, var_eta / (1.0 - (b_clamped ** 2))))
        sigma_ou = sigma_eq * math.sqrt(2.0 * kappa)

        return kappa, eq_mean, half_life, sigma_ou, sigma_eq

    def evaluate_residual_stat_arb(
        self,
        symbol: str,
        stock_returns: List[float],
        market_returns: List[float],
    ) -> StatArbReport:
        """
        Full pipeline: strips market beta, computes cumulative residual series,
        calibrates OU parameters, calculates s-score, and issues execution directive.
        """
        alpha, beta, _ = self.strip_market_factor(stock_returns, market_returns)

        # Cumulative beta-hedged excess return series X_t = sum (R_stock - beta * R_mkt)
        cum_res = []
        acc = 0.0
        n_obs = min(len(stock_returns), len(market_returns))
        for i in range(n_obs):
            excess = stock_returns[i] - (beta * market_returns[i])
            acc += excess
            cum_res.append(acc)

        curr_x = cum_res[-1]
        kappa, eq_mean, half_life, sigma_ou, sigma_eq = self.calibrate_ou_process(cum_res)

        # Avellaneda-Lee Dimensionless s-Score
        s_score = (curr_x - eq_mean) / max(1e-4, sigma_eq)

        # Regime & Directives
        if abs(s_score) >= self.stop_s_score:
            regime = "STAT_ARB_STRUCTURAL_BREAK_ABORT"
            directive = "CLOSE_ALL_POSITIONS_STOP_LOSS"
        elif half_life > self.max_half_life_days:
            regime = "SLOW_MEAN_REVERSION_INADMISSIBLE"
            directive = "STAND_ASIDE_HALF_LIFE_EXCEEDED"
        elif s_score <= -self.entry_s_score:
            regime = "STAT_ARB_BUY_CHEAP_RESIDUAL"
            directive = "LONG_STOCK_SHORT_BETA_HEDGE"
        elif s_score >= self.entry_s_score:
            regime = "STAT_ARB_SHORT_RICH_RESIDUAL"
            directive = "SHORT_STOCK_LONG_BETA_HEDGE"
        elif abs(s_score) <= self.exit_s_score:
            regime = "STAT_ARB_IN_EQUILIBRIUM_FLAT"
            directive = "CLOSE_SPREAD_CAPTURE_PROFIT"
        else:
            regime = "INTERMEDIATE_DRIFT_HOLD"
            directive = "HOLD_EXISTING_SPREAD_POSITIONS"

        report = StatArbReport(
            symbol=symbol,
            current_residual=round(curr_x, 4),
            equilibrium_mean=round(eq_mean, 4),
            kappa=round(kappa, 4),
            half_life_days=round(half_life, 2),
            sigma_ou=round(sigma_ou, 4),
            sigma_eq=round(sigma_eq, 4),
            s_score=round(s_score, 2),
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, report: StatArbReport) -> None:
        """Persists audit record to SQLite database."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO stat_arb_ou_telemetry (
                timestamp, symbol, current_residual, equilibrium_mean,
                kappa, half_life_days, sigma_eq, s_score, regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report.timestamp,
                report.symbol,
                report.current_residual,
                report.equilibrium_mean,
                report.kappa,
                report.half_life_days,
                report.sigma_eq,
                report.s_score,
                report.regime,
                report.trade_directive,
            ),
        )
        conn.commit()
