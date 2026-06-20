r"""
Domain 186 (WP-CJ): Real-Time Options Surface Wing Kurtosis & Extreme Tail-Risk Pricing Engine

Implements Extreme Value Theory (EVT) Generalized Pareto Distribution (GPD) tail fitting,
Pickands-Balkema-de Haan asymptotic excess losses, 10-delta vs 25-delta wing kurtosis index \mathcal{K}_{\text{wing}},
risk-neutral crash jump probability estimation, and convex tail hedge/harvest execution directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


class TailRiskDirective(str, Enum):
    CRASH_HEDGE_ACCELERATION_BUY_WINGS = "CRASH_HEDGE_ACCELERATION_BUY_WINGS"
    HARVEST_OVERPRICED_WINGS_SHORT_FLY = "HARVEST_OVERPRICED_WINGS_SHORT_FLY"
    THIN_TAIL_UNDERPRICED_HAZARD = "THIN_TAIL_UNDERPRICED_HAZARD"
    NORMAL_GAUSSIAN_TAIL_REGIME = "NORMAL_GAUSSIAN_TAIL_REGIME"


@dataclass
class DeepSmileQuotes:
    symbol: str
    underlying_price: float
    days_to_expiry: float
    atm_vol: float  # \sigma_{ATM}
    put_25d_vol: float  # \sigma_{25P}
    call_25d_vol: float  # \sigma_{25C}
    put_10d_vol: float  # \sigma_{10P} (deep OTM wing put)
    call_10d_vol: float  # \sigma_{10C} (deep OTM wing call)
    realized_vol_30d: float = 0.14  # Baseline annualized realized volatility


@dataclass
class WingKurtosisReport:
    symbol: str
    days_to_expiry: float
    wing_kurtosis_index: float  # \mathcal{K}_{\text{wing}}
    gpd_tail_index_xi: float  # Shape parameter \xi (fatness)
    gpd_scale_beta: float  # Scale parameter \beta
    crash_jump_probability_pct: float  # P(S_T < -3\sigma)
    wing_richness_ratio: float  # IV_{10P} / RV
    directive: TailRiskDirective
    rationale: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class OptionsWingKurtosisEVTEngine:
    """
    Sub-second Options Wing Kurtosis & Extreme Value Theory Tail Risk Engine.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        kurtosis_fat_threshold: float = 2.40,
        kurtosis_thin_threshold: float = 1.35,
        tail_index_heavy_threshold: float = 0.28,
    ):
        self.db_path = db_path
        self.kurt_fat_thresh = kurtosis_fat_threshold
        self.kurt_thin_thresh = kurtosis_thin_threshold
        self.xi_heavy_thresh = tail_index_heavy_threshold

        self._conn: Optional[sqlite3.Connection] = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for tail risk telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS options_wing_evt_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                dte REAL NOT NULL,
                wing_kurtosis REAL NOT NULL,
                tail_xi REAL NOT NULL,
                tail_beta REAL NOT NULL,
                crash_prob_pct REAL NOT NULL,
                wing_richness REAL NOT NULL,
                directive TEXT NOT NULL,
                rationale TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def calculate_wing_kurtosis(self, quotes: DeepSmileQuotes) -> float:
        r"""
        Computes Wing Kurtosis Index:
        \mathcal{K}_{\text{wing}} = \frac{(\sigma_{10P} + \sigma_{10C}) - 2\sigma_{ATM}}{(\sigma_{25P} + \sigma_{25C}) - 2\sigma_{ATM}}
        """
        num = (quotes.put_10d_vol + quotes.call_10d_vol) - 2.0 * quotes.atm_vol
        den = (quotes.put_25d_vol + quotes.call_25d_vol) - 2.0 * quotes.atm_vol

        if den <= 1e-6:
            return 1.60  # Default benign Gaussian ratio
        return round(num / den, 4)

    def fit_gpd_parameters(self, quotes: DeepSmileQuotes) -> Tuple[float, float, float]:
        """
        Calibrates Generalized Pareto Distribution parameters (xi, beta)
        from implied volatility wing curvature and estimates tail crash probability.
        """
        t_years = max(quotes.days_to_expiry, 1.0) / 365.0
        # Implied standard deviation over life of option
        std_t = quotes.atm_vol * math.sqrt(t_years)

        # Excess wing spread: IV(10P) - IV(ATM)
        wing_excess = max(0.001, quotes.put_10d_vol - quotes.atm_vol)

        # Closed-form EVT parameter mapping from wing convexity
        # Higher wing excess vol relative to ATM implies heavier Fréchet tail xi > 0
        xi = round(min(0.65, max(0.02, (wing_excess / quotes.atm_vol) * 0.85)), 4)
        beta = round(std_t * (1.0 - xi * 0.5), 4)

        # Asymptotic GPD tail exceedance probability for 3-sigma crash move: y = 3.0 * std_t
        y = 3.0 * std_t
        if 1.0 + xi * (y / beta) > 0:
            survivor_prob = (1.0 + xi * (y / beta)) ** (-1.0 / xi)
        else:
            survivor_prob = 0.0001

        crash_prob_pct = round(survivor_prob * 100.0, 3)
        return xi, beta, crash_prob_pct

    def analyze_tail_risk(self, quotes: DeepSmileQuotes) -> WingKurtosisReport:
        """
        Performs full EVT wing kurtosis analysis and emits institutional tail hedging directives.
        """
        kurt_index = self.calculate_wing_kurtosis(quotes)
        xi, beta, crash_prob_pct = self.fit_gpd_parameters(quotes)

        # Wing richness vs realized volatility
        rv = max(0.01, quotes.realized_vol_30d)
        wing_richness = round(quotes.put_10d_vol / rv, 2)

        # Directives
        if kurt_index >= self.kurt_fat_thresh and wing_richness >= 2.50:
            directive = TailRiskDirective.HARVEST_OVERPRICED_WINGS_SHORT_FLY
            rationale = (
                f"Wings severely overpriced relative to realized vol (Kurtosis={kurt_index:.2f}, "
                f"10d Put IV={quotes.put_10d_vol*100:.1f}% vs RV={rv*100:.1f}%, Richness={wing_richness}x). "
                f"Harvest volatility risk premium via ratio condor / sell rich wings against 25d hedges."
            )
        elif xi >= self.xi_heavy_thresh or kurt_index >= self.kurt_fat_thresh:
            directive = TailRiskDirective.CRASH_HEDGE_ACCELERATION_BUY_WINGS
            rationale = (
                f"Heavy tail index (Xi={xi:.3f}, Kurtosis={kurt_index:.2f}, CrashProb={crash_prob_pct:.2f}%). "
                f"Tail hazard elevated; buy convex 10-delta OTM put wings for catastrophic gap protection."
            )
        elif kurt_index <= self.kurt_thin_thresh:
            directive = TailRiskDirective.THIN_TAIL_UNDERPRICED_HAZARD
            rationale = (
                f"Wings unnaturally thin (Kurtosis={kurt_index:.2f} <= {self.kurt_thin_thresh:.2f}). "
                f"Market underpricing tail jumps; cheap convex crash insurance available."
            )
        else:
            directive = TailRiskDirective.NORMAL_GAUSSIAN_TAIL_REGIME
            rationale = (
                f"Options surface wing kurtosis in normal Gaussian regime (Kurtosis={kurt_index:.2f}, "
                f"Xi={xi:.3f}, CrashProb={crash_prob_pct:.2f}%)."
            )

        report = WingKurtosisReport(
            symbol=quotes.symbol,
            days_to_expiry=quotes.days_to_expiry,
            wing_kurtosis_index=kurt_index,
            gpd_tail_index_xi=xi,
            gpd_scale_beta=beta,
            crash_jump_probability_pct=crash_prob_pct,
            wing_richness_ratio=wing_richness,
            directive=directive,
            rationale=rationale,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: WingKurtosisReport) -> None:
        """Persists tail risk evaluation to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO options_wing_evt_telemetry (
                timestamp, symbol, dte, wing_kurtosis, tail_xi, tail_beta,
                crash_prob_pct, wing_richness, directive, rationale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.days_to_expiry,
                rep.wing_kurtosis_index,
                rep.gpd_tail_index_xi,
                rep.gpd_scale_beta,
                rep.crash_jump_probability_pct,
                rep.wing_richness_ratio,
                rep.directive.value,
                rep.rationale,
            ),
        )
        conn.commit()

    def get_latest_telemetry(self, limit: int = 10) -> List[Tuple]:
        """Retrieves recent tail risk telemetry records."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT symbol, dte, wing_kurtosis, tail_xi, crash_prob_pct, directive
            FROM options_wing_evt_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
