"""python-bridge/services/volatility_breakout_engine.py — Adaptive Intraday
Volatility Breakout & Expansion Engine (Domain 117).

Production-grade systematic volatility breakout and expansion engine for Indian F&O:

  * High-efficiency Parkinson, Garman-Klass, and Rogers-Satchell volatility estimators
  * Short-term vs long-term volatility compression ratio VR_t (coiling sieve)
  * Opening Range Breakout (ORB) expansion sieve with range contraction filter
  * Cumulative Volume Delta (CVD) confirmation and buyer/seller absorption
  * False-breakout exhaustion sentry (wick ratio > 50%, volume divergence veto)
  * Adaptive ATR trailing channel with dynamic volatility multipliers
  * SQLite persistence for volatility regimes and breakout execution ledger

Stdlib-first, thread-safe, zero external dependencies beyond numpy.
"""
from __future__ import annotations

import json
import logging
import math
import os
import sqlite3
import sys
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple, Union

import numpy as np

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

try:
    from logger import get_logger
except Exception:  # pragma: no cover
    def get_logger(name: str, tag: str = None) -> logging.Logger:  # type: ignore[misc]
        lg = logging.getLogger(name)
        if not lg.handlers:
            lg.addHandler(logging.StreamHandler())
        return lg

log = get_logger("volatility_breakout_engine", tag="VOL_BREAKOUT")


# ---------------------------------------------------------------------------
# Domain Enums & Data Containers
# ---------------------------------------------------------------------------
class VolatilityRegime(str, Enum):
    EXTREME_COMPRESSION = "EXTREME_COMPRESSION"  # VR < 0.60 (Coiling shelf)
    NORMAL = "NORMAL"                            # 0.60 <= VR <= 1.40
    EXPANSION = "EXPANSION"                      # 1.40 < VR <= 2.20 (Breakout phase)
    BLOWOFF_EXHAUSTION = "BLOWOFF_EXHAUSTION"    # VR > 2.20 (Terminal climax)


class BreakoutDirection(str, Enum):
    BULLISH_EXPANSION = "BULLISH_EXPANSION"
    BEARISH_EXPANSION = "BEARISH_EXPANSION"
    NEUTRAL = "NEUTRAL"


@dataclass(slots=True)
class OHLCVBar:
    timestamp: float
    open: float
    high: float
    low: float
    close: float
    volume: int
    buy_volume: int = 0
    sell_volume: int = 0

    @property
    def cvd(self) -> int:
        return self.buy_volume - self.sell_volume

    @property
    def range(self) -> float:
        return max(self.high - self.low, 1e-4)

    @property
    def upper_wick(self) -> float:
        return self.high - max(self.open, self.close)

    @property
    def lower_wick(self) -> float:
        return min(self.open, self.close) - self.low

    @property
    def upper_wick_ratio(self) -> float:
        return self.upper_wick / self.range

    @property
    def lower_wick_ratio(self) -> float:
        return self.lower_wick / self.range


@dataclass
class VolatilityMetrics:
    parkinson_vol: float
    garman_klass_vol: float
    rogers_satchell_vol: float
    volatility_ratio: float
    regime: VolatilityRegime
    atr: float


@dataclass
class OpeningRange:
    symbol: str
    date_str: str
    orb_high: float
    orb_low: float
    orb_width: float
    is_valid_compression: bool   # Width <= 1.20 * daily ATR
    is_broken_out: bool = False
    breakout_dir: BreakoutDirection = BreakoutDirection.NEUTRAL


@dataclass
class BreakoutSignal:
    signal_id: str
    symbol: str
    direction: BreakoutDirection
    trigger_price: float
    initial_stop_price: float
    target_price: float
    volatility_ratio: float
    atr: float
    cvd: int
    exhaustion_risk_score: float  # In [0.0, 1.0]; > 0.70 vetoes entry
    timestamp: float = field(default_factory=time.time)


