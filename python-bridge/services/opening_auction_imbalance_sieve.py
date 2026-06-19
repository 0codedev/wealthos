"""
Domain 168 (WP-BR): Intraday Opening Auction Microstructure Imbalance & Price Discovery Sieve

Implements NSE / SEBI pre-open call auction Indicative Equilibrium Price (IEP) discovery,
cumulative order book match maximization, auction imbalance ratio analysis,
and opening gap continuation vs fading execution directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class AuctionOrder:
    price: float
    quantity: float
    side: str  # "BUY" or "SELL"


@dataclass
class EquilibriumResult:
    iep: float
    matched_volume: float
    unmet_buy_volume: float
    unmet_sell_volume: float
    imbalance_ratio: float  # (Q_buy - Q_sell) / (Q_buy + Q_sell)


@dataclass
class OpeningAuctionReport:
    symbol: str
    iep: float
    prior_close: float
    gap_percent: float
    matched_volume: float
    imbalance_ratio: float
    unmet_imbalance: float
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class OpeningAuctionImbalanceSieve:
    """
    Intraday Opening Auction Microstructure Imbalance & Price Discovery Sieve.
    Calculates Indicative Equilibrium Price (IEP) and evaluates opening gap auction dynamics.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        tick_size: float = 0.05,
        min_matched_volume: float = 1000.0,
    ):
        self.db_path = db_path
        self.tick_size = max(0.01, tick_size)
        self.min_matched_volume = min_matched_volume
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for Opening Auction telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS opening_auction_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                iep REAL NOT NULL,
                prior_close REAL NOT NULL,
                gap_percent REAL NOT NULL,
                matched_volume REAL NOT NULL,
                imbalance_ratio REAL NOT NULL,
                unmet_imbalance REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def calculate_equilibrium(
        self,
        orders: List[AuctionOrder],
        prior_close: float,
    ) -> EquilibriumResult:
        """
        Determines the Indicative Equilibrium Price (IEP) according to SEBI/NSE auction rules:
        1. Maximize matched tradable volume: min(cumulative_buy(P), cumulative_sell(P)).
        2. Minimize unmet order quantity (residual imbalance |Q_buy - Q_sell|).
        3. Tie-breaker: price closest to prior close.
        """
        if not orders:
            return EquilibriumResult(
                iep=prior_close,
                matched_volume=0.0,
                unmet_buy_volume=0.0,
                unmet_sell_volume=0.0,
                imbalance_ratio=0.0,
            )

        # Distinct sorted price candidates
        candidate_prices = sorted(list({o.price for o in orders}))

        best_price = prior_close
        max_matched = -1.0
        min_unmet = float("inf")
        min_distance_to_close = float("inf")
        best_unmet_buy = 0.0
        best_unmet_sell = 0.0

        for p in candidate_prices:
            # Aggregate cumulative buy: buyers willing to buy at p or higher
            cum_buy = sum(o.quantity for o in orders if o.side.upper() == "BUY" and o.price >= p)
            # Aggregate cumulative sell: sellers willing to sell at p or lower
            cum_sell = sum(o.quantity for o in orders if o.side.upper() == "SELL" and o.price <= p)

            matched = min(cum_buy, cum_sell)
            unmet = abs(cum_buy - cum_sell)
            dist_close = abs(p - prior_close)

            # Rule 1: Maximize matched volume
            if matched > max_matched:
                max_matched = matched
                min_unmet = unmet
                min_distance_to_close = dist_close
                best_price = p
                best_unmet_buy = max(0.0, cum_buy - cum_sell)
                best_unmet_sell = max(0.0, cum_sell - cum_buy)
            elif abs(matched - max_matched) < 1e-5:
                # Rule 2: Minimize unmet order quantity
                if unmet < min_unmet:
                    min_unmet = unmet
                    min_distance_to_close = dist_close
                    best_price = p
                    best_unmet_buy = max(0.0, cum_buy - cum_sell)
                    best_unmet_sell = max(0.0, cum_sell - cum_buy)
                elif abs(unmet - min_unmet) < 1e-5:
                    # Rule 3: Price closest to prior close
                    if dist_close < min_distance_to_close:
                        min_distance_to_close = dist_close
                        best_price = p
                        best_unmet_buy = max(0.0, cum_buy - cum_sell)
                        best_unmet_sell = max(0.0, cum_sell - cum_buy)

        total_orders_at_iep = (best_unmet_buy + max_matched) + (best_unmet_sell + max_matched)
        imbalance_ratio = 0.0
        if total_orders_at_iep > 0:
            imbalance_ratio = (best_unmet_buy - best_unmet_sell) / total_orders_at_iep

        return EquilibriumResult(
            iep=best_price,
            matched_volume=round(max_matched, 2),
            unmet_buy_volume=round(best_unmet_buy, 2),
            unmet_sell_volume=round(best_unmet_sell, 2),
            imbalance_ratio=round(imbalance_ratio, 4),
        )

    def analyze_opening_auction(
        self,
        symbol: str,
        orders: List[AuctionOrder],
        prior_close: float,
    ) -> OpeningAuctionReport:
        """
        Evaluates auction discovery, gap magnitude, and imbalance skew.
        Directives:
        - AUCTION_GAP_CONTINUATION_LONG
        - AUCTION_GAP_CONTINUATION_SHORT
        - AUCTION_GAP_FADING_SHORT
        - AUCTION_GAP_FADING_LONG
        - AUCTION_ANEMIC_TRAP_NO_TRADE
        - AUCTION_BALANCED_OPEN
        """
        eq = self.calculate_equilibrium(orders, prior_close)
        gap_pct = round(((eq.iep - prior_close) / prior_close) * 100.0, 3)
        net_unmet = round(eq.unmet_buy_volume - eq.unmet_sell_volume, 2)

        # 1. Anemic matched volume trap check
        if eq.matched_volume < self.min_matched_volume:
            regime = "ANEMIC_AUCTION_LIQUIDITY_TRAP"
            directive = "STAND_ASIDE_WAIT_FOR_REGULAR_MARKET"
        elif abs(gap_pct) < 0.15:
            regime = "BALANCED_EQUILIBRIUM_OPEN"
            directive = "STANDARD_ORB_OBSERVATION"
        elif gap_pct >= 0.15:
            # Bullish Gap
            if eq.imbalance_ratio >= 0.15:
                # Strong buy demand overhang -> Continuation
                regime = "BULLISH_GAP_SURPLUS_ACCUMULATION"
                directive = "EXECUTE_OPENING_DRIVE_LONG"
            elif eq.imbalance_ratio <= -0.10 or gap_pct >= 2.0:
                # Sell overhang at highs or extreme gap exhaustion -> Fade
                regime = "BULLISH_GAP_EXHAUSTION_OVERHANG"
                directive = "FADE_GAP_SHORT_TO_PRIOR_CLOSE"
            else:
                regime = "BULLISH_GAP_NEUTRAL_FLOW"
                directive = "TRAIL_LONG_ORB_CONFIRMATION"
        else:
            # Bearish Gap (gap_pct <= -0.15)
            if eq.imbalance_ratio <= -0.15:
                # Heavy sell overhang -> Continuation
                regime = "BEARISH_GAP_SURPLUS_DISTRIBUTION"
                directive = "EXECUTE_OPENING_DRIVE_SHORT"
            elif eq.imbalance_ratio >= 0.10 or gap_pct <= -2.0:
                # Buy absorption at discount or extreme panic gap -> Fade
                regime = "BEARISH_GAP_ABSORPTION_REVERSAL"
                directive = "FADE_GAP_LONG_TO_PRIOR_CLOSE"
            else:
                regime = "BEARISH_GAP_NEUTRAL_FLOW"
                directive = "TRAIL_SHORT_ORB_CONFIRMATION"

        report = OpeningAuctionReport(
            symbol=symbol,
            iep=eq.iep,
            prior_close=prior_close,
            gap_percent=gap_pct,
            matched_volume=eq.matched_volume,
            imbalance_ratio=eq.imbalance_ratio,
            unmet_imbalance=net_unmet,
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: OpeningAuctionReport) -> None:
        """Persists evaluation results to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO opening_auction_telemetry (
                timestamp, symbol, iep, prior_close, gap_percent,
                matched_volume, imbalance_ratio, unmet_imbalance,
                regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.iep,
                rep.prior_close,
                rep.gap_percent,
                rep.matched_volume,
                rep.imbalance_ratio,
                rep.unmet_imbalance,
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
            SELECT symbol, iep, prior_close, gap_percent, matched_volume, imbalance_ratio, regime, directive
            FROM opening_auction_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
