"""
Domain 170 (WP-BT): Cross-Sectional Statistical Arbitrage Residual Cointegration & Johansen Trace Sieve

Implements Johansen (1988, 1991) multi-asset cointegration rank test, generalized eigenvalue
decomposition, Trace statistic computation, cointegrating eigenvector hedge ratio derivation,
Ornstein-Uhlenbeck spread half-life estimation, and statistical arbitrage basket trade directives.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class CointegrationResult:
    is_cointegrated: bool
    cointegration_rank: int
    trace_statistic: float
    critical_value_95: float
    eigenvalues: List[float]
    hedge_ratios: List[float]  # Normalized beta_1 eigenvector
    spread_mean: float
    spread_std: float
    z_score: float
    half_life_days: float


@dataclass
class JohansenReport:
    basket_name: str
    asset_symbols: List[str]
    is_cointegrated: bool
    cointegration_rank: int
    trace_stat: float
    crit_val: float
    hedge_ratios: Dict[str, float]
    current_z_score: float
    half_life_days: float
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class JohansenCointegrationStatArbSieve:
    """
    Multi-Asset Johansen Cointegration & Statistical Arbitrage Sieve.
    """

    # Critical values for Johansen Trace Statistic (r = 0, 95% level, constant in CE, no trend)
    # Dimension N: Osterwald-Lenum (1992) Table 1
    TRACE_CRIT_95: Dict[int, float] = {
        2: 15.49,
        3: 29.80,
        4: 47.85,
        5: 69.82,
        6: 95.75,
    }

    def __init__(self, db_path: str = ":memory:"):
        self.db_path = db_path
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for Johansen telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS johansen_cointegration_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                basket_name TEXT NOT NULL,
                assets TEXT NOT NULL,
                cointegrated INTEGER NOT NULL,
                rank INTEGER NOT NULL,
                trace_stat REAL NOT NULL,
                crit_value REAL NOT NULL,
                z_score REAL NOT NULL,
                half_life_days REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def _matrix_mult(self, A: List[List[float]], B: List[List[float]]) -> List[List[float]]:
        rows_A, cols_A = len(A), len(A[0])
        rows_B, cols_B = len(B), len(B[0])
        assert cols_A == rows_B
        C = [[0.0] * cols_B for _ in range(rows_A)]
        for i in range(rows_A):
            for k in range(cols_A):
                for j in range(cols_B):
                    C[i][j] += A[i][k] * B[k][j]
        return C

    def _invert_2x2(self, M: List[List[float]]) -> List[List[float]]:
        det = M[0][0] * M[1][1] - M[0][1] * M[1][0]
        if abs(det) < 1e-12:
            return [[1.0, 0.0], [0.0, 1.0]]
        inv_det = 1.0 / det
        return [
            [M[1][1] * inv_det, -M[0][1] * inv_det],
            [-M[1][0] * inv_det, M[0][0] * inv_det],
        ]

    def run_johansen_2asset(
        self,
        series_1: List[float],
        series_2: List[float],
    ) -> CointegrationResult:
        """
        Executes analytical Johansen cointegration test for N = 2 asset series.
        Decomposes sample covariances, solves the characteristic 2x2 polynomial,
        computes Trace statistic, and extracts the cointegrating eigenvector.
        """
        T = min(len(series_1), len(series_2))
        if T < 20:
            raise ValueError("Time series too short for Johansen test (minimum 20 observations)")

        y1 = series_1[:T]
        y2 = series_2[:T]

        # 1. First differences
        dy1 = [y1[t] - y1[t - 1] for t in range(1, T)]
        dy2 = [y2[t] - y2[t - 1] for t in range(1, T)]
        lag_y1 = y1[:-1]
        lag_y2 = y2[:-1]
        N_obs = T - 1

        # Demean series
        mean_dy1 = sum(dy1) / N_obs
        mean_dy2 = sum(dy2) / N_obs
        mean_ly1 = sum(lag_y1) / N_obs
        mean_ly2 = sum(lag_y2) / N_obs

        dY = [[dy1[t] - mean_dy1, dy2[t] - mean_dy2] for t in range(N_obs)]
        lY = [[lag_y1[t] - mean_ly1, lag_y2[t] - mean_ly2] for t in range(N_obs)]

        # Sample Covariances: S00 (dY, dY), S11 (lY, lY), S01 (dY, lY)
        s00 = [[0.0, 0.0], [0.0, 0.0]]
        s11 = [[0.0, 0.0], [0.0, 0.0]]
        s01 = [[0.0, 0.0], [0.0, 0.0]]

        for t in range(N_obs):
            # S00
            s00[0][0] += dY[t][0] * dY[t][0]
            s00[0][1] += dY[t][0] * dY[t][1]
            s00[1][0] += dY[t][1] * dY[t][0]
            s00[1][1] += dY[t][1] * dY[t][1]

            # S11
            s11[0][0] += lY[t][0] * lY[t][0]
            s11[0][1] += lY[t][0] * lY[t][1]
            s11[1][0] += lY[t][1] * lY[t][0]
            s11[1][1] += lY[t][1] * lY[t][1]

            # S01
            s01[0][0] += dY[t][0] * lY[t][0]
            s01[0][1] += dY[t][0] * lY[t][1]
            s01[1][0] += dY[t][1] * lY[t][0]
            s01[1][1] += dY[t][1] * lY[t][1]

        for i in range(2):
            for j in range(2):
                s00[i][j] /= N_obs
                s11[i][j] /= N_obs
                s01[i][j] /= N_obs

        s10 = [[s01[0][0], s01[1][0]], [s01[0][1], s01[1][1]]]
        inv_s00 = self._invert_2x2(s00)
        inv_s11 = self._invert_2x2(s11)

        # M = S11^{-1} * S10 * S00^{-1} * S01
        temp = self._matrix_mult(inv_s11, s10)
        temp2 = self._matrix_mult(temp, inv_s00)
        M = self._matrix_mult(temp2, s01)

        # Characteristic polynomial of 2x2 matrix M: lambda^2 - tr(M)*lambda + det(M) = 0
        tr_M = M[0][0] + M[1][1]
        det_M = M[0][0] * M[1][1] - M[0][1] * M[1][0]

        disc = max(0.0, tr_M * tr_M - 4.0 * det_M)
        sqrt_disc = math.sqrt(disc)

        lambda1 = max(1e-6, min(0.9999, 0.5 * (tr_M + sqrt_disc)))
        lambda2 = max(1e-6, min(0.9999, 0.5 * (tr_M - sqrt_disc)))

        # Trace statistic for r = 0: -T * (ln(1 - lambda1) + ln(1 - lambda2))
        trace_stat = -N_obs * (math.log(1.0 - lambda1) + math.log(1.0 - lambda2))
        crit_val = self.TRACE_CRIT_95[2]
        is_cointegrated = trace_stat > crit_val

        # Solve eigenvector (M - lambda1 * I) v = 0 -> normalized to [1.0, -beta]
        # (M00 - lambda1)*v1 + M01*v2 = 0 -> v2 = -(M00 - lambda1)/M01 * v1
        if abs(M[0][1]) > 1e-8:
            beta = -(M[0][0] - lambda1) / M[0][1]
        elif abs(M[1][0]) > 1e-8:
            beta = -M[1][1] + lambda1  # fallback
        else:
            # S11-based fallback hedge ratio
            beta = s01[0][1] / max(1e-6, s11[1][1])

        # Normalize hedge ratio: [1.0, -beta] for co-trending series
        hedge_ratios = [1.0, -round(abs(float(beta)), 4)]

        # Calculate Cointegrated Spread: z_t = y1_t + hedge_ratios[1] * y2_t
        spread = [y1[t] + hedge_ratios[1] * y2[t] for t in range(T)]
        spread_mean = sum(spread) / T
        variance = sum((z - spread_mean) ** 2 for z in spread) / max(1, T - 1)
        spread_std = max(1e-6, math.sqrt(variance))
        latest_z_score = (spread[-1] - spread_mean) / spread_std

        # Estimate Ornstein-Uhlenbeck Half-Life: dz_t = a + b * z_{t-1} + eps
        dz = [spread[t] - spread[t - 1] for t in range(1, T)]
        lag_z = spread[:-1]
        cov_z = sum((dz[t] - (sum(dz) / (T - 1))) * (lag_z[t] - (sum(lag_z) / (T - 1))) for t in range(T - 1))
        var_z = sum((lag_z[t] - (sum(lag_z) / (T - 1))) ** 2 for t in range(T - 1))
        b = cov_z / max(1e-8, var_z)

        # kappa = -ln(1 + b) or -b
        kappa = -math.log(max(1e-4, 1.0 + b)) if -0.999 < b < 0 else max(0.01, -b)
        half_life = math.log(2.0) / max(1e-4, kappa)
        half_life_days = round(max(0.5, min(120.0, half_life)), 2)

        return CointegrationResult(
            is_cointegrated=is_cointegrated,
            cointegration_rank=1 if is_cointegrated else 0,
            trace_statistic=round(trace_stat, 2),
            critical_value_95=crit_val,
            eigenvalues=[round(lambda1, 4), round(lambda2, 4)],
            hedge_ratios=hedge_ratios,
            spread_mean=round(spread_mean, 4),
            spread_std=round(spread_std, 4),
            z_score=round(latest_z_score, 2),
            half_life_days=half_life_days,
        )

    def analyze_pair(
        self,
        basket_name: str,
        sym1: str,
        sym2: str,
        prices1: List[float],
        prices2: List[float],
    ) -> JohansenReport:
        """
        Runs comprehensive Johansen Stat-Arb Sieve on an asset pair.
        Directives:
        - STAT_ARB_SHORT_SPREAD_BASKET (s >= +2.0)
        - STAT_ARB_LONG_SPREAD_BASKET (s <= -2.0)
        - STAT_ARB_UNWIND_TARGET_REACHED (|s| <= 0.5)
        - STAT_ARB_STRUCTURAL_BREAK_STOP (|s| >= 4.0)
        - NO_COINTEGRATION_STAND_ASIDE (trace_stat <= crit_val)
        """
        res = self.run_johansen_2asset(prices1, prices2)

        if not res.is_cointegrated:
            regime = "NO_COINTEGRATION_RANDOM_WALK"
            directive = "STAND_ASIDE_NO_STATIONARY_RELATION"
        elif abs(res.z_score) >= 4.0:
            regime = "STRUCTURAL_BREAK_DIVERGENCE"
            directive = "EMERGENCY_STOP_LOSS_LIQUIDATION"
        elif res.z_score >= 2.0:
            regime = "OVEREXTENDED_POSITIVE_SPREAD"
            directive = "STAT_ARB_SHORT_SPREAD_BASKET"
        elif res.z_score <= -2.0:
            regime = "OVEREXTENDED_NEGATIVE_SPREAD"
            directive = "STAT_ARB_LONG_SPREAD_BASKET"
        elif abs(res.z_score) <= 0.50:
            regime = "MEAN_REVERSION_EQUILIBRIUM"
            directive = "STAT_ARB_UNWIND_TARGET_REACHED"
        else:
            regime = "MODERATE_SPREAD_CONSOLIDATION"
            directive = "HOLD_ACTIVE_PAIR_POSITIONS"

        report = JohansenReport(
            basket_name=basket_name,
            asset_symbols=[sym1, sym2],
            is_cointegrated=res.is_cointegrated,
            cointegration_rank=res.cointegration_rank,
            trace_stat=res.trace_statistic,
            crit_val=res.critical_value_95,
            hedge_ratios={sym1: res.hedge_ratios[0], sym2: res.hedge_ratios[1]},
            current_z_score=res.z_score,
            half_life_days=res.half_life_days,
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: JohansenReport) -> None:
        """Persists evaluation results to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO johansen_cointegration_telemetry (
                timestamp, basket_name, assets, cointegrated, rank,
                trace_stat, crit_value, z_score, half_life_days, regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.basket_name,
                ",".join(rep.asset_symbols),
                1 if rep.is_cointegrated else 0,
                rep.cointegration_rank,
                rep.trace_stat,
                rep.crit_val,
                rep.current_z_score,
                rep.half_life_days,
                rep.regime,
                rep.trade_directive,
            ),
        )
        conn.commit()

    def get_latest_telemetry(self, limit: int = 10) -> List[Tuple]:
        """Retrieves latest persisted telemetry rows."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT basket_name, assets, cointegrated, trace_stat, z_score, regime, directive
            FROM johansen_cointegration_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
