r"""
Real-Time Options Implied Volatility Surface Arb & Butterfly Sieve (Domain 142 / WP-AR)
========================================================================================

Autonomous options surface arbitrage engine detecting static Carr-Madan (2005)
no-arbitrage boundary violations, including vertical monotonicity violations
(negative call/put spreads) and butterfly convexity violations (negative butterflies).

Mathematical Formulations:
--------------------------
1. Strike Monotonicity Condition (Vertical Spread):
       \forall K_1 < K_2: \quad C(K_1) \ge C(K_2) \quad \text{and} \quad P(K_1) \le P(K_2)
   Violation (Call): \text{Bid}(C, K_2) > \text{Ask}(C, K_1)
       \implies \text{Buy } C(K_1), \text{ Sell } C(K_2) \implies \text{Immediate Credit} > 0, \text{ Payoff} \ge 0 \quad \forall S_T

2. Strike Convexity Condition (Butterfly Spread):
   For equidistant strikes K_1 < K_2 < K_3 with \Delta K = K_2 - K_1 = K_3 - K_2:
       C(K_1) - 2C(K_2) + C(K_3) \ge 0
   Cost of Long Butterfly:
       \text{Cost}_{\text{fly}} = \text{Ask}(K_1) - 2 \cdot \text{Bid}(K_2) + \text{Ask}(K_3)
   Violation: \text{Cost}_{\text{fly}} < -\text{FrictionCost}
       \implies \text{Long Butterfly opened for net cash credit; Payoff } \ge 0 \quad \forall S_T

3. Risk-Neutral Density Non-Negativity:
       p(K_2) \approx e^{rT} \frac{C(K_1) - 2C(K_2) + C(K_3)}{(\Delta K)^2} \ge 0
       \text{Negative butterfly price} \iff \text{Negative risk-neutral probability density (Pure Arbitrage)}
"""

from dataclasses import dataclass
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class OptionQuote:
    strike: float
    option_type: str  # 'CE' or 'PE'
    bid: float
    ask: float
    lot_size: int = 25


@dataclass
class ArbitrageOpportunity:
    arb_type: str  # 'BUTTERFLY_CONVEXITY_VIOLATION', 'VERTICAL_MONOTONICITY_VIOLATION'
    option_type: str
    strikes: Tuple[float, ...]
    execution_net_cost_pts: float  # negative means upfront credit received
    guaranteed_profit_inr: float
    legs_description: List[str]
    rationale: str


@dataclass
class SurfaceArbitrageReport:
    timestamp: datetime
    total_opportunities: int
    max_guaranteed_profit_inr: float
    opportunities: List[ArbitrageOpportunity]
    regime: str  # 'STATIC_ARBITRAGE_DETECTED', 'NO_ARBITRAGE_CONSISTENT'
    rationale: str


