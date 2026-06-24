"""
Intraday Realized Volatility Signature Plot & Microstructure Noise Sieve
Domain 225 / Work Package WP-DW

Implements Zhang-Mykland-Aït-Sahalia Two-Time Scale Realized Volatility (TSRV),
Andersen-Bollerslev volatility signature plots, Bandi-Russell optimal sampling
intervals, and high-frequency bid-ask microstructure noise estimation.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class NoiseRegimeState(str, Enum):
    SIGNAL_CLEAR = "SIGNAL_CLEAR"          # Noise ratio <= 0.15, high signal-to-noise ratio
    MODERATE_NOISE = "MODERATE_NOISE"      # Noise ratio 0.15 - 0.40, subsampling recommended
    NOISE_DOMINATED = "NOISE_DOMINATED"    # Noise ratio > 0.40, phantom microstructure bounce


@dataclass
class SignaturePoint:
    tau_seconds: float
    realized_variance: float
    annualized_volatility: float
    num_samples: int


@dataclass
class TSRVResult:
    tsrv_variance: float
    tsrv_annualized_vol: float
    all_points_variance: float
    subgrid_variance: float
    noise_variance_omega2: float
    noise_to_signal_ratio: float
    optimal_sampling_sec: float
    regime: NoiseRegimeState
    details: Dict[str, float] = field(default_factory=dict)


class VolatilitySignatureNoiseSieve:
    """
    Analyzes high-frequency tick price series to separate continuous integrated variance
    from discrete microstructure noise (bid-ask bounce, order routing delays).
    """

    def __init__(
        self,
        trading_hours_per_day: float = 6.5,
        annualization_days: float = 252.0,
        subgrid_k: int = 5,
    ):
        self.trading_hours = trading_hours_per_day
        self.annualization_days = annualization_days
        self.annualization_factor = math.sqrt(annualization_days * trading_hours_per_day * 3600.0)
        self.default_k = max(2, subgrid_k)

    @staticmethod
    def _compute_log_returns(prices: List[float]) -> List[float]:
        """Calculates log returns: r_i = ln(P_i / P_{i-1})."""
        if len(prices) < 2:
            return []
        returns = []
        for i in range(1, len(prices)):
            p0 = prices[i - 1]
            p1 = prices[i]
            if p0 > 0.0 and p1 > 0.0:
                returns.append(math.log(p1 / p0))
            else:
                returns.append(0.0)
        return returns

    def compute_rv(
        self,
        prices: List[float],
        timestamps: List[float],
        interval_seconds: float,
    ) -> SignaturePoint:
        """
        Calculates standard Realized Variance (RV) at a specific sampling interval (tau).
        Uses forward-fill price sampling over regular time bins.
        """
        if len(prices) < 2 or len(timestamps) != len(prices):
            return SignaturePoint(interval_seconds, 0.0, 0.0, 0)

        t_start = timestamps[0]
        t_end = timestamps[-1]
        total_duration = max(t_end - t_start, 1.0)

        if interval_seconds <= 0.0:
            interval_seconds = 1.0

        # Construct sampled grid
        num_bins = int(total_duration / interval_seconds)
        if num_bins < 1:
            # Fallback to endpoints
            log_ret = math.log(prices[-1] / prices[0]) if prices[0] > 0 and prices[-1] > 0 else 0.0
            rv = log_ret * log_ret
            ann_vol = math.sqrt(max(0.0, rv)) * math.sqrt(self.annualization_days * self.trading_hours * 3600.0 / total_duration)
            return SignaturePoint(interval_seconds, rv, ann_vol, 1)

        grid_times = [t_start + i * interval_seconds for i in range(num_bins + 1)]
        sampled_prices = []

        curr_idx = 0
        n_ticks = len(timestamps)

        for gt in grid_times:
            while curr_idx + 1 < n_ticks and timestamps[curr_idx + 1] <= gt:
                curr_idx += 1
            sampled_prices.append(prices[curr_idx])

        returns = self._compute_log_returns(sampled_prices)
        rv = sum(r * r for r in returns)

        # Annualize by scaling to seconds in trading year
        # total period duration fraction of trading year
        period_seconds = total_duration
        year_seconds = self.annualization_days * self.trading_hours * 3600.0
        annualization_mult = math.sqrt(year_seconds / period_seconds) if period_seconds > 0 else 1.0
        ann_vol = math.sqrt(max(0.0, rv)) * annualization_mult

        return SignaturePoint(
            tau_seconds=interval_seconds,
            realized_variance=rv,
            annualized_volatility=ann_vol,
            num_samples=len(returns),
        )

    def compute_signature_plot(
        self,
        prices: List[float],
        timestamps: List[float],
        tau_grid_seconds: Optional[List[float]] = None,
    ) -> List[SignaturePoint]:
        """
        Computes the Andersen-Bollerslev volatility signature plot across a spectrum of frequencies.
        Signature plot reveals the asymptote of microstructure noise as tau -> 0.
        """
        if tau_grid_seconds is None:
            tau_grid_seconds = [1.0, 5.0, 15.0, 30.0, 60.0, 180.0, 300.0, 600.0]

        return [self.compute_rv(prices, timestamps, tau) for tau in tau_grid_seconds]

    def compute_tsrv(
        self,
        prices: List[float],
        timestamps: List[float],
        k: Optional[int] = None,
    ) -> TSRVResult:
        """
        Computes Zhang-Mykland-Aït-Sahalia (2005) Two-Time Scale Realized Volatility (TSRV).
        TSRV = [Y,Y]^{(K)} - (n_bar / n) * [Y,Y]_{all}
        where [Y,Y]^{(K)} is the average RV across K interleaved subgrids.
        """
        n = len(prices) - 1
        if n < 4:
            return TSRVResult(
                tsrv_variance=0.0,
                tsrv_annualized_vol=0.0,
                all_points_variance=0.0,
                subgrid_variance=0.0,
                noise_variance_omega2=0.0,
                noise_to_signal_ratio=0.0,
                optimal_sampling_sec=30.0,
                regime=NoiseRegimeState.SIGNAL_CLEAR,
            )

        subgrid_k = k if k is not None else min(self.default_k, max(2, n // 4))

        # All-points RV: [Y, Y]_{all}
        raw_returns = self._compute_log_returns(prices)
        rv_all = sum(r * r for r in raw_returns)

        # Subgrid RV: interleaved subsampling
        # Grid k has indices: k, k + subgrid_k, k + 2*subgrid_k, ...
        subgrid_rvs = []
        for offset in range(subgrid_k):
            sub_indices = list(range(offset, len(prices), subgrid_k))
            if len(sub_indices) >= 2:
                sub_prices = [prices[idx] for idx in sub_indices]
                sub_returns = self._compute_log_returns(sub_prices)
                sub_rv = sum(r * r for r in sub_returns)
                subgrid_rvs.append(sub_rv)

        avg_subgrid_rv = sum(subgrid_rvs) / len(subgrid_rvs) if subgrid_rvs else rv_all

        # Bias correction: n_bar = (n - K + 1) / K
        n_bar = (n - subgrid_k + 1.0) / subgrid_k
        bias_term = (n_bar / n) * rv_all if n > 0 else 0.0

        tsrv_var = avg_subgrid_rv - bias_term

        # Guard against small sample negative variance truncation
        effective_tsrv_var = max(tsrv_var, 1e-10)

        # Microstructure noise variance estimator:
        # Since E[RV_all] = IV + 2n*omega^2 and E[TSRV] = IV,
        # 2n*omega^2 = max(0, RV_all - TSRV)
        excess_noise_rv = max(0.0, rv_all - effective_tsrv_var)
        noise_var_omega2 = excess_noise_rv / (2.0 * n) if n > 0 else 0.0

        # Total duration in seconds
        total_duration = max(timestamps[-1] - timestamps[0], 1.0)
        year_seconds = self.annualization_days * self.trading_hours * 3600.0
        ann_mult = math.sqrt(year_seconds / total_duration)
        tsrv_ann_vol = math.sqrt(effective_tsrv_var) * ann_mult

        # Noise-to-signal ratio: proportion of all-points RV attributable to microstructure noise
        noise_to_signal = (excess_noise_rv / rv_all) if rv_all > 1e-12 else 0.0

        # Bandi-Russell optimal sampling interval approximation:
        # Quarticity: IQ = (n / 3) * sum(r^4)
        iq = (n / 3.0) * sum(r ** 4 for r in raw_returns)
        effective_noise_omega2 = max(noise_var_omega2, 1e-10)
        if iq > 1e-12:
            # Optimal number of observations: n* = (IQ / (4 * omega^4))^(1/3)
            # Optimal tau = Duration / n*
            ratio = iq / (4.0 * (effective_noise_omega2 ** 2))
            n_star = max(1.0, ratio ** (1.0 / 3.0))
            opt_tau = max(1.0, min(total_duration / n_star, 900.0))
        else:
            opt_tau = 30.0

        # Regime classification
        if noise_to_signal <= 0.15:
            regime = NoiseRegimeState.SIGNAL_CLEAR
        elif noise_to_signal <= 0.40:
            regime = NoiseRegimeState.MODERATE_NOISE
        else:
            regime = NoiseRegimeState.NOISE_DOMINATED

        return TSRVResult(
            tsrv_variance=effective_tsrv_var,
            tsrv_annualized_vol=tsrv_ann_vol,
            all_points_variance=rv_all,
            subgrid_variance=avg_subgrid_rv,
            noise_variance_omega2=noise_var_omega2,
            noise_to_signal_ratio=noise_to_signal,
            optimal_sampling_sec=opt_tau,
            regime=regime,
            details={
                "n_ticks": float(n),
                "subgrid_k": float(subgrid_k),
                "bias_term": bias_term,
                "raw_tsrv_variance": tsrv_var,
                "total_duration_sec": total_duration,
            },
        )
