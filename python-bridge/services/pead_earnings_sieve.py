r"""
Post-Earnings Announcement Drift (PEAD) & Standardized Unexpected Earnings Sieve (Domain 151 / WP-BA)
======================================================================================================

Autonomous institutional equity alpha engine calculating Standardized Unexpected Earnings (SUE)
via Foster-Ohlson-Bernard seasonal random walk models, estimating Earnings Response
Coefficients (ERC), detecting institutional underreaction, and generating multi-week
post-earnings momentum drift execution signals.

Mathematical Formulations:
--------------------------
1. Seasonal Random Walk with Drift Earnings Expectation:
       \mathbb{E}[EPS_t] = EPS_{t-4} + \delta_t, \quad \delta_t = \frac{1}{K} \sum_{k=1}^K (EPS_{t-k} - EPS_{t-k-4})

2. Standardized Unexpected Earnings (SUE):
       UE_t = EPS_t - \mathbb{E}[EPS_t]
       SUE_t = \frac{UE_t}{\sigma_{UE, t}}
   where \sigma_{UE, t} is the rolling standard deviation of seasonal forecast errors over K=8 quarters.

3. Cumulative Abnormal Return & Institutional Underreaction:
       CAR_{[0, +1]} = \sum_{\tau=0}^1 (R_{i, \tau} - \beta_i R_{m, \tau})
       \text{UnderreactionFactor} = \max\left(0, \; SUE_t - \frac{CAR_{[0, +1]}}{0.015}\right)

4. Composite PEAD Momentum Drift Score (M_{\text{pead}} \in [-1.0, 1.0]):
       M_{\text{pead}} = \tanh\left( 0.45 \cdot SUE_t + 0.35 \cdot \frac{RevSurprise_{\%}}{10.0} + 0.20 \cdot \text{UnderreactionFactor} \right)
"""

from dataclasses import dataclass
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class QuarterlyEarningsReport:
    symbol: str
    reported_eps: float
    historical_eps: List[float]  # Chronological EPS [t-8, t-7, ..., t-1] (at least 8 quarters)
    revenue_surprise_pct: float = 0.0  # Revenue beat/miss % (e.g. +4.5 for 4.5% beat)
    car_day0_day1: float = 0.0  # Cumulative abnormal return from Day 0 to Day +1 (e.g. 0.02 for +2.0%)


@dataclass
class PEADAnalysisReport:
    symbol: str
    reported_eps: float
    expected_eps: float
    unexpected_earnings: float
    sue_score: float
    car_day0_day1_pct: float
    underreaction_score: float
    pead_momentum_score: float
    expected_drift_horizon_days: int
    regime: str
    trade_directive: str


