"""
Domain 163 (WP-BM): High-Frequency Order Flow Toxicity & VPIN Microstructure Shock Sentry

Implements Easley, Lopez de Prado, and O'Hara (2012) Volume-Synchronized Probability of Toxicity
(VPIN) framework: volume-clock discretization, bulk volume order classification, rolling
bucket imbalance computation, empirical toxicity percentiles, and market maker quote retreat sentries.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import List, Tuple, Optional


@dataclass
class TradeTick:
    timestamp: str
    price: float
    volume: float
    bid: float
    ask: float


@dataclass
class VolumeBucket:
    bucket_index: int
    buy_volume: float
    sell_volume: float
    total_volume: float
    imbalance: float  # |buy_vol - sell_vol|


@dataclass
class VPINReport:
    symbol: str
    current_price: float
    vpin_score: float
    vpin_percentile: float
    bucket_size: float
    num_buckets_evaluated: int
    latest_bucket_imbalance: float
    toxicity_regime: str
    defense_directive: str
    quote_width_multiplier: float
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class VPINToxicitySentry:
    """
    Volume-Synchronized Probability of Toxicity (VPIN) Microstructure Sentry.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        vpin_window_buckets: int = 50,
        toxic_vpin_hurdle: float = 0.65,
        benign_vpin_hurdle: float = 0.30,
    ):
        self.db_path = db_path
        self.vpin_window_buckets = vpin_window_buckets
        self.toxic_vpin_hurdle = toxic_vpin_hurdle
        self.benign_vpin_hurdle = benign_vpin_hurdle
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for VPIN telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS vpin_toxicity_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                current_price REAL NOT NULL,
                vpin_score REAL NOT NULL,
                percentile REAL NOT NULL,
                bucket_imbalance REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL,
                quote_multiplier REAL NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def classify_trade_direction(tick: TradeTick, prev_price: float) -> int:
        """
        Lee-Ready tick rule classification: +1 Buy, -1 Sell.
        """
        mid = (tick.bid + tick.ask) / 2.0
        if tick.price > mid + 1e-5:
            return 1
        elif tick.price < mid - 1e-5:
            return -1
        else:
            if tick.price > prev_price:
                return 1
            elif tick.price < prev_price:
                return -1
            return 1  # Default to buy if indeterminate

    def slice_into_volume_buckets(
        self,
        ticks: List[TradeTick],
        bucket_size: float,
    ) -> List[VolumeBucket]:
        """
        Converts physical time tick stream into equal-sized volume-clock buckets.
        """
        if not ticks or bucket_size <= 0:
            return []

        buckets: List[VolumeBucket] = []
        curr_buy = 0.0
        curr_sell = 0.0
        rem_in_bucket = bucket_size
        prev_p = ticks[0].price
        bucket_idx = 0

        for t in ticks:
            direction = self.classify_trade_direction(t, prev_p)
            prev_p = t.price
            trade_vol = t.volume

            while trade_vol > 0:
                fill_vol = min(trade_vol, rem_in_bucket)
                if direction == 1:
                    curr_buy += fill_vol
                else:
                    curr_sell += fill_vol

                trade_vol -= fill_vol
                rem_in_bucket -= fill_vol

                if rem_in_bucket <= 1e-6:
                    # Bucket is full!
                    imb = abs(curr_buy - curr_sell)
                    buckets.append(
                        VolumeBucket(
                            bucket_index=bucket_idx,
                            buy_volume=curr_buy,
                            sell_volume=curr_sell,
                            total_volume=bucket_size,
                            imbalance=imb,
                        )
                    )
                    bucket_idx += 1
                    curr_buy = 0.0
                    curr_sell = 0.0
                    rem_in_bucket = bucket_size

        return buckets

    def compute_vpin(self, buckets: List[VolumeBucket]) -> float:
        """
        Calculates VPIN across rolling window: VPIN = sum(|V_b - V_s|) / (N * V)
        """
        if len(buckets) < self.vpin_window_buckets:
            # If fewer than N buckets, compute on available buckets
            window = buckets
        else:
            window = buckets[-self.vpin_window_buckets :]

        if not window:
            return 0.0

        total_imbalance = sum(b.imbalance for b in window)
        total_vol = sum(b.total_volume for b in window)

        if total_vol <= 0:
            return 0.0

        return max(0.0, min(1.0, total_imbalance / total_vol))

    def evaluate_order_flow_toxicity(
        self,
        symbol: str,
        current_price: float,
        ticks: List[TradeTick],
        bucket_size: float,
        historical_vpins: Optional[List[float]] = None,
    ) -> VPINReport:
        """
        Full VPIN evaluation: slices ticks into volume buckets, computes VPIN,
        calculates empirical percentile, and issues quoting defense directives.
        """
        buckets = self.slice_into_volume_buckets(ticks, bucket_size)
        vpin = self.compute_vpin(buckets)

        latest_imb = buckets[-1].imbalance / bucket_size if buckets else 0.0

        # Empirical Percentile CDF
        if historical_vpins and len(historical_vpins) >= 10:
            count_below = sum(1 for v in historical_vpins if v <= vpin)
            pct = count_below / len(historical_vpins)
        else:
            # Sigmoid proxy
            pct = 1.0 / (1.0 + math.exp(-8.0 * (vpin - 0.45)))

        # Regimes & Quoting Multiplier
        if vpin >= self.toxic_vpin_hurdle or pct >= 0.90:
            regime = "TOXIC_ORDER_FLOW_TSUNAMI"
            directive = "EMERGENCY_PULL_MAKER_QUOTES_WIDEN_MAX"
            quote_mult = 3.50  # Widen quoting spreads by 3.5x
        elif vpin <= self.benign_vpin_hurdle:
            regime = "BENIGN_NOISE_TRADER_REGIME"
            directive = "POST_TIGHT_INSIDE_SPREAD_QUOTES"
            quote_mult = 1.00  # Tight normal spread
        else:
            regime = "MODERATE_INFORMED_FLOW_TRANSITION"
            directive = "LEAN_DEFENSIVE_SKEW_QUOTES"
            quote_mult = 1.75

        report = VPINReport(
            symbol=symbol,
            current_price=round(current_price, 2),
            vpin_score=round(vpin, 4),
            vpin_percentile=round(pct, 4),
            bucket_size=round(bucket_size, 1),
            num_buckets_evaluated=len(buckets),
            latest_bucket_imbalance=round(latest_imb, 4),
            toxicity_regime=regime,
            defense_directive=directive,
            quote_width_multiplier=round(quote_mult, 2),
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, report: VPINReport) -> None:
        """Persists audit record to SQLite database."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO vpin_toxicity_telemetry (
                timestamp, symbol, current_price, vpin_score, percentile,
                bucket_imbalance, regime, directive, quote_multiplier
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report.timestamp,
                report.symbol,
                report.current_price,
                report.vpin_score,
                report.vpin_percentile,
                report.latest_bucket_imbalance,
                report.toxicity_regime,
                report.defense_directive,
                report.quote_width_multiplier,
            ),
        )
        conn.commit()