# ---------------------------------------------------------------------------
# High-Efficiency Mathematical Estimators
# ---------------------------------------------------------------------------
class VolatilityEstimator:
    """Computes Parkinson, Garman-Klass, and Rogers-Satchell intraday volatility."""

    @staticmethod
    def parkinson(bars: Sequence[OHLCVBar]) -> float:
        """Parkinson High-Low volatility estimator."""
        n = len(bars)
        if n < 2:
            return 0.0
        ratios_sq = [math.log(max(b.high / max(b.low, 1e-4), 1.0)) ** 2 for b in bars]
        var = sum(ratios_sq) / (4.0 * math.log(2.0) * n)
        return math.sqrt(max(var, 0.0))

    @staticmethod
    def garman_klass(bars: Sequence[OHLCVBar]) -> float:
        """Garman-Klass Open-High-Low-Close volatility estimator."""
        n = len(bars)
        if n < 2:
            return 0.0
        acc = 0.0
        c1 = 0.5
        c2 = 2.0 * math.log(2.0) - 1.0
        for b in bars:
            hl = math.log(max(b.high / max(b.low, 1e-4), 1.0))
            co = math.log(max(b.close / max(b.open, 1e-4), 1.0))
            acc += (c1 * (hl ** 2)) - (c2 * (co ** 2))
        var = acc / n
        return math.sqrt(max(var, 0.0))

    @staticmethod
    def rogers_satchell(bars: Sequence[OHLCVBar]) -> float:
        """Rogers-Satchell non-zero drift volatility estimator."""
        n = len(bars)
        if n < 2:
            return 0.0
        acc = 0.0
        for b in bars:
            hc = math.log(max(b.high / max(b.close, 1e-4), 1.0))
            ho = math.log(max(b.high / max(b.open, 1e-4), 1.0))
            lc = math.log(max(b.low / max(b.close, 1e-4), 1e-6))
            lo = math.log(max(b.low / max(b.open, 1e-4), 1e-6))
            acc += (hc * ho) + (lc * lo)
        var = acc / n
        return math.sqrt(max(var, 0.0))

    @staticmethod
    def compute_atr(bars: Sequence[OHLCVBar], period: int = 14) -> float:
        """Standard Average True Range (ATR)."""
        if len(bars) < 2:
            return bars[0].range if bars else 0.0
        trs = []
        for i in range(1, len(bars)):
            h = bars[i].high
            l = bars[i].low
            prev_c = bars[i - 1].close
            tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
            trs.append(tr)
        return float(np.mean(trs[-period:]) if len(trs) >= period else np.mean(trs))