class OptionButterflyArbSieve:
    """
    Sub-millisecond Options Surface Arbitrage & Butterfly Convexity Sieve.
    """

    def __init__(
        self,
        friction_hurdle_pts: float = 0.50,  # 0.50 pts per lot friction floor
        db_path: str = ":memory:",
    ):
        self.friction = friction_hurdle_pts
        self.db_path = db_path

        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            if self._conn is None:
                self._conn = sqlite3.connect(":memory:")
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS option_butterfly_arb_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                arb_type TEXT NOT NULL,
                option_type TEXT NOT NULL,
                strikes TEXT NOT NULL,
                cost_pts REAL NOT NULL,
                profit_inr REAL NOT NULL,
                description TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def scan_chain_arbitrage(
        self,
        quotes: List[OptionQuote],
        timestamp: Optional[datetime] = None,
    ) -> SurfaceArbitrageReport:
        now = timestamp if timestamp is not None else datetime.utcnow()

        calls = sorted([q for q in quotes if q.option_type.upper() == 'CE'], key=lambda q: q.strike)
        puts = sorted([q for q in quotes if q.option_type.upper() == 'PE'], key=lambda q: q.strike)

        opportunities: List[ArbitrageOpportunity] = []

        # 1. Check Vertical Monotonicity Violations (Calls & Puts)
        # For Calls: K1 < K2 must satisfy Ask(K1) >= Bid(K2). If Bid(K2) > Ask(K1) -> Arb!
        for i in range(len(calls)):
            for j in range(i + 1, len(calls)):
                k1, k2 = calls[i], calls[j]
                if k2.bid > k1.ask + self.friction:
                    credit = round(k2.bid - k1.ask, 2)
                    profit_inr = round((credit - self.friction) * k1.lot_size, 2)
                    legs = [
                        f"BUY {k1.strike:.0f} CE @ {k1.ask:.2f}",
                        f"SELL {k2.strike:.0f} CE @ {k2.bid:.2f}",
                    ]
                    opportunities.append(
                        ArbitrageOpportunity(
                            arb_type="VERTICAL_MONOTONICITY_VIOLATION",
                            option_type="CE",
                            strikes=(k1.strike, k2.strike),
                            execution_net_cost_pts=-credit,
                            guaranteed_profit_inr=profit_inr,
                            legs_description=legs,
                            rationale=(
                                f"Call vertical spread mispricing: Higher strike {k2.strike:.0f} CE Bid (₹{k2.bid:.2f}) "
                                f"> Lower strike {k1.strike:.0f} CE Ask (₹{k1.ask:.2f}). Guaranteed net profit ₹{profit_inr:.2f}."
                            ),
                        )
                    )

        # For Puts: K1 < K2 must satisfy Ask(K2) >= Bid(K1). If Bid(K1) > Ask(K2) -> Arb!
        for i in range(len(puts)):
            for j in range(i + 1, len(puts)):
                k1, k2 = puts[i], puts[j]
                if k1.bid > k2.ask + self.friction:
                    credit = round(k1.bid - k2.ask, 2)
                    profit_inr = round((credit - self.friction) * k1.lot_size, 2)
                    legs = [
                        f"BUY {k2.strike:.0f} PE @ {k2.ask:.2f}",
                        f"SELL {k1.strike:.0f} PE @ {k1.bid:.2f}",
                    ]
                    opportunities.append(
                        ArbitrageOpportunity(
                            arb_type="VERTICAL_MONOTONICITY_VIOLATION",
                            option_type="PE",
                            strikes=(k1.strike, k2.strike),
                            execution_net_cost_pts=-credit,
                            guaranteed_profit_inr=profit_inr,
                            legs_description=legs,
                            rationale=(
                                f"Put vertical spread mispricing: Lower strike {k1.strike:.0f} PE Bid (₹{k1.bid:.2f}) "
                                f"> Higher strike {k2.strike:.0f} PE Ask (₹{k2.ask:.2f}). Guaranteed net profit ₹{profit_inr:.2f}."
                            ),
                        )
                    )

        # 2. Check Butterfly Convexity Violations (Calls)
        # K1 < K2 < K3 equidistant: Cost = Ask(K1) - 2*Bid(K2) + Ask(K3). If Cost < -friction -> Arb!
        for i in range(len(calls) - 2):
            for j in range(i + 1, len(calls) - 1):
                for k in range(j + 1, len(calls)):
                    q1, q2, q3 = calls[i], calls[j], calls[k]
                    # Check equidistant
                    d1 = round(q2.strike - q1.strike, 2)
                    d2 = round(q3.strike - q2.strike, 2)
                    if abs(d1 - d2) < 1e-3:
                        # Cost to buy butterfly
                        cost = round(q1.ask - 2.0 * q2.bid + q3.ask, 2)
                        if cost < -self.friction:
                            credit = -cost
                            profit_inr = round((credit - self.friction) * q1.lot_size, 2)
                            legs = [
                                f"BUY {q1.strike:.0f} CE @ {q1.ask:.2f}",
                                f"SELL 2x {q2.strike:.0f} CE @ {q2.bid:.2f}",
                                f"BUY {q3.strike:.0f} CE @ {q3.ask:.2f}",
                            ]
                            opportunities.append(
                                ArbitrageOpportunity(
                                    arb_type="BUTTERFLY_CONVEXITY_VIOLATION",
                                    option_type="CE",
                                    strikes=(q1.strike, q2.strike, q3.strike),
                                    execution_net_cost_pts=cost,
                                    guaranteed_profit_inr=profit_inr,
                                    legs_description=legs,
                                    rationale=(
                                        f"Negative butterfly convexity arbitrage on strikes ({q1.strike:.0f}, {q2.strike:.0f}, {q3.strike:.0f}). "
                                        f"Net upfront credit received = ₹{credit:.2f} pts. Guaranteed risk-free profit ₹{profit_inr:.2f}."
                                    ),
                                )
                            )

        # 3. Persist and Report
        conn = self._get_connection()
        cursor = conn.cursor()
        for opp in opportunities:
            cursor.execute(
                """
                INSERT INTO option_butterfly_arb_telemetry (
                    timestamp, arb_type, option_type, strikes, cost_pts, profit_inr, description
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    now.isoformat(),
                    opp.arb_type,
                    opp.option_type,
                    str(opp.strikes),
                    opp.execution_net_cost_pts,
                    opp.guaranteed_profit_inr,
                    "; ".join(opp.legs_description),
                ),
            )
        conn.commit()

        total_opps = len(opportunities)
        max_profit = max([o.guaranteed_profit_inr for o in opportunities], default=0.0)
        regime = "STATIC_ARBITRAGE_DETECTED" if total_opps > 0 else "NO_ARBITRAGE_CONSISTENT"
        rationale = (
            f"Detected {total_opps} static surface arbitrage opportunities with up to ₹{max_profit:.2f} risk-free profit."
            if total_opps > 0
            else "Options surface strictly satisfies Carr-Madan monotonicity and convexity bounds. No arbitrage."
        )

        return SurfaceArbitrageReport(
            timestamp=now,
            total_opportunities=total_opps,
            max_guaranteed_profit_inr=max_profit,
            opportunities=opportunities,
            regime=regime,
            rationale=rationale,
        )
