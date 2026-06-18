"""python-bridge/services/max_pain_pinning_engine.py — Dynamic Cross-Strike
Pinning & Max Pain Surface Engine (Domain 118).

Production-grade systematic Option Max Pain and Dealer Gamma Pinning Engine for Indian F&O:

  * Real-time Option Max Pain calculation min_S CashLoss(S) across option chains
  * Strike-level dealer Gamma Exposure (GEX) profile and Gamma Flip boundary
  * Expiry-day strike pinning probability index P_pin in [0.0, 1.0]
  * Intraday Max Pain drift velocity v_pain = d(Pain)/dt tracking institutional unwinds
  * Negative Gamma Squeeze breakout trigger (dealer hedging cascade detector)
  * SQLite persistence for option pain surfaces and strike pinning alerts

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

log = get_logger("max_pain_pinning_engine", tag="MAX_PAIN")


# ---------------------------------------------------------------------------
# Domain Enums & Data Containers
# ---------------------------------------------------------------------------
class GammaRegime(str, Enum):
    POSITIVE_GAMMA_PINNED = "POSITIVE_GAMMA_PINNED"  # Dealers long gamma: volatility dampened
    GAMMA_FLIP_TRANSITION = "GAMMA_FLIP_TRANSITION"  # Near zero gamma flip line
    NEGATIVE_GAMMA_SQUEEZE = "NEGATIVE_GAMMA_SQUEEZE"# Dealers short gamma: explosive volatility


class PinningState(str, Enum):
    PINNED_TO_PAIN = "PINNED_TO_PAIN"               # |S - MaxPain| <= 0.5 * ATR
    MIGRATING_PAIN = "MIGRATING_PAIN"               # Pain velocity > 0.5 strike/hr
    SQUEEZE_BREAKOUT = "SQUEEZE_BREAKOUT"           # Price outside gamma wall in negative gamma


@dataclass(slots=True)
class OptionStrikeRecord:
    strike: float
    call_oi: int
    put_oi: int
    call_volume: int = 0
    put_volume: int = 0
    call_iv: float = 0.15
    put_iv: float = 0.15
    call_ltp: float = 0.0
    put_ltp: float = 0.0


@dataclass
class MaxPainResult:
    symbol: str
    underlying_price: float
    max_pain_strike: float
    pain_distance_pts: float
    pain_distance_pct: float
    total_market_loss_inr: float
    call_put_oi_ratio: float
    timestamp: float = field(default_factory=time.time)


@dataclass
class GEXProfile:
    symbol: str
    net_gex_crores: float
    gamma_flip_strike: float
    call_gamma_wall: float
    put_gamma_wall: float
    gamma_regime: GammaRegime
    pinning_probability: float  # In [0.0, 1.0]


@dataclass
class PinningAlert:
    alert_id: str
    symbol: str
    state: PinningState
    underlying_price: float
    max_pain_strike: float
    pinning_probability: float
    drift_velocity_pts_hr: float
    details: str
    timestamp: float = field(default_factory=time.time)


# ---------------------------------------------------------------------------
# High-Efficiency Quant Math
# ---------------------------------------------------------------------------
class BlackScholesGamma:
    """Standard Black-Scholes gamma calculation: Gamma = N'(d1) / (S * sigma * sqrt(T))."""

    @staticmethod
    def norm_pdf(x: float) -> float:
        return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)

    @classmethod
    def gamma(cls, spot: float, strike: float, time_to_expiry_years: float, iv: float, rate: float = 0.07) -> float:
        if spot <= 0 or strike <= 0 or time_to_expiry_years <= 0 or iv <= 0:
            return 0.0
        t = max(time_to_expiry_years, 1.0 / 365.0)
        d1 = (math.log(spot / strike) + (rate + 0.5 * iv * iv) * t) / (iv * math.sqrt(t))
        return cls.norm_pdf(d1) / (spot * iv * math.sqrt(t))


