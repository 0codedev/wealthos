"""
Domain 160 (WP-BJ): Intraday Anchored VWAP (AVWAP) & Institutional Liquidity Sweep Sieve

Implements event-anchored VWAP (AVWAP) from exogenous market shocks, volume-weighted second
central moment dispersion bands (+/- 1.0 sigma, 2.0 sigma), institutional stop-hunting liquidity
sweep detection ("Wyckoff Spring / Upthrust"), and dynamic reversal trade directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import List, Optional


@dataclass
class CandleBar:
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class AVWAPReport:
    symbol: str
    anchor_event: str
    current_price: float
    avwap: float
    sigma_dispersion: float
    upper_band_1: float
    lower_band_1: float
    upper_band_2: float
    lower_band_2: float
    z_score: float
    wick_ratio: float
    volume_surge_ratio: float
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class AnchoredVWAPSweepSieve:
    """
    Event-Anchored VWAP & Stop-Hunt Liquidity Sweep Sieve.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        volume_surge_hurdle: float = 1.75,
        wick_rejection_hurdle: float = 0.50,
    ):
        self.db_path = db_path
        self.volume_surge_hurdle = volume_surge_hurdle
        self.wick_rejection_hurdle = wick_rejection_hurdle
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for AVWAP telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS anchored_vwap_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                anchor_event TEXT NOT NULL,
                current_price REAL NOT NULL,
                avwap REAL NOT NULL,
                sigma REAL NOT NULL,
                z_score REAL NOT NULL,
                wick_ratio REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def calculate_avwap_series(
        self,
        bars: List[CandleBar],
        anchor_index: int,
    ) -> tuple[float, float]:
        """
        Calculates AVWAP and volume-weighted standard deviation from anchor_index to the end.
        """
        if anchor_index >= len(bars):
            raise ValueError(f"Anchor index {anchor_index} exceeds bars length {len(bars)}")

        c_v = 0.0
        c_pv = 0.0
        c_pv2 = 0.0

        for b in bars[anchor_index:]:
            v = max(1e-4, b.volume)
            typical_price = (b.high + b.low + b.close) / 3.0
            c_v += v
            c_pv += typical_price * v
            c_pv2 += (typical_price**2) * v

        if c_v <= 0:
            return bars[-1].close, 0.0

        avwap = c_pv / c_v
        var_dispersion = max(1e-6, (c_pv2 / c_v) - (avwap**2))
        sigma = math.sqrt(var_dispersion)
        return avwap, sigma

    def evaluate_anchor_and_sweep(
        self,
        symbol: str,
        anchor_event_name: str,
        bars: List[CandleBar],
        anchor_index: int,
        average_volume: float,
    ) -> AVWAPReport:
        """
        Evaluates current price vs AVWAP bands, tests for stop-hunting liquidity sweeps.
        """
        avwap, sigma = self.calculate_avwap_series(bars, anchor_index)
        curr = bars[-1]
        p_close = curr.close

        upper_1 = avwap + (1.0 * sigma)
        lower_1 = avwap - (1.0 * sigma)
        upper_2 = avwap + (2.0 * sigma)
        lower_2 = avwap - (2.0 * sigma)

        z_score = (p_close - avwap) / max(1e-4, sigma)
        vol_surge = curr.volume / max(1.0, average_volume)
        bar_span = max(1e-4, curr.high - curr.low)

        # Detect Bullish / Bearish Sweeps
        lower_wick = min(curr.open, p_close) - curr.low
        lower_wick_ratio = lower_wick / bar_span

        upper_wick = curr.high - max(curr.open, p_close)
        upper_wick_ratio = upper_wick / bar_span

        is_bull_sweep = False
        is_bear_sweep = False

        if curr.low < lower_2:
            wick_ratio = lower_wick_ratio
            if wick_ratio >= self.wick_rejection_hurdle and vol_surge >= self.volume_surge_hurdle:
                is_bull_sweep = True
        elif curr.high > upper_2:
            wick_ratio = upper_wick_ratio
            if wick_ratio >= self.wick_rejection_hurdle and vol_surge >= self.volume_surge_hurdle:
                is_bear_sweep = True
        else:
            wick_ratio = max(lower_wick_ratio, upper_wick_ratio)

        if is_bull_sweep:
            regime = "BULLISH_LIQUIDITY_SWEEP_SPRING"
            directive = "BUY_LIQUIDITY_ABSORPTION_REVERSAL"
        elif is_bear_sweep:
            regime = "BEARISH_LIQUIDITY_SWEEP_UPTHRUST"
            directive = "SELL_LIQUIDITY_ABSORPTION_REVERSAL"
        elif p_close > upper_2:
            regime = "OVEREXTENDED_BULLISH_EXPANSION"
            directive = "AVOID_LONG_CHASING_WAIT_PULLBACK"
        elif p_close < lower_2:
            regime = "OVEREXTENDED_BEARISH_CAPITULATION"
            directive = "AVOID_SHORT_CHASING_WAIT_BOUNCE"
        elif p_close >= avwap:
            regime = "BULLISH_ANCHOR_TREND_HOLD"
            directive = "HOLD_LONG_ABOVE_AVWAP"
        else:
            regime = "BEARISH_ANCHOR_TREND_HOLD"
            directive = "HOLD_SHORT_BELOW_AVWAP"

        report = AVWAPReport(
            symbol=symbol,
            anchor_event=anchor_event_name,
            current_price=round(p_close, 2),
            avwap=round(avwap, 2),
            sigma_dispersion=round(sigma, 2),
            upper_band_1=round(upper_1, 2),
            lower_band_1=round(lower_1, 2),
            upper_band_2=round(upper_2, 2),
            lower_band_2=round(lower_2, 2),
            z_score=round(z_score, 2),
            wick_ratio=round(wick_ratio, 3),
            volume_surge_ratio=round(vol_surge, 2),
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, report: AVWAPReport) -> None:
        """Persists audit record to SQLite database."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO anchored_vwap_telemetry (
                timestamp, symbol, anchor_event, current_price, avwap,
                sigma, z_score, wick_ratio, regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report.timestamp,
                report.symbol,
                report.anchor_event,
                report.current_price,
                report.avwap,
                report.sigma_dispersion,
                report.z_score,
                report.wick_ratio,
                report.regime,
                report.trade_directive,
            ),
        )
        conn.commit()
