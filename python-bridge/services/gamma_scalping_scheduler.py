"""
Domain 154 (WP-BD): Dynamic Delta-Neutral Gamma Scalping Execution Scheduler

Implements real-time portfolio delta-hedging, Leland-Zakamouline optimal rebalancing band
formulation, realized vs implied volatility PnL attribution, long/short gamma inventory
management, and automated order execution scheduling for option market makers.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import Optional


@dataclass
class PortfolioGreeks:
    underlying_price: float
    net_delta: float
    net_gamma: float
    net_vega: float
    net_theta: float
    underlying_hedge_qty: float
    implied_vol: float
    realized_vol_30d: float


@dataclass
class GammaScalpReport:
    symbol: str
    underlying_price: float
    total_delta: float
    net_gamma: float
    rebalance_band_delta: float
    rebalance_band_price: float
    required_hedge_delta: float
    hedge_action: str
    vol_spread_real_minus_impl: float
    expected_daily_gamma_pnl: float
    expected_daily_theta_cost: float
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class GammaScalpingScheduler:
    """
    Dynamic Delta-Neutral Gamma Scalper & Rebalance Band Governor.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        transaction_cost_rate: float = 0.0005,  # 5 bps round-trip friction
        delta_tolerance: float = 0.15,         # Rebalance if net portfolio delta > 0.15
        risk_aversion: float = 1.0,
    ):
        self.db_path = db_path
        self.transaction_cost_rate = transaction_cost_rate
        self.delta_tolerance = delta_tolerance
        self.risk_aversion = risk_aversion
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for gamma scalping telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS gamma_scalping_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                underlying_price REAL NOT NULL,
                total_delta REAL NOT NULL,
                net_gamma REAL NOT NULL,
                hedge_delta REAL NOT NULL,
                hedge_action TEXT NOT NULL,
                vol_spread REAL NOT NULL,
                expected_pnl REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def calculate_leland_rebalance_band(
        self,
        price: float,
        gamma: float,
        vol: float,
    ) -> tuple[float, float]:
        """
        Calculates Leland-Zakamouline optimal rebalance bands in Price and Delta space:
        delta_band_price = ( (3 * c * price) / (gamma * risk_aversion) )^(1/3) (approx)
        delta_band_delta = gamma * delta_band_price
        """
        abs_gamma = max(1e-5, abs(gamma))
        c = self.transaction_cost_rate

        # Cubic root formulation for optimal bandwidth
        band_price = price * math.pow(
            (3.0 * c) / (abs_gamma * price * self.risk_aversion),
            1.0 / 3.0,
        )
        # Limit price band between 0.1% and 3.0% of price
        band_price = max(0.001 * price, min(0.03 * price, band_price))
        band_delta = abs_gamma * band_price

        # Institutional risk ceiling: unhedged delta must not exceed delta_tolerance
        band_delta = min(self.delta_tolerance, max(0.01, band_delta))
        return band_price, band_delta

    def evaluate_gamma_scalp(
        self,
        symbol: str,
        greeks: PortfolioGreeks,
    ) -> GammaScalpReport:
        """
        Evaluates portfolio delta-neutrality, checks if drift exceeds rebalance band,
        computes expected daily gamma PnL vs theta bleeding, and issues hedge orders.
        """
        price = greeks.underlying_price
        gamma = greeks.net_gamma

        # Total unhedged position delta
        total_delta = greeks.net_delta + greeks.underlying_hedge_qty

        # Rebalancing bands
        band_price, band_delta = self.calculate_leland_rebalance_band(
            price=price,
            gamma=gamma,
            vol=greeks.implied_vol,
        )

        # Volatility Spread: Realized Vol - Implied Vol
        vol_spread = greeks.realized_vol_30d - greeks.implied_vol

        # Theoretical Daily Gamma Scalping Attribution:
        # PnL_gamma_daily approx 0.5 * S^2 * Gamma * (sigma_realized^2 / 252)
        # Theta_cost_daily approx Net_Theta (negative)
        dt = 1.0 / 252.0
        expected_gamma_pnl = 0.5 * (price**2) * gamma * ((greeks.realized_vol_30d**2) * dt)
        expected_theta_cost = greeks.net_theta  # Typically negative

        # Determine required hedge adjustment
        required_hedge_delta = -total_delta

        # Rebalance execution logic
        if abs(total_delta) >= band_delta:
            if total_delta > 0:
                # Portfolio is net long delta -> Need to sell underlying to flatten
                hedge_action = "SELL_UNDERLYING_HEDGE"
                if gamma > 0:
                    directive = "SCALP_HARVEST_UPMOVE_SELL_HEDGE"
                else:
                    directive = "DEFENSIVE_SHORT_GAMMA_STOP_HEDGE"
            else:
                # Portfolio is net short delta -> Need to buy underlying to flatten
                hedge_action = "BUY_UNDERLYING_HEDGE"
                if gamma > 0:
                    directive = "SCALP_HARVEST_DIP_BUY_HEDGE"
                else:
                    directive = "DEFENSIVE_SHORT_GAMMA_STOP_HEDGE"

            if gamma > 0:
                if vol_spread >= 0.0:
                    regime = "POSITIVE_VOL_HARVEST_ACTIVE_SCALPING"
                else:
                    regime = "SUBDUED_VOL_GAMMA_SCALPING_THRESHOLD_MET"
            else:
                regime = "SHORT_GAMMA_DELTA_DEVIATION_CORRECTION"
        else:
            hedge_action = "NO_HEDGE_WITHIN_BAND"
            required_hedge_delta = 0.0
            if gamma > 0:
                if vol_spread < -0.05:
                    regime = "LONG_GAMMA_THETA_BLEED_WARNING"
                    directive = "MAINTAIN_BAND_CONSIDER_TRIMMING_LONGS"
                else:
                    regime = "DELTA_NEUTRAL_IDLE_MONITORING"
                    directive = "MAINTAIN_CURRENT_HEDGE"
            else:
                regime = "SHORT_GAMMA_THETA_HARVEST_IDLE"
                directive = "COLLECT_DECAY_MAINTAIN_DELTA_TOLERANCE"

        report = GammaScalpReport(
            symbol=symbol,
            underlying_price=round(price, 2),
            total_delta=round(total_delta, 4),
            net_gamma=round(gamma, 6),
            rebalance_band_delta=round(band_delta, 4),
            rebalance_band_price=round(band_price, 2),
            required_hedge_delta=round(required_hedge_delta, 4),
            hedge_action=hedge_action,
            vol_spread_real_minus_impl=round(vol_spread, 4),
            expected_daily_gamma_pnl=round(expected_gamma_pnl, 2),
            expected_daily_theta_cost=round(expected_theta_cost, 2),
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, report: GammaScalpReport) -> None:
        """Persists audit record to SQLite database."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO gamma_scalping_telemetry (
                timestamp, symbol, underlying_price, total_delta, net_gamma,
                hedge_delta, hedge_action, vol_spread, expected_pnl,
                regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report.timestamp,
                report.symbol,
                report.underlying_price,
                report.total_delta,
                report.net_gamma,
                report.required_hedge_delta,
                report.hedge_action,
                report.vol_spread_real_minus_impl,
                report.expected_daily_gamma_pnl,
                report.regime,
                report.trade_directive,
            ),
        )
        conn.commit()
