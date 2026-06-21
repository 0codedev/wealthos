r"""
Sovereign Macro Liquidity & RBI Net LAF Factor Transmission Engine (Domain 130 / WP-AF)
=======================================================================================

Autonomous sovereign macro factor and interbank liquidity transmission engine
monitoring the Reserve Bank of India (RBI) Liquidity Adjustment Facility (LAF) corridor,
Weighted Average Call Rate (WACR), and systemic banking liquidity transmission to
NIFTY and BANKNIFTY equity derivatives.

Mathematical Specifications:
-----------------------------
1. RBI Net LAF Liquidity Balance (in INR Lakh Crores):
   Let SDF be Standing Deposit Facility, VRRR be Variable Rate Reverse Repo,
   Repo be standard overnight repo, VRR be Variable Rate Repo, and MSF be Marginal Standing Facility:
       \text{NetLAF}_t = (\text{SDF}_t + \text{VRRR}_t) - (\text{Repo}_t + \text{VRR}_t + \text{MSF}_t)
   where \text{NetLAF} > 0 denotes systemic banking cash surplus (absorption by RBI),
   and \text{NetLAF} < 0 denotes systemic cash deficit (liquidity injection by RBI).

2. WACR Policy Corridor Spread:
   Policy corridor bounded by SDF (floor) and MSF (ceiling):
       SDF = R_{\text{repo}} - 0.25\%, \quad MSF = R_{\text{repo}} + 0.25\%
   Policy Spread:
       \Delta_{\text{WACR}} = \text{WACR}_t - R_{\text{repo}} \in [-0.25\%, +0.25\%]

3. Systemic Liquidity Indicator (SLI):
   Normalized multi-factor composite index:
       SLI_t = 0.50 \cdot Z(\text{NetLAF}_t) - 0.35 \cdot Z(\Delta_{\text{WACR}, t}) - 0.15 \cdot Z(\text{TREPS Spread}_t)

4. Macro Regimes & BANKNIFTY Positioning Sieve:
   - SLI_t \ge +1.0\sigma: 'LIQUIDITY_SURPLUS_EXPANSIVE' (Fuel for multi-week equity rallies; long bias)
   - -1.0\sigma < SLI_t < +1.0\sigma: 'LIQUIDITY_NEUTRAL_BALANCED' (Standard quantitative strategies)
   - SLI_t \le -1.0\sigma: 'LIQUIDITY_DEFICIT_CONTRACTION' (Tight money market conditions; tighten BANKNIFTY stops, cap long exposure)
"""

from dataclasses import dataclass, field
from datetime import datetime
import math
from typing import Dict, List, Optional, Tuple
import sqlite3


@dataclass
class LAFOperationsDaily:
    date_str: str  # YYYY-MM-DD
    policy_repo_rate_pct: float
    wacr_pct: float
    sdf_amount_lakh_cr: float
    vrrr_amount_lakh_cr: float
    repo_amount_lakh_cr: float
    vrr_amount_lakh_cr: float
    msf_amount_lakh_cr: float
    treps_rate_pct: float


@dataclass
class MacroLiquidityRegime:
    timestamp: datetime
    date_str: str
    net_laf_lakh_cr: float
    wacr_policy_spread_bps: float
    sli_z_score: float
    regime: str  # 'LIQUIDITY_SURPLUS_EXPANSIVE', 'LIQUIDITY_NEUTRAL_BALANCED', 'LIQUIDITY_DEFICIT_CONTRACTION'
    banknifty_bias: str  # 'AGGRESSIVE_BULLISH', 'NEUTRAL', 'DEFENSIVE_TIGHTEN_STOPS'
    recommended_leverage_multiplier: float
    rationale: str


