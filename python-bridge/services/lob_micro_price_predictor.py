"""
Domain 155 (WP-BE): High-Frequency Limit Order Book Micro-Price & Imbalance Drift Predictor

Implements Sasha Stoikov's (2018) Micro-Price estimator, multi-level exponentially decayed
order book depth imbalance, Markov state transition tick jump probability, and sub-millisecond
execution directives for algorithmic spread trading.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import List


@dataclass
class LOBLevel:
    price: float
    quantity: float


@dataclass
class LOBDepthSnapshot:
    symbol: str
    bids: List[LOBLevel]  # Sorted descending by price (Level 1 is best bid)
    asks: List[LOBLevel]  # Sorted ascending by price (Level 1 is best ask)
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class MicroPriceReport:
    symbol: str
    best_bid: float
    best_ask: float
    spread: float
    mid_price: float
    micro_price: float
    imbalance_ratio: float
    multi_level_imbalance: float
    drift_bps: float
    prob_next_tick_ask: float
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class LOBMicroPricePredictor:
    """
    High-Frequency Limit Order Book Micro-Price & Imbalance Drift Sieve.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        decay_lambda: float = 0.50,
        drift_hurdle_bps: float = 3.0,
        imbalance_hurdle: float = 0.75,
        markov_sensitivity: float = 6.0,
    ):
        self.db_path = db_path
        self.decay_lambda = decay_lambda
        self.drift_hurdle_bps = drift_hurdle_bps
        self.imbalance_hurdle = imbalance_hurdle
        self.markov_sensitivity = markov_sensitivity
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for micro-price telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS lob_micro_price_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                best_bid REAL NOT NULL,
                best_ask REAL NOT NULL,
                mid_price REAL NOT NULL,
                micro_price REAL NOT NULL,
                imbalance REAL NOT NULL,
                drift_bps REAL NOT NULL,
                prob_ask REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def calculate_micro_price(self, snapshot: LOBDepthSnapshot) -> MicroPriceReport:
        """
        Calculates Stoikov Level-1 and Multi-level micro-price, fair value drift in bps,
        and next tick Markov jump probability.
        """
        if not snapshot.bids or not snapshot.asks:
            raise ValueError("LOB snapshot must contain at least 1 bid and 1 ask level.")

        best_bid = snapshot.bids[0].price
        best_ask = snapshot.asks[0].price
        spread = max(1e-4, best_ask - best_bid)
        mid_price = (best_bid + best_ask) / 2.0

        # Level 1 Imbalance
        q_b1 = max(0.0, snapshot.bids[0].quantity)
        q_a1 = max(0.0, snapshot.asks[0].quantity)
        denom_1 = max(1e-4, q_b1 + q_a1)
        imb_1 = q_b1 / denom_1

        # Multi-level exponentially decayed effective depth
        k_levels = min(len(snapshot.bids), len(snapshot.asks))
        eff_bid = 0.0
        eff_ask = 0.0

        for k in range(k_levels):
            weight = math.exp(-self.decay_lambda * k)
            eff_bid += weight * max(0.0, snapshot.bids[k].quantity)
            eff_ask += weight * max(0.0, snapshot.asks[k].quantity)

        denom_multi = max(1e-4, eff_bid + eff_ask)
        imb_multi = eff_bid / denom_multi

        # Sasha Stoikov Micro-Price formulation
        micro_price = best_bid + (imb_multi * spread)

        # Drift in basis points relative to mid
        drift_pts = micro_price - mid_price
        drift_bps = (drift_pts / mid_price) * 10000.0

        # Markov probability of next trade printing on Ask (lifting ask)
        prob_ask = 1.0 / (1.0 + math.exp(-self.markov_sensitivity * (imb_multi - 0.5)))

        # Regime & Directives
        if drift_bps >= self.drift_hurdle_bps and imb_multi >= self.imbalance_hurdle:
            regime = "STRONG_UPWARD_IMBALANCE_DRIFT"
            trade_directive = "CROSS_SPREAD_AGGRESSIVE_BUY"
        elif drift_bps <= -self.drift_hurdle_bps and imb_multi <= (1.0 - self.imbalance_hurdle):
            regime = "STRONG_DOWNWARD_IMBALANCE_DRIFT"
            trade_directive = "CROSS_SPREAD_AGGRESSIVE_SELL"
        elif abs(drift_bps) < 1.0:
            regime = "BALANCED_BOOK_EQUILIBRIUM"
            trade_directive = "POST_PASSIVE_BID_ASK_LIQUIDITY"
        elif drift_bps > 0:
            regime = "MODERATE_BULLISH_DRIFT"
            trade_directive = "LEAN_ON_BEST_BID"
        else:
            regime = "MODERATE_BEARISH_DRIFT"
            trade_directive = "LEAN_ON_BEST_ASK"

        report = MicroPriceReport(
            symbol=snapshot.symbol,
            best_bid=round(best_bid, 2),
            best_ask=round(best_ask, 2),
            spread=round(spread, 2),
            mid_price=round(mid_price, 2),
            micro_price=round(micro_price, 3),
            imbalance_ratio=round(imb_1, 4),
            multi_level_imbalance=round(imb_multi, 4),
            drift_bps=round(drift_bps, 2),
            prob_next_tick_ask=round(prob_ask, 4),
            regime=regime,
            trade_directive=trade_directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, report: MicroPriceReport) -> None:
        """Persists audit record to SQLite database."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO lob_micro_price_telemetry (
                timestamp, symbol, best_bid, best_ask, mid_price,
                micro_price, imbalance, drift_bps, prob_ask,
                regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report.timestamp,
                report.symbol,
                report.best_bid,
                report.best_ask,
                report.mid_price,
                report.micro_price,
                report.multi_level_imbalance,
                report.drift_bps,
                report.prob_next_tick_ask,
                report.regime,
                report.trade_directive,
            ),
        )
        conn.commit()
