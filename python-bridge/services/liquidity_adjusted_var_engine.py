r"""
Liquidity-Adjusted Value at Risk (LVaR) & Optimal Liquidation Horizon Sieve (Domain 144 / WP-AT)
==================================================================================================

Autonomous institutional risk engine calculating Liquidity-Adjusted VaR (LVaR), combining
exogenous bid-ask spread stochastic risk (Bangia et al., 1999) with endogenous market
impact (Almgren-Chriss, 2000; Kyle-Obizhaeva, 2016), and solving for the optimal
liquidation horizon T* that minimizes the composite risk frontier.

Mathematical Formulations:
--------------------------
1. Pure Market Risk (Classical VaR):
       \text{VaR}_\alpha(T) = z_\alpha \cdot \sigma_{\text{daily}} \cdot \sqrt{T} \cdot V_{\text{pos}}
   where z_{0.99} = 2.3263, z_{0.95} = 1.6449, T is horizon in days.

2. Exogenous Stochastic Spread Cost (Bangia et al.):
       \text{Cost}_{\text{spread}} = \frac{1}{2} V_{\text{pos}} \cdot (\bar{S} + z_{\alpha, S} \cdot \sigma_S)
   where \bar{S} is relative spread (Ask - Bid)/Mid, \sigma_S is spread standard deviation.

3. Endogenous Price Impact Cost (Universal Square-Root Law):
       \text{Cost}_{\text{impact}}(T) = \frac{1}{2} V_{\text{pos}} \cdot Y \cdot \sigma_{\text{daily}} \sqrt{\frac{Q}{T \cdot V_{\text{adv}}}}
   where Y \approx 0.60 is the Kyle-Obizhaeva dimensionless constant.

4. Combined Liquidity-Adjusted VaR (LVaR):
       \text{LVaR}_\alpha(T) = \text{VaR}_\alpha(T) + \text{Cost}_{\text{spread}} + \text{Cost}_{\text{impact}}(T)

5. Analytical Optimal Liquidation Horizon T*:
   Minimizing \text{LVaR}_\alpha(T) with respect to T:
       \frac{\partial \text{LVaR}}{\partial T} = \frac{1}{2} z_\alpha \sigma V T^{-1/2} - \frac{1}{4} V Y \sigma \sqrt{\frac{Q}{V_{\text{adv}}}} T^{-3/2} = 0
       \implies T^* = \left( \frac{Y}{2 z_\alpha} \right) \cdot \sqrt{\frac{Q}{V_{\text{adv}}}} \quad \text{(in trading days)}

6. Liquidity Haircut Multiplier:
       \Lambda = \frac{\text{LVaR}_\alpha(T^*)}{\text{VaR}_\alpha(1)}
"""

from dataclasses import dataclass
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class PositionRiskParameters:
    symbol: str
    quantity: float  # Number of shares/contracts
    price: float  # Current mid price (INR)
    daily_volatility: float  # \sigma_daily (e.g. 0.015 for 1.5% daily vol)
    adv_shares: float  # Average daily volume in shares
    mean_spread_bps: float = 4.0  # Mean relative spread in bps (e.g. 4 bps)
    spread_vol_bps: float = 2.0  # Volatility of relative spread in bps
    confidence_level: float = 0.99  # 99% VaR standard
    kyle_y: float = 0.60  # Universal impact constant Y


@dataclass
class LVaRReport:
    symbol: str
    position_value_inr: float
    classical_var_1d_inr: float
    exogenous_spread_risk_inr: float
    endogenous_impact_cost_inr: float
    optimal_horizon_days: float
    optimal_horizon_hours: float
    lvar_optimal_inr: float
    liquidity_multiplier: float  # LVaR / Classical VaR 1D
    risk_regime: str
    recommended_action: str
    required_margin_buffer_pct: float