class RBIMacroLiquidityEngine:
    """
    Sub-millisecond Sovereign Macro & Interbank Liquidity Transmission Engine.
    """

    def __init__(
        self,
        rolling_window_days: int = 30,
        sli_expansion_threshold: float = 1.0,
        sli_contraction_threshold: float = -1.0,
        db_path: str = ":memory:",
    ):
        self.rolling_window = rolling_window_days
        self.sli_expansion_threshold = sli_expansion_threshold
        self.sli_contraction_threshold = sli_contraction_threshold
        self.db_path = db_path

        self._history: List[Tuple[float, float, float]] = []  # (net_laf, wacr_spread, treps_spread)

        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            if self._conn is None:
                self._conn = sqlite3.connect(":memory:")
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS rbi_macro_liquidity_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                date_str TEXT NOT NULL,
                net_laf REAL NOT NULL,
                wacr_spread_bps REAL NOT NULL,
                sli_z_score REAL NOT NULL,
                regime TEXT NOT NULL,
                banknifty_bias TEXT NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def compute_net_laf_surplus(op: LAFOperationsDaily) -> float:
        """
        Computes Net LAF Liquidity Surplus/Deficit:
            NetLAF = (SDF + VRRR) - (Repo + VRR + MSF)
        Positive = Banking Cash Surplus (absorbed by RBI).
        Negative = Banking Cash Deficit (injected by RBI).
        """
        absorbed = op.sdf_amount_lakh_cr + op.vrrr_amount_lakh_cr
        injected = op.repo_amount_lakh_cr + op.vrr_amount_lakh_cr + op.msf_amount_lakh_cr
        return round(absorbed - injected, 4)

    @staticmethod
    def calculate_wacr_policy_spread_bps(wacr: float, repo: float) -> float:
        """
        Calculates spread of interbank call money rate (WACR) vs Policy Repo in basis points:
            Spread = (WACR - Repo) * 100 bps
        """
        return round((wacr - repo) * 100.0, 2)

    def assess_daily_operations(
        self,
        op: LAFOperationsDaily,
        timestamp: Optional[datetime] = None,
    ) -> MacroLiquidityRegime:
        """
        Processes a daily RBI operation report, updates rolling baseline, and classifies macro regime.
        """
        now = timestamp if timestamp is not None else datetime.utcnow()

        net_laf = self.compute_net_laf_surplus(op)
        wacr_spread_bps = self.calculate_wacr_policy_spread_bps(op.wacr_pct, op.policy_repo_rate_pct)
        treps_spread_bps = round((op.treps_rate_pct - op.policy_repo_rate_pct) * 100.0, 2)

        self._history.append((net_laf, wacr_spread_bps, treps_spread_bps))
        if len(self._history) > self.rolling_window * 2:
            self._history.pop(0)

        # Compute Z-Scores over rolling window
        if len(self._history) >= 5:
            laf_vals = [h[0] for h in self._history[-self.rolling_window:]]
            wacr_vals = [h[1] for h in self._history[-self.rolling_window:]]
            treps_vals = [h[2] for h in self._history[-self.rolling_window:]]

            def z_score(vals: List[float], x: float) -> float:
                m = sum(vals) / len(vals)
                v = sum((v_i - m) ** 2 for v_i in vals) / len(vals)
                s = math.sqrt(v) if v > 1e-6 else 1.0
                return (x - m) / s

            z_laf = z_score(laf_vals, net_laf)
            z_wacr = z_score(wacr_vals, wacr_spread_bps)
            z_treps = z_score(treps_vals, treps_spread_bps)

            # SLI = 0.50 * Z_LAF - 0.35 * Z_WACR - 0.15 * Z_TREPS
            sli = 0.50 * z_laf - 0.35 * z_wacr - 0.15 * z_treps
        else:
            # Prior based on direct level
            sli = net_laf * 1.5 - (wacr_spread_bps / 25.0)

        # Classify regime
        if sli >= self.sli_expansion_threshold:
            regime = 'LIQUIDITY_SURPLUS_EXPANSIVE'
            bias = 'AGGRESSIVE_BULLISH'
            mult = 1.25
            rationale = (
                f"Abundant systemic liquidity (Net LAF=+₹{net_laf:.2f}L Cr, SLI=+{sli:.2f}sigma). "
                f"Call rates trading near SDF floor. Bullish liquidity tailwind."
            )
        elif sli <= self.sli_contraction_threshold:
            regime = 'LIQUIDITY_DEFICIT_CONTRACTION'
            bias = 'DEFENSIVE_TIGHTEN_STOPS'
            mult = 0.70
            rationale = (
                f"Severe systemic deficit (Net LAF=₹{net_laf:.2f}L Cr, SLI={sli:.2f}sigma). "
                f"WACR spiked {wacr_spread_bps:+.1f}bps toward MSF. Tighten BANKNIFTY risk."
            )
        else:
            regime = 'LIQUIDITY_NEUTRAL_BALANCED'
            bias = 'NEUTRAL'
            mult = 1.0
            rationale = (
                f"Systemic liquidity in balanced corridor (Net LAF=₹{net_laf:.2f}L Cr, SLI={sli:.2f}sigma). "
                f"Standard execution parameters active."
            )

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO rbi_macro_liquidity_telemetry (
                timestamp, date_str, net_laf, wacr_spread_bps, sli_z_score, regime, banknifty_bias
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now.isoformat(),
                op.date_str,
                net_laf,
                wacr_spread_bps,
                round(sli, 2),
                regime,
                bias,
            )
        )
        conn.commit()

        return MacroLiquidityRegime(
            timestamp=now,
            date_str=op.date_str,
            net_laf_lakh_cr=net_laf,
            wacr_policy_spread_bps=wacr_spread_bps,
            sli_z_score=round(sli, 2),
            regime=regime,
            banknifty_bias=bias,
            recommended_leverage_multiplier=mult,
            rationale=rationale,
        )
