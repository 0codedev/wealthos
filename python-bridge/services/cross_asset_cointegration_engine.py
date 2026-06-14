r"""
Cross-Asset Lead-Lag Granger Causality & Cointegration Sieve (Domain 135 / WP-AK)
=================================================================================

Autonomous institutional pairs trading, statistical arbitrage, and lead-lag
transmission engine implementing Engle-Granger two-step cointegration,
Ornstein-Uhlenbeck half-life estimation, and bivariate Granger causality F-tests.

Mathematical Formulations:
--------------------------
1. Engle-Granger OLS Cointegration & Spread:
       \ln(Y_t) = \alpha + \beta \ln(X_t) + \epsilon_t
       \beta = \frac{\text{Cov}(\ln(X), \ln(Y))}{\text{Var}(\ln(X))}, \quad \alpha = \mathbb{E}[\ln(Y)] - \beta \mathbb{E}[\ln(X)]
       S_t = \ln(Y_t) - \beta \ln(X_t) - \alpha

2. Ornstein-Uhlenbeck Mean-Reversion Half-Life:
       \Delta S_t = \gamma S_{t-1} + u_t
       \tau_{1/2} = \frac{\ln(2)}{-\gamma} \quad (\text{bars for 50\% mean-reversion, } \gamma < 0)
       t_{\gamma} = \frac{\gamma}{\text{SE}(\gamma)} \quad (\text{Cointegrated if } t_{\gamma} \le -2.86)

3. Bivariate Granger Causality (Lag 1):
       \text{Model R: } Y_t = c_0 + a_1 Y_{t-1} + e_{R, t} \implies \text{RSS}_R
       \text{Model U: } Y_t = c_0 + a_1 Y_{t-1} + b_1 X_{t-1} + e_{U, t} \implies \text{RSS}_U
       F_{X \to Y} = \frac{\text{RSS}_R - \text{RSS}_U}{\text{RSS}_U / (T - 3)} \quad (\text{Significant if } F \ge 3.84, p \le 0.05)

4. Dynamic Z-Score Mean-Reversion Sieve:
       Z_t = \frac{S_t - \mu_S}{\sigma_S}
       - Z_t \le -2.0 \land \text{Cointegrated} \implies \text{LONG\_SPREAD (Long } Y, \text{ Short } \beta X)
       - Z_t \ge +2.0 \land \text{Cointegrated} \implies \text{SHORT\_SPREAD (Short } Y, \text{ Long } \beta X)
       - |Z_t| \le 0.25 \lor \text{BarsHeld} > 3\tau_{1/2} \implies \text{EXIT\_SPREAD}
"""

from dataclasses import dataclass
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class CointegrationReport:
    timestamp: datetime
    asset_a: str
    asset_b: str
    beta_hedge_ratio: float
    alpha_intercept: float
    t_stat_adf: float
    is_cointegrated: bool
    half_life_bars: float
    current_spread: float
    spread_z_score: float
    granger_f_stat: float
    lead_asset: str  # 'ASSET_A_LEADS', 'ASSET_B_LEADS', 'BIDIRECTIONAL', 'NEUTRAL'
    trading_signal: str  # 'LONG_SPREAD', 'SHORT_SPREAD', 'EXIT_SPREAD', 'HOLD_FLAT'
    rationale: str


