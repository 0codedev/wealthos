"""
Domain 178 (WP-CB): Cross-Exchange Crypto / Futures Basis Curve Arbitrage Sieve

Implements cash-and-carry basis term structure analytics, perpetual funding rate yield harvest,
cost-of-carry theoretical forward bounds, round-trip exchange and margin friction models,
and delta-neutral basis convergence execution directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


class ContractType(str, Enum):
    CALENDAR_FUTURES = "CALENDAR_FUTURES"
    PERPETUAL_SWAP = "PERPETUAL_SWAP"


class ArbitrageDirective(str, Enum):
    LONG_CASH_AND_CARRY = "LONG_CASH_AND_CARRY"  # Long Spot + Short Futures (Contango Premium)
    REVERSE_CASH_AND_CARRY = "REVERSE_CASH_AND_CARRY"  # Short Spot + Long Futures (Backwardation Discount)
    PERP_FUNDING_RATE_HARVEST = "PERP_FUNDING_RATE_HARVEST"  # Long Spot + Short Perp (Earn 8h Funding)
    NO_ARBITRAGE_EQUILIBRIUM = "NO_ARBITRAGE_EQUILIBRIUM"  # Basis within friction band
    UNPROFITABLE_FRICTION_EXHAUSTION = "UNPROFITABLE_FRICTION_EXHAUSTION"  # Edge eroded by fees/borrow
    EMERGENCY_DELEVERAGE_PINCH = "EMERGENCY_DELEVERAGE_PINCH"  # Basis blow-out or margin pinch


@dataclass
class BasisQuote:
    symbol: str
    spot_price: float
    futures_price: float
    contract_type: ContractType = ContractType.CALENDAR_FUTURES
    days_to_expiry: float = 30.0  # Relevant for dated futures
    funding_rate_8h: float = 0.0001  # Relevant for perpetual swaps (e.g., 0.01% per 8h = 0.0001)
    spot_borrow_apr: float = 0.05  # 5% annual cost to borrow spot for reverse arb
    risk_free_rate: float = 0.065  # 6.5% sovereign/stablecoin risk-free benchmark
    taker_fee_bps: float = 5.0  # 5 bps taker fee per leg
    maker_fee_bps: float = 2.0  # 2 bps maker fee per leg
    slippage_bps: float = 3.0  # Estimated slippage in basis points


@dataclass
class BasisEvaluation:
    symbol: str
    contract_type: ContractType
    spot_price: float
    futures_price: float
    basis_bps: float  # (F - S) / S * 10000
    theoretical_basis_bps: float  # Cost-of-carry fair value basis
    annualized_basis_apy: float  # (Basis% * 365 / DTE) * 100
    funding_apy: float  # Annualized perpetual funding rate
    roundtrip_friction_bps: float  # Total entry + exit fee + borrow + slippage
    net_annualized_edge_pct: float  # Net APY after amortized friction
    directive: ArbitrageDirective
    rationale: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class FuturesBasisArbitrageSieve:
    """
    Delta-Neutral Futures and Perpetual Basis Arbitrage Sieve.
    """

    def __init__(self, db_path: str = ":memory:", min_hurdle_apy_pct: float = 8.0):
        self.db_path = db_path
        self.min_hurdle_apy_pct = min_hurdle_apy_pct
        self._conn: Optional[sqlite3.Connection] = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for basis arbitrage telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS basis_arbitrage_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                contract_type TEXT NOT NULL,
                spot_price REAL NOT NULL,
                futures_price REAL NOT NULL,
                basis_bps REAL NOT NULL,
                annualized_basis_apy REAL NOT NULL,
                net_annualized_edge_pct REAL NOT NULL,
                directive TEXT NOT NULL,
                rationale TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def calculate_cost_of_carry_price(
        self, spot: float, r_f: float, days_to_expiry: float, borrow_or_storage: float = 0.0
    ) -> float:
        """
        Computes theoretical forward price F* = S * exp((r_f + c) * T).
        """
        t_years = max(days_to_expiry, 0.001) / 365.0
        return round(spot * math.exp((r_f + borrow_or_storage) * t_years), 4)

    def evaluate_calendar_basis(self, quote: BasisQuote) -> BasisEvaluation:
        """
        Evaluates dated calendar futures cash-and-carry and reverse cash-and-carry basis.
        """
        if quote.spot_price <= 0 or quote.futures_price <= 0:
            raise ValueError("Prices must be strictly positive.")

        days = max(quote.days_to_expiry, 0.001)
        t_years = days / 365.0

        # Market basis in bps
        raw_spread = quote.futures_price - quote.spot_price
        basis_bps = (raw_spread / quote.spot_price) * 10000.0

        # Theoretical fair value forward price
        f_theoretical = self.calculate_cost_of_carry_price(quote.spot_price, quote.risk_free_rate, days)
        theo_basis_bps = ((f_theoretical - quote.spot_price) / quote.spot_price) * 10000.0

        # Gross annualized APY
        gross_basis_pct = (raw_spread / quote.spot_price) * 100.0
        annualized_basis_apy = gross_basis_pct * (365.0 / days)

        # Roundtrip friction: 2 legs entry (spot + fut) + 2 legs exit (spot + fut)
        # Entry: taker, Exit at expiry: maker or delivery
        fees_bps = (quote.taker_fee_bps + quote.maker_fee_bps) * 2.0
        friction_bps = fees_bps + (quote.slippage_bps * 2.0)
        friction_pct_total = friction_bps / 100.0  # in percent

        # Amortize friction over trade horizon to annual terms
        annualized_friction_pct = friction_pct_total * (365.0 / days)

        funding_apy = 0.0

        # Determine regime and edge
        if basis_bps > 0:
            # Contango -> Long Spot, Short Futures
            net_edge_apy = annualized_basis_apy - annualized_friction_pct
            if net_edge_apy >= self.min_hurdle_apy_pct:
                directive = ArbitrageDirective.LONG_CASH_AND_CARRY
                rationale = (
                    f"Strong contango basis (+{basis_bps:.1f} bps, APY={annualized_basis_apy:.2f}%). "
                    f"Net APY after amortized friction ({annualized_friction_pct:.2f}%) is {net_edge_apy:.2f}% >= "
                    f"hurdle {self.min_hurdle_apy_pct:.1f}%."
                )
            elif net_edge_apy > 0:
                directive = ArbitrageDirective.UNPROFITABLE_FRICTION_EXHAUSTION
                rationale = (
                    f"Positive basis (+{basis_bps:.1f} bps) but net APY {net_edge_apy:.2f}% is below hurdle "
                    f"{self.min_hurdle_apy_pct:.1f}% due to friction ({annualized_friction_pct:.2f}%)."
                )
            else:
                directive = ArbitrageDirective.NO_ARBITRAGE_EQUILIBRIUM
                rationale = f"Basis spread (+{basis_bps:.1f} bps) entirely absorbed by transaction friction."
        else:
            # Backwardation -> Short Spot (borrow), Long Futures
            # Gross backwardation gain
            gross_backwardation_pct = (-raw_spread / quote.spot_price) * 100.0
            annualized_backwardation_apy = gross_backwardation_pct * (365.0 / days)
            # Must pay spot borrow fee (quote.spot_borrow_apr in %)
            net_edge_apy = annualized_backwardation_apy - annualized_friction_pct - (quote.spot_borrow_apr * 100.0)

            if net_edge_apy >= self.min_hurdle_apy_pct:
                directive = ArbitrageDirective.REVERSE_CASH_AND_CARRY
                rationale = (
                    f"Severe backwardation basis ({basis_bps:.1f} bps, Gross APY={annualized_backwardation_apy:.2f}%). "
                    f"Net APY after borrow fee ({quote.spot_borrow_apr*100:.1f}%) and friction is {net_edge_apy:.2f}%."
                )
            else:
                directive = ArbitrageDirective.NO_ARBITRAGE_EQUILIBRIUM
                rationale = (
                    f"Backwardation ({basis_bps:.1f} bps) insufficient to cover short borrow rate "
                    f"({quote.spot_borrow_apr*100:.1f}%) and friction."
                )

        eval_report = BasisEvaluation(
            symbol=quote.symbol,
            contract_type=ContractType.CALENDAR_FUTURES,
            spot_price=quote.spot_price,
            futures_price=quote.futures_price,
            basis_bps=round(basis_bps, 2),
            theoretical_basis_bps=round(theo_basis_bps, 2),
            annualized_basis_apy=round(annualized_basis_apy, 2),
            funding_apy=0.0,
            roundtrip_friction_bps=round(friction_bps, 2),
            net_annualized_edge_pct=round(net_edge_apy, 2),
            directive=directive,
            rationale=rationale,
        )

        self._record_telemetry(eval_report)
        return eval_report

    def evaluate_perpetual_funding_basis(self, quote: BasisQuote) -> BasisEvaluation:
        """
        Evaluates crypto perpetual swap basis and 8-hour funding rate yield harvest.
        """
        if quote.spot_price <= 0 or quote.futures_price <= 0:
            raise ValueError("Prices must be strictly positive.")

        raw_spread = quote.futures_price - quote.spot_price
        basis_bps = (raw_spread / quote.spot_price) * 10000.0

        # Annualized funding yield: 3 funding settlements per 24 hours * 365 days
        annual_funding_periods = 3.0 * 365.0
        funding_apy_pct = quote.funding_rate_8h * annual_funding_periods * 100.0

        # Round-trip friction for opening and holding perpetual hedge (assumed 30-day holding horizon)
        fees_bps = (quote.taker_fee_bps + quote.maker_fee_bps) * 2.0
        friction_bps = fees_bps + (quote.slippage_bps * 2.0)
        holding_days = 30.0
        friction_pct_annualized = (friction_bps / 100.0) * (365.0 / holding_days)

        net_funding_edge_pct = funding_apy_pct - friction_pct_annualized

        if quote.funding_rate_8h >= 0.0003 and net_funding_edge_pct >= self.min_hurdle_apy_pct:
            # Positive funding rate >= 0.03% / 8h (~32.8% APY)
            directive = ArbitrageDirective.PERP_FUNDING_RATE_HARVEST
            rationale = (
                f"Elevated perp funding rate ({quote.funding_rate_8h*100:.3f}%/8h, Funding APY={funding_apy_pct:.2f}%). "
                f"Long Spot + Short Perp yields net {net_funding_edge_pct:.2f}% APY after friction."
            )
        elif quote.funding_rate_8h < -0.0005:
            # Negative funding rate -> Longs receive funding from shorts
            directive = ArbitrageDirective.EMERGENCY_DELEVERAGE_PINCH
            rationale = (
                f"Negative perp funding ({quote.funding_rate_8h*100:.3f}%/8h). Short perp positions bleed funding. "
                f"Deleverage or flip hedge to avoid liquidation pinch."
            )
        elif net_funding_edge_pct > 0:
            directive = ArbitrageDirective.NO_ARBITRAGE_EQUILIBRIUM
            rationale = (
                f"Perp funding APY ({funding_apy_pct:.2f}%) within normal equilibrium bounds. "
                f"Net edge {net_funding_edge_pct:.2f}% below institutional deployment hurdle."
            )
        else:
            directive = ArbitrageDirective.UNPROFITABLE_FRICTION_EXHAUSTION
            rationale = f"Perp funding rate ({funding_apy_pct:.2f}%) eroded by trading friction."

        eval_report = BasisEvaluation(
            symbol=quote.symbol,
            contract_type=ContractType.PERPETUAL_SWAP,
            spot_price=quote.spot_price,
            futures_price=quote.futures_price,
            basis_bps=round(basis_bps, 2),
            theoretical_basis_bps=0.0,
            annualized_basis_apy=round(basis_bps * (365.0 / holding_days) / 100.0, 2),
            funding_apy=round(funding_apy_pct, 2),
            roundtrip_friction_bps=round(friction_bps, 2),
            net_annualized_edge_pct=round(net_funding_edge_pct, 2),
            directive=directive,
            rationale=rationale,
        )

        self._record_telemetry(eval_report)
        return eval_report

    def evaluate_basis_curve(self, quotes: List[BasisQuote]) -> List[BasisEvaluation]:
        """
        Evaluates a term structure curve across multiple maturities or perpetual instruments.
        """
        results = []
        for q in quotes:
            if q.contract_type == ContractType.PERPETUAL_SWAP:
                results.append(self.evaluate_perpetual_funding_basis(q))
            else:
                results.append(self.evaluate_calendar_basis(q))
        return results

    def _record_telemetry(self, rep: BasisEvaluation) -> None:
        """Persists evaluation results to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO basis_arbitrage_telemetry (
                timestamp, symbol, contract_type, spot_price, futures_price,
                basis_bps, annualized_basis_apy, net_annualized_edge_pct,
                directive, rationale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.contract_type.value,
                rep.spot_price,
                rep.futures_price,
                rep.basis_bps,
                rep.annualized_basis_apy,
                rep.net_annualized_edge_pct,
                rep.directive.value,
                rep.rationale,
            ),
        )
        conn.commit()

    def get_latest_telemetry(self, limit: int = 10) -> List[Tuple]:
        """Retrieves recent evaluation telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT symbol, contract_type, basis_bps, annualized_basis_apy, net_annualized_edge_pct, directive
            FROM basis_arbitrage_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
