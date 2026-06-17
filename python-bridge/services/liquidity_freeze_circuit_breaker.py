r"""
Structural Liquidity Freeze & Auto-Deleveraging Circuit Breaker Engine (Domain 134 / WP-AJ)
==========================================================================================

Autonomous institutional market microstructure circuit sentry and emergency risk
governor detecting exchange limit-up/limit-down boundary proximity, order book
depth collapse, and bid-ask spread blowouts to execute tiered auto-deleveraging.

Mathematical Formulations:
--------------------------
1. Exchange Circuit Proximity:
       D_{\text{upper}} = \frac{P_{\text{upper}} - S_t}{S_t} \times 100\%, \quad D_{\text{lower}} = \frac{S_t - P_{\text{lower}}}{S_t} \times 100\%
       D_{\text{min}} = \min(D_{\text{upper}}, D_{\text{lower}})

2. Bid-Ask Spread Blowout Ratio:
       \text{Spread}_t = \text{Ask}_1 - \text{Bid}_1
       \text{BlowoutRatio} = \frac{\text{Spread}_t}{\text{BaselineSpread}}

3. Order Book Liquidity Depth Ratio:
       \text{Depth}_t = \sum_{i=1}^5 \text{BidQty}_i + \sum_{i=1}^5 \text{AskQty}_i
       \text{DepthRatio} = \frac{\text{Depth}_t}{\text{BaselineDepth}}

4. 3-Tier Emergency Auto-Deleveraging Ladder:
   - LEVEL 1 (WARNING): D_{\text{min}} \le 2.0\% \lor \text{DepthRatio} < 0.50 \lor \text{Blowout} \ge 3.0
     Cancel aggressive taker orders; switch to passive post-only IOC.
   - LEVEL 2 (THROTTLE 50%): D_{\text{min}} \le 1.0\% \lor \text{DepthRatio} < 0.20 \lor \text{Blowout} \ge 8.0
     Immediately liquidate 50% of naked directional delta/margin exposure.
   - LEVEL 3 (EMERGENCY FLATTEN): D_{\text{min}} \le 0.5\% \lor \text{DepthRatio} < 0.05 \lor \text{Blowout} \ge 15.0
     Immediate atomic emergency market unwind (FLATTEN_ALL) prior to exchange freeze.
"""

from dataclasses import dataclass
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class OrderBookSnapshot:
    symbol: str
    ltp: float
    upper_circuit_limit: float
    lower_circuit_limit: float
    bids: List[Tuple[float, float]]  # [(price, qty)] top 5
    asks: List[Tuple[float, float]]  # [(price, qty)] top 5
    tick_size: float = 0.05


@dataclass
class CircuitBreakerDirective:
    timestamp: datetime
    symbol: str
    proximity_upper_pct: float
    proximity_lower_pct: float
    min_proximity_pct: float
    spread_pts: float
    spread_blowout_ratio: float
    depth_ratio: float
    alert_level: str  # 'NORMAL', 'LEVEL_1_WARNING', 'LEVEL_2_THROTTLE_50', 'LEVEL_3_EMERGENCY_FLATTEN'
    margin_reduction_pct: float  # 0.0, 50.0, or 100.0
    execution_command: str
    rationale: str


