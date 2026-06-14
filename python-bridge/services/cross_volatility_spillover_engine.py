r"""Multi-Horizon Cross-Correlation & Volatility Spillover Lead-Lag Engine (Domain 197 / WP-CU)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Multi-asset realized volatility estimation and logarithmic variance transformations.
2. Generalized Vector Autoregression (VAR(p)) and Generalized Forecast Error Variance
   Decomposition (GFEVD) following Diebold & Yilmaz (2012) and Pesaran & Shin (1998).
3. Directional Volatility Spillover Matrix:
   - Spillover TO others: S_{i -> *}
   - Spillover FROM others: S_{* -> i}
   - Net Volatility Spillover: Net_i = S_{i -> *} - S_{* -> i}
   - Total Volatility Spillover Index (TSI).
4. Asymmetric Cross-Correlation Lead-Lag estimation across tick/time lags \tau \in [-L, +L].
5. Institutional risk sentry & pre-hedging alpha signals for cross-market contagion.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class MarketRole(Enum):
    """Network transmission role of an asset in the volatility graph."""
    NET_TRANSMITTER = "NET_TRANSMITTER"  # Lead asset / volatility exporter
    NET_RECEIVER = "NET_RECEIVER"        # Lag asset / volatility absorber
    NEUTRAL = "NEUTRAL"                  # Balanced / independent flow


class ContagionRegime(Enum):
    """Systemic market-wide volatility contagion regime."""
    DECOUPLED = "DECOUPLED"       # TSI < 30% (idiosyncratic risk dominates)
    MODERATE = "MODERATE"         # 30% <= TSI < 60% (normal cross-market transmission)
    ELEVATED = "ELEVATED"         # 60% <= TSI < 75% (strong spillover alert)
    CRISIS_CASCADE = "CRISIS_CASCADE" # TSI >= 75% (systemic market-wide volatility lock)


@dataclass
class SpilloverProfile:
    """Asset-level volatility transmission profile."""
    symbol: str
    spillover_to_others: float   # % of variance shock transmitted to other markets
    spillover_from_others: float # % of variance shock imported from other markets
    net_spillover: float         # To - From (positive = exporter/lead, negative = importer/lag)
    own_variance_share: float    # % of forecast error variance explained by own shocks
    role: MarketRole


@dataclass
class LeadLagRelationship:
    """Pairwise high-frequency lead-lag cross-correlation summary."""
    lead_symbol: str
    lag_symbol: str
    optimal_lag_steps: int       # Number of steps lead precedes lag (> 0 means lead precedes lag)
    peak_correlation: float      # Maximum cross-correlation at optimal lag
    asymmetry_ratio: float       # Forward vs backward correlation ratio (> 1 indicates directional lead)
    statistically_significant: bool


@dataclass
class CrossVolatilityAnalysisResult:
    """Comprehensive multi-horizon spillover and lead-lag diagnostic result."""
    symbols: List[str]
    forecast_horizon: int
    total_spillover_index: float # 0 to 100%
    contagion_regime: ContagionRegime
    spillover_matrix: List[List[float]] # Normalized GFEVD matrix (rows = receivers, cols = transmitters)
    asset_profiles: Dict[str, SpilloverProfile]
    primary_transmitter: str
    primary_receiver: str
    lead_lag_pairs: List[LeadLagRelationship]
    pre_hedge_recommendations: List[Dict[str, Any]]


class CrossVolatilitySpilloverEngine:
    r"""Multi-Horizon Cross-Correlation & Volatility Spillover Lead-Lag Engine.
    
    Formulation:
    1. Realized variance time-series: y_t = [log(sigma_{1,t}^2), ..., log(sigma_{N,t}^2)]^T
    2. VAR(1) Estimation via OLS:
       y_t = \Phi y_{t-1} + \epsilon_t, \quad \Sigma = \mathbb{E}[\epsilon_t \epsilon_t^T]
    3. Moving Average VMA representation:
       y_t = \sum_{h=0}^\infty A_h \epsilon_{t-h}, \quad A_h = \Phi^h
    4. Generalized Forecast Error Variance Decomposition (Diebold-Yilmaz 2012):
       \theta_{ij}^g(H) = \frac{\sigma_{jj}^{-1} \sum_{h=0}^{H-1} (e_i^T A_h \Sigma e_j)^2}{\sum_{h=0}^{H-1} (e_i^T A_h \Sigma A_h^T e_i)}
       Normalized: \tilde{\theta}_{ij} = \theta_{ij}^g(H) / \sum_{k=1}^N \theta_{ik}^g(H)
    """

    def __init__(
        self,
        default_horizon: int = 10,
        significance_threshold: float = 0.25,
        elevated_tsi_threshold: float = 60.0,
        crisis_tsi_threshold: float = 75.0,
    ) -> None:
        self.default_horizon = default_horizon
        self.significance_threshold = significance_threshold
        self.elevated_tsi_threshold = elevated_tsi_threshold
        self.crisis_tsi_threshold = crisis_tsi_threshold

    def calculate_log_realized_variances(
        self,
        return_series: Dict[str, List[float]],
        window: int = 20,
    ) -> Dict[str, List[float]]:
        r"""Compute rolling log-realized-variance series: \log(\sum r_\tau^2 + \epsilon)."""
        log_vars: Dict[str, List[float]] = {}
        for symbol, rets in return_series.items():
            if len(rets) < window:
                raise ValueError(f"Asset {symbol} series length ({len(rets)}) < window ({window})")
            n = len(rets)
            series: List[float] = []
            for t in range(window, n + 1):
                chunk = rets[t - window : t]
                rv = sum(r * r for r in chunk)
                # Safeguard against zero variance
                safe_rv = max(rv, 1e-8)
                series.append(math.log(safe_rv))
            log_vars[symbol] = series
        return log_vars

    def fit_var1_coefficients(
        self,
        series_matrix: List[List[float]],
    ) -> Tuple[List[List[float]], List[List[float]]]:
        r"""Fit a stationary VAR(1) model: Y = \Phi X + E via Ridge-regularized OLS.
        
        Args:
            series_matrix: N x T matrix of demeaned log-volatilities.
        Returns:
            Phi: N x N transition matrix.
            Sigma: N x N residual covariance matrix.
        """
        n_assets = len(series_matrix)
        t_obs = len(series_matrix[0])
        if t_obs < n_assets + 2:
            raise ValueError(f"Insufficient observations ({t_obs}) for {n_assets} assets in VAR(1)")

        # Demean series
        demeaned: List[List[float]] = []
        for i in range(n_assets):
            mean_i = sum(series_matrix[i]) / t_obs
            demeaned.append([v - mean_i for v in series_matrix[i]])

        # X is t=0..T-2, Y is t=1..T-1
        k_obs = t_obs - 1
        # Compute Cross-Moments: G_0 = (1/k) Y X^T, G_1 = (1/k) X X^T
        # Add ridge shrinkage lambda * I to G_1 for guaranteed invertibility
        ridge_lambda = 1e-4

        # G_1 = X X^T / k (N x N)
        g1 = [[0.0] * n_assets for _ in range(n_assets)]
        # G_0 = Y X^T / k (N x N)
        g0 = [[0.0] * n_assets for _ in range(n_assets)]

        for t in range(k_obs):
            for i in range(n_assets):
                x_i = demeaned[i][t]
                y_i = demeaned[i][t + 1]
                for j in range(n_assets):
                    x_j = demeaned[j][t]
                    g1[i][j] += (x_i * x_j) / k_obs
                    g0[i][j] += (y_i * x_j) / k_obs

        for i in range(n_assets):
            g1[i][i] += ridge_lambda

        # Invert G1 using Gauss-Jordan elimination
        inv_g1 = self._invert_matrix(g1)

        # Phi = G0 * inv_G1
        phi = [[0.0] * n_assets for _ in range(n_assets)]
        for i in range(n_assets):
            for j in range(n_assets):
                phi[i][j] = sum(g0[i][k] * inv_g1[k][j] for k in range(n_assets))

        # Compute residuals E = Y - Phi * X
        residuals: List[List[float]] = [[0.0] * k_obs for _ in range(n_assets)]
        for t in range(k_obs):
            for i in range(n_assets):
                pred = sum(phi[i][j] * demeaned[j][t] for j in range(n_assets))
                residuals[i][t] = demeaned[i][t + 1] - pred

        # Covariance Sigma = E E^T / k
        sigma = [[0.0] * n_assets for _ in range(n_assets)]
        for i in range(n_assets):
            for j in range(n_assets):
                s = sum(residuals[i][t] * residuals[j][t] for t in range(k_obs)) / k_obs
                sigma[i][j] = s

        # Regularize diagonal of Sigma if needed
        for i in range(n_assets):
            if sigma[i][i] < 1e-6:
                sigma[i][i] = 1e-6

        return phi, sigma

    def compute_gfevd_spillover_matrix(
        self,
        phi: List[List[float]],
        sigma: List[List[float]],
        horizon: int = 10,
    ) -> List[List[float]]:
        r"""Compute the Diebold-Yilmaz (2012) normalized GFEVD matrix.
        
        Element \tilde{\theta}_{ij}(H) is the percentage of forecast error variance
        of asset i explained by shocks originating in asset j.
        Rows sum to 1.0 (or 100%).
        """
        n = len(phi)
        # Compute VMA coefficient matrices A_h = Phi^h for h = 0 .. H-1
        a_mats: List[List[List[float]]] = []
        # A_0 = Identity
        curr_a = [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]
        a_mats.append(curr_a)

        for _ in range(1, horizon):
            next_a = self._matmul(curr_a, phi)
            a_mats.append(next_a)
            curr_a = next_a

        # Raw variance contributions theta_ij
        theta_raw = [[0.0] * n for _ in range(n)]

        for i in range(n):
            # Denominator: sum_{h=0}^{H-1} e_i^T A_h \Sigma A_h^T e_i
            denom = 0.0
            for h in range(horizon):
                ah = a_mats[h]
                # row_i of Ah is e_i^T Ah
                row_i = ah[i]
                # row_i * Sigma * row_i^T
                val = 0.0
                for r in range(n):
                    s_r = sum(row_i[c] * sigma[c][r] for c in range(n))
                    val += s_r * row_i[r]
                denom += val

            safe_denom = max(denom, 1e-12)

            for j in range(n):
                sig_jj = max(sigma[j][j], 1e-12)
                # Numerator: \sigma_{jj}^{-1} \sum_{h=0}^{H-1} (e_i^T A_h \Sigma e_j)^2
                num_sum = 0.0
                for h in range(horizon):
                    ah = a_mats[h]
                    row_i = ah[i]
                    # term = e_i^T A_h \Sigma e_j = row_i * col_j of Sigma
                    term = sum(row_i[k] * sigma[k][j] for k in range(n))
                    num_sum += term * term

                theta_raw[i][j] = (num_sum / sig_jj) / safe_denom

        # Normalize rows so that \sum_{j=1}^N \tilde{\theta}_{ij} = 1.0
        normalized = [[0.0] * n for _ in range(n)]
        for i in range(n):
            row_sum = sum(theta_raw[i])
            safe_row_sum = max(row_sum, 1e-12)
            for j in range(n):
                normalized[i][j] = theta_raw[i][j] / safe_row_sum

        return normalized

    def compute_lead_lag_cross_correlation(
        self,
        series_a: List[float],
        series_b: List[float],
        symbol_a: str,
        symbol_b: str,
        max_lag: int = 10,
    ) -> LeadLagRelationship:
        r"""Compute asymmetric cross-correlation \rho(\tau) = Corr(A_t, B_{t+\tau}) for \tau \in [-max_lag, +max_lag].
        
        If \tau^* > 0: A leads B (shocks in A show up in B after \tau^* periods).
        If \tau^* < 0: B leads A.
        """
        n = min(len(series_a), len(series_b))
        if n < max_lag * 2 + 5:
            return LeadLagRelationship(
                lead_symbol=symbol_a,
                lag_symbol=symbol_b,
                optimal_lag_steps=0,
                peak_correlation=0.0,
                asymmetry_ratio=1.0,
                statistically_significant=False,
            )

        mean_a = sum(series_a[:n]) / n
        mean_b = sum(series_b[:n]) / n
        dev_a = [x - mean_a for x in series_a[:n]]
        dev_b = [x - mean_b for x in series_b[:n]]
        var_a = sum(d * d for d in dev_a)
        var_b = sum(d * d for d in dev_b)
        denom = math.sqrt(max(var_a * var_b, 1e-12))

        corrs: Dict[int, float] = {}
        for lag in range(-max_lag, max_lag + 1):
            if lag > 0:
                # A leads B by lag (Corr(A_t, B_{t+lag}))
                cov = sum(dev_a[t] * dev_b[t + lag] for t in range(n - lag))
            elif lag < 0:
                # B leads A by |lag| (Corr(A_{t+|lag|}, B_t))
                abs_lag = abs(lag)
                cov = sum(dev_a[t + abs_lag] * dev_b[t] for t in range(n - abs_lag))
            else:
                cov = sum(dev_a[t] * dev_b[t] for t in range(n))
            corrs[lag] = cov / denom

        # Find peak lag
        best_lag = 0
        best_abs_corr = -1.0
        for lag, r in corrs.items():
            if abs(r) > best_abs_corr:
                best_abs_corr = abs(r)
                best_lag = lag

        peak_corr = corrs[best_lag]

        # Asymmetry calculation: positive lag strength vs negative lag strength
        pos_strength = sum(abs(corrs[l]) for l in range(1, max_lag + 1))
        neg_strength = sum(abs(corrs[l]) for l in range(-max_lag, 0))
        asym = (pos_strength + 1e-6) / (neg_strength + 1e-6)

        sig = (abs(peak_corr) >= self.significance_threshold) and (best_lag != 0)

        if best_lag > 0:
            lead = symbol_a
            lag_sym = symbol_b
            opt_steps = best_lag
        elif best_lag < 0:
            lead = symbol_b
            lag_sym = symbol_a
            opt_steps = abs(best_lag)
            asym = 1.0 / asym
        else:
            lead = symbol_a
            lag_sym = symbol_b
            opt_steps = 0

        return LeadLagRelationship(
            lead_symbol=lead,
            lag_symbol=lag_sym,
            optimal_lag_steps=opt_steps,
            peak_correlation=round(peak_corr, 4),
            asymmetry_ratio=round(asym, 4),
            statistically_significant=sig,
        )

    def analyze_cross_market_spillover(
        self,
        symbol_series: Dict[str, List[float]],
        horizon: Optional[int] = None,
        max_cross_lag: int = 5,
    ) -> CrossVolatilityAnalysisResult:
        """Run end-to-end multi-asset volatility spillover and lead-lag analysis."""
        h = horizon or self.default_horizon
        symbols = list(symbol_series.keys())
        n = len(symbols)

        if n < 2:
            raise ValueError("Cross-market spillover requires at least 2 distinct asset series")

        raw_matrix = [symbol_series[s] for s in symbols]
        phi, sigma = self.fit_var1_coefficients(raw_matrix)
        norm_gfevd = self.compute_gfevd_spillover_matrix(phi, sigma, horizon=h)

        # 1. Compute Spillover Metrics
        # Spillover TO others from j: sum_{i != j} theta_{ij} * (100 / N)
        # Spillover FROM others to i: sum_{j != i} theta_{ij} * (100 / N)
        to_others: Dict[str, float] = {}
        from_others: Dict[str, float] = {}
        own_shares: Dict[str, float] = {}

        for j, sym_j in enumerate(symbols):
            col_to_others = sum(norm_gfevd[i][j] for i in range(n) if i != j)
            to_others[sym_j] = round(col_to_others * (100.0 / n), 3)

        for i, sym_i in enumerate(symbols):
            row_from_others = sum(norm_gfevd[i][j] for j in range(n) if j != i)
            from_others[sym_i] = round(row_from_others * (100.0 / n), 3)
            own_shares[sym_i] = round(norm_gfevd[i][i] * 100.0, 3)

        # Total Spillover Index (TSI)
        total_off_diag = sum(
            norm_gfevd[i][j] for i in range(n) for j in range(n) if i != j
        )
        tsi = round((total_off_diag / n) * 100.0, 3)

        # Contagion Regime
        if tsi < 30.0:
            regime = ContagionRegime.DECOUPLED
        elif tsi < self.elevated_tsi_threshold:
            regime = ContagionRegime.MODERATE
        elif tsi < self.crisis_tsi_threshold:
            regime = ContagionRegime.ELEVATED
        else:
            regime = ContagionRegime.CRISIS_CASCADE

        # Build Asset Profiles
        profiles: Dict[str, SpilloverProfile] = {}
        for sym in symbols:
            s_to = to_others[sym]
            s_from = from_others[sym]
            net = round(s_to - s_from, 3)
            if net > 1.0:
                role = MarketRole.NET_TRANSMITTER
            elif net < -1.0:
                role = MarketRole.NET_RECEIVER
            else:
                role = MarketRole.NEUTRAL

            profiles[sym] = SpilloverProfile(
                symbol=sym,
                spillover_to_others=s_to,
                spillover_from_others=s_from,
                net_spillover=net,
                own_variance_share=own_shares[sym],
                role=role,
            )

        # Identify Primary Transmitter and Receiver
        primary_trans = max(symbols, key=lambda s: profiles[s].net_spillover)
        primary_recv = min(symbols, key=lambda s: profiles[s].net_spillover)

        # 2. Pairwise High-Frequency Lead-Lag Cross-Correlation
        lead_lags: List[LeadLagRelationship] = []
        for i in range(n):
            for j in range(i + 1, n):
                rel = self.compute_lead_lag_cross_correlation(
                    series_a=symbol_series[symbols[i]],
                    series_b=symbol_series[symbols[j]],
                    symbol_a=symbols[i],
                    symbol_b=symbols[j],
                    max_lag=max_cross_lag,
                )
                lead_lags.append(rel)

        # 3. Pre-Hedging & Execution Directives
        recommendations = self._generate_pre_hedge_signals(
            regime=regime,
            tsi=tsi,
            profiles=profiles,
            lead_lags=lead_lags,
        )

        return CrossVolatilityAnalysisResult(
            symbols=symbols,
            forecast_horizon=h,
            total_spillover_index=tsi,
            contagion_regime=regime,
            spillover_matrix=norm_gfevd,
            asset_profiles=profiles,
            primary_transmitter=primary_trans,
            primary_receiver=primary_recv,
            lead_lag_pairs=lead_lags,
            pre_hedge_recommendations=recommendations,
        )

    def _generate_pre_hedge_signals(
        self,
        regime: ContagionRegime,
        tsi: float,
        profiles: Dict[str, SpilloverProfile],
        lead_lags: List[LeadLagRelationship],
    ) -> List[Dict[str, Any]]:
        """Generate tactical pre-hedging and risk-reduction execution directives."""
        signals: List[Dict[str, Any]] = []

        # Systemic regime defense
        if regime in (ContagionRegime.ELEVATED, ContagionRegime.CRISIS_CASCADE):
            signals.append({
                "action": "SYSTEMIC_RISK_DEFENSE",
                "urgency": "CRITICAL" if regime == ContagionRegime.CRISIS_CASCADE else "HIGH",
                "directive": (
                    f"Systemic spillover elevated (TSI={tsi:.1f}%). Tighten inventory holding "
                    "horizons by 50%, widen maker quotes across all correlated pairs, and "
                    "activate vega-neutral crash collars."
                ),
            })

        # Lead-lag pre-hedging recommendations
        for rel in lead_lags:
            if rel.statistically_significant and rel.optimal_lag_steps > 0:
                lead_p = profiles[rel.lead_symbol]
                lag_p = profiles[rel.lag_symbol]
                if lead_p.net_spillover > 0:
                    signals.append({
                        "action": "ANTICIPATORY_PRE_HEDGE",
                        "lead_asset": rel.lead_symbol,
                        "lag_asset": rel.lag_symbol,
                        "lead_window_steps": rel.optimal_lag_steps,
                        "peak_corr": rel.peak_correlation,
                        "directive": (
                            f"Lead asset '{rel.lead_symbol}' transmits volatility to '{rel.lag_symbol}' "
                            f"with {rel.optimal_lag_steps}-step delay (\rho={rel.peak_correlation:+.2f}). "
                            f"Upon volatility expansion in {rel.lead_symbol}, execute anticipatory "
                            f"protective hedge in {rel.lag_symbol} prior to shock arrival."
                        ),
                    })

        return signals

    # Internal Matrix Utilities
    def _matmul(self, a: List[List[float]], b: List[List[float]]) -> List[List[float]]:
        n = len(a)
        res = [[0.0] * n for _ in range(n)]
        for i in range(n):
            for j in range(n):
                res[i][j] = sum(a[i][k] * b[k][j] for k in range(n))
        return res

    def _invert_matrix(self, a: List[List[float]]) -> List[List[float]]:
        n = len(a)
        # Augmented matrix [A | I]
        aug = [row[:] + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(a)]

        for col in range(n):
            # Pivot selection
            max_row = col
            max_val = abs(aug[col][col])
            for r in range(col + 1, n):
                if abs(aug[r][col]) > max_val:
                    max_val = abs(aug[r][col])
                    max_row = r

            aug[col], aug[max_row] = aug[max_row], aug[col]
            pivot = aug[col][col]
            if abs(pivot) < 1e-12:
                pivot = 1e-12 if pivot >= 0 else -1e-12

            # Scale pivot row
            for c in range(2 * n):
                aug[col][c] /= pivot

            # Eliminate column entries in other rows
            for r in range(n):
                if r != col:
                    factor = aug[r][col]
                    for c in range(2 * n):
                        aug[r][c] -= factor * aug[col][c]

        return [row[n:] for row in aug]
