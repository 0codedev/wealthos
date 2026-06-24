"""
Intraday Volume-Duration Point Process & Non-Homogeneous Poisson Flow Engine
Domain 228 / Work Package WP-DZ

Implements Engle-Russell Autoregressive Conditional Duration (ACD) point processes,
intraday U-shaped diurnal intensity scaling, and trade flow acceleration /
liquidity drought sentry filters.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class FlowRegimeState(str, Enum):
    BURST_ACCELERATION = "BURST_ACCELERATION"  # High trade arrival intensity, institutional sweep
    NORMAL_POISSON_FLOW = "NORMAL_POISSON_FLOW"# Equilibrium steady-state arrival
    LIQUIDITY_DROUGHT = "LIQUIDITY_DROUGHT"    # Abnormally long inter-trade duration, dried-up liquidity


@dataclass
class DurationEvent:
    event_id: int
    timestamp: float        # Epoch seconds or intraday seconds
    volume: float           # Executed volume in lot or USD
    duration_seconds: float # Inter-event elapsed time: t_i - t_{i-1}


@dataclass
class ACDParameters:
    omega: float  # Base duration baseline
    alpha: float  # Shock sensitivity to previous duration
    beta: float   # Persistence of previous expected duration
    persistence: float  # alpha + beta (< 1.0 for stationarity)
    unconditional_mean_duration: float


@dataclass
class VolumeFlowDecision:
    current_duration_sec: float
    expected_duration_psi_sec: float
    standardized_residual: float
    instantaneous_intensity_hz: float
    burst_acceleration_ratio: float
    regime: FlowRegimeState
    recommended_action: str
    details: Dict[str, float] = field(default_factory=dict)


class VolumeDurationPoissonFlowEngine:
    """
    Tracks transaction arrival dynamics, filters out intraday diurnal patterns,
    and isolates high-frequency trade burst clusters from liquidity droughts.
    """

    def __init__(
        self,
        default_omega: float = 0.5,
        default_alpha: float = 0.15,
        default_beta: float = 0.80,
        trading_day_seconds: float = 23400.0, # 6.5 hours = 23,400 sec
    ):
        self.default_params = ACDParameters(
            omega=default_omega,
            alpha=default_alpha,
            beta=default_beta,
            persistence=default_alpha + default_beta,
            unconditional_mean_duration=default_omega / max(1e-4, 1.0 - (default_alpha + default_beta)),
        )
        self.day_seconds = trading_day_seconds
        self.midday_sec = trading_day_seconds / 2.0

    def compute_diurnal_factor(self, intraday_sec: float) -> float:
        """
        Computes intraday U-shaped seasonality factor s(t).
        Higher intensity at open and close; lower intensity at midday.
        s(t) = 1.0 + 0.6 * ((t - t_mid) / t_mid)^2
        """
        t = max(0.0, min(self.day_seconds, intraday_sec))
        normalized_dist = (t - self.midday_sec) / self.midday_sec
        return 1.0 + 0.6 * (normalized_dist ** 2)

    def calibrate_acd_parameters(self, durations: List[float]) -> ACDParameters:
        """
        Calibrates ACD(1,1) parameters using method of moments / empirical bounds.
        psi_i = omega + alpha * x_{i-1} + beta * psi_{i-1}
        """
        if not durations:
            return self.default_params

        mean_dur = sum(durations) / len(durations)
        if len(durations) < 5:
            persistence = 0.95
            alpha = 0.15
            beta = 0.80
            omega = max(0.001, mean_dur * (1.0 - persistence))
            return ACDParameters(
                omega=omega,
                alpha=alpha,
                beta=beta,
                persistence=persistence,
                unconditional_mean_duration=mean_dur,
            )

        var_dur = sum((d - mean_dur) ** 2 for d in durations) / len(durations)

        # Autocorrelation at lag 1
        num = sum((durations[i] - mean_dur) * (durations[i - 1] - mean_dur) for i in range(1, len(durations)))
        rho_1 = num / (len(durations) * max(1e-6, var_dur))

        # Restrict persistence to stationary range (0.50 - 0.95)
        persistence = max(0.50, min(0.95, 0.70 + 0.25 * max(0.0, rho_1)))
        alpha = max(0.05, min(0.30, persistence * 0.20))
        beta = persistence - alpha
        omega = max(0.001, mean_dur * (1.0 - persistence))

        return ACDParameters(
            omega=omega,
            alpha=alpha,
            beta=beta,
            persistence=persistence,
            unconditional_mean_duration=mean_dur,
        )

    def compute_conditional_durations(
        self,
        durations: List[float],
        params: Optional[ACDParameters] = None,
    ) -> List[float]:
        """
        Computes the sequence of expected conditional durations psi_i:
        psi_i = omega + alpha * x_{i-1} + beta * psi_{i-1}
        """
        p = params if params is not None else self.default_params
        if not durations:
            return []

        sample_mean = sum(durations) / len(durations) if durations else p.unconditional_mean_duration
        psi = [sample_mean]
        for i in range(1, len(durations)):
            x_prev = max(1e-4, durations[i - 1])
            psi_curr = p.omega + p.alpha * x_prev + p.beta * psi[-1]
            psi.append(psi_curr)

        return psi

    def evaluate_flow_regime(
        self,
        current_duration: float,
        duration_history: List[float],
        intraday_timestamp_sec: float = 3600.0,
        custom_params: Optional[ACDParameters] = None,
    ) -> VolumeFlowDecision:
        """
        Evaluates real-time trade arrival flow regime.
        Detects institutional sweeps (bursts) vs drying liquidity (droughts).
        """
        params = custom_params if custom_params is not None else self.calibrate_acd_parameters(duration_history)
        diurnal_factor = self.compute_diurnal_factor(intraday_timestamp_sec)

        # Compute current expected conditional duration psi
        if duration_history:
            prev_durations = duration_history[-20:] # rolling window
            psi_series = self.compute_conditional_durations(prev_durations, params)
            prev_psi = psi_series[-1]
            last_x = max(1e-4, duration_history[-1])
            psi = params.omega + params.alpha * last_x + params.beta * prev_psi
        else:
            psi = params.unconditional_mean_duration

        psi = max(1e-4, psi)
        cur_x = max(1e-4, current_duration)

        # Standardized residual epsilon_i = x_i / psi_i
        epsilon = cur_x / psi

        # Instantaneous realized arrival intensity of current event:
        # lambda_hz = diurnal_factor / cur_x (events per second)
        lambda_hz = diurnal_factor / cur_x
        expected_lambda_hz = diurnal_factor / psi

        # Burst acceleration ratio: ratio of expected duration to realized duration
        # High value (> 2.75) means events are arriving 3x faster than expected
        burst_ratio = psi / cur_x

        # Sentry Regime Decision
        if burst_ratio >= 2.75 or (epsilon <= 0.35 and lambda_hz > 1.0):
            regime = FlowRegimeState.BURST_ACCELERATION
            action = f"BURST_ACCELERATION: Trade arrival rate {lambda_hz:.2f} Hz ({burst_ratio:.1f}x baseline). Institutional sweep detected."
        elif epsilon >= 3.0 or lambda_hz < 0.05:
            regime = FlowRegimeState.LIQUIDITY_DROUGHT
            action = f"LIQUIDITY_DROUGHT: Duration {cur_x:.1f}s is {epsilon:.1f}x expected psi ({psi:.1f}s). Spreads widening."
        else:
            regime = FlowRegimeState.NORMAL_POISSON_FLOW
            action = f"NORMAL_FLOW: Equilibrium arrival intensity {lambda_hz:.2f} Hz (psi={psi:.2f}s, epsilon={epsilon:.2f})."

        return VolumeFlowDecision(
            current_duration_sec=cur_x,
            expected_duration_psi_sec=psi,
            standardized_residual=epsilon,
            instantaneous_intensity_hz=lambda_hz,
            burst_acceleration_ratio=burst_ratio,
            regime=regime,
            recommended_action=action,
            details={
                "diurnal_factor": diurnal_factor,
                "omega": params.omega,
                "alpha": params.alpha,
                "beta": params.beta,
                "persistence": params.persistence,
            },
        )