class CrossAssetCointegrationEngine:
    """
    Sub-millisecond Cross-Asset Cointegration & Granger Lead-Lag Engine.
    """

    def __init__(
        self,
        z_score_entry_threshold: float = 2.0,
        z_score_exit_threshold: float = 0.25,
        max_half_life_bars: float = 50.0,
        adf_critical_t_stat: float = -2.86,  # 5% MacKinnon approximation
        db_path: str = ":memory:",
    ):
        self.entry_z = z_score_entry_threshold
        self.exit_z = z_score_exit_threshold
        self.max_half_life = max_half_life_bars
        self.adf_crit = adf_critical_t_stat
        self.db_path = db_path

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
            CREATE TABLE IF NOT EXISTS cross_asset_cointegration_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                asset_a TEXT NOT NULL,
                asset_b TEXT NOT NULL,
                beta REAL NOT NULL,
                t_stat_adf REAL NOT NULL,
                is_cointegrated INTEGER NOT NULL,
                half_life REAL NOT NULL,
                spread_z REAL NOT NULL,
                lead_asset TEXT NOT NULL,
                trading_signal TEXT NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def compute_ols_hedge_ratio(series_x: List[float], series_y: List[float]) -> Tuple[float, float, List[float]]:
        """
        Computes ln(Y) = alpha + beta * ln(X) + eps
        Returns: (beta, alpha, spread_series)
        """
        n = len(series_x)
        if n < 5 or n != len(series_y):
            return 1.0, 0.0, [0.0] * n

        ln_x = [math.log(max(x, 1e-4)) for x in series_x]
        ln_y = [math.log(max(y, 1e-4)) for y in series_y]

        mean_x = sum(ln_x) / n
        mean_y = sum(ln_y) / n

        var_x = sum((x - mean_x) ** 2 for x in ln_x)
        if var_x < 1e-8:
            return 1.0, 0.0, [0.0] * n

        cov_xy = sum((ln_x[i] - mean_x) * (ln_y[i] - mean_y) for i in range(n))
        beta = cov_xy / var_x
        alpha = mean_y - beta * mean_x

        spread = [ln_y[i] - beta * ln_x[i] - alpha for i in range(n)]
        return round(beta, 4), round(alpha, 4), spread

    @staticmethod
    def estimate_half_life_and_stationarity(spread: List[float]) -> Tuple[float, float, bool]:
        """
        Estimates delta(S_t) = gamma * S_{t-1} + u_t
        Returns: (half_life, t_stat_gamma, is_stationary)
        """
        n = len(spread)
        if n < 10:
            return 999.0, 0.0, False

        delta_s = [spread[i] - spread[i - 1] for i in range(1, n)]
        lag_s = [spread[i - 1] for i in range(1, n)]
        m = len(delta_s)

        # Regress delta_s on lag_s (no constant since spread is zero-mean)
        denom = sum(x * x for x in lag_s)
        if denom < 1e-8:
            return 999.0, 0.0, False

        gamma = sum(lag_s[i] * delta_s[i] for i in range(m)) / denom

        # Compute residuals & SE
        res = [delta_s[i] - gamma * lag_s[i] for i in range(m)]
        s2 = sum(r * r for r in res) / max(m - 1, 1)
        se_gamma = math.sqrt(s2 / denom) if denom > 0 else 1.0
        t_stat = gamma / max(se_gamma, 1e-6)

        if gamma < -1e-5:
            half_life = round(math.log(2.0) / (-gamma), 2)
        else:
            half_life = 999.0

        is_stat = (t_stat <= -2.86) and (half_life <= 100.0)
        return half_life, round(t_stat, 2), is_stat

    @staticmethod
    def test_granger_causality_f_stat(series_cause: List[float], series_effect: List[float]) -> float:
        """
        Bivariate Granger causality test (Lag 1) on returns.
        H0: Cause does not Granger-cause Effect.
        Returns F-statistic.
        """
        n = len(series_cause)
        if n < 15:
            return 0.0

        # Log returns
        ret_x = [math.log(series_cause[i] / series_cause[i - 1]) for i in range(1, n)]
        ret_y = [math.log(series_effect[i] / series_effect[i - 1]) for i in range(1, n)]
        m = len(ret_y)

        # Restricted Model: Y_t = c0 + a1 * Y_{t-1} + e
        y_cur = ret_y[1:]
        y_lag = ret_y[:-1]
        k = len(y_cur)

        # OLS on lag
        my_cur = sum(y_cur) / k
        my_lag = sum(y_lag) / k
        var_lag = sum((yl - my_lag) ** 2 for yl in y_lag)
        if var_lag < 1e-9:
            return 0.0

        a1 = sum((y_lag[i] - my_lag) * (y_cur[i] - my_cur) for i in range(k)) / var_lag
        c0 = my_cur - a1 * my_lag
        rss_r = sum((y_cur[i] - (c0 + a1 * y_lag[i])) ** 2 for i in range(k))

        # Unrestricted Model: Y_t = d0 + a1 * Y_{t-1} + b1 * X_{t-1} + e
        x_lag = ret_x[:-1]
        # Multiple linear regression via 2x2 normal equations
        mx_lag = sum(x_lag) / k
        v_xx = sum((x_lag[i] - mx_lag) ** 2 for i in range(k))
        v_yy = var_lag
        v_xy = sum((x_lag[i] - mx_lag) * (y_lag[i] - my_lag) for i in range(k))
        det = v_xx * v_yy - v_xy * v_xy

        if abs(det) < 1e-12:
            return 0.0

        c_yx = sum((x_lag[i] - mx_lag) * (y_cur[i] - my_cur) for i in range(k))
        c_yy = sum((y_lag[i] - my_lag) * (y_cur[i] - my_cur) for i in range(k))

        b1_unr = (v_yy * c_yx - v_xy * c_yy) / det
        a1_unr = (v_xx * c_yy - v_xy * c_yx) / det
        d0 = my_cur - a1_unr * my_lag - b1_unr * mx_lag

        rss_u = sum((y_cur[i] - (d0 + a1_unr * y_lag[i] + b1_unr * x_lag[i])) ** 2 for i in range(k))

        # F-statistic with 1 restriction: (RSS_R - RSS_U) / (RSS_U / (k - 3))
        df_denom = max(k - 3, 1)
        f_stat = ((rss_r - rss_u) / max(rss_u / df_denom, 1e-8))
        return round(max(f_stat, 0.0), 2)

    def evaluate_pair(
        self,
        asset_a: str,
        asset_b: str,
        prices_a: List[float],
        prices_b: List[float],
        timestamp: Optional[datetime] = None,
    ) -> CointegrationReport:
        now = timestamp if timestamp is not None else datetime.utcnow()

        # Asset A = X, Asset B = Y
        beta, alpha, spread = self.compute_ols_hedge_ratio(prices_a, prices_b)
        half_life, t_stat, is_coint = self.estimate_half_life_and_stationarity(spread)

        # Spread Z-score
        cur_spread = spread[-1]
        mean_s = sum(spread) / len(spread)
        std_s = math.sqrt(sum((s - mean_s) ** 2 for s in spread) / len(spread)) if len(spread) > 1 else 1.0
        z_score = round((cur_spread - mean_s) / max(std_s, 1e-4), 2)

        # Granger Causality
        f_a_causes_b = self.test_granger_causality_f_stat(prices_a, prices_b)
        f_b_causes_a = self.test_granger_causality_f_stat(prices_b, prices_a)

        f_crit = 3.84  # p=0.05
        if f_a_causes_b >= f_crit and f_b_causes_a < f_crit:
            lead = f"{asset_a}_LEADS"
        elif f_b_causes_a >= f_crit and f_a_causes_b < f_crit:
            lead = f"{asset_b}_LEADS"
        elif f_a_causes_b >= f_crit and f_b_causes_a >= f_crit:
            lead = "BIDIRECTIONAL"
        else:
            lead = "NEUTRAL"

        # Trading Signal
        if is_coint and z_score <= -self.entry_z:
            sig = "LONG_SPREAD"
            rationale = (
                f"Cointegrated pair ({t_stat:.2f} <= {self.adf_crit}). Spread oversold (Z={z_score:+.2f}). "
                f"Long {asset_b}, Short {beta:.2f}x {asset_a}. Expected half-life: {half_life:.1f} bars. Lead: {lead}."
            )
        elif is_coint and z_score >= self.entry_z:
            sig = "SHORT_SPREAD"
            rationale = (
                f"Cointegrated pair ({t_stat:.2f} <= {self.adf_crit}). Spread overbought (Z={z_score:+.2f}). "
                f"Short {asset_b}, Long {beta:.2f}x {asset_a}. Expected half-life: {half_life:.1f} bars. Lead: {lead}."
            )
        elif abs(z_score) <= self.exit_z:
            sig = "EXIT_SPREAD"
            rationale = f"Spread converged to mean (Z={z_score:+.2f}). Close spread positions."
        else:
            sig = "HOLD_FLAT"
            rationale = (
                f"Spread within neutral bands (Z={z_score:+.2f}). Cointegrated={is_coint} (t={t_stat:.2f}). Lead: {lead}."
            )

        # Relational persistence
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO cross_asset_cointegration_telemetry (
                timestamp, asset_a, asset_b, beta, t_stat_adf, is_cointegrated,
                half_life, spread_z, lead_asset, trading_signal
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now.isoformat(),
                asset_a,
                asset_b,
                beta,
                t_stat,
                1 if is_coint else 0,
                half_life,
                z_score,
                lead,
                sig,
            ),
        )
        conn.commit()

        return CointegrationReport(
            timestamp=now,
            asset_a=asset_a,
            asset_b=asset_b,
            beta_hedge_ratio=beta,
            alpha_intercept=alpha,
            t_stat_adf=t_stat,
            is_cointegrated=is_coint,
            half_life_bars=half_life,
            current_spread=cur_spread,
            spread_z_score=z_score,
            granger_f_stat=f_a_causes_b,
            lead_asset=lead,
            trading_signal=sig,
            rationale=rationale,
        )
