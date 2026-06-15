r"""
Institutional FII/DII Net Flow & Derivative Squeeze Predictor (Domain 131 / WP-AG)
===================================================================================

Autonomous institutional positioning surveillance and derivative squeeze prediction
engine analyzing Foreign Institutional Investors (FII), Domestic Institutional
Investors (DII), and proprietary participants across NSE cash and index futures.

Mathematical Formulations:
--------------------------
1. Participant Net Cash & Derivative Flow:
   Let FII_buy, FII_sell be cash turnovers in INR Crores:
       \text{FII}_{\text{net}} = \text{FII}_{\text{buy}} - \text{FII}_{\text{sell}}
       \text{DII}_{\text{net}} = \text{DII}_{\text{buy}} - \text{DII}_{\text{sell}}
       \text{TotalInst}_{\text{net}} = \text{FII}_{\text{net}} + \text{DII}_{\text{net}}

2. FII Index Futures Long-Short Ratio (LSR) & Percent Long:
       \text{LSR}_{\text{FII}} = \frac{\text{Long}_{\text{FII}}}{\max(\text{Short}_{\text{FII}}, 1)}
       \%\text{Long}_{\text{FII}} = \frac{\text{Long}_{\text{FII}}}{\text{Long}_{\text{FII}} + \text{Short}_{\text{FII}}} \times 100\%
       \text{NetOI}_{\text{FII}} = \text{Long}_{\text{FII}} - \text{Short}_{\text{FII}}

3. Positioning Asymmetry & Crowding Z-Score:
   Rolling N-day baseline of Net Open Interest:
       Z_{\text{crowd}} = \frac{\text{NetOI}_{\text{FII}, t} - \mu_N}{\sigma_N}
   - Z_{\text{crowd}} \le -2.0\sigma \lor \%\text{Long} \le 20\%: Coiled Short Squeeze setup.
   - Z_{\text{crowd}} \ge +2.0\sigma \lor \%\text{Long} \ge 80\%: Fragile Long Liquidation setup.

4. Intraday Afternoon Squeeze Probability P(Squeeze) (14:00 - 15:00 IST):
   Synthesizes macro crowding with intraday price action (VWAP displacement & CVD):
       P(\text{Squeeze}) = \text{clip}\left(0.30 + 0.20 \cdot |Z_{\text{crowd}}| \cdot \mathbf{1}_{\{Z \le -1.5\}} + 0.30 \cdot \mathbf{1}_{\{S_t > \text{VWAP}\}} + 0.20 \cdot \mathbf{1}_{\{\text{CVD} > 0\}}, 0.0, 1.0\right)
"""

from dataclasses import dataclass
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class DailyParticipantPositioning:
    date_str: str  # YYYY-MM-DD
    fii_cash_buy_cr: float
    fii_cash_sell_cr: float
    dii_cash_buy_cr: float
    dii_cash_sell_cr: float
    fii_index_futures_long: int
    fii_index_futures_short: int
    pro_index_futures_long: int
    pro_index_futures_short: int
    client_index_futures_long: int
    client_index_futures_short: int
    spot_close: float


@dataclass
class SqueezePredictorResult:
    timestamp: datetime
    date_str: str
    fii_net_cash_cr: float
    dii_net_cash_cr: float
    total_inst_net_cr: float
    fii_lsr: float
    fii_pct_long: float
    fii_net_oi: int
    crowding_z_score: float
    regime: str  # 'COILED_SHORT_SQUEEZE_SETUP', 'LONG_LIQUIDATION_VULNERABILITY', 'BALANCED_POSITIONING'
    squeeze_probability: float  # [0.0, 1.0]
    directional_recommendation: str  # 'CALL_SQUEEZE_UPSIDE_ASYMMETRY', 'PUT_HEDGE_RECOMMENDED', 'NEUTRAL'
    stop_adjustment_factor: float  # e.g., 0.60 to tighten short stops
    rationale: str


