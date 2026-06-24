"""
Domain 172 (WP-BV): Intraday VWAP Elasticity & Mean-Reversion Half-Life Sieve

Implements cumulative intraday VWAP, volume-weighted second central moment dispersion bands
(+/- 1.0, 2.0, 3.0 sigma), dynamic diurnal Hooke's elasticity restoring force,
Ornstein-Uhlenbeck mean-reversion half-life calibration, and institutional execution directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class CandleBar:
    timestamp: str  # "HH:MM" or ISO string
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class VWAPBandResult:
    vwap: float
    sigma: float
    upper_1: float
    lower_1: float
    upper_2: float
    lower_2: float
    upper_3: float
    lower_3: float
    z_score: float


@dataclass
class VWAPElasticityReport:
    symbol: str
    current_price: float
    vwap: float
    sigma_vwap: float
    z_score: float
    elasticity_kappa: float
    half_life_minutes: float
    volume_surge_ratio: float
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class VWAPElasticitySieve:
    """
    Intraday VWAP Elasticity & Mean-Reversion Sieve.
    """

    def __init__(self, db_path: str = ":memory:"):
        self.db_path = db_path
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for VWAP Elasticity telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS vwap_elasticity_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                current_price REAL NOT NULL,
                vwap REAL NOT NULL,
                sigma_vwap REAL NOT NULL,
                z_score REAL NOT NULL,
                elasticity_kappa REAL NOT NULL,
                half_life_minutes REAL NOT NULL,
                volume_surge REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def calculate_vwap_and_bands(self, bars: List[CandleBar]) -> VWAPBandResult:
        """
        Calculates cumulative VWAP and volume-weighted standard deviation bands.
        Typical price P_typ = (H + L + C) / 3.
        """
        if not bars:
            return VWAPBandResult(
                vwap=0.0, sigma=0.0, upper_1=0.0, lower_1=0.0, upper_2=0.0, lower_2=0.0, upper_3=0.0, lower_3=0.0, z_score=0.0
            )

        cum_pv = 0.0
        cum_vol = 0.0

        for b in bars:
            p_typ = (b.high + b.low + b.close) / 3.0
            cum_pv += p_typ * b.volume
            cum_vol += b.volume

        if cum_vol <= 0:
            p_last = bars[-1].close
            return VWAPBandResult(
                vwap=p_last, sigma=0.0, upper_1=p_last, lower_1=p_last, upper_2=p_last, lower_2=p_last, upper_3=p_last, lower_3=p_last, z_score=0.0
            )

        vwap = cum_pv / cum_vol

        # Second central moment: sigma^2 = sum(V * (P - VWAP)^2) / sum(V)
        cum_var = 0.0
        for b in bars:
            p_typ = (b.high + b.low + b.close) / 3.0
            cum_var += b.volume * ((p_typ - vwap) ** 2)

        sigma = math.sqrt(cum_var / cum_vol)
        current_price = bars[-1].close
        z_score = (current_price - vwap) / max(1e-4, sigma)

        return VWAPBandResult(
            vwap=round(vwap, 2),
            sigma=round(sigma, 4),
            upper_1=round(vwap + 1.0 * sigma, 2),
            lower_1=round(vwap - 1.0 * sigma, 2),
            upper_2=round(vwap + 2.0 * sigma, 2),
            lower_2=round(vwap - 2.0 * sigma, 2),
            upper_3=round(vwap + 3.0 * sigma, 2),
            lower_3=round(vwap - 3.0 * sigma, 2),
            z_score=round(z_score, 2),
        )

    def calculate_ou_half_life(self, bars: List[CandleBar], vwap: float, bar_interval_min: float = 5.0) -> Tuple[float, float]:
        """
        Fits Ornstein-Uhlenbeck process on displacement x_t = P_t - VWAP:
        Delta x_t = a + b * x_{t-1} + eps
        Returns: (kappa, half_life_minutes).
        """
        if len(bars) < 5:
            return 0.10, 30.0

        displacements = [b.close - vwap for b in bars]
        dx = [displacements[t] - displacements[t - 1] for t in range(1, len(displacements))]
        lag_x = displacements[:-1]

        N = len(dx)
        mean_dx = sum(dx) / N
        mean_lx = sum(lag_x) / N

        cov_x = sum((dx[t] - mean_dx) * (lag_x[t] - mean_lx) for t in range(N))
        var_x = sum((lag_x[t] - mean_lx) ** 2 for t in range(N))

        b = cov_x / max(1e-8, var_x)

        # kappa per minute
        dt = bar_interval_min
        if -0.999 < b < 0.0:
            kappa = -math.log(1.0 + b) / dt
        else:
            kappa = max(0.005, -b / dt)

        half_life_min = math.log(2.0) / max(1e-4, kappa)
        half_life_clamped = round(max(2.0, min(180.0, half_life_min)), 1)
        return round(kappa, 4), half_life_clamped

    def analyze_vwap_elasticity(
        self,
        symbol: str,
        bars: List[CandleBar],
        bar_interval_min: float = 5.0,
    ) -> VWAPElasticityReport:
        """
        Runs comprehensive VWAP Elasticity & Mean Reversion Sieve.
        Directives:
        - EXECUTE_LONG_ELASTIC_REVERSION_TO_VWAP (z <= -2.0, non-breakout)
        - EXECUTE_SHORT_ELASTIC_REVERSION_TO_VWAP (z >= +2.0, non-breakout)
        - VWAP_TREND_EXPANSION_BULLISH (z >= 2.2 with volume surge >= 2.0x)
        - VWAP_TREND_EXPANSION_BEARISH (z <= -2.2 with volume surge >= 2.0x)
        - VWAP_ROTATIONAL_EQUILIBRIUM (|z| <= 0.50)
        """
        if not bars:
            raise ValueError("bars list cannot be empty")

        bands = self.calculate_vwap_and_bands(bars)
        kappa, half_life = self.calculate_ou_half_life(bars, bands.vwap, bar_interval_min)

        current_price = bars[-1].close
        z = bands.z_score

        # Volume surge ratio: latest bar volume vs rolling average
        avg_vol = sum(b.volume for b in bars) / len(bars)
        vol_surge = round(bars[-1].volume / max(1.0, avg_vol), 2)

        # Classify regime & directive
        if z >= 1.75 and vol_surge >= 2.0:
            regime = "VWAP_TREND_EXPANSION_BULLISH"
            directive = "INITIATIVE_LONG_CONTINUATION"
        elif z <= -1.75 and vol_surge >= 2.0:
            regime = "VWAP_TREND_EXPANSION_BEARISH"
            directive = "INITIATIVE_SHORT_CONTINUATION"
        elif z >= 1.75:
            regime = "OVEREXTENDED_UPPER_VWAP_BAND"
            directive = "EXECUTE_SHORT_ELASTIC_REVERSION_TO_VWAP"
        elif z <= -1.75:
            regime = "OVEREXTENDED_LOWER_VWAP_BAND"
            directive = "EXECUTE_LONG_ELASTIC_REVERSION_TO_VWAP"
        elif abs(z) <= 0.50:
            regime = "VWAP_EQUILIBRIUM_ZONE"
            directive = "STAND_ASIDE_FAIR_VALUE"
        else:
            regime = "MID_BAND_ROTATIONAL"
            directive = "TRAIL_EXISTING_POSITIONS"

        report = VWAPElasticityReport(
            symbol=symbol,
            current_price=round(current_price, 2),
            vwap=bands.vwap,
            sigma_vwap=bands.sigma,
            z_score=z,
            elasticity_kappa=kappa,
            half_life_minutes=half_life,
            volume_surge_ratio=vol_surge,
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: VWAPElasticityReport) -> None:
        """Persists evaluation results to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO vwap_elasticity_telemetry (
                timestamp, symbol, current_price, vwap, sigma_vwap,
                z_score, elasticity_kappa, half_life_minutes, volume_surge,
                regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.current_price,
                rep.vwap,
                rep.sigma_vwap,
                rep.z_score,
                rep.elasticity_kappa,
                rep.half_life_minutes,
                rep.volume_surge_ratio,
                rep.regime,
                rep.trade_directive,
            ),
        )
        conn.commit()

    def get_latest_telemetry(self, limit: int = 10) -> List[Tuple]:
        """Retrieves latest persisted telemetry rows."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT symbol, current_price, vwap, z_score, elasticity_kappa, half_life_minutes, regime, directive
            FROM vwap_elasticity_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
