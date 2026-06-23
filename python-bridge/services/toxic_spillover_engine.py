r"""
Cross-Asset Order Flow Toxicity & Toxic Imbalance Spillover Engine (Domain 125 / WP-AA)
=======================================================================================

Autonomous cross-asset order flow toxicity surveillance engine implementing
the Diebold-Yilmaz Spillover Index over rolling VPIN series to measure
instantaneous toxic transmission from Indian index derivatives (NIFTY, BANKNIFTY)
to major constituent equities and options order books.

Mathematical Specifications:
-----------------------------
1. High-Frequency Vector Autoregression VAR(1) on VPIN Vectors:
   Let \mathbf{V}_t = [VPIN_{1,t}, VPIN_{2,t}, \dots, VPIN_{K,t}]' denote the K-dimensional
   toxicity state across monitored instruments:
       \mathbf{V}_t = \mathbf{\Phi} \mathbf{V}_{t-1} + \boldsymbol{\epsilon}_t, \quad \boldsymbol{\epsilon}_t \sim (0, \mathbf{\Sigma})

2. Generalized Forecast Error Variance Decomposition (GFEVD):
   KPPS / Diebold-Yilmaz invariant decomposition over forecast horizon H:
       \theta_{ij}(H) = \frac{\sigma_{jj}^{-1} \sum_{h=0}^{H-1} (\mathbf{e}_i' \mathbf{A}_h \mathbf{\Sigma} \mathbf{e}_j)^2}{\sum_{h=0}^{H-1} (\mathbf{e}_i' \mathbf{A}_h \mathbf{\Sigma} \mathbf{A}_h' \mathbf{e}_i)}
   Row-normalized variance shares:
       \tilde{\theta}_{ij}(H) = \frac{\theta_{ij}(H)}{\sum_{j=1}^K \theta_{ij}(H)}, \quad \sum_{j=1}^K \tilde{\theta}_{ij}(H) \equiv 1.0

3. Total & Directional Spillover Indices:
   Total Systemic Spillover Index:
       S^*(H) = \frac{\sum_{i=1}^K \sum_{j=1, j \ne i}^K \tilde{\theta}_{ij}(H)}{K} \times 100\% \in [0.0, 100.0\%]
   Directional Spillover Transmitted to Others:
       S_{\cdot \leftarrow i}(H) = \sum_{j \ne i} \tilde{\theta}_{ji}(H) \times 100\%
   Directional Spillover Received from Others:
       S_{i \leftarrow \cdot}(H) = \sum_{j \ne i} \tilde{\theta}_{ij}(H) \times 100\%
   Net Transmitter / Receiver Metric:
       NS_i(H) = S_{\cdot \leftarrow i}(H) - S_{i \leftarrow \cdot}(H)

4. Systemic Contagion Alert & Maker Veto:
   - S^*(H) \ge 40.0\%: SYSTEMIC_CONTAGION_ACTIVE
     Triggers universal passive maker quote widening and halts high-beta stock accumulation.
"""

from dataclasses import dataclass, field
from datetime import datetime
import math
from typing import Dict, List, Optional, Tuple
import sqlite3


@dataclass
class DirectionalSpilloverMetrics:
    symbol: str
    transmitted_to_others: float  # Percentage [0.0, 100.0]
    received_from_others: float   # Percentage [0.0, 100.0]
    net_spillover: float          # Positive = Transmitter, Negative = Receiver
    is_net_transmitter: bool


@dataclass
class SystemicContagionAlert:
    timestamp: datetime
    total_spillover_index: float  # Percentage S*(H)
    regime: str  # 'IDIOSYNCRATIC_ISOLATED', 'MODERATE_SPILLOVER', 'SYSTEMIC_CONTAGION'
    is_contagion_alert_active: bool
    lead_transmitter_symbol: str
    directional_metrics: Dict[str, DirectionalSpilloverMetrics]
    recommended_portfolio_action: str