class PEADEarningsSieve:
    """
    Sub-millisecond Post-Earnings Announcement Drift (PEAD) and SUE engine.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        sue_hurdle: float = 1.80,  # 1.80 sigma threshold for significant surprise
    ):
        self.db_path = db_path
        self.sue_hurdle = sue_hurdle
        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            if self._conn is None:
                self._conn = sqlite3.connect(":memory:")
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for PEAD telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS pead_sue_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                reported_eps REAL NOT NULL,
                expected_eps REAL NOT NULL,
                sue_score REAL NOT NULL,
                car_0_1 REAL NOT NULL,
                pead_momentum REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def evaluate_pead(self, report_data: QuarterlyEarningsReport) -> PEADAnalysisReport:
        """
        Calculates seasonal expected EPS, SUE, underreaction factor, and PEAD momentum.
        """
        hist = report_data.historical_eps
        if len(hist) < 8:
            raise ValueError(f"Historical EPS must contain at least 8 quarters, got {len(hist)}")

        # Last quarter in history is t-1, t-4 is hist[-4]
        # Foster seasonal random walk: E[EPS_t] = EPS_{t-4} + mean seasonal delta
        eps_t_minus_4 = hist[-4]

        # Calculate historical seasonal differences: EPS_k - EPS_{k-4}
        seasonal_diffs = []
        for i in range(4, len(hist)):
            seasonal_diffs.append(hist[i] - hist[i - 4])

        mean_drift = sum(seasonal_diffs) / max(1, len(seasonal_diffs))
        expected_eps = eps_t_minus_4 + mean_drift

        # Unexpected Earnings UE_t
        ue = report_data.reported_eps - expected_eps

        # Forecast error volatility sigma_UE over past 4 seasonal differences
        variance_ue = sum((d - mean_drift) ** 2 for d in seasonal_diffs) / max(1, len(seasonal_diffs) - 1)
        min_sigma = max(0.10, 0.03 * abs(expected_eps))
        sigma_ue = max(min_sigma, math.sqrt(variance_ue))

        # Standardized Unexpected Earnings (SUE)
        sue = ue / sigma_ue

        # Underreaction Factor:
        # If SUE is high (+2 sigma) but Day 0-1 price only moved +1%, price underreacted!
        car = report_data.car_day0_day1
        if sue > 0:
            underreact = max(0.0, sue - (car / 0.015))
        elif sue < 0:
            underreact = min(0.0, sue - (car / 0.015))
        else:
            underreact = 0.0

        # Composite PEAD Momentum Score M_pead in [-1.0, 1.0]
        raw_score = (
            0.45 * sue
            + 0.35 * (report_data.revenue_surprise_pct / 10.0)
            + 0.20 * underreact
        )
        pead_score = math.tanh(raw_score)

        # Regimes and Directives
        if sue >= self.sue_hurdle and car <= 0.05:
            # Significant positive beat with moderate or muted day 0-1 reaction -> Accumulate
            regime = "PEAD_BULLISH_UNDERREACTION"
            directive = "ACCUMULATE_LONG_PEAD_MOMENTUM_RUNNER"
            horizon = 45  # 45 trading days
        elif sue >= self.sue_hurdle and car > 0.08:
            # Significant beat but stock already surged > 8% on Day 0-1 -> Exhausted
            regime = "PEAD_PRICED_IN_OR_EXHAUSTED"
            directive = "HOLD_OR_TAKE_PROFIT_DAY_1"
            horizon = 5
        elif sue <= -self.sue_hurdle and car >= -0.05:
            # Significant miss with muted reaction -> Negative drift
            regime = "PEAD_BEARISH_UNDERREACTION"
            directive = "SHORT_OR_DISTRIBUTE_EQUITY_RISK"
            horizon = 45
        elif abs(sue) < 0.80:
            regime = "NEUTRAL_EARNINGS_CONSENSUS"
            directive = "NO_PEAD_EDGE_MAINTAIN_PORTFOLIO"
            horizon = 0
        else:
            regime = "MODERATE_EARNINGS_SURPRISE"
            directive = "MONITOR_ANALYST_REVISION_FLOW"
            horizon = 20

        report = PEADAnalysisReport(
            symbol=report_data.symbol,
            reported_eps=round(report_data.reported_eps, 2),
            expected_eps=round(expected_eps, 2),
            unexpected_earnings=round(ue, 2),
            sue_score=round(sue, 3),
            car_day0_day1_pct=round(car * 100.0, 2),
            underreaction_score=round(underreact, 3),
            pead_momentum_score=round(pead_score, 4),
            expected_drift_horizon_days=horizon,
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: PEADAnalysisReport) -> None:
        """Persists PEAD telemetry into SQLite."""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO pead_sue_telemetry (
                    timestamp, symbol, reported_eps, expected_eps, sue_score,
                    car_0_1, pead_momentum, regime, directive
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.utcnow().isoformat(),
                    rep.symbol,
                    rep.reported_eps,
                    rep.expected_eps,
                    rep.sue_score,
                    rep.car_day0_day1_pct,
                    rep.pead_momentum_score,
                    rep.regime,
                    rep.trade_directive,
                ),
            )
            conn.commit()
        except Exception:
            pass
