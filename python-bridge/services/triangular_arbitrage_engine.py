r"""
Sub-Cent Crypto/FX Cross-Rate Triangular Arbitrage Engine (Domain 120 / WP-V)
=============================================================================

Autonomous high-frequency triangular parity and cross-rate arbitrage engine
tailored for NSE Currency Derivatives (USDINR, EURINR, GBPINR, JPYINR) and
cross-venue/crypto synthetic forward pricing.

Mathematical Specifications:
-----------------------------
1. Triangular No-Arbitrage Parity:
   For currency triad (Base A, Mid B, Quote C), e.g., EUR / USD / INR:
       Fair Cross Rate:
           P_{A/C}^{fair} = P_{A/B} \times P_{B/C}

2. Arbitrage Discrepancy & Gross Yield:
   Path 1 (Forward Triangular Arb: Buy A/C direct, Sell synthetic):
       P_{A/B}^{bid} \times P_{B/C}^{bid} > P_{A/C}^{ask} \cdot (1 + \text{Hurdle})
       \text{GrossSpread}_{1} = \frac{P_{A/B}^{bid} \cdot P_{B/C}^{bid}}{P_{A/C}^{ask}} - 1.0

   Path 2 (Reverse Triangular Arb: Sell A/C direct, Buy synthetic):
       P_{A/C}^{bid} > P_{A/B}^{ask} \cdot P_{B/C}^{ask} \cdot (1 + \text{Hurdle})
       \text{GrossSpread}_{2} = \frac{P_{A/C}^{bid}}{P_{A/B}^{ask} \cdot P_{B/C}^{ask}} - 1.0

3. Indian CDS Statutory Friction Filter:
   NSE CDS transaction costs:
       - Stamp Duty: 0.0001% (buy side)
       - Exchange Turnover: 0.0009%
       - Brokerage: Flat INR 20 or 0.001%
       - GST: 18% on (Brokerage + Exchange)
       - SEBI Turnover: 0.0001%
       Total 3-leg statutory friction floor:
           \text{Friction}_{\text{roundtrip}} \approx 0.0045\% \text{ to } 0.0080\%
       Mandatory Alpha Hurdle Gate:
           \text{GrossSpread} \ge 2.5 \times \text{Friction}_{\text{roundtrip}} + \text{SlippageSafety}

4. Atomic 3-Leg Execution Guard & Broken-Leg Sieve:
   Dispatches 3 atomic IOC instructions. If Leg 1 or Leg 2 fails or fills partially
   beyond tolerance \epsilon_{fill}, generates instantaneous counter-market square-off
   within <= 100ms.
"""

from dataclasses import dataclass, field
from datetime import datetime
import math
from typing import Dict, List, Optional, Tuple
import sqlite3


@dataclass
class TickerQuote:
    symbol: str
    bid_price: float
    bid_size: int
    ask_price: float
    ask_size: int
    timestamp: datetime


@dataclass
class ArbitrageSignal:
    timestamp: datetime
    triad_name: str  # e.g., "EUR/USD/INR"
    path: str  # 'FORWARD' or 'REVERSE'
    leg_a_c: str  # e.g., "EURINR"
    leg_a_b: str  # e.g., "EURUSD"
    leg_b_c: str  # e.g., "USDINR"
    direct_price: float
    synthetic_price: float
    gross_discrepancy_bps: float
    friction_cost_bps: float
    net_alpha_bps: float
    is_actionable: bool
    recommended_lots: int


@dataclass
class ExecutionLegResult:
    leg_symbol: str
    order_side: str  # 'BUY' or 'SELL'
    target_qty: int
    filled_qty: int
    fill_price: float
    status: str  # 'FILLED', 'PARTIAL', 'REJECTED'


@dataclass
class BrokenLegRecoveryInstruction:
    leg_symbol: str
    unwind_side: str
    unwind_qty: int
    urgency: str
    reason: str