# ---------------------------------------------------------------------------
# Main Production Engine
# ---------------------------------------------------------------------------
class MaxPainPinningEngine:
    """Dynamic Cross-Strike Pinning & Max Pain Surface Engine."""

    def __init__(self, db_path: str = ":memory:"):
        self.db_path = db_path
        self._lock = threading.RLock()
        self.pain_history: Dict[str, List[Tuple[float, float]]] = {}  # (ts, max_pain_strike)
        self.alerts_log: List[PinningAlert] = []

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
            CREATE TABLE IF NOT EXISTS max_pain_snapshots (
                symbol TEXT,
                timestamp REAL,
                spot REAL,
                max_pain REAL,
                pain_distance REAL,
                total_loss REAL,
                pcr_oi REAL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS pinning_alerts (
                alert_id TEXT PRIMARY KEY,
                symbol TEXT,
                state TEXT,
                spot REAL,
                max_pain REAL,
                pinning_prob REAL,
                drift_velocity REAL,
                details TEXT,
                timestamp REAL
            )
        """)
        conn.commit()
        self._close_connection(conn)

    def compute_max_pain(
        self,
        symbol: str,
        spot: float,
        chain: Sequence[OptionStrikeRecord],
    ) -> MaxPainResult:
        """Calculates exact Option Max Pain strike and cash loss distribution."""
        with self._lock:
            strikes = [r.strike for r in chain]
            if not strikes:
                return MaxPainResult(symbol, spot, spot, 0.0, 0.0, 0.0, 1.0)

            # Evaluate cumulative option buyer payout across all hypothetical settlement strikes
            min_loss = float("inf")
            best_strike = spot
            total_call_oi = sum(r.call_oi for r in chain)
            total_put_oi = sum(r.put_oi for r in chain)

            for test_s in strikes:
                loss = 0.0
                for r in chain:
                    # In-the-money call payout
                    if test_s > r.strike:
                        loss += (test_s - r.strike) * r.call_oi
                    # In-the-money put payout
                    elif test_s < r.strike:
                        loss += (r.strike - test_s) * r.put_oi

                if loss < min_loss:
                    min_loss = loss
                    best_strike = test_s

            pcr = (total_put_oi / max(total_call_oi, 1)) if total_call_oi > 0 else 1.0
            dist_pts = spot - best_strike
            dist_pct = (dist_pts / best_strike) * 100.0 if best_strike > 0 else 0.0

            result = MaxPainResult(
                symbol=symbol,
                underlying_price=spot,
                max_pain_strike=best_strike,
                pain_distance_pts=dist_pts,
                pain_distance_pct=dist_pct,
                total_market_loss_inr=min_loss,
                call_put_oi_ratio=pcr,
            )

            # Track drift history
            if symbol not in self.pain_history:
                self.pain_history[symbol] = []
            self.pain_history[symbol].append((time.time(), best_strike))

            # Persist snapshot
            conn = self._get_connection()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO max_pain_snapshots VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (symbol, result.timestamp, spot, best_strike, dist_pts, min_loss, pcr))
            conn.commit()
            self._close_connection(conn)

            return result

    def compute_gex_profile(
        self,
        symbol: str,
        spot: float,
        chain: Sequence[OptionStrikeRecord],
        time_to_expiry_days: float = 1.0,
    ) -> GEXProfile:
        """Computes Dealer Gamma Exposure, Gamma Walls, and Pinning Probability."""
        with self._lock:
            t_years = max(time_to_expiry_days / 365.0, 1.0 / (365.0 * 6.25))  # Minimum 1 hour
            total_net_gex = 0.0
            strike_gex: Dict[float, float] = {}

            max_call_oi = -1
            call_wall = spot
            max_put_oi = -1
            put_wall = spot

            for r in chain:
                # Track walls by pure OI concentration
                if r.call_oi > max_call_oi:
                    max_call_oi = r.call_oi
                    call_wall = r.strike
                if r.put_oi > max_put_oi:
                    max_put_oi = r.put_oi
                    put_wall = r.strike

                # Dealer Gamma: Call GEX (dealers long call = long gamma), Put GEX (dealers short put = short gamma)
                gamma_c = BlackScholesGamma.gamma(spot, r.strike, t_years, r.call_iv)
                gamma_p = BlackScholesGamma.gamma(spot, r.strike, t_years, r.put_iv)

                # Notional GEX in Crores (₹1 Cr = 1e7): Spot * Gamma * OI * LotSize(e.g. 50)
                gex_k = (r.call_oi * gamma_c - r.put_oi * gamma_p) * spot * spot * 0.01 / 1e7
                strike_gex[r.strike] = gex_k
                total_net_gex += gex_k

            # Find Gamma Flip strike (where cumulative GEX changes sign)
            sorted_strikes = sorted(strike_gex.keys())
            flip_strike = spot
            for i in range(len(sorted_strikes) - 1):
                s1, s2 = sorted_strikes[i], sorted_strikes[i + 1]
                if (strike_gex[s1] < 0 and strike_gex[s2] > 0) or (strike_gex[s1] > 0 and strike_gex[s2] < 0):
                    flip_strike = (s1 + s2) / 2.0
                    break

            # Classify Gamma Regime
            if total_net_gex > 5.0:
                regime = GammaRegime.POSITIVE_GAMMA_PINNED
            elif total_net_gex < -5.0:
                regime = GammaRegime.NEGATIVE_GAMMA_SQUEEZE
            else:
                regime = GammaRegime.GAMMA_FLIP_TRANSITION

            # Pinning Probability Index P_pin
            # High when NetGEX > 0, T is small, and Spot is close to Call/Put Wall midpoint
            gex_factor = 1.0 / (1.0 + math.exp(-0.2 * total_net_gex)) if abs(total_net_gex) < 50 else (1.0 if total_net_gex > 0 else 0.0)
            time_factor = math.exp(-0.5 * time_to_expiry_days)  # Strongest on 0-DTE
            pin_prob = float(min(1.0, max(0.0, gex_factor * time_factor * 1.2)))

            return GEXProfile(
                symbol=symbol,
                net_gex_crores=round(total_net_gex, 2),
                gamma_flip_strike=flip_strike,
                call_gamma_wall=call_wall,
                put_gamma_wall=put_wall,
                gamma_regime=regime,
                pinning_probability=round(pin_prob, 3),
            )

    def evaluate_pinning_alerts(
        self,
        symbol: str,
        spot: float,
        pain_result: MaxPainResult,
        gex_profile: GEXProfile,
        atr_14: float = 100.0,
    ) -> Optional[PinningAlert]:
        """Evaluates whether the underlying is pinned, migrating, or initiating a gamma squeeze."""
        with self._lock:
            # 1. Calculate Max Pain Drift Velocity (points/hr)
            v_pain = 0.0
            history = self.pain_history.get(symbol, [])
            if len(history) >= 2:
                t_prev, p_prev = history[0]
                t_curr, p_curr = history[-1]
                dt_hrs = (t_curr - t_prev) / 3600.0
                if dt_hrs > 0.01:
                    v_pain = (p_curr - p_prev) / dt_hrs

            dist = abs(spot - pain_result.max_pain_strike)
            alert = None

            # Scenario A: Negative Gamma Squeeze Breakout
            if gex_profile.gamma_regime == GammaRegime.NEGATIVE_GAMMA_SQUEEZE:
                if spot > gex_profile.call_gamma_wall or spot < gex_profile.put_gamma_wall:
                    alert = PinningAlert(
                        alert_id=str(uuid.uuid4())[:8],
                        symbol=symbol,
                        state=PinningState.SQUEEZE_BREAKOUT,
                        underlying_price=spot,
                        max_pain_strike=pain_result.max_pain_strike,
                        pinning_probability=gex_profile.pinning_probability,
                        drift_velocity_pts_hr=v_pain,
                        details=f"Gamma squeeze active: Spot breached wall {gex_profile.call_gamma_wall} in negative gamma {gex_profile.net_gex_crores}Cr",
                    )

            # Scenario B: High Pinning Probability (|S - MaxPain| <= 0.5 * ATR)
            elif gex_profile.pinning_probability >= 0.60 and dist <= 0.50 * atr_14:
                alert = PinningAlert(
                    alert_id=str(uuid.uuid4())[:8],
                    symbol=symbol,
                    state=PinningState.PINNED_TO_PAIN,
                    underlying_price=spot,
                    max_pain_strike=pain_result.max_pain_strike,
                    pinning_probability=gex_profile.pinning_probability,
                    drift_velocity_pts_hr=v_pain,
                    details=f"Underlying pinned to Max Pain strike {pain_result.max_pain_strike} (dist {dist:.1f}pts <= 0.5*ATR)",
                )

            # Scenario C: Rapid Pain Migration
            elif abs(v_pain) >= 30.0:  # Moving faster than 30 pts/hr
                alert = PinningAlert(
                    alert_id=str(uuid.uuid4())[:8],
                    symbol=symbol,
                    state=PinningState.MIGRATING_PAIN,
                    underlying_price=spot,
                    max_pain_strike=pain_result.max_pain_strike,
                    pinning_probability=gex_profile.pinning_probability,
                    drift_velocity_pts_hr=v_pain,
                    details=f"Max Pain migrating rapidly: velocity {v_pain:+.1f} pts/hr indicates writer liquidation",
                )

            if alert:
                self.alerts_log.append(alert)
                conn = self._get_connection()
                cur = conn.cursor()
                cur.execute("""
                    INSERT OR REPLACE INTO pinning_alerts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    alert.alert_id, alert.symbol, alert.state.value, alert.underlying_price,
                    alert.max_pain_strike, alert.pinning_probability, alert.drift_velocity_pts_hr,
                    alert.details, alert.timestamp
                ))
                conn.commit()
                self._close_connection(conn)

            return alert
