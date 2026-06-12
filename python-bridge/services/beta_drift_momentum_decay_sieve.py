"""
Domain 182 (WP-CF): High-Frequency Cross-Sectional Factor Beta Drift & Momentum Decay Sieve

Implements rolling intraday CAPM factor beta estimation, recursive beta drift velocity,
idiosyncratic residual momentum extraction, exponential half-life decay modeling,
and factor-neutral hedging/alpha acceleration execution directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


class BetaRegimeDirective(str, Enum):
    BETA_EXPANSION_HEDGE_MARKET_RISK = "BETA_EXPANSION_HEDGE_MARKET_RISK"
    IDIOSYNCRATIC_ALPHA_OUTPERFORMER = "IDIOSYNCRATIC_ALPHA_OUTPERFORMER"
    MOMENTUM_EXHAUSTION_HALFLIFE_DECAY = "MOMENTUM_EXHAUSTION_HALFLIFE_DECAY"
    STABLE_FACTOR_EQUILIBRIUM = "STABLE_FACTOR_EQUILIBRIUM"
    BETA_COMPRESSION_DECOUPLING = "BETA_COMPRESSION_DECOUPLING"


@dataclass
class BarReturnPair:
    timestamp_sec: float
    asset_return: float  # (P_t - P_{t-1}) / P_{t-1}
    market_return: float  # Benchmark return (e.g. NIFTY)


@dataclass
class BetaDriftReport:
    symbol: str
    benchmark_symbol: str
    current_beta: float
    baseline_beta: float
    beta_drift: float  # beta_current - beta_baseline
    beta_velocity_per_hr: float
    idiosyncratic_volatility: float
    residual_momentum: float
    momentum_half_life_bars: float
    directive: BetaRegimeDirective
    rationale: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class BetaDriftMomentumDecaySieve:
    """
    Sub-minute Factor Beta Drift & Residual Momentum Decay Sieve.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        rolling_window_bars: int = 20,
        beta_drift_threshold: float = 0.35,
        half_life_exhaustion_bars: float = 8.0,
    ):
        self.db_path = db_path
        self.rolling_window = rolling_window_bars
        self.drift_thresh = beta_drift_threshold
        self.half_life_exhaustion = half_life_exhaustion_bars

        self._conn: Optional[sqlite3.Connection] = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for beta drift telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS beta_drift_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                benchmark TEXT NOT NULL,
                current_beta REAL NOT NULL,
                baseline_beta REAL NOT NULL,
                beta_drift REAL NOT NULL,
                beta_velocity REAL NOT NULL,
                residual_momentum REAL NOT NULL,
                half_life_bars REAL NOT NULL,
                directive TEXT NOT NULL,
                rationale TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def calculate_rolling_beta(self, return_pairs: List[BarReturnPair]) -> Tuple[float, float, float]:
        """
        Computes rolling CAPM beta = Cov(R_i, R_m) / Var(R_m),
        alpha, and idiosyncratic residual volatility sigma_eps.
        """
        n = len(return_pairs)
        if n < 5:
            return 1.0, 0.0, 0.0

        r_asset = [p.asset_return for p in return_pairs]
        r_mkt = [p.market_return for p in return_pairs]

        mean_asset = sum(r_asset) / n
        mean_mkt = sum(r_mkt) / n

        cov = sum((r_asset[i] - mean_asset) * (r_mkt[i] - mean_mkt) for i in range(n)) / (n - 1)
        var_mkt = sum((r_mkt[i] - mean_mkt) ** 2 for i in range(n)) / (n - 1)

        if var_mkt < 1e-12:
            return 1.0, 0.0, 0.0

        beta = cov / var_mkt
        alpha = mean_asset - beta * mean_mkt

        residuals = [r_asset[i] - (alpha + beta * r_mkt[i]) for i in range(n)]
        var_resid = sum(r ** 2 for r in residuals) / max(1, n - 2)
        sigma_eps = math.sqrt(var_resid)

        return round(beta, 4), round(alpha, 6), round(sigma_eps, 6)

    def calculate_residual_momentum_and_decay(
        self,
        return_pairs: List[BarReturnPair],
        beta: float,
        alpha: float,
    ) -> Tuple[float, float]:
        """
        Extracts benchmark-adjusted residual returns r_eps = R_i - beta * R_m,
        cumulative momentum, and estimates Ornstein-Uhlenbeck decay rate / half-life.
        """
        if len(return_pairs) < 6:
            return 0.0, 20.0

        # Benchmark-adjusted residual return R_i - beta * R_m
        residuals = [p.asset_return - (beta * p.market_return) for p in return_pairs]

        # Cumulative residual return (total idiosyncratic alpha)
        cum_residual = sum(residuals)

        # Estimate AR(1) mean-reversion parameter on demeaned cumulative residual:
        # e_{t} = phi * e_{t-1} + u
        cum_series = []
        c = 0.0
        for r in residuals:
            c += (r - alpha)
            cum_series.append(c)

        x_prev = cum_series[:-1]
        y_curr = cum_series[1:]
        m = len(x_prev)

        mean_x = sum(x_prev) / m
        mean_y = sum(y_curr) / m

        num = sum((x_prev[i] - mean_x) * (y_curr[i] - mean_y) for i in range(m))
        den = sum((x_prev[i] - mean_x) ** 2 for i in range(m))

        phi = num / den if den > 1e-12 else 1.0
        phi = max(0.01, min(0.999, phi))

        # Half life tau_{1/2} = -ln(2) / ln(phi) in bars
        kappa = -math.log(phi)
        half_life = math.log(2.0) / kappa if kappa > 1e-6 else 50.0

        return round(cum_residual, 6), round(half_life, 2)

    def analyze_beta_drift(
        self,
        symbol: str,
        benchmark_symbol: str,
        return_history: List[BarReturnPair],
        baseline_beta: float = 1.0,
        bar_duration_minutes: float = 5.0,
    ) -> BetaDriftReport:
        """
        Evaluates intraday beta drift velocity, momentum half-life decay, and generates risk directives.
        """
        if len(return_history) < self.rolling_window:
            return BetaDriftReport(
                symbol=symbol,
                benchmark_symbol=benchmark_symbol,
                current_beta=baseline_beta,
                baseline_beta=baseline_beta,
                beta_drift=0.0,
                beta_velocity_per_hr=0.0,
                idiosyncratic_volatility=0.0,
                residual_momentum=0.0,
                momentum_half_life_bars=20.0,
                directive=BetaRegimeDirective.STABLE_FACTOR_EQUILIBRIUM,
                rationale="Insufficient history for rolling beta calibration.",
            )

        # 1. Current rolling window beta
        recent_slice = return_history[-self.rolling_window:]
        curr_beta, alpha, sigma_eps = self.calculate_rolling_beta(recent_slice)

        # 2. Older baseline window beta (prior window)
        if len(return_history) >= self.rolling_window * 2:
            prior_slice = return_history[-self.rolling_window * 2 : -self.rolling_window]
            prior_beta, _, _ = self.calculate_rolling_beta(prior_slice)
        else:
            prior_beta = baseline_beta

        beta_drift = curr_beta - prior_beta

        # Hours elapsed between midpoints of slices
        elapsed_bars = self.rolling_window
        elapsed_hours = (elapsed_bars * bar_duration_minutes) / 60.0
        beta_velocity = beta_drift / max(0.1, elapsed_hours)

        # 3. Residual momentum and half-life
        cum_res, half_life = self.calculate_residual_momentum_and_decay(recent_slice, curr_beta, alpha)

        # 4. Regime classification and directives
        if beta_drift >= self.drift_thresh or curr_beta >= 1.65:
            directive = BetaRegimeDirective.BETA_EXPANSION_HEDGE_MARKET_RISK
            rationale = (
                f"Severe beta expansion (Beta={curr_beta:.2f} vs Prior={prior_beta:.2f}, "
                f"Drift=+{beta_drift:+.2f}, Vel={beta_velocity:+.2f}/hr). Systemic gearing elevated; "
                f"increase index short hedge to re-neutralize factor exposure."
            )
        elif curr_beta <= 0.35:
            directive = BetaRegimeDirective.BETA_COMPRESSION_DECOUPLING
            rationale = (
                f"Beta compression (Beta={curr_beta:.2f}). Asset has decoupled from {benchmark_symbol}; "
                f"pure idiosyncratic price discovery active."
            )
        elif cum_res > 0.015 and half_life >= self.half_life_exhaustion:
            directive = BetaRegimeDirective.IDIOSYNCRATIC_ALPHA_OUTPERFORMER
            rationale = (
                f"Strong idiosyncratic alpha (+{cum_res*100:.2f}% residual) with stable beta ({curr_beta:.2f}) "
                f"and healthy momentum half-life ({half_life:.1f} bars). Run trend winners."
            )
        elif half_life < self.half_life_exhaustion and abs(cum_res) > 0.005:
            directive = BetaRegimeDirective.MOMENTUM_EXHAUSTION_HALFLIFE_DECAY
            rationale = (
                f"Residual momentum half-life collapsed ({half_life:.1f} bars < threshold {self.half_life_exhaustion:.1f}). "
                f"Mean-reversion decay imminent; tighten trailing stops or harvest profits."
            )
        else:
            directive = BetaRegimeDirective.STABLE_FACTOR_EQUILIBRIUM
            rationale = (
                f"Factor exposure within equilibrium bands (Beta={curr_beta:.2f}, "
                f"Drift={beta_drift:+.2f}, IdioVol={sigma_eps*100:.2f}%)."
            )

        report = BetaDriftReport(
            symbol=symbol,
            benchmark_symbol=benchmark_symbol,
            current_beta=curr_beta,
            baseline_beta=prior_beta,
            beta_drift=round(beta_drift, 4),
            beta_velocity_per_hr=round(beta_velocity, 4),
            idiosyncratic_volatility=sigma_eps,
            residual_momentum=cum_res,
            momentum_half_life_bars=half_life,
            directive=directive,
            rationale=rationale,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: BetaDriftReport) -> None:
        """Persists beta drift evaluation to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO beta_drift_telemetry (
                timestamp, symbol, benchmark, current_beta, baseline_beta,
                beta_drift, beta_velocity, residual_momentum, half_life_bars,
                directive, rationale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.benchmark_symbol,
                rep.current_beta,
                rep.baseline_beta,
                rep.beta_drift,
                rep.beta_velocity_per_hr,
                rep.residual_momentum,
                rep.momentum_half_life_bars,
                rep.directive.value,
                rep.rationale,
            ),
        )
        conn.commit()

    def get_latest_telemetry(self, limit: int = 10) -> List[Tuple]:
        """Retrieves latest telemetry entries."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT symbol, benchmark, current_beta, beta_drift, beta_velocity, directive
            FROM beta_drift_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
