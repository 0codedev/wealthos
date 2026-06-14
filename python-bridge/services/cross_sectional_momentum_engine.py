"""
Domain 157 (WP-BG): Cross-Sectional Momentum & Idiosyncratic Volatility Acceleration Engine

Implements Jegadeesh & Titman (1993) 12-1 cross-sectional momentum ranking, Ang et al. (2006)
idiosyncratic volatility (IVOL) anomaly filtration, second-derivative momentum acceleration
extraction, and quality-momentum regime synthesis.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import List, Dict, Tuple


@dataclass
class EquityPriceHistory:
    symbol: str
    prices: List[float]  # Daily closing prices, length >= 252 (index 0 is oldest, -1 is latest)
    market_prices: List[float]  # Corresponding benchmark index prices


@dataclass
class MomentumAnalysisReport:
    symbol: str
    r_12_1: float
    percentile_rank: float
    ivol_annualized: float
    acceleration_norm: float
    quality_momentum_score: float
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CrossSectionalMomentumEngine:
    """
    Cross-Sectional Quality Momentum & Idiosyncratic Volatility Acceleration Engine.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        top_percentile_hurdle: float = 0.75,
        ivol_ceiling: float = 0.35,  # 35% annualized IVOL threshold
    ):
        self.db_path = db_path
        self.top_percentile_hurdle = top_percentile_hurdle
        self.ivol_ceiling = ivol_ceiling
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for momentum telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS cross_sectional_momentum_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                r_12_1 REAL NOT NULL,
                percentile_rank REAL NOT NULL,
                ivol REAL NOT NULL,
                acceleration REAL NOT NULL,
                quality_score REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def calculate_r_12_1(prices: List[float]) -> float:
        """
        Jegadeesh-Titman 12-1 momentum return:
        Prices[-21] / Prices[-252] - 1.0 (skipping most recent 21 trading days).
        """
        if len(prices) < 252:
            raise ValueError(f"Need at least 252 daily prices, got {len(prices)}")
        p_t_minus_21 = prices[-21]
        p_t_minus_252 = prices[-252]
        if p_t_minus_252 <= 0:
            return 0.0
        return (p_t_minus_21 / p_t_minus_252) - 1.0

    @staticmethod
    def calculate_ivol_60d(stock_prices: List[float], market_prices: List[float]) -> float:
        """
        Calculates annualized idiosyncratic volatility over the past 60 days
        from market model regression residuals.
        """
        if len(stock_prices) < 61 or len(market_prices) < 61:
            raise ValueError("Need at least 61 prices to compute 60 daily returns.")

        # Compute log returns over past 60 steps
        r_stock = [
            math.log(stock_prices[i] / stock_prices[i - 1])
            for i in range(len(stock_prices) - 60, len(stock_prices))
        ]
        r_market = [
            math.log(market_prices[i] / market_prices[i - 1])
            for i in range(len(market_prices) - 60, len(market_prices))
        ]

        n = len(r_stock)
        mean_s = sum(r_stock) / n
        mean_m = sum(r_market) / n

        var_m = sum((m - mean_m) ** 2 for m in r_market) / (n - 1)
        if var_m < 1e-8:
            # Zero market variance fallback
            return math.sqrt(sum((s - mean_s) ** 2 for s in r_stock) / (n - 1)) * math.sqrt(252)

        cov_sm = sum((s - mean_s) * (m - mean_m) for s, m in zip(r_stock, r_market)) / (n - 1)
        beta = cov_sm / var_m
        alpha = mean_s - (beta * mean_m)

        # Residuals
        res_var = sum((s - (alpha + beta * m)) ** 2 for s, m in zip(r_stock, r_market)) / (n - 2)
        daily_ivol = math.sqrt(max(1e-8, res_var))
        return daily_ivol * math.sqrt(252.0)

    @staticmethod
    def calculate_momentum_acceleration(prices: List[float]) -> float:
        """
        Calculates normalized second derivative of price:
        v_now = (P[-1] - P[-21]) / 21
        v_prev = (P[-21] - P[-42]) / 21
        accel = (v_now - v_prev) / 21
        Normalized by recent price standard deviation.
        """
        if len(prices) < 42:
            return 0.0

        v_now = (prices[-1] - prices[-21]) / 21.0
        v_prev = (prices[-21] - prices[-42]) / 21.0
        raw_accel = (v_now - v_prev) / 21.0

        # Recent daily volatility
        returns_42 = [prices[i] / prices[i - 1] - 1.0 for i in range(len(prices) - 41, len(prices))]
        std_ret = math.sqrt(sum(r**2 for r in returns_42) / len(returns_42))
        norm_factor = max(1e-4, std_ret * prices[-1])

        return raw_accel / norm_factor

    def rank_universe_and_evaluate(
        self,
        universe: List[EquityPriceHistory],
    ) -> List[MomentumAnalysisReport]:
        """
        Ranks cross-sectional universe, computes IVOL and acceleration,
        and generates institutional quality-momentum reports.
        """
        if not universe:
            return []

        # Step 1: Compute 12-1 momentum for all constituents
        mom_scores = []
        for eq in universe:
            r12_1 = self.calculate_r_12_1(eq.prices)
            mom_scores.append((eq.symbol, r12_1, eq))

        # Sort ascending to assign percentile rank
        mom_scores.sort(key=lambda x: x[1])
        m_count = len(mom_scores)

        reports = []
        for rank_idx, (sym, r12_1, eq) in enumerate(mom_scores):
            pct_rank = (rank_idx + 1) / max(1, m_count)
            ivol = self.calculate_ivol_60d(eq.prices, eq.market_prices)
            accel = self.calculate_momentum_acceleration(eq.prices)

            # IVOL penalty factor: penalize lottery stocks with IVOL > 35%
            ivol_penalty = max(0.0, min(1.0, 1.0 - (ivol / 0.50)))

            # Composite Quality Momentum Score
            q_mom = (
                0.50 * pct_rank
                + 0.30 * ivol_penalty
                + 0.20 * math.tanh(accel)
            )

            # Regime & Directives
            if pct_rank >= self.top_percentile_hurdle:
                if ivol > self.ivol_ceiling:
                    regime = "HIGH_IVOL_JUNK_MOMENTUM_TRAP"
                    directive = "AVOID_LOTTERY_EXPOSURE"
                elif accel < -1.0:
                    regime = "MOMENTUM_DECELERATION_EXHAUSTION_WARNING"
                    directive = "TAKE_PROFIT_TIGHTEN_TRAIL_STOP"
                else:
                    regime = "HIGH_CONVICTION_QUALITY_MOMENTUM_RUNNER"
                    directive = "OVERWEIGHT_LONG_ALPHA_RUNNER"
            elif pct_rank <= 0.20:
                regime = "PERSISTENT_CROSS_SECTIONAL_LOSER"
                directive = "UNDERWEIGHT_OR_SHORT_MOMENTUM_FADE"
            else:
                regime = "MEDIAN_UNIVERSE_CHURN"
                directive = "NEUTRAL_MARKET_WEIGHT"

            rep = MomentumAnalysisReport(
                symbol=sym,
                r_12_1=round(r12_1, 4),
                percentile_rank=round(pct_rank, 4),
                ivol_annualized=round(ivol, 4),
                acceleration_norm=round(accel, 4),
                quality_momentum_score=round(q_mom, 4),
                regime=regime,
                trade_directive=directive,
            )
            self._record_telemetry(rep)
            reports.append(rep)

        return reports

    def _record_telemetry(self, report: MomentumAnalysisReport) -> None:
        """Persists audit record to SQLite database."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO cross_sectional_momentum_telemetry (
                timestamp, symbol, r_12_1, percentile_rank, ivol,
                acceleration, quality_score, regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report.timestamp,
                report.symbol,
                report.r_12_1,
                report.percentile_rank,
                report.ivol_annualized,
                report.acceleration_norm,
                report.quality_momentum_score,
                report.regime,
                report.trade_directive,
            ),
        )
        conn.commit()
