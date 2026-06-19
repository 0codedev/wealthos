"""
Domain 152 (WP-BB): Intraday Opening Range Breakout (ORB) & Volatility Expansion Sieve

Implements Toby Crabel (1990) dynamic stretch factor calculation, 15-minute Opening Range
envelope formulation, volume expansion validation (V >= 1.8 * SMA_V), false breakout wick
rejection filtering, and automated ORB trade directive synthesis.
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
class DailySessionStats:
    high: float
    low: float
    open: float
    close: float


@dataclass
class ORBAnalysisReport:
    symbol: str
    or_high: float
    or_low: float
    or_span: float
    stretch: float
    bull_trigger: float
    bear_trigger: float
    current_price: float
    volume_expansion_ratio: float
    wick_ratio: float
    regime: str
    trade_directive: str
    target_1: float
    target_2: float
    stop_loss: float
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class OpeningRangeBreakoutSieve:
    """
    Intraday Opening Range Breakout (ORB) with Toby Crabel stretch factor and
    institutional volume expansion / false breakout rejection sifter.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        stretch_multiplier: float = 0.20,
        volume_expansion_hurdle: float = 1.80,
        wick_rejection_threshold: float = 0.50,
    ):
        self.db_path = db_path
        self.stretch_multiplier = stretch_multiplier
        self.volume_expansion_hurdle = volume_expansion_hurdle
        self.wick_rejection_threshold = wick_rejection_threshold
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite telemetry audit table for ORB executions."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS orb_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                or_high REAL NOT NULL,
                or_low REAL NOT NULL,
                or_span REAL NOT NULL,
                stretch REAL NOT NULL,
                bull_trigger REAL NOT NULL,
                bear_trigger REAL NOT NULL,
                current_price REAL NOT NULL,
                volume_ratio REAL NOT NULL,
                wick_ratio REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def calculate_crabel_stretch(historical_sessions: List[DailySessionStats]) -> float:
        """
        Calculates Toby Crabel's Stretch: the average difference between the Open and
        the extreme prices (High-Open and Open-Low) across historical daily sessions.
        """
        if not historical_sessions:
            return 0.0

        diffs = []
        for s in historical_sessions:
            diff_high = max(0.0, s.high - s.open)
            diff_low = max(0.0, s.open - s.low)
            diffs.append((diff_high + diff_low) / 2.0)

        return sum(diffs) / len(diffs)

    def evaluate_orb(
        self,
        symbol: str,
        opening_bars: List[CandleBar],
        current_bar: CandleBar,
        average_bar_volume: float,
        historical_sessions: Optional[List[DailySessionStats]] = None,
    ) -> ORBAnalysisReport:
        """
        Evaluates the opening range, tests current bar for volume-confirmed breakouts
        or false breakout wick rejections.
        """
        if not opening_bars:
            raise ValueError("Opening bars list cannot be empty.")

        # Compute Opening Range High and Low
        or_high = max(b.high for b in opening_bars)
        or_low = min(b.low for b in opening_bars)
        or_span = max(1e-4, or_high - or_low)

        # Compute Toby Crabel Stretch
        stretch = 0.0
        if historical_sessions:
            stretch = self.calculate_crabel_stretch(historical_sessions)
        else:
            # Fallback: 15% of opening range span
            stretch = 0.15 * or_span

        # Define dynamic breakout triggers
        bull_trigger = or_high + (self.stretch_multiplier * stretch)
        bear_trigger = or_low - (self.stretch_multiplier * stretch)

        # Volume expansion ratio
        effective_avg_vol = max(1.0, average_bar_volume)
        vol_ratio = current_bar.volume / effective_avg_vol

        # Candle Wick Ratio calculation
        candle_total_range = max(1e-4, current_bar.high - current_bar.low)
        p_close = current_bar.close

        # Wick ratio depends on whether testing upside or downside
        if current_bar.high > or_high and p_close < or_high:
            # Upper wick rejection (Bull trap)
            wick_ratio = (current_bar.high - max(current_bar.open, p_close)) / candle_total_range
        elif current_bar.low < or_low and p_close > or_low:
            # Lower wick rejection (Bear trap)
            wick_ratio = (min(current_bar.open, p_close) - current_bar.low) / candle_total_range
        else:
            wick_ratio = 0.0

        # Regime & Directive Determination
        is_volume_confirmed = vol_ratio >= self.volume_expansion_hurdle
        is_wick_rejected = wick_ratio >= self.wick_rejection_threshold

        t1 = 0.0
        t2 = 0.0
        stop_loss = 0.0

        if current_bar.high > bull_trigger:
            if is_wick_rejected or (not is_volume_confirmed and p_close <= or_high):
                regime = "FALSE_BREAKOUT_BULL_TRAP"
                trade_directive = "FADE_FALSE_BREAKOUT_SHORT"
                stop_loss = current_bar.high + 0.10 * or_span
                t1 = or_high - 0.50 * or_span
                t2 = or_low
            elif is_volume_confirmed and p_close >= bull_trigger:
                regime = "BULLISH_ORB_EXPANSION_CONFIRMED"
                trade_directive = "BUY_ORB_BREAKOUT_EXPANSION"
                stop_loss = or_high - (0.35 * or_span)
                t1 = or_high + (1.0 * or_span)
                t2 = or_high + (2.0 * or_span)
            else:
                regime = "MARGINAL_BULLISH_BREAKOUT_UNCONFIRMED"
                trade_directive = "WAIT_FOR_EXPANSION_CONFIRMATION"
                stop_loss = (or_high + or_low) / 2.0
                t1 = or_high + (0.5 * or_span)
                t2 = or_high + (1.0 * or_span)

        elif current_bar.low < bear_trigger:
            if is_wick_rejected or (not is_volume_confirmed and p_close >= or_low):
                regime = "FALSE_BREAKOUT_BEAR_TRAP"
                trade_directive = "FADE_FALSE_BREAKDOWN_LONG"
                stop_loss = current_bar.low - 0.10 * or_span
                t1 = or_low + 0.50 * or_span
                t2 = or_high
            elif is_volume_confirmed and p_close <= bear_trigger:
                regime = "BEARISH_ORB_BREAKDOWN_CONFIRMED"
                trade_directive = "SELL_ORB_BREAKDOWN_EXPANSION"
                stop_loss = or_low + (0.35 * or_span)
                t1 = or_low - (1.0 * or_span)
                t2 = or_low - (2.0 * or_span)
            else:
                regime = "MARGINAL_BEARISH_BREAKDOWN_UNCONFIRMED"
                trade_directive = "WAIT_FOR_EXPANSION_CONFIRMATION"
                stop_loss = (or_high + or_low) / 2.0
                t1 = or_low - (0.5 * or_span)
                t2 = or_low - (1.0 * or_span)

        else:
            regime = "IN_RANGE_CONSOLIDATION"
            trade_directive = "STAND_ASIDE_INITIAL_BALANCE"
            stop_loss = or_low
            t1 = (or_high + or_low) / 2.0
            t2 = or_high

        report = ORBAnalysisReport(
            symbol=symbol,
            or_high=round(or_high, 2),
            or_low=round(or_low, 2),
            or_span=round(or_span, 2),
            stretch=round(stretch, 2),
            bull_trigger=round(bull_trigger, 2),
            bear_trigger=round(bear_trigger, 2),
            current_price=round(p_close, 2),
            volume_expansion_ratio=round(vol_ratio, 2),
            wick_ratio=round(wick_ratio, 3),
            regime=regime,
            trade_directive=trade_directive,
            target_1=round(t1, 2),
            target_2=round(t2, 2),
            stop_loss=round(stop_loss, 2),
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, report: ORBAnalysisReport) -> None:
        """Persists audit record to SQLite database."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO orb_telemetry (
                timestamp, symbol, or_high, or_low, or_span, stretch,
                bull_trigger, bear_trigger, current_price, volume_ratio,
                wick_ratio, regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report.timestamp,
                report.symbol,
                report.or_high,
                report.or_low,
                report.or_span,
                report.stretch,
                report.bull_trigger,
                report.bear_trigger,
                report.current_price,
                report.volume_expansion_ratio,
                report.wick_ratio,
                report.regime,
                report.trade_directive,
            ),
        )
        conn.commit()
