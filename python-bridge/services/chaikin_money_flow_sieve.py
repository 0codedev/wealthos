"""
Domain 153 (WP-BC): Multi-Timeframe Volume Accumulation-Distribution (A/D) Chaikin Money Flow Sieve

Implements Marc Chaikin's Accumulation/Distribution Line (ADL), rolling 20-period Chaikin
Money Flow (CMF), institutional stealth accumulation / distribution divergence detection,
and automated algorithmic order-flow classification.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import List, Optional


@dataclass
class BarData:
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class CMFAnalysisReport:
    symbol: str
    current_price: float
    price_change_pct: float
    mfm: float
    cmf: float
    adl: float
    adl_slope: float
    regime: str
    trade_directive: str
    confidence_score: float
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ChaikinMoneyFlowSieve:
    """
    Multi-Timeframe Chaikin Money Flow & Stealth Institutional Flow Sieve.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        cmf_period: int = 20,
        bullish_threshold: float = 0.12,
        bearish_threshold: float = -0.12,
    ):
        self.db_path = db_path
        self.cmf_period = cmf_period
        self.bullish_threshold = bullish_threshold
        self.bearish_threshold = bearish_threshold
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for CMF telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS chaikin_cmf_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                current_price REAL NOT NULL,
                price_change_pct REAL NOT NULL,
                mfm REAL NOT NULL,
                cmf REAL NOT NULL,
                adl REAL NOT NULL,
                adl_slope REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL,
                confidence REAL NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def calculate_mfm(high: float, low: float, close: float) -> float:
        """
        Money Flow Multiplier (MFM):
        MFM = [(Close - Low) - (High - Close)] / (High - Low)
            = (2 * Close - High - Low) / (High - Low)
        Range: [-1.0, 1.0]
        """
        spread = high - low
        if spread <= 1e-6:
            return 0.0
        mfm = (2.0 * close - high - low) / spread
        return max(-1.0, min(1.0, mfm))

    def evaluate_flow(self, symbol: str, bars: List[BarData]) -> CMFAnalysisReport:
        """
        Evaluates cumulative ADL, rolling CMF, and stealth divergence regimes.
        """
        if len(bars) < self.cmf_period:
            raise ValueError(f"Insufficient bars for CMF period {self.cmf_period}, got {len(bars)}")

        # Compute MFM and MFV across all bars
        mfm_list = []
        mfv_list = []
        vol_list = []
        adl_series = []
        current_adl = 0.0

        for b in bars:
            m = self.calculate_mfm(b.high, b.low, b.close)
            mfv = m * b.volume
            current_adl += mfv
            mfm_list.append(m)
            mfv_list.append(mfv)
            vol_list.append(b.volume)
            adl_series.append(current_adl)

        # Slice rolling window of length cmf_period
        window_mfv = mfv_list[-self.cmf_period :]
        window_vol = vol_list[-self.cmf_period :]
        total_vol = sum(window_vol)

        if total_vol <= 0:
            cmf = 0.0
        else:
            cmf = sum(window_mfv) / total_vol

        # Current bar metrics
        curr_bar = bars[-1]
        start_bar = bars[-self.cmf_period]
        price_change_pct = ((curr_bar.close - start_bar.close) / start_bar.close) * 100.0

        # ADL slope over the rolling window (end vs start)
        adl_start = adl_series[-self.cmf_period]
        adl_end = adl_series[-1]
        adl_slope = adl_end - adl_start

        # Detect Institutional Stealth Divergences
        latest_mfm = mfm_list[-1]

        # Confidence metric derived from CMF magnitude and volume confirmation
        confidence = min(1.0, abs(cmf) / 0.25)

        if cmf >= self.bullish_threshold:
            if price_change_pct <= 0.50:
                # Price is stagnant or dropping while institutional money is heavily accumulating!
                regime = "BULLISH_STEALTH_ACCUMULATION"
                trade_directive = "ACCUMULATE_LONG_STEALTH_FLOW"
                confidence = max(0.85, confidence)
            else:
                regime = "BULLISH_EXPANSION_CONFIRMED"
                trade_directive = "FOLLOW_MOMENTUM_LONG"
        elif cmf <= self.bearish_threshold:
            if price_change_pct >= -0.50:
                # Price is buoyant while institutional money is heavily dumping!
                regime = "BEARISH_STEALTH_DISTRIBUTION"
                trade_directive = "DISTRIBUTE_OR_SHORT_FLOW"
                confidence = max(0.85, confidence)
            else:
                regime = "BEARISH_BREAKDOWN_CONFIRMED"
                trade_directive = "FOLLOW_MOMENTUM_SHORT"
        else:
            regime = "NEUTRAL_VOLUME_EQUILIBRIUM"
            trade_directive = "MAINTAIN_NEUTRAL_POSITION"
            confidence = 0.30

        report = CMFAnalysisReport(
            symbol=symbol,
            current_price=round(curr_bar.close, 2),
            price_change_pct=round(price_change_pct, 2),
            mfm=round(latest_mfm, 4),
            cmf=round(cmf, 4),
            adl=round(current_adl, 2),
            adl_slope=round(adl_slope, 2),
            regime=regime,
            trade_directive=trade_directive,
            confidence_score=round(confidence, 3),
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, report: CMFAnalysisReport) -> None:
        """Persists audit record to SQLite database."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO chaikin_cmf_telemetry (
                timestamp, symbol, current_price, price_change_pct, mfm,
                cmf, adl, adl_slope, regime, directive, confidence
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report.timestamp,
                report.symbol,
                report.current_price,
                report.price_change_pct,
                report.mfm,
                report.cmf,
                report.adl,
                report.adl_slope,
                report.regime,
                report.trade_directive,
                report.confidence_score,
            ),
        )
        conn.commit()