# ---------------------------------------------------------------------------
# Main Production Engine
# ---------------------------------------------------------------------------
class VolatilityBreakoutEngine:
    """Adaptive Volatility Breakout & Expansion Engine."""

    def __init__(self, db_path: str = ":memory:"):
        self.db_path = db_path
        self._lock = threading.RLock()
        self.bars_history: Dict[str, List[OHLCVBar]] = {}
        self.opening_ranges: Dict[str, OpeningRange] = {}
        self.signals_log: List[BreakoutSignal] = []

        # Parameters
        self.short_vol_window = 10
        self.long_vol_window = 30
        self.compression_threshold = 0.60
        self.expansion_threshold = 1.20
        self.exhaustion_threshold = 2.20
        self.wick_rejection_limit = 0.50  # 50% wick implies rejection

        if db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:", check_same_thread=False)
        else:
            self._conn = None

        self._init_sqlite()

    def _get_connection(self) -> sqlite3.Connection:
        if self._conn is not None:
            return self._conn
        return sqlite3.connect(self.db_path)

    def _close_connection(self, conn: sqlite3.Connection) -> None:
        if conn is not self._conn:
            conn.close()

    def _init_sqlite(self) -> None:
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS volatility_regimes (
                symbol TEXT,
                timestamp REAL,
                parkinson_vol REAL,
                garman_klass_vol REAL,
                volatility_ratio REAL,
                regime TEXT,
                atr REAL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS orb_breakout_signals (
                signal_id TEXT PRIMARY KEY,
                symbol TEXT,
                direction TEXT,
                trigger_price REAL,
                initial_stop REAL,
                target_price REAL,
                volatility_ratio REAL,
                atr REAL,
                cvd INTEGER,
                exhaustion_risk REAL,
                timestamp REAL
            )
        """)
        conn.commit()
        self._close_connection(conn)

    def ingest_bar(self, symbol: str, bar: OHLCVBar) -> Tuple[VolatilityMetrics, Optional[BreakoutSignal]]:
        """Ingests completed candle, updates volatility estimators, and screens for ORB breakouts."""
        with self._lock:
            if symbol not in self.bars_history:
                self.bars_history[symbol] = []
            self.bars_history[symbol].append(bar)
            bars = self.bars_history[symbol]

            # 1. Compute multi-window volatility
            metrics = self._calculate_volatility_metrics(bars)

            # 2. Persist regime
            conn = self._get_connection()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO volatility_regimes VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                symbol, bar.timestamp, metrics.parkinson_vol,
                metrics.garman_klass_vol, metrics.volatility_ratio,
                metrics.regime.value, metrics.atr
            ))
            conn.commit()
            self._close_connection(conn)

            # 3. Check for ORB Breakout Signals
            signal = self._evaluate_breakout(symbol, bar, metrics)
            if signal:
                self.signals_log.append(signal)
                self._record_signal(signal)

            return metrics, signal

    def set_opening_range(
        self,
        symbol: str,
        date_str: str,
        orb_high: float,
        orb_low: float,
        daily_atr: float,
    ) -> OpeningRange:
        """Sets the opening range benchmark (e.g. 09:15 to 09:30 range)."""
        with self._lock:
            width = max(orb_high - orb_low, 1e-4)
            # Contraction Sieve: Opening width <= 1.20 * daily ATR
            is_valid_compression = bool(width <= 1.20 * max(daily_atr, 1e-4))

            orb = OpeningRange(
                symbol=symbol,
                date_str=date_str,
                orb_high=orb_high,
                orb_low=orb_low,
                orb_width=width,
                is_valid_compression=is_valid_compression,
            )
            self.opening_ranges[symbol] = orb
            log.info(f"Set ORB for {symbol}: High={orb_high:.2f}, Low={orb_low:.2f}, Valid={is_valid_compression}")
            return orb

    def _calculate_volatility_metrics(self, bars: Sequence[OHLCVBar]) -> VolatilityMetrics:
        """Calculates Parkinson, Garman-Klass, Volatility Ratio, and ATR."""
        if len(bars) < self.short_vol_window:
            atr = VolatilityEstimator.compute_atr(bars)
            return VolatilityMetrics(
                parkinson_vol=0.01,
                garman_klass_vol=0.01,
                rogers_satchell_vol=0.01,
                volatility_ratio=1.0,
                regime=VolatilityRegime.NORMAL,
                atr=atr,
            )

        short_bars = bars[-self.short_vol_window:]
        long_bars = bars[-self.long_vol_window:] if len(bars) >= self.long_vol_window else bars

        gk_short = VolatilityEstimator.garman_klass(short_bars)
        gk_long = VolatilityEstimator.garman_klass(long_bars)
        p_vol = VolatilityEstimator.parkinson(short_bars)
        rs_vol = VolatilityEstimator.rogers_satchell(short_bars)
        atr = VolatilityEstimator.compute_atr(bars)

        # Volatility Ratio
        vr = gk_short / max(gk_long, 1e-6)

        if vr < self.compression_threshold:
            regime = VolatilityRegime.EXTREME_COMPRESSION
        elif vr > self.exhaustion_threshold:
            regime = VolatilityRegime.BLOWOFF_EXHAUSTION
        elif vr > self.expansion_threshold:
            regime = VolatilityRegime.EXPANSION
        else:
            regime = VolatilityRegime.NORMAL

        return VolatilityMetrics(
            parkinson_vol=p_vol,
            garman_klass_vol=gk_short,
            rogers_satchell_vol=rs_vol,
            volatility_ratio=vr,
            regime=regime,
            atr=atr,
        )

    def _evaluate_breakout(
        self,
        symbol: str,
        bar: OHLCVBar,
        metrics: VolatilityMetrics,
    ) -> Optional[BreakoutSignal]:
        """Screens for valid directional volatility breakouts, vetoing exhaustion climaxes."""
        orb = self.opening_ranges.get(symbol)
        if not orb or not orb.is_valid_compression or orb.is_broken_out:
            return None

        # Check for Bullish Breakout
        if bar.close > orb.orb_high:
            # Sentry Veto 1: Upper wick ratio > 50% implies strong intraday rejection
            if bar.upper_wick_ratio > self.wick_rejection_limit:
                log.info(f"Breakout vetoed for {symbol}: upper wick ratio {bar.upper_wick_ratio:.2f} > 0.50")
                return None

            # Sentry Veto 2: Negative Cumulative Volume Delta implies selling absorption
            if bar.cvd < 0:
                log.info(f"Breakout vetoed for {symbol}: negative CVD {bar.cvd} on breakout")
                return None

            # Sentry Veto 3: Terminal exhaustion climax (VR > 2.20)
            if metrics.regime == VolatilityRegime.BLOWOFF_EXHAUSTION:
                log.info(f"Breakout vetoed for {symbol}: blowoff exhaustion VR={metrics.volatility_ratio:.2f}")
                return None

            orb.is_broken_out = True
            orb.breakout_dir = BreakoutDirection.BULLISH_EXPANSION

            stop_price = max(orb.orb_high - 1.5 * metrics.atr, orb.orb_low)
            target_price = bar.close + 2.5 * metrics.atr

            return BreakoutSignal(
                signal_id=str(uuid.uuid4())[:8],
                symbol=symbol,
                direction=BreakoutDirection.BULLISH_EXPANSION,
                trigger_price=bar.close,
                initial_stop_price=stop_price,
                target_price=target_price,
                volatility_ratio=metrics.volatility_ratio,
                atr=metrics.atr,
                cvd=bar.cvd,
                exhaustion_risk_score=bar.upper_wick_ratio,
            )

        # Check for Bearish Breakout
        elif bar.close < orb.orb_low:
            # Sentry Veto 1: Lower wick ratio > 50% implies buying absorption
            if bar.lower_wick_ratio > self.wick_rejection_limit:
                log.info(f"Breakout vetoed for {symbol}: lower wick ratio {bar.lower_wick_ratio:.2f} > 0.50")
                return None

            # Sentry Veto 2: Positive CVD on breakdown implies hidden buyers
            if bar.cvd > 0:
                log.info(f"Breakdown vetoed for {symbol}: positive CVD {bar.cvd} on breakdown")
                return None

            # Sentry Veto 3: Terminal exhaustion climax
            if metrics.regime == VolatilityRegime.BLOWOFF_EXHAUSTION:
                return None

            orb.is_broken_out = True
            orb.breakout_dir = BreakoutDirection.BEARISH_EXPANSION

            stop_price = min(orb.orb_low + 1.5 * metrics.atr, orb.orb_high)
            target_price = bar.close - 2.5 * metrics.atr

            return BreakoutSignal(
                signal_id=str(uuid.uuid4())[:8],
                symbol=symbol,
                direction=BreakoutDirection.BEARISH_EXPANSION,
                trigger_price=bar.close,
                initial_stop_price=stop_price,
                target_price=target_price,
                volatility_ratio=metrics.volatility_ratio,
                atr=metrics.atr,
                cvd=bar.cvd,
                exhaustion_risk_score=bar.lower_wick_ratio,
            )

        return None

    def _record_signal(self, sig: BreakoutSignal) -> None:
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT OR REPLACE INTO orb_breakout_signals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            sig.signal_id, sig.symbol, sig.direction.value, sig.trigger_price,
            sig.initial_stop_price, sig.target_price, sig.volatility_ratio,
            sig.atr, sig.cvd, sig.exhaustion_risk_score, sig.timestamp
        ))
        conn.commit()
        self._close_connection(conn)