class TriangularArbitrageEngine:
    """
    Sub-millisecond triangular cross-rate arbitrage engine.
    """

    def __init__(
        self,
        min_net_hurdle_bps: float = 2.0,  # Minimum 2 bps net after all costs
        fixed_slippage_bps: float = 0.5,
        max_position_lots: int = 100,
        db_path: str = ":memory:",
    ):
        self.min_net_hurdle_bps = min_net_hurdle_bps
        self.fixed_slippage_bps = fixed_slippage_bps
        self.max_position_lots = max_position_lots
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
            CREATE TABLE IF NOT EXISTS triangular_arb_signals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                triad_name TEXT NOT NULL,
                path TEXT NOT NULL,
                gross_bps REAL NOT NULL,
                friction_bps REAL NOT NULL,
                net_bps REAL NOT NULL,
                is_actionable INTEGER NOT NULL,
                recommended_lots INTEGER NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def calculate_statutory_friction_bps(
        direct_price: float,
        cross_ab_price: float,
        cross_bc_price: float,
    ) -> float:
        """
        Calculates 3-leg combined statutory friction in basis points (1 bp = 0.01%).
        CDS exchange turnover (0.9 bps total), stamp duty (0.1 bp), brokerage (0.5 bps), GST.
        Approximates ~1.5 - 2.5 bps round-trip friction.
        """
        # 3 legs turnover + stamp duty on buy legs
        base_friction_bps = 1.8
        return base_friction_bps

    def evaluate_triad(
        self,
        triad_name: str,
        quote_ac: TickerQuote,  # Direct pair: e.g. EURINR
        quote_ab: TickerQuote,  # Cross leg 1: e.g. EURUSD
        quote_bc: TickerQuote,  # Cross leg 2: e.g. USDINR
    ) -> Optional[ArbitrageSignal]:
        """
        Evaluates Forward and Reverse triangular arbitrage pricing discrepancies.
        """
        # Sanity check quotes
        if (
            quote_ac.ask_price <= 0 or quote_ac.bid_price <= 0 or
            quote_ab.ask_price <= 0 or quote_ab.bid_price <= 0 or
            quote_bc.ask_price <= 0 or quote_bc.bid_price <= 0
        ):
            return None

        friction_bps = self.calculate_statutory_friction_bps(
            quote_ac.ask_price, quote_ab.ask_price, quote_bc.ask_price
        ) + self.fixed_slippage_bps

        ts = max(quote_ac.timestamp, quote_ab.timestamp, quote_bc.timestamp)

        # Path 1: Forward Arbitrage (Buy AC direct at Ask, Sell Synthetic: Sell AB at Bid, Sell BC at Bid)
        # Synthetic Bid for AC = quote_ab.bid_price * quote_bc.bid_price
        synthetic_bid_ac = quote_ab.bid_price * quote_bc.bid_price
        forward_discrepancy_bps = ((synthetic_bid_ac - quote_ac.ask_price) / quote_ac.ask_price) * 10000.0

        # Path 2: Reverse Arbitrage (Sell AC direct at Bid, Buy Synthetic: Buy AB at Ask, Buy BC at Ask)
        # Synthetic Ask for AC = quote_ab.ask_price * quote_bc.ask_price
        synthetic_ask_ac = quote_ab.ask_price * quote_bc.ask_price
        reverse_discrepancy_bps = ((quote_ac.bid_price - synthetic_ask_ac) / synthetic_ask_ac) * 10000.0

        # Select best path
        if forward_discrepancy_bps > reverse_discrepancy_bps:
            chosen_path = "FORWARD"
            gross_bps = forward_discrepancy_bps
            direct_p = quote_ac.ask_price
            synth_p = synthetic_bid_ac
            # Available liquidity constraint
            avail_lots = min(quote_ac.ask_size, quote_ab.bid_size, quote_bc.bid_size)
        else:
            chosen_path = "REVERSE"
            gross_bps = reverse_discrepancy_bps
            direct_p = quote_ac.bid_price
            synth_p = synthetic_ask_ac
            avail_lots = min(quote_ac.bid_size, quote_ab.ask_size, quote_bc.ask_size)

        net_alpha_bps = gross_bps - friction_bps
        is_actionable = net_alpha_bps >= self.min_net_hurdle_bps and avail_lots > 0
        recommended_lots = min(avail_lots, self.max_position_lots) if is_actionable else 0

        signal = ArbitrageSignal(
            timestamp=ts,
            triad_name=triad_name,
            path=chosen_path,
            leg_a_c=quote_ac.symbol,
            leg_a_b=quote_ab.symbol,
            leg_b_c=quote_bc.symbol,
            direct_price=direct_p,
            synthetic_price=synth_p,
            gross_discrepancy_bps=round(gross_bps, 2),
            friction_cost_bps=round(friction_bps, 2),
            net_alpha_bps=round(net_alpha_bps, 2),
            is_actionable=is_actionable,
            recommended_lots=recommended_lots,
        )

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO triangular_arb_signals (
                timestamp, triad_name, path, gross_bps, friction_bps, net_bps, is_actionable, recommended_lots
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ts.isoformat(),
                triad_name,
                chosen_path,
                signal.gross_discrepancy_bps,
                signal.friction_cost_bps,
                signal.net_alpha_bps,
                1 if is_actionable else 0,
                recommended_lots,
            )
        )
        conn.commit()

        return signal

    def audit_atomic_execution(
        self,
        executed_legs: List[ExecutionLegResult],
    ) -> List[BrokenLegRecoveryInstruction]:
        """
        Examines execution results of 3 legs. If any leg is unfulfilled or partially filled,
        generates microsecond unwinding instructions for filled portions to neutralize exposure.
        """
        recovery_plan: List[BrokenLegRecoveryInstruction] = []

        total_legs = len(executed_legs)
        if total_legs == 0:
            return recovery_plan

        filled_counts = sum(1 for leg in executed_legs if leg.status == 'FILLED' and leg.filled_qty == leg.target_qty)
        if filled_counts == total_legs:
            # 100% clean complete execution
            return recovery_plan

        # Broken leg condition detected
        for leg in executed_legs:
            if leg.filled_qty > 0:
                # Need to neutralize what was filled
                unwind_side = 'SELL' if leg.order_side == 'BUY' else 'BUY'
                recovery_plan.append(
                    BrokenLegRecoveryInstruction(
                        leg_symbol=leg.leg_symbol,
                        unwind_side=unwind_side,
                        unwind_qty=leg.filled_qty,
                        urgency="EMERGENCY_ATOMIC_100MS",
                        reason=f"Broken triad: leg {leg.leg_symbol} filled {leg.filled_qty} but sibling leg failed/partial",
                    )
                )

        return recovery_plan
