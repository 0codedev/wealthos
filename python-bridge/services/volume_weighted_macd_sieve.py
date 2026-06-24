"""
Domain 158 (WP-BH): Intraday Volume-Weighted MACD & Dual-Momentum Divergence Sieve

Implements Buff Dormeier's Volume-Weighted Moving Average Convergence Divergence (VW-MACD),
recursive dual-accumulator Volume-Weighted Exponential Moving Averages (VWEMA-12 / VWEMA-26),
volume confirmation hurdle verification, and false crossover rejection filtering.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import List, Optional


@dataclass
class BarTick:
    timestamp: str
    close: float
    volume: float


@dataclass
class VWMACDReport:
    symbol: str
    current_price: float
    vw_macd: float
    signal_line: float
    histogram: float
    volume_conf_ratio: float
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class VolumeWeightedMACDSieve:
    """
    Intraday Volume-Weighted MACD & Dual-Momentum Sieve.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        fast_period: int = 12,
        slow_period: int = 26,
        signal_period: int = 9,
        volume_hurdle: float = 1.50,
    ):
        self.db_path = db_path
        self.fast_period = fast_period
        self.slow_period = slow_period
        self.signal_period = signal_period
        self.volume_hurdle = volume_hurdle
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for VW-MACD telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS vw_macd_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                current_price REAL NOT NULL,
                vw_macd REAL NOT NULL,
                signal_line REAL NOT NULL,
                histogram REAL NOT NULL,
                volume_ratio REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def compute_vw_macd_series(self, bars: List[BarTick]) -> tuple[List[float], List[float], List[float]]:
        """
        Computes VW-MACD line, Signal line, and Histogram across bar sequence.
        Uses recursive dual-accumulator formulation for fast and slow VWEMA.
        """
        if len(bars) < self.slow_period + self.signal_period:
            raise ValueError(f"Need at least {self.slow_period + self.signal_period} bars, got {len(bars)}")

        alpha_f = 2.0 / (self.fast_period + 1.0)
        alpha_s = 2.0 / (self.slow_period + 1.0)
        alpha_sig = 2.0 / (self.signal_period + 1.0)

        # Initial seed at bar 0
        num_f = bars[0].close * bars[0].volume
        den_f = max(1e-4, bars[0].volume)

        num_s = bars[0].close * bars[0].volume
        den_s = max(1e-4, bars[0].volume)

        macd_series = []

        for b in bars:
            pv = b.close * b.volume
            v = max(1e-4, b.volume)

            num_f = alpha_f * pv + (1.0 - alpha_f) * num_f
            den_f = alpha_f * v + (1.0 - alpha_f) * den_f
            vwema_f = num_f / den_f

            num_s = alpha_s * pv + (1.0 - alpha_s) * num_s
            den_s = alpha_s * v + (1.0 - alpha_s) * den_s
            vwema_s = num_s / den_s

            macd_val = vwema_f - vwema_s
            macd_series.append(macd_val)

        # Signal line (EMA of macd_series)
        sig_series = []
        curr_sig = macd_series[0]
        for m in macd_series:
            curr_sig = alpha_sig * m + (1.0 - alpha_sig) * curr_sig
            sig_series.append(curr_sig)

        hist_series = [m - s for m, s in zip(macd_series, sig_series)]
        return macd_series, sig_series, hist_series

    def evaluate_vw_macd(self, symbol: str, bars: List[BarTick]) -> VWMACDReport:
        """
        Evaluates latest VW-MACD crossover and checks volume confirmation ratio.
        """
        macd_series, sig_series, hist_series = self.compute_vw_macd_series(bars)

        curr_macd = macd_series[-1]
        prev_macd = macd_series[-2]

        curr_sig = sig_series[-1]
        prev_sig = sig_series[-2]

        curr_hist = hist_series[-1]
        prev_hist = hist_series[-2]

        # Calculate volume confirmation ratio vs 20-bar baseline
        vol_baseline_bars = bars[-21:-1] if len(bars) >= 21 else bars[:-1]
        avg_vol = sum(b.volume for b in vol_baseline_bars) / max(1, len(vol_baseline_bars))
        vol_ratio = bars[-1].volume / max(1.0, avg_vol)

        # Crossover Detection
        is_bullish_cross = prev_macd <= prev_sig and curr_macd > curr_sig
        is_bearish_cross = prev_macd >= prev_sig and curr_macd < curr_sig

        is_volume_confirmed = vol_ratio >= self.volume_hurdle

        if is_bullish_cross:
            if is_volume_confirmed:
                regime = "BULLISH_VW_MACD_CROSSOVER_CONFIRMED"
                directive = "BUY_MOMENTUM_EXPANSION"
            else:
                regime = "LOW_VOLUME_FALSE_CROSSOVER_REJECTED"
                directive = "STAND_ASIDE_FILTER_NOISE"
        elif is_bearish_cross:
            if is_volume_confirmed:
                regime = "BEARISH_VW_MACD_CROSSDOWN_CONFIRMED"
                directive = "SELL_MOMENTUM_BREAKDOWN"
            else:
                regime = "LOW_VOLUME_FALSE_CROSSDOWN_REJECTED"
                directive = "STAND_ASIDE_FILTER_NOISE"
        elif curr_hist > 0:
            if curr_hist > prev_hist:
                regime = "BULLISH_HISTOGRAM_ACCELERATING"
                directive = "RIDE_LONG_MOMENTUM"
            else:
                regime = "BULLISH_HISTOGRAM_DECELERATING"
                directive = "TRAIL_PROFIT_STOP"
        elif curr_hist < 0:
            if curr_hist < prev_hist:
                regime = "BEARISH_HISTOGRAM_ACCELERATING"
                directive = "RIDE_SHORT_MOMENTUM"
            else:
                regime = "BEARISH_HISTOGRAM_DECELERATING"
                directive = "COVER_SHORT_EXHAUSTION"
        else:
            regime = "VW_MACD_ZERO_EQUILIBRIUM"
            directive = "STAND_ASIDE_NEUTRAL"

        report = VWMACDReport(
            symbol=symbol,
            current_price=round(bars[-1].close, 2),
            vw_macd=round(curr_macd, 4),
            signal_line=round(curr_sig, 4),
            histogram=round(curr_hist, 4),
            volume_conf_ratio=round(vol_ratio, 2),
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, report: VWMACDReport) -> None:
        """Persists audit record to SQLite database."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO vw_macd_telemetry (
                timestamp, symbol, current_price, vw_macd, signal_line,
                histogram, volume_ratio, regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report.timestamp,
                report.symbol,
                report.current_price,
                report.vw_macd,
                report.signal_line,
                report.histogram,
                report.volume_conf_ratio,
                report.regime,
                report.trade_directive,
            ),
        )
        conn.commit()
