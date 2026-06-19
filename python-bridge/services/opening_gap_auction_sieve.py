r"""
Intraday Opening Gap Fade & Auction Price Discovery Equilibrium Sieve (Domain 148 / WP-AX)
========================================================================================

Autonomous pre-market auction and opening execution engine analyzing NSE 09:00-09:08 IST
call auction price discovery, matched volume, unmatched order imbalance ratios (OIR),
and standardized gap Z-scores to calculate opening gap fill probabilities and trade directives.

Mathematical Formulations:
--------------------------
1. Standardized Overnight Gap:
       \text{Gap}_{\text{pts}} = P_{\text{open}} - P_{\text{prev\_close}}
       Z_{\text{gap}} = \frac{\text{Gap}_{\text{pts}}}{\text{ATR}_{20}}

2. Auction Order Imbalance Ratio (OIR):
       \text{OIR} = \frac{Q_{\text{unmatched\_buy}} - Q_{\text{unmatched\_sell}}}{Q_{\text{unmatched\_buy}} + Q_{\text{unmatched\_sell}} + \epsilon} \in [-1.0, 1.0]

3. Empirical Gap Fill Probability (Logistic Sieve):
       \eta = \beta_0 - \beta_1 |Z_{\text{gap}}| - \beta_2 \cdot \text{sgn}(Z_{\text{gap}}) \cdot \text{OIR} + \beta_3 \cdot \min\left(1.0, \frac{V_{\text{adv\_open}}}{V_{\text{auction}} + 1.0}\right)
       P_{\text{fill}} = \frac{1}{1 + e^{-\eta}}
   where \beta_0 = 1.8, \beta_1 = 1.1, \beta_2 = 1.5, \beta_3 = 0.5.

4. Trade Target & Stop Geometry:
       \text{Target} = P_{\text{prev\_close}}
       \text{Stop}_{\text{up}} = P_{\text{open}} + 0.35 \cdot \text{ATR}_{20}
       \text{Stop}_{\text{down}} = P_{\text{open}} - 0.35 \cdot \text{ATR}_{20}
"""

from dataclasses import dataclass
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class PreOpenAuctionData:
    symbol: str
    prev_close: float
    open_price: float
    atr_20: float
    matched_volume: float
    unmatched_buy_qty: float
    unmatched_sell_qty: float
    typical_opening_volume: float = 100000.0


@dataclass
class GapAnalysisReport:
    symbol: str
    prev_close: float
    open_price: float
    gap_pts: float
    gap_pct: float
    gap_z_score: float
    order_imbalance_ratio: float
    gap_fill_probability: float
    target_price: float
    stop_price: float
    risk_reward_ratio: float
    regime: str
    execution_directive: str