class FIIDIISqueezePredictor:
    """
    Sub-millisecond Institutional Flow & Derivative Squeeze Predictor Engine.
    """

    def __init__(
        self,
        rolling_window_days: int = 20,
        short_crowding_z_threshold: float = -1.8,
        long_crowding_z_threshold: float = 1.8,
        extreme_short_pct_threshold: float = 22.0,  # <= 22% FII Long
        extreme_long_pct_threshold: float = 78.0,   # >= 78% FII Long
        db_path: str = ":memory:",
    ):
        self.rolling_window = rolling_window_days
        self.short_z_threshold = short_crowding_z_threshold
        self.long_z_threshold = long_crowding_z_threshold
        self.extreme_short_pct = extreme_short_pct_threshold
        self.extreme_long_pct = extreme_long_pct_threshold
        self.db_path = db_path

        self._net_oi_history: List[int] = []
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
            CREATE TABLE IF NOT EXISTS fii_dii_positioning_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                date_str TEXT NOT NULL,
                fii_net_cash REAL NOT NULL,
                dii_net_cash REAL NOT NULL,
                fii_lsr REAL NOT NULL,
                fii_pct_long REAL NOT NULL,
                fii_net_oi INTEGER NOT NULL,
                crowding_z REAL NOT NULL,
                regime TEXT NOT NULL,
                squeeze_prob REAL NOT NULL,
                recommendation TEXT NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def calculate_cash_flows(pos: DailyParticipantPositioning) -> Tuple[float, float, float]:
        fii_net = round(pos.fii_cash_buy_cr - pos.fii_cash_sell_cr, 2)
        dii_net = round(pos.dii_cash_buy_cr - pos.dii_cash_sell_cr, 2)
        total_net = round(fii_net + dii_net, 2)
        return fii_net, dii_net, total_net

    @staticmethod
    def calculate_fii_derivative_ratios(long_c: int, short_c: int) -> Tuple[float, float, int]:
        total_c = long_c + short_c
        lsr = round(long_c / max(short_c, 1), 4)
        pct_long = round((long_c / max(total_c, 1)) * 100.0, 2)
        net_oi = long_c - short_c
        return lsr, pct_long, net_oi

    def assess_daily_positioning(
        self,
        pos: DailyParticipantPositioning,
        intraday_spot_above_vwap: bool = False,
        intraday_cvd_positive: bool = False,
        timestamp: Optional[datetime] = None,
    ) -> SqueezePredictorResult:
        now = timestamp if timestamp is not None else datetime.utcnow()

        fii_net, dii_net, total_net = self.calculate_cash_flows(pos)
        lsr, pct_long, net_oi = self.calculate_fii_derivative_ratios(
            pos.fii_index_futures_long, pos.fii_index_futures_short
        )

        self._net_oi_history.append(net_oi)
        if len(self._net_oi_history) > self.rolling_window * 2:
            self._net_oi_history.pop(0)

        # Compute Z-score of Net OI
        if len(self._net_oi_history) >= 5:
            recent_vals = self._net_oi_history[-self.rolling_window:]
            mean_oi = sum(recent_vals) / len(recent_vals)
            var_oi = sum((x - mean_oi) ** 2 for x in recent_vals) / len(recent_vals)
            std_oi = math.sqrt(var_oi) if var_oi > 1e-4 else 1000.0
            z_crowd = round((net_oi - mean_oi) / std_oi, 2)
        else:
            # Baseline prior based on percent long distance from 50%
            z_crowd = round((pct_long - 50.0) / 15.0, 2)

        # Regimes & Squeeze Probability
        if z_crowd <= self.short_z_threshold or pct_long <= self.extreme_short_pct:
            regime = "COILED_SHORT_SQUEEZE_SETUP"
            # Squeeze probability increases with intraday bullish confirmation
            base_prob = 0.55 + 0.15 * min(abs(z_crowd), 3.0) / 3.0
            if intraday_spot_above_vwap:
                base_prob += 0.18
            if intraday_cvd_positive:
                base_prob += 0.12
            squeeze_prob = round(min(base_prob, 0.98), 2)
            rec = "CALL_SQUEEZE_UPSIDE_ASYMMETRY"
            stop_adj = 0.50  # Strongly compress short stops (protect against gap squeezes)
            rationale = (
                f"FII Net OI heavily skewed short ({pct_long:.1f}% Long, Z={z_crowd:+.2f}sigma). "
                f"LSR={lsr:.2f}. Extreme one-sided bearish crowding creates explosive short squeeze vulnerability."
            )
        elif z_crowd >= self.long_z_threshold or pct_long >= self.extreme_long_pct:
            regime = "LONG_LIQUIDATION_VULNERABILITY"
            squeeze_prob = 0.05
            rec = "PUT_HEDGE_RECOMMENDED"
            stop_adj = 0.70  # Compress long stops
            rationale = (
                f"FII Net OI excessively crowded long ({pct_long:.1f}% Long, Z={z_crowd:+.2f}sigma). "
                f"LSR={lsr:.2f}. Market vulnerable to cascading liquidation if support breaks."
            )
        else:
            regime = "BALANCED_POSITIONING"
            squeeze_prob = 0.15
            rec = "NEUTRAL"
            stop_adj = 1.00
            rationale = (
                f"FII positioning in balanced zone ({pct_long:.1f}% Long, Z={z_crowd:+.2f}sigma, LSR={lsr:.2f}). "
                f"Net cash total: ₹{total_net:+.1f} Cr. Standard execution active."
            )

        # Persist to database
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO fii_dii_positioning_telemetry (
                timestamp, date_str, fii_net_cash, dii_net_cash, fii_lsr, fii_pct_long,
                fii_net_oi, crowding_z, regime, squeeze_prob, recommendation
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now.isoformat(),
                pos.date_str,
                fii_net,
                dii_net,
                lsr,
                pct_long,
                net_oi,
                z_crowd,
                regime,
                squeeze_prob,
                rec,
            ),
        )
        conn.commit()

        return SqueezePredictorResult(
            timestamp=now,
            date_str=pos.date_str,
            fii_net_cash_cr=fii_net,
            dii_net_cash_cr=dii_net,
            total_inst_net_cr=total_net,
            fii_lsr=lsr,
            fii_pct_long=pct_long,
            fii_net_oi=net_oi,
            crowding_z_score=z_crowd,
            regime=regime,
            squeeze_probability=squeeze_prob,
            directional_recommendation=rec,
            stop_adjustment_factor=stop_adj,
            rationale=rationale,
        )