class LiquidityAdjustedVaREngine:
    """
    Sub-millisecond LVaR calculator and liquidation horizon optimizer.
    """

    CONFIDENCE_QUANTILES = {
        0.90: 1.2816,
        0.95: 1.6449,
        0.975: 1.9600,
        0.99: 2.3263,
        0.995: 2.5758,
        0.999: 3.0902,
    }

    def __init__(
        self,
        db_path: str = ":memory:",
        trading_hours_per_day: float = 6.25,  # 09:15 to 15:30 IST = 6.25 hrs
    ):
        self.db_path = db_path
        self.trading_hours = trading_hours_per_day
        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            if self._conn is None:
                self._conn = sqlite3.connect(":memory:")
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for LVaR telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS lvar_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                position_value REAL NOT NULL,
                classical_var REAL NOT NULL,
                spread_risk REAL NOT NULL,
                impact_cost REAL NOT NULL,
                optimal_horizon_days REAL NOT NULL,
                lvar_optimal REAL NOT NULL,
                liquidity_multiplier REAL NOT NULL,
                risk_regime TEXT NOT NULL,
                recommended_action TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def get_quantile(self, confidence: float) -> float:
        """Returns Gaussian quantile for the specified confidence level."""
        closest = min(self.CONFIDENCE_QUANTILES.keys(), key=lambda k: abs(k - confidence))
        return self.CONFIDENCE_QUANTILES[closest]

    def compute_lvar(self, pos: PositionRiskParameters) -> LVaRReport:
        """
        Computes 1-day Classical VaR, stochastic exogenous spread risk,
        endogenous square-root price impact, optimal liquidation horizon T*,
        and combined LVaR.
        """
        V_pos = pos.quantity * pos.price
        z = self.get_quantile(pos.confidence_level)
        z_spread = self.get_quantile(pos.confidence_level)

        # 1. 1-Day Classical Pure Market VaR
        classical_var_1d = z * pos.daily_volatility * 1.0 * V_pos

        # 2. Exogenous Stochastic Spread Cost (Bangia et al.)
        mean_s = (pos.mean_spread_bps / 10000.0)
        vol_s = (pos.spread_vol_bps / 10000.0)
        exogenous_spread_risk = 0.5 * V_pos * (mean_s + z_spread * vol_s)

        # 3. Optimal Liquidation Horizon T* (in days)
        # T* = [ Y / (2 * z) ] * sqrt(Q / ADV)
        participation_ratio = max(1e-8, pos.quantity / max(1.0, pos.adv_shares))
        sqrt_part = math.sqrt(participation_ratio)
        optimal_t_raw = (pos.kyle_y / (2.0 * z)) * sqrt_part
        # Impose reasonable execution bounds: minimum 1 minute (1 / (6.25 * 60) days)
        min_t = 1.0 / (self.trading_hours * 60.0)
        optimal_t = max(min_t, optimal_t_raw)
        optimal_hours = optimal_t * self.trading_hours

        # 4. Market Risk over effective horizon (minimum 1 day for overnight holding risk)
        t_risk = max(1.0, optimal_t)
        effective_market_var = z * pos.daily_volatility * math.sqrt(t_risk) * V_pos

        # 5. Endogenous Price Impact over optimal horizon T*
        # Impact = 0.5 * V_pos * Y * sigma * sqrt(Q / (T* * ADV))
        impact_over_optimal_t = 0.5 * V_pos * pos.kyle_y * pos.daily_volatility * math.sqrt(participation_ratio / optimal_t)

        # 6. Combined LVaR at T*
        lvar_optimal = effective_market_var + exogenous_spread_risk + impact_over_optimal_t

        # 7. Liquidity Multiplier
        multiplier = lvar_optimal / max(1e-4, classical_var_1d)

        # 8. Regime Classification and Directive Ladder
        if multiplier <= 1.25:
            regime = "LIQUID_OPTIMAL_EXECUTION"
            action = "STANDARD_VWAP_OR_TWAP"
            margin_buffer = 15.0  # Standard +15% margin buffer
        elif multiplier <= 2.00:
            regime = "MODERATE_IMPACT_THROTTLE"
            action = "EXTEND_SCHEDULE_PASSIVE_PEG"
            margin_buffer = 30.0  # +30% margin buffer
        elif multiplier <= 3.50:
            regime = "ACUTE_LIQUIDITY_STRESS"
            action = "ROUTE_CROSSING_DARK_AUCTION"
            margin_buffer = 60.0  # +60% margin buffer
        else:
            regime = "PROHIBITIVE_LIQUIDATION_HAZARD"
            action = "HALT_EXPANSION_PASSIVE_ICEBERG_ONLY"
            margin_buffer = 100.0  # 100% additional collateral

        report = LVaRReport(
            symbol=pos.symbol,
            position_value_inr=round(V_pos, 2),
            classical_var_1d_inr=round(classical_var_1d, 2),
            exogenous_spread_risk_inr=round(exogenous_spread_risk, 2),
            endogenous_impact_cost_inr=round(impact_over_optimal_t, 2),
            optimal_horizon_days=round(optimal_t, 4),
            optimal_horizon_hours=round(optimal_hours, 2),
            lvar_optimal_inr=round(lvar_optimal, 2),
            liquidity_multiplier=round(multiplier, 3),
            risk_regime=regime,
            recommended_action=action,
            required_margin_buffer_pct=margin_buffer,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: LVaRReport) -> None:
        """Persists LVaR telemetry into SQLite."""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO lvar_telemetry (
                    timestamp, symbol, position_value, classical_var,
                    spread_risk, impact_cost, optimal_horizon_days,
                    lvar_optimal, liquidity_multiplier, risk_regime, recommended_action
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.utcnow().isoformat(),
                    rep.symbol,
                    rep.position_value_inr,
                    rep.classical_var_1d_inr,
                    rep.exogenous_spread_risk_inr,
                    rep.endogenous_impact_cost_inr,
                    rep.optimal_horizon_days,
                    rep.lvar_optimal_inr,
                    rep.liquidity_multiplier,
                    rep.risk_regime,
                    rep.recommended_action,
                ),
            )
            conn.commit()
        except Exception:
            pass