class LiquidityFreezeCircuitBreaker:
    """
    Sub-millisecond Microstructure Circuit Sentry & Emergency Deleveraging Engine.
    """

    def __init__(
        self,
        baseline_spread_pts: float = 0.50,  # e.g. 0.50 pts for NIFTY
        baseline_depth_qty: float = 5000.0,  # 5,000 contracts across top 5 levels
        level_1_proximity_pct: float = 2.0,
        level_2_proximity_pct: float = 1.0,
        level_3_proximity_pct: float = 0.5,
        db_path: str = ":memory:",
    ):
        self.baseline_spread = max(baseline_spread_pts, 0.05)
        self.baseline_depth = max(baseline_depth_qty, 100.0)
        self.l1_prox = level_1_proximity_pct
        self.l2_prox = level_2_proximity_pct
        self.l3_prox = level_3_proximity_pct
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
            CREATE TABLE IF NOT EXISTS circuit_breaker_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                min_proximity_pct REAL NOT NULL,
                spread_pts REAL NOT NULL,
                spread_blowout REAL NOT NULL,
                depth_ratio REAL NOT NULL,
                alert_level TEXT NOT NULL,
                margin_reduction REAL NOT NULL,
                command TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def evaluate_book_snapshot(
        self,
        book: OrderBookSnapshot,
        timestamp: Optional[datetime] = None,
    ) -> CircuitBreakerDirective:
        now = timestamp if timestamp is not None else datetime.utcnow()

        # 1. Proximity to circuit limits
        prox_upper = round(((book.upper_circuit_limit - book.ltp) / book.ltp) * 100.0, 3)
        prox_lower = round(((book.ltp - book.lower_circuit_limit) / book.ltp) * 100.0, 3)
        min_prox = min(prox_upper, prox_lower)

        # 2. Spread & Blowout Ratio
        best_bid = book.bids[0][0] if book.bids else (book.ltp - book.tick_size)
        best_ask = book.asks[0][0] if book.asks else (book.ltp + book.tick_size)
        spread = round(max(best_ask - best_bid, book.tick_size), 2)
        spread_blowout = round(spread / self.baseline_spread, 2)

        # 3. Liquidity Depth
        bid_qty = sum(q for _, q in book.bids) if book.bids else 0.0
        ask_qty = sum(q for _, q in book.asks) if book.asks else 0.0
        tot_depth = bid_qty + ask_qty
        depth_ratio = round(tot_depth / self.baseline_depth, 3)

        # 4. Emergency Ladder Classification
        if min_prox <= self.l3_prox or depth_ratio < 0.05 or spread_blowout >= 15.0:
            level = "LEVEL_3_EMERGENCY_FLATTEN"
            reduction = 100.0
            command = "FLATTEN_ALL_POSITIONS_IMMEDIATE"
            rationale = (
                f"CRITICAL CIRCUIT RISK: Proximity={min_prox:.2f}%, DepthRatio={depth_ratio:.2f}, "
                f"SpreadBlowout={spread_blowout:.1f}x. Complete liquidity freeze imminent. Emergency flatten."
            )
        elif min_prox <= self.l2_prox or depth_ratio < 0.20 or spread_blowout >= 8.0:
            level = "LEVEL_2_THROTTLE_50"
            reduction = 50.0
            command = "DELEVERAGE_50_PERCENT_EXPOSURE"
            rationale = (
                f"HIGH CIRCUIT WARNING: Proximity={min_prox:.2f}%, DepthRatio={depth_ratio:.2f}, "
                f"SpreadBlowout={spread_blowout:.1f}x. Liquidate 50% directional exposure."
            )
        elif min_prox <= self.l1_prox or depth_ratio < 0.50 or spread_blowout >= 3.0:
            level = "LEVEL_1_WARNING"
            reduction = 0.0
            command = "CANCEL_AGGRESSIVE_ORDERS_RESTRICT_IOC"
            rationale = (
                f"ELEVATED MICROSTRUCTURE STRESS: Proximity={min_prox:.2f}%, DepthRatio={depth_ratio:.2f}, "
                f"SpreadBlowout={spread_blowout:.1f}x. Halt taker orders, restrict to passive limit."
            )
        else:
            level = "NORMAL"
            reduction = 0.0
            command = "STANDARD_EXECUTION_ACTIVE"
            rationale = (
                f"Normal liquidity conditions (Proximity={min_prox:.2f}%, DepthRatio={depth_ratio:.2f}, "
                f"Spread={spread:.2f} pts). Standard algorithms operational."
            )

        # Persist to SQLite
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO circuit_breaker_telemetry (
                timestamp, symbol, min_proximity_pct, spread_pts, spread_blowout,
                depth_ratio, alert_level, margin_reduction, command
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now.isoformat(),
                book.symbol,
                min_prox,
                spread,
                spread_blowout,
                depth_ratio,
                level,
                reduction,
                command,
            ),
        )
        conn.commit()

        return CircuitBreakerDirective(
            timestamp=now,
            symbol=book.symbol,
            proximity_upper_pct=prox_upper,
            proximity_lower_pct=prox_lower,
            min_proximity_pct=min_prox,
            spread_pts=spread,
            spread_blowout_ratio=spread_blowout,
            depth_ratio=depth_ratio,
            alert_level=level,
            margin_reduction_pct=reduction,
            execution_command=command,
            rationale=rationale,
        )
