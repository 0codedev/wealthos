r"""
Domain 194 (WP-CR): Cross-Asset Options Smile Dispersion & Volatility Arbitrage Engine

Implements multi-asset options dispersion and correlation risk premium (CRP) arbitrage:
- Index vs Constituent variance identity (Driessen-Maenhout-Vilkov 2009):
    \sigma_I^2 = \sum w_i^2 \sigma_i^2 + \rho_{imp} \sum_{i \ne j} w_i w_j \sigma_i \sigma_j
- Analytical inversion for Equi-correlation / Implied Correlation \rho_{imp}:
    \rho_{imp} = \frac{\sigma_I^2 - \sum w_i^2 \sigma_i^2}{(\sum w_i \sigma_i)^2 - \sum w_i^2 \sigma_i^2}
- No-arbitrage spectral bound verification: \rho_{imp} \in [-1/(N-1), 1.0]
- Vega-neutral basket weighting and dynamic hedging ratios
- Quantitative trading directives:
    * Classic dispersion: Short rich index variance, long cheap constituent basket
    * Reverse dispersion: Long cheap index variance, short rich constituent basket
    * Bound violation arbitrage alert
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


class DispersionDirective(str, Enum):
    DISPERSION_SELL_INDEX_BUY_BASKET = "DISPERSION_SELL_INDEX_BUY_BASKET"
    REVERSE_DISPERSION_BUY_INDEX_SELL_BASKET = "REVERSE_DISPERSION_BUY_INDEX_SELL_BASKET"
    DISPERSION_ARBITRAGE_BOUND_VIOLATION = "DISPERSION_ARBITRAGE_BOUND_VIOLATION"
    EQUILIBRIUM_FAIR_DISPERSION = "EQUILIBRIUM_FAIR_DISPERSION"


@dataclass
class ConstituentOption:
    symbol: str
    weight: float  # Capitalization or index weight w_i \in [0, 1]
    spot: float
    atm_iv: float  # Fraction, e.g. 0.22 for 22% IV
    vega_per_contract: float  # Dollar or INR vega per contract


@dataclass
class DispersionOpportunity:
    index_symbol: str
    index_spot: float
    index_atm_iv: float
    index_vega: float
    constituents: List[ConstituentOption]
    weighted_basket_iv: float
    implied_correlation: float  # \rho_{imp}
    realized_correlation: float  # \rho_{real}
    correlation_risk_premium: float  # \rho_{imp} - \rho_{real}
    vega_neutral_allocations: Dict[str, float]  # Contracts per constituent per 1 index contract
    directive: DispersionDirective
    rationale: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class OptionsDispersionArbitrageEngine:
    r"""
    Quantitative Index Options Dispersion & Correlation Arbitrage Engine.
    Harvests the structural Correlation Risk Premium (CRP) by monetizing
    discrepancies between index implied volatility and constituent implied volatilities.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        dispersion_threshold: float = 0.15,  # \rho_{imp} - \rho_{real} >= 0.15
        reverse_threshold: float = -0.10,     # \rho_{imp} - \rho_{real} <= -0.10
    ):
        self.db_path = db_path
        self.disp_thresh = dispersion_threshold
        self.rev_thresh = reverse_threshold

        self._conn: Optional[sqlite3.Connection] = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for dispersion telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS dispersion_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                index_symbol TEXT NOT NULL,
                index_iv REAL NOT NULL,
                basket_iv REAL NOT NULL,
                implied_corr REAL NOT NULL,
                realized_corr REAL NOT NULL,
                crp REAL NOT NULL,
                directive TEXT NOT NULL,
                rationale TEXT NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def compute_implied_correlation(
        index_iv: float, constituents: List[ConstituentOption]
    ) -> Tuple[float, float, float]:
        r"""
        Inverts index variance equation for implied correlation \rho_{imp}:
        \sigma_I^2 = \sum w_i^2 \sigma_i^2 + \rho_{imp} \sum_{i \ne j} w_i w_j \sigma_i \sigma_j
        \rho_{imp} = \frac{\sigma_I^2 - \sum w_i^2 \sigma_i^2}{(\sum w_i \sigma_i)^2 - \sum w_i^2 \sigma_i^2}
        Returns:
            (implied_correlation, weighted_basket_iv, sum_w2_sigma2)
        """
        if not constituents:
            return 0.0, 0.0, 0.0

        # Normalize weights if sum != 1
        total_w = sum(c.weight for c in constituents)
        if total_w <= 0:
            return 0.0, 0.0, 0.0

        weights = [c.weight / total_w for c in constituents]
        vols = [c.atm_iv for c in constituents]

        # 1. Sum of w_i * \sigma_i
        sum_w_sigma = sum(w * v for w, v in zip(weights, vols))

        # 2. Sum of w_i^2 * \sigma_i^2 (Individual variance term)
        sum_w2_sigma2 = sum((w * v) ** 2 for w, v in zip(weights, vols))

        # 3. Off-diagonal sum: (\sum w_i \sigma_i)^2 - \sum w_i^2 \sigma_i^2
        cross_term = (sum_w_sigma ** 2) - sum_w2_sigma2

        idx_var = index_iv ** 2

        if cross_term <= 1e-12:
            return 1.0, sum_w_sigma, sum_w2_sigma2

        rho_imp = (idx_var - sum_w2_sigma2) / cross_term
        return rho_imp, sum_w_sigma, sum_w2_sigma2

    def evaluate_dispersion(
        self,
        index_symbol: str,
        index_spot: float,
        index_iv: float,
        index_vega: float,
        constituents: List[ConstituentOption],
        realized_correlation: float,
    ) -> DispersionOpportunity:
        r"""
        Evaluates cross-sectional dispersion opportunity, calculates vega-neutral basket allocations,
        and emits execution directives.
        """
        now_ts = datetime.now(timezone.utc).isoformat()
        if not constituents:
            return DispersionOpportunity(
                index_symbol=index_symbol,
                index_spot=index_spot,
                index_iv=index_iv,
                index_vega=index_vega,
                constituents=[],
                weighted_basket_iv=0.0,
                implied_correlation=0.0,
                realized_correlation=realized_correlation,
                correlation_risk_premium=0.0,
                vega_neutral_allocations={},
                directive=DispersionDirective.EQUILIBRIUM_FAIR_DISPERSION,
                rationale="No constituents provided.",
                timestamp=now_ts,
            )

        n = len(constituents)
        rho_imp, basket_iv, _ = self.compute_implied_correlation(index_iv, constituents)
        crp = rho_imp - realized_correlation

        # Lower mathematical bound for equi-correlation: -1 / (n - 1)
        lower_bound = -1.0 / float(max(1, n - 1))

        # Calculate Vega-Neutral Allocations (contracts of constituent per 1 index contract)
        # Total index vega to hedge = index_vega
        # Constituent allocation = (w_i * index_vega) / vega_per_contract
        vega_allocations: Dict[str, float] = {}
        for c in constituents:
            if c.vega_per_contract > 1e-6:
                alloc = (c.weight * index_vega) / c.vega_per_contract
                vega_allocations[c.symbol] = round(alloc, 4)
            else:
                vega_allocations[c.symbol] = 0.0

        # Directive Sieve
        if rho_imp > 1.0001 or rho_imp < lower_bound - 0.0001:
            directive = DispersionDirective.DISPERSION_ARBITRAGE_BOUND_VIOLATION
            rationale = (
                f"Mathematical arbitrage bound violated! Implied correlation {rho_imp:.3f} "
                f"outside physical spectral bounds [{lower_bound:.3f}, 1.000]. Free arbitrage extraction."
            )
        elif crp >= self.disp_thresh:
            directive = DispersionDirective.DISPERSION_SELL_INDEX_BUY_BASKET
            rationale = (
                f"Rich Correlation Risk Premium (+{crp*100:.1f}% CRP). "
                f"Implied corr ({rho_imp*100:.1f}%) >> Realized corr ({realized_correlation*100:.1f}%). "
                f"SHORT Index Vol ({index_iv*100:.1f}%), LONG Constituent Basket ({basket_iv*100:.1f}%)."
            )
        elif crp <= self.rev_thresh:
            directive = DispersionDirective.REVERSE_DISPERSION_BUY_INDEX_SELL_BASKET
            rationale = (
                f"Cheap correlation detected ({crp*100:.1f}% CRP). "
                f"Implied corr ({rho_imp*100:.1f}%) << Realized corr ({realized_correlation*100:.1f}%). "
                f"LONG Index Vol ({index_iv*100:.1f}%), SHORT Constituent Basket ({basket_iv*100:.1f}%)."
            )
        else:
            directive = DispersionDirective.EQUILIBRIUM_FAIR_DISPERSION
            rationale = (
                f"Fair dispersion pricing (CRP: {crp*100:.1f}% within normal bounds "
                f"[{self.rev_thresh*100:.1f}%, {self.disp_thresh*100:.1f}%])."
            )

        opp = DispersionOpportunity(
            index_symbol=index_symbol,
            index_spot=index_spot,
            index_atm_iv=round(index_iv, 4),
            index_vega=round(index_vega, 2),
            constituents=constituents,
            weighted_basket_iv=round(basket_iv, 4),
            implied_correlation=round(rho_imp, 4),
            realized_correlation=round(realized_correlation, 4),
            correlation_risk_premium=round(crp, 4),
            vega_neutral_allocations=vega_allocations,
            directive=directive,
            rationale=rationale,
            timestamp=now_ts,
        )

        self._record_telemetry(opp)
        return opp

    def _record_telemetry(self, opp: DispersionOpportunity) -> None:
        """Persists dispersion metrics to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO dispersion_telemetry (
                timestamp, index_symbol, index_iv, basket_iv, implied_corr,
                realized_corr, crp, directive, rationale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                opp.timestamp,
                opp.index_symbol,
                opp.index_atm_iv,
                opp.weighted_basket_iv,
                opp.implied_correlation,
                opp.realized_correlation,
                opp.correlation_risk_premium,
                opp.directive.value,
                opp.rationale,
            ),
        )
        conn.commit()

    def get_recent_opportunities(self, limit: int = 10) -> List[Dict]:
        """Retrieves recent dispersion evaluations from SQLite telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT timestamp, index_symbol, index_iv, basket_iv, implied_corr,
                   realized_corr, crp, directive, rationale
            FROM dispersion_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        rows = cursor.fetchall()
        results = []
        for r in rows:
            results.append(
                {
                    "timestamp": r[0],
                    "index_symbol": r[1],
                    "index_iv": r[2],
                    "basket_iv": r[3],
                    "implied_corr": r[4],
                    "realized_corr": r[5],
                    "crp": r[6],
                    "directive": r[7],
                    "rationale": r[8],
                }
            )
        return results
