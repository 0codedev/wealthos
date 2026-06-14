"""
Domain 176 (WP-BZ): Cross-Venue Latency & Sub-Millisecond Order Routing Sieve

Implements Budish-Cramton-Shim (2015) continuous-time cross-venue race modeling,
round-trip latency (RTT) tracking, jitter standard deviation profiling,
net latency-arbitrage profit expectation after statutory fees, and Smart Order Routing (SOR) directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class VenueQuote:
    venue_name: str
    bid_price: float
    ask_price: float
    bid_qty: float
    ask_qty: float
    fee_bps: float
    latency_ms: float  # One-way transmission + matching engine latency


@dataclass
class CrossVenueReport:
    symbol: str
    venue_a: str
    venue_b: str
    gross_spread_bps: float
    net_spread_bps: float
    fastest_venue: str
    latency_advantage_ms: float
    win_probability: float
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CrossVenueLatencySieve:
    """
    Cross-Venue Latency Arbitrage & Smart Order Routing Sieve.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        jitter_std_ms: float = 0.40,
        max_tolerable_latency_ms: float = 20.0,
    ):
        self.db_path = db_path
        self.jitter_std_ms = max(0.01, jitter_std_ms)
        self.max_tolerable_latency_ms = max_tolerable_latency_ms
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for Cross-Venue Latency telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS cross_venue_latency_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                venue_a TEXT NOT NULL,
                venue_b TEXT NOT NULL,
                gross_spread_bps REAL NOT NULL,
                net_spread_bps REAL NOT NULL,
                fastest_venue TEXT NOT NULL,
                latency_advantage_ms REAL NOT NULL,
                win_prob REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def norm_cdf(x: float) -> float:
        return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

    def calculate_race_win_probability(
        self,
        our_latency_ms: float,
        competitor_latency_ms: float,
    ) -> float:
        """
        Calculates probability of our packet arriving first at the destination venue:
        P(Win) = Phi((tau_competitor - tau_our) / (sqrt(2) * sigma_jitter)).
        """
        diff = competitor_latency_ms - our_latency_ms
        denom = math.sqrt(2.0) * self.jitter_std_ms
        return round(self.norm_cdf(diff / denom), 4)

    def evaluate_arbitrage_opportunity(
        self,
        symbol: str,
        quote_a: VenueQuote,
        quote_b: VenueQuote,
        competitor_latency_ms: float = 2.0,
    ) -> CrossVenueReport:
        """
        Evaluates cross-venue arbitrage (Buy on cheaper venue, sell on richer venue):
        Case 1: Buy Venue A (at Ask_A), Sell Venue B (at Bid_B).
        Case 2: Buy Venue B (at Ask_B), Sell Venue A (at Bid_A).
        """
        # Safety halt on network jitter/latency spikes
        if quote_a.latency_ms > self.max_tolerable_latency_ms or quote_b.latency_ms > self.max_tolerable_latency_ms:
            return CrossVenueReport(
                symbol=symbol,
                venue_a=quote_a.venue_name,
                venue_b=quote_b.venue_name,
                gross_spread_bps=0.0,
                net_spread_bps=-99.0,
                fastest_venue="NONE",
                latency_advantage_ms=0.0,
                win_probability=0.0,
                regime="NETWORK_LATENCY_SPIKE_HALT",
                trade_directive="HALT_CROSS_VENUE_ROUTING_LATENCY_SPIKE",
            )

        mid_ref = (quote_a.bid_price + quote_b.ask_price) / 2.0

        # Opportunity 1: Buy A (Ask_A), Sell B (Bid_B)
        spread_1 = quote_b.bid_price - quote_a.ask_price
        fees_1_bps = quote_a.fee_bps + quote_b.fee_bps
        spread_1_bps = (spread_1 / mid_ref) * 10000.0
        net_1_bps = spread_1_bps - fees_1_bps

        # Opportunity 2: Buy B (Ask_B), Sell A (Bid_A)
        spread_2 = quote_a.bid_price - quote_b.ask_price
        fees_2_bps = quote_a.fee_bps + quote_b.fee_bps
        spread_2_bps = (spread_2 / mid_ref) * 10000.0
        net_2_bps = spread_2_bps - fees_2_bps

        # Choose best directional opportunity
        if net_1_bps >= net_2_bps:
            gross_bps = round(spread_1_bps, 2)
            net_bps = round(net_1_bps, 2)
            buy_venue, sell_venue = quote_a.venue_name, quote_b.venue_name
            our_eff_latency = max(quote_a.latency_ms, quote_b.latency_ms)
        else:
            gross_bps = round(spread_2_bps, 2)
            net_bps = round(net_2_bps, 2)
            buy_venue, sell_venue = quote_b.venue_name, quote_a.venue_name
            our_eff_latency = max(quote_a.latency_ms, quote_b.latency_ms)

        # Fastest venue for smart order routing
        fastest_venue = quote_a.venue_name if quote_a.latency_ms <= quote_b.latency_ms else quote_b.venue_name
        latency_advantage = round(competitor_latency_ms - our_eff_latency, 3)
        win_prob = self.calculate_race_win_probability(our_eff_latency, competitor_latency_ms)

        # Directives
        if net_bps > 0.0 and win_prob >= 0.70:
            regime = "CROSS_VENUE_LATENCY_ARBITRAGE_ACTIVE"
            directive = f"EXECUTE_CROSS_VENUE_ARB_BUY_{buy_venue}_SELL_{sell_venue}"
        elif net_bps > 0.0 and win_prob < 0.70:
            regime = "RACE_ADVERSE_SELECTION_DEFICIT"
            directive = "STAND_ASIDE_HIGH_COMPETITOR_WIN_PROBABILITY"
        else:
            regime = "NO_ARBITRAGE_EQUILIBRIUM"
            directive = f"ROUTE_SMART_ORDER_CHEAPEST_{fastest_venue}"

        report = CrossVenueReport(
            symbol=symbol,
            venue_a=quote_a.venue_name,
            venue_b=quote_b.venue_name,
            gross_spread_bps=gross_bps,
            net_spread_bps=net_bps,
            fastest_venue=fastest_venue,
            latency_advantage_ms=latency_advantage,
            win_probability=win_prob,
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: CrossVenueReport) -> None:
        """Persists evaluation results to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO cross_venue_latency_telemetry (
                timestamp, symbol, venue_a, venue_b, gross_spread_bps,
                net_spread_bps, fastest_venue, latency_advantage_ms,
                win_prob, regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.venue_a,
                rep.venue_b,
                rep.gross_spread_bps,
                rep.net_spread_bps,
                rep.fastest_venue,
                rep.latency_advantage_ms,
                rep.win_probability,
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
            SELECT symbol, venue_a, venue_b, net_spread_bps, win_prob, regime, directive
            FROM cross_venue_latency_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
