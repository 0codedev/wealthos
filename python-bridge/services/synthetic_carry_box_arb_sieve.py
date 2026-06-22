"""
Domain 161 (WP-BK): Multi-Asset Synthetic Carry & Implied Yield Curve Arbitrage Sieve

Implements 4-legged options box spread synthetic zero-coupon bond replication, implied money-market
interest rate extraction, sovereign benchmark spread comparison, and automated synthetic
lending / borrowing carry arbitrage directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import Optional


@dataclass
class OptionQuote:
    strike: float
    bid: float
    ask: float


@dataclass
class BoxSpreadInput:
    symbol: str
    strike_1: float
    strike_2: float
    days_to_expiry: float
    call_1: OptionQuote
    put_1: OptionQuote
    call_2: OptionQuote
    put_2: OptionQuote
    benchmark_yield_annual: float  # Sovereign G-Sec or MIBOR rate (e.g. 0.065 for 6.5%)
    friction_bps: float = 8.0     # Exchange STT, transaction costs, and brokerage


@dataclass
class SyntheticCarryReport:
    symbol: str
    strike_1: float
    strike_2: float
    box_width: float
    days_to_expiry: float
    buy_box_cost: float
    sell_box_proceeds: float
    implied_lending_rate: float
    implied_borrowing_rate: float
    benchmark_rate: float
    lending_spread_bps: float
    borrowing_spread_bps: float
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class SyntheticCarryBoxArbSieve:
    """
    Synthetic Money-Market Carry & Box Spread Arbitrage Sieve.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        spread_hurdle_bps: float = 35.0,  # 35 bps minimum net alpha after statutory friction
    ):
        self.db_path = db_path
        self.spread_hurdle_bps = spread_hurdle_bps
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for synthetic carry telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS synthetic_carry_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                strike_1 REAL NOT NULL,
                strike_2 REAL NOT NULL,
                box_width REAL NOT NULL,
                buy_cost REAL NOT NULL,
                lending_rate REAL NOT NULL,
                borrowing_rate REAL NOT NULL,
                benchmark_rate REAL NOT NULL,
                lending_spread_bps REAL NOT NULL,
                borrowing_spread_bps REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def evaluate_box_spread(self, inp: BoxSpreadInput) -> SyntheticCarryReport:
        """
        Calculates implied lending and borrowing rates from 4-leg option box spread,
        compares with sovereign benchmark, and issues money-market arbitrage directives.
        """
        k1 = min(inp.strike_1, inp.strike_2)
        k2 = max(inp.strike_1, inp.strike_2)
        box_width = k2 - k1
        if box_width <= 0:
            raise ValueError("Strikes must be strictly distinct.")

        t_years = max(1.0 / 365.0, inp.days_to_expiry / 365.0)

        # Cost to BUY Box Spread (Synthetic Lending: Pay debit now, receive box_width at T):
        # Buy Call 1 (Ask) - Sell Put 1 (Bid) - Buy Call 2 (Bid) + Buy Put 2 (Ask)
        # Cost = Ask_C1 - Bid_P1 - (Bid_C2 - Ask_P2)
        buy_cost = (inp.call_1.ask - inp.put_1.bid) - (inp.call_2.bid - inp.put_2.ask)

        # Proceeds from SELLING Box Spread (Synthetic Borrowing: Receive credit now, repay box_width at T):
        # Sell Call 1 (Bid) - Buy Put 1 (Ask) - Sell Call 2 (Ask) + Buy Put 2 (Bid)
        # Proceeds = Bid_C1 - Ask_P1 - (Ask_C2 - Bid_P2)
        sell_proceeds = (inp.call_1.bid - inp.put_1.ask) - (inp.call_2.ask - inp.put_2.bid)

        # Annualized Implied Lending Rate (r_lend = ln(Width / Cost) / T)
        if buy_cost > 0 and buy_cost < box_width:
            r_lend = (1.0 / t_years) * math.log(box_width / buy_cost)
        else:
            r_lend = -0.99  # Inadmissible or inverted

        # Annualized Implied Borrowing Rate (r_borrow = ln(Width / Proceeds) / T)
        if sell_proceeds > 0 and sell_proceeds < box_width:
            r_borrow = (1.0 / t_years) * math.log(box_width / sell_proceeds)
        else:
            r_borrow = 0.99

        # Calculate Net Spreads in bps relative to Benchmark Yield
        # Lending: earn r_lend, pay benchmark funding
        lending_spread_bps = ((r_lend - inp.benchmark_yield_annual) * 10000.0) - inp.friction_bps

        # Borrowing: borrow at r_borrow, invest in benchmark
        borrowing_spread_bps = ((inp.benchmark_yield_annual - r_borrow) * 10000.0) - inp.friction_bps

        # Regime & Directives
        if lending_spread_bps >= self.spread_hurdle_bps:
            regime = "SYNTHETIC_LENDING_CARRY_ARBITRAGE"
            directive = "BUY_BOX_LOCK_HIGH_SYNTHETIC_YIELD"
        elif borrowing_spread_bps >= self.spread_hurdle_bps:
            regime = "SYNTHETIC_BORROWING_CARRY_ARBITRAGE"
            directive = "SELL_BOX_BORROW_CHEAP_CASH"
        else:
            regime = "CARRY_EFFICIENT_MARKET_EQUILIBRIUM"
            directive = "NO_CARRY_EDGE_STAND_ASIDE"

        report = SyntheticCarryReport(
            symbol=inp.symbol,
            strike_1=k1,
            strike_2=k2,
            box_width=round(box_width, 2),
            days_to_expiry=round(inp.days_to_expiry, 1),
            buy_box_cost=round(buy_cost, 2),
            sell_box_proceeds=round(sell_proceeds, 2),
            implied_lending_rate=round(r_lend, 4),
            implied_borrowing_rate=round(r_borrow, 4),
            benchmark_rate=round(inp.benchmark_yield_annual, 4),
            lending_spread_bps=round(lending_spread_bps, 2),
            borrowing_spread_bps=round(borrowing_spread_bps, 2),
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, report: SyntheticCarryReport) -> None:
        """Persists audit record to SQLite database."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO synthetic_carry_telemetry (
                timestamp, symbol, strike_1, strike_2, box_width, buy_cost,
                lending_rate, borrowing_rate, benchmark_rate, lending_spread_bps,
                borrowing_spread_bps, regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report.timestamp,
                report.symbol,
                report.strike_1,
                report.strike_2,
                report.box_width,
                report.buy_box_cost,
                report.implied_lending_rate,
                report.implied_borrowing_rate,
                report.benchmark_rate,
                report.lending_spread_bps,
                report.borrowing_spread_bps,
                report.regime,
                report.trade_directive,
            ),
        )
        conn.commit()
