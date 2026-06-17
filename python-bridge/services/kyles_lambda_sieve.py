"""
Domain 159 (WP-BI): Sub-Second Market Microstructure Kyle's Lambda & Invariance Flow Sieve

Implements Albert S. Kyle's (1985) linear price impact lambda estimation, signed trade flow
aggregation (Lee-Ready classification), cross-asset normalized illiquidity metrics,
adverse selection toxicity regime detection, and execution POV participation governors.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import List, Tuple


@dataclass
class TradeTick:
    timestamp: str
    price: float
    volume: float
    bid: float
    ask: float


@dataclass
class TradeInterval:
    price_change: float
    signed_volume: float


@dataclass
class KylesLambdaReport:
    symbol: str
    current_price: float
    raw_lambda: float
    norm_lambda_bps: float
    r_squared: float
    toxicity_regime: str
    execution_directive: str
    max_recommended_pov: float
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class KylesLambdaSieve:
    """
    Sub-Second Kyle's Lambda & Market Microstructure Illiquidity Sieve.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        toxic_lambda_hurdle_bps: float = 12.0,
        benign_lambda_hurdle_bps: float = 4.0,
        min_intervals: int = 20,
    ):
        self.db_path = db_path
        self.toxic_lambda_hurdle_bps = toxic_lambda_hurdle_bps
        self.benign_lambda_hurdle_bps = benign_lambda_hurdle_bps
        self.min_intervals = min_intervals
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for Kyle's Lambda telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS kyles_lambda_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                current_price REAL NOT NULL,
                raw_lambda REAL NOT NULL,
                norm_lambda_bps REAL NOT NULL,
                r_squared REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL,
                recommended_pov REAL NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def classify_trade_sign_lee_ready(tick: TradeTick, prev_price: float) -> int:
        """
        Lee-Ready (1991) trade classification algorithm:
        1. Quote rule: if price > mid -> +1 (buyer-initiated); if price < mid -> -1 (seller-initiated).
        2. Tick rule fallback: if price == mid: if price > prev_price -> +1; if price < prev_price -> -1.
        """
        mid = (tick.bid + tick.ask) / 2.0
        if tick.price > mid + 1e-5:
            return 1
        elif tick.price < mid - 1e-5:
            return -1
        else:
            # Tick rule
            if tick.price > prev_price:
                return 1
            elif tick.price < prev_price:
                return -1
            return 0

    def aggregate_intervals(self, ticks: List[TradeTick], interval_size: int = 10) -> List[TradeInterval]:
        """
        Aggregates tick stream into non-overlapping trade intervals of size N trades.
        """
        if len(ticks) < interval_size * 2:
            return []

        intervals = []
        prev_p = ticks[0].price

        for i in range(0, len(ticks) - interval_size + 1, interval_size):
            chunk = ticks[i : i + interval_size]
            dp = chunk[-1].price - chunk[0].price

            signed_v = 0.0
            for t in chunk:
                sign = self.classify_trade_sign_lee_ready(t, prev_p)
                signed_v += sign * t.volume
                prev_p = t.price

            intervals.append(TradeInterval(price_change=dp, signed_volume=signed_v))

        return intervals

    def estimate_kyle_lambda(self, intervals: List[TradeInterval]) -> Tuple[float, float]:
        """
        Estimates Kyle's Lambda via OLS regression: Delta_P = lambda * Q + eta
        Returns (lambda, R^2).
        """
        if len(intervals) < self.min_intervals:
            raise ValueError(f"Need at least {self.min_intervals} intervals, got {len(intervals)}")

        q_list = [iv.signed_volume for iv in intervals]
        dp_list = [iv.price_change for iv in intervals]
        n = len(intervals)

        mean_q = sum(q_list) / n
        mean_dp = sum(dp_list) / n

        var_q = sum((q - mean_q) ** 2 for q in q_list) / (n - 1)
        if var_q < 1e-6:
            return 0.0, 0.0

        cov_q_dp = sum((q - mean_q) * (dp - mean_dp) for q, dp in zip(q_list, dp_list)) / (n - 1)
        raw_lambda = max(0.0, cov_q_dp / var_q)

        var_dp = sum((dp - mean_dp) ** 2 for dp in dp_list) / (n - 1)
        if var_dp < 1e-8:
            r_squared = 0.0
        else:
            r_squared = max(0.0, min(1.0, (cov_q_dp ** 2) / (var_q * var_dp)))

        return raw_lambda, r_squared

    def evaluate_microstructure_flow(
        self,
        symbol: str,
        current_price: float,
        intervals: List[TradeInterval],
    ) -> KylesLambdaReport:
        """
        Calculates raw lambda, normalized basis point impact per 10 Lakh shares,
        classifies toxicity regime, and determines maximum recommended POV rate.
        """
        raw_lambda, r2 = self.estimate_kyle_lambda(intervals)

        # Normalize lambda into basis points per 1,000 shares traded
        # (delta P per 1000 shares) / price * 10,000 bps
        norm_lambda_bps = (raw_lambda * 1000.0 / max(1.0, current_price)) * 10000.0

        if norm_lambda_bps >= self.toxic_lambda_hurdle_bps:
            regime = "TOXIC_INFORMED_FLOW_HAZARD"
            directive = "WIDEN_MAKER_SPREADS_RESTRICT_POV"
            rec_pov = 0.05  # Cap POV participation to 5% to avoid adverse selection
        elif norm_lambda_bps <= self.benign_lambda_hurdle_bps:
            regime = "BENIGN_NOISE_FLOW_DEEP_LIQUIDITY"
            directive = "TIGHTEN_MAKER_SPREADS_AGGRESSIVE_TWAP"
            rec_pov = 0.25  # Safe to participate up to 25% POV
        else:
            regime = "NORMAL_LIQUIDITY_EQUILIBRIUM"
            directive = "STANDARD_ALGO_EXECUTION"
            rec_pov = 0.15

        report = KylesLambdaReport(
            symbol=symbol,
            current_price=round(current_price, 2),
            raw_lambda=round(raw_lambda, 6),
            norm_lambda_bps=round(norm_lambda_bps, 2),
            r_squared=round(r2, 4),
            toxicity_regime=regime,
            execution_directive=directive,
            max_recommended_pov=round(rec_pov, 2),
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, report: KylesLambdaReport) -> None:
        """Persists audit record to SQLite database."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO kyles_lambda_telemetry (
                timestamp, symbol, current_price, raw_lambda, norm_lambda_bps,
                r_squared, regime, directive, recommended_pov
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report.timestamp,
                report.symbol,
                report.current_price,
                report.raw_lambda,
                report.norm_lambda_bps,
                report.r_squared,
                report.toxicity_regime,
                report.execution_directive,
                report.max_recommended_pov,
            ),
        )
        conn.commit()