class OpeningGapAuctionSieve:
    """
    Sub-millisecond opening gap fade and auction equilibrium sieve.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        fill_prob_hurdle: float = 0.65,
    ):
        self.db_path = db_path
        self.fill_prob_hurdle = fill_prob_hurdle
        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            if self._conn is None:
                self._conn = sqlite3.connect(":memory:")
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for opening gap telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS opening_gap_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                prev_close REAL NOT NULL,
                open_price REAL NOT NULL,
                gap_pts REAL NOT NULL,
                gap_z REAL NOT NULL,
                oir REAL NOT NULL,
                fill_prob REAL NOT NULL,
                target REAL NOT NULL,
                stop REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def evaluate_opening_gap(self, auction: PreOpenAuctionData) -> GapAnalysisReport:
        """
        Analyzes pre-open auction clearing price, order imbalance, and
        generates the gap fill probability and trade setup.
        """
        P_prev = auction.prev_close
        P_open = auction.open_price
        atr = max(1e-4, auction.atr_20)

        gap_pts = P_open - P_prev
        gap_pct = (gap_pts / P_prev) * 100.0
        z_gap = gap_pts / atr

        # Order Imbalance Ratio OIR in [-1.0, 1.0]
        total_unmatched = auction.unmatched_buy_qty + auction.unmatched_sell_qty
        if total_unmatched > 0.0:
            oir = (auction.unmatched_buy_qty - auction.unmatched_sell_qty) / total_unmatched
        else:
            oir = 0.0

        # Logistic model for gap fill probability
        abs_z = abs(z_gap)
        sgn_z = 1.0 if z_gap > 0 else (-1.0 if z_gap < 0 else 0.0)

        # Volume scarcity factor: low auction volume compared to typical increases fill probability
        vol_ratio = auction.typical_opening_volume / max(1.0, auction.matched_volume)
        vol_term = min(1.0, vol_ratio)

        # Logit calculation
        # If gap is UP (sgn_z = +1) and OIR is positive (buying imbalance), sgn_z * OIR > 0 -> decreases fill prob
        # If gap is UP and OIR is negative (selling supply), sgn_z * OIR < 0 -> increases fill prob
        b0, b1, b2, b3 = 1.8, 1.1, 1.5, 0.5
        eta = b0 - b1 * abs_z - b2 * (sgn_z * oir) + b3 * vol_term
        fill_prob = 1.0 / (1.0 + math.exp(-max(-10.0, min(10.0, eta))))

        # Target is previous close (complete gap fill)
        target = P_prev

        # Regime & Directives
        if abs_z < 0.25:
            regime = "NEUTRAL_OPEN_EQUILIBRIUM"
            directive = "NO_ACTION_RANGE_OPEN"
            stop = P_open
            rr = 1.0
        elif abs_z > 1.8 and (sgn_z * oir) > 0.35:
            # Massive gap with strong supporting imbalance
            regime = "RUNAWAY_GAP_CONTINUATION"
            directive = "GO_LONG_MOMENTUM_RUNNER" if z_gap > 0 else "GO_SHORT_MOMENTUM_RUNNER"
            stop = P_open - 0.5 * atr if z_gap > 0 else P_open + 0.5 * atr
            target = P_open + 1.5 * gap_pts  # Target continuation extension
            risk = abs(P_open - stop)
            reward = abs(target - P_open)
            rr = reward / max(1e-4, risk)
        elif fill_prob >= self.fill_prob_hurdle:
            # Fade setup
            if z_gap > 0:
                regime = "GAP_UP_EXHAUSTION_FADE"
                directive = "SELL_SHORT_TARGET_PREV_CLOSE"
                stop = P_open + 0.35 * atr
            else:
                regime = "GAP_DOWN_EXHAUSTION_FADE"
                directive = "BUY_LONG_TARGET_PREV_CLOSE"
                stop = P_open - 0.35 * atr
            risk = abs(P_open - stop)
            reward = abs(target - P_open)
            rr = reward / max(1e-4, risk)
        else:
            regime = "AMBIGUOUS_OPENING_AUCTION"
            directive = "WAIT_FOR_0930_VWAP_CONFIRMATION"
            stop = P_open + (0.5 * atr if z_gap > 0 else -0.5 * atr)
            rr = 1.0

        report = GapAnalysisReport(
            symbol=auction.symbol,
            prev_close=round(P_prev, 2),
            open_price=round(P_open, 2),
            gap_pts=round(gap_pts, 2),
            gap_pct=round(gap_pct, 2),
            gap_z_score=round(z_gap, 3),
            order_imbalance_ratio=round(oir, 4),
            gap_fill_probability=round(fill_prob, 4),
            target_price=round(target, 2),
            stop_price=round(stop, 2),
            risk_reward_ratio=round(rr, 2),
            regime=regime,
            execution_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: GapAnalysisReport) -> None:
        """Persists gap telemetry into SQLite."""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO opening_gap_telemetry (
                    timestamp, symbol, prev_close, open_price, gap_pts,
                    gap_z, oir, fill_prob, target, stop, regime, directive
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.utcnow().isoformat(),
                    rep.symbol,
                    rep.prev_close,
                    rep.open_price,
                    rep.gap_pts,
                    rep.gap_z_score,
                    rep.order_imbalance_ratio,
                    rep.gap_fill_probability,
                    rep.target_price,
                    rep.stop_price,
                    rep.regime,
                    rep.execution_directive,
                ),
            )
            conn.commit()
        except Exception:
            pass
