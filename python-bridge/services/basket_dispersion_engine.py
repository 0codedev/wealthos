r"""
Multi-Asset Synthetic Basket Dispersion Arbitrage & Correlation Swap Sieve (Domain 150 / WP-AZ)
=================================================================================================

Autonomous dispersion arbitrage and correlation swap engine tracking NIFTY 50 index options
versus constituent equity options, calculating market-implied correlation (\bar{\rho}_{\text{impl}}),
volatility dispersion spreads (\Delta_{\text{disp}}), and constructing delta-neutral,
vega-balanced dispersion portfolios.

Mathematical Formulations:
--------------------------
1. Index Return Variance & Implied Correlation:
       \sigma_I^2 = \sum_{i=1}^M w_i^2 \sigma_i^2 + \bar{\rho} \left[ \left( \sum_{i=1}^M w_i \sigma_i \right)^2 - \sum_{i=1}^M w_i^2 \sigma_i^2 \right]
   Solving for Market-Implied Correlation \bar{\rho}_{\text{impl}}:
       \bar{\rho}_{\text{impl}} = \frac{\sigma_I^2 - \sum_{i=1}^M w_i^2 \sigma_i^2}{\left( \sum_{i=1}^M w_i \sigma_i \right)^2 - \sum_{i=1}^M w_i^2 \sigma_i^2}
   subject to \bar{\rho}_{\text{impl}} \in [0.0, 1.0].

2. Volatility Dispersion Spread:
       \Delta_{\text{disp}} = \left( \sum_{i=1}^M w_i \sigma_i \right) - \sigma_I \quad \text{(in vol pts)}

3. Vega-Balanced Basket Weighting:
   To ensure portfolio vega neutrality between the short index options and long constituent basket:
       w_{\text{vega}, i} = w_i \cdot \frac{\mathcal{V}_I}{\sum_{j=1}^M w_j \mathcal{V}_j}

4. Dispersion Arbitrage Directives:
       \text{If } \bar{\rho}_{\text{impl}} \ge 0.55 \text{ and } \Delta_{\text{disp}} \ge 3.0 \text{ pts}: \implies \text{LONG\_DISPERSION\_SHORT\_CORRELATION}
       \text{If } \bar{\rho}_{\text{impl}} \le 0.22: \implies \text{SHORT\_DISPERSION\_LONG\_CORRELATION}
"""

from dataclasses import dataclass
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class ConstituentVolQuote:
    symbol: str
    weight: float  # Normalized index weight (e.g. 0.30 for 30%)
    implied_vol: float  # Annualized IV (e.g. 0.24 for 24%)
    vega_per_contract: float = 100.0


@dataclass
class DispersionReport:
    index_symbol: str
    index_implied_vol: float
    weighted_constituent_vol: float
    dispersion_spread_pts: float
    implied_correlation: float
    recommended_vega_weights: Dict[str, float]
    regime: str
    trade_directive: str


class BasketDispersionEngine:
    """
    Sub-millisecond multi-asset basket dispersion arbitrage and correlation swap engine.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        high_corr_hurdle: float = 0.55,  # Threshold to sell overpriced correlation
        low_corr_hurdle: float = 0.22,   # Threshold to buy underpriced correlation
        min_dispersion_pts: float = 3.0,  # Minimum vol dispersion spread in pts
    ):
        self.db_path = db_path
        self.high_corr = high_corr_hurdle
        self.low_corr = low_corr_hurdle
        self.min_disp = min_dispersion_pts
        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            if self._conn is None:
                self._conn = sqlite3.connect(":memory:")
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for dispersion telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS basket_dispersion_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                index_symbol TEXT NOT NULL,
                index_vol REAL NOT NULL,
                weighted_vol REAL NOT NULL,
                dispersion_spread REAL NOT NULL,
                implied_corr REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def evaluate_dispersion(
        self,
        index_symbol: str,
        index_implied_vol: float,
        constituents: List[ConstituentVolQuote],
        index_vega: float = 1000.0,
    ) -> DispersionReport:
        """
        Calculates implied correlation, dispersion spread, and optimal
        vega allocation across index and constituent legs.
        """
        n = len(constituents)
        if n == 0:
            raise ValueError("Constituents list cannot be empty")

        total_w = sum(c.weight for c in constituents)
        norm_weights = [c.weight / max(1e-6, total_w) for c in constituents]

        # 1. Component sums
        # Weighted average IV
        weighted_vol = sum(w * c.implied_vol for w, c in zip(norm_weights, constituents))
        sigma_sq_weighted = sum((w ** 2) * (c.implied_vol ** 2) for w, c in zip(norm_weights, constituents))
        weighted_sum_sq = (weighted_vol) ** 2

        # 2. Implied Correlation \bar{\rho}_{\text{impl}}
        index_var = index_implied_vol ** 2
        numerator = index_var - sigma_sq_weighted
        denominator = weighted_sum_sq - sigma_sq_weighted

        if denominator <= 1e-8:
            implied_corr = 1.0
        else:
            raw_corr = numerator / denominator
            implied_corr = max(0.0, min(1.0, raw_corr))

        # 3. Volatility Dispersion Spread (in vol percentage points)
        dispersion_spread_pts = (weighted_vol - index_implied_vol) * 100.0

        # 4. Vega-Balanced Weights
        vega_weights: Dict[str, float] = {}
        total_denom_vega = sum(w * c.vega_per_contract for w, c in zip(norm_weights, constituents))
        for w, c in zip(norm_weights, constituents):
            scale = (w * index_vega) / max(1e-4, total_denom_vega)
            vega_weights[c.symbol] = round(scale, 4)

        # 5. Regime & Directive Sieve
        if implied_corr >= self.high_corr and dispersion_spread_pts >= self.min_disp:
            regime = "OVERPRICED_CORRELATION_REGIME"
            directive = "LONG_DISPERSION_SELL_INDEX_BUY_BASKET"
        elif implied_corr <= self.low_corr:
            regime = "UNDERPRICED_CORRELATION_REGIME"
            directive = "SHORT_DISPERSION_BUY_INDEX_SELL_BASKET"
        else:
            regime = "CORRELATION_EQUILIBRIUM"
            directive = "HOLD_DELTA_HEDGED_DISPERSION_BOOK"

        report = DispersionReport(
            index_symbol=index_symbol,
            index_implied_vol=round(index_implied_vol, 4),
            weighted_constituent_vol=round(weighted_vol, 4),
            dispersion_spread_pts=round(dispersion_spread_pts, 2),
            implied_correlation=round(implied_corr, 4),
            recommended_vega_weights=vega_weights,
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: DispersionReport) -> None:
        """Persists dispersion telemetry into SQLite."""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO basket_dispersion_telemetry (
                    timestamp, index_symbol, index_vol, weighted_vol,
                    dispersion_spread, implied_corr, regime, directive
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.utcnow().isoformat(),
                    rep.index_symbol,
                    rep.index_implied_vol,
                    rep.weighted_constituent_vol,
                    rep.dispersion_spread_pts,
                    rep.implied_correlation,
                    rep.regime,
                    rep.trade_directive,
                ),
            )
            conn.commit()
        except Exception:
            pass
