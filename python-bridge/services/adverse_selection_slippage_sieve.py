r"""
Domain 187 (WP-CK): Real-Time Intraday Flow Toxicity & Adverse Selection Slippage Sieve

Implements microstructure effective spread vs realized spread decomposition,
post-trade price impact velocity \Delta M(\tau), flow toxicity ratio \mathcal{T},
and dynamic market maker defensive spread widening/momentum piggybacking execution directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


class AdverseSelectionDirective(str, Enum):
    DEFENSIVE_SPREAD_WIDENING_VETO_PASSIVE = "DEFENSIVE_SPREAD_WIDENING_VETO_PASSIVE"
    FOLLOW_INFORMED_FLOW_MOMENTUM = "FOLLOW_INFORMED_FLOW_MOMENTUM"
    BENIGN_RETAIL_FLOW_TIGHTEN_QUOTES = "BENIGN_RETAIL_FLOW_TIGHTEN_QUOTES"
    EQUILIBRIUM_FLOW = "EQUILIBRIUM_FLOW"


@dataclass
class TradeExecutionTrace:
    timestamp_sec: float
    trade_price: float
    mid_at_execution: float
    mid_post_horizon: float  # Mid quote at t + \tau (e.g. \tau = 1s or 5s)
    direction: int  # +1 for BUY (buyer initiated), -1 for SELL
    quantity: float


@dataclass
class AdverseSelectionReport:
    symbol: str
    effective_spread_bps: float
    realized_spread_bps: float
    price_impact_bps: float
    toxicity_ratio: float  # \mathcal{T} \in [0.0, 1.0+]
    quote_spread_multiplier: float
    directive: AdverseSelectionDirective
    rationale: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class AdverseSelectionSlippageSieve:
    """
    Sub-second Microstructure Flow Toxicity & Adverse Selection Sieve.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        toxicity_veto_threshold: float = 0.70,
        toxicity_benign_threshold: float = 0.35,
    ):
        self.db_path = db_path
        self.tox_veto_thresh = toxicity_veto_threshold
        self.tox_benign_thresh = toxicity_benign_threshold

        self._conn: Optional[sqlite3.Connection] = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for adverse selection telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS adverse_selection_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                eff_spread_bps REAL NOT NULL,
                real_spread_bps REAL NOT NULL,
                price_impact_bps REAL NOT NULL,
                toxicity_ratio REAL NOT NULL,
                spread_mult REAL NOT NULL,
                directive TEXT NOT NULL,
                rationale TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def evaluate_spread_decomposition(
        self, trace: TradeExecutionTrace
    ) -> Tuple[float, float, float]:
        """
        Decomposes trade fill into:
        - Effective Spread: 2 * q * (P_trade - M_0) / M_0 * 10^4 (bps)
        - Realized Spread:  2 * q * (P_trade - M_\tau) / M_0 * 10^4 (bps)
        - Price Impact:     2 * q * (M_\tau - M_0) / M_0 * 10^4 (bps)
        Note identity: EffectiveSpread = RealizedSpread + PriceImpact
        """
        m0 = max(1.0, trace.mid_at_execution)
        q = trace.direction

        eff_spread = 2.0 * q * (trace.trade_price - m0) / m0 * 10000.0
        real_spread = 2.0 * q * (trace.trade_price - trace.mid_post_horizon) / m0 * 10000.0
        impact = 2.0 * q * (trace.mid_post_horizon - m0) / m0 * 10000.0

        return round(eff_spread, 2), round(real_spread, 2), round(impact, 2)

    def analyze_flow_toxicity(
        self,
        symbol: str,
        execution_traces: List[TradeExecutionTrace],
    ) -> AdverseSelectionReport:
        """
        Aggregates batch of trade execution traces to compute systemic flow toxicity
        and emit defensive quoting and execution directives.
        """
        if not execution_traces:
            return AdverseSelectionReport(
                symbol=symbol,
                effective_spread_bps=0.0,
                realized_spread_bps=0.0,
                price_impact_bps=0.0,
                toxicity_ratio=0.0,
                quote_spread_multiplier=1.0,
                directive=AdverseSelectionDirective.EQUILIBRIUM_FLOW,
                rationale="No execution traces provided for evaluation.",
            )

        total_eff = 0.0
        total_real = 0.0
        total_impact = 0.0
        total_adverse = 0.0
        total_vol = 0.0

        for tr in execution_traces:
            eff, real, imp = self.evaluate_spread_decomposition(tr)
            vol = max(1.0, tr.quantity)
            total_eff += eff * vol
            total_real += real * vol
            total_impact += imp * vol
            total_adverse += max(0.0, imp) * vol
            total_vol += vol

        mean_eff = total_eff / total_vol
        mean_real = total_real / total_vol
        mean_imp = total_impact / total_vol

        # Toxicity ratio: adverse selection impact as proportion of effective spread
        # Values > 0.70 indicate that informed traders extract more than 70% of the spread
        tox_ratio = total_adverse / max(0.1, total_eff) if total_eff > 0 else 0.50
        tox_ratio = round(max(0.0, tox_ratio), 4)

        # Directives and spread multiplier
        if tox_ratio >= self.tox_veto_thresh and mean_real < 0.0:
            directive = AdverseSelectionDirective.DEFENSIVE_SPREAD_WIDENING_VETO_PASSIVE
            mult = round(min(2.5, 1.0 + 1.5 * tox_ratio), 2)
            rationale = (
                f"Severe adverse selection toxicity (T={tox_ratio:.2f} >= {self.tox_veto_thresh:.2f}, "
                f"Realized Spread={mean_real:+.1f} bps < 0). Liquidity providers bleeding capital to informed takers. "
                f"Widen maker quoting spreads by {mult}x and veto resting passive quotes."
            )
        elif tox_ratio >= self.tox_veto_thresh:
            directive = AdverseSelectionDirective.FOLLOW_INFORMED_FLOW_MOMENTUM
            mult = 1.30
            rationale = (
                f"High informed flow impact (Impact={mean_imp:.1f} bps, Toxicity={tox_ratio:.2f}). "
                f"Aggressive sweep active; piggyback informed institutional flow."
            )
        elif tox_ratio <= self.tox_benign_thresh:
            directive = AdverseSelectionDirective.BENIGN_RETAIL_FLOW_TIGHTEN_QUOTES
            mult = 0.85
            rationale = (
                f"Benign uninformed order flow (Toxicity={tox_ratio:.2f} <= {self.tox_benign_thresh:.2f}, "
                f"Realized Spread={mean_real:+.1f} bps). Tighten quoting spreads by 15% to maximize capture."
            )
        else:
            directive = AdverseSelectionDirective.EQUILIBRIUM_FLOW
            mult = 1.00
            rationale = (
                f"Order flow in equilibrium (Toxicity={tox_ratio:.2f}, EffSpread={mean_eff:.1f} bps, "
                f"Impact={mean_imp:.1f} bps)."
            )

        report = AdverseSelectionReport(
            symbol=symbol,
            effective_spread_bps=round(mean_eff, 2),
            realized_spread_bps=round(mean_real, 2),
            price_impact_bps=round(mean_imp, 2),
            toxicity_ratio=tox_ratio,
            quote_spread_multiplier=mult,
            directive=directive,
            rationale=rationale,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: AdverseSelectionReport) -> None:
        """Persists evaluation results to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO adverse_selection_telemetry (
                timestamp, symbol, eff_spread_bps, real_spread_bps,
                price_impact_bps, toxicity_ratio, spread_mult,
                directive, rationale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.effective_spread_bps,
                rep.realized_spread_bps,
                rep.price_impact_bps,
                rep.toxicity_ratio,
                rep.quote_spread_multiplier,
                rep.directive.value,
                rep.rationale,
            ),
        )
        conn.commit()

    def get_latest_telemetry(self, limit: int = 10) -> List[Tuple]:
        """Retrieves latest telemetry entries."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT symbol, eff_spread_bps, real_spread_bps, toxicity_ratio, spread_mult, directive
            FROM adverse_selection_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