class ToxicSpilloverEngine:
    """
    Cross-asset order flow toxicity spillover and contagion engine.
    """

    def __init__(
        self,
        contagion_threshold_pct: float = 40.0,
        moderate_threshold_pct: float = 25.0,
        forecast_horizon_h: int = 4,
        db_path: str = ":memory:",
    ):
        self.contagion_threshold_pct = contagion_threshold_pct
        self.moderate_threshold_pct = moderate_threshold_pct
        self.forecast_horizon = forecast_horizon_h
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
            CREATE TABLE IF NOT EXISTS toxic_spillover_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                total_spillover REAL NOT NULL,
                regime TEXT NOT NULL,
                lead_transmitter TEXT NOT NULL,
                is_alert INTEGER NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def fit_var1_matrix(data: List[List[float]]) -> Tuple[List[List[float]], List[List[float]]]:
        r"""
        Fits a simple VAR(1) model \mathbf{V}_t = \mathbf{\Phi} \mathbf{V}_{t-1} + \boldsymbol{\epsilon}_t.
        Returns (\mathbf{\Phi}, \mathbf{\Sigma}).
        data is a list of time observations, each observation having K values: [T x K].
        """
        t_len = len(data)
        if t_len < 5:
            # Fallback identity/diagonal prior
            k = len(data[0]) if data else 1
            phi = [[0.5 if i == j else 0.0 for j in range(k)] for i in range(k)]
            sigma = [[0.01 if i == j else 0.0 for j in range(k)] for i in range(k)]
            return phi, sigma

        k = len(data[0])

        # Centering
        means = [sum(data[t][i] for t in range(t_len)) / t_len for i in range(k)]
        centered = [[data[t][i] - means[i] for i in range(k)] for t in range(t_len)]

        # Estimate phi_ij using cross-covariances: \Phi \approx \Gamma_1 \Gamma_0^{-1}
        # For simplicity and numerical stability in microsecond loops, we use regularized univariate projections
        phi = [[0.0 for _ in range(k)] for _ in range(k)]
        for i in range(k):
            var_i = sum(centered[t][i] ** 2 for t in range(t_len - 1)) / (t_len - 1)
            var_i = max(var_i, 1e-6)
            for j in range(k):
                cov_ij = sum(centered[t + 1][i] * centered[t][j] for t in range(t_len - 1)) / (t_len - 1)
                # Bounded AR(1) coefficient
                phi[i][j] = min(max(cov_ij / var_i, -0.90), 0.90)

        # Residual covariance \Sigma
        residuals = []
        for t in range(t_len - 1):
            res_t = []
            for i in range(k):
                pred_i = sum(phi[i][j] * centered[t][j] for j in range(k))
                res_t.append(centered[t + 1][i] - pred_i)
            residuals.append(res_t)

        n_res = len(residuals)
        sigma = [[0.0 for _ in range(k)] for _ in range(k)]
        for i in range(k):
            for j in range(k):
                cov = sum(residuals[t][i] * residuals[t][j] for t in range(n_res)) / max(n_res, 1)
                sigma[i][j] = cov if i != j else max(cov, 1e-6)

        return phi, sigma

    def compute_gfevd_matrix(
        self,
        phi: List[List[float]],
        sigma: List[List[float]],
        h_steps: int = 4,
    ) -> List[List[float]]:
        r"""
        Computes row-normalized Generalized Forecast Error Variance Decomposition (GFEVD) matrix \tilde{\theta}.
        Output is K x K where row i sums to 1.0 (100% of variance).
        """
        k = len(phi)
        theta_raw = [[0.0 for _ in range(k)] for _ in range(k)]

        # MA coefficients A_h: A_0 = I, A_1 = Phi, A_2 = Phi^2, etc.
        ma_coefs = []
        curr_a = [[1.0 if i == j else 0.0 for j in range(k)] for i in range(k)]
        ma_coefs.append(curr_a)

        for h in range(1, h_steps):
            next_a = [[0.0 for _ in range(k)] for _ in range(k)]
            for i in range(k):
                for j in range(k):
                    next_a[i][j] = sum(curr_a[i][m] * phi[m][j] for m in range(k))
            ma_coefs.append(next_a)
            curr_a = next_a

        # KPPS numerator and denominator
        for i in range(k):
            # Denominator: \sum_{h=0}^{H-1} e_i' A_h \Sigma A_h' e_i
            denom = 0.0
            for h in range(h_steps):
                a_h = ma_coefs[h]
                term_vec = [sum(a_h[i][m] * sigma[m][n] for m in range(k)) for n in range(k)]
                denom += sum(term_vec[n] * a_h[i][n] for n in range(k))
            denom = max(denom, 1e-9)

            for j in range(k):
                sigma_jj = max(sigma[j][j], 1e-9)
                num = 0.0
                for h in range(h_steps):
                    a_h = ma_coefs[h]
                    # e_i' A_h \Sigma e_j = row i of A_h dot col j of \Sigma
                    cross_term = sum(a_h[i][m] * sigma[m][j] for m in range(k))
                    num += (cross_term ** 2)

                theta_raw[i][j] = (num / sigma_jj) / denom

        # Row normalization: \tilde{\theta}_{ij} = \theta_{ij} / \sum_j \theta_{ij}
        theta_norm = [[0.0 for _ in range(k)] for _ in range(k)]
        for i in range(k):
            row_sum = sum(theta_raw[i][j] for j in range(k))
            row_sum = max(row_sum, 1e-9)
            for j in range(k):
                theta_norm[i][j] = theta_raw[i][j] / row_sum

        return theta_norm

    def assess_spillover_risk(
        self,
        symbols: List[str],
        vpin_time_series: List[List[float]],  # T rows, K columns
        timestamp: datetime,
    ) -> SystemicContagionAlert:
        """
        Calculates Total and Directional Spillover Indices across monitored instruments.
        """
        k = len(symbols)
        if k < 2 or len(vpin_time_series) < 5:
            # Insufficient dimensions for cross-asset spillover
            return SystemicContagionAlert(
                timestamp=timestamp,
                total_spillover_index=0.0,
                regime='IDIOSYNCRATIC_ISOLATED',
                is_contagion_alert_active=False,
                lead_transmitter_symbol=symbols[0] if symbols else "NONE",
                directional_metrics={},
                recommended_portfolio_action="NORMAL_OPERATION",
            )

        phi, sigma = self.fit_var1_matrix(vpin_time_series)
        gfevd = self.compute_gfevd_matrix(phi, sigma, h_steps=self.forecast_horizon)

        # Total Spillover S*(H) = (sum_{i != j} theta_ij / K) * 100%
        off_diag_sum = sum(gfevd[i][j] for i in range(k) for j in range(k) if i != j)
        total_spillover = (off_diag_sum / float(k)) * 100.0
        total_spillover = min(max(total_spillover, 0.0), 100.0)

        directional_metrics: Dict[str, DirectionalSpilloverMetrics] = {}
        for idx, sym in enumerate(symbols):
            # Transmitted to others: sum of col idx (excluding diagonal) * 100
            transmitted = sum(gfevd[j][idx] for j in range(k) if j != idx) * 100.0
            # Received from others: sum of row idx (excluding diagonal) * 100
            received = sum(gfevd[idx][j] for j in range(k) if j != idx) * 100.0
            net = transmitted - received

            directional_metrics[sym] = DirectionalSpilloverMetrics(
                symbol=sym,
                transmitted_to_others=round(transmitted, 2),
                received_from_others=round(received, 2),
                net_spillover=round(net, 2),
                is_net_transmitter=(net > 0),
            )

        # Identify lead transmitter (highest net spillover)
        lead_sym = max(directional_metrics.keys(), key=lambda s: directional_metrics[s].net_spillover)

        # Regime classification
        if total_spillover >= self.contagion_threshold_pct:
            regime = 'SYSTEMIC_CONTAGION'
            alert_active = True
            action = "WIDEN_MAKER_SPREADS_AND_PAUSE_INVENTORY_ACCUMULATION"
        elif total_spillover >= self.moderate_threshold_pct:
            regime = 'MODERATE_SPILLOVER'
            alert_active = False
            action = "APPLY_CONSERVATIVE_SPREAD_MULTIPLIER_1.5X"
        else:
            regime = 'IDIOSYNCRATIC_ISOLATED'
            alert_active = False
            action = "NORMAL_OPERATION"

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO toxic_spillover_telemetry (
                timestamp, total_spillover, regime, lead_transmitter, is_alert
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                timestamp.isoformat(),
                round(total_spillover, 2),
                regime,
                lead_sym,
                1 if alert_active else 0,
            )
        )
        conn.commit()

        return SystemicContagionAlert(
            timestamp=timestamp,
            total_spillover_index=round(total_spillover, 2),
            regime=regime,
            is_contagion_alert_active=alert_active,
            lead_transmitter_symbol=lead_sym,
            directional_metrics=directional_metrics,
            recommended_portfolio_action=action,
        )
